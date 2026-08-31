'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const IR = require('../engine/drawing-ir.js');
const ROUTER = require('../engine/schematic-edit-router.js');
const EDITOR = require('../engine/schematic-editor.js');

function device(id, x, y, port) {
  return IR.createPlacedDevice({ id, type: 'terminal-block', bbox: { x, y, width: 20, height: 20 },
    ports: port ? [port] : [] });
}
function route(id, netId, circuitId, source, target, points) {
  return IR.routeOrthogonal({ id, netId, circuitId, layer: 'EVSE-CTL', source, target, points });
}
function endpoint(deviceId, portId, x, y) { return { ref: deviceId + ':' + portId, deviceId, portId, x, y }; }

test('sparse orthogonal router detours around a hard device obstacle and is deterministic', () => {
  const devices = [
    device('A', 0, 40, { id: 'P', x: 20, y: 50, side: 'RIGHT' }),
    device('B', 140, 40, { id: 'P', x: 140, y: 50, side: 'LEFT' }),
    device('OBSTACLE', 60, 35)
  ];
  const invalidSeed = route('R1', 'N1', 'C1', endpoint('A', 'P', 20, 50), endpoint('B', 'P', 140, 50),
    [{ x: 20, y: 50 }, { x: 140, y: 50 }]);
  const first = ROUTER.planRoute({ route: invalidSeed, devices, fixedRoutes: [],
    options: { deviceClearance: 5, wireSpacing: 5 } });
  const second = ROUTER.planRoute({ route: invalidSeed, devices, fixedRoutes: [],
    options: { deviceClearance: 5, wireSpacing: 5 } });
  assert.deepEqual(first.route.points, second.route.points);
  assert.notDeepEqual(first.route.points, invalidSeed.points);
  const analysis = IR.analyzeGeometry({ devices, routes: [first.route] });
  assert.equal(analysis.violations.length, 0);
  assert.ok(first.route.points.some((point) => point.y <= 30 || point.y >= 60));
});

test('rerouteAffected discovers a wire displaced by a newly occupied keepout', () => {
  const devices = [
    device('A', 0, 40, { id: 'P', x: 20, y: 50, side: 'RIGHT' }),
    device('B', 140, 40, { id: 'P', x: 140, y: 50, side: 'LEFT' }),
    device('MOVED', 60, 35)
  ];
  const original = route('R1', 'N1', 'C1', endpoint('A', 'P', 20, 50), endpoint('B', 'P', 140, 50),
    [{ x: 20, y: 50 }, { x: 140, y: 50 }]);
  assert.equal(IR.analyzeGeometry({ devices, routes: [original] }).violations.length, 1);
  const result = ROUTER.rerouteAffected({ devices, routes: [original], affectedRouteIds: [] });
  assert.deepEqual(result.reroutedRouteIds, ['R1']);
  assert.equal(IR.analyzeGeometry({ devices, routes: result.routes }).violations.length, 0);
  assert.notDeepEqual(result.routes[0].points, original.points);
});

test('router never escapes the sheet or falls back through a full-height obstacle', () => {
  const devices = [
    device('A', 0, 40, { id: 'P', x: 20, y: 50, side: 'RIGHT' }),
    device('B', 140, 40, { id: 'P', x: 140, y: 50, side: 'LEFT' }),
    IR.createPlacedDevice({ id: 'WALL', type: 'terminal-block', bbox: { x: 60, y: 0, width: 20, height: 100 }, ports: [] })
  ];
  const seed = route('R1', 'N1', 'C1', endpoint('A', 'P', 20, 50), endpoint('B', 'P', 140, 50),
    [{ x: 20, y: 50 }, { x: 140, y: 50 }]);
  assert.throws(() => ROUTER.planRoute({ route: seed, devices, fixedRoutes: [], options: {
    deviceClearance: 0, sheetBounds: { xMin: 0, yMin: 0, xMax: 160, yMax: 100 }
  } }), (error) => error && error.code === 'NO_LEGAL_ORTHOGONAL_PATH');
});

