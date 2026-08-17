/* sch_lib 绘图规则包回归套件: node tests/drawing-skill.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function freshWindow() {
  const win = {};
  ['symbols.js', 'ev-standards.js', 'design-model.js', 'drawing-skill.js', 'vendors.js',
    'engine.js', 'layout.js', 'draw-pile.js'].forEach((name) => {
    (new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'js', name), 'utf8')))(win, {});
  });
  return win;
}
const win = freshWindow();
const SKILL = win.EVSE_DRAWING_SKILL;

const base = {
  pileName: '规则包测试桩', site: '深圳', standard: 'eu', archetype: 'dc-integrated',
  outputKw: 240, gunCount: 2, gunCurrentA: 300, voltageWindow: '150-1000', moduleKw: 30,
  supplyMode: 'grid', thermal: 'liquid', essEnabled: true, essKwh: 215, essChem: 'lfp',
  essCoupling: 'ac', essPowerKw: 100, backend: 'ocpp201', pref: 'balance'
};
const build = (overrides) => win.EVSE_ENGINE.build(Object.assign({}, base, overrides || {}));

/* ---------- 1. 规则包身份与 profile ---------- */
assert.strictEqual(SKILL.ID, 'EVSE-SCH-LIB-DRAWING-SKILL');
assert.strictEqual(SKILL.DRAWING_KEY, 'ev-schematic');
assert.deepStrictEqual(Object.keys(SKILL.PROFILES), ['ev-schematic'], '只保留充电桩原理图 profile');
assert.strictEqual(SKILL.profileFor('cooling-pid'), null, '已删除的图型不得静默复用其他 profile');
assert.strictEqual(SKILL.SOURCE_LIBRARY.length, 2);
SKILL.SOURCE_LIBRARY.forEach((item) => assert.ok(/^sch_lib\//.test(item.file), '参考图必须指向 sch_lib 目录'));
/* 规则包只承认参考图是证据，不得声明合规 */
const skillSource = fs.readFileSync(path.join(ROOT, 'js', 'drawing-skill.js'), 'utf8');
assert.ok(/不是标准符合性证书|不构成标准符合性/.test(skillSource));

/* ---------- 2. 正常模型必须全绿 ---------- */
const R = build();
assert.strictEqual(R.drawingSkill.status, 'ACTIVE');
assert.strictEqual(R.drawingSkill.graphValidation.blockingCount, 0);
assert.ok(R.drawingSkill.evaluatedRuleIds.length >= 10, '必须真正执行了多条机器可检查规则');
/* 只有产生了检查结果的规则才能计入 evaluated，其余留作人工复核 */
assert.ok(R.drawingSkill.skippedRuleIds.length > 0, '指导类规则必须显式标记为待人工复核');
R.drawingSkill.skippedRuleIds.forEach((item) => assert.ok(/PROFESSIONAL/.test(item.reason)));

/* ---------- 3. 语义图规则能真正抓到缺陷 ---------- */
function mutate(mutator) {
  const local = build();
  mutator(local);
  return SKILL.validateGraph(local);
}
const codes = (result) => result.violations.map((item) => item.code);

/* 3.1 去掉一把枪的快熔 → 枪回路保护规则报警 */
let out = mutate((local) => {
  const branch = local.design.topology.gunBranches[0];
  local.design.equipment = local.design.equipment.filter((item) => item.id !== branch.fuse);
});
assert.ok(codes(out).includes('E021-GUN-PROTECTION'), '缺少枪快熔必须被 EVS-001 拦截');

/* 3.2 断开枪的 PE → 接地规则报警 */
out = mutate((local) => {
  local.design.circuits = local.design.circuits.filter((edge) => !/^CCT-G1-06$/.test(edge.id));
});
assert.ok(codes(out).includes('E022-GUN-EARTH'), '缺少枪 PE 必须被 EVS-002 拦截');

/* 3.3 把储能直接搭到充电直流母线 → 变换设备规则报警 */
out = mutate((local) => {
  const edge = local.design.circuits.find((item) => item.id === 'CCT-ESS-CV2');
  edge.to = 'EQ-DC-BUS';
  edge.toPort = 'in';
  edge.netClass = 'POWER_DC_ESS';
});
assert.ok(codes(out).includes('E031-ESS-CONVERSION'), '储能直连充电母线必须被 ESS-002 拦截');

/* 3.4 电池簇绕过保护单元 → 预充/主接触器规则报警 */
out = mutate((local) => {
  const edge = local.design.circuits.find((item) => item.id === 'CCT-ESS-1-01');
  edge.to = 'EQ-ESS-BUS';
  edge.toPort = 'in';
});
assert.ok(codes(out).includes('E030-ESS-PROTECTION'), '电池簇绕过保护必须被 ESS-001 拦截');

/* 3.5 把控制信号伪装成功率回路 → 分域规则报警 */
out = mutate((local) => {
  const edge = local.design.circuits.find((item) => item.kind === 'signal');
  edge.netClass = 'POWER_DC';
});
assert.ok(codes(out).includes('E008-CONTROL-SEPARATION') || codes(out).includes('E002-PORT-NETCLASS'),
  '控制边混入功率网络必须被 TOP-005 拦截');

/* 3.6 辅助电源直接从功率母线取电 → 辅助电源规则报警 */
out = mutate((local) => {
  const edge = local.design.circuits.find((item) => item.id === 'CCT-AUX-03');
  edge.from = 'EQ-DC-BUS';
  edge.fromPort = 'out';
});
assert.ok(codes(out).includes('E025-AUX-SOURCE') || codes(out).includes('E002-PORT-NETCLASS'),
  '辅助电源违规取电必须被 AUX-001 拦截');

/* 3.7 位号重复 → 唯一性规则报警 */
out = mutate((local) => { local.design.equipment[2].referenceDesignation = local.design.equipment[1].referenceDesignation; });
assert.ok(codes(out).includes('E004-REFERENCE'), '参考代号重复必须被 TAG-001 拦截');

/* 3.8 删掉交流进线保护 → 交流侧规则报警 */
out = mutate((local) => {
  local.design.equipment = local.design.equipment.filter((item) => item.kind !== 'surge-protector');
});
assert.ok(codes(out).includes('E020-AC-PROTECTION'), '缺少 SPD 必须被 EVS-004 拦截');

/* ---------- 4. 渲染前置检查 ---------- */
const markup = win.drawPile(R);
const audit = SKILL.auditMarkup(markup, 'ev-schematic', R);
assert.strictEqual(audit.blockingCount, 0, '正常渲染不得有阻断项：' +
  audit.checks.filter((c) => !c.ok).map((c) => c.code).join(','));
assert.strictEqual(audit.profile, 'ev-power-schematic');
/* 少画图例、明细表或接地都必须被抓到 */
[['图例 LEGEND', 'G005-LEGEND'], ['设备明细表', 'G006-SCHEDULE'], ['PE 保护接地排', 'G012-PE'], ['开关电源', 'G013-AUX']]
  .forEach(([token, code]) => {
    const broken = SKILL.auditMarkup(markup.split(token).join('＿'), 'ev-schematic', R);
    assert.ok(broken.checks.some((check) => check.code === code && !check.ok), code + ' 未能抓到缺失的“' + token + '”');
  });
const unknown = SKILL.auditMarkup(markup, 'not-a-profile', R);
assert.strictEqual(unknown.status, 'BLOCKED', '未知 profile 必须阻断而不是静默通过');

/* ---------- 5. 导出闸门 ---------- */
assert.strictEqual(SKILL.canExport(R, 'ev-schematic', 'SVG').allowed, false, '未记录审计前禁止导出');
SKILL.recordDrawingAudit(R, 'ev-schematic', audit);
SKILL.finalizeDrawingAudits(R);
assert.strictEqual(SKILL.canExport(R, 'ev-schematic', 'SVG').allowed, true);
assert.strictEqual(SKILL.canExport(R, 'ev-schematic', 'DXF').allowed, true);
assert.ok(/不得作为生产图/.test(SKILL.canExport(R, 'ev-schematic', 'SVG').reason), '允许导出时必须同时声明边界');

const blocked = build();
SKILL.recordDrawingAudit(blocked, 'ev-schematic', {
  drawingKey: 'ev-schematic', status: 'BLOCKED', blockingCount: 1, evaluatedRuleIds: ['DOC-001'],
  checks: [{ code: 'G001-A3', ruleId: 'DOC-001', ok: false, severity: 'ERROR', detail: '测试注入' }]
});
SKILL.finalizeDrawingAudits(blocked);
assert.strictEqual(blocked.drawingSkill.status, 'BLOCKED');
assert.strictEqual(SKILL.canExport(blocked, 'ev-schematic', 'SVG').allowed, false, '渲染阻断时必须禁止导出');
assert.ok(blocked.warnings.some((item) => /禁止导出/.test(item)));

/* ---------- 6. 规则包缺失时引擎必须失败即封闭 ---------- */
const bare = {};
['symbols.js', 'ev-standards.js', 'design-model.js', 'vendors.js', 'engine.js', 'layout.js'].forEach((name) => {
  (new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'js', name), 'utf8')))(bare, {});
});
const noSkill = bare.EVSE_ENGINE.build(base);
assert.strictEqual(noSkill.drawingSkill.id, 'EVSE-DRAWING-SKILL-MISSING');
assert.strictEqual(noSkill.drawingSkill.status, 'BLOCKED');
assert.ok(noSkill.readiness.blockingItems.some((item) => item.id === 'DRAW-SKILL-MISSING'));

console.log('绘图规则包回归通过：profile 隔离、8 类语义缺陷拦截、渲染前置检查与导出闸门。');
