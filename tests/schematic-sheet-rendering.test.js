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

const win = runtime();
const SHEETS = win.EVSE_SCHEMATIC_SHEET_RENDERING;

function params(extra) {
  return Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'SHEET-RENDERING-TEST', standard: 'gb', archetype: 'dc-integrated',
    outputKw: 240, moduleKw: 30, gunCount: 4, gunCurrentA: 250,
    acVoltage: 380, voltageWindow: '200-1000', thermal: 'liquid',
    essEnabled: true, essKwh: 260, essPowerKw: 120, essCoupling: 'dc',
    requirementConfirmed: true
  }, extra || {});
}

function result(extra) { return win.EVSE_ENGINE.build(params(extra)); }

test('renders the six functional sheets from one immutable authoritative EDEM', () => {
  const built = result();
  const before = JSON.stringify(built.design);
  const rendered = SHEETS.buildDocument(built);

  assert.equal(JSON.stringify(built.design), before);
  assert.equal(rendered.pages.length, 6);
  assert.equal(rendered.document.sheets.length, 6);
  assert.equal(rendered.status, 'PASS');
  assert.equal(rendered.projectGate.status, 'PASS');
  assert.deepEqual(rendered.pages.map((page) => page.sheetId), ['S01', 'S02', 'S03', 'S04', 'S05', 'S06']);

  rendered.pages.forEach((page, index) => {
    assert.equal(page.pageGate.status, 'PASS', page.sheetId);
    assert.equal(page.pageGate.visualQuality.status, 'PASS', page.sheetId);
    assert.equal(page.pageGate.quality.checks.find((check) =>
      check.code === 'PAGE-Q11-VISUAL-CLEARANCE').ok, true, page.sheetId);
    const connectorClearance = page.pageGate.quality.checks.find((check) =>
      check.code === 'PAGE-Q12-OFFPAGE-LABEL-CLEARANCE');
    assert.equal(connectorClearance.ok, true, page.sheetId);
    assert.equal(connectorClearance.severity, 'BLOCKING', page.sheetId);
    assert.equal(page.pageGate.offPageLabelClearance.status, 'PASS', page.sheetId);
    assert.equal(page.pageGate.coverage.ok, true, page.sheetId);
    assert.equal(page.pageGate.coverage.exactGlobalEndpoints, true, page.sheetId);
    assert.match(page.svg, new RegExp('data-sheet-id="' + page.sheetId + '"'));
    assert.match(page.svg, new RegExp('data-page-current="' + (index + 1) + '"'));
    assert.match(page.svg, /data-page-total="6"/);
    assert.match(page.svg, /data-schedule-included="false"/);
    assert.doesNotMatch(page.svg, /data-symbol-fallback="true"/);
    page.compiled.drawingIR.devices.forEach((device) => {
      assert.ok(device.bbox.height <= 300,
        page.sheetId + ' ' + device.id + ' exceeds the fan-out graphic height budget: ' + device.bbox.height);
    });
  });
});

