/* 充电桩选型引擎回归套件: node tests/engine.test.js */
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
/* 保持与浏览器一致的加载顺序 */
['symbols.js', 'ev-standards.js', 'design-model.js', 'drawing-skill.js', 'vendors.js',
  'engine.js', 'layout.js', 'draw-pile.js'].forEach(load);

const sample = {
  pileName: '测试超充桩', site: '上海', standard: 'gb', archetype: 'dc-integrated',
  outputKw: 480, gunCount: 4, gunCurrentA: 250, voltageWindow: '200-1000', moduleKw: 40,
  acVoltage: 380, supplyMode: 'transformer', thermal: 'liquid',
  essEnabled: true, essKwh: 200, essChem: 'lfp', essCoupling: 'dc', essPowerKw: 120,
  backend: 'ocpp16', hmiSize: '10 英寸', pref: 'balance'
};

/* ---------- 1. 确定性 ---------- */
const R1 = win.EVSE_ENGINE.build(sample);
const R2 = win.EVSE_ENGINE.build(sample);
assert.strictEqual(JSON.stringify(R1), JSON.stringify(R2), '相同输入必须生成完全一致的工程模型');
assert.strictEqual(R1.engineVersion, '3.0.0');
assert.strictEqual(R1.design.schemaVersion, '3.0.0');
assert.strictEqual(R1.documentStatus, 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED');
assert.strictEqual(R1.drawingSkill.id, 'EVSE-SCH-LIB-DRAWING-SKILL');
assert.strictEqual(R1.drawingSkill.graphValidation.blockingCount, 0, '正常模型必须通过端口/拓扑规则校验');
assert.strictEqual(R1.releaseGate.constructionDrawingAllowed, false, '自动引擎不得开放生产/施工图发布');
assert.strictEqual(R1.readiness.level, 'CONCEPT_ONLY');

/* ---------- 2. 功率模块与直流侧 ---------- */
assert.strictEqual(R1.dc.moduleCount, 12, '480kW / 40kW 应为 12 台模块');
assert.strictEqual(R1.dc.installedKw, 480);
assert.strictEqual(R1.dc.mainCurrentA, 1000, '直流总电流取“按功率”与“按枪数×枪电流”的较小值');
assert.ok(R1.dc.mainFuseA >= R1.dc.mainCurrentA * 1.25, '直流总快熔必须留 25% 以上裕度');
assert.ok(R1.dc.sensorRangeA >= R1.dc.mainCurrentA, '电流传感器量程不得低于额定电流');

/* ---------- 3. 交流进线必须包含辅助与热管理负荷 ---------- */
const moduleOnlyKva = R1.dc.installedKw / 0.95 / 0.99;
assert.ok(R1.ac.inputKva > moduleOnlyKva, '进线容量必须计入辅助电源与热管理负荷');
assert.ok(R1.ac.auxDemandKw > 0);
assert.ok(R1.ac.breakerA >= R1.ac.inputA * 1.25, '进线断路器必须按 1.25 倍以上选型');
assert.ok(win.EV_STD.SERIES.breakerA.includes(R1.ac.breakerA), '断路器必须落在标称档位序列上');
assert.ok(win.EV_STD.SERIES.acContactorA.includes(R1.ac.contactorA));

/* ---------- 4. 枪回路 ---------- */
assert.strictEqual(R1.guns.length, 4);
R1.guns.forEach((gun) => {
  assert.ok(gun.fuseA >= gun.currentA * 1.25, '枪快熔必须留裕度');
  assert.ok(gun.contactorA >= gun.currentA * 1.25, '枪接触器必须留裕度');
  assert.ok(gun.pins.includes('DC+') && gun.pins.includes('DC-') && gun.pins.includes('PE'));
});
assert.ok(R1.guns[0].pins.includes('CC1') && R1.guns[0].pins.includes('S+'), '国标枪必须含 CC1/CC2 与 S+/S-');

/* 位号必须全图唯一：主回路 FU1 不得与枪回路重名 */
const tags = R1.schedule.map((row) => row.tag);
assert.strictEqual(tags.length, new Set(tags).size, '设备明细表位号必须唯一');
assert.ok(tags.includes('FU1') && tags.includes('F1') && !tags.filter((t) => t === 'FU1')[1]);

/* ---------- 5. 储能：优先最少簇数，不得拆成一堆小簇 ---------- */
assert.strictEqual(R1.ess.enabled, true);
assert.strictEqual(R1.ess.clusterCount, 1, '200kWh 应由 1 簇满足，而不是多簇小电芯');
assert.ok(R1.ess.installedKwh >= R1.ess.requestedKwh, '装机容量不得低于目标容量');
assert.ok(R1.ess.usableKwh < R1.ess.installedKwh, '可用容量必须按 DOD 折减');
assert.strictEqual(R1.ess.coupling, 'dc');
assert.ok(R1.ess.converterInstalledKw >= 120);
assert.ok(R1.ess.clusterFuseA > 0 && R1.ess.clusterContactorA > 0 && R1.ess.prechargeR > 0);

/* ---------- 6. 无储能时不得残留储能对象 ---------- */
const noEss = win.EVSE_ENGINE.build(Object.assign({}, sample, { essEnabled: false }));
assert.strictEqual(noEss.ess.enabled, false);
assert.strictEqual(noEss.design.equipment.filter((item) => item.kind === 'battery-cluster').length, 0);
assert.strictEqual(noEss.design.equipment.filter((item) => /^ess-/.test(item.kind)).length, 0);
assert.ok(!noEss.schedule.some((row) => /电池簇/.test(row.name)));
assert.strictEqual(noEss.drawingSkill.graphValidation.blockingCount, 0);

/* ---------- 7. 三种标准都能生成完整模型 ---------- */
['gb', 'eu', 'us'].forEach((id) => {
  const R = win.EVSE_ENGINE.build(Object.assign({}, sample, { standard: id, acVoltage: null }));
  assert.strictEqual(R.standardId, id);
  assert.strictEqual(R.drawingSkill.graphValidation.blockingCount, 0, id + ' 语义图必须无阻断项');
  assert.strictEqual(R.ac.lineVoltage, win.EV_STD.standard(id).acLineVoltage, id + ' 未选电压时应采用标准默认进线电压');
  if (id === 'us') assert.strictEqual(R.ac.neutral, false, '美标 480V Delta 无中性线');
  const markup = win.drawPile(R);
  win.EV_STD.standard(id).controlPins.forEach((pin) => {
    assert.ok(markup.includes(pin), id + ' 图面必须标注控制导引端子 ' + pin);
  });
});

/* ---------- 8. 工程模型完整性 ---------- */
const design = R1.design;
const equipmentIds = design.equipment.map((item) => item.id);
assert.strictEqual(equipmentIds.length, new Set(equipmentIds).size, '设备 ID 必须唯一');
const refs = design.equipment.map((item) => item.referenceDesignation);
assert.strictEqual(refs.length, new Set(refs).size, '参考代号必须唯一');
design.circuits.forEach((edge) => {
  assert.ok(edge.netClass && edge.direction, edge.id + ' 缺少网络类别或方向');
  if (edge.kind === 'signal') assert.ok(edge.protocol, edge.id + ' 信号边必须声明协议');
});
assert.strictEqual(design.topology.gunBranches.length, 4);
assert.deepStrictEqual(design.documentControl.drawingRegister.map((item) => item.key), ['ev-schematic']);

/* ---------- 9. 校核清单不得伪装成合规结论 ---------- */
const statusText = JSON.stringify({ validation: R1.validation, compliance: R1.compliance });
assert.ok(!/\b(?:PASS|COMPLIANT|CERTIFIED|APPROVED)\b/i.test(statusText), '校核清单不得输出合规/签发结论');
assert.ok(R1.validation.some((item) => item.result === 'NOT_CHECKED'), '必须保留未校核项');
assert.ok(R1.bom.every((item) => item.status === 'RFQ_REQUIRED'), '所有目录条目必须标记 RFQ_REQUIRED');

/* ---------- 10. 输入越界时给出警告而不是静默 ---------- */
const badWindow = win.EVSE_ENGINE.build(Object.assign({}, sample, { moduleKw: 15, voltageWindow: '200-1000' }));
assert.ok(badWindow.dc.moduleCount === 32, '15kW 模块承担 480kW 需要 32 台');
const highC = win.EVSE_ENGINE.build(Object.assign({}, sample, { essKwh: 100, essPowerKw: 250 }));
assert.ok(highC.warnings.some((item) => /C/.test(item)), '高倍率储能必须给出警告');

console.log('充电桩引擎回归通过：确定性、模块/进线/枪回路选型、储能簇配置、三标准模型与校核边界。');
