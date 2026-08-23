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

test('Web 禁用尚未验证的接口与桩型', () => {
  assert.match(html, /value="nacs" disabled/);
  assert.match(html, /value="chademo" disabled/);
  assert.match(html, /value="dc-split" disabled/);
  assert.match(html, /value="ac-dc-combo" disabled/);
  assert.match(html, /value="ess-mobile" disabled/);
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