test('screenshot-matching GB S02 keeps every signal PIN label clear and PAGE-Q12 blocks a regression', () => {
  const built = result({
    outputKw: 120, moduleKw: 40, gunCount: 2, gunCurrentA: 250,
    essEnabled: false
  });
  const rendered = SHEETS.buildDocument(built);
  const page = rendered.pages.find((candidate) => candidate.sheetId === 'S02');
  assert.ok(page, 'S02 must be rendered');
  assert.equal(page.compiled.drawingIR.routes.length, 30, 'fixture must match the reported S02 circuit count');

  const signalBanks = page.compiled.drawingIR.devices.filter((device) =>
    device.id === 'OPB-S02-OUT-S06-SIGNAL_COMM-01' ||
    device.id === 'OPB-S02-OUT-S06-SIGNAL_CTRL-01');
  assert.equal(signalBanks.length, 2);
  const signalBankIds = new Set(signalBanks.map((device) => device.id));
  const labels = page.compiled.drawingIR.primitives.filter((primitive) =>
    signalBankIds.has(primitive.equipmentId) && primitive.symbolRole === 'terminal-label');
  assert.equal(labels.length, 8, 'four communication and four control PIN references must remain explicit');
  assert.equal(page.pageGate.offPageLabelClearance.status, 'PASS');
  assert.equal(page.pageGate.offPageLabelClearance.blockingCount, 0);

  const tamperedIR = JSON.parse(JSON.stringify(page.compiled.drawingIR));
  const firstLabel = tamperedIR.primitives.find((primitive) =>
    signalBankIds.has(primitive.equipmentId) && primitive.symbolRole === 'terminal-label');
  const ownArrow = tamperedIR.primitives.find((primitive) =>
    primitive.equipmentId === firstLabel.equipmentId && /off-page-(?:incoming|outgoing)-arrow/.test(primitive.symbolRole));
  assert.ok(firstLabel && ownArrow, 'tamper fixture requires one label and continuation triangle');
  firstLabel.x = ownArrow.points[0].x;
  firstLabel.y = ownArrow.points[0].y;
  firstLabel.anchor = 'middle';

  const quality = SHEETS.pagePresentationQuality(page.sheet,
    Object.assign({}, page.compiled, { drawingIR: tamperedIR }), page.pageGate.coverage, page.svg);
  const q12 = quality.checks.find((check) => check.code === 'PAGE-Q12-OFFPAGE-LABEL-CLEARANCE');
  assert.equal(q12.ok, false);
  assert.equal(q12.severity, 'BLOCKING');
  assert.equal(quality.status, 'BLOCKED');
  assert.ok(q12.evidence.some((finding) =>
    finding.code === 'VIS-006-OFFPAGE-LABEL-SYMBOL-COLLISION'));
});

test('each internal circuit is rendered once and each cross-sheet circuit exactly twice with global PIN identity', () => {
  const built = result({ standard: 'eu', acVoltage: 400 });
  const rendered = SHEETS.buildDocument(built);
  const routes = rendered.pages.flatMap((page) => page.compiled.drawingIR.routes.map((route) => ({ page, route })));
  const sourceById = new Map(built.design.circuits.map((circuit) => [circuit.id, circuit]));
  const crossIds = new Set(rendered.document.crossSheetCircuits.map((item) => item.circuitId));

  built.design.circuits.forEach((circuit) => {
    const matches = routes.filter((item) => item.route.circuitId === circuit.id);
    assert.equal(matches.length, crossIds.has(circuit.id) ? 2 : 1, circuit.id);
    matches.forEach(({ page, route }) => {
      assert.equal(route.globalSource.ref, circuit.from + ':' + circuit.fromPort);
      assert.equal(route.globalTarget.ref, circuit.to + ':' + circuit.toPort);
      assert.ok(page.svg.includes('data-circuit="' + circuit.id + '"'));
      assert.ok(page.svg.includes('data-from="' + circuit.from + ':' + circuit.fromPort + '"'));
      assert.ok(page.svg.includes('data-to="' + circuit.to + ':' + circuit.toPort + '"'));
    });
  });
  assert.equal(sourceById.size, built.design.circuits.length);

  rendered.document.crossSheetCircuits.forEach((cross) => {
    const pages = rendered.pages.filter((page) =>
      page.offPageConnectors.some((connector) => connector.circuitId === cross.circuitId));
    assert.equal(pages.length, 2, cross.circuitId);
    pages.forEach((page) => {
      const connector = page.offPageConnectors.find((item) => item.circuitId === cross.circuitId);
      assert.ok(page.svg.includes('data-off-page-connector="' + connector.id + '"'));
      assert.ok(page.svg.includes('data-peer-connector="' + connector.peerConnectorId + '"'));
      assert.ok(page.svg.includes('data-xref-sheet="' + connector.remoteSheetId + '"'));
    });
  });
});

test('an unused functional page stays explicit, selectable and covered instead of disappearing', () => {
  const rendered = SHEETS.buildDocument(result({ essEnabled: false }));
  const storage = rendered.pages.find((page) => page.sheetId === 'S04');
  assert.ok(storage);
  assert.equal(storage.pageModel.circuits.length, 0);
  assert.equal(storage.pageGate.status, 'PASS');
  assert.match(storage.svg, /本配置不需要此功能单元/);
  assert.match(storage.svg, /data-sheet-id="S04"/);
});

