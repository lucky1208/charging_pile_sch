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
  const standard = (extra && extra.standard) || 'eu';
  const params = Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'FUNCTIONAL-SAFETY-ADVERSARIAL', standard, archetype: 'dc-integrated',
    outputKw: 120, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
    acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard],
    voltageWindow: '200-1000', thermal: 'air', essEnabled: false,
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
}

function validateMutation(model) {
  refreshHash(model);
  const result = win.EVSE_ERC.validate(model);
  assert.equal(result.violations.some((item) => item.code === 'MODEL_HASH_MISMATCH'), false,
    'the semantic mutation must not rely on the integrity fingerprint');
  assert.ok(result.blockingCount > 0, JSON.stringify(result.violations));
  return new Set(result.violations.map((item) => item.code));
}

function unitFor(model, type, connectorId) {
  return model.topology.functionalUnits.find((unit) =>
    unit.type === type && (!connectorId || unit.protectedConnectorId === connectorId));
}

function instance(model, id) {
  return model.instances.find((item) => item.id === id);
}

function netFor(model, instanceId, terminalId) {
  const matches = model.nets.filter((net) => net.members.some((member) =>
    member.instanceId === instanceId && member.terminalId === terminalId));
  assert.equal(matches.length, 1, instanceId + ':' + terminalId);
  return matches[0];
}

test('interface applicability cannot be changed by metadata alone', () => {
  const noPilot = clone(build({ standard: 'gb', acVoltage: 380 }));
  const gbConnector = instance(noPilot, 'EQ-G1-XS');
  gbConnector.controlContract.functions.controlPilot = 'REQUIRED';
  assert.ok(validateMutation(noPilot).has('PILOT_APPLICABILITY_MISMATCH'));

  const pilot = clone(build());
  const euConnector = instance(pilot, 'EQ-G1-XS');
  euConnector.controlContract.functions.controlPilot = 'NOT_APPLICABLE';
  assert.ok(validateMutation(pilot).has('PILOT_APPLICABILITY_MISMATCH'));
});

test('CP assembly requires all three functions on the exact same physical net with one source', () => {
  const wrongNetRef = clone(build());
  const cpUnit = unitFor(wrongNetRef, 'CONTROL_PILOT_INTERFACE', 'EQ-G1-XS');
  cpUnit.physicalCpNetId = wrongNetRef.nets.find((net) => net.id !== cpUnit.physicalCpNetId).id;
  assert.ok(validateMutation(wrongNetRef).has('CP_PHYSICAL_NET_DIVERGED'));

  const duplicateGenerator = clone(build());
  const duplicateUnit = unitFor(duplicateGenerator, 'CONTROL_PILOT_INTERFACE', 'EQ-G1-XS');
  const generatorId = duplicateUnit.instanceIds.find((id) => instance(duplicateGenerator, id).kind === 'control-pilot-generator');
  duplicateUnit.instanceIds.push(generatorId);
  const duplicateCodes = validateMutation(duplicateGenerator);
  assert.ok(duplicateCodes.has('CP_DEVICE_CARDINALITY'));
  assert.ok(duplicateCodes.has('FUNCTIONAL_UNIT_REFERENCE_SET_INVALID'));
});

test('output precheck cannot omit a pole or move its high-impedance sense upstream', () => {
  const missingPole = clone(build());
  const missingUnit = unitFor(missingPole, 'OUTPUT_SAFETY_DIAGNOSTICS', 'EQ-G1-XS');
  missingUnit.monitoredOutputEndpoints = missingUnit.monitoredOutputEndpoints.filter((endpoint) => endpoint.terminalId !== 'DC_NEG');
  assert.ok(validateMutation(missingPole).has('PRECHECK_ENDPOINT_COVERAGE'));

  const upstream = clone(build());
  const diagnostic = unitFor(upstream, 'OUTPUT_SAFETY_DIAGNOSTICS', 'EQ-G1-XS');
  const pole = diagnostic.monitoredPoles.find((item) => item.poleId === 'DC_POS');
  const precheckId = diagnostic.precheckInstanceId;
  const outputNet = netFor(upstream, precheckId, 'SENSE_DC_POS');
  const inputNet = netFor(upstream, pole.deviceId, pole.upstreamTerminalId);
  const sourceMember = inputNet.members.find((member) => {
    const owner = instance(upstream, member.instanceId);
    const terminal = owner && owner.terminals.find((item) => item.id === member.terminalId);
    return terminal && (terminal.direction === 'out' || terminal.direction === 'bidirectional');
  });
  assert.ok(sourceMember, 'upstream net must expose a source for a valid adversarial circuit');
  outputNet.members = outputNet.members.filter((member) =>
    !(member.instanceId === precheckId && member.terminalId === 'SENSE_DC_POS'));
  inputNet.members.push({ instanceId: precheckId, terminalId: 'SENSE_DC_POS' });
  const senseCircuit = upstream.circuits.find((circuit) =>
    circuit.to === precheckId && circuit.toPort === 'SENSE_DC_POS');
  assert.ok(senseCircuit);
  senseCircuit.netId = inputNet.id;
  senseCircuit.from = sourceMember.instanceId;
  senseCircuit.fromPort = sourceMember.terminalId;
  ['netClass', 'domain', 'phase', 'polarity', 'protocol', 'signalRole'].forEach((field) => {
    if (inputNet[field] === undefined) delete senseCircuit[field];
    else senseCircuit[field] = inputNet[field];
  });
  if (!diagnostic.netIds.includes(inputNet.id)) diagnostic.netIds.push(inputNet.id);
  const upstreamCodes = validateMutation(upstream);
  assert.ok(upstreamCodes.has('PRECHECK_NOT_AT_OUTPUT_ENDPOINT'));
  assert.ok(upstreamCodes.has('PRECHECK_UPSTREAM_ALIAS'));
});

