'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IR = require('../engine/drawing-ir.js');

function endpoint(deviceId, portId, x, y) {
  return { ref: deviceId + ':' + portId, deviceId, portId, x, y };
}

function straightRoute(id, netId, circuitId, source, target, extra) {
  return IR.routeOrthogonal(Object.assign({
    id, netId, circuitId, source, target,
    points: [{ x: source.x, y: source.y }, { x: target.x, y: target.y }]
  }, extra || {}));
}

test('module loads in a window + new Function environment', () => {
  const file = path.resolve(__dirname, '../engine/drawing-ir.js');
  const source = fs.readFileSync(file, 'utf8');
  const browserWindow = {};
  const loaded = new Function('window', source + '\nreturn window.EVSE_DRAWING_IR;')(browserWindow);
  assert.equal(loaded.VERSION, IR.VERSION);
  assert.equal(typeof loaded.buildDrawingIR, 'function');
  assert.equal(typeof loaded.routeOrthogonal, 'function');
  assert.equal(typeof loaded.auditCoverage, 'function');
  assert.equal(loaded.build, loaded.buildDrawingIR);
  assert.equal(loaded.route, loaded.routeOrthogonal);
  assert.equal(loaded.audit, loaded.auditCoverage);
});

test('interval coloring is optimal, stable, and uses deterministic lane labels', () => {
  const intervals = [
    { id: 'LONG', start: 0, end: 10 },
    { id: 'LEFT', start: 1, end: 4 },
    { id: 'RIGHT', start: 6, end: 9 },
    { id: 'AFTER', start: 12, end: 14 }
  ];
  const a = IR.allocateIntervalLanes(intervals);
  const b = IR.allocateIntervalLanes([intervals[3], intervals[1], intervals[0], intervals[2]]);
  assert.equal(a.laneCount, 2, 'maximum clique has two intervals');
  assert.equal(a.optimal, true);
  assert.deepEqual(a.assignments, b.assignments);
  assert.deepEqual(a.byId, { AFTER: 0, LEFT: 1, LONG: 0, RIGHT: 1 });
});

test('closed interval endpoints conflict unless touchingConflicts is disabled', () => {
  const intervals = [{ id: 'A', start: 0, end: 10 }, { id: 'B', start: 10, end: 20 }];
  assert.equal(IR.allocateIntervalLanes(intervals).laneCount, 2);
  assert.equal(IR.allocateIntervalLanes(intervals, { touchingConflicts: false }).laneCount, 1);
});

test('channel assignment produces stable physical coordinates', () => {
  const channel = IR.createChannel({
    id: 'CTL-H1', orientation: 'horizontal',
    bounds: { x: 0, y: 100, width: 200, height: 30 },
    lanePitch: 10, laneInset: 5
  });
  const allocation = IR.assignChannelLanes(channel, [
    { id: 'R2', start: 20, end: 80 },
    { id: 'R1', start: 0, end: 50 }
  ]);
  assert.equal(allocation.laneCount, 2);
  assert.equal(allocation.byId.R1.coordinate, 105);
  assert.equal(allocation.byId.R2.coordinate, 115);
});

test('channel capacity overflow is fail-closed with actionable details', () => {
  const channel = IR.createChannel({
    id: 'ONE-LANE', orientation: 'horizontal', start: 0, end: 100,
    crossMin: 20, crossMax: 20, lanePitch: 10, capacity: 1
  });
  assert.throws(
    () => IR.assignChannelLanes(channel, [
      { id: 'A', start: 0, end: 80 },
      { id: 'B', start: 10, end: 90 }
    ]),
    (error) => error instanceof IR.ChannelCapacityError &&
      error.code === 'CHANNEL_CAPACITY_EXCEEDED' &&
      error.details.channelId === 'ONE-LANE' && error.details.required === 2
  );
});