test('sheet rendering is deterministic and rejects a document from another EDEM', () => {
  const built = result();
  const first = SHEETS.buildDocument(built);
  const second = SHEETS.buildDocument(built);
  assert.deepEqual(first, second);

  const other = result({ outputKw: 120, gunCount: 2 });
  assert.throws(() => SHEETS.compilePage(other, first.document, 'S01'), (error) =>
    error && error.code === 'DOCUMENT_MODEL_HASH_MISMATCH');
  assert.throws(() => SHEETS.compilePage(built, first.document, 'S99'), (error) =>
    error && error.code === 'SHEET_UNKNOWN');
});

test('page editing retains global endpoint and off-page identity through an IR rebuild', () => {
  const built = result();
  const rendered = SHEETS.buildDocument(built);
  const page = rendered.pages.find((item) => item.sheetId === 'S01');
  const editor = win.EVSE_SCHEMATIC_EDITOR.createSession({
    drawingIR: page.compiled.drawingIR,
    model: page.pageModel
  });
  const annotation = editor.drawingIR.annotations.find((item) => item.kind === 'text');
  assert.ok(annotation);
  const response = editor.editAnnotationText(annotation.id, annotation.text + ' · 已复核布局');
  assert.equal(response.accepted, true);
  editor.drawingIR.routes.forEach((route) => {
    const source = built.design.circuits.find((circuit) => circuit.id === route.circuitId);
    assert.ok(source);
    assert.equal(route.globalSource.ref, source.from + ':' + source.fromPort);
    assert.equal(route.globalTarget.ref, source.to + ':' + source.toPort);
    if (page.offPageConnectors.some((connector) => connector.circuitId === route.circuitId)) {
      assert.ok(route.offPageConnector);
      assert.equal(route.offPageConnector.circuitId, route.circuitId);
    }
  });
  editor.drawingIR.devices.forEach((device) => {
    assert.ok(Object.prototype.hasOwnProperty.call(device, 'graphicalRepresentationOf'));
  });
  const crossRoute = editor.drawingIR.routes.find((route) => route.offPageConnector);
  const sourceDevice = editor.drawingIR.devices.find((device) => device.id === crossRoute.source.deviceId);
  const sourcePort = sourceDevice.ports.find((port) => port.ref === crossRoute.source.ref);
  const connection = editor.connectionsForPort(crossRoute.source.deviceId, sourcePort.id)
    .find((item) => item.routeId === crossRoute.id);
  assert.ok(connection);
  assert.equal(connection.oppositeRef, crossRoute.globalTarget.ref);
  assert.equal(connection.graphicalOppositeRef, crossRoute.target.ref);
  assert.equal(connection.offPageConnectorId, crossRoute.offPageConnector.id);
  assert.equal(connection.remoteSheetId, crossRoute.offPageConnector.remoteSheetId);
});

test('sheet DXF XDATA preserves authoritative pins and separate graphical endpoints', () => {
  const built = result();
  const rendered = SHEETS.buildDocument(built);
  const page = rendered.pages.find((candidate) => candidate.offPageConnectors.length > 0);
  assert.ok(page, 'fixture must contain at least one cross-sheet circuit');
  const route = page.compiled.drawingIR.routes.find((candidate) => candidate.offPageConnector);
  assert.ok(route);
  const exported = win.EVSE_DXF.exportDrawingIR(page.compiled.drawingIR, { allowInvalid: false });
  const trace = exported.trace.find((candidate) => candidate.routeId === route.id);
  assert.ok(trace, 'DXF manifest must expose a trace record for the page route');
  assert.equal(trace.from, route.globalSource.ref);
  assert.equal(trace.to, route.globalTarget.ref);
  assert.equal(trace.graphicalFrom, route.source.ref);
  assert.equal(trace.graphicalTo, route.target.ref);
  assert.equal(trace.offPageConnectorId, route.offPageConnector.id);
  assert.equal(trace.xrefSheet, route.offPageConnector.remoteSheetId);
  assert.match(exported.dxf, /EVSE_IR/);
});

