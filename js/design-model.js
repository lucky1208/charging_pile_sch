/* ============================================================
 * EVSE Engineering Design Model (EDEM)
 * ------------------------------------------------------------
 * 充电桩方案的唯一、与渲染器无关的工程真值来源。原理图、设备
 * 明细表、计算记录和校验结果都必须引用这里的 ID，不允许各自
 * 另外发明一套拓扑。
 * ============================================================ */
(function () {
  'use strict';

  const SCHEMA_VERSION = '3.0.0';
  const DOCUMENT_STATUS = 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED';

  /* 项目文控约定，不代表该自动图纸已按 IEC 81346 / ISO 7200 /
   * ISO 5457 或业主 CAD 手册审批通过。 */
  const CAD_LAYER_MANIFEST = [
    { name: 'EVSE-FRAME', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.50, purpose: '图框、标题栏、修订栏' },
    { name: 'EVSE-TEXT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '标题、说明、位号' },
    { name: 'EVSE-ANNO', color: 8, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '待核说明、参考注释' },
    { name: 'EVSE-EQPT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '设备外形与符号' },
    { name: 'EVSE-AC', color: 5, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '交流主回路' },
    { name: 'EVSE-DC', color: 1, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '充电直流主回路' },
    { name: 'EVSE-ESS', color: 30, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '储能直流回路' },
    { name: 'EVSE-AUX', color: 4, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '辅助直流电源 24V/12V' },
    { name: 'EVSE-CTL', color: 8, linetype: 'DASHED', lineweightMm: 0.18, purpose: '控制、联锁与采样信号' },
    { name: 'EVSE-COMM', color: 6, linetype: 'DASHED', lineweightMm: 0.18, purpose: '通信总线与后台链路' },
    { name: 'EVSE-PE', color: 3, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '保护接地与等电位' }
  ];

  const DRAWING_REGISTER = [
    { key: 'ev-schematic', drawingNo: 'EVSE-CONCEPT-101', title: '充电桩电气原理图', discipline: 'ELECTRICAL', sheet: 'A3', orientation: 'LANDSCAPE', scale: 'NTS' }
  ];

  /* 命名端口是工程图与渲染器之间的契约：参考图复核显示，专业原理图
   * 的导线永远接在明确端子上，不接设备几何中心。 */
  const PORT_TEMPLATES = {
    'ac-incomer': [{ id: 'out', netClass: 'POWER_AC', direction: 'out', required: true }],
    'ac-isolator': [{ id: 'in', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_AC', direction: 'out', required: true }],
    'ac-breaker': [{ id: 'in', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_AC', direction: 'out', required: true }],
    'surge-protector': [{ id: 'line', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'earth', netClass: 'PROTECTIVE_EARTH', direction: 'out', required: true }],
    'residual-current-monitor': [{ id: 'in', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_AC', direction: 'out', required: true }, { id: 'signal', netClass: 'SIGNAL_CTRL', direction: 'out', required: true }],
    'ac-contactor': [{ id: 'in', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_AC', direction: 'out', required: true }, { id: 'coil', netClass: 'SIGNAL_CTRL', direction: 'in', required: true }],
    'ac-meter': [{ id: 'in', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_AC', direction: 'out', required: true }, { id: 'comm', netClass: 'SIGNAL_COMM', direction: 'out', required: true }],
    'ac-busbar': [{ id: 'in', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_AC', direction: 'out', required: true }],
    'power-module-array': [{ id: 'ac', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'dc', netClass: 'POWER_DC', direction: 'out', required: true }, { id: 'ctrl', netClass: 'SIGNAL_COMM', direction: 'bidirectional', required: true }],
    'dc-busbar': [{ id: 'in', netClass: 'POWER_DC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC', direction: 'out', required: true }],
    'dc-fuse': [{ id: 'in', netClass: 'POWER_DC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC', direction: 'out', required: true }],
    'dc-contactor': [{ id: 'in', netClass: 'POWER_DC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC', direction: 'out', required: true }, { id: 'coil', netClass: 'SIGNAL_CTRL', direction: 'in', required: true }],
    'current-transducer': [{ id: 'in', netClass: 'POWER_DC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC', direction: 'out', required: true }, { id: 'signal', netClass: 'SIGNAL_CTRL', direction: 'out', required: true }],
    'insulation-monitor': [{ id: 'dc', netClass: 'POWER_DC', direction: 'in', required: true }, { id: 'earth', netClass: 'PROTECTIVE_EARTH', direction: 'out', required: true }, { id: 'signal', netClass: 'SIGNAL_CTRL', direction: 'out', required: true }],
    'dc-meter': [{ id: 'in', netClass: 'POWER_DC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC', direction: 'out', required: true }, { id: 'comm', netClass: 'SIGNAL_COMM', direction: 'out', required: true }],
    'charge-connector': [{ id: 'dc', netClass: 'POWER_DC', direction: 'in', required: true }, { id: 'control', netClass: 'SIGNAL_CTRL', direction: 'bidirectional', required: true }, { id: 'comm', netClass: 'SIGNAL_COMM', direction: 'bidirectional', required: true }, { id: 'earth', netClass: 'PROTECTIVE_EARTH', direction: 'in', required: true }],
    'connector-lock': [{ id: 'power', netClass: 'POWER_DC_AUX', direction: 'in', required: true }, { id: 'control', netClass: 'SIGNAL_CTRL', direction: 'bidirectional', required: true }],
    'charge-controller': [{ id: 'power', netClass: 'POWER_DC_AUX', direction: 'in', required: true }, { id: 'control', netClass: 'SIGNAL_CTRL', direction: 'bidirectional', required: true }, { id: 'comm', netClass: 'SIGNAL_COMM', direction: 'bidirectional', required: true }],
    'comm-gateway': [{ id: 'power', netClass: 'POWER_DC_AUX', direction: 'in', required: true }, { id: 'comm', netClass: 'SIGNAL_COMM', direction: 'bidirectional', required: true }],
    'hmi-unit': [{ id: 'power', netClass: 'POWER_DC_AUX', direction: 'in', required: true }, { id: 'control', netClass: 'SIGNAL_CTRL', direction: 'bidirectional', required: true }],
    'safety-device': [{ id: 'control', netClass: 'SIGNAL_CTRL', direction: 'out', required: true }],
    'aux-psu': [{ id: 'in', netClass: 'POWER_AC', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC_AUX', direction: 'out', required: true }],
    'aux-busbar': [{ id: 'in', netClass: 'POWER_DC_AUX', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC_AUX', direction: 'out', required: true }],
    'thermal-unit': [{ id: 'power', netClass: 'POWER_DC_AUX', direction: 'in', required: true }, { id: 'control', netClass: 'SIGNAL_CTRL', direction: 'in', required: false }],
    'earth-bar': [{ id: 'in', netClass: 'PROTECTIVE_EARTH', direction: 'in', required: true }, { id: 'out', netClass: 'PROTECTIVE_EARTH', direction: 'out', required: false }],
    'battery-cluster': [{ id: 'dc', netClass: 'POWER_DC_ESS', direction: 'out', required: true }, { id: 'bms', netClass: 'SIGNAL_COMM', direction: 'bidirectional', required: true }],
    'battery-protection': [{ id: 'in', netClass: 'POWER_DC_ESS', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC_ESS', direction: 'out', required: true }, { id: 'coil', netClass: 'SIGNAL_CTRL', direction: 'in', required: true }],
    'ess-busbar': [{ id: 'in', netClass: 'POWER_DC_ESS', direction: 'in', required: true }, { id: 'out', netClass: 'POWER_DC_ESS', direction: 'out', required: true }],
    'bms-controller': [{ id: 'power', netClass: 'POWER_DC_AUX', direction: 'in', required: true }, { id: 'comm', netClass: 'SIGNAL_COMM', direction: 'bidirectional', required: true }, { id: 'ctrl', netClass: 'SIGNAL_CTRL', direction: 'out', required: true }],
    'ess-dcdc': [{ id: 'ess', netClass: 'POWER_DC_ESS', direction: 'in', required: true }, { id: 'dc', netClass: 'POWER_DC', direction: 'out', required: true }, { id: 'ctrl', netClass: 'SIGNAL_COMM', direction: 'bidirectional', required: true }],
    'ess-pcs': [{ id: 'ess', netClass: 'POWER_DC_ESS', direction: 'in', required: true }, { id: 'ac', netClass: 'POWER_AC', direction: 'out', required: true }, { id: 'ctrl', netClass: 'SIGNAL_COMM', direction: 'bidirectional', required: true }]
  };

  /* 只有这些设备允许同时拥有多个 POWER_* 端口，即允许跨能量域。 */
  const DOMAIN_CONVERTERS = ['power-module-array', 'ess-dcdc', 'ess-pcs', 'aux-psu'];

  function portsFor(kind) {
    return (PORT_TEMPLATES[kind] || [{ id: 'in', netClass: 'UNCLASSIFIED', direction: 'in', required: false }, { id: 'out', netClass: 'UNCLASSIFIED', direction: 'out', required: false }])
      .map((port) => Object.assign({}, port));
  }

  function idPart(value) {
    const raw = String(value || '').trim();
    const ascii = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
    /* 中文等非拉丁项目名不能全部塌缩成同一个代号。这是确定性标识符，
     * 不是安全散列，也不能替代业主项目编号。 */
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    const unicodeSuffix = 'U' + (hash >>> 0).toString(36).toUpperCase().slice(0, 10);
    if (ascii && !/[^\x00-\x7F]/.test(raw)) return ascii;
    if (ascii) return (ascii.slice(0, 16) + '-' + unicodeSuffix).slice(0, 28);
    return raw ? unicodeSuffix : 'EVSE';
  }

  function projectReference(projectId) {
    return 'EVSE-' + String(projectId || 'EVSE').replace(/^PRJ-/, '');
  }

  function documentControl(projectId, standardName) {
    const projectRef = projectReference(projectId);
    return {
      documentSetId: projectRef + '-CONCEPT-SET',
      projectReference: projectRef,
      documentClass: 'CONCEPTUAL_SCHEME',
      issuePurpose: '方案比较与工程深化输入',
      status: DOCUMENT_STATUS,
      revision: 'P01',
      revisionHistory: [{ revision: 'P01', status: 'UNISSUED', description: '自动生成的方案级原理图；待专业校核、批准和签发', issueDate: null }],
      page: { current: 1, total: 1 },
      roleStatus: {
        preparedBy: 'AUTO_GENERATED—REVIEW_REQUIRED',
        checkedBy: 'UNASSIGNED',
        approvedBy: 'UNASSIGNED'
      },
      referenceDesignationSystem: {
        convention: 'PROJECT_INTERNAL_EVSE_V1',
        status: 'PROJECT_CONVENTION—NOT_A_CERTIFIED_IEC_81346_IMPLEMENTATION',
        equipmentPattern: 'EVSE-{系统}-{类型}{序号}',
        circuitPattern: 'EVSE-{系统}-CCT{序号}',
        note: '代号用于方案追溯；项目深化时须由业主/设计院编码规则复核。'
      },
      referenceBaseline: [
        { id: 'REF-IEC-61082-1', title: 'IEC 61082-1', use: '文件编制参考', status: 'REFERENCE_ONLY—APPLICABILITY_TO_BE_CONFIRMED' },
        { id: 'REF-IEC-60617', title: 'IEC 60617 / GB/T 4728', use: '图形符号参考', status: 'REFERENCE_ONLY—SYMBOL_LIBRARY_TO_BE_VERIFIED' },
        { id: 'REF-EV-STANDARD', title: standardName || '充电接口标准', use: '接口与协议基线', status: 'REFERENCE_ONLY—CERTIFICATION_REQUIRED' },
        { id: 'REF-ISO-5457', title: 'ISO 5457 / ISO 7200', use: '图幅与标题栏参考', status: 'REFERENCE_ONLY—PROJECT_TEMPLATE_REQUIRED' }
      ],
      drawingRegister: DRAWING_REGISTER.map((drawing) => Object.assign({}, drawing, {
        drawingRef: projectRef + '-' + drawing.drawingNo,
        revision: 'P01',
        status: DOCUMENT_STATUS,
        issuePurpose: '方案级自动原理图，待专业校核/签发',
        verification: 'NOT_VERIFIED',
        output: ['SVG_A3_PREVIEW', 'DXF_R2010_CONCEPT']
      })),
      cadLayerManifest: CAD_LAYER_MANIFEST.map((layer) => Object.assign({}, layer)),
      traceability: {
        modelSchema: 'EDEM-' + SCHEMA_VERSION,
        source: 'EVSE_ENGINE',
        generatedAt: null,
        immutableInputHash: null,
        note: '导出包应另行记录输入快照、计算版本、审查人和签发时间。'
      }
    };
  }

  function create(spec) {
    const p = spec.params || {};
    const std = spec.standard || {};
    const ac = spec.ac || {};
    const dc = spec.dc || {};
    const guns = Array.isArray(spec.guns) ? spec.guns : [];
    const ess = spec.ess || { enabled: false };
    const aux = spec.aux || {};
    const projectId = 'PRJ-' + idPart(p.pileName);
    const docControl = documentControl(projectId, std.connector);

    const equipment = [];
    const circuits = [];
    const addEquipment = (data) => {
      const item = Object.assign({
        id: data.id, ref: data.ref || data.id,
        referenceDesignation: data.referenceDesignation || data.ref || data.id,
        kind: data.kind, quantity: 1, source: 'EVSE_ENGINE', status: 'CONCEPT',
        ports: portsFor(data.kind)
      }, data);
      equipment.push(item);
      return item.id;
    };
    const addPower = (id, ref, from, fromPort, to, toPort, netClass, voltageV, extra) => {
      circuits.push(Object.assign({
        id, ref, referenceDesignation: ref, kind: 'electrical', direction: 'from-to',
        from, fromPort, to, toPort, netClass, voltageV, status: 'CONCEPT'
      }, extra || {}));
      return id;
    };
    const addSignal = (id, ref, from, fromPort, to, toPort, netClass, protocol, extra) => {
      circuits.push(Object.assign({
        id, ref, referenceDesignation: ref, kind: 'signal', direction: 'from-to',
        from, fromPort, to, toPort, netClass, protocol, status: 'CONCEPT'
      }, extra || {}));
      return id;
    };

    const acV = ac.lineVoltage || 400;
    const dcV = dc.busVoltageV || 750;
    const auxV = 24;

    /* ---------- 保护接地 ---------- */
    const peBar = addEquipment({ id: 'EQ-PE', ref: 'EVSE-PE-PE01', kind: 'earth-bar', name: '保护接地排 PE', system: 'earth' });

    /* ---------- 交流进线 ---------- */
    const incomer = addEquipment({ id: 'EQ-AC-IN', ref: 'EVSE-AC-W01', kind: 'ac-incomer', name: '交流进线', system: 'ac', voltageV: acV, phases: ac.phases, note: ac.description });
    const isolator = addEquipment({ id: 'EQ-AC-QS1', ref: 'EVSE-AC-QS1', kind: 'ac-isolator', name: '进线隔离开关', system: 'ac', ratedCurrentA: ac.breakerA });
    const breaker = addEquipment({ id: 'EQ-AC-QF1', ref: 'EVSE-AC-QF1', kind: 'ac-breaker', name: '进线断路器', system: 'ac', ratedCurrentA: ac.breakerA, breakingKa: ac.breakingKa });
    const spd = addEquipment({ id: 'EQ-AC-FV1', ref: 'EVSE-AC-FV1', kind: 'surge-protector', name: '电源浪涌保护器', system: 'ac', spec: ac.spdClass });
    const rcm = addEquipment({ id: 'EQ-AC-RCM1', ref: 'EVSE-AC-RCM1', kind: 'residual-current-monitor', name: '剩余电流监测/漏电继电器', system: 'ac', spec: ac.rcdType });
    const acMeter = addEquipment({ id: 'EQ-AC-PJ1', ref: 'EVSE-AC-PJ1', kind: 'ac-meter', name: '交流电能表', system: 'ac', spec: std.meter });
    const acContactor = addEquipment({ id: 'EQ-AC-KM1', ref: 'EVSE-AC-KM1', kind: 'ac-contactor', name: '交流主接触器', system: 'ac', ratedCurrentA: ac.contactorA });
    const acBus = addEquipment({ id: 'EQ-AC-BUS', ref: 'EVSE-AC-WB1', kind: 'ac-busbar', name: '交流分配母排', system: 'ac', voltageV: acV, ratedCurrentA: ac.busbarA });

    addPower('CCT-AC-01', 'EVSE-AC-CCT01', incomer, 'out', isolator, 'in', 'POWER_AC', acV, { cable: ac.cableText });
    addPower('CCT-AC-02', 'EVSE-AC-CCT02', isolator, 'out', breaker, 'in', 'POWER_AC', acV);
    addPower('CCT-AC-03', 'EVSE-AC-CCT03', breaker, 'out', rcm, 'in', 'POWER_AC', acV);
    addPower('CCT-AC-04', 'EVSE-AC-CCT04', rcm, 'out', acMeter, 'in', 'POWER_AC', acV);
    addPower('CCT-AC-05', 'EVSE-AC-CCT05', acMeter, 'out', acContactor, 'in', 'POWER_AC', acV);
    addPower('CCT-AC-06', 'EVSE-AC-CCT06', acContactor, 'out', acBus, 'in', 'POWER_AC', acV);
    addPower('CCT-AC-07', 'EVSE-AC-CCT07', breaker, 'out', spd, 'line', 'POWER_AC', acV, { service: '浪涌保护支路' });
    addPower('CCT-PE-01', 'EVSE-PE-CCT01', spd, 'earth', peBar, 'in', 'PROTECTIVE_EARTH', 0, { service: 'SPD 接地' });

    /* ---------- 功率变换 ---------- */
    const modules = addEquipment({
      id: 'EQ-PM', ref: 'EVSE-PM-M01', kind: 'power-module-array', name: '充电功率模块阵列',
      system: 'power', quantity: dc.moduleCount, unitKw: dc.moduleKw,
      installedKw: dc.installedKw, outputRange: dc.outputRangeText
    });
    addPower('CCT-PM-01', 'EVSE-PM-CCT01', acBus, 'out', modules, 'ac', 'POWER_AC', acV, { service: '模块交流进线' });

    /* ---------- 充电直流母线与保护计量 ---------- */
    const dcBus = addEquipment({ id: 'EQ-DC-BUS', ref: 'EVSE-DC-WB1', kind: 'dc-busbar', name: '充电直流母线', system: 'dc', voltageV: dcV, ratedCurrentA: dc.busbarA });
    const dcFuse = addEquipment({ id: 'EQ-DC-FU1', ref: 'EVSE-DC-FU1', kind: 'dc-fuse', name: '直流总快速熔断器', system: 'dc', ratedCurrentA: dc.mainFuseA });
    const dcSensor = addEquipment({ id: 'EQ-DC-TA1', ref: 'EVSE-DC-TA1', kind: 'current-transducer', name: '直流霍尔电流传感器', system: 'dc', rangeA: dc.sensorRangeA });
    const imd = addEquipment({ id: 'EQ-DC-IMD1', ref: 'EVSE-DC-RI1', kind: 'insulation-monitor', name: '直流绝缘监测装置 IMD', system: 'dc', spec: dc.imdSpec });
    const dcMeter = addEquipment({ id: 'EQ-DC-PJ2', ref: 'EVSE-DC-PJ2', kind: 'dc-meter', name: '直流电能表', system: 'dc', spec: std.meter });

    addPower('CCT-DC-01', 'EVSE-DC-CCT01', modules, 'dc', dcFuse, 'in', 'POWER_DC', dcV, { service: '模块直流汇流' });
    addPower('CCT-DC-02', 'EVSE-DC-CCT02', dcFuse, 'out', dcSensor, 'in', 'POWER_DC', dcV);
    addPower('CCT-DC-03', 'EVSE-DC-CCT03', dcSensor, 'out', dcMeter, 'in', 'POWER_DC', dcV);
    addPower('CCT-DC-04', 'EVSE-DC-CCT04', dcMeter, 'out', dcBus, 'in', 'POWER_DC', dcV);
    addPower('CCT-DC-05', 'EVSE-DC-CCT05', dcBus, 'out', imd, 'dc', 'POWER_DC', dcV, { service: '绝缘监测取样' });
    addPower('CCT-PE-02', 'EVSE-PE-CCT02', imd, 'earth', peBar, 'in', 'PROTECTIVE_EARTH', 0, { service: 'IMD 接地基准' });

    /* ---------- 辅助电源 ---------- */
    const psu24 = addEquipment({ id: 'EQ-AUX-T1', ref: 'EVSE-AUX-T1', kind: 'aux-psu', name: '开关电源 DC24V', system: 'aux', spec: aux.psu24Text });
    const psu12 = addEquipment({ id: 'EQ-AUX-T2', ref: 'EVSE-AUX-T2', kind: 'aux-psu', name: '开关电源 DC12V', system: 'aux', spec: aux.psu12Text });
    const auxBus = addEquipment({ id: 'EQ-AUX-BUS', ref: 'EVSE-AUX-WB2', kind: 'aux-busbar', name: '辅助直流母排 24V/12V', system: 'aux', voltageV: auxV });
    addPower('CCT-AUX-01', 'EVSE-AUX-CCT01', acBus, 'out', psu24, 'in', 'POWER_AC', acV, { service: '辅助电源进线' });
    addPower('CCT-AUX-02', 'EVSE-AUX-CCT02', acBus, 'out', psu12, 'in', 'POWER_AC', acV, { service: '辅助电源进线' });
    addPower('CCT-AUX-03', 'EVSE-AUX-CCT03', psu24, 'out', auxBus, 'in', 'POWER_DC_AUX', 24);
    addPower('CCT-AUX-04', 'EVSE-AUX-CCT04', psu12, 'out', auxBus, 'in', 'POWER_DC_AUX', 12);

    /* ---------- 控制与通信 ---------- */
    const controller = addEquipment({ id: 'EQ-CTL-A1', ref: 'EVSE-CTL-A1', kind: 'charge-controller', name: '充电控制单元 CCU', system: 'control', spec: std.protocol });
    const gateway = addEquipment({ id: 'EQ-CTL-A2', ref: 'EVSE-CTL-A2', kind: 'comm-gateway', name: (std.physicalLayer === 'PLC' ? 'SECC 通信控制器（PLC）' : '计费与后台通信网关'), system: 'control', spec: std.backend });
    const router = addEquipment({ id: 'EQ-CTL-A3', ref: 'EVSE-CTL-A3', kind: 'comm-gateway', name: '4G/以太网路由器', system: 'control', spec: aux.networkText });
    const hmi = addEquipment({ id: 'EQ-HMI-A4', ref: 'EVSE-HMI-A4', kind: 'hmi-unit', name: '人机交互（显示屏/读卡器）', system: 'control', spec: aux.hmiText });
    const estop = addEquipment({ id: 'EQ-SAF-SB1', ref: 'EVSE-SAF-SB1', kind: 'safety-device', name: '急停按钮', system: 'safety', spec: '双断点自锁，直接切除输出使能' });
    const door = addEquipment({ id: 'EQ-SAF-SQ1', ref: 'EVSE-SAF-SQ1', kind: 'safety-device', name: '柜门门禁/防拆开关', system: 'safety' });
    const thermal = addEquipment({ id: 'EQ-THM-M1', ref: 'EVSE-THM-M1', kind: 'thermal-unit', name: aux.thermalName || '柜内热管理', system: 'thermal', spec: aux.thermalText });

    addPower('CCT-AUX-05', 'EVSE-AUX-CCT05', auxBus, 'out', controller, 'power', 'POWER_DC_AUX', 24);
    addPower('CCT-AUX-06', 'EVSE-AUX-CCT06', auxBus, 'out', gateway, 'power', 'POWER_DC_AUX', 12);
    addPower('CCT-AUX-07', 'EVSE-AUX-CCT07', auxBus, 'out', router, 'power', 'POWER_DC_AUX', 12);
    addPower('CCT-AUX-08', 'EVSE-AUX-CCT08', auxBus, 'out', hmi, 'power', 'POWER_DC_AUX', 12);
    addPower('CCT-AUX-09', 'EVSE-AUX-CCT09', auxBus, 'out', thermal, 'power', 'POWER_DC_AUX', 24);

    addSignal('SIG-CTL-01', 'EVSE-CTL-SIG01', controller, 'control', acContactor, 'coil', 'SIGNAL_CTRL', '接触器控制 24VDC');
    addSignal('SIG-CTL-02', 'EVSE-CTL-SIG02', rcm, 'signal', controller, 'control', 'SIGNAL_CTRL', '漏电报警/跳闸联锁');
    addSignal('SIG-CTL-03', 'EVSE-CTL-SIG03', dcSensor, 'signal', controller, 'control', 'SIGNAL_CTRL', '直流电流采样');
    addSignal('SIG-CTL-04', 'EVSE-CTL-SIG04', imd, 'signal', controller, 'control', 'SIGNAL_CTRL', '绝缘阻值/告警');
    addSignal('SIG-CTL-05', 'EVSE-CTL-SIG05', estop, 'control', controller, 'control', 'SIGNAL_CTRL', '急停硬线联锁');
    addSignal('SIG-CTL-06', 'EVSE-CTL-SIG06', door, 'control', controller, 'control', 'SIGNAL_CTRL', '门禁/防拆状态');
    addSignal('SIG-CTL-07', 'EVSE-CTL-SIG07', controller, 'control', hmi, 'control', 'SIGNAL_CTRL', '人机交互串口');
    addSignal('SIG-COM-01', 'EVSE-CTL-SIG08', controller, 'comm', modules, 'ctrl', 'SIGNAL_COMM', '模块 CAN 控制总线');
    addSignal('SIG-COM-02', 'EVSE-CTL-SIG09', dcMeter, 'comm', controller, 'comm', 'SIGNAL_COMM', '计量数据 RS485/CAN');
    addSignal('SIG-COM-03', 'EVSE-CTL-SIG10', acMeter, 'comm', controller, 'comm', 'SIGNAL_COMM', '交流计量 RS485');
    addSignal('SIG-COM-04', 'EVSE-CTL-SIG11', controller, 'comm', gateway, 'comm', 'SIGNAL_COMM', std.physicalLayer === 'PLC' ? 'SECC 内部以太网' : '计费报文');
    addSignal('SIG-COM-05', 'EVSE-CTL-SIG12', gateway, 'comm', router, 'comm', 'SIGNAL_COMM', std.backend);

    /* ---------- 充电枪回路 ---------- */
    const gunEquipment = [];
    guns.forEach((gun, index) => {
      const n = index + 1;
      const fuse = addEquipment({ id: 'EQ-G' + n + '-FU', ref: 'EVSE-G' + n + '-FU' + n, kind: 'dc-fuse', name: '枪' + n + ' 直流快熔', system: 'gun', ratedCurrentA: gun.fuseA });
      const kp = addEquipment({ id: 'EQ-G' + n + '-KP', ref: 'EVSE-G' + n + '-KM' + n + 'P', kind: 'dc-contactor', name: '枪' + n + ' 正极直流接触器', system: 'gun', ratedCurrentA: gun.contactorA });
      const kn = addEquipment({ id: 'EQ-G' + n + '-KN', ref: 'EVSE-G' + n + '-KM' + n + 'N', kind: 'dc-contactor', name: '枪' + n + ' 负极直流接触器', system: 'gun', ratedCurrentA: gun.contactorA });
      const lock = addEquipment({ id: 'EQ-G' + n + '-LOCK', ref: 'EVSE-G' + n + '-YV' + n, kind: 'connector-lock', name: '枪' + n + ' 电子锁及锁反馈', system: 'gun', spec: gun.lockText });
      const connector = addEquipment({
        id: 'EQ-G' + n, ref: 'EVSE-G' + n + '-XS' + n, kind: 'charge-connector',
        name: gun.name, system: 'gun', ratedCurrentA: gun.currentA, pins: gun.pins,
        cable: gun.cableText, voltageRange: gun.voltageRangeText
      });
      addPower('CCT-G' + n + '-01', 'EVSE-G' + n + '-CCT01', dcBus, 'out', fuse, 'in', 'POWER_DC', dcV, { service: '枪' + n + ' 直流馈出' });
      addPower('CCT-G' + n + '-02', 'EVSE-G' + n + '-CCT02', fuse, 'out', kp, 'in', 'POWER_DC', dcV);
      addPower('CCT-G' + n + '-03', 'EVSE-G' + n + '-CCT03', kp, 'out', connector, 'dc', 'POWER_DC', dcV, { pole: 'DC+' });
      addPower('CCT-G' + n + '-04', 'EVSE-G' + n + '-CCT04', dcBus, 'out', kn, 'in', 'POWER_DC', dcV, { pole: 'DC-' });
      addPower('CCT-G' + n + '-05', 'EVSE-G' + n + '-CCT05', kn, 'out', connector, 'dc', 'POWER_DC', dcV, { pole: 'DC-' });
      addPower('CCT-G' + n + '-06', 'EVSE-G' + n + '-CCT06', peBar, 'out', connector, 'earth', 'PROTECTIVE_EARTH', 0, { service: '枪' + n + ' PE' });
      addPower('CCT-G' + n + '-07', 'EVSE-G' + n + '-CCT07', auxBus, 'out', lock, 'power', 'POWER_DC_AUX', 12);
      addSignal('SIG-G' + n + '-01', 'EVSE-G' + n + '-SIG01', controller, 'control', kp, 'coil', 'SIGNAL_CTRL', '正极接触器控制');
      addSignal('SIG-G' + n + '-02', 'EVSE-G' + n + '-SIG02', controller, 'control', kn, 'coil', 'SIGNAL_CTRL', '负极接触器控制');
      addSignal('SIG-G' + n + '-03', 'EVSE-G' + n + '-SIG03', controller, 'control', lock, 'control', 'SIGNAL_CTRL', '电子锁驱动与锁到位反馈');
      addSignal('SIG-G' + n + '-04', 'EVSE-G' + n + '-SIG04', controller, 'control', connector, 'control', 'SIGNAL_CTRL', gun.controlSignalText);
      addSignal('SIG-G' + n + '-05', 'EVSE-G' + n + '-SIG05', (std.physicalLayer === 'PLC' ? gateway : controller), 'comm', connector, 'comm', 'SIGNAL_COMM', gun.commSignalText);
      gunEquipment.push({ index: n, connector, fuse, contactorPositive: kp, contactorNegative: kn, lock });
    });

    /* ---------- 储能系统 ---------- */
    const essObjects = [];
    if (ess.enabled) {
      const essBus = addEquipment({ id: 'EQ-ESS-BUS', ref: 'EVSE-ESS-WB3', kind: 'ess-busbar', name: '储能直流母线', system: 'ess', voltageV: ess.busVoltageV });
      essObjects.push(essBus);
      const bms = addEquipment({ id: 'EQ-ESS-BAMS', ref: 'EVSE-ESS-A5', kind: 'bms-controller', name: '电池管理主控 BAMS', system: 'ess', spec: ess.bmsText });
      essObjects.push(bms);
      addPower('CCT-ESS-AUX', 'EVSE-ESS-CCT00', auxBus, 'out', bms, 'power', 'POWER_DC_AUX', 24);
      addSignal('SIG-ESS-00', 'EVSE-ESS-SIG00', bms, 'comm', controller, 'comm', 'SIGNAL_COMM', '储能状态/功率指令 CAN');

      for (let i = 1; i <= ess.clusterCount; i += 1) {
        const cluster = addEquipment({
          id: 'EQ-ESS-B' + i, ref: 'EVSE-ESS-GB' + i, kind: 'battery-cluster',
          name: '电池簇 ' + i, system: 'ess', capacityKwh: ess.clusterKwh,
          voltageV: ess.busVoltageV, configuration: ess.clusterConfig
        });
        const protect = addEquipment({
          id: 'EQ-ESS-P' + i, ref: 'EVSE-ESS-QP' + i, kind: 'battery-protection',
          name: '簇 ' + i + ' 熔断/主接触器/预充单元', system: 'ess',
          spec: ess.clusterProtectText, ratedCurrentA: ess.clusterCurrentA
        });
        essObjects.push(cluster, protect);
        addPower('CCT-ESS-' + i + '-01', 'EVSE-ESS-CCT' + i + '1', cluster, 'dc', protect, 'in', 'POWER_DC_ESS', ess.busVoltageV);
        addPower('CCT-ESS-' + i + '-02', 'EVSE-ESS-CCT' + i + '2', protect, 'out', essBus, 'in', 'POWER_DC_ESS', ess.busVoltageV);
        addSignal('SIG-ESS-' + i + '-01', 'EVSE-ESS-SIG' + i + '1', cluster, 'bms', bms, 'comm', 'SIGNAL_COMM', '簇级 BCU 内部 CAN');
        addSignal('SIG-ESS-' + i + '-02', 'EVSE-ESS-SIG' + i + '2', bms, 'ctrl', protect, 'coil', 'SIGNAL_CTRL', '主正/主负/预充时序');
      }

      if (ess.coupling === 'dc') {
        const dcdc = addEquipment({
          id: 'EQ-ESS-DCDC', ref: 'EVSE-ESS-M2', kind: 'ess-dcdc', name: '储能双向 DC/DC 变换器',
          system: 'ess', quantity: ess.converterCount, unitKw: ess.converterUnitKw, installedKw: ess.converterInstalledKw
        });
        essObjects.push(dcdc);
        addPower('CCT-ESS-CV1', 'EVSE-ESS-CCT90', essBus, 'out', dcdc, 'ess', 'POWER_DC_ESS', ess.busVoltageV);
        addPower('CCT-ESS-CV2', 'EVSE-ESS-CCT91', dcdc, 'dc', dcBus, 'in', 'POWER_DC', dcV, { service: '储能并入充电直流母线' });
        addSignal('SIG-ESS-CV', 'EVSE-ESS-SIG90', controller, 'comm', dcdc, 'ctrl', 'SIGNAL_COMM', '功率指令 CAN');
      } else {
        const pcs = addEquipment({
          id: 'EQ-ESS-PCS', ref: 'EVSE-ESS-M3', kind: 'ess-pcs', name: '储能双向变流器 PCS',
          system: 'ess', quantity: ess.converterCount, unitKw: ess.converterUnitKw, installedKw: ess.converterInstalledKw
        });
        essObjects.push(pcs);
        addPower('CCT-ESS-CV1', 'EVSE-ESS-CCT90', essBus, 'out', pcs, 'ess', 'POWER_DC_ESS', ess.busVoltageV);
        addPower('CCT-ESS-CV2', 'EVSE-ESS-CCT91', pcs, 'ac', acBus, 'in', 'POWER_AC', acV, { service: '储能并入交流母排' });
        addSignal('SIG-ESS-CV', 'EVSE-ESS-SIG90', controller, 'comm', pcs, 'ctrl', 'SIGNAL_COMM', '并离网/功率指令');
      }
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      project: {
        id: projectId, name: p.pileName || '充电桩', site: p.site || '',
        status: 'CONCEPT_DRAFT', referenceDesignation: docControl.projectReference
      },
      documentControl: docControl,
      requirements: {
        standard: std.id, standardName: std.name, connector: std.connector, protocol: std.protocol,
        archetype: p.archetype, outputKw: dc.ratedKw, gunCount: guns.length,
        gunCurrentA: p.gunCurrentA, essEnabled: !!ess.enabled, essKwh: ess.enabled ? ess.usableKwh : 0,
        specialRequirements: p.specialRequirements || []
      },
      assumptions: spec.assumptions || [],
      equipment,
      circuits,
      topology: {
        acChain: [incomer, isolator, breaker, rcm, acMeter, acContactor, acBus],
        dcChain: [modules, dcFuse, dcSensor, dcMeter, dcBus],
        gunBranches: gunEquipment,
        essObjects,
        earthBar: peBar,
        controlObjects: [controller, gateway, router, hmi, estop, door, thermal]
      },
      ess: { enabled: !!ess.enabled, coupling: ess.coupling || null, objectIds: essObjects },
      domainConverters: DOMAIN_CONVERTERS.slice(),
      provenance: {
        engine: 'EVSE_ENGINE',
        engineVersion: spec.engineVersion || (window.EVSE_ENGINE && window.EVSE_ENGINE.ENGINE_VERSION) || 'UNSPECIFIED',
        /* 生成时间戳属于导出文档包，不属于确定性工程模型本身。 */
        generatedAt: spec.generatedAt || null,
        calculationStatus: 'CONCEPTUAL—PROFESSIONAL_REVIEW_REQUIRED'
      }
    };
  }

  window.EVSE_DESIGN = { SCHEMA_VERSION, DOCUMENT_STATUS, CAD_LAYER_MANIFEST, DRAWING_REGISTER, DOMAIN_CONVERTERS, PORT_TEMPLATES, create };
})();
