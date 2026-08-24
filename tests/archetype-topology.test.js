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

function build(standard, archetype, extra) {
  const params = Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'ARCH-' + standard + '-' + archetype,
    standard,
    archetype,
    acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard],
    outputKw: 120,
    moduleKw: 30,
    gunCount: 2,
    gunCurrentA: 250,
    voltageWindow: '200-1000',
    essEnabled: archetype === 'ess-mobile',
    essKwh: 120,
    requirementConfirmed: true
  }, extra || {});
  return win.EVSE_ENGINE.build(params).design;
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

function codes(model) {
  return new Set(win.EVSE_ERC.validate(refreshHash(model)).violations.map((item) => item.code));
}

function replaceEndpoint(model, left, right) {
  function parse(value) {
    const split = value.lastIndexOf(':');
    return { instanceId: value.slice(0, split), terminalId: value.slice(split + 1) };
  }
  const a = parse(left);
  const b = parse(right);
  function swap(value) {
    if (value.instanceId === a.instanceId && value.terminalId === a.terminalId) Object.assign(value, b);
    else if (value.instanceId === b.instanceId && value.terminalId === b.terminalId) Object.assign(value, a);
  }
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

test('all five standards and four archetypes compile independent terminal-level templates', () => {
  ['gb', 'eu', 'us', 'nacs', 'chademo'].forEach((standard) => {
    ['dc-integrated', 'dc-split', 'ac-dc-combo', 'ess-mobile'].forEach((archetype) => {
      const design = build(standard, archetype);
      assert.equal(design.modelValidation.status, 'PASS', standard + '/' + archetype + ': ' + JSON.stringify(design.modelValidation.violations));
      assert.equal(design.topology.archetypeContract.id, archetype);
      assert.ok(design.topology.archetypeContract.requiredKinds.length > 0);
      assert.ok(design.topology.archetypeContract.markerIds.length > 0);
    });
  });
  const split = build('gb', 'dc-split');
  assert.equal(split.topology.splitCableLinks.length, 2);
  ['DC_POS', 'DC_NEG', 'PE', 'COMM_P', 'COMM_N', 'INTERLOCK', 'V24', 'V24_0V'].forEach((identity) => {
    assert.ok(split.circuits.some((circuit) => circuit.cableId === 'CBL-G1' &&
      (circuit.fromPort.includes(identity) || circuit.toPort.includes(identity))), 'missing split conductor ' + identity);
  });
});

test('0823 mobile template preserves K1..K10, dual inputs, 24/12/5V and separate communications', () => {
  ['gb', 'eu', 'us', 'nacs', 'chademo'].forEach((standard) => {
    const design = build(standard, 'ess-mobile');
    assert.equal(design.modelValidation.status, 'PASS', standard + ': ' + JSON.stringify(design.modelValidation.violations));
    for (let number = 1; number <= 10; number += 1) assert.ok(design.instances.some((instance) => instance.id === 'EQ-MOB-K' + number));
    assert.ok(design.instances.some((instance) => instance.id === 'EQ-MOB-DC-IN' && instance.kind === 'dc-charge-inlet'));
    assert.ok(design.instances.some((instance) => instance.id === 'EQ-MOB-AC-IN' && instance.kind === 'ac-charge-connector'));
    assert.ok(design.instances.some((instance) => instance.id === 'EQ-MOB-G1-XS' && instance.kind === 'charge-connector'));
    assert.notEqual(design.topology.mobileReference.replenishment.dcInlet, design.topology.gunBranches[0].connector);
    assert.deepEqual(design.topology.mobileReference.batteryBoxIds, ['EQ-MOB-BAT1', 'EQ-MOB-BAT2', 'EQ-MOB-BAT3']);
    assert.equal(design.instances.filter((instance) => instance.kind === 'battery-box').length, 3);
    assert.equal(design.instances.filter((instance) => instance.kind === 'battery-cluster' && /^EQ-MOB-/.test(instance.id)).length, 0);
    assert.equal(design.nets.filter((net) => net.seriesJunctionType === 'BATTERY_BOX_STRING' && net.polarity === 'INTERMEDIATE').length, 2);
    assert.equal(design.nets.filter((net) => net.seriesJunctionType === 'BATTERY_HEATER_STRING' && net.polarity === 'INTERMEDIATE').length, 2);
    const domains = new Set(design.nets.filter((net) => net.netClass === 'POWER_DC_AUX').map((net) => net.domain));
    ['AUX_24V', 'AUX_12V', 'AUX_5V'].forEach((domain) => assert.ok(domains.has(domain), standard + ' ' + domain));
    const protocols = new Set(design.nets.filter((net) => net.netClass === 'SIGNAL_COMM').map((net) => net.protocol));
    ['BMS_CAN', 'VEHICLE_CAN', 'CHARGE_CAN', 'SECC_CAN', 'MODULE_CAN', 'SERIAL_UNKNOWN', 'TA_TB_UNKNOWN', 'HMI_UART', 'CARD_READER_SERIAL_UNKNOWN']
      .forEach((protocol) => assert.ok(protocols.has(protocol), standard + ' ' + protocol));
    const pcs = design.instances.find((instance) => instance.id === 'EQ-MOB-PCS');
    assert.equal(pcs.energyDirection, 'UNRESOLVED');
    assert.ok(!pcs.name.includes('双向'));
    assert.equal(pcs.reverseCapability, 'UNRESOLVED');
    assert.equal(pcs.terminals.find((terminal) => terminal.id === 'ESS_DC_POS').direction, 'out');
    assert.equal(pcs.terminals.find((terminal) => terminal.id === 'AC_L1').direction, 'in');
  });
});

test('mobile measurement and observed control hardware stay separate and evidence bounded', () => {
  const design = build('eu', 'ess-mobile');
  const byId = new Map(design.instances.map((instance) => [instance.id, instance]));
  const meter = byId.get('EQ-MOB-PJ2');
  ['SENSE_DC_POS', 'SENSE_DC_NEG', 'SHUNT_SENSE_P', 'SHUNT_SENSE_N', 'COMM_TA', 'COMM_TB'].forEach((id) => {
    assert.ok(meter.terminals.some((terminal) => terminal.id === id && terminal.required), id);
  });
  assert.ok(!meter.terminals.some((terminal) => terminal.id === 'IN' || terminal.id === 'OUT'), 'meter must not carry gun main power');
  ['METER_PWR_POS', 'METER_PWR_RET'].forEach((terminalId) => {
    const terminal = meter.terminals.find((item) => item.id === terminalId);
    assert.equal(terminal.required, false);
    assert.equal(terminal.evidenceStatus, 'OBSERVED_VOLTAGE_UNRESOLVED');
    assert.ok(!design.nets.some((net) => net.members.some((member) => member.instanceId === meter.id && member.terminalId === terminalId)));
  });
  assert.ok(design.circuits.some((circuit) => circuit.from === 'EQ-MOB-RS1' && circuit.fromPort === 'OUT' && circuit.to === 'EQ-MOB-K8' && circuit.toPort === 'IN'));
  ['P', 'N'].forEach((side) => {
    assert.ok(design.circuits.some((circuit) => circuit.from === 'EQ-MOB-RS1' && circuit.fromPort === 'KELVIN_' + side &&
      circuit.to === 'EQ-MOB-PJ2' && circuit.toPort === 'SHUNT_SENSE_' + side));
  });
  ['TA', 'TB'].forEach((side) => {
    assert.ok(design.nets.some((net) => net.protocol === 'TA_TB_UNKNOWN' && net.members.some((member) => member.instanceId === 'EQ-MOB-PJ2' && member.terminalId === 'COMM_' + side) &&
      net.members.some((member) => member.instanceId === 'EQ-MOB-VCU' && member.terminalId === 'J6_METER_' + side)));
  });
  ['EQ-MOB-DISPLAY', 'EQ-MOB-CARD', 'EQ-MOB-VOICE', 'EQ-MOB-SPK', 'EQ-MOB-HL-Y', 'EQ-MOB-HL-G', 'EQ-MOB-HL-R',
    'EQ-MOB-TEMP', 'EQ-MOB-QT', 'EQ-MOB-X12', 'EQ-MOB-KA-JTA', 'EQ-MOB-KA-FAN', 'EQ-MOB-FAN'].forEach((id) => assert.ok(byId.has(id), id));
  assert.equal(byId.get('EQ-MOB-QT').contactForm, 'NO_NC_UNKNOWN');
  assert.deepEqual(byId.get('EQ-MOB-QT').observedTerminalLabels, ['XS/5', 'XS/20', 'TX/ENABLE', 'TX/GND']);
  assert.equal(byId.get('EQ-MOB-TEMP').kind, 'temperature-sensor');
  ['TX', 'RX'].forEach((terminalId) => {
    assert.ok(byId.get('EQ-MOB-DISPLAY').terminals.some((terminal) => terminal.id === terminalId));
    assert.ok(byId.get('EQ-MOB-CARD').terminals.some((terminal) => terminal.id === terminalId));
  });
  assert.ok(byId.get('EQ-MOB-VOICE').terminals.some((terminal) => terminal.id === 'RX'));
  assert.ok(!byId.get('EQ-MOB-VOICE').terminals.some((terminal) => terminal.id === 'TX'));
  assert.ok(design.nets.some((net) => net.protocol === 'HMI_UART' &&
    ['EQ-MOB-VCU:HMI_TX', 'EQ-MOB-DISPLAY:RX', 'EQ-MOB-VOICE:RX'].every((identity) => {
      const split = identity.split(':');
      return net.members.some((member) => member.instanceId === split[0] && member.terminalId === split[1]);
    })));
  assert.equal(byId.get('EQ-MOB-KA-FAN').terminals.find((terminal) => terminal.id === 'COIL_V12').domain, 'AUX_12V');
  assert.equal(byId.get('EQ-MOB-FAN').terminals.find((terminal) => terminal.id === 'CTRL_PWR_V12').domain, 'AUX_12V');
  assert.ok(design.assumptions.some((item) => item.id === 'ESS-MOBILE-BCU-OBSERVED-TERMINALS' && item.value === 'OBSERVED_UNMAPPED'));
});

test('five mobile replenishment interfaces preserve physical assemblies, locks and CHAdeMO 12V', () => {
  ['gb', 'eu', 'us', 'nacs', 'chademo'].forEach((standard) => {
    const design = build(standard, 'ess-mobile');
    const dcInlet = design.instances.find((instance) => instance.id === 'EQ-MOB-DC-IN');
    const acInlet = design.instances.find((instance) => instance.id === 'EQ-MOB-AC-IN');
    const lock = design.instances.find((instance) => instance.id === 'EQ-MOB-INLET-LOCK');
    const sharesAssembly = ['eu', 'us', 'nacs'].includes(standard);
    assert.equal(dcInlet.physicalAssemblyId === acInlet.physicalAssemblyId, sharesAssembly, standard);
    assert.equal(acInlet.assemblyMode, sharesAssembly
      ? (standard === 'nacs' ? 'SHARED_CONTROL_AND_POWER_CONTACTS_MODE_EXCLUSIVE' : 'SHARED_CONTROL_CONTACTS')
      : 'SEPARATE_PHYSICAL_CONNECTORS');
    const modeInterlock = design.instances.find((instance) => instance.id === 'EQ-MOB-NACS-MODE-ILK');
    assert.equal(!!modeInterlock, standard === 'nacs');
    if (modeInterlock) {
      assert.equal(modeInterlock.modeRelationship, 'MUTUALLY_EXCLUSIVE');
      assert.ok(design.topology.archetypeContract.requiredKinds.includes('ac-dc-mode-interlock'));
    }
    if (standard === 'chademo') {
      assert.equal(lock, undefined);
      const aux = design.nets.find((net) => net.members.some((member) => member.instanceId === dcInlet.id && member.terminalId === 'CHARGER_12V'));
      assert.equal(aux.domain, 'CONNECTOR_AUX_12V');
      assert.equal(aux.nominalVoltageV, 12);
    } else {
      assert.ok(lock);
      ['FEEDBACK', 'FEEDBACK_2'].forEach((terminalId) => assert.ok(design.nets.some((net) => net.members.some((member) => member.instanceId === lock.id && member.terminalId === terminalId))));
    }
  });
});

test('mobile fused-node, replenishment and JT permission mutations fail the archetype contract', () => {
  const fu3 = clone(build('eu', 'ess-mobile'));
  replaceEndpoint(fu3, 'EQ-MOB-FU3:OUT', 'EQ-MOB-K6:IN');
  const fu3Codes = codes(fu3);
  assert.ok(fu3Codes.has('MOBILE_PCS_POS_BUS') || fu3Codes.has('MOBILE_FUSED_BRANCH'));

  const k4 = clone(build('eu', 'ess-mobile'));
  replaceEndpoint(k4, 'EQ-MOB-K4:OUT', 'EQ-MOB-K1:IN');
  assert.ok(codes(k4).has('MOBILE_K4_BUS'));

  const jt = clone(build('eu', 'ess-mobile'));
  replaceEndpoint(jt, 'EQ-MOB-JT:B_OUT', 'EQ-MOB-JT:C_OUT');
  const jtCodes = codes(jt);
  assert.ok(jtCodes.has('MOBILE_JT_B_PERMISSION') || jtCodes.has('MOBILE_JT_C_PERMISSION'));
});

test('mobile series strings, meter bypass and observed relay chains fail closed under mutation', () => {
  const battery = clone(build('eu', 'ess-mobile'));
  replaceEndpoint(battery, 'EQ-MOB-BAT2:SERIES_HIGH', 'EQ-MOB-ESS-BUS:BUS_DC_POS');
  const batteryCodes = codes(battery);
  assert.ok(batteryCodes.has('INTERMEDIATE_JUNCTION_TOPOLOGY') || batteryCodes.has('MOBILE_BATTERY_SERIES'));

  const heater = clone(build('eu', 'ess-mobile'));
  replaceEndpoint(heater, 'EQ-MOB-HEATER2:HEAT_HIGH', 'EQ-MOB-ESS-BUS:BUS_DC_POS');
  const heaterCodes = codes(heater);
  assert.ok(heaterCodes.has('INTERMEDIATE_JUNCTION_TOPOLOGY') || heaterCodes.has('MOBILE_HEATER_SERIES'));

  const meter = clone(build('eu', 'ess-mobile'));
  replaceEndpoint(meter, 'EQ-MOB-RS1:OUT', 'EQ-MOB-PJ2:SENSE_DC_NEG');
  assert.ok(codes(meter).has('MOBILE_GUN_NEG_ORDER'));

  const fan = clone(build('eu', 'ess-mobile'));
  replaceEndpoint(fan, 'EQ-MOB-KA-FAN:CONTACT_OUT', 'EQ-MOB-AUX-BUS:BUS12_V12');
  assert.ok(codes(fan).has('MOBILE_FAN_RELAY'));

  const can = clone(build('eu', 'ess-mobile'));
  const edgeIndex = can.circuits.findIndex((circuit) => circuit.from === 'EQ-MOB-BAT2' && circuit.fromPort === 'CAN_P' && circuit.to === 'EQ-MOB-BAT3' && circuit.toPort === 'CAN_P');
  assert.ok(edgeIndex >= 0);
  can.circuits.splice(edgeIndex, 1);
  assert.ok(codes(can).has('MOBILE_BATTERY_CAN_DAISY_CHAIN'));
});

test('mobile input assembly and dual feedback mutations are blocked', () => {
  const gb = clone(build('gb', 'ess-mobile'));
  gb.instances.find((instance) => instance.id === 'EQ-MOB-AC-IN').physicalAssemblyId = gb.instances.find((instance) => instance.id === 'EQ-MOB-DC-IN').physicalAssemblyId;
  assert.ok(codes(gb).has('AC_DC_ASSEMBLY_BOUNDARY'));

  const nacs = clone(build('nacs', 'ess-mobile'));
  nacs.instances.find((instance) => instance.id === 'EQ-MOB-AC-IN').assemblyMode = 'SHARED_CONTROL_CONTACTS';
  assert.ok(codes(nacs).has('NACS_AC_DC_MODE_BOUNDARY'));

  const nacsHard = clone(build('nacs', 'ess-mobile'));
  replaceEndpoint(nacsHard, 'EQ-MOB-NACS-MODE-ILK:DC_PERMISSION_V24', 'EQ-MOB-AUX-BUS:BUS24_V24');
  assert.ok(codes(nacsHard).has('NACS_AC_DC_HARD_INTERLOCK'));

  const eu = clone(build('eu', 'ess-mobile'));
  eu.nets.forEach((net) => { net.members = net.members.filter((member) => !(member.instanceId === 'EQ-MOB-INLET-LOCK' && member.terminalId === 'FEEDBACK_2')); });
  eu.circuits = eu.circuits.filter((circuit) => !((circuit.from === 'EQ-MOB-INLET-LOCK' && circuit.fromPort === 'FEEDBACK_2') || (circuit.to === 'EQ-MOB-INLET-LOCK' && circuit.toPort === 'FEEDBACK_2')));
  assert.ok(codes(eu).has('REQUIRED_TERMINAL_OPEN'));
});

test('split cable PE deletion cannot be hidden by a recomputed model hash', () => {
  const design = clone(build('gb', 'dc-split'));
  const index = design.circuits.findIndex((circuit) => circuit.cableId === 'CBL-G1' &&
    ((circuit.from === 'EQ-G1-IF-CAB' && circuit.fromPort === 'PE') || (circuit.to === 'EQ-G1-IF-CAB' && circuit.toPort === 'PE')));
  assert.ok(index >= 0);
  design.circuits.splice(index, 1);
  assert.ok(codes(design).has('SPLIT_CABLE_CONDUCTOR_MISSING'));
});

test('GB AC CC identity and NACS transformer boundary fail closed', () => {
  const gb = clone(build('gb', 'ac-dc-combo'));
  const connector = gb.instances.find((instance) => instance.id === 'EQ-AC-EV-XS1');
  [connector.terminals, connector.physicalTerminals, connector.ports].forEach((terminals) => {
    const terminal = terminals.find((item) => item.id === 'CC');
    terminal.id = 'PP';
    terminal.signalRole = 'AC:PP';
  });
  connector.functionalPorts.forEach((port) => {
    port.physicalTerminalIds = port.physicalTerminalIds.map((id) => id === 'CC' ? 'PP' : id);
    if (port.id === 'CC') port.id = 'PP';
  });
  gb.nets.forEach((net) => net.members.forEach((member) => { if (member.instanceId === connector.id && member.terminalId === 'CC') member.terminalId = 'PP'; }));
  gb.circuits.forEach((circuit) => {
    if (circuit.from === connector.id && circuit.fromPort === 'CC') circuit.fromPort = 'PP';
    if (circuit.to === connector.id && circuit.toPort === 'CC') circuit.toPort = 'PP';
  });
  assert.ok(codes(gb).has('AC_CONNECTOR_CONTROL_SET'));

  const nacs = clone(build('nacs', 'ac-dc-combo'));
  replaceEndpoint(nacs, 'EQ-AC-EV-TX1:OUT_L1', 'EQ-AC-EV-QF1:OUT_L1');
  const nacsCodes = codes(nacs);
  assert.ok(nacsCodes.has('AC_EV_TRANSFORMER_BYPASSED') || nacsCodes.has('DOMAIN_MISMATCH'));
});
