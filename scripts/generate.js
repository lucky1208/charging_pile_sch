'use strict';
/* ============================================================
 * EVSE 充电桩电气原理图 一键生成脚本（Node 侧，无需浏览器 / API Key）
 * ------------------------------------------------------------
 * 用法（Windows PowerShell 下请用参数文件，避免引号被吞）:
 *   node scripts\generate.js --params params.json [--out <输出目录>] [--name <文件名前缀>]
 *
 * 流程与浏览器端 app.js 使用同一个多页编译入口：
 *   1. EVSE_ENGINE.build(params)                       唯一 EDEM 真值
 *   2. EVSE_SCHEMATIC_SHEET_RENDERING.buildDocument   六页投影 + 精确跨页连接
 *   3. projectGate                                    页/项目 fail-closed 闸门
 *   4. 每页 Drawing IR 直接导出 SVG 与 DXF            不反解析 SVG
 *   5. 工程交付表：BOM / 精确 PIN 接线 / RFQ 澄清 / 审计证据
 *   6. JSON 图册方案包（SCHEMATICFORGE-DIAGNOSTIC-PACKAGE/2.0）
 *
 * 退出码: 0 成功；1 参数/运行错误；2 绘图规则闸门阻断（不产出图纸）
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const REQUIREMENTS = require('../engine/requirement-spec.js');
const { orderedEngineFiles } = require('./core-modules.js');

const ENGINE_DIR = path.join(__dirname, '..', 'engine');
const DRAWING_KEY = 'ev-schematic';

function fail(msg, code) {
  console.error('[evse-schematic-design] 错误: ' + msg);
  process.exit(code || 1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--params' || a === '-p') args.params = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--name' || a === '-n') args.name = argv[++i];
    else if (a === '--confirm-requirements') args.confirmRequirements = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const HELP = [
  'EVSE 充电桩电气原理图生成器（方案级概念草图，须经专业复核）',
  '用法: node scripts\\generate.js --params <params.json 路径> [--out <输出目录>] [--name <文件名前缀>] [--confirm-requirements]',
  '参数契约见 references/parameters.md；关键字段:',
  '  standard(gb|eu|us|nacs|chademo) archetype(dc-integrated|dc-split|ac-dc-combo|ess-mobile)',
  '  outputKw gunCount(1-4) gunCurrentA(125|200|250|300|400|500)',
  '  moduleKw(15|20|30|40|60) voltageWindow thermal(air|liquid)',
  '  essEnabled essKwh essPowerKw essChem(lfp|nmc) essCoupling(dc|ac)',
  '输出目录: --out 未提供时使用当前工作目录',
  '输出文件: <name>_EVSE-01..06.svg/.dxf + <name>_BOM/_WIRING/_RFQ.csv + <name>_AUDIT.json + <name>.json'
].join('\n');

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.params) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}

/* ---------- 加载引擎（与 tests 相同的 window 注入方式） ---------- */
const win = {};
function load(file) {
  const src = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
  /* eslint-disable no-new-func */
  (new Function('window', 'document', src))(win, {});
}
orderedEngineFiles(ENGINE_DIR).forEach(load);

if (!win.EVSE_ENGINE || typeof win.EVSE_ENGINE.build !== 'function') {
  fail('选型引擎加载失败，请确认 engine/ 目录完整。');
}
const SKILL = win.EVSE_DRAWING_SKILL;

/* Node 侧为 dxf-export 提供 DOMParser（浏览器有原生实现，不会加载本 shim） */
if (typeof global.DOMParser === 'undefined') {
  global.DOMParser = require('./minidom.js').DOMParser;
}

