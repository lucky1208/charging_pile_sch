'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function load(windowObject, file) {
  const source = fs.readFileSync(path.join(rootDir, 'engine', file), 'utf8');
  new Function('window', 'document', source)(windowObject, {});
}

function fixture() {
  const terminal = (id, netClass, domain, direction, label) => ({
    id, label: label || id, netClass, domain, direction, required: true
  });
  const instances = [
    { id: 'SRC', kind: 'charge-controller', system: 'control', name: '充电控制单元 A1',
      referenceDesignation: 'EVSE-CTL-A1', terminals: [
        terminal('OUT1', 'SIGNAL_CTRL', 'CONTROL', 'out'),
        terminal('OUT2', 'SIGNAL_CTRL', 'CONTROL', 'out')
      ] },
    { id: 'LOCK1', kind: 'connector-lock', system: 'gun', name: '电子锁 1',
      referenceDesignation: 'EVSE-G1-YV1', terminals: [terminal('DRIVE', 'SIGNAL_CTRL', 'CONTROL', 'in')] },
    { id: 'LOCK2', kind: 'connector-lock', system: 'gun', name: '电子锁 2',
      referenceDesignation: 'EVSE-G2-YV2', terminals: [terminal('DRIVE', 'SIGNAL_CTRL', 'CONTROL', 'in')] }
  ];
  return {
    schemaVersion: '4.0.0',
    project: { name: 'IR Pipeline Test' },
    instances,
    equipment: instances,
    nets: [
      { id: 'N1', netClass: 'SIGNAL_CTRL', domain: 'CONTROL', members: [
        { instanceId: 'SRC', terminalId: 'OUT1' }, { instanceId: 'LOCK1', terminalId: 'DRIVE' }
      ] },
      { id: 'N2', netClass: 'SIGNAL_CTRL', domain: 'CONTROL', members: [
        { instanceId: 'SRC', terminalId: 'OUT2' }, { instanceId: 'LOCK2', terminalId: 'DRIVE' }
      ] }
    ],
    circuits: [
      { id: 'C1', netId: 'N1', from: 'SRC', fromPort: 'OUT1', to: 'LOCK1', toPort: 'DRIVE',
        netClass: 'SIGNAL_CTRL', domain: 'CONTROL', kind: 'signal', direction: 'from-to', protocol: 'DRY' },
      { id: 'C2', netId: 'N2', from: 'SRC', fromPort: 'OUT2', to: 'LOCK2', toPort: 'DRIVE',
        netClass: 'SIGNAL_CTRL', domain: 'CONTROL', kind: 'signal', direction: 'from-to', protocol: 'DRY' }
    ],
    documentControl: { page: { current: 1, total: 1 }, drawingRegister: [] }
  };
}

function runtime() {
  const win = {};
  [
    'color-scheme.js', 'symbols.js', 'iec-symbol-catalog.js', 'drawing-ir.js', 'schematic-placement.js',
    'svg-ir-renderer.js', 'draw-pile.js'
  ].forEach((file) => load(win, file));
  return win;
}

test('drawPile compiles exact design collections and SVG carries trace attributes', () => {
  const win = runtime();
  const R = { design: fixture(), inputs: { designer: 'TEST', watermarkText: '' }, pileName: 'IR Test' };
  const svg = win.drawPile(R);
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /data-ir-schema="evse-drawing-ir\/v1"/);
  assert.match(svg, /data-coverage-status="PASS"/);
  assert.match(svg, /data-equipment="SRC"/);
  assert.match(svg, /data-net="N1"/);
  assert.match(svg, /data-circuit="C1"/);
  assert.match(svg, /data-layer="EVSE-CTL"/);
  assert.match(svg, /stroke-dasharray="8 4"/);
  const routeSegmentCount = R.drawingIR.routes.reduce((sum, route) => sum + route.segments.length, 0);
  assert.equal((svg.match(/data-editor-hit-target="true"/g) || []).length, routeSegmentCount,
    'every orthogonal segment has one non-scaling editor hit target');
  assert.match(svg, /class="editor-route-hit-target"[^>]*stroke="transparent"[^>]*stroke-width="12"[^>]*pointer-events="stroke"[^>]*vector-effect="non-scaling-stroke"/);
  assert.match(svg, /<g id="ROUTE-C1"[^>]*role="button"[^>]*tabindex="0"[^>]*aria-label="导线 C1，SRC:OUT1 到 LOCK1:DRIVE"/);
  assert.equal(R.drawingIR.coverage.ok, true);
  const declaredLayers = new Set(R.drawingIR.layers.map((layer) => layer.id));
  R.drawingIR.routes.forEach((route) => assert.ok(declaredLayers.has(route.layer), 'route layer is declared: ' + route.layer));
  assert.ok(declaredLayers.has('EVSE-ESS'), 'ESS layer is declared even when the current page does not use it');
  assert.equal(R.drawingIR.routes.length, R.design.circuits.length);
  assert.equal(R.drawingGeometryHash, win.EVSE_DRAWING_IR.drawingIRHash(R.drawingIR));
  R.design.circuits.forEach((circuit) => {
    const route = R.drawingIR.routes.find((item) => item.circuitId === circuit.id);
    assert.ok(route);
    assert.deepEqual([route.source.ref, route.target.ref].sort(),
      [circuit.from + ':' + circuit.fromPort, circuit.to + ':' + circuit.toPort].sort());
  });
});

test('draw-pile integration contains no scalar-topology or naked-wire fallback', () => {
  const source = fs.readFileSync(path.join(rootDir, 'engine', 'draw-pile.js'), 'utf8');
  assert.doesNotMatch(source, /R\.(?:ac|dc|guns|ess|aux)\b/);
  assert.doesNotMatch(source, /\.wire\s*\(/);
  assert.match(source, /placement\.compile\(R\.design\)/);
  assert.match(source, /renderer\.render\(compiled, R\)/);
});

test('coverage mutation fails closed before SVG rendering', () => {
  const win = runtime();
  const design = fixture();
  design.nets[0].members[1].terminalId = 'WRONG';
  assert.throws(() => win.drawPile({ design, inputs: {} }), (error) =>
    error && (error.code === 'SCHEMATIC_GEOMETRY_BLOCKED' || error.code === 'SCHEMATIC_MODEL_INCOMPLETE'));
});
