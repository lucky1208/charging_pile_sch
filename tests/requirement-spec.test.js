'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SPEC = require('../engine/requirement-spec.js');

test('Web 与 CLI 使用同一组确定性默认参数', () => {
  const web = SPEC.normaliseParams({}, { source: 'FORM' });
  const cli = SPEC.normaliseParams({}, { source: 'CLI' });
  Object.keys(SPEC.DEFAULTS).forEach((key) => {
    if (key === 'requirementSource') return;
    assert.deepEqual(web[key], cli[key], key);
    assert.deepEqual(web[key], SPEC.DEFAULTS[key], key);
  });
  assert.equal(web.requirementSource, 'FORM');
  assert.equal(cli.requirementSource, 'CLI');
});

test('“无储能/不带储能”优先于宽泛的储能关键词', () => {
  assert.equal(SPEC.parseLocal('国标双枪 120kW，无储能').essEnabled, false);
  assert.equal(SPEC.parseLocal('欧标 240kW，不带储能电池').essEnabled, false);
  assert.equal(SPEC.parseLocal('国标 120kW，带 200kWh 储能').essEnabled, true);
});

test('NACS 与 CHAdeMO 不会被宽泛的美标/CAN 规则吞掉', () => {
  assert.equal(SPEC.normaliseStandard('美标 NACS / SAE J3400'), 'nacs');
  assert.equal(SPEC.normaliseStandard('日标 CHAdeMO CAN'), 'chademo');
  assert.equal(SPEC.parseLocal('NACS 四枪 480kW').standard, 'nacs');
  assert.equal(SPEC.parseLocal('CHAdeMO 双枪 120kW').standard, 'chademo');
});

test('四种桩型中文名称不会被宽泛“一体式”规则吞掉', () => {
  assert.equal(SPEC.normaliseArchetype('直流一体式'), 'dc-integrated');
  assert.equal(SPEC.normaliseArchetype('直流分体式功率柜+终端'), 'dc-split');
  assert.equal(SPEC.normaliseArchetype('交流一体式 AC+DC'), 'ac-dc-combo');
  assert.equal(SPEC.normaliseArchetype('储能移动充电桩'), 'ess-mobile');
});

test('标准改变时从共享映射得到对应交流输入电压', () => {
  assert.equal(SPEC.normaliseParams({ standard: 'gb' }, { source: 'CLI' }).acVoltage, 380);
  assert.equal(SPEC.normaliseParams({ standard: 'eu' }, { source: 'CLI' }).acVoltage, 400);
  assert.equal(SPEC.normaliseParams({ standard: 'us' }, { source: 'CLI' }).acVoltage, 480);
  assert.equal(SPEC.normaliseParams({ standard: 'nacs' }, { source: 'CLI' }).acVoltage, 480);
  assert.equal(SPEC.normaliseParams({ standard: 'chademo' }, { source: 'CLI' }).acVoltage, 400);
});

test('五种标准和四种桩型全部进入受控生成范围', () => {
  SPEC.ENUMS.standard.forEach((standard) => {
    SPEC.ENUMS.archetype.forEach((archetype) => {
      const params = SPEC.normaliseParams({ standard, archetype, essEnabled: archetype === 'ess-mobile' });
      assert.deepEqual(SPEC.supportIssues(params), [], standard + '/' + archetype);
    });
  });
  assert.ok(SPEC.generationGate({ archetype: 'ess-mobile', essEnabled: false }).issues
    .some((issue) => issue.code === 'ARCHETYPE_REQUIRES_ESS'));
});

test('低置信度、缺失置信度或未决项必须明确确认', () => {
  const low = SPEC.confirmationGate({ source: 'LOCAL_RULES', confidence: 0.55 }, false);
  assert.equal(low.allowed, false);
  assert.equal(low.requiresConfirmation, true);
  assert.equal(SPEC.confirmationGate({ source: 'SERVER_AI:test', confidence: null }, false).allowed, false);
  assert.equal(SPEC.confirmationGate({ source: 'SERVER_AI:test', confidence: 0.99, questions: ['站点接地型式？'] }, false).allowed, false);
  assert.equal(SPEC.confirmationGate({ source: 'SERVER_AI:test', confidence: 0.55 }, true).allowed, true);
  assert.equal(SPEC.confirmationGate({ source: 'FORM', confidence: null }, false).allowed, true);
});

