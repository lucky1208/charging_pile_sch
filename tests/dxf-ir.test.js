'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IR = require('../engine/drawing-ir.js');
const DXF = require('../engine/dxf-export.js');

function endpoint(deviceId, portId, x, y) {
  return { ref: deviceId + ':' + portId, deviceId, portId, x, y };
}

function straightRoute(id, netId, circuitId, source, target, extra) {
  return IR.routeOrthogonal(Object.assign({
    id, netId, circuitId, source, target,
    points: [{ x: source.x, y: source.y }, { x: target.x, y: target.y }]
  }, extra || {}));
}

function dxfPairs(dxf) {
  const lines = String(dxf).replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  assert.equal(lines.length % 2, 0, 'DXF must contain complete group-code/value pairs');
  const result = [];
  for (let index = 0; index < lines.length; index += 2) {
    result.push({ code: Number(lines[index].trim()), value: lines[index + 1] });
  }
  return result;
}

function entityRecords(dxf) {
  const input = dxfPairs(dxf);
  const records = [];
  let inEntities = false;
  let current = null;
  for (let index = 0; index < input.length; index += 1) {
    const pair = input[index];
    if (!inEntities && pair.code === 0 && pair.value === 'SECTION' &&
        input[index + 1] && input[index + 1].code === 2 && input[index + 1].value === 'ENTITIES') {
      inEntities = true;
      index += 1;
      continue;
    }
    if (!inEntities) continue;
    if (pair.code === 0 && pair.value === 'ENDSEC') {
      if (current) records.push(current);
      break;
    }
    if (pair.code === 0) {
      if (current) records.push(current);
      current = { type: pair.value, pairs: [] };
    } else if (current) {
      current.pairs.push(pair);
    }
  }
  return records;
}

function xdataFields(entity) {
  const app = entity.pairs.findIndex((pair) => pair.code === 1001 && pair.value === DXF.XDATA_APP_ID);
  if (app < 0) return {};
  const fields = {};
  entity.pairs.slice(app + 1).filter((pair) => pair.code === 1000).forEach((pair) => {
    const match = /^([^=]+)=(.*)$/.exec(pair.value);
    if (!match) return;
    const chunked = /^(.*)#(\d+)\/(\d+)$/.exec(match[1]);
    const key = chunked ? chunked[1] : match[1];
    fields[key] = (fields[key] || '') + match[2];
  });
  Object.keys(fields).forEach((key) => { fields[key] = decodeURIComponent(fields[key]); });
  return fields;
}

function polylinePoints(entity) {
  const points = [];
  entity.pairs.forEach((pair, index) => {
    if (pair.code !== 10) return;
    const y = entity.pairs.slice(index + 1).find((candidate) => candidate.code === 20);
    points.push({ x: Number(pair.value), y: Number(y.value) });
  });
  return points;
}

function crossingDrawing() {
  const routes = [
    straightRoute('R-H-J', 'NET-SAME', 'C-J1', endpoint('A', 'P', 0, 20), endpoint('B', 'P', 100, 20), { layer: 'EVSE-DC' }),
    straightRoute('R-V-J', 'NET-SAME', 'C-J2', endpoint('C', 'P', 30, 0), endpoint('D', 'P', 30, 40), { layer: 'EVSE-DC' }),
    straightRoute('R-H-B', 'NET-H', 'C-B1', endpoint('E', 'P', 0, 60), endpoint('F', 'P', 100, 60), { layer: 'EVSE-CTL' }),
    straightRoute('R-V-B', 'NET-V', 'C-B2', endpoint('G', 'P', 70, 40), endpoint('H', 'P', 70, 80), { layer: 'EVSE-COMM' })
  ];
  return IR.buildDrawingIR({ routes, metadata: { drawingNo: 'DXF-IR-001', revision: 'P01' } });
}

