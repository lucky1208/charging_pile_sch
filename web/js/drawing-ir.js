/* ============================================================
 * EVSE deterministic Drawing / Geometry IR v1.0
 * ------------------------------------------------------------
 * Pure geometry core shared by SVG and DXF renderers.
 *
 * Responsibilities:
 *  - placed devices, physical port anchors and keep-outs
 *  - optimal deterministic lane allocation for interval channels
 *  - deterministic orthogonal routes
 *  - global, order-independent crossing / keep-out analysis
 *  - model-to-drawing coverage audit
 *  - renderer-neutral primitives carrying equipment/net/circuit IDs
 *
 * This module never infers electrical connectivity.  A route must carry
 * the net/circuit identity and exact terminal endpoints produced by the
 * electrical model.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_DRAWING_IR = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'evse-drawing-ir/v1';
  const EPSILON = 1e-9;

  const DEFAULT_LAYERS = Object.freeze([
    Object.freeze({ id: 'EVSE-EQPT', purpose: 'equipment' }),
    Object.freeze({ id: 'EVSE-AC', purpose: 'power-ac' }),
    Object.freeze({ id: 'EVSE-DC', purpose: 'power-dc' }),
    Object.freeze({ id: 'EVSE-AUX', purpose: 'auxiliary-power' }),
    Object.freeze({ id: 'EVSE-CTL', purpose: 'control' }),
    Object.freeze({ id: 'EVSE-COMM', purpose: 'communication' }),
    Object.freeze({ id: 'EVSE-PE', purpose: 'protective-earth' }),
    Object.freeze({ id: 'EVSE-MARKER', purpose: 'junction-and-bridge-markers' })
  ]);

  class DrawingIRError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'DrawingIRError';
      this.code = code;
      this.details = details || {};
    }
  }

  class ChannelCapacityError extends DrawingIRError {
    constructor(channelId, capacity, required, details) {
      super(
        'CHANNEL_CAPACITY_EXCEEDED',
        'Channel ' + channelId + ' requires ' + required +
          ' lanes but its capacity is ' + capacity + '.',
        Object.assign({ channelId, capacity, required }, details || {})
      );
      this.name = 'ChannelCapacityError';
    }
  }

  class GeometryValidationError extends DrawingIRError {
    constructor(violations, coverage) {
      const geometryCount = Array.isArray(violations) ? violations.length : 0;
      const coverageCount = coverage && Array.isArray(coverage.errors) ? coverage.errors.length : 0;
      super(
        'DRAWING_IR_INVALID',
        'Drawing IR has ' + geometryCount + ' geometry violation(s) and ' +
          coverageCount + ' coverage error(s).',
        { violations: violations || [], coverage: coverage || null }
      );
      this.name = 'GeometryValidationError';
    }
  }

  function finite(value, label) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new DrawingIRError('INVALID_NUMBER', label + ' must be a finite number.', { label, value });
    }
    return Object.is(n, -0) ? 0 : n;
  }

  function nonEmptyId(value, label) {
    const id = String(value == null ? '' : value).trim();
    if (!id) throw new DrawingIRError('MISSING_ID', label + ' is required.', { label });
    return id;
  }

  function compareText(a, b) {
    const aa = String(a);
    const bb = String(b);
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  }

  function compareNumber(a, b) {
    return Math.abs(a - b) <= EPSILON ? 0 : a < b ? -1 : 1;
  }

  function point(x, y) {
    return Object.freeze({ x: finite(x, 'point.x'), y: finite(y, 'point.y') });
  }

  function pointKey(p) {
    return numberKey(p.x) + ',' + numberKey(p.y);
  }

  function numberKey(value) {
    const n = Object.is(Number(value), -0) ? 0 : Number(value);
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(9)));
  }

  function normalizeRect(input, label) {
    const value = input || {};
    let x1;
    let y1;
    let x2;
    let y2;
    if (value.xMin != null || value.xMax != null || value.yMin != null || value.yMax != null) {
      x1 = finite(value.xMin, label + '.xMin');
      y1 = finite(value.yMin, label + '.yMin');
      x2 = finite(value.xMax, label + '.xMax');
      y2 = finite(value.yMax, label + '.yMax');
    } else {
      x1 = finite(value.x, label + '.x');
      y1 = finite(value.y, label + '.y');
      x2 = x1 + finite(value.width != null ? value.width : value.w, label + '.width');
      y2 = y1 + finite(value.height != null ? value.height : value.h, label + '.height');
    }
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);
    if (xMax - xMin <= EPSILON || yMax - yMin <= EPSILON) {
      throw new DrawingIRError('INVALID_RECT', label + ' must have positive width and height.', {
        label, xMin, xMax, yMin, yMax
      });
    }
    return Object.freeze({ xMin, yMin, xMax, yMax, width: xMax - xMin, height: yMax - yMin });
  }

  function endpointRef(deviceId, portId) {
    const device = nonEmptyId(deviceId, 'endpoint.deviceId');
    const port = nonEmptyId(portId, 'endpoint.portId');
    return device + ':' + port;
  }

  function splitEndpointRef(ref) {
    const value = nonEmptyId(ref, 'endpoint.ref');
    const index = value.indexOf(':');
    if (index < 1 || index === value.length - 1) return { ref: value, deviceId: value, portId: '' };
    return { ref: value, deviceId: value.slice(0, index), portId: value.slice(index + 1) };
  }

  function createPortAnchor(deviceId, spec) {
    const value = spec || {};
    const id = nonEmptyId(value.id != null ? value.id : value.portId, 'port.id');
    const ref = value.ref || endpointRef(deviceId, id);
    return Object.freeze({
      id,
      ref: nonEmptyId(ref, 'port.ref'),
      deviceId: nonEmptyId(deviceId, 'port.deviceId'),
      terminalId: String(value.terminalId || value.modelTerminalId || id),
      circuitId: String(value.circuitId || ''),
      x: finite(value.x, 'port.x'),
      y: finite(value.y, 'port.y'),
      side: String(value.side || 'UNSPECIFIED').toUpperCase(),
      direction: String(value.direction || 'BIDIRECTIONAL').toUpperCase(),
      domain: String(value.domain || ''),
      netClass: String(value.netClass || ''),
      label: String(value.label || value.terminalLabel || value.terminalId || id)
    });
  }

  function portArray(deviceId, ports) {
    if (!ports) return [];
    const values = Array.isArray(ports)
      ? ports
      : Object.keys(ports).map((id) => Object.assign({ id }, ports[id] || {}));
    const result = values.map((value) => createPortAnchor(deviceId, value));
    result.sort((a, b) => compareText(a.id, b.id));
    const seen = new Set();
    result.forEach((port) => {
      if (seen.has(port.id)) {
        throw new DrawingIRError('DUPLICATE_PORT_ID', 'Duplicate port ' + port.id + ' on ' + deviceId + '.', {
          deviceId, portId: port.id
        });
      }
      seen.add(port.id);
    });
    return result;
  }

  function createKeepout(ownerId, spec, fallbackId) {
    const value = spec || {};
    const rect = normalizeRect(value.rect || value, 'keepout');
    return Object.freeze(Object.assign({}, rect, {
      id: nonEmptyId(value.id || fallbackId, 'keepout.id'),
      ownerId: String(value.ownerId || ownerId || ''),
      kind: String(value.kind || 'BODY').toUpperCase()
    }));
  }

  function createPlacedDevice(spec) {
    const value = spec || {};
    const id = nonEmptyId(value.id != null ? value.id : value.equipmentId, 'device.id');
    const bbox = normalizeRect(value.bbox || value, 'device[' + id + '].bbox');
    const ports = portArray(id, value.ports);
    const keepouts = [];
    if (value.includeBodyKeepout !== false) {
      keepouts.push(createKeepout(id, bbox, id + ':BODY'));
    }
    (Array.isArray(value.keepouts) ? value.keepouts : []).forEach((keepout, index) => {
      keepouts.push(createKeepout(id, keepout, id + ':KEEP_OUT:' + (index + 1)));
    });
    keepouts.sort((a, b) => compareText(a.id, b.id));
    const seen = new Set();
    keepouts.forEach((keepout) => {
      if (seen.has(keepout.id)) {
        throw new DrawingIRError('DUPLICATE_KEEPOUT_ID', 'Duplicate keep-out ' + keepout.id + '.', {
          deviceId: id, keepoutId: keepout.id
        });
      }
      seen.add(keepout.id);
    });
    return Object.freeze({
      id,
      equipmentId: id,
      type: String(value.type || value.deviceClass || ''),
      system: String(value.system || ''),
      tag: String(value.tag || ''),
      referenceDesignation: String(value.referenceDesignation || value.ref || ''),
      bbox,
      ports: Object.freeze(ports),
      keepouts: Object.freeze(keepouts),
      layer: String(value.layer || 'EVSE-EQPT'),
      label: String(value.label || value.title || id)
    });
  }

  function createChannel(spec) {
    const value = spec || {};
    const id = nonEmptyId(value.id, 'channel.id');
    const orientation = String(value.orientation || '').toLowerCase();
    if (orientation !== 'horizontal' && orientation !== 'vertical') {
      throw new DrawingIRError('INVALID_CHANNEL_ORIENTATION',
        'Channel ' + id + ' orientation must be horizontal or vertical.', { id, orientation });
    }
    let start;
    let end;
    let crossMin;
    let crossMax;
    if (value.bounds) {
      const bounds = normalizeRect(value.bounds, 'channel[' + id + '].bounds');
      if (orientation === 'horizontal') {
        start = bounds.xMin;
        end = bounds.xMax;
        crossMin = bounds.yMin;
        crossMax = bounds.yMax;
      } else {
        start = bounds.yMin;
        end = bounds.yMax;
        crossMin = bounds.xMin;
        crossMax = bounds.xMax;
      }
    } else {
      start = finite(value.start, 'channel.start');
      end = finite(value.end, 'channel.end');
      crossMin = finite(value.crossMin, 'channel.crossMin');
      crossMax = finite(value.crossMax, 'channel.crossMax');
    }
    if (end < start) [start, end] = [end, start];
    if (crossMax < crossMin) [crossMin, crossMax] = [crossMax, crossMin];
    const lanePitch = finite(value.lanePitch == null ? 10 : value.lanePitch, 'channel.lanePitch');
    const laneInset = finite(value.laneInset == null ? 0 : value.laneInset, 'channel.laneInset');
    if (lanePitch <= 0 || laneInset < 0 || crossMax - crossMin < laneInset * 2 - EPSILON) {
      throw new DrawingIRError('INVALID_CHANNEL_LANES', 'Invalid lane pitch/inset for channel ' + id + '.', {
        id, lanePitch, laneInset, crossMin, crossMax
      });
    }
    const derivedCapacity = Math.floor(((crossMax - laneInset) - (crossMin + laneInset)) / lanePitch + EPSILON) + 1;
    const capacity = value.capacity == null ? derivedCapacity : Math.floor(finite(value.capacity, 'channel.capacity'));
    if (capacity < 1 || capacity > derivedCapacity) {
      throw new DrawingIRError('INVALID_CHANNEL_CAPACITY',
        'Channel ' + id + ' capacity must be between 1 and ' + derivedCapacity + '.', {
          id, capacity, derivedCapacity
        });
    }
    return Object.freeze({ id, orientation, start, end, crossMin, crossMax, lanePitch, laneInset, capacity });
  }

  function normalizeInterval(spec, index) {
    const value = spec || {};
    const id = nonEmptyId(value.id != null ? value.id : value.routeId, 'interval[' + index + '].id');
    const a = finite(value.start, 'interval[' + id + '].start');
    const b = finite(value.end, 'interval[' + id + '].end');
    return { id, start: Math.min(a, b), end: Math.max(a, b) };
  }

  /*
   * Earliest-start interval partitioning is optimal for interval graphs:
   * the lane count equals the maximum simultaneous overlap (the clique number).
   * Sorting by end/id and always taking the smallest reusable lane makes the
   * concrete lane labels stable as well as optimal.
   */
  function allocateIntervalLanes(intervals, options) {
    const opts = Object.assign({ gap: 0, touchingConflicts: true, capacity: null, channelId: 'UNNAMED' }, options || {});
    const gap = finite(opts.gap, 'lane.gap');
    if (gap < 0) throw new DrawingIRError('INVALID_LANE_GAP', 'Lane gap cannot be negative.', { gap });
    const values = (Array.isArray(intervals) ? intervals : []).map(normalizeInterval);
    values.sort((a, b) => compareNumber(a.start, b.start) || compareNumber(a.end, b.end) || compareText(a.id, b.id));
    const ids = new Set();
    values.forEach((value) => {
      if (ids.has(value.id)) {
        throw new DrawingIRError('DUPLICATE_INTERVAL_ID', 'Duplicate interval ' + value.id + '.', { id: value.id });
      }
      ids.add(value.id);
    });

    const laneEnds = [];
    const assigned = [];
    const canReuse = (laneEnd, nextStart) => opts.touchingConflicts
      ? laneEnd + gap < nextStart - EPSILON
      : laneEnd + gap <= nextStart + EPSILON;

    values.forEach((value) => {
      let laneIndex = -1;
      for (let lane = 0; lane < laneEnds.length; lane++) {
        if (canReuse(laneEnds[lane], value.start)) {
          laneIndex = lane;
          break;
        }
      }
      if (laneIndex < 0) {
        laneIndex = laneEnds.length;
        laneEnds.push(value.end);
      } else {
        laneEnds[laneIndex] = value.end;
      }
      assigned.push({ id: value.id, start: value.start, end: value.end, laneIndex });
    });

    const capacity = opts.capacity == null ? null : Math.floor(finite(opts.capacity, 'lane.capacity'));
    if (capacity != null && capacity < laneEnds.length) {
      throw new ChannelCapacityError(String(opts.channelId), capacity, laneEnds.length, {
        intervals: values.map((value) => value.id)
      });
    }

    assigned.sort((a, b) => compareText(a.id, b.id));
    const byId = {};
    assigned.forEach((value) => { byId[value.id] = value.laneIndex; });
    return Object.freeze({
      laneCount: laneEnds.length,
      optimal: true,
      assignments: Object.freeze(assigned.map((value) => Object.freeze(value))),
      byId: Object.freeze(byId)
    });
  }

  function assignChannelLanes(channelSpec, traversals, options) {
    const channel = channelSpec && channelSpec.orientation ? createChannel(channelSpec) : createChannel(channelSpec || {});
    const values = (Array.isArray(traversals) ? traversals : []).map(normalizeInterval);
    values.forEach((value) => {
      if (value.start < channel.start - EPSILON || value.end > channel.end + EPSILON) {
        throw new DrawingIRError('TRAVERSAL_OUTSIDE_CHANNEL',
          'Traversal ' + value.id + ' is outside channel ' + channel.id + '.', {
            channelId: channel.id, traversalId: value.id, channelStart: channel.start,
            channelEnd: channel.end, start: value.start, end: value.end
          });
      }
    });
    const allocation = allocateIntervalLanes(values, Object.assign({}, options || {}, {
      capacity: channel.capacity,
      channelId: channel.id
    }));
    const assignments = allocation.assignments.map((value) => Object.freeze(Object.assign({}, value, {
      channelId: channel.id,
      orientation: channel.orientation,
      coordinate: channel.crossMin + channel.laneInset + value.laneIndex * channel.lanePitch
    })));
    const byId = {};
    assignments.forEach((value) => { byId[value.id] = value; });
    return Object.freeze({ channel, laneCount: allocation.laneCount, optimal: true,
      assignments: Object.freeze(assignments), byId: Object.freeze(byId) });
  }

  function normalizeEndpoint(value, label, fallbackPoint) {
    const raw = typeof value === 'string' ? { ref: value } : (value || {});
    const parsed = raw.ref ? splitEndpointRef(raw.ref) : null;
    const deviceId = String(raw.deviceId || raw.equipmentId || (parsed && parsed.deviceId) || '');
    const portId = String(raw.portId || raw.terminalId || (parsed && parsed.portId) || '');
    const ref = raw.ref || (deviceId && portId ? endpointRef(deviceId, portId) : '');
    const fallback = fallbackPoint || {};
    return Object.freeze({
      ref: nonEmptyId(ref, label + '.ref'),
      deviceId,
      portId,
      x: finite(raw.x == null ? fallback.x : raw.x, label + '.x'),
      y: finite(raw.y == null ? fallback.y : raw.y, label + '.y')
    });
  }

  function appendPoint(points, value) {
    const p = point(value.x, value.y);
    const previous = points[points.length - 1];
    if (!previous || Math.abs(previous.x - p.x) > EPSILON || Math.abs(previous.y - p.y) > EPSILON) points.push(p);
  }

  function appendManhattan(points, target, horizontalFirst) {
    const current = points[points.length - 1];
    if (Math.abs(current.x - target.x) > EPSILON && Math.abs(current.y - target.y) > EPSILON) {
      appendPoint(points, horizontalFirst ? { x: target.x, y: current.y } : { x: current.x, y: target.y });
    }
    appendPoint(points, target);
  }

  function removeCollinearPoints(points) {
    const result = [];
    points.forEach((current) => {
      while (result.length >= 2) {
        const a = result[result.length - 2];
        const b = result[result.length - 1];
        const sameX = Math.abs(a.x - b.x) <= EPSILON && Math.abs(b.x - current.x) <= EPSILON;
        const sameY = Math.abs(a.y - b.y) <= EPSILON && Math.abs(b.y - current.y) <= EPSILON;
        if (!sameX && !sameY) break;
        result.pop();
      }
      result.push(current);
    });
    return result;
  }

  function makeSegments(routeId, points) {
    const width = Math.max(2, String(Math.max(0, points.length - 2)).length);
    return points.slice(1).map((to, index) => {
      const from = points[index];
      const horizontal = Math.abs(from.y - to.y) <= EPSILON;
      const vertical = Math.abs(from.x - to.x) <= EPSILON;
      if (!horizontal && !vertical) {
        throw new DrawingIRError('NON_ORTHOGONAL_SEGMENT', 'Route ' + routeId + ' contains a diagonal segment.', {
          routeId, from, to
        });
      }
      if (horizontal && Math.abs(from.x - to.x) <= EPSILON) {
        throw new DrawingIRError('ZERO_LENGTH_SEGMENT', 'Route ' + routeId + ' contains a zero-length segment.', {
          routeId, from, to
        });
      }
      return Object.freeze({
        id: routeId + ':S' + String(index).padStart(width, '0'),
        index,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        orientation: horizontal ? 'horizontal' : 'vertical'
      });
    });
  }

  function routeOrthogonal(spec) {
    const value = spec || {};
    const id = nonEmptyId(value.id != null ? value.id : value.routeId, 'route.id');
    const suppliedPoints = Array.isArray(value.points) ? value.points.map((p) => point(p.x, p.y)) : null;
    let sourceSeed = value.source || value.fromEndpoint;
    let targetSeed = value.target || value.toEndpoint;
    if (!sourceSeed && value.from) {
      sourceSeed = { deviceId: value.from, portId: value.fromPort, x: value.fromX, y: value.fromY };
    }
    if (!targetSeed && value.to) {
      targetSeed = { deviceId: value.to, portId: value.toPort, x: value.toX, y: value.toY };
    }
    const sourceFallback = suppliedPoints && suppliedPoints[0];
    const targetFallback = suppliedPoints && suppliedPoints[suppliedPoints.length - 1];
    const source = normalizeEndpoint(sourceSeed, 'route[' + id + '].source', sourceFallback);
    const target = normalizeEndpoint(targetSeed, 'route[' + id + '].target', targetFallback);
    let points;
    if (suppliedPoints) {
      if (suppliedPoints.length < 2) {
        throw new DrawingIRError('ROUTE_TOO_SHORT', 'Route ' + id + ' requires at least two points.', { id });
      }
      points = removeCollinearPoints(suppliedPoints);
      if (Math.abs(points[0].x - source.x) > EPSILON || Math.abs(points[0].y - source.y) > EPSILON ||
          Math.abs(points[points.length - 1].x - target.x) > EPSILON ||
          Math.abs(points[points.length - 1].y - target.y) > EPSILON) {
        throw new DrawingIRError('ROUTE_ENDPOINT_COORDINATE_MISMATCH',
          'Route ' + id + ' point endpoints do not match its terminal anchors.', { id, source, target });
      }
    } else {
      points = [];
      appendPoint(points, source);
      const horizontalFirst = String(value.bend || value.orientation || 'horizontal-first').toLowerCase() !== 'vertical-first';
      (Array.isArray(value.via) ? value.via : []).forEach((via) => appendManhattan(points, via, horizontalFirst));
      appendManhattan(points, target, horizontalFirst);
      points = removeCollinearPoints(points);
    }
    const segments = makeSegments(id, points);
    return Object.freeze({
      id,
      routeId: id,
      netId: String(value.netId || ''),
      circuitId: String(value.circuitId || ''),
      netClass: String(value.netClass || ''),
      domain: String(value.domain || ''),
      polarity: String(value.polarity || ''),
      phase: String(value.phase || ''),
      protocol: String(value.protocol || ''),
      source,
      target,
      points: Object.freeze(points),
      segments: Object.freeze(segments),
      layer: String(value.layer || 'EVSE-CTL'),
      bridgePriority: Number.isFinite(Number(value.bridgePriority)) ? Number(value.bridgePriority) : 0,
      style: String(value.style || 'orthogonal')
    });
  }

  function pointOnSegment(p, segment, strict) {
    if (segment.orientation === 'horizontal') {
      const min = Math.min(segment.x1, segment.x2);
      const max = Math.max(segment.x1, segment.x2);
      return Math.abs(p.y - segment.y1) <= EPSILON &&
        (strict ? p.x > min + EPSILON && p.x < max - EPSILON : p.x >= min - EPSILON && p.x <= max + EPSILON);
    }
    const min = Math.min(segment.y1, segment.y2);
    const max = Math.max(segment.y1, segment.y2);
    return Math.abs(p.x - segment.x1) <= EPSILON &&
      (strict ? p.y > min + EPSILON && p.y < max - EPSILON : p.y >= min - EPSILON && p.y <= max + EPSILON);
  }

  function isSegmentEndpoint(p, segment) {
    return (Math.abs(p.x - segment.x1) <= EPSILON && Math.abs(p.y - segment.y1) <= EPSILON) ||
      (Math.abs(p.x - segment.x2) <= EPSILON && Math.abs(p.y - segment.y2) <= EPSILON);
  }

  function normalizedSegment(route, segment) {
    return Object.assign({}, segment, {
      routeId: route.id,
      netId: route.netId,
      circuitId: route.circuitId,
      netClass: route.netClass,
      domain: route.domain,
      polarity: route.polarity,
      phase: route.phase,
      protocol: route.protocol,
      bridgePriority: route.bridgePriority
    });
  }

  function flattenSegments(routes) {
    const result = [];
    routes.forEach((route) => route.segments.forEach((segment) => result.push(normalizedSegment(route, segment))));
    result.sort((a, b) => compareText(a.routeId, b.routeId) || a.index - b.index);
    return result;
  }

  function overlap1d(a1, a2, b1, b2) {
    const start = Math.max(Math.min(a1, a2), Math.min(b1, b2));
    const end = Math.min(Math.max(a1, a2), Math.max(b1, b2));
    return { start, end, length: end - start };
  }

  function sameNet(a, b) {
    return !!a.netId && a.netId === b.netId;
  }

  function crossingRouteChoice(a, b) {
    if (a.bridgePriority !== b.bridgePriority) return a.bridgePriority > b.bridgePriority ? a.routeId : b.routeId;
    return compareText(a.routeId, b.routeId) <= 0 ? a.routeId : b.routeId;
  }

  function adjacentSameRoute(a, b) {
    return a.routeId === b.routeId && Math.abs(a.index - b.index) === 1;
  }

  function pairKey(a, b) {
    return compareText(a.routeId, b.routeId) <= 0
      ? a.routeId + '|' + b.routeId
      : b.routeId + '|' + a.routeId;
  }

  function classifySegmentPair(a, b) {
    if (adjacentSameRoute(a, b)) return null;
    if (a.orientation === b.orientation) {
      const collinear = a.orientation === 'horizontal'
        ? Math.abs(a.y1 - b.y1) <= EPSILON
        : Math.abs(a.x1 - b.x1) <= EPSILON;
      if (!collinear) return null;
      const overlap = a.orientation === 'horizontal'
        ? overlap1d(a.x1, a.x2, b.x1, b.x2)
        : overlap1d(a.y1, a.y2, b.y1, b.y2);
      if (overlap.length > EPSILON) {
        const from = a.orientation === 'horizontal' ? point(overlap.start, a.y1) : point(a.x1, overlap.start);
        const to = a.orientation === 'horizontal' ? point(overlap.end, a.y1) : point(a.x1, overlap.end);
        return { type: 'illegal_overlap', routeIds: [a.routeId, b.routeId].sort(compareText),
          segmentIds: [a.id, b.id].sort(compareText), from, to,
          netIds: [a.netId, b.netId].filter(Boolean).sort(compareText) };
      }
      if (Math.abs(overlap.length) <= EPSILON) {
        const p = a.orientation === 'horizontal' ? point(overlap.start, a.y1) : point(a.x1, overlap.start);
        if (sameNet(a, b)) {
          return { type: 'junction', x: p.x, y: p.y, routeIds: [a.routeId, b.routeId].sort(compareText),
            netId: a.netId };
        }
        return { type: 'illegal_contact', x: p.x, y: p.y,
          routeIds: [a.routeId, b.routeId].sort(compareText),
          segmentIds: [a.id, b.id].sort(compareText),
          netIds: [a.netId, b.netId].filter(Boolean).sort(compareText) };
      }
      return null;
    }

    const horizontal = a.orientation === 'horizontal' ? a : b;
    const vertical = a.orientation === 'vertical' ? a : b;
    const p = point(vertical.x1, horizontal.y1);
    if (!pointOnSegment(p, horizontal, false) || !pointOnSegment(p, vertical, false)) return null;
    if (a.routeId === b.routeId) {
      return { type: 'illegal_self_crossing', x: p.x, y: p.y, routeIds: [a.routeId],
        segmentIds: [a.id, b.id].sort(compareText), netIds: [a.netId].filter(Boolean) };
    }
    if (sameNet(a, b)) {
      return { type: 'junction', x: p.x, y: p.y,
        routeIds: [a.routeId, b.routeId].sort(compareText), netId: a.netId };
    }
    if (isSegmentEndpoint(p, a) || isSegmentEndpoint(p, b)) {
      return { type: 'illegal_contact', x: p.x, y: p.y,
        routeIds: [a.routeId, b.routeId].sort(compareText),
        segmentIds: [a.id, b.id].sort(compareText),
        netIds: [a.netId, b.netId].filter(Boolean).sort(compareText) };
    }
    return {
      type: 'bridge', x: p.x, y: p.y,
      routeIds: [a.routeId, b.routeId].sort(compareText),
      netIds: [a.netId, b.netId].filter(Boolean).sort(compareText),
      bridgeRouteId: crossingRouteChoice(a, b)
    };
  }

  function segmentIntersectsKeepout(segment, keepout) {
    if (segment.orientation === 'horizontal') {
      if (!(segment.y1 > keepout.yMin + EPSILON && segment.y1 < keepout.yMax - EPSILON)) return false;
      return overlap1d(segment.x1, segment.x2, keepout.xMin, keepout.xMax).length > EPSILON;
    }
    if (!(segment.x1 > keepout.xMin + EPSILON && segment.x1 < keepout.xMax - EPSILON)) return false;
    return overlap1d(segment.y1, segment.y2, keepout.yMin, keepout.yMax).length > EPSILON;
  }

  function eventKey(event) {
    if (event.type === 'illegal_overlap') {
      return event.type + '|' + event.routeIds.join('|') + '|' + pointKey(event.from) + '|' + pointKey(event.to);
    }
    if (event.type === 'keepout') {
      return event.type + '|' + event.routeId + '|' + event.segmentId + '|' + event.keepoutId;
    }
    return event.type + '|' + (event.routeIds || []).join('|') + '|' + numberKey(event.x) + '|' + numberKey(event.y);
  }

  function sortEvents(events) {
    return events.sort((a, b) => compareText(eventKey(a), eventKey(b)));
  }

  function analyzeGeometry(input) {
    const value = input || {};
    const devices = (Array.isArray(value.devices) ? value.devices : []).map((device) =>
      device && device.bbox && Array.isArray(device.ports) ? device : createPlacedDevice(device));
    const routes = (Array.isArray(value.routes) ? value.routes : []).map((route) =>
      route && Array.isArray(route.segments) && route.source && route.target ? route : routeOrthogonal(route));
    devices.sort((a, b) => compareText(a.id, b.id));
    routes.sort((a, b) => compareText(a.id, b.id));
    const segments = flattenSegments(routes);
    const events = [];
    const keys = new Set();
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const event = classifySegmentPair(segments[i], segments[j]);
        if (!event) continue;
        const key = eventKey(event);
        if (!keys.has(key)) {
          keys.add(key);
          events.push(event);
        }
      }
    }
    devices.forEach((device) => device.keepouts.forEach((keepout) => {
      segments.forEach((segment) => {
        if (!segmentIntersectsKeepout(segment, keepout)) return;
        const event = {
          type: 'keepout', routeId: segment.routeId, segmentId: segment.id,
          netId: segment.netId, deviceId: device.id, keepoutId: keepout.id
        };
        const key = eventKey(event);
        if (!keys.has(key)) {
          keys.add(key);
          events.push(event);
        }
      });
    }));
    sortEvents(events);
    const junctions = events.filter((event) => event.type === 'junction');
    const bridges = events.filter((event) => event.type === 'bridge');
    const violations = events.filter((event) => event.type !== 'junction' && event.type !== 'bridge').map((event) =>
      Object.freeze(Object.assign({
        code: event.type === 'illegal_overlap' ? 'ILLEGAL_COLLINEAR_OVERLAP'
          : event.type === 'keepout' ? 'ROUTE_KEEP_OUT_INTERSECTION'
            : event.type === 'illegal_contact' ? 'DIFFERENT_NET_CONTACT'
              : 'ILLEGAL_SELF_CROSSING'
      }, event)));
    return Object.freeze({
      classifications: Object.freeze(events.map((event) => Object.freeze(event))),
      junctions: Object.freeze(junctions),
      bridges: Object.freeze(bridges),
      illegalOverlaps: Object.freeze(events.filter((event) => event.type === 'illegal_overlap')),
      keepoutViolations: Object.freeze(events.filter((event) => event.type === 'keepout')),
      violations: Object.freeze(violations),
      ok: violations.length === 0
    });
  }

  function modelDeviceArray(model) {
    if (!model || typeof model !== 'object') return [];
    const list = model.instances || model.equipment || model.devices || [];
    return Array.isArray(list) ? list : Object.keys(list).map((id) => Object.assign({ id }, list[id] || {}));
  }

  function itemId(value) {
    return typeof value === 'string' ? value : String((value &&
      (value.id || value.equipmentId || value.instanceId || value.netId || value.circuitId)) || '');
  }

  function makeModelEndpoint(device, port) {
    if (device && typeof device === 'object') {
      const ref = device.ref || device.endpointRef;
      if (ref) return nonEmptyId(ref, 'model.endpoint.ref');
      return endpointRef(device.deviceId || device.equipmentId || device.instanceId || device.id,
        device.portId || device.terminalId || device.port || port);
    }
    const deviceText = String(device == null ? '' : device);
    if (!port && deviceText.includes(':')) return nonEmptyId(deviceText, 'model.endpoint');
    return endpointRef(deviceText, port);
  }

  function connectionEndpoints(item) {
    const value = item || {};
    const members = value.members || value.endpoints || value.terminals;
    if (Array.isArray(members) && members.length) {
      return Array.from(new Set(members.map((member) => makeModelEndpoint(member)))).sort(compareText);
    }
    const source = value.source || value.fromEndpoint;
    const target = value.target || value.toEndpoint;
    if (source || target) return [makeModelEndpoint(source), makeModelEndpoint(target)].sort(compareText);
    if (value.from != null || value.to != null) {
      return [makeModelEndpoint(value.from, value.fromPort), makeModelEndpoint(value.to, value.toPort)].sort(compareText);
    }
    return [];
  }

  function routeEndpointRefs(route) {
    return [route.source && route.source.ref, route.target && route.target.ref].filter(Boolean).sort(compareText);
  }

  function equalSets(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(compareText);
  }

  function auditConnectionCollection(kind, modelItems, routes, routeField, errors) {
    if (!Array.isArray(modelItems) || !modelItems.length) return;
    const expected = new Map();
    modelItems.forEach((item) => {
      const id = itemId(item);
      if (!id) {
        errors.push({ code: 'MODEL_CONNECTION_MISSING_ID', kind });
        return;
      }
      if (expected.has(id)) {
        errors.push({ code: 'DUPLICATE_MODEL_CONNECTION_ID', kind, id });
        return;
      }
      expected.set(id, connectionEndpoints(item));
    });
    const actual = new Map();
    const routeCount = new Map();
    routes.forEach((route) => {
      const id = String(route[routeField] || '');
      if (!id) {
        errors.push({ code: 'ROUTE_MISSING_' + kind.toUpperCase() + '_ID', kind, routeId: route.id });
        return;
      }
      const list = actual.get(id) || [];
      list.push(...routeEndpointRefs(route));
      actual.set(id, list);
      routeCount.set(id, (routeCount.get(id) || 0) + 1);
    });
    expected.forEach((endpoints, id) => {
      if (!actual.has(id)) {
        errors.push({ code: 'CONNECTION_MISSING_ROUTE', kind, id });
        return;
      }
      const actualEndpoints = uniqueSorted(actual.get(id));
      if (!equalSets(uniqueSorted(endpoints), actualEndpoints)) {
        errors.push({ code: 'CONNECTION_ENDPOINT_MISMATCH', kind, id,
          expected: uniqueSorted(endpoints), actual: actualEndpoints });
      }
      if (kind === 'circuit' && routeCount.get(id) !== 1) {
        errors.push({ code: 'CIRCUIT_ROUTE_CARDINALITY', kind, id,
          expected: 1, actual: routeCount.get(id) });
      }
    });
    actual.forEach((endpoints, id) => {
      if (!expected.has(id)) errors.push({ code: 'ROUTE_UNKNOWN_CONNECTION', kind, id,
        actual: uniqueSorted(endpoints) });
    });
  }

  function auditCoverage(model, drawing) {
    const value = drawing || {};
    const routes = (Array.isArray(value.routes) ? value.routes : []).map((route) =>
      route && route.source && route.target && Array.isArray(route.segments) ? route : routeOrthogonal(route));
    const modelDeviceIds = uniqueSorted(modelDeviceArray(model).map(itemId));
    const drawingDevices = Array.isArray(value.devices) ? value.devices : [];
    const drawingDeviceIds = drawingDevices.length
      ? uniqueSorted(drawingDevices.map(itemId))
      : uniqueSorted(routes.flatMap((route) => [route.source.deviceId, route.target.deviceId]));
    const errors = [];
    modelDeviceIds.forEach((id) => {
      if (!drawingDeviceIds.includes(id)) errors.push({ code: 'DEVICE_MISSING_IN_DRAWING', id });
    });
    drawingDeviceIds.forEach((id) => {
      if (!modelDeviceIds.includes(id)) errors.push({ code: 'DEVICE_EXTRA_IN_DRAWING', id });
    });

    /* A route endpoint is not merely a text label: it must resolve to the
       exact placed terminal anchor and coordinate. */
    if (drawingDevices.length) {
      const anchors = new Map();
      drawingDevices.forEach((device) => {
        const deviceId = itemId(device);
        const ports = Array.isArray(device.ports)
          ? device.ports
          : Object.keys(device.ports || {}).map((id) => Object.assign({ id }, device.ports[id] || {}));
        ports.forEach((port) => {
          const ref = port.ref || endpointRef(deviceId, port.id || port.portId);
          const list = anchors.get(ref) || [];
          list.push(port);
          anchors.set(ref, list);
        });
      });
      routes.forEach((route) => [route.source, route.target].forEach((routeEndpoint) => {
        const candidates = anchors.get(routeEndpoint.ref) || [];
        if (!candidates.length) {
          errors.push({ code: 'ROUTE_ENDPOINT_NOT_PLACED', routeId: route.id, endpoint: routeEndpoint.ref });
          return;
        }
        const matched = candidates.some((anchor) =>
          Math.abs(Number(anchor.x) - routeEndpoint.x) <= EPSILON &&
          Math.abs(Number(anchor.y) - routeEndpoint.y) <= EPSILON);
        if (!matched) {
          errors.push({ code: 'ROUTE_ENDPOINT_ANCHOR_MISMATCH', routeId: route.id,
            endpoint: routeEndpoint.ref,
            expected: candidates.map((anchor) => ({ x: Number(anchor.x), y: Number(anchor.y) })),
            actual: { x: routeEndpoint.x, y: routeEndpoint.y } });
        }
      }));
    }

    const routeIds = new Set();
    routes.forEach((route) => {
      if (routeIds.has(route.id)) errors.push({ code: 'DUPLICATE_ROUTE_ID', id: route.id });
      routeIds.add(route.id);
    });

    const circuits = model && Array.isArray(model.circuits) ? model.circuits : [];
    const nets = model && Array.isArray(model.nets) ? model.nets.map((net) => Object.assign({}, net)) : [];
    if (nets.length && circuits.length) {
      const netMap = new Map();
      nets.forEach((net) => netMap.set(itemId(net), uniqueSorted(connectionEndpoints(net))));
      circuits.forEach((circuit) => {
        const netId = String(circuit.netId || '');
        if (netId && netMap.has(netId)) netMap.set(netId,
          uniqueSorted(netMap.get(netId).concat(connectionEndpoints(circuit))));
      });
      nets.forEach((net) => { net.members = netMap.get(itemId(net)); });
    }
    auditConnectionCollection('circuit', circuits, routes, 'circuitId', errors);
    auditConnectionCollection('net', nets, routes, 'netId', errors);
    errors.sort((a, b) => compareText(stableStringify(a), stableStringify(b)));
    return Object.freeze({
      ok: errors.length === 0,
      errors: Object.freeze(errors.map((error) => Object.freeze(error))),
      summary: Object.freeze({
        modelDevices: modelDeviceIds.length,
        drawingDevices: drawingDeviceIds.length,
        modelNets: nets.length,
        modelCircuits: circuits.length,
        drawingRoutes: routes.length
      })
    });
  }

  function markerId(marker) {
    const routes = (marker.routeIds || []).join('-');
    return marker.type.toUpperCase() + ':' + numberKey(marker.x) + ':' + numberKey(marker.y) + ':' + routes;
  }

  function devicePrimitives(device) {
    const result = [{
      id: 'DEVICE:' + device.id,
      kind: 'rect',
      layer: device.layer,
      equipmentId: device.id,
      x: device.bbox.xMin,
      y: device.bbox.yMin,
      width: device.bbox.width,
      height: device.bbox.height,
      label: device.label
    }];
    device.ports.forEach((port) => result.push({
      /* A physical terminal may deliberately have several graphical tap
         anchors (one per exact circuit).  endpointRef remains the physical
         identity; the primitive ID follows the unique graphical port ID. */
      id: 'PORT:' + device.id + ':' + port.id,
      kind: 'port',
      layer: device.layer,
      equipmentId: device.id,
      portId: port.id,
      endpointRef: port.ref,
      x: port.x,
      y: port.y
    }));
    return result;
  }

  function routePrimitive(route) {
    return {
      id: 'ROUTE:' + route.id,
      kind: 'polyline',
      layer: route.layer,
      routeId: route.id,
      netId: route.netId,
      circuitId: route.circuitId,
      netClass: route.netClass,
      domain: route.domain,
      polarity: route.polarity,
      phase: route.phase,
      protocol: route.protocol,
      from: route.source.ref,
      to: route.target.ref,
      points: route.points.map((p) => ({ x: p.x, y: p.y }))
    };
  }

  function markerPrimitive(marker) {
    return {
      id: markerId(marker),
      kind: marker.type,
      layer: 'EVSE-MARKER',
      x: marker.x,
      y: marker.y,
      routeIds: marker.routeIds.slice(),
      netId: marker.netId || '',
      netIds: marker.netIds ? marker.netIds.slice() : [],
      bridgeRouteId: marker.bridgeRouteId || '',
      radius: marker.type === 'bridge' ? 4 : 1.8
    };
  }

  function normalizeLayers(layers) {
    const source = Array.isArray(layers) && layers.length ? layers : DEFAULT_LAYERS;
    return source.map((layer) => Object.freeze({
      id: nonEmptyId(layer.id || layer.name, 'layer.id'),
      purpose: String(layer.purpose || '')
    })).sort((a, b) => compareText(a.id, b.id));
  }

  function buildDrawingIR(spec) {
    const value = spec || {};
    const devices = (Array.isArray(value.devices) ? value.devices : []).map((device) =>
      device && device.bbox && Array.isArray(device.ports) ? device : createPlacedDevice(device));
    const routes = (Array.isArray(value.routes) ? value.routes : []).map((route) =>
      route && route.source && route.target && Array.isArray(route.segments) ? route : routeOrthogonal(route));
    devices.sort((a, b) => compareText(a.id, b.id));
    routes.sort((a, b) => compareText(a.id, b.id));
    const deviceIds = new Set();
    devices.forEach((device) => {
      if (deviceIds.has(device.id)) throw new DrawingIRError('DUPLICATE_DEVICE_ID', 'Duplicate placed device ' + device.id + '.', { id: device.id });
      deviceIds.add(device.id);
    });
    const routeIds = new Set();
    routes.forEach((route) => {
      if (routeIds.has(route.id)) throw new DrawingIRError('DUPLICATE_ROUTE_ID', 'Duplicate route ' + route.id + '.', { id: route.id });
      routeIds.add(route.id);
    });
    const analysis = analyzeGeometry({ devices, routes });
    const markers = analysis.junctions.concat(analysis.bridges).map((marker) => Object.freeze(Object.assign({}, marker)));
    markers.sort((a, b) => compareText(markerId(a), markerId(b)));
    const primitives = [];
    devices.forEach((device) => primitives.push(...devicePrimitives(device)));
    routes.forEach((route) => primitives.push(routePrimitive(route)));
    markers.forEach((marker) => primitives.push(markerPrimitive(marker)));
    primitives.sort((a, b) => compareText(a.id, b.id));
    const ir = {
      schema: SCHEMA,
      version: VERSION,
      coordinateSystem: Object.freeze({ unit: String(value.unit || 'mm'), xAxis: 'right', yAxis: String(value.yAxis || 'down') }),
      metadata: Object.freeze(Object.assign({}, value.metadata || {})),
      layers: Object.freeze(normalizeLayers(value.layers)),
      devices: Object.freeze(devices),
      routes: Object.freeze(routes),
      markers: Object.freeze(markers),
      primitives: Object.freeze(primitives.map((primitive) => Object.freeze(primitive))),
      violations: analysis.violations,
      coverage: null
    };
    ir.coverage = value.model ? auditCoverage(value.model, ir) : null;
    Object.freeze(ir);
    if (value.strict) assertValidDrawingIR(ir);
    return ir;
  }

  function postProcessCrossings(drawing) {
    const value = drawing || {};
    return buildDrawingIR({
      devices: value.devices || [],
      routes: value.routes || [],
      model: value.model || null,
      metadata: value.metadata || {},
      layers: value.layers || DEFAULT_LAYERS,
      unit: value.coordinateSystem && value.coordinateSystem.unit,
      yAxis: value.coordinateSystem && value.coordinateSystem.yAxis,
      strict: false
    });
  }

  function assertValidDrawingIR(ir) {
    const violations = ir && Array.isArray(ir.violations) ? ir.violations : [];
    const coverage = ir && ir.coverage;
    if (violations.length || (coverage && !coverage.ok)) throw new GeometryValidationError(violations, coverage);
    return ir;
  }

  function canonicalize(value) {
    if (value == null || typeof value !== 'object') {
      if (typeof value === 'number' && Object.is(value, -0)) return 0;
      return value;
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    const result = {};
    Object.keys(value).sort(compareText).forEach((key) => {
      if (typeof value[key] !== 'undefined') result[key] = canonicalize(value[key]);
    });
    return result;
  }

  function stableStringify(value) {
    return JSON.stringify(canonicalize(value));
  }

  function canonicalDrawingProjection(ir) {
    const value = ir || {};
    const sortById = (array) => (Array.isArray(array) ? array.slice() : []).sort((a, b) =>
      compareText((a && (a.id || eventKey(a))) || '', (b && (b.id || eventKey(b))) || ''));
    return canonicalize({
      schema: value.schema || SCHEMA,
      version: value.version || VERSION,
      coordinateSystem: value.coordinateSystem || null,
      metadata: value.metadata || {},
      layers: sortById(value.layers),
      devices: sortById(value.devices).map((device) => Object.assign({}, device, {
        ports: sortById(device.ports), keepouts: sortById(device.keepouts)
      })),
      routes: sortById(value.routes),
      markers: sortById(value.markers),
      primitives: sortById(value.primitives),
      violations: (Array.isArray(value.violations) ? value.violations.slice() : []).sort((a, b) =>
        compareText(eventKey(a), eventKey(b))),
      coverage: value.coverage || null
    });
  }

  function drawingIRHash(ir) {
    const text = stableStringify(canonicalDrawingProjection(ir));
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'fnv1a32:' + hash.toString(16).padStart(8, '0');
  }

  return Object.freeze({
    VERSION,
    SCHEMA,
    DEFAULT_LAYERS,
    DrawingIRError,
    ChannelCapacityError,
    GeometryValidationError,
    createPortAnchor,
    createPlacedDevice,
    createChannel,
    allocateIntervalLanes,
    assignChannelLanes,
    routeOrthogonal,
    analyzeGeometry,
    postProcessCrossings,
    auditCoverage,
    buildDrawingIR,
    assertValidDrawingIR,
    canonicalDrawingProjection,
    stableStringify,
    drawingIRHash,
    endpointRef,
    /* concise aliases for compiler/renderer adapters */
    place: createPlacedDevice,
    allocateLanes: allocateIntervalLanes,
    route: routeOrthogonal,
    analyze: analyzeGeometry,
    audit: auditCoverage,
    build: buildDrawingIR,
    hash: drawingIRHash
  });
});
