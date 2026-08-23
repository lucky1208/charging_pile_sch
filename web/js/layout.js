/* ============================================================
 * 自动布局引擎 v1.0 (无需 LLM, 确定性)
 * ------------------------------------------------------------
 * 提供:
 *  - GRID 网格基准 + snap() 网格对齐 (CAD 出图纪律)
 *  - layered() 分层(层级)布局: 节点按 rank 分列, 列内垂直居中堆叠,
 *    坐标全部对齐网格, 随节点数量自动伸缩 —— 替代手工坐标
 *  - rowFlow() 水平流程排布 (用于液冷等横向链路)
 * ============================================================ */
window.LAYOUT = (function () {
  'use strict';
  const GRID = 10;
  const snap = (v) => Math.round(v / GRID) * GRID;

  /* 分层布局: nodes=[{id,rank,title,sub,color,fill,render}], 返回 {pos, cols, maxN, height} */
  function layered(nodes, opts) {
    const o = Object.assign({ left: 40, top: 90, colWidth: 170, gapX: 40, rowHeight: 95, nodeH: 62 }, opts || {});
    const ranks = {};
    nodes.forEach((n) => { (ranks[n.rank] = ranks[n.rank] || []).push(n); });
    const keys = Object.keys(ranks).map(Number).sort((a, b) => a - b);
    const maxN = Math.max.apply(null, keys.map((k) => ranks[k].length));
    const pos = {}, cols = [];
    keys.forEach((k, ci) => {
      const col = ranks[k];
      const x = snap(o.left + ci * (o.colWidth + o.gapX));
      const colH = col.length * o.rowHeight;
      const startY = o.top + (maxN * o.rowHeight - colH) / 2 + o.rowHeight / 2 - o.nodeH / 2;
      col.forEach((n, i) => {
        pos[n.id] = { x: x, y: snap(startY + i * o.rowHeight), w: o.colWidth, h: o.nodeH };
      });
      cols.push({ rank: k, x: x, right: x + o.colWidth, count: col.length });
    });
    return { pos, cols, maxN, height: o.top + maxN * o.rowHeight, opts: o };
  }

  /* 等距分布: 在 [left,right] 内生成 count 个网格对齐中心点 (馈线/列锚点) */
  function distribute(count, left, right) {
    if (count <= 1) return [snap((left + right) / 2)];
    const step = (right - left) / (count - 1);
    const out = [];
    for (let i = 0; i < count; i++) out.push(snap(left + i * step));
    return out;
  }

  /* 水平流程排布: items=[{id,...}], 从左到右等距, 返回 {pos, width} */
  function rowFlow(items, opts) {
    const o = Object.assign({ left: 40, y: 520, itemW: 150, gapX: 40, itemH: 62 }, opts || {});
    const pos = {};
    items.forEach((it, i) => {
      pos[it.id] = { x: snap(o.left + i * (o.itemW + o.gapX)), y: snap(o.y), w: o.itemW, h: o.itemH };
    });
    const width = o.left + items.length * (o.itemW + o.gapX);
    return { pos, width, opts: o };
  }

  return { GRID, snap, layered, rowFlow, distribute };
})();