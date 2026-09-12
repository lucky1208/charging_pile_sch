/* ============================================================
 * EVSE multi-sheet schematic document planner
 * ------------------------------------------------------------
 * The EDEM remains the only electrical source of truth. This module only
 * produces deterministic presentation projections and exact off-page
 * connector records. It never invents, aliases, drops, or repairs a circuit.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) {
    root.SCHEMATIC_DOCUMENT = api;
    root.SCHEMATIC_FORGE_DOCUMENT = api;
  }
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'SCHEMATIC-DOCUMENT/1.0';
  const PROJECTION_SCHEMA = 'SCHEMATIC-SHEET-PROJECTION/1.0';
  const SHEET_RULES = Object.freeze([
    Object.freeze({ id: 'S01', key: 'AC_INPUT', order: 10, drawingNo: 'EVSE-01',
      title: '交流进线、保护与计量 / AC input, protection & metering',
      purpose: '电网进线、隔离、断路、浪涌、剩余电流、计量、交流主接触器与PE基准。' }),
    Object.freeze({ id: 'S02', key: 'POWER_CONVERSION', order: 20, drawingNo: 'EVSE-02',
      title: '功率变换与直流母线 / Power conversion & DC bus',
      purpose: '功率模块、直流总保护、传感、计量、绝缘监测、母线与泄放。' }),
    Object.freeze({ id: 'S03', key: 'OUTPUT', order: 30, drawingNo: 'EVSE-03',
      title: '充电输出与车辆接口 / Charging outputs & vehicle interface',
      purpose: '逐枪支路保护、逐极隔离、锁止与车辆物理接口。' }),
    Object.freeze({ id: 'S04', key: 'ENERGY_STORAGE', order: 40, drawingNo: 'EVSE-04',
      title: '储能与补电 / Energy storage & replenishment',
      purpose: '电池、预充、储能母线、PCS/DC-DC、加热与补电输入安全链。' }),
    Object.freeze({ id: 'S05', key: 'AUXILIARY', order: 50, drawingNo: 'EVSE-05',
      title: '辅助电源与热管理 / Auxiliary power & thermal',
      purpose: '隔离辅助供电、辅助母线、热管理与低压执行负载。' }),
    Object.freeze({ id: 'S06', key: 'CONTROL_SAFETY', order: 60, drawingNo: 'EVSE-06',
      title: '控制、通信与安全诊断 / Control, communication & safety',
      purpose: '控制器、通信、人机界面、联锁、输出预检与逐极状态反馈。' })
  ]);

  function text(value) { return String(value == null ? '' : value).trim(); }
  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach((key) => { out[key] = clone(value[key]); });
      return out;
    }
    return value;
  }
  function compare(left, right) { return text(left).localeCompare(text(right), 'en'); }
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const out = {};
      // Keep byte-for-byte parity with EVSE_DESIGN.modelHash.  Locale-aware
      // ordering is presentation-friendly but can order mixed-case/underscore
      // keys differently from ECMAScript's deterministic code-unit sort.
      Object.keys(value).sort().forEach((key) => { out[key] = stable(value[key]); });
      return out;
    }
    return value;
  }
  function hash(value) {
    const source = JSON.stringify(stable(value));
    let result = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      result ^= source.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return 'fnv1a32-' + (result >>> 0).toString(16).padStart(8, '0');
  }
  function authoritativeModelHash(design) {
    return hash({
      schemaVersion: design && design.schemaVersion,
      requirements: design && design.requirements,
      instances: design && design.instances,
      nets: design && design.nets,
      circuits: design && design.circuits,
      assumptions: design && design.assumptions,
      decisions: design && design.decisions,
      capabilities: design && design.capabilities,
      topology: design && design.topology,
      ess: design && design.ess
    });
  }
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }
  function endpoint(instanceId, terminalId) {
    const instance = text(instanceId); const terminal = text(terminalId);
    return { instanceId: instance, terminalId: terminal, endpointKey: instance + ':' + terminal };
  }

  function assertDesign(design) {
    if (!design || typeof design !== 'object') throw new Error('A complete authoritative EDEM design is required.');
    if (!/^EVSE-EDEM\//.test(text(design.schema))) throw new Error('Unsupported authoritative model schema: ' + text(design.schema));
    if (!text(design.modelHash)) throw new Error('Authoritative EDEM modelHash is required.');
    const expectedModelHash = authoritativeModelHash(design);
    if (text(design.modelHash) !== expectedModelHash) {
      throw new Error('Authoritative EDEM modelHash does not match the current model content.');
    }
    const instances = Array.isArray(design.instances) ? design.instances : [];
    const nets = Array.isArray(design.nets) ? design.nets : [];
    const circuits = Array.isArray(design.circuits) ? design.circuits : [];
    if (!instances.length || !nets.length || !circuits.length) throw new Error('EDEM instances, nets and circuits must be non-empty.');
    const instanceById = new Map();
    instances.forEach((instance) => {
      const id = text(instance && instance.id);
      if (!id || instanceById.has(id)) throw new Error('Invalid or duplicate instance id: ' + id);
      instanceById.set(id, instance);
    });
    const netIds = new Set();
    nets.forEach((net) => {
      const id = text(net && net.id);
      if (!id || netIds.has(id)) throw new Error('Invalid or duplicate net id: ' + id);
      netIds.add(id);
    });
    const circuitIds = new Set();
    circuits.forEach((circuit) => {
      const id = text(circuit && circuit.id);
      if (!id || circuitIds.has(id)) throw new Error('Invalid or duplicate circuit id: ' + id);
      circuitIds.add(id);
      if (!netIds.has(text(circuit.netId))) throw new Error('Circuit ' + id + ' references unknown net ' + text(circuit.netId));
      [['from', 'fromPort'], ['to', 'toPort']].forEach((pair) => {
        const instanceId = text(circuit[pair[0]]); const terminalId = text(circuit[pair[1]]);
        const instance = instanceById.get(instanceId);
        if (!instance) throw new Error('Circuit ' + id + ' references unknown instance ' + instanceId);
        const terminals = instance.terminals || instance.physicalTerminals || instance.ports || [];
        if (!terminalId || !terminals.some((terminal) => text(terminal && terminal.id) === terminalId)) {
          throw new Error('Circuit ' + id + ' references unknown terminal ' + instanceId + ':' + terminalId);
        }
      });
    });
    return { instances, nets, circuits, instanceById };
  }

  function sheetIdFor(instance) {
    const system = text(instance && instance.system).toLowerCase();
    const kind = text(instance && (instance.kind || instance.type)).toLowerCase();
    const id = text(instance && instance.id).toUpperCase();
    if (system === 'gun' || /charge-connector|split-interface/.test(kind) || /^EQ-G\d+[-_]/.test(id)) return 'S03';
    if (system === 'ess' || system === 'replenishment' || /^(ess-|battery|precharge)/.test(kind) || /storage/.test(system)) return 'S04';
    if (system === 'aux' || /^(aux-|thermal)/.test(kind)) return 'S05';
    if (system === 'ac' || system === 'earth' ||
        /ac-incomer|ac-isolator|ac-breaker|surge-protector|residual-current|ac-meter|ac-contactor|ac-busbar|earth-bar|four-pole-safety/.test(kind)) return 'S01';
    if (system === 'dc' || /insulation-monitor|dc-meter|dc-busbar|dc-discharge|dc-current/.test(kind)) return 'S02';
    if (/control|comm|safety|diagnostic/.test(system) ||
        /controller|gateway|hmi|sensor|monitor|relay|lamp|display|reader|speaker|antenna|selector|voice/.test(kind)) return 'S06';
    return 'S02';
  }

  function offPageConnector(circuit, side, localSheet, remoteSheet) {
    const from = endpoint(circuit.from, circuit.fromPort);
    const to = endpoint(circuit.to, circuit.toPort);
    const isSource = side === 'SOURCE';
    const id = 'OPC:' + text(circuit.id) + ':' + side;
    const peerId = 'OPC:' + text(circuit.id) + ':' + (isSource ? 'TARGET' : 'SOURCE');
    return {
      id, role: side, direction: isSource ? 'OUTGOING' : 'INCOMING',
      circuitId: text(circuit.id), netId: text(circuit.netId), netClass: text(circuit.netClass),
      from, to, localEndpoint: isSource ? from : to, remoteEndpoint: isSource ? to : from,
      localSheetId: localSheet.id, remoteSheetId: remoteSheet.id,
      peerConnectorId: peerId,
      xref: { connectorId: peerId, sheetId: remoteSheet.id, page: remoteSheet.page,
        drawingNo: remoteSheet.drawingNo, endpointKey: (isSource ? to : from).endpointKey }
    };
  }

  function gateStatus(value, missingCode) {
    if (value === true) return { status: 'PASS', code: 'PASS' };
    if (value === false || value == null) return { status: 'BLOCKED', code: missingCode };
    const blocking = Number(value.blockingCount || 0);
    const explicit = text(value.status).toUpperCase();
    const denied = value.allowed === false || value.ok === false || blocking > 0 || explicit === 'BLOCKED' || explicit === 'FAIL';
    if (denied) return { status: 'BLOCKED', code: text(value.code) || 'BLOCKED', blockingCount: Math.max(1, blocking) };
    if (value.allowed === true || value.ok === true || explicit === 'PASS') return { status: 'PASS', code: text(value.code) || 'PASS', blockingCount: 0 };
    if (explicit === 'REVIEW_REQUIRED' || explicit === 'WARN' || explicit === 'WARNING') {
      return { status: 'REVIEW_REQUIRED', code: text(value.code) || explicit, blockingCount: 0 };
    }
    return { status: 'BLOCKED', code: missingCode, blockingCount: 1 };
  }

  function pageGate(sheetId, gates) {
    const collection = gates && gates.pages;
    const supplied = Array.isArray(collection)
      ? collection.find((item) => item && (item.id === sheetId || item.sheetId === sheetId))
      : collection && collection[sheetId];
    const drawing = gateStatus(supplied && supplied.drawing, 'DRAWING_GATE_NOT_EVALUATED');
    const quality = gateStatus(supplied && supplied.quality, 'QUALITY_GATE_NOT_EVALUATED');
    const coverage = gateStatus(supplied && supplied.coverage, 'PAGE_COVERAGE_NOT_EVALUATED');
    const status = [drawing, quality, coverage].some((item) => item.status === 'BLOCKED') ? 'BLOCKED' :
      [drawing, quality, coverage].some((item) => item.status === 'REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' : 'PASS';
    return { status, drawing, quality, coverage };
  }

  function compile(designOrResult, gateInput) {
    const wrapper = designOrResult && designOrResult.design ? designOrResult : null;
    const design = wrapper ? wrapper.design : designOrResult;
    const gates = gateInput || (wrapper && wrapper.gates) || {};
    const checked = assertDesign(design);
    const sheets = SHEET_RULES.map((rule, index) => Object.assign({}, rule, {
      page: index + 1, total: SHEET_RULES.length, instanceIds: [], internalCircuitIds: [],
      crossCircuitIds: [], offPageConnectors: []
    }));
    const sheetById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    const instanceToSheet = new Map();
    checked.instances.slice().sort((a, b) => compare(a.id, b.id)).forEach((instance) => {
      const sheetId = sheetIdFor(instance);
      instanceToSheet.set(instance.id, sheetId);
      sheetById.get(sheetId).instanceIds.push(instance.id);
    });
    const coverageManifest = [];
    const crossSheetCircuits = [];
    checked.circuits.slice().sort((a, b) => compare(a.id, b.id)).forEach((circuit) => {
      const fromSheet = sheetById.get(instanceToSheet.get(circuit.from));
      const toSheet = sheetById.get(instanceToSheet.get(circuit.to));
      if (fromSheet.id === toSheet.id) {
        fromSheet.internalCircuitIds.push(circuit.id);
        coverageManifest.push({ circuitId: circuit.id, netId: circuit.netId, representation: 'INTERNAL_ROUTE',
          sheetId: fromSheet.id, routeId: circuit.id });
        return;
      }
      const sourceConnector = offPageConnector(circuit, 'SOURCE', fromSheet, toSheet);
      const targetConnector = offPageConnector(circuit, 'TARGET', toSheet, fromSheet);
      fromSheet.crossCircuitIds.push(circuit.id); toSheet.crossCircuitIds.push(circuit.id);
      fromSheet.offPageConnectors.push(sourceConnector); toSheet.offPageConnectors.push(targetConnector);
      const crossEntry = { circuitId: circuit.id, netId: circuit.netId, netClass: text(circuit.netClass),
        from: sourceConnector.from, to: sourceConnector.to, sourceSheetId: fromSheet.id, targetSheetId: toSheet.id,
        sourceConnectorId: sourceConnector.id, targetConnectorId: targetConnector.id };
      crossSheetCircuits.push(crossEntry);
      coverageManifest.push({ circuitId: circuit.id, netId: circuit.netId, representation: 'OFF_PAGE_PAIR',
        sourceSheetId: fromSheet.id, targetSheetId: toSheet.id,
        connectorIds: [sourceConnector.id, targetConnector.id] });
    });

    const instanceById = checked.instanceById;
    const circuitById = new Map(checked.circuits.map((item) => [item.id, item]));
    const netById = new Map(checked.nets.map((item) => [item.id, item]));
    sheets.forEach((sheet) => {
      sheet.instanceIds.sort(compare); sheet.internalCircuitIds.sort(compare);
      sheet.crossCircuitIds = Array.from(new Set(sheet.crossCircuitIds)).sort(compare);
      sheet.offPageConnectors.sort((a, b) => compare(a.id, b.id));
      const visibleNetIds = new Set();
      sheet.internalCircuitIds.concat(sheet.crossCircuitIds).forEach((id) => visibleNetIds.add(circuitById.get(id).netId));
      sheet.modelProjection = {
        schema: PROJECTION_SCHEMA, sourceSchema: design.schema, sourceModelHash: design.modelHash,
        sheetId: sheet.id,
        instances: sheet.instanceIds.map((id) => clone(instanceById.get(id))),
        nets: Array.from(visibleNetIds).sort(compare).map((id) => clone(netById.get(id))),
        internalCircuits: sheet.internalCircuitIds.map((id) => clone(circuitById.get(id))),
        offPageConnectors: clone(sheet.offPageConnectors)
      };
      sheet.gate = pageGate(sheet.id, gates);
    });

    coverageManifest.sort((a, b) => compare(a.circuitId, b.circuitId));
    crossSheetCircuits.sort((a, b) => compare(a.circuitId, b.circuitId));
    const uniqueCoverage = new Set(coverageManifest.map((item) => item.circuitId));
    const crossCoverageOk = coverageManifest.length === checked.circuits.length && uniqueCoverage.size === checked.circuits.length &&
      crossSheetCircuits.every((entry) => {
        const source = sheetById.get(entry.sourceSheetId).offPageConnectors.find((item) => item.id === entry.sourceConnectorId);
        const target = sheetById.get(entry.targetSheetId).offPageConnectors.find((item) => item.id === entry.targetConnectorId);
        return !!source && !!target && source.peerConnectorId === target.id && target.peerConnectorId === source.id &&
          source.circuitId === target.circuitId && source.netId === target.netId &&
          source.from.endpointKey === target.from.endpointKey && source.to.endpointKey === target.to.endpointKey;
      });
    const computedCrossGate = crossCoverageOk
      ? { status: 'PASS', code: 'EXACT_CIRCUIT_REPRESENTATION', blockingCount: 0 }
      : { status: 'BLOCKED', code: 'CROSS_PAGE_COVERAGE_INVALID', blockingCount: 1 };
    const externalCrossGate = gates && Object.prototype.hasOwnProperty.call(gates, 'crossPageCoverage')
      ? gateStatus(gates.crossPageCoverage, 'CROSS_PAGE_GATE_NOT_EVALUATED') : { status: 'PASS', code: 'NOT_OVERRIDDEN', blockingCount: 0 };
    const crossPageGate = computedCrossGate.status === 'BLOCKED' || externalCrossGate.status === 'BLOCKED'
      ? { status: 'BLOCKED', computed: computedCrossGate, external: externalCrossGate }
      : { status: externalCrossGate.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'PASS', computed: computedCrossGate, external: externalCrossGate };
    const modelGate = gateStatus(gates.model || gates.erc || design.modelValidation, 'MODEL_ERC_NOT_EVALUATED');
    const blockedSheets = sheets.filter((sheet) => sheet.gate.status === 'BLOCKED').map((sheet) => sheet.id);
    const projectStatus = modelGate.status === 'BLOCKED' || crossPageGate.status === 'BLOCKED' || blockedSheets.length ? 'BLOCKED' :
      modelGate.status === 'REVIEW_REQUIRED' || crossPageGate.status === 'REVIEW_REQUIRED' ||
        sheets.some((sheet) => sheet.gate.status === 'REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' : 'PASS';
    const projectGate = {
      status: projectStatus, allowed: projectStatus !== 'BLOCKED', model: modelGate,
      pages: sheets.map((sheet) => ({ sheetId: sheet.id, status: sheet.gate.status, gate: clone(sheet.gate) })),
      crossPageCoverage: crossPageGate, blockedSheetIds: blockedSheets
    };
    const result = {
      schema: SCHEMA, version: VERSION, sourceSchema: design.schema, sourceModelHash: design.modelHash,
      status: projectStatus, sheets, crossSheetCircuits, coverageManifest, projectGate,
      statistics: {
        sheetCount: sheets.length, instanceCount: checked.instances.length, circuitCount: checked.circuits.length,
        internalCircuitCount: coverageManifest.filter((item) => item.representation === 'INTERNAL_ROUTE').length,
        crossSheetCircuitCount: crossSheetCircuits.length, offPageConnectorCount: crossSheetCircuits.length * 2,
        blockedSheetCount: blockedSheets.length
      }
    };
    result.documentHash = hash(result);
    return deepFreeze(result);
  }

  return Object.freeze({
    VERSION, SCHEMA, PROJECTION_SCHEMA, SHEET_RULES,
    compile, build: compile, plan: compile, hash, authoritativeModelHash, sheetIdFor
  });
});
