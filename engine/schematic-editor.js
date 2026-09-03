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

  const VERSION = '2.1.0';
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
  function deepFreeze(value, seen) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
    const visited = seen || new WeakSet();
    if (visited.has(value)) return value;
    visited.add(value);
    Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], visited));
    return Object.freeze(value);
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
  function moveRoutesByDeviceDeltas(routes, deltas) {
    return routes.map((route) => {
      const sourceDelta = deltas.get(route.source.deviceId);
      const targetDelta = deltas.get(route.target.deviceId);
      if (sourceDelta && targetDelta && sourceDelta.dx === targetDelta.dx && sourceDelta.dy === targetDelta.dy) {
        return translateWholeRoute(route, sourceDelta.dx, sourceDelta.dy);
      }
      let value = route;
      if (sourceDelta) value = moveEndpoint(value, 'source', sourceDelta.dx, sourceDelta.dy);
      if (targetDelta) value = moveEndpoint(value, 'target', targetDelta.dx, targetDelta.dy);
      return value;
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
  function normalizedBounds(value) {
    const x1 = finite(value.xMin != null ? value.xMin : value.x, 'x');
    const y1 = finite(value.yMin != null ? value.yMin : value.y, 'y');
    const x2 = value.xMax != null ? finite(value.xMax, 'xMax') : x1 + finite(value.width, 'width');
    const y2 = value.yMax != null ? finite(value.yMax, 'yMax') : y1 + finite(value.height, 'height');
    return { xMin: Math.min(x1, x2), yMin: Math.min(y1, y2), xMax: Math.max(x1, x2), yMax: Math.max(y1, y2) };
  }
  function boundsContained(inner, outer) {
    return inner.xMin >= outer.xMin - 1e-9 && inner.yMin >= outer.yMin - 1e-9 &&
      inner.xMax <= outer.xMax + 1e-9 && inner.yMax <= outer.yMax + 1e-9;
  }
  function boundsIntersect(left, right) {
    return left.xMax >= right.xMin - 1e-9 && left.xMin <= right.xMax + 1e-9 &&
      left.yMax >= right.yMin - 1e-9 && left.yMin <= right.yMax + 1e-9;
  }
  function annotationBounds(item) {
    if (item.kind === 'rect') return normalizedBounds(item);
    if (item.kind === 'line') return normalizedBounds({ x: item.x1, y: item.y1,
      width: item.x2 - item.x1, height: item.y2 - item.y1 });
    if (item.kind === 'polyline') {
      const xs = (item.points || []).map((point) => Number(point.x));
      const ys = (item.points || []).map((point) => Number(point.y));
      if (!xs.length || !ys.length) return null;
      return { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) };
    }
    if (item.kind === 'text') {
      const height = Math.max(1, Number(item.height) || 8);
      const width = Math.max(height, String(item.text || '').length * height * 0.58);
      const anchor = String(item.anchor || 'start');
      const x = anchor === 'middle' ? item.x - width / 2 : anchor === 'end' ? item.x - width : item.x;
      return { xMin: x, yMin: item.y - height * 0.78, xMax: x + width, yMax: item.y + height * 0.22 };
    }
    return null;
  }
  function selectionKey(value) {
    return String(value.kind) + ':' + String(value.id) + ':' + (value.subId == null ? '' : String(value.subId));
  }
  function normalizeSelectionItems(items) {
    const values = Array.isArray(items) ? items : (items ? [items] : []); const seen = new Set(); const output = [];
    values.forEach((item) => {
      if (!item || !item.kind || !item.id) return;
      const value = { kind: String(item.kind), id: String(item.id), subId: item.subId == null ? null : String(item.subId) };
      const key = selectionKey(value); if (seen.has(key)) return;
      seen.add(key); output.push(value);
    });
    return output.sort((a, b) => compareText(selectionKey(a), selectionKey(b)));
  }
  function electricalProjection(ir) {
    const value = ir || {};
    return JSON.stringify({
      devices: (value.devices || []).map((device) => ({ id: device.id, equipmentId: device.equipmentId,
        type: device.type, system: device.system, tag: device.tag, referenceDesignation: device.referenceDesignation,
        label: device.label,
        symbolId: device.symbolId, symbolFallback: device.symbolFallback,
        ports: (device.ports || []).map((port) => ({ id: port.id, ref: port.ref, deviceId: port.deviceId,
          terminalId: port.terminalId, circuitId: port.circuitId, direction: port.direction,
          domain: port.domain, netClass: port.netClass, label: port.label })) })),
      routes: (value.routes || []).map((route) => ({ id: route.id, netId: route.netId,
        circuitId: route.circuitId, netClass: route.netClass, domain: route.domain,
        polarity: route.polarity, phase: route.phase, protocol: route.protocol,
        source: { ref: route.source.ref, deviceId: route.source.deviceId, portId: route.source.portId,
          physicalRef: route.source.physicalRef },
        target: { ref: route.target.ref, deviceId: route.target.deviceId, portId: route.target.portId,
          physicalRef: route.target.physicalRef } })),
      aliasTraces: clone(value.aliasTraces || [])
    });
  }
  function fingerprint(value) {
    const text = IR && typeof IR.stableStringify === 'function' ? IR.stableStringify(value) : JSON.stringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'fnv1a32:' + hash.toString(16).padStart(8, '0');
  }

  function createSession(options) {
    const o = options || {};
    if (!IR) throw new EditorError('DRAWING_IR_MISSING', 'EVSE_DRAWING_IR is required.');
    if (!o.drawingIR || o.drawingIR.schema !== IR.SCHEMA) throw new EditorError('INVALID_DRAWING_IR', 'A valid Drawing IR is required.');
    const initial = deepFreeze(clone(o.drawingIR)); const model = deepFreeze(clone(o.model || null));
    const historyLimit = Math.max(1, Number(o.historyLimit) || 100);
    if (initial.coverage && !model) throw new EditorError('MODEL_REQUIRED_FOR_COVERED_DRAWING',
      '带图模覆盖结果的 Drawing IR 必须绑定实时 EDEM 模型后才能编辑。');
    if (model) {
      const liveCoverage = IR.auditCoverage(model, initial);
      if (!liveCoverage.ok) throw new EditorError('MODEL_DRAWING_MISMATCH',
        '当前 EDEM 模型与 Drawing IR 不一致，不能开始编辑。', { errors: liveCoverage.errors || [] });
    }
    const modelHash = model ? fingerprint(model) : '';
    const initialElectricalProjection = electricalProjection(initial);
    const initialValidity = validity(initial);
    if (!initialValidity.ok) throw new EditorError('INITIAL_DRAWING_INVALID', 'Editor cannot open an invalid Drawing IR.', initialValidity);
    let current = initial; let history = []; let future = []; let selections = []; let selection = null;
    let revision = 0; let sequence = 0;
    const journal = []; const listeners = new Set();

    function emit(event) { listeners.forEach((listener) => { try { listener(event); } catch (_) { /* observer isolation */ } }); }
    function remember(value) {
      history.push(value); if (history.length > historyLimit) history.shift();
    }
    function snapshot() { return Object.freeze({ schema: SCHEMA, version: VERSION,
      routerVersion: ROUTER && ROUTER.VERSION || '', modelHash, revision, drawingIR: current,
      selection: selection ? Object.freeze(Object.assign({}, selection)) : null,
      selections: Object.freeze(selections.map((item) => Object.freeze(Object.assign({}, item)))),
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
      try { candidate = deepFreeze(rebuild(state, model)); } catch (error) { return fail(error.code || 'REBUILD_ERROR', error.message, error.details); }
      if (electricalProjection(candidate) !== initialElectricalProjection) {
        return fail('ELECTRICAL_IDENTITY_CHANGED', '几何编辑不得修改器件、PIN、网络、回路或端点身份，已回滚。');
      }
      const checked = validity(candidate);
      if (!checked.ok) return fail('EDIT_REJECTED_BY_ERC', '编辑导致几何或端子覆盖违规，已回滚。', checked);
      remember(current);
      current = candidate; future = []; revision += 1; sequence += 1;
      const entry = Object.freeze({ id: 'CMD-' + String(sequence).padStart(5, '0'), revision, type,
        payload: deepFreeze(clone(payload || {})), geometryHash: IR.drawingIRHash(current) });
      journal.push(entry);
      const response = Object.freeze({ accepted: true, command: entry, snapshot: snapshot() });
      emit({ type: 'command-accepted', response }); return response;
    }
    function objectExists(item) {
      const arrays = { device: current.devices, route: current.routes, annotation: current.annotations };
      const value = (arrays[item.kind] || []).find((entry) => entry.id === item.id);
      if (!value) return false;
      if (item.subId == null) return true;
      if (item.kind === 'device') return (value.ports || []).some((port) => String(port.id) === item.subId);
      if (item.kind === 'route') return (value.segments || []).some((segment) => String(segment.index) === item.subId);
      return false;
    }
    function selectMany(items, options) {
      const o2 = options || {}; const mode = String(o2.mode || 'replace').toLowerCase();
      if (!['replace', 'add', 'remove', 'toggle'].includes(mode)) {
        throw new EditorError('SELECTION_MODE_INVALID', '不支持的选择模式：' + mode);
      }
      const incoming = normalizeSelectionItems(items).filter(objectExists);
      const values = new Map(selections.map((item) => [selectionKey(item), item]));
      if (mode === 'replace') values.clear();
      incoming.forEach((item) => {
        const key = selectionKey(item);
        if (mode === 'remove' || (mode === 'toggle' && values.has(key))) values.delete(key); else values.set(key, item);
      });
      selections = Array.from(values.values()).sort((a, b) => compareText(selectionKey(a), selectionKey(b)));
      const primaryKey = o2.primary ? selectionKey(o2.primary) : incoming.length ? selectionKey(incoming[incoming.length - 1]) : '';
      selection = selections.find((item) => selectionKey(item) === primaryKey) ||
        (selection && selections.find((item) => selectionKey(item) === selectionKey(selection))) ||
        selections[selections.length - 1] || null;
      if (selection) selection = Object.freeze(Object.assign({}, selection));
      const value = snapshot(); emit({ type: 'selection-changed', snapshot: value }); return value;
    }
    function select(kind, id, subId) {
      return selectMany(kind && id ? [{ kind, id, subId }] : [], { mode: 'replace',
        primary: kind && id ? { kind, id, subId } : null });
    }
    function toggleSelection(kind, id, subId) {
      return selectMany([{ kind, id, subId }], { mode: 'toggle', primary: { kind, id, subId } });
    }
    function applyDeviceDeltas(state, inputDeltas, options, payload) {
      if (!ROUTER) throw new EditorError('EDIT_ROUTER_MISSING', '自动避让路由内核未加载。');
      const deltas = new Map();
      (inputDeltas || []).forEach((entry) => {
        const dx = finite(entry.dx, 'dx'); const dy = finite(entry.dy, 'dy');
        if (dx || dy) deltas.set(String(entry.id), { dx, dy });
      });
      const list = Array.from(deltas.keys()).sort(compareText); const found = new Set();
      if (!list.length) throw new EditorError('NO_MOVEMENT', '移动量为0。');
      const targets = new Set(list); const affectedRouteIds = connectedRouteIds(state.routes, targets);
      state.devices = state.devices.map((device) => {
        const delta = deltas.get(device.id); if (!delta) return device;
        found.add(device.id); return translateDevice(device, delta.dx, delta.dy);
      });
      const missing = list.filter((id) => !found.has(id));
      if (missing.length) throw new EditorError('DEVICE_NOT_FOUND', '设备不存在：' + missing.join(', '), { missing });
      state.routes = moveRoutesByDeviceDeltas(state.routes, deltas);
      const routeOptions = routerOptions(current, options);
      ROUTER.assertDevicePlacement(state.devices, list, state.metadata, routeOptions);
      const routed = ROUTER.rerouteAffected({ devices: state.devices, routes: state.routes,
        annotations: state.annotations, affectedRouteIds, options: routeOptions });
      state.routes = Array.from(routed.routes);
      payload.reroutedRouteIds = Array.from(routed.reroutedRouteIds);
      payload.routingPasses = routed.passes;
      payload.moves = list.map((id) => Object.freeze({ id, dx: deltas.get(id).dx, dy: deltas.get(id).dy }));
    }
    function moveDevices(ids, dx, dy, options) {
      const o2 = options || {}; const x = snap(finite(dx, 'dx'), o2.grid); const y = snap(finite(dy, 'dy'), o2.grid);
      const list = Array.from(new Set((Array.isArray(ids) ? ids : [ids]).map(String))).sort(compareText);
      if (!x && !y) return fail('NO_MOVEMENT', '移动量为0。');
      const payload = { ids: list, dx: x, dy: y, grid: Number(o2.grid) || 0, reroutedRouteIds: [] };
      return transact('MOVE_DEVICES', payload, (state) => {
        applyDeviceDeltas(state, list.map((id) => ({ id, dx: x, dy: y })), o2, payload);
      });
    }
    function moveObjects(items, dx, dy, options) {
      const o2 = options || {}; const x = snap(finite(dx, 'dx'), o2.grid); const y = snap(finite(dy, 'dy'), o2.grid);
      const list = normalizeSelectionItems(items); if (!x && !y) return fail('NO_MOVEMENT', '移动量为0。');
      const unsupported = list.filter((item) => !['device', 'annotation'].includes(item.kind));
      if (unsupported.length) return fail('GROUP_MOVE_UNSUPPORTED_KIND', '成组移动仅支持器件和图示/文字对象。', { unsupported });
      const deviceIds = list.filter((item) => item.kind === 'device').map((item) => item.id);
      const annotationIds = new Set(list.filter((item) => item.kind === 'annotation').map((item) => item.id));
      if (!deviceIds.length && !annotationIds.size) return fail('NO_MOVABLE_OBJECTS', '选择中没有可移动对象。');
      const payload = { items: list, dx: x, dy: y, grid: Number(o2.grid) || 0, reroutedRouteIds: [] };
      return transact('MOVE_OBJECTS', payload, (state) => {
        const foundAnnotations = new Set();
        state.annotations = state.annotations.map((item) => {
          if (!annotationIds.has(item.id)) return item;
          foundAnnotations.add(item.id); return translateAnnotation(item, x, y);
        });
        const missingAnnotations = Array.from(annotationIds).filter((id) => !foundAnnotations.has(id)).sort(compareText);
        if (missingAnnotations.length) throw new EditorError('ANNOTATION_NOT_FOUND',
          '图示对象不存在：' + missingAnnotations.join(', '), { missing: missingAnnotations });
        if (deviceIds.length) applyDeviceDeltas(state, deviceIds.map((id) => ({ id, dx: x, dy: y })), o2, payload);
      });
    }
    function repositionDevices(moves, type, extraPayload, options) {
      const o2 = options || {}; const normalized = (moves || []).map((entry) => ({ id: String(entry.id),
        dx: snap(finite(entry.dx, 'dx'), o2.grid), dy: snap(finite(entry.dy, 'dy'), o2.grid) }))
        .filter((entry) => entry.dx || entry.dy).sort((a, b) => compareText(a.id, b.id));
      if (!normalized.length) return fail('NO_MOVEMENT', '器件已经位于目标位置。');
      const payload = Object.assign({ reroutedRouteIds: [] }, extraPayload || {});
      return transact(type, payload, (state) => applyDeviceDeltas(state, normalized, o2, payload));
    }
    function alignDevices(ids, mode, options) {
      const o2 = options || {}; const list = Array.from(new Set((ids || []).map(String))).sort(compareText);
      if (list.length < 2) return fail('ALIGN_REQUIRES_TWO', '至少选择两个器件才能对齐。');
      const devices = list.map((id) => current.devices.find((item) => item.id === id));
      const missing = list.filter((id, index) => !devices[index]);
      if (missing.length) return fail('DEVICE_NOT_FOUND', '设备不存在：' + missing.join(', '), { missing });
      if (o2.anchorId != null && !list.includes(String(o2.anchorId))) {
        return fail('ALIGN_ANCHOR_NOT_SELECTED', '对齐基准器件不在当前选择中。', { anchorId: String(o2.anchorId) });
      }
      const anchorId = o2.anchorId == null ? list[0] : String(o2.anchorId);
      const anchor = current.devices.find((item) => item.id === anchorId); const kind = String(mode || '');
      const edge = (device) => {
        const box = device.bbox;
        if (kind === 'left') return box.xMin; if (kind === 'centerX') return (box.xMin + box.xMax) / 2;
        if (kind === 'right') return box.xMax; if (kind === 'top') return box.yMin;
        if (kind === 'centerY') return (box.yMin + box.yMax) / 2; if (kind === 'bottom') return box.yMax;
        throw new EditorError('ALIGN_MODE_INVALID', '不支持的对齐方式：' + kind);
      };
      let target;
      try { target = edge(anchor); } catch (error) { return fail(error.code, error.message, error.details); }
      const vertical = ['left', 'centerX', 'right'].includes(kind);
      const moves = devices.map((device) => {
        const delta = target - edge(device); return { id: device.id, dx: vertical ? delta : 0, dy: vertical ? 0 : delta };
      });
      return repositionDevices(moves, 'ALIGN_DEVICES', { ids: list, mode: kind, anchorId }, Object.assign({}, o2, { grid: 0 }));
    }
    function distributeDevices(ids, axis, options) {
      const o2 = options || {}; const list = Array.from(new Set((ids || []).map(String))).sort(compareText);
      if (list.length < 3) return fail('DISTRIBUTE_REQUIRES_THREE', '至少选择三个器件才能等距分布。');
      const horizontal = String(axis) === 'horizontal';
      if (!horizontal && String(axis) !== 'vertical') return fail('DISTRIBUTE_AXIS_INVALID', '分布方向必须是 horizontal 或 vertical。');
      const devices = list.map((id) => current.devices.find((item) => item.id === id));
      const missing = list.filter((id, index) => !devices[index]);
      if (missing.length) return fail('DEVICE_NOT_FOUND', '设备不存在：' + missing.join(', '), { missing });
      const center = (device) => horizontal ? (device.bbox.xMin + device.bbox.xMax) / 2 :
        (device.bbox.yMin + device.bbox.yMax) / 2;
      devices.sort((a, b) => center(a) - center(b) || compareText(a.id, b.id));
      const start = center(devices[0]); const end = center(devices[devices.length - 1]); const pitch = (end - start) / (devices.length - 1);
      const moves = devices.map((device, index) => {
        const delta = start + pitch * index - center(device);
        return { id: device.id, dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta };
      });
      return repositionDevices(moves, 'DISTRIBUTE_DEVICES', { ids: devices.map((item) => item.id), axis: String(axis) },
        Object.assign({}, o2, { grid: 0 }));
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
    function previewObjectMove(items, dx, dy, options) {
      const o2 = options || {}; const x = snap(finite(dx, 'dx'), o2.grid); const y = snap(finite(dy, 'dy'), o2.grid);
      const list = normalizeSelectionItems(items); const movable = list.filter((item) => ['device', 'annotation'].includes(item.kind));
      const deviceIds = movable.filter((item) => item.kind === 'device').map((item) => item.id);
      const annotationIds = movable.filter((item) => item.kind === 'annotation').map((item) => item.id);
      const missingAnnotations = annotationIds.filter((id) => !current.annotations.some((item) => item.id === id));
      if (missingAnnotations.length) throw new EditorError('ANNOTATION_NOT_FOUND',
        '图示对象不存在：' + missingAnnotations.join(', '), { missing: missingAnnotations });
      const devicePreview = deviceIds.length ? previewDeviceMove(deviceIds, x, y, o2) : null;
      return Object.freeze({ items: Object.freeze(movable.map((item) => Object.freeze(Object.assign({}, item)))),
        dx: x, dy: y, placementOk: devicePreview ? devicePreview.placementOk : true,
        placementError: devicePreview ? devicePreview.placementError : null,
        routes: devicePreview ? devicePreview.routes : Object.freeze([]),
        deviceIds: Object.freeze(deviceIds), annotationIds: Object.freeze(annotationIds) });
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
      remember(current); current = future.pop(); revision += 1; sequence += 1;
      const entry = Object.freeze({ id: 'CMD-' + String(sequence).padStart(5, '0'), revision, type: 'REDO',
        payload: Object.freeze({}), geometryHash: IR.drawingIRHash(current) });
      journal.push(entry); const response = Object.freeze({ accepted: true, command: entry, snapshot: snapshot() });
      emit({ type: 'redo', response }); return response;
    }
    function reset() {
      if (current === initial) return fail('ALREADY_INITIAL', '已经是自动生成的初始版本。');
      remember(current); current = initial; future = []; revision += 1; sequence += 1;
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
    function queryRect(inputBounds, options) {
      const area = normalizedBounds(inputBounds); const o2 = options || {};
      const mode = String(o2.mode || 'intersect').toLowerCase();
      if (!['contained', 'intersect'].includes(mode)) {
        throw new EditorError('RECT_SELECTION_MODE_INVALID', '不支持的框选模式：' + mode);
      }
      const contained = mode === 'contained';
      const kinds = new Set(Array.isArray(o2.kinds) && o2.kinds.length ? o2.kinds.map(String) :
        ['device', 'route', 'annotation']);
      const matches = [];
      if (kinds.has('device')) current.devices.forEach((device) => {
        const box = normalizedBounds(device.bbox);
        if (contained ? boundsContained(box, area) : boundsIntersect(box, area)) matches.push({ kind: 'device', id: device.id });
      });
      if (kinds.has('route')) current.routes.forEach((route) => {
        const segments = route.segments || [];
        const hit = contained ? (route.points || []).every((point) => point.x >= area.xMin - 1e-9 &&
          point.x <= area.xMax + 1e-9 && point.y >= area.yMin - 1e-9 && point.y <= area.yMax + 1e-9) :
          segments.some((segment) => boundsIntersect(normalizedBounds({ x: segment.x1, y: segment.y1,
            width: segment.x2 - segment.x1, height: segment.y2 - segment.y1 }), area));
        if (hit) matches.push({ kind: 'route', id: route.id });
      });
      if (kinds.has('annotation')) current.annotations.forEach((item) => {
        const box = annotationBounds(item); if (!box) return;
        if (contained ? boundsContained(box, area) : boundsIntersect(box, area)) matches.push({ kind: 'annotation', id: item.id });
      });
      return Object.freeze(normalizeSelectionItems(matches).map((item) => Object.freeze(item)));
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
        routerVersion: ROUTER && ROUTER.VERSION || '', modelHash,
        revision, generatedGeometryHash: IR.drawingIRHash(initial), currentGeometryHash: IR.drawingIRHash(current),
        drawingIR: current, journal: Object.freeze(journal.slice()) });
    }

    return Object.freeze({
      schema: SCHEMA, version: VERSION, snapshot, select, selectMany, toggleSelection, queryRect, inspect,
      moveDevices, moveDevice: (id, dx, dy, o2) => moveDevices([id], dx, dy, o2), moveObjects,
      alignDevices, distributeDevices, moveRouteSegment, previewDeviceMove, previewObjectMove, previewRouteSegment, connectionsForPort,
      moveAnnotation, editAnnotationText, undo, redo, reset, subscribe, exportDocument,
      get drawingIR() { return current; }, get selection() { return selection; },
      get selections() { return Object.freeze(selections.map((item) => Object.freeze(Object.assign({}, item)))); },
      get journal() { return Object.freeze(journal.slice()); }
    });
  }

  return Object.freeze({ VERSION, SCHEMA, EditorError, createSession, snap });
});
