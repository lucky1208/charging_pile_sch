/* ============================================================
 * Independent DXF R2010 readback audit
 * ------------------------------------------------------------
 * Parses the text that will actually be delivered.  It does not call or
 * trust the DXF exporter/manifest and reconciles every ENTITIES record and
 * EVSE_IR XDATA identity against the current Drawing IR.  Scope is the
 * deterministic identity-coordinate export used by this platform.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_RENDERED_DXF_AUDIT = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.0.0';
  const APP_ID = 'EVSE_IR';
  const IR_SCHEMA = 'evse-drawing-ir/v1';
  const EPSILON = 1e-7;

  function near(left, right) {
    return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) &&
      Math.abs(Number(left) - Number(right)) <= EPSILON;
  }
  function compare(left, right) {
    const a = String(left == null ? '' : left);
    const b = String(right == null ? '' : right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function parsePairs(dxf) {
    if (typeof dxf !== 'string' || !dxf.length || dxf.length > 120000000 || /\u0000/.test(dxf)) {
      throw new Error('DXF_INPUT_SIZE_OR_ENCODING');
    }
    const lines = dxf.replace(/\r/g, '').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    if (!lines.length || lines.length % 2) throw new Error('DXF_GROUP_PAIR_INCOMPLETE');
    const pairs = [];
    for (let index = 0; index < lines.length; index += 2) {
      if (!/^-?\d+$/.test(lines[index].trim())) throw new Error('DXF_GROUP_CODE_INVALID');
      pairs.push({ code: Number(lines[index].trim()), value: lines[index + 1] });
    }
    if (!pairs.length || pairs[pairs.length - 1].code !== 0 || pairs[pairs.length - 1].value !== 'EOF') {
      throw new Error('DXF_EOF_MISSING');
    }
    return pairs;
  }
  function entityRecords(pairs) {
    const records = [];
    let inEntities = false;
    let sectionCount = 0;
    let current = null;
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[index];
      if (!inEntities && pair.code === 0 && pair.value === 'SECTION' &&
          pairs[index + 1] && pairs[index + 1].code === 2 && pairs[index + 1].value === 'ENTITIES') {
        sectionCount += 1;
        inEntities = true;
        index += 1;
        continue;
      }
      if (!inEntities) continue;
      if (pair.code === 0 && pair.value === 'ENDSEC') {
        if (current) records.push(current);
        current = null;
        inEntities = false;
        continue;
      }
      if (pair.code === 0) {
        if (current) records.push(current);
        current = { type: pair.value, pairs: [] };
      } else if (current) current.pairs.push(pair);
    }
    if (inEntities || sectionCount !== 1) throw new Error('DXF_ENTITIES_SECTION_INVALID');
    return records;
  }
  function xdata(entity) {
    const start = entity.pairs.findIndex((pair) => pair.code === 1001 && pair.value === APP_ID);
    if (start < 0) throw new Error('DXF_XDATA_MISSING');
    const plain = new Map();
    const chunks = new Map();
    entity.pairs.slice(start + 1).filter((pair) => pair.code === 1000).forEach((pair) => {
      if (!/^[\x20-\x7e]*$/.test(pair.value) || BufferByteLength(pair.value) > 255) {
        throw new Error('DXF_XDATA_ENCODING');
      }
      const field = /^([^=]+)=(.*)$/.exec(pair.value);
      if (!field) throw new Error('DXF_XDATA_FIELD');
      const chunk = /^(.*)#(\d+)\/(\d+)$/.exec(field[1]);
      if (!chunk) {
        if (plain.has(field[1]) || chunks.has(field[1])) throw new Error('DXF_XDATA_DUPLICATE');
        plain.set(field[1], field[2]);
        return;
      }
      const key = chunk[1];
      if (plain.has(key)) throw new Error('DXF_XDATA_DUPLICATE');
      const index = Number(chunk[2]);
      const total = Number(chunk[3]);
      if (!(index >= 1 && total >= 1 && index <= total)) throw new Error('DXF_XDATA_CHUNK');
      const record = chunks.get(key) || { total, values: new Map() };
      if (record.total !== total || record.values.has(index)) throw new Error('DXF_XDATA_CHUNK');
      record.values.set(index, field[2]);
      chunks.set(key, record);
    });
    chunks.forEach((record, key) => {
      if (record.values.size !== record.total) throw new Error('DXF_XDATA_CHUNK_INCOMPLETE');
      let value = '';
      for (let index = 1; index <= record.total; index += 1) {
        if (!record.values.has(index)) throw new Error('DXF_XDATA_CHUNK_INCOMPLETE');
        value += record.values.get(index);
      }
      plain.set(key, value);
    });
    const result = {};
    plain.forEach((value, key) => {
      try { result[key] = decodeURIComponent(value); }
      catch (_) { throw new Error('DXF_XDATA_URI_ENCODING'); }
    });
    return result;
  }
  function BufferByteLength(value) {
    if (typeof Buffer !== 'undefined' && Buffer.byteLength) return Buffer.byteLength(value, 'utf8');
    return unescape(encodeURIComponent(value)).length;
  }
  function values(entity, code) {
    return entity.pairs.filter((pair) => pair.code === code).map((pair) => pair.value);
  }
  function first(entity, code, fallback) {
    const pair = entity.pairs.find((item) => item.code === code);
    return pair ? pair.value : fallback;
  }
  function points(entity) {
    const result = [];
    entity.pairs.forEach((pair, index) => {
      if (pair.code !== 10) return;
      const y = entity.pairs.slice(index + 1).find((candidate) => candidate.code === 20);
      if (!y) throw new Error('DXF_VERTEX_Y_MISSING');
      result.push({ x: Number(pair.value), y: Number(y.value) });
    });
    return result;
  }
  function samePoints(left, right) {
    return left.length === right.length && left.every((point, index) =>
      near(point.x, right[index].x) && near(point.y, right[index].y));
  }
  function routeOrientation(ir, primitive) {
    const route = (ir.routes || []).find((item) => String(item.id) === String(primitive.bridgeRouteId));
    if (!route) return '';
    const segment = (route.segments || []).find((item) =>
      Number(primitive.x) >= Math.min(item.x1, item.x2) - EPSILON &&
      Number(primitive.x) <= Math.max(item.x1, item.x2) + EPSILON &&
      Number(primitive.y) >= Math.min(item.y1, item.y2) - EPSILON &&
      Number(primitive.y) <= Math.max(item.y1, item.y2) + EPSILON);
    return segment && segment.orientation || '';
  }
  function expectedIdentity(primitive) {
    return {
      schema: IR_SCHEMA,
      primitiveId: primitive.id,
      kind: primitive.kind,
      equipmentId: primitive.equipmentId || '',
      portId: primitive.portId || '',
      endpointRef: primitive.endpointRef || '',
      terminalId: primitive.terminalId || '',
      symbolId: primitive.symbolId || '',
      symbolRole: primitive.symbolRole || '',
      deviceKind: primitive.deviceKind || '',
      routeId: primitive.routeId || '',
      netId: primitive.netId || '',
      circuitId: primitive.circuitId || '',
      from: primitive.from || '',
      to: primitive.to || '',
      physicalFrom: primitive.physicalFrom || '',
      physicalTo: primitive.physicalTo || '',
      graphicalFrom: primitive.graphicalFrom || '',
      graphicalTo: primitive.graphicalTo || '',
      offPageConnectorId: primitive.offPageConnectorId || '',
      xrefSheet: primitive.xrefSheet || '',
      xrefPage: primitive.xrefPage || '',
      xrefDrawingNo: primitive.xrefDrawingNo || '',
      xrefEndpoint: primitive.xrefEndpoint || '',
      routeIds: Array.isArray(primitive.routeIds) ? primitive.routeIds.join(',') : '',
      bridgeRouteId: primitive.bridgeRouteId || ''
    };
  }

  function audit(dxf, ir, options) {
    const errors = [];
    const add = (code, id, detail) => {
      if (errors.length < 200) errors.push({ code, id: id || '', detail: detail == null ? '' : detail });
    };
    if (!ir || ir.schema !== IR_SCHEMA || !Array.isArray(ir.primitives)) {
      return Object.freeze({ version: VERSION, ok: false,
        errors: Object.freeze([{ code: 'DXF_IR_MISSING_OR_UNSUPPORTED', id: '', detail: '' }]),
        stats: Object.freeze({}), scope: 'RENDERED_DXF_ENTITIES_TO_DRAWING_IR' });
    }
    const opts = options || {};
    const identityTransform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
    if (Object.keys(identityTransform).some((key) => opts[key] != null &&
        Number(opts[key]) !== identityTransform[key]) || opts.flipYAxis) {
      add('DXF_TRANSFORM_SCOPE_UNSUPPORTED', 'options');
    }
    let entities;
    try { entities = entityRecords(parsePairs(dxf)); }
    catch (error) {
      return Object.freeze({ version: VERSION, ok: false,
        errors: Object.freeze([{ code: 'DXF_PARSE', id: '', detail: error.message }]),
        stats: Object.freeze({}), scope: 'RENDERED_DXF_ENTITIES_TO_DRAWING_IR' });
    }
    const byPrimitive = new Map();
    entities.forEach((entity, index) => {
      let trace;
      try { trace = xdata(entity); }
      catch (error) { add(error.message, 'ENTITY-' + index); return; }
      const id = String(trace.primitiveId || '');
      if (!id) { add('DXF_PRIMITIVE_ID_MISSING', 'ENTITY-' + index); return; }
      const list = byPrimitive.get(id) || [];
      list.push({ entity, trace, index });
      byPrimitive.set(id, list);
    });

    const primitiveById = new Map(ir.primitives.map((primitive) => [String(primitive.id), primitive]));
    byPrimitive.forEach((records, id) => {
      if (!primitiveById.has(id)) add('DXF_EXTRA_PRIMITIVE', id);
      if (records.length > 1 && records.some((record) => record.trace.role !== 'deviceLabel')) {
        const mainCount = records.filter((record) => record.trace.role !== 'deviceLabel').length;
        if (mainCount !== 1) add('DXF_DUPLICATE_PRIMITIVE', id);
      }
    });
    primitiveById.forEach((primitive, id) => {
      const records = byPrimitive.get(id) || [];
      const main = records.find((record) => record.trace.role !== 'deviceLabel');
      if (!main) { add('DXF_MISSING_PRIMITIVE', id); return; }
      const identity = expectedIdentity(primitive);
      Object.entries(identity).forEach(([key, value]) => {
        if (String(main.trace[key] || '') !== String(value || '')) add('DXF_PRIMITIVE_IDENTITY', id, key);
      });
      if (first(main.entity, 8, '') !== String(primitive.layer || 'EVSE-EQPT')) add('DXF_LAYER_MISMATCH', id);
      const kind = String(primitive.kind || '').toLowerCase();
      const wantedType = kind === 'polyline' || kind === 'rect' ? 'LWPOLYLINE' :
        kind === 'port' || kind === 'junction' || kind === 'circle' ? 'CIRCLE' :
          kind === 'bridge' || kind === 'arc' ? 'ARC' : kind === 'line' ? 'LINE' :
            kind === 'text' ? 'TEXT' : '';
      if (main.entity.type !== wantedType) { add('DXF_ENTITY_TYPE', id, main.entity.type); return; }
      if (kind === 'polyline') {
        if (!samePoints(points(main.entity), primitive.points || []) ||
            Number(first(main.entity, 70, 0)) !== (primitive.closed === true ? 1 : 0)) add('DXF_GEOMETRY', id);
      } else if (kind === 'rect') {
        const wanted = [
          { x: primitive.x, y: primitive.y }, { x: primitive.x + primitive.width, y: primitive.y },
          { x: primitive.x + primitive.width, y: primitive.y + primitive.height },
          { x: primitive.x, y: primitive.y + primitive.height }
        ];
        if (!samePoints(points(main.entity), wanted) || Number(first(main.entity, 70, 0)) !== 1) add('DXF_GEOMETRY', id);
      } else if (kind === 'line') {
        if (![primitive.x1, primitive.y1, primitive.x2, primitive.y2].every((value, index) => near(value,
          Number(first(main.entity, [10, 20, 11, 21][index], NaN))))) add('DXF_GEOMETRY', id);
      } else if (kind === 'circle' || kind === 'port' || kind === 'junction') {
        const radius = kind === 'port' ? (opts.portRadius == null ? 0.8 : opts.portRadius) :
          kind === 'junction' ? (primitive.radius == null ? 1.8 : primitive.radius) : primitive.radius;
        if (!near(first(main.entity, 10, NaN), primitive.x) || !near(first(main.entity, 20, NaN), primitive.y) ||
            !near(first(main.entity, 40, NaN), radius)) add('DXF_GEOMETRY', id);
      } else if (kind === 'arc' || kind === 'bridge') {
        let start = primitive.startAngle;
        let end = primitive.endAngle;
        if (kind === 'bridge') {
          const orientation = routeOrientation(ir, primitive);
          start = orientation === 'horizontal' ? 0 : 90;
          end = orientation === 'horizontal' ? 180 : 270;
          if (!orientation) add('DXF_BRIDGE_ROUTE', id);
        }
        const radius = kind === 'bridge' && primitive.radius == null ? 4 : primitive.radius;
        if (!near(first(main.entity, 10, NaN), primitive.x) || !near(first(main.entity, 20, NaN), primitive.y) ||
            !near(first(main.entity, 40, NaN), radius) || !near(first(main.entity, 50, NaN), start) ||
            !near(first(main.entity, 51, NaN), end)) add('DXF_GEOMETRY', id);
      } else if (kind === 'text') {
        if (!near(first(main.entity, 10, NaN), primitive.x) || !near(first(main.entity, 20, NaN), primitive.y) ||
            !near(first(main.entity, 40, NaN), primitive.height == null ? 2.5 : primitive.height) ||
            String(first(main.entity, 1, '')) !== String(primitive.text || '') ||
            !near(first(main.entity, 50, 0), primitive.rotation || 0)) add('DXF_GEOMETRY', id);
      }
      const labelRecords = records.filter((record) => record.trace.role === 'deviceLabel');
      if ((kind === 'rect' && primitive.label ? 1 : 0) !== labelRecords.length) add('DXF_LABEL_ENTITY', id);
    });

    errors.sort((left, right) => compare(left.code, right.code) || compare(left.id, right.id));
    return Object.freeze({ version: VERSION, ok: errors.length === 0, errors: Object.freeze(errors),
      stats: Object.freeze({ entities: entities.length, primitives: primitiveById.size }),
      scope: 'RENDERED_DXF_ENTITIES_TO_DRAWING_IR' });
  }

  return Object.freeze({ VERSION, APP_ID, IR_SCHEMA, parsePairs, entityRecords, audit });
});
