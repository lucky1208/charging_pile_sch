/*
 * 独立的交付契约回归套件。
 *
 * 这里刻意只测输出契约，不复制渲染器实现细节：A3 物理图幅、文控字段、
 * 方案级作用域声明，以及 app.js 消费的 DXF 静态契约。运行：
 *   node tests/regression-contract.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const win = {};

function load(name) {
  const source = fs.readFileSync(path.join(ROOT, 'js', name), 'utf8');
  (new Function('window', 'document', source))(win, {});
}
['symbols.js', 'ev-standards.js', 'design-model.js', 'drawing-skill.js', 'vendors.js',
  'engine.js', 'layout.js', 'draw-pile.js'].forEach(load);

const base = Object.freeze({
  pileName: '回归验证充电桩', site: '上海', standard: 'gb', archetype: 'dc-integrated',
  outputKw: 360, gunCount: 2, gunCurrentA: 250, voltageWindow: '200-1000', moduleKw: 30,
  acVoltage: 380, supplyMode: 'transformer', thermal: 'air',
  essEnabled: true, essKwh: 215, essChem: 'lfp', essCoupling: 'dc', essPowerKw: 100,
  backend: 'ocpp16', pref: 'balance'
});

const requiredCadLayers = Object.freeze([
  'EVSE-FRAME', 'EVSE-TEXT', 'EVSE-ANNO', 'EVSE-EQPT', 'EVSE-AC', 'EVSE-DC',
  'EVSE-ESS', 'EVSE-AUX', 'EVSE-CTL', 'EVSE-COMM', 'EVSE-PE'
]);

function build(overrides) {
  return win.EVSE_ENGINE.build(Object.assign({}, base, overrides || {}));
}
function render(result) {
  const markup = win.drawPile(result);
  assert.strictEqual(typeof markup, 'string', '渲染器必须返回 SVG 字符串');
  assert.ok(markup.startsWith('<svg') && markup.trim().endsWith('</svg>'), '必须返回完整 SVG');
  return markup;
}

function assertA3Contract(markup, name) {
  const root = markup.match(/^<svg\b[^>]*>/);
  assert.ok(root, name + ' 缺少 SVG 根节点');
  const tag = root[0];
  assert.ok(/width="420mm"/.test(tag) && /height="297mm"/.test(tag), name + ' 必须以 420mm × 297mm 交付');
  assert.ok(/data-sheet-format="A3"/.test(tag) && /data-sheet-orientation="LANDSCAPE"/.test(tag) && /data-units="mm"/.test(tag),
    name + ' 缺少 A3 横向/mm 元数据');
  const viewBox = /viewBox="\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*"/.exec(tag);
  assert.ok(viewBox, name + ' 缺少可缩放 viewBox');
  const ratio = Number(viewBox[1]) / Number(viewBox[2]);
  assert.ok(Math.abs(ratio - 420 / 297) < 0.002, name + ' 虚拟画布与 A3 横向比例不一致');
}

function assertDocumentControl(result, markup) {
  const control = result.design && result.design.documentControl;
  assert.ok(control, '工程模型必须输出文控对象');
  assert.strictEqual(control.documentClass, 'CONCEPTUAL_SCHEME');
  assert.strictEqual(control.revision, 'P01');
  assert.strictEqual(control.status, result.documentStatus);
  const register = control.drawingRegister || [];
  assert.deepStrictEqual(register.map((item) => item.key), ['ev-schematic'], '图纸登记册只登记充电桩原理图');
  register.forEach((item) => {
    assert.strictEqual(item.sheet, 'A3');
    assert.strictEqual(item.orientation, 'LANDSCAPE');
    assert.strictEqual(item.status, result.documentStatus);
    assert.strictEqual(item.verification, 'NOT_VERIFIED');
  });
  assert.deepStrictEqual(control.cadLayerManifest.map((item) => item.name), requiredCadLayers, '工程模型与 CAD 图层清单必须一致');
  const root = markup.match(/^<svg\b[^>]*>/)[0];
  assert.ok(root.includes('data-document-control="CONCEPTUAL_SCHEME"'));
  assert.ok(root.includes('data-document-key="ev-schematic"'));
  assert.ok(root.includes('data-document-status="' + result.documentStatus + '"'));
  const encoded = /data-cad-layer-manifest="([^"]+)"/.exec(root);
  assert.ok(encoded, 'SVG 缺少 CAD 图层清单');
  const layers = JSON.parse(encoded[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')).map((item) => item.name);
  assert.deepStrictEqual(layers, requiredCadLayers, 'SVG 图层清单与工程模型不一致');
  ['图号:', '修订: P01', '阶段: 方案级', '校核:', '批准:', '页: 1/1'].forEach((label) => {
    assert.ok(markup.includes(label), '标题栏缺少字段：' + label);
  });
}

function assertConceptOnly(result, markup, name) {
  assert.strictEqual(result.documentStatus, 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED');
  assert.ok(markup.includes('CONCEPT_DRAFT'), name + ' 必须显示方案级文档状态');
  assert.ok(/待(?:专业|专项|确认|核算|核实|校核)|不构成|不得作为/.test(markup), name + ' 必须声明尚待专业确认的边界');
  /* 允许“不构成 IEC 合规认证”这类范围声明，禁止任何正向的生产/合规断言 */
  const prohibited = [
    /CONSTRUCTION[_ -]?READY/i,
    /(?:生产|施工)图(?:级|交付|输出|已生成|已完成)/,
    /可直接(?:用于)?(?:生产|施工)/,
    /(?:已|自动|满足|符合|通过).{0,8}(?:IEC|GB\/T|UL|SAE|规范|合规|认证|型式试验)/,
    /(?:IEC|GB\/T|UL|SAE|规范|合规|认证|型式试验).{0,8}(?:已|自动|满足|符合|通过)/
  ];
  prohibited.forEach((rule) => assert.ok(!rule.test(markup), name + ' 出现不允许的生产/合规正向声明：' + rule));
}

