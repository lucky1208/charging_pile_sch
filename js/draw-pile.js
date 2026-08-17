/* ============================================================
 * 充电桩电气原理图渲染器
 * ------------------------------------------------------------
 * 只读取引擎结果与工程模型渲染，不自行决定设备数量、额定值或拓扑。
 * 分区遵循 sch_lib 参考图确认的阅读顺序：
 *   交流进线 → 功率变换 → 直流母线与保护计量 → 充电枪回路
 *   下方依次为 保护接地干线 / 储能与二次系统 / 辅助电源与配电
 * ============================================================ */
window.drawPile = function (R) {
  'use strict';
  const S = window.SYM, C = S.C, L = window.LAYOUT;
  const W = 1680, H = 1188;
  const std = R.standard, ac = R.ac, dc = R.dc, guns = R.guns || [], ess = R.ess || {}, aux = R.aux || {};
  const doc = S.documentMeta(R, 'ev-schematic');

  const subtitle = [
    std.name + ' · ' + R.archetype.name,
    dc.ratedKw + 'kW 额定 / ' + dc.installedKw + 'kW 装机',
    guns.length + ' 枪 × ' + (guns[0] ? guns[0].currentA : 0) + 'A',
    dc.outputRangeText,
    ess.enabled ? ('储能 ' + ess.installedKwh + 'kWh · ' + ess.couplingName) : '无储能配置'
  ].join(' | ');

  let s = S.svgOpen(W, H, '充电桩电气原理图', subtitle, doc);

  /* ============ 几何基准 ============ */
  const RAIL_AC = 150;          // 交流主回路水平轴
  const AC_BUS_X = 400;         // 交流分配母排
  const RAIL_DC_P = 250;        // 直流母线 DC+
  const RAIL_DC_N = 300;        // 直流母线 DC-
  const RAIL_X0 = 536, RAIL_X1 = 1290;
  const PE_Y = 624;             // 保护接地干线
  const ESS_RISER_X = 540;      // 储能并入立管
  const AUX_DROP_X = 520;       // 辅助电源交流馈线立管
  const SIG_BUS_Y = 596;        // 枪回路控制与通信总线

  /* ============ 1. 交流进线与保护 ============ */
  s += S.zone(40, 74, 344, 148, '① 交流进线与保护');
  s += S.terminals(48, 118, std.neutral ? ['L1', 'L2', 'L3', 'N', 'PE'] : ['L1', 'L2', 'L3', 'PE'], C.ac, 30);
  s += S.txt(63, 112, 'W01 进线', 7.5, C.ac, 'middle', 'bold');
  s += S.wire(78, RAIL_AC, 86, RAIL_AC, C.ac, 1.8);
  s += S.hisolator(86, RAIL_AC, C.ac, 'QS1');
  s += S.wire(130, RAIL_AC, 138, RAIL_AC, C.ac, 1.8);
  s += S.hbreaker(138, RAIL_AC, C.ac, 'QF1');
  s += S.wire(182, RAIL_AC, 200, RAIL_AC, C.ac, 1.8);
  s += S.jdot(192, RAIL_AC, C.ac);
  s += S.wire(192, RAIL_AC, 192, 160, '#9333ea', 1.4);
  s += S.spd(192, 160, '#9333ea', 'FV1');
  s += S.wire(192, 190, 192, PE_Y, C.pe, 1.5);
  s += S.hsensor(200, RAIL_AC, C.ac, 'RCM1', 'IΔ');
  s += S.wire(244, RAIL_AC, 252, RAIL_AC, C.ac, 1.8);
  s += S.block(252, 134, 58, 32, C.ac, 'PJ1', '交流计量', '#eff6ff');
  s += S.wire(310, RAIL_AC, 318, RAIL_AC, C.ac, 1.8);
  s += S.hcontact(318, RAIL_AC, C.ac, 'KM1');
  s += S.wire(362, RAIL_AC, AC_BUS_X, RAIL_AC, C.ac, 1.8);
  s += S.txt(44, 200, ac.description + ' · ' + ac.supplyText, 7, C.anno, 'start');
  s += S.txt(44, 212, 'QS1/QF1 ' + ac.breakerA + 'A · KM1 ' + ac.contactorA + 'A · 进线 ' + ac.cableText, 7, C.anno, 'start');

  /* 交流分配母排 */
  s += S.vbus(AC_BUS_X, 110, 230, C.ac, 4.5);
  s += S.jdot(AC_BUS_X, RAIL_AC, C.ac, 3);
  s += S.txt(AC_BUS_X - 6, 104, 'WB1 交流母排 ' + ac.busbarA + 'A', 7.5, C.ac, 'middle', 'bold');

  /* ============ 2. 功率变换 ============ */
  s += S.zone(404, 74, 200, 148, '② 功率变换');
  s += S.moduleArray(430, 98, 170, 94, C.dc, Math.min(4, dc.moduleCount), null, null);
  s += S.wire(AC_BUS_X, 140, 430, 140, C.ac, 1.8);
  s += S.jdot(AC_BUS_X, 140, C.ac);
  s += S.txt(515, 204, 'M1 充电功率模块 ' + dc.moduleCount + ' × ' + dc.moduleKw + 'kW', 7.5, C.dc, 'middle', 'bold');
  s += S.txt(515, 215, dc.outputRangeText + ' · ' + dc.moduleCooling + ' · 并联均流', 7, C.anno, 'middle');

  /* ============ 3. 直流保护与计量 ============ */
  s += S.zone(612, 74, 250, 148, '③ 直流保护与计量');
  s += S.wire(600, 120, 620, 120, C.dc, 1.8);
  s += S.hfuse(620, 120, C.dc, 'FU1');
  s += S.wire(664, 120, 674, 120, C.dc, 1.8);
  s += S.hsensor(674, 120, C.dc, 'TA1', 'A');
  s += S.wire(718, 120, 728, 120, C.dc, 1.8);
  s += S.block(728, 104, 62, 32, C.dc, 'PJ2', '直流计量', '#fef2f2');
  s += S.wire(790, 120, 812, 120, C.dc, 1.8);
  s += S.wire(812, 120, 812, RAIL_DC_P, C.dc, 1.8);
  s += S.jdot(812, RAIL_DC_P, C.dc, 3);
  s += S.wire(600, 170, 630, 170, C.dc, 1.8);
  s += S.wire(630, 170, 630, RAIL_DC_N, C.dc, 1.8);
  s += S.jumpV(630, RAIL_DC_P, C.dc, 6);
  s += S.jdot(630, RAIL_DC_N, C.dc, 3);
  s += S.txt(616, 200, 'FU1 ' + dc.mainFuseA + 'A gR · TA1 0–' + dc.sensorRangeA + 'A', 7, C.anno, 'start');
  s += S.txt(616, 212, 'PJ2 ' + S.clip(std.meter, 7, 224), 7, C.anno, 'start');

  /* ============ 4. 充电直流母线 ============ */
  s += S.bus(RAIL_X0, RAIL_DC_P, RAIL_X1 - RAIL_X0, C.dc, 5);
  s += S.bus(RAIL_X0, RAIL_DC_N, RAIL_X1 - RAIL_X0, C.dc, 5);
  s += S.txt(560, 242, 'DC+ 母线 ' + dc.busbarA + 'A', 7.5, C.dc, 'start', 'bold');
  s += S.txt(560, 293, 'DC- 母线 ' + dc.outputRangeText, 7.5, C.dc, 'start', 'bold');

  /* 绝缘监测 IMD：取样自 DC+/DC-，基准接 PE */
  s += S.jdot(678, RAIL_DC_P, C.dc);
  s += S.wire(678, RAIL_DC_P, 678, 340, C.dc, 1.3);
  s += S.jumpV(678, RAIL_DC_N, C.dc, 6);
  s += S.jdot(730, RAIL_DC_N, C.dc);
  s += S.wire(730, RAIL_DC_N, 730, 340, C.dc, 1.3);
  s += S.block(650, 340, 110, 44, C.dc, 'RI1 绝缘监测', 'IMD · ≥100Ω/V', '#fef2f2');
  s += S.wire(705, 384, 705, PE_Y, C.pe, 1.5);

  /* 母线泄放电阻 */
  s += S.jdot(850, RAIL_DC_P, C.dc);
  s += S.wire(850, RAIL_DC_P, 850, 256, C.dc, 1.3);
  s += S.vres(850, 256, C.dc, 'RS0');
  s += S.wire(850, 286, 850, RAIL_DC_N, C.dc, 1.3);
  s += S.jdot(850, RAIL_DC_N, C.dc);
  s += S.txt(806, 322, '停机泄放：1s 内降至 ≤60VDC（阻值待核算）', 7, C.anno, 'middle');

  /* ============ 5. 充电枪回路 ============ */
  s += S.zone(880, 314, 430, 300, '④ 充电枪回路（每枪独立快熔 + 正/负极直流接触器）');
  const centers = L.distribute(guns.length, guns.length > 1 ? 950 : 1090, guns.length > 1 ? 1250 : 1090);
  guns.forEach((gun, index) => {
    const cx = centers[index], xp = cx - 18, xn = cx + 18;
    /* DC+ 支路：母线 → 快熔 → 正极接触器 → 枪 */
    s += S.jdot(xp, RAIL_DC_P, C.dc, 3);
    s += S.wire(xp, RAIL_DC_P, xp, 322, C.dc, 1.6);
    s += S.jumpV(xp, RAIL_DC_N, C.dc, 6);
    s += S.vfuse(xp, 322, C.dc, gun.fuseTag, 'left');
    s += S.wire(xp, 352, xp, 360, C.dc, 1.6);
    s += S.vcontact(xp, 360, C.dc, gun.contactorTagP, 'left');
    s += S.wire(xp, 390, xp, 452, C.dc, 1.6);
    /* DC- 支路：母线 → 负极接触器 → 枪 */
    s += S.jdot(xn, RAIL_DC_N, C.dc, 3);
    s += S.wire(xn, RAIL_DC_N, xn, 360, C.dc, 1.6);
    s += S.vcontact(xn, 360, C.dc, gun.contactorTagN, 'right');
    s += S.wire(xn, 390, xn, 452, C.dc, 1.6);
    /* 枪本体 */
    s += S.connector(cx, 480, std.id, C.dc);
    s += S.txt(cx, 532, gun.tag, 8.5, C.dc, 'middle', 'bold');
    s += S.txt(cx, 544, gun.currentA + 'A/' + gun.powerKw + 'kW', 7, C.ink, 'middle');
    /* PE 与电子锁 */
    s += S.wire(cx + 22, PE_Y, cx + 22, 500, C.pe, 1.5);
    s += S.txt(cx + 26, 470, 'PE', 7, C.pe, 'start', 'bold');
    /* 控制与通信支线 */
    s += S.wire(cx - 26, SIG_BUS_Y, cx - 26, 512, C.ctl, 1.2, '4,3');
    s += S.jdot(cx - 26, SIG_BUS_Y, C.ctl, 2.2);
  });
  s += S.wire(920, SIG_BUS_Y, RAIL_X1, SIG_BUS_Y, C.ctl, 1.3, '4,3');
  s += S.txt(1095, 570, '每枪：' + guns[0].lockText, 7, C.anno, 'middle');

  /* ============ 6. 保护接地干线 ============ */
  s += S.bus(60, PE_Y, 1230, C.pe, 4);
  s += S.txt(66, PE_Y - 8, 'PE 保护接地排（等电位联结，接地电阻待现场实测）', 7.5, C.pe, 'start', 'bold');
  s += S.pe(140, PE_Y);
  s += S.jdot(192, PE_Y, C.pe, 3);
  s += S.jdot(705, PE_Y, C.pe, 3);
  guns.forEach((gun, index) => { s += S.jdot(centers[index] + 22, PE_Y, C.pe, 3); });

  /* ============ 7. 储能系统 ============ */
  if (ess.enabled) {
    s += S.zone(40, 650, 460, 232, '⑤ 储能系统（' + ess.couplingName + '）');
    const shown = Math.min(2, ess.clusterCount);
    const ESS_BUS_X = 360;
    for (let i = 0; i < shown; i += 1) {
      const cy = 690 + i * 92;
      s += S.batteryCluster(50, cy - 22, 140, 44, C.ess, 'GB' + (i + 1) + ' 电池簇', ess.clusterKwh + 'kWh · ' + ess.busVoltageV + 'V');
      s += S.wire(190, cy, 198, cy, C.ess, 1.8);
      s += S.hfuse(198, cy, C.ess, 'FB' + (i + 1));
      s += S.wire(242, cy, 250, cy, C.ess, 1.8);
      s += S.hcontact(250, cy, C.ess, 'KB' + (i + 1));
      s += S.wire(294, cy, ESS_BUS_X, cy, C.ess, 1.8);
      /* 预充支路：接触器 + 限流电阻，与主接触器并联 */
      s += S.jdot(246, cy, C.ess);
      s += S.wire(246, cy, 246, cy + 28, C.ess, 1.3);
      s += S.hcontact(246, cy + 28, C.ess, 'KP' + (i + 1));
      s += S.hres(298, cy + 28, C.ess, 'RS' + (i + 1));
      s += S.wire(290, cy + 28, 298, cy + 28, C.ess, 1.3);
      s += S.wire(342, cy + 28, 342, cy, C.ess, 1.3);
      s += S.jdot(342, cy, C.ess);
      s += S.txt(52, cy + 34, '预充 ' + ess.prechargeR + 'Ω/200W', 6.5, C.anno, 'start');
    }
    if (ess.clusterCount > shown) {
      s += S.txt(50, 852, '⋯ 共 ' + ess.clusterCount + ' 簇，其余簇同型并联（簇间环流与均衡策略待 BMS 厂家确认）', 7, C.anno, 'start');
    }
    s += S.vbus(ESS_BUS_X, 660, 180, C.ess, 4.5);
    s += S.txt(ESS_BUS_X + 4, 656, 'WB3 储能母线 ' + ess.voltageRangeText, 7, C.ess, 'start', 'bold');
    s += S.converter(376, 700, 100, 54, C.ess, 'DC', ess.coupling === 'ac' ? 'AC' : 'DC', null, null);
    s += S.txt(426, 694, (ess.coupling === 'ac' ? 'M3 储能 PCS' : 'M4 储能 DC/DC'), 8, C.ess, 'middle', 'bold');
    s += S.txt(426, 766, ess.converterText, 7, C.anno, 'middle');
    s += S.jdot(ESS_BUS_X, 727, C.ess, 3);
    s += S.wire(ESS_BUS_X, 727, 376, 727, C.ess, 1.8);
    /* 变换器输出并入 */
    s += S.wire(476, 727, ESS_RISER_X, 727, ess.coupling === 'ac' ? C.ac : C.dc, 1.8);
    if (ess.coupling === 'ac') {
      s += S.wire(ESS_RISER_X, 727, ESS_RISER_X, 336, C.ac, 1.8);
      s += S.jumpV(ESS_RISER_X, PE_Y, C.ac, 6);
      s += S.wire(ESS_RISER_X, 336, AC_BUS_X, 336, C.ac, 1.8);
      s += S.jdot(AC_BUS_X, 336, C.ac, 3);
      s += S.txt(470, 330, '并入交流母排', 7, C.ac, 'middle');
    } else {
      s += S.wire(ESS_RISER_X, 727, ESS_RISER_X, RAIL_DC_P, C.dc, 1.8);
      s += S.jumpV(ESS_RISER_X, PE_Y, C.dc, 6);
      s += S.jumpV(ESS_RISER_X, RAIL_DC_N, C.dc, 6);
      s += S.jdot(ESS_RISER_X, RAIL_DC_P, C.dc, 3);
      s += S.txt(500, 244, '并入 DC+', 7, C.dc, 'middle');
    }
    s += S.block(376, 800, 110, 42, C.comm, 'A5 BAMS', '电池管理主控', '#f5f3ff');
    s += S.txt(50, 866, ess.chemistryName + ' · DOD ' + Math.round(ess.dod * 100) + '% · 可用 ' + ess.usableKwh + 'kWh · ' + ess.cRate + 'C', 7, C.anno, 'start');
  } else {
    s += S.zone(40, 650, 460, 232, '⑤ 储能系统（本方案未配置）');
    s += S.txt(60, 700, '当前输入未选择储能配置：', 8, C.anno, 'start', 'bold');
    s += S.txt(60, 718, '· 全部充电功率由交流进线承担，进线容量与需量费用需按峰值核算；', 7.5, C.anno, 'start');
    s += S.txt(60, 734, '· 如后续增加储能，需重新校核进线容量、并网批复、消防与柜体布置；', 7.5, C.anno, 'start');
    s += S.txt(60, 750, '· 本图不预留储能支路的保护、预充与并离网切换回路。', 7.5, C.anno, 'start');
  }

  /* ============ 8. 二次控制与通信 ============ */
  s += S.zone(560, 650, 750, 232, '⑥ 二次控制、计量与通信');
  s += S.block(580, 676, 150, 64, C.ctl, 'A1 充电控制单元 CCU', S.clip(std.protocol, 7.5, 142), '#f1f5f9');
  s += S.block(750, 676, 140, 56, C.comm, std.physicalLayer === 'PLC' ? 'A2 SECC 通信控制器' : 'A2 计费通信网关', std.physicalLayer === 'PLC' ? 'HomePlug Green PHY' : 'CAN / RS485', '#f5f3ff');
  s += S.block(910, 676, 110, 50, C.comm, 'A3 路由器', '4G / 以太网', '#f5f3ff');
  s += S.antenna(1062, 700, C.comm);
  s += S.txt(1062, 716, '天线', 7, C.comm, 'middle');
  s += S.txt(1100, 686, '后台协议：' + aux.backendText, 7.5, C.anno, 'start');
  s += S.txt(1100, 700, '计量：' + S.clip(std.meter, 7.5, 196), 7.5, C.anno, 'start');
  s += S.txt(1100, 714, '接口：' + S.clip(std.connector, 7.5, 196), 7.5, C.anno, 'start');
  s += S.block(580, 782, 108, 46, C.ctl, 'A4 显示屏', S.clip(aux.hmiText, 7, 100), '#f1f5f9');
  s += S.block(700, 782, 100, 46, C.ctl, '读卡/扫码', '身份与计费', '#f1f5f9');
  s += S.estop(838, 800, '#dc2626');
  s += S.txt(838, 832, 'SB1 急停', 7, '#dc2626', 'middle', 'bold');
  s += S.lamp(898, 800, '#ca8a04');
  s += S.txt(898, 832, 'HL 状态灯', 7, '#ca8a04', 'middle');
  s += S.block(940, 782, 100, 46, C.ctl, 'SQ1 门禁', '防拆/开门联锁', '#f1f5f9');
  s += S.block(1052, 782, 118, 46, C.ctl, '环境监测', '温度/烟感/水浸', '#f1f5f9');
  s += S.txt(1182, 800, '所有联锁信号硬线接入 A1，', 7, C.anno, 'start');
  s += S.txt(1182, 812, '动作后直接切除输出使能。', 7, C.anno, 'start');
  /* 控制单元到各二次设备（虚线） */
  [[634, 782], [750, 782], [838, 789], [898, 791], [990, 782], [1111, 782]].forEach((p) => {
    s += S.wire(655, 740, p[0], p[1], C.ctl, 1.1, '4,3', 764);
  });
  s += S.wire(730, 700, 750, 700, C.comm, 1.3, '4,3');
  s += S.wire(890, 700, 910, 700, C.comm, 1.3, '4,3');
  /* 控制单元 → 枪回路控制与通信总线 */
  s += S.wire(655, 676, 655, SIG_BUS_Y, C.ctl, 1.3, '4,3');
  s += S.jumpV(655, PE_Y, C.ctl, 6);
  s += S.wire(655, SIG_BUS_Y, 920, SIG_BUS_Y, C.ctl, 1.3, '4,3');
  s += S.jumpH(705, SIG_BUS_Y, C.ctl, 6);
  s += S.txt(662, 588, '控制与通信总线：' + S.clip(guns[0].controlSignalText, 7, 160), 7, C.ctl, 'start');
  /* 模块与计量的通信总线 */
  s += S.wire(580, 690, 470, 690, C.comm, 1.2, '4,3');
  if (ess.enabled) s += S.wire(486, 821, 540, 821, C.comm, 1.2, '4,3');

  /* ============ 9. 辅助电源与配电 ============ */
  s += S.zone(40, 872, 940, 176, '⑦ 辅助电源、热管理与配电');
  s += S.jdot(AC_BUS_X, 316, C.ac, 3);
  s += S.wire(AC_BUS_X, 316, AUX_DROP_X, 316, C.aux, 1.5);
  s += S.wire(AUX_DROP_X, 316, AUX_DROP_X, 886, C.aux, 1.5);
  s += S.jumpV(AUX_DROP_X, PE_Y, C.aux, 6);
  s += S.wire(130, 886, AUX_DROP_X, 886, C.aux, 1.5);
  s += S.block(80, 896, 100, 38, C.aux, 'T1 开关电源', 'AC/DC ' + aux.psu24W + 'W 24V', '#ecfeff');
  s += S.block(200, 896, 100, 38, C.aux, 'T2 开关电源', 'AC/DC ' + aux.psu12W + 'W 12V', '#ecfeff');
  s += S.jdot(130, 886, C.aux);
  s += S.jdot(250, 886, C.aux);
  s += S.wire(250, 886, 250, 896, C.aux, 1.4);
  s += S.wire(130, 934, 130, 952, C.aux, 1.6);
  s += S.wire(250, 934, 250, 952, C.aux, 1.6);
  s += S.bus(110, 952, 850, C.aux, 4);
  s += S.txt(116, 946, 'WB4 辅助直流母排 DC24V / DC12V', 7.5, C.aux, 'start', 'bold');
  const auxTaps = [
    ['M2 热管理', aux.thermalMode === 'liquid' ? '控制/联锁' : aux.fanCount + ' 台风机'],
    ['EH 加热/除湿', aux.heaterW ? aux.heaterW + 'W' : '按需选配'],
    ['KM/K 线圈', '接触器驱动'],
    ['YV 电子锁', guns.length + ' 套'],
    ['A1 控制单元', 'DC24V'],
    ['A2/A3 通信', 'DC12V'],
    ['A4 显示/读卡', 'DC12V'],
    [ess.enabled ? 'A5 BMS' : '备用回路', ess.enabled ? 'DC24V' : '预留']
  ];
  auxTaps.forEach((tap, index) => {
    const x = 340 + index * 82;
    s += S.jdot(x, 952, C.aux);
    s += S.wire(x, 952, x, 976, C.aux, 1.3);
    s += `<rect x="${x - 5}" y="976" width="10" height="8" fill="#fff" stroke="${C.aux}" stroke-width="1.1"/>`;
    s += S.txt(x, 998, S.clip(tap[0], 6.8, 80), 6.8, C.aux, 'middle', 'bold');
    s += S.txt(x, 1009, S.clip(tap[1], 6.5, 80), 6.5, C.anno, 'middle');
  });
  s += S.fan(70, 1000, C.aux);
  s += S.txt(70, 1022, S.clip(aux.thermalName, 6.8, 90), 6.8, C.aux, 'middle');
  s += S.txt(150, 998, '防护等级 ' + aux.ipRating, 7, C.anno, 'start');
  s += S.txt(150, 1010, '工作温度 ' + aux.ambientText, 7, C.anno, 'start');
  s += S.txt(150, 1022, S.clip(aux.thermalText, 7, 170), 7, C.anno, 'start');

  /* ============ 10. 图例 ============ */
  s += S.legend([
    { color: C.ac, thick: 2, label: '交流主回路 ' + ac.lineVoltage + 'V' },
    { color: C.dc, thick: 2, label: '充电直流回路 ' + dc.outputRangeText },
    { color: C.ess, thick: 2, label: '储能直流回路' },
    { color: C.aux, thick: 1.8, label: '辅助电源 DC24V / DC12V' },
    { color: C.ctl, dash: '4,3', label: '控制、联锁与采样信号' },
    { color: C.comm, dash: '4,3', label: '通信总线与后台链路' },
    { color: C.pe, thick: 2.4, label: '保护接地 PE / 等电位' }
  ], 1000, 872, 300);

  /* ============ 11. 设备明细表 ============ */
  s += S.schedule((R.schedule || []).slice(0, 40), 1326, 92, 330);

  /* ============ 12. 图注 ============ */
  s += S.txt(44, 1064, '枪端子（' + std.name + ' ' + std.connector + '）：' + std.dcPins.join(' / ') +
    '；控制导引 ' + std.controlPins.join('/') + '；通信 ' + guns[0].commSignalText, 7.5, C.anno, 'start');
  s += S.txt(44, 1076, '注：本图由确定性算法按输入参数选取设备档位并自动出图，为方案级原理图。' +
    '短路与保护配合、EMC、温升、接口一致性测试、消防与并网审批均未完成，不得作为生产图或合规证明。', 7.5, C.anno, 'start');

  s += '</svg>';
  return s;
};