test('orthogonal route generation only emits Manhattan segments', () => {
  const route = IR.routeOrthogonal({
    id: 'R-MANHATTAN', netId: 'N1', circuitId: 'C1',
    source: endpoint('A', 'P', 0, 0),
    target: endpoint('B', 'Q', 100, 70),
    via: [{ x: 30, y: 20 }, { x: 80, y: 40 }],
    bend: 'horizontal-first'
  });
  assert.equal(route.points[0].x, 0);
  assert.equal(route.points.at(-1).y, 70);
  assert.ok(route.segments.length >= 2);
  assert.ok(route.segments.every((segment) => segment.x1 === segment.x2 || segment.y1 === segment.y2));
});

test('global crossing pass classifies same-net junction and different-net bridge', () => {
  const routes = [
    straightRoute('R-H1', 'NET-SAME', 'C1', endpoint('A', 'P', 0, 20), endpoint('B', 'P', 100, 20)),
    straightRoute('R-V1', 'NET-SAME', 'C2', endpoint('C', 'P', 30, 0), endpoint('D', 'P', 30, 40)),
    straightRoute('R-H2', 'NET-OTHER', 'C3', endpoint('E', 'P', 0, 60), endpoint('F', 'P', 100, 60)),
    straightRoute('R-V2', 'NET-THIRD', 'C4', endpoint('G', 'P', 70, 40), endpoint('H', 'P', 70, 80))
  ];
  const result = IR.analyzeGeometry({ routes });
  assert.equal(result.junctions.length, 1);
  assert.deepEqual({ x: result.junctions[0].x, y: result.junctions[0].y }, { x: 30, y: 20 });
  assert.equal(result.bridges.length, 1);
  assert.deepEqual({ x: result.bridges[0].x, y: result.bridges[0].y }, { x: 70, y: 60 });
  assert.equal(result.violations.length, 0);
});

test('different-net endpoint contact is illegal rather than hidden by a bridge', () => {
  const routes = [
    straightRoute('H', 'N1', 'C1', endpoint('A', 'P', 0, 10), endpoint('B', 'P', 20, 10)),
    straightRoute('V', 'N2', 'C2', endpoint('C', 'P', 20, 10), endpoint('D', 'P', 20, 30))
  ];
  const result = IR.analyzeGeometry({ routes });
  assert.equal(result.bridges.length, 0);
  assert.ok(result.violations.some((violation) => violation.code === 'DIFFERENT_NET_CONTACT'));
});

test('route through a device keep-out is reported', () => {
  const device = IR.createPlacedDevice({
    id: 'EQ-X', bbox: { x: 40, y: 40, width: 20, height: 20 }, ports: []
  });
  const route = straightRoute('R-CUT', 'N1', 'C1', endpoint('A', 'P', 0, 50), endpoint('B', 'P', 100, 50));
  const result = IR.analyzeGeometry({ devices: [device], routes: [route] });
  assert.equal(result.keepoutViolations.length, 1);
  assert.equal(result.keepoutViolations[0].deviceId, 'EQ-X');
  assert.ok(result.violations.some((violation) => violation.code === 'ROUTE_KEEP_OUT_INTERSECTION'));
});

test('positive-length collinear overlap is illegal for both same and different nets', () => {
  const routes = [
    straightRoute('R-A', 'N1', 'C1', endpoint('A', 'P', 0, 10), endpoint('B', 'P', 80, 10)),
    straightRoute('R-B', 'N1', 'C2', endpoint('C', 'P', 30, 10), endpoint('D', 'P', 100, 10)),
    straightRoute('R-C', 'N2', 'C3', endpoint('E', 'P', 0, 30), endpoint('F', 'P', 80, 30)),
    straightRoute('R-D', 'N3', 'C4', endpoint('G', 'P', 30, 30), endpoint('H', 'P', 100, 30))
  ];
  const result = IR.analyzeGeometry({ routes });
  assert.equal(result.illegalOverlaps.length, 2);
  assert.equal(result.violations.filter((violation) => violation.code === 'ILLEGAL_COLLINEAR_OVERLAP').length, 2);
});

