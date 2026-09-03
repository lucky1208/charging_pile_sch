'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const IR = require('../engine/drawing-ir.js');
const EDITOR = require('../engine/schematic-editor.js');

function device(id, type, tag, x, y, ports) {
  return IR.createPlacedDevice({
    id, type, tag,
    bbox: { x, y, width: 20, height: 20 },
    ports: ports || []
  });
}

function fixture() {
  const a = device('EQ-A', 'ac-breaker', 'QF1', 20, 20,
    [{ id: 'OUT', x: 40, y: 30, side: 'RIGHT' }]);
  const b = device('EQ-B', 'dc-fuse', 'FU1', 180, 60,
    [{ id: 'IN', x: 180, y: 70, side: 'LEFT' }]);
  const c = device('EQ-C', 'contactor', 'KM1', 40, 160);
  const d = device('EQ-D', 'contactor', 'KM2', 100, 170);
  const e = device('EQ-E', 'contactor', 'KM3', 220, 190);

  const model = {
    instances: [a, b, c, d, e].map((item) => ({ id: item.id })),
    nets: [{ id: 'NET-1', members: ['EQ-A:OUT', 'EQ-B:IN'] }],
    circuits: [{
      id: 'C-1', netId: 'NET-1',
      from: 'EQ-A', fromPort: 'OUT', to: 'EQ-B', toPort: 'IN'
    }]
  };
  const route = IR.routeOrthogonal({
    id: 'R-1', netId: 'NET-1', circuitId: 'C-1', layer: 'EVSE-DC',
    source: { ref: 'EQ-A:OUT', deviceId: 'EQ-A', portId: 'OUT', x: 40, y: 30 },
    target: { ref: 'EQ-B:IN', deviceId: 'EQ-B', portId: 'IN', x: 180, y: 70 },
    points: [{ x: 40, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 70 }, { x: 180, y: 70 }]
  });
  const drawingIR = IR.buildDrawingIR({
    devices: [a, b, c, d, e],
    routes: [route],
    annotations: [{ id: 'NOTE-1', kind: 'text', x: 50, y: 120, text: '说明', height: 8 }],
    metadata: { sheet: { canvasWidth: 400, canvasHeight: 300 } },
    model,
    strict: true
  });
  return { drawingIR, model };
}

function selectionKeys(items) {
  return items.map((item) => item.kind + ':' + item.id).sort();
}

function centerX(item) {
  return (item.bbox.xMin + item.bbox.xMax) / 2;
}

test('selection supports replace, add and toggle while maintaining an explicit primary object', () => {
  const session = EDITOR.createSession(fixture());
  const initial = session.snapshot();

  let snapshot = session.selectMany(
    [{ kind: 'device', id: 'EQ-A' }],
    { mode: 'replace', primary: { kind: 'device', id: 'EQ-A' } }
  );
  assert.deepEqual(selectionKeys(snapshot.selections), ['device:EQ-A']);
  assert.deepEqual(snapshot.selection, { kind: 'device', id: 'EQ-A', subId: null });

  snapshot = session.selectMany([
    { kind: 'device', id: 'EQ-B' },
    { kind: 'annotation', id: 'NOTE-1' }
  ], { mode: 'add', primary: { kind: 'annotation', id: 'NOTE-1' } });
  assert.deepEqual(selectionKeys(session.selections), [
    'annotation:NOTE-1', 'device:EQ-A', 'device:EQ-B'
  ]);
  assert.equal(session.selection.kind, 'annotation');
  assert.equal(session.selection.id, 'NOTE-1');

  snapshot = session.toggleSelection('device', 'EQ-B');
  assert.deepEqual(selectionKeys(snapshot.selections), ['annotation:NOTE-1', 'device:EQ-A']);
  assert.equal(snapshot.selection.id, 'NOTE-1');

  snapshot = session.selectMany(
    [{ kind: 'route', id: 'R-1' }],
    { mode: 'toggle', primary: { kind: 'route', id: 'R-1' } }
  );
  assert.deepEqual(selectionKeys(snapshot.selections), [
    'annotation:NOTE-1', 'device:EQ-A', 'route:R-1'
  ]);
  assert.deepEqual(snapshot.selection, { kind: 'route', id: 'R-1', subId: null });

  assert.equal(snapshot.revision, 0, 'selection is view state and must not create a geometry revision');
  assert.equal(snapshot.geometryHash, initial.geometryHash);
  assert.equal(snapshot.canUndo, false);

  snapshot = session.selectMany([{ kind: 'device', id: 'EQ-A' }], { mode: 'remove' });
  assert.deepEqual(selectionKeys(snapshot.selections), ['annotation:NOTE-1', 'route:R-1']);
  assert.throws(() => session.selectMany([], { mode: 'mystery' }), (error) => error.code === 'SELECTION_MODE_INVALID');

  snapshot = session.select('route', 'R-1', '1');
  assert.deepEqual(snapshot.selection, { kind: 'route', id: 'R-1', subId: '1' });
  snapshot = session.toggleSelection('route', 'R-1', '1');
  assert.equal(snapshot.selection, null);
});

