'use strict';
/* ============================================================
 * EVSE 充电桩电气原理图 一键生成脚本（Node 侧，无需浏览器 / API Key）
 * ------------------------------------------------------------
 * 用法（Windows PowerShell 下请用参数文件，避免引号被吞）:
 *   node scripts\generate.js --params params.json [--out <输出目录>] [--name <文件名前缀>]
 *
 * 流程与浏览器端 app.js 完全一致：
 *   1. EVSE_ENGINE.build(params)                 确定性选型 + 工程模型 + 语义图校验
 *   2. drawPile(R)                               渲染 A3 SVG
 *   3. EVSE_DRAWING_SKILL.auditMarkup(...)       渲染规则校验（sch_lib 规则包）
 *      recordDrawingAudit + finalizeDrawingAudits
 *   4. canExport 闸门（fail-closed）              不通过则不写 SVG/DXF
 *   5. EVSE_DXF.exportDrawingIR(R.drawingIR)     R2010 DXF 概念草图
 *   6. JSON 方案包（EVSE-SOLUTION-PACKAGE/1.0）
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
  '  standard(gb|eu|us) archetype(dc-integrated) outputKw gunCount(1-4) gunCurrentA(125|200|250|300|400)',
  '  moduleKw(15|20|30|40|60) voltageWindow thermal(air|liquid)',
  '  essEnabled essKwh essPowerKw essChem(lfp|nmc) essCoupling(dc|ac)',
  '输出目录: --out 未提供时使用当前工作目录',
  '输出文件: <name>.svg + <name>.dxf + <name>.json'
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

/* ---------- 2. 渲染 SVG ---------- */
let svg = '';
let renderError = null;
if (typeof win.drawPile === 'function') {
  try {
    svg = win.drawPile(R);
  } catch (e) {
    renderError = e.message;
  }
}

/* ---------- 3. 渲染规则校验（与 app.js renderDrawing 同序） ---------- */
if (SKILL && typeof SKILL.recordDrawingAudit === 'function') {
  if (svg && typeof SKILL.auditMarkup === 'function') {
    SKILL.recordDrawingAudit(R, DRAWING_KEY, SKILL.auditMarkup(svg, DRAWING_KEY, R));
  } else {
    SKILL.recordDrawingAudit(R, DRAWING_KEY, {
      drawingKey: DRAWING_KEY, status: 'BLOCKED', blockingCount: 1, evaluatedRuleIds: ['DOC-001'],
      checks: [{ code: 'G000-RENDER-ERROR', ok: false, severity: 'ERROR', detail: renderError || '渲染器未加载或无 SVG 输出。' }]
    });
  }
}
if (SKILL && typeof SKILL.finalizeDrawingAudits === 'function') SKILL.finalizeDrawingAudits(R);

const skill = R.drawingSkill || {};
const graph = skill.graphValidation || {};
const blocking = Number(graph.blockingCount || 0);

/* ---------- 4. 导出闸门（fail-closed） ---------- */
const gateSvg = SKILL && typeof SKILL.canExport === 'function'
  ? SKILL.canExport(R, DRAWING_KEY, 'SVG')
  : { allowed: false, reason: '绘图规则包未加载，禁止导出。' };
const gateDxf = SKILL && typeof SKILL.canExport === 'function'
  ? SKILL.canExport(R, DRAWING_KEY, 'DXF')
  : { allowed: false, reason: '绘图规则包未加载，禁止导出。' };

/* ---------- 审计戳记（与 app.js stampAudit 等效，作用于 SVG 字符串） ---------- */
function stampSvg(markup) {
  const report = R.drawingSkill || {};
  const audit = (report.drawingAudits || {})[DRAWING_KEY] || {};
  const meta = typeof SKILL.metadata === 'function' ? SKILL.metadata(R, DRAWING_KEY) : {};
  /* 与浏览器端 setAttribute 等效：根标签已有的属性覆盖、没有的新增，
   * 避免重复属性导致 XML 解析失败（symbols.js 已预写 skill-status/evaluated-rules）。 */
  const gt = markup.indexOf('>');
  if (gt === -1) return markup;
  let rootTag = markup.slice(0, gt);
  const setRootAttr = (name, value) => {
    const re = new RegExp('\\s' + name + '\\s*=\\s*"[^"]*"');
    rootTag = re.test(rootTag)
      ? rootTag.replace(re, ' ' + name + '="' + value + '"')
      : rootTag + ' ' + name + '="' + value + '"';
  };
  setRootAttr('data-drawing-audit-status', audit.status || 'BLOCKED');
  setRootAttr('data-drawing-skill-status', report.status || 'BLOCKED');
  setRootAttr('data-evaluated-rules', (meta.evaluatedRuleIds || []).join(','));
  let out = rootTag + markup.slice(gt);
  out = out.replace(/<metadata>([\s\S]*?)<\/metadata>/, (m, inner) => {
    try {
      const documentMeta = JSON.parse(inner);
      documentMeta.drawingSkill = Object.assign({}, documentMeta.drawingSkill || {}, meta, {
        status: report.status || 'BLOCKED',
        auditStatus: audit.status || 'BLOCKED',
        auditVersion: SKILL.VERSION || ''
      });
      return '<metadata>' + JSON.stringify(documentMeta) + '</metadata>';
    } catch (e) {
      return m;
    }
  });
  return out;
}