/* ---------- 参数契约（Web/CLI 共用默认值、枚举和 fail-closed 闸门） ---------- */
let userParams = {};
const raw = String(args.params).trim();
try {
  const text = raw.startsWith('{') ? raw : fs.readFileSync(raw, 'utf8');
  userParams = JSON.parse(text);
} catch (e) {
  fail('参数解析失败: ' + e.message + '（--params 需为 JSON 文件路径；PowerShell 下不建议内联 JSON）');
}
if (!userParams || typeof userParams !== 'object') fail('参数必须是 JSON 对象。');
let params;
try {
  params = REQUIREMENTS.assertGenerationAllowed(userParams, {
    source: 'CLI',
    confirmed: args.confirmRequirements === true || userParams.requirementConfirmed === true
  });
} catch (error) {
  fail('需求闸门阻止生成: ' + error.message +
    (error.code === 'EVSE_REQUIREMENT_CONFIRMATION_REQUIRED'
      ? ' 请复核参数与未决项后，在 JSON 中设置 requirementConfirmed=true，或显式传入 --confirm-requirements。'
      : ''));
}

/* ---------- 1. 确定性选型 + 语义图校验 ---------- */
let R;
try {
  R = win.EVSE_ENGINE.build(params);
} catch (e) {
  fail('选型引擎计算失败: ' + e.message);
}

/* ---------- 2. 六页图册编译与项目闸门 ---------- */
const sheetRenderer = win.EVSE_SCHEMATIC_SHEET_RENDERING || win.SCHEMATIC_FORGE_SHEET_RENDERING;
if (!sheetRenderer || typeof sheetRenderer.buildDocument !== 'function') {
  fail('多 Sheet 编译器未加载；禁止退回旧单页渲染。', 2);
}
let renderedDocument;
try {
  renderedDocument = sheetRenderer.buildDocument(R);
} catch (error) {
  fail('多 Sheet 编译失败: ' + error.message, 2);
}
const skill = R.drawingSkill || {};
const graph = skill.graphValidation || {};
const blocking = Number(graph.blockingCount || 0);
const projectGate = renderedDocument.projectGate || { status: 'BLOCKED', allowed: false };
const pageBlocked = renderedDocument.pages.some((page) => !page.pageGate || page.pageGate.allowed !== true);
const projectAllowed = blocking === 0 && projectGate.status !== 'BLOCKED' && !pageBlocked;
const gateSvg = { allowed: projectAllowed,
  reason: projectAllowed ? '六页图册、跨页连接、Drawing IR 和项目闸门通过。' : '多 Sheet 项目闸门未通过。' };
const gateDxf = Object.assign({}, gateSvg);

