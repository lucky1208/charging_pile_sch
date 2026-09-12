'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');
const win = {};
orderedEngineFiles(path.join(rootDir, 'engine')).forEach((file) => {
  const source = fs.readFileSync(path.join(rootDir, 'engine', file), 'utf8');
  new Function('window', 'document', source)(win, {});
});

const result = win.EVSE_ENGINE.build(Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
  pileName: 'RENDERED-SVG-AUDIT-TEST', standard: 'gb', archetype: 'dc-integrated',
  outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
  acVoltage: 380, voltageWindow: '200-1000', thermal: 'air',
  essEnabled: false, requirementConfirmed: true
}));
const rendered = win.EVSE_SCHEMATIC_SHEET_RENDERING.buildDocument(result);
const page = rendered.pages.find((item) => item.sheetId === 'S01');
const AUDIT = win.EVSE_RENDERED_SVG_AUDIT;

function audit(svg) { return AUDIT.audit(svg, page.compiled.drawingIR, win.SYM.C); }
function firstVisibleRouteLine(svg) {
  const match = /<line\b(?=[^>]*\bdata-route=")[^>]*\/>/.exec(svg);
  assert.ok(match, 'test page must contain a visible routed line');
  return match[0];
}

test('all compiler pages reconcile from final SVG geometry to immutable Drawing IR', () => {
  rendered.pages.forEach((candidate) => {
    const report = AUDIT.audit(candidate.svg, candidate.compiled.drawingIR, win.SYM.C);
    assert.equal(report.ok, true, candidate.sheetId + ': ' + JSON.stringify(report.errors.slice(0, 3)));
    assert.equal(report.stats.routes, candidate.compiled.drawingIR.routes.length);
    assert.equal(report.stats.primitives,
      candidate.compiled.drawingIR.primitives.filter((primitive) => primitive.equipmentId).length +
      candidate.compiled.drawingIR.annotations.length);
  });
});

test('deleting or moving a rendered conductor blocks even when the root hash is left untouched', () => {
  const line = firstVisibleRouteLine(page.svg);
  const deleted = page.svg.replace(line, '');
  const deletedAudit = audit(deleted);
  assert.equal(deletedAudit.ok, false);
  assert.ok(deletedAudit.errors.some((error) => error.code === 'SVG_WIRE_GAP'));

  const movedLine = line.replace(/x1="([\d.]+)"/, (_, value) => 'x1="' + (Number(value) + 4) + '"');
  const movedAudit = audit(page.svg.replace(line, movedLine));
  assert.equal(movedAudit.ok, false);
  assert.ok(movedAudit.errors.some((error) =>
    ['SVG_ROUTE_DEVIATION', 'SVG_WIRE_GAP', 'SVG_ROUTE_COORDINATE'].includes(error.code)));
});

test('route identities, PIN anchors and transparent editor hit targets are independently checked', () => {
  const wrongNet = page.svg.replace(/(<g id="ROUTE-[^"]+"[^>]*data-net=")[^"]+/, '$1NET-FORGED');
  assert.ok(audit(wrongNet).errors.some((error) => error.code === 'SVG_ROUTE_IDENTITY'));

  const port = /<circle\b(?=[^>]*\bdata-primitive=")(?=[^>]*\bdata-terminal=")[^>]*\/>/.exec(page.svg);
  assert.ok(port);
  assert.ok(audit(page.svg.replace(port[0], '')).errors.some((error) => error.code === 'SVG_MISSING_PRIMITIVE'));

  const hit = /<line class="editor-route-hit-target"[^>]*\/>/.exec(page.svg);
  assert.ok(hit);
  assert.ok(audit(page.svg.replace(hit[0], '')).errors.some((error) => error.code === 'SVG_MISSING_HIT_TARGET'));
});

test('bridge arcs are centred on declared crossings and cannot be removed or enlarged', () => {
  const bridge = /<path\b(?=[^>]*data-marker="bridge")[^>]*\/>/.exec(page.svg);
  assert.ok(bridge, 'test page must contain a bridge');
  const removed = audit(page.svg.replace(bridge[0], ''));
  assert.ok(removed.errors.some((error) => error.code === 'SVG_MISSING_BRIDGE'));

  const enlarged = bridge[0].replace(/ A[-\d.e+]+,[-\d.e+]+/i, ' A9,9');
  const enlargedAudit = audit(page.svg.replace(bridge[0], enlarged));
  assert.ok(enlargedAudit.errors.some((error) => error.code === 'SVG_BRIDGE_GEOMETRY'));
});

test('hidden/transformed IR, active content, duplicate IDs and malformed XML fail closed', () => {
  const hidden = page.svg.replace('<g id="EVSE-DRAWING-IR"', '<g id="EVSE-DRAWING-IR" display="none"');
  assert.ok(audit(hidden).errors.some((error) => error.code === 'SVG_VISIBILITY_OVERRIDE'));
  const transformed = page.svg.replace('<g id="EVSE-DRAWING-IR"', '<g id="EVSE-DRAWING-IR" transform="translate(1 0)"');
  assert.ok(audit(transformed).errors.some((error) => error.code === 'SVG_TRANSFORM_OVERRIDE'));
  assert.ok(audit(page.svg.replace('</svg>', '<script>alert(1)</script></svg>')).errors.some((error) =>
    error.code === 'SVG_ACTIVE_OR_EXTERNAL_CONTENT'));
  assert.ok(audit(page.svg.replace('</svg>', '<g id="EVSE-FRAME"/></svg>')).errors.some((error) =>
    error.code === 'SVG_PARSE'));
  assert.ok(audit(page.svg.replace('</svg>', '')).errors.some((error) => error.code === 'SVG_PARSE'));
});

test('the complete presentation skeleton rejects a root-level opaque overlay', () => {
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(page.svg);
  assert.ok(viewBox);
  const overlay = '<rect x="0" y="0" width="' + viewBox[1] + '" height="' + viewBox[2] + '" fill="#fff"/>';
  const report = audit(page.svg.replace('</svg>', overlay + '</svg>'));
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.code === 'SVG_UNTRACKED_ROOT_CONTENT'));
  assert.ok(report.errors.some((error) => error.code === 'SVG_PRESENTATION_OCCLUSION'));
});

test('page and recomputed project gates consume the final-SVG audit result', () => {
  const line = firstVisibleRouteLine(page.svg);
  const mutatedSvg = page.svg.replace(line, '');
  const pageGate = win.EVSE_SCHEMATIC_SHEET_RENDERING.evaluatePage(
    result, rendered.document, page.sheetId, page.compiled, mutatedSvg);
  assert.equal(pageGate.allowed, false);
  assert.equal(pageGate.status, 'BLOCKED');
  assert.ok(pageGate.quality.checks.some((check) => check.code === 'PAGE-Q10-RENDERED-SVG' && !check.ok));

  const replacement = Object.assign({}, page, { svg: mutatedSvg });
  const project = win.EVSE_SCHEMATIC_SHEET_RENDERING.evaluateDocument(
    result, rendered, { [page.sheetId]: replacement });
  assert.equal(project.status, 'BLOCKED');
  assert.equal(project.projectGate.status, 'BLOCKED');
});
