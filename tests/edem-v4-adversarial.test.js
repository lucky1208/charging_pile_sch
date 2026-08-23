'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');
const engineDir = path.join(rootDir, 'engine');

function runtime() {
  const win = {};
  orderedEngineFiles(engineDir).forEach((file) => {
    const source = fs.readFileSync(path.join(engineDir, file), 'utf8');
    new Function('window', 'document', source)(win, {});
  });
  return win;
}

const win = runtime();

function params(extra) {
  return Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'EDEM-ADVERSARIAL', standard: 'gb', archetype: 'dc-integrated',
    outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
    acVoltage: 380, voltageWindow: '200-1000', thermal: 'air',
    essEnabled: false, requirementConfirmed: true
  }, extra || {});
}

function build(extra) {
  return win.EVSE_ENGINE.build(params(extra)).design;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function refreshHash(model) {
  model.modelHash = win.EVSE_DESIGN.modelHash({
    schemaVersion: model.schemaVersion,
    requirements: model.requirements,
    instances: model.instances,
    nets: model.nets,
    circuits: model.circuits,
    assumptions: model.assumptions,
    decisions: model.decisions,
    capabilities: model.capabilities,
    topology: model.topology,
    ess: model.ess
  });
  return model;
}

function validateRehashed(model) {
  refreshHash(model);
  const result = win.EVSE_ERC.validate(model);
  assert.equal(result.violations.some((item) => item.code === 'MODEL_HASH_MISMATCH'), false,
    'mutation test must exercise semantic ERC, not only the integrity fingerprint');
  assert.ok(result.blockingCount > 0);
  return result;
}

function codes(result) {
  return new Set(result.violations.map((item) => item.code));
}

function replaceEndpoint(model, left, right) {
  const swap = (value) => {
    const candidate = value.instanceId + ':' + value.terminalId;
    if (candidate === left) {
      const split = right.lastIndexOf(':');
      value.instanceId = right.slice(0, split);
      value.terminalId = right.slice(split + 1);
    } else if (candidate === right) {
      const split = left.lastIndexOf(':');
      value.instanceId = left.slice(0, split);
      value.terminalId = left.slice(split + 1);
    }
  };
  model.nets.forEach((net) => net.members.forEach(swap));
  model.circuits.forEach((circuit) => {
    const from = { instanceId: circuit.from, terminalId: circuit.fromPort };
    const to = { instanceId: circuit.to, terminalId: circuit.toPort };
    swap(from);
    swap(to);
    circuit.from = from.instanceId;
    circuit.fromPort = from.terminalId;
    circuit.to = to.instanceId;
    circuit.toPort = to.terminalId;
  });
}

test('normal GB/EU/US and both ESS couplings remain ERC clean', () => {
  ['gb', 'eu', 'us'].forEach((standard) => {
    const design = build({ standard, acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard], gunCount: 4 });
    assert.equal(win.EVSE_ERC.validate(design).status, 'PASS');
  });
  ['dc', 'ac'].forEach((essCoupling) => {
    const design = build({ essEnabled: true, essCoupling, essKwh: 200, essPowerKw: 120 });
    assert.equal(win.EVSE_ERC.validate(design).status, 'PASS');
  });
});

test('missing conductor identity cannot be hidden by recomputing modelHash', () => {
  const phase = clone(build());
  const acNet = phase.nets.find((net) => net.netClass === 'POWER_AC' && net.phase === 'L2');
  delete acNet.phase;
  phase.circuits.filter((circuit) => circuit.netId === acNet.id).forEach((circuit) => delete circuit.phase);
  assert.ok(codes(validateRehashed(phase)).has('PHASE_REQUIRED'));

  const polarity = clone(build());
  const dcNet = polarity.nets.find((net) => net.netClass === 'POWER_DC' && net.polarity === 'NEGATIVE');
  delete dcNet.polarity;
  polarity.circuits.filter((circuit) => circuit.netId === dcNet.id).forEach((circuit) => delete circuit.polarity);
  assert.ok(codes(validateRehashed(polarity)).has('POLARITY_REQUIRED'));
});

test('12V/24V, PE/DC-negative and AC phases cannot be cross-connected', () => {
  const auxiliary = clone(build());
  replaceEndpoint(auxiliary, 'EQ-CTL-A1:PWR_V24', 'EQ-CTL-A3:PWR_V12');
  assert.ok([...codes(validateRehashed(auxiliary))].some((code) => /DOMAIN|VOLTAGE|AUX_/.test(code)));

  const earth = clone(build());
  replaceEndpoint(earth, 'EQ-G1-XS:PE', 'EQ-G1-XS:DC_NEG');
  assert.ok([...codes(validateRehashed(earth))].some((code) => /PE_|POLARITY|DOMAIN|NET_CLASS|CONNECTOR/.test(code)));

  const phases = clone(build());
  replaceEndpoint(phases, 'EQ-AC-QS1:IN_L1', 'EQ-AC-QS1:IN_L2');
  assert.ok([...codes(validateRehashed(phases))].some((code) => /PHASE/.test(code)));
});

