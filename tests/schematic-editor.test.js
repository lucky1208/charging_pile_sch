'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const IR = require('../engine/drawing-ir.js');
const EDITOR = require('../engine/schematic-editor.js');

function fixture() {
  const a = IR.createPlacedDevice({
    id: 'EQ-A', type: 'ac-breaker', tag: 'QF1', bbox: { x: 0, y: 0, width: 20, height: 20 },
    ports: [{ id: 'OUT', x: 20, y: 10, side: 'RIGHT' }]
  });
  const b = IR.createPlacedDevice({
    id: 'EQ-B', type: 'dc-fuse', tag: 'FU1', bbox: { x: 100, y: 40, width: 20, height: 20 },
    ports: [{ id: 'IN', x: 100, y: 50, side: 'LEFT' }]
  });
  const model = {
    instances: [{ id: 'EQ-A' }, { id: 'EQ-B' }],
    nets: [{ id: 'NET-1', members: ['EQ-A:OUT', 'EQ-B:IN'] }],
    circuits: [{ id: 'C-1', netId: 'NET-1', from: 'EQ-A', fromPort: 'OUT', to: 'EQ-B', toPort: 'IN' }]
  };
  const route = IR.routeOrthogonal({
    id: 'R-1', netId: 'NET-1', circuitId: 'C-1', layer: 'EVSE-DC',
    source: { ref: 'EQ-A:OUT', deviceId: 'EQ-A', portId: 'OUT', x: 20, y: 10 },
    target: { ref: 'EQ-B:IN', deviceId: 'EQ-B', portId: 'IN', x: 100, y: 50 },
    points: [{ x: 20, y: 10 }, { x: 45, y: 10 }, { x: 45, y: 50 }, { x: 100, y: 50 }]
  });
  const drawingIR = IR.buildDrawingIR({
    devices: [a, b], routes: [route], model, strict: true,
    annotations: [{ id: 'NOTE-1', kind: 'text', x: 10, y: 80, text: '原始文字', height: 8 }]
  });
  return { drawingIR, model };
}

test('device movement is transactional and preserves exact model endpoints', () => {
  const value = fixture();
  const session = EDITOR.createSession(value);
  const before = session.snapshot().geometryHash;
  const response = session.moveDevice('EQ-A', 0, 20, { grid: 5 });
  assert.equal(response.accepted, true);
  assert.notEqual(response.snapshot.geometryHash, before);
  assert.equal(session.drawingIR.coverage.ok, true);
  const device = session.inspect('device', 'EQ-A');
  const route = session.inspect('route', 'R-1');
  assert.equal(device.ports[0].y, 30);
  assert.deepEqual({ ref: route.source.ref, x: route.source.x, y: route.source.y },
    { ref: 'EQ-A:OUT', x: 20, y: 30 });
  assert.deepEqual(route.points[0], { x: 20, y: 30 });
  assert.equal(session.undo().accepted, true);
  assert.equal(session.inspect('device', 'EQ-A').ports[0].y, 10);
  assert.equal(session.redo().accepted, true);
  assert.equal(session.inspect('device', 'EQ-A').ports[0].y, 30);
});

test('middle wire segment can move but endpoint-adjacent segments remain locked', () => {
  const value = fixture();
  const session = EDITOR.createSession(value);
  const moved = session.moveRouteSegment('R-1', 1, 10, { grid: 5 });
  assert.equal(moved.accepted, true);
  const route = session.inspect('route', 'R-1');
  assert.equal(route.segments[1].orientation, 'vertical');
  assert.equal(route.segments[1].x1, 55);
  assert.equal(route.source.ref, 'EQ-A:OUT');
  assert.equal(route.target.ref, 'EQ-B:IN');
  const locked = session.moveRouteSegment('R-1', 0, 10, { grid: 5 });
  assert.equal(locked.accepted, false);
  assert.equal(locked.code, 'ENDPOINT_SEGMENT_LOCKED');
});

test('geometry or keepout violation rejects the command and rolls back', () => {
  const value = fixture();
  const session = EDITOR.createSession(value);
  const before = session.snapshot().geometryHash;
  const rejected = session.moveDevice('EQ-A', 100, 40, { grid: 5 });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, 'EDIT_REJECTED_BY_ERC');
  assert.equal(session.snapshot().geometryHash, before);
  assert.equal(session.snapshot().canUndo, false);
});

test('annotation text and position are editable with a stable command journal', () => {
  const value = fixture();
  const session = EDITOR.createSession(value);
  assert.equal(session.editAnnotationText('NOTE-1', '修订文字').accepted, true);
  assert.equal(session.moveAnnotation('NOTE-1', 10, 5, { grid: 5 }).accepted, true);
  const note = session.inspect('annotation', 'NOTE-1');
  assert.equal(note.text, '修订文字');
  assert.equal(note.x, 20);
  assert.equal(note.y, 85);
  const document = session.exportDocument();
  assert.equal(document.schema, 'EVSE-EDITABLE-SCHEMATIC-DOCUMENT/1.0');
  assert.equal(document.journal.length, 2);
  assert.ok(document.journal.every((entry, index) => entry.id === 'CMD-' + String(index + 1).padStart(5, '0')));
});
