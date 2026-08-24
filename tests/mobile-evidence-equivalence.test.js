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

function build(extra) {
  const standard = extra && extra.standard || 'eu';
  const params = Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'MOBILE-EVIDENCE-' + standard,
    standard,
    archetype: 'ess-mobile',
    acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard],
    outputKw: 60,
    moduleKw: 30,
    gunCount: 1,
    gunCurrentA: 250,
    voltageWindow: '200-1000',
    supplyMode: 'offgrid',
    thermal: 'liquid',
    essEnabled: true,
    essKwh: 200,
    essPowerKw: 120,
    essCoupling: 'dc',
    requirementConfirmed: true
  }, extra || {});
  const design = win.EVSE_ENGINE.build(params).design;
  assert.equal(design.modelValidation.status, 'PASS', JSON.stringify(design.modelValidation.violations));
  return design;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rehash(model) {
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

function validateMutation(model) {
  const result = win.EVSE_ERC.validate(rehash(model));
  assert.ok(!result.violations.some((item) => item.code === 'MODEL_HASH_MISMATCH'),
    'mutation must be caught by semantic ERC after modelHash is recomputed');
  return result;
}

function assertMutationBlocked(model, expectedCodes, label) {
  const result = validateMutation(model);
  assert.equal(result.status, 'BLOCKED', label + ': ' + JSON.stringify(result.violations));
  const actual = new Set(result.violations.map((item) => item.code));
  assert.ok(expectedCodes.some((code) => actual.has(code)),
    label + ': expected one of ' + expectedCodes.join(', ') + '; actual ' + Array.from(actual).join(', '));
}

function byId(model, id) {
  const instance = model.instances.find((item) => item.id === id);
  assert.ok(instance, 'missing instance ' + id);
  return instance;
}

function mirrorEquipmentInstance(model, instanceId) {
  const index = (model.equipment || []).findIndex((item) => item.id === instanceId);
  assert.notEqual(index, -1, 'missing equipment compatibility instance ' + instanceId);
  model.equipment[index] = clone(byId(model, instanceId));
}

function terminalLabel(terminal) {
  return terminal.observedLabel || terminal.originalLabel || terminal.label;
}

function netIdsAt(model, instanceId, terminalId) {
  return model.nets.filter((net) => (net.members || []).some((member) =>
    member.instanceId === instanceId && member.terminalId === terminalId)).map((net) => net.id);
}

function isConnected(model, instanceId, terminalId) {
  return netIdsAt(model, instanceId, terminalId).length > 0;
}

function shareNet(model, leftId, leftTerminal, rightId, rightTerminal) {
  const right = new Set(netIdsAt(model, rightId, rightTerminal));
  return netIdsAt(model, leftId, leftTerminal).some((id) => right.has(id));
}

function disconnectTerminal(model, instanceId, terminalId) {
  model.nets.forEach((net) => {
    net.members = (net.members || []).filter((member) =>
      !(member.instanceId === instanceId && member.terminalId === terminalId));
  });
  model.circuits = model.circuits.filter((circuit) =>
    !((circuit.from === instanceId && circuit.fromPort === terminalId) ||
      (circuit.to === instanceId && circuit.toPort === terminalId)));
}

function removeTerminalDefinition(instance, terminalId) {
  ['terminals', 'physicalTerminals', 'ports'].forEach((key) => {
    instance[key] = (instance[key] || []).filter((terminal) => terminal.id !== terminalId);
  });
  (instance.functionalPorts || []).forEach((port) => {
    port.physicalTerminalIds = (port.physicalTerminalIds || []).filter((id) => id !== terminalId);
  });
  instance.functionalPorts = (instance.functionalPorts || []).filter((port) =>
    port.id !== terminalId && (port.physicalTerminalIds || []).length > 0);
}

function removeInstanceEverywhere(model, instanceId) {
  model.instances = model.instances.filter((instance) => instance.id !== instanceId);
  model.equipment = (model.equipment || []).filter((instance) => instance.id !== instanceId);
  model.nets.forEach((net) => {
    net.members = (net.members || []).filter((member) => member.instanceId !== instanceId);
  });
  model.circuits = model.circuits.filter((circuit) => circuit.from !== instanceId && circuit.to !== instanceId);
}

function splitEndpoint(identity) {
  const at = identity.lastIndexOf(':');
  return { instanceId: identity.slice(0, at), terminalId: identity.slice(at + 1) };
}

function coilTerminals(instance) {
  return (instance.terminals || []).filter((terminal) => /^COIL_/.test(terminal.id));
}

function mobileReference(model) {
  assert.ok(model.topology && model.topology.mobileReference, 'missing 0823 mobile reference contract');
  return model.topology.mobileReference;
}

test('mobile module count, labels and ratings are calculated from user parameters', () => {
  [
    { outputKw: 30, moduleKw: 30, expectedCount: 1 },
    { outputKw: 80, moduleKw: 40, expectedCount: 2 }
  ].forEach((sample) => {
    const design = build(sample);
    const modules = design.instances.filter((instance) => instance.kind === 'dc-dc-charge-module');
    assert.equal(modules.length, sample.expectedCount, JSON.stringify(sample));
    assert.equal(mobileReference(design).moduleIds.length, sample.expectedCount);
    modules.forEach((module) => {
      assert.equal(module.unitKw, sample.moduleKw);
      assert.match(module.name, new RegExp(String(sample.moduleKw) + '\\s*kW', 'i'));
      assert.equal(module.ratingStatus, 'CALCULATED');
      assert.ok(module.calculationBasis || module.ratingBasis || module.calculationSource || module.calculation,
        module.id + ' must retain the deterministic calculation evidence');
    });
  });

  const wrongRating = clone(build({ outputKw: 80, moduleKw: 40 }));
  const first = wrongRating.instances.find((instance) => instance.kind === 'dc-dc-charge-module');
  first.unitKw = 30;
  assertMutationBlocked(wrongRating, ['MOBILE_MODULE_SIZING', 'MOBILE_MODULE_RATING_EVIDENCE'], 'module unit rating mutation');

  const wrongLabel = clone(build({ outputKw: 80, moduleKw: 40 }));
  wrongLabel.instances.find((instance) => instance.kind === 'dc-dc-charge-module').name = '30kW DC/DC 充电模块 M1';
  assertMutationBlocked(wrongLabel, ['MOBILE_MODULE_SIZING', 'MOBILE_MODULE_RATING_EVIDENCE'], 'module nameplate mutation');
});

test('precharge control intent keeps the observed order and unresolved settings', () => {
  const design = build();
  const intent = mobileReference(design).prechargeControlIntent;
  assert.ok(intent, 'prechargeControlIntent must be explicit, not inferred from static wiring');
  assert.deepEqual(intent.sequence, [
    'CLOSE_K2',
    'CLOSE_K3',
    'MONITOR_BUS_DIFFERENTIAL_OR_TIMEOUT',
    'CLOSE_K1',
    'OPEN_K3'
  ]);
  assert.equal(intent.completionThresholdV, 'UNRESOLVED');
  assert.equal(intent.timeoutMs, 'UNRESOLVED');

  const reordered = clone(design);
  reordered.topology.mobileReference.prechargeControlIntent.sequence[0] = 'CLOSE_K1';
  assertMutationBlocked(reordered, ['MOBILE_PRECHARGE_CONTROL_INTENT'], 'precharge sequence mutation');

  const inventedSetting = clone(design);
  inventedSetting.topology.mobileReference.prechargeControlIntent.completionThresholdV = 20;
  assertMutationBlocked(inventedSetting, ['MOBILE_PRECHARGE_CONTROL_INTENT'], 'invented precharge threshold');

  const inventedTimeout = clone(design);
  inventedTimeout.topology.mobileReference.prechargeControlIntent.timeoutMs = 5000;
  assertMutationBlocked(inventedTimeout, ['MOBILE_PRECHARGE_CONTROL_INTENT'], 'invented precharge timeout');
});

test('battery heater route crosses an explicit two-pole project interface', () => {
  const design = build();
  const reference = mobileReference(design);
  assert.ok(reference.heaterInterface, 'mobileReference must identify the observed heater interface');
  const heaterInterface = byId(design, reference.heaterInterface);
  assert.equal(heaterInterface.kind, 'heating-connector-2pin');
  const poles = new Set((heaterInterface.terminals || []).map((terminal) => terminal.localPole || terminal.polarity));
  assert.ok(poles.has('POSITIVE'));
  assert.ok(poles.has('NEGATIVE'));
  ['PANEL_H02', 'BATTERY_H02', 'BATTERY_H05', 'PANEL_H05'].forEach((terminalId) => {
    assert.ok((heaterInterface.terminals || []).some((terminal) => terminal.id === terminalId && terminal.required), terminalId);
  });
  assert.ok(shareNet(design, 'EQ-MOB-FUH', 'OUT', heaterInterface.id, 'PANEL_H02'));
  assert.ok(shareNet(design, heaterInterface.id, 'BATTERY_H02', 'EQ-MOB-HEATER1', 'HEAT_HIGH'));
  assert.ok(shareNet(design, 'EQ-MOB-HEATER3', 'HEAT_LOW', heaterInterface.id, 'BATTERY_H05'));
  assert.ok(shareNet(design, heaterInterface.id, 'PANEL_H05', 'EQ-MOB-ESS-BUS', 'BUS_DC_NEG'));

  const broken = clone(design);
  broken.topology.mobileReference.heaterInterface = 'EQ-MOB-HEATER1';
  assertMutationBlocked(broken, ['MOBILE_HEATER_INTERFACE'], 'heater interface substitution');

  const bypassed = clone(design);
  disconnectTerminal(bypassed, heaterInterface.id, 'PANEL_H02');
  assertMutationBlocked(bypassed, ['MOBILE_HEATER_INTERFACE', 'REQUIRED_TERMINAL_OPEN'], 'heater interface bypass');
});

test('BCU observed labels are explicit terminals and unresolved destinations stay open', () => {
  const design = build();
  const bcu = byId(design, 'EQ-MOB-BCU');
  const observedLabels = ['CANH', 'CANL', 'BTA1+', 'BTA2+', 'BTA5+', 'BAT1−', 'BAT2−', 'A+', 'CC2'];
  const observed = new Map((bcu.terminals || []).map((terminal) => [terminalLabel(terminal), terminal]));
  observedLabels.forEach((label) => assert.ok(observed.has(label), 'BCU must expose observed terminal ' + label));
  observedLabels.slice(2).forEach((label) => {
    const terminal = observed.get(label);
    assert.equal(terminal.required, false, label);
    assert.equal(terminal.evidenceStatus, 'OBSERVED_DESTINATION_UNRESOLVED', label);
    assert.equal(isConnected(design, bcu.id, terminal.id), false, label + ' must remain an open evidence stub');
  });

  const invented = clone(design);
  const inventedBcu = byId(invented, 'EQ-MOB-BCU');
  const bta1 = inventedBcu.terminals.find((terminal) => terminalLabel(terminal) === 'BTA1+');
  ['terminals', 'physicalTerminals', 'ports'].forEach((key) => {
    inventedBcu[key].find((terminal) => terminal.id === bta1.id).evidenceStatus = 'CONFIRMED';
  });
  assertMutationBlocked(invented, ['MOBILE_BCU_OBSERVED_TERMINALS'], 'invented BCU destination');
});

test('KM2 and the independent AC relay retain separate coil/contact/feedback evidence', () => {
  const design = build();
  const replenishment = mobileReference(design).replenishment;
  assert.ok(replenishment.km2, 'missing observed KM2');
  assert.ok(replenishment.acControlRelay, 'missing independent AC control relay');
  assert.notEqual(replenishment.km2, replenishment.acControlRelay);
  const km2 = byId(design, replenishment.km2);
  const relay = byId(design, replenishment.acControlRelay);
  [km2, relay].forEach((instance) => {
    const coil = coilTerminals(instance);
    assert.ok(coil.length >= 2, instance.id + ' coil terminals');
    coil.forEach((terminal) => {
      assert.equal(terminal.required, true, instance.id + ':' + terminal.id);
      assert.equal(isConnected(design, instance.id, terminal.id), true, instance.id + ':' + terminal.id);
    });
    const feedback = (instance.terminals || []).find((terminal) =>
      /FEEDBACK/.test(terminal.id) || /FEEDBACK/.test(terminal.signalRole || ''));
    assert.ok(feedback, instance.id + ' feedback terminal');
    assert.equal(isConnected(design, instance.id, feedback.id), true, instance.id + ':' + feedback.id);
  });
  assert.ok(shareNet(design, km2.id, 'CONTACT_OUT', relay.id, 'CONTACT_IN'));
  assert.ok(shareNet(design, relay.id, 'CONTACT_OUT', 'EQ-MOB-KM1', 'COIL_V24'));

  const broken = clone(design);
  const brokenRelay = byId(broken, replenishment.acControlRelay);
  disconnectTerminal(broken, brokenRelay.id, coilTerminals(brokenRelay)[0].id);
  assertMutationBlocked(broken, ['MOBILE_AC_CONTROL_RELAY_CHAIN', 'REQUIRED_TERMINAL_OPEN'], 'AC relay coil disconnection');
});

test('JT-A external-chain relay includes the observed 24V coil circuit', () => {
  const design = build();
  const relayId = mobileReference(design).controlObjects.externalChainRelay;
  const relay = byId(design, relayId);
  const coil = coilTerminals(relay);
  assert.ok(coil.length >= 2);
  coil.forEach((terminal) => {
    assert.equal(terminal.required, true, relay.id + ':' + terminal.id);
    assert.equal(isConnected(design, relay.id, terminal.id), true, relay.id + ':' + terminal.id);
  });
  assert.ok(shareNet(design, 'EQ-MOB-VCU', 'ZB_J10_4', relay.id, 'COIL_V24'));
  assert.equal(relay.coilSourceLabel, 'ZB/J10/4');
  assert.equal(relay.coilReturnLabel, '24V−');

  const broken = clone(design);
  disconnectTerminal(broken, relay.id, coil[0].id);
  assertMutationBlocked(broken, ['MOBILE_JT_A_RELAY_COIL', 'REQUIRED_TERMINAL_OPEN'], 'JT-A relay coil disconnection');
});

test('router and three-in-one antenna are separate devices joined only by RF_UNKNOWN', () => {
  const design = build();
  const controls = mobileReference(design).controlObjects;
  assert.ok(controls.router);
  assert.ok(controls.antenna);
  assert.notEqual(controls.router, controls.antenna);
  byId(design, controls.router);
  byId(design, controls.antenna);
  const rf = design.nets.find((net) => net.protocol === 'RF_UNKNOWN' &&
    net.members.some((member) => member.instanceId === controls.router) &&
    net.members.some((member) => member.instanceId === controls.antenna));
  assert.ok(rf, 'router-to-antenna physical link must remain RF_UNKNOWN');
  assert.ok(!design.nets.some((net) => net.netClass === 'SIGNAL_COMM' && net.protocol !== 'RF_UNKNOWN' &&
    net.members.some((member) => member.instanceId === controls.ocpp) &&
    net.members.some((member) => member.instanceId === controls.router)),
  'reference does not prove an OCPP-to-router data conductor');

  const broken = clone(design);
  broken.nets.find((net) => net.id === rf.id).protocol = 'ETHERNET';
  assertMutationBlocked(broken, ['MOBILE_ROUTER_ANTENNA_RF'], 'invented router RF protocol');

  const disconnected = clone(design);
  const antennaRf = byId(disconnected, controls.antenna).terminals.find((terminal) => terminal.protocol === 'RF_UNKNOWN');
  disconnectTerminal(disconnected, controls.antenna, antennaRf.id);
  assertMutationBlocked(disconnected, ['MOBILE_ROUTER_ANTENNA_RF', 'REQUIRED_TERMINAL_OPEN'], 'router antenna disconnection');
});

test('fuse calculations and K1-K10 observed nameplates retain evidence status', () => {
  const design = build();
  ['FU1', 'FU2', 'FU3', 'FUH'].forEach((tag) => {
    const fuse = design.instances.find((instance) => instance.tag === tag);
    assert.ok(fuse, tag);
    const hasNumericRating = fuse.ratedCurrentA !== null && fuse.ratedCurrentA !== undefined &&
      Number.isFinite(Number(fuse.ratedCurrentA));
    assert.equal(fuse.ratingStatus, hasNumericRating ? 'CALCULATED' : 'UNKNOWN', tag);
    assert.ok(fuse.calculationBasis || fuse.ratingBasis || fuse.calculationSource || fuse.ratingSource,
      tag + ' rating evidence');
  });
  for (let number = 1; number <= 10; number += 1) {
    const contactor = byId(design, 'EQ-MOB-K' + number);
    assert.equal(contactor.ratedCurrentA, number === 3 || number === 5 ? 50 : 200, contactor.id);
    assert.equal(contactor.coilVoltageV, 24, contactor.id);
    assert.equal(contactor.ratingStatus, 'OBSERVED', contactor.id);
  }

  const fuseMutation = clone(design);
  const fuse = fuseMutation.instances.find((instance) => instance.tag === 'FU1');
  fuse.ratingStatus = 'CONFIRMED_MANUFACTURER_DATA';
  assertMutationBlocked(fuseMutation, ['MOBILE_FUSE_RATING_EVIDENCE'], 'fuse evidence promotion');

  const contactorMutation = clone(design);
  byId(contactorMutation, 'EQ-MOB-K3').ratedCurrentA = 200;
  assertMutationBlocked(contactorMutation, ['MOBILE_CONTACTOR_RATING_EVIDENCE'], 'K3 nameplate mutation');
});

test('mobile SPD nameplate follows each selected AC conductor profile', () => {
  const expected = { gb: '3P+N', eu: '3P+N', us: '2P', nacs: '2P', chademo: '1P+N' };
  Object.entries(expected).forEach(([standard, phaseConfiguration]) => {
    const design = build({ standard });
    const spd = byId(design, 'EQ-MOB-SPD1');
    const conductors = mobileReference(design).replenishment.acOutputProfile.conductors;
    assert.deepEqual(spd.actualConductors, conductors, standard);
    assert.equal(spd.phaseConfiguration, phaseConfiguration, standard);
    assert.ok(spd.name.includes(phaseConfiguration), standard + ': ' + spd.name);
  });

  const broken = clone(build({ standard: 'nacs' }));
  byId(broken, 'EQ-MOB-SPD1').name = '补电座 L1+L2+L3+N 浪涌保护';
  assertMutationBlocked(broken, ['MOBILE_SPD_LABEL'], 'NACS SPD label mutation');
});

test('voice-board T is retained as an unresolved observed terminal', () => {
  const design = build();
  const voice = byId(design, 'EQ-MOB-VOICE');
  const terminalT = (voice.terminals || []).find((terminal) => terminal.id === 'T' || terminalLabel(terminal) === 'T');
  assert.ok(terminalT, 'voice-board terminal T');
  assert.equal(terminalT.required, false);
  assert.equal(terminalT.evidenceStatus, 'OBSERVED_DESTINATION_UNRESOLVED');
  assert.equal(isConnected(design, voice.id, terminalT.id), false);

  const broken = clone(design);
  removeTerminalDefinition(byId(broken, voice.id), terminalT.id);
  assertMutationBlocked(broken, ['MOBILE_VOICE_T_EVIDENCE'], 'voice T deletion');
});

test('NACS AC and DC functions alias one physical contact pair and remain hard interlocked', () => {
  const design = build({ standard: 'nacs' });
  const acInlet = byId(design, 'EQ-MOB-AC-IN');
  const dcInlet = byId(design, 'EQ-MOB-DC-IN');
  const owner = byId(design, 'EQ-MOB-NACS-IN');
  const selector = byId(design, 'EQ-MOB-NACS-SEL');
  assert.equal(owner.kind, 'nacs-shared-inlet');
  assert.equal(selector.kind, 'ac-dc-power-selector');
  assert.deepEqual(owner.physicalTerminals.map((terminal) => terminal.id).sort(), ['CP', 'PE', 'PP', 'PWR_A', 'PWR_B']);
  assert.equal(acInlet.physicalTerminals.length, 0, 'NACS AC proxy must not duplicate physical contacts');
  assert.equal(dcInlet.physicalTerminals.length, 0, 'NACS DC proxy must not duplicate physical contacts');
  [acInlet, dcInlet].forEach((proxy) => proxy.functionalPorts.forEach((port) => {
    assert.equal(port.physicalOwnerId, owner.id, proxy.id + ':' + port.id);
  }));

  const ownerPort = (id) => {
    const port = owner.functionalPorts.find((item) => item.id === id);
    assert.ok(port, 'missing NACS owner functional port ' + id);
    return port;
  };
  const acL1 = ownerPort('AC_L1');
  const acL2 = ownerPort('AC_L2');
  const dcPos = ownerPort('DC_POS');
  const dcNeg = ownerPort('DC_NEG');
  assert.deepEqual(acL1.physicalTerminalIds, ['PWR_A']);
  assert.deepEqual(dcPos.physicalTerminalIds, ['PWR_A']);
  assert.deepEqual(acL2.physicalTerminalIds, ['PWR_B']);
  assert.deepEqual(dcNeg.physicalTerminalIds, ['PWR_B']);
  assert.deepEqual([acL1.modeId, acL2.modeId, dcPos.modeId, dcNeg.modeId], ['AC', 'AC', 'DC', 'DC']);
  [acL1, acL2, dcPos, dcNeg].forEach((port) => assert.equal(port.mutualExclusionGroup, 'NACS_AC_DC_POWER'));
  ['CP', 'PP', 'PE'].forEach((id) => {
    assert.equal(owner.functionalPorts.filter((port) => port.id === id).length, 1, id + ' must have one physical owner port');
  });

  assert.ok(shareNet(design, owner.id, 'PWR_A', selector.id, 'COMMON_A'));
  assert.ok(shareNet(design, owner.id, 'PWR_B', selector.id, 'COMMON_B'));
  assert.ok(shareNet(design, selector.id, 'DC_POS', 'EQ-MOB-K4', 'IN'));
  assert.ok(shareNet(design, selector.id, 'DC_NEG', 'EQ-MOB-K4N', 'IN'));
  assert.ok(shareNet(design, owner.id, 'CP', 'EQ-MOB-EVCC', 'DC_INLET_CP'));
  assert.ok(shareNet(design, owner.id, 'PP', 'EQ-MOB-EVCC', 'DC_INLET_PP'));
  assert.equal(design.circuits.some((circuit) =>
    [acInlet.id, dcInlet.id].includes(circuit.from) || [acInlet.id, dcInlet.id].includes(circuit.to)), false,
  'logical aliases must not be emitted as physical circuits');
  ['PWR_A', 'PWR_B'].forEach((terminalId) => {
    const net = design.nets.find((item) => item.id === netIdsAt(design, owner.id, terminalId)[0]);
    assert.equal(net.netClass, 'POWER_INTERFACE_MODED', terminalId);
  });
  assert.equal(selector.defaultMode, 'ALL_OPEN');
  assert.equal(selector.powerModePolicy, 'BREAK_BEFORE_MAKE_ALL_POLES');
  assert.deepEqual(selector.modeStateMatrix, {
    ALL_OPEN: { acPermission: false, dcPositivePermission: false, dcNegativePermission: false },
    AC_ENABLED: { acPermission: true, dcPositivePermission: false, dcNegativePermission: false },
    DC_ENABLED: { acPermission: false, dcPositivePermission: true, dcNegativePermission: true }
  });

  const interlock = byId(design, 'EQ-MOB-NACS-MODE-ILK');
  const k4Negative = byId(design, 'EQ-MOB-K4N');
  assert.equal(interlock.modeRelationship, 'MUTUALLY_EXCLUSIVE');
  assert.deepEqual(new Set(interlock.dcPermissionTargets), new Set([
    'EQ-MOB-K4:COIL_V24',
    'EQ-MOB-K4N:COIL_V24'
  ]));
  assert.ok(shareNet(design, interlock.id, 'DC_PERMISSION_V24', 'EQ-MOB-K4', 'COIL_V24'));
  assert.ok(shareNet(design, interlock.id, 'DC_PERMISSION_V24', k4Negative.id, 'COIL_V24'));
  interlock.acPermissionTargets.forEach((identity) => {
    const target = splitEndpoint(identity);
    assert.ok(shareNet(design, interlock.id, 'AC_PERMISSION_V24', target.instanceId, target.terminalId), identity);
  });

  const aliasMutation = clone(design);
  byId(aliasMutation, owner.id).functionalPorts.find((port) => port.id === 'DC_NEG').physicalTerminalIds = ['PWR_A'];
  mirrorEquipmentInstance(aliasMutation, owner.id);
  assertMutationBlocked(aliasMutation, ['NACS_SHARED_POWER_CONTACT_ALIAS'], 'NACS physical alias mutation');

  const genericModeBypass = clone(build({ standard: 'gb' }));
  const batteryPort = byId(genericModeBypass, 'EQ-MOB-BAT1').functionalPorts[0];
  batteryPort.modeDependent = true;
  batteryPort.netClass = 'SIGNAL_CTRL';
  batteryPort.domain = 'CONTROL';
  mirrorEquipmentInstance(genericModeBypass, 'EQ-MOB-BAT1');
  assertMutationBlocked(genericModeBypass,
    ['MODE_DEPENDENT_PORT_UNAUTHORIZED', 'FUNCTIONAL_PORT_SEMANTICS_MISMATCH'],
    'ordinary device cannot claim the NACS mode-dependent exception');

  const proxyPortMutation = clone(design);
  byId(proxyPortMutation, dcInlet.id).functionalPorts.find((port) => port.id === 'DC_POS').physicalTerminalIds = ['PWR_B'];
  mirrorEquipmentInstance(proxyPortMutation, dcInlet.id);
  assertMutationBlocked(proxyPortMutation, ['NACS_SHARED_POWER_CONTACT_ALIAS', 'MODE_DEPENDENT_PORT_UNAUTHORIZED'],
    'NACS proxy port reverse mapping mutation');

  const missingLogicalTarget = clone(design);
  byId(missingLogicalTarget, owner.id).functionalPorts.find((port) => port.id === 'DC_POS').logicalTerminalIds = ['NOT_A_TERMINAL'];
  mirrorEquipmentInstance(missingLogicalTarget, owner.id);
  assertMutationBlocked(missingLogicalTarget,
    ['NACS_SHARED_POWER_CONTACT_ALIAS', 'FUNCTIONAL_PORT_UNKNOWN_TERMINAL', 'MODE_DEPENDENT_PORT_UNAUTHORIZED'],
    'NACS owner logical target mutation');

  const terminalPortDivergence = clone(design);
  byId(terminalPortDivergence, dcInlet.id).terminals.find((terminal) => terminal.id === 'DC_POS').physicalTerminalId = 'PWR_B';
  byId(terminalPortDivergence, dcInlet.id).ports.find((terminal) => terminal.id === 'DC_POS').physicalTerminalId = 'PWR_B';
  mirrorEquipmentInstance(terminalPortDivergence, dcInlet.id);
  assertMutationBlocked(terminalPortDivergence, ['NACS_SHARED_POWER_CONTACT_ALIAS'],
    'NACS proxy terminal and functional-port divergence');

  const interlockMutation = clone(design);
  disconnectTerminal(interlockMutation, interlock.id, 'DC_PERMISSION_V24');
  assertMutationBlocked(interlockMutation, ['NACS_AC_DC_HARD_INTERLOCK', 'REQUIRED_TERMINAL_OPEN'], 'NACS DC mode interlock mutation');

  const unsafeDefault = clone(design);
  byId(unsafeDefault, selector.id).modeStateMatrix.ALL_OPEN.dcPositivePermission = true;
  assertMutationBlocked(unsafeDefault, ['NACS_AC_DC_HARD_INTERLOCK'], 'NACS unsafe default-state mutation');

  const missingNegativePole = clone(design);
  removeInstanceEverywhere(missingNegativePole, k4Negative.id);
  assertMutationBlocked(missingNegativePole,
    ['NACS_AC_DC_HARD_INTERLOCK', 'NACS_SHARED_POWER_CONTACT_ALIAS', 'ARCHETYPE_MARKER_MISSING'],
    'NACS negative-pole isolator deletion');

  const bypassedNegativePole = clone(design);
  disconnectTerminal(bypassedNegativePole, k4Negative.id, 'IN');
  assertMutationBlocked(bypassedNegativePole,
    ['NACS_AC_DC_HARD_INTERLOCK', 'NACS_SHARED_POWER_CONTACT_ALIAS', 'REQUIRED_TERMINAL_OPEN'],
    'NACS negative-pole isolator bypass');
});