test('moving a page device preserves cross-sheet PIN identity and keeps the page gate open', () => {
  const built = result({ outputKw: 120, moduleKw: 40, gunCount: 2, essEnabled: false });
  const rendered = SHEETS.buildDocument(built);
  const page = rendered.pages.find((candidate) => candidate.sheetId === 'S05');
  const editor = win.EVSE_SCHEMATIC_EDITOR.createSession({
    drawingIR: page.compiled.drawingIR,
    model: page.pageModel
  });
  const response = editor.moveDevice('EQ-AUX-M2', 40, 0, { grid: 5 });
  assert.equal(response.accepted, true);
  const compiled = Object.assign({}, page.compiled, { drawingIR: editor.drawingIR });
  const svg = win.EVSE_SVG_IR_RENDERER.render(compiled, built, {
    title: page.sheet.title,
    subtitle: page.sheet.drawingNo + ' | edited projection',
    sheetId: page.sheet.id,
    drawingNo: page.sheet.drawingNo,
    pageCurrent: page.sheet.page,
    pageTotal: page.sheet.total,
    sourceModelHash: built.design.modelHash,
    includeSchedule: false,
    includeLegend: true,
    offPageConnectors: page.offPageConnectors
  });
  const gate = SHEETS.evaluatePage(built, rendered.document, 'S05', compiled, svg);
  assert.equal(gate.status, 'PASS');
  assert.equal(gate.coverage.exactGlobalEndpoints, true);
  const circuitById = new Map(built.design.circuits.map((circuit) => [circuit.id, circuit]));
  editor.drawingIR.routes.forEach((route) => {
    const circuit = circuitById.get(route.circuitId);
    assert.equal(route.globalSource.ref, circuit.from + ':' + circuit.fromPort);
    assert.equal(route.globalTarget.ref, circuit.to + ':' + circuit.toPort);
    if (page.offPageConnectors.some((connector) => connector.circuitId === route.circuitId)) {
      assert.equal(route.offPageConnector.circuitId, route.circuitId);
    }
  });
});

test('a same-page connector swap blocks both the page and the recomputed project gate', () => {
  const built = result({ essEnabled: false, gunCount: 2 });
  const rendered = SHEETS.buildDocument(built);
  const page = rendered.pages.find((candidate) => candidate.offPageConnectors.length > 1);
  const routed = page.compiled.drawingIR.routes.filter((route) => route.offPageConnector);
  assert.ok(routed.length > 1);
  const wrongConnector = routed[1].offPageConnector;
  const routes = page.compiled.drawingIR.routes.map((route) => route.id === routed[0].id
    ? Object.freeze(Object.assign({}, route, { offPageConnector: wrongConnector })) : route);
  const drawingIR = Object.freeze(Object.assign({}, page.compiled.drawingIR, { routes: Object.freeze(routes) }));
  const compiled = Object.freeze(Object.assign({}, page.compiled, { drawingIR }));
  const svg = win.EVSE_SVG_IR_RENDERER.render(compiled, built, {
    title: page.sheet.title, subtitle: 'fault injection', sheetId: page.sheet.id,
    drawingNo: page.sheet.drawingNo, pageCurrent: page.sheet.page, pageTotal: page.sheet.total,
    sourceModelHash: built.design.modelHash, includeSchedule: false, includeLegend: true,
    offPageConnectors: page.offPageConnectors
  });
  const gate = SHEETS.evaluatePage(built, rendered.document, page.sheetId, compiled, svg);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.coverage.exactOffPageConnectors, false);
  assert.ok(gate.coverage.offPageConnectorErrors.some((item) => item.startsWith('MISMATCH:')));

  const edited = Object.freeze(Object.assign({}, page, { compiled, svg, pageGate: gate }));
  const reevaluated = SHEETS.evaluateDocument(built, rendered, { [page.sheetId]: edited });
  assert.equal(reevaluated.status, 'BLOCKED');
  assert.equal(reevaluated.projectGate.status, 'BLOCKED');
  assert.ok(reevaluated.projectGate.blockedSheetIds.includes(page.sheetId));
});
