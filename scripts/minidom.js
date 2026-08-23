'use strict';
/* ============================================================
 * 最小 XML DOM shim —— 仅供 generate.js 在 Node 侧运行 dxf-export.js 使用。
 * 只实现 dxf-export 用到的只读子集：
 *   DOMParser.parseFromString / doc.querySelector('parsererror') /
 *   doc.documentElement / node.tagName|nodeName|nodeType|getAttribute|
 *   parentElement|textContent|querySelector|querySelectorAll('a,b,c')
 * 输入必须是良构 XML（symbols.js 生成的 SVG 满足；属性值经 esc() 转义）。
 * 不用于浏览器环境（浏览器有原生 DOMParser，不会加载本文件）。
 * ============================================================ */

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

class MiniNode {
  constructor(tag) {
    this.nodeType = 1;
    this._tag = tag;
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.text = '';
  }
  get tagName() { return this._tag; }
  get nodeName() { return this._tag; }
  get parentElement() { return this.parent && this.parent.nodeType === 1 ? this.parent : null; }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  get textContent() {
    let out = this.text;
    for (const c of this.children) out += c.textContent;
    return out;
  }
  walk(fn) {
    fn(this);
    for (const c of this.children) c.walk(fn);
  }
  querySelectorAll(selector) {
    const tags = String(selector).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const out = [];
    this.walk((n) => {
      if (n !== this && tags.indexOf(String(n._tag).toLowerCase()) !== -1) out.push(n);
    });
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function parseError(root, msg) {
  const e = new MiniNode('parsererror');
  e.text = msg;
  e.parent = root;
  root.children.push(e);
  return root;
}

function parseXml(markup) {
  const src = String(markup || '');
  const root = new MiniNode('#document');
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      const t = src.slice(i);
      if (t.trim()) stack[stack.length - 1].text += decodeEntities(t);
      break;
    }
    if (lt > i) {
      const t = src.slice(i, lt);
      if (t) stack[stack.length - 1].text += decodeEntities(t);
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt);
      if (end === -1) return parseError(root, '未闭合的处理指令');
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      if (end === -1) return parseError(root, '未闭合的注释');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      if (end === -1) return parseError(root, '未闭合的 DOCTYPE');
      i = end + 1;
      continue;
    }
    if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt);
      if (end === -1) return parseError(root, '未闭合的结束标签');
      const name = src.slice(lt + 2, end).trim();
      for (let k = stack.length - 1; k >= 1; k -= 1) {
        if (stack[k]._tag === name) { stack.length = k; break; }
      }
      i = end + 1;
      continue;
    }
    const end = src.indexOf('>', lt);
    if (end === -1) return parseError(root, '未闭合的开始标签');
    let inner = src.slice(lt + 1, end);
    const selfClose = inner.endsWith('/');
    if (selfClose) inner = inner.slice(0, -1);
    const m = inner.match(/^([A-Za-z_][\w:.-]*)/);
    if (!m) return parseError(root, '非法标签名: ' + inner.slice(0, 20));
    const node = new MiniNode(m[1]);
    const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = attrRe.exec(inner)) !== null) {
      node.attrs[am[1]] = decodeEntities(am[2] != null ? am[2] : am[3]);
    }
    const top = stack[stack.length - 1];
    node.parent = top;
    top.children.push(node);
    if (!selfClose) stack.push(node);
    i = end + 1;
  }
  if (stack.length !== 1) return parseError(root, '存在未闭合标签');
  return root;
}

class DOMParserShim {
  parseFromString(markup) {
    const doc = parseXml(markup);
    const documentElement = doc.children.find((c) => c.nodeType === 1) || null;
    return {
      documentElement,
      querySelector: (sel) => doc.querySelector(sel),
      querySelectorAll: (sel) => doc.querySelectorAll(sel)
    };
  }
}

module.exports = { DOMParser: DOMParserShim };