test('post-processing and Drawing IR hash do not depend on device/route input order', () => {
  const devices = [
    IR.createPlacedDevice({ id: 'A', bbox: { x: -20, y: 10, width: 20, height: 20 },
      ports: [{ id: 'P', x: 0, y: 20, side: 'RIGHT' }] }),
    IR.createPlacedDevice({ id: 'B', bbox: { x: 100, y: 10, width: 20, height: 20 },
      ports: [{ id: 'P', x: 100, y: 20, side: 'LEFT' }] }),
    IR.createPlacedDevice({ id: 'C', bbox: { x: 40, y: -20, width: 20, height: 20 },
      ports: [{ id: 'P', x: 50, y: 0, side: 'BOTTOM' }] }),
    IR.createPlacedDevice({ id: 'D', bbox: { x: 40, y: 40, width: 20, height: 20 },
      ports: [{ id: 'P', x: 50, y: 40, side: 'TOP' }] })
  ];
  const routes = [
    straightRoute('R-H', 'N-H', 'C-H', endpoint('A', 'P', 0, 20), endpoint('B', 'P', 100, 20)),
    straightRoute('R-V', 'N-V', 'C-V', endpoint('C', 'P', 50, 0), endpoint('D', 'P', 50, 40))
  ];
  const first = IR.buildDrawingIR({ devices, routes, metadata: { drawingNo: 'T-001', revision: 'A' } });
  const second = IR.buildDrawingIR({
    devices: [devices[3], devices[1], devices[0], devices[2]],
    routes: [routes[1], routes[0]],
    metadata: { revision: 'A', drawingNo: 'T-001' }
  });
  assert.equal(first.markers.length, 1);
  assert.equal(first.markers[0].type, 'bridge');
  assert.equal(IR.drawingIRHash(first), IR.drawingIRHash(second));
  assert.deepEqual(IR.canonicalDrawingProjection(first), IR.canonicalDrawingProjection(second));
});

test('coverage audit validates devices, nets, circuits and exact terminal endpoints', () => {
  const devices = [
    IR.createPlacedDevice({ id: 'EQ-A', bbox: { x: -10, y: -10, width: 10, height: 20 },
      ports: [{ id: 'OUT+', x: 0, y: 0 }] }),
    IR.createPlacedDevice({ id: 'EQ-B', bbox: { x: 100, y: -10, width: 10, height: 20 },
      ports: [{ id: 'IN+', x: 100, y: 0 }] })
  ];
  const model = {
    instances: [{ id: 'EQ-A' }, { id: 'EQ-B' }],
    nets: [{ id: 'NET-DC+', members: ['EQ-A:OUT+', 'EQ-B:IN+'] }],
    circuits: [{ id: 'C-DC+', netId: 'NET-DC+', from: 'EQ-A', fromPort: 'OUT+', to: 'EQ-B', toPort: 'IN+' }]
  };
  const route = straightRoute('R-DC+', 'NET-DC+', 'C-DC+',
    endpoint('EQ-A', 'OUT+', 0, 0), endpoint('EQ-B', 'IN+', 100, 0));
  const good = IR.auditCoverage(model, { devices, routes: [route] });
  assert.equal(good.ok, true);

  const wrongTerminal = straightRoute('R-WRONG', 'NET-DC+', 'C-DC+',
    endpoint('EQ-A', 'OUT+', 0, 0), endpoint('EQ-B', 'IN-', 100, 0));
  const endpointMutation = IR.auditCoverage(model, { devices, routes: [wrongTerminal] });
  assert.equal(endpointMutation.ok, false);
  assert.ok(endpointMutation.errors.some((error) => error.code === 'CONNECTION_ENDPOINT_MISMATCH'));

  const missingMutation = IR.auditCoverage(model, { devices, routes: [] });
  assert.equal(missingMutation.ok, false);
  assert.ok(missingMutation.errors.some((error) => error.code === 'CONNECTION_MISSING_ROUTE'));

  const extraDevice = IR.createPlacedDevice({ id: 'EQ-X', bbox: { x: 10, y: 30, width: 10, height: 10 } });
  const deviceMutation = IR.auditCoverage(model, { devices: devices.concat(extraDevice), routes: [route] });
  assert.equal(deviceMutation.ok, false);
  assert.ok(deviceMutation.errors.some((error) => error.code === 'DEVICE_EXTRA_IN_DRAWING'));
});