/* 1. 国标 + 直流耦合储能：完整契约 */
const gb = build();
const gbMarkup = render(gb);
assertA3Contract(gbMarkup, '国标原理图');
assertDocumentControl(gb, gbMarkup);
assertConceptOnly(gb, gbMarkup, '国标原理图');
assert.ok(gbMarkup.includes('XS1') && gbMarkup.includes('XS2'), '每把枪必须有唯一位号');
assert.ok(gbMarkup.includes('GB1') && gbMarkup.includes('预充'), '储能支路必须显示电池簇与预充');

/* 2. 无储能：不得凭空画出储能支路 */
const noEss = build({ essEnabled: false });
const noEssMarkup = render(noEss);
assertA3Contract(noEssMarkup, '无储能原理图');
assertConceptOnly(noEss, noEssMarkup, '无储能原理图');
assert.ok(noEssMarkup.includes('本方案未配置'), '无储能时必须明确声明未配置');
assert.ok(!noEssMarkup.includes('GB1 电池簇'), '无储能时不得画出电池簇');
assert.ok(!/A5 BAMS/.test(noEssMarkup), '无储能时不得画出 BMS');

/* 3. 欧标单枪 / 美标四枪：接口端子必须随标准变化 */
const eu = build({ standard: 'eu', gunCount: 1, acVoltage: null });
const euMarkup = render(eu);
assert.ok(euMarkup.includes('CP') && euMarkup.includes('PP'), 'CCS2 必须标注 CP/PP');
assert.ok(!/CC1/.test(euMarkup), 'CCS2 不得残留国标 CC1 端子');
assertA3Contract(euMarkup, '欧标原理图');

