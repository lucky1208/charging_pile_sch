/* ============================================================
 * 充电桩标准与器件规格库  v1.0
 * ------------------------------------------------------------
 * 数据来源分两类，必须区分：
 *  1) 标准接口约定（枪型触点、通信协议、计量要求）——取自公开标准
 *     名称，仅作为图面表达和参数校核的“项目基线输入”，不构成
 *     GB/T、IEC、EN、UL、SAE 的符合性结论。
 *  2) 器件档位序列（断路器、接触器、快熔、电缆、电池、PCS）——
 *     为通用标称值序列，用于确定性选型档位，不是厂家型录、
 *     不是报价、不能替代型式试验和技术协议。
 *
 * 本文件不复制 sch_lib 参考图中的任何具体额定值、厂商料号或
 * 设备数量；参考图只用于确认图面表达习惯。
 * ============================================================ */
window.EV_STD = (function () {
  'use strict';

  const VERSION = '1.1.0';
  const BASIS = 'PROJECT_BASELINE—NOT_A_COMPLIANCE_CERTIFICATE';

  /* ---------- 充电标准 / 接口 ---------- */
  const STANDARDS = {
    gb: {
      id: 'gb',
      connectorType: 'gbt-dc',
      name: '国标 GB/T',
      region: '中国大陆',
      connector: 'GB/T 20234.3 直流充电接口（9 芯）',
      acConnector: 'GB/T 20234.2 交流充电接口（7 芯）',
      acOutput: Object.freeze({ connectorType: 'gbt-ac', lineVoltage: 380, phases: 3, conductors: ['L1', 'L2', 'L3', 'N'], controlPins: ['CP', 'CC'], requiresTransformer: false }),
      protocol: 'GB/T 27930 充电通信（CAN 2.0B, 250kbps）',
      safety: 'GB/T 18487.1 电动汽车传导充电系统',
      physicalLayer: 'CAN',
      dcPins: ['DC+', 'DC-', 'PE', 'S+', 'S-', 'CC1', 'CC2', 'A+', 'A-'],
      controlPins: ['CC1', 'CC2'],
      commPins: ['S+', 'S-'],
      auxPins: ['A+', 'A-'],
      electronicLock: true,
      temperaturePins: 2,
      meter: '直流电能表（国网型式批准 + 强检）',
      meterNote: '计量方式、检定与防作弊要求按当地计量主管部门确认',
      backend: 'GB/T 27930 + 运营平台私有协议 / OCPP 网关（可选）',
      acVoltage: 'AC 380V 3P+N+PE 50Hz',
      acLineVoltage: 380,
      phases: 3,
      neutral: true,
      dcVoltageRange: [200, 1000],
      gunCurrentOptions: [125, 200, 250, 300, 400],
      earthing: 'TN-S（IT/TT 需按站点接地型式复核）',
      note: '国标直流枪的 CC1/CC2 用于连接确认与电子锁判据，S+/S- 为 CAN 通信，A+/A- 为车辆低压辅助供电。'
    },
    eu: {
      id: 'eu',
      connectorType: 'ccs2',
      name: '欧标 CCS2',
      region: '欧洲 / 中东 / 部分亚太',
      connector: 'IEC 62196-3 Configuration FF（CCS Combo 2）',
      acConnector: 'IEC 62196-2 Type 2',
      acOutput: Object.freeze({ connectorType: 'type2-ac', lineVoltage: 400, phases: 3, conductors: ['L1', 'L2', 'L3', 'N'], controlPins: ['CP', 'PP'], requiresTransformer: false }),
      protocol: 'DIN 70121 / ISO 15118-2（HomePlug Green PHY 电力线通信）',
      safety: 'IEC 61851-1 / IEC 61851-23 直流充电机',
      physicalLayer: 'PLC',
      dcPins: ['DC+', 'DC-', 'PE', 'CP', 'PP'],
      controlPins: ['CP', 'PP'],
      commPins: ['CP'],
      auxPins: [],
      electronicLock: true,
      temperaturePins: 2,
      meter: 'MID 认证直流电能表（德国市场另需 Eichrecht 计量法合规）',
      meterNote: '计量、显示与数据签名要求按销售国计量法规确认',
      backend: 'OCPP 1.6J / OCPP 2.0.1（TLS）',
      acVoltage: 'AC 400V 3P+N+PE 50Hz',
      acLineVoltage: 400,
      phases: 3,
      neutral: true,
      dcVoltageRange: [150, 1000],
      gunCurrentOptions: [125, 200, 250, 300, 400],
      earthing: 'TN-S / TT（按并网点接地型式复核）',
      note: 'CCS2 的 CP 同时承载 PWM 状态与 GreenPHY 载波；PP 为插头在位/载流能力编码，电子锁与锁反馈为必需回路。'
    },
    us: {
      id: 'us',
      connectorType: 'ccs1',
      name: '美标 CCS1',
      region: '北美',
      connector: 'IEC 62196-3 Configuration EE（CCS Combo 1）',
      acConnector: 'SAE J1772 Type 1',
      acOutput: Object.freeze({ connectorType: 'j1772-ac', lineVoltage: 240, phases: 1, conductors: ['L1', 'L2'], controlPins: ['CP', 'PP'], requiresTransformer: true }),
      protocol: 'DIN 70121 / ISO 15118 / SAE J2847-2（HomePlug Green PHY）',
      safety: 'UL 2202 / UL 2594 / NEC Article 625（适用性待认证机构确认）',
      physicalLayer: 'PLC',
      dcPins: ['DC+', 'DC-', 'PE', 'CP', 'PP'],
      controlPins: ['CP', 'PP'],
      commPins: ['CP'],
      auxPins: [],
      electronicLock: true,
      temperaturePins: 2,
      meter: 'NTEP / CTEP 计量认证电能表',
      meterNote: '计量认证与州计量局备案要求按销售州确认',
      backend: 'OCPP 1.6J / OCPP 2.0.1（TLS）',
      acVoltage: 'AC 480V 3P+PE 60Hz（Delta，无中性线）',
      acLineVoltage: 480,
      phases: 3,
      neutral: false,
      dcVoltageRange: [150, 1000],
      gunCurrentOptions: [125, 200, 250, 300, 400],
      earthing: '按 NEC 接地与故障电流保护要求确认（含 GFCI/GFDI）',
      note: '北美 480V Delta 系统通常无中性线，控制与辅助电源需从相间取电或独立控制变压器；接地故障保护按 NEC 625 复核。'
    },
    nacs: {
      id: 'nacs',
      connectorType: 'nacs',
      name: '美标 NACS',
      region: '北美（特斯拉开放 / SAE J3400）',
      connector: 'SAE J3400 交直流一体接口（5 触点：DC+/L1、DC-/L2/N、PE、CP、PP）',
      acConnector: 'SAE J3400 交流输出（L1/L2 复用两个大电流触点，单相）',
      acOutput: Object.freeze({ connectorType: 'nacs-ac', lineVoltage: 240, phases: 1, conductors: ['L1', 'L2'], controlPins: ['CP', 'PP'], requiresTransformer: true }),
      protocol: 'ISO 15118 PLC · 兼容 PWM-CP（J1772）/ LIN-CP · 互操作 P1(DIN 70121)/P2(ISO 15118-2)',
      safety: 'UL 2202 / NEC Article 625 / SAE J3400（适用性待认证机构确认）',
      physicalLayer: 'PLC',
      dcPins: ['DC+', 'DC-', 'PE', 'CP', 'PP'],
      controlPins: ['CP', 'PP'],
      commPins: ['CP'],
      auxPins: [],
      electronicLock: true,
      temperaturePins: 2,
      meter: 'NTEP / CTEP 计量认证电能表',
      meterNote: '计量认证与州计量局备案要求按销售州确认',
      backend: 'OCPP 1.6J / OCPP 2.0.1（TLS）· ISO 15118 即插即充',
      /* 站点进线与车辆连接器输出是两个不同边界。北美直流快充柜
       * 仍按 480V 三相站点进线建模；J3400 的两个大电流触点只描述
       * 车辆侧单相交流输出或直流输出，绝不能把站点进线误画成两相。 */
      acVoltage: '站点进线 AC 480V 3P+PE 60Hz；J3400 车辆侧交流输出为单相 L1/L2',
      acLineVoltage: 480,
      phases: 3,
      neutral: false,
      connectorAcPhases: 1,
      connectorAcConductors: ['L1', 'L2'],
      dcVoltageRange: [150, 1000],
      gunCurrentOptions: [250, 300, 400, 500],
      earthing: '按 NEC 接地与故障电流保护要求确认（含 GFCI/GFDI）',
      note: 'J3400 五触点在车辆接口处复用交直流；本平台把站点交流进线与连接器交流输出分别建模。双向能力、温度限值和锁止策略须按选定 J3400 版本及认证方案复核。'
    },
    chademo: {
      id: 'chademo',
      connectorType: 'chademo',
      name: '日标 CHAdeMO',
      region: '日本 / 国际（CHAdeMO 协会）',
      connector: 'CHAdeMO 直流接口（10 触点：DC±、FG/PE、Charger 12V、连接检查、启停1/2、充电使能、CAN-H/L）',
      acConnector: '无（纯直流接口；交流由车辆另配 Type1）',
      acOutput: Object.freeze({ connectorType: 'j1772-ac', lineVoltage: 230, phases: 1, conductors: ['L1', 'N'], controlPins: ['CP', 'PP'], requiresTransformer: false, companionInterface: true }),
      protocol: 'CHAdeMO 1.x / 2.0 / 2.1 · CAN 总线（车辆主导；项目必须锁定实际版本）',
      safety: 'CHAdeMO 规格 + 当地电气安全法规（适用性待确认）',
      physicalLayer: 'CAN',
      dcPins: ['DC+', 'DC-', 'PE', 'CHARGER_12V', 'CONNECTION_CHECK', 'START_STOP_1', 'START_STOP_2', 'CHARGE_ENABLE', 'CAN_H', 'CAN_L'],
      controlPins: ['CONNECTION_CHECK', 'START_STOP_1', 'START_STOP_2', 'CHARGE_ENABLE'],
      commPins: ['CAN_H', 'CAN_L'],
      auxPins: ['CHARGER_12V'],
      electronicLock: false,
      temperaturePins: 0,
      meter: '直流电能表（按当地计量法规确认）',
      meterNote: '计量方式与检定要求按当地计量主管部门确认',
      backend: 'OCPP 网关（可选）· CHAdeMO 后台协议',
      acVoltage: 'AC 400V 3P+N+PE 50/60Hz',
      acLineVoltage: 400,
      phases: 3,
      neutral: true,
      dcVoltageRange: [50, 1000],
      gunCurrentOptions: [125, 200, 400, 500],
      earthing: 'TN-S / TT（按站点接地型式复核）',
      note: 'CHAdeMO 为车辆主导：BMS 经 CAN 下发需求；Charger 12V、连接检查、启停1/2与充电使能均为独立物理回路，不得压成一个 CP 或用模糊匹配自动接线。CHAdeMO 2.1 已公布最高 800A 能力，但本平台在缺少受控 800A 枪线/温升配置前只开放至 500A；更高电流必须 fail-closed 并由厂家与认证机构复核。'
    }
  };

  /* ---------- 桩型 ---------- */
  const ARCHETYPES = {
    'dc-integrated': { id: 'dc-integrated', name: '直流一体式充电桩', note: '功率模块、控制、计量、枪线集成于同一柜体' },
    'dc-split': { id: 'dc-split', name: '直流分体式（功率柜 + 充电终端）', note: '功率柜与终端分离，直流电缆敷设、压降与联锁需专项设计' },
    'ac-dc-combo': { id: 'ac-dc-combo', name: '交直流一体桩', note: '在直流基础上增加交流慢充支路（含独立计量与保护）' },
    'ess-mobile': { id: 'ess-mobile', name: '储能移动充电车 / 移动充电桩', note: '以电池组为主电源，市电或补电座为补能路径' }
  };

  /* ---------- 功率模块档位 ---------- */
  const MODULE_OPTIONS = [
    { kw: 15, vRange: [150, 1000], iMax: 25, cool: '风冷' },
    { kw: 20, vRange: [150, 1000], iMax: 40, cool: '风冷' },
    { kw: 30, vRange: [150, 1000], iMax: 60, cool: '风冷' },
    { kw: 40, vRange: [200, 1000], iMax: 80, cool: '风冷/液冷' },
    { kw: 60, vRange: [200, 1000], iMax: 120, cool: '液冷' }
  ];

  /* ---------- 标称档位序列（用于确定性选型，不是产品型录） ---------- */
  const SERIES = {
    breakerA: [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600],
    acContactorA: [9, 12, 18, 25, 32, 40, 50, 65, 80, 95, 115, 150, 185, 225, 265, 330, 400, 500, 630, 800],
    dcContactorA: [50, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000],
    dcFuseA: [32, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600],
    sensorA: [100, 200, 300, 500, 600, 800, 1000, 1500, 2000],
    psuW: [150, 240, 320, 480, 720, 1000, 1500, 2000, 3000, 4500],
    pcsKw: [30, 50, 60, 100, 125, 150, 200, 250],
    dcdcKw: [20, 30, 40, 50, 60]
  };

  /* 铜芯电缆载流量（空气中敷设、30℃、参考值）。真实取值必须按项目
   * 敷设方式、环境温度、成束系数、压降和短路热稳定重新校核。 */
  const CABLE = [
    { mm2: 6, a: 46 }, { mm2: 10, a: 63 }, { mm2: 16, a: 85 }, { mm2: 25, a: 112 },
    { mm2: 35, a: 138 }, { mm2: 50, a: 168 }, { mm2: 70, a: 213 }, { mm2: 95, a: 258 },
    { mm2: 120, a: 299 }, { mm2: 150, a: 344 }, { mm2: 185, a: 392 }, { mm2: 240, a: 461 },
    { mm2: 300, a: 530 }
  ];

  /* 枪线：常规风冷电缆 vs 液冷电缆（液冷可用更小截面承载大电流） */
  const GUN_CABLE = [
    { maxA: 125, mm2: 35, cool: '常规风冷枪线' },
    { maxA: 200, mm2: 70, cool: '常规风冷枪线' },
    { maxA: 250, mm2: 95, cool: '常规风冷枪线' },
    { maxA: 300, mm2: 25, cool: '液冷枪线' },
    { maxA: 400, mm2: 35, cool: '液冷枪线' },
    { maxA: 600, mm2: 50, cool: '液冷枪线' }
  ];

  /* ---------- 电池 ---------- */
  const CHEMISTRY = {
    lfp: { id: 'lfp', name: '磷酸铁锂 LFP', cellV: 3.2, vMinRatio: 0.78, vMaxRatio: 1.14, note: '循环寿命与热失控裕度较好，低温性能需加热策略' },
    nmc: { id: 'nmc', name: '三元 NMC', cellV: 3.7, vMinRatio: 0.81, vMaxRatio: 1.14, note: '能量密度高，热安全与消防等级要求更严格' }
  };
  const CELL_AH = [50, 100, 105, 150, 200, 230, 280, 314];
  /* 簇标称电压档位：1P160S ≈ 512V(LFP)，1P240S ≈ 768V(LFP) */
  const CLUSTER_SERIES = [
    { cellCount: 160, label: '1P160S' },
    { cellCount: 240, label: '1P240S' }
  ];

  const COUPLING = {
    dc: { id: 'dc', name: '直流侧耦合', note: '电池经 DC/DC 直接并到充电直流母线，转换级数少、效率高' },
    ac: { id: 'ac', name: '交流侧耦合', note: '电池经 PCS 并到交流母排，可并网/离网切换，兼容既有交流配电' }
  };

  /* 取不小于 value 的最小标称档位。超出内置序列时返回 overflow 标记，
   * 由调用方显式告警，绝不静默按最大档位选型。 */
  function nextIn(value, series) {
    return series.find((n) => n >= value) || series[series.length - 1];
  }
  function exceedsSeries(value, series) {
    return value > series[series.length - 1];
  }
  /* Unknown identifiers are input errors.  Silent fallback could put GB/T
   * terminals on a NACS/CHAdeMO requirement or select the wrong topology. */
  const standard = (id) => STANDARDS[id] || null;
  const archetype = (id) => ARCHETYPES[id] || null;
  const chemistry = (id) => CHEMISTRY[id] || CHEMISTRY.lfp;

  function cableFor(currentA, parallelLimit) {
    const limit = Math.max(1, parallelLimit || 4);
    for (let n = 1; n <= limit; n += 1) {
      const hit = CABLE.find((item) => item.a * n >= currentA);
      if (hit) return { mm2: hit.mm2, cores: n, ampacity: hit.a * n };
    }
    const last = CABLE[CABLE.length - 1];
    return { mm2: last.mm2, cores: limit, ampacity: last.a * limit, overflow: true };
  }
  function gunCableFor(currentA) {
    return GUN_CABLE.find((item) => item.maxA >= currentA) || GUN_CABLE[GUN_CABLE.length - 1];
  }
  function moduleFor(kw) {
    return MODULE_OPTIONS.find((item) => item.kw === Number(kw)) || MODULE_OPTIONS[2];
  }

  return {
    VERSION, BASIS, STANDARDS, ARCHETYPES, MODULE_OPTIONS, SERIES, CABLE, GUN_CABLE,
    CHEMISTRY, CELL_AH, CLUSTER_SERIES, COUPLING,
    nextIn, exceedsSeries, standard, archetype, chemistry, cableFor, gunCableFor, moduleFor
  };
})();