test('DXF module loads in CommonJS and window + new Function environments', () => {
  const file = path.resolve(__dirname, '../engine/dxf-export.js');
  const source = fs.readFileSync(file, 'utf8');
  const browserWindow = {};
  const loaded = new Function('window', source + '\nreturn window.EVSE_DXF;')(browserWindow);
  assert.equal(loaded.VERSION, DXF.VERSION);
  assert.equal(loaded.DRAWING_IR_SCHEMA, IR.SCHEMA);
  assert.equal(loaded.fromIR, loaded.exportDrawingIR);
  assert.equal(loaded.exportSvgLegacy, loaded.exportSvg);
});

test('direct DXF route geometry and electrical trace come from Drawing IR unchanged', () => {
  const drawing = crossingDrawing();
  const result = DXF.exportDrawingIR(drawing, { drawingIRHash: IR.drawingIRHash(drawing) });
  const entities = entityRecords(result.dxf);
  const route = drawing.routes.find((item) => item.id === 'R-H-J');
  const routeEntity = entities.find((entity) => xdataFields(entity).routeId === route.id);
  assert.ok(routeEntity, 'route entity must be traceable by routeId');
  assert.equal(routeEntity.type, 'LWPOLYLINE');
  assert.deepEqual(polylinePoints(routeEntity), route.points.map((point) => ({ x: point.x, y: point.y })));
  assert.deepEqual(
    Object.fromEntries(['primitiveId', 'routeId', 'netId', 'circuitId', 'from', 'to'].map((key) => [key, xdataFields(routeEntity)[key]])),
    {
      primitiveId: 'ROUTE:R-H-J', routeId: 'R-H-J', netId: 'NET-SAME', circuitId: 'C-J1',
      from: 'A:P', to: 'B:P'
    }
  );
  assert.match(result.dxf, /\n2\nAPPID\n/);
  assert.match(result.dxf, /\n2\nEVSE_IR\n/);
  assert.equal(result.manifest.source.schema, IR.SCHEMA);
  assert.equal(result.manifest.source.drawingIRHash, IR.drawingIRHash(drawing));
  assert.equal(result.manifest.trace.method, 'DXF_XDATA_AND_COMMENT_METADATA');
  assert.match(result.dxf, /\n999\nEVSE-DXF-IR-MANIFEST: /);
  assert.ok(!result.warnings.some((warning) => warning.includes('LEGACY_SVG_PARSE')));
});

test('device, port, junction, and bridge primitives retain semantic XDATA and marker layers', () => {
  const device = IR.createPlacedDevice({
    id: 'EQ-A', label: 'Controller', bbox: { x: 110, y: 10, width: 20, height: 20 },
    ports: [{ id: 'CAN', x: 110, y: 20 }]
  });
  const base = crossingDrawing();
  const drawing = IR.buildDrawingIR({ devices: [device], routes: base.routes });
  const result = DXF.exportDrawingIR(drawing);
  const entities = entityRecords(result.dxf);

  const deviceEntity = entities.find((entity) => xdataFields(entity).equipmentId === 'EQ-A' &&
    xdataFields(entity).symbolId === device.symbolId && xdataFields(entity).symbolRole === 'function-frame');
  const portEntity = entities.find((entity) => xdataFields(entity).primitiveId === 'PORT:EQ-A:CAN');
  const junction = entities.find((entity) => xdataFields(entity).markerType === 'junction');
  const bridge = entities.find((entity) => xdataFields(entity).markerType === 'bridge');
  assert.ok(deviceEntity);
  assert.equal(xdataFields(deviceEntity).equipmentId, 'EQ-A');
  assert.equal(xdataFields(deviceEntity).symbolId, device.symbolId);
  assert.ok(portEntity);
  assert.equal(xdataFields(portEntity).endpointRef, 'EQ-A:CAN');
  assert.equal(junction.type, 'CIRCLE');
  assert.equal(junction.pairs.find((pair) => pair.code === 8).value, 'EVSE-MARKER');
  assert.equal(bridge.type, 'ARC');
  assert.equal(bridge.pairs.find((pair) => pair.code === 8).value, 'EVSE-MARKER');
  assert.ok(['horizontal', 'vertical'].includes(xdataFields(bridge).bridgeOrientation));
  assert.ok(xdataFields(bridge).bridgeRouteId);
  assert.equal(result.stats.routes, 4);
  assert.equal(result.stats.markers, 2);
});