const us = build({ standard: 'us', gunCount: 4, gunCurrentA: 400, acVoltage: null });
const usMarkup = render(us);
assert.ok(['XS1', 'XS2', 'XS3', 'XS4'].every((tag) => usMarkup.includes(tag)), '四枪必须全部出图');
assert.strictEqual(us.ac.lineVoltage, 480);
assertA3Contract(usMarkup, '美标原理图');

/* 4. 校核清单永远保留开放项 */
[gb, noEss, eu, us].forEach((result) => {
  const text = JSON.stringify({ validation: result.validation, compliance: result.compliance });
  assert.ok(!/\b(?:PASS|COMPLIANT|CERTIFIED|APPROVED)\b/i.test(text), '方案级校核不得输出合规/签发结论');
  assert.ok(result.validation.some((item) => item.result === 'NOT_CHECKED'), '校核清单必须保留开放状态');
  assert.strictEqual(result.releaseGate.constructionDrawingAllowed, false);
});

/* 5. DXF 静态契约：Node CI 没有浏览器 DOMParser，改测 app.js 消费的接口令牌 */
const dxfSource = fs.readFileSync(path.join(ROOT, 'js', 'dxf-export.js'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
[
  'window.EVSE_DXF', 'exportSvg', 'DOMParser', 'AC1024', '$INSUNITS',
  "'EVSE-FRAME'", "'EVSE-TEXT'", "'EVSE-ANNO'", "'EVSE-EQPT'",
  "'EVSE-AC'", "'EVSE-DC'", "'EVSE-ESS'", "'EVSE-AUX'", "'EVSE-CTL'", "'EVSE-COMM'", "'EVSE-PE'",
  'FALLBACK_LAYER_MANIFEST', 'manifestFromSvg', 'data-cad-layer-manifest',
  'documentFromSvg', 'paperMm'
].forEach((token) => assert.ok(dxfSource.includes(token), 'DXF 导出缺少静态契约：' + token));
assert.ok(/概念.*草图|方案级.*草图/.test(dxfSource), 'DXF 导出必须明确为方案级草图');
assert.ok(!/AIDC/.test(dxfSource + appSource + htmlSource), '不得残留上一代 AIDC 命名');
assert.ok(/downloadDxf/.test(appSource) && /EVSE_DXF/.test(appSource), '界面必须调用 DXF 概念草图导出器');

/* 6. 页面只保留充电桩原理图，旧的多图/多标签必须彻底移除 */
['draw-arch.js', 'draw-wiring.js', 'draw-dual.js', 'draw-cooling.js', 'draw-thermal.js', 'assetlib.js', 'pictograms.js']
  .forEach((name) => {
    assert.ok(!fs.existsSync(path.join(ROOT, 'js', name)), '已删除的渲染器不得残留：' + name);
    assert.ok(!htmlSource.includes(name), 'index.html 不得再引用：' + name);
  });
['系统架构图', '双路供电拓扑图', '液冷管路图', '热管理方案图', '素材库', 'BOM 清单', '发布检查', '选型比较']
  .forEach((label) => assert.ok(!htmlSource.includes(label), 'index.html 不得残留旧标签：' + label));
assert.ok(htmlSource.includes('充电桩设计') && htmlSource.includes('生成充电桩原理图'), '左侧栏必须是充电桩设计');
const dxfScriptIndex = htmlSource.indexOf('js/dxf-export.js');
const appScriptIndex = htmlSource.indexOf('js/app.js');
const stdScriptIndex = htmlSource.indexOf('js/ev-standards.js');
const engineScriptIndex = htmlSource.indexOf('js/engine.js');
assert.ok(dxfScriptIndex >= 0 && appScriptIndex > dxfScriptIndex, 'DXF 导出器必须在 app.js 前加载');
assert.ok(stdScriptIndex >= 0 && engineScriptIndex > stdScriptIndex, '标准库必须在引擎前加载');

console.log('交付契约回归通过：A3 图幅、文控字段、方案级作用域、三标准接口、DXF 静态契约与旧图纸清理。');
