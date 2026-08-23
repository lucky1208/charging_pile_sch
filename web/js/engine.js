/* ============================================================
 * 充电桩确定性选型与原理图工程引擎  v4.0
 * ------------------------------------------------------------
 * 职责：把表单参数确定性地翻译成设备数量、额定档位、回路参数和
 * 工程模型。相同输入必须得到完全相同的输出。
 *
 * 明确不做的事：不出具保护整定值、不做短路/EMC/型式试验结论、
 * 不生成认证或合规声明、不产生厂家报价，也不允许 AI 改写任何
 * 计算结果或图纸几何。
 * ============================================================ */
window.EVSE_ENGINE = (function () {
  'use strict';

  const ENGINE_VERSION = '4.0.0';
  const DOCUMENT_STATUS = 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED';

  const asNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const positive = (value, fallback) => {
    const n = asNumber(value, fallback);
    return n > 0 ? n : fallback;
  };
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const round = (n) => Math.round(n);
  const cnyToWan = (value) => r2(value / 10000);
  const safeText = (value, fallback) => String(value == null ? fallback : value).replace(/[<>]/g, '').trim() || fallback;

  /* 输出电压窗口档位（模块输出范围，不是电池电压） */
  const VOLTAGE_WINDOWS = {
    '200-750': { min: 200, max: 750, label: '200–750V' },
    '150-1000': { min: 150, max: 1000, label: '150–1000V' },
    '200-1000': { min: 200, max: 1000, label: '200–1000V' },
    '500-1000': { min: 500, max: 1000, label: '500–1000V（高压平台车型）' }
  };

  function build(P0) {
    const rawInput = P0 && typeof P0 === 'object' ? P0 : {};
    const P = Object.assign({}, rawInput);
    const STD = window.EV_STD;
    if (!STD) throw new Error('EV_STD 标准库未加载，无法进行确定性选型。');

    const warnings = [];
    const assumptions = [];
    const assumptionIds = new Set();
    const addAssumption = (id, value, note) => {
      if (assumptionIds.has(id)) return;
      assumptionIds.add(id);
      assumptions.push({ id, value, note, status: 'ASSUMPTION' });
    };

    P.pileName = safeText(P.pileName, '充电桩');
    P.site = safeText(P.site, '未指定站点');
    P.pref = P.pref || 'balance';
    P.specialRequirements = Array.isArray(P.specialRequirements) ? P.specialRequirements.slice(0, 20) : [];

    /* 档位选取：超出内置标称序列时必须显式告警，不允许静默按最大档位选型 */
    const pick = (value, series, label) => {
      if (STD.exceedsSeries(value, series)) {
        warnings.push(label + ' 所需容量 ' + Math.ceil(value) + ' 已超出内置标称档位序列上限 ' +
          series[series.length - 1] + '，必须由电气专业按厂家型录另行选型。');
      }
      return STD.nextIn(value, series);
    };

    const std = STD.standard(P.standard);
    const arch = STD.archetype(P.archetype);
    const window0 = VOLTAGE_WINDOWS[P.voltageWindow] || VOLTAGE_WINDOWS['200-1000'];

    /* ---------- 输出功率与功率模块 ---------- */
    const requestedKw = positive(P.outputKw, 120);
    const moduleSpec = STD.moduleFor(positive(P.moduleKw, 30));
    const moduleCount = Math.max(1, Math.ceil(requestedKw / moduleSpec.kw));
    const installedKw = moduleCount * moduleSpec.kw;
    if (installedKw !== requestedKw) {
      addAssumption('MODULE-ROUNDING', moduleCount + ' × ' + moduleSpec.kw + 'kW = ' + installedKw + 'kW',
        '装机功率按整数台功率模块向上取整；额定输出 ' + requestedKw + 'kW 与装机容量的差额留作模块降额裕度。');
    }

    const gunCount = Math.min(4, Math.max(1, round(asNumber(P.gunCount, 2))));
    const gunCurrentA = positive(P.gunCurrentA, 250);
    if (!std.gunCurrentOptions.includes(gunCurrentA)) {
      addAssumption('GUN-CURRENT', gunCurrentA + ' A', '所选枪电流不在常用档位内，枪线、端子温升和连接器型式试验必须专项确认。');
    }

    /* ---------- 辅助电源、热管理与人机交互 ---------- */
    const thermalMode = P.thermal === 'liquid' ? 'liquid' : 'air';
    const fanCount = thermalMode === 'air' ? Math.max(2, Math.ceil(installedKw / 30)) : 2;
    const liquidUnitKw = thermalMode === 'liquid' ? r1(installedKw * 0.06) : 0;
    const heaterW = P.lowTemp ? 400 : 0;
    const load24W = 30 + gunCount * 2 * 15 + gunCount * 20 + fanCount * 25 + heaterW + 40;
    const load12W = 35 + 8 + 15 + 20 + gunCount * 5;
    const psu24W = pick(load24W * 1.4, STD.SERIES.psuW, 'DC24V 开关电源');
    const psu12W = pick(load12W * 1.4, STD.SERIES.psuW, 'DC12V 开关电源');
    const backend = P.backend || (std.physicalLayer === 'CAN' ? 'private' : 'ocpp16');
    const backendText = backend === 'ocpp201' ? 'OCPP 2.0.1（TLS）' : backend === 'ocpp16' ? 'OCPP 1.6J（TLS）' : '运营商私有协议 + 可选 OCPP 网关';
    const aux = {
      thermalMode,
      thermalName: thermalMode === 'liquid' ? '模块液冷机组' : '柜内强制风冷',
      thermalText: thermalMode === 'liquid'
        ? '液冷机组 ' + liquidUnitKw + 'kW（交流侧独立供电支路，DC24V 仅供控制与联锁）；管路、流量与漏液联锁待热工专项计算'
        : fanCount + ' 台轴流风机 + 防尘滤网，风量与温升待样机试验验证',
      fanCount, liquidUnitKw, heaterW,
      load24W: round(load24W), load12W: round(load12W),
      psu24W, psu12W,
      psu24Text: 'AC/DC ' + psu24W + 'W · 24VDC（估算负载 ' + round(load24W) + 'W）',
      psu12Text: 'AC/DC ' + psu12W + 'W · 12VDC（估算负载 ' + round(load12W) + 'W）',
      hmiText: safeText(P.hmiSize, '7 英寸') + '触摸屏 + 读卡器（' + (P.hmiPayment || '扫码 / 刷卡') + '）',
      networkText: '4G/以太网双通道 · ' + backendText,
      backend, backendText,
      ipRating: safeText(P.ipRating, 'IP54'),
      ambientText: safeText(P.ambient, '-20℃ ~ +50℃')
    };

    /* ---------- 交流进线 ---------- */
    const acLineVoltage = positive(P.acVoltage, std.acLineVoltage);
    const moduleEff = positive(P.moduleEfficiency, 0.95);
    const inputPf = positive(P.inputPf, 0.99);
    /* 进线容量 = 充电模块 + 热管理 + 辅助电源，避免只按模块容量选进线开关 */
    const auxDemandKw = r1(liquidUnitKw + (psu24W + psu12W) / 1000 + (thermalMode === 'air' ? fanCount * 0.09 : 0));
    const inputKva = installedKw / (moduleEff * inputPf) + auxDemandKw;
    const inputA = inputKva * 1000 / (Math.sqrt(3) * acLineVoltage);
    const acBreakerA = pick(inputA * 1.25, STD.SERIES.breakerA, '交流进线断路器');
    const acContactorA = pick(inputA * 1.25, STD.SERIES.acContactorA, '交流主接触器');
    const acBusbarA = pick(inputA * 1.30, STD.SERIES.breakerA, '交流母排');
    const acCable = STD.cableFor(acBreakerA, 4);
    const supplyMode = P.supplyMode || 'grid';
    const supplyText = supplyMode === 'transformer' ? '专用变压器供电（变压器容量与保护配合待电气专业计算）'
      : supplyMode === 'offgrid' ? '储能离网供电为主，市电/补电座为补能路径'
        : '市电低压直供（供电容量与并网批复待供电部门确认）';

    const ac = {
      lineVoltage: acLineVoltage,
      phases: std.phases,
      neutral: std.neutral,
      description: std.acVoltage,
      supplyMode, supplyText,
      inputKva: r1(inputKva), auxDemandKw,
      inputA: r1(inputA),
      breakerA: acBreakerA,
      contactorA: acContactorA,
      busbarA: acBusbarA,
      breakingKa: '≥36kA（待短路电流计算书确认）',
      cableText: acCable.cores + '×' + acCable.mm2 + 'mm² 铜芯（载流 ' + acCable.ampacity + 'A 参考值）',
      cable: acCable,
      spdClass: 'T1+T2 · Iimp 12.5kA(10/350μs) · Up≤2.5kV',
      rcdType: 'Type B 剩余电流监测（含 ≥6mA 直流分量检测），动作值待接地型式与保护配合确认',
      earthing: std.earthing
    };
    if (acCable.overflow) warnings.push('交流进线电流已超出内置电缆表范围，进线截面与敷设方式必须由电气专业单独计算。');

    /* ---------- 充电直流侧 ---------- */
    const dcCurrentByPower = installedKw * 1000 / window0.min;
    const dcCurrentByGun = gunCount * gunCurrentA;
    const dcMainA = Math.ceil(Math.min(dcCurrentByPower, dcCurrentByGun));
    const dcMainFuseA = pick(dcMainA * 1.25, STD.SERIES.dcFuseA, '直流总快熔');
    const dcBusbarA = pick(dcMainA * 1.30, STD.SERIES.breakerA, '直流母排');
    const dcSensorRangeA = pick(dcMainA * 1.50, STD.SERIES.sensorA, '直流电流传感器');
    const dc = {
      ratedKw: requestedKw,
      installedKw,
      moduleKw: moduleSpec.kw,
      moduleCount,
      moduleCooling: moduleSpec.cool,
      moduleSpecText: moduleSpec.kw + 'kW · ' + moduleSpec.vRange[0] + '–' + moduleSpec.vRange[1] + 'V · ' + moduleSpec.iMax + 'A',
      outputRangeText: window0.label,
      outputVmin: window0.min,
      outputVmax: window0.max,
      busVoltageV: window0.max,
      mainCurrentA: dcMainA,
      mainFuseA: dcMainFuseA,
      busbarA: dcBusbarA,
      sensorRangeA: dcSensorRangeA,
      imdSpec: '直流对地绝缘监测，报警判据 ≥100Ω/V（具体阈值与响应时间按 ' + std.safety + ' 项目确认）',
      dischargeText: '母线泄放电阻，停机 1s 内降至 ≤60VDC（阻值与功率待电容量核算）'
    };
    if (window0.max > moduleSpec.vRange[1]) {
      warnings.push('所选输出电压窗口上限超过功率模块能力，需改选模块或缩小输出电压范围。');
    }

    /* ---------- 充电枪回路 ---------- */
    const gunCableSpec = STD.gunCableFor(gunCurrentA);
    const gunFuseA = pick(gunCurrentA * 1.25, STD.SERIES.dcFuseA, '枪回路快熔');
    const gunContactorA = pick(gunCurrentA * 1.25, STD.SERIES.dcContactorA, '枪回路直流接触器');
    const gunPowerKw = Math.min(installedKw, round(gunCurrentA * window0.max / 1000));
    const controlSignalText = std.physicalLayer === 'CAN'
      ? 'CC1/CC2 连接确认 + 电子锁到位反馈 + 枪端温度 T1/T2'
      : 'CP 控制导引(PWM) + PP 插头在位 + 电子锁到位反馈 + 枪端温度 T1/T2';
    const commSignalText = std.physicalLayer === 'CAN'
      ? 'S+/S- CAN 250kbps（' + std.protocol + '）'
      : 'CP 线载波 HomePlug Green PHY（' + std.protocol + '）';
    const guns = [];
    for (let i = 1; i <= gunCount; i += 1) {
      guns.push({
        index: i,
        name: std.name + ' 直流充电枪 ' + i,
        tag: 'XS' + i,
        fuseTag: 'F' + i,
        contactorTagP: 'K' + i + 'P',
        contactorTagN: 'K' + i + 'N',
        lockTag: 'YV' + i,
        currentA: gunCurrentA,
        powerKw: gunPowerKw,
        fuseA: gunFuseA,
        contactorA: gunContactorA,
        pins: std.dcPins.slice(),
        pinText: std.dcPins.join(' / '),
        cableText: gunCableSpec.cool + ' ' + gunCableSpec.mm2 + 'mm²（' + gunCurrentA + 'A 连续）',
        voltageRangeText: window0.label,
        lockText: std.electronicLock ? '电子锁 + 锁到位反馈（充电中禁止解锁）' : '机械锁（本标准未要求电子锁）',
        controlSignalText,
        commSignalText
      });
    }
    const powerSharing = gunCount > 1
      ? '功率动态分配：模块按枪需求分组投切，单枪最大 ' + gunPowerKw + 'kW，合计不超过装机 ' + installedKw + 'kW'
      : '单枪独占全部模块功率 ' + Math.min(installedKw, gunPowerKw) + 'kW';

    /* ---------- 储能系统 ---------- */
    const essEnabled = P.essEnabled === true || P.essEnabled === 'true' || P.essEnabled === 1 || P.essEnabled === '1';
    let ess = { enabled: false };
    if (essEnabled) {
      const chem = STD.chemistry(P.essChem);
      const requestedKwh = positive(P.essKwh, 100);
      const series = requestedKwh >= 150 ? STD.CLUSTER_SERIES[1] : STD.CLUSTER_SERIES[0];
      const vNom = round(series.cellCount * chem.cellV);
      const ahTotal = requestedKwh * 1000 / vNom;
      /* 优先用最少簇数满足容量：先试 1 簇，再逐步增加，避免把大容量
       * 拆成一堆小电芯簇。簇内电芯 Ah 取标称档位向上取整。 */
      let cellAh = STD.CELL_AH[STD.CELL_AH.length - 1];
      let clusterCount = Math.max(1, Math.ceil(ahTotal / cellAh));
      for (let count = 1; count <= 8; count += 1) {
        const candidate = STD.CELL_AH.find((value) => value >= ahTotal / count);
        if (candidate) { cellAh = candidate; clusterCount = count; break; }
      }
      const clusterKwh = r1(cellAh * vNom / 1000);
      const installedKwh = r1(clusterKwh * clusterCount);
      const dod = 0.90;
      const usableKwh = r1(installedKwh * dod);
      const vMin = round(vNom * chem.vMinRatio);
      const vMax = round(vNom * chem.vMaxRatio);

      const coupling = P.essCoupling === 'ac' ? 'ac' : 'dc';
      const requestedPowerKw = positive(P.essPowerKw, Math.min(installedKw, round(installedKwh * 0.5)));
      const unitSeries = coupling === 'ac' ? STD.SERIES.pcsKw : STD.SERIES.dcdcKw;
      const candidates = unitSeries.filter((n) => n <= requestedPowerKw);
      const converterUnitKw = candidates.length ? candidates[candidates.length - 1] : unitSeries[0];
      const converterCount = Math.max(1, Math.ceil(requestedPowerKw / converterUnitKw));
      const converterInstalledKw = converterUnitKw * converterCount;
      const clusterCurrentA = converterInstalledKw * 1000 / (vMin * clusterCount);
      const clusterFuseA = pick(clusterCurrentA * 1.5, STD.SERIES.dcFuseA, '电池簇快熔');
      const clusterContactorA = pick(clusterCurrentA * 1.5, STD.SERIES.dcContactorA, '电池簇主接触器');
      const prechargeR = Math.max(10, round(vMax / 30 / 5) * 5);
      const cRate = r2(converterInstalledKw / installedKwh);
      /* 变换器并网侧保护（对标欧标参考图 KM1/K9/K10/FU3 与 K7/K8/FU2）：
       * 交流耦合＝断路器 + 并网接触器；直流耦合＝并网接触器 + 快熔 */
      const gridAcCurrentA = coupling === 'ac' ? converterInstalledKw * 1000 / (asNumber(P.acVoltage, 400) * 1.732 * 0.99) : 0;
      const gridAcBreakerA = coupling === 'ac' ? pick(gridAcCurrentA * 1.25, STD.SERIES.breakerA, 'PCS 并网断路器') : 0;
      const gridAcContactorA = coupling === 'ac' ? pick(gridAcCurrentA * 1.25, STD.SERIES.acContactorA, 'PCS 并网接触器') : 0;
      const gridDcCurrentA = coupling === 'dc' ? converterInstalledKw * 1000 / vMin : 0;
      const gridDcFuseA = coupling === 'dc' ? pick(gridDcCurrentA * 1.5, STD.SERIES.dcFuseA, 'DC/DC 并网快熔') : 0;
      const gridDcContactorA = coupling === 'dc' ? pick(gridDcCurrentA * 1.5, STD.SERIES.dcContactorA, 'DC/DC 并网接触器') : 0;

      ess = {
        enabled: true,
        chemistry: chem.id, chemistryName: chem.name, chemistryNote: chem.note,
        requestedKwh, installedKwh, usableKwh, dod,
        clusterCount, clusterKwh, cellAh, cellCount: series.cellCount,
        clusterConfig: series.label + '（' + series.cellCount + ' 串 × ' + cellAh + 'Ah）',
        busVoltageV: vNom, voltageMinV: vMin, voltageMaxV: vMax,
        voltageRangeText: vMin + '–' + vMax + 'V（标称 ' + vNom + 'V）',
        coupling, couplingName: STD.COUPLING[coupling].name, couplingNote: STD.COUPLING[coupling].note,
        converterKind: coupling === 'ac' ? 'PCS' : 'DC/DC',
        converterUnitKw, converterCount, converterInstalledKw,
        converterText: converterCount + ' × ' + converterUnitKw + 'kW ' + (coupling === 'ac' ? '双向 PCS' : '双向 DC/DC'),
        clusterCurrentA: r1(clusterCurrentA),
        clusterFuseA, clusterContactorA, prechargeR,
        clusterProtectText: '快熔 ' + clusterFuseA + 'A + 主正/主负接触器 ' + clusterContactorA + 'A + 预充 ' + prechargeR + 'Ω/200W + 手动维修隔离',
        gridAcBreakerA, gridAcContactorA, gridDcFuseA, gridDcContactorA,
        gridProtectText: coupling === 'ac'
          ? 'AC 并网断路器 QF2 ' + gridAcBreakerA + 'A + 并网接触器 KM2 ' + gridAcContactorA + 'A（防孤岛与并网检测待专项）'
          : 'DC 并网接触器 KC1 ' + gridDcContactorA + 'A + 并网快熔 FC1 ' + gridDcFuseA + 'A',
        bmsText: '三层架构 BAMS/BCU/BMU：簇级 CAN 汇总至主控，SOC/SOH、温度、单体压差与均衡策略待电池厂家数据',
        cRate,
        fireText: 'PACK 级可燃气体/烟温复合探测 + 舱级灭火（全氟己酮/气溶胶），消防等级与联动矩阵待消防专项设计',
        thermalText: '电池舱独立温控（' + (thermalMode === 'liquid' ? '液冷' : '空调风冷') + '），温度均匀性与低温加热策略待热仿真',
        peakShavingText: '削峰填谷：谷段/低谷电价时段从电网充电，峰段与大功率充电时段由储能补充'
      };
      if (cRate > 1.2) warnings.push('储能功率与容量之比达到 ' + cRate + 'C，电池选型、寿命与热管理必须由电池厂家数据复核。');
      if (converterInstalledKw < installedKw * 0.3 && ess.coupling === 'dc') {
        addAssumption('ESS-POWER-RATIO', converterInstalledKw + ' kW',
          '储能变换器功率明显低于充电装机功率，大功率充电时仍主要依赖电网，功率分配策略待运行工况确认。');
      }
    }

    /* ---------- 设备明细表（图上只放位号，规格集中到表） ---------- */
    const schedule = [];
    const addSched = (tag, name, spec) => schedule.push({ tag, name, spec: safeText(spec, '待确认') });
    addSched('W01', '交流进线电缆', ac.cableText);
    addSched('QS1', '进线隔离开关', acBreakerA + 'A/' + (std.neutral ? '4P' : '3P'));
    addSched('QF1', '进线断路器', acBreakerA + 'A · ' + ac.breakingKa);
    addSched('FV1', '电源浪涌保护器', ac.spdClass);
    addSched('RCM1', '剩余电流监测', ac.rcdType);
    addSched('PJ1', '交流电能表', std.meter + '·母线取电');
    addSched('KM1', '交流主接触器', acContactorA + 'A AC-3·线圈 24VDC 取自 A1 DO');
    addSched('WB1', '交流分配母排', acBusbarA + 'A · ' + acLineVoltage + 'V');
    addSched('M1', '充电功率模块', moduleCount + ' × ' + dc.moduleSpecText + '（' + moduleSpec.cool + '）');
    addSched('FU1', '直流总快熔', dcMainFuseA + 'A gR/aR');
    addSched('TA1', '直流电流传感器', '霍尔式 0–' + dcSensorRangeA + 'A');
    addSched('PJ2', '直流电能表', std.meter + '·母线取电');
    addSched('RI1', '绝缘监测装置', dc.imdSpec + '·供电 24VDC 取自 WB4');
    addSched('RS0', '母线泄放电阻', dc.dischargeText);
    addSched('WB2', '充电直流母线', dcBusbarA + 'A · ' + window0.label);
    guns.forEach((gun) => {
      addSched(gun.fuseTag, '枪' + gun.index + ' 直流快熔', gun.fuseA + 'A gR/aR');
      addSched(gun.contactorTagP + '/' + gun.contactorTagN, '枪' + gun.index + ' 直流接触器', gun.contactorA + 'A ×2（正/负极）');
      addSched(gun.lockTag, '枪' + gun.index + ' 电子锁', gun.lockText + '・24V 取自 A1 DO');
      addSched(gun.tag, '充电枪 ' + gun.index, std.name + '：' + gun.pinText + ' · ' + gun.cableText);
    });
    addSched('A1', '充电控制单元', 'CCU · ' + std.protocol + '·供电 24VDC 取自 WB4');
    addSched('A2', std.physicalLayer === 'PLC' ? 'SECC 控制器' : '计费网关', aux.backendText + '·供电 24VDC 取自 WB4');
    addSched('A3', '路由器 / 通信模块', aux.networkText + '・供电 24VDC 取自 WB4');
    addSched('A4', '人机交互单元', aux.hmiText + '·供电 24VDC 取自 WB4');
    addSched('SB1', '急停按钮', '双断点自锁，硬线切除输出使能·24V 回路接 A1 DI');
    addSched('HL', '状态指示灯', '红/绿/黄三色，柜门显示·24V 取自 A1 DO');
    addSched('SQ1', '门禁/防拆开关', '门开联锁切除输出使能·24V 回路接 A1 DI');
    addSched('B1', '环境监测', '温度/烟感/水浸·供电 24VDC 取自 WB4');
    addSched('T1', '开关电源 24V', aux.psu24Text + '·输入 AC 取自 WB1');
    addSched('T2', '开关电源 12V', aux.psu12Text + '·输入 AC 取自 WB1');
    addSched('WB4', '辅助直流母排', 'DC24V / DC12V');
    if (aux.heaterW) addSched('EH', '加热/除湿回路', aux.heaterW + 'W，低温/凝露策略待热工确认');
    addSched('M2', aux.thermalName, aux.thermalText + '·供电 24VDC 取自 WB4');
    addSched('PE', '保护接地', ac.earthing + '；接地电阻与等电位待现场实测');
    if (ess.enabled) {
      addSched('GB1~' + ess.clusterCount, '储能电池簇', ess.clusterCount + ' × ' + ess.clusterKwh + 'kWh · ' + ess.clusterConfig);
      addSched('QP1~' + ess.clusterCount, '簇保护单元', ess.clusterProtectText);
      addSched('WB3', '储能母线', ess.voltageRangeText);
      addSched('FB1~' + ess.clusterCount, '簇直流快熔', ess.clusterFuseA + 'A gR/aR');
      addSched('KB1~' + ess.clusterCount, '簇主正/主负接触器', ess.clusterContactorA + 'A ×2/簇');
      addSched('KP1~' + ess.clusterCount, '簇预充接触器', '与预充电阻串联，簇并入母线先预充');
      addSched('RS1~' + ess.clusterCount, '簇预充电阻', ess.prechargeR + 'Ω/200W');
      addSched('A5', 'BMS 主控 BAMS', ess.bmsText + '·簇供电+24V 备用');
      addSched(ess.coupling === 'ac' ? 'M3' : 'M4', ess.coupling === 'ac' ? '储能变流器 PCS' : '储能双向 DC/DC', ess.converterText + '·控制电 24VDC 取自 WB4');
      if (ess.coupling === 'ac') {
        addSched('QF2', 'PCS 并网断路器', ess.gridAcBreakerA + 'A/4P');
        addSched('KM2', 'PCS 并网接触器', ess.gridAcContactorA + 'A AC-3');
      } else {
        addSched('KC1', 'DC/DC 并网接触器', ess.gridDcContactorA + 'A');
        addSched('FC1', 'DC/DC 并网快熔', ess.gridDcFuseA + 'A gR/aR');
      }
      addSched('FS1', '电池舱消防', ess.fireText);
    }

    /* ---------- 概念造价（受控示例目录，不是报价） ---------- */
    const VEN = window.VENDORS;
    const bom = [];
    const addBom = (cat, name, model, qty, unit, unitCny, note) => {
      if (!(qty > 0)) return;
      const cleanUnitCny = Math.max(0, Number(unitCny) || 0);
      const totalCny = round(cleanUnitCny * qty);
      bom.push({
        cat, name, model, qty, unit, unitPriceCny: cleanUnitCny, totalCny,
        unitPrice: cnyToWan(cleanUnitCny), total: cnyToWan(totalCny),
        note: note || '', source: '概念估算/非报价', status: 'RFQ_REQUIRED'
      });
    };
    addBom('功率', '充电功率模块', dc.moduleSpecText, moduleCount, '台', moduleSpec.kw * 400, moduleSpec.cool);
    addBom('功率', '柜体与母排系统', arch.name, 1, '套', 12000 + installedKw * 90, '含结构、散热风道、防护等级 ' + aux.ipRating);
    addBom('保护', '交流进线开关与保护', acBreakerA + 'A 组件', 1, '套', 2600 + acBreakerA * 12, '含隔离、断路器、SPD、漏电监测');
    addBom('保护', '直流保护与传感', dcMainFuseA + 'A 组件', 1, '套', 1800 + dcMainA * 8, '含快熔、霍尔传感器、绝缘监测、泄放');
    addBom('枪线', '直流充电枪总成', std.name + ' ' + gunCurrentA + 'A', gunCount, '套', gunCurrentA >= 300 ? 16000 : 5200, gunCableSpec.cool);
    addBom('枪线', '枪回路接触器与快熔', gunContactorA + 'A', gunCount, '套', 1400 + gunContactorA * 6, '每枪正负极各一只直流接触器');
    addBom('控制', '控制与通信单元', std.protocol, 1, '套', 6800, '含 CCU、通信网关、路由器');
    addBom('控制', '计量与人机交互', std.meter, 1, '套', 4200, aux.hmiText);
    addBom('辅助', '辅助电源与热管理', aux.thermalName, 1, '套', 2400 + (psu24W + psu12W) * 2, aux.thermalText);
    if (ess.enabled) {
      const battery = VEN ? VEN.select('battery', P.pref, { requiredCapacity: ess.clusterKwh }) : null;
      const batteryModel = battery && battery.recommended ? battery.recommended.vendor + ' ' + battery.recommended.model : '无目录容量匹配，待 RFQ';
      const batteryUnit = battery && battery.recommended ? battery.recommended.priceCnyPerUnit : 700;
      addBom('储能', '储能电池簇（含 BCU）', batteryModel, ess.clusterCount, '簇', batteryUnit * ess.clusterKwh, ess.clusterKwh + 'kWh/簇 · ' + ess.chemistryName);
      const converter = VEN ? VEN.select(ess.coupling === 'ac' ? 'pcs' : 'dcdc', P.pref, { requiredCapacity: ess.converterUnitKw }) : null;
      const converterModel = converter && converter.recommended ? converter.recommended.vendor + ' ' + converter.recommended.model : '无目录容量匹配，待 RFQ';
      const converterUnit = converter && converter.recommended ? converter.recommended.priceCnyPerUnit : 600;
      addBom('储能', ess.coupling === 'ac' ? '储能变流器 PCS' : '储能双向 DC/DC', converterModel, ess.converterCount, '台', converterUnit * ess.converterUnitKw, ess.converterText);
      addBom('储能', '变换器并网保护', ess.coupling === 'ac' ? 'QF2 + KM2' : 'KC1 + FC1', 1, '套', 4200, ess.gridProtectText);
      addBom('储能', '簇保护、BMS 与消防', 'BAMS + 探测 + 灭火', 1, '套', 18000 + ess.clusterCount * 9000, ess.fireText);
    }
    const bomTotalCny = bom.reduce((sum, item) => sum + item.totalCny, 0);
    const bomTotal = cnyToWan(bomTotalCny);

    /* ---------- 明确的校核边界 ---------- */
    const validation = [
      { id: 'EV-SIZING-001', result: 'CALCULATED', rule: '功率模块与输出能力', ref: '本引擎确定性计算', detail: '额定 ' + requestedKw + 'kW，装机 ' + moduleCount + ' × ' + moduleSpec.kw + 'kW = ' + installedKw + 'kW；单枪最大 ' + gunPowerKw + 'kW，' + powerSharing + '。', evidence: ['MODULE-COUNT'] },
      { id: 'EV-AC-001', result: 'ASSUMPTION', rule: '交流进线电流与开关档位', ref: '待供电方案与短路计算书', detail: '按效率 ' + moduleEff + '、功率因数 ' + inputPf + '，含辅助与热管理 ' + auxDemandKw + 'kW，概算进线 ' + r1(inputA) + 'A，选 ' + acBreakerA + 'A 断路器与 ' + ac.cableText + '；分断能力、敷设方式与压降未校核。', evidence: ['AC-INPUT'] },
      { id: 'EV-SC-001', result: 'NOT_CHECKED', rule: '短路电流与保护配合', ref: '短路计算书 / 保护配合研究', detail: '未导入供电点短路容量、上级保护曲线与选择性要求；禁止以本表档位作为整定依据。', evidence: [] },
      { id: 'EV-INSU-001', result: 'ASSUMPTION', rule: '绝缘监测与接地故障保护', ref: std.safety, detail: dc.imdSpec + '；接地型式 ' + ac.earthing + '，实际判据、动作时间和试验方法必须按适用标准版本确认。', evidence: ['IMD'] },
      { id: 'EV-CONN-001', result: 'ASSUMPTION', rule: '充电接口与通信协议', ref: std.connector + ' / ' + std.protocol, detail: '按 ' + std.name + ' 接口画出 ' + std.dcPins.join('、') + ' 端子与 ' + controlSignalText + '；互操作性必须通过一致性测试验证。', evidence: ['CONNECTOR'] },
      { id: 'EV-THERM-001', result: 'NOT_CHECKED', rule: '温升、散热与枪端温度保护', ref: '样机温升试验 / 热仿真', detail: aux.thermalText + '；端子温升、降载曲线和枪温保护阈值未计算。', evidence: [] },
      { id: 'EV-EMC-001', result: 'NOT_CHECKED', rule: 'EMC、谐波与并网影响', ref: '型式试验 / 并网检测', detail: '未评估谐波电流、功率因数、闪变、传导与辐射发射；模块并联环流与共模干扰待样机实测。', evidence: [] },
      { id: 'EV-CERT-001', result: 'NOT_CHECKED', rule: '型式试验与认证', ref: std.safety + ' / 当地认证机构', detail: '本图不构成 ' + std.name + ' 合规声明；型式试验、计量检定（' + std.meterNote + '）和市场准入必须另行完成。', evidence: [] },
      { id: 'EV-METER-001', result: 'ASSUMPTION', rule: '计量与计费', ref: std.meter, detail: std.meter + '；' + std.meterNote + '。后台协议采用 ' + aux.backendText + '，数据签名与防篡改要求待运营方确认。', evidence: ['METER'] }
    ];
    if (ess.enabled) {
      validation.push(
        { id: 'EV-ESS-001', result: 'CALCULATED', rule: '储能容量与簇配置', ref: '本引擎确定性计算', detail: '目标 ' + ess.requestedKwh + 'kWh → ' + ess.clusterCount + ' 簇 × ' + ess.clusterKwh + 'kWh（' + ess.clusterConfig + '），装机 ' + ess.installedKwh + 'kWh，按 DOD ' + Math.round(ess.dod * 100) + '% 可用 ' + ess.usableKwh + 'kWh；' + ess.converterText + '，' + ess.cRate + 'C。', evidence: ['ESS-SIZING'] },
        { id: 'EV-ESS-002', result: 'NOT_CHECKED', rule: '电池安全、消防与热失控防护', ref: '消防专项 / 电池厂家安全数据', detail: ess.fireText + '；热失控扩散、泄压、排烟和舱体结构未验证。', evidence: [] },
        { id: 'EV-ESS-003', result: 'NOT_CHECKED', rule: '并离网切换与并网许可', ref: '并网检测 / 供电部门批复', detail: ess.couplingNote + '；防孤岛、并离网切换时间、反送电闭锁与并网批复必须另行取得。', evidence: [] }
      );
    }
    validation.push({ id: 'DOC-REVIEW-001', result: 'NOT_CHECKED', rule: '图纸签发与规范符合性', ref: '注册工程师审查 / 项目适用规范', detail: '当前输出为方案级自动原理图，须由具备相应资格的电气专业人员审核、深化并签发。', evidence: [] });

    const readiness = {
      version: '2.0.0',
      level: 'CONCEPT_ONLY',
      label: '方案级自动原理图，专业校核与型式试验未完成',
      detail: '表单默认值和未核实输入均按工程假设处理。可用于方案比较与内部沟通，不得用于生产、采购、保护整定或认证声明。',
      summary: { assumptionCount: assumptions.length, warningCount: warnings.length },
      entries: [],
      blockingItems: [],
      release: {
        conceptExportAllowed: true,
        reviewPackageAllowed: false,
        constructionDrawingAllowed: false,
        constructionStatus: 'BLOCKED—EXTERNAL_PROFESSIONAL_SIGNOFF_REQUIRED',
        forbiddenLabels: ['生产图', '施工图', 'IFC', 'Issued for Construction'],
        reason: '自动生成器无法验证供电条件、短路数据、厂家器件文件、型式试验记录或执业签章；任何自动输出均不得标记为生产/施工图。',
        requiredExternalAction: '在受控项目环境中完成短路与保护配合计算、EMC 与温升试验、接口一致性测试、消防与并网审批，并由具备资格的人员校审签发。'
      }
    };

    if (!window.EVSE_DESIGN || typeof window.EVSE_DESIGN.create !== 'function') {
      throw new Error('EDEM v4 编译器未加载，已阻止生成空模型。');
    }
    const design = window.EVSE_DESIGN.create({
      params: P, standard: std, ac, dc, guns, ess, aux, assumptions, schedule, engineVersion: ENGINE_VERSION
    });

    const baseResult = {
      ok: true,
      engineVersion: ENGINE_VERSION,
      documentStatus: DOCUMENT_STATUS,
      pileName: P.pileName,
      site: P.site,
      standardId: std.id,
      standard: std,
      archetype: arch,
      pref: P.pref,
      inputs: P,
      ac, dc, guns, ess, aux,
      powerSharing,
      schedule,
      bom, bomTotal, bomTotalCny,
      validation, compliance: validation,
      assumptions, warnings, readiness, releaseGate: readiness.release, design,
      calculations: {
        acInput: { kva: r1(inputKva), currentA: r1(inputA), breakerA: acBreakerA },
        dcOutput: { installedKw, mainCurrentA: dcMainA, mainFuseA: dcMainFuseA },
        ess: ess.enabled ? { installedKwh: ess.installedKwh, converterKw: ess.converterInstalledKw, cRate: ess.cRate } : null
      }
    };

    const drawingSkill = window.EVSE_DRAWING_SKILL;
    if (drawingSkill && typeof drawingSkill.apply === 'function') return drawingSkill.apply(baseResult);

    /* 规则包未加载时保持“失败即封闭”：仍可预览，但不得当作已校验结果。 */
    baseResult.drawingSkill = {
      id: 'EVSE-DRAWING-SKILL-MISSING', version: null, status: 'BLOCKED',
      selectedRuleIds: [], evaluatedRuleIds: [], appliedRuleIds: [], skippedRuleIds: [],
      graphValidation: { status: 'NOT_RUN', blockingCount: 1, checks: [], violations: [] },
      drawingAudits: {}
    };
    baseResult.validation.push({
      id: 'DRAW-SKILL-001', result: 'WARN', rule: '绘图规则包加载状态', ref: 'EVSE_DRAWING_SKILL',
      detail: '绘图规则包未加载；只能预览概念草案，已阻止导出与评审。', evidence: []
    });
    baseResult.compliance = baseResult.validation;
    baseResult.readiness.blockingItems.push({ id: 'DRAW-SKILL-MISSING', title: '绘图规则包未加载', status: 'BLOCKED', detail: '检查 js/drawing-skill.js 的部署和加载顺序。' });
    baseResult.readiness.release.drawingRuleStatus = 'BLOCKED—SKILL_NOT_LOADED';
    baseResult.releaseGate = baseResult.readiness.release;
    return baseResult;
  }

  return { build, ENGINE_VERSION, VOLTAGE_WINDOWS, DOCUMENT_STATUS };
})();
