'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');

function runtime() {
  const win = {};
  orderedEngineFiles(path.join(rootDir, 'engine')).forEach((file) => {
    const source = fs.readFileSync(path.join(rootDir, 'engine', file), 'utf8');
    new Function('window', 'document', source)(win, {});
  });
  return win;
}

const win = runtime();
const DOCUMENT = win.SCHEMATIC_DOCUMENT;

function params(extra) {
  return Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'MULTISHEET-TEST', standard: 'gb', archetype: 'dc-integrated',
    outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
    acVoltage: 380, voltageWindow: '200-1000', thermal: 'air',
    essEnabled: false, requirementConfirmed: true
  }, extra || {});
}

function design(extra) { return win.EVSE_ENGINE.build(params(extra)).design; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => { out[key] = clone(value[key]); });
    return out;
  }
  return value;
}
function passGates(overrides) {
  const pages = {};
  DOCUMENT.SHEET_RULES.forEach((sheet) => {
    pages[sheet.id] = { drawing: { allowed: true }, quality: { status: 'PASS' }, coverage: { ok: true } };
  });
  Object.keys(overrides || {}).forEach((id) => { pages[id] = Object.assign({}, pages[id], overrides[id]); });
  return { pages };
}

test('exports one browser API under both supported names and CommonJS', () => {
  assert.equal(win.SCHEMATIC_DOCUMENT, win.SCHEMATIC_FORGE_DOCUMENT);
  assert.equal(typeof DOCUMENT.compile, 'function');
  assert.equal(DOCUMENT.compile, DOCUMENT.build);
  assert.equal(DOCUMENT.compile, DOCUMENT.plan);
  assert.equal(require('../engine/schematic-document.js').SCHEMA, DOCUMENT.SCHEMA);
});

test('plans exactly six stable functional sheets without changing the EDEM', () => {
  const source = design();
  const before = JSON.stringify(source);
  const first = DOCUMENT.compile(source);
  const second = DOCUMENT.compile(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(first.sheets.length, 6);
  assert.deepEqual(first.sheets.map((sheet) => sheet.id), ['S01', 'S02', 'S03', 'S04', 'S05', 'S06']);
  assert.deepEqual(first.sheets.map((sheet) => sheet.page), [1, 2, 3, 4, 5, 6]);
  assert.equal(first.documentHash, second.documentHash);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.sheets[0].modelProjection), true);

  const assigned = first.sheets.flatMap((sheet) => sheet.instanceIds);
  assert.equal(assigned.length, source.instances.length);
  assert.equal(new Set(assigned).size, source.instances.length);
  assert.deepEqual(assigned.slice().sort(), source.instances.map((item) => item.id).sort());
});

test('electrical protection monitors stay with their power domains instead of generic control pages', () => {
  const document = DOCUMENT.compile(design());
  const sheet = (id) => document.sheets.find((item) => item.id === id);
  assert.ok(sheet('S01').instanceIds.includes('EQ-AC-RCM1'), 'RCM belongs to AC input/protection');
  assert.ok(sheet('S02').instanceIds.includes('EQ-DC-IMD1'), 'IMD belongs to the DC bus/power conversion page');
  assert.equal(sheet('S06').instanceIds.includes('EQ-AC-RCM1'), false);
  assert.equal(sheet('S06').instanceIds.includes('EQ-DC-IMD1'), false);
});

test('input array order cannot change plans or references while provenance keeps the exact serialised model identity', () => {
  const source = design();
  const reordered = clone(source);
  reordered.instances.reverse();
  reordered.equipment = reordered.instances;
  reordered.nets.reverse();
  reordered.circuits.reverse();
  reordered.modelHash = DOCUMENT.authoritativeModelHash(reordered);
  const normal = DOCUMENT.compile(source);
  const changed = DOCUMENT.compile(reordered);
  assert.notEqual(changed.sourceModelHash, normal.sourceModelHash);
  assert.notEqual(changed.documentHash, normal.documentHash);
  const comparable = (value) => {
    const copy = clone(value);
    delete copy.documentHash;
    copy.sourceModelHash = '<exact-source-model-hash>';
    copy.sheets.forEach((sheet) => { sheet.modelProjection.sourceModelHash = '<exact-source-model-hash>'; });
    return copy;
  };
  assert.deepEqual(comparable(changed), comparable(normal));
});

test('every authoritative circuit has exactly one internal route or one exact connector pair', () => {
  const source = design({ standard: 'eu', acVoltage: 400, gunCount: 4, essEnabled: true,
    essKwh: 200, essPowerKw: 120, essCoupling: 'dc' });
  const document = DOCUMENT.compile(source);
  assert.equal(document.coverageManifest.length, source.circuits.length);
  assert.equal(new Set(document.coverageManifest.map((item) => item.circuitId)).size, source.circuits.length);
  assert.equal(document.projectGate.crossPageCoverage.computed.status, 'PASS');
  assert.equal(document.statistics.offPageConnectorCount, document.crossSheetCircuits.length * 2);

  const circuitById = new Map(source.circuits.map((item) => [item.id, item]));
  document.coverageManifest.forEach((coverage) => {
    const circuit = circuitById.get(coverage.circuitId);
    assert.ok(circuit);
    if (coverage.representation === 'INTERNAL_ROUTE') {
      const sheet = document.sheets.find((item) => item.id === coverage.sheetId);
      assert.ok(sheet.internalCircuitIds.includes(circuit.id));
      assert.equal(sheet.offPageConnectors.some((item) => item.circuitId === circuit.id), false);
      return;
    }
    assert.equal(coverage.representation, 'OFF_PAGE_PAIR');
    assert.equal(coverage.connectorIds.length, 2);
    const connectors = document.sheets.flatMap((sheet) => sheet.offPageConnectors)
      .filter((item) => item.circuitId === circuit.id);
    assert.equal(connectors.length, 2);
    const sourceConnector = connectors.find((item) => item.role === 'SOURCE');
    const targetConnector = connectors.find((item) => item.role === 'TARGET');
    assert.ok(sourceConnector && targetConnector);
    assert.equal(sourceConnector.peerConnectorId, targetConnector.id);
    assert.equal(targetConnector.peerConnectorId, sourceConnector.id);
    [sourceConnector, targetConnector].forEach((connector) => {
      assert.equal(connector.netId, circuit.netId);
      assert.deepEqual(connector.from, {
        instanceId: circuit.from, terminalId: circuit.fromPort,
        endpointKey: circuit.from + ':' + circuit.fromPort
      });
      assert.deepEqual(connector.to, {
        instanceId: circuit.to, terminalId: circuit.toPort,
        endpointKey: circuit.to + ':' + circuit.toPort
      });
      assert.equal(connector.xref.connectorId, connector.peerConnectorId);
      assert.equal(connector.xref.sheetId, connector.remoteSheetId);
    });
  });
});