/* ---------- 5. 输出 ---------- */
const outDir = path.resolve(args.out || '.');
fs.mkdirSync(outDir, { recursive: true });
const safeName = String(args.name || ((R.pileName || '充电桩') + '_电气原理图')).replace(/[\\/:*?"<>|]/g, '_');

const files = {};
const packageExtras = { dxfWarnings: [], dxfStats: null };
if (gateSvg.allowed && svg) {
  const stamped = stampSvg(svg);
  files.svg = safeName + '.svg';
  fs.writeFileSync(path.join(outDir, files.svg), '<?xml version="1.0" encoding="UTF-8"?>\n' + stamped, 'utf8');

  if (gateDxf.allowed && win.EVSE_DXF) {
    const dxfOptions = {
      title: safeName,
      drawing: DRAWING_KEY,
      project: R.pileName,
      documentStatus: R.documentStatus,
      notice: '可编辑 DXF 概念草图；复杂符号、图层、线宽、比例和打印样式须在 CAD 模板中复核。'
    };
    if (!R.drawingIR || typeof win.EVSE_DXF.exportDrawingIR !== 'function') {
      fail('Drawing IR 缺失或直接 DXF 导出器未加载；禁止从 SVG 反向猜测几何。', 2);
    }
    const dxfResult = win.EVSE_DXF.exportDrawingIR(R.drawingIR, dxfOptions);
    const dxf = dxfResult && (dxfResult.dxf || dxfResult.text);
    if (dxf && /^\s*0\s*[\r\n]+SECTION/m.test(dxf)) {
      files.dxf = safeName + '.dxf';
      fs.writeFileSync(path.join(outDir, files.dxf), dxf, 'utf8');
      packageExtras.dxfWarnings = Array.isArray(dxfResult.warnings) ? dxfResult.warnings : [];
      packageExtras.dxfStats = dxfResult.stats || null;
    }
  }
}

/* ---------- 6. JSON 方案包 ---------- */
const packageData = {
  schema: 'EVSE-SOLUTION-PACKAGE/1.0',
  exportedAt: new Date().toISOString(),
  documentStatus: R.documentStatus,
  notice: '方案级自动原理图；不构成生产图、施工图、标准符合性证明、型式试验结论或设备报价。',
  releaseGate: R.releaseGate || (R.readiness && R.readiness.release) || { constructionDrawingAllowed: false },
  drawingGeometryHash: R.drawingGeometryHash || null,
  drawingIR: R.drawingIR || null,
  drawingSkill: {
    id: skill.id || null,
    version: skill.version || null,
    status: skill.status || null,
    blockingCount: blocking,
    renderBlockingCount: Number(skill.renderBlockingCount || 0),
    evaluatedRules: (skill.evaluatedRuleIds || []).length
  },
  exports: {
    svg: files.svg || null,
    dxf: files.dxf || null,
    dxfWarnings: packageExtras.dxfWarnings,
    dxfStats: packageExtras.dxfStats
  },
  gates: { svg: gateSvg, dxf: gateDxf },
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
  'SVG 闸门: ' + (gateSvg.allowed ? '通过' : '阻断(' + gateSvg.reason + ')') + ' | DXF 闸门: ' + (gateDxf.allowed ? '通过' : '阻断(' + gateDxf.reason + ')')
];
if (packageExtras.dxfWarnings.length) lines.push('DXF 转换提示: ' + packageExtras.dxfWarnings.join('；'));
lines.push('输出目录: ' + outDir);
Object.keys(files).forEach((k) => lines.push('  - ' + k.toUpperCase() + ': ' + files[k]));
lines.push('====================================================');
console.log(lines.join('\n'));

if (!gateSvg.allowed || !gateDxf.allowed || blocking > 0) {
  console.error('[evse-schematic-design] 闸门阻断，未完整产出 SVG/DXF；原因见 JSON 方案包 gates 字段。');
  process.exit(2);
}
process.exit(0);