test('covered drawings require the live EDEM model and reject a mismatched model at session start', () => {
  const value = fixture();
  assert.throws(() => EDITOR.createSession({ drawingIR: value.drawingIR }),
    (error) => error.code === 'MODEL_REQUIRED_FOR_COVERED_DRAWING');
  const mismatched = JSON.parse(JSON.stringify(value.model));
  mismatched.circuits[0].to = 'EQ-C';
  assert.throws(() => EDITOR.createSession({ drawingIR: value.drawingIR, model: mismatched }),
    (error) => error.code === 'MODEL_DRAWING_MISMATCH');
  assert.match(EDITOR.createSession(value).snapshot().modelHash, /^fnv1a32:/);
});

test('rectangle queries distinguish contained windows from intersect windows for every editable kind', () => {
  const session = EDITOR.createSession(fixture());

  assert.deepEqual(selectionKeys(session.queryRect(
    { xMin: 18, yMin: 18, xMax: 42, yMax: 42 },
    { mode: 'contained', kinds: ['device'] }
  )), ['device:EQ-A']);
  assert.deepEqual(selectionKeys(session.queryRect(
    { xMin: 35, yMin: 25, xMax: 185, yMax: 75 },
    { mode: 'contained', kinds: ['route'] }
  )), ['route:R-1']);
  assert.deepEqual(selectionKeys(session.queryRect(
    { xMin: 45, yMin: 110, xMax: 70, yMax: 125 },
    { mode: 'contained', kinds: ['annotation'] }
  )), ['annotation:NOTE-1']);

  assert.deepEqual(selectionKeys(session.queryRect(
    { xMin: 38, yMin: 25, xMax: 45, yMax: 35 },
    { mode: 'intersect', kinds: ['device', 'route'] }
  )), ['device:EQ-A', 'route:R-1']);
  assert.deepEqual(selectionKeys(session.queryRect(
    { xMin: 58, yMin: 116, xMax: 65, yMax: 123 },
    { mode: 'intersect', kinds: ['annotation'] }
  )), ['annotation:NOTE-1']);
  assert.throws(() => session.queryRect(
    { xMin: 0, yMin: 0, xMax: 10, yMax: 10 },
    { mode: 'approximate' }
  ), (error) => error.code === 'RECT_SELECTION_MODE_INVALID');
});

test('session snapshots are deeply immutable and isolated from caller-owned Drawing IR metadata', () => {
  const value = fixture();
  const session = EDITOR.createSession(value);
  const before = session.snapshot();

  value.drawingIR.metadata.sheet.canvasWidth = 999;
  assert.equal(session.snapshot().drawingIR.metadata.sheet.canvasWidth, 400);
  assert.equal(session.snapshot().geometryHash, before.geometryHash);
  assert.equal(Object.isFrozen(session.snapshot().drawingIR.metadata.sheet), true);
  assert.throws(() => {
    session.snapshot().drawingIR.metadata.sheet.canvasWidth = 777;
  }, TypeError);
  assert.equal(session.snapshot().geometryHash, before.geometryHash);
  assert.equal(session.snapshot().revision, 0);
});

test('reset and redo enforce the configured history limit', () => {
  const session = EDITOR.createSession(Object.assign(fixture(), { historyLimit: 1 }));
  assert.equal(session.moveAnnotation('NOTE-1', 10, 0, { grid: 5 }).accepted, true);
  assert.equal(session.reset().accepted, true);
  assert.equal(session.undo().accepted, true);
  assert.equal(session.inspect('annotation', 'NOTE-1').x, 60);
  const exhausted = session.undo();
  assert.equal(exhausted.accepted, false);
  assert.equal(exhausted.code, 'UNDO_EMPTY');
  assert.equal(session.redo().accepted, true);
  assert.equal(session.inspect('annotation', 'NOTE-1').x, 50);
});

