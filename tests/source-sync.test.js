'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { orderedEngineFiles, buildBrowserBundle } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');
const engineDir = path.join(rootDir, 'engine');
const webJsDir = path.join(rootDir, 'web', 'js');

test('每个 engine 模块都有字节一致的 Web 副本', () => {
  const files = orderedEngineFiles(engineDir);
  assert.ok(files.includes('requirement-spec.js'));
  files.forEach((filename) => {
    assert.equal(
      fs.readFileSync(path.join(webJsDir, filename), 'utf8'),
      fs.readFileSync(path.join(engineDir, filename), 'utf8'),
      filename + ' 已分叉；请运行 npm run sync:web'
    );
  });
});

test('web/js 不保留已经移除或未登记的核心镜像', () => {
  const allowed = new Set(orderedEngineFiles(engineDir).concat([
    'app.js',
    'engine-bundle.js'
  ]));
  const unexpected = fs.readdirSync(webJsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.js') && !allowed.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(unexpected, [], 'web/js 存在孤儿 JavaScript；删除旧核心镜像或将真正的交互入口加入显式白名单');
});

test('浏览器核心 bundle 可由 engine 唯一源码确定性重建', () => {
  assert.equal(
    fs.readFileSync(path.join(webJsDir, 'engine-bundle.js'), 'utf8'),
    buildBrowserBundle(engineDir),
    'engine-bundle.js 已过期；请运行 npm run sync:web'
  );
});

test('Web 只加载生成的核心 bundle，不再手工列举 engine 模块', () => {
  const html = fs.readFileSync(path.join(rootDir, 'web', 'index.html'), 'utf8');
  assert.match(html, /<script src="js\/engine-bundle\.js/);
  orderedEngineFiles(engineDir).forEach((filename) => {
    assert.doesNotMatch(html, new RegExp('<script[^>]+js/' + filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('Web 脚本查询版本由各自当前内容哈希生成', () => {
  const bundle = fs.readFileSync(path.join(webJsDir, 'engine-bundle.js'), 'utf8');
  const bundleCacheKey = 'sha256-' + crypto.createHash('sha256').update(bundle, 'utf8').digest('hex');
  const app = fs.readFileSync(path.join(webJsDir, 'app.js'));
  const appCacheKey = 'sha256-' + crypto.createHash('sha256').update(app).digest('hex');
  const html = fs.readFileSync(path.join(rootDir, 'web', 'index.html'), 'utf8');
  const expectedBundle = '<script src="js/engine-bundle.js?v=' + bundleCacheKey +
    '" data-generated-bundle-hash="' + bundleCacheKey + '"></script>';
  const expectedApp = '<script src="js/app.js?v=' + appCacheKey +
    '" data-generated-app-hash="' + appCacheKey + '"></script>';
  assert.ok(html.includes(expectedBundle), 'engine-bundle.js 缓存键过期；请运行 npm run sync:web');
  assert.ok(html.includes(expectedApp), 'app.js 缓存键过期；请运行 npm run sync:web');
  assert.equal((html.match(/data-generated-bundle-hash=/g) || []).length, 1, 'bundle 生成标记必须且只能出现一次');
  assert.equal((html.match(/data-generated-app-hash=/g) || []).length, 1, 'app 生成标记必须且只能出现一次');
});

test('生成的浏览器 bundle 可加载共享契约和确定性引擎', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(webJsDir, 'engine-bundle.js'), 'utf8'), {
    window,
    document: {},
    console,
    DOMParser: function DOMParser() {}
  }, { filename: 'engine-bundle.js' });
  assert.equal(typeof window.EVSE_REQUIREMENT_SPEC.normaliseParams, 'function');
  assert.equal(typeof window.EVSE_ENGINE.build, 'function');
  assert.equal(typeof window.drawPile, 'function');
});
