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
    pileName: 'EDEM-V4-TEST', standard: 'gb', archetype: 'dc-integrated',
    outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
    acVoltage: 380, voltageWindow: '200-1000', thermal: 'air',
    essEnabled: false, requirementConfirmed: true
  }, extra || {});
}

function build(extra) { return win.EVSE_ENGINE.build(params(extra)); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function memberKey(member) { return member.instanceId + ':' + member.terminalId; }

test('EDEM v4 is conductor-level, deterministic, approved, and ERC clean', () => {
  const first = build();
  const second = build();
  const design = first.design;
  assert.equal(first.engineVersion, '4.0.0');
  assert.equal(design.schemaVersion, '4.0.0');
  assert.equal(design.modelValidation.status, 'PASS');
  assert.equal(design.modelValidation.blockingCount, 0);
  assert.equal(design.modelHash, second.design.modelHash);
  assert.deepEqual(design.nets, second.design.nets);
  assert.deepEqual(design.circuits, second.design.circuits);
  assert.ok(design.instances.every((instance) => instance.definition.lifecycle === 'APPROVED'));
  assert.ok(design.instances.every((instance) => instance.terminals.length && instance.functionalPorts.length));
  assert.ok(design.instances.some((instance) => instance.tag === 'RS0'));
  assert.ok(design.instances.some((instance) => instance.tag === 'HL'));
  assert.ok(design.instances.some((instance) => instance.tag === 'B1'));

  const acPhases = new Set(design.nets.filter((net) => net.netClass === 'POWER_AC').map((net) => net.phase));
  assert.deepEqual([...acPhases].sort(), ['L1', 'L2', 'L3', 'N']);
  const auxDomains = new Set(design.nets.filter((net) => net.netClass === 'POWER_DC_AUX').map((net) => net.domain));
  assert.ok(auxDomains.has('AUX_24V'));
  assert.ok(auxDomains.has('AUX_12V'));

  const memberships = new Map();
  design.nets.forEach((net) => net.members.forEach((member) => {
    const key = memberKey(member);
    memberships.set(key, (memberships.get(key) || 0) + 1);
  }));
  assert.ok([...memberships.values()].every((count) => count === 1));
});

test('each connector has distinct DC+, DC-, PE and exact standard signal terminals', () => {
  ['gb', 'eu', 'us'].forEach((standard) => {
    const result = build({ standard, acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard], gunCount: 4 });
    const design = result.design;
    assert.equal(design.modelValidation.blockingCount, 0);
    const connectors = design.instances.filter((instance) => instance.kind === 'charge-connector');
    assert.equal(connectors.length, 4);
    connectors.forEach((connector) => {
      const netFor = (terminalId) => design.nets.find((net) => net.members.some((member) => member.instanceId === connector.id && member.terminalId === terminalId));
      const positive = netFor('DC_POS');
      const negative = netFor('DC_NEG');
      const earth = netFor('PE');
      assert.ok(positive && negative && earth);
      assert.notEqual(positive.id, negative.id);
      assert.equal(positive.polarity, 'POSITIVE');
      assert.equal(negative.polarity, 'NEGATIVE');
      assert.equal(earth.netClass, 'PROTECTIVE_EARTH');
      connector.terminals.filter((terminal) => terminal.required).forEach((terminal) => assert.ok(netFor(terminal.id), connector.id + ':' + terminal.id));
    });
    if (standard !== 'gb') {
      const cpCircuits = design.circuits.filter((circuit) => /:CP$/.test(circuit.from + ':' + circuit.fromPort) || /:CP$/.test(circuit.to + ':' + circuit.toPort));
      const gatewayPorts = cpCircuits.map((circuit) => circuit.from === 'EQ-CTL-A2' ? circuit.fromPort : circuit.toPort);
      assert.equal(new Set(gatewayPorts).size, 4, 'each gun CP must terminate on a distinct gateway terminal');
    }
  });
});

test('ESS model uses atomic fuse/contactors/precharge and explicit grid protection', () => {
  ['dc', 'ac'].forEach((essCoupling) => {
    const design = build({ essEnabled: true, essKwh: 200, essPowerKw: 120, essCoupling }).design;
    assert.equal(design.modelValidation.blockingCount, 0, JSON.stringify(design.modelValidation.violations));
    ['ess-fuse', 'ess-contactor', 'precharge-contactor', 'precharge-resistor'].forEach((kind) => {
      assert.ok(design.instances.some((instance) => instance.kind === kind), 'missing ' + kind);
    });
    if (essCoupling === 'dc') {
      assert.ok(design.instances.some((instance) => instance.tag === 'FC1'));
      assert.ok(design.instances.some((instance) => instance.tag === 'KC1'));
    } else {
      assert.ok(design.instances.some((instance) => instance.tag === 'QF2'));
      assert.ok(design.instances.some((instance) => instance.tag === 'KM2'));
    }
  });
});

test('ERC fails closed for polarity, voltage-domain, PE and approval mutations', () => {
  const original = build().design;

  const polarity = clone(original);
  const connector = polarity.instances.find((instance) => instance.kind === 'charge-connector');
  const positive = polarity.nets.find((net) => net.members.some((member) => member.instanceId === connector.id && member.terminalId === 'DC_POS'));
  positive.members.find((member) => member.instanceId === connector.id).terminalId = 'DC_NEG';
  assert.ok(win.EVSE_ERC.validate(polarity).violations.some((item) => /POLARITY|MULTIPLE_NETS|CONNECTOR/.test(item.code)));

  const voltage = clone(original);
  const net24 = voltage.nets.find((net) => net.domain === 'AUX_24V' && net.polarity === 'POSITIVE');
  const terminal12 = voltage.instances.find((instance) => instance.id === 'EQ-CTL-A3').terminals.find((terminal) => terminal.id === 'PWR_V12');
  terminal12.domain = 'AUX_24V';
  terminal12.voltageV = 12;
  net24.members.push({ instanceId: 'EQ-CTL-A3', terminalId: 'PWR_V12' });
  assert.ok(win.EVSE_ERC.validate(voltage).violations.some((item) => item.code === 'VOLTAGE_MISMATCH'));

  const earth = clone(original);
  const pe = earth.nets.find((net) => net.netClass === 'PROTECTIVE_EARTH');
  pe.members.push({ instanceId: connector.id, terminalId: 'DC_NEG' });
  assert.ok(win.EVSE_ERC.validate(earth).violations.some((item) => /NET_CLASS|DOMAIN|POLARITY|MULTIPLE_NETS/.test(item.code)));

  const approval = clone(original);
  approval.instances[0].definition.lifecycle = 'DRAFT';
  assert.ok(win.EVSE_ERC.validate(approval).violations.some((item) => item.code === 'DEFINITION_NOT_APPROVED'));
});

test('Drawing IR coverage fails when a model circuit or exact endpoint is changed', () => {
  const result = build();
  win.drawPile(result);
  assert.equal(result.drawingIR.coverage.ok, true);

  const changedModel = clone(result.design);
  changedModel.circuits[0].fromPort = changedModel.circuits[1].fromPort;
  const coverage = win.EVSE_DRAWING_IR.auditCoverage(changedModel, result.drawingIR);
  assert.equal(coverage.ok, false);
  assert.ok(coverage.errors.some((item) => item.code === 'CONNECTION_ENDPOINT_MISMATCH'));

  const changedDrawing = Object.assign({}, result.drawingIR, { routes: result.drawingIR.routes.slice(1) });
  const missing = win.EVSE_DRAWING_IR.auditCoverage(result.design, changedDrawing);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((item) => item.code === 'CONNECTION_MISSING_ROUTE'));
});
