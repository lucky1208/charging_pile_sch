'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(rootDir, 'web', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(rootDir, 'web', 'js', 'app.js'), 'utf8');

test('Web 暴露明确的需求复核控件', () => {
  assert.match(html, /id="requirement-review"/);
  assert.match(html, /id="f-requirement-confirm"/);
  assert.match(app, /REQUIREMENTS\.generationGate/);
});

test('Web 开放五种接口与四种桩型，不残留 disabled 占位项', () => {
  ['nacs', 'chademo', 'dc-split', 'ac-dc-combo', 'ess-mobile'].forEach((value) => {
    assert.match(html, new RegExp('value="' + value + '"'));
    assert.doesNotMatch(html, new RegExp('value="' + value + '"\\s+disabled'));
  });
  assert.match(app, /value === 'ess-mobile'/);
  assert.match(app, /\$\('f-ess'\)\.value = '1'/);
  assert.match(app, /\$\('f-supply'\)\.value = 'offgrid'/);
});

test('AI 回填标准时同时使用共享标准电压映射', () => {
  assert.match(app, /STANDARD_VOLTAGES\[requirement\.standard\]/);
  assert.match(app, /setAutomatedValue\('f-acv'/);
});

test('Web 将原始自然语言附在 AI RequirementSpec，且数字输入交给共享闸门校验', () => {
  assert.match(app, /Object\.assign\(\{\}, payload \|\| \{\}, \{ rawText: text \}\)/);
  assert.doesNotMatch(app, /innerHTML\s*=\s*[^\n;]*rawText/);
  assert.doesNotMatch(app, /Math\.max\(1,\s*inputNumber\('f-output'/);
  assert.doesNotMatch(app, /Math\.max\(0,\s*inputNumber\('f-ess-kwh'/);
});

test('Web 的 DXF 与 JSON 导出直接携带 Drawing IR，不回退解析 SVG', () => {
  assert.match(app, /svgMatchesDrawingIR\(svg\)/);
  assert.match(app, /data-geometry-hash/);
  assert.match(app, /data-route-count/);
  assert.match(app, /exporter\.exportDrawingIR\(state\.R\.drawingIR, options\)/);
  assert.match(app, /drawingIR:\s*state\.R\.drawingIR \|\| null/);
  assert.doesNotMatch(app, /exportSvgLegacy\(exportSvgMarkup/);
});

test('Web 明示功能安全模型与用户项目证据化候选知识的工程边界', () => {
  assert.match(html, /id="functional-unit-status"/);
  assert.match(app, /renderFunctionalUnitStatus\(\)/);
  assert.match(app, /functionalUnitKnowledge/);
  assert.match(app, /禁止自动选型/);
  assert.match(app, /板级电路、器件值、阈值和时序仍为项目待决项/);
});

test('Web 提供真实项目参考矩阵并明确区分可见走线和待复核推断', () => {
  assert.match(app, /EVSE_REFERENCE_SYSTEM_LIBRARY/);
  assert.match(app, /showReferenceSystem/);
  assert.match(app, /端子标注\+走线明确/);
  assert.match(app, /功能推断—必须复核/);
  assert.match(html, /推断待核三级保存/);
});

test('Web 编辑器提供实时跟线、自动避让、挤推、图层和键盘事务入口', () => {
  assert.match(html, /EVSE-EDITOR-PREVIEW/);
  assert.match(html, /挤推重布相邻导线/);
  assert.match(app, /previewObjectMove/);
  assert.match(app, /previewRouteSegment/);
  assert.match(app, /connectionsForPort/);
  assert.match(app, /data-editor-layer/);
  assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(app, /window\.editorUndo\(\)/);
  assert.match(app, /cancelEditorDrag/);
});

test('Web 编辑器提供 CAD 框选、多选、原子组移、网格微调与对齐分布入口', () => {
  assert.match(html, /id="editor-snap"/);
  assert.match(html, /id="editor-grid"/);
  assert.match(html, /id="editor-selection-count"/);
  assert.match(html, /EVSE-EDITOR-MARQUEE/);
  assert.match(app, /state\.editor\.selectMany/);
  assert.match(app, /state\.editor\.toggleSelection/);
  assert.match(app, /state\.editor\.queryRect/);
  assert.match(app, /state\.editor\.moveObjects/);
  assert.match(app, /state\.editor\.alignDevices/);
  assert.match(app, /state\.editor\.distributeDevices/);
  assert.match(app, /screenDistance < 4/);
  assert.match(app, /arrowleft/);
  assert.match(app, /drag\.marqueeMode === 'contained'/);
});
