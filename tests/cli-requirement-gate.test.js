'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

function run(params, extraArgs) {
  return spawnSync(process.execPath, [
    path.join(rootDir, 'scripts', 'generate.js'),
    '--params', JSON.stringify(params),
    '--out', os.tmpdir()
  ].concat(extraArgs || []), { cwd: rootDir, encoding: 'utf8' });
}

test('CLI 对受控枚举之外的标准 fail-closed', () => {
  const result = run({ standard: 'megacharge' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不在受控枚举|允许值|UNSUPPORTED/);
});

test('CLI 对低置信度自动翻译要求明确确认', () => {
  const result = run({ requirement: { source: 'SERVER_AI:test', confidence: 0.4 } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /确认|confirm-requirements/);
});

test('CLI 对显式非法值和越界参数 fail-closed', () => {
  const malformed = run({ outputKw: 'abc', essEnabled: 'maybe' });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /有限数字|true\/false|不能静默/);
  const belowMinimum = run({ outputKw: 19 });
  assert.equal(belowMinimum.status, 1);
  assert.match(belowMinimum.stderr, /20.*2000/);
});

test('CLI 导出实现不包含 SVG 反解析回退', () => {
  const source = require('node:fs').readFileSync(path.join(rootDir, 'scripts', 'generate.js'), 'utf8');
  assert.match(source, /exportDrawingIR\(page\.compiled\.drawingIR, dxfOptions\)/);
  assert.doesNotMatch(source, /exportSvgLegacy\(stamped/);
  assert.match(source, /drawingIRHash:\s*page\.geometryHash/);
  assert.match(source, /schematicDocument:\s*renderedDocument\.document/);
});