test('device and annotation move as one transaction and one undo restores the complete group', () => {
  const session = EDITOR.createSession(fixture());
  const before = session.snapshot();
  const originalDevice = session.inspect('device', 'EQ-A');
  const originalNote = session.inspect('annotation', 'NOTE-1');

  const moved = session.moveObjects([
    { kind: 'device', id: 'EQ-A' },
    { kind: 'annotation', id: 'NOTE-1' }
  ], 20, 10, { grid: 5 });

  assert.equal(moved.accepted, true);
  assert.equal(moved.command.type, 'MOVE_OBJECTS');
  assert.equal(moved.snapshot.revision, 1);
  assert.equal(moved.snapshot.journalLength, 1);
  assert.equal(session.inspect('device', 'EQ-A').bbox.xMin, originalDevice.bbox.xMin + 20);
  assert.equal(session.inspect('device', 'EQ-A').bbox.yMin, originalDevice.bbox.yMin + 10);
  assert.equal(session.inspect('annotation', 'NOTE-1').x, originalNote.x + 20);
  assert.equal(session.inspect('annotation', 'NOTE-1').y, originalNote.y + 10);
  assert.deepEqual(
    { x: session.inspect('route', 'R-1').source.x, y: session.inspect('route', 'R-1').source.y },
    { x: session.inspect('device', 'EQ-A').ports[0].x, y: session.inspect('device', 'EQ-A').ports[0].y }
  );

  const undone = session.undo();
  assert.equal(undone.accepted, true);
  assert.equal(undone.snapshot.geometryHash, before.geometryHash);
  assert.equal(session.inspect('device', 'EQ-A').bbox.xMin, originalDevice.bbox.xMin);
  assert.equal(session.inspect('device', 'EQ-A').bbox.yMin, originalDevice.bbox.yMin);
  assert.equal(session.inspect('annotation', 'NOTE-1').x, originalNote.x);
  assert.equal(session.inspect('annotation', 'NOTE-1').y, originalNote.y);
});

test('a colliding group move rolls back every selected object and creates no history entry', () => {
  const session = EDITOR.createSession(fixture());
  const before = session.snapshot();
  const noteBefore = session.inspect('annotation', 'NOTE-1');

  const rejected = session.moveObjects([
    { kind: 'device', id: 'EQ-A' },
    { kind: 'annotation', id: 'NOTE-1' }
  ], 160, 40, { grid: 5 });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, 'DEVICE_BODY_COLLISION');
  assert.equal(session.snapshot().geometryHash, before.geometryHash);
  assert.equal(session.snapshot().revision, before.revision);
  assert.equal(session.snapshot().canUndo, false);
  assert.equal(session.inspect('device', 'EQ-A').bbox.xMin, 20);
  assert.equal(session.inspect('device', 'EQ-A').bbox.yMin, 20);
  assert.equal(session.inspect('annotation', 'NOTE-1').x, noteBefore.x);
  assert.equal(session.inspect('annotation', 'NOTE-1').y, noteBefore.y);
});

test('device alignment commits atomically and unsafe alignment fails without mutation', () => {
  const alignedSession = EDITOR.createSession(fixture());
  const aligned = alignedSession.alignDevices(
    ['EQ-C', 'EQ-D'], 'top', { anchorId: 'EQ-C', grid: 5 }
  );
  assert.equal(aligned.accepted, true);
  assert.equal(aligned.command.type, 'ALIGN_DEVICES');
  assert.equal(aligned.snapshot.revision, 1);
  assert.equal(alignedSession.inspect('device', 'EQ-C').bbox.yMin, 160);
  assert.equal(alignedSession.inspect('device', 'EQ-D').bbox.yMin, 160);

  const unsafeSession = EDITOR.createSession(fixture());
  const before = unsafeSession.snapshot();
  const rejected = unsafeSession.alignDevices(
    ['EQ-C', 'EQ-D'], 'left', { anchorId: 'EQ-C', grid: 5 }
  );
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, 'DEVICE_BODY_COLLISION');
  assert.equal(unsafeSession.snapshot().geometryHash, before.geometryHash);
  assert.equal(unsafeSession.snapshot().revision, 0);
  assert.equal(unsafeSession.snapshot().canUndo, false);

  const invalidAnchorSession = EDITOR.createSession(fixture());
  const invalidAnchor = invalidAnchorSession.alignDevices(
    ['EQ-C', 'EQ-D'], 'top', { anchorId: 'EQ-NOT-SELECTED', grid: 5 }
  );
  assert.equal(invalidAnchor.accepted, false);
  assert.equal(invalidAnchor.code, 'ALIGN_ANCHOR_NOT_SELECTED');
});

