/* ============================================================
 * EVSE Engineering Design Model (EDEM) v4
 * ------------------------------------------------------------
 * Single electrical source of truth.  The model distinguishes functional
 * ports from physical terminals and stores every conductor as an explicit
 * net.  Renderers may consume this model; they may never recreate topology.
 * ============================================================ */
window.EVSE_DESIGN = (function () {
  'use strict';

  const SCHEMA_VERSION = '4.1.0';
  const DOCUMENT_STATUS = 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED';
  const IMPLEMENTED_STANDARDS = Object.freeze(['gb', 'eu', 'us', 'nacs', 'chademo']);
  const IMPLEMENTED_ARCHETYPES = Object.freeze(['dc-integrated', 'dc-split', 'ac-dc-combo', 'ess-mobile']);

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

  const DOMAIN_CONVERTERS = Object.freeze([
    'power-module-array', 'ess-dcdc', 'ess-pcs', 'aux-psu',
    'dc-dc-charge-module', 'hv-aux-converter', 'aux-dc-converter', 'interface-12v-supply', 'ac-ev-transformer'
  ]);

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
      .replace(/_(V(?:5|12|24)|V(?:5|12|24)_0V)$/, '')
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
      { key: 'ev-schematic', drawingNo: 'EVSE-CONCEPT-101', title: '充电桩端子级电气原理图', discipline: 'ELECTRICAL', sheet: 'AUTO', orientation: 'LANDSCAPE', scale: 'NTS' }
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
        output: ['SVG_AUTO_FORMAT_PREVIEW', 'DXF_R2010_CONCEPT']
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
      seriesJunction: net.seriesJunction === true,
      seriesJunctionType: net.seriesJunctionType,
      seriesJunctionId: net.seriesJunctionId,
      nominalPotentialV: net.nominalPotentialV,
      potentialStatus: net.potentialStatus,
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

  function addCoil(builder, controllerId, deviceId, label, auxList, coilVoltageV) {
    const voltage = Number(coilVoltageV) || 24;
    auxList.positive.push(endpoint(deviceId, 'COIL_V' + voltage));
    const driverId = 'DO_' + label.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    builder.ensureTerminal(controllerId, driverId, {
      netClass: 'POWER_DC_AUX', domain: 'AUX_' + voltage + 'V', voltageV: 0, referenceVoltageV: voltage,
      polarity: 'RETURN', direction: 'out', required: true, electricalType: 'open-collector-output'
    });
    builder.wire(label + ' 线圈受控回路', endpoint(controllerId, driverId), endpoint(deviceId, 'COIL_V' + voltage + '_0V'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_' + voltage + 'V', nominalVoltageV: 0, referenceVoltageV: voltage, polarity: 'RETURN'
    });
  }

  function outputControlContract(profileId, cpCapable, interfaceRole, evidenceRefs) {
    const library = window.EVSE_FUNCTIONAL_UNIT_LIBRARY;
    if (!library || typeof library.controlContract !== 'function') {
      throw new Error('EVSE_FUNCTIONAL_UNIT_LIBRARY 未加载，不能建立输出控制功能合同。');
    }
    return library.controlContract({
      profileId,
      cpCapable: cpCapable === true,
      interfaceRole: interfaceRole || 'CHARGING_OUTPUT',
      evidenceRefs: evidenceRefs || []
    });
  }

  function addControlPilotAssembly(builder, options) {
    const o = options || {};
    const connectorTerminal = builder.terminal(endpoint(o.connectorId, 'CP'));
    const cpContext = {
      cpNetClass: connectorTerminal.netClass,
      cpDomain: connectorTerminal.domain,
      cpProtocol: connectorTerminal.protocol,
      cpSignalRole: connectorTerminal.signalRole
    };
    const startNet = builder.nets.length;
    const startCircuit = builder.circuits.length;
    const metadata = {
      protectedConnectorId: o.connectorId,
      branchId: o.branchId,
      implementationLevel: 'CONTROL_BOARD_FUNCTION',
      implementationStatus: 'FUNCTIONAL_REQUIREMENT—BOARD_TOPOLOGY_AND_VALUES_UNRESOLVED',
      candidateKnowledgeRef: 'EVSE_FUNCTIONAL_UNIT_LIBRARY@1.0.0',
      automaticVariantSelectionAllowed: false
    };
    const generator = o.add(o.idPrefix + '-CP-GEN', 'CPG' + o.tagSuffix,
      'control-pilot-generator', '接口 ' + o.displayName + ' CP 信号发生', 'safety-diagnostic', cpContext,
      Object.assign({}, metadata, { functionalUnitIds: ['cp_gen'], variantRef: null }));
    const monitor = o.add(o.idPrefix + '-CP-MON', 'CPM' + o.tagSuffix,
      'control-pilot-monitor', '接口 ' + o.displayName + ' CP 高阻采样', 'safety-diagnostic', cpContext,
      Object.assign({}, metadata, { functionalUnitIds: ['cp_det'], variantRef: null }));
    const diode = o.add(o.idPrefix + '-DIODE', 'DIO' + o.tagSuffix,
      'vehicle-diode-detector', '接口 ' + o.displayName + ' 车辆二极管检测', 'safety-diagnostic', cpContext,
      Object.assign({}, metadata, { functionalUnitIds: ['diode_det'], variantRef: null }));
    [generator, monitor, diode].forEach((instanceId) => addAuxTarget(o.aux24, instanceId, 'PWR_V24', 'PWR_V24_0V'));

    connectFixedToDynamic(builder, o.displayName + ' CP PWM 命令', endpoint(generator, 'PWM_CMD'),
      o.controllerId, o.controlPrefix + '_CP_PWM_CMD', 'out');
    connectFixedToDynamic(builder, o.displayName + ' CP 采样值', endpoint(monitor, 'CP_VALUE'),
      o.controllerId, o.controlPrefix + '_CP_VALUE', 'in');
    connectFixedToDynamic(builder, o.displayName + ' 车辆二极管结果', endpoint(diode, 'DIODE_OK'),
      o.controllerId, o.controlPrefix + '_DIODE_OK', 'in');

    const members = [
      endpoint(generator, 'CP_OUT'), endpoint(o.connectorId, 'CP'),
      endpoint(monitor, 'CP_SENSE'), endpoint(diode, 'CP_SENSE')
    ];
    const edges = [
      [endpoint(generator, 'CP_OUT'), endpoint(o.connectorId, 'CP'), { functionalRole: 'CONTROL_PILOT_DRIVE' }],
      [endpoint(o.connectorId, 'CP'), endpoint(monitor, 'CP_SENSE'), { functionalRole: 'HIGH_IMPEDANCE_CP_MEASUREMENT' }],
      [endpoint(o.connectorId, 'CP'), endpoint(diode, 'CP_SENSE'), { functionalRole: 'VEHICLE_DIODE_MEASUREMENT' }]
    ];
    let physicalTransceiverTerminal = null;
    if (connectorTerminal.netClass === 'SIGNAL_COMM') {
      physicalTransceiverTerminal = o.controlPrefix + '_CP_PHYSICAL';
      builder.ensureTerminal(o.controllerId, physicalTransceiverTerminal, Object.assign({}, connectorTerminal, {
        id: physicalTransceiverTerminal, label: physicalTransceiverTerminal,
        direction: 'bidirectional', required: true, multiplicity: 'one'
      }));
      members.push(endpoint(o.controllerId, physicalTransceiverTerminal));
      edges.push([endpoint(o.connectorId, 'CP'), endpoint(o.controllerId, physicalTransceiverTerminal), {
        functionalRole: 'CP_PLC_PHYSICAL_LAYER'
      }]);
    }
    const cpNet = builder.addNode(o.displayName + ' 物理 CP 导体', semanticsForTerminal(connectorTerminal), members, edges);
    return {
      id: 'FU-' + o.branchId + '-CONTROL-PILOT',
      type: 'CONTROL_PILOT_INTERFACE',
      branchId: o.branchId,
      protectedConnectorId: o.connectorId,
      controllerId: o.controllerId,
      functions: ['CP_GENERATION', 'CP_MONITORING', 'VEHICLE_DIODE_CHECK'],
      instanceIds: [generator, monitor, diode],
      netIds: builder.nets.slice(startNet).map((net) => net.id),
      circuitIds: builder.circuits.slice(startCircuit).map((circuit) => circuit.id),
      physicalCpNetId: cpNet.id,
      physicalTransceiverTerminal,
      lifecycle: 'APPROVED',
      implementationStatus: 'FUNCTIONAL_REQUIREMENT—BOARD_TOPOLOGY_AND_VALUES_UNRESOLVED',
      variantRefs: { cp_gen: null, cp_det: null, diode_det: null },
      stateApplicability: ['ALL_OPEN', 'PRECHECK', 'READY', 'ENERGIZED'],
      failureAction: 'INHIBIT_ENERGY_TRANSFER'
    };
  }

  function addOutputDiagnosticAssembly(builder, options) {
    const o = options || {};
    const metadata = {
      protectedConnectorId: o.connectorId,
      branchId: o.branchId,
      safeIsolationDeviceIds: o.safeIsolationDeviceIds.slice(),
      implementationLevel: 'SAFETY_DIAGNOSTIC_FUNCTION',
      implementationStatus: 'FUNCTIONAL_REQUIREMENT—BOARD_TOPOLOGY_THRESHOLDS_AND_TIMING_UNRESOLVED',
      candidateKnowledgeRef: 'EVSE_FUNCTIONAL_UNIT_LIBRARY@1.0.0',
      automaticVariantSelectionAllowed: false,
      failureAction: 'INHIBIT_ENERGY_TRANSFER'
    };
    const precheck = o.add(o.idPrefix + '-PRECHECK', 'SC' + o.tagSuffix,
      'output-precheck-monitor', o.displayName + ' 送电前输出预检', 'safety-diagnostic', o.powerContext,
      Object.assign({}, metadata, {
        functionalUnitIds: ['sc_det'], variantRef: null,
        defaultState: 'TEST_PATH_ISOLATED', evaluationState: 'MAIN_CONTACTORS_OPEN',
        requiredSequence: ['MAIN_CONTACTORS_OPEN', 'ENABLE_TEST_PATH', 'EVALUATE_RESULT', 'DISABLE_AND_ISOLATE_TEST_PATH']
      }));
    const stateMonitor = o.add(o.idPrefix + '-WELD-MON', 'AD' + o.tagSuffix,
      'contactor-state-monitor', o.displayName + ' 接触器逐极状态/粘连监测', 'safety-diagnostic', o.powerContext,
      Object.assign({}, metadata, {
        functionalUnitIds: ['adh_det'], variantRef: null,
        evaluationState: 'CONTACTORS_COMMAND_OPEN', monitoredPoles: o.monitoredPoles.map(clone)
      }));
    [precheck, stateMonitor].forEach((instanceId) => addAuxTarget(o.aux24, instanceId, 'PWR_V24', 'PWR_V24_0V'));
    connectFixedToDynamic(builder, o.displayName + ' 输出预检使能', endpoint(precheck, 'TEST_ENABLE'),
      o.controllerId, o.controlPrefix + '_PRECHECK_ENABLE', 'out');
    connectFixedToDynamic(builder, o.displayName + ' 输出预检结果', endpoint(precheck, 'TEST_RESULT'),
      o.controllerId, o.controlPrefix + '_PRECHECK_RESULT', 'in');
    connectFixedToDynamic(builder, o.displayName + ' 粘连监测结果', endpoint(stateMonitor, 'WELD_STATUS'),
      o.controllerId, o.controlPrefix + '_WELD_STATUS', 'in');
    return {
      id: 'FU-' + o.branchId + '-OUTPUT-DIAGNOSTICS',
      type: 'OUTPUT_SAFETY_DIAGNOSTICS',
      branchId: o.branchId,
      protectedConnectorId: o.connectorId,
      controllerId: o.controllerId,
      safeIsolationDeviceIds: o.safeIsolationDeviceIds.slice(),
      monitoredPoles: o.monitoredPoles.map(clone),
      functions: ['OUTPUT_PREENERGIZATION_CHECK', 'CONTACTOR_STATE_MONITORING'],
      instanceIds: [precheck, stateMonitor],
      precheckInstanceId: precheck,
      stateMonitorInstanceId: stateMonitor,
      lifecycle: 'APPROVED',
      implementationStatus: 'FUNCTIONAL_REQUIREMENT—BOARD_TOPOLOGY_THRESHOLDS_AND_TIMING_UNRESOLVED',
      variantRefs: { sc_det: null, adh_det: null },
      defaultState: 'TEST_PATH_ISOLATED',
      precheckEvaluationState: 'MAIN_CONTACTORS_OPEN',
      weldEvaluationState: 'CONTACTORS_COMMAND_OPEN',
      failureAction: 'INHIBIT_ENERGY_TRANSFER'
    };
  }

  function finishOutputDiagnosticAssembly(builder, assembly, monitoredOutputEndpoints) {
    const ownedInstanceIds = new Set([assembly.precheckInstanceId, assembly.stateMonitorInstanceId]);
    const out = Object.assign({}, assembly, {
      monitoredOutputEndpoints: monitoredOutputEndpoints.map(clone),
      netIds: builder.nets.filter((net) => net.members.some((member) => ownedInstanceIds.has(member.instanceId))).map((net) => net.id),
      circuitIds: builder.circuits.filter((circuit) => ownedInstanceIds.has(circuit.from) || ownedInstanceIds.has(circuit.to)).map((circuit) => circuit.id)
    });
    return out;
  }

  function safetyStateMachine(branchContracts) {
    const branches = (branchContracts || []).map((branch) => ({
      branchId: branch.branchId,
      connectorId: branch.connectorId,
      safeIsolationDeviceIds: branch.safeIsolationDeviceIds.slice(),
      controlPilotRequired: branch.controlPilotRequired === true,
      outputDiagnosticFunctionalUnitId: branch.outputDiagnosticFunctionalUnitId,
      controlPilotFunctionalUnitId: branch.controlPilotFunctionalUnitId || null
    }));
    const isolationDevices = Array.from(new Set(branches.flatMap((branch) => branch.safeIsolationDeviceIds))).sort();
    return {
      schema: 'EVSE-SAFETY-STATE/1.0',
      status: 'FUNCTIONAL_SEQUENCE_ONLY—PROJECT_THRESHOLDS_TIMING_AND_CERTIFICATION_REQUIRED',
      defaultState: 'ALL_OPEN',
      faultState: 'FAULT_ALL_OPEN',
      states: [
        { id: 'ALL_OPEN', contactorCommand: 'OPEN', activeFunctions: [] },
        { id: 'PRECHECK', contactorCommand: 'OPEN', activeFunctions: ['OUTPUT_PREENERGIZATION_CHECK'] },
        { id: 'READY', contactorCommand: 'OPEN', activeFunctions: ['CONTACTOR_STATE_MONITORING'] },
        { id: 'ENERGIZED', contactorCommand: 'CLOSED', activeFunctions: ['CONTROL_PILOT_MONITORING'] },
        { id: 'FAULT_ALL_OPEN', contactorCommand: 'OPEN', activeFunctions: ['CONTACTOR_STATE_MONITORING'] }
      ],
      transitions: [
        { id: 'T-OPEN-TO-PRECHECK', from: 'ALL_OPEN', to: 'PRECHECK',
          guards: [{ type: 'OUTPUT_DEENERGIZED', expected: true }],
          actions: [{ type: 'ENABLE_OUTPUT_PRECHECK' }] },
        { id: 'T-PRECHECK-TO-READY', from: 'PRECHECK', to: 'READY',
          guards: [{ type: 'ALL_APPLICABLE_PRECHECKS_PASS', expected: true }, { type: 'TEST_PATH_ISOLATED', expected: true }],
          actions: [{ type: 'DISABLE_OUTPUT_PRECHECK' }] },
        { id: 'T-READY-TO-ENERGIZED', from: 'READY', to: 'ENERGIZED',
          guards: [{ type: 'CONTACTOR_OPEN_FEEDBACK_VALID', expected: true }, { type: 'INTERFACE_PERMISSION_VALID', expected: true }],
          actions: isolationDevices.map((deviceId) => ({ type: 'COMMAND_CONTACTOR_CLOSED', deviceId })) },
        { id: 'T-ENERGIZED-TO-OPEN', from: 'ENERGIZED', to: 'ALL_OPEN', guards: [],
          actions: isolationDevices.map((deviceId) => ({ type: 'COMMAND_CONTACTOR_OPEN', deviceId })) },
        { id: 'T-ANY-TO-FAULT', from: '*', to: 'FAULT_ALL_OPEN',
          guards: [{ type: 'SAFETY_FAULT', expected: true }],
          actions: isolationDevices.map((deviceId) => ({ type: 'COMMAND_CONTACTOR_OPEN', deviceId })) }
      ],
      branches,
      projectSettings: [
        { id: 'OUTPUT_PRECHECK_THRESHOLD', value: null, unit: 'PROJECT_DEFINED', status: 'PROJECT_VALUE_REQUIRED', sourceRef: null, calculationRef: null },
        { id: 'OUTPUT_PRECHECK_TIMEOUT', value: null, unit: 'ms', status: 'PROJECT_VALUE_REQUIRED', sourceRef: null, calculationRef: null },
        { id: 'CONTACTOR_WELD_THRESHOLD', value: null, unit: 'V', status: 'PROJECT_VALUE_REQUIRED', sourceRef: null, calculationRef: null }
      ],
      unresolvedValuesArePass: false,
      executionAllowed: false
    };
  }

  function ensureSignal(builder, instanceId, terminalId, options) {
    return builder.ensureTerminal(instanceId, terminalId, Object.assign({
      netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'bidirectional',
      required: true, multiplicity: 'one', electricalType: 'signal'
    }, options || {}));
  }

  function wireSplitSignal(builder, name, from, to, protocol, signalRole, extra) {
    const semantics = {
      netClass: protocol === 'HARDWIRED_INTERLOCK' ? 'SIGNAL_CTRL' : 'SIGNAL_COMM',
      domain: protocol === 'HARDWIRED_INTERLOCK' ? 'CONTROL' : 'COMMUNICATION',
      protocol, signalRole
    };
    return builder.wire(name, from, to, Object.assign({}, semantics, extra || {}), extra || {});
  }

  /* The mobile ESS topology is compiled from the 0823 project drawing as an
   * independent template.  Its interface pins still come from the selected
   * controlled standard; the misleading "国标" filename is never used to
   * choose a connector. */
  function createEssMobile(spec, catalog) {
    const p = spec.params || {};
    const std = spec.standard || {};
    const ac = spec.ac || {};
    const dc = spec.dc || {};
    const guns = Array.isArray(spec.guns) && spec.guns.length ? spec.guns : [{ index: 1, currentA: p.gunCurrentA || 250 }];
    const sourceEss = spec.ess || {};
    const aux = spec.aux || {};
    const ess = Object.assign({ enabled: true, busVoltageV: 750, usableKwh: Number(p.essKwh) || 100 }, sourceEss, { enabled: true });
    const essVoltage = Number(ess.busVoltageV) || 750;
    const chargeVoltage = Number(dc.busVoltageV || dc.outputVmax) || 1000;
    const projectId = 'PRJ-' + idPart(p.pileName);
    const docControl = documentControl(projectId, std.connector, true);
    const builder = new Builder(catalog);
    const aux24 = { positive: [], return: [] };
    const aux12 = { positive: [], return: [] };
    const aux5 = { positive: [], return: [] };
    const peTargets = [];
    const mobileObjects = [];
    const moduleIds = [];
    const gunEquipment = [];
    const functionalUnits = [];
    const safetyBranches = [];
    const add = (id, tag, kind, name, system, context, extra) => builder.addInstance(Object.assign({
      id, tag, ref: 'EVSE-' + String(system || 'SYS').toUpperCase() + '-' + tag,
      referenceDesignation: 'EVSE-' + String(system || 'SYS').toUpperCase() + '-' + tag,
      kind, name, system
    }, extra || {}), context || {});
    const essPos = { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE', ratedVoltageV: essVoltage };
    const essNeg = { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE', ratedVoltageV: essVoltage };
    const essIntermediateUpper = {
      netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'INTERMEDIATE', ratedVoltageV: essVoltage,
      seriesJunction: true, seriesJunctionType: 'BATTERY_BOX_STRING', seriesJunctionId: 'GB1_NEG__GB2_POS',
      nominalPotentialV: null, potentialStatus: 'UNRESOLVED_BOX_VOLTAGES'
    };
    const essIntermediateLower = {
      netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'INTERMEDIATE', ratedVoltageV: essVoltage,
      seriesJunction: true, seriesJunctionType: 'BATTERY_BOX_STRING', seriesJunctionId: 'GB2_NEG__GB3_POS',
      nominalPotentialV: null, potentialStatus: 'UNRESOLVED_BOX_VOLTAGES'
    };
    const heatIntermediateUpper = {
      netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'INTERMEDIATE', ratedVoltageV: essVoltage,
      seriesJunction: true, seriesJunctionType: 'BATTERY_HEATER_STRING', seriesJunctionId: 'EH1_LOW__EH2_HIGH',
      nominalPotentialV: null, potentialStatus: 'UNRESOLVED_HEATER_VOLTAGE_DIVISION'
    };
    const heatIntermediateLower = {
      netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'INTERMEDIATE', ratedVoltageV: essVoltage,
      seriesJunction: true, seriesJunctionType: 'BATTERY_HEATER_STRING', seriesJunctionId: 'EH2_LOW__EH3_HIGH',
      nominalPotentialV: null, potentialStatus: 'UNRESOLVED_HEATER_VOLTAGE_DIVISION'
    };
    const chargePos = { netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE', ratedVoltageV: chargeVoltage };
    const chargeNeg = { netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'NEGATIVE', ratedVoltageV: chargeVoltage };
    const evidenceRating = (ratedCurrentA, ratingStatus, ratingSource) => {
      const hasNumericRating = ratedCurrentA !== null && ratedCurrentA !== undefined && ratedCurrentA !== '' && Number.isFinite(Number(ratedCurrentA));
      return {
        ratedCurrentA: hasNumericRating ? Number(ratedCurrentA) : null,
        ratingStatus,
        ratingSource,
        calculationSource: ratingStatus === 'CALCULATED' ? ratingSource : null,
        ratingBasis: ratingStatus === 'UNKNOWN' ? 'DRAWING_RATING_NOT_LEGIBLE' : ratingSource,
        ratingReview: ratingStatus === 'CALCULATED' ? 'PROTECTION_COORDINATION_REQUIRED' : 'PROJECT_CONFIRMATION_REQUIRED'
      };
    };
    const contactorRating = (ratedCurrentA, ratingStatus) => Object.assign({
      coilVoltageV: 24,
      coilVoltageStatus: 'OBSERVED_0823_DRAWING_LABEL'
    }, evidenceRating(ratedCurrentA, ratingStatus, '0823_SVG_CONTACTOR_LABEL'));

    /* ---------- 0823 battery string, K1/K2/K3 and fused junction ---------- */
    const peBar = add('EQ-MOB-PE', 'PE', 'earth-bar', '移动储充系统保护接地排', 'earth');
    const battery1 = add('EQ-MOB-BAT1', 'GB1', 'battery-box', '串联电池箱 GB1（上箱）', 'ess', { position: 'top' }, {
      stringIndex: 1, seriesBoxCount: 3, boxCapacityKwh: null, boxVoltageV: null,
      stringRequirementVoltageV: essVoltage, boxRatingStatus: 'UNRESOLVED—BATTERY_VENDOR_BOM_REQUIRED'
    });
    const battery2 = add('EQ-MOB-BAT2', 'GB2', 'battery-box', '串联电池箱 GB2（中箱）', 'ess', { position: 'middle' }, {
      stringIndex: 2, seriesBoxCount: 3, boxCapacityKwh: null, boxVoltageV: null,
      stringRequirementVoltageV: essVoltage, boxRatingStatus: 'UNRESOLVED—BATTERY_VENDOR_BOM_REQUIRED'
    });
    const battery3 = add('EQ-MOB-BAT3', 'GB3', 'battery-box', '串联电池箱 GB3（下箱）', 'ess', { position: 'bottom' }, {
      stringIndex: 3, seriesBoxCount: 3, boxCapacityKwh: null, boxVoltageV: null,
      stringRequirementVoltageV: essVoltage, boxRatingStatus: 'UNRESOLVED—BATTERY_VENDOR_BOM_REQUIRED'
    });
    const batteryBoxes = [battery1, battery2, battery3];
    const fu1RatedA = Number(ess.clusterFuseA || dc.mainFuseA);
    const fu1 = add('EQ-MOB-FU1', 'FU1', 'ess-fuse', '电池总正快熔 FU1', 'ess', { polarity: 'POSITIVE' },
      evidenceRating(Number.isFinite(fu1RatedA) ? fu1RatedA : null, Number.isFinite(fu1RatedA) ? 'CALCULATED' : 'UNKNOWN',
        Number.isFinite(fu1RatedA) ? 'EV_DC_OUTPUT_SIZING' : '0823_SVG_RATING_UNRESOLVED'));
    const rs2 = add('EQ-MOB-RS2', 'RS2', 'current-transducer', '电池总负电流采样 RS2', 'ess', {
      netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE', protocol: 'ANALOG_OR_DRY'
    });
    const k1 = add('EQ-MOB-K1', 'K1', 'ess-contactor', '总正接触器 K1（200A / 24V线圈）', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' }, contactorRating(200, 'OBSERVED'));
    const k2 = add('EQ-MOB-K2', 'K2', 'ess-contactor', '总负接触器 K2（200A / 24V线圈）', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE' }, contactorRating(200, 'OBSERVED'));
    const k3 = add('EQ-MOB-K3', 'K3', 'precharge-contactor', '预充接触器 K3（50A / 24V线圈）', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' }, contactorRating(50, 'OBSERVED'));
    const rpre = add('EQ-MOB-RPRE', 'RPRE', 'precharge-resistor', '预充电阻 200W-30R', 'ess', {
      netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE'
    }, { resistanceOhm: 30, ratedPowerW: 200, sourceLabel: '200W-30R' });
    const batteryBus = add('EQ-MOB-BAT-BUS', 'WBB', 'ess-busbar', '电池熔断后正节点 / 总负节点', 'ess', {}, { voltageV: essVoltage });
    const essBus = add('EQ-MOB-ESS-BUS', 'WB3', 'ess-busbar', '主放电高压母线', 'ess', {}, { voltageV: essVoltage });
    const k4 = add('EQ-MOB-K4', 'K4', 'dc-contactor', '直流补电正极接触器 K4（200A / 24V线圈）', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' }, contactorRating(200, 'OBSERVED'));
    const k4Negative = std.id === 'nacs' ? add('EQ-MOB-K4N', 'K4N', 'dc-contactor', 'NACS补电负极模式隔离接触器 K4N（200A / 24V线圈）', 'ess', {
      netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE'
    }, Object.assign(contactorRating(200, 'CALCULATED'), {
      ratingSource: 'NACS_SHARED_CONTACT_FAIL_CLOSED_DESIGN',
      modeIsolationRole: 'DC_NEGATIVE_BREAK_BEFORE_MAKE'
    })) : null;
    const k5 = add('EQ-MOB-K5', 'K5', 'dc-contactor', '电池加热接触器 K5（50A / 24V线圈）', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' }, contactorRating(50, 'OBSERVED'));
    const heatFuse = add('EQ-MOB-FUH', 'FUH', 'ess-fuse', '电池加热支路熔断器（额定待确认）', 'ess', { polarity: 'POSITIVE' },
      evidenceRating(null, 'UNKNOWN', '0823_SVG_RATING_UNRESOLVED'));
    const heaterInterface = add('EQ-MOB-XH1', 'XH1', 'heating-connector-2pin', '电池加热两芯接口 H02/H05', 'ess', {}, {
      boundary: 'HEATER_TWO_CORE_INTERFACE', observedPins: ['H02', 'H05'], evidenceStatus: 'OBSERVED'
    });
    const heater1 = add('EQ-MOB-HEATER1', 'EH1', 'battery-heater', '电池箱 GB1 高压加热器', 'ess', { seriesPosition: 'top' });
    const heater2 = add('EQ-MOB-HEATER2', 'EH2', 'battery-heater', '电池箱 GB2 高压加热器', 'ess', { seriesPosition: 'middle' });
    const heater3 = add('EQ-MOB-HEATER3', 'EH3', 'battery-heater', '电池箱 GB3 高压加热器', 'ess', { seriesPosition: 'bottom' });
    const heaters = [heater1, heater2, heater3];
    const k6 = add('EQ-MOB-K6', 'K6', 'dc-contactor', 'PCS 整流回充接触器 K6（200A / 24V线圈）', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' }, contactorRating(200, 'OBSERVED'));

    builder.wire('GB1+→FU1', endpoint(battery1, 'PACK_DC_POS'), endpoint(fu1, 'IN'), essPos);
    builder.wire('GB1−→GB2+', endpoint(battery1, 'SERIES_LOW'), endpoint(battery2, 'SERIES_HIGH'), essIntermediateUpper, {
      seriesJunction: true, seriesJunctionId: essIntermediateUpper.seriesJunctionId, nominalPotentialV: essIntermediateUpper.nominalPotentialV
    });
    builder.wire('GB2−→GB3+', endpoint(battery2, 'SERIES_LOW'), endpoint(battery3, 'SERIES_HIGH'), essIntermediateLower, {
      seriesJunction: true, seriesJunctionId: essIntermediateLower.seriesJunctionId, nominalPotentialV: essIntermediateLower.nominalPotentialV
    });
    builder.wire('GB3−→RS2', endpoint(battery3, 'PACK_DC_NEG'), endpoint(rs2, 'IN'), essNeg);
    builder.wire('RS2→K2', endpoint(rs2, 'OUT'), endpoint(k2, 'IN'), essNeg);
    builder.addNode('FU1后电池正节点', essPos,
      [endpoint(fu1, 'OUT'), endpoint(batteryBus, 'BUS_DC_POS'), endpoint(k1, 'IN'), endpoint(k3, 'IN'), endpoint(k5, 'IN'), endpoint(k6, 'IN')],
      [
        [endpoint(fu1, 'OUT'), endpoint(batteryBus, 'BUS_DC_POS')],
        [endpoint(batteryBus, 'BUS_DC_POS'), endpoint(k1, 'IN')],
        [endpoint(batteryBus, 'BUS_DC_POS'), endpoint(k3, 'IN')],
        [endpoint(batteryBus, 'BUS_DC_POS'), endpoint(k5, 'IN')],
        [endpoint(batteryBus, 'BUS_DC_POS'), endpoint(k6, 'IN')]
      ]);
    builder.wire('K3→30R预充电阻', endpoint(k3, 'OUT'), endpoint(rpre, 'A'), essPos);
    builder.wire('K5→加热熔断器', endpoint(k5, 'OUT'), endpoint(heatFuse, 'IN'), essPos);
    builder.wire('FUH→H02柜侧', endpoint(heatFuse, 'OUT'), endpoint(heaterInterface, 'PANEL_H02'),
      Object.assign({}, essPos, { boundary: 'HEATER_TWO_CORE_INTERFACE', interfaceId: heaterInterface }), { boundary: 'HEATER_TWO_CORE_INTERFACE' });
    builder.wire('H02电池侧→EH1+', endpoint(heaterInterface, 'BATTERY_H02'), endpoint(heater1, 'HEAT_HIGH'),
      Object.assign({}, essPos, { boundary: 'HEATER_TWO_CORE_INTERFACE', interfaceId: heaterInterface }), { boundary: 'HEATER_TWO_CORE_INTERFACE' });
    builder.wire('EH1−→EH2+', endpoint(heater1, 'HEAT_LOW'), endpoint(heater2, 'HEAT_HIGH'), heatIntermediateUpper, {
      seriesJunction: true, seriesJunctionType: heatIntermediateUpper.seriesJunctionType,
      seriesJunctionId: heatIntermediateUpper.seriesJunctionId, nominalPotentialV: null
    });
    builder.wire('EH2−→EH3+', endpoint(heater2, 'HEAT_LOW'), endpoint(heater3, 'HEAT_HIGH'), heatIntermediateLower, {
      seriesJunction: true, seriesJunctionType: heatIntermediateLower.seriesJunctionType,
      seriesJunctionId: heatIntermediateLower.seriesJunctionId, nominalPotentialV: null
    });

    /* ---------- selected-standard AC/DC replenishment assembly and PCS ---------- */
    const sharedAcDcAssembly = ['eu', 'us', 'nacs'].includes(std.id);
    const dcAssemblyId = sharedAcDcAssembly ? 'MOB-COMBO-INLET' : 'MOB-DC-INLET';
    const acAssemblyId = sharedAcDcAssembly ? 'MOB-COMBO-INLET' : 'MOB-AC-INLET';
    const assemblyMode = sharedAcDcAssembly ? (std.id === 'nacs' ? 'SHARED_CONTROL_AND_POWER_CONTACTS_MODE_EXCLUSIVE' : 'SHARED_CONTROL_CONTACTS') : 'SEPARATE_PHYSICAL_CONNECTORS';
    const nacsModeStateMatrix = std.id === 'nacs' ? {
      ALL_OPEN: { acPermission: false, dcPositivePermission: false, dcNegativePermission: false },
      AC_ENABLED: { acPermission: true, dcPositivePermission: false, dcNegativePermission: false },
      DC_ENABLED: { acPermission: false, dcPositivePermission: true, dcNegativePermission: true }
    } : null;
    const inletDc = add('EQ-MOB-DC-IN', 'XS-IN-DC', 'dc-charge-inlet', std.name + ' 直流补电座', 'replenishment', {
      connectorType: std.connectorType, protocol: std.protocol, physicalLayer: std.physicalLayer, dcDomain: 'HV_DC_ESS'
    }, { connectorType: std.connectorType, standardId: std.id, interfaceRole: 'REPLENISHMENT_INPUT', physicalAssemblyId: dcAssemblyId, assemblyMode });
    const acOutput = std.acOutput || { connectorType: 'type2-ac', lineVoltage: ac.lineVoltage || 400, conductors: ['L1', 'L2', 'L3', 'N'], controlPins: ['CP', 'PP'] };
    const inletAcContext = {
      voltageV: acOutput.lineVoltage, conductors: acOutput.conductors.slice(),
      controlPins: sharedAcDcAssembly ? [] : acOutput.controlPins.slice(), includePe: !sharedAcDcAssembly,
      acDomain: 'AC_MAINS', powerDirection: 'out'
    };
    const inletAc = add('EQ-MOB-AC-IN', 'XS-IN-AC', 'ac-charge-connector', std.acConnector + ' 交流补电座', 'replenishment', inletAcContext, {
      connectorType: acOutput.connectorType, standardId: std.id, acOutputProfile: clone(acOutput),
      interfaceRole: 'REPLENISHMENT_INPUT', physicalAssemblyId: acAssemblyId, assemblyMode,
      sharedControlOwner: sharedAcDcAssembly ? 'EQ-MOB-DC-IN' : null,
      sharedPowerContacts: std.id === 'nacs' ? { L1: 'DC_POS', L2: 'DC_NEG', mode: 'MUTUALLY_EXCLUSIVE' } : null
    });
    const nacsPhysicalOwner = std.id === 'nacs' ? add('EQ-MOB-NACS-IN', 'XS-IN-NACS', 'nacs-shared-inlet', 'NACS交直流共享物理输入口', 'replenishment', {
      protocol: std.protocol, physicalLayer: std.physicalLayer
    }, {
      physicalAssemblyId: dcAssemblyId, physicalContactOwner: true,
      mutualExclusionGroup: 'NACS_AC_DC_POWER', activeModes: ['AC', 'DC']
    }) : null;
    const nacsPowerSelector = std.id === 'nacs' ? add('EQ-MOB-NACS-SEL', 'QS-NACS', 'ac-dc-power-selector', 'NACS双极交直流模式选择边界', 'replenishment', {}, {
      physicalAssemblyId: dcAssemblyId, defaultMode: 'ALL_OPEN', powerModePolicy: 'BREAK_BEFORE_MAKE_ALL_POLES',
      mutualExclusionGroup: 'NACS_AC_DC_POWER', modeStateMatrix: clone(nacsModeStateMatrix)
    }) : null;
    const acRcm = add('EQ-MOB-RCM1', 'RCM1', 'residual-current-monitor', '补电座漏电检测', 'replenishment', Object.assign({}, inletAcContext, { protocol: 'DRY_CONTACT' }));
    const acSpdPhaseConfiguration = acOutput.conductors.includes('L3') ? '3P+N'
      : (acOutput.conductors.includes('N') ? '1P+N' : '2P');
    const acSpd = add('EQ-MOB-SPD1', 'FV1', 'surge-protector', '补电座 ' + acSpdPhaseConfiguration + ' 浪涌保护', 'replenishment', inletAcContext, {
      actualConductors: acOutput.conductors.slice(), phaseConfiguration: acSpdPhaseConfiguration, ratingStatus: 'PROJECT_COORDINATION_REQUIRED'
    });
    const km1 = add('EQ-MOB-KM1', 'KM1', 'ac-contactor', 'PCS 交流输入接触器 KM1', 'replenishment', inletAcContext);
    const km2 = add('EQ-MOB-KM2', 'KM2', 'control-relay', 'KM2 NCH8-40/11+ZB 控制联锁', 'control', {
      coilRequired: true, coilVoltageV: 24, feedbackRequired: true,
      feedbackSignalRole: 'AC_INTERLOCK:KM2_FEEDBACK', feedbackEvidenceStatus: 'INFERRED_REVIEW_REQUIRED',
      contactNetClass: 'POWER_DC_AUX', contactDomain: 'AUX_24V', contactVoltageV: 24
    }, { controlDestinationStatus: 'INFERRED_REVIEW_REQUIRED', observedDeviceLabel: 'NCH8-40/11+ZB' });
    const acControlRelay = add('EQ-MOB-KA-AC', 'KA-AC', 'control-relay', '独立交流中继（控制对端待确认）', 'control', {
      coilRequired: true, coilVoltageV: 24, feedbackRequired: true,
      feedbackSignalRole: 'AC_INTERLOCK:KA_AC_FEEDBACK', feedbackEvidenceStatus: 'INFERRED_REVIEW_REQUIRED',
      contactNetClass: 'POWER_DC_AUX', contactDomain: 'AUX_24V', contactVoltageV: 24
    }, { controlDestinationStatus: 'INFERRED_REVIEW_REQUIRED', observedDeviceLabel: '交流中继' });
    const pcs = add('EQ-MOB-PCS', 'PCS1', 'ess-pcs', '22kW PCS（反向能力待确认）', 'ess', Object.assign({}, inletAcContext, {
      protocol: 'MODULE_CAN', energyDirection: 'AC_TO_DC_OBSERVED_REVERSE_UNRESOLVED'
    }), {
      installedKw: 22, sourceRating: '22kW', energyDirection: 'UNRESOLVED',
      observedEnergyPath: 'AC_INPUT_TO_ESS_DC_OUTPUT', reverseCapability: 'UNRESOLVED'
    });
    const k9 = add('EQ-MOB-K9', 'K9', 'ess-contactor', 'PCS 回充正接触器 K9（200A / 24V线圈）', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE' }, contactorRating(200, 'OBSERVED'));
    const fu3 = add('EQ-MOB-FU3', 'FU3', 'ess-fuse', 'PCS / 整流回充快熔 FU3（额定待确认）', 'ess', { polarity: 'POSITIVE' },
      evidenceRating(null, 'UNKNOWN', '0823_SVG_RATING_UNRESOLVED'));
    const k10 = add('EQ-MOB-K10', 'K10', 'ess-contactor', 'PCS 回充负接触器 K10（200A / 24V线圈）', 'ess', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE' }, contactorRating(200, 'OBSERVED'));
    const nacsModeInterlock = std.id === 'nacs' ? add('EQ-MOB-NACS-MODE-ILK', 'ILK-NACS', 'ac-dc-mode-interlock', 'NACS 补电 AC/DC 模式硬互锁', 'safety', {}, {
      physicalAssemblyId: dcAssemblyId, modeRelationship: 'MUTUALLY_EXCLUSIVE',
      acPermissionTargets: ['EQ-MOB-KM2:COIL_V24', 'EQ-MOB-KA-AC:COIL_V24'],
      dcPermissionTargets: ['EQ-MOB-K4:COIL_V24', 'EQ-MOB-K4N:COIL_V24'],
      powerModePolicy: 'BREAK_BEFORE_MAKE_ALL_POLES', defaultMode: 'ALL_OPEN',
      modeStateMatrix: clone(nacsModeStateMatrix)
    }) : null;
    if (nacsPhysicalOwner) {
      ['A', 'B'].forEach((pole) => builder.wire('NACS共享功率触点' + pole + '→模式选择COMMON_' + pole,
        endpoint(nacsPhysicalOwner, 'PWR_' + pole), endpoint(nacsPowerSelector, 'COMMON_' + pole), {
          netClass: 'POWER_INTERFACE_MODED', domain: 'INTERFACE_POWER_MODED',
          modeDependent: true, mutualExclusionGroup: 'NACS_AC_DC_POWER', defaultState: 'OPEN'
        }));
      builder.wire('NACS DC+模式throw→K4', endpoint(nacsPowerSelector, 'DC_POS'), endpoint(k4, 'IN'), essPos, { activeMode: 'DC' });
      builder.wire('NACS DC−模式throw→K4N', endpoint(nacsPowerSelector, 'DC_NEG'), endpoint(k4Negative, 'IN'), essNeg, { activeMode: 'DC' });
    } else {
      builder.wire('直流补电座+→K4', endpoint(inletDc, 'DC_POS'), endpoint(k4, 'IN'), essPos);
    }
    builder.wire('PCS DC+→K9', endpoint(pcs, 'ESS_DC_POS'), endpoint(k9, 'IN'), essPos);
    builder.wire('K9→FU3', endpoint(k9, 'OUT'), endpoint(fu3, 'IN'), essPos);
    builder.wire('PCS DC−→K10', endpoint(pcs, 'ESS_DC_NEG'), endpoint(k10, 'IN'), essNeg);
    acOutput.conductors.forEach((phase) => {
      const sem = { netClass: 'POWER_AC', domain: 'AC_MAINS', phase, ratedVoltageV: acOutput.lineVoltage };
      const acSource = nacsPowerSelector ? endpoint(nacsPowerSelector, 'AC_' + phase) : endpoint(inletAc, 'AC_' + phase);
      const acMembers = nacsPowerSelector
        ? [acSource, endpoint(acRcm, 'IN_' + phase), endpoint(acSpd, 'LINE_' + phase)]
        : [endpoint(inletAc, 'AC_' + phase), endpoint(acRcm, 'IN_' + phase), endpoint(acSpd, 'LINE_' + phase)];
      const acEdges = nacsPowerSelector
        ? [[acSource, endpoint(acRcm, 'IN_' + phase), { activeMode: 'AC' }], [acSource, endpoint(acSpd, 'LINE_' + phase), { activeMode: 'AC' }]]
        : [[endpoint(inletAc, 'AC_' + phase), endpoint(acRcm, 'IN_' + phase)], [endpoint(inletAc, 'AC_' + phase), endpoint(acSpd, 'LINE_' + phase)]];
      builder.addNode('补电座 ' + phase + ' 漏电/SPD分支', sem, acMembers, acEdges);
      builder.wire('漏电检测→KM1 ' + phase, endpoint(acRcm, 'OUT_' + phase), endpoint(km1, 'IN_' + phase), sem);
      builder.wire('KM1→PCS ' + phase, endpoint(km1, 'OUT_' + phase), endpoint(pcs, 'AC_' + phase), sem);
    });

    mobileObjects.push(...batteryBoxes, fu1, rs2, k1, k2, k3, rpre, batteryBus, essBus, k4, k5, heatFuse, heaterInterface, ...heaters, k6,
      inletDc, inletAc, acRcm, acSpd, km1, km2, acControlRelay, pcs, k9, fu3, k10);
    if (k4Negative) mobileObjects.push(k4Negative);
    if (nacsModeInterlock) mobileObjects.push(nacsModeInterlock);
    if (nacsPhysicalOwner) mobileObjects.push(nacsPhysicalOwner, nacsPowerSelector);

    /* ---------- battery-fed M1..Mn DC/DC output and real gun branches ---------- */
    const chargeBus = add('EQ-MOB-CHARGE-BUS', 'WB2', 'dc-busbar', 'DC/DC 枪侧直流母线', 'charge', { domain: 'HV_DC_CHARGE' }, { voltageV: chargeVoltage });
    const moduleCount = Math.max(1, Math.min(8, Math.floor(Number(dc.moduleCount) || 1)));
    const moduleKw = Number(dc.moduleKw) || 30;
    const moduleInstalledKw = moduleCount * moduleKw;
    for (let index = 1; index <= moduleCount; index += 1) {
      const moduleId = add('EQ-MOB-M' + index, 'M' + index, 'dc-dc-charge-module', moduleKw + 'kW DC/DC 充电模块 M' + index, 'ess', {}, {
        unitKw: moduleKw, installedKw: moduleKw, moduleIndex: index,
        ratingStatus: 'CALCULATED', ratingSource: 'EV-SIZING-001', calculationSource: 'EV-SIZING-001',
        calculationBasis: moduleCount + ' × ' + moduleKw + 'kW = ' + moduleInstalledKw + 'kW'
      });
      moduleIds.push(moduleId);
      mobileObjects.push(moduleId);
      peTargets.push(endpoint(moduleId, 'PE'));
    }

    const hv24 = add('EQ-MOB-HV24', 'T1', 'hv-aux-converter', '4500W 高压→24V DC/DC', 'aux', {}, { ratedPowerW: 4500 });
    const auxBus = add('EQ-MOB-AUX-BUS', 'WB4', 'aux-busbar', '移动系统 24V/12V 辅助端子排', 'aux');
    const dcdc24to12 = add('EQ-MOB-24V12', 'T2', 'aux-dc-converter', '300W 24V→12V', 'aux', { inputVoltageV: 24, outputVoltageV: 12 }, { ratedPowerW: 300 });
    const dcdc12to5 = add('EQ-MOB-12V5', 'T3', 'aux-dc-converter', '屏幕独立 12V→5V', 'aux', { inputVoltageV: 12, outputVoltageV: 5 }, { purpose: 'HMI_5V_DOMAIN' });
    const bcu = add('EQ-MOB-BCU', 'BCU', 'bms-controller', '电池控制单元 BCU', 'control', {}, {
      observedTerminalLabels: ['CANH', 'CANL', 'BTA1+', 'BTA2+', 'BTA5+', 'BAT1−', 'BAT2−', 'A+', 'CC2'],
      observedTerminalMappingStatus: 'OBSERVED_LABELS_UNMAPPED—DO_NOT_INFER_ELECTRICAL_NODES'
    });
    const bcuObservedTerminals = [
      ['OBS_CANH', 'CANH', 'SIGNAL_COMM', 'COMMUNICATION', 'BMS_CAN_LABEL_UNMAPPED'],
      ['OBS_CANL', 'CANL', 'SIGNAL_COMM', 'COMMUNICATION', 'BMS_CAN_LABEL_UNMAPPED'],
      ['OBS_BTA1_POS', 'BTA1+', 'SIGNAL_CTRL', 'CONTROL', 'ANALOG_MEASUREMENT_UNKNOWN'],
      ['OBS_BTA2_POS', 'BTA2+', 'SIGNAL_CTRL', 'CONTROL', 'ANALOG_MEASUREMENT_UNKNOWN'],
      ['OBS_BTA5_POS', 'BTA5+', 'SIGNAL_CTRL', 'CONTROL', 'ANALOG_MEASUREMENT_UNKNOWN'],
      ['OBS_BAT1_NEG', 'BAT1−', 'SIGNAL_CTRL', 'CONTROL', 'ANALOG_MEASUREMENT_UNKNOWN'],
      ['OBS_BAT2_NEG', 'BAT2−', 'SIGNAL_CTRL', 'CONTROL', 'ANALOG_MEASUREMENT_UNKNOWN'],
      ['OBS_A_POS', 'A+', 'SIGNAL_CTRL', 'CONTROL', 'ANALOG_MEASUREMENT_UNKNOWN'],
      ['OBS_CC2', 'CC2', 'SIGNAL_CTRL', 'CONTROL', 'OBSERVED_SIGNAL_UNKNOWN']
    ].map((item) => {
      builder.ensureTerminal(bcu, item[0], {
        label: item[1], observedLabel: item[1], netClass: item[2], domain: item[3], protocol: item[4],
        signalRole: 'BCU_OBSERVED:' + item[1], direction: 'in', required: false, multiplicity: 'one',
        electricalType: item[2] === 'SIGNAL_COMM' ? 'observed-communication-stub' : 'observed-measurement-stub',
        evidenceStatus: 'OBSERVED_DESTINATION_UNRESOLVED', openCircuitPolicy: 'OBSERVED_DESTINATION_UNRESOLVED'
      });
      return { terminalId: item[0], observedLabel: item[1], evidenceStatus: 'OBSERVED_DESTINATION_UNRESOLVED', connectionStatus: 'OPEN_STUB' };
    });
    const vcu = add('EQ-MOB-VCU', 'VCU', 'charge-controller', '整车控制器 VCU', 'control');
    const evcc = add('EQ-MOB-EVCC', 'EVCC', 'charge-controller', '补电接口 EVCC', 'control');
    const secc = add('EQ-MOB-SECC', 'SECC', 'comm-gateway', std.id === 'chademo' ? 'CHAdeMO 输出协议控制器 SECC' : '输出充电 SECC', 'control', { supplyVoltageV: 24 });
    const ocpp = add('EQ-MOB-OCPP', 'OCPP', 'comm-gateway', 'OCPP 通信控制板', 'control', { supplyVoltageV: 12 });
    const router = add('EQ-MOB-ROUTER', 'R1', 'comm-gateway', '移动通信路由器', 'control', { supplyVoltageV: 12, rfPort: true }, {
      externalDataLinkStatus: 'UNRESOLVED—DO_NOT_INFER_OCPP_LINK'
    });
    const antenna = add('EQ-MOB-ANT', 'ANT1', 'rf-antenna', '三合一天线', 'control', {}, {
      antennaType: 'THREE_IN_ONE', rfProtocol: 'RF_UNKNOWN', evidenceStatus: 'OBSERVED_PHYSICAL_LINK_PROTOCOL_UNRESOLVED'
    });
    const display = add('EQ-MOB-DISPLAY', 'DP1', 'touch-display', '4.3英寸触摸显示屏', 'control', {}, { displaySizeInch: 4.3 });
    const cardReader = add('EQ-MOB-CARD', 'RFID1', 'card-reader', '独立刷卡器', 'control', { supplyVoltageV: 5 });
    const voiceBoard = add('EQ-MOB-VOICE', 'VB1', 'voice-board', '独立语音控制板（串口与屏幕共线）', 'control', { supplyVoltageV: 5, protocol: 'HMI_UART' }, {
      observedRawTerminalLabels: ['V', 'V', 'G', 'G', 'R', 'T'], terminalTStatus: 'OBSERVED_DESTINATION_UNRESOLVED'
    });
    const speaker = add('EQ-MOB-SPK', 'SPK1', 'loudspeaker', '语音扬声器', 'control');
    const lampYellow = add('EQ-MOB-HL-Y', 'HL-Y', 'indicator-lamp', '黄色状态指示灯', 'control', { supplyVoltageV: 12 }, { color: 'YELLOW', voltageEvidenceStatus: 'INFERRED_REVIEW_REQUIRED' });
    const lampGreen = add('EQ-MOB-HL-G', 'HL-G', 'indicator-lamp', '绿色状态指示灯', 'control', { supplyVoltageV: 12 }, { color: 'GREEN', voltageEvidenceStatus: 'INFERRED_REVIEW_REQUIRED' });
    const lampRed = add('EQ-MOB-HL-R', 'HL-R', 'indicator-lamp', '红色状态指示灯', 'control', { supplyVoltageV: 12 }, { color: 'RED', voltageEvidenceStatus: 'INFERRED_REVIEW_REQUIRED' });
    const temperatureSensor = add('EQ-MOB-TEMP', 'TS1', 'temperature-sensor', '电池舱两线温感', 'control', {}, {
      observedFunction: 'PASSIVE_TEMPERATURE_INTENT', fireSuppressionFunction: 'NOT_OBSERVED'
    });
    const fan = add('EQ-MOB-FAN', 'M-FAN', 'thermal-unit', '柜内12V风机', 'aux', { enableRequired: false, supplyVoltageV: 12 }, { spec: aux.thermalText || '风冷', sourceVoltageLabel: '12V+/12V−' });
    const fanRelay = add('EQ-MOB-KA-FAN', 'KA2-8', 'control-relay', '风机驱动中继 KA2-8（VCU/J10）', 'control', {
      coilRequired: true, coilVoltageV: 12, contactNetClass: 'POWER_DC_AUX', contactDomain: 'AUX_12V', contactVoltageV: 12
    }, { controllerPortLabel: 'J10', function: 'FAN_POWER_SWITCH' });
    const externalConnector = add('EQ-MOB-X12', 'XS-FPT12', 'external-connector-12pin', '12芯外部接口 FPT28021212ASN', 'safety', {}, {
      manufacturerPart: 'FPT28021212ASN', coreCount: 12, externalLoopStatus: 'PROJECT_HARNESS_REQUIRED'
    });
    const externalChainRelay = add('EQ-MOB-KA-JTA', 'KA-JTA', 'control-relay', 'JT-A 外部12芯链串联中继', 'safety', {
      coilRequired: true, coilVoltageV: 24, contactNetClass: 'POWER_DC_AUX', contactDomain: 'AUX_24V', contactVoltageV: 24
    }, {
      coilFunctionStatus: 'OBSERVED', coilSourceLabel: 'ZB/J10/4', coilReturnLabel: '24V−',
      contactFunction: 'JT_A_SERIES_CHAIN', evidenceStatus: 'OBSERVED_DESTINATION_UNRESOLVED'
    });
    const selectorQt = add('EQ-MOB-QT', 'QT', 'selector-switch-dual', 'QT 启停机械联动双触点', 'control', {}, {
      mechanicallyLinked: true, contactForm: 'NO_NC_UNKNOWN',
      observedTerminalLabels: ['XS/5', 'XS/20', 'TX/ENABLE', 'TX/GND'],
      destinationStatus: 'OBSERVED_UNRESOLVED'
    });
    const jt = add('EQ-MOB-JT', 'JT', 'four-pole-safety', '四联 JT 硬联锁（D触点语义待确认）', 'safety', {}, {
      contactSemantics: { A: 'EXTERNAL_12_CORE_CHAIN', B: 'K7_K8_HARD_PERMISSION', C: 'K9_K10_HARD_PERMISSION', D: 'MAINBOARD_STATE_UNKNOWN' },
      semanticStatus: 'D_CONTACT_UNKNOWN—PROJECT_CONFIRMATION_REQUIRED'
    });
    const inletLock = std.electronicLock === false ? null : add('EQ-MOB-INLET-LOCK', 'YV-IN', 'connector-lock', '补电座电子锁（双反馈）', 'replenishment', { feedbackCount: 2 }, {
      physicalAssemblyId: dcAssemblyId, feedbackChannels: 2, assemblyMode
    });
    mobileObjects.push(chargeBus, hv24, auxBus, dcdc24to12, dcdc12to5, bcu, vcu, evcc, secc, ocpp, router, antenna,
      display, cardReader, voiceBoard, speaker, lampYellow, lampGreen, lampRed, temperatureSensor, fan, fanRelay,
      externalConnector, externalChainRelay, selectorQt, jt);
    if (inletLock) {
      mobileObjects.push(inletLock);
      addAuxTarget(aux24, inletLock, 'PWR_V24', 'PWR_V24_0V');
    }
    batteryBoxes.forEach((box) => peTargets.push(endpoint(box, 'PE')));
    heaters.forEach((heater) => peTargets.push(endpoint(heater, 'PE')));
    peTargets.push(endpoint(pcs, 'PE'), endpoint(acSpd, 'PE'), endpoint(hv24, 'PE'), endpoint(fan, 'PE'));
    // NACS 的 AC/DC 逻辑接口不是第二个可接线物理座。PE 只从唯一物理 owner
    // 入网，避免逻辑别名被误投影成重复导线。
    peTargets.push(endpoint(nacsPhysicalOwner || inletDc, 'PE'));
    if (!sharedAcDcAssembly) peTargets.push(endpoint(inletAc, 'PE'));

    const chargePositiveMembers = [endpoint(chargeBus, 'BUS_DC_POS')];
    const chargePositiveEdges = [];
    const chargeNegativeMembers = [endpoint(chargeBus, 'BUS_DC_NEG')];
    const chargeNegativeEdges = [];
    moduleIds.forEach((moduleId) => {
      chargePositiveMembers.push(endpoint(moduleId, 'CHARGE_DC_POS'));
      chargePositiveEdges.push([endpoint(moduleId, 'CHARGE_DC_POS'), endpoint(chargeBus, 'BUS_DC_POS')]);
      chargeNegativeMembers.push(endpoint(moduleId, 'CHARGE_DC_NEG'));
      chargeNegativeEdges.push([endpoint(moduleId, 'CHARGE_DC_NEG'), endpoint(chargeBus, 'BUS_DC_NEG')]);
    });
    builder.wire('EH3−→H05电池侧', endpoint(heater3, 'HEAT_LOW'), endpoint(heaterInterface, 'BATTERY_H05'),
      Object.assign({}, essNeg, { boundary: 'HEATER_TWO_CORE_INTERFACE', interfaceId: heaterInterface }), { boundary: 'HEATER_TWO_CORE_INTERFACE' });

    guns.forEach((gun, index) => {
      const number = index + 1;
      const suffix = number === 1 ? '' : '-' + number;
      const k7 = add('EQ-MOB-K7' + suffix, number === 1 ? 'K7' : 'K7-' + number, 'dc-contactor', '枪 ' + number + ' 正接触器 K7（200A / 24V线圈）', 'gun', {
        polarity: 'POSITIVE', feedbackRequired: true, feedbackSignalRole: 'G' + number + ':POSITIVE_CONTACTOR_FEEDBACK'
      }, Object.assign({ gun: number, requiredForSafeIsolation: true, poleId: 'DC_POS' }, contactorRating(200, 'OBSERVED')));
      const fu2RatedA = Number(gun.fuseA);
      const fu2 = add('EQ-MOB-FU2' + suffix, number === 1 ? 'FU2' : 'FU2-' + number, 'dc-fuse', '枪 ' + number + ' 输出快熔 FU2', 'gun', { polarity: 'POSITIVE' }, Object.assign({ gun: number },
        evidenceRating(Number.isFinite(fu2RatedA) ? fu2RatedA : null, Number.isFinite(fu2RatedA) ? 'CALCULATED' : 'UNKNOWN',
          Number.isFinite(fu2RatedA) ? 'EV_GUN_BRANCH_SIZING' : '0823_SVG_RATING_UNRESOLVED')));
      const rs1 = add('EQ-MOB-RS1' + suffix, number === 1 ? 'RS1' : 'RS1-' + number, 'current-transducer', '枪 ' + number + ' 负极串联分流器 RS1', 'gun', {
        polarity: 'NEGATIVE', measurementMode: 'SHUNT_TA_TB', protocol: 'TA_TB_UNKNOWN'
      }, { gun: number, measurementRole: 'SERIES_SHUNT_ON_NEGATIVE_CONDUCTOR' });
      const meter = add('EQ-MOB-PJ2' + suffix, number === 1 ? 'PJ2' : 'PJ2-' + number, 'dc-meter', '枪 ' + number + ' 直流电能表（高阻V± / TA-TB采样）', 'gun', {
        measurementMode: 'SHUNT_TA_TB', protocol: 'TA_TB_UNKNOWN'
      }, {
        gun: number, spec: std.meter, communicationProtocol: 'UNKNOWN', mainPowerPath: false,
        auxiliarySupplyStatus: 'OBSERVED_VOLTAGE_UNRESOLVED—OPTIONAL_TERMINALS_OPEN'
      });
      const k8 = add('EQ-MOB-K8' + suffix, number === 1 ? 'K8' : 'K8-' + number, 'dc-contactor', '枪 ' + number + ' 负接触器 K8（200A / 24V线圈）', 'gun', {
        polarity: 'NEGATIVE', feedbackRequired: true, feedbackSignalRole: 'G' + number + ':NEGATIVE_CONTACTOR_FEEDBACK'
      }, Object.assign({ gun: number, requiredForSafeIsolation: true, poleId: 'DC_NEG' }, contactorRating(200, 'OBSERVED')));
      const connector = add('EQ-MOB-G' + number + '-XS', gun.tag || ('XS' + number), 'charge-connector', std.name + ' 直流充电枪 ' + number, 'gun', {
        connectorType: std.connectorType, protocol: std.protocol, physicalLayer: std.physicalLayer
      }, {
        gun: number, currentA: gun.currentA, connectorType: std.connectorType, standardId: std.id,
        interfaceRole: 'CHARGING_OUTPUT',
        controlContract: outputControlContract(std.id + ':' + std.connectorType + ':DC_OUTPUT',
          Array.isArray(std.dcPins) && std.dcPins.includes('CP'), 'CHARGING_OUTPUT', [std.connector, std.protocol])
      });
      const lock = std.electronicLock === false ? null : add('EQ-MOB-G' + number + '-LOCK', gun.lockTag || ('YV' + number), 'connector-lock', '输出枪 ' + number + ' 电子锁', 'gun', {}, { gun: number });
      const branchId = 'MOB-G' + number;
      const diagnostics = addOutputDiagnosticAssembly(builder, {
        add, aux24, connectorId: connector, controllerId: secc, branchId,
        idPrefix: 'EQ-MOB-G' + number, tagSuffix: '-G' + number, displayName: '输出枪 ' + number,
        controlPrefix: 'G' + number,
        safeIsolationDeviceIds: [k7, k8],
        monitoredPoles: [
          { deviceId: k7, poleId: 'DC_POS', upstreamTerminalId: 'IN', downstreamTerminalId: 'OUT', feedbackTerminalId: 'FEEDBACK' },
          { deviceId: k8, poleId: 'DC_NEG', upstreamTerminalId: 'IN', downstreamTerminalId: 'OUT', feedbackTerminalId: 'FEEDBACK' }
        ],
        powerContext: { powerType: 'DC', domain: 'HV_DC_CHARGE', voltageV: chargeVoltage }
      });
      chargePositiveMembers.push(endpoint(k7, 'IN'), endpoint(meter, 'SENSE_DC_POS'));
      chargePositiveEdges.push([endpoint(chargeBus, 'BUS_DC_POS'), endpoint(k7, 'IN')], [endpoint(chargeBus, 'BUS_DC_POS'), endpoint(meter, 'SENSE_DC_POS')]);
      chargeNegativeMembers.push(endpoint(rs1, 'IN'), endpoint(meter, 'SENSE_DC_NEG'));
      chargeNegativeEdges.push([endpoint(chargeBus, 'BUS_DC_NEG'), endpoint(rs1, 'IN')], [endpoint(chargeBus, 'BUS_DC_NEG'), endpoint(meter, 'SENSE_DC_NEG')]);
      builder.wire('枪 ' + number + ' K7→FU2', endpoint(k7, 'OUT'), endpoint(fu2, 'IN'), chargePos);
      builder.addNode('枪 ' + number + ' FU2 后 DC+ 输出与安全取样', chargePos,
        [endpoint(fu2, 'OUT'), endpoint(connector, 'DC_POS'),
          endpoint(diagnostics.precheckInstanceId, 'SENSE_DC_POS'), endpoint(diagnostics.stateMonitorInstanceId, 'SENSE_DC_POS')],
        [[endpoint(fu2, 'OUT'), endpoint(connector, 'DC_POS')],
          [endpoint(fu2, 'OUT'), endpoint(diagnostics.precheckInstanceId, 'SENSE_DC_POS'), { functionalRole: 'PRECHECK_DOWNSTREAM_SENSE' }],
          [endpoint(fu2, 'OUT'), endpoint(diagnostics.stateMonitorInstanceId, 'SENSE_DC_POS'), { functionalRole: 'WELD_DOWNSTREAM_SENSE' }]]);
      builder.wire('枪 ' + number + ' RS1→K8主负极', endpoint(rs1, 'OUT'), endpoint(k8, 'IN'), chargeNeg);
      builder.addNode('枪 ' + number + ' K8 后 DC− 输出与安全取样', chargeNeg,
        [endpoint(k8, 'OUT'), endpoint(connector, 'DC_NEG'),
          endpoint(diagnostics.precheckInstanceId, 'SENSE_DC_NEG'), endpoint(diagnostics.stateMonitorInstanceId, 'SENSE_DC_NEG')],
        [[endpoint(k8, 'OUT'), endpoint(connector, 'DC_NEG')],
          [endpoint(k8, 'OUT'), endpoint(diagnostics.precheckInstanceId, 'SENSE_DC_NEG'), { functionalRole: 'PRECHECK_DOWNSTREAM_SENSE' }],
          [endpoint(k8, 'OUT'), endpoint(diagnostics.stateMonitorInstanceId, 'SENSE_DC_NEG'), { functionalRole: 'WELD_DOWNSTREAM_SENSE' }]]);
      ['P', 'N'].forEach((side) => builder.wire('枪 ' + number + ' RS1 Kelvin ' + side + '→PJ2分流采样',
        endpoint(rs1, 'KELVIN_' + side), endpoint(meter, 'SHUNT_SENSE_' + side), {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'SHUNT_KELVIN', signalRole: 'SHUNT_KELVIN:' + side
        }));
      peTargets.push(endpoint(connector, 'PE'));
      if (lock) addAuxTarget(aux24, lock, 'PWR_V24', 'PWR_V24_0V');
      const connectorInstance = builder.instanceById.get(connector);
      let pilotAssembly = null;
      if (connectorInstance.terminals.some((terminal) => terminal.id === 'CP' && terminal.required)) {
        pilotAssembly = addControlPilotAssembly(builder, {
          add, aux24, connectorId: connector, controllerId: secc, branchId,
          idPrefix: 'EQ-MOB-G' + number, tagSuffix: '-G' + number, displayName: '输出枪 ' + number,
          controlPrefix: 'G' + number
        });
        functionalUnits.push(pilotAssembly);
      }
      connectorInstance.terminals.filter((terminal) => terminal.required && terminal.electricalType === 'signal').forEach((terminal) => {
        if (terminal.id === 'CP' && pilotAssembly) return;
        connectFixedToDynamic(builder, '输出枪 ' + number + ' ' + terminal.label, endpoint(connector, terminal.id), secc,
          'G' + number + '_' + terminal.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase(), 'bidirectional');
      });
      connectFixedToDynamic(builder, '输出枪 ' + number + ' 正接触器辅助反馈', endpoint(k7, 'FEEDBACK'), secc,
        'DI_G' + number + '_KPOS_FEEDBACK', 'in');
      connectFixedToDynamic(builder, '输出枪 ' + number + ' 负接触器辅助反馈', endpoint(k8, 'FEEDBACK'), secc,
        'DI_G' + number + '_KNEG_FEEDBACK', 'in');
      if (lock) {
        connectFixedToDynamic(builder, '输出枪 ' + number + ' 锁驱动', endpoint(lock, 'DRIVE'), secc, 'DO_G' + number + '_LOCK', 'out');
        connectFixedToDynamic(builder, '输出枪 ' + number + ' 锁反馈', endpoint(lock, 'FEEDBACK'), secc, 'DI_G' + number + '_LOCKED', 'in');
      }
      const charger12 = connectorInstance.terminals.find((terminal) => terminal.id === 'CHARGER_12V' && terminal.required);
      let interfaceSupply = null;
      if (charger12) {
        interfaceSupply = add('EQ-MOB-G' + number + '-T12', 'T12-' + number, 'interface-12v-supply', '输出枪 ' + number + ' 独立受控 Charger 12V', 'gun', {}, { gun: number });
        addAuxTarget(aux12, interfaceSupply, 'IN_V12', 'IN_V12_0V');
        ensureSignal(builder, secc, 'DO_G' + number + '_CHARGER_12V', { protocol: 'HARDWIRED_ENABLE', signalRole: 'CONNECTOR_12V:ENABLE', direction: 'out' });
        builder.wire('输出枪 ' + number + ' Charger12V使能', endpoint(secc, 'DO_G' + number + '_CHARGER_12V'), endpoint(interfaceSupply, 'ENABLE'), {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'HARDWIRED_ENABLE', signalRole: 'CONNECTOR_12V:ENABLE'
        });
        builder.wire('输出枪 ' + number + ' 独立Charger12V', endpoint(interfaceSupply, 'CHARGER_12V'), endpoint(connector, 'CHARGER_12V'), {
          netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX_12V', nominalVoltageV: 12, referenceVoltageV: 12, polarity: 'POSITIVE'
        });
        mobileObjects.push(interfaceSupply);
      }
      const diagnosticsRecord = finishOutputDiagnosticAssembly(builder, diagnostics, [
        { instanceId: connector, terminalId: 'DC_POS', position: 'CONTACTOR_DOWNSTREAM_CONNECTOR_SIDE' },
        { instanceId: connector, terminalId: 'DC_NEG', position: 'CONTACTOR_DOWNSTREAM_CONNECTOR_SIDE' }
      ]);
      functionalUnits.push(diagnosticsRecord);
      safetyBranches.push({
        branchId, connectorId: connector, safeIsolationDeviceIds: [k7, k8],
        controlPilotRequired: !!pilotAssembly,
        controlPilotFunctionalUnitId: pilotAssembly && pilotAssembly.id,
        outputDiagnosticFunctionalUnitId: diagnosticsRecord.id
      });
      gunEquipment.push({ gun: number, positiveContactor: k7, fuse: fu2, currentSensor: rs1, meter, negativeContactor: k8,
        connector, lock, interfaceSupply, pilotAssembly, diagnostics: diagnosticsRecord });
      mobileObjects.push(k7, fu2, rs1, meter, k8, connector, diagnostics.precheckInstanceId, diagnostics.stateMonitorInstanceId);
      if (pilotAssembly) mobileObjects.push(...pilotAssembly.instanceIds);
      if (lock) mobileObjects.push(lock);
    });
    builder.addNode('DC/DC 枪侧 DC+ 母线', chargePos, chargePositiveMembers, chargePositiveEdges);
    builder.addNode('DC/DC 枪侧 DC− 母线', chargeNeg, chargeNegativeMembers, chargeNegativeEdges);

    const mainPositiveMembers = [endpoint(essBus, 'BUS_DC_POS'), endpoint(k1, 'OUT'), endpoint(rpre, 'B'), endpoint(k4, 'OUT'), endpoint(k6, 'OUT'), endpoint(fu3, 'OUT'), endpoint(hv24, 'ESS_DC_POS')];
    const mainPositiveEdges = [
      [endpoint(k1, 'OUT'), endpoint(essBus, 'BUS_DC_POS')],
      [endpoint(rpre, 'B'), endpoint(essBus, 'BUS_DC_POS')],
      [endpoint(k4, 'OUT'), endpoint(essBus, 'BUS_DC_POS')],
      [endpoint(k6, 'OUT'), endpoint(essBus, 'BUS_DC_POS')],
      [endpoint(fu3, 'OUT'), endpoint(essBus, 'BUS_DC_POS')],
      [endpoint(essBus, 'BUS_DC_POS'), endpoint(hv24, 'ESS_DC_POS')]
    ];
    const replenishmentNegative = k4Negative ? endpoint(k4Negative, 'OUT') : endpoint(inletDc, 'DC_NEG');
    const mainNegativeMembers = [endpoint(k2, 'OUT'), endpoint(batteryBus, 'BUS_DC_NEG'), endpoint(essBus, 'BUS_DC_NEG'),
      replenishmentNegative, endpoint(k10, 'OUT'), endpoint(heaterInterface, 'PANEL_H05'), endpoint(hv24, 'ESS_DC_NEG')];
    const mainNegativeEdges = [
      [endpoint(k2, 'OUT'), endpoint(essBus, 'BUS_DC_NEG')],
      [endpoint(essBus, 'BUS_DC_NEG'), endpoint(batteryBus, 'BUS_DC_NEG')],
      [replenishmentNegative, endpoint(essBus, 'BUS_DC_NEG')],
      [endpoint(k10, 'OUT'), endpoint(essBus, 'BUS_DC_NEG')],
      [endpoint(heaterInterface, 'PANEL_H05'), endpoint(essBus, 'BUS_DC_NEG'), { boundary: 'HEATER_TWO_CORE_INTERFACE' }],
      [endpoint(essBus, 'BUS_DC_NEG'), endpoint(hv24, 'ESS_DC_NEG')]
    ];
    moduleIds.forEach((moduleId) => {
      mainPositiveMembers.push(endpoint(moduleId, 'ESS_DC_POS'));
      mainPositiveEdges.push([endpoint(essBus, 'BUS_DC_POS'), endpoint(moduleId, 'ESS_DC_POS')]);
      mainNegativeMembers.push(endpoint(moduleId, 'ESS_DC_NEG'));
      mainNegativeEdges.push([endpoint(essBus, 'BUS_DC_NEG'), endpoint(moduleId, 'ESS_DC_NEG')]);
    });
    builder.addNode('K1/K3 后主正高压母线', essPos, mainPositiveMembers, mainPositiveEdges);
    builder.addNode('K2 后总负高压母线', essNeg, mainNegativeMembers, mainNegativeEdges);

    /* ---------- HV→24V→12V→5V and hard-wired JT permissions ---------- */
    addAuxTarget(aux24, bcu, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux24, vcu, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux24, evcc, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux24, secc, 'PWR_V24', 'PWR_V24_0V');
    addAuxTarget(aux24, pcs, 'CTRL_PWR_V24', 'CTRL_PWR_V24_0V');
    addAuxTarget(aux24, dcdc24to12, 'IN_V24', 'IN_V24_0V');
    moduleIds.forEach((moduleId) => addAuxTarget(aux24, moduleId, 'CTRL_PWR_V24', 'CTRL_PWR_V24_0V'));
    addAuxTarget(aux12, ocpp, 'PWR_V12', 'PWR_V12_0V');
    addAuxTarget(aux12, router, 'PWR_V12', 'PWR_V12_0V');
    [lampYellow, lampGreen, lampRed].forEach((lamp) => addAuxTarget(aux12, lamp, 'PWR_V12', 'PWR_V12_0V'));
    addAuxTarget(aux12, dcdc12to5, 'IN_V12', 'IN_V12_0V');
    addAuxTarget(aux5, display, 'PWR_V5', 'PWR_V5_0V');
    addAuxTarget(aux5, cardReader, 'PWR_V5', 'PWR_V5_0V');
    addAuxTarget(aux5, voiceBoard, 'PWR_V5', 'PWR_V5_0V');
    aux12.positive.push(endpoint(fanRelay, 'CONTACT_IN'));
    aux12.return.push(endpoint(fan, 'CTRL_PWR_V12_0V'));
    [[k1, 1], [k2, 2], [k3, 3], [k5, 5], [k6, 6]].forEach((item) => addCoil(builder, bcu, item[0], 'MOB_K' + item[1], aux24));
    if (nacsModeInterlock) {
      addCoil(builder, bcu, k4, 'MOB_K4', { positive: [], return: [] });
      addCoil(builder, bcu, k4Negative, 'MOB_K4N', { positive: [], return: [] });
      addCoil(builder, vcu, km2, 'MOB_KM2_CONTROL_UNRESOLVED', { positive: [], return: [] });
      addCoil(builder, vcu, acControlRelay, 'MOB_KAAC_CONTROL_UNRESOLVED', { positive: [], return: [] });
      addAuxTarget(aux24, nacsModeInterlock, 'PWR_V24', 'PWR_V24_0V');
      builder.addNode('NACS DC模式双极许可→K4/K4N线圈+', {
        netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
      }, [endpoint(nacsModeInterlock, 'DC_PERMISSION_V24'), endpoint(k4, 'COIL_V24'), endpoint(k4Negative, 'COIL_V24')], [
        [endpoint(nacsModeInterlock, 'DC_PERMISSION_V24'), endpoint(k4, 'COIL_V24')],
        [endpoint(nacsModeInterlock, 'DC_PERMISSION_V24'), endpoint(k4Negative, 'COIL_V24')]
      ]);
      builder.addNode('NACS AC模式许可→KM2/交流中继线圈+', {
        netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
      }, [endpoint(nacsModeInterlock, 'AC_PERMISSION_V24'), endpoint(km2, 'COIL_V24'), endpoint(acControlRelay, 'COIL_V24')], [
        [endpoint(nacsModeInterlock, 'AC_PERMISSION_V24'), endpoint(km2, 'COIL_V24')],
        [endpoint(nacsModeInterlock, 'AC_PERMISSION_V24'), endpoint(acControlRelay, 'COIL_V24')]
      ]);
      connectFixedToDynamic(builder, 'NACS AC/DC模式命令', endpoint(nacsModeInterlock, 'MODE_COMMAND'), evcc, 'DO_NACS_AC_DC_MODE', 'out');
    } else {
      addCoil(builder, bcu, k4, 'MOB_K4', aux24);
      addCoil(builder, vcu, km2, 'MOB_KM2_CONTROL_UNRESOLVED', aux24);
      addCoil(builder, vcu, acControlRelay, 'MOB_KAAC_CONTROL_UNRESOLVED', aux24);
    }
    connectFixedToDynamic(builder, 'KM2反馈（对端待线束确认）', endpoint(km2, 'FEEDBACK'), vcu, 'DI_KM2_FEEDBACK_UNRESOLVED', 'in', {
      evidenceStatus: 'INFERRED_REVIEW_REQUIRED', destinationStatus: 'CONTROL_ENDPOINT_UNRESOLVED'
    });
    connectFixedToDynamic(builder, '交流中继反馈（对端待线束确认）', endpoint(acControlRelay, 'FEEDBACK'), vcu, 'DI_KAAC_FEEDBACK_UNRESOLVED', 'in', {
      evidenceStatus: 'INFERRED_REVIEW_REQUIRED', destinationStatus: 'CONTROL_ENDPOINT_UNRESOLVED'
    });
    addCoil(builder, vcu, fanRelay, 'MOB_FAN_RELAY', aux12, 12);
    builder.wire('风机中继触点→12V风机+', endpoint(fanRelay, 'CONTACT_OUT'), endpoint(fan, 'CTRL_PWR_V12'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_12V', nominalVoltageV: 12, referenceVoltageV: 12, polarity: 'POSITIVE'
    });

    const addReturnDriver = (controllerId, contactorId, terminalId) => {
      builder.ensureTerminal(controllerId, terminalId, {
        netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 0, referenceVoltageV: 24,
        polarity: 'RETURN', direction: 'out', required: true, multiplicity: 'one', electricalType: 'open-collector-output'
      });
      builder.wire(terminalId + ' 线圈回路', endpoint(controllerId, terminalId), endpoint(contactorId, 'COIL_V24_0V'), {
        netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 0, referenceVoltageV: 24, polarity: 'RETURN'
      });
    };
    gunEquipment.forEach((branch, index) => {
      addReturnDriver(vcu, branch.positiveContactor, 'DO_G' + (index + 1) + '_K7_RETURN');
      addReturnDriver(vcu, branch.negativeContactor, 'DO_G' + (index + 1) + '_K8_RETURN');
    });
    addReturnDriver(vcu, k9, 'DO_K9_RETURN');
    addReturnDriver(vcu, k10, 'DO_K10_RETURN');
    addReturnDriver(vcu, km1, 'DO_KM1_RETURN');

    aux24.positive.push(endpoint(externalConnector, 'JT_LOOP_IN'), endpoint(jt, 'B_IN'), endpoint(jt, 'C_IN'), endpoint(jt, 'D_IN'), endpoint(km2, 'CONTACT_IN'));
    builder.ensureTerminal(vcu, 'ZB_J10_4', {
      label: 'ZB/J10/4', observedLabel: 'ZB/J10/4', netClass: 'POWER_DC_AUX', domain: 'AUX_24V',
      voltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE', direction: 'out', required: true,
      multiplicity: 'one', electricalType: 'observed-controller-output', evidenceStatus: 'OBSERVED'
    });
    builder.wire('ZB/J10/4→JT-A中继线圈+', endpoint(vcu, 'ZB_J10_4'), endpoint(externalChainRelay, 'COIL_V24'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE',
      evidenceStatus: 'OBSERVED'
    });
    aux24.return.push(endpoint(externalChainRelay, 'COIL_V24_0V'));
    builder.ensureTerminal(vcu, 'DI_JT_A_EXTERNAL', {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24,
      polarity: 'POSITIVE', direction: 'in', required: true, electricalType: 'hardwired-input'
    });
    builder.ensureTerminal(vcu, 'DI_JT_D_STATE_UNKNOWN', {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24,
      polarity: 'POSITIVE', direction: 'in', required: true, electricalType: 'hardwired-input'
    });
    builder.wire('12芯外部链返回→串联中继', endpoint(externalConnector, 'JT_LOOP_OUT'), endpoint(externalChainRelay, 'CONTACT_IN'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
    });
    builder.wire('串联中继→JT-A输入', endpoint(externalChainRelay, 'CONTACT_OUT'), endpoint(jt, 'A_IN'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
    });
    builder.wire('JT-A 外部12芯链状态→VCU', endpoint(jt, 'A_OUT'), endpoint(vcu, 'DI_JT_A_EXTERNAL'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
    });
    builder.wire('JT-D 主板状态（语义待确认）', endpoint(jt, 'D_OUT'), endpoint(vcu, 'DI_JT_D_STATE_UNKNOWN'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
    });
    builder.addNode('JT-B K7/K8 硬许可', {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
    }, [endpoint(jt, 'B_OUT')].concat(gunEquipment.flatMap((branch) => [endpoint(branch.positiveContactor, 'COIL_V24'), endpoint(branch.negativeContactor, 'COIL_V24')])),
    gunEquipment.flatMap((branch) => [[endpoint(jt, 'B_OUT'), endpoint(branch.positiveContactor, 'COIL_V24')], [endpoint(jt, 'B_OUT'), endpoint(branch.negativeContactor, 'COIL_V24')]]));
    builder.addNode('JT-C K9/K10 硬许可', {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
    }, [endpoint(jt, 'C_OUT'), endpoint(k9, 'COIL_V24'), endpoint(k10, 'COIL_V24')],
    [[endpoint(jt, 'C_OUT'), endpoint(k9, 'COIL_V24')], [endpoint(jt, 'C_OUT'), endpoint(k10, 'COIL_V24')]]);
    builder.wire('KM2联锁触点→独立交流中继', endpoint(km2, 'CONTACT_OUT'), endpoint(acControlRelay, 'CONTACT_IN'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE',
      evidenceStatus: 'OBSERVED_TOPOLOGY_ENDPOINTS_REVIEW_REQUIRED'
    });
    builder.wire('独立交流中继→KM1线圈+', endpoint(acControlRelay, 'CONTACT_OUT'), endpoint(km1, 'COIL_V24'), {
      netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
    });

    const makeAuxNode = (name, source, bus, targets, voltage, polarity) => {
      const members = [source, bus].concat(targets);
      const edges = [[source, bus]].concat(targets.map((target) => [bus, target]));
      builder.addNode(name, {
        netClass: 'POWER_DC_AUX', domain: 'AUX_' + voltage + 'V', nominalVoltageV: polarity === 'POSITIVE' ? voltage : 0,
        referenceVoltageV: voltage, polarity
      }, members, edges);
    };
    makeAuxNode('移动系统 +24V', endpoint(hv24, 'OUT_V24'), endpoint(auxBus, 'BUS24_V24'), aux24.positive, 24, 'POSITIVE');
    makeAuxNode('移动系统 24V-0V', endpoint(hv24, 'OUT_V24_0V'), endpoint(auxBus, 'BUS24_V24_0V'), aux24.return, 24, 'RETURN');
    makeAuxNode('移动系统 +12V', endpoint(dcdc24to12, 'OUT_V12'), endpoint(auxBus, 'BUS12_V12'), aux12.positive, 12, 'POSITIVE');
    makeAuxNode('移动系统 12V-0V', endpoint(dcdc24to12, 'OUT_V12_0V'), endpoint(auxBus, 'BUS12_V12_0V'), aux12.return, 12, 'RETURN');
    builder.addNode('屏幕/刷卡/语音板独立 +5V', {
      netClass: 'POWER_DC_AUX', domain: 'AUX_5V', nominalVoltageV: 5, referenceVoltageV: 5, polarity: 'POSITIVE'
    }, [endpoint(dcdc12to5, 'OUT_V5')].concat(aux5.positive),
    aux5.positive.map((target) => [endpoint(dcdc12to5, 'OUT_V5'), target]));
    builder.addNode('屏幕/刷卡/语音板独立 5V-0V', {
      netClass: 'POWER_DC_AUX', domain: 'AUX_5V', nominalVoltageV: 0, referenceVoltageV: 5, polarity: 'RETURN'
    }, [endpoint(dcdc12to5, 'OUT_V5_0V')].concat(aux5.return),
    aux5.return.map((target) => [endpoint(dcdc12to5, 'OUT_V5_0V'), target]));

    /* ---------- exact controller, CAN, serial and interface conductors ---------- */
    ['P', 'N'].forEach((side) => {
      builder.addNode('GB1→GB2→GB3→BCU BMS CAN ' + side, {
        netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'BMS_CAN', signalRole: 'CAN:' + side
      }, batteryBoxes.map((box) => endpoint(box, 'CAN_' + side)).concat([endpoint(bcu, 'CAN_' + side)]), [
        [endpoint(battery1, 'CAN_' + side), endpoint(battery2, 'CAN_' + side)],
        [endpoint(battery2, 'CAN_' + side), endpoint(battery3, 'CAN_' + side)],
        [endpoint(battery3, 'CAN_' + side), endpoint(bcu, 'CAN_' + side)]
      ]);
      connectDynamicPair(builder, 'BCU整车CAN ' + side, bcu, 'VEHICLE_CAN_' + side, vcu, 'BCU_CAN_' + side, 'VEHICLE_CAN');
      connectDynamicPair(builder, 'BCU充电CAN ' + side, bcu, 'CHARGE_CAN_' + side, evcc, 'BCU_CAN_' + side, 'CHARGE_CAN');
      connectDynamicPair(builder, 'VCU↔SECC CAN ' + side, vcu, 'SECC_CAN_' + side, secc, 'VCU_CAN_' + side, 'SECC_CAN');
      const role = 'COMM:' + side;
      builder.ensureTerminal(vcu, 'MODULE_CAN_' + side, {
        netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'MODULE_CAN', signalRole: role,
        direction: 'bidirectional', required: true, electricalType: 'signal'
      });
      const moduleMembers = [endpoint(vcu, 'MODULE_CAN_' + side), endpoint(pcs, 'COMM_' + side)]
        .concat(moduleIds.map((moduleId) => endpoint(moduleId, 'COMM_' + side)));
      const moduleEdges = [[endpoint(vcu, 'MODULE_CAN_' + side), endpoint(pcs, 'COMM_' + side)]]
        .concat(moduleIds.map((moduleId) => [endpoint(vcu, 'MODULE_CAN_' + side), endpoint(moduleId, 'COMM_' + side)]));
      builder.addNode('VCU模块CAN ' + side, {
        netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'MODULE_CAN', signalRole: role
      }, moduleMembers, moduleEdges);

      connectFixedToDynamic(builder, 'RS2 电池电流采样 ' + side, endpoint(rs2, 'SIGNAL_' + side), bcu, 'AI_RS2_' + side, 'in');
      connectFixedToDynamic(builder, '补电漏电检测 ' + side, endpoint(acRcm, 'SIGNAL_' + side), vcu, 'DI_RCM_' + side, 'in');
    });
    ['TA', 'TB'].forEach((side) => {
      const role = 'METER_LINK:' + side;
      builder.ensureTerminal(vcu, 'J6_METER_' + side, {
        netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'TA_TB_UNKNOWN', signalRole: role,
        direction: 'bidirectional', required: true, electricalType: 'signal'
      });
      const meterMembers = [endpoint(vcu, 'J6_METER_' + side)].concat(gunEquipment.map((branch) => endpoint(branch.meter, 'COMM_' + side)));
      const meterEdges = gunEquipment.map((branch) => [endpoint(vcu, 'J6_METER_' + side), endpoint(branch.meter, 'COMM_' + side)]);
      builder.addNode('VCU J6 电表 ' + side, {
        netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'TA_TB_UNKNOWN', signalRole: role
      }, meterMembers, meterEdges);
    });
    connectDynamicPair(builder, 'VCU↔OCPP 串口 P', vcu, 'OCPP_SERIAL_P', ocpp, 'VCU_SERIAL_P', 'SERIAL_UNKNOWN');
    connectDynamicPair(builder, 'VCU↔OCPP 串口 N', vcu, 'OCPP_SERIAL_N', ocpp, 'VCU_SERIAL_N', 'SERIAL_UNKNOWN');
    builder.wire('路由器→三合一天线 RF物理链（制式未知）', endpoint(router, 'RF_PORT'), endpoint(antenna, 'RF'), {
      netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'RF_UNKNOWN', signalRole: 'RF_LINK',
      evidenceStatus: 'OBSERVED_PHYSICAL_LINK_PROTOCOL_UNRESOLVED'
    });
    builder.ensureTerminal(vcu, 'HMI_TX', {
      netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'HMI_UART', signalRole: 'HMI_UART:HOST_TX',
      direction: 'out', required: true, electricalType: 'serial-tx'
    });
    builder.addNode('VCU TX→4.3屏 RX / 语音板 RX 共线', {
      netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'HMI_UART', signalRole: 'HMI_UART:HOST_TX'
    }, [endpoint(vcu, 'HMI_TX'), endpoint(display, 'RX'), endpoint(voiceBoard, 'RX')], [
      [endpoint(vcu, 'HMI_TX'), endpoint(display, 'RX')],
      [endpoint(vcu, 'HMI_TX'), endpoint(voiceBoard, 'RX')]
    ]);
    builder.ensureTerminal(vcu, 'HMI_RX', {
      netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'HMI_UART', signalRole: 'HMI_UART:DISPLAY_TX',
      direction: 'in', required: true, electricalType: 'serial-rx'
    });
    builder.wire('4.3屏 TX→VCU RX', endpoint(display, 'TX'), endpoint(vcu, 'HMI_RX'), {
      netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'HMI_UART', signalRole: 'HMI_UART:DISPLAY_TX'
    });
    connectFixedToDynamic(builder, 'VCU TX→刷卡器 RX', endpoint(cardReader, 'RX'), vcu, 'CARD_TX', 'out');
    connectFixedToDynamic(builder, '刷卡器 TX→VCU RX', endpoint(cardReader, 'TX'), vcu, 'CARD_RX', 'in');
    ['P', 'N'].forEach((side) => {
      connectFixedToDynamic(builder, '电池舱温感 ' + side, endpoint(temperatureSensor, 'SENSOR_' + side), bcu, 'TEMP_SENSOR_' + side, 'in');
      builder.wire('语音板→喇叭音频 ' + side, endpoint(voiceBoard, 'AUDIO_OUT_' + side), endpoint(speaker, 'AUDIO_IN_' + side), {
        netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'ANALOG_AUDIO', signalRole: 'AUDIO:' + side
      });
    });
    [[lampYellow, 'YELLOW'], [lampGreen, 'GREEN'], [lampRed, 'RED']].forEach((item) => {
      connectFixedToDynamic(builder, item[1] + ' 状态灯驱动', endpoint(item[0], 'DRIVE'), vcu, 'DO_LAMP_' + item[1], 'out');
    });
    if (!sharedAcDcAssembly) acOutput.controlPins.forEach((terminalId) => connectFixedToDynamic(builder, '交流补电座 ' + terminalId,
      endpoint(inletAc, terminalId), evcc, 'AC_INLET_' + terminalId, 'bidirectional', terminalId === 'PP' ? {
        evidenceStatus: 'INFERRED_REVIEW_REQUIRED', destinationStatus: 'CONTROL_BOARD_TERMINAL_UNRESOLVED'
      } : null));
    const inletInstance = builder.instanceById.get(inletDc);
    inletInstance.terminals.filter((terminal) => terminal.required && terminal.electricalType === 'signal').forEach((terminal) => {
      const dynamicId = 'DC_INLET_' + terminal.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
      const overrides = terminal.id === 'PP' ? {
        evidenceStatus: 'INFERRED_REVIEW_REQUIRED', destinationStatus: 'CONTROL_BOARD_TERMINAL_UNRESOLVED'
      } : null;
      if (nacsPhysicalOwner && ['CP', 'PP'].includes(terminal.id)) {
        const fixedTerminal = builder.terminal(endpoint(nacsPhysicalOwner, terminal.id));
        builder.ensureTerminal(evcc, dynamicId, Object.assign({}, fixedTerminal, overrides || {}, {
          id: dynamicId, label: dynamicId, direction: 'bidirectional', required: true, multiplicity: 'one'
        }));
        builder.wire('NACS物理' + terminal.id + '→EVCC', endpoint(nacsPhysicalOwner, terminal.id), endpoint(evcc, dynamicId),
          semanticsForTerminal(fixedTerminal, overrides));
      } else {
        connectFixedToDynamic(builder, '直流补电座 ' + terminal.label, endpoint(inletDc, terminal.id), evcc,
          dynamicId, 'bidirectional', overrides);
      }
    });
    if (inletInstance.terminals.some((terminal) => terminal.id === 'CHARGER_12V' && terminal.required)) {
      builder.ensureTerminal(evcc, 'INLET_CHARGER_12V', {
        netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX_12V', voltageV: 12, referenceVoltageV: 12,
        polarity: 'POSITIVE', direction: 'in', required: true, electricalType: 'power'
      });
      builder.wire('直流补电座独立 Charger12V', endpoint(inletDc, 'CHARGER_12V'), endpoint(evcc, 'INLET_CHARGER_12V'), {
        netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX_12V', nominalVoltageV: 12, referenceVoltageV: 12, polarity: 'POSITIVE'
      });
    }
    if (inletLock) {
      connectFixedToDynamic(builder, '补电座电子锁驱动', endpoint(inletLock, 'DRIVE'), evcc, 'DO_INLET_LOCK', 'out');
      connectFixedToDynamic(builder, '补电座电子锁反馈1', endpoint(inletLock, 'FEEDBACK'), evcc, 'DI_INLET_LOCK_1', 'in');
      connectFixedToDynamic(builder, '补电座电子锁反馈2', endpoint(inletLock, 'FEEDBACK_2'), evcc, 'DI_INLET_LOCK_2', 'in');
    }

    const peMembers = [endpoint(peBar, 'PE')].concat(peTargets);
    const peEdges = peTargets.map((target) => [endpoint(peBar, 'PE'), target]);
    builder.addNode('移动储充系统保护接地 PE', {
      netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', nominalVoltageV: 0
    }, peMembers, peEdges);
    builder.finishInstances();

    if (nacsPhysicalOwner) {
      const ownerInstance = builder.instanceById.get(nacsPhysicalOwner);
      const dcProxy = builder.instanceById.get(inletDc);
      const acProxy = builder.instanceById.get(inletAc);
      const group = 'NACS_AC_DC_POWER';
      const dcPhysicalMap = { DC_POS: 'PWR_A', DC_NEG: 'PWR_B', CP: 'CP', PP: 'PP', PE: 'PE' };
      const acPhysicalMap = { AC_L1: 'PWR_A', AC_L2: 'PWR_B' };
      const makeProxyPort = (instance, terminal, physicalId, modeId) => ({
        id: terminal.id === 'AC_L1' || terminal.id === 'AC_L2' ? 'AC' : terminal.id,
        netClass: terminal.netClass, domain: terminal.domain, logicalTerminalIds: [terminal.id],
        physicalOwnerId: ownerInstance.id, physicalTerminalIds: [physicalId], modeId,
        mutualExclusionGroup: ['PWR_A', 'PWR_B'].includes(physicalId) ? group : null,
        modeDependent: ['PWR_A', 'PWR_B'].includes(physicalId)
      });
      [dcProxy, acProxy].forEach((proxy) => {
        proxy.logicalOnlyProxy = true;
        proxy.physicalOwnerId = ownerInstance.id;
        proxy.physicalTerminals = [];
        proxy.ports = proxy.terminals;
      });
      dcProxy.terminals.forEach((terminal) => {
        terminal.logicalOnly = true;
        terminal.required = false;
        terminal.connectionPolicy = 'LOGICAL_ALIAS_ONLY_NO_NET';
        terminal.evidenceStatus = 'CONTROLLED_NACS_FUNCTION_ALIAS';
        terminal.direction = 'bidirectional';
        terminal.physicalOwnerId = ownerInstance.id;
        terminal.physicalTerminalId = dcPhysicalMap[terminal.id];
        terminal.modeId = /^DC_/.test(terminal.id) ? 'DC' : 'AC_DC_SHARED';
        terminal.mutualExclusionGroup = /^DC_/.test(terminal.id) ? group : null;
      });
      acProxy.terminals.forEach((terminal) => {
        terminal.logicalOnly = true;
        terminal.required = false;
        terminal.connectionPolicy = 'LOGICAL_ALIAS_ONLY_NO_NET';
        terminal.evidenceStatus = 'CONTROLLED_NACS_FUNCTION_ALIAS';
        terminal.direction = 'bidirectional';
        terminal.physicalOwnerId = ownerInstance.id;
        terminal.physicalTerminalId = acPhysicalMap[terminal.id];
        terminal.modeId = 'AC';
        terminal.mutualExclusionGroup = group;
      });
      dcProxy.functionalPorts = dcProxy.terminals.map((terminal) => makeProxyPort(dcProxy, terminal, dcPhysicalMap[terminal.id], /^DC_/.test(terminal.id) ? 'DC' : 'AC_DC_SHARED'));
      acProxy.functionalPorts = [{
        id: 'AC', netClass: 'POWER_AC', domain: 'AC_MAINS', logicalTerminalIds: ['AC_L1', 'AC_L2'],
        physicalOwnerId: ownerInstance.id, physicalTerminalIds: ['PWR_A', 'PWR_B'], modeId: 'AC',
        mutualExclusionGroup: group, modeDependent: true
      }];
      ownerInstance.modeDependentPhysicalOwner = true;
      ownerInstance.defaultMode = 'ALL_OPEN';
      ownerInstance.powerModePolicy = 'BREAK_BEFORE_MAKE_ALL_POLES';
      ownerInstance.modeStateMatrix = clone(nacsModeStateMatrix);
      ownerInstance.functionalPorts = [
        { id: 'AC_L1', netClass: 'POWER_AC', domain: 'AC_MAINS', physicalTerminalIds: ['PWR_A'], logicalOwnerId: acProxy.id, logicalTerminalIds: ['AC_L1'], modeId: 'AC', mutualExclusionGroup: group, modeDependent: true },
        { id: 'DC_POS', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', physicalTerminalIds: ['PWR_A'], logicalOwnerId: dcProxy.id, logicalTerminalIds: ['DC_POS'], modeId: 'DC', mutualExclusionGroup: group, modeDependent: true },
        { id: 'AC_L2', netClass: 'POWER_AC', domain: 'AC_MAINS', physicalTerminalIds: ['PWR_B'], logicalOwnerId: acProxy.id, logicalTerminalIds: ['AC_L2'], modeId: 'AC', mutualExclusionGroup: group, modeDependent: true },
        { id: 'DC_NEG', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', physicalTerminalIds: ['PWR_B'], logicalOwnerId: dcProxy.id, logicalTerminalIds: ['DC_NEG'], modeId: 'DC', mutualExclusionGroup: group, modeDependent: true }
      ].concat(['CP', 'PP', 'PE'].map((terminalId) => {
        const terminal = ownerInstance.terminals.find((item) => item.id === terminalId);
        return { id: terminalId, netClass: terminal.netClass, domain: terminal.domain, physicalTerminalIds: [terminalId], activeModes: ['AC', 'DC'] };
      }));
      acProxy.sharedPowerContacts = { L1: 'PWR_A', L2: 'PWR_B', mode: 'MUTUALLY_EXCLUSIVE', physicalOwnerId: ownerInstance.id };
    }

    const markerIds = [
      'EQ-MOB-BAT1', 'EQ-MOB-BAT2', 'EQ-MOB-BAT3', 'EQ-MOB-FU1', 'EQ-MOB-RPRE',
      'EQ-MOB-HEATER1', 'EQ-MOB-HEATER2', 'EQ-MOB-HEATER3', 'EQ-MOB-PCS', 'EQ-MOB-DC-IN', 'EQ-MOB-AC-IN',
      'EQ-MOB-HV24', 'EQ-MOB-24V12', 'EQ-MOB-12V5', 'EQ-MOB-BCU', 'EQ-MOB-VCU', 'EQ-MOB-EVCC',
      'EQ-MOB-SECC', 'EQ-MOB-OCPP', 'EQ-MOB-JT', 'EQ-MOB-DISPLAY', 'EQ-MOB-CARD', 'EQ-MOB-VOICE',
      'EQ-MOB-SPK', 'EQ-MOB-HL-Y', 'EQ-MOB-HL-G', 'EQ-MOB-HL-R', 'EQ-MOB-TEMP', 'EQ-MOB-QT',
      'EQ-MOB-X12', 'EQ-MOB-KA-JTA', 'EQ-MOB-KA-FAN', 'EQ-MOB-FAN', 'EQ-MOB-XH1',
      'EQ-MOB-KM2', 'EQ-MOB-KA-AC', 'EQ-MOB-ROUTER', 'EQ-MOB-ANT', 'EQ-MOB-SPD1'
    ].concat(Array.from({ length: 10 }, (_, index) => 'EQ-MOB-K' + (index + 1)));
    if (inletLock) markerIds.push('EQ-MOB-INLET-LOCK');
    const mobileRequiredKinds = [
      'battery-box', 'battery-heater', 'ess-contactor', 'precharge-contactor', 'precharge-resistor',
      'dc-dc-charge-module', 'ess-pcs', 'dc-charge-inlet', 'four-pole-safety', 'touch-display',
      'card-reader', 'voice-board', 'loudspeaker', 'indicator-lamp', 'temperature-sensor',
      'selector-switch-dual', 'external-connector-12pin', 'control-relay', 'thermal-unit',
      'heating-connector-2pin', 'rf-antenna',
      'output-precheck-monitor', 'contactor-state-monitor'
    ];
    if (functionalUnits.some((unit) => unit.type === 'CONTROL_PILOT_INTERFACE')) {
      mobileRequiredKinds.push('control-pilot-generator', 'control-pilot-monitor', 'vehicle-diode-detector');
    }
    if (inletLock) mobileRequiredKinds.push('connector-lock');
    if (nacsModeInterlock) {
      markerIds.push('EQ-MOB-NACS-MODE-ILK', 'EQ-MOB-NACS-IN', 'EQ-MOB-NACS-SEL', 'EQ-MOB-K4N');
      mobileRequiredKinds.push('ac-dc-mode-interlock', 'nacs-shared-inlet', 'ac-dc-power-selector');
    }
    const moduleSizing = {
      moduleCount,
      unitKw: moduleKw,
      calculatedInstalledKw: moduleInstalledKw,
      declaredInstalledKw: Number(dc.installedKw),
      requestedOutputKw: Number(dc.ratedKw),
      ratingStatus: 'CALCULATED', calculationSource: 'EV-SIZING-001',
      calculationBasis: moduleCount + ' × ' + moduleKw + 'kW = ' + moduleInstalledKw + 'kW',
      outputContractStatus: Number(dc.installedKw) === moduleInstalledKw && moduleInstalledKw >= Number(dc.ratedKw) ? 'SATISFIED' : 'INVALID'
    };
    const prechargeControlIntent = {
      sequence: ['CLOSE_K2', 'CLOSE_K3', 'MONITOR_BUS_DIFFERENTIAL_OR_TIMEOUT', 'CLOSE_K1', 'OPEN_K3'],
      completionThresholdV: 'UNRESOLVED', timeoutMs: 'UNRESOLVED',
      monitorIntent: 'BUS_DIFFERENTIAL_VOLTAGE_AND_TIMEOUT',
      observedCandidateTerminalIds: bcuObservedTerminals.filter((item) => /^BTA|^BAT/.test(item.observedLabel)).map((item) => item.terminalId),
      candidateMappingStatus: 'OBSERVED_DESTINATION_UNRESOLVED',
      failClosedState: 'K1_OPEN_K3_OPEN', evidenceStatus: 'CONTROL_INTENT_VALUES_UNRESOLVED'
    };
    const requirements = {
      schema: 'EVSE-REQUIREMENT-SPEC/1.0', standard: std.id, standardName: std.name,
      connector: std.connector, protocol: std.protocol, archetype: 'ess-mobile',
      outputKw: dc.ratedKw, installedOutputKw: dc.installedKw, gunCount: guns.length, gunCurrentA: p.gunCurrentA,
      essEnabled: true, essKwh: ess.usableKwh || ess.installedKwh || Number(p.essKwh) || 0,
      specialRequirements: Array.isArray(p.specialRequirements) ? p.specialRequirements.slice() : [],
      source: p.requirement ? clone(p.requirement) : { source: p.requirementSource || 'FORM', confidence: p.requirementConfidence, confirmed: !!p.requirementConfirmed }
    };
    const assumptions = clone(spec.assumptions || []);
    assumptions.push({
      id: 'ESS-MOBILE-0823-INTERFACE-NORMALIZATION', value: std.id + ' / ' + std.connectorType,
      note: '0823参考文件名含“国标”但图内连接器文字为欧标；模板仅采纳电源/控制拓扑，接口触点严格由所选受控标准生成。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-JT-D-SEMANTICS', value: 'UNKNOWN',
      note: '参考图只给出JT四联触点及D触点主板状态链，未足以证明其等同急停；保留UNKNOWN并要求项目确认。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-PCS-DIRECTION', value: 'UNRESOLVED',
      note: '0823参考图标出22kW PCS及AC/DC端子，但不足以证明允许双向能量流；控制策略与认证边界待厂家资料确认。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-METER-TA-TB-PROTOCOL', value: 'TA_TB_UNKNOWN',
      note: '参考图只标出电表TA/TB，未给出RS485或其他协议；保留受控未知协议，不进行接口猜测。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-METER-AUX-SUPPLY', value: 'VOLTAGE_UNRESOLVED',
      note: '参考图可见直流表低压供电意图但电压值不足以确认；仅保留可选未决端子，不接入12V或24V域。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-OCPP-SERIAL-PROTOCOL', value: 'SERIAL_UNKNOWN',
      note: '参考图只标出VCU↔OCPP串口，未给出RS232/RS485电气制式；只保留独立串行链。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-BATTERY-BOX-RATINGS', value: 'UNRESOLVED',
      note: '参考图证明GB1/GB2/GB3串联，但未给出单箱额定电压和容量；模型不得把总值等分后伪装成厂家额定值。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-BCU-OBSERVED-TERMINALS', value: 'OBSERVED_UNMAPPED',
      note: '保留CANH/CANL、BTA1+、BTA2+、BTA5+、BAT1−、BAT2−、A+、CC2原图标签；没有足够证据时不把它们猜接成母线采样。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-INLET-PP-DESTINATION', value: 'INFERRED_REVIEW_REQUIRED',
      note: 'PP物理触点由受控接口保留；参考图未能确认最终控制板端子，当前EVCC逻辑归属必须由项目线束表复核。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-PANEL-EVIDENCE-BOUNDARY', value: 'PARTIALLY_OBSERVED',
      note: '4.3屏5V/TX/RX、刷卡器PW+/RX/TX/GND、语音板5V/GND/RX及共线关系按图建模；QT触点形式和外部芯号保持UNKNOWN。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-PRECHARGE-SETTINGS', value: 'THRESHOLD_AND_TIMEOUT_UNRESOLVED',
      note: '仅保留K2→K3→监测压差/超时→K1→K3断开的控制意图；压差阈值、超时和故障恢复策略必须由电池/PCS厂家联调确认。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-FUSE-RATING-EVIDENCE', value: 'FU1_FU2_CALCULATED—FU3_FUH_UNKNOWN',
      note: 'FU1/FU2来自确定性输出与枪支路计算；FU3和加热FUH图面额定不足以确认，禁止伪填厂家额定值。', status: 'ASSUMPTION'
    });
    assumptions.push({
      id: 'ESS-MOBILE-AC-RELAY-ENDPOINTS', value: 'INFERRED_REVIEW_REQUIRED',
      note: '图面证明KM2与独立交流中继及反馈角色，但模糊的板端编号保持待线束表确认。', status: 'ASSUMPTION'
    });
    if (nacsModeInterlock) assumptions.push({
      id: 'NACS-SHARED-POWER-FAIL-CLOSED-BOUNDARY', value: 'ALL_OPEN_BREAK_BEFORE_MAKE',
      note: 'NACS的PWR_A/PWR_B由单一物理owner进入双极模式选择边界；K4/K4N与KM1许可互斥，默认全断。K4N是防止DC−静态旁路的安全设计要求。', status: 'DESIGN_REQUIREMENT'
    });
    const model = {
      schema: 'EVSE-EDEM/4.1', schemaVersion: SCHEMA_VERSION,
      project: { id: projectId, name: p.pileName || '储能移动充电桩', site: p.site || '', status: 'CONCEPT_DRAFT', referenceDesignation: docControl.projectReference },
      documentControl: docControl, requirements, assumptions,
      decisions: [
        { id: 'DEC-SOURCE-OF-TRUTH', value: 'EDEM_V4_TERMINAL_NETLIST', rationale: '绘图与DXF只消费同一端子级网表。' },
        { id: 'DEC-MOBILE-REFERENCE', value: '0823_PROJECT_TOPOLOGY_SELECTED_STANDARD_PINS', rationale: '真实项目功率/控制拓扑与受控接口引脚分层。' },
        { id: 'DEC-ROUTING', value: 'CHANNEL_INTERVAL_LANES', rationale: '几何不得推断或改写电气连接。' },
        { id: 'DEC-FUNCTIONAL-SAFETY', value: 'EXACT_TERMINALS_AND_FAIL_CLOSED_SEQUENCE', rationale: '控制导引、输出预检与逐极反馈进入同一EDEM网表；候选板级拓扑不得自动选用。' }
      ],
      capabilities: {
        implementedStandards: IMPLEMENTED_STANDARDS.slice(), implementedArchetypes: IMPLEMENTED_ARCHETYPES.slice(),
        terminalLevelNetlist: true, conductorLevelAc: true, explicitDcPolarity: true,
        isolatedAuxDomains: true, rendererIndependent: true, realProjectReferenceTopology: true,
        outputPreenergizationDiagnostics: true, perPoleContactorFeedback: true,
        controlPilotFunctionalUnits: true, functionalSafetyStateMachine: true
      },
      instances: builder.instances, equipment: builder.instances, nets: builder.nets, circuits: builder.circuits,
      topology: {
        archetypeContract: {
          id: 'ess-mobile', templateVersion: '2.2.0',
          requiredKinds: mobileRequiredKinds,
          markerIds
        },
        mobileReference: {
          topologyId: 'ESS-MOBILE-0823', batteryBoxCount: 3, batteryBoxIds: batteryBoxes.slice(), heaterIds: heaters.slice(),
          heaterInterface, heaterInterfaces: [{ instanceId: heaterInterface, physicalPins: ['H02', 'H05'], boundary: 'HEATER_TWO_CORE_INTERFACE' }],
          moduleIds, moduleSizing, prechargeControlIntent, bcuObservedTerminals: clone(bcuObservedTerminals), gunBranches: gunEquipment,
          replenishment: {
            dcInlet: inletDc, acInlet: inletAc, inletLock, nacsModeInterlock, nacsPhysicalOwner, nacsPowerSelector,
            k4Negative, km2, acControlRelay, pcs, selectedStandard: std.id, acOutputProfile: clone(acOutput),
            assemblyMode, dcAssemblyId, acAssemblyId, powerModePolicy: nacsModeInterlock ? 'BREAK_BEFORE_MAKE_ALL_POLES' : null,
            modeStateMatrix: nacsModeInterlock ? clone(nacsModeStateMatrix) : null
          },
          contactors: { K1: k1, K2: k2, K3: k3, K4: k4, K5: k5, K6: k6, K7: gunEquipment[0].positiveContactor, K8: gunEquipment[0].negativeContactor, K9: k9, K10: k10, K4N: k4Negative },
          controlObjects: {
            bcu, vcu, evcc, secc, ocpp, router, antenna, display, cardReader, voiceBoard, speaker,
            lamps: [lampYellow, lampGreen, lampRed], temperatureSensor, selectorQt, externalConnector,
            externalChainRelay, fanRelay, fan, jt
          },
          referenceInterfaceConflict: 'FILENAME_GB—DRAWING_LABEL_CCS2—SELECTED_STANDARD_WINS'
        },
        acChain: [inletAc, acRcm, km1, pcs], dcChain: batteryBoxes.concat([fu1, k1, essBus]).concat(moduleIds, [chargeBus]),
        gunBranches: gunEquipment, splitCableLinks: [], comboObjects: [], essObjects: mobileObjects,
        functionalUnits: functionalUnits.map(clone),
        safetyStateMachine: safetyStateMachine(safetyBranches),
        earthBar: peBar, controlObjects: [bcu, vcu, evcc, secc, ocpp, router, antenna, display, cardReader, voiceBoard,
          speaker, lampYellow, lampGreen, lampRed, temperatureSensor, selectorQt, externalConnector,
          externalChainRelay, fanRelay, fan, jt]
      },
      sheets: docControl.drawingRegister.map((drawing) => ({ id: drawing.key, drawingNo: drawing.drawingNo, title: drawing.title, page: drawing.page })),
      ess: { enabled: true, coupling: 'mobile-dual-input', objectIds: mobileObjects.slice(), batteryBoxCount: 3 },
      domainConverters: DOMAIN_CONVERTERS.slice(),
      provenance: {
        engine: 'EVSE_ENGINE', engineVersion: spec.engineVersion || (window.EVSE_ENGINE && window.EVSE_ENGINE.ENGINE_VERSION) || 'UNSPECIFIED',
        requirementSource: requirements.source, componentCatalog: 'EVSE-CATALOG-' + catalog.VERSION,
        referenceTopology: ['国标储能充电桩电气原理图0823.svg', '欧标流储充桩电气原理图0823.png'],
        generatedAt: spec.generatedAt || null, calculationStatus: 'CONCEPTUAL—PROFESSIONAL_REVIEW_REQUIRED'
      }
    };
    model.modelHash = modelHash({
      schemaVersion: model.schemaVersion, requirements: model.requirements, instances: model.instances,
      nets: model.nets, circuits: model.circuits, assumptions: model.assumptions, decisions: model.decisions,
      capabilities: model.capabilities, topology: model.topology, ess: model.ess
    });
    model.modelValidation = window.EVSE_ERC ? window.EVSE_ERC.validate(model)
      : { id: 'EVSE-ERC-MISSING', status: 'BLOCKED', blockingCount: 1, checks: [], violations: [{ ruleId: 'ERC-000', code: 'ERC_MISSING', severity: 'BLOCK', message: 'EVSE_ERC 未加载。' }] };
    return model;
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
    if (p.archetype === 'ess-mobile') return createEssMobile(spec, catalog);

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
    const peExtraMembers = [];
    const peExtraEdges = [];
    const splitLocalAux = [];
    const splitCableLinks = [];
    const functionalUnits = [];
    const safetyBranches = [];

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
    const gatewayName = std.id === 'chademo' ? 'CHAdeMO 充电协议控制器'
      : std.physicalLayer === 'PLC' ? 'SECC 控制器' : '计费通信网关';
    const gateway = add('EQ-CTL-A2', 'A2', 'comm-gateway', gatewayName, 'control', { supplyVoltageV: 24 });
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
      const split = p.archetype === 'dc-split';
      const cableId = split ? 'CBL-G' + number : null;
      const cabinetInterface = split ? add('EQ-G' + number + '-IF-CAB', 'XG' + number + 'C', 'split-interface', '功率柜枪 ' + number + ' 电缆接口', 'split-cabinet', {}, { gun: number, boundaryRole: 'POWER_CABINET' }) : null;
      const terminalInterface = split ? add('EQ-G' + number + '-IF-TERM', 'XG' + number + 'T', 'split-interface', '充电终端 ' + number + ' 电缆接口', 'split-terminal', {}, { gun: number, boundaryRole: 'CHARGE_TERMINAL' }) : null;
      const localController = split ? add('EQ-G' + number + '-LCU', 'LCU' + number, 'charge-controller', '充电终端 ' + number + ' 本地控制器', 'split-terminal') : null;
      const branchController = localController || controller;
      const gunFuse = add('EQ-G' + number + '-F', gun.fuseTag || ('F' + number), 'dc-fuse', '枪 ' + number + ' 直流快熔', 'gun', { polarity: 'POSITIVE' }, { gun: number, ratedCurrentA: gun.fuseA });
      const kp = add('EQ-G' + number + '-KP', gun.contactorTagP || ('K' + number + 'P'), 'dc-contactor', '枪 ' + number + ' 正极接触器', 'gun', {
        polarity: 'POSITIVE', feedbackRequired: true, feedbackSignalRole: 'G' + number + ':POSITIVE_CONTACTOR_FEEDBACK'
      }, { gun: number, ratedCurrentA: gun.contactorA, requiredForSafeIsolation: true, poleId: 'DC_POS' });
      const kn = add('EQ-G' + number + '-KN', gun.contactorTagN || ('K' + number + 'N'), 'dc-contactor', '枪 ' + number + ' 负极接触器', 'gun', {
        polarity: 'NEGATIVE', feedbackRequired: true, feedbackSignalRole: 'G' + number + ':NEGATIVE_CONTACTOR_FEEDBACK'
      }, { gun: number, ratedCurrentA: gun.contactorA, requiredForSafeIsolation: true, poleId: 'DC_NEG' });
      const connector = add('EQ-G' + number + '-XS', gun.tag || ('XS' + number), 'charge-connector', '直流充电枪 ' + number, 'gun', {
        connectorType: std.connectorType, protocol: std.protocol, physicalLayer: std.physicalLayer
      }, {
        gun: number, currentA: gun.currentA, connectorType: std.connectorType, standardId: std.id,
        interfaceRole: 'CHARGING_OUTPUT',
        controlContract: outputControlContract(std.id + ':' + std.connectorType + ':DC_OUTPUT',
          Array.isArray(std.dcPins) && std.dcPins.includes('CP'), 'CHARGING_OUTPUT', [std.connector, std.protocol])
      });
      const lock = std.electronicLock === false ? null
        : add('EQ-G' + number + '-YV', gun.lockTag || ('YV' + number), 'connector-lock', '枪 ' + number + ' 电子锁', 'gun', {}, { gun: number });
      const branchAux24 = split ? { positive: [], return: [] } : aux24;
      const branchId = 'G' + number;
      const diagnostics = addOutputDiagnosticAssembly(builder, {
        add, aux24: branchAux24, connectorId: connector, controllerId: branchController, branchId,
        idPrefix: 'EQ-G' + number, tagSuffix: String(number), displayName: '枪 ' + number,
        controlPrefix: 'G' + number,
        safeIsolationDeviceIds: [kp, kn],
        monitoredPoles: [
          { deviceId: kp, poleId: 'DC_POS', upstreamTerminalId: 'IN', downstreamTerminalId: 'OUT', feedbackTerminalId: 'FEEDBACK' },
          { deviceId: kn, poleId: 'DC_NEG', upstreamTerminalId: 'IN', downstreamTerminalId: 'OUT', feedbackTerminalId: 'FEEDBACK' }
        ],
        powerContext: { powerType: 'DC', domain: 'HV_DC_CHARGE', voltageV: dcVoltage }
      });

      const branchPositiveSource = split ? endpoint(cabinetInterface, 'IN_DC_POS') : endpoint(gunFuse, 'IN');
      const branchNegativeSource = split ? endpoint(cabinetInterface, 'IN_DC_NEG') : endpoint(kn, 'IN');
      positiveBusMembers.push(branchPositiveSource);
      positiveBusEdges.push([endpoint(dcBus, 'BUS_DC_POS'), branchPositiveSource, { service: '枪 ' + number + ' 正极支路' }]);
      negativeBusMembers.push(branchNegativeSource);
      negativeBusEdges.push([endpoint(dcBus, 'BUS_DC_NEG'), branchNegativeSource, { service: '枪 ' + number + ' 负极支路' }]);
      if (split) {
        const cableMeta = { boundary: 'CABINET_TERMINAL_CABLE', cableId, gun: number };
        builder.wire(cableId + ' DC+', endpoint(cabinetInterface, 'OUT_DC_POS'), endpoint(terminalInterface, 'IN_DC_POS'), Object.assign({}, dcPos, cableMeta), cableMeta);
        builder.wire(cableId + ' DC−', endpoint(cabinetInterface, 'OUT_DC_NEG'), endpoint(terminalInterface, 'IN_DC_NEG'), Object.assign({}, dcNeg, cableMeta), cableMeta);
        builder.wire('终端 ' + number + ' DC+→快熔', endpoint(terminalInterface, 'OUT_DC_POS'), endpoint(gunFuse, 'IN'), dcPos);
        builder.wire('终端 ' + number + ' DC−→K−', endpoint(terminalInterface, 'OUT_DC_NEG'), endpoint(kn, 'IN'), dcNeg);

        ['P', 'N'].forEach((side) => {
          const role = 'SPLIT_LINK:' + side;
          const options = { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'SPLIT_TERMINAL_CAN', signalRole: role, electricalType: 'signal' };
          ensureSignal(builder, controller, 'G' + number + '_SPLIT_COMM_' + side, Object.assign({}, options, { direction: 'bidirectional' }));
          ensureSignal(builder, localController, 'CAB_COMM_' + side, Object.assign({}, options, { direction: 'bidirectional' }));
          wireSplitSignal(builder, '柜控→柜端接口 ' + side, endpoint(controller, 'G' + number + '_SPLIT_COMM_' + side), endpoint(cabinetInterface, 'IN_COMM_' + side), 'SPLIT_TERMINAL_CAN', role);
          wireSplitSignal(builder, cableId + ' 通信 ' + side, endpoint(cabinetInterface, 'OUT_COMM_' + side), endpoint(terminalInterface, 'IN_COMM_' + side), 'SPLIT_TERMINAL_CAN', role, cableMeta);
          wireSplitSignal(builder, '终端接口→LCU ' + side, endpoint(terminalInterface, 'OUT_COMM_' + side), endpoint(localController, 'CAB_COMM_' + side), 'SPLIT_TERMINAL_CAN', role);
        });
        ensureSignal(builder, controller, 'DO_G' + number + '_CABLE_INTERLOCK', { protocol: 'HARDWIRED_INTERLOCK', signalRole: 'SPLIT:INTERLOCK', direction: 'out' });
        ensureSignal(builder, localController, 'DI_CABLE_INTERLOCK', { protocol: 'HARDWIRED_INTERLOCK', signalRole: 'SPLIT:INTERLOCK', direction: 'in' });
        wireSplitSignal(builder, '柜控→柜端联锁', endpoint(controller, 'DO_G' + number + '_CABLE_INTERLOCK'), endpoint(cabinetInterface, 'IN_INTERLOCK'), 'HARDWIRED_INTERLOCK', 'SPLIT:INTERLOCK');
        wireSplitSignal(builder, cableId + ' 联锁', endpoint(cabinetInterface, 'OUT_INTERLOCK'), endpoint(terminalInterface, 'IN_INTERLOCK'), 'HARDWIRED_INTERLOCK', 'SPLIT:INTERLOCK', cableMeta);
        wireSplitSignal(builder, '终端接口→LCU 联锁', endpoint(terminalInterface, 'OUT_INTERLOCK'), endpoint(localController, 'DI_CABLE_INTERLOCK'), 'HARDWIRED_INTERLOCK', 'SPLIT:INTERLOCK');
      }
      builder.wire('枪 ' + number + ' FU→K+', endpoint(gunFuse, 'OUT'), endpoint(kp, 'IN'), dcPos);
      builder.addNode('枪 ' + number + ' K+ 后 DC+ 输出与安全取样', dcPos,
        [endpoint(kp, 'OUT'), endpoint(connector, 'DC_POS'),
          endpoint(diagnostics.precheckInstanceId, 'SENSE_DC_POS'), endpoint(diagnostics.stateMonitorInstanceId, 'SENSE_DC_POS')],
        [[endpoint(kp, 'OUT'), endpoint(connector, 'DC_POS')],
          [endpoint(kp, 'OUT'), endpoint(diagnostics.precheckInstanceId, 'SENSE_DC_POS'), { functionalRole: 'PRECHECK_DOWNSTREAM_SENSE' }],
          [endpoint(kp, 'OUT'), endpoint(diagnostics.stateMonitorInstanceId, 'SENSE_DC_POS'), { functionalRole: 'WELD_DOWNSTREAM_SENSE' }]]);
      builder.addNode('枪 ' + number + ' K− 后 DC− 输出与安全取样', dcNeg,
        [endpoint(kn, 'OUT'), endpoint(connector, 'DC_NEG'),
          endpoint(diagnostics.precheckInstanceId, 'SENSE_DC_NEG'), endpoint(diagnostics.stateMonitorInstanceId, 'SENSE_DC_NEG')],
        [[endpoint(kn, 'OUT'), endpoint(connector, 'DC_NEG')],
          [endpoint(kn, 'OUT'), endpoint(diagnostics.precheckInstanceId, 'SENSE_DC_NEG'), { functionalRole: 'PRECHECK_DOWNSTREAM_SENSE' }],
          [endpoint(kn, 'OUT'), endpoint(diagnostics.stateMonitorInstanceId, 'SENSE_DC_NEG'), { functionalRole: 'WELD_DOWNSTREAM_SENSE' }]]);
      addCoil(builder, branchController, kp, 'G' + number + '_KP', branchAux24);
      addCoil(builder, branchController, kn, 'G' + number + '_KN', branchAux24);
      if (lock) addAuxTarget(branchAux24, lock, 'PWR_V24', 'PWR_V24_0V');
      if (split) {
        addAuxTarget(aux24, cabinetInterface, 'IN_V24', 'IN_V24_0V');
        addAuxTarget(branchAux24, localController, 'PWR_V24', 'PWR_V24_0V');
        const cableMeta = { boundary: 'CABINET_TERMINAL_CABLE', cableId, gun: number };
        builder.wire(cableId + ' +24V', endpoint(cabinetInterface, 'OUT_V24'), endpoint(terminalInterface, 'IN_V24'), {
          netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE', boundary: cableMeta.boundary, cableId
        }, cableMeta);
        builder.wire(cableId + ' 0V', endpoint(cabinetInterface, 'OUT_V24_0V'), endpoint(terminalInterface, 'IN_V24_0V'), {
          netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 0, referenceVoltageV: 24, polarity: 'RETURN', boundary: cableMeta.boundary, cableId
        }, cableMeta);
        splitLocalAux.push({ number, cableId, sourcePositive: endpoint(terminalInterface, 'OUT_V24'), sourceReturn: endpoint(terminalInterface, 'OUT_V24_0V'), targets: branchAux24 });
        peTargets.push(endpoint(cabinetInterface, 'PE'));
        peExtraMembers.push(endpoint(terminalInterface, 'PE'), endpoint(connector, 'PE'));
        peExtraEdges.push(
          [endpoint(cabinetInterface, 'PE'), endpoint(terminalInterface, 'PE'), cableMeta],
          [endpoint(terminalInterface, 'PE'), endpoint(connector, 'PE'), { service: '终端保护接地' }]
        );
        splitCableLinks.push({ gun: number, cableId, cabinetInterface, terminalInterface, localController });
      } else {
        peTargets.push(endpoint(connector, 'PE'));
      }

      if (lock) {
        connectFixedToDynamic(builder, '枪 ' + number + ' 锁驱动', endpoint(lock, 'DRIVE'), branchController, 'DO_G' + number + '_LOCK', 'out');
        connectFixedToDynamic(builder, '枪 ' + number + ' 锁反馈', endpoint(lock, 'FEEDBACK'), branchController, 'DI_G' + number + '_LOCKED', 'in');
      }
      const connectorInstance = builder.instanceById.get(connector);
      let pilotAssembly = null;
      if (connectorInstance.terminals.some((terminal) => terminal.id === 'CP' && terminal.required)) {
        const pilotController = split ? branchController : (std.physicalLayer === 'PLC' ? gateway : branchController);
        pilotAssembly = addControlPilotAssembly(builder, {
          add, aux24: branchAux24, connectorId: connector, controllerId: pilotController, branchId,
          idPrefix: 'EQ-G' + number, tagSuffix: String(number), displayName: '枪 ' + number,
          controlPrefix: 'G' + number
        });
        functionalUnits.push(pilotAssembly);
      }
      connectorInstance.terminals.filter((terminal) => terminal.required && terminal.electricalType === 'signal').forEach((terminal) => {
        if (terminal.id === 'CP' && pilotAssembly) return;
        const receiver = split ? localController : (std.id === 'chademo' ? gateway : (terminal.id === 'CP' && std.physicalLayer === 'PLC' ? gateway : controller));
        const prefix = receiver === gateway ? 'G' + number + '_EV_' : 'G' + number + '_';
        connectFixedToDynamic(builder, '枪 ' + number + ' ' + terminal.label, endpoint(connector, terminal.id), receiver,
          prefix + terminal.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase(), 'bidirectional');
      });
      connectFixedToDynamic(builder, '枪 ' + number + ' 正接触器辅助反馈', endpoint(kp, 'FEEDBACK'), branchController,
        'DI_G' + number + '_KPOS_FEEDBACK', 'in');
      connectFixedToDynamic(builder, '枪 ' + number + ' 负接触器辅助反馈', endpoint(kn, 'FEEDBACK'), branchController,
        'DI_G' + number + '_KNEG_FEEDBACK', 'in');
      const charger12 = connectorInstance.terminals.find((terminal) => terminal.id === 'CHARGER_12V' && terminal.required);
      if (charger12) {
        const supply = add('EQ-G' + number + '-T12', 'T12-' + number, 'interface-12v-supply', '枪 ' + number + ' CHAdeMO 隔离受控 12V', split ? 'split-terminal' : 'gun', {}, { gun: number, isolatedInterfaceSupply: true });
        if (split) {
          const localDcdc = add('EQ-G' + number + '-T24-12', 'T24-12-' + number, 'aux-dc-converter', '终端 ' + number + ' 24V→12V', 'split-terminal', {}, { gun: number });
          const local = splitLocalAux[splitLocalAux.length - 1];
          addAuxTarget(local.targets, localDcdc, 'IN_V24', 'IN_V24_0V');
          builder.wire('终端 ' + number + ' 12V 电源+', endpoint(localDcdc, 'OUT_V12'), endpoint(supply, 'IN_V12'), {
            netClass: 'POWER_DC_AUX', domain: 'AUX_12V', nominalVoltageV: 12, referenceVoltageV: 12, polarity: 'POSITIVE'
          });
          builder.wire('终端 ' + number + ' 12V 电源0V', endpoint(localDcdc, 'OUT_V12_0V'), endpoint(supply, 'IN_V12_0V'), {
            netClass: 'POWER_DC_AUX', domain: 'AUX_12V', nominalVoltageV: 0, referenceVoltageV: 12, polarity: 'RETURN'
          });
        } else {
          addAuxTarget(aux12, supply, 'IN_V12', 'IN_V12_0V');
        }
        ensureSignal(builder, branchController === controller && std.id === 'chademo' ? gateway : branchController,
          'DO_G' + number + '_CHARGER_12V', { protocol: 'HARDWIRED_ENABLE', signalRole: 'CONNECTOR_12V:ENABLE', direction: 'out' });
        const supplyController = branchController === controller && std.id === 'chademo' ? gateway : branchController;
        builder.wire('枪 ' + number + ' Charger12V 受控使能', endpoint(supplyController, 'DO_G' + number + '_CHARGER_12V'), endpoint(supply, 'ENABLE'), {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'HARDWIRED_ENABLE', signalRole: 'CONNECTOR_12V:ENABLE'
        });
        builder.wire('枪 ' + number + ' 独立 Charger12V', endpoint(supply, 'CHARGER_12V'), endpoint(connector, 'CHARGER_12V'), {
          netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX_12V', nominalVoltageV: 12, referenceVoltageV: 12, polarity: 'POSITIVE'
        });
      }
      const diagnosticsRecord = finishOutputDiagnosticAssembly(builder, diagnostics, [
        { instanceId: connector, terminalId: 'DC_POS', position: 'CONTACTOR_DOWNSTREAM_CONNECTOR_SIDE' },
        { instanceId: connector, terminalId: 'DC_NEG', position: 'CONTACTOR_DOWNSTREAM_CONNECTOR_SIDE' }
      ]);
      functionalUnits.push(diagnosticsRecord);
      safetyBranches.push({
        branchId, connectorId: connector, safeIsolationDeviceIds: [kp, kn],
        controlPilotRequired: !!pilotAssembly,
        controlPilotFunctionalUnitId: pilotAssembly && pilotAssembly.id,
        outputDiagnosticFunctionalUnitId: diagnosticsRecord.id
      });
      gunEquipment.push({ gun: number, fuse: gunFuse, positiveContactor: kp, negativeContactor: kn, connector, lock,
        cabinetInterface, terminalInterface, localController, cableId, pilotAssembly, diagnostics: diagnosticsRecord });
    });

    /* ---------- ESS atomic protection topology ---------- */
    const essObjects = [];
    const comboObjects = [];
    let comboAcOutput = null;
    let fireSystem = null;
    const acBusExtraTargets = {};
    acConductors.forEach((phase) => { acBusExtraTargets[phase] = []; });
    if (p.archetype === 'ac-dc-combo') {
      const acOutput = std.acOutput || { connectorType: 'type2-ac', lineVoltage: acContext.voltageV, conductors: acConductors.slice(), controlPins: ['CP', 'PP'], requiresTransformer: false };
      const outputConductors = acOutput.conductors.slice();
      const sourceConductors = acOutput.requiresTransformer ? ['L1', 'L2'] : outputConductors.slice();
      const sourceContext = { voltageV: acContext.voltageV, conductors: sourceConductors, acDomain: 'AC_MAINS' };
      const outputDomain = acOutput.requiresTransformer ? 'AC_EV_OUTPUT' : 'AC_MAINS';
      const acBranchContext = {
        voltageV: acOutput.lineVoltage, conductors: outputConductors, acDomain: outputDomain,
        controlPins: acOutput.controlPins
      };
      const branchBreaker = add('EQ-AC-EV-QF1', 'QFAC1', 'ac-breaker', '交流充电支路断路器 QF', 'ac-ev', sourceContext, { ratedCurrentA: 63 });
      const branchTransformer = acOutput.requiresTransformer
        ? add('EQ-AC-EV-TX1', 'TXAC1', 'ac-ev-transformer', acContext.voltageV + 'V→' + acOutput.lineVoltage + 'V 交流充电隔离变压器', 'ac-ev', {
          inputConductors: sourceConductors, outputConductors, inputVoltageV: acContext.voltageV, outputVoltageV: acOutput.lineVoltage
        }, { ratedKva: Math.ceil(63 * acOutput.lineVoltage / 1000), isolationBoundary: 'AC_MAINS_TO_AC_EV_OUTPUT' })
        : null;
      const branchRcd = add('EQ-AC-EV-RCD1', 'RCDAC1', 'residual-current-monitor', '交流充电支路 Type B RCD', 'ac-ev', Object.assign({}, acBranchContext, { protocol: 'DRY_CONTACT' }), { spec: 'Type B / 30mA，额定值待项目复核' });
      const branchMeter = add('EQ-AC-EV-PJ1', 'PJAC1', 'ac-meter', '交流充电支路独立电能表', 'ac-ev', Object.assign({}, acBranchContext, { protocol: 'RS485' }), { spec: std.meter });
      const branchContactor = add('EQ-AC-EV-KM1', 'KMAC1', 'ac-contactor', '交流充电支路接触器', 'ac-ev', Object.assign({}, acBranchContext, {
        feedbackRequired: true, feedbackSignalRole: 'AC_EV:CONTACTOR_FEEDBACK'
      }), { ratedCurrentA: 63, requiredForSafeIsolation: true, poleId: 'ALL_AC_CONDUCTORS_MECHANICALLY_LINKED' });
      const branchController = add('EQ-AC-EV-A1', 'AAC1', 'charge-controller', '交流 EVSE 控制器', 'ac-ev');
      const branchConnector = add('EQ-AC-EV-XS1', 'XSAC1', 'ac-charge-connector', std.acConnector + '（逐导体）', 'ac-ev', acBranchContext, {
        standardId: std.id, connectorType: acOutput.connectorType, ratedCurrentA: 63,
        acOutputProfile: clone(acOutput), interfaceRole: 'CHARGING_OUTPUT',
        controlContract: outputControlContract(std.id + ':' + acOutput.connectorType + ':AC_OUTPUT',
          acOutput.controlPins.includes('CP'), 'CHARGING_OUTPUT', [std.acConnector, 'IEC_61851_CP'])
      });
      const acBranchId = 'AC-EV-1';
      const acDiagnostics = addOutputDiagnosticAssembly(builder, {
        add, aux24, connectorId: branchConnector, controllerId: branchController, branchId: acBranchId,
        idPrefix: 'EQ-AC-EV', tagSuffix: '-AC1', displayName: '交流输出 1', controlPrefix: 'AC_EV_1',
        safeIsolationDeviceIds: [branchContactor],
        monitoredPoles: outputConductors.map((phase) => ({
          deviceId: branchContactor, poleId: phase, upstreamTerminalId: 'IN_' + phase,
          downstreamTerminalId: 'OUT_' + phase, feedbackTerminalId: 'FEEDBACK',
          mechanicallyLinkedGroup: 'AC_EV_KM1_ALL_POLES'
        })),
        powerContext: { powerType: 'AC', conductors: outputConductors, acDomain: outputDomain, voltageV: acOutput.lineVoltage }
      });
      comboObjects.push(branchBreaker);
      if (branchTransformer) comboObjects.push(branchTransformer);
      comboObjects.push(branchRcd, branchMeter, branchContactor, branchController, branchConnector,
        acDiagnostics.precheckInstanceId, acDiagnostics.stateMonitorInstanceId);
      addAuxTarget(aux24, branchController, 'PWR_V24', 'PWR_V24_0V');
      addCoil(builder, branchController, branchContactor, 'AC_EV_KM1', aux24);
      peTargets.push(endpoint(branchConnector, 'PE'));
      if (branchTransformer) peTargets.push(endpoint(branchTransformer, 'PE'));
      sourceConductors.forEach((phase) => {
        acBusExtraTargets[phase].push(endpoint(branchBreaker, 'IN_' + phase));
        if (branchTransformer) {
          builder.wire('AC EV QF→TX ' + phase, endpoint(branchBreaker, 'OUT_' + phase), endpoint(branchTransformer, 'IN_' + phase), acSem(phase));
        }
      });
      outputConductors.forEach((phase) => {
        const outputSem = { netClass: 'POWER_AC', domain: outputDomain, phase, ratedVoltageV: acOutput.lineVoltage };
        if (branchTransformer) {
          builder.wire('AC EV TX→RCD ' + phase, endpoint(branchTransformer, 'OUT_' + phase), endpoint(branchRcd, 'IN_' + phase), outputSem);
        } else {
          builder.wire('AC EV QF→RCD ' + phase, endpoint(branchBreaker, 'OUT_' + phase), endpoint(branchRcd, 'IN_' + phase), outputSem);
        }
        builder.wire('AC EV RCD→PJ ' + phase, endpoint(branchRcd, 'OUT_' + phase), endpoint(branchMeter, 'IN_' + phase), outputSem);
        builder.wire('AC EV PJ→KM ' + phase, endpoint(branchMeter, 'OUT_' + phase), endpoint(branchContactor, 'IN_' + phase), outputSem);
        builder.addNode('AC EV KM 后 ' + phase + ' 输出与安全取样', outputSem,
          [endpoint(branchContactor, 'OUT_' + phase), endpoint(branchConnector, 'AC_' + phase),
            endpoint(acDiagnostics.precheckInstanceId, 'SENSE_' + phase), endpoint(acDiagnostics.stateMonitorInstanceId, 'SENSE_' + phase)],
          [[endpoint(branchContactor, 'OUT_' + phase), endpoint(branchConnector, 'AC_' + phase)],
            [endpoint(branchContactor, 'OUT_' + phase), endpoint(acDiagnostics.precheckInstanceId, 'SENSE_' + phase), { functionalRole: 'PRECHECK_DOWNSTREAM_SENSE' }],
            [endpoint(branchContactor, 'OUT_' + phase), endpoint(acDiagnostics.stateMonitorInstanceId, 'SENSE_' + phase), { functionalRole: 'WELD_DOWNSTREAM_SENSE' }]]);
      });
      ['P', 'N'].forEach((side) => {
        connectFixedToDynamic(builder, 'AC EV RCD 状态 ' + side, endpoint(branchRcd, 'SIGNAL_' + side), branchController, 'RCD_STATUS_' + side, 'in');
        connectFixedToDynamic(builder, 'AC EV 电表 RS485 ' + side, endpoint(branchMeter, 'COMM_' + side), branchController, 'METER_' + side, 'bidirectional');
      });
      let acPilotAssembly = null;
      if (acOutput.controlPins.includes('CP')) {
        acPilotAssembly = addControlPilotAssembly(builder, {
          add, aux24, connectorId: branchConnector, controllerId: branchController, branchId: acBranchId,
          idPrefix: 'EQ-AC-EV', tagSuffix: '-AC1', displayName: '交流输出 1', controlPrefix: 'AC_EV_1'
        });
        functionalUnits.push(acPilotAssembly);
        comboObjects.push(...acPilotAssembly.instanceIds);
      }
      acOutput.controlPins.forEach((terminalId) => {
        if (terminalId === 'CP' && acPilotAssembly) return;
        connectFixedToDynamic(builder, 'AC EV ' + terminalId, endpoint(branchConnector, terminalId), branchController, terminalId, 'bidirectional');
      });
      connectFixedToDynamic(builder, 'AC EV 接触器辅助反馈', endpoint(branchContactor, 'FEEDBACK'), branchController,
        'DI_AC_EV_KM1_FEEDBACK', 'in');
      const acDiagnosticsRecord = finishOutputDiagnosticAssembly(builder, acDiagnostics,
        outputConductors.map((phase) => ({ instanceId: branchConnector, terminalId: 'AC_' + phase, position: 'CONTACTOR_DOWNSTREAM_CONNECTOR_SIDE' })));
      functionalUnits.push(acDiagnosticsRecord);
      safetyBranches.push({
        branchId: acBranchId, connectorId: branchConnector, safeIsolationDeviceIds: [branchContactor],
        controlPilotRequired: !!acPilotAssembly,
        controlPilotFunctionalUnitId: acPilotAssembly && acPilotAssembly.id,
        outputDiagnosticFunctionalUnitId: acDiagnosticsRecord.id
      });
      comboAcOutput = clone(acOutput);
    }
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
      (acBusExtraTargets[phase] || []).forEach((target) => { members.push(target); edges.push([hub, target, { service: p.archetype === 'ac-dc-combo' ? '交流充电/储能支路' : '储能交流耦合' }]); });
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
    splitLocalAux.forEach((local) => {
      const positiveMembers = [local.sourcePositive].concat(local.targets.positive);
      const positiveEdges = local.targets.positive.map((target) => [local.sourcePositive, target, { service: '终端 ' + local.number + ' 本地 24V' }]);
      builder.addNode('终端 ' + local.number + ' 本地 +24V', {
        netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE'
      }, positiveMembers, positiveEdges);
      const returnMembers = [local.sourceReturn].concat(local.targets.return);
      const returnEdges = local.targets.return.map((target) => [local.sourceReturn, target, { service: '终端 ' + local.number + ' 本地 0V' }]);
      builder.addNode('终端 ' + local.number + ' 本地 0V', {
        netClass: 'POWER_DC_AUX', domain: 'AUX_24V', nominalVoltageV: 0, referenceVoltageV: 24, polarity: 'RETURN'
      }, returnMembers, returnEdges);
    });

    /* ---------- PE is one explicit node, never an alias for DC− ---------- */
    const peMembers = [endpoint(incomer, 'PE'), endpoint(peBar, 'PE'), endpoint(spd, 'PE'), endpoint(imd, 'PE')].concat(peTargets, peExtraMembers);
    const peEdges = [[endpoint(incomer, 'PE'), endpoint(peBar, 'PE')], [endpoint(peBar, 'PE'), endpoint(spd, 'PE')], [endpoint(peBar, 'PE'), endpoint(imd, 'PE')]]
      .concat(peTargets.map((target) => [endpoint(peBar, 'PE'), target]), peExtraEdges);
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

    const contractByArchetype = {
      'dc-integrated': {
        requiredKinds: ['ac-incomer', 'power-module-array', 'dc-busbar', 'charge-connector',
          'output-precheck-monitor', 'contactor-state-monitor'],
        markerIds: ['EQ-AC-IN', 'EQ-PM', 'EQ-DC-BUS']
      },
      'dc-split': {
        requiredKinds: ['power-module-array', 'dc-busbar', 'split-interface', 'charge-controller', 'charge-connector',
          'output-precheck-monitor', 'contactor-state-monitor'],
        markerIds: splitCableLinks.flatMap((link) => [link.cabinetInterface, link.terminalInterface, link.localController])
      },
      'ac-dc-combo': {
        requiredKinds: ['power-module-array', 'charge-connector', 'ac-breaker', 'residual-current-monitor', 'ac-meter', 'ac-contactor', 'ac-charge-connector',
          'control-pilot-generator', 'control-pilot-monitor', 'vehicle-diode-detector',
          'output-precheck-monitor', 'contactor-state-monitor'],
        markerIds: ['EQ-AC-EV-QF1', 'EQ-AC-EV-RCD1', 'EQ-AC-EV-PJ1', 'EQ-AC-EV-KM1', 'EQ-AC-EV-A1', 'EQ-AC-EV-XS1']
      }
    };
    const archetypeContract = Object.assign({ id: p.archetype, templateVersion: '1.1.0' }, contractByArchetype[p.archetype] || {
      requiredKinds: [], markerIds: []
    });
    if (functionalUnits.some((unit) => unit.type === 'CONTROL_PILOT_INTERFACE')) {
      ['control-pilot-generator', 'control-pilot-monitor', 'vehicle-diode-detector'].forEach((kind) => {
        if (!archetypeContract.requiredKinds.includes(kind)) archetypeContract.requiredKinds.push(kind);
      });
    }

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
    const modelAssumptions = clone(spec.assumptions || []);
    if (comboAcOutput) modelAssumptions.push({
      id: 'AC-EV-BRANCH-RATING',
      value: '63A @ ' + comboAcOutput.lineVoltage + 'V / ' + comboAcOutput.connectorType,
      note: '交流充电支路 63A 为未提供专用输入时的方案级假设；电压、地区接口与北美隔离变压器容量须在项目深化时确认。',
      status: 'ASSUMPTION'
    });
    modelAssumptions.push({
      id: 'FUNCTIONAL-SAFETY-BOARD-IMPLEMENTATION',
      value: 'TOPOLOGY_VALUES_THRESHOLDS_AND_TIMING_UNRESOLVED',
      note: 'CP发生/采样、车辆二极管检查、输出预检与粘连监测已建立端子级功能合同；板级变体、器件值、阈值和时序必须由项目工程师选型计算并复核，平台不得自动猜测。',
      status: 'ASSUMPTION'
    });
    const model = {
      schema: 'EVSE-EDEM/4.1',
      schemaVersion: SCHEMA_VERSION,
      project: { id: projectId, name: p.pileName || '充电桩', site: p.site || '', status: 'CONCEPT_DRAFT', referenceDesignation: docControl.projectReference },
      documentControl: docControl,
      requirements,
      assumptions: modelAssumptions,
      decisions: [
        { id: 'DEC-SOURCE-OF-TRUTH', value: 'EDEM_V4_1_TERMINAL_NETLIST', rationale: '绘图与 DXF 必须引用同一 instances/nets/circuits。' },
        { id: 'DEC-ROUTING', value: 'CHANNEL_INTERVAL_LANES', rationale: '几何路由不得推断或改写电气连接。' },
        { id: 'DEC-COMPONENT-AI', value: 'DRAFT_REVIEW_APPROVE', rationale: 'AI 导入器件只能生成隔离草稿，批准后才能进入受控目录。' },
        { id: 'DEC-FUNCTIONAL-SAFETY', value: 'EXACT_TERMINALS_AND_FAIL_CLOSED_SEQUENCE', rationale: '控制导引、输出预检与逐极反馈进入同一EDEM网表；候选板级拓扑不得自动选用。' }
      ],
      capabilities: {
        implementedStandards: IMPLEMENTED_STANDARDS.slice(),
        implementedArchetypes: IMPLEMENTED_ARCHETYPES.slice(),
        terminalLevelNetlist: true,
        conductorLevelAc: true,
        explicitDcPolarity: true,
        isolatedAuxDomains: true,
        rendererIndependent: true,
        outputPreenergizationDiagnostics: true,
        perPoleContactorFeedback: true,
        controlPilotFunctionalUnits: true,
        functionalSafetyStateMachine: true
      },
      instances: builder.instances,
      equipment: builder.instances,
      nets: builder.nets,
      circuits: builder.circuits,
      topology: {
        archetypeContract,
        acChain: [incomer, isolator, breaker, rcm, acMeter, acContactor, acBus],
        dcChain: [modules, dcFuse, dcSensor, dcMeter, dcBus],
        gunBranches: gunEquipment,
        splitCableLinks,
        comboObjects,
        comboAcOutput,
        essObjects,
        functionalUnits: functionalUnits.map(clone),
        safetyStateMachine: safetyStateMachine(safetyBranches),
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
