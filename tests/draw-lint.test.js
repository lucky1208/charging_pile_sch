/* 图纸专业度体检（无需 LLM）：检测文字重叠 / 越界 / 图幅溢出
 * 用法: node tests/draw-lint.test.js
 * 目标：所有参数组合下文字重叠均为 0，且没有文字越出图框 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const win = {};
function load(name) {
  (new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'js', name), 'utf8')))(win, {});
}
['symbols.js', 'ev-standards.js', 'design-model.js', 'drawing-skill.js', 'vendors.js',
  'engine.js', 'layout.js', 'draw-pile.js'].forEach(load);

function textWidth(value, size) {
  let width = 0;
  for (const ch of value) width += (ch.codePointAt(0) > 0x2e80 ? size : size * 0.58);
  return width;
}
/* 解析整个 <text> 标签的属性，不依赖属性书写顺序：
 * 早期版本只读 font-size 之后的属性，会把 text-anchor="end" 的文字
 * 误判成左对齐，从而漏报/误报越界。 */
function extractTexts(svg) {
  const out = [];
  const re = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/g;
  const attr = (source, name) => {
    const hit = new RegExp(name + '="([^"]*)"').exec(source);
    return hit ? hit[1] : null;
  };
  let m;
  while ((m = re.exec(svg))) {
    const attrs = m[1], raw = m[2].replace(/<[^>]+>/g, '');
    const x = Number(attr(attrs, 'x')), y = Number(attr(attrs, 'y'));
    const size = Number(attr(attrs, 'font-size'));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || !raw) continue;
    const width = textWidth(raw, size);
    const anchor = attr(attrs, 'text-anchor');
    let left = x;
    if (anchor === 'middle') left = x - width / 2;
    else if (anchor === 'end') left = x - width;
    out.push({ left, top: y - size * 0.85, right: left + width, bottom: y + size * 0.2, raw: raw.slice(0, 16), y });
  }
  return out;
}
function overlaps(texts) {
  const bad = [];
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i], b = texts[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
        bad.push([a.raw, b.raw, Math.round(a.left), Math.round(a.y), Math.round(b.left), Math.round(b.y)]);
      }
    }
  }
  return bad;
}

const base = {
  pileName: '图纸体检桩', site: '上海', archetype: 'dc-integrated',
  voltageWindow: '200-1000', supplyMode: 'grid', backend: 'ocpp16', pref: 'balance'
};
/* 覆盖标准、枪数、模块功率、热管理与储能耦合的组合边界 */
const cases = [
  ['国标 单枪 60kW 无储能', { standard: 'gb', outputKw: 60, gunCount: 1, gunCurrentA: 125, moduleKw: 20, thermal: 'air', essEnabled: false }],
  ['国标 双枪 240kW 直流耦合储能', { standard: 'gb', outputKw: 240, gunCount: 2, gunCurrentA: 250, moduleKw: 30, thermal: 'air', essEnabled: true, essKwh: 200, essCoupling: 'dc', essPowerKw: 120 }],
  ['欧标 双枪 360kW 交流耦合储能', { standard: 'eu', outputKw: 360, gunCount: 2, gunCurrentA: 300, moduleKw: 40, thermal: 'liquid', essEnabled: true, essKwh: 500, essCoupling: 'ac', essPowerKw: 250 }],
  ['美标 四枪 600kW 液冷储能', { standard: 'us', outputKw: 600, gunCount: 4, gunCurrentA: 400, moduleKw: 60, thermal: 'liquid', essEnabled: true, essKwh: 1000, essCoupling: 'dc', essPowerKw: 240 }],
  ['国标 三枪 480kW 无储能 高压平台', { standard: 'gb', outputKw: 480, gunCount: 3, gunCurrentA: 250, moduleKw: 40, thermal: 'liquid', essEnabled: false, voltageWindow: '500-1000' }]
];

const FRAME = { left: 14, top: 14, right: 1666, bottom: 1174 };
let totalOverlap = 0, totalOutside = 0;

for (const [name, params] of cases) {
  const R = win.EVSE_ENGINE.build(Object.assign({}, base, params));
  const svg = win.drawPile(R);
  const texts = extractTexts(svg);
  const bad = overlaps(texts);
  const outside = texts.filter((t) => t.left < FRAME.left || t.right > FRAME.right || t.top < FRAME.top || t.bottom > FRAME.bottom);
  totalOverlap += bad.length;
  totalOutside += outside.length;
  console.log(`\n【${name}】文字 ${texts.length} 个 · 重叠 ${bad.length} 处 · 越界 ${outside.length} 处`);
  bad.slice(0, 8).forEach((p) => console.log(`   重叠: "${p[0]}"@(${p[2]},${p[3]}) × "${p[1]}"@(${p[4]},${p[5]})`));
  outside.slice(0, 8).forEach((t) => console.log(`   越界: "${t.raw}" [${Math.round(t.left)},${Math.round(t.top)}]-[${Math.round(t.right)},${Math.round(t.bottom)}]`));
  assert.ok(texts.length > 120, name + ' 文本数量异常少，图纸可能未完整渲染');
}

console.log('\n=== 总重叠 ' + totalOverlap + ' 处 · 总越界 ' + totalOutside + ' 处（专业目标: 0 / 0）===');
assert.strictEqual(totalOverlap, 0, '图纸文字重叠必须为 0');
assert.strictEqual(totalOutside, 0, '图纸文字不得越出 A3 图框');