test('direct exporter rejects unsupported, invalid, or internally inconsistent Drawing IR', () => {
  const drawing = crossingDrawing();
  assert.throws(
    () => DXF.exportDrawingIR(Object.assign({}, drawing, { schema: 'unknown/v1' })),
    (error) => error.code === 'DRAWING_IR_SCHEMA_UNSUPPORTED'
  );
  assert.throws(
    () => DXF.exportDrawingIR(Object.assign({}, drawing, { violations: [{ code: 'TEST' }] })),
    (error) => error.code === 'DRAWING_IR_GEOMETRY_BLOCKED'
  );
  assert.throws(
    () => DXF.exportDrawingIR(Object.assign({}, drawing, { coverage: { ok: false, errors: [{ code: 'TEST' }] } })),
    (error) => error.code === 'DRAWING_IR_COVERAGE_BLOCKED'
  );

  const primitives = drawing.primitives.map((primitive) => primitive.routeId === 'R-H-J'
    ? Object.assign({}, primitive, { points: [{ x: 0, y: 20 }, { x: 99, y: 20 }] })
    : primitive);
  assert.throws(
    () => DXF.exportDrawingIR(Object.assign({}, drawing, { primitives })),
    (error) => error.code === 'DRAWING_IR_ROUTE_PRIMITIVE_MISMATCH'
  );
  assert.doesNotThrow(() => DXF.exportDrawingIR(Object.assign({}, drawing, {
    violations: [{ code: 'DIAGNOSTIC_ONLY' }]
  }), { allowInvalid: true }));
});

test('XDATA values are newline-safe ASCII chunks no longer than 255 bytes', () => {
  const longId = '设备'.repeat(180);
  const device = IR.createPlacedDevice({ id: longId, bbox: { x: 0, y: 0, width: 10, height: 10 } });
  const drawing = IR.buildDrawingIR({ devices: [device] });
  const result = DXF.exportDrawingIR(drawing);
  const groups = dxfPairs(result.dxf).filter((pair) => pair.code === 1000);
  assert.ok(groups.length > 2, 'long trace values should be split over multiple XDATA groups');
  groups.forEach((pair) => {
    assert.match(pair.value, /^[\x20-\x7e]+$/);
    assert.ok(Buffer.byteLength(pair.value, 'utf8') <= 255);
    assert.ok(!/[\r\n]/.test(pair.value));
  });
});

test('legacy SVG compatibility entry is explicitly identified in warnings', () => {
  const previous = global.DOMParser;
  global.DOMParser = require('../scripts/minidom.js').DOMParser;
  try {
    const metadata = JSON.stringify({ drawingNo: 'LEGACY-1', revision: 'P01' });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm" ' +
      'data-drawing-skill="EVSE" data-drawing-skill-version="1" data-drawing-profile="TEST" ' +
      'data-drawing-skill-status="ACTIVE" data-drawing-audit-status="CHECKED">' +
      '<metadata>' + metadata + '</metadata><line x1="0" y1="0" x2="10" y2="10"/></svg>';
    const result = DXF.exportSvgLegacy(svg);
    assert.ok(result.warnings.some((warning) => warning.includes('LEGACY_SVG_PARSE')));
    assert.equal(result.manifest.schema, DXF.LEGACY_MANIFEST_SCHEMA);
  } finally {
    if (previous === undefined) delete global.DOMParser;
    else global.DOMParser = previous;
  }
});
