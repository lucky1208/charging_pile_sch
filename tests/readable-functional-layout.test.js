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

function buildAndDraw(win) {
  const input = Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'FUNCTIONAL-LAYOUT-TEST', standard: 'gb', archetype: 'dc-integrated',
    outputKw: 120, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
    acVoltage: 380, voltageWindow: '200-1000', thermal: 'air',
    essEnabled: false, requirementConfirmed: true
  });
  const result = win.EVSE_ENGINE.build(input);
  const svg = win.drawPile(result);
  return { result, svg };
}

function buildNacsMobileAndDraw(win) {
  const input = Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'NACS-LOGICAL-PROXY-LAYOUT-TEST', standard: 'nacs', archetype: 'ess-mobile',
    outputKw: 60, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
    supplyMode: 'offgrid', thermal: 'liquid', essEnabled: true,
    essKwh: 200, essPowerKw: 120, essCoupling: 'dc',
    acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES.nacs,
    voltageWindow: '200-1000', requirementConfirmed: true
  });
  const result = win.EVSE_ENGINE.build(input);
  const svg = win.drawPile(result);
  return { result, svg };
}

function rootAttribute(svg, name) {
  const root = /^<svg\b([^>]*)>/.exec(svg);
  assert.ok(root, 'complete SVG root');
  const match = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([^"]*)"').exec(root[1]);
  return match ? match[1] : '';
}

test('new archetype device kinds have explicit native symbols, including a dual-winding transformer', () => {
  const catalog = require('../engine/iec-symbol-catalog.js');
  const kinds = [
    'split-interface', 'ac-charge-connector', 'dc-charge-inlet', 'dc-dc-charge-module',
    'hv-aux-converter', 'aux-dc-converter', 'interface-12v-supply', 'four-pole-safety',
    'battery-heater', 'ac-ev-transformer',
    'battery-box', 'touch-display', 'card-reader', 'voice-board', 'loudspeaker',
    'selector-switch-dual', 'external-connector-12pin', 'control-relay', 'temperature-sensor',
    'ac-dc-mode-interlock', 'heating-connector-2pin', 'rf-antenna',
    'nacs-shared-inlet', 'ac-dc-power-selector'
  ];
  kinds.forEach((kind) => {
    const resolved = catalog.resolve(kind);
    assert.equal(resolved.fallback, false, kind);
    assert.notEqual(resolved.symbolId, catalog.FALLBACK_SYMBOL_ID, kind);
  });
  const transformer = catalog.instantiate({
    kind: 'ac-ev-transformer', tag: 'T-EV', bbox: { x: 0, y: 0, width: 160, height: 90 },
    ports: [
      { id: 'PRI', terminalId: 'PRI', x: 0, y: 45, side: 'LEFT', netClass: 'POWER_AC', domain: 'AC_MAINS' },
      { id: 'SEC', terminalId: 'SEC', x: 160, y: 45, side: 'RIGHT', netClass: 'POWER_AC', domain: 'AC_MAINS' }
    ]
  });
  assert.ok(transformer.primitives.some((primitive) => primitive.symbolRole === 'primary-winding'));
  assert.ok(transformer.primitives.some((primitive) => primitive.symbolRole === 'secondary-winding'));
  assert.ok(transformer.primitives.filter((primitive) => primitive.symbolRole === 'magnetic-core').length >= 2);
  assert.ok(!transformer.primitives.some((primitive) => primitive.symbolRole === 'function-frame'));

  const instantiate = (kind, ports) => catalog.instantiate({
    kind, tag: kind, bbox: { x: 0, y: 0, width: 180, height: 120 }, ports: ports || [
      { id: 'A', terminalId: 'A', x: 0, y: 50, side: 'LEFT', netClass: 'SIGNAL_CTRL', domain: 'CONTROL' },
      { id: 'B', terminalId: 'B', x: 180, y: 70, side: 'RIGHT', netClass: 'SIGNAL_CTRL', domain: 'CONTROL' }
    ]
  }).primitives;
  assert.ok(instantiate('battery-box').some((primitive) => primitive.symbolRole === 'battery-positive-plate'));
  ['touch-display', 'card-reader', 'voice-board'].forEach((kind) => {
    assert.ok(instantiate(kind).some((primitive) => primitive.symbolRole === 'function-frame'), kind);
    assert.ok(instantiate(kind).some((primitive) => primitive.symbolRole === 'function-code'), kind);
  });
  const speaker = instantiate('loudspeaker');
  assert.ok(speaker.some((primitive) => primitive.symbolRole === 'speaker-cone'));
  assert.ok(speaker.filter((primitive) => primitive.symbolRole === 'acoustic-wave').length >= 2);
  assert.ok(!speaker.some((primitive) => primitive.symbolRole === 'function-frame'));

  const selectorPorts = [
    ['XS_5', 0, 42, 'LEFT'], ['XS_20', 180, 42, 'RIGHT'],
    ['TX_ENABLE', 0, 78, 'LEFT'], ['TX_GND', 180, 78, 'RIGHT']
  ].map((item) => ({ id: item[0], terminalId: item[0], x: item[1], y: item[2], side: item[3],
    netClass: 'SIGNAL_CTRL', domain: 'CONTROL' }));
  const selector = instantiate('selector-switch-dual', selectorPorts);
  assert.equal(selector.filter((primitive) => primitive.symbolRole === 'neutral-contact').length, 2);
  assert.ok(selector.some((primitive) => primitive.symbolRole === 'mechanical-linkage'));
  assert.ok(!selector.some((primitive) => primitive.symbolRole === 'function-frame'));

  const connectorPorts = Array.from({ length: 12 }, (_, index) => ({
    id: 'P' + String(index + 1).padStart(2, '0'), terminalId: 'P' + String(index + 1).padStart(2, '0'),
    x: index < 6 ? 0 : 180, y: 20 + (index % 6) * 16,
    side: index < 6 ? 'LEFT' : 'RIGHT', netClass: 'SIGNAL_CTRL', domain: 'CONTROL'
  }));
  const external = instantiate('external-connector-12pin', connectorPorts);
  assert.equal(external.filter((primitive) => primitive.symbolRole === 'connector-pin').length, 12);
  assert.equal(external.filter((primitive) => primitive.symbolRole === 'pin-number').length, 12);

  const relayPorts = [
    ['COIL_POS', 0, 78, 'LEFT'], ['COIL_NEG', 180, 78, 'RIGHT'],
    ['CONTACT_IN', 0, 40, 'LEFT'], ['CONTACT_OUT', 180, 40, 'RIGHT']
  ].map((item) => ({ id: item[0], terminalId: item[0], x: item[1], y: item[2], side: item[3],
    netClass: 'POWER_DC_AUX', domain: 'AUX_24V' }));
  const relay = instantiate('control-relay', relayPorts);
  assert.ok(relay.some((primitive) => primitive.symbolRole === 'relay-coil'));
  assert.ok(relay.some((primitive) => primitive.symbolRole === 'neutral-contact'));
  assert.ok(relay.some((primitive) => primitive.symbolRole === 'mechanical-linkage'));
  const temperature = instantiate('temperature-sensor');
  assert.ok(temperature.some((primitive) => primitive.symbolRole === 'temperature-sensor-body'));
  assert.ok(temperature.some((primitive) => primitive.symbolRole === 'temperature-function' && primitive.text === 'ϑ'));
  const modeInterlock = instantiate('ac-dc-mode-interlock');
  assert.ok(modeInterlock.some((primitive) => primitive.symbolRole === 'function-frame'));
  assert.ok(modeInterlock.some((primitive) => primitive.symbolRole === 'one-hot-function' && primitive.text === '=1'));
  assert.equal(modeInterlock.filter((primitive) => primitive.symbolRole === 'neutral-contact').length, 2);
  assert.ok(modeInterlock.some((primitive) => primitive.symbolRole === 'mutual-exclusion-link'));

  const heaterPorts = [
    ['PANEL_H02', 0, 40, 'LEFT'], ['BATTERY_H02', 180, 40, 'RIGHT'],
    ['PANEL_H05', 0, 80, 'LEFT'], ['BATTERY_H05', 180, 80, 'RIGHT']
  ].map((item) => ({ id: item[0], terminalId: item[0], x: item[1], y: item[2], side: item[3],
    netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS' }));
  const heaterConnector = instantiate('heating-connector-2pin', heaterPorts);
  assert.equal(heaterConnector.filter((primitive) => primitive.symbolRole === 'connector-pole').length, 2);
  assert.equal(heaterConnector.filter((primitive) => primitive.symbolRole === 'connector-socket').length, 2);
  assert.equal(heaterConnector.filter((primitive) => primitive.symbolRole === 'connector-plug').length, 2);
  assert.ok(!heaterConnector.some((primitive) => primitive.symbolRole === 'function-frame'));

  const antenna = instantiate('rf-antenna', [
    { id: 'RF', terminalId: 'RF', x: 0, y: 85, side: 'LEFT', netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION' }
  ]);
  assert.ok(antenna.some((primitive) => primitive.symbolRole === 'antenna-mast'));
  assert.ok(antenna.filter((primitive) => primitive.symbolRole === 'antenna-element').length >= 2);
  assert.ok(antenna.filter((primitive) => primitive.symbolRole === 'rf-wave').length >= 3);
  assert.ok(!antenna.some((primitive) => primitive.symbolRole === 'function-frame'));

  const nacsPorts = [
    ['PWR_A', 0, 35, 'LEFT'], ['PWR_B', 0, 55, 'LEFT'],
    ['CP', 180, 35, 'RIGHT'], ['PP', 180, 55, 'RIGHT'], ['PE', 180, 80, 'RIGHT']
  ].map((item) => ({ id: item[0], terminalId: item[0], x: item[1], y: item[2], side: item[3],
    netClass: item[0].startsWith('PWR') ? 'POWER_INTERFACE_MODED' : 'SIGNAL_CTRL', domain: 'CONTROL' }));
  const nacsInlet = instantiate('nacs-shared-inlet', nacsPorts);
  assert.equal(nacsInlet.filter((primitive) => primitive.symbolRole === 'connector-pin').length, 5);
  assert.ok(nacsInlet.some((primitive) => primitive.symbolRole === 'connector-shell'));
  assert.ok(!nacsInlet.some((primitive) => primitive.symbolRole === 'function-frame'));

  const powerSelectorPorts = [
    ['COMMON_A', 0, 38, 'LEFT'], ['AC_L1', 180, 28, 'RIGHT'], ['DC_POS', 180, 48, 'RIGHT'],
    ['COMMON_B', 0, 82, 'LEFT'], ['AC_L2', 180, 72, 'RIGHT'], ['DC_NEG', 180, 92, 'RIGHT']
  ].map((item) => ({ id: item[0], terminalId: item[0], x: item[1], y: item[2], side: item[3],
    netClass: item[0].startsWith('AC_') ? 'POWER_AC' : 'POWER_DC_ESS', domain: 'INTERFACE_POWER_MODED' }));
  const powerSelector = instantiate('ac-dc-power-selector', powerSelectorPorts);
  assert.equal(powerSelector.filter((primitive) => primitive.symbolRole === 'selector-common').length, 2);
  assert.equal(powerSelector.filter((primitive) => primitive.symbolRole === 'ac-throw').length, 2);
  assert.equal(powerSelector.filter((primitive) => primitive.symbolRole === 'dc-throw').length, 2);
  assert.equal(powerSelector.filter((primitive) => primitive.symbolRole === 'selector-neutral-blade').length, 2);
  assert.ok(powerSelector.some((primitive) => primitive.symbolRole === 'mechanical-linkage'));
  assert.ok(!powerSelector.some((primitive) => primitive.symbolRole === 'function-frame'));
});

test('functional zoning follows electrical flow and preserves readable fixed-scale metrics', () => {
  const win = runtime();
  const { result, svg } = buildAndDraw(win);
  const plan = result.drawingPlan;
  const ir = result.drawingIR;
  assert.equal(ir.coverage.ok, true);
  assert.deepEqual(ir.violations, []);
  assert.deepEqual(plan.zones.map((zone) => zone.id),
    ['POWER_FLOW', 'AUXILIARY', 'CONTROL_COMM', 'PROTECTIVE_EARTH']);
  assert.equal(ir.annotations.length, plan.zones.length * 2);
  plan.zones.forEach((zone) => {
    assert.match(svg, new RegExp('data-primitive="ZONE:' + zone.id + ':TITLE"'));
    assert.ok(zone.deviceCount > 0);
  });

  const xOf = (id) => ir.devices.find((device) => device.id === id).bbox.xMin;
  assert.ok(xOf('EQ-AC-IN') < xOf('EQ-PM'), 'AC input must precede power conversion');
  assert.ok(xOf('EQ-PM') < xOf('EQ-G1-XS'), 'power conversion must precede EV connector');

  ir.devices.forEach((device) => ['LEFT', 'RIGHT'].forEach((side) => {
    const ys = Array.from(new Set(device.ports.filter((port) => port.side === side).map((port) => port.y))).sort((a, b) => a - b);
    for (let index = 1; index < ys.length; index += 1) {
      assert.ok(ys[index] - ys[index - 1] >= plan.readability.terminalPitchMin - 0.01,
        device.id + ' ' + side + ' terminal pitch');
    }
  }));
  const symbolText = ir.primitives.filter((primitive) => primitive.equipmentId && primitive.kind === 'text');
  assert.ok(symbolText.length > 0);
  assert.ok(symbolText.every((primitive) => Number(primitive.height) >= plan.readability.symbolTextHeightMin));
  assert.equal(plan.readability.routeLanePitchMin, 12);
  assert.ok(plan.verticalGapWidths.every((width) => width >= plan.readability.horizontalDeviceGapMin));

  const sheet = plan.sheet;
  assert.equal(sheet.scale, '1:4');
  assert.equal(sheet.canvasWidth / sheet.widthMm, 4);
  assert.equal(sheet.canvasHeight / sheet.heightMm, 4);
  assert.equal(rootAttribute(svg, 'width'), sheet.widthMm + 'mm');
  assert.equal(rootAttribute(svg, 'height'), sheet.heightMm + 'mm');
  assert.equal(rootAttribute(svg, 'viewBox'), '0 0 ' + sheet.canvasWidth + ' ' + sheet.canvasHeight);
  assert.equal(rootAttribute(svg, 'data-sheet-format-actual'), sheet.format);
  assert.equal(rootAttribute(svg, 'data-plot-scale'), '1:4');

  const audit = win.EVSE_DRAWING_SKILL.auditMarkup(svg, win.EVSE_DRAWING_SKILL.DRAWING_KEY, result);
  assert.equal(audit.blockingCount, 0,
    audit.checks.filter((item) => !item.ok).map((item) => item.code + ':' + item.evidence).join(','));

});

test('NACS mobile renders one physical inlet and selector while logical AC/DC slices remain trace-only', () => {
  const win = runtime();
  const { result, svg } = buildNacsMobileAndDraw(win);
  const design = result.design;
  const ir = result.drawingIR;
  const proxyIds = ['EQ-MOB-AC-IN', 'EQ-MOB-DC-IN'];
  const proxyInstances = design.instances.filter((instance) => proxyIds.includes(instance.id));
  assert.equal(proxyInstances.length, 2);
  assert.ok(proxyInstances.every((instance) => instance.logicalOnlyProxy === true));
  assert.ok(proxyInstances.every((instance) => instance.physicalOwnerId === 'EQ-MOB-NACS-IN'));

  const renderedIds = new Set(ir.devices.map((device) => device.id));
  proxyIds.forEach((id) => {
    assert.equal(renderedIds.has(id), false, id + ' must not have a placed device');
    assert.doesNotMatch(svg, new RegExp('<g id="DEVICE-' + id + '"'));
  });
  assert.equal(ir.devices.filter((device) => device.type === 'nacs-shared-inlet').length, 1);
  assert.equal(ir.devices.filter((device) => device.type === 'ac-dc-power-selector').length, 1);
  assert.equal((svg.match(/data-device-kind="nacs-shared-inlet"/g) || []).length, 1);
  assert.equal((svg.match(/data-device-kind="ac-dc-power-selector"/g) || []).length, 1);

  const anchorRefs = new Set(ir.devices.flatMap((device) => device.ports.map((port) => port.ref)));
  const proxyCircuitEndpoints = design.circuits.flatMap((circuit) => [
    { instanceId: circuit.from, terminalId: circuit.fromPort },
    { instanceId: circuit.to, terminalId: circuit.toPort }
  ]).filter((endpoint) => proxyIds.includes(endpoint.instanceId));
  assert.equal(proxyCircuitEndpoints.length, 0,
    'logical aliases are mappings, not physical conductors or DrawingIR routes');
  proxyIds.forEach((id) => assert.ok(!Array.from(anchorRefs).some((ref) => ref.startsWith(id + ':')),
    id + ' must not create a physical DrawingIR anchor'));
  assert.equal(ir.routes.length, design.circuits.length);
  assert.ok(design.circuits.every((circuit) => ir.routes.some((route) =>
    route.circuitId === circuit.id && route.netId === circuit.netId &&
    route.source.ref === circuit.from + ':' + circuit.fromPort &&
    route.target.ref === circuit.to + ':' + circuit.toPort)));
  assert.equal(ir.coverage.ok, true, JSON.stringify(ir.coverage.errors));
  assert.equal(ir.coverage.summary.logicalProxyDevices, 2);
  assert.equal(ir.violations.length, 0, JSON.stringify(ir.violations));
  assert.ok(ir.devices.every((device) => device.symbolFallback === false));

  const dxf = win.EVSE_DXF.exportDrawingIR(ir, { title: 'NACS logical proxy rendering' });
  assert.equal(dxf.stats.routes, design.circuits.length);
  assert.equal(dxf.manifest.source.schema, win.EVSE_DRAWING_IR.SCHEMA);
  assert.ok(!dxf.warnings.includes('LEGACY_SVG_PARSE'));
  const audit = win.EVSE_DRAWING_SKILL.auditMarkup(svg, win.EVSE_DRAWING_SKILL.DRAWING_KEY, result);
  assert.equal(audit.blockingCount, 0,
    audit.checks.filter((item) => !item.ok).map((item) => item.code + ':' + item.evidence).join(','));

  const forgedProxyDevice = svg.replace('</svg>', '<g data-equipment="EQ-MOB-AC-IN"></g></svg>');
  const forgedAudit = win.EVSE_DRAWING_SKILL.auditMarkup(
    forgedProxyDevice, win.EVSE_DRAWING_SKILL.DRAWING_KEY, result);
  const equipmentTrace = forgedAudit.checks.find((item) => item.code === 'G048-EQUIPMENT-TRACE');
  assert.equal(equipmentTrace.ok, false);
  assert.deepEqual(equipmentTrace.evidence.renderedLogicalProxies, ['EQ-MOB-AC-IN']);
});

test('sheet planner promotes A-series sizes before CUSTOM and G001 blocks forged declarations', () => {
  const placement = require('../engine/schematic-placement.js');
  assert.equal(placement.chooseDrawingSheet(1600, 1100).format, 'A3');
  assert.equal(placement.chooseDrawingSheet(2200, 1500).format, 'A2');
  assert.equal(placement.chooseDrawingSheet(3200, 2200).format, 'A1');
  assert.equal(placement.chooseDrawingSheet(4500, 3200).format, 'A0');
  assert.equal(placement.chooseDrawingSheet(5000, 3500).format, 'CUSTOM');

  const win = runtime();
  const { result, svg } = buildAndDraw(win);
  const skill = win.EVSE_DRAWING_SKILL;
  const alteredWidth = svg.replace(/\bwidth="[0-9.]+mm"/, 'width="420mm"');
  const widthAudit = skill.auditMarkup(alteredWidth, skill.DRAWING_KEY, result);
  assert.equal(widthAudit.checks.find((item) => item.code === 'G001-SHEET').ok, false);

  const forgedMetadata = Object.assign({}, result, {
    drawingIR: Object.assign({}, result.drawingIR, {
      metadata: Object.assign({}, result.drawingIR.metadata, {
        sheet: Object.assign({}, result.drawingIR.metadata.sheet, { format: 'A3', widthMm: 420, heightMm: 297 })
      })
    })
  });
  const metadataAudit = skill.auditMarkup(svg, skill.DRAWING_KEY, forgedMetadata);
  assert.equal(metadataAudit.checks.find((item) => item.code === 'G001-SHEET').ok, false);
});
