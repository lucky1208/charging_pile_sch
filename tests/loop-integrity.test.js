'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');
const win = {};
orderedEngineFiles(path.join(rootDir, 'engine')).forEach((file) => {
  const source = fs.readFileSync(path.join(rootDir, 'engine', file), 'utf8');
  new Function('window', 'document', source)(win, {});
});

function params(archetype, extra) {
  return Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'LOOP-INTEGRITY-TEST', standard: 'gb', archetype: archetype || 'dc-integrated',
    outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
    acVoltage: 380, voltageWindow: '200-1000', thermal: 'air',
    essEnabled: archetype === 'ess-mobile', essKwh: 160, essPowerKw: 80,
    essCoupling: 'dc', requirementConfirmed: true
  }, extra || {});
}
function build(archetype, extra) { return win.EVSE_ENGINE.build(params(archetype, extra)); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

test('stationary archetypes prove same-source auxiliary returns and declared PE using actual circuit edges', () => {
  ['dc-integrated', 'dc-split', 'ac-dc-combo'].forEach((archetype) => {
    const report = win.EVSE_LOOP_INTEGRITY.audit(build(archetype).design);
    assert.equal(report.status, 'PASS', archetype);
    assert.equal(report.blockingCount, 0, archetype);
    assert.equal(report.unresolvedCount, 0, archetype);
    ['LOOP-001', 'LOOP-002', 'LOOP-003', 'LOOP-004', 'LOOP-005', 'LOOP-006']
      .forEach((family) => assert.notEqual(
        report.families.find((item) => item.id === family).status, 'BLOCKED', archetype + ':' + family));
  });
});

test('removing a real return conductor blocks even though the stale net membership still names both endpoints', () => {
  const model = clone(build('dc-integrated').design);
  const load = model.instances.find((instance) => instance.id === 'EQ-AUX-M2');
  const circuitIndex = model.circuits.findIndex((circuit) =>
    circuit.to === load.id && circuit.toPort === 'CTRL_PWR_V24_0V');
  assert.ok(circuitIndex >= 0);
  const removed = model.circuits.splice(circuitIndex, 1)[0];
  assert.ok(model.nets.some((net) => net.id === removed.netId), 'test retains the old net object');

  const report = win.EVSE_LOOP_INTEGRITY.audit(model);
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.records.some((record) => record.deviceId === load.id &&
    record.code === 'SOURCE_OR_RETURN_DISCONNECTED'));
});

test('equal-looking voltages from two physical supplies do not satisfy the same-source invariant', () => {
  const model = clone(build('dc-integrated').design);
  const circuit = model.circuits.find((item) =>
    item.to === 'EQ-AUX-M2' && item.toPort === 'CTRL_PWR_V24_0V');
  assert.ok(circuit);
  /* Deliberately land the 24 V load return on the distinct 12 V PSU output.
     This is a source-identity test; voltage/domain ERC catches it separately. */
  circuit.from = 'EQ-AUX-T2';
  circuit.fromPort = 'OUT_V12_0V';
  const report = win.EVSE_LOOP_INTEGRITY.audit(model);
  assert.ok(report.records.some((record) => record.deviceId === 'EQ-AUX-M2' &&
    record.code === 'SOURCE_PAIR_MISMATCH'));
});

test('removing a module PE conductor is a blocking PE-open defect', () => {
  const model = clone(build('dc-integrated').design);
  const module = model.instances.find((instance) => instance.kind === 'power-module-array');
  assert.ok(module);
  const index = model.circuits.findIndex((circuit) =>
    circuit.to === module.id && circuit.toPort === 'PE' ||
    circuit.from === module.id && circuit.fromPort === 'PE');
  assert.ok(index >= 0);
  model.circuits.splice(index, 1);
  const report = win.EVSE_LOOP_INTEGRITY.audit(model);
  assert.ok(report.records.some((record) => record.family === 'LOOP-005' &&
    record.deviceId === module.id && record.code === 'PE_OPEN' && record.status === 'BLOCKED'));
});

test('mobile project limitations remain explicit NOT_EVALUATED rather than fabricated continuity', () => {
  const report = win.EVSE_LOOP_INTEGRITY.audit(build('ess-mobile').design);
  assert.equal(report.blockingCount, 0);
  assert.equal(report.status, 'PARTIAL');
  assert.ok(report.unresolvedCount > 0);
  assert.ok(report.records.some((record) => record.status === 'NOT_EVALUATED'));
});

test('ERC-086 integrates loop defects into the authoritative fail-closed model gate', () => {
  const model = clone(build('dc-integrated').design);
  const index = model.circuits.findIndex((circuit) =>
    circuit.to === 'EQ-AUX-M2' && circuit.toPort === 'CTRL_PWR_V24_0V');
  assert.ok(index >= 0);
  model.circuits.splice(index, 1);
  const erc = win.EVSE_ERC.validate(model);
  assert.ok(erc.blockingCount > 0);
  assert.ok(erc.violations.some((violation) => violation.ruleId === 'ERC-086' &&
    violation.code === 'LOOP-001:SOURCE_OR_RETURN_DISCONNECTED'));
  assert.equal(erc.loopIntegrity.status, 'BLOCKED');
});
