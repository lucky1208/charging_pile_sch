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
  assert.match(app, /真实起点PIN/);
  assert.match(app, /本页图形端点/);
  assert.match(app, /跨页续接/);
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

test('工程工作台提供真实适页、锚点缩放、平移、全屏和可折叠侧栏', () => {
  assert.match(html, /onclick="zoomActual\(\)"/);
  assert.match(html, /onclick="toggleInspectorPanels\(\)"/);
  assert.match(html, /onclick="toggleConfigPanel\(\)"/);
  assert.match(app, /Math\.max\(0\.02,/);
  assert.doesNotMatch(app, /state\.zoom = Math\.max\(0\.25/);
  assert.match(app, /event\.code === 'Space'/);
  assert.match(app, /event\.button === 1/);
  assert.match(app, /requestFullscreen/);
  assert.match(app, /document\.fullscreenElement/);
  assert.match(html, /body\.workspace-mode\.inspector-collapsed \.editor-shell\.active\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(html, /\.sheet-tabs \.state-tag\{white-space:nowrap;flex:0 0 auto/);
  assert.match(html, /\.diagram-box svg\{display:block;max-width:none;margin-inline:auto\}/);
});

test('参数、元器件库和 PIN 检查器组成图纸上方的响应式横向控制台', () => {
  assert.match(html, /\.wrap\{display:grid;grid-template-rows:auto minmax\(0,1fr\);grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /class="config-groups"/);
  assert.ok((html.match(/class="config-group(?:\s|"|$)/g) || []).length >= 6);
  assert.match(html, /class="editor-top-console" id="editor-top-console"/);
  const consoleStart = html.indexOf('id="editor-top-console"');
  const drawingStart = html.indexOf('id="d-pile"');
  assert.ok(consoleStart >= 0 && drawingStart > consoleStart, 'editor console must precede the drawing canvas');
  assert.match(html, /body\.config-collapsed \.wrap\{grid-template-rows:0 minmax\(0,1fr\)/);
  assert.match(html, /#design-config-panel\{grid-row:1/);
  assert.match(html, /\.workspace-column\{grid-row:2/);
  assert.match(html, /#result-area\{[^}]*flex-direction:column;align-items:stretch/);
  assert.match(html, /body\.config-collapsed \.workspace-column\{grid-row:2\}/);
  assert.match(html, /body\.workspace-mode \.workspace-column\{grid-row:1\}/);
  assert.match(html, /body\.config-collapsed #design-config-panel,body\.config-collapsed \.editor-top-console\{display:none!important\}/);
  assert.match(html, /body\.config-collapsed #review-host,body\.config-collapsed \.editor-status,body\.config-collapsed footer\{display:none!important\}/);
  assert.match(html, /body\.inspector-collapsed #editor-inspector\{display:none!important\}/);
  assert.match(html, /@media \(max-width:720px\)[\s\S]*\.config-groups\{grid-template-columns:1fr\}/);
  assert.match(html, /\.editor-route-hit-target[^}]*stroke:transparent!important;stroke-width:12!important;pointer-events:stroke/);
  assert.equal((html.match(/<label class="form-label"(?![^>]*\bfor=)/g) || []).length, 0,
    'every form label must point to its control');
});

test('图纸首屏适配、分页编辑历史、编辑后项目闸门与 DXF 追溯信息均保持真实', () => {
  const reveal = app.indexOf("$('result-area').style.display = 'flex'");
  const activate = app.indexOf('activateSchematicSheet(state.activeSheetId)', reveal);
  assert.ok(reveal >= 0 && activate > reveal, 'result must be measurable before fit-to-page zoom');
  assert.match(app, /pageEditorSessions\[sessionKey\]\s*\|\|\s*[\s\S]*api\.createSession/);
  assert.match(app, /state\.pageEditorSessions\[sessionKey\]\s*=\s*state\.editor/);
  assert.match(app, /pageApi\.evaluateDocument\(state\.R, state\.renderedSchematicDocument, state\.pageEdits\)/);
  assert.match(app, /drawingIRHash:\s*state\.R\s*&&\s*state\.R\.drawingGeometryHash/);
  assert.match(app, /sheetTabKeydown/);
});

test('浏览器只在内存保留受控 AI 访问令牌并以 Bearer 发送', () => {
  assert.match(html, /id="f-ai-access-token"[^>]*autocomplete="off"/);
  assert.match(app, /Authorization:\s*'Bearer '\s*\+\s*token/);
  assert.doesNotMatch(app, /(?:localStorage|sessionStorage|indexedDB)[\s\S]{0,120}(?:access.?token|f-ai-access-token)/i);
  assert.doesNotMatch(app, /TRACKED_FIELDS[^;]*f-ai-access-token/);
});

test('Web 暴露受控 AI 审图、EDEM 同源 BOM 与候选知识维护边界', () => {
  assert.match(html, /id="ai-review-panel"/);
  assert.match(html, /id="review-file"/);
  assert.match(html, /id="bom-table-body"/);
  ['位号', '类别', '设备名称', '型号', '参考推荐厂家', '关键参数', '数量', '说明手册下载'].forEach((column) => {
    assert.match(html, new RegExp(column));
  });
  assert.match(html, /CANDIDATE → REVIEWED → APPROVED/);
  assert.match(app, /SCHEMATIC_ENGINEERING_REVIEW/);
  assert.match(app, /SCHEMATIC_ENGINEERING_BOM/);
  assert.match(app, /action: 'bom-research', bom: rows/);
  assert.match(app, /action: 'review', context: reviewCase/);
  assert.match(app, /PART_SELECTION_REQUIRED/);
  assert.match(app, /DRAFT_DIAGNOSTIC/);
});

test('Web 导出时反读当前 DOM，且提供 BOM、精确 PIN、RFQ 与审计证据四件套', () => {
  assert.match(app, /pageApi\.evaluatePage\(state\.R, state\.schematicDocument, state\.activeSheetId,[\s\S]*state\.activePage\.compiled, markup\)/);
  assert.match(app, /最终 SVG，发现 Drawing IR、页面骨架、几何或跨页精确覆盖不一致/);
  assert.match(app, /SCHEMATIC_ENGINEERING_DELIVERY/);
  ['downloadEngineeringBomCsv', 'downloadExactPinWiringCsv', 'downloadEngineeringRfqCsv',
    'downloadEngineeringAuditJson'].forEach((handler) => {
    assert.match(html, new RegExp('onclick="' + handler + '\\(\\)"'));
    assert.match(app, new RegExp('window\\.' + handler + '\\s*=\\s*function'));
  });
  assert.match(app, /delivery\.wiringCsv\(state\.R\)/);
  assert.match(app, /delivery\.rfqCsv\(state\.R\)/);
  assert.match(app, /delivery\.auditJson\(state\.R, auditedDocument\)/);
});
