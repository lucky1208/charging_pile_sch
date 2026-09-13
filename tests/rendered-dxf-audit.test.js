'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IR = require('../engine/drawing-ir.js');
const DXF = require('../engine/dxf-export.js');
const AUDIT = require('../engine/rendered-dxf-audit.js');

function endpoint(deviceId, portId, x, y) {
  return { ref: deviceId + ':' + portId, deviceId, portId, x, y };
}
function route(id, netId, circuitId, source, target, layer) {
  return IR.routeOrthogonal({ id, netId, circuitId, source, target,
    points: [{ x: source.x, y: source.y }, { x: target.x, y: target.y }], layer });
}
function drawing() {
  return IR.buildDrawingIR({ routes: [
    route('R-H', 'N-H', 'C-H', endpoint('A', 'P', 0, 20), endpoint('B', 'P', 100, 20), 'EVSE-DC'),
    route('R-V', 'N-V', 'C-V', endpoint('C', 'P', 50, 0), endpoint('D', 'P', 50, 40), 'EVSE-COMM')
  ] });
}

function entityLinetype(entity) {
  const pair = entity && entity.pairs.find((candidate) => candidate.code === 6);
  return pair && pair.value;
}

function mutatePrimitiveLinetype(dxf, primitiveId, linetype) {
  const pairs = AUDIT.parsePairs(dxf).map((pair) => ({ code: pair.code, value: pair.value }));
  const encoded = encodeURIComponent(primitiveId);
  const traceIndex = pairs.findIndex((pair) => pair.code === 1000 && pair.value === 'primitiveId=' + encoded);
  assert.ok(traceIndex >= 0, primitiveId + ' XDATA must be present');
  let entityStart = traceIndex;
  while (entityStart >= 0 && pairs[entityStart].code !== 0) entityStart -= 1;
  assert.ok(entityStart >= 0, primitiveId + ' entity boundary must be present');
  const styleIndex = pairs.findIndex((pair, index) =>
    index > entityStart && index < traceIndex && pair.code === 6);
  assert.ok(styleIndex > entityStart, primitiveId + ' entity must declare a linetype');
  pairs[styleIndex].value = linetype;
  return pairs.map((pair) => String(pair.code) + '\n' + pair.value + '\n').join('');
}

test('independent DXF parser reconciles final entity geometry and XDATA to Drawing IR', () => {
  const ir = drawing();
  const exported = DXF.exportDrawingIR(ir);
  const report = AUDIT.audit(exported.dxf, ir);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.stats.primitives, ir.primitives.length);
  assert.equal(report.stats.entities, exported.stats.entities);
  const entities = AUDIT.entityRecords(AUDIT.parsePairs(exported.dxf));
  const routeTraces = exported.trace.filter((trace) => trace.routeId);
  assert.equal(routeTraces.length, ir.routes.length);
  routeTraces.forEach((trace) => {
    assert.equal(entityLinetype(entities[trace.entityIndex]), 'CONTINUOUS', trace.routeId);
  });
  const communicationTrace = routeTraces.find((trace) => trace.routeId === 'R-V');
  assert.ok(communicationTrace, 'fixture must export the EVSE-COMM route');
  const communicationEntity = entities[communicationTrace.entityIndex];
  assert.equal(communicationEntity.pairs.find((pair) => pair.code === 8).value, 'EVSE-COMM');
  assert.equal(entityLinetype(communicationEntity), 'CONTINUOUS',
    'the final EVSE-COMM route entity must carry DXF group code 6 CONTINUOUS');
});

test('DXF readback blocks a route entity whose linetype is changed to DASHED', () => {
  const ir = drawing();
  const dxf = DXF.exportDrawingIR(ir).dxf;
  const dashed = mutatePrimitiveLinetype(dxf, 'ROUTE:R-V', 'DASHED');
  const report = AUDIT.audit(dashed, ir);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) =>
    error.code === 'DXF_ELECTRICAL_CONDUCTOR_DASHED' && error.id === 'ROUTE:R-V'));
});

test('coordinate and trace-identity mutations fail even when exporter statistics are unavailable', () => {
  const ir = drawing();
  const dxf = DXF.exportDrawingIR(ir).dxf;
  const coordinateMutation = dxf.replace(/(\n10\n)0(\n20\n20\n)/, '$199$2');
  const coordinateReport = AUDIT.audit(coordinateMutation, ir);
  assert.equal(coordinateReport.ok, false);
  assert.ok(coordinateReport.errors.some((error) => error.code === 'DXF_GEOMETRY'));

  const encoded = encodeURIComponent('ROUTE:R-H');
  assert.ok(dxf.includes('primitiveId=' + encoded));
  const identityMutation = dxf.replace('primitiveId=' + encoded,
    'primitiveId=' + encodeURIComponent('ROUTE:FORGED'));
  const identityReport = AUDIT.audit(identityMutation, ir);
  assert.ok(identityReport.errors.some((error) =>
    error.code === 'DXF_EXTRA_PRIMITIVE' || error.code === 'DXF_MISSING_PRIMITIVE'));
});

test('missing XDATA, injected entities, incomplete pairs and missing EOF fail closed', () => {
  const ir = drawing();
  const dxf = DXF.exportDrawingIR(ir).dxf;
  const missingXdata = dxf.replace('\n1001\nEVSE_IR\n', '\n1001\nFORGED_APP\n');
  assert.ok(AUDIT.audit(missingXdata, ir).errors.some((error) => error.code === 'DXF_XDATA_MISSING'));

  const injected = dxf.replace('\n0\nENDSEC\n0\nEOF\n',
    '\n0\nLINE\n8\nEVSE-DC\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDSEC\n0\nEOF\n');
  assert.ok(AUDIT.audit(injected, ir).errors.some((error) => error.code === 'DXF_XDATA_MISSING'));
  assert.equal(AUDIT.audit(dxf + '10\n', ir).ok, false);
  assert.equal(AUDIT.audit(dxf.replace(/0\nEOF\n$/, ''), ir).ok, false);
});

test('non-identity export transforms are explicitly outside the current readback scope', () => {
  const ir = drawing();
  const dxf = DXF.exportDrawingIR(ir, { scaleX: 2 }).dxf;
  const report = AUDIT.audit(dxf, ir, { scaleX: 2 });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.code === 'DXF_TRANSFORM_SCOPE_UNSUPPORTED'));
});