test('differential legs, CP/PP roles and communication protocols are exact', () => {
  const gb = clone(build({ standard: 'gb', acVoltage: 380 }));
  replaceEndpoint(gb, 'EQ-G1-XS:S_POS', 'EQ-G1-XS:S_NEG');
  assert.ok(codes(validateRehashed(gb)).has('SIGNAL_ROLE_MISMATCH'));

  const eu = clone(build({ standard: 'eu', acVoltage: 400 }));
  replaceEndpoint(eu, 'EQ-G1-XS:CP', 'EQ-G1-XS:PP');
  const euCodes = codes(validateRehashed(eu));
  assert.ok(euCodes.has('SIGNAL_ROLE_MISMATCH') || euCodes.has('NET_CLASS_MISMATCH'));

  const protocol = clone(build());
  const commNet = protocol.nets.find((net) => net.netClass === 'SIGNAL_COMM');
  commNet.protocol = 'WRONG_PROTOCOL';
  protocol.circuits.filter((circuit) => circuit.netId === commNet.id).forEach((circuit) => { circuit.protocol = 'WRONG_PROTOCOL'; });
  assert.ok(codes(validateRehashed(protocol)).has('PROTOCOL_MISMATCH'));
});

test('terminal aliases, duplicate terminals, approvals and connector types fail closed', () => {
  const aliases = clone(build());
  aliases.instances[0].ports[0].domain = 'TAMPERED';
  assert.ok(codes(validateRehashed(aliases)).has('TERMINAL_ALIAS_DIVERGED'));

  const duplicate = clone(build());
  const target = duplicate.instances.find((instance) => instance.id === 'EQ-CTL-A1');
  target.terminals.push(clone(target.terminals[0]));
  assert.ok(codes(validateRehashed(duplicate)).has('TERMINAL_ID_DUPLICATE'));

  const approval = clone(build());
  approval.instances[0].definition = null;
  approval.equipment.find((instance) => instance.id === approval.instances[0].id).definition = null;
  assert.ok(codes(validateRehashed(approval)).has('DEFINITION_NOT_APPROVED'));

  assert.equal(win.EVSE_CONNECTOR_LIB.get('unknown-connector'), null);
  assert.throws(() => win.EVSE_DEVICE_CATALOG.definition('charge-connector', { connectorType: 'unknown-connector' }), /Unknown connector definition/);
  const connector = clone(build());
  connector.instances.find((instance) => instance.kind === 'charge-connector').connectorType = 'unknown-connector';
  connector.equipment.find((instance) => instance.kind === 'charge-connector').connectorType = 'unknown-connector';
  assert.ok(codes(validateRehashed(connector)).has('CONNECTOR_TYPE_UNSUPPORTED'));
});

test('net/circuit coverage and every circuit semantic field are independently checked', () => {
  const missing = clone(build());
  missing.circuits.splice(0, 1);
  const missingCodes = codes(validateRehashed(missing));
  assert.ok(missingCodes.has('NET_WITHOUT_CIRCUIT') || missingCodes.has('NET_CIRCUIT_DISCONNECTED'));

  const semantics = clone(build());
  const acCircuit = semantics.circuits.find((circuit) => circuit.phase === 'L1');
  acCircuit.phase = 'L2';
  assert.ok(codes(validateRehashed(semantics)).has('CIRCUIT_SEMANTICS_MISMATCH'));

  const repeated = clone(build());
  const copy = clone(repeated.circuits[0]);
  copy.id = 'CCT-ADVERSARIAL-DUPLICATE';
  repeated.circuits.push(copy);
  assert.ok(codes(validateRehashed(repeated)).has('CIRCUIT_EDGE_DUPLICATE'));
});

test('ESS precharge order is enforced even when every terminal and circuit stays connected', () => {
  const design = clone(build({ essEnabled: true, essCoupling: 'dc', essKwh: 200, essPowerKw: 120 }));
  replaceEndpoint(design, 'EQ-ESS-KP1:IN', 'EQ-ESS-RS1:A');
  replaceEndpoint(design, 'EQ-ESS-KP1:OUT', 'EQ-ESS-RS1:B');
  const result = validateRehashed(design);
  assert.ok(codes(result).has('ESS_PRECHARGE_TOPOLOGY'), JSON.stringify(result.violations));
});

test('ESS DC grid fuse and contactor order cannot be reversed', () => {
  const design = clone(build({ essEnabled: true, essCoupling: 'dc', essKwh: 200, essPowerKw: 120 }));
  replaceEndpoint(design, 'EQ-ESS-FC1:IN', 'EQ-ESS-KC1:IN');
  replaceEndpoint(design, 'EQ-ESS-FC1:OUT', 'EQ-ESS-KC1:OUT');
  const result = validateRehashed(design);
  assert.ok(codes(result).has('ESS_DC_GRID_CONTACTOR') || codes(result).has('ESS_DC_GRID_FUSE'), JSON.stringify(result.violations));
});
