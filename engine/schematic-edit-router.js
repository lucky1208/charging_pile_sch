/* ============================================================
 * Obstacle-aware router for transactional schematic editing
 * ------------------------------------------------------------
 * The generation compiler owns electrical connectivity.  This module only
 * changes the geometry of already modelled routes whose exact source/target
 * terminal references are fixed.  It deliberately has no "draw through the
 * obstacle" fallback: inability to find a legal path is a rejected edit.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  let ir = root && root.EVSE_DRAWING_IR;
  if (!ir && typeof module === 'object' && module && module.exports && typeof require === 'function') {
    ir = require('./drawing-ir.js');
  }
  const api = factory(ir);
  if (root) root.EVSE_SCHEMATIC_EDIT_ROUTER = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (IR) {
  'use strict';

  const VERSION = '1.0.0';
  const EPSILON = 1e-9;

  class EditRouterError extends Error {
    constructor(code, message, details) {
      super(message); this.name = 'EditRouterError'; this.code = code; this.details = details || {};
    }
  }

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function compareText(a, b) {
    const aa = String(a); const bb = String(b);
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  }
  function finite(value, fallback) {
    const number = Number(value); return Number.isFinite(number) ? number : fallback;
  }
  function pointKey(point) { return numberKey(point.x) + ',' + numberKey(point.y); }
  function numberKey(value) {
    const number = Object.is(Number(value), -0) ? 0 : Number(value);
    return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)));
  }
  function samePoint(a, b) {
    return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
  }
  function simplifyPoints(input) {
    const output = [];
    (input || []).forEach((raw) => {
      const current = { x: Number(raw.x), y: Number(raw.y) };
      if (output.length && samePoint(output[output.length - 1], current)) return;
      while (output.length >= 2) {
        const a = output[output.length - 2]; const b = output[output.length - 1];
        const sameX = Math.abs(a.x - b.x) <= EPSILON && Math.abs(b.x - current.x) <= EPSILON;
        const sameY = Math.abs(a.y - b.y) <= EPSILON && Math.abs(b.y - current.y) <= EPSILON;
        if (!sameX && !sameY) break;
        output.pop();
      }
      output.push(current);
    });
    return output;
  }
  function segmentsForPoints(points) {
    return points.slice(1).map((to, index) => {
      const from = points[index]; const horizontal = Math.abs(from.y - to.y) <= EPSILON;
      return { index, x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        orientation: horizontal ? 'horizontal' : 'vertical' };
    });
  }
  function rect(value) {
    const xMin = finite(value.xMin, finite(value.x, 0));
    const yMin = finite(value.yMin, finite(value.y, 0));
    const width = finite(value.width, finite(value.xMax, xMin) - xMin);
    const height = finite(value.height, finite(value.yMax, yMin) - yMin);
    return { xMin, yMin, xMax: xMin + width, yMax: yMin + height };
  }
  function expandRect(value, amount) {
    const source = rect(value); const gap = Math.max(0, Number(amount) || 0);
    return { xMin: source.xMin - gap, yMin: source.yMin - gap,
      xMax: source.xMax + gap, yMax: source.yMax + gap };
  }
  function rectsOverlap(a, b, clearance) {
    const gap = Math.max(0, Number(clearance) || 0);
    return a.xMin < b.xMax + gap - EPSILON && a.xMax > b.xMin - gap + EPSILON &&
      a.yMin < b.yMax + gap - EPSILON && a.yMax > b.yMin - gap + EPSILON;
  }
  function segmentIntersectsRectInterior(segment, value) {
    if (segment.orientation === 'horizontal') {
      if (!(segment.y1 > value.yMin + EPSILON && segment.y1 < value.yMax - EPSILON)) return false;
      return Math.min(Math.max(segment.x1, segment.x2), value.xMax) -
        Math.max(Math.min(segment.x1, segment.x2), value.xMin) > EPSILON;
    }
    if (!(segment.x1 > value.xMin + EPSILON && segment.x1 < value.xMax - EPSILON)) return false;
    return Math.min(Math.max(segment.y1, segment.y2), value.yMax) -
      Math.max(Math.min(segment.y1, segment.y2), value.yMin) > EPSILON;
  }
  function pointInsideRect(point, value) {
    return point.x > value.xMin + EPSILON && point.x < value.xMax - EPSILON &&
      point.y > value.yMin + EPSILON && point.y < value.yMax - EPSILON;
  }
  function segmentBounds(segment) {
    return { xMin: Math.min(segment.x1, segment.x2), xMax: Math.max(segment.x1, segment.x2),
      yMin: Math.min(segment.y1, segment.y2), yMax: Math.max(segment.y1, segment.y2) };
  }
  function boundsIntersect(a, b) {
    return a.xMax >= b.xMin - EPSILON && a.xMin <= b.xMax + EPSILON &&
      a.yMax >= b.yMin - EPSILON && a.yMin <= b.yMax + EPSILON;
  }
  function overlap1d(a1, a2, b1, b2) {
    const start = Math.max(Math.min(a1, a2), Math.min(b1, b2));
    const end = Math.min(Math.max(a1, a2), Math.max(b1, b2));
    return { start, end, length: end - start };
  }
  function endpointOf(point, segment) {
    return (Math.abs(point.x - segment.x1) <= EPSILON && Math.abs(point.y - segment.y1) <= EPSILON) ||
      (Math.abs(point.x - segment.x2) <= EPSILON && Math.abs(point.y - segment.y2) <= EPSILON);
  }

  function normalizeRoute(route, points) {
    return IR.routeOrthogonal({
      id: route.id, netId: route.netId, circuitId: route.circuitId,
      netClass: route.netClass, domain: route.domain, polarity: route.polarity, phase: route.phase,
      protocol: route.protocol, source: route.source, target: route.target,
      points: points || route.points, layer: route.layer,
      bridgePriority: route.bridgePriority, style: route.style
    });
  }

  function deviceObstacles(devices, clearance) {
    const seen = new Set(); const result = [];
    (devices || []).forEach((device) => {
      const source = (device.keepouts && device.keepouts.length) ? device.keepouts : [device.bbox];
      source.forEach((keepout, index) => {
        const raw = rect(keepout); const id = String(keepout.id || device.id + ':KEEP:' + index);
        if (seen.has(id)) return;
        seen.add(id); result.push({ id, ownerId: String(device.id), raw,
          expanded: expandRect(raw, clearance) });
      });
    });
    return result.sort((a, b) => compareText(a.id, b.id));
  }
  function annotationObstacles(annotations, padding) {
    return (annotations || []).filter((item) => item && item.kind === 'text' && item.text).map((item) => {
      const height = Math.max(1, finite(item.height, 8));
      const width = Math.max(height, String(item.text).length * height * 0.58);
      const anchor = String(item.anchor || 'start');
      const x = anchor === 'middle' ? item.x - width / 2 : anchor === 'end' ? item.x - width : item.x;
      return expandRect({ x, y: item.y - height * 0.72, width, height }, padding);
    });
  }
  function findPort(device, endpoint) {
    if (!device) return null;
    return (device.ports || []).find((port) => port.id === endpoint.portId) ||
      (device.ports || []).find((port) => port.ref === endpoint.ref) || null;
  }
  function inferSide(device, endpoint) {
    const port = findPort(device, endpoint);
    const declared = String(port && port.side || '').toUpperCase();
    if (['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].includes(declared)) return declared;
    if (!device || !device.bbox) return '';
    const body = rect(device.bbox); const candidates = [
      { side: 'LEFT', distance: Math.abs(endpoint.x - body.xMin) },
      { side: 'RIGHT', distance: Math.abs(endpoint.x - body.xMax) },
      { side: 'TOP', distance: Math.abs(endpoint.y - body.yMin) },
      { side: 'BOTTOM', distance: Math.abs(endpoint.y - body.yMax) }
    ].sort((a, b) => a.distance - b.distance || compareText(a.side, b.side));
    return candidates[0].side;
  }
  function escapePoint(endpoint, side, distance) {
    const point = { x: endpoint.x, y: endpoint.y };
    if (side === 'LEFT') point.x -= distance;
    if (side === 'RIGHT') point.x += distance;
    if (side === 'TOP') point.y -= distance;
    if (side === 'BOTTOM') point.y += distance;
    return point;
  }

  function fixedSegments(routes) {
    const output = [];
    (routes || []).forEach((route) => (route.segments || segmentsForPoints(route.points || [])).forEach((segment) => {
      output.push(Object.assign({}, segment, segmentBounds(segment), { routeId: route.id, netId: route.netId }));
    }));
    return output.sort((a, b) => compareText(a.routeId, b.routeId) || a.index - b.index);
  }
  function edgeInteraction(segment, fixed, route, options) {
    let cost = 0; const spacing = options.wireSpacing;
    const paddedBounds = expandRect(segmentBounds(segment), spacing);
    for (let index = 0; index < fixed.length; index += 1) {
      const other = fixed[index];
      if (!boundsIntersect(paddedBounds, other.xMin == null ? segmentBounds(other) : other)) continue;
      if (segment.orientation === other.orientation) {
        const collinear = segment.orientation === 'horizontal'
          ? Math.abs(segment.y1 - other.y1) <= EPSILON
          : Math.abs(segment.x1 - other.x1) <= EPSILON;
        const overlap = segment.orientation === 'horizontal'
          ? overlap1d(segment.x1, segment.x2, other.x1, other.x2)
          : overlap1d(segment.y1, segment.y2, other.y1, other.y2);
        if (collinear && overlap.length > EPSILON) return Infinity;
        if (collinear && Math.abs(overlap.length) <= EPSILON && route.netId !== other.netId) return Infinity;
        if (!collinear && overlap.length > EPSILON) {
          const distance = segment.orientation === 'horizontal'
            ? Math.abs(segment.y1 - other.y1) : Math.abs(segment.x1 - other.x1);
          if (distance < spacing - EPSILON) {
            cost += options.nearWirePenalty * overlap.length * (spacing - distance) / spacing;
          }
        }
        continue;
      }
      const horizontal = segment.orientation === 'horizontal' ? segment : other;
      const vertical = segment.orientation === 'vertical' ? segment : other;
      const point = { x: vertical.x1, y: horizontal.y1 };
      if (point.x < Math.min(horizontal.x1, horizontal.x2) - EPSILON ||
          point.x > Math.max(horizontal.x1, horizontal.x2) + EPSILON ||
          point.y < Math.min(vertical.y1, vertical.y2) - EPSILON ||
          point.y > Math.max(vertical.y1, vertical.y2) + EPSILON) continue;
      /* A graph edge is split at every routing axis.  Its temporary endpoint
         may disappear when consecutive collinear edges are simplified, so a
         crossing there is allowed provisionally.  A fixed-route endpoint is
         a real electrical contact and remains forbidden for a different net;
         pathScore() checks the simplified final segment again. */
      if (endpointOf(point, other) && route.netId !== other.netId) return Infinity;
      if (route.netId !== other.netId) cost += options.crossingPenalty;
    }
    return cost;
  }
  function softObstacleCost(segment, softObstacles, penalty) {
    let hits = 0;
    softObstacles.forEach((obstacle) => { if (segmentIntersectsRectInterior(segment, obstacle)) hits += 1; });
    return hits * penalty;
  }

  function distanceToInterval(value, a, b) {
    const min = Math.min(a, b); const max = Math.max(a, b);
    return value < min ? min - value : value > max ? value - max : 0;
  }
  function selectCoordinates(values, start, end, limit) {
    const unique = Array.from(new Set(values.filter(Number.isFinite).map(numberKey))).map(Number).sort((a, b) => a - b);
    if (unique.length <= limit) return unique;
    const required = new Set([numberKey(start), numberKey(end)]);
    const selected = unique.slice().sort((a, b) =>
      distanceToInterval(a, start, end) - distanceToInterval(b, start, end) || Math.abs(a - start) - Math.abs(b - start) || a - b)
      .slice(0, limit);
    [start, end].forEach((value) => { if (!selected.some((item) => Math.abs(item - value) <= EPSILON)) selected.push(value); });
    return Array.from(new Set(selected.map(numberKey))).map(Number).sort((a, b) => a - b);
  }
  function relevantRect(value, corridor) {
    return boundsIntersect(value, corridor);
  }
  function graphAxes(start, end, obstacles, fixed, options, margin) {
    const corridor = { xMin: Math.min(start.x, end.x) - margin, xMax: Math.max(start.x, end.x) + margin,
      yMin: Math.min(start.y, end.y) - margin, yMax: Math.max(start.y, end.y) + margin };
    if (options.sheetBounds) {
      corridor.xMin = Math.max(corridor.xMin, options.sheetBounds.xMin);
      corridor.xMax = Math.min(corridor.xMax, options.sheetBounds.xMax);
      corridor.yMin = Math.max(corridor.yMin, options.sheetBounds.yMin);
      corridor.yMax = Math.min(corridor.yMax, options.sheetBounds.yMax);
    }
    const activeObstacles = obstacles.filter((obstacle) => relevantRect(obstacle.expanded, corridor));
    const activeFixed = fixed.filter((segment) => boundsIntersect(segmentBounds(segment), corridor));
    const xs = [start.x, end.x, corridor.xMin, corridor.xMax];
    const ys = [start.y, end.y, corridor.yMin, corridor.yMax];
    activeObstacles.forEach((obstacle) => {
      xs.push(obstacle.expanded.xMin, obstacle.expanded.xMax);
      ys.push(obstacle.expanded.yMin, obstacle.expanded.yMax);
    });
    activeFixed.forEach((segment) => {
      xs.push(segment.x1, segment.x2, segment.x1 - options.wireSpacing, segment.x1 + options.wireSpacing,
        segment.x2 - options.wireSpacing, segment.x2 + options.wireSpacing);
      ys.push(segment.y1, segment.y2, segment.y1 - options.wireSpacing, segment.y1 + options.wireSpacing,
        segment.y2 - options.wireSpacing, segment.y2 + options.wireSpacing);
    });
    return {
      xs: selectCoordinates(xs, start.x, end.x, options.maxAxes),
      ys: selectCoordinates(ys, start.y, end.y, options.maxAxes)
    };
  }

  class MinHeap {
    constructor() { this.values = []; }
    push(value) {
      this.values.push(value); let index = this.values.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (!MinHeap.before(value, this.values[parent])) break;
        this.values[index] = this.values[parent]; index = parent;
      }
      this.values[index] = value;
    }
    pop() {
      if (!this.values.length) return null;
      const first = this.values[0]; const last = this.values.pop();
      if (this.values.length) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1; const right = left + 1;
          if (left >= this.values.length) break;
          let child = right < this.values.length && MinHeap.before(this.values[right], this.values[left]) ? right : left;
          if (!MinHeap.before(this.values[child], last)) break;
          this.values[index] = this.values[child]; index = child;
        }
        this.values[index] = last;
      }
      return first;
    }
    static before(a, b) { return a.f < b.f - EPSILON ||
      (Math.abs(a.f - b.f) <= EPSILON && (a.g < b.g - EPSILON ||
        (Math.abs(a.g - b.g) <= EPSILON && compareText(a.key, b.key) < 0))); }
  }

  function pathFind(start, end, obstacles, fixed, soft, route, options, margin) {
    const corridor = { xMin: Math.min(start.x, end.x) - margin, xMax: Math.max(start.x, end.x) + margin,
      yMin: Math.min(start.y, end.y) - margin, yMax: Math.max(start.y, end.y) + margin };
    const localObstacles = obstacles.filter((obstacle) => boundsIntersect(obstacle.expanded, corridor));
    const localFixed = fixed.filter((segment) => boundsIntersect(segment, corridor));
    const localSoft = soft.filter((obstacle) => boundsIntersect(obstacle, corridor));
    const axes = graphAxes(start, end, obstacles, fixed, options, margin);
    const sx = axes.xs.findIndex((value) => Math.abs(value - start.x) <= EPSILON);
    const sy = axes.ys.findIndex((value) => Math.abs(value - start.y) <= EPSILON);
    const tx = axes.xs.findIndex((value) => Math.abs(value - end.x) <= EPSILON);
    const ty = axes.ys.findIndex((value) => Math.abs(value - end.y) <= EPSILON);
    if (sx < 0 || sy < 0 || tx < 0 || ty < 0) return null;
    if (localObstacles.some((obstacle) => pointInsideRect(start, obstacle.expanded) || pointInsideRect(end, obstacle.expanded))) return null;
    const keyOf = (x, y, direction) => x + ',' + y + ',' + direction;
    const heap = new MinHeap(); const distance = new Map(); const previous = new Map();
    const startKey = keyOf(sx, sy, 'N'); distance.set(startKey, 0);
    heap.push({ ix: sx, iy: sy, direction: 'N', key: startKey, g: 0,
      f: Math.abs(start.x - end.x) + Math.abs(start.y - end.y) });
    let endState = null; let expanded = 0;
    while (heap.values.length && expanded < options.maxExpandedStates) {
      const current = heap.pop();
      if (current.g > (distance.get(current.key) || 0) + EPSILON) continue;
      if (current.ix === tx && current.iy === ty) { endState = current; break; }
      expanded += 1;
      const neighbors = [
        { ix: current.ix - 1, iy: current.iy, direction: 'H' },
        { ix: current.ix + 1, iy: current.iy, direction: 'H' },
        { ix: current.ix, iy: current.iy - 1, direction: 'V' },
        { ix: current.ix, iy: current.iy + 1, direction: 'V' }
      ];
      neighbors.forEach((neighbor) => {
        if (neighbor.ix < 0 || neighbor.ix >= axes.xs.length || neighbor.iy < 0 || neighbor.iy >= axes.ys.length) return;
        const from = { x: axes.xs[current.ix], y: axes.ys[current.iy] };
        const to = { x: axes.xs[neighbor.ix], y: axes.ys[neighbor.iy] };
        if (options.sheetBounds && (to.x < options.sheetBounds.xMin - EPSILON ||
            to.x > options.sheetBounds.xMax + EPSILON || to.y < options.sheetBounds.yMin - EPSILON ||
            to.y > options.sheetBounds.yMax + EPSILON)) return;
        const segment = { x1: from.x, y1: from.y, x2: to.x, y2: to.y, orientation: neighbor.direction === 'H' ? 'horizontal' : 'vertical' };
        if (localObstacles.some((obstacle) => segmentIntersectsRectInterior(segment, obstacle.expanded))) return;
        const interaction = edgeInteraction(segment, localFixed, route, options);
        if (!Number.isFinite(interaction)) return;
        const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        const bend = current.direction !== 'N' && current.direction !== neighbor.direction ? options.bendPenalty : 0;
        const nextG = current.g + length + bend + interaction + softObstacleCost(segment, localSoft, options.textPenalty);
        const nextKey = keyOf(neighbor.ix, neighbor.iy, neighbor.direction);
        const old = distance.get(nextKey);
        if (old != null && nextG >= old - EPSILON) return;
        distance.set(nextKey, nextG); previous.set(nextKey, current.key);
        heap.push(Object.assign({}, neighbor, { key: nextKey, g: nextG,
          f: nextG + Math.abs(to.x - end.x) + Math.abs(to.y - end.y) }));
      });
    }
    if (!endState) return null;
    const states = []; let cursor = endState.key;
    while (cursor) {
      const pieces = cursor.split(',');
      states.push({ x: axes.xs[Number(pieces[0])], y: axes.ys[Number(pieces[1])] });
      cursor = previous.get(cursor);
    }
    return simplifyPoints(states.reverse());
  }

  function pathScore(points, route, obstacles, fixed, soft, options) {
    if (options.sheetBounds && points.some((point) => point.x < options.sheetBounds.xMin - EPSILON ||
        point.x > options.sheetBounds.xMax + EPSILON || point.y < options.sheetBounds.yMin - EPSILON ||
        point.y > options.sheetBounds.yMax + EPSILON)) return Infinity;
    const segments = segmentsForPoints(points); let cost = 0;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex += 1) {
        const obstacle = obstacles[obstacleIndex];
        const endpointOwner = (index === 0 && obstacle.ownerId === route.source.deviceId) ||
          (index === segments.length - 1 && obstacle.ownerId === route.target.deviceId);
        if (segmentIntersectsRectInterior(segment, endpointOwner ? obstacle.raw : obstacle.expanded)) return Infinity;
      }
      const interaction = edgeInteraction(segment, fixed, route, options);
      if (!Number.isFinite(interaction)) return Infinity;
      cost += Math.abs(segment.x2 - segment.x1) + Math.abs(segment.y2 - segment.y1) + interaction +
        softObstacleCost(segment, soft, options.textPenalty);
      if (index && segments[index - 1].orientation !== segment.orientation) cost += options.bendPenalty;
    }
    return cost;
  }
  function directCandidates(source, target, axes) {
    const output = [];
    if (Math.abs(source.x - target.x) <= EPSILON || Math.abs(source.y - target.y) <= EPSILON) output.push([source, target]);
    output.push([source, { x: target.x, y: source.y }, target]);
    output.push([source, { x: source.x, y: target.y }, target]);
    const ranked = (values, a, b) => (values || []).slice().sort((left, right) =>
      distanceToInterval(left, a, b) - distanceToInterval(right, a, b) ||
      Math.abs(left - a) - Math.abs(right - a) || left - right).slice(0, 14);
    ranked(axes.xs, source.x, target.x).forEach((x) =>
      output.push([source, { x, y: source.y }, { x, y: target.y }, target]));
    ranked(axes.ys, source.y, target.y).forEach((y) =>
      output.push([source, { x: source.x, y }, { x: target.x, y }, target]));
    const seen = new Set();
    return output.map(simplifyPoints).filter((points) => {
      if (points.length < 2) return false;
      const key = points.map(pointKey).join('|'); if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function candidateRoute(route, points) {
    try {
      const candidate = normalizeRoute(route, points);
      return IR.analyzeGeometry({ devices: [], routes: [candidate] }).violations.length ? null : candidate;
    } catch (_) { return null; }
  }
  function routeOptions(input) {
    const value = input || {};
    const sheetInput = value.sheetBounds;
    const sheetBounds = sheetInput && Number.isFinite(Number(sheetInput.xMax)) && Number.isFinite(Number(sheetInput.yMax))
      ? { xMin: finite(sheetInput.xMin, 0), yMin: finite(sheetInput.yMin, 0),
        xMax: Number(sheetInput.xMax), yMax: Number(sheetInput.yMax) } : null;
    return {
      deviceClearance: Math.max(0, finite(value.deviceClearance, 8)),
      wireSpacing: Math.max(1, finite(value.wireSpacing, 8)),
      escapeDistance: Math.max(2, finite(value.escapeDistance, 12)),
      bendPenalty: Math.max(0, finite(value.bendPenalty, 28)),
      crossingPenalty: Math.max(0, finite(value.crossingPenalty, 48)),
      nearWirePenalty: Math.max(0, finite(value.nearWirePenalty, 2.5)),
      textPenalty: Math.max(0, finite(value.textPenalty, 180)),
      maxAxes: Math.max(16, Math.floor(finite(value.maxAxes, 88))),
      maxExpandedStates: Math.max(500, Math.floor(finite(value.maxExpandedStates, 36000))),
      maxAffectedRoutes: Math.max(1, Math.floor(finite(value.maxAffectedRoutes, 64))),
      margins: Array.isArray(value.margins) && value.margins.length ? value.margins.map(Number) : [48, 120, 280],
      sheetBounds
    };
  }

  function planRoute(spec) {
    if (!IR) throw new EditRouterError('DRAWING_IR_MISSING', 'EVSE_DRAWING_IR is required.');
    const value = spec || {}; const route = normalizeRoute(value.route);
    const devices = value.devices || []; const fixedRoutes = (value.fixedRoutes || []).map((item) => normalizeRoute(item));
    const options = routeOptions(value.options); const deviceMap = new Map(devices.map((device) => [device.id, device]));
    const sourceDevice = deviceMap.get(route.source.deviceId); const targetDevice = deviceMap.get(route.target.deviceId);
    if (!sourceDevice || !targetDevice) throw new EditRouterError('ROUTE_ENDPOINT_DEVICE_MISSING',
      '导线端点器件不存在，不能重布线。', { routeId: route.id, source: route.source.ref, target: route.target.ref });
    const sourceSide = inferSide(sourceDevice, route.source); const targetSide = inferSide(targetDevice, route.target);
    const fixed = fixedSegments(fixedRoutes); const soft = annotationObstacles(value.annotations, 2);
    /* Most edits only rubber-band an endpoint into free space.  Preserve that
       readable path without invoking the search grid when it is already
       legal against every body and fixed conductor. */
    const rawObstacles = deviceObstacles(devices, 0);
    const existingScore = pathScore(route.points, route, rawObstacles, fixed, soft, options);
    const existingRoute = Number.isFinite(existingScore) ? candidateRoute(route, route.points) : null;
    if (existingRoute) return Object.freeze({ route: existingRoute, score: existingScore,
      clearance: 0, margin: 0, sourceSide, targetSide, preserved: true });

    const hardMinimumClearance = 1;
    const preferredClearance = Math.max(hardMinimumClearance, options.deviceClearance);
    const clearanceTiers = Array.from(new Set([
      preferredClearance, Math.max(hardMinimumClearance, preferredClearance / 2), hardMinimumClearance
    ].map((number) => Number(number.toFixed(6)))));
    for (let tierIndex = 0; tierIndex < clearanceTiers.length; tierIndex += 1) {
      const clearance = clearanceTiers[tierIndex]; let best = null;
      const obstacles = deviceObstacles(devices, clearance);
      const escapeDistance = Math.max(options.escapeDistance, clearance + 2);
      const sourceEscape = escapePoint(route.source, sourceSide, escapeDistance);
      const targetEscape = escapePoint(route.target, targetSide, escapeDistance);
      for (let marginIndex = 0; marginIndex < options.margins.length; marginIndex += 1) {
        const margin = options.margins[marginIndex];
        const axes = graphAxes(sourceEscape, targetEscape, obstacles, fixed, options, margin);
        const paths = directCandidates(sourceEscape, targetEscape, axes);
        const searched = pathFind(sourceEscape, targetEscape, obstacles, fixed, soft, route, options, margin);
        if (searched) paths.push(searched);
        paths.forEach((core) => {
          const points = simplifyPoints([{ x: route.source.x, y: route.source.y }].concat(core,
            [{ x: route.target.x, y: route.target.y }]));
          const score = pathScore(points, route, obstacles, fixed, soft, options);
          if (!Number.isFinite(score)) return;
          const candidate = candidateRoute(route, points);
          if (!candidate) return;
          const key = candidate.points.map(pointKey).join('|');
          if (!best || score < best.score - EPSILON ||
              (Math.abs(score - best.score) <= EPSILON && compareText(key, best.key) < 0)) {
            best = { route: candidate, score, key, clearance, margin };
          }
        });
        if (best) return Object.freeze({ route: best.route, score: best.score, clearance: best.clearance,
          margin: best.margin, sourceSide, targetSide });
      }
    }
    throw new EditRouterError('NO_LEGAL_ORTHOGONAL_PATH',
      '没有找到不穿越器件且满足导线几何规则的正交路径。', {
        routeId: route.id, source: route.source.ref, target: route.target.ref
      });
  }

  function violationRouteIds(violation) {
    const ids = [];
    if (violation.routeId) ids.push(String(violation.routeId));
    (violation.routeIds || []).forEach((id) => ids.push(String(id)));
    return Array.from(new Set(ids)).sort(compareText);
  }
  function rerouteAffected(spec) {
    if (!IR) throw new EditRouterError('DRAWING_IR_MISSING', 'EVSE_DRAWING_IR is required.');
    const value = spec || {}; const devices = value.devices || [];
    const routes = (value.routes || []).map((route) => normalizeRoute(route));
    const routeById = new Map(routes.map((route) => [route.id, route]));
    const locked = new Set((value.lockedRouteIds || []).map(String));
    const affected = new Set((value.affectedRouteIds || []).map(String).filter((id) => !locked.has(id)));
    const options = routeOptions(value.options);
    (value.affectedRouteIds || []).forEach((id) => {
      if (!routeById.has(String(id))) throw new EditRouterError('ROUTE_NOT_FOUND', '导线不存在：' + id, { routeId: id });
    });
    let working = routes; let lastAnalysis = null; let pass = 0;
    while (pass < 4) {
      pass += 1;
      const seedAnalysis = IR.analyzeGeometry({ devices, routes: working });
      seedAnalysis.violations.forEach((violation) => {
        const ids = violationRouteIds(violation); const movable = ids.filter((id) => !locked.has(id));
        if (!movable.length) throw new EditRouterError('LOCKED_GEOMETRY_VIOLATION',
          '挤推操作会使锁定导线穿越器件或产生非法接触，已拒绝。', { violation });
        movable.forEach((id) => affected.add(id));
      });
      if (affected.size > options.maxAffectedRoutes) throw new EditRouterError('AFFECTED_ROUTE_LIMIT',
        '本次编辑需要重布线的回路过多，已安全拒绝。', { count: affected.size, limit: options.maxAffectedRoutes });
      const order = Array.from(affected).sort(compareText);
      const fixed = working.filter((route) => !affected.has(route.id));
      const planned = [];
      order.forEach((id) => {
        const source = routeById.get(id) || working.find((route) => route.id === id);
        if (!source) throw new EditRouterError('ROUTE_NOT_FOUND', '导线不存在：' + id, { routeId: id });
        const result = planRoute({ route: source, devices, fixedRoutes: fixed.concat(planned),
          annotations: value.annotations || [], options });
        planned.push(result.route);
      });
      working = fixed.concat(planned).sort((a, b) => compareText(a.id, b.id));
      lastAnalysis = IR.analyzeGeometry({ devices, routes: working });
      if (!lastAnalysis.violations.length) return Object.freeze({
        routes: Object.freeze(working), reroutedRouteIds: Object.freeze(order), passes: pass,
        bridgeCount: lastAnalysis.bridges.length, junctionCount: lastAnalysis.junctions.length
      });
      const before = affected.size;
      lastAnalysis.violations.forEach((violation) => violationRouteIds(violation).forEach((id) => {
        if (!locked.has(id)) affected.add(id);
      }));
      if (affected.size === before) break;
    }
    throw new EditRouterError('REROUTE_DID_NOT_CONVERGE', '自动避让未能收敛到合法几何，已回滚。', {
      affectedRouteIds: Array.from(affected).sort(compareText),
      violations: lastAnalysis ? lastAnalysis.violations : []
    });
  }

  function assertDevicePlacement(devices, movedDeviceIds, metadata, options) {
    const moved = new Set((movedDeviceIds || []).map(String)); const list = devices || [];
    const clearance = Math.max(0, finite(options && options.deviceSpacing, 0));
    const collisions = [];
    for (let left = 0; left < list.length; left += 1) {
      for (let right = left + 1; right < list.length; right += 1) {
        if (!moved.has(list[left].id) && !moved.has(list[right].id)) continue;
        if (rectsOverlap(rect(list[left].bbox), rect(list[right].bbox), clearance)) {
          collisions.push([list[left].id, list[right].id].sort(compareText));
        }
      }
    }
    if (collisions.length) throw new EditRouterError('DEVICE_BODY_COLLISION', '器件本体不能相互重叠。', { collisions });
    const sheet = metadata && metadata.sheet;
    if (sheet && Number.isFinite(Number(sheet.canvasWidth)) && Number.isFinite(Number(sheet.canvasHeight))) {
      const outside = list.filter((device) => moved.has(device.id)).filter((device) => {
        const box = rect(device.bbox);
        return box.xMin < -EPSILON || box.yMin < -EPSILON ||
          box.xMax > Number(sheet.canvasWidth) + EPSILON || box.yMax > Number(sheet.canvasHeight) + EPSILON;
      }).map((device) => device.id).sort(compareText);
      if (outside.length) throw new EditRouterError('DEVICE_OUTSIDE_SHEET', '器件不能移出图纸边界。', { deviceIds: outside });
    }
    return true;
  }

  return Object.freeze({ VERSION, EditRouterError, planRoute, rerouteAffected,
    assertDevicePlacement, normalizeRoute, violationRouteIds });
});
