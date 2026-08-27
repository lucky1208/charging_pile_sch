'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const CATALOG = require('../engine/iec-symbol-catalog.js');
const IR = require('../engine/drawing-ir.js');
const DXF = require('../engine/dxf-export.js');

function catalogDeviceKinds() {
  const windowObject = {};
  const source = fs.readFileSync(path.join(rootDir, 'engine', 'device-catalog.js'), 'utf8');
  new Function('window', source)(windowObject);
  return Object.keys(windowObject.EVSE_DEVICE_CATALOG.DEVICE_CLASSES).sort();
}

function representativePorts(x, y, width, height) {
  return [
    { id: 'IN@C1', terminalId: 'IN', label: 'IN', x, y: y + height * 0.38,
      side: 'LEFT', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE' },
    { id: 'OUT@C1', terminalId: 'OUT', label: 'OUT', x: x + width, y: y + height * 0.38,
      side: 'RIGHT', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE' },
    { id: 'CTRL@C2', terminalId: 'CTRL', label: 'CTRL', x, y: y + height * 0.72,
      side: 'LEFT', netClass: 'SIGNAL_CTRL', domain: 'CONTROL' },
    { id: 'FB@C2', terminalId: 'FB', label: 'FB', x: x + width, y: y + height * 0.72,
      side: 'RIGHT', netClass: 'SIGNAL_CTRL', domain: 'CONTROL' }
  ];
}

test('all controlled device classes have explicit non-fallback IEC symbol mappings', () => {
  const controlledKinds = catalogDeviceKinds();
  assert.deepEqual(CATALOG.CURRENT_DEVICE_KINDS, controlledKinds);
  assert.equal(controlledKinds.length, 66);
  controlledKinds.forEach((kind) => {
    const resolved = CATALOG.resolve(kind);
    assert.equal(resolved.fallback, false, kind);
    assert.notEqual(resolved.symbolId, CATALOG.FALLBACK_SYMBOL_ID, kind);
    assert.ok(resolved.definition.iecReferences.every((reference) => /^IEC-60617-\d{4}$/.test(reference)), kind);
  });
  assert.equal(CATALOG.assertCurrentCoverage(controlledKinds), true);
});

test('catalog emits only native renderer-neutral vector primitives', () => {
  const allowed = new Set(['line', 'polyline', 'circle', 'arc', 'rect', 'text']);
  CATALOG.CURRENT_DEVICE_KINDS.forEach((kind) => {
    const symbol = CATALOG.instantiate({
      kind, tag: kind, bbox: { x: 0, y: 0, width: 120, height: 80 },
      ports: representativePorts(0, 0, 120, 80)
    });
    assert.equal(symbol.fallback, false, kind);
    assert.ok(symbol.primitives.length >= 6, kind);
    assert.ok(symbol.primitives.every((primitive) => allowed.has(primitive.kind)), kind);
    assert.ok(symbol.primitives.every((primitive) => !('href' in primitive) && !('svg' in primitive) && !('image' in primitive)), kind);
    if (symbol.definition.elementary) {
      assert.ok(!symbol.primitives.some((primitive) => primitive.symbolRole === 'function-frame'),
        kind + ' must not be reduced to a framed function block');
    } else {
      assert.ok(symbol.primitives.some((primitive) => primitive.symbolRole === 'function-frame'), kind);
      assert.ok(symbol.primitives.some((primitive) => primitive.symbolRole === 'function-code'), kind);
    }
  });
});

test('representative elementary devices retain recognisable IEC electrical glyphs', () => {
  const instantiate = (kind) => CATALOG.instantiate({
    kind, tag: 'T1', bbox: { x: 0, y: 0, width: 120, height: 80 },
    ports: representativePorts(0, 0, 120, 80)
  }).primitives;
  assert.ok(instantiate('ac-breaker').some((primitive) => primitive.symbolRole === 'moving-contact'));
  assert.ok(instantiate('ac-breaker').some((primitive) => primitive.symbolRole === 'trip-release'));
  assert.ok(instantiate('dc-fuse').some((primitive) => primitive.symbolRole === 'fusible-link'));
  assert.ok(instantiate('precharge-resistor').some((primitive) => primitive.symbolRole === 'resistor-body'));
  assert.ok(instantiate('battery-cluster').some((primitive) => primitive.symbolRole === 'battery-positive-plate'));
  assert.ok(instantiate('earth-bar').filter((primitive) => primitive.symbolRole === 'earth-bar').length >= 3);
  assert.equal(instantiate('indicator-lamp').filter((primitive) => primitive.symbolRole === 'lamp-filament').length, 2);
  assert.ok(instantiate('charge-connector').some((primitive) => primitive.symbolRole === 'connector-pin'));
});

test('unknown future kinds use an explicit meaningful function-block fallback', () => {
  const symbol = CATALOG.instantiate({
    kind: 'future-device', tag: 'X99', bbox: { x: 0, y: 0, width: 120, height: 70 }, ports: []
  });
  assert.equal(symbol.fallback, true);
  assert.equal(symbol.symbolId, CATALOG.FALLBACK_SYMBOL_ID);
  assert.ok(symbol.primitives.some((primitive) => primitive.symbolRole === 'function-frame'));
  assert.ok(symbol.primitives.some((primitive) => primitive.kind === 'text' && primitive.text === 'FUNC'));
});

test('Drawing IR, SVG and DXF consume the same symbol subprimitives with trace identity', () => {
  const devices = CATALOG.CURRENT_DEVICE_KINDS.map((kind, index) => {
    const column = index % 6;
    const row = Math.floor(index / 6);
    const x = column * 150;
    const y = row * 105;
    return IR.createPlacedDevice({
      id: 'EQ-' + String(index + 1).padStart(2, '0'),
      type: kind,
      tag: kind,
      bbox: { x, y, width: 120, height: 80 },
      ports: representativePorts(x, y, 120, 80)
    });
  });
  const drawing = IR.buildDrawingIR({ devices });
  assert.ok(drawing.devices.every((device) => !device.symbolFallback));
  drawing.devices.forEach((device) => {
    const symbolPrimitives = drawing.primitives.filter((primitive) =>
      primitive.equipmentId === device.id && primitive.kind !== 'port');
    assert.ok(symbolPrimitives.length >= 6, device.type);
    assert.ok(symbolPrimitives.every((primitive) => primitive.symbolId === device.symbolId), device.type);
  });

  const dxf = DXF.exportDrawingIR(drawing);
  assert.equal(dxf.stats.primitives, drawing.primitives.length);
  assert.equal(dxf.stats.entities, drawing.primitives.length);
  assert.ok(dxf.trace.some((record) => record.symbolRole === 'moving-contact'));
  assert.ok(dxf.trace.some((record) => record.symbolRole === 'connector-pin'));
  assert.ok(dxf.trace.every((record) => !record.equipmentId || record.symbolId || record.kind === 'port'));

  const windowObject = {};
  ['color-scheme.js', 'symbols.js', 'iec-symbol-catalog.js', 'drawing-ir.js', 'svg-ir-renderer.js']
    .forEach((file) => {
      const source = fs.readFileSync(path.join(rootDir, 'engine', file), 'utf8');
      new Function('window', 'document', source)(windowObject, {});
    });
  const browserDevices = devices.map((device) => windowObject.EVSE_DRAWING_IR.createPlacedDevice({
    id: device.id, type: device.type, tag: device.tag, bbox: device.bbox, ports: device.ports,
    symbolId: device.symbolId, symbolFallback: device.symbolFallback
  }));
  const browserDrawing = windowObject.EVSE_DRAWING_IR.buildDrawingIR({ devices: browserDevices });
  const compiled = {
    drawingIR: browserDrawing,
    plan: { width: 1300, height: 900, schedule: { x: 960, y: 20, width: 300 } },
    instances: CATALOG.CURRENT_DEVICE_KINDS.map((kind, index) => ({ id: 'EQ-' + String(index + 1).padStart(2, '0'), kind })),
    sheets: [{}], circuits: []
  };
  const svg = windowObject.EVSE_SVG_IR_RENDERER.render(compiled, { design: { requirements: {} }, inputs: {} });
  assert.match(svg, /data-symbol="iec\.switch\.circuit-breaker"/);
  assert.match(svg, /data-symbol-role="moving-contact"/);
  assert.match(svg, /data-symbol-role="fuse-element"/);
  assert.match(svg, /data-symbol-role="lamp-filament"/);
  assert.match(svg, /data-symbol-role="function-code"/);
  assert.doesNotMatch(svg, /data-symbol-fallback="true"/);
  assert.doesNotMatch(svg, /(?:base64|<image\b|href=)/i);
});