test('safe-isolation feedback cannot be replaced by a coil terminal', () => {
  const model = clone(build());
  const diagnostic = unitFor(model, 'OUTPUT_SAFETY_DIAGNOSTICS', 'EQ-G1-XS');
  const pole = diagnostic.monitoredPoles[0];
  pole.feedbackTerminalId = 'COIL_V24_0V';
  const monitor = instance(model, diagnostic.stateMonitorInstanceId);
  monitor.monitoredPoles[0].feedbackTerminalId = 'COIL_V24_0V';
  const result = validateMutation(model);
  assert.ok(result.has('CONTACTOR_FEEDBACK_NOT_MECHANICALLY_LINKED'));
  assert.ok(result.has('CONTACTOR_FEEDBACK_COIL_ALIAS'));
});

test('state machine cannot bypass READY, energize on unresolved values, or leave fault state closed', () => {
  const bypass = clone(build());
  const energize = bypass.topology.safetyStateMachine.transitions.find((transition) => transition.to === 'ENERGIZED');
  energize.from = 'ALL_OPEN';
  assert.ok(validateMutation(bypass).has('ENERGIZE_GUARD_OR_ACTION_BYPASS'));

  const unresolved = clone(build());
  unresolved.topology.safetyStateMachine.executionAllowed = true;
  assert.ok(validateMutation(unresolved).has('UNRESOLVED_VALUE_FALSE_PASS'));

  const faultClosed = clone(build());
  faultClosed.topology.safetyStateMachine.states.find((state) => state.id === 'FAULT_ALL_OPEN').contactorCommand = 'CLOSED';
  const faultCodes = validateMutation(faultClosed);
  assert.ok(faultCodes.has('SAFETY_DEFAULT_FAULT_NOT_OPEN'));
  assert.ok(faultCodes.has('CLOSED_STATE_ALIAS'));
});

test('functional units cannot invent circuit references or share diagnostic ownership', () => {
  const unknownCircuit = clone(build());
  const diagnostic = unitFor(unknownCircuit, 'OUTPUT_SAFETY_DIAGNOSTICS', 'EQ-G1-XS');
  diagnostic.circuitIds[0] = 'CCT-NOT-IN-MODEL';
  assert.ok(validateMutation(unknownCircuit).has('FUNCTIONAL_UNIT_CIRCUIT_UNKNOWN'));

  const duplicateOwner = clone(build());
  const outputUnit = unitFor(duplicateOwner, 'OUTPUT_SAFETY_DIAGNOSTICS', 'EQ-G1-XS');
  const cpUnit = unitFor(duplicateOwner, 'CONTROL_PILOT_INTERFACE', 'EQ-G1-XS');
  cpUnit.instanceIds.push(outputUnit.precheckInstanceId);
  assert.ok(validateMutation(duplicateOwner).has('DIAGNOSTIC_INSTANCE_OWNERSHIP'));

  const duplicateCircuit = clone(build());
  const outputCircuitUnit = unitFor(duplicateCircuit, 'OUTPUT_SAFETY_DIAGNOSTICS', 'EQ-G1-XS');
  const pilotCircuitUnit = unitFor(duplicateCircuit, 'CONTROL_PILOT_INTERFACE', 'EQ-G1-XS');
  const foreignCircuitId = outputCircuitUnit.circuitIds[0];
  const foreignCircuit = duplicateCircuit.circuits.find((circuit) => circuit.id === foreignCircuitId);
  pilotCircuitUnit.circuitIds.push(foreignCircuitId);
  if (!pilotCircuitUnit.netIds.includes(foreignCircuit.netId)) pilotCircuitUnit.netIds.push(foreignCircuit.netId);
  const circuitCodes = validateMutation(duplicateCircuit);
  assert.ok(circuitCodes.has('FUNCTIONAL_UNIT_CIRCUIT_SCOPE_INVALID'));
  assert.ok(circuitCodes.has('FUNCTIONAL_UNIT_CIRCUIT_OWNERSHIP'));
});