test('sheet projections are explicitly non-authoritative and preserve only exact internal circuits', () => {
  const source = design();
  const document = DOCUMENT.compile(source);
  const sourceCircuitById = new Map(source.circuits.map((item) => [item.id, item]));
  document.sheets.forEach((sheet) => {
    const projection = sheet.modelProjection;
    assert.equal(projection.schema, DOCUMENT.PROJECTION_SCHEMA);
    assert.equal(projection.sourceModelHash, source.modelHash);
    assert.equal(Object.prototype.hasOwnProperty.call(projection, 'modelHash'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(projection, 'modelValidation'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(projection, 'circuits'), false);
    assert.deepEqual(projection.internalCircuits.map((item) => item.id), sheet.internalCircuitIds);
    projection.internalCircuits.forEach((circuit) => assert.deepEqual(circuit, sourceCircuitById.get(circuit.id)));
    assert.deepEqual(projection.offPageConnectors, sheet.offPageConnectors);
  });
});

test('project gate aggregates model/ERC, every page gate and exact cross-page coverage fail-closed', () => {
  const source = design();
  const notAudited = DOCUMENT.compile(source);
  assert.equal(notAudited.status, 'BLOCKED');
  assert.deepEqual(notAudited.projectGate.blockedSheetIds, ['S01', 'S02', 'S03', 'S04', 'S05', 'S06']);
  assert.equal(notAudited.projectGate.model.status, 'PASS');
  assert.equal(notAudited.projectGate.crossPageCoverage.status, 'PASS');

  const passed = DOCUMENT.compile(source, passGates());
  assert.equal(passed.status, 'PASS');
  assert.equal(passed.projectGate.allowed, true);

  const review = DOCUMENT.compile(source, passGates({ S03: { quality: { status: 'REVIEW_REQUIRED' } } }));
  assert.equal(review.status, 'REVIEW_REQUIRED');
  assert.equal(review.projectGate.allowed, true);

  const drawingBlocked = DOCUMENT.compile(source, passGates({ S02: { drawing: { allowed: false, code: 'GEOMETRY_BLOCKED' } } }));
  assert.equal(drawingBlocked.status, 'BLOCKED');
  assert.deepEqual(drawingBlocked.projectGate.blockedSheetIds, ['S02']);

  const modelBlocked = clone(source);
  modelBlocked.modelValidation = { status: 'BLOCKED', blockingCount: 1 };
  const blocked = DOCUMENT.compile(modelBlocked, passGates());
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.projectGate.model.status, 'BLOCKED');

  const externalCrossBlocked = DOCUMENT.compile(source,
    Object.assign(passGates(), { crossPageCoverage: { status: 'BLOCKED', blockingCount: 1 } }));
  assert.equal(externalCrossBlocked.status, 'BLOCKED');
  assert.equal(externalCrossBlocked.projectGate.crossPageCoverage.status, 'BLOCKED');
});

test('rejects malformed or inexact EDEM endpoints instead of guessing or repairing', () => {
  const missingHash = clone(design());
  delete missingHash.modelHash;
  assert.throws(() => DOCUMENT.compile(missingHash), /modelHash is required/);

  const badTerminal = clone(design());
  badTerminal.circuits[0].fromPort = 'GUESSED_PIN';
  badTerminal.modelHash = DOCUMENT.authoritativeModelHash(badTerminal);
  assert.throws(() => DOCUMENT.compile(badTerminal), /references unknown terminal/);

  const badNet = clone(design());
  badNet.circuits[0].netId = 'NET-DOES-NOT-EXIST';
  badNet.modelHash = DOCUMENT.authoritativeModelHash(badNet);
  assert.throws(() => DOCUMENT.compile(badNet), /references unknown net/);
});

test('rejects a stale model hash and engine results freeze the authoritative EDEM', () => {
  const built = win.EVSE_ENGINE.build(params());
  assert.equal(Object.isFrozen(built.design), true);
  assert.equal(Object.isFrozen(built.design.circuits), true);
  assert.equal(Object.isFrozen(built.design.circuits[0]), true);
  const changed = clone(built.design);
  const circuit = changed.circuits[0];
  const instance = changed.instances.find((item) => item.id === circuit.to);
  const alternative = instance.terminals.find((item) => item.id !== circuit.toPort);
  assert.ok(alternative);
  circuit.toPort = alternative.id;
  assert.throws(() => DOCUMENT.compile(changed), /modelHash does not match/);
});
