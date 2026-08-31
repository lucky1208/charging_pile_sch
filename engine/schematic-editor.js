/* ============================================================
 * Transactional schematic editor kernel
 * ------------------------------------------------------------
 * Edits operate on Drawing IR objects, not on flattened SVG pixels.  Every
 * accepted command rebuilds geometry, re-runs model coverage and is recorded
 * in an undo/redo journal.  Invalid moves are rejected without mutating the
 * current document.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  let ir = root && root.EVSE_DRAWING_IR;
  let router = root && root.EVSE_SCHEMATIC_EDIT_ROUTER;
  if (!ir && typeof module === 'object' && module && module.exports && typeof require === 'function') {
    ir = require('./drawing-ir.js');
  }
  if (!router && typeof module === 'object' && module && module.exports && typeof require === 'function') {
    router = require('./schematic-edit-router.js');
  }
  const api = factory(ir, router);
  if (root) root.EVSE_SCHEMATIC_EDITOR = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (IR, ROUTER) {
  'use strict';

  const VERSION = '2.0.0';
  const SCHEMA = 'EVSE-SCHEMATIC-EDITOR-SESSION/1.0';

  class EditorError extends Error {
    constructor(code, message, details) {
      super(message); this.name = 'EditorError'; this.code = code; this.details = details || {};
    }
  }

  function finite(value, label) {
    const result = Number(value);
    if (!Number.isFinite(result)) throw new EditorError('INVALID_NUMBER', label + ' must be finite.', { label, value });
    return Object.is(result, -0) ? 0 : result;
  }
  function snap(value, grid) {
    const pitch = Math.max(0, Number(grid) || 0);
    return pitch ? Math.round(Number(value) / pitch) * pitch : Number(value);
  }
  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  function compareText(a, b) { return String(a).localeCompare(String(b), 'en'); }
  function bboxInput(bbox) {
    return { x: bbox.xMin != null ? bbox.xMin : bbox.x, y: bbox.yMin != null ? bbox.yMin : bbox.y,
      width: bbox.width, height: bbox.height };
  }
  function rawState(ir) {
    return {
      coordinateSystem: clone(ir.coordinateSystem), metadata: clone(ir.metadata), layers: clone(ir.layers),
      devices: clone(ir.devices), routes: clone(ir.routes), aliasTraces: clone(ir.aliasTraces),
      annotations: clone(ir.annotations)
    };
  }
  function normalizeDevice(value) {
    const bodyId = value.id + ':BODY';
    return IR.createPlacedDevice({
      id: value.id, type: value.type, symbolId: value.symbolId,
      symbolFallback: value.symbolFallback, system: value.system, tag: value.tag,
      referenceDesignation: value.referenceDesignation, bbox: bboxInput(value.bbox),
      ports: value.ports, keepouts: (value.keepouts || []).filter((item) => item.id !== bodyId),
      layer: value.layer, label: value.label
    });
  }
  function normalizeRoute(value) {
    return IR.routeOrthogonal({
      id: value.id, netId: value.netId, circuitId: value.circuitId,
      netClass: value.netClass, domain: value.domain, polarity: value.polarity, phase: value.phase,
      protocol: value.protocol, source: value.source, target: value.target,
      points: value.points, layer: value.layer, bridgePriority: value.bridgePriority, style: value.style
    });
  }
  function rebuild(state, model) {
    return IR.buildDrawingIR({
      devices: state.devices.map(normalizeDevice), routes: state.routes.map(normalizeRoute),
      aliasTraces: state.aliasTraces, annotations: state.annotations, model: model || null,
      metadata: state.metadata, layers: state.layers,
      unit: state.coordinateSystem && state.coordinateSystem.unit,
      yAxis: state.coordinateSystem && state.coordinateSystem.yAxis,
      strict: false
    });
  }
  function validity(ir) {
    const violations = Array.isArray(ir.violations) ? ir.violations : [];
    const coverageErrors = ir.coverage && !ir.coverage.ok ? ir.coverage.errors || [] : [];
    return Object.freeze({ ok: violations.length === 0 && coverageErrors.length === 0,
      violations: Object.freeze(violations.slice()), coverageErrors: Object.freeze(coverageErrors.slice()) });
  }
  function translatedRect(rect, dx, dy) {
    const x = (rect.xMin != null ? rect.xMin : rect.x) + dx;
    const y = (rect.yMin != null ? rect.yMin : rect.y) + dy;
    return Object.assign({}, rect, { x, y, xMin: x, yMin: y, xMax: x + rect.width, yMax: y + rect.height });
  }
  function translateDevice(value, dx, dy) {
    const result = clone(value);
    result.bbox = translatedRect(result.bbox, dx, dy);
    result.ports = (result.ports || []).map((port) => Object.assign({}, port, { x: port.x + dx, y: port.y + dy }));
    result.keepouts = (result.keepouts || []).map((keepout) => translatedRect(keepout, dx, dy));
    return result;
  }
  function samePoint(a, b) { return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9; }
  function translateWholeRoute(route, dx, dy) {
    const value = clone(route);
    value.source.x += dx; value.source.y += dy; value.target.x += dx; value.target.y += dy;
    value.points = value.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    return value;
  }
  function moveEndpoint(route, end, dx, dy) {
    const value = clone(route); const points = value.points;
    const source = end === 'source'; const endpoint = value[end];
    endpoint.x += dx; endpoint.y += dy;
    if (points.length === 2) {
      if (source) points[0] = { x: endpoint.x, y: endpoint.y };
      else points[1] = { x: endpoint.x, y: endpoint.y };
      if (Math.abs(points[0].x - points[1].x) > 1e-9 && Math.abs(points[0].y - points[1].y) > 1e-9) {
        points.splice(1, 0, source
          ? { x: points[1].x, y: points[0].y }
          : { x: points[0].x, y: points[1].y });
      }
      return value;
    }
    if (source) {
      const old = points[0]; const next = points[1];
      const horizontal = Math.abs(old.y - next.y) < 1e-9;
      points[0] = { x: endpoint.x, y: endpoint.y };
      if (horizontal) points[1].y = endpoint.y; else points[1].x = endpoint.x;
      if (samePoint(points[0], points[1]) && points.length > 2) points.splice(1, 1);
    } else {
      const last = points.length - 1; const old = points[last]; const previous = points[last - 1];
      const horizontal = Math.abs(old.y - previous.y) < 1e-9;
      points[last] = { x: endpoint.x, y: endpoint.y };
      if (horizontal) points[last - 1].y = endpoint.y; else points[last - 1].x = endpoint.x;
      if (samePoint(points[last], points[last - 1]) && points.length > 2) points.splice(last - 1, 1);
    }
    return value;
  }
  function moveConnectedRoutes(routes, deviceIds, dx, dy) {
    return routes.map((route) => {
      const sourceMoved = deviceIds.has(route.source.deviceId);
      const targetMoved = deviceIds.has(route.target.deviceId);
      if (sourceMoved && targetMoved) return translateWholeRoute(route, dx, dy);
      if (sourceMoved) return moveEndpoint(route, 'source', dx, dy);
      if (targetMoved) return moveEndpoint(route, 'target', dx, dy);
      return route;
    });
  }
  function connectedRouteIds(routes, deviceIds) {
    return routes.filter((route) => deviceIds.has(route.source.deviceId) || deviceIds.has(route.target.deviceId))
      .map((route) => route.id).sort(compareText);
  }
  function shiftedRouteSegment(route, segmentIndex, amount) {
    const value = clone(route); const segment = value.segments[Number(segmentIndex)];
    if (!segment) throw new EditorError('SEGMENT_NOT_FOUND', '线段不存在。', { routeId: route.id, segmentIndex });
    if (segment.index === 0 || segment.index === value.segments.length - 1) {
      throw new EditorError('ENDPOINT_SEGMENT_LOCKED', '端子相邻线段锁定；请移动器件或选择中间线段。');
    }
    const a = segment.index; const b = a + 1;
    if (segment.orientation === 'horizontal') { value.points[a].y += amount; value.points[b].y += amount; }
    else { value.points[a].x += amount; value.points[b].x += amount; }
    return normalizeRoute(value);
  }
  function routerOptions(ir, options) {
    const supplied = options || {};
    const readability = ir && ir.metadata && ir.metadata.readability || {};
    const pitch = Math.max(4, Number(readability.routeLanePitchMin) || 12);
    const sheet = ir && ir.metadata && ir.metadata.sheet;
    return {
      deviceClearance: supplied.deviceClearance == null ? Math.max(4, pitch * 0.55) : supplied.deviceClearance,
      deviceSpacing: supplied.deviceSpacing == null ? 0 : supplied.deviceSpacing,
      wireSpacing: supplied.wireSpacing == null ? Math.max(4, pitch * 0.65) : supplied.wireSpacing,
      escapeDistance: supplied.escapeDistance == null ? Math.max(8, pitch) : supplied.escapeDistance,
      maxAffectedRoutes: supplied.maxAffectedRoutes == null ? 64 : supplied.maxAffectedRoutes,
      maxAxes: supplied.maxAxes == null ? 58 : supplied.maxAxes,
      maxExpandedStates: supplied.maxExpandedStates == null ? 14000 : supplied.maxExpandedStates,
      margins: supplied.margins || [48, 120, 280],
      sheetBounds: supplied.sheetBounds || (sheet && Number.isFinite(Number(sheet.canvasWidth)) &&
        Number.isFinite(Number(sheet.canvasHeight)) ? {
          xMin: 0, yMin: 0, xMax: Number(sheet.canvasWidth), yMax: Number(sheet.canvasHeight)
        } : null)
    };
  }
  function translateAnnotation(value, dx, dy) {
    const item = clone(value);
    if (item.kind === 'rect' || item.kind === 'text') { item.x += dx; item.y += dy; }
    else if (item.kind === 'line') { item.x1 += dx; item.y1 += dy; item.x2 += dx; item.y2 += dy; }
    else if (item.kind === 'polyline') item.points = item.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    return item;
  }

  function createSession(options) {
    const o = options || {};
    if (!IR) throw new EditorError('DRAWING_IR_MISSING', 'EVSE_DRAWING_IR is required.');
    if (!o.drawingIR || o.drawingIR.schema !== IR.SCHEMA) throw new EditorError('INVALID_DRAWING_IR', 'A valid Drawing IR is required.');
    const initial = o.drawingIR; const model = o.model || null; const historyLimit = Math.max(1, Number(o.historyLimit) || 100);
    const initialValidity = validity(initial);
    if (!initialValidity.ok) throw new EditorError('INITIAL_DRAWING_INVALID', 'Editor cannot open an invalid Drawing IR.', initialValidity);
    let current = initial; let history = []; let future = []; let selection = null; let revision = 0; let sequence = 0;
    const journal = []; const listeners = new Set();

    function emit(event) { listeners.forEach((listener) => { try { listener(event); } catch (_) { /* observer isolation */ } }); }
    function snapshot() { return Object.freeze({ schema: SCHEMA, version: VERSION,
      routerVersion: ROUTER && ROUTER.VERSION || '', revision, drawingIR: current,
      selection: selection ? Object.freeze(Object.assign({}, selection)) : null,
      canUndo: history.length > 0, canRedo: future.length > 0,
      geometryHash: IR.drawingIRHash(current), journalLength: journal.length }); }
    function fail(code, message, details) {
      const response = Object.freeze({ accepted: false, code, message, details: details || {}, snapshot: snapshot() });
      emit({ type: 'command-rejected', response }); return response;
    }
    function transact(type, payload, mutate) {
      const state = rawState(current);
      try { mutate(state); } catch (error) { return fail(error.code || 'COMMAND_ERROR', error.message, error.details); }
      let candidate;
      try { candidate = rebuild(state, model); } catch (error) { return fail(error.code || 'REBUILD_ERROR', error.message, error.details); }
      const checked = validity(candidate);
      if (!checked.ok) return fail('EDIT_REJECTED_BY_ERC', '编辑导致几何或端子覆盖违规，已回滚。', checked);
      history.push(current); if (history.length > historyLimit) history.shift();
      current = candidate; future = []; revision += 1; sequence += 1;
      const entry = Object.freeze({ id: 'CMD-' + String(sequence).padStart(5, '0'), revision, type,
        payload: Object.freeze(clone(payload || {})), geometryHash: IR.drawingIRHash(current) });
      journal.push(entry);
      const response = Object.freeze({ accepted: true, command: entry, snapshot: snapshot() });
      emit({ type: 'command-accepted', response }); return response;
    }
    function select(kind, id, subId) {
      if (!kind || !id) selection = null;
      else selection = Object.freeze({ kind: String(kind), id: String(id), subId: subId == null ? null : String(subId) });
      const value = snapshot(); emit({ type: 'selection-changed', snapshot: value }); return value;
    }
    function moveDevices(ids, dx, dy, options) {
      const o2 = options || {}; const x = snap(finite(dx, 'dx'), o2.grid); const y = snap(finite(dy, 'dy'), o2.grid);
      const list = Array.from(new Set((Array.isArray(ids) ? ids : [ids]).map(String))).sort(compareText);
      if (!x && !y) return fail('NO_MOVEMENT', '移动量为0。');
      const payload = { ids: list, dx: x, dy: y, grid: Number(o2.grid) || 0, reroutedRouteIds: [] };
      return transact('MOVE_DEVICES', payload, (state) => {
        if (!ROUTER) throw new EditorError('EDIT_ROUTER_MISSING', '自动避让路由内核未加载。');
        const targets = new Set(list); const found = new Set();
        const affectedRouteIds = connectedRouteIds(state.routes, targets);
        state.devices = state.devices.map((device) => {
          if (!targets.has(device.id)) return device;
          found.add(device.id); return translateDevice(device, x, y);
        });
        const missing = list.filter((id) => !found.has(id));
        if (missing.length) throw new EditorError('DEVICE_NOT_FOUND', '设备不存在：' + missing.join(', '), { missing });
        state.routes = moveConnectedRoutes(state.routes, targets, x, y);
        const routeOptions = routerOptions(current, o2);
        ROUTER.assertDevicePlacement(state.devices, list, state.metadata, routeOptions);
        const routed = ROUTER.rerouteAffected({ devices: state.devices, routes: state.routes,
          annotations: state.annotations, affectedRouteIds, options: routeOptions });
        state.routes = Array.from(routed.routes);
        payload.reroutedRouteIds = Array.from(routed.reroutedRouteIds);
        payload.routingPasses = routed.passes;
      });
    }
    function moveRouteSegment(routeId, segmentIndex, delta, options) {
      const o2 = options || {}; const amount = snap(finite(delta, 'delta'), o2.grid);
      if (!amount) return fail('NO_MOVEMENT', '移动量为0。');
      const payload = { routeId: String(routeId), segmentIndex: Number(segmentIndex), delta: amount,
        displacedRouteIds: [] };
      return transact('MOVE_ROUTE_SEGMENT', payload, (state) => {
        if (!ROUTER) throw new EditorError('EDIT_ROUTER_MISSING', '自动避让路由内核未加载。');
        const index = state.routes.findIndex((route) => route.id === String(routeId));
        if (index < 0) throw new EditorError('ROUTE_NOT_FOUND', '导线不存在：' + routeId);
        state.routes[index] = shiftedRouteSegment(state.routes[index], segmentIndex, amount);
        const routed = ROUTER.rerouteAffected({ devices: state.devices, routes: state.routes,
          annotations: state.annotations, affectedRouteIds: [], lockedRouteIds: [String(routeId)],
          options: routerOptions(current, o2) });
        state.routes = Array.from(routed.routes);
        payload.displacedRouteIds = Array.from(routed.reroutedRouteIds);
        payload.routingPasses = routed.passes;
      });
    }
    function previewDeviceMove(ids, dx, dy, options) {
      const o2 = options || {}; const x = snap(finite(dx, 'dx'), o2.grid); const y = snap(finite(dy, 'dy'), o2.grid);
      const list = Array.from(new Set((Array.isArray(ids) ? ids : [ids]).map(String))).sort(compareText);
      const targets = new Set(list); const found = new Set();
      const devices = current.devices.map((device) => {
        if (!targets.has(device.id)) return device;
        found.add(device.id); return translateDevice(device, x, y);
      });
      const missing = list.filter((id) => !found.has(id));
      if (missing.length) throw new EditorError('DEVICE_NOT_FOUND', '设备不存在：' + missing.join(', '), { missing });
      const routes = moveConnectedRoutes(current.routes, targets, x, y);
      const routeIds = new Set(connectedRouteIds(current.routes, targets));
      let placementOk = true; let placementError = null;
      if (ROUTER) {
        try { ROUTER.assertDevicePlacement(devices, list, current.metadata, routerOptions(current, o2)); }
        catch (error) { placementOk = false; placementError = { code: error.code || 'PREVIEW_INVALID', message: error.message }; }
      }
      return Object.freeze({ ids: Object.freeze(list), dx: x, dy: y, placementOk,
        placementError: placementError && Object.freeze(placementError),
        routes: Object.freeze(routes.filter((route) => routeIds.has(route.id)).map((route) => Object.freeze({
          id: route.id, layer: route.layer, netId: route.netId,
          points: Object.freeze(route.points.map((point) => Object.freeze({ x: point.x, y: point.y })))
        }))) });
    }
    function previewRouteSegment(routeId, segmentIndex, delta, options) {
      const amount = snap(finite(delta, 'delta'), options && options.grid);
      const route = current.routes.find((item) => item.id === String(routeId));
      if (!route) throw new EditorError('ROUTE_NOT_FOUND', '导线不存在：' + routeId);
      const shifted = shiftedRouteSegment(route, segmentIndex, amount);
      return Object.freeze({ id: shifted.id, layer: shifted.layer, netId: shifted.netId,
        points: Object.freeze(shifted.points.map((point) => Object.freeze({ x: point.x, y: point.y }))) });
    }
    function moveAnnotation(id, dx, dy, options) {
      const o2 = options || {}; const x = snap(finite(dx, 'dx'), o2.grid); const y = snap(finite(dy, 'dy'), o2.grid);
      return transact('MOVE_ANNOTATION', { id: String(id), dx: x, dy: y }, (state) => {
        const index = state.annotations.findIndex((item) => item.id === String(id));
        if (index < 0) throw new EditorError('ANNOTATION_NOT_FOUND', '图示对象不存在：' + id);
        state.annotations[index] = translateAnnotation(state.annotations[index], x, y);
      });
    }
    function editAnnotationText(id, text) {
      return transact('EDIT_ANNOTATION_TEXT', { id: String(id), text: String(text) }, (state) => {
        const item = state.annotations.find((value) => value.id === String(id));
        if (!item || item.kind !== 'text') throw new EditorError('TEXT_ANNOTATION_NOT_FOUND', '文字对象不存在：' + id);
        item.text = String(text).slice(0, 500);
      });
    }
    function undo() {
      if (!history.length) return fail('UNDO_EMPTY', '没有可撤销的命令。');
      future.push(current); current = history.pop(); revision += 1; sequence += 1;
      const entry = Object.freeze({ id: 'CMD-' + String(sequence).padStart(5, '0'), revision, type: 'UNDO',
        payload: Object.freeze({}), geometryHash: IR.drawingIRHash(current) });
      journal.push(entry); const response = Object.freeze({ accepted: true, command: entry, snapshot: snapshot() });
      emit({ type: 'undo', response }); return response;
    }
    function redo() {
      if (!future.length) return fail('REDO_EMPTY', '没有可重做的命令。');
      history.push(current); current = future.pop(); revision += 1; sequence += 1;
      const entry = Object.freeze({ id: 'CMD-' + String(sequence).padStart(5, '0'), revision, type: 'REDO',
        payload: Object.freeze({}), geometryHash: IR.drawingIRHash(current) });
      journal.push(entry); const response = Object.freeze({ accepted: true, command: entry, snapshot: snapshot() });
      emit({ type: 'redo', response }); return response;
    }
    function reset() {
      if (current === initial) return fail('ALREADY_INITIAL', '已经是自动生成的初始版本。');
      history.push(current); current = initial; future = []; revision += 1; sequence += 1;
      const entry = Object.freeze({ id: 'CMD-' + String(sequence).padStart(5, '0'), revision, type: 'RESET_TO_GENERATED',
        payload: Object.freeze({}), geometryHash: IR.drawingIRHash(current) });
      journal.push(entry); const response = Object.freeze({ accepted: true, command: entry, snapshot: snapshot() });
      emit({ type: 'reset', response }); return response;
    }
    function subscribe(listener) {
      if (typeof listener !== 'function') throw new EditorError('INVALID_LISTENER', 'listener must be a function.');
      listeners.add(listener); return () => listeners.delete(listener);
    }
    function inspect(kind, id) {
      const arrays = { device: current.devices, route: current.routes, annotation: current.annotations };
      const list = arrays[String(kind)] || [];
      return list.find((item) => item.id === String(id)) || null;
    }
    function connectionsForPort(deviceId, portId) {
      const device = current.devices.find((item) => item.id === String(deviceId));
      const port = device && (device.ports || []).find((item) => item.id === String(portId));
      if (!port) return Object.freeze([]);
      const result = [];
      current.routes.forEach((route) => {
        let opposite = null; let role = '';
        const sourceMatches = route.source.deviceId === device.id &&
          (route.source.portId === port.id || (route.source.ref === port.ref &&
            Math.abs(route.source.x - port.x) < 1e-9 && Math.abs(route.source.y - port.y) < 1e-9));
        const targetMatches = route.target.deviceId === device.id &&
          (route.target.portId === port.id || (route.target.ref === port.ref &&
            Math.abs(route.target.x - port.x) < 1e-9 && Math.abs(route.target.y - port.y) < 1e-9));
        if (sourceMatches) {
          opposite = route.target; role = 'SOURCE';
        } else if (targetMatches) {
          opposite = route.source; role = 'TARGET';
        }
        if (opposite) result.push(Object.freeze({ routeId: route.id, circuitId: route.circuitId,
          netId: route.netId, netClass: route.netClass, role, oppositeRef: opposite.ref,
          oppositeDeviceId: opposite.deviceId, oppositePortId: opposite.portId }));
      });
      result.sort((a, b) => compareText(a.routeId, b.routeId));
      return Object.freeze(result);
    }
    function exportDocument() {
      return Object.freeze({ schema: 'EVSE-EDITABLE-SCHEMATIC-DOCUMENT/1.0', editorVersion: VERSION,
        routerVersion: ROUTER && ROUTER.VERSION || '',
        revision, generatedGeometryHash: IR.drawingIRHash(initial), currentGeometryHash: IR.drawingIRHash(current),
        drawingIR: current, journal: Object.freeze(journal.slice()) });
    }

    return Object.freeze({
      schema: SCHEMA, version: VERSION, snapshot, select, inspect, moveDevices, moveDevice: (id, dx, dy, o2) => moveDevices([id], dx, dy, o2),
      moveRouteSegment, previewDeviceMove, previewRouteSegment, connectionsForPort,
      moveAnnotation, editAnnotationText, undo, redo, reset, subscribe, exportDocument,
      get drawingIR() { return current; }, get selection() { return selection; }, get journal() { return Object.freeze(journal.slice()); }
    });
  }

  return Object.freeze({ VERSION, SCHEMA, EditorError, createSession, snap });
});