test('renderer-neutral primitives retain traceability tags for SVG and DXF', () => {
  const devices = [
    IR.createPlacedDevice({ id: 'A', bbox: { x: -10, y: -10, width: 10, height: 20 },
      ports: [{ id: 'P', x: 0, y: 0 }] }),
    IR.createPlacedDevice({ id: 'B', bbox: { x: 100, y: -10, width: 10, height: 20 },
      ports: [{ id: 'Q', x: 100, y: 0 }] })
  ];
  const route = straightRoute('R1', 'N1', 'C1', endpoint('A', 'P', 0, 0), endpoint('B', 'Q', 100, 0), { layer: 'EVSE-DC' });
  const drawing = IR.buildDrawingIR({ devices, routes: [route] });
  const primitive = drawing.primitives.find((item) => item.id === 'ROUTE:R1');
  assert.deepEqual(
    { kind: primitive.kind, layer: primitive.layer, routeId: primitive.routeId,
      netId: primitive.netId, circuitId: primitive.circuitId, from: primitive.from, to: primitive.to },
    { kind: 'polyline', layer: 'EVSE-DC', routeId: 'R1', netId: 'N1', circuitId: 'C1', from: 'A:P', to: 'B:Q' }
  );
});

test('multiplicity-many terminals may expose deterministic graphical tap anchors', () => {
  const bus = IR.createPlacedDevice({
    id: 'BUS', bbox: { x: 0, y: 0, width: 40, height: 40 },
    ports: [
      { id: 'P@C1', ref: 'BUS:P', x: 40, y: 10 },
      { id: 'P@C2', ref: 'BUS:P', x: 40, y: 30 }
    ]
  });
  const a = IR.createPlacedDevice({ id: 'A', bbox: { x: 100, y: 0, width: 30, height: 20 },
    ports: [{ id: 'IN', x: 100, y: 10 }] });
  const b = IR.createPlacedDevice({ id: 'B', bbox: { x: 100, y: 40, width: 30, height: 20 },
    ports: [{ id: 'IN', x: 100, y: 50 }] });
  const model = {
    instances: [{ id: 'BUS' }, { id: 'A' }, { id: 'B' }],
    nets: [{ id: 'N', members: [
      { instanceId: 'BUS', terminalId: 'P' },
      { instanceId: 'A', terminalId: 'IN' },
      { instanceId: 'B', terminalId: 'IN' }
    ] }],
    circuits: [
      { id: 'C1', netId: 'N', from: 'BUS', fromPort: 'P', to: 'A', toPort: 'IN' },
      { id: 'C2', netId: 'N', from: 'BUS', fromPort: 'P', to: 'B', toPort: 'IN' }
    ]
  };
  const routes = [
    straightRoute('C1', 'N', 'C1', endpoint('BUS', 'P', 40, 10), endpoint('A', 'IN', 100, 10)),
    straightRoute('C2', 'N', 'C2', endpoint('BUS', 'P', 40, 30), endpoint('B', 'IN', 100, 50), {
      points: [{ x: 40, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 50 }, { x: 100, y: 50 }]
    })
  ];
  assert.equal(IR.auditCoverage(model, { devices: [bus, a, b], routes }).ok, true);
});