test('来源、置信度和未决项进入规范化参数', () => {
  const params = SPEC.normaliseParams({
    requirement: { source: 'SERVER_AI:deepseek', confidence: 0.82, questions: ['确认短路容量'] }
  });
  assert.equal(params.requirementSource, 'SERVER_AI:deepseek');
  assert.equal(params.requirementConfidence, 0.82);
  assert.deepEqual(params.unresolvedItems, ['确认短路容量']);
});

test('生成闸门同时执行受控枚举与人工确认检查', () => {
  const blocked = SPEC.generationGate({
    standard: 'nacs',
    requirement: { source: 'LOCAL_RULES', confidence: 0.55 }
  });
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.issues, []);
  assert.equal(blocked.confirmation.allowed, false);

  const allowed = SPEC.generationGate({
    standard: 'nacs', archetype: 'dc-split',
    requirement: { source: 'LOCAL_RULES', confidence: 0.55 },
    requirementConfirmed: true
  });
  assert.equal(allowed.allowed, true);
});

test('显式非法数字和布尔值不会静默回退到默认值', () => {
  const gate = SPEC.generationGate({
    outputKw: 'abc', acVoltage: 'bad', essEnabled: 'maybe', lowTemp: 'unknown'
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.params.outputKw, null);
  assert.equal(gate.params.acVoltage, null);
  assert.equal(gate.params.essEnabled, null);
  assert.ok(gate.issues.some((issue) => issue.code === 'INVALID_NUMBER_FORMAT' && issue.field === 'outputKw'));
  assert.ok(gate.issues.some((issue) => issue.code === 'INVALID_NUMBER_FORMAT' && issue.field === 'acVoltage'));
  assert.ok(gate.issues.some((issue) => issue.code === 'INVALID_BOOLEAN_FORMAT' && issue.field === 'essEnabled'));
  assert.ok(gate.issues.some((issue) => issue.code === 'INVALID_BOOLEAN_FORMAT' && issue.field === 'lowTemp'));
});

test('显式 null、空串和非法标准也不得被当成缺省值', () => {
  const gate = SPEC.generationGate({ outputKw: null, inputPf: '', standard: null });
  assert.equal(gate.allowed, false);
  assert.equal(gate.params.outputKw, null);
  assert.equal(gate.params.inputPf, null);
  assert.equal(gate.params.standard, '');
  assert.ok(gate.issues.some((issue) => issue.code === 'INVALID_NUMBER_FORMAT' && issue.field === 'outputKw'));
  assert.ok(gate.issues.some((issue) => issue.code === 'INVALID_NUMBER_FORMAT' && issue.field === 'inputPf'));
  assert.ok(gate.issues.some((issue) => issue.code === 'UNSUPPORTED_STANDARD' && issue.field === 'standard'));
});

test('缺省值仍可回填，显式越界参数则 fail-closed', () => {
  assert.equal(SPEC.generationGate({}).allowed, true);
  const cases = [
    ['outputKw', 19], ['outputKw', 2001],
    ['moduleEfficiency', 0.79], ['moduleEfficiency', 1.01],
    ['inputPf', 0.79], ['inputPf', 1.01],
    ['essKwh', -1], ['essPowerKw', -1]
  ];
  cases.forEach(([field, value]) => {
    const gate = SPEC.generationGate({ [field]: value });
    assert.equal(gate.allowed, false, field + '=' + value);
    assert.ok(gate.issues.some((issue) => issue.field === field), field + '=' + value);
  });
  assert.ok(SPEC.generationGate({ standard: 'gb', acVoltage: 400 }).issues
    .some((issue) => issue.code === 'AC_VOLTAGE_STANDARD_MISMATCH'));
});

test('自然语言原文经安全清理后贯穿本地与 AI RequirementSpec', () => {
  const raw = '  国标双枪\u0000 120kW\r\n无储能<script>  ';
  const local = SPEC.parseLocal(raw);
  assert.equal(local.rawText, '国标双枪 120kW\n无储能<script>');
  assert.equal(local.essEnabled, false);
  const ai = SPEC.normaliseRequirement({ parsed: { standard: 'eu' }, sourceText: raw }, 'SERVER_AI:test');
  assert.equal(ai.rawText, local.rawText);
  const params = SPEC.normaliseParams({ requirement: ai });
  assert.equal(params.requirement.rawText, local.rawText);
});
