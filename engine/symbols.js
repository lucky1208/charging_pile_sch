/* ============================================================
 * 充电桩概念符号库 + CAD 图框组件  v2.0
 * ------------------------------------------------------------
 * 参考基线（须由项目专业人员复核适用性）：
 *  - IEC 60617 / GB/T 4728 图形符号参考
 *  - sch_lib 参考图确认的画法：导线接命名端子、正交走线、
 *    真实连接画实心点、几何交叉画跨线、母线线宽 ≥3 倍普通线宽、
 *    功率/控制/通信分域并配图例
 * ------------------------------------------------------------
 * 全部符号为纯函数，返回 SVG 字符串，可直接拼装。它们是方案级
 * 占位表达，不能单独作为 IEC/GB 符号合规、生产图或审图结论。
 * ============================================================ */
window.SYM = (function () {
  'use strict';

  /* ---------- 颜色规范 EVSE-COLOR-SCHEME v1.0（依据见 js/color-scheme.js） ----------
   * IEC 60446 识别色：PE 绿(专用)、N 蓝(专用)、相线棕；直流红系；
   * 其余为项目约定；设备块底色用所属回路浅色 fill.*；G041 闸门白名单自检。 */
  const C = window.EVSE_COLOR_SCHEME ? window.EVSE_COLOR_SCHEME.palette() : {
    ink: '#0f172a', ac: '#92400e', n: '#0284c7', dc: '#dc2626', ess: '#ea580c',
    aux: '#0e7490', ctl: '#475569', comm: '#7c3aed', pe: '#15803d', saf: '#dc2626',
    warn: '#ca8a04', anno: '#64748b', grid: '#cbd5e1',
    fill: { ac: '#fff7ed', dc: '#fef2f2', ess: '#ffedd5', comm: '#f5f3ff', ctl: '#f1f5f9', aux: '#ecfeff', def: '#f8fafc', white: '#ffffff' }
  };

  const FONT = "'Segoe UI','Microsoft YaHei',sans-serif";
  const MONO = "Consolas,'Courier New',monospace";

  const DEFAULT_CAD_LAYER_MANIFEST = [
    { name: 'EVSE-FRAME', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.50, purpose: '图框、标题栏、修订栏' },
    { name: 'EVSE-TEXT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '标题、说明、位号' },
    { name: 'EVSE-ANNO', color: 8, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '待核说明、参考注释' },
    { name: 'EVSE-EQPT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '设备外形与符号' },
    { name: 'EVSE-AC', color: 34, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '交流主回路（相线棕 IEC 60446；N 另见 EVSE-AC 屏色 #0284c7）' },
    { name: 'EVSE-DC', color: 1, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '充电直流主回路' },
    { name: 'EVSE-ESS', color: 30, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '储能直流回路' },
    { name: 'EVSE-AUX', color: 4, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '辅助直流电源 24V/12V' },
    { name: 'EVSE-CTL', color: 8, linetype: 'DASHED', lineweightMm: 0.18, purpose: '控制、联锁与采样信号' },
    { name: 'EVSE-COMM', color: 6, linetype: 'DASHED', lineweightMm: 0.18, purpose: '通信总线与后台链路' },
    { name: 'EVSE-PE', color: 3, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '保护接地与等电位' }
  ];

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  /* 中文按全宽、西文按 0.58 宽估算，用于截断与排版避让 */
  function textWidth(value, size) {
    let width = 0;
    for (const ch of String(value == null ? '' : value)) width += (ch.codePointAt(0) > 0x2e80 ? size : size * 0.58);
    return width;
  }
  function clip(value, size, maxWidth) {
    const text = String(value == null ? '' : value);
    if (textWidth(text, size) <= maxWidth) return text;
    let out = '';
    for (const ch of text) {
      if (textWidth(out + ch + '…', size) > maxWidth) break;
      out += ch;
    }
    return out + '…';
  }
  /* 把长文本按可用宽度折成若干行（用于设备明细表） */
  function wrap(value, size, maxWidth, maxLines) {
    const text = String(value == null ? '' : value);
    const lines = [];
    let current = '';
    for (const ch of text) {
      if (textWidth(current + ch, size) > maxWidth && current) {
        lines.push(current);
        current = ch;
        if (lines.length === (maxLines || 3) - 1) break;
      } else current += ch;
    }
    const rest = text.slice(lines.join('').length);
    lines.push(lines.length === (maxLines || 3) - 1 ? clip(rest, size, maxWidth) : current);
    return lines.filter((line) => line !== '');
  }

  /* ---------- 基础图元 ---------- */
  function txt(x, y, s, size, color, anchor, weight, font) {
    return `<text x="${x}" y="${y}" font-size="${size || 10}" fill="${color || C.ink}"
      font-family="${font || FONT}" ${anchor ? 'text-anchor="' + anchor + '"' : ''}
      ${weight ? 'font-weight="' + weight + '"' : ''}>${esc(s)}</text>`;
  }

  /* 正交布线（无斜线）：先横后竖或先竖后横 */
  function wire(x1, y1, x2, y2, color, w, dash, midY) {
    const c = color || C.ac, sw = w || 1.4;
    const d = dash ? `stroke-dasharray="${dash}"` : '';
    if (Math.abs(x1 - x2) < 0.5 || Math.abs(y1 - y2) < 0.5)
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" ${d}/>`;
    const my = midY !== undefined ? midY : y1;
    return `<polyline points="${x1},${y1} ${x1},${my} ${x2},${my} ${x2},${y2}" fill="none"
      stroke="${c}" stroke-width="${sw}" stroke-linejoin="round" ${d}/>`;
  }
  /* 真实连接点 */
  function jdot(x, y, color, r) {
    return `<circle cx="${x}" cy="${y}" r="${r || 2.6}" fill="${color || C.ink}"/>`;
  }
  /* 竖线跨过横线的半圆跳线（交叉不连接） */
  function jumpV(cx, cy, color, r) {
    const c = color || C.ink, rr = r || 6;
    return `<path d="M${cx},${cy - rr} A${rr},${rr} 0 0,1 ${cx},${cy + rr}" fill="none" stroke="${c}" stroke-width="1.5"/>`;
  }
  /* 横线跨过竖线的半圆跳线 */
  function jumpH(cx, cy, color, r) {
    const c = color || C.ink, rr = r || 6;
    return `<path d="M${cx - rr},${cy} A${rr},${rr} 0 0,1 ${cx + rr},${cy}" fill="none" stroke="${c}" stroke-width="1.5"/>`;
  }
  /* 水印：图面中央斜置半透明大字，画在内容层之下；
   * text 带 data-watermark 标记，供图纸体检（重叠检查）豁免。 */
  function watermark(W, H, text) {
    const t = esc(String(text == null ? '' : text).trim().slice(0, 12));
    if (!t) return '';
    const size = Math.min(170, Math.round((W * 0.62) / t.length * 1.05));
    return `<g id="EVSE-WATERMARK" data-layer="EVSE-ANNO">
    <text x="${W / 2}" y="${H / 2}" font-size="${size}" font-weight="bold" fill="#94a3b8" fill-opacity="0.10" font-family="${FONT}" text-anchor="middle" data-watermark="1" transform="rotate(-24 ${W / 2} ${H / 2})">${t}</text>
  </g>`;
  }
  /* 母线（线宽 ≥3 倍普通线） */
  function bus(x, y, len, color, w) {
    return `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y}" stroke="${color || C.dc}" stroke-width="${w || 4.5}" stroke-linecap="round"/>`;
  }
  function vbus(x, y, len, color, w) {
    return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + len}" stroke="${color || C.ac}" stroke-width="${w || 4.5}" stroke-linecap="round"/>`;
  }
  /* 设备/功能容器 */
  function block(x, y, w, h, color, title, sub, fill, inner) {
    const c = color || C.ink;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill || '#f8fafc'}"
      stroke="${c}" stroke-width="1.5" rx="3"/>
    ${inner || ''}
    ${title ? txt(x + w / 2, y + (sub ? h / 2 - 1 : h / 2 + 3.5), clip(title, 9.5, w - 10), 9.5, c, 'middle', 'bold') : ''}
    ${sub ? txt(x + w / 2, y + h / 2 + 12, clip(sub, 7.5, w - 8), 7.5, C.ink, 'middle') : ''}`;
  }
  /* 分区虚线边界 */
  function zone(x, y, w, h, label, color) {
    const c = color || '#94a3b8';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${c}"
      stroke-width="1" stroke-dasharray="6,4" rx="4"/>
      ${txt(x + 8, y + 13, label, 9, '#64748b', 'start', 'bold')}`;
  }

  /* ---------- 端子排 ---------- */
  function terminals(x, y, labels, color, w) {
    const c = color || C.ink, width = w || 30, rowH = 13;
    let s = `<rect x="${x}" y="${y}" width="${width}" height="${labels.length * rowH}" fill="#fff" stroke="${c}" stroke-width="1.2"/>`;
    labels.forEach((label, i) => {
      const yy = y + i * rowH;
      if (i) s += `<line x1="${x}" y1="${yy}" x2="${x + width}" y2="${yy}" stroke="${c}" stroke-width="0.7"/>`;
      s += txt(x + width / 2, yy + 9.4, label, 7, c, 'middle', '', MONO);
    });
    return s;
  }

  /* ---------- 竖向串联元件（能量自上而下） ----------
   * V 为各符号的标准占位高度，渲染器按此累加走线长度。 */
  const V = { fu: 30, contact: 30, res: 30 };

  function vres(cx, y0, color, tag) {
    const c = color || C.ink;
    return `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y0 + 7}" stroke="${c}" stroke-width="1.4"/>
    <rect x="${cx - 7}" y="${y0 + 7}" width="14" height="16" fill="#fff" stroke="${c}" stroke-width="1.3"/>
    <line x1="${cx}" y1="${y0 + 23}" x2="${cx}" y2="${y0 + V.res}" stroke="${c}" stroke-width="1.4"/>
    ${tag ? txt(cx + 11, y0 + 18, tag, 7.5, c, 'start', '', MONO) : ''}`;
  }
  /* 直流接触器（常开主触点 + 线圈标记） */
  function vcontact(cx, y0, color, tag, tagSide) {
    const c = color || C.dc, side = tagSide === 'left' ? -1 : 1;
    return `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y0 + 8}" stroke="${c}" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${y0 + 8}" r="2.2" fill="${c}"/>
    <line x1="${cx}" y1="${y0 + 8}" x2="${cx + 13}" y2="${y0 + 20}" stroke="${c}" stroke-width="1.4"/>
    <circle cx="${cx}" cy="${y0 + 22}" r="2.2" fill="none" stroke="${c}" stroke-width="1.3"/>
    <line x1="${cx}" y1="${y0 + 22}" x2="${cx}" y2="${y0 + V.contact}" stroke="${c}" stroke-width="1.5"/>
    ${tag ? txt(cx + side * 5, y0 + 6, tag, 7.5, c, side < 0 ? 'end' : 'start', 'bold', MONO) : ''}`;
  }
  function vfuse(cx, y0, color, tag, tagSide) {
    const c = color || C.dc, side = tagSide === 'left' ? -1 : 1;
    return `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y0 + 6}" stroke="${c}" stroke-width="1.5"/>
    <rect x="${cx - 6}" y="${y0 + 6}" width="12" height="18" fill="#fff" stroke="${c}" stroke-width="1.3"/>
    <line x1="${cx}" y1="${y0 + 6}" x2="${cx}" y2="${y0 + 24}" stroke="${c}" stroke-width="1"/>
    <line x1="${cx}" y1="${y0 + 24}" x2="${cx}" y2="${y0 + V.fu}" stroke="${c}" stroke-width="1.5"/>
    ${tag ? txt(cx + side * 9, y0 + 19, tag, 7.5, c, side < 0 ? 'end' : 'start', 'bold', MONO) : ''}`;
  }
  /* 浪涌保护器（对地支路） */
  function spd(cx, y0, color, tag) {
    const c = color || '#9333ea';
    return `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y0 + 6}" stroke="${c}" stroke-width="1.4"/>
    <rect x="${cx - 9}" y="${y0 + 6}" width="18" height="16" fill="#fff" stroke="${c}" stroke-width="1.3"/>
    <path d="M${cx - 5},${y0 + 18} L${cx + 5},${y0 + 10}" stroke="${c}" stroke-width="1.3" fill="none"/>
    <line x1="${cx}" y1="${y0 + 22}" x2="${cx}" y2="${y0 + 30}" stroke="${c}" stroke-width="1.4"/>
    ${tag ? txt(cx + 13, y0 + 17, tag, 7.5, c, 'start', 'bold', MONO) : ''}`;
  }

  /* ---------- 横向串联元件（能量自左向右），单元宽 44 ---------- */
  const H = 44;
  function hfuse(x, y, color, tag) {
    const c = color || C.ac;
    return `<line x1="${x}" y1="${y}" x2="${x + 13}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    <rect x="${x + 13}" y="${y - 6}" width="18" height="12" fill="#fff" stroke="${c}" stroke-width="1.3"/>
    <line x1="${x + 13}" y1="${y}" x2="${x + 31}" y2="${y}" stroke="${c}" stroke-width="1"/>
    <line x1="${x + 31}" y1="${y}" x2="${x + H}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    ${tag ? txt(x + H / 2, y - 11, tag, 7.5, c, 'middle', 'bold', MONO) : ''}`;
  }
  function hbreaker(x, y, color, tag) {
    const c = color || C.ac;
    return `<line x1="${x}" y1="${y}" x2="${x + 12}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    <rect x="${x + 12}" y="${y - 8}" width="20" height="16" fill="#fff" stroke="${c}" stroke-width="1.4"/>
    <line x1="${x + 12}" y1="${y + 8}" x2="${x + 32}" y2="${y - 8}" stroke="${c}" stroke-width="1.1"/>
    <line x1="${x + 32}" y1="${y}" x2="${x + H}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    ${tag ? txt(x + H / 2, y - 13, tag, 7.5, c, 'middle', 'bold', MONO) : ''}`;
  }
  function hisolator(x, y, color, tag) {
    const c = color || C.ac;
    return `<line x1="${x}" y1="${y}" x2="${x + 12}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    <circle cx="${x + 12}" cy="${y}" r="2.2" fill="${c}"/>
    <line x1="${x + 12}" y1="${y}" x2="${x + 30}" y2="${y - 11}" stroke="${c}" stroke-width="1.4"/>
    <circle cx="${x + 32}" cy="${y}" r="2.2" fill="none" stroke="${c}" stroke-width="1.3"/>
    <line x1="${x + 32}" y1="${y}" x2="${x + H}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    ${tag ? txt(x + H / 2, y - 15, tag, 7.5, c, 'middle', 'bold', MONO) : ''}`;
  }
  function hcontact(x, y, color, tag) {
    const c = color || C.ac;
    return `<line x1="${x}" y1="${y}" x2="${x + 12}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    <circle cx="${x + 12}" cy="${y}" r="2.2" fill="${c}"/>
    <line x1="${x + 12}" y1="${y}" x2="${x + 30}" y2="${y - 10}" stroke="${c}" stroke-width="1.4"/>
    <circle cx="${x + 32}" cy="${y}" r="2.2" fill="none" stroke="${c}" stroke-width="1.3"/>
    <line x1="${x + 32}" y1="${y}" x2="${x + H}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    <line x1="${x + 21}" y1="${y - 5}" x2="${x + 21}" y2="${y + 12}" stroke="${c}" stroke-width="0.9" stroke-dasharray="3,2"/>
    <rect x="${x + 15}" y="${y + 12}" width="12" height="7" fill="#fff" stroke="${c}" stroke-width="1"/>
    ${tag ? txt(x + H / 2, y - 13, tag, 7.5, c, 'middle', 'bold', MONO) : ''}`;
  }
  function hsensor(x, y, color, tag, kind) {
    const c = color || C.ink;
    return `<line x1="${x}" y1="${y}" x2="${x + 13}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    <circle cx="${x + H / 2}" cy="${y}" r="9" fill="#fff" stroke="${c}" stroke-width="1.3"/>
    ${txt(x + H / 2, y + 3.2, kind || 'A', 8, c, 'middle', '', MONO)}
    <line x1="${x + 31}" y1="${y}" x2="${x + H}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    ${tag ? txt(x + H / 2, y - 13, tag, 7.5, c, 'middle', 'bold', MONO) : ''}`;
  }
  function hres(x, y, color, tag) {
    const c = color || C.ess;
    return `<line x1="${x}" y1="${y}" x2="${x + 10}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    <rect x="${x + 10}" y="${y - 7}" width="24" height="14" fill="#fff" stroke="${c}" stroke-width="1.3"/>
    <line x1="${x + 34}" y1="${y}" x2="${x + H}" y2="${y}" stroke="${c}" stroke-width="1.5"/>
    ${tag ? txt(x + H / 2, y - 12, tag, 7.5, c, 'middle', 'bold', MONO) : ''}`;
  }

  /* ---------- 变换设备（矩形 + 对角线 + 左右域标注） ---------- */
  function converter(x, y, w, h, color, leftDomain, rightDomain, title, sub) {
    const c = color || C.dc;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${c}" stroke-width="1.6" rx="3"/>
    <line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y}" stroke="${c}" stroke-width="1.2"/>
    ${txt(x + w * 0.24, y + h * 0.34, leftDomain, 9, c, 'middle', 'bold', MONO)}
    ${txt(x + w * 0.76, y + h * 0.76, rightDomain, 9, c, 'middle', 'bold', MONO)}
    ${title ? txt(x + w / 2, y - 7, clip(title, 9, w + 40), 9, c, 'middle', 'bold') : ''}
    ${sub ? txt(x + w / 2, y + h + 12, clip(sub, 7.5, w + 60), 7.5, C.ink, 'middle') : ''}`;
  }

  /* 功率模块阵列：外框 + 若干模块条 */
  function moduleArray(x, y, w, h, color, rows, title, sub) {
    const c = color || C.dc, n = Math.max(1, Math.min(4, rows || 3));
    const pad = 8, innerH = (h - pad * 2 - (n - 1) * 5) / n;
    let inner = '';
    for (let i = 0; i < n; i += 1) {
      const yy = y + pad + i * (innerH + 5);
      inner += `<rect x="${x + pad}" y="${yy}" width="${w - pad * 2}" height="${innerH}" fill="#fff" stroke="${c}" stroke-width="1.1" rx="2"/>
      <line x1="${x + pad}" y1="${yy + innerH}" x2="${x + w - pad}" y2="${yy}" stroke="${c}" stroke-width="0.9"/>
      ${txt(x + pad + (w - pad * 2) * 0.26, yy + innerH * 0.42, 'AC', 7, c, 'middle', '', MONO)}
      ${txt(x + pad + (w - pad * 2) * 0.74, yy + innerH * 0.82, 'DC', 7, c, 'middle', '', MONO)}`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fef2f2" stroke="${c}" stroke-width="1.6" rx="3"/>
      ${inner}
      ${title ? txt(x + w / 2, y - 8, title, 9.5, c, 'middle', 'bold') : ''}
      ${sub ? txt(x + w / 2, y + h + 12, sub, 7.5, C.ink, 'middle') : ''}`;
  }

  /* 电池簇：外框 + 电池极板符号 */
  function batteryCluster(x, y, w, h, color, title, sub) {
    const c = color || C.ess, cy = y + h / 2;
    const inner = `<line x1="${x + 14}" y1="${cy - 11}" x2="${x + 14}" y2="${cy + 11}" stroke="${c}" stroke-width="1.5"/>
      <line x1="${x + 21}" y1="${cy - 6}" x2="${x + 21}" y2="${cy + 6}" stroke="${c}" stroke-width="3"/>
      <line x1="${x + 28}" y1="${cy - 11}" x2="${x + 28}" y2="${cy + 11}" stroke="${c}" stroke-width="1.5"/>
      <line x1="${x + 35}" y1="${cy - 6}" x2="${x + 35}" y2="${cy + 6}" stroke="${c}" stroke-width="3"/>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.fill.ess}" stroke="${c}" stroke-width="1.5" rx="3"/>
      ${inner}
      ${txt(x + 48, y + (sub ? h / 2 - 1 : h / 2 + 3), clip(title, 9, w - 54), 9, c, 'start', 'bold')}
      ${sub ? txt(x + 48, y + h / 2 + 11, clip(sub, 7, w - 54), 7, C.ink, 'start') : ''}`;
  }

  /* 保护接地 */
  function pe(cx, y0, color) {
    const c = color || C.pe;
    return `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y0 + 4}" stroke="${c}" stroke-width="1.8"/>
    <line x1="${cx - 11}" y1="${y0 + 5}" x2="${cx + 11}" y2="${y0 + 5}" stroke="${c}" stroke-width="1.6"/>
    <line x1="${cx - 7}" y1="${y0 + 10}" x2="${cx + 7}" y2="${y0 + 10}" stroke="${c}" stroke-width="1.5"/>
    <line x1="${cx - 3}" y1="${y0 + 15}" x2="${cx + 3}" y2="${y0 + 15}" stroke="${c}" stroke-width="1.4"/>`;
  }

  /* ---------- 充电枪（按标准画外形与端子） ---------- */
  /* 枪头端子坐标：完全由 connector-library 数据驱动（五类枪头），
   * 返回 { <pinId>: [x,y], peLeadX?, peLeadY? }，供符号与外部接线共用。 */
  function gunTerminals(cx, cy, type) {
    const lib = window.EVSE_CONNECTOR_LIB;
    const def = lib ? lib.get(type) : null;
    const out = {};
    if (!def) return out;
    def.pins.forEach((p) => { out[p.id] = [cx + p.dx, cy + p.dy]; });
    const pe = def.pins.find((p) => p.kind === 'pe');
    if (pe && pe.lead) { out.peLeadX = cx + pe.lead.x; out.peLeadY = cy + pe.lead.y; }
    return out;
  }

  /* 枪头符号：外廓 + 全部触头 + 信号/PE 引出线，均按库数据绘制 */
  function connector(cx, cy, type, color) {
    const c = color || C.dc;
    const def = window.EVSE_CONNECTOR_LIB.get(type);
    let s = '';
    def.outline.forEach((o) => {
      s += `<circle cx="${cx + o.dx}" cy="${cy + o.dy}" r="${o.r}" fill="#fff" stroke="${c}" stroke-width="${o.w}"/>`;
    });
    def.pins.forEach((p) => {
      const w = p.kind === 'power' ? 1.6 : (p.kind === 'aux' ? 0.8 : 1);
      s += `<circle cx="${cx + p.dx}" cy="${cy + p.dy}" r="${p.r}" fill="#fff" stroke="${c}" stroke-width="${w}"/>`;
      if (p.lead) {
        if (p.kind === 'pe') {
          /* PE 顶部引出线横跨 DC± 电源立线处走半圆 */
          const py = cy + p.lead.y;
          s += `<path d="M${cx + p.dx},${cy + p.dy - p.r} L${cx + p.dx},${py} L${cx + 15},${py} A3,3 0 0,1 ${cx + 21},${py} L${cx + p.lead.x},${py}" fill="none" stroke="${c}" stroke-width="1.2"/>`;
        } else {
          const x0 = cx + p.dx + (p.dx > 0 ? p.r : -p.r);
          const x1 = cx + p.lead.x;
          const y = cy + p.dy;
          const crossX = cx + (p.dx > 0 ? 18 : -18);
          if (Math.min(x0, x1) + 2 < crossX && crossX < Math.max(x0, x1) - 2) {
            const a = Math.min(x0, x1), b = Math.max(x0, x1);
            s += `<line x1="${a}" y1="${y}" x2="${crossX - 3}" y2="${y}" stroke="${c}" stroke-width="1.2"/>`;
            s += `<path d="M${crossX - 3},${y} A3,3 0 0,1 ${crossX + 3},${y}" fill="none" stroke="${c}" stroke-width="1.2"/>`;
            s += `<line x1="${crossX + 3}" y1="${y}" x2="${b}" y2="${y}" stroke="${c}" stroke-width="1.2"/>`;
          } else {
            s += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${c}" stroke-width="1.2"/>`;
          }
        }
      }
    });
    return s;
  }

  /* ---------- 二次设备小符号 ---------- */
  function estop(cx, cy, color) {
    const c = color || '#dc2626';
    return `<circle cx="${cx}" cy="${cy}" r="11" fill="#fff" stroke="${c}" stroke-width="1.8"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="${c}" opacity="0.85"/>
    <line x1="${cx}" y1="${cy + 11}" x2="${cx}" y2="${cy + 18}" stroke="${c}" stroke-width="1.4"/>`;
  }
  function lamp(cx, cy, color) {
    const c = color || '#ca8a04';
    return `<circle cx="${cx}" cy="${cy}" r="9" fill="#fff" stroke="${c}" stroke-width="1.5"/>
    <line x1="${cx - 6.4}" y1="${cy - 6.4}" x2="${cx + 6.4}" y2="${cy + 6.4}" stroke="${c}" stroke-width="1.1"/>
    <line x1="${cx + 6.4}" y1="${cy - 6.4}" x2="${cx - 6.4}" y2="${cy + 6.4}" stroke="${c}" stroke-width="1.1"/>`;
  }
  function fan(cx, cy, color) {
    const c = color || C.aux;
    return `<circle cx="${cx}" cy="${cy}" r="11" fill="#fff" stroke="${c}" stroke-width="1.4"/>
    <path d="M${cx},${cy} q7,-9 11,-2 q-6,4 -11,2 M${cx},${cy} q-9,-7 -2,-11 q4,6 2,11 M${cx},${cy} q9,7 2,11 q-4,-6 -2,-11 M${cx},${cy} q-7,9 -11,2 q6,-4 11,-2"
      fill="none" stroke="${c}" stroke-width="1.1"/>`;
  }
  function antenna(cx, cy, color) {
    const c = color || C.comm;
    return `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 16}" stroke="${c}" stroke-width="1.5"/>
    <path d="M${cx - 8},${cy - 16} L${cx},${cy - 24} L${cx + 8},${cy - 16}" fill="none" stroke="${c}" stroke-width="1.3"/>
    <path d="M${cx - 13},${cy - 12} a13,13 0 0 1 26,0" fill="none" stroke="${c}" stroke-width="1" stroke-dasharray="3,2"/>`;
  }

  /* ---------- 图例 ---------- */
  function legend(items, x, y, w) {
    const c = C.ink, width = w || 220;
    let s = `<rect x="${x}" y="${y}" width="${width}" height="${items.length * 17 + 26}" fill="#fff"
      stroke="${c}" stroke-width="1.1" rx="3"/>
    ${txt(x + 10, y + 16, '图例 LEGEND', 9.5, c, 'start', 'bold')}`;
    items.forEach((item, i) => {
      const yy = y + 31 + i * 17;
      s += `<line x1="${x + 10}" y1="${yy}" x2="${x + 44}" y2="${yy}" stroke="${item.color}"
        stroke-width="${item.thick || 1.6}" ${item.dash ? `stroke-dasharray="${item.dash}"` : ''}/>`;
      s += txt(x + 50, yy + 3.2, clip(item.label, 8, width - 58), 8, '#334155', 'start');
    });
    return s;
  }

  /* ---------- 设备明细表（图上只放位号，规格集中在此） ---------- */
  function schedule(rows, x, y, w, title) {
    const c = C.ink, headH = 16, lineH = 9.4, pad = 3.2;
    const c1 = x + 46, c2 = x + 122;
    const specWidth = x + w - c2 - 6;
    const prepared = rows.map((row) => ({
      tag: row.tag, name: clip(row.name, 6.8, c2 - c1 - 6),
      lines: wrap(row.spec, 6.4, specWidth, 3)
    }));
    const heights = prepared.map((row) => Math.max(row.lines.length, 1) * lineH + pad);
    const total = headH + heights.reduce((sum, h) => sum + h, 0);
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${total}" fill="#fff" stroke="${c}" stroke-width="1.2"/>
    ${txt(x + w / 2, y - 6, title || '设备明细表（规格为方案级档位，须经 RFQ 与专业校核）', 8.5, c, 'middle', 'bold')}
    <line x1="${x}" y1="${y + headH}" x2="${x + w}" y2="${y + headH}" stroke="${c}" stroke-width="0.9"/>
    <line x1="${c1}" y1="${y}" x2="${c1}" y2="${y + total}" stroke="${c}" stroke-width="0.7"/>
    <line x1="${c2}" y1="${y}" x2="${c2}" y2="${y + total}" stroke="${c}" stroke-width="0.7"/>
    ${txt(x + 5, y + 11, '位号', 7.5, c, 'start', 'bold')}
    ${txt(c1 + 5, y + 11, '名称', 7.5, c, 'start', 'bold')}
    ${txt(c2 + 5, y + 11, '规格 / 状态', 7.5, c, 'start', 'bold')}`;
    let cursor = y + headH;
    prepared.forEach((row, i) => {
      s += txt(x + 5, cursor + 8, clip(row.tag, 6.8, 38), 6.8, c, 'start', 'bold', MONO);
      s += txt(c1 + 5, cursor + 8, row.name, 6.8, c, 'start');
      row.lines.forEach((line, li) => {
        s += txt(c2 + 5, cursor + 8 + li * lineH, line, 6.4, '#334155', 'start');
      });
      cursor += heights[i];
      if (i < prepared.length - 1) s += `<line x1="${x}" y1="${cursor}" x2="${x + w}" y2="${cursor}" stroke="${c}" stroke-width="0.5"/>`;
    });
    return s;
  }

  /* 从工程模型的图纸登记表解析图签信息，保证图号与标题文字解耦 */
  function documentMeta(R, drawingKey, overrides) {
    const design = R && R.design ? R.design : {};
    const control = design.documentControl || {};
    const register = Array.isArray(control.drawingRegister) ? control.drawingRegister : [];
    const drawing = register.find((item) => item.key === drawingKey) || {};
    const project = design.project || {};
    const baseline = Array.isArray(control.referenceBaseline) ? control.referenceBaseline : [];
    const baselineLabel = baseline.slice(0, 3).map((item) => item.title).join(' · ') || '项目适用标准待确认';
    const defaultSheet = { format: 'A3', widthMm: 420, heightMm: 297, orientation: 'LANDSCAPE' };
    const skillMeta = window.EVSE_DRAWING_SKILL && typeof window.EVSE_DRAWING_SKILL.metadata === 'function'
      ? window.EVSE_DRAWING_SKILL.metadata(R, drawingKey)
      : { id: 'EVSE-DRAWING-SKILL-MISSING', version: '', profile: 'unvalidated', selectedRuleIds: [], evaluatedRuleIds: [], appliedRuleIds: [], status: 'BLOCKED' };
    return Object.assign({
      drawingKey: drawingKey || 'unregistered',
      drawingNo: drawing.drawingNo || 'EVSE-CONCEPT-000',
      drawingRef: drawing.drawingRef || '',
      revision: drawing.revision || control.revision || 'P01',
      rev: drawing.revision || control.revision || 'P01',
      discipline: drawing.discipline || 'ELECTRICAL',
      issuePurpose: drawing.issuePurpose || control.issuePurpose || '方案级自动原理图，待专业校核/签发',
      status: drawing.status || control.status || 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED',
      verification: drawing.verification || 'NOT_VERIFIED',
      documentSetId: control.documentSetId || '',
      projectRef: control.projectReference || project.referenceDesignation || '',
      projName: (R && R.pileName) || project.name || '',
      designer: '自动生成（待校核）',
      checker: '未委派',
      approver: '未委派',
      issueDate: '待签发',
      page: control.page || { current: 1, total: 1 },
      scale: drawing.scale || 'NTS',
      sheet: Object.assign({}, defaultSheet, drawing.sheet ? { format: drawing.sheet } : {}, drawing.orientation ? { orientation: drawing.orientation } : {}),
      standard: baselineLabel + '（仅参考，适用性待确认）',
      cadLayerManifest: Array.isArray(control.cadLayerManifest) && control.cadLayerManifest.length ? control.cadLayerManifest : DEFAULT_CAD_LAYER_MANIFEST,
      drawingSkill: skillMeta
    }, overrides || {});
  }

  /* ---------- A3 图框与标题栏 ---------- */
  function svgOpen(W, H, title, sub, meta) {
    const m = meta || {};
    const st = m.standard || '标准基线待项目确认';
    /* 不使用浏览器时钟：生成结果必须确定性可复现，签发日期属于导出包。 */
    const date = m.issueDate || m.date || '待签发';
    const rev = m.revision || m.rev || 'P01';
    const scale = m.scale || 'NTS';
    const no = m.drawingNo || 'EVSE-CONCEPT-000';
    const designer = m.designer || '自动化方案草案';
    const proj = m.projName || '';
    const status = m.status || 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED';
    const statusLabel = /CONCEPT_DRAFT/.test(status) ? '方案级原理图 · 待专业校核/签发' : status;
    const discipline = m.discipline || 'ELECTRICAL';
    const purpose = m.issuePurpose || '方案级自动原理图，待专业校核/签发';
    const checker = m.checker || '未委派';
    const approver = m.approver || '未委派';
    const page = m.page || { current: 1, total: 1 };
    const sheet = m.sheet || { format: 'A3', widthMm: 420, heightMm: 297, orientation: 'LANDSCAPE' };
    const tbH = 84, tbY = H - tbH - 10;
    const tbW = Math.min(560, W * 0.38), tbX = W - tbW - 10;
    const splitA = tbX + tbW * 0.53, splitB = tbX + tbW * 0.77;
    const layers = Array.isArray(m.cadLayerManifest) && m.cadLayerManifest.length ? m.cadLayerManifest : DEFAULT_CAD_LAYER_MANIFEST;
    const skill = m.drawingSkill || { id: 'EVSE-DRAWING-SKILL-MISSING', version: '', profile: 'unvalidated', selectedRuleIds: [], evaluatedRuleIds: [], appliedRuleIds: [], status: 'BLOCKED' };
    const metadata = esc(JSON.stringify({
      documentStatus: status, issuePurpose: purpose, verification: m.verification || 'NOT_VERIFIED',
      documentSetId: m.documentSetId || '', projectReference: m.projectRef || '',
      drawingKey: m.drawingKey || '', drawingNo: no, drawingRef: m.drawingRef || '', revision: rev,
      sheet: sheet.format + ' ' + sheet.orientation, units: 'mm', engine: 'EVSE',
      cadLayerManifest: layers, drawingSkill: skill
    }));
    const layerManifest = esc(JSON.stringify(layers));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${sheet.widthMm}mm" height="${sheet.heightMm}mm" preserveAspectRatio="xMidYMid meet" data-sheet-format="${sheet.format}" data-sheet-orientation="${sheet.orientation}" data-units="mm" data-document-key="${esc(m.drawingKey || '')}" data-document-status="${esc(status)}" data-document-control="CONCEPTUAL_SCHEME" data-drawing-skill="${esc(skill.id || '')}" data-drawing-skill-version="${esc(skill.version || '')}" data-drawing-skill-status="${esc(skill.status || 'BLOCKED')}" data-drawing-profile="${esc(skill.profile || '')}" data-selected-rules="${esc((skill.selectedRuleIds || []).join(','))}" data-evaluated-rules="${esc((skill.evaluatedRuleIds || []).join(','))}" data-applied-rules="${esc((skill.appliedRuleIds || []).join(','))}" data-cad-layer-manifest="${layerManifest}">
    <title>${esc(title)}</title><desc>${esc(status)}</desc><metadata>${metadata}</metadata>
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <g id="EVSE-FRAME" data-layer="EVSE-FRAME">
      <rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="${C.ink}" stroke-width="2"/>
      <rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${C.ink}" stroke-width="0.8"/>
      <rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" fill="#fff" stroke="${C.ink}" stroke-width="1.5"/>
      <line x1="${tbX}" y1="${tbY + 20}" x2="${tbX + tbW}" y2="${tbY + 20}" stroke="${C.ink}" stroke-width="0.9"/>
      <line x1="${tbX}" y1="${tbY + 42}" x2="${tbX + tbW}" y2="${tbY + 42}" stroke="${C.ink}" stroke-width="0.9"/>
      <line x1="${tbX}" y1="${tbY + 63}" x2="${tbX + tbW}" y2="${tbY + 63}" stroke="${C.ink}" stroke-width="0.9"/>
      <line x1="${splitA}" y1="${tbY}" x2="${splitA}" y2="${tbY + tbH}" stroke="${C.ink}" stroke-width="0.9"/>
      <line x1="${splitB}" y1="${tbY}" x2="${splitB}" y2="${tbY + 63}" stroke="${C.ink}" stroke-width="0.9"/>
      <text x="${tbX + 6}" y="${tbY + 13}" font-size="7.5" fill="${C.ink}" font-family="${FONT}">项目: ${esc(clip(proj, 7.5, tbW * 0.5))}</text>
      <text x="${tbX + 6}" y="${tbY + 35}" font-size="9.4" font-weight="bold" fill="${C.ink}" font-family="${FONT}">${esc(clip(title, 9.4, tbW * 0.5))}</text>
      <text x="${tbX + 6}" y="${tbY + 57}" font-size="6.8" fill="${C.ink}" font-family="${FONT}">文件集: ${esc(m.documentSetId || '待分配')}</text>
      <text x="${tbX + 6}" y="${tbY + 78}" font-size="6.8" fill="${C.warn}" font-weight="bold" font-family="${FONT}">状态: ${esc(statusLabel)}</text>
      <text x="${splitA + 5}" y="${tbY + 12}" font-size="7.2" fill="${C.ink}" font-family="${FONT}">图号: ${esc(no)}</text>
      <text x="${splitA + 5}" y="${tbY + 31}" font-size="7.2" fill="${C.ink}" font-family="${FONT}">修订: ${esc(rev)} · ${esc(discipline)}</text>
      <text x="${splitA + 5}" y="${tbY + 51}" font-size="6.7" fill="${C.ink}" font-family="${FONT}">设计人: ${esc(designer)}</text>
      <text x="${splitA + 5}" y="${tbY + 70}" font-size="6.7" fill="${C.ink}" font-family="${FONT}">校核: ${esc(checker)} · 批准: ${esc(approver)}</text>
      <text x="${splitB + 5}" y="${tbY + 12}" font-size="7.1" fill="${C.ink}" font-family="${FONT}">图幅: ${esc(sheet.format)}</text>
      <text x="${splitB + 5}" y="${tbY + 31}" font-size="7.1" fill="${C.ink}" font-family="${FONT}">比例: ${esc(scale)} · 页: ${esc(page.current)}/${esc(page.total)}</text>
      <text x="${splitB + 5}" y="${tbY + 51}" font-size="6.7" fill="${C.ink}" font-family="${FONT}">阶段: 方案级</text>
      <text x="${splitB + 5}" y="${tbY + 70}" font-size="6.7" fill="${C.ink}" font-family="${FONT}">签发: ${esc(date)}</text>
    </g>
    <g id="EVSE-TITLE" data-layer="EVSE-TEXT">
      <text x="${W / 2}" y="30" text-anchor="middle" font-size="15" font-weight="bold" fill="${C.ink}" font-family="${FONT}">${esc(title)}</text>
      <text x="${W / 2}" y="46" text-anchor="middle" font-size="9" fill="#334155" font-family="${FONT}">${esc(clip(sub || '', 9, W - 260))}</text>
      <text x="${W - 24}" y="46" text-anchor="end" font-size="7" fill="${C.anno}" font-family="${FONT}">${esc(clip(st, 7, 420))}</text>
    </g>`;
  }

  return {
    C, FONT, MONO, H, CAD_LAYER_MANIFEST: DEFAULT_CAD_LAYER_MANIFEST,
    esc, textWidth, clip, wrap,
    txt, wire, jdot, jumpV, jumpH, bus, vbus, block, zone, terminals,
    vres, vcontact, vfuse, spd, pe,
    hfuse, hbreaker, hisolator, hcontact, hsensor, hres,
    converter, moduleArray, batteryCluster, connector,
    estop, lamp, fan, antenna,
    legend, schedule, documentMeta, svgOpen, watermark, gunTerminals
  };
})();
