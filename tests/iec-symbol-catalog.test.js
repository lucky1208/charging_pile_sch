'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const CATALOG = require('../engine/iec-symbol-catalog.js');
const IR = require('../engine/drawing-ir.js');
const DXF = require('../engine/dxf-export.js');
const VISUAL = require('../engine/visual-quality-audit.js');

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

function primitiveBounds(primitive) {
  if (primitive.kind === 'line') {
    return {
      xMin: Math.min(primitive.x1, primitive.x2), yMin: Math.min(primitive.y1, primitive.y2),
      xMax: Math.max(primitive.x1, primitive.x2), yMax: Math.max(primitive.y1, primitive.y2)
    };
  }
  if (primitive.kind === 'polyline') {
    const xs = primitive.points.map((point) => point.x);
    const ys = primitive.points.map((point) => point.y);
    return {
      xMin: Math.min(...xs), yMin: Math.min(...ys),
      xMax: Math.max(...xs), yMax: Math.max(...ys)
    };
  }
  if (primitive.kind === 'circle') {
    const x = primitive.x == null ? primitive.cx : primitive.x;
    const y = primitive.y == null ? primitive.cy : primitive.y;
    const radius = primitive.radius == null ? primitive.r : primitive.radius;
    return { xMin: x - radius, yMin: y - radius, xMax: x + radius, yMax: y + radius };
  }
  throw new Error('Unsupported connector primitive in test: ' + primitive.kind);
}

function boxesHaveClearance(left, right, clearance) {
  return left.xMax + clearance <= right.xMin || right.xMax + clearance <= left.xMin ||
    left.yMax + clearance <= right.yMin || right.yMax + clearance <= left.yMin;
}

function assertOffPageLabelsClear(primitives, expectedLabels, message) {
  const labels = primitives.filter((primitive) => primitive.symbolRole === 'terminal-label');
  const connectionSymbols = primitives.filter((primitive) =>
    /^(?:off-page-(?:incoming|outgoing)-(?:lead|arrow)|off-page-terminal)$/.test(primitive.symbolRole || ''));
  assert.equal(labels.length, expectedLabels, message + ' label count');
  assert.equal(connectionSymbols.length, expectedLabels * 3, message + ' connection-symbol count');
  labels.forEach((label) => {
    const labelBounds = VISUAL.textBounds(label);
    assert.ok(labelBounds, message + ' ' + label.id + ' must have measurable text bounds');
    connectionSymbols.forEach((symbol) => {
      assert.ok(boxesHaveClearance(labelBounds, primitiveBounds(symbol), 2),
        message + ' ' + label.id + ' overlaps ' + symbol.id + ' (' + symbol.symbolRole + ')');
    });
  });
}

test('all controlled device classes have explicit non-fallback IEC symbol mappings', () => {
  const controlledKinds = catalogDeviceKinds();
  assert.deepEqual(CATALOG.CONTROLLED_DEVICE_KINDS, controlledKinds);
  assert.equal(controlledKinds.length, 66);
  controlledKinds.forEach((kind) => {
    const resolved = CATALOG.resolve(kind);
    assert.equal(resolved.fallback, false, kind);
    assert.notEqual(resolved.symbolId, CATALOG.FALLBACK_SYMBOL_ID, kind);
    assert.ok(resolved.definition.iecReferences.every((reference) => /^IEC-60617-\d{4}$/.test(reference)), kind);
  });
  assert.equal(CATALOG.assertCurrentCoverage(controlledKinds), true);
});

test('off-page symbols are explicit non-authoritative graphical projection kinds', () => {
  assert.deepEqual(CATALOG.GRAPHICAL_PROJECTION_KINDS, [
    'off-page-connector-incoming', 'off-page-connector-outgoing'
  ]);
  CATALOG.GRAPHICAL_PROJECTION_KINDS.forEach((kind) => {
    assert.equal(catalogDeviceKinds().includes(kind), false, kind);
    const resolved = CATALOG.resolve(kind);
    assert.equal(resolved.fallback, false, kind);
    assert.ok(resolved.definition.iecReferences.includes('IEC-61082-1'), kind);
  });
});

