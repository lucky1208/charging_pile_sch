'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');

function runtime() {
  const win = {};
  const engineDir = path.join(rootDir, 'engine');
  orderedEngineFiles(engineDir).forEach((file) => {
    const source = fs.readFileSync(path.join(engineDir, file), 'utf8');
    new Function('window', 'document', source)(win, {});
  });
  return win;
}

test('RequirementSpec 原文来源进入最终 EDEM 设计包且保持纯数据', () => {
  const win = runtime();
  const requirement = win.EVSE_REQUIREMENT_SPEC.parseLocal('国标双枪 120kW，无储能 <img src=x onerror=alert(1)>');
  const params = win.EVSE_REQUIREMENT_SPEC.assertGenerationAllowed({
    requirement,
    requirementConfirmed: true
  }, { confirmed: true });
  const result = win.EVSE_ENGINE.build(params);
  assert.equal(result.design.requirements.source.source, 'LOCAL_RULES');
  assert.equal(result.design.requirements.source.rawText, requirement.rawText);
  assert.match(result.design.requirements.source.rawText, /<img src=x/);
  assert.equal(typeof result.design.requirements.source.rawText, 'string');
});
