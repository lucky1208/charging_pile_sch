/* ============================================================
 * EVSE 原理图颜色规范 v1.0（EVSE-COLOR-SCHEME）
 * ------------------------------------------------------------
 * 依据与约定：
 *  - IEC 60445 / GB/T 6995 导体与端子识别基线（具体版次和适用性须由项目确认）：
 *      PE 保护接地 = 绿黄（CAD 单色绿，专用）；N 中性线 = 蓝（专用）；
 *      交流相线 = 棕/黑/灰（本规范取棕）；直流正 = 红/棕（本规范取红），直流负 = 蓝。
 *  - 屏幕网络色与线型是项目可视化约定，不构成 IEC 符合性证明；不得只靠颜色表达电气语义。
 *  - ISO 3864 安全红用于安全器件（急停/消防/浪涌保护）。
 *  - 设备块底色 = 所属回路色的浅底（fill.*），打印友好。
 *  - DXF 层色为 AutoCAD ACI 编号，与屏上颜色语义一一对应。
 * 渲染闸门 G041-LIB-COLOR 按本规范白名单自检，出现未登记颜色即阻断导出。
 * ============================================================ */
window.EVSE_COLOR_SCHEME = (function () {
  'use strict';

  const ID = 'EVSE-COLOR-SCHEME';
  const VERSION = '1.0.0';

  const CATEGORIES = Object.freeze([
    { id: 'ac', color: '#92400e', dxf: 34, basis: '项目屏显棕；导体识别按项目采用的 IEC 60445 / GB/T 6995 版次复核', label: '交流电源回路（相线）' },
    { id: 'n', color: '#0284c7', dxf: 5, basis: '项目屏显蓝；中性导体标识适用性须复核', label: '中性线 N' },
    { id: 'dc', color: '#dc2626', dxf: 1, basis: '项目屏显红；极性必须同时由 DC± 与端子语义标识', label: '充电直流回路' },
    { id: 'ess', color: '#ea580c', dxf: 30, basis: '项目约定·橙（区分充电直流）', label: '储能直流回路' },
    { id: 'aux', color: '#0e7490', dxf: 4, basis: '项目约定·青（安全特低电压域）', label: '辅助电源 DC24V/12V' },
    { id: 'ctl', color: '#475569', dxf: 8, basis: '项目约定·灰+虚线=非功率控制/联锁/采样', label: '控制/联锁/采样信号' },
    { id: 'comm', color: '#7c3aed', dxf: 6, basis: '项目约定·紫+虚线=通信总线', label: '通信总线/后台链路' },
    { id: 'pe', color: '#15803d', dxf: 3, basis: '项目屏显绿；PE 必须同时由符号/文字标识，实际导体绿黄要求按项目标准复核', label: '保护接地 PE/等电位' },
    { id: 'saf', color: '#dc2626', dxf: 1, basis: 'ISO 3864 安全红', label: '安全器件（急停/消防/浪涌）' },
    { id: 'warn', color: '#ca8a04', dxf: 40, basis: '项目约定·琥珀=状态指示/警示', label: '状态指示/警示' },
    { id: 'ink', color: '#0f172a', dxf: 7, basis: 'ISO 128/IEC 61082 默认黑线划', label: '图框/标题栏/主文字' },
    { id: 'anno', color: '#64748b', dxf: 8, basis: '项目约定·灰=非电气注释', label: '注释/待核说明' },
    { id: 'grid', color: '#cbd5e1', dxf: 9, basis: '项目约定·浅灰=辅助网格/水印', label: '辅助网格/水印' }
  ]);

  const FILLS = Object.freeze({
    ac: '#fff7ed', dc: '#fef2f2', ess: '#ffedd5', comm: '#f5f3ff',
    ctl: '#f1f5f9', aux: '#ecfeff', def: '#f8fafc', white: '#ffffff'
  });

  const EXTRA = Object.freeze(['#334155', '#64748b', '#94a3b8']); /* 表格文字/分区虚线框 */

  function palette() {
    const c = { fill: FILLS };
    CATEGORIES.forEach((k) => { c[k.id] = k.color; });
    return c;
  }

  function allowlist() {
    const set = new Set(EXTRA);
    CATEGORIES.forEach((k) => set.add(k.color.toLowerCase()));
    Object.values(FILLS).forEach((v) => set.add(v.toLowerCase()));
    return set;
  }

  return { ID, VERSION, CATEGORIES, FILLS, EXTRA, palette, allowlist };
})();