function pushFixture(withObstacle) {
  const devices = [
    device('A', 0, 10, { id: 'P', x: 20, y: 20, side: 'RIGHT' }),
    device('B', 140, 10, { id: 'P', x: 140, y: 20, side: 'LEFT' }),
    device('C', 0, 50, { id: 'P', x: 20, y: 60, side: 'RIGHT' }),
    device('D', 140, 50, { id: 'P', x: 140, y: 60, side: 'LEFT' })
  ];
  if (withObstacle) devices.push(device('BLOCK', 60, 34));
  const routes = [
    route('R1', 'N1', 'C1', endpoint('A', 'P', 20, 20), endpoint('B', 'P', 140, 20),
      [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 30 }, { x: 120, y: 30 }, { x: 120, y: 20 }, { x: 140, y: 20 }]),
    route('R2', 'N2', 'C2', endpoint('C', 'P', 20, 60), endpoint('D', 'P', 140, 60),
      [{ x: 20, y: 60 }, { x: 40, y: 60 }, { x: 40, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 60 }, { x: 140, y: 60 }])
  ];
  const model = {
    instances: devices.map((item) => ({ id: item.id })),
    nets: [
      { id: 'N1', members: ['A:P', 'B:P'] },
      { id: 'N2', members: ['C:P', 'D:P'] }
    ],
    circuits: [
      { id: 'C1', netId: 'N1', from: 'A', fromPort: 'P', to: 'B', toPort: 'P' },
      { id: 'C2', netId: 'N2', from: 'C', fromPort: 'P', to: 'D', toPort: 'P' }
    ]
  };
  return { drawingIR: IR.buildDrawingIR({ devices, routes, model, strict: true }), model };
}

test('moving a middle segment push-reroutes the conflicting neighbour while the dragged route stays locked', () => {
  const session = EDITOR.createSession(pushFixture(false));
  const response = session.moveRouteSegment('R1', 2, 10, { grid: 5, deviceClearance: 2, wireSpacing: 5 });
  assert.equal(response.accepted, true, response.message);
  assert.deepEqual(response.command.payload.displacedRouteIds, ['R2']);
  assert.equal(session.inspect('route', 'R1').segments[2].y1, 40);
  assert.equal(session.drawingIR.violations.length, 0);
  assert.equal(session.drawingIR.coverage.ok, true);
});

test('locked route entering a component is rejected and the transaction hash is unchanged', () => {
  const devices = [
    device('A', 0, 10, { id: 'P', x: 20, y: 20, side: 'RIGHT' }),
    device('B', 140, 10, { id: 'P', x: 140, y: 20, side: 'LEFT' }),
    device('BLOCK', 60, 34)
  ];
  const routes = [route('R1', 'N1', 'C1', endpoint('A', 'P', 20, 20), endpoint('B', 'P', 140, 20),
    [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 30 }, { x: 120, y: 30 }, { x: 120, y: 20 }, { x: 140, y: 20 }])];
  const model = {
    instances: devices.map((item) => ({ id: item.id })),
    nets: [{ id: 'N1', members: ['A:P', 'B:P'] }],
    circuits: [{ id: 'C1', netId: 'N1', from: 'A', fromPort: 'P', to: 'B', toPort: 'P' }]
  };
  const value = { drawingIR: IR.buildDrawingIR({ devices, routes, model, strict: true }), model };
  const session = EDITOR.createSession(value);
  const before = session.snapshot().geometryHash;
  const response = session.moveRouteSegment('R1', 2, 10, { grid: 5 });
  assert.equal(response.accepted, false);
  assert.equal(response.code, 'LOCKED_GEOMETRY_VIOLATION');
  assert.equal(session.snapshot().geometryHash, before);
  assert.equal(session.snapshot().canUndo, false);
});

test('drag previews preserve state and expose every moved terminal route', () => {
  const session = EDITOR.createSession(pushFixture(false));
  const before = session.snapshot().geometryHash;
  const preview = session.previewDeviceMove('A', 0, 15, { grid: 5 });
  assert.equal(preview.routes.length, 1);
  assert.equal(preview.routes[0].id, 'R1');
  assert.deepEqual(preview.routes[0].points[0], { x: 20, y: 35 });
  assert.equal(session.snapshot().geometryHash, before);
  assert.equal(session.snapshot().revision, 0);
  const segment = session.previewRouteSegment('R1', 2, 5, { grid: 5 });
  assert.equal(segment.points[2].y, 35);
  assert.equal(session.snapshot().geometryHash, before);
});

test('pin inspection resolves the opposite physical endpoint and network identity', () => {
  const session = EDITOR.createSession(pushFixture(false));
  assert.deepEqual(session.connectionsForPort('A', 'P').map((item) => ({
    routeId: item.routeId, netId: item.netId, oppositeRef: item.oppositeRef
  })), [{ routeId: 'R1', netId: 'N1', oppositeRef: 'B:P' }]);
});