test('device distribution creates equal spacing and invalid distribution is a safe no-op', () => {
  const distributedSession = EDITOR.createSession(fixture());
  const distributed = distributedSession.distributeDevices(
    ['EQ-C', 'EQ-D', 'EQ-E'], 'horizontal', { grid: 5 }
  );
  assert.equal(distributed.accepted, true);
  assert.equal(distributed.command.type, 'DISTRIBUTE_DEVICES');
  assert.equal(distributed.snapshot.revision, 1);
  const centers = ['EQ-C', 'EQ-D', 'EQ-E'].map((id) => centerX(distributedSession.inspect('device', id)));
  assert.equal(centers[1] - centers[0], centers[2] - centers[1]);

  const invalidSession = EDITOR.createSession(fixture());
  const before = invalidSession.snapshot();
  const rejected = invalidSession.distributeDevices(
    ['EQ-C', 'EQ-D', 'EQ-E'], 'diagonal', { grid: 5 }
  );
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, 'DISTRIBUTE_AXIS_INVALID');
  assert.equal(invalidSession.snapshot().geometryHash, before.geometryHash);
  assert.equal(invalidSession.snapshot().revision, 0);
  assert.equal(invalidSession.snapshot().canUndo, false);
});

test('alignment can move both ends of one route by different deltas without changing endpoint identity', () => {
  const session = EDITOR.createSession(fixture());
  const response = session.alignDevices(['EQ-A', 'EQ-B', 'EQ-E'], 'top', { anchorId: 'EQ-E', grid: 5 });
  assert.equal(response.accepted, true);
  const route = session.inspect('route', 'R-1');
  const sourcePort = session.inspect('device', 'EQ-A').ports[0];
  const targetPort = session.inspect('device', 'EQ-B').ports[0];
  assert.deepEqual({ ref: route.source.ref, x: route.source.x, y: route.source.y },
    { ref: sourcePort.ref, x: sourcePort.x, y: sourcePort.y });
  assert.deepEqual({ ref: route.target.ref, x: route.target.x, y: route.target.y },
    { ref: targetPort.ref, x: targetPort.x, y: targetPort.y });
  assert.equal(session.drawingIR.coverage.ok, true);
});

test('alignment and distribution preserve exact constraints even when a requested grid cannot represent them', () => {
  const a = IR.createPlacedDevice({ id: 'A', type: 'ac-breaker', bbox: { x: 0, y: 0, width: 21, height: 20 }, ports: [] });
  const b = IR.createPlacedDevice({ id: 'B', type: 'dc-fuse', bbox: { x: 50, y: 50, width: 20, height: 20 }, ports: [] });
  const c = IR.createPlacedDevice({ id: 'C', type: 'contactor', bbox: { x: 101, y: 100, width: 20, height: 20 }, ports: [] });
  const model = { instances: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], nets: [], circuits: [] };
  const drawingIR = IR.buildDrawingIR({ devices: [a, b, c], routes: [], model, strict: true });
  const aligned = EDITOR.createSession({ drawingIR, model });
  assert.equal(aligned.alignDevices(['A', 'B'], 'centerX', { anchorId: 'A', grid: 5 }).accepted, true);
  assert.equal(centerX(aligned.inspect('device', 'A')), centerX(aligned.inspect('device', 'B')));

  const distributed = EDITOR.createSession({ drawingIR, model });
  assert.equal(distributed.distributeDevices(['A', 'B', 'C'], 'horizontal', { grid: 5 }).accepted, true);
  const centers = ['A', 'B', 'C'].map((id) => centerX(distributed.inspect('device', id)));
  assert.ok(Math.abs((centers[1] - centers[0]) - (centers[2] - centers[1])) < 1e-9);
});