test('off-page PIN labels reserve clearance from every continuation lead, arrow and terminal', () => {
  ['off-page-connector-incoming', 'off-page-connector-outgoing'].forEach((kind) => {
    ['LEFT', 'RIGHT'].forEach((side) => {
      const x = side === 'LEFT' ? 0 : 240;
      const ports = [
        { id: 'X01@CCT-0001', terminalId: 'X01', label: '→p6 S06 EQ-CTL-A1:AI_DC_CURRENT_P',
          x, y: 26, side, netClass: 'SIGNAL_CTRL', domain: 'CONTROL' },
        { id: 'X02@CCT-0002', terminalId: 'X02', label: '→p6 S06 EQ-CTL-A1:DI_IMD_N',
          x, y: 54, side, netClass: 'SIGNAL_CTRL', domain: 'CONTROL' }
      ];
      const symbol = CATALOG.instantiate({
        kind, tag: side, bbox: { x: 0, y: 0, width: 240, height: 80 }, ports
      });
      assertOffPageLabelsClear(symbol.primitives, ports.length, kind + ' ' + side);
      assert.equal(symbol.primitives.some((primitive) =>
        primitive.symbolRole === 'device-title' || primitive.symbolRole === 'off-page-direction'), false,
      kind + ' ' + side + ' must not add a title/footer into the terminal-row area');
      symbol.primitives.filter((primitive) =>
        primitive.symbolRole === 'terminal-label' || /off-page-/.test(primitive.symbolRole || ''))
        .forEach((primitive) => assert.ok(primitive.connectorRowId,
          kind + ' ' + side + ' every row primitive must trace its exact connector row'));
    });
  });
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

test('contactor graphical appearances never invent absent main, coil or feedback terminals', () => {
  const make = (ports) => CATALOG.instantiate({
    kind: 'dc-contactor', tag: 'KM1', bbox: { x: 0, y: 0, width: 120, height: 80 }, ports
  }).primitives;
  const port = (terminalId, x, y, netClass, domain, polarity) => ({
    id: terminalId + '@C1', terminalId, label: terminalId, x, y,
    side: x === 0 ? 'LEFT' : 'RIGHT', netClass, domain, polarity
  });

  const mainOnly = make([
    port('IN_P', 0, 32, 'POWER_DC', 'HV_DC_CHARGE', 'POSITIVE'),
    port('OUT_P', 120, 32, 'POWER_DC', 'HV_DC_CHARGE', 'POSITIVE')
  ]);
  assert.ok(mainOnly.some((primitive) => primitive.symbolRole === 'moving-contact'));
  assert.ok(!mainOnly.some((primitive) => primitive.symbolRole === 'contactor-coil'));
  assert.ok(!mainOnly.some((primitive) => /feedback/.test(primitive.symbolRole || '')));
  assert.ok(!mainOnly.some((primitive) => primitive.kind === 'text' && /A1|A2/.test(primitive.text || '')));

  const coilOnly = make([
    port('COIL_V24', 0, 30, 'POWER_DC_AUX', 'AUX_24V', 'POSITIVE'),
    port('COIL_V24_0V', 120, 50, 'POWER_DC_AUX', 'AUX_24V', 'RETURN')
  ]);
  assert.ok(coilOnly.some((primitive) => primitive.symbolRole === 'contactor-coil'));
  assert.ok(!coilOnly.some((primitive) => primitive.symbolRole === 'moving-contact'));
  assert.ok(!coilOnly.some((primitive) => /auxiliary-moving-contact/.test(primitive.symbolRole || '')));

  const feedbackOnly = make([
    port('FEEDBACK', 120, 40, 'SIGNAL_CTRL', 'CONTROL', 'SENSE')
  ]);
  assert.ok(feedbackOnly.some((primitive) => primitive.symbolRole === 'feedback-interface'));
  assert.ok(feedbackOnly.some((primitive) => primitive.symbolRole === 'feedback-interface-label' && primitive.text === 'FB'));
  assert.ok(!feedbackOnly.some((primitive) => primitive.symbolRole === 'auxiliary-moving-contact'));
  assert.ok(!feedbackOnly.some((primitive) => primitive.symbolRole === 'contactor-coil'));
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