/* ---------- 3. 每页 SVG / DXF 直接输出 ---------- */
const outDir = path.resolve(args.out || '.');
fs.mkdirSync(outDir, { recursive: true });
const safeName = String(args.name || ((R.pileName || '充电桩') + '_电气原理图')).replace(/[\\/:*?"<>|]/g, '_');

const files = { pages: [] };
if (projectAllowed) {
  renderedDocument.pages.forEach((page) => {
    const drawingNo = String(page.sheet && page.sheet.drawingNo || page.sheetId).replace(/[^A-Za-z0-9_.-]/g, '_');
    const entry = { sheetId: page.sheetId, drawingNo, svg: safeName + '_' + drawingNo + '.svg', dxf: null,
      drawingIRHash: page.geometryHash, pageGate: page.pageGate.status };
    fs.writeFileSync(path.join(outDir, entry.svg), '<?xml version="1.0" encoding="UTF-8"?>\n' + page.svg, 'utf8');
    if (win.EVSE_DXF && typeof win.EVSE_DXF.exportDrawingIR === 'function') {
    const dxfOptions = {
        title: safeName + '_' + drawingNo,
      drawing: DRAWING_KEY,
      project: R.pileName,
      documentStatus: R.documentStatus,
        drawingIRHash: page.geometryHash,
      notice: '可编辑 DXF 概念草图；复杂符号、图层、线宽、比例和打印样式须在 CAD 模板中复核。'
    };
      const dxfResult = win.EVSE_DXF.exportDrawingIR(page.compiled.drawingIR, dxfOptions);
    const dxf = dxfResult && (dxfResult.dxf || dxfResult.text);
      if (!dxf || !/^\s*0\s*[\r\n]+SECTION/m.test(dxf)) fail('页面 ' + page.sheetId + ' 的 DXF 结果无效。', 2);
      const dxfAuditor = win.EVSE_RENDERED_DXF_AUDIT;
      const dxfAudit = dxfAuditor && typeof dxfAuditor.audit === 'function'
        ? dxfAuditor.audit(dxf, page.compiled.drawingIR)
        : { ok: false, errors: [{ code: 'DXF_READBACK_AUDITOR_MISSING' }] };
      if (!dxfAudit.ok) fail('页面 ' + page.sheetId + ' 的最终 DXF 反读审计未通过：' +
        (dxfAudit.errors || []).slice(0, 5).map((item) => item.code + ':' + item.id).join(', '), 2);
      entry.dxf = safeName + '_' + drawingNo + '.dxf';
      entry.dxfWarnings = Array.isArray(dxfResult.warnings) ? dxfResult.warnings : [];
      entry.dxfStats = dxfResult.stats || null;
      entry.dxfReadbackAudit = dxfAudit;
      fs.writeFileSync(path.join(outDir, entry.dxf), dxf, 'utf8');
    }
    files.pages.push(entry);
  });
}

/* ---------- 4. JSON 图册方案包 ---------- */
const engineeringBom = win.SCHEMATIC_ENGINEERING_BOM && typeof win.SCHEMATIC_ENGINEERING_BOM.build === 'function'
  ? win.SCHEMATIC_ENGINEERING_BOM.build(R) : null;
const delivery = win.SCHEMATIC_ENGINEERING_DELIVERY || win.EVSE_ENGINEERING_DELIVERY;
if (!delivery || typeof delivery.wiringCsv !== 'function' || typeof delivery.auditJson !== 'function') {
  fail('工程交付导出模块未加载，不能生成可追溯 PIN 接线表与审计证据。', 2);
}
files.bom = safeName + '_BOM.csv';
files.wiring = safeName + '_WIRING.csv';
files.rfq = safeName + '_RFQ.csv';
files.audit = safeName + '_AUDIT.json';
fs.writeFileSync(path.join(outDir, files.bom), delivery.bomCsv(engineeringBom), 'utf8');
fs.writeFileSync(path.join(outDir, files.wiring), delivery.wiringCsv(R), 'utf8');
fs.writeFileSync(path.join(outDir, files.rfq), delivery.rfqCsv(R), 'utf8');
const deliveryDocument = Object.assign({}, renderedDocument, {
  pages: renderedDocument.pages.map((page) => {
    const file = files.pages.find((entry) => entry.sheetId === page.sheetId);
    return Object.assign({}, page, { dxfReadbackAudit: file && file.dxfReadbackAudit || null });
  })
});
fs.writeFileSync(path.join(outDir, files.audit), delivery.auditJson(R, deliveryDocument), 'utf8');
const packageData = {
  schema: 'SCHEMATICFORGE-DIAGNOSTIC-PACKAGE/2.0',
  exportedAt: new Date().toISOString(),
  documentStatus: R.documentStatus,
  notice: '方案级自动原理图；不构成生产图、施工图、标准符合性证明、型式试验结论或设备报价。',
  releaseGate: R.releaseGate || (R.readiness && R.readiness.release) || { constructionDrawingAllowed: false },
  sourceModelHash: R.design && R.design.modelHash || null,
  schematicDocument: renderedDocument.document,
  renderedPageManifest: renderedDocument.pages.map((page) => ({
    sheetId: page.sheetId, drawingNo: page.sheet && page.sheet.drawingNo,
    geometryHash: page.geometryHash, projectionHash: page.projectionHash,
    pageGate: page.pageGate, svg: files.pages.find((entry) => entry.sheetId === page.sheetId)?.svg || null,
    dxf: files.pages.find((entry) => entry.sheetId === page.sheetId)?.dxf || null,
    dxfReadbackAudit: files.pages.find((entry) => entry.sheetId === page.sheetId)?.dxfReadbackAudit || null
  })),
  engineeringBom,
  engineeringDelivery: {
    bom: files.bom,
    exactPinWiring: files.wiring,
    rfqClarifications: files.rfq,
    auditEvidence: files.audit,
    candidateStatus: delivery.CANDIDATE_STATUS,
    approvalStatus: delivery.APPROVAL_STATUS
  },
  drawingSkill: {
    id: skill.id || null,
    version: skill.version || null,
    status: skill.status || null,
    blockingCount: blocking,
    renderBlockingCount: renderedDocument.pages.reduce((sum, page) => sum + Number(page.pageGate && page.pageGate.quality && page.pageGate.quality.blockingCount || 0), 0),
    evaluatedRules: (skill.evaluatedRuleIds || []).length
  },
  exports: { pages: files.pages, bom: files.bom, wiring: files.wiring, rfq: files.rfq, audit: files.audit },
  gates: { svg: gateSvg, dxf: gateDxf, project: projectGate },
  model: R
};
files.json = safeName + '.json';
fs.writeFileSync(path.join(outDir, files.json), JSON.stringify(packageData, null, 2), 'utf8');

/* ---------- 汇总 ---------- */
const get = (obj, keys, fallback) => {
  let cur = obj;
  for (const k of keys.split('.')) cur = cur == null ? undefined : cur[k];
  return cur == null ? fallback : cur;
};
const dc = R.dc || {}, ac = R.ac || {};
const lines = [
  '================ EVSE 原理图生成汇总 ================',
  '引擎: EVSE-ENGINE@' + (R.engineVersion || '?') + ' | 绘图规则: ' + (skill.id || 'MISSING') + '@' + (skill.version || '?') + ' (' + (skill.status || 'BLOCKED') + ')',
  '文档状态: ' + R.documentStatus,
  '桩名: ' + R.pileName + ' | 站点: ' + (R.site || '-') + ' | 标准: ' + get(R, 'standard.name', params.standard) + ' | 形态: ' + get(R, 'archetype.name', params.archetype),
  '额定 ' + (dc.ratedKw != null ? dc.ratedKw : '?') + 'kW / 装机 ' + (dc.installedKw != null ? dc.installedKw : '?') + 'kW | 模块 ' + (dc.moduleCount != null ? dc.moduleCount : '?') + ' × ' + (dc.moduleKw != null ? dc.moduleKw : params.moduleKw) + 'kW',
  '交流进线: ' + (ac.inputA != null ? ac.inputA : '?') + 'A / 断路器 ' + (ac.breakerA != null ? ac.breakerA : '?') + 'A',
  '直流母线: ' + get(R, 'calculations.dcOutput.mainCurrentA', '?') + 'A / 总快熔 ' + get(R, 'calculations.dcOutput.mainFuseA', '?') + 'A',
  '充电枪: ' + (R.guns || []).length + ' × ' + params.gunCurrentA + 'A | 输出窗口 ' + (dc.outputRangeText || params.voltageWindow),
  '储能: ' + (get(R, 'ess.enabled', false) ? (get(R, 'ess.installedKwh', '?') + 'kWh / 变换器 ' + get(R, 'ess.converterInstalledKw', '?') + 'kW / ' + get(R, 'ess.couplingName', params.essCoupling)) : '无'),
  '语义图阻断项: ' + blocking + ' | 渲染阻断项: ' + Number(skill.renderBlockingCount || 0),
  '项目图册闸门: ' + projectGate.status + ' | SVG: ' + (gateSvg.allowed ? '通过' : '阻断') + ' | DXF: ' + (gateDxf.allowed ? '通过' : '阻断')
];
lines.push('输出目录: ' + outDir);
files.pages.forEach((page) => lines.push('  - ' + page.sheetId + ': ' + page.svg + (page.dxf ? ' + ' + page.dxf : '')));
lines.push('  - JSON: ' + files.json);
lines.push('  - 工程 BOM: ' + files.bom);
lines.push('  - 精确 PIN 接线表: ' + files.wiring);
lines.push('  - RFQ 澄清表: ' + files.rfq);
lines.push('  - 审计证据: ' + files.audit);
lines.push('====================================================');
console.log(lines.join('\n'));

if (!projectAllowed) {
  console.error('[evse-schematic-design] 闸门阻断，未完整产出 SVG/DXF；原因见 JSON 方案包 gates 字段。');
  process.exit(2);
}
process.exit(0);
