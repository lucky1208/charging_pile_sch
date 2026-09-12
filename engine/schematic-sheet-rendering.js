/* ============================================================
 * Non-authoritative multi-sheet rendering projection
 * ------------------------------------------------------------
 * The EDEM remains immutable and authoritative.  This module derives a
 * bounded graphical model for one sheet, splits high-fan-out symbols into
 * traceable graphic units, and terminates every cross-sheet circuit on an
 * explicit IEC 61082-style continuation reference.  It never invents or
 * merges an electrical circuit.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  let nodeDependencies = null;
  if (typeof window === 'undefined' && typeof module === 'object' && module && module.exports && typeof require === 'function') {
    require('./color-scheme.js');
    require('./symbols.js');
    nodeDependencies = {
      document: require('./schematic-document.js'),
      placement: require('./schematic-placement.js'),
      drawingIR: require('./drawing-ir.js'),
      renderer: require('./svg-ir-renderer.js'),
      renderedSvgAudit: require('./rendered-svg-audit.js'),
      visualQualityAudit: require('./visual-quality-audit.js')
    };
  }
  const api = factory(root, nodeDependencies);
  if (root) {
    root.EVSE_SCHEMATIC_SHEET_RENDERING = api;
    root.SCHEMATIC_FORGE_SHEET_RENDERING = api;
  }
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (root, nodeDependencies) {
  'use strict';

  const VERSION = '1.1.0';
  const SCHEMA = 'SCHEMATIC-SHEET-RENDERING/1.0';
  const PAGE_MODEL_SCHEMA = 'SCHEMATIC-GRAPHICAL-PROJECTION/1.0';
  const DEFAULT_MAX_ENDPOINTS = 14;

  class SheetRenderingError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'SheetRenderingError';
      this.code = code;
      this.details = details || {};
    }
  }

  function runtime() {
    const dependencies = nodeDependencies || {};
    const value = {
      document: dependencies.document || (root && root.SCHEMATIC_DOCUMENT),
      placement: dependencies.placement || (root && root.EVSE_SCHEMATIC_PLACEMENT),
      drawingIR: dependencies.drawingIR || (root && root.EVSE_DRAWING_IR),
      renderer: dependencies.renderer || (root && root.EVSE_SVG_IR_RENDERER),
      renderedSvgAudit: dependencies.renderedSvgAudit || (root && root.EVSE_RENDERED_SVG_AUDIT),
      visualQualityAudit: dependencies.visualQualityAudit || (root && root.EVSE_VISUAL_QUALITY_AUDIT)
    };
    const missing = Object.keys(value).filter((key) => !value[key]);
    if (missing.length) throw new SheetRenderingError('SHEET_RENDERING_DEPENDENCY_MISSING',
      'Missing multi-sheet rendering dependencies: ' + missing.join(', '), { missing });
    return value;
  }

  function text(value) { return String(value == null ? '' : value).trim(); }
  function compare(left, right) {
    const a = text(left); const b = text(right);
    return a < b ? -1 : a > b ? 1 : 0;
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
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }
  function endpoint(instanceId, terminalId) {
    return { instanceId: text(instanceId), terminalId: text(terminalId),
      ref: text(instanceId) + ':' + text(terminalId) };
  }
  function terminals(instance) {
    return Array.isArray(instance && instance.terminals) ? instance.terminals :
      (Array.isArray(instance && instance.ports) ? instance.ports : []);
  }
  function findTerminal(instance, terminalId) {
    return terminals(instance).find((item) => text(item && item.id) === text(terminalId));
  }
  function safeToken(value) {
    return text(value).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'X';
  }
  function chunks(values, size) {
    const out = [];
    for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
    return out;
  }
  function unique(values) { return Array.from(new Set(values)); }

  function assertInputs(result, documentValue, sheetId) {
    const design = result && result.design;
    if (!design || !text(design.modelHash)) throw new SheetRenderingError('AUTHORITATIVE_EDEM_REQUIRED',
      'compilePage requires a build result with an authoritative EDEM modelHash.');
    if (!documentValue || !Array.isArray(documentValue.sheets)) throw new SheetRenderingError('DOCUMENT_REQUIRED',
      'compilePage requires a SCHEMATIC_DOCUMENT plan.');
    if (text(documentValue.sourceModelHash) !== text(design.modelHash)) {
      throw new SheetRenderingError('DOCUMENT_MODEL_HASH_MISMATCH',
        'The sheet document was not planned from this EDEM.', {
          designModelHash: design.modelHash, documentModelHash: documentValue.sourceModelHash
        });
    }
    const sheet = documentValue.sheets.find((item) => item.id === sheetId);
    if (!sheet) throw new SheetRenderingError('SHEET_UNKNOWN', 'Unknown sheet ' + text(sheetId) + '.', { sheetId });
    return { design, sheet };
  }

  function resolvePhysicalEndpoint(instanceById, instanceId, terminalId) {
    const instance = instanceById.get(instanceId);
    const terminal = instance && findTerminal(instance, terminalId);
    if (!instance || !terminal) throw new SheetRenderingError('GLOBAL_ENDPOINT_UNKNOWN',
      'Cannot project unknown global endpoint ' + endpoint(instanceId, terminalId).ref + '.');
    if (instance.logicalOnlyProxy !== true) return { instance, terminal, instanceId, terminalId };
    const ownerId = text(instance.physicalOwnerId || terminal.physicalOwnerId);
    const ownerTerminalId = text(terminal.physicalTerminalId);
    const owner = instanceById.get(ownerId);
    const ownerTerminal = owner && findTerminal(owner, ownerTerminalId);
    if (!owner || !ownerTerminal || owner.logicalOnlyProxy === true) {
      throw new SheetRenderingError('LOGICAL_PROXY_GRAPHICAL_OWNER_MISSING',
        'Logical endpoint ' + endpoint(instanceId, terminalId).ref + ' has no usable graphical owner.', {
          ownerId, ownerTerminalId
        });
    }
    return { instance: owner, terminal: ownerTerminal, instanceId: ownerId, terminalId: ownerTerminalId,
      logicalInstanceId: instanceId, logicalTerminalId: terminalId };
  }

  function systemForNetClass(netClass) {
    const value = text(netClass).toUpperCase();
    if (value === 'POWER_AC') return 'ac';
    if (value === 'POWER_DC') return 'dc';
    if (value === 'POWER_DC_ESS' || value === 'POWER_INTERFACE_MODED') return 'ess';
    if (value === 'POWER_DC_AUX') return 'aux';
    if (value === 'PROTECTIVE_EARTH') return 'earth';
    return value === 'SIGNAL_COMM' ? 'comm' : 'control';
  }

  function makeProjection(result, documentValue, sheet, options) {
    const design = result.design;
    const maxEndpoints = Math.max(12, Math.min(16,
      Math.floor(Number(options && options.maxEndpointsPerGraphicUnit || DEFAULT_MAX_ENDPOINTS))));
    const instanceById = new Map(design.instances.map((instance) => [instance.id, instance]));
    const circuitById = new Map(design.circuits.map((circuit) => [circuit.id, circuit]));
    const netById = new Map(design.nets.map((net) => [net.id, net]));
    const connectorByCircuit = new Map(sheet.offPageConnectors.map((connector) => [connector.circuitId, connector]));
    const circuitIds = unique(sheet.internalCircuitIds.concat(sheet.crossCircuitIds)).sort(compare);
    const occurrenceByInstance = new Map();
    const occurrenceDetails = new Map();
    const displayInstanceIds = new Set();

    function addOccurrence(circuit, role) {
      const originalId = role === 'FROM' ? circuit.from : circuit.to;
      const originalTerminalId = role === 'FROM' ? circuit.fromPort : circuit.toPort;
      const physical = resolvePhysicalEndpoint(instanceById, originalId, originalTerminalId);
      displayInstanceIds.add(physical.instanceId);
      const record = {
        key: circuit.id + ':' + role, circuitId: circuit.id, role,
        originalInstanceId: originalId, originalTerminalId,
        displayInstanceId: physical.instanceId, displayTerminalId: physical.terminalId,
        terminal: physical.terminal
      };
      const list = occurrenceByInstance.get(physical.instanceId) || [];
      list.push(record); occurrenceByInstance.set(physical.instanceId, list);
      occurrenceDetails.set(record.key, record);
    }

    sheet.instanceIds.forEach((id) => {
      const instance = instanceById.get(id);
      if (instance && instance.logicalOnlyProxy !== true) displayInstanceIds.add(id);
    });
    circuitIds.forEach((id) => {
      const circuit = circuitById.get(id);
      if (!circuit) throw new SheetRenderingError('DOCUMENT_CIRCUIT_UNKNOWN',
        'Sheet ' + sheet.id + ' references unknown circuit ' + id + '.');
      const connector = connectorByCircuit.get(id);
      if (!connector) { addOccurrence(circuit, 'FROM'); addOccurrence(circuit, 'TO'); }
      else addOccurrence(circuit, connector.role === 'SOURCE' ? 'FROM' : 'TO');
    });

    const graphicalInstances = [];
    const occurrenceEndpoint = new Map();
    const graphicUnitManifest = [];
    Array.from(displayInstanceIds).sort(compare).forEach((instanceId) => {
      const source = instanceById.get(instanceId);
      if (!source) throw new SheetRenderingError('DISPLAY_INSTANCE_UNKNOWN',
        'Missing display instance ' + instanceId + '.');
      const connected = (occurrenceByInstance.get(instanceId) || []).slice()
        .sort((a, b) => compare(a.displayTerminalId, b.displayTerminalId) ||
          compare(a.circuitId, b.circuitId) || compare(a.role, b.role));
      const connectedTerminalIds = new Set(connected.map((item) => item.displayTerminalId));
      const open = terminals(source).filter((terminal) => !connectedTerminalIds.has(terminal.id))
        .map((terminal) => ({ key: '', circuitId: '', role: 'OPEN', displayInstanceId: instanceId,
          displayTerminalId: terminal.id, terminal }));
      const records = connected.concat(open);
      if (records.length <= maxEndpoints) {
        const copy = clone(source);
        copy.modelInstanceId = instanceId;
        copy.graphicalRepresentationOf = instanceId;
        copy.graphicUnitIndex = 1; copy.graphicUnitCount = 1;
        copy.projectionRole = sheet.instanceIds.includes(instanceId) ? 'LOCAL_INSTANCE' : 'LOGICAL_OWNER_REPLICA';
        graphicalInstances.push(copy);
        connected.forEach((record) => occurrenceEndpoint.set(record.key,
          endpoint(instanceId, record.displayTerminalId)));
        graphicUnitManifest.push({ graphicId: instanceId, modelInstanceId: instanceId,
          unitIndex: 1, unitCount: 1, endpointCount: records.length });
        return;
      }
      const recordChunks = chunks(records, maxEndpoints);
      recordChunks.forEach((unitRecords, unitIndex) => {
        const graphicId = instanceId + '~GR' + String(unitIndex + 1).padStart(2, '0');
        const copy = clone(source);
        copy.id = graphicId;
        copy.modelInstanceId = instanceId;
        copy.graphicalRepresentationOf = instanceId;
        copy.graphicUnitIndex = unitIndex + 1; copy.graphicUnitCount = recordChunks.length;
        copy.projectionRole = 'FANOUT_GRAPHIC_UNIT';
        copy.tag = text(source.tag || source.designation || source.referenceDesignation || instanceId) +
          '.' + (unitIndex + 1) + '/' + recordChunks.length;
        copy.name = text(source.name || source.kind) + ' · 图形分段';
        copy.terminals = unitRecords.map((record, recordIndex) => {
          const terminalCopy = clone(record.terminal);
          terminalCopy.id = 'P' + String(recordIndex + 1).padStart(2, '0') + '-' + safeToken(record.displayTerminalId);
          terminalCopy.label = text(record.terminal.label || record.displayTerminalId);
          terminalCopy.modelInstanceId = instanceId;
          terminalCopy.modelTerminalId = record.displayTerminalId;
          terminalCopy.graphicalOccurrence = record.key || 'OPEN:' + record.displayTerminalId;
          if (record.key) occurrenceEndpoint.set(record.key, endpoint(graphicId, terminalCopy.id));
          return terminalCopy;
        });
        copy.ports = copy.terminals;
        graphicalInstances.push(copy);
        graphicUnitManifest.push({ graphicId, modelInstanceId: instanceId,
          unitIndex: unitIndex + 1, unitCount: recordChunks.length, endpointCount: unitRecords.length });
      });
    });

    const offPageEndpoint = new Map();
    const offPageBanks = [];
    const groups = new Map();
    sheet.offPageConnectors.slice().sort((a, b) => compare(a.id, b.id)).forEach((connector) => {
      const key = [connector.role, connector.remoteSheetId, connector.netClass].join('|');
      const list = groups.get(key) || []; list.push(connector); groups.set(key, list);
    });
    Array.from(groups.keys()).sort(compare).forEach((groupKey) => {
      const group = groups.get(groupKey);
      chunks(group, maxEndpoints).forEach((bankConnectors, bankIndex) => {
        const first = bankConnectors[0];
        const outgoing = first.role === 'SOURCE';
        const bankId = 'OPB-' + sheet.id + '-' + (outgoing ? 'OUT' : 'IN') + '-' +
          safeToken(first.remoteSheetId) + '-' + safeToken(first.netClass) + '-' + String(bankIndex + 1).padStart(2, '0');
        const bank = {
          id: bankId,
          kind: outgoing ? 'off-page-connector-outgoing' : 'off-page-connector-incoming',
          system: systemForNetClass(first.netClass),
          name: (outgoing ? '续至' : '来自') + ' ' + first.remoteSheetId + ' / ' + first.xref.drawingNo,
          tag: (outgoing ? '→' : '←') + first.xref.page + '/' + documentValue.sheets.length,
          referenceDesignation: bankId,
          modelInstanceId: '', graphicalRepresentationOf: '',
          graphicUnitIndex: bankIndex + 1,
          graphicUnitCount: Math.ceil(group.length / maxEndpoints),
          projectionRole: 'OFF_PAGE_CONNECTOR_BANK',
          syntheticProjection: true,
          offPageConnectors: bankConnectors.map(clone),
          terminals: bankConnectors.map((connector, connectorIndex) => {
            const id = 'X' + String(connectorIndex + 1).padStart(2, '0');
            offPageEndpoint.set(connector.id, endpoint(bankId, id));
            return {
              id,
              label: (outgoing ? '→' : '←') + 'p' + connector.xref.page + ' ' +
                connector.remoteSheetId + ' ' + connector.xref.endpointKey,
              netClass: connector.netClass,
              domain: '',
              direction: outgoing ? 'in' : 'out',
              required: true,
              offPageConnectorId: connector.id,
              circuitId: connector.circuitId,
              netId: connector.netId,
              xref: clone(connector.xref)
            };
          })
        };
        bank.ports = bank.terminals;
        graphicalInstances.push(bank); offPageBanks.push(bank);
        graphicUnitManifest.push({ graphicId: bankId, modelInstanceId: '', unitIndex: bankIndex + 1,
          unitCount: bank.graphicUnitCount, endpointCount: bank.terminals.length,
          projectionRole: bank.projectionRole });
      });
    });

    const pageCircuits = circuitIds.map((id) => {
      const source = circuitById.get(id);
      const connector = connectorByCircuit.get(id);
      const projected = clone(source);
      projected.projectionOfCircuitId = source.id;
      projected.globalFrom = source.from; projected.globalFromPort = source.fromPort;
      projected.globalTo = source.to; projected.globalToPort = source.toPort;
      if (!connector) {
        const from = occurrenceEndpoint.get(id + ':FROM');
        const to = occurrenceEndpoint.get(id + ':TO');
        if (!from || !to) throw new SheetRenderingError('GRAPHICAL_ENDPOINT_MISSING',
          'Internal circuit ' + id + ' has no graphical endpoint mapping.');
        projected.from = from.instanceId; projected.fromPort = from.terminalId;
        projected.to = to.instanceId; projected.toPort = to.terminalId;
      } else if (connector.role === 'SOURCE') {
        const from = occurrenceEndpoint.get(id + ':FROM');
        const to = offPageEndpoint.get(connector.id);
        projected.from = from.instanceId; projected.fromPort = from.terminalId;
        projected.to = to.instanceId; projected.toPort = to.terminalId;
      } else {
        const from = offPageEndpoint.get(connector.id);
        const to = occurrenceEndpoint.get(id + ':TO');
        projected.from = from.instanceId; projected.fromPort = from.terminalId;
        projected.to = to.instanceId; projected.toPort = to.terminalId;
      }
      if (connector) {
        projected.offPageConnectorId = connector.id;
        projected.xref = clone(connector.xref);
      }
      return projected;
    });
    const visibleNetIds = unique(pageCircuits.map((circuit) => circuit.netId)).sort(compare);
    const pageNets = visibleNetIds.map((id) => {
      const source = netById.get(id);
      if (!source) throw new SheetRenderingError('PAGE_NET_UNKNOWN', 'Missing page net ' + id + '.');
      const copy = clone(source);
      copy.members = unique(pageCircuits.filter((circuit) => circuit.netId === id).flatMap((circuit) => [
        circuit.from + ':' + circuit.fromPort, circuit.to + ':' + circuit.toPort
      ])).sort(compare).map((ref) => {
        const split = ref.indexOf(':');
        return { instanceId: ref.slice(0, split), terminalId: ref.slice(split + 1) };
      });
      return copy;
    });
    const pageModel = {
      schema: PAGE_MODEL_SCHEMA,
      schemaVersion: '1.0.0',
      authoritative: false,
      sourceModelHash: design.modelHash,
      sourceSchema: design.schema,
      sheetId: sheet.id,
      instances: graphicalInstances.sort((a, b) => compare(a.id, b.id)),
      equipment: null,
      nets: pageNets,
      circuits: pageCircuits,
      requirements: clone(design.requirements || {})
    };
    pageModel.equipment = pageModel.instances;
    pageModel.projectionHash = runtime().document.hash({
      sourceModelHash: design.modelHash, sheetId: sheet.id,
      instances: pageModel.instances, nets: pageModel.nets, circuits: pageModel.circuits
    });
    return { pageModel: deepFreeze(pageModel), graphicUnitManifest: deepFreeze(graphicUnitManifest),
      offPageBanks: deepFreeze(offPageBanks), maxEndpoints };
  }

  function emptyCompiled(dependencies, pageModel, sheet) {
    const sheetInfo = dependencies.placement.chooseDrawingSheet(1500, 930);
    const annotations = [{
      id: 'SHEET:' + sheet.id + ':EMPTY', kind: 'text', layer: 'EVSE-TEXT',
      annotationRole: 'empty-sheet-note', x: 100, y: 120,
      text: '本配置不需要此功能单元；页次保留以维持受控图册编号。', height: 13
    }];
    const drawingIR = dependencies.drawingIR.buildDrawingIR({
      devices: [], routes: [], annotations, model: pageModel,
      metadata: { sourceModelHash: pageModel.sourceModelHash, sheetId: sheet.id,
        projectionSchema: PAGE_MODEL_SCHEMA, emptySheet: true }, strict: false
    });
    const plan = Object.freeze({
      schema: 'EVSE-SCHEMATIC-PLACEMENT/1.2', version: VERSION,
      width: sheetInfo.canvasWidth, height: sheetInfo.canvasHeight,
      requiredWidth: 1500, requiredHeight: 930, sheet: sheetInfo,
      content: Object.freeze({ left: 40, top: 68, right: 1500, bottom: 930 }),
      schedule: Object.freeze({ x: 0, y: 0, width: 0, included: false }),
      zones: Object.freeze([]), readability: Object.freeze({ terminalPitchMin: 12, routeLanePitchMin: 10 }),
      rows: 0, columns: 0
    });
    return Object.freeze({ schema: plan.schema, version: VERSION, drawingIR, plan,
      instances: Object.freeze([]), modelInstances: Object.freeze([]), nets: Object.freeze([]),
      circuits: Object.freeze([]), routedCircuits: Object.freeze([]), aliasTraces: Object.freeze([]),
      sheets: Object.freeze([{ index: sheet.page, total: sheet.total, drawingIR, plan }]) });
  }

  function connectorSignature(connector) {
    const value = connector || {};
    const xref = value.xref || {};
    const from = value.from || {};
    const to = value.to || {};
    const local = value.localEndpoint || {};
    const remote = value.remoteEndpoint || {};
    return [
      text(value.id), text(value.peerConnectorId), text(value.circuitId), text(value.netId),
      text(value.netClass), text(value.role), text(value.direction),
      text(from.endpointKey), text(to.endpointKey), text(local.endpointKey), text(remote.endpointKey),
      text(value.localSheetId), text(value.remoteSheetId), text(xref.connectorId),
      text(xref.sheetId), text(xref.page), text(xref.drawingNo), text(xref.endpointKey)
    ].join('|');
  }

  function routeConnectorContract(sheet, compiled) {
    const expectedByCircuit = new Map((sheet.offPageConnectors || []).map((item) => [item.circuitId, item]));
    const errors = [];
    (compiled.drawingIR.routes || []).forEach((route) => {
      const expected = expectedByCircuit.get(route.circuitId) || null;
      const actual = route.offPageConnector || null;
      if (!expected && actual) errors.push('UNEXPECTED:' + route.circuitId + ':' + text(actual.id));
      else if (expected && !actual) errors.push('MISSING:' + route.circuitId + ':' + expected.id);
      else if (expected && connectorSignature(expected) !== connectorSignature(actual)) {
        errors.push('MISMATCH:' + route.circuitId + ':' + text(actual && actual.id));
      }
    });
    expectedByCircuit.forEach((connector, circuitId) => {
      const matches = (compiled.drawingIR.routes || []).filter((route) => route.circuitId === circuitId);
      if (matches.length !== 1) errors.push('CARDINALITY:' + circuitId + ':' + matches.length);
    });
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(unique(errors).sort(compare)) });
  }

  function connectorMarkupPresent(svg, connector) {
    const source = String(svg || '');
    const attrs = {
      'data-off-page-connector': connector.id,
      'data-peer-connector': connector.peerConnectorId,
      'data-circuit': connector.circuitId,
      'data-net': connector.netId,
      'data-local-sheet': connector.localSheetId,
      'data-remote-sheet': connector.remoteSheetId,
      'data-remote-page': connector.xref && connector.xref.page,
      'data-remote-drawing-no': connector.xref && connector.xref.drawingNo,
      'data-remote-endpoint': connector.xref && connector.xref.endpointKey
    };
    return Object.keys(attrs).every((name) => source.includes(name + '="' + text(attrs[name]) + '"'));
  }

  function pageCoverage(design, sheet, compiled, svg) {
    const expected = unique(sheet.internalCircuitIds.concat(sheet.crossCircuitIds)).sort(compare);
    const actual = compiled.drawingIR.routes.concat(compiled.drawingIR.aliasTraces || [])
      .map((trace) => trace.circuitId).sort(compare);
    const circuitById = new Map(design.circuits.map((circuit) => [circuit.id, circuit]));
    const exact = compiled.drawingIR.routes.every((route) => {
      const source = circuitById.get(route.circuitId);
      return source && route.globalSource && route.globalTarget &&
        route.globalSource.ref === source.from + ':' + source.fromPort &&
        route.globalTarget.ref === source.to + ':' + source.toPort;
    });
    const connectorIds = sheet.offPageConnectors.map((connector) => connector.id).sort(compare);
    const renderedConnectorIds = sheet.offPageConnectors.filter((connector) => connectorMarkupPresent(svg, connector))
      .map((connector) => connector.id).sort(compare);
    const connectorContract = routeConnectorContract(sheet, compiled);
    const ok = compiled.drawingIR.coverage && compiled.drawingIR.coverage.ok &&
      JSON.stringify(expected) === JSON.stringify(actual) && exact &&
      connectorContract.ok && renderedConnectorIds.length === connectorIds.length;
    return Object.freeze({
      ok, status: ok ? 'PASS' : 'BLOCKED', code: ok ? 'EXACT_PAGE_PROJECTION' : 'PAGE_PROJECTION_INCOMPLETE',
      expectedCircuitCount: expected.length, renderedCircuitCount: actual.length,
      expectedOffPageConnectorCount: connectorIds.length,
      renderedOffPageConnectorCount: renderedConnectorIds.length,
      exactGlobalEndpoints: exact,
      exactOffPageConnectors: connectorContract.ok,
      offPageConnectorErrors: connectorContract.errors,
      drawingIRCoverage: compiled.drawingIR.coverage
    });
  }

  function pagePresentationQuality(sheet, compiled, coverage, svg) {
    const dependencies = runtime();
    const ir = compiled && compiled.drawingIR || {};
    const plan = compiled && compiled.plan || {};
    const devices = Array.isArray(ir.devices) ? ir.devices : [];
    const routes = Array.isArray(ir.routes) ? ir.routes : [];
    const checks = [];
    function add(code, ok, severity, detail, evidence) {
      checks.push(Object.freeze({ code, ok: !!ok, severity, detail,
        evidence: Object.freeze((Array.isArray(evidence) ? evidence : []).slice()) }));
    }
    /* Bboxes are reconstructed from absolute floating-point coordinates, so
       an exact 240-unit body can read back as 240.00000000000045.  Keep the
       engineering limit exact while tolerating only numeric round-off. */
    const sizeEpsilon = 1e-7;
    const oversize = devices.filter((device) => Number(device.bbox && device.bbox.height) > 300 + sizeEpsilon ||
      Number(device.bbox && device.bbox.width) > 240 + sizeEpsilon).map((device) => device.id);
    const fallbacks = devices.filter((device) => device.symbolFallback === true).map((device) => device.id);
    const duplicateCircuits = routes.map((route) => route.circuitId)
      .filter((id, index, values) => values.indexOf(id) !== index);
    const readability = plan.readability || {};
    const sheetInfo = plan.sheet || {};
    const svgText = String(svg || '');
    const expectedGeometryHash = dependencies.drawingIR.drawingIRHash(ir);
    let freshGeometry;
    try { freshGeometry = dependencies.drawingIR.analyzeGeometry(ir); }
    catch (error) {
      freshGeometry = { ok: false, violations: [{ code: 'GEOMETRY_REANALYSIS_FAILED', detail: error.message }] };
    }
    const renderedGeometry = dependencies.renderedSvgAudit.audit(svgText, ir,
      root && root.SYM && root.SYM.C || {});
    const visualQuality = dependencies.visualQualityAudit.audit(ir);
    const offPageLabelClearance =
      dependencies.visualQualityAudit.auditOffPageConnectorLabelClearance(ir);
    const connectorContract = routeConnectorContract(sheet, compiled);
    const connectorIssues = (sheet.offPageConnectors || []).filter((connector) =>
      !connector.id || !connector.peerConnectorId || !connector.circuitId || !connector.netId ||
      !connector.xref || !connector.xref.sheetId || !connector.xref.drawingNo || !connector.xref.endpointKey)
      .map((connector) => connector.id || connector.circuitId || 'UNKNOWN')
      .concat(connectorContract.errors);

    add('PAGE-Q01-COVERAGE', coverage && coverage.ok, 'BLOCKING',
      '本页每条回路必须由一条内部导线或一个精确跨页续接端表示。', coverage && coverage.drawingIRCoverage && coverage.drawingIRCoverage.errors);
    add('PAGE-Q02-GEOMETRY', freshGeometry.ok === true, 'BLOCKING',
      '本页在闸门执行时重新计算几何，不得存在穿器件、不同网误接、共线重叠或非法自交。',
      freshGeometry.violations || []);
    add('PAGE-Q03-UNIQUE-CIRCUIT', duplicateCircuits.length === 0, 'BLOCKING',
      '同一页面内每个 circuitId 只能对应一条可选择导线。', unique(duplicateCircuits));
    add('PAGE-Q04-SYMBOL-RESOLUTION', fallbacks.length === 0, 'BLOCKING',
      '页面器件必须解析到受控符号，禁止静默回退通用方框。', fallbacks);
    add('PAGE-Q05-FANOUT-BOUND', oversize.length === 0, 'BLOCKING',
      '高扇出器件必须拆为可追溯图形分段，单个图形框不得超过 240×300 图形单位。', oversize);
    add('PAGE-Q06-READABILITY', Number(readability.terminalPitchMin || 0) >= 10 &&
      Number(readability.routeLanePitchMin || 0) >= 8, 'BLOCKING',
      '端子间距和路由 lane 间距必须满足页面可读性下限。', [readability]);
    add('PAGE-Q07-XREF-CONTRACT', connectorIssues.length === 0 &&
      Number(coverage && coverage.renderedOffPageConnectorCount || 0) === (sheet.offPageConnectors || []).length,
    'BLOCKING', '跨页续接符必须具有成对 ID、目标页、图号和远端精确 PIN。', connectorIssues);
    add('PAGE-Q08-DOCUMENT', /^<svg\b/.test(svgText) && /<\/svg>\s*$/.test(svgText) &&
      !/\b(?:undefined|NaN|Infinity|-Infinity)\b/.test(svgText) &&
      svgText.includes('data-sheet-id="' + sheet.id + '"') &&
      svgText.includes('data-geometry-hash="' + expectedGeometryHash + '"') &&
      svgText.includes('data-route-count="' + routes.length + '"'), 'BLOCKING',
      '页面必须是完整 SVG，并携带与当前 Drawing IR 一致的页号、几何哈希和路由数量。');
    add('PAGE-Q09-STANDARD-SHEET', text(sheetInfo.format) !== 'CUSTOM', 'REVIEW',
      text(sheetInfo.format) === 'CUSTOM'
        ? '内容超过 A0，需由工程师决定继续分页或批准自定义图幅。'
        : '页面已装入 A3/A2/A1/A0 标准图幅。', [sheetInfo.format]);
    add('PAGE-Q10-RENDERED-SVG', renderedGeometry.ok === true, 'BLOCKING',
      '独立读取最终 SVG 的每段导线、跨线、选线层、端子、符号和页面骨架，必须与当前 Drawing IR 完全相符。',
      renderedGeometry.errors || []);
    add('PAGE-Q11-VISUAL-CLEARANCE', visualQuality.ok === true, 'REVIEW',
      '文字与导线、不同器件文字、功能分区标题之间应保留可读间距；该项使用确定性保守字宽估算，命中时须人工复核。',
      visualQuality.findings || []);
    add('PAGE-Q12-OFFPAGE-LABEL-CLEARANCE', offPageLabelClearance.ok === true, 'BLOCKING',
      '每个跨页续接属性文字必须与小三角、短引线、端子及同组相邻属性文字保持最小净距；无法证明时禁止交付。',
      offPageLabelClearance.findings || []);

    const blocking = checks.filter((item) => !item.ok && item.severity === 'BLOCKING');
    const review = checks.filter((item) => !item.ok && item.severity === 'REVIEW');
    return Object.freeze({
      status: blocking.length ? 'BLOCKED' : review.length ? 'REVIEW_REQUIRED' : 'PASS',
      code: blocking.length ? 'PAGE_PRESENTATION_BLOCKED' : review.length ? 'PAGE_PRESENTATION_REVIEW_REQUIRED' : 'PAGE_PRESENTATION_PASS',
      blockingCount: blocking.length,
      reviewCount: review.length,
      checks: Object.freeze(checks),
      freshGeometry: Object.freeze(freshGeometry),
      renderedGeometry,
      visualQuality,
      offPageLabelClearance
    });
  }

  function evaluatePage(result, documentValue, sheetId, compiled, svg) {
    const checked = assertInputs(result, documentValue, sheetId);
    const drawingIR = compiled && compiled.drawingIR;
    if (!drawingIR) throw new SheetRenderingError('PAGE_DRAWING_IR_REQUIRED',
      'A rendered or edited page Drawing IR is required for the page gate.');
    const coverage = pageCoverage(checked.design, checked.sheet, compiled, String(svg || ''));
    const quality = pagePresentationQuality(checked.sheet, compiled, coverage, svg);
    const currentViolations = quality.freshGeometry && quality.freshGeometry.violations || [];
    const drawing = Object.freeze({
      allowed: quality.freshGeometry && quality.freshGeometry.ok === true,
      status: quality.freshGeometry && quality.freshGeometry.ok === true ? 'PASS' : 'BLOCKED',
      code: quality.freshGeometry && quality.freshGeometry.ok === true ? 'PAGE_GEOMETRY_PASS' : 'PAGE_GEOMETRY_BLOCKED',
      blockingCount: currentViolations.length || (quality.freshGeometry && quality.freshGeometry.ok === true ? 0 : 1)
    });
    const status = !drawing.allowed || !coverage.ok || quality.status === 'BLOCKED' ? 'BLOCKED' :
      quality.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'PASS';
    return Object.freeze({ status, allowed: status !== 'BLOCKED', drawing, quality, coverage,
      renderedGeometry: quality.renderedGeometry, visualQuality: quality.visualQuality,
      offPageLabelClearance: quality.offPageLabelClearance });
  }

  function compilePage(result, documentValue, sheetId, options) {
    const dependencies = runtime();
    const checked = assertInputs(result, documentValue, sheetId);
    const sourceSnapshot = JSON.stringify(checked.design);
    const projection = makeProjection(result, documentValue, checked.sheet, options || {});
    const placementOptions = Object.assign({
      /* Cross-sheet PIN labels retain the exact remote endpoint.  Permit the
         existing page-quality ceiling so those labels stay inside their IEC
         connector bank instead of protruding into an adjacent routing lane. */
      deviceWidth: 118, maximumDeviceWidth: 240, minimumDeviceHeight: 58,
      portPitch: 12, lanePitch: 8, channelInset: 14,
      minimumHorizontalGap: 70, minimumVerticalGap: 74, zoneStackLimit: 5,
      essFoldColumnLimit: 12,
      left: 40, top: 68, rightMargin: 40, bottomMargin: 330,
      scheduleWidth: 0, includeSchedule: false
    }, options && options.placement || {});
    let placed = projection.pageModel.circuits.length
      ? dependencies.placement.compile(projection.pageModel, placementOptions)
      : emptyCompiled(dependencies, projection.pageModel, checked.sheet);
    const instanceMetadata = new Map(projection.pageModel.instances.map((instance) => [instance.id, instance]));
    const circuitById = new Map(checked.design.circuits.map((circuit) => [circuit.id, circuit]));
    const connectorByCircuit = new Map(checked.sheet.offPageConnectors.map((connector) => [connector.circuitId, connector]));
    const devices = placed.drawingIR.devices.map((device) => {
      const metadata = instanceMetadata.get(device.id) || {};
      return Object.freeze(Object.assign({}, device, {
        modelInstanceId: metadata.modelInstanceId || metadata.graphicalRepresentationOf || metadata.id || '',
        graphicalRepresentationOf: metadata.graphicalRepresentationOf || metadata.modelInstanceId || metadata.id || '',
        graphicUnitIndex: metadata.graphicUnitIndex || 1,
        graphicUnitCount: metadata.graphicUnitCount || 1,
        projectionRole: metadata.projectionRole || '',
        offPageConnectors: Object.freeze((metadata.offPageConnectors || []).map(clone))
      }));
    });
    const routes = placed.drawingIR.routes.map((route) => {
      const circuit = circuitById.get(route.circuitId);
      const connector = connectorByCircuit.get(route.circuitId) || null;
      if (!circuit) throw new SheetRenderingError('RENDERED_CIRCUIT_UNKNOWN',
        'Rendered page route has no authoritative circuit ' + route.circuitId + '.');
      return Object.freeze(Object.assign({}, route, {
        globalSource: Object.freeze({ ref: circuit.from + ':' + circuit.fromPort,
          deviceId: circuit.from, portId: circuit.fromPort,
          physicalRef: circuit.from + ':' + circuit.fromPort }),
        globalTarget: Object.freeze({ ref: circuit.to + ':' + circuit.toPort,
          deviceId: circuit.to, portId: circuit.toPort,
          physicalRef: circuit.to + ':' + circuit.toPort }),
        offPageConnector: connector ? deepFreeze(clone(connector)) : null
      }));
    });
    const drawingIR = dependencies.drawingIR.buildDrawingIR({
      devices, routes, aliasTraces: placed.drawingIR.aliasTraces,
      annotations: placed.drawingIR.annotations,
      model: projection.pageModel,
      metadata: Object.assign({}, placed.drawingIR.metadata, {
        sourceModelHash: checked.design.modelHash,
        projectionHash: projection.pageModel.projectionHash,
        projectionSchema: PAGE_MODEL_SCHEMA,
        authoritative: false,
        sheetId: checked.sheet.id,
        drawingNo: checked.sheet.drawingNo,
        page: checked.sheet.page,
        pageTotal: checked.sheet.total,
        maxEndpointsPerGraphicUnit: projection.maxEndpoints
      }),
      unit: 'mm', yAxis: 'down', strict: false
    });
    if (drawingIR.violations.length || !drawingIR.coverage || !drawingIR.coverage.ok) {
      throw new SheetRenderingError('PAGE_GEOMETRY_BLOCKED',
        'Sheet ' + checked.sheet.id + ' failed its graphical projection gate.', {
          violations: drawingIR.violations, coverage: drawingIR.coverage
        });
    }
    placed = Object.freeze(Object.assign({}, placed, {
      drawingIR,
      instances: projection.pageModel.instances,
      modelInstances: projection.pageModel.instances,
      nets: projection.pageModel.nets,
      circuits: projection.pageModel.circuits,
      routedCircuits: projection.pageModel.circuits,
      offPageConnectors: checked.sheet.offPageConnectors,
      sourceModelHash: checked.design.modelHash,
      projectionHash: projection.pageModel.projectionHash,
      sheets: Object.freeze([{ index: checked.sheet.page, total: checked.sheet.total,
        drawingIR, plan: placed.plan }])
    }));
    const renderOptions = Object.assign({}, options && options.render || {}, {
      title: checked.sheet.title,
      subtitle: checked.sheet.drawingNo + ' | ' + checked.sheet.purpose + ' | 图形投影·非权威 EDEM',
      sheetId: checked.sheet.id,
      drawingNo: checked.sheet.drawingNo,
      pageCurrent: checked.sheet.page,
      pageTotal: checked.sheet.total,
      sourceModelHash: checked.design.modelHash,
      includeSchedule: false,
      includeLegend: true,
      offPageConnectors: checked.sheet.offPageConnectors,
      projectionNote: '本页为不可编辑电气真值的图形投影；图形分段与跨页续接符均通过 circuitId/netId 追溯至全局 EDEM。'
    });
    const svg = dependencies.renderer.render(placed, result, renderOptions);
    const pageGate = evaluatePage(result, documentValue, checked.sheet.id, placed, svg);
    if (JSON.stringify(checked.design) !== sourceSnapshot) throw new SheetRenderingError('EDEM_MUTATED',
      'Sheet rendering changed the authoritative EDEM in memory.');
    const geometryHash = dependencies.drawingIR.drawingIRHash(drawingIR);
    return Object.freeze({
      schema: SCHEMA, version: VERSION, sheetId: checked.sheet.id,
      sheet: checked.sheet, compiled: placed, svg,
      pageModel: projection.pageModel, pageGate,
      geometryHash, projectionHash: projection.pageModel.projectionHash,
      sourceModelHash: checked.design.modelHash,
      offPageConnectors: checked.sheet.offPageConnectors,
      graphicUnitManifest: projection.graphicUnitManifest
    });
  }

  function evaluateDocument(result, renderedValue, replacements) {
    const dependencies = runtime();
    if (!result || !result.design) throw new SheetRenderingError('AUTHORITATIVE_EDEM_REQUIRED',
      'evaluateDocument requires an EVSE engine result.');
    const canonical = dependencies.document.compile(result.design);
    const originalPages = renderedValue && Array.isArray(renderedValue.pages) ? renderedValue.pages : [];
    const replacementMap = replacements || {};
    const pages = canonical.sheets.map((sheet) => {
      const candidate = replacementMap[sheet.id] || originalPages.find((page) => page.sheetId === sheet.id);
      if (!candidate || !candidate.compiled || !candidate.svg) {
        throw new SheetRenderingError('PAGE_RESULT_MISSING', 'Rendered sheet ' + sheet.id + ' is missing.', { sheetId: sheet.id });
      }
      if (text(candidate.sourceModelHash) !== text(result.design.modelHash)) {
        throw new SheetRenderingError('PAGE_MODEL_HASH_MISMATCH', 'Rendered sheet ' + sheet.id + ' belongs to another EDEM.', {
          sheetId: sheet.id, pageModelHash: candidate.sourceModelHash, designModelHash: result.design.modelHash
        });
      }
      const gate = evaluatePage(result, canonical, sheet.id, candidate.compiled, candidate.svg);
      return Object.freeze(Object.assign({}, candidate, { sheet, pageGate: gate }));
    });
    const pageGates = {};
    pages.forEach((page) => {
      pageGates[page.sheetId] = {
        drawing: page.pageGate.drawing,
        quality: page.pageGate.quality,
        coverage: page.pageGate.coverage
      };
    });
    const connectorErrors = [];
    canonical.sheets.forEach((sheet) => {
      const page = pages.find((item) => item.sheetId === sheet.id);
      const contract = page && routeConnectorContract(sheet, page.compiled);
      if (!contract || !contract.ok) connectorErrors.push.apply(connectorErrors,
        (contract && contract.errors || ['PAGE_MISSING']).map((item) => sheet.id + ':' + item));
    });
    const documentValue = dependencies.document.compile(result.design, {
      model: result.design.modelValidation || { status: 'PASS' },
      pages: pageGates,
      crossPageCoverage: connectorErrors.length
        ? { status: 'BLOCKED', code: 'CONNECTOR_PAIR_RENDER_MISMATCH', blockingCount: connectorErrors.length,
          errors: connectorErrors }
        : { status: 'PASS', code: 'ALL_CONNECTOR_PAIRS_RENDERED' }
    });
    return Object.freeze({
      schema: 'SCHEMATIC-RENDERED-DOCUMENT/1.0', version: VERSION,
      sourceModelHash: result.design.modelHash,
      document: documentValue,
      pages: Object.freeze(pages),
      status: documentValue.status,
      projectGate: documentValue.projectGate
    });
  }

  function buildDocument(result, options) {
    const dependencies = runtime();
    if (!result || !result.design) throw new SheetRenderingError('AUTHORITATIVE_EDEM_REQUIRED',
      'buildDocument requires an EVSE engine result.');
    const initial = dependencies.document.compile(result.design);
    const pages = initial.sheets.map((sheet) => compilePage(result, initial, sheet.id, options));
    return evaluateDocument(result, { pages });
  }

  return Object.freeze({
    VERSION, SCHEMA, PAGE_MODEL_SCHEMA, DEFAULT_MAX_ENDPOINTS,
    SheetRenderingError,
    compilePage, buildDocument, build: buildDocument,
    evaluatePage, evaluateDocument, pageCoverage, pagePresentationQuality,
    connectorSignature, routeConnectorContract
  });
});
