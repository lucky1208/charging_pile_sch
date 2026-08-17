/* ============================================================
 * EVSE Drawing Skill — sch_lib 参考图提炼的规则包
 * ------------------------------------------------------------
 * 参考图（国标 60kW 充电桩原理图、欧标储能充电桩电气原理图）是
 * 工程经验证据，不是可执行指令，也不是标准符合性证书。本模块把
 * 复核过的画图规律转换成每次生成都要跑的确定性语义图 / 渲染检查。
 *
 * 明确不学习：不复制参考图中的额定值、接触器顺序、线缆规格、
 * 连接器料号、厂商型号与设备数量；不因文件名含“国标/欧标/美标”
 * 就声明标准合规。
 * ============================================================ */
window.EVSE_DRAWING_SKILL = (function () {
  'use strict';

  const ID = 'EVSE-SCH-LIB-DRAWING-SKILL';
  const VERSION = '2.0.0';
  const BASIS_STATUS = 'REFERENCE_DERIVED—PROFESSIONAL_REVIEW_REQUIRED';
  const DRAWING_KEY = 'ev-schematic';

  const SOURCE_LIBRARY = Object.freeze([
    { id: 'SRC-EV-CN', file: 'sch_lib/国标60kW充电桩原理图.svg', type: 'multiline-schematic', reviewed: true },
    { id: 'SRC-EV-EU', file: 'sch_lib/欧标充电桩电气原理图.svg', type: 'multiline-schematic', reviewed: true }
  ]);

  const RULES = Object.freeze([
    { id: 'TOP-001', group: 'topology', enforcement: 'BLOCKING', text: '每条边必须连接两个已声明设备端口，禁止自由坐标端点。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'TOP-002', group: 'topology', enforcement: 'BLOCKING', text: '边必须声明网络类别、方向以及电压或通信协议。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'TOP-003', group: 'topology', enforcement: 'BLOCKING', text: '跨 AC/DC 或跨直流域的连接必须经过明确的变换设备（模块、PCS、DC/DC、开关电源）。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'TOP-005', group: 'topology', enforcement: 'BLOCKING', text: '控制/通信网络与功率网络必须分离，控制边不得成为功率路径。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'BUS-001', group: 'topology', enforcement: 'GUIDANCE', text: '直流母线采用连续主干，支路从显式连接点正交接出。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'EVS-001', group: 'protection', enforcement: 'BLOCKING', text: '每把充电枪必须具备独立的直流快熔与正/负极直流接触器。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'EVS-002', group: 'protection', enforcement: 'BLOCKING', text: '每把充电枪必须接入保护接地，PE 不得只依靠颜色表达。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'EVS-003', group: 'protection', enforcement: 'BLOCKING', text: '充电直流母线必须配置绝缘监测与电流采样，并把信号送至控制单元。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'EVS-004', group: 'protection', enforcement: 'BLOCKING', text: '交流进线必须具备隔离、断路、浪涌保护与剩余电流监测节点。', evidence: ['SRC-EV-EU'] },
    { id: 'EVS-005', group: 'interface', enforcement: 'BLOCKING', text: '充电枪的控制与通信端子必须按所选标准标注，且由控制器/通信控制器驱动。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'ESS-001', group: 'protection', enforcement: 'BLOCKING', text: '每个电池簇必须经过熔断、主接触器与预充单元才能并到储能母线。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'ESS-002', group: 'topology', enforcement: 'BLOCKING', text: '储能直流母线必须经变换设备并入充电直流母线或交流母排，不得直连。', evidence: ['SRC-EV-EU'] },
    { id: 'AUX-001', group: 'protection', enforcement: 'BLOCKING', text: '辅助 24V/12V 必须来自明确的开关电源，不得从功率母线直接取电。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'FED-002', group: 'repetition', enforcement: 'BLOCKING', text: '重复支路（多枪、多电池簇）从模板实例化，位号与目标设备必须唯一。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'TAG-001', group: 'annotation', enforcement: 'BLOCKING', text: '设备、回路及仪表参考代号在项目范围内必须唯一。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'TAG-002', group: 'annotation', enforcement: 'GUIDANCE', text: '额定值必须来自工程数据；未知参数显示“待确认”，不得伪造精确值。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'TAG-003', group: 'annotation', enforcement: 'GUIDANCE', text: '相线、中性线、PE、DC+/DC− 及端子号不得只依赖颜色区分。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'ANN-001', group: 'annotation', enforcement: 'GUIDANCE', text: '电压、电流、容量和线缆规格必须绑定到设备或边，不得成为浮动文本。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'LAY-001', group: 'layout', enforcement: 'GUIDANCE', text: '主能量链保持单一阅读方向：交流进线 → 功率变换 → 直流母线 → 充电枪。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'LAY-002', group: 'layout', enforcement: 'GUIDANCE', text: '线路正交；重复支路等距、同尺寸、同层级。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'LAY-004', group: 'layout', enforcement: 'BLOCKING', text: '线路不得穿过设备、文字、图例或标题栏禁入区。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'LAY-005', group: 'layout', enforcement: 'BLOCKING', text: '真实连接使用连接点；视觉交叉默认不连接并需跨线表达。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'STYLE-001', group: 'style', enforcement: 'GUIDANCE', text: '交流、直流、储能、辅助、控制与通信使用稳定线型并带图例；颜色只能作为辅助。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'GRP-001', group: 'grouping', enforcement: 'GUIDANCE', text: '功能单元（进线柜、功率单元、枪回路、储能舱、二次系统）使用容器边界，成员不得越界漂浮。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] },
    { id: 'DOC-001', group: 'document', enforcement: 'BLOCKING', text: '原理图必须保留图框、图号、修订、状态和编制/校核/批准字段。', evidence: ['SRC-EV-CN', 'SRC-EV-EU'] }
  ]);

  const PROFILES = Object.freeze({
    'ev-schematic': {
      id: 'ev-power-schematic',
      rules: ['TOP-001', 'TOP-002', 'TOP-003', 'TOP-005', 'BUS-001', 'EVS-001', 'EVS-002', 'EVS-003', 'EVS-004', 'EVS-005',
        'ESS-001', 'ESS-002', 'AUX-001', 'FED-002', 'TAG-001', 'TAG-002', 'TAG-003', 'ANN-001',
        'LAY-001', 'LAY-002', 'LAY-004', 'LAY-005', 'STYLE-001', 'GRP-001', 'DOC-001']
    }
  });

  const ruleById = (id) => RULES.find((rule) => rule.id === id);
  const portId = (port) => (typeof port === 'string' ? port : (port && port.id));
  const unique = (items) => Array.from(new Set(items));
  const isPower = (netClass) => /^POWER_/.test(netClass || '');
  const isSignal = (netClass) => /^SIGNAL_/.test(netClass || '');

  function profileFor(drawingKey) {
    return Object.prototype.hasOwnProperty.call(PROFILES, drawingKey) ? PROFILES[drawingKey] : null;
  }
  function rulesFor(drawingKey) {
    const profile = profileFor(drawingKey);
    return profile ? profile.rules.map(ruleById).filter(Boolean).map((rule) => Object.assign({}, rule)) : [];
  }

  function validateGraph(result) {
    const design = result && result.design ? result.design : {};
    const equipment = Array.isArray(design.equipment) ? design.equipment : [];
    const circuits = Array.isArray(design.circuits) ? design.circuits : [];
    const converters = Array.isArray(design.domainConverters) ? design.domainConverters : [];
    const checks = [];
    const add = (code, ruleId, ok, severity, detail, evidence) => checks.push({
      code, ruleId, ok: !!ok, status: ok ? 'CHECKED' : 'VIOLATION', severity, detail, evidence: evidence || []
    });

    const ids = equipment.map((item) => item.id).filter(Boolean);
    const refs = equipment.map((item) => item.referenceDesignation || item.ref).filter(Boolean);
    const circuitIds = circuits.map((item) => item.id).filter(Boolean);
    const circuitRefs = circuits.map((item) => item.referenceDesignation || item.ref).filter(Boolean);
    const byId = {};
    equipment.forEach((item) => { if (item && item.id) byId[item.id] = item; });
    const byKind = (kind) => equipment.filter((item) => item.kind === kind);

    add('E004-EQUIPMENT-ID', 'TAG-001', ids.length === equipment.length && ids.length === unique(ids).length, 'ERROR', '设备 ID 必须存在且唯一。', ids);
    add('E004-REFERENCE', 'TAG-001', refs.length === equipment.length && refs.length === unique(refs).length, 'ERROR', '设备参考代号必须存在且唯一。', refs);
    add('E004-CIRCUIT-ID', 'FED-002', circuitIds.length === circuits.length && circuitIds.length === unique(circuitIds).length, 'ERROR', '回路 ID 必须存在且唯一。', circuitIds);
    add('E004-CIRCUIT-REFERENCE', 'FED-002', circuitRefs.length === circuits.length && circuitRefs.length === unique(circuitRefs).length, 'ERROR', '回路参考代号必须存在且唯一。', circuitRefs);

    const missingPorts = equipment.filter((item) => Number(item.quantity || 0) > 0 && (!Array.isArray(item.ports) || !item.ports.length));
    add('E001-EQUIPMENT-PORTS', 'TOP-001', missingPorts.length === 0, 'ERROR', '所有在用设备必须声明命名端口。', missingPorts.map((item) => item.id));

    const badEndpoints = [], badPortRefs = [], badSemantics = [], badNetClasses = [], badDirections = [];
    const connectedPorts = new Set();
    circuits.forEach((edge) => {
      const from = byId[edge.from], to = byId[edge.to];
      if (!from || !to) badEndpoints.push(edge.id);
      if (from) {
        const port = new Map((from.ports || []).map((item) => [portId(item), item])).get(edge.fromPort);
        if (!edge.fromPort || !port) badPortRefs.push(edge.id + ':from');
        else {
          connectedPorts.add(from.id + ':' + edge.fromPort);
          if (port.netClass && edge.netClass && port.netClass !== edge.netClass) badNetClasses.push(edge.id + ':from:' + port.netClass + '!=' + edge.netClass);
          if (!['out', 'bidirectional'].includes(port.direction)) badDirections.push(edge.id + ':from:' + port.direction);
        }
      }
      if (to) {
        const port = new Map((to.ports || []).map((item) => [portId(item), item])).get(edge.toPort);
        if (!edge.toPort || !port) badPortRefs.push(edge.id + ':to');
        else {
          connectedPorts.add(to.id + ':' + edge.toPort);
          if (port.netClass && edge.netClass && port.netClass !== edge.netClass) badNetClasses.push(edge.id + ':to:' + port.netClass + '!=' + edge.netClass);
          if (!['in', 'bidirectional'].includes(port.direction)) badDirections.push(edge.id + ':to:' + port.direction);
        }
      }
      const semanticOk = !!edge.netClass && !!edge.direction && (
        edge.kind === 'signal'
          ? !!edge.protocol
          : (edge.netClass === 'PROTECTIVE_EARTH' ? !!edge.service : Number(edge.voltageV) > 0)
      );
      if (!semanticOk) badSemantics.push(edge.id);
    });
    add('E001-EDGE-ENDPOINT', 'TOP-001', badEndpoints.length === 0, 'ERROR', '回路两端必须引用已声明设备。', badEndpoints);
    add('E001-EDGE-PORT', 'TOP-001', badPortRefs.length === 0, 'ERROR', '回路必须连接设备的已声明端口。', badPortRefs);
    add('E002-EDGE-SEMANTICS', 'TOP-002', badSemantics.length === 0, 'ERROR', '回路必须声明网络类别、方向及电压/协议/服务。', badSemantics);
    add('E002-PORT-NETCLASS', 'TOP-002', badNetClasses.length === 0, 'ERROR', '端口网络类别必须与所接回路一致。', badNetClasses);
    add('E002-PORT-DIRECTION', 'TOP-002', badDirections.length === 0, 'ERROR', '回路方向必须与起点/终点端口方向一致。', badDirections);

    const danglingRequired = [];
    equipment.forEach((item) => (item.ports || []).forEach((port) => {
      if (Number(item.quantity || 0) > 0 && port.required && !connectedPorts.has(item.id + ':' + port.id)) danglingRequired.push(item.id + ':' + port.id);
    }));
    add('E001-REQUIRED-PORT', 'TOP-001', danglingRequired.length === 0, 'ERROR', '在用设备的必接端口不得悬空。', danglingRequired);

    const illegalConverters = equipment.filter((item) => {
      const classes = unique((item.ports || []).map((port) => port.netClass).filter(isPower));
      return classes.length > 1 && !converters.includes(item.kind);
    });
    add('E003-DOMAIN-CONVERSION', 'TOP-003', illegalConverters.length === 0, 'ERROR', '跨 AC/DC 或跨直流域必须由声明的变换设备完成。', illegalConverters.map((item) => item.id));

    const mixedEdges = circuits.filter((edge) => (edge.kind === 'signal' && isPower(edge.netClass)) || (edge.kind === 'electrical' && isSignal(edge.netClass)));
    add('E008-CONTROL-SEPARATION', 'TOP-005', mixedEdges.length === 0, 'ERROR', '控制/通信边不得混入功率网络，功率边不得声明为信号网络。', mixedEdges.map((edge) => edge.id));

    /* ---------- 交流进线保护完整性 ---------- */
    const acKinds = ['ac-isolator', 'ac-breaker', 'surge-protector', 'residual-current-monitor'];
    const missingAc = acKinds.filter((kind) => byKind(kind).length === 0);
    add('E020-AC-PROTECTION', 'EVS-004', missingAc.length === 0, 'ERROR', '交流进线必须包含隔离、断路、浪涌与剩余电流监测设备。', missingAc);

    /* ---------- 每枪保护完整性 ---------- */
    const branches = (design.topology && Array.isArray(design.topology.gunBranches)) ? design.topology.gunBranches : [];
    const connectors = byKind('charge-connector');
    add('E021-GUN-BRANCH', 'FED-002', branches.length === connectors.length && connectors.length > 0, 'ERROR', '每把充电枪必须有一条已实例化的枪支路。', connectors.map((item) => item.id));
    const gunProtectionFaults = [];
    const gunEarthFaults = [];
    const gunSignalFaults = [];
    branches.forEach((branch) => {
      const fuse = byId[branch.fuse];
      const kp = byId[branch.contactorPositive];
      const kn = byId[branch.contactorNegative];
      if (!fuse || fuse.kind !== 'dc-fuse' || !kp || kp.kind !== 'dc-contactor' || !kn || kn.kind !== 'dc-contactor') {
        gunProtectionFaults.push(branch.connector);
      }
      const earth = circuits.some((edge) => edge.to === branch.connector && edge.toPort === 'earth' && edge.netClass === 'PROTECTIVE_EARTH');
      if (!earth) gunEarthFaults.push(branch.connector);
      const control = circuits.some((edge) => edge.to === branch.connector && edge.toPort === 'control' && edge.netClass === 'SIGNAL_CTRL');
      const comm = circuits.some((edge) => edge.to === branch.connector && edge.toPort === 'comm' && edge.netClass === 'SIGNAL_COMM');
      if (!control || !comm) gunSignalFaults.push(branch.connector);
    });
    add('E021-GUN-PROTECTION', 'EVS-001', gunProtectionFaults.length === 0, 'ERROR', '每把充电枪必须有独立快熔和正/负极直流接触器。', gunProtectionFaults);
    add('E022-GUN-EARTH', 'EVS-002', gunEarthFaults.length === 0, 'ERROR', '每把充电枪必须接入 PE 保护接地。', gunEarthFaults);
    add('E023-GUN-INTERFACE', 'EVS-005', gunSignalFaults.length === 0, 'ERROR', '每把充电枪必须有控制导引与通信回路。', gunSignalFaults);

    /* ---------- 直流母线监测 ---------- */
    const imd = byKind('insulation-monitor')[0];
    const sensor = byKind('current-transducer')[0];
    const imdSignal = !!imd && circuits.some((edge) => edge.from === imd.id && edge.fromPort === 'signal');
    const sensorSignal = !!sensor && circuits.some((edge) => edge.from === sensor.id && edge.fromPort === 'signal');
    add('E024-DC-MONITORING', 'EVS-003', imdSignal && sensorSignal, 'ERROR', '直流母线的绝缘监测与电流采样必须送至控制单元。', [imd && imd.id, sensor && sensor.id].filter(Boolean));

    /* ---------- 辅助电源来源 ---------- */
    const auxSources = circuits.filter((edge) => edge.netClass === 'POWER_DC_AUX' && byId[edge.from] && byId[edge.from].kind !== 'aux-psu' && byId[edge.from].kind !== 'aux-busbar');
    add('E025-AUX-SOURCE', 'AUX-001', auxSources.length === 0, 'ERROR', '辅助直流电源必须来自开关电源或辅助母排。', auxSources.map((edge) => edge.id));

    /* ---------- 储能支路 ---------- */
    if (result && result.ess && result.ess.enabled) {
      const clusters = byKind('battery-cluster');
      const unprotected = clusters.filter((cluster) => !circuits.some((edge) => edge.from === cluster.id && byId[edge.to] && byId[edge.to].kind === 'battery-protection'));
      add('E030-ESS-PROTECTION', 'ESS-001', clusters.length > 0 && unprotected.length === 0, 'ERROR', '每个电池簇必须经熔断/主接触器/预充单元并入储能母线。', unprotected.map((item) => item.id));
      const directTie = circuits.filter((edge) => edge.netClass === 'POWER_DC_ESS' && byId[edge.to] && byId[edge.to].kind === 'dc-busbar');
      const converter = equipment.filter((item) => item.kind === 'ess-dcdc' || item.kind === 'ess-pcs');
      add('E031-ESS-CONVERSION', 'ESS-002', directTie.length === 0 && converter.length === 1, 'ERROR', '储能母线必须经 DC/DC 或 PCS 并入，不得直接搭接充电母线。', converter.map((item) => item.id));
    }

    const blocking = checks.filter((check) => !check.ok && check.severity === 'ERROR');
    return {
      status: blocking.length ? 'BLOCKED' : 'CHECKED_WITH_OPEN_PROFESSIONAL_ITEMS',
      checks,
      violations: checks.filter((check) => !check.ok),
      blockingCount: blocking.length,
      checkedCount: checks.length,
      evaluatedRuleIds: unique(checks.map((check) => check.ruleId).filter(Boolean))
    };
  }

  function selectedRuleIds() {
    return PROFILES[DRAWING_KEY].rules.slice();
  }

  function syncRuleCoverage(report) {
    if (!report) return;
    report.selectedRuleIds = unique(report.selectedRuleIds || []);
    report.evaluatedRuleIds = unique(report.evaluatedRuleIds || []);
    report.appliedRuleIds = report.evaluatedRuleIds.slice();
    report.guidanceRuleIds = report.selectedRuleIds.filter((id) => {
      const rule = ruleById(id);
      return rule && rule.enforcement === 'GUIDANCE';
    });
    report.skippedRuleIds = report.selectedRuleIds.filter((id) => !report.evaluatedRuleIds.includes(id)).map((ruleId) => ({
      ruleId,
      reason: (ruleById(ruleId) && ruleById(ruleId).enforcement === 'GUIDANCE')
        ? 'GUIDANCE_ONLY—PROFESSIONAL_VISUAL_REVIEW_REQUIRED'
        : 'NOT_MACHINE_EVALUATED—PROFESSIONAL_REVIEW_REQUIRED'
    }));
  }

  function updateSkillValidation(result) {
    if (!result || !result.drawingSkill) return;
    const report = result.drawingSkill;
    const graphCount = Number((report.graphValidation && report.graphValidation.blockingCount) || 0);
    const renderCount = Number(report.renderBlockingCount || 0);
    const blocked = graphCount + renderCount > 0;
    const record = {
      id: 'DRAW-SKILL-001',
      result: blocked ? 'WARN' : 'CALCULATED',
      rule: 'sch_lib 绘图规则包与语义图/渲染校验',
      ref: ID + '@' + VERSION,
      detail: blocked
        ? '语义图阻断 ' + graphCount + ' 项、渲染阻断 ' + renderCount + ' 项；已阻止导出。'
        : '已执行 ' + report.evaluatedRuleIds.length + ' 条机器可检查规则；其余指导规则和专业适用性仍须人工复核。',
      evidence: report.evaluatedRuleIds.slice()
    };
    result.validation = (result.validation || []).filter((item) => item.id !== record.id).concat(record);
    result.compliance = result.validation;
    if (result.design && result.design.drawingSkill) {
      result.design.drawingSkill.status = report.status;
      result.design.drawingSkill.selectedRuleIds = report.selectedRuleIds.slice();
      result.design.drawingSkill.evaluatedRuleIds = report.evaluatedRuleIds.slice();
      result.design.drawingSkill.appliedRuleIds = report.appliedRuleIds.slice();
    }
    if (result.readiness && result.readiness.release) {
      result.readiness.release.drawingRuleStatus = blocked
        ? 'BLOCKED—DRAWING_INTEGRITY_FAILED'
        : (report.drawingAudits && report.drawingAudits[DRAWING_KEY]
          ? 'GRAPH_AND_RENDER_CHECKED—PROFESSIONAL_REVIEW_REQUIRED'
          : 'GRAPH_CHECKED—VISUAL_REVIEW_REQUIRED');
      result.releaseGate = result.readiness.release;
    }
  }

  function blockReview(result, reason, items) {
    if (!result || !result.readiness) return;
    result.readiness.level = 'CONCEPT_ONLY';
    result.readiness.label = '仅限概念方案，绘图规则校验未通过';
    result.readiness.detail = reason;
    const incoming = items || [];
    const incomingIds = new Set(incoming.map((item) => item.id));
    const retained = (result.readiness.blockingItems || []).filter((item) => !incomingIds.has(item.id));
    const seen = new Set();
    result.readiness.blockingItems = retained.concat(incoming).filter((item) => item && item.id && !seen.has(item.id) && seen.add(item.id));
    if (result.readiness.release) {
      result.readiness.release.reviewPackageAllowed = false;
      result.readiness.release.drawingRuleStatus = 'BLOCKED';
    }
    result.releaseGate = result.readiness.release || result.releaseGate;
  }

  function apply(result) {
    if (!result || typeof result !== 'object') return result;
    const graphValidation = validateGraph(result);
    const ruleIds = selectedRuleIds();
    const sources = unique(ruleIds.flatMap((id) => (ruleById(id) && ruleById(id).evidence) || []));
    const report = {
      id: ID, version: VERSION, basisStatus: BASIS_STATUS,
      status: graphValidation.blockingCount ? 'BLOCKED' : 'ACTIVE',
      note: '规则从 sch_lib 参考图中提炼并叠加项目安全基线；不构成标准符合性或专业签发。',
      profiles: Object.keys(PROFILES).reduce((out, key) => {
        out[key] = { id: PROFILES[key].id, ruleIds: PROFILES[key].rules.slice() };
        return out;
      }, {}),
      selectedRuleIds: ruleIds,
      evaluatedRuleIds: graphValidation.evaluatedRuleIds.slice(),
      appliedRuleIds: graphValidation.evaluatedRuleIds.slice(),
      guidanceRuleIds: [], skippedRuleIds: [],
      sourceIds: sources,
      graphValidation,
      drawingAudits: {}
    };
    syncRuleCoverage(report);
    result.drawingSkill = report;
    if (result.design) result.design.drawingSkill = {
      id: report.id, version: report.version, basisStatus: report.basisStatus, status: report.status,
      selectedRuleIds: report.selectedRuleIds.slice(), evaluatedRuleIds: report.evaluatedRuleIds.slice(),
      appliedRuleIds: report.appliedRuleIds.slice(), sourceIds: report.sourceIds.slice()
    };
    if (graphValidation.blockingCount) {
      const items = graphValidation.violations.filter((item) => item.severity === 'ERROR').map((item) => ({
        id: item.code, title: item.detail, status: 'DRAWING_RULE_VIOLATION', detail: (item.evidence || []).join('；')
      }));
      blockReview(result, '语义图未通过 sch_lib 绘图规则校验；必须修正连接、端口和回路后再评审。', items);
      result.warnings = unique((result.warnings || []).concat('绘图规则校验发现阻断项，已禁止导出。'));
    }
    updateSkillValidation(result);
    return result;
  }

  function metadata(result, drawingKey) {
    const profile = profileFor(drawingKey);
    if (!profile) return {
      id: ID, version: VERSION, profile: 'UNKNOWN_DRAWING_PROFILE', basisStatus: BASIS_STATUS,
      selectedRuleIds: [], evaluatedRuleIds: [], appliedRuleIds: [], status: 'BLOCKED'
    };
    const report = result && result.drawingSkill;
    const evaluated = report ? profile.rules.filter((id) => (report.evaluatedRuleIds || []).includes(id)) : [];
    return {
      id: ID, version: VERSION, profile: profile.id, basisStatus: BASIS_STATUS,
      selectedRuleIds: profile.rules.slice(), evaluatedRuleIds: evaluated, appliedRuleIds: evaluated.slice(),
      status: report ? report.status : 'NOT_APPLIED'
    };
  }

  function auditMarkup(markup, drawingKey, result) {
    const text = String(markup || '');
    const profile = profileFor(drawingKey);
    if (!profile) return {
      drawingKey, profile: 'UNKNOWN_DRAWING_PROFILE', status: 'BLOCKED', blockingCount: 1, evaluatedRuleIds: [],
      checks: [{ code: 'G000-UNKNOWN-PROFILE', ruleId: 'DOC-001', ok: false, severity: 'ERROR', detail: '未知图型 profile，禁止静默按其他图型校验。' }]
    };
    const checks = [];
    const add = (code, ruleId, ok, severity, detail) => checks.push({ code, ruleId, ok: !!ok, severity, detail });
    add('G000-SVG-COMPLETE', 'DOC-001', /^<svg\b/.test(text) && /<\/svg>\s*$/.test(text), 'ERROR', '输出必须是完整 SVG。');
    add('G001-A3', 'DOC-001', /width="420mm"/.test(text) && /height="297mm"/.test(text), 'ERROR', '输出必须保留 A3 物理图幅。');
    add('G002-SKILL-META', 'DOC-001', text.includes('data-drawing-skill="' + ID + '"') && text.includes('data-drawing-profile="' + profile.id + '"'), 'ERROR', 'SVG 必须记录绘图 skill 与图型 profile。');
    add('G003-DOCUMENT-CONTROL', 'DOC-001', /图号:/.test(text) && /修订:/.test(text) && /校核:/.test(text) && /批准:/.test(text), 'ERROR', 'SVG 必须包含文控标题栏。');
    add('G004-UNRESOLVED-TOKEN', 'TAG-002', !/\b(?:undefined|NaN)\b/.test(text), 'ERROR', 'SVG 不得包含未解析占位值。');
    add('G005-LEGEND', 'STYLE-001', /图例|LEGEND/.test(text), 'ERROR', '使用颜色/线型的图纸必须有图例。');
    add('G006-SCHEDULE', 'ANN-001', /设备明细表/.test(text), 'ERROR', '规格型号必须集中到设备明细表，不得只散落在图面。');
    add('G010-AC-PROTECTION', 'EVS-004', /QS1/.test(text) && /QF1/.test(text) && /FV1/.test(text) && /RCM1/.test(text), 'ERROR', '图面必须显示进线隔离、断路、浪涌与剩余电流监测位号。');
    add('G011-DC-MONITOR', 'EVS-003', /RI1/.test(text) && /TA1/.test(text), 'ERROR', '图面必须显示绝缘监测与直流电流传感器位号。');
    add('G012-PE', 'EVS-002', /PE\s*保护接地|保护接地排/.test(text), 'ERROR', '图面必须显示保护接地边界。');
    add('G013-AUX', 'AUX-001', /开关电源/.test(text), 'ERROR', '图面必须显示辅助电源来源。');
    const guns = (result && Array.isArray(result.guns)) ? result.guns : [];
    if (guns.length) {
      const gunTags = guns.every((gun) => text.includes('XS' + gun.index));
      add('G014-GUN-TAGS', 'FED-002', gunTags, 'ERROR', '每把充电枪必须在图面上有唯一位号。');
      const pins = (result.standard && result.standard.controlPins) || [];
      add('G015-GUN-PINS', 'EVS-005', pins.every((pin) => text.includes(pin)), 'ERROR', '充电枪的控制导引端子必须按所选标准标注。');
    }
    if (result && result.ess && result.ess.enabled) {
      add('G020-ESS-PROTECTION', 'ESS-001', /预充/.test(text) && /GB1/.test(text), 'ERROR', '储能支路必须显示电池簇与预充/主接触器回路。');
      add('G021-ESS-CONVERTER', 'ESS-002', /PCS|DC\/DC/.test(text), 'ERROR', '储能必须经变换设备并入，图面须显示该设备。');
    }
    const blocking = checks.filter((check) => !check.ok && check.severity === 'ERROR');
    return {
      drawingKey, profile: profile.id, status: blocking.length ? 'BLOCKED' : 'CHECKED',
      checks, blockingCount: blocking.length,
      evaluatedRuleIds: unique(checks.map((check) => check.ruleId).filter(Boolean))
    };
  }

  function recordDrawingAudit(result, drawingKey, audit) {
    if (!result || !result.drawingSkill) return;
    result.drawingSkill.drawingAudits[drawingKey] = audit;
    result.drawingSkill.evaluatedRuleIds = unique((result.drawingSkill.evaluatedRuleIds || []).concat((audit && audit.evaluatedRuleIds) || []));
    syncRuleCoverage(result.drawingSkill);
  }

  function finalizeDrawingAudits(result) {
    if (!result || !result.drawingSkill) return result;
    if (result.readiness) {
      result.readiness.blockingItems = (result.readiness.blockingItems || []).filter((item) => !/^DRAWING-/.test(item.id || ''));
    }
    result.warnings = (result.warnings || []).filter((message) => message !== '充电桩原理图未通过绘图 skill 渲染检查，已禁止导出。');
    const drawingAudits = result.drawingSkill.drawingAudits || {};
    if (!drawingAudits[DRAWING_KEY]) {
      drawingAudits[DRAWING_KEY] = {
        drawingKey: DRAWING_KEY, profile: PROFILES[DRAWING_KEY].id, status: 'BLOCKED', blockingCount: 1,
        evaluatedRuleIds: ['DOC-001'],
        checks: [{ code: 'G000-AUDIT-MISSING', ruleId: 'DOC-001', ok: false, severity: 'ERROR', detail: '图纸未完成渲染规则校验。' }]
      };
    }
    result.drawingSkill.drawingAudits = drawingAudits;
    const audits = Object.values(drawingAudits);
    const blocked = audits.filter((audit) => audit && audit.blockingCount > 0);
    result.drawingSkill.renderBlockingCount = blocked.reduce((sum, audit) => sum + audit.blockingCount, 0);
    if (blocked.length) {
      result.drawingSkill.status = 'BLOCKED';
      blockReview(result, '充电桩原理图未通过 sch_lib 绘图规则的渲染前置检查。', blocked.map((audit) => ({
        id: 'DRAWING-' + String(audit.drawingKey || '').toUpperCase(),
        title: audit.drawingKey + ' 渲染规则未通过', status: 'DRAWING_RULE_VIOLATION',
        detail: audit.checks.filter((check) => !check.ok && check.severity === 'ERROR').map((check) => check.code).join('、')
      })));
      result.warnings = unique((result.warnings || []).concat('充电桩原理图未通过绘图 skill 渲染检查，已禁止导出。'));
    } else {
      result.drawingSkill.status = Number((result.drawingSkill.graphValidation && result.drawingSkill.graphValidation.blockingCount) || 0) > 0 ? 'BLOCKED' : 'ACTIVE';
    }
    syncRuleCoverage(result.drawingSkill);
    updateSkillValidation(result);
    return result;
  }

  function canExport(result, drawingKey, format) {
    const report = result && result.drawingSkill;
    if (!report) return { allowed: false, reason: '绘图 skill 报告缺失，禁止导出。', format };
    if (report.graphValidation && report.graphValidation.blockingCount > 0) {
      return { allowed: false, reason: '语义图存在阻断性连接/端口错误，禁止导出。', format };
    }
    if (Number(report.renderBlockingCount || 0) > 0) {
      return { allowed: false, reason: '原理图未通过渲染规则校验，须先修正。', format };
    }
    const audit = report.drawingAudits && report.drawingAudits[drawingKey];
    if (!audit) return { allowed: false, reason: '当前图纸尚未执行渲染规则校验，禁止导出。', format };
    if (audit.blockingCount > 0) return { allowed: false, reason: '当前图纸未通过渲染规则校验，禁止导出。', format };
    return { allowed: true, reason: '允许导出方案级原理图；仍不得作为生产图、施工图或规范符合性证明。', format };
  }

  return {
    ID, VERSION, BASIS_STATUS, DRAWING_KEY, SOURCE_LIBRARY, RULES, PROFILES,
    profileFor, rulesFor, validateGraph, apply, metadata,
    auditMarkup, recordDrawingAudit, finalizeDrawingAudits, canExport
  };
})();
