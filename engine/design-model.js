/* ============================================================
 * EVSE Engineering Design Model (EDEM) v4
 * ------------------------------------------------------------
 * Single electrical source of truth.  The model distinguishes functional
 * ports from physical terminals and stores every conductor as an explicit
 * net.  Renderers may consume this model; they may never recreate topology.
 * ============================================================ */
window.EVSE_DESIGN = (function () {
  'use strict';

  const SCHEMA_VERSION = '4.0.0';
  const DOCUMENT_STATUS = 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED';
  const IMPLEMENTED_STANDARDS = Object.freeze(['gb', 'eu', 'us']);
  const IMPLEMENTED_ARCHETYPES = Object.freeze(['dc-integrated']);

  const CAD_LAYER_MANIFEST = [
    { name: 'EVSE-FRAME', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.50, purpose: '图框、标题栏、修订栏' },
    { name: 'EVSE-TEXT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '标题、说明、位号' },
    { name: 'EVSE-ANNO', color: 8, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '待核说明、参考注释' },
    { name: 'EVSE-EQPT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '设备外形、符号与端子' },
    { name: 'EVSE-AC', color: 5, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '交流导体' },
    { name: 'EVSE-DC', color: 1, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '充电直流导体' },
    { name: 'EVSE-ESS', color: 30, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '储能直流导体' },
    { name: 'EVSE-AUX', color: 4, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '24V/12V 辅助电源及各自回路' },
    { name: 'EVSE-CTL', color: 8, linetype: 'DASHED', lineweightMm: 0.18, purpose: '控制与安全联锁' },
    { name: 'EVSE-COMM', color: 6, linetype: 'DASHED', lineweightMm: 0.18, purpose: '通信总线' },
    { name: 'EVSE-PE', color: 3, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '保护接地；不得与功能地或直流负极合并' }
  ];

  const DOMAIN_CONVERTERS = Object.freeze(['power-module-array', 'ess-dcdc', 'ess-pcs', 'aux-psu']);

  function idPart(value) {
    const raw = String(value || '').trim();
    const ascii = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
    let hash = 5381;
    for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    const suffix = 'U' + (hash >>> 0).toString(36).toUpperCase().slice(0, 8);
    if (ascii && !/[^\x00-\x7F]/.test(raw)) return ascii;
    return raw ? ((ascii ? ascii + '-' : '') + suffix).slice(0, 28) : 'EVSE';
  }

  function pad(value, width) {
    return String(value).padStart(width || 3, '0');
  }

  function endpoint(instanceId, terminalId) {
    return { instanceId, terminalId };
  }

  function endpointKey(value) {
    return value.instanceId + ':' + value.terminalId;
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach((key) => { out[key] = clone(value[key]); });
      return out;
    }
    return value;
  }

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((key) => { out[key] = stable(value[key]); });
      return out;
    }
    return value;
  }

  function modelHash(value) {
    const text = JSON.stringify(stable(value));
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return 'fnv1a32-' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  function functionalPortId(terminalId) {
    return String(terminalId)
      .replace(/_(L1|L2|L3|N)$/, '')
      .replace(/_DC_(POS|NEG)$/, '_DC')
      .replace(/_(V(?:12|24)|V(?:12|24)_0V)$/, '')
      .replace(/_(P|N)$/, '');
  }

  function buildFunctionalPorts(terminals) {
    const groups = new Map();
    terminals.forEach((terminal) => {
      const id = terminal.functionalPort || functionalPortId(terminal.id) || terminal.id;
      if (!groups.has(id)) groups.set(id, {
        id,
        netClass: terminal.netClass,
        domain: terminal.domain,
        physicalTerminalIds: []
      });
      groups.get(id).physicalTerminalIds.push(terminal.id);
    });
    return Array.from(groups.values()).map((item) => Object.assign(item, {
      physicalTerminalIds: item.physicalTerminalIds.slice().sort()
    })).sort((a, b) => a.id.localeCompare(b.id));
  }

  function drawingRegister() {
    return [
      { key: 'ev-schematic', drawingNo: 'EVSE-CONCEPT-101', title: '充电桩端子级电气原理图', discipline: 'ELECTRICAL', sheet: 'A3', orientation: 'LANDSCAPE', scale: 'NTS' }
    ];
  }

  function documentControl(projectId, standardName, includeEss) {
    const projectReference = 'EVSE-' + String(projectId).replace(/^PRJ-/, '');
    const drawings = drawingRegister();
    return {
      documentSetId: projectReference + '-CONCEPT-SET',
      projectReference,
      documentClass: 'CONCEPTUAL_SCHEME',
      issuePurpose: '方案比较与工程深化输入',
      status: DOCUMENT_STATUS,
      revision: 'P02',
      revisionHistory: [{ revision: 'P02', status: 'UNISSUED', description: 'EDEM v4 端子级网表与图模等价性版本', issueDate: null }],
      page: { current: 1, total: drawings.length },
      roleStatus: { preparedBy: 'AUTO_GENERATED—REVIEW_REQUIRED', checkedBy: 'UNASSIGNED', approvedBy: 'UNASSIGNED' },
      referenceDesignationSystem: {
        convention: 'PROJECT_INTERNAL_EVSE_V2',
        status: 'PROJECT_CONVENTION—NOT_A_CERTIFIED_IEC_81346_IMPLEMENTATION',
        equipmentPattern: 'EVSE-{SYSTEM}-{TAG}',
        circuitPattern: 'CCT-{NNNN}',
        note: '代号用于端子、网络、图形和明细表追溯；项目深化时仍须按业主编码规则复核。'
      },
      referenceBaseline: [
        { id: 'REF-IEC-61082-1', title: 'IEC 61082-1', use: '电工文件编制参考', status: 'REFERENCE_ONLY—APPLICABILITY_TO_BE_CONFIRMED' },
        { id: 'REF-IEC-60617', title: 'IEC 60617 / GB/T 4728', use: '图形符号参考', status: 'REFERENCE_ONLY—SYMBOL_LIBRARY_TO_BE_VERIFIED' },
        { id: 'REF-EV-STANDARD', title: standardName || '充电接口标准', use: '端子与协议基线', status: 'REFERENCE_ONLY—CERTIFICATION_REQUIRED' }
      ],
      drawingRegister: drawings.map((drawing, index) => Object.assign({}, drawing, {
        drawingRef: projectReference + '-' + drawing.drawingNo,
        page: index + 1,
        revision: 'P02',
        status: DOCUMENT_STATUS,
        verification: 'MODEL_COVERAGE_REQUIRED',
        output: ['SVG_A3_PREVIEW', 'DXF_R2010_CONCEPT']
      })),
      cadLayerManifest: CAD_LAYER_MANIFEST.map(clone),
      traceability: { modelSchema: 'EDEM-' + SCHEMA_VERSION, source: 'EVSE_ENGINE', generatedAt: null, immutableInputHash: null }
    };
  }

  function Builder(catalog) {
    this.catalog = catalog;
    this.instances = [];
    this.instanceById = new Map();
    this.nets = [];
    this.circuits = [];
    this.netCounter = 0;
    this.circuitCounter = 0;
  }

  Builder.prototype.addInstance = function (data, context) {
    if (!data || !data.id || this.instanceById.has(data.id)) throw new Error('Invalid or duplicate instance id: ' + String(data && data.id));
    const definition = this.catalog.definition(data.kind, context || {});
    if (definition.lifecycle !== 'APPROVED') throw new Error('Unapproved catalog definition: ' + data.kind);
    const terminals = definition.terminals.map(clone);
    const instance = Object.assign({
      id: data.id,
      ref: data.ref || data.id,
      tag: data.tag || data.ref || data.id,
      referenceDesignation: data.referenceDesignation || data.ref || data.id,
      kind: data.kind,
      quantity: 1,
      source: 'EVSE_CONTROLLED_CATALOG',
      lifecycle: 'APPROVED',
      status: 'CONCEPT',
      definitionRef: definition.source.id + ':' + definition.typeId + '@' + definition.version,
      definition: { schema: definition.schema, typeId: definition.typeId, version: definition.version, lifecycle: definition.lifecycle, source: clone(definition.source) },
      terminals,
      physicalTerminals: terminals,
      ports: terminals,
      functionalPorts: buildFunctionalPorts(terminals)
    }, data);
    instance.terminals = terminals;
    instance.physicalTerminals = terminals;
    instance.ports = terminals;
    instance.functionalPorts = buildFunctionalPorts(terminals);
    this.instances.push(instance);
    this.instanceById.set(instance.id, instance);
    return instance.id;
  };

  Builder.prototype.ensureTerminal = function (instanceId, terminalId, options) {
    const instance = this.instanceById.get(instanceId);
    if (!instance) throw new Error('Unknown instance for dynamic terminal: ' + instanceId);
    let terminal = instance.terminals.find((item) => item.id === terminalId);
    if (!terminal) {
      terminal = this.catalog.terminal(terminalId, Object.assign({ required: true, status: 'APPROVED' }, options || {}));
      instance.terminals.push(terminal);
      instance.functionalPorts = buildFunctionalPorts(instance.terminals);
    }
    return terminal;
  };

  Builder.prototype.terminal = function (value) {
    const instance = this.instanceById.get(value.instanceId);
    if (!instance) throw new Error('Unknown instance endpoint: ' + endpointKey(value));
    const terminal = instance.terminals.find((item) => item.id === value.terminalId);
    if (!terminal) throw new Error('Unknown physical terminal endpoint: ' + endpointKey(value));
    return terminal;
  };

  Builder.prototype.addNode = function (name, semantics, members, edges) {
    const unique = [];
    const seen = new Set();
    (members || []).forEach((member) => {
      this.terminal(member);
      const k = endpointKey(member);
      if (!seen.has(k)) { seen.add(k); unique.push(clone(member)); }
    });
    if (unique.length < 2) throw new Error('Net requires at least two exact terminals: ' + name);
    const id = 'NET-' + pad(++this.netCounter, 4);
    const net = Object.assign({ id, name, members: unique, status: 'CONCEPT' }, clone(semantics || {}));
    this.nets.push(net);
    (edges || []).forEach((edge) => this.addCircuit(net, edge[0], edge[1], edge[2]));
    return net;
  };

  Builder.prototype.addCircuit = function (net, from, to, extra) {
    this.terminal(from);
    this.terminal(to);
    const id = 'CCT-' + pad(++this.circuitCounter, 4);
    const circuit = Object.assign({
      id,
      ref: id,
      referenceDesignation: id,
      netId: net.id,
      kind: net.netClass && net.netClass.indexOf('SIGNAL_') === 0 ? 'signal' : 'electrical',
      direction: 'from-to',
      from: from.instanceId,
      fromPort: from.terminalId,
      to: to.instanceId,
      toPort: to.terminalId,
      netClass: net.netClass,
      domain: net.domain,
      phase: net.phase,
      polarity: net.polarity,
      protocol: net.protocol,
      signalRole: net.signalRole,
      voltageV: Number.isFinite(net.nominalVoltageV) ? net.nominalVoltageV : net.ratedVoltageV,
      status: 'CONCEPT'
    }, extra || {});
    this.circuits.push(circuit);
    return circuit;
  };

  Builder.prototype.wire = function (name, from, to, semantics, extra) {
    return this.addNode(name, semantics, [from, to], [[from, to, extra]]);
  };

  Builder.prototype.finishInstances = function () {
    this.instances.forEach((instance) => {
      instance.terminals.sort((a, b) => a.id.localeCompare(b.id));
      instance.functionalPorts = buildFunctionalPorts(instance.terminals);
      instance.physicalTerminals = instance.terminals;
      instance.ports = instance.terminals;
    });
  };

  function semanticsForTerminal(terminal, overrides) {
    const out = {
      netClass: terminal.netClass,
      domain: terminal.domain,
      polarity: terminal.polarity,
      phase: terminal.phase,
      protocol: terminal.protocol,
      signalRole: terminal.signalRole,
      referenceVoltageV: terminal.referenceVoltageV
    };
    if (Number.isFinite(terminal.voltageV)) out.nominalVoltageV = terminal.voltageV;
    return Object.assign(out, overrides || {});
  }

  function connectFixedToDynamic(builder, name, fixed, dynamicInstanceId, dynamicTerminalId, dynamicDirection, overrides) {
    const fixedTerminal = builder.terminal(fixed);
    const options = Object.assign({}, fixedTerminal, overrides || {}, {
      id: dynamicTerminalId,
      label: dynamicTerminalId,
      direction: dynamicDirection || (fixedTerminal.direction === 'out' ? 'in' : fixedTerminal.direction === 'in' ? 'out' : 'bidirectional'),
      required: true,
      multiplicity: 'one'
    });
    builder.ensureTerminal(dynamicInstanceId, dynamicTerminalId, options);
    const dynamic = endpoint(dynamicInstanceId, dynamicTerminalId);
    const from = fixedTerminal.direction === 'in' ? dynamic : fixed;
    const to = fixedTerminal.direction === 'in' ? fixed : dynamic;
    return builder.wire(name, from, to, semanticsForTerminal(fixedTerminal, overrides));
  }

  function connectDynamicPair(builder, name, aId, aTerminal, bId, bTerminal, protocol) {
    const leg = /_P$/.test(aTerminal) ? 'P' : (/_N$/.test(aTerminal) ? 'N' : String(aTerminal));
    const signalRole = 'LINK:' + leg;
    const options = { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol, signalRole, direction: 'bidirectional', required: true, electricalType: 'signal' };
    builder.ensureTerminal(aId, aTerminal, options);
    builder.ensureTerminal(bId, bTerminal, options);
    return builder.wire(name, endpoint(aId, aTerminal), endpoint(bId, bTerminal), {
      netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol, signalRole
    });
  }

  function addAuxTarget(list, instanceId, positiveId, returnId) {
    list.positive.push(endpoint(instanceId, positiveId));
    list.return.push(endpoint(instanceId, returnId));
  }

  function addCoil(builder, controllerId, deviceId, label, aux24) {
    aux24.positive.push(endpoint(deviceId, 'COIL_V24'));
    const driverId = 'DO_' + label.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    builder.ensureTerminal(controllerId, driverId, {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 0, referenceVoltageV: 24,
      polarity: 'RETURN', direction: 'out', required: true, electricalType: 'open-collector-output'
    });
    builder.wire(label + ' 线圈受控回路', endpoint(controllerId, driverId), endpoint(deviceId, 'COIL_V24_0V'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 0, referenceVoltageV: 24, polarity: 'RETURN'
    });
  }

  function create(spec) {
    const catalog = window.EVSE_DEVICE_CATALOG;
    if (!catalog) throw new Error('EVSE_DEVICE_CATALOG 未加载，不能编译端子级网表。');
    const p = spec.params || {};
    const std = spec.standard || {};
    const ac = spec.ac || {};
    const dc = spec.dc || {};
    const guns = Array.isArray(spec.guns) ? spec.guns : [];
    const ess = spec.ess || { enabled: false };
    const aux = spec.aux || {};
    if (!IMPLEMENTED_STANDARDS.includes(std.id)) throw new Error('EDEM v4 尚未验证接口标准：' + String(std.id));
    if (!IMPLEMENTED_ARCHETYPES.includes(p.archetype)) throw new Error('EDEM v4 尚未实现桩型：' + String(p.archetype));

    const projectId = 'PRJ-' + idPart(p.pileName);
    const docControl = documentControl(projectId, std.connector, !!ess.enabled);
    const builder = new Builder(catalog);
    const acContext = { voltageV: ac.lineVoltage || std.acLineVoltage || 400, phases: ac.phases || std.phases || 3, neutral: ac.neutral === true };
    const acConductors = catalog.acConductors(acContext);
    const dcVoltage = dc.busVoltageV || dc.outputVmax || 1000;
    const controller = 'EQ-CTL-A1';
    const aux24 = { positive: [], return: [] };
    const aux12 = { positive: [], return: [] };
    const peTargets = [];

    const add = (id, tag, kind, name, system, context, extra) => builder.addInstance(Object.assign({
      id, tag, ref: 'EVSE-' + String(system || 'SYS').toUpperCase() + '-' + tag,
      referenceDesignation: 'EVSE-' + String(system || 'SYS').toUpperCase() + '-' + tag,
      kind, name, system
    }, extra || {}), context || {});

    /* ---------- controlled instances ---------- */
    const peBar = add('EQ-PE', 'PE', 'earth-bar', '保护接地排 PE', 'earth');
    const incomer = add('EQ-AC-IN', 'W01', 'ac-incomer', '交流进线', 'ac', acContext, { voltageV: acContext.voltageV, phases: acContext.phases });
    const isolator = add('EQ-AC-QS1', 'QS1', 'ac-isolator', '进线隔离开关', 'ac', acContext, { ratedCurrentA: ac.breakerA });
    const breaker = add('EQ-AC-QF1', 'QF1', 'ac-breaker', '进线断路器', 'ac', acContext, { ratedCurrentA: ac.breakerA, breakingKa: ac.breakingKa });
    const spd = add('EQ-AC-FV1', 'FV1', 'surge-protector', '电源浪涌保护器', 'ac', acContext, { spec: ac.spdClass });
    const rcm = add('EQ-AC-RCM1', 'RCM1', 'residual-current-monitor', '剩余电流监测', 'ac', acContext, { spec: ac.rcdType });
    const acMeter = add('EQ-AC-PJ1', 'PJ1', 'ac-meter', '交流电能表', 'ac', Object.assign({}, acContext, { protocol: 'RS485' }), { spec: std.meter });
    const acContactor = add('EQ-AC-KM1', 'KM1', 'ac-contactor', '交流主接触器', 'ac', acContext, { ratedCurrentA: ac.contactorA });
    const acBus = add('EQ-AC-BUS', 'WB1', 'ac-busbar', '交流分配母排', 'ac', acContext, { voltageV: acContext.voltageV, ratedCurrentA: ac.busbarA });
    const modules = add('EQ-PM', 'M1', 'power-module-array', '充电功率模块阵列', 'power', acContext, {
      quantity: dc.moduleCount, unitKw: dc.moduleKw, installedKw: dc.installedKw, outputRange: dc.outputRangeText
    });

    const dcFuse = add('EQ-DC-FU1', 'FU1', 'dc-fuse', '直流总快速熔断器', 'dc', { polarity: 'POSITIVE' }, { ratedCurrentA: dc.mainFuseA });
    const dcSensor = add('EQ-DC-TA1', 'TA1', 'current-transducer', '直流霍尔电流传感器', 'dc', { polarity: 'POSITIVE', protocol: 'ANALOG_OR_DRY' }, { rangeA: dc.sensorRangeA });
    const dcMeter = add('EQ-DC-PJ2', 'PJ2', 'dc-meter', '直流电能表', 'dc', { protocol: 'RS485' }, { spec: std.meter });
    const dcBus = add('EQ-DC-BUS', 'WB2', 'dc-busbar', '充电直流母线', 'dc', { domain: 'HV_DC_CHARGE' }, { voltageV: dcVoltage, ratedCurrentA: dc.busbarA });
    const imd = add('EQ-DC-IMD1', 'RI1', 'insulation-monitor', '直流绝缘监测装置 IMD', 'dc', {}, { spec: dc.imdSpec });
    const discharge = add('EQ-DC-RS0', 'RS0', 'discharge-resistor', '直流母线泄放电阻', 'dc', { domain: 'HV_DC_CHARGE', netClass: 'POWER_DC' }, { spec: dc.dischargeText });

    const psu24 = add('EQ-AUX-T1', 'T1', 'aux-psu', '开关电源 DC24V', 'aux', { outputVoltageV: 24, neutral: acContext.neutral }, { spec: aux.psu24Text });
    const psu12 = add('EQ-AUX-T2', 'T2', 'aux-psu', '开关电源 DC12V', 'aux', { outputVoltageV: 12, neutral: acContext.neutral }, { spec: aux.psu12Text });
    const auxBus = add('EQ-AUX-BUS', 'WB4', 'aux-busbar', '辅助直流端子排（隔离 24V/12V）', 'aux', {}, { voltageDomains: ['AUX_24V', 'AUX_12V'] });
    add(controller, 'A1', 'charge-controller', '充电控制单元 CCU', 'control');
    const gateway = add('EQ-CTL-A2', 'A2', 'comm-gateway', std.physicalLayer === 'PLC' ? 'SECC 控制器' : '计费通信网关', 'control', { supplyVoltageV: 24 });
    const router = add('EQ-CTL-A3', 'A3', 'comm-gateway', '路由器 / 通信模块', 'control', { supplyVoltageV: 12 });
    const hmi = add('EQ-CTL-A4', 'A4', 'hmi-unit', '人机交互单元', 'control', { supplyVoltageV: 12 });
    const estop = add('EQ-CTL-SB1', 'SB1', 'safety-device', '急停按钮（双断点）', 'control');
    const door = add('EQ-CTL-SQ1', 'SQ1', 'safety-device', '门禁 / 防拆开关', 'control');
    const lamp = add('EQ-CTL-HL', 'HL', 'indicator-lamp', '红/绿/黄状态指示灯', 'control');
    const environment = add('EQ-CTL-B1', 'B1', 'environment-sensor', '温度 / 烟感 / 水浸监测', 'control');
    const thermal = add('EQ-AUX-M2', 'M2', 'thermal-unit', aux.thermalName || '热管理设备', 'aux', {}, { spec: aux.thermalText });

    addAuxTarget(aux24, controller, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux24, gateway, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux12, router, 'PWR_V12', 'PWR_V12_0V');
    addAuxTarget(aux12, hmi, 'PWR_V12', 'PWR_V12_0V');
    addAuxTarget(aux24, imd, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux24, lamp, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux24, environment, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux24, thermal, 'CTRL_PWR_V24', 'CTRL_PWR_V24_0V');
    aux24.positive.push(endpoint(estop, 'CONTACT_A'), endpoint(door, 'CONTACT_A'));
    peTargets.push(endpoint(modules, 'PE'), endpoint(psu24, 'PE'), endpoint(psu12, 'PE'), endpoint(thermal, 'PE'));
    addCoil(builder, controller, acContactor, 'KM1', aux24);

    /* ---------- exact AC conductors ---------- */
    const acSem = (phase) => ({ netClass: 'POWER_AC', domain: 'AC_MAINS', phase, ratedVoltageV: acContext.voltageV });
    acConductors.forEach((phase) => {
      builder.wire('进线→QS1 ' + phase, endpoint(incomer, 'OUT_' + phase), endpoint(isolator, 'IN_' + phase), acSem(phase), { service: '交流进线' });
      builder.wire('QS1→QF1 ' + phase, endpoint(isolator, 'OUT_' + phase), endpoint(breaker, 'IN_' + phase), acSem(phase));
      const qfOut = endpoint(breaker, 'OUT_' + phase);
      const rcmIn = endpoint(rcm, 'IN_' + phase);
      const spdLine = endpoint(spd, 'LINE_' + phase);
      builder.addNode('QF1 后分支 ' + phase, acSem(phase), [qfOut, rcmIn, spdLine], [[qfOut, rcmIn], [qfOut, spdLine, { service: 'SPD 取样支路' }]]);
      builder.wire('RCM1→PJ1 ' + phase, endpoint(rcm, 'OUT_' + phase), endpoint(acMeter, 'IN_' + phase), acSem(phase));
      builder.wire('PJ1→KM1 ' + phase, endpoint(acMeter, 'OUT_' + phase), endpoint(acContactor, 'IN_' + phase), acSem(phase));
    });

    /* ---------- exact DC main chain and gun branches ---------- */
    const dcPos = { netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE', ratedVoltageV: dcVoltage };
    const dcNeg = { netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'NEGATIVE', ratedVoltageV: dcVoltage };
    builder.wire('模块 DC+→FU1', endpoint(modules, 'DC_POS'), endpoint(dcFuse, 'IN'), dcPos);
    builder.wire('FU1→TA1', endpoint(dcFuse, 'OUT'), endpoint(dcSensor, 'IN'), dcPos);
    builder.wire('TA1→PJ2', endpoint(dcSensor, 'OUT'), endpoint(dcMeter, 'IN'), dcPos);

    const positiveBusMembers = [endpoint(dcMeter, 'OUT'), endpoint(dcBus, 'BUS_DC_POS'), endpoint(imd, 'SENSE_DC_POS'), endpoint(discharge, 'A')];
    const positiveBusEdges = [
      [endpoint(dcMeter, 'OUT'), endpoint(dcBus, 'BUS_DC_POS')],
      [endpoint(dcBus, 'BUS_DC_POS'), endpoint(imd, 'SENSE_DC_POS'), { service: 'IMD 正极取样' }],
      [endpoint(dcBus, 'BUS_DC_POS'), endpoint(discharge, 'A'), { service: '母线泄放' }]
    ];
    const negativeBusMembers = [endpoint(modules, 'DC_NEG'), endpoint(dcBus, 'BUS_DC_NEG'), endpoint(imd, 'SENSE_DC_NEG'), endpoint(dcMeter, 'SENSE_NEG'), endpoint(discharge, 'B')];
    const negativeBusEdges = [
      [endpoint(modules, 'DC_NEG'), endpoint(dcBus, 'BUS_DC_NEG')],
      [endpoint(dcBus, 'BUS_DC_NEG'), endpoint(imd, 'SENSE_DC_NEG'), { service: 'IMD 负极取样' }],
      [endpoint(dcBus, 'BUS_DC_NEG'), endpoint(dcMeter, 'SENSE_NEG'), { service: '直流计量负极取样' }],
      [endpoint(dcBus, 'BUS_DC_NEG'), endpoint(discharge, 'B'), { service: '母线泄放' }]
    ];

    const gunEquipment = [];
    guns.forEach((gun, index) => {
      const number = index + 1;
      const gunFuse = add('EQ-G' + number + '-F', gun.fuseTag || ('F' + number), 'dc-fuse', '枪 ' + number + ' 直流快熔', 'gun', { polarity: 'POSITIVE' }, { gun: number, ratedCurrentA: gun.fuseA });
      const kp = add('EQ-G' + number + '-KP', gun.contactorTagP || ('K' + number + 'P'), 'dc-contactor', '枪 ' + number + ' 正极接触器', 'gun', { polarity: 'POSITIVE' }, { gun: number, ratedCurrentA: gun.contactorA });
      const kn = add('EQ-G' + number + '-KN', gun.contactorTagN || ('K' + number + 'N'), 'dc-contactor', '枪 ' + number + ' 负极接触器', 'gun', { polarity: 'NEGATIVE' }, { gun: number, ratedCurrentA: gun.contactorA });
      const connector = add('EQ-G' + number + '-XS', gun.tag || ('XS' + number), 'charge-connector', '直流充电枪 ' + number, 'gun', {
        connectorType: std.connectorType, protocol: std.protocol, physicalLayer: std.physicalLayer
      }, { gun: number, currentA: gun.currentA, connectorType: std.connectorType, standardId: std.id });
      const lock = add('EQ-G' + number + '-YV', gun.lockTag || ('YV' + number), 'connector-lock', '枪 ' + number + ' 电子锁', 'gun', {}, { gun: number });

      positiveBusMembers.push(endpoint(gunFuse, 'IN'));
      positiveBusEdges.push([endpoint(dcBus, 'BUS_DC_POS'), endpoint(gunFuse, 'IN'), { service: '枪 ' + number + ' 正极支路' }]);
      negativeBusMembers.push(endpoint(kn, 'IN'));
      negativeBusEdges.push([endpoint(dcBus, 'BUS_DC_NEG'), endpoint(kn, 'IN'), { service: '枪 ' + number + ' 负极支路' }]);
      builder.wire('枪 ' + number + ' FU→K+', endpoint(gunFuse, 'OUT'), endpoint(kp, 'IN'), dcPos);
      builder.wire('枪 ' + number + ' K+→DC+', endpoint(kp, 'OUT'), endpoint(connector, 'DC_POS'), dcPos);
      builder.wire('枪 ' + number + ' K−→DC−', endpoint(kn, 'OUT'), endpoint(connector, 'DC_NEG'), dcNeg);
      addCoil(builder, controller, kp, 'G' + number + '_KP', aux24);
      addCoil(builder, controller, kn, 'G' + number + '_KN', aux24);
      addAuxTarget(aux24, lock, 'PWR_V24', 'PWR_V24_0V');
      peTargets.push(endpoint(connector, 'PE'));

      connectFixedToDynamic(builder, '枪 ' + number + ' 锁驱动', endpoint(lock, 'DRIVE'), controller, 'DO_G' + number + '_LOCK', 'out');
      connectFixedToDynamic(builder, '枪 ' + number + ' 锁反馈', endpoint(lock, 'FEEDBACK'), controller, 'DI_G' + number + '_LOCKED', 'in');
      const connectorInstance = builder.instanceById.get(connector);
      connectorInstance.terminals.filter((terminal) => terminal.required && terminal.electricalType === 'signal').forEach((terminal) => {
        const receiver = terminal.id === 'CP' && std.physicalLayer === 'PLC' ? gateway : controller;
        const prefix = receiver === gateway ? 'G' + number + '_EV_' : 'G' + number + '_';
        connectFixedToDynamic(builder, '枪 ' + number + ' ' + terminal.label, endpoint(connector, terminal.id), receiver,
          prefix + terminal.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase(), 'bidirectional');
      });
      gunEquipment.push({ gun: number, fuse: gunFuse, positiveContactor: kp, negativeContactor: kn, connector, lock });
    });

    /* ---------- ESS atomic protection topology ---------- */
    const essObjects = [];
    let fireSystem = null;
    const acBusExtraTargets = {};
    acConductors.forEach((phase) => { acBusExtraTargets[phase] = []; });
    if (ess.enabled) {
      const essBus = add('EQ-ESS-BUS', 'WB3', 'ess-busbar', '储能直流母线', 'ess', {}, { voltageV: ess.busVoltageV });
      const bms = add('EQ-ESS-BAMS', 'A5', 'bms-controller', '电池管理主控 BAMS', 'ess');
      essObjects.push(essBus, bms);
      addAuxTarget(aux24, bms, 'PWR_V24', 'PWR_V24_0V');
      const essPosMembers = [endpoint(essBus, 'BUS_DC_POS')];
      const essNegMembers = [endpoint(essBus, 'BUS_DC_NEG')];
      const essPosEdges = [];
      const essNegEdges = [];
      const clusters = [];
      for (let index = 1; index <= ess.clusterCount; index += 1) {
        const cluster = add('EQ-ESS-B' + index, 'GB' + index, 'battery-cluster', '电池簇 ' + index, 'ess', {}, {
          capacityKwh: ess.clusterKwh, voltageV: ess.busVoltageV, configuration: ess.clusterConfig
        });
        const fuse = add('EQ-ESS-FB' + index, 'FB' + index, 'ess-fuse', '簇 ' + index + ' 正极快熔', 'ess', { polarity: 'POSITIVE' }, { ratedCurrentA: ess.clusterFuseA });
        const kp = add('EQ-ESS-KBP' + index, 'KB' + index + 'P', 'ess-contactor', '簇 ' + index + ' 主正接触器', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' }, { ratedCurrentA: ess.clusterContactorA });
        const kn = add('EQ-ESS-KBN' + index, 'KB' + index + 'N', 'ess-contactor', '簇 ' + index + ' 主负接触器', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE' }, { ratedCurrentA: ess.clusterContactorA });
        const pre = add('EQ-ESS-KP' + index, 'KP' + index, 'precharge-contactor', '簇 ' + index + ' 预充接触器', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' });
        const resistor = add('EQ-ESS-RS' + index, 'RS' + index, 'precharge-resistor', '簇 ' + index + ' 预充电阻', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' }, { resistanceOhm: ess.prechargeR });
        essObjects.push(cluster, fuse, kp, kn, pre, resistor);
        clusters.push(cluster);
        peTargets.push(endpoint(cluster, 'PE'));
        const essPos = { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE', ratedVoltageV: ess.busVoltageV };
        const essNeg = { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE', ratedVoltageV: ess.busVoltageV };
        builder.wire('簇 ' + index + ' PACK+→FB', endpoint(cluster, 'PACK_DC_POS'), endpoint(fuse, 'IN'), essPos);
        builder.addNode('簇 ' + index + ' 主正/预充分支', essPos,
          [endpoint(fuse, 'OUT'), endpoint(kp, 'IN'), endpoint(pre, 'IN')],
          [[endpoint(fuse, 'OUT'), endpoint(kp, 'IN')], [endpoint(fuse, 'OUT'), endpoint(pre, 'IN')]]);
        builder.wire('簇 ' + index + ' 预充接触器→电阻', endpoint(pre, 'OUT'), endpoint(resistor, 'A'), essPos);
        builder.wire('簇 ' + index + ' PACK−→K−', endpoint(cluster, 'PACK_DC_NEG'), endpoint(kn, 'IN'), essNeg);
        essPosMembers.push(endpoint(kp, 'OUT'), endpoint(resistor, 'B'));
        essPosEdges.push([endpoint(kp, 'OUT'), endpoint(essBus, 'BUS_DC_POS')], [endpoint(resistor, 'B'), endpoint(essBus, 'BUS_DC_POS')]);
        essNegMembers.push(endpoint(kn, 'OUT'));
        essNegEdges.push([endpoint(kn, 'OUT'), endpoint(essBus, 'BUS_DC_NEG')]);
        addCoil(builder, controller, kp, 'ESS' + index + '_KBP', aux24);
        addCoil(builder, controller, kn, 'ESS' + index + '_KBN', aux24);
        addCoil(builder, controller, pre, 'ESS' + index + '_PRE', aux24);
      }

      const converter = ess.coupling === 'ac'
        ? add('EQ-ESS-PCS', 'M3', 'ess-pcs', '储能双向 PCS', 'ess', acContext, { quantity: ess.converterCount, installedKw: ess.converterInstalledKw })
        : add('EQ-ESS-DCDC', 'M4', 'ess-dcdc', '储能双向 DC/DC', 'ess', {}, { quantity: ess.converterCount, installedKw: ess.converterInstalledKw });
      essObjects.push(converter);
      addAuxTarget(aux24, converter, 'CTRL_PWR_V24', 'CTRL_PWR_V24_0V');
      peTargets.push(endpoint(converter, 'PE'));
      fireSystem = add('EQ-ESS-FS1', 'FS1', 'environment-sensor', '电池舱消防探测与联动单元', 'ess', {}, { spec: ess.fireText });
      essObjects.push(fireSystem);
      addAuxTarget(aux24, fireSystem, 'PWR_V24', 'PWR_V24_0V');
      essPosMembers.push(endpoint(converter, 'ESS_DC_POS'));
      essNegMembers.push(endpoint(converter, 'ESS_DC_NEG'));
      essPosEdges.push([endpoint(essBus, 'BUS_DC_POS'), endpoint(converter, 'ESS_DC_POS')]);
      essNegEdges.push([endpoint(essBus, 'BUS_DC_NEG'), endpoint(converter, 'ESS_DC_NEG')]);
      builder.addNode('储能正极母线', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE', ratedVoltageV: ess.busVoltageV }, essPosMembers, essPosEdges);
      builder.addNode('储能负极母线', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE', ratedVoltageV: ess.busVoltageV }, essNegMembers, essNegEdges);

      ['P', 'N'].forEach((side) => {
        const bmsTerminal = 'CAN_' + side;
        const members = [endpoint(bms, bmsTerminal)].concat(clusters.map((cluster) => endpoint(cluster, bmsTerminal)));
        const edges = clusters.map((cluster) => [endpoint(bms, bmsTerminal), endpoint(cluster, bmsTerminal)]);
        builder.addNode('BMS 簇级 CAN ' + side, { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'BMS_CAN', signalRole: 'CAN:' + side }, members, edges);
      });
      connectDynamicPair(builder, 'BAMS 上行 P', bms, 'UPLINK_P', controller, 'ESS_BMS_P', 'ESS_CAN');
      connectDynamicPair(builder, 'BAMS 上行 N', bms, 'UPLINK_N', controller, 'ESS_BMS_N', 'ESS_CAN');
      ['P', 'N'].forEach((side) => connectFixedToDynamic(builder, '储能变换器通信 ' + side, endpoint(converter, 'COMM_' + side), controller, 'ESS_CONVERTER_' + side, 'bidirectional'));

      if (ess.coupling === 'dc') {
        const gridFuse = add('EQ-ESS-FC1', 'FC1', 'dc-fuse', 'DC/DC 并网快熔', 'ess', { polarity: 'POSITIVE' }, { ratedCurrentA: ess.gridDcFuseA });
        const gridContactor = add('EQ-ESS-KC1', 'KC1', 'dc-contactor', 'DC/DC 并网接触器', 'ess', { polarity: 'POSITIVE' }, { ratedCurrentA: ess.gridDcContactorA });
        essObjects.push(gridFuse, gridContactor);
        positiveBusMembers.push(endpoint(gridFuse, 'IN'));
        positiveBusEdges.push([endpoint(dcBus, 'BUS_DC_POS'), endpoint(gridFuse, 'IN'), { service: '储能直流耦合' }]);
        negativeBusMembers.push(endpoint(converter, 'CHARGE_DC_NEG'));
        negativeBusEdges.push([endpoint(dcBus, 'BUS_DC_NEG'), endpoint(converter, 'CHARGE_DC_NEG'), { service: '储能直流耦合负极' }]);
        builder.wire('FC1→KC1', endpoint(gridFuse, 'OUT'), endpoint(gridContactor, 'IN'), dcPos);
        builder.wire('KC1→DC/DC', endpoint(gridContactor, 'OUT'), endpoint(converter, 'CHARGE_DC_POS'), dcPos);
        addCoil(builder, controller, gridContactor, 'ESS_KC1', aux24);
      } else {
        const gridBreaker = add('EQ-ESS-QF2', 'QF2', 'ac-breaker', 'PCS 并网断路器', 'ess', acContext, { ratedCurrentA: ess.gridAcBreakerA });
        const gridContactor = add('EQ-ESS-KM2', 'KM2', 'ac-contactor', 'PCS 并网接触器', 'ess', acContext, { ratedCurrentA: ess.gridAcContactorA });
        essObjects.push(gridBreaker, gridContactor);
        acConductors.forEach((phase) => {
          acBusExtraTargets[phase].push(endpoint(gridBreaker, 'IN_' + phase));
          builder.wire('QF2→KM2 ' + phase, endpoint(gridBreaker, 'OUT_' + phase), endpoint(gridContactor, 'IN_' + phase), acSem(phase));
          builder.wire('KM2→PCS ' + phase, endpoint(gridContactor, 'OUT_' + phase), endpoint(converter, 'AC_' + phase), acSem(phase));
        });
        addCoil(builder, controller, gridContactor, 'ESS_KM2', aux24);
      }
    }

    builder.addNode('充电 DC+ 母线', dcPos, positiveBusMembers, positiveBusEdges);
    builder.addNode('充电 DC− 母线', dcNeg, negativeBusMembers, negativeBusEdges);

    /* ---------- AC distribution node, including auxiliaries and ESS ---------- */
    acConductors.forEach((phase) => {
      const hub = endpoint(acBus, 'BUS_' + phase);
      const members = [endpoint(acContactor, 'OUT_' + phase), hub, endpoint(modules, 'AC_' + phase)];
      const edges = [[endpoint(acContactor, 'OUT_' + phase), hub], [hub, endpoint(modules, 'AC_' + phase), { service: '功率模块交流进线' }]];
      if (phase === 'L1') {
        [psu24, psu12].forEach((psu) => { members.push(endpoint(psu, 'AC_L1')); edges.push([hub, endpoint(psu, 'AC_L1'), { service: '辅助电源进线' }]); });
      }
      const secondPhase = acContext.neutral ? 'N' : 'L2';
      if (phase === secondPhase) {
        const terminalId = acContext.neutral ? 'AC_N' : 'AC_L2';
        [psu24, psu12].forEach((psu) => { members.push(endpoint(psu, terminalId)); edges.push([hub, endpoint(psu, terminalId), { service: '辅助电源回路' }]); });
      }
      (acBusExtraTargets[phase] || []).forEach((target) => { members.push(target); edges.push([hub, target, { service: '储能交流耦合' }]); });
      builder.addNode('交流分配母线 ' + phase, acSem(phase), members, edges);
    });

    /* ---------- isolated auxiliary voltage domains ---------- */
    const makeAuxNode = (voltage, polarity, psuTerminal, busTerminal, targets) => {
      const psu = voltage === 24 ? psu24 : psu12;
      const members = [endpoint(psu, psuTerminal), endpoint(auxBus, busTerminal)].concat(targets);
      const edges = [[endpoint(psu, psuTerminal), endpoint(auxBus, busTerminal)]].concat(targets.map((target) => [endpoint(auxBus, busTerminal), target]));
      builder.addNode('AUX ' + voltage + 'V ' + polarity, {
        netClass: 'POWER_DC_AUX', domain: 'AUX_' + voltage + 'V', nominalVoltageV: polarity === 'POSITIVE' ? voltage : 0,
        referenceVoltageV: voltage, polarity
      }, members, edges);
    };
    makeAuxNode(24, 'POSITIVE', 'OUT_V24', 'BUS24_V24', aux24.positive);
    makeAuxNode(24, 'RETURN', 'OUT_V24_0V', 'BUS24_V24_0V', aux24.return);
    makeAuxNode(12, 'POSITIVE', 'OUT_V12', 'BUS12_V12', aux12.positive);
    makeAuxNode(12, 'RETURN', 'OUT_V12_0V', 'BUS12_V12_0V', aux12.return);

    /* ---------- PE is one explicit node, never an alias for DC− ---------- */
    const peMembers = [endpoint(incomer, 'PE'), endpoint(peBar, 'PE'), endpoint(spd, 'PE'), endpoint(imd, 'PE')].concat(peTargets);
    const peEdges = [[endpoint(incomer, 'PE'), endpoint(peBar, 'PE')], [endpoint(peBar, 'PE'), endpoint(spd, 'PE')], [endpoint(peBar, 'PE'), endpoint(imd, 'PE')]]
      .concat(peTargets.map((target) => [endpoint(peBar, 'PE'), target]));
    builder.addNode('保护接地 PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', nominalVoltageV: 0 }, peMembers, peEdges);

    /* ---------- deterministic control and communication ---------- */
    ['P', 'N'].forEach((side) => {
      connectFixedToDynamic(builder, 'RCM 信号 ' + side, endpoint(rcm, 'SIGNAL_' + side), controller, 'DI_RCM_' + side, 'in');
      connectFixedToDynamic(builder, '电流传感 ' + side, endpoint(dcSensor, 'SIGNAL_' + side), controller, 'AI_DC_CURRENT_' + side, 'in');
      connectFixedToDynamic(builder, 'IMD 告警 ' + side, endpoint(imd, 'ALARM_' + side), controller, 'DI_IMD_' + side, 'in');
      connectFixedToDynamic(builder, '交流表 RS485 ' + side, endpoint(acMeter, 'COMM_' + side), controller, 'METER_AC_' + side, 'bidirectional');
      connectFixedToDynamic(builder, '直流表 RS485 ' + side, endpoint(dcMeter, 'COMM_' + side), controller, 'METER_DC_' + side, 'bidirectional');
      connectFixedToDynamic(builder, '功率模块 CAN ' + side, endpoint(modules, 'COMM_' + side), controller, 'MODULE_CAN_' + side, 'bidirectional');
    });
    connectFixedToDynamic(builder, '急停 +24V 安全回路', endpoint(estop, 'CONTACT_B'), controller, 'DI_ESTOP', 'in');
    connectFixedToDynamic(builder, '门禁 +24V 安全回路', endpoint(door, 'CONTACT_B'), controller, 'DI_DOOR', 'in');
    connectFixedToDynamic(builder, '环境告警', endpoint(environment, 'ALARM'), controller, 'DI_ENVIRONMENT', 'in');
    if (fireSystem) connectFixedToDynamic(builder, '电池舱消防告警', endpoint(fireSystem, 'ALARM'), controller, 'DI_ESS_FIRE', 'in');
    connectFixedToDynamic(builder, '热管理使能', endpoint(thermal, 'ENABLE'), controller, 'DO_THERMAL_ENABLE', 'out');
    connectFixedToDynamic(builder, '状态灯驱动', endpoint(lamp, 'DRIVE'), controller, 'DO_STATUS_LAMP', 'out');
    ['P', 'N'].forEach((side) => {
      connectDynamicPair(builder, 'CCU↔SECC ' + side, controller, 'SECC_LINK_' + side, gateway, 'CCU_LINK_' + side, 'ETHERNET');
      connectDynamicPair(builder, 'SECC↔路由器 ' + side, gateway, 'WAN_' + side, router, 'LAN_' + side, 'ETHERNET');
      connectDynamicPair(builder, 'CCU↔HMI ' + side, controller, 'HMI_LINK_' + side, hmi, 'CCU_LINK_' + side, 'MODBUS_TCP');
    });

    builder.finishInstances();

    const requirements = {
      schema: 'EVSE-REQUIREMENT-SPEC/1.0',
      standard: std.id,
      standardName: std.name,
      connector: std.connector,
      protocol: std.protocol,
      archetype: p.archetype,
      outputKw: dc.ratedKw,
      gunCount: guns.length,
      gunCurrentA: p.gunCurrentA,
      essEnabled: !!ess.enabled,
      essKwh: ess.enabled ? ess.usableKwh : 0,
      specialRequirements: Array.isArray(p.specialRequirements) ? p.specialRequirements.slice() : [],
      source: p.requirement ? clone(p.requirement) : { source: p.requirementSource || 'FORM', confidence: p.requirementConfidence, confirmed: !!p.requirementConfirmed }
    };
    const model = {
      schema: 'EVSE-EDEM/4.0',
      schemaVersion: SCHEMA_VERSION,
      project: { id: projectId, name: p.pileName || '充电桩', site: p.site || '', status: 'CONCEPT_DRAFT', referenceDesignation: docControl.projectReference },
      documentControl: docControl,
      requirements,
      assumptions: clone(spec.assumptions || []),
      decisions: [
        { id: 'DEC-SOURCE-OF-TRUTH', value: 'EDEM_V4_TERMINAL_NETLIST', rationale: '绘图与 DXF 必须引用同一 instances/nets/circuits。' },
        { id: 'DEC-ROUTING', value: 'CHANNEL_INTERVAL_LANES', rationale: '几何路由不得推断或改写电气连接。' },
        { id: 'DEC-COMPONENT-AI', value: 'DRAFT_REVIEW_APPROVE', rationale: 'AI 导入器件只能生成隔离草稿，批准后才能进入受控目录。' }
      ],
      capabilities: {
        implementedStandards: IMPLEMENTED_STANDARDS.slice(),
        implementedArchetypes: IMPLEMENTED_ARCHETYPES.slice(),
        terminalLevelNetlist: true,
        conductorLevelAc: true,
        explicitDcPolarity: true,
        isolatedAuxDomains: true,
        rendererIndependent: true
      },
      instances: builder.instances,
      equipment: builder.instances,
      nets: builder.nets,
      circuits: builder.circuits,
      topology: {
        acChain: [incomer, isolator, breaker, rcm, acMeter, acContactor, acBus],
        dcChain: [modules, dcFuse, dcSensor, dcMeter, dcBus],
        gunBranches: gunEquipment,
        essObjects,
        earthBar: peBar,
        controlObjects: [controller, gateway, router, hmi, estop, door, lamp, environment, thermal]
      },
      sheets: docControl.drawingRegister.map((drawing) => ({ id: drawing.key, drawingNo: drawing.drawingNo, title: drawing.title, page: drawing.page })),
      ess: { enabled: !!ess.enabled, coupling: ess.coupling || null, objectIds: essObjects.slice() },
      domainConverters: DOMAIN_CONVERTERS.slice(),
      provenance: {
        engine: 'EVSE_ENGINE',
        engineVersion: spec.engineVersion || (window.EVSE_ENGINE && window.EVSE_ENGINE.ENGINE_VERSION) || 'UNSPECIFIED',
        requirementSource: requirements.source,
        componentCatalog: 'EVSE-CATALOG-' + catalog.VERSION,
        generatedAt: spec.generatedAt || null,
        calculationStatus: 'CONCEPTUAL—PROFESSIONAL_REVIEW_REQUIRED'
      }
    };
    model.modelHash = modelHash({
      schemaVersion: model.schemaVersion,
      requirements: model.requirements,
      instances: model.instances,
      nets: model.nets,
      circuits: model.circuits,
      assumptions: model.assumptions,
      decisions: model.decisions,
      capabilities: model.capabilities,
      topology: model.topology,
      ess: model.ess
    });
    model.modelValidation = window.EVSE_ERC
      ? window.EVSE_ERC.validate(model)
      : { id: 'EVSE-ERC-MISSING', status: 'BLOCKED', blockingCount: 1, checks: [], violations: [{ ruleId: 'ERC-000', code: 'ERC_MISSING', severity: 'BLOCK', message: 'EVSE_ERC 未加载。' }] };
    return model;
  }

  return {
    SCHEMA_VERSION,
    DOCUMENT_STATUS,
    CAD_LAYER_MANIFEST,
    DOMAIN_CONVERTERS,
    IMPLEMENTED_STANDARDS,
    IMPLEMENTED_ARCHETYPES,
    endpoint,
    stable,
    modelHash,
    create
  };
})();
