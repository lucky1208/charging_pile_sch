'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { orderedEngineFiles, buildBrowserBundle } = require('./core-modules.js');

const rootDir = path.resolve(__dirname, '..');
const engineDir = path.join(rootDir, 'engine');
const webJsDir = path.join(rootDir, 'web', 'js');
const webIndexPath = path.join(rootDir, 'web', 'index.html');
const webAppPath = path.join(webJsDir, 'app.js');
const files = orderedEngineFiles(engineDir);
const bundle = buildBrowserBundle(engineDir);
const bundleCacheKey = 'sha256-' + crypto.createHash('sha256').update(bundle, 'utf8').digest('hex');
const appCacheKey = 'sha256-' + crypto.createHash('sha256').update(fs.readFileSync(webAppPath)).digest('hex');

fs.mkdirSync(webJsDir, { recursive: true });
files.forEach((filename) => {
  fs.copyFileSync(path.join(engineDir, filename), path.join(webJsDir, filename));
});
fs.writeFileSync(path.join(webJsDir, 'engine-bundle.js'), bundle, 'utf8');

const indexHtml = fs.readFileSync(webIndexPath, 'utf8');
const bundleScriptPattern = /<script\b[^>]*\bsrc=(["'])js\/engine-bundle\.js(?:\?v=[^"']*)?\1[^>]*><\/script>/gi;
const bundleScriptMatches = indexHtml.match(bundleScriptPattern) || [];
if (bundleScriptMatches.length !== 1) {
  throw new Error('web/index.html 必须且只能包含一个 engine-bundle.js script 标记。');
}
const bundleScript = '<script src="js/engine-bundle.js?v=' + bundleCacheKey +
  '" data-generated-bundle-hash="' + bundleCacheKey + '"></script>';
let nextIndexHtml = indexHtml.replace(bundleScriptPattern, bundleScript);

const appScriptPattern = /<script\b[^>]*\bsrc=(["'])js\/app\.js(?:\?v=[^"']*)?\1[^>]*><\/script>/gi;
const appScriptMatches = nextIndexHtml.match(appScriptPattern) || [];
if (appScriptMatches.length !== 1) {
  throw new Error('web/index.html 必须且只能包含一个 app.js script 标记。');
}
const appScript = '<script src="js/app.js?v=' + appCacheKey +
  '" data-generated-app-hash="' + appCacheKey + '"></script>';
nextIndexHtml = nextIndexHtml.replace(appScriptPattern, appScript);
fs.writeFileSync(webIndexPath, nextIndexHtml, 'utf8');

console.log('[sync:web] 已从 engine/ 同步 ' + files.length + ' 个模块并生成 web/js/engine-bundle.js');
console.log('[sync:web] 浏览器缓存键: bundle=' + bundleCacheKey + ' app=' + appCacheKey);
console.log('[sync:web] 加载顺序: ' + files.join(' -> '));
