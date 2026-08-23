/* ============================================================
 * EVSE Drawing IR → DXF R2010 concept exporter
 * ------------------------------------------------------------
 * The primary path consumes renderer-neutral Drawing IR directly.  It
 * never reconstructs circuit geometry from an SVG DOM.  The SVG parser
 * remains available only as an explicitly marked legacy compatibility
 * adapter while older callers migrate to exportDrawingIR().
 *
 * This is intentionally not a DWG replacement, a construction drawing,
 * a protection study, or a compliance/certification artefact.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_DXF = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '2.0.0';
  const DRAWING_IR_SCHEMA = 'evse-drawing-ir/v1';
  const MANIFEST_SCHEMA = 'EVSE-DXF-IR-MANIFEST/2.0';
  const LEGACY_MANIFEST_SCHEMA = 'EVSE-DXF-MANIFEST/1.0';
  const XDATA_APP_ID = 'EVSE_IR';

  const FALLBACK_LAYER_MANIFEST = [
    { name: 'EVSE-FRAME', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.50, purpose: '图框、标题栏、修订栏' },
    { name: 'EVSE-TEXT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '标题、说明、位号' },
    { name: 'EVSE-ANNO', color: 8, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '待核说明、参考注释' },
    { name: 'EVSE-EQPT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '通用设备外形与符号' },
    { name: 'EVSE-AC', color: 34, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '交流主回路（相线棕 IEC 60446）' },
    { name: 'EVSE-DC', color: 1, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '充电直流主回路' },
    { name: 'EVSE-ESS', color: 30, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '储能直流回路' },
    { name: 'EVSE-AUX', color: 4, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '辅助直流电源 24V/12V' },
    { name: 'EVSE-CTL', color: 8, linetype: 'DASHED', lineweightMm: 0.18, purpose: '控制、联锁与采样信号' },
    { name: 'EVSE-COMM', color: 6, linetype: 'DASHED', lineweightMm: 0.18, purpose: '通信总线与后台链路' },
    { name: 'EVSE-PE', color: 3, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '保护接地与等电位' },
    { name: 'EVSE-MARKER', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '连接点与非连接跨线标记' }
  ];
  const VALID_LAYER = new Set(FALLBACK_LAYER_MANIFEST.map((layer) => layer.name));

  const pairs = (...values) => values.map((value) => String(value) + '\n').join('');
  const number = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const attr = (node, name, fallback) => number(node.getAttribute(name), fallback);
  const xmlText = (node) => (node.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanText = (value) => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\^/g, '^^');
  const cloneManifest = (layers) => layers.map((layer) => Object.assign({}, layer));
  const validLayerweight = (mm, fallback) => Math.max(13, Math.min(211, Math.round(number(mm, fallback) * 100)));

  function inherited(node, name) {
    let current = node;
    while (current && current.nodeType === 1) {
      const value = current.getAttribute(name);
      if (value) return value;
      current = current.parentElement;
    }
    return '';
  }

  function manifestFromSvg(svg) {
    try {
      const raw = svg.getAttribute('data-cad-layer-manifest');
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length && parsed.every((layer) => layer && VALID_LAYER.has(layer.name))) return cloneManifest(parsed);
    } catch (_) { /* use the controlled local manifest */ }
    return cloneManifest(FALLBACK_LAYER_MANIFEST);
  }

  function documentFromSvg(svg) {
    let metadata = {};
    try {
      const raw = svg.querySelector('metadata') && svg.querySelector('metadata').textContent;
      metadata = raw ? JSON.parse(raw) : {};
    } catch (_) { metadata = {}; }
    return {
      drawingKey: svg.getAttribute('data-document-key') || metadata.drawingKey || '',
      drawingNo: metadata.drawingNo || '',
      drawingRef: metadata.drawingRef || '',
      revision: metadata.revision || '',
      documentSetId: metadata.documentSetId || '',
      projectReference: metadata.projectReference || '',
      documentStatus: svg.getAttribute('data-document-status') || metadata.documentStatus || 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED',
      issuePurpose: metadata.issuePurpose || '方案级自动草图，待专业校核/签发',
      verification: metadata.verification || 'NOT_VERIFIED',
      drawingSkill: metadata.drawingSkill || {
        id: svg.getAttribute('data-drawing-skill') || 'MISSING',
        version: svg.getAttribute('data-drawing-skill-version') || '',
        profile: svg.getAttribute('data-drawing-profile') || '',
        selectedRuleIds: String(svg.getAttribute('data-selected-rules') || '').split(',').filter(Boolean),
        evaluatedRuleIds: String(svg.getAttribute('data-evaluated-rules') || '').split(',').filter(Boolean),
        appliedRuleIds: String(svg.getAttribute('data-applied-rules') || '').split(',').filter(Boolean)
      },
      drawingAuditStatus: svg.getAttribute('data-drawing-audit-status') || 'NOT_AUDITED'
    };
  }

  function layerFor(node) {
    let current = node;
    while (current && current.nodeType === 1) {
      const id = current.getAttribute('id') || '';
      const dataLayer = current.getAttribute('data-layer') || '';
      if (VALID_LAYER.has(id)) return id;
      if (VALID_LAYER.has(dataLayer)) return dataLayer;
      current = current.parentElement;
    }
    if (node.tagName && node.tagName.toLowerCase() === 'text') return 'EVSE-TEXT';
    const color = (inherited(node, 'stroke') || inherited(node, 'fill') || '').toLowerCase();
    const dashed = Boolean(inherited(node, 'stroke-dasharray'));
    if (color === '#2563eb' || color === '#1d4ed8') return 'EVSE-AC';
    if (color === '#dc2626') return 'EVSE-DC';
    if (color === '#ea580c' || color === '#b45309') return 'EVSE-ESS';
    if (color === '#0e7490' || color === '#0284c7' || color === '#0ea5e9') return 'EVSE-AUX';
    if (color === '#7c3aed' || color === '#6d28d9') return 'EVSE-COMM';
    if (color === '#475569' && dashed) return 'EVSE-CTL';
    if (color === '#16a34a' || color === '#15803d') return 'EVSE-PE';
    return 'EVSE-EQPT';
  }

  function styleFor(node, layer, sx, sy, manifest) {
    const definition = manifest.find((item) => item.name === layer) || { linetype: 'CONTINUOUS', lineweightMm: 0.25 };
    const dash = inherited(node, 'stroke-dasharray');
    const strokeWidth = number(inherited(node, 'stroke-width'), definition.lineweightMm / Math.sqrt(sx * sy));
    const mm = Math.max(definition.lineweightMm || 0.18, strokeWidth * Math.sqrt(sx * sy));
    return { linetype: dash ? 'DASHED' : (definition.linetype || 'CONTINUOUS'), lineweight: validLayerweight(mm, definition.lineweightMm || 0.25) };
  }

  function parsePoints(value) {
    const values = String(value || '').trim().split(/[ ,]+/).map(Number).filter(Number.isFinite);
    const out = [];
    for (let i = 0; i + 1 < values.length; i += 2) out.push([values[i], values[i + 1]]);
    return out;
  }

  /* Only M/L/H/V/Z segments are emitted. Curves are reported rather than
   * silently changed into potentially misleading native CAD geometry. */
  function parseStraightPath(value, warnings) {
    const tokens = String(value || '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
    const points = [];
    let i = 0, cmd = '', x = 0, y = 0, startX = 0, startY = 0;
    const take = () => number(tokens[i++], 0);
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
      const relative = cmd === cmd.toLowerCase();
      const upper = cmd.toUpperCase();
      if (upper === 'M' || upper === 'L') {
        if (i + 1 >= tokens.length) break;
        const nx = take(), ny = take();
        x = relative ? x + nx : nx; y = relative ? y + ny : ny;
        if (upper === 'M') { startX = x; startY = y; cmd = relative ? 'l' : 'L'; }
        points.push([x, y]);
      } else if (upper === 'H') {
        if (i >= tokens.length) break;
        const nx = take(); x = relative ? x + nx : nx; points.push([x, y]);
      } else if (upper === 'V') {
        if (i >= tokens.length) break;
        const ny = take(); y = relative ? y + ny : ny; points.push([x, y]);
      } else if (upper === 'Z') {
        points.push([startX, startY]); cmd = '';
      } else {
        warnings.push('未导出含曲线/弧的 SVG path；请在项目 CAD 模板中复核复杂符号。');
        const arity = { C: 6, S: 4, Q: 4, T: 2, A: 7 }[upper] || 0;
        if (!arity || i + arity > tokens.length) break;
        i += arity;
      }
    }
    return points;
  }

  function lineTypeTable() {
    return pairs(
      0, 'TABLE', 2, 'LTYPE', 70, 2,
      0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0,
      0, 'LTYPE', 2, 'DASHED', 70, 0, 3, 'Dashed __ __', 72, 65, 73, 2, 40, 6, 49, 4.5, 74, 0, 49, -1.5, 74, 0,
      0, 'ENDTAB'
    );
  }

  function tables(manifest) {
    let out = pairs(0, 'SECTION', 2, 'TABLES');
    out += lineTypeTable();
    out += pairs(0, 'TABLE', 2, 'LAYER', 70, manifest.length);
    manifest.forEach((layer) => {
      out += pairs(0, 'LAYER', 2, layer.name, 70, 0, 62, layer.color, 6, layer.linetype || 'CONTINUOUS', 370, validLayerweight(layer.lineweightMm, 0.25));
    });
    out += pairs(0, 'ENDTAB');
    out += pairs(
      0, 'TABLE', 2, 'APPID', 70, 1,
      0, 'APPID', 2, XDATA_APP_ID, 70, 0,
      0, 'ENDTAB'
    );
    return out + pairs(0, 'ENDSEC');
  }

  function directError(code, message, details) {
    const error = new Error(code + '：' + message);
    error.name = 'DxfDrawingIRError';
    error.code = code;
    error.details = details || {};
    return error;
  }

  function compareText(a, b) {
    const aa = String(a == null ? '' : a);
    const bb = String(b == null ? '' : b);
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  }

  function finite(value, label) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw directError('INVALID_DRAWING_IR_NUMBER', label + ' must be finite.', { label, value });
    return Object.is(n, -0) ? 0 : n;
  }

  function nonEmpty(value, label) {
    const text = String(value == null ? '' : value).trim();
    if (!text) throw directError('INVALID_DRAWING_IR_ID', label + ' is required.', { label });
    return text;
  }

  function sameNumber(a, b) {
    return Math.abs(Number(a) - Number(b)) <= 1e-9;
  }

  function samePoints(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((point, index) => point && right[index] &&
      sameNumber(point.x, right[index].x) && sameNumber(point.y, right[index].y));
  }

  function layerDefinition(name) {
    return FALLBACK_LAYER_MANIFEST.find((layer) => layer.name === name) || {
      name, color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25,
      purpose: 'Drawing IR custom layer'
    };
  }

  function validDxfLayerName(name) {
    return !!name && name.length <= 255 && !/[<>\\/"\:;?*|=]/.test(name);
  }

  function manifestFromDrawingIR(ir, options) {
    const supplied = options && Array.isArray(options.layerManifest) ? options.layerManifest : [];
    const definitions = new Map();
    FALLBACK_LAYER_MANIFEST.concat(supplied).forEach((layer) => {
      if (!layer) return;
      const name = String(layer.name || layer.id || '');
      if (name) definitions.set(name, Object.assign({}, layerDefinition(name), layer, { name }));
    });
    const required = new Set(FALLBACK_LAYER_MANIFEST.map((layer) => layer.name));
    (Array.isArray(ir.layers) ? ir.layers : []).forEach((layer) => required.add(String(layer && (layer.id || layer.name) || '')));
    (Array.isArray(ir.primitives) ? ir.primitives : []).forEach((primitive) => required.add(String(primitive && primitive.layer || '')));
    required.delete('');
    const result = Array.from(required).sort(compareText).map((name) => {
      if (!validDxfLayerName(name)) throw directError('INVALID_DXF_LAYER', 'Drawing IR layer cannot be represented safely in DXF.', { name });
      const source = definitions.get(name) || layerDefinition(name);
      return {
        name,
        color: Math.max(1, Math.min(255, Math.floor(number(source.color, 7)))),
        linetype: source.linetype === 'DASHED' ? 'DASHED' : 'CONTINUOUS',
        lineweightMm: Math.max(0.13, number(source.lineweightMm, 0.25)),
        purpose: String(source.purpose || '')
      };
    });
    return result;
  }

  /* XDATA group 1000 strings are limited to 255 bytes.  Values are URI
   * encoded before chunking, so every emitted chunk is ASCII and cannot
   * inject a DXF group-code line even when source IDs contain Unicode. */
  function wellFormedUnicode(value) {
    const input = String(value);
    let output = '';
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = input.charCodeAt(index + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          output += input[index] + input[index + 1];
          index += 1;
        } else {
          output += '\uFFFD';
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        output += '\uFFFD';
      } else {
        output += input[index];
      }
    }
    return output;
  }

  function encodedXdataChunks(key, value) {
    const encoded = encodeURIComponent(wellFormedUnicode(typeof value === 'string' ? value : JSON.stringify(value)));
    const prefix = String(key) + '=';
    const maxPayload = Math.max(1, 240 - prefix.length);
    if (encoded.length <= maxPayload) return [prefix + encoded];
    const parts = [];
    for (let offset = 0; offset < encoded.length; offset += maxPayload) {
      parts.push(encoded.slice(offset, offset + maxPayload));
    }
    return parts.map((part, index) => String(key) + '#' + (index + 1) + '/' + parts.length + '=' + part);
  }

  function xdata(trace) {
    const result = [1001, XDATA_APP_ID];
    Object.keys(trace || {}).sort(compareText).forEach((key) => {
      const value = trace[key];
      if (value == null || value === '') return;
      encodedXdataChunks(key, value).forEach((chunk) => result.push(1000, chunk));
    });
    return result;
  }

  function traceForPrimitive(primitive, extra) {
    return Object.assign({
      schema: DRAWING_IR_SCHEMA,
      primitiveId: primitive.id,
      kind: primitive.kind,
      equipmentId: primitive.equipmentId || '',
      portId: primitive.portId || '',
      endpointRef: primitive.endpointRef || '',
      routeId: primitive.routeId || '',
      netId: primitive.netId || '',
      circuitId: primitive.circuitId || '',
      from: primitive.from || '',
      to: primitive.to || '',
      routeIds: Array.isArray(primitive.routeIds) ? primitive.routeIds.join(',') : '',
      bridgeRouteId: primitive.bridgeRouteId || ''
    }, extra || {});
  }

  function assertDrawingIR(ir, options) {
    const allowInvalid = !!(options && options.allowInvalid);
    if (!ir || typeof ir !== 'object') throw directError('DRAWING_IR_REQUIRED', 'exportDrawingIR requires a Drawing IR object.');
    if (ir.schema !== DRAWING_IR_SCHEMA) {
      throw directError('DRAWING_IR_SCHEMA_UNSUPPORTED', 'Expected ' + DRAWING_IR_SCHEMA + '.', { actual: ir.schema || null });
    }
    if (!ir.coordinateSystem || String(ir.coordinateSystem.unit || '').toLowerCase() !== 'mm') {
      throw directError('DRAWING_IR_UNIT_UNSUPPORTED', 'DXF exporter currently accepts millimetre Drawing IR only.', {
        unit: ir.coordinateSystem && ir.coordinateSystem.unit
      });
    }
    const violations = Array.isArray(ir.violations) ? ir.violations : [];
    if (!allowInvalid && violations.length) {
      throw directError('DRAWING_IR_GEOMETRY_BLOCKED', 'Drawing IR contains geometry violations.', { violations });
    }
    if (!allowInvalid && ir.coverage && ir.coverage.ok !== true) {
      throw directError('DRAWING_IR_COVERAGE_BLOCKED', 'Drawing IR failed model-to-drawing coverage.', { coverage: ir.coverage });
    }
    if (!Array.isArray(ir.primitives) || !Array.isArray(ir.routes) ||
        !Array.isArray(ir.devices) || !Array.isArray(ir.markers)) {
      throw directError('DRAWING_IR_COLLECTION_REQUIRED', 'Drawing IR must contain primitives, routes, devices, and markers arrays.');
    }

    const primitiveById = new Map();
    const routePrimitives = new Map();
    ir.primitives.forEach((primitive, index) => {
      const id = nonEmpty(primitive && primitive.id, 'primitives[' + index + '].id');
      if (primitiveById.has(id)) throw directError('DRAWING_IR_DUPLICATE_PRIMITIVE', 'Duplicate primitive ID.', { id });
      primitiveById.set(id, primitive);
      if (primitive.kind === 'polyline' && primitive.routeId) {
        const routeId = String(primitive.routeId);
        if (routePrimitives.has(routeId)) {
          throw directError('DRAWING_IR_DUPLICATE_ROUTE_PRIMITIVE', 'Multiple polyline primitives reference one route.', {
            routeId, primitiveIds: [routePrimitives.get(routeId).id, id]
          });
        }
        routePrimitives.set(routeId, primitive);
      }
    });
    const routeIds = new Set();
    ir.routes.forEach((route, index) => {
      const id = nonEmpty(route && (route.id || route.routeId), 'routes[' + index + '].id');
      if (routeIds.has(id)) throw directError('DRAWING_IR_DUPLICATE_ROUTE', 'Duplicate route ID.', { id });
      routeIds.add(id);
      const primitive = routePrimitives.get(id);
      if (!primitive) throw directError('DRAWING_IR_ROUTE_PRIMITIVE_MISSING', 'Route has no renderer-neutral polyline primitive.', { routeId: id });
      const expectedFrom = route.source && route.source.ref || '';
      const expectedTo = route.target && route.target.ref || '';
      if (!samePoints(route.points, primitive.points) ||
          String(primitive.netId || '') !== String(route.netId || '') ||
          String(primitive.circuitId || '') !== String(route.circuitId || '') ||
          String(primitive.from || '') !== String(expectedFrom) ||
          String(primitive.to || '') !== String(expectedTo)) {
        throw directError('DRAWING_IR_ROUTE_PRIMITIVE_MISMATCH', 'Route primitive differs from its Drawing IR route.', {
          routeId: id, primitiveId: primitive.id
        });
      }
    });
    routePrimitives.forEach((primitive, routeId) => {
      if (!routeIds.has(routeId)) throw directError('DRAWING_IR_UNKNOWN_ROUTE_PRIMITIVE', 'Polyline primitive references an unknown route.', {
        routeId, primitiveId: primitive.id
      });
    });

    const devices = new Set();
    ir.devices.forEach((device, index) => {
      const deviceId = nonEmpty(device && (device.id || device.equipmentId), 'devices[' + index + '].id');
      if (devices.has(deviceId)) throw directError('DRAWING_IR_DUPLICATE_DEVICE', 'Duplicate placed device.', { deviceId });
      devices.add(deviceId);
      const body = primitiveById.get('DEVICE:' + deviceId);
      if (!body || body.kind !== 'rect' || String(body.equipmentId || '') !== deviceId ||
          !sameNumber(body.x, device.bbox && device.bbox.xMin) ||
          !sameNumber(body.y, device.bbox && device.bbox.yMin) ||
          !sameNumber(body.width, device.bbox && device.bbox.width) ||
          !sameNumber(body.height, device.bbox && device.bbox.height)) {
        throw directError('DRAWING_IR_DEVICE_PRIMITIVE_MISMATCH', 'Placed device differs from its renderer-neutral body primitive.', {
          deviceId, primitiveId: body && body.id || null
        });
      }
      (Array.isArray(device.ports) ? device.ports : []).forEach((port) => {
        const ref = nonEmpty(port.ref, 'device[' + deviceId + '].port.ref');
        const anchorId = 'PORT:' + deviceId + ':' + String(port.id || '');
        const anchor = primitiveById.get(anchorId);
        if (!anchor || anchor.kind !== 'port' || String(anchor.equipmentId || '') !== deviceId ||
            String(anchor.portId || '') !== String(port.id || '') ||
            String(anchor.endpointRef || '') !== ref || !sameNumber(anchor.x, port.x) || !sameNumber(anchor.y, port.y)) {
          throw directError('DRAWING_IR_PORT_PRIMITIVE_MISMATCH', 'Placed terminal differs from its renderer-neutral port primitive.', {
            deviceId, endpointRef: ref, primitiveId: anchor && anchor.id || null
          });
        }
      });
    });

    const markerPrimitives = ir.primitives.filter((primitive) => primitive.kind === 'junction' || primitive.kind === 'bridge');
    if (markerPrimitives.length !== ir.markers.length) {
      throw directError('DRAWING_IR_MARKER_PRIMITIVE_MISMATCH', 'Marker and marker-primitive counts differ.', {
        markers: ir.markers.length, primitives: markerPrimitives.length
      });
    }
    const markerKey = (marker) => [
      String(marker.kind || marker.type || ''),
      String(Number(marker.x)),
      String(Number(marker.y)),
      (marker.routeIds || []).slice().sort(compareText).join(',')
    ].join('\u001f');
    const markerPrimitiveByKey = new Map(markerPrimitives.map((primitive) => [markerKey(primitive), primitive]));
    ir.markers.forEach((marker) => {
      const primitive = markerPrimitiveByKey.get(markerKey(marker));
      if (!primitive || String(primitive.bridgeRouteId || '') !== String(marker.bridgeRouteId || '')) {
        throw directError('DRAWING_IR_MARKER_PRIMITIVE_MISMATCH', 'Crossing marker differs from its renderer-neutral primitive.', {
          type: marker.type, x: marker.x, y: marker.y, routeIds: marker.routeIds || []
        });
      }
    });
    return ir;
  }

  function coordinateTransform(ir, options) {
    const opts = options || {};
    const scaleX = finite(opts.scaleX == null ? 1 : opts.scaleX, 'options.scaleX');
    const scaleY = finite(opts.scaleY == null ? 1 : opts.scaleY, 'options.scaleY');
    const offsetX = finite(opts.offsetX == null ? 0 : opts.offsetX, 'options.offsetX');
    const offsetY = finite(opts.offsetY == null ? 0 : opts.offsetY, 'options.offsetY');
    if (scaleX === 0 || scaleY === 0) throw directError('INVALID_DXF_SCALE', 'DXF coordinate scale cannot be zero.');
    const flipY = !!opts.flipYAxis;
    let yAxisOrigin = finite(opts.yAxisOrigin == null ? 0 : opts.yAxisOrigin, 'options.yAxisOrigin');
    if (flipY && opts.yAxisOrigin == null) {
      const ys = [];
      ir.primitives.forEach((primitive) => {
        if (Array.isArray(primitive.points)) primitive.points.forEach((point) => ys.push(finite(point.y, primitive.id + '.point.y')));
        ['y', 'y1', 'y2'].forEach((key) => {
          if (primitive[key] != null) ys.push(finite(primitive[key], primitive.id + '.' + key));
        });
        if (primitive.y != null && primitive.height != null) ys.push(finite(primitive.y, primitive.id + '.y') + finite(primitive.height, primitive.id + '.height'));
      });
      yAxisOrigin = ys.length ? Math.min(...ys) + Math.max(...ys) : 0;
    }
    return {
      x: (value) => finite(value, 'coordinate.x') * scaleX + offsetX,
      y: (value) => (flipY ? yAxisOrigin - finite(value, 'coordinate.y') : finite(value, 'coordinate.y')) * scaleY + offsetY,
      radius: (value) => Math.abs(finite(value, 'coordinate.radius')) * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2),
      description: { scaleX, scaleY, offsetX, offsetY, flipY, yAxisOrigin }
    };
  }

  function styleForLayer(layer, manifest) {
    const definition = manifest.find((item) => item.name === layer) || layerDefinition(layer);
    return {
      linetype: definition.linetype || 'CONTINUOUS',
      lineweight: validLayerweight(definition.lineweightMm, 0.25)
    };
  }

  function bridgeOrientation(primitive, routeById) {
    const route = routeById.get(String(primitive.bridgeRouteId || ''));
    if (!route) throw directError('DRAWING_IR_BRIDGE_ROUTE_MISSING', 'Bridge marker references an unknown route.', {
      primitiveId: primitive.id, bridgeRouteId: primitive.bridgeRouteId || null
    });
    const x = finite(primitive.x, primitive.id + '.x');
    const y = finite(primitive.y, primitive.id + '.y');
    const segments = Array.isArray(route.segments) ? route.segments : [];
    const segment = segments.find((candidate) => {
      const xMin = Math.min(Number(candidate.x1), Number(candidate.x2));
      const xMax = Math.max(Number(candidate.x1), Number(candidate.x2));
      const yMin = Math.min(Number(candidate.y1), Number(candidate.y2));
      const yMax = Math.max(Number(candidate.y1), Number(candidate.y2));
      return x >= xMin - 1e-9 && x <= xMax + 1e-9 && y >= yMin - 1e-9 && y <= yMax + 1e-9;
    });
    if (!segment || (segment.orientation !== 'horizontal' && segment.orientation !== 'vertical')) {
      throw directError('DRAWING_IR_BRIDGE_NOT_ON_ROUTE', 'Bridge marker is not located on its bridge route.', {
        primitiveId: primitive.id, bridgeRouteId: primitive.bridgeRouteId
      });
    }
    return segment.orientation;
  }

  function exportDrawingIR(drawingIR, options) {
    const opts = options || {};
    const ir = assertDrawingIR(drawingIR, opts);
    const manifest = manifestFromDrawingIR(ir, opts);
    const transform = coordinateTransform(ir, opts);
    const routeById = new Map(ir.routes.map((route) => [String(route.id || route.routeId), route]));
    const primitives = ir.primitives.slice().sort((a, b) => compareText(a.id, b.id));
    const entities = [];
    const traceRecords = [];
    const entityCounts = {};
    const warnings = ['DXF 仅为方案级可编辑草图；不得替代施工图、计算书、设备数据表或专业签发。'];

    function addEntity(type, primitive, geometry, extraTrace, layerOverride) {
      const layer = String(layerOverride || primitive.layer || 'EVSE-EQPT');
      const style = styleForLayer(layer, manifest);
      const trace = traceForPrimitive(primitive, Object.assign({ entityType: type }, extraTrace || {}));
      entities.push(pairs(
        0, type,
        100, 'AcDbEntity',
        8, layer,
        6, style.linetype,
        370, style.lineweight,
        ...geometry,
        ...xdata(trace)
      ));
      traceRecords.push(Object.freeze(Object.assign({ entityIndex: entities.length - 1, layer }, trace)));
      entityCounts[layer] = (entityCounts[layer] || 0) + 1;
    }

    function addPolyline(primitive, points, closed, extraTrace) {
      if (!Array.isArray(points) || points.length < 2) {
        throw directError('DRAWING_IR_POLYLINE_TOO_SHORT', 'Polyline primitive requires at least two points.', { primitiveId: primitive.id });
      }
      const geometry = [100, 'AcDbPolyline', 90, points.length, 70, closed ? 1 : 0];
      points.forEach((point) => geometry.push(10, transform.x(point.x), 20, transform.y(point.y)));
      addEntity('LWPOLYLINE', primitive, geometry, extraTrace);
    }

    primitives.forEach((primitive) => {
      const kind = String(primitive.kind || '').toLowerCase();
      if (kind === 'polyline') {
        addPolyline(primitive, primitive.points, false, { sourcePointCount: primitive.points.length });
        return;
      }
      if (kind === 'rect') {
        const x = finite(primitive.x, primitive.id + '.x');
        const y = finite(primitive.y, primitive.id + '.y');
        const width = finite(primitive.width, primitive.id + '.width');
        const height = finite(primitive.height, primitive.id + '.height');
        if (width <= 0 || height <= 0) throw directError('DRAWING_IR_RECT_INVALID', 'Rectangle dimensions must be positive.', { primitiveId: primitive.id });
        addPolyline(primitive, [
          { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }
        ], true);
        if (primitive.label) {
          const textHeight = Math.max(1.5, Math.min(3.5, height / 4));
          addEntity('TEXT', primitive, [
            100, 'AcDbText', 10, transform.x(x + width / 2), 20, transform.y(y + height / 2), 30, 0,
            40, transform.radius(textHeight), 1, cleanText(primitive.label), 7, 'STANDARD',
            72, 1, 73, 2, 11, transform.x(x + width / 2), 21, transform.y(y + height / 2), 31, 0
          ], { role: 'deviceLabel' }, 'EVSE-TEXT');
        }
        return;
      }
      if (kind === 'port') {
        addEntity('CIRCLE', primitive, [
          100, 'AcDbCircle', 10, transform.x(primitive.x), 20, transform.y(primitive.y), 30, 0,
          40, transform.radius(opts.portRadius == null ? 0.8 : opts.portRadius)
        ], { role: 'terminalAnchor' });
        return;
      }
      if (kind === 'junction') {
        addEntity('CIRCLE', primitive, [
          100, 'AcDbCircle', 10, transform.x(primitive.x), 20, transform.y(primitive.y), 30, 0,
          40, transform.radius(primitive.radius == null ? 1.8 : primitive.radius)
        ], { markerType: 'junction' });
        return;
      }
      if (kind === 'bridge') {
        const orientation = bridgeOrientation(primitive, routeById);
        const flipped = !!transform.description.flipY;
        let startAngle = orientation === 'horizontal' ? 0 : 90;
        let endAngle = orientation === 'horizontal' ? 180 : 270;
        if (flipped && orientation === 'vertical') {
          startAngle = 270;
          endAngle = 90;
        }
        addEntity('ARC', primitive, [
          100, 'AcDbCircle', 10, transform.x(primitive.x), 20, transform.y(primitive.y), 30, 0,
          40, transform.radius(primitive.radius == null ? 4 : primitive.radius),
          100, 'AcDbArc', 50, startAngle, 51, endAngle
        ], { markerType: 'bridge', bridgeOrientation: orientation });
        return;
      }
      if (kind === 'line') {
        addEntity('LINE', primitive, [
          100, 'AcDbLine', 10, transform.x(primitive.x1), 20, transform.y(primitive.y1), 30, 0,
          11, transform.x(primitive.x2), 21, transform.y(primitive.y2), 31, 0
        ]);
        return;
      }
      if (kind === 'circle') {
        addEntity('CIRCLE', primitive, [
          100, 'AcDbCircle', 10, transform.x(primitive.x), 20, transform.y(primitive.y), 30, 0,
          40, transform.radius(primitive.radius)
        ]);
        return;
      }
      if (kind === 'text') {
        addEntity('TEXT', primitive, [
          100, 'AcDbText', 10, transform.x(primitive.x), 20, transform.y(primitive.y), 30, 0,
          40, transform.radius(primitive.height == null ? 2.5 : primitive.height),
          1, cleanText(primitive.text), 7, 'STANDARD'
        ]);
        return;
      }
      if (!opts.skipUnsupported) {
        throw directError('DRAWING_IR_PRIMITIVE_UNSUPPORTED', 'Unsupported renderer-neutral primitive kind.', {
          primitiveId: primitive.id, kind: primitive.kind
        });
      }
      warnings.push('DRAWING_IR_PRIMITIVE_SKIPPED: ' + primitive.id + ' (' + primitive.kind + ')');
    });

    const header = pairs(
      0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1024',
      9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1,
      9, '$LUNITS', 70, 2, 9, '$LTSCALE', 40, 1.0,
      9, '$DWGCODEPAGE', 3, 'UTF-8', 0, 'ENDSEC'
    );
    const sourceHash = String(opts.drawingIRHash || ir.metadata && ir.metadata.drawingIRHash || '');
    const document = Object.assign({}, ir.metadata || {});
    const manifestData = {
      schema: MANIFEST_SCHEMA,
      output: 'DXF_R2010_CONCEPT',
      units: 'mm',
      source: {
        schema: ir.schema,
        version: ir.version || '',
        drawingIRHash: sourceHash,
        coordinateSystem: Object.assign({}, ir.coordinateSystem || {}),
        transform: transform.description
      },
      document,
      trace: { method: 'DXF_XDATA', appId: XDATA_APP_ID, valueEncoding: 'URI_COMPONENT', entityCount: traceRecords.length },
      layers: cloneManifest(manifest),
      scope: {
        included: ['Drawing IR primitives', 'placed devices and terminal anchors', 'routed circuit polylines', 'junction and bridge markers', 'EVSE_IR XDATA trace'],
        excluded: ['native CAD blocks', 'dimensioning', 'protection settings', 'cable schedules', 'approval/signature', 'construction-level verification'],
        status: 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED'
      }
    };
    const comment = cleanText(opts.comment || 'EVSE Drawing IR direct DXF export; professional review required.');
    const compactManifest = cleanText(JSON.stringify({
      schema: MANIFEST_SCHEMA,
      sourceSchema: ir.schema,
      sourceVersion: ir.version || '',
      drawingIRHash: sourceHash,
      xdataAppId: XDATA_APP_ID,
      primitiveCount: primitives.length,
      routeCount: ir.routes.length,
      markerCount: ir.markers.length
    }));
    const dxf = header + tables(manifest) + pairs(
      0, 'SECTION', 2, 'ENTITIES',
      999, comment,
      999, 'EVSE-DXF-IR-MANIFEST: ' + compactManifest
    ) + entities.join('') + pairs(0, 'ENDSEC', 0, 'EOF');
    return Object.freeze({
      dxf,
      text: dxf,
      warnings: Object.freeze(Array.from(new Set(warnings))),
      stats: Object.freeze({
        entities: entities.length,
        primitives: primitives.length,
        devices: ir.devices.length,
        routes: ir.routes.length,
        markers: ir.markers.length,
        layerEntityCounts: Object.freeze(Object.assign({}, entityCounts))
      }),
      trace: Object.freeze(traceRecords),
      manifest: Object.freeze(manifestData)
    });
  }

  function exportSvg(svgMarkup, options) {
    if (typeof DOMParser === 'undefined') throw new Error('DXF 导出需在浏览器中运行。');
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(svgMarkup || ''), 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG 无法解析，未生成 DXF。');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('未找到 SVG 图纸。');
    const skillId = svg.getAttribute('data-drawing-skill');
    const skillVersion = svg.getAttribute('data-drawing-skill-version');
    const profile = svg.getAttribute('data-drawing-profile');
    const skillStatus = svg.getAttribute('data-drawing-skill-status');
    const auditStatus = svg.getAttribute('data-drawing-audit-status');
    if (!skillId || !skillVersion || !profile) throw new Error('DRAWING_SKILL_METADATA_REQUIRED：缺少受控绘图规则元数据。');
    if (skillStatus !== 'ACTIVE') throw new Error('DRAWING_SKILL_BLOCKED：绘图规则状态未通过。');
    if (auditStatus !== 'CHECKED') throw new Error('DRAWING_AUDIT_REQUIRED：图纸尚未通过渲染规则校验。');
    const viewBox = String(svg.getAttribute('viewBox') || '0 0 420 297').trim().split(/[ ,]+/).map(Number);
    const minX = number(viewBox[0], 0), minY = number(viewBox[1], 0), vbW = number(viewBox[2], 420), vbH = number(viewBox[3], 297);
    const paperW = number(String(svg.getAttribute('width') || '420').replace(/[a-z]+/ig, ''), 420);
    const paperH = number(String(svg.getAttribute('height') || '297').replace(/[a-z]+/ig, ''), 297);
    const sx = paperW / vbW, sy = paperH / vbH;
    const manifest = manifestFromSvg(svg);
    const documentControl = documentFromSvg(svg);
    const warnings = [
      'LEGACY_SVG_PARSE：该兼容入口从 SVG DOM 反向提取几何，不具备 Drawing IR 的线路与端子追溯保证。',
      'DXF 仅为方案级可编辑草图；不得替代施工图、计算书、设备数据表或专业签发。'
    ];
    const entities = [];
    const entityCounts = {};
    const add = (...v) => entities.push(pairs(...v));
    const px = (x) => (number(x, 0) - minX) * sx;
    const py = (y) => paperH - (number(y, 0) - minY) * sy;
    const startEntity = (type, layer, style) => [0, type, 8, layer, 6, style.linetype, 370, style.lineweight];
    const count = (layer) => { entityCounts[layer] = (entityCounts[layer] || 0) + 1; };
    const line = (x1, y1, x2, y2, layer, style) => {
      add(...startEntity('LINE', layer, style), 10, px(x1), 20, py(y1), 30, 0, 11, px(x2), 21, py(y2), 31, 0); count(layer);
    };
    const poly = (points, layer, closed, style) => {
      if (points.length < 2) return;
      add(...startEntity('LWPOLYLINE', layer, style), 90, points.length, 70, closed ? 1 : 0);
      points.forEach(([x, y]) => add(10, px(x), 20, py(y)));
      count(layer);
    };
    const addText = (node, layer, style) => {
      const value = cleanText(xmlText(node));
      if (!value) return;
      const anchor = node.getAttribute('text-anchor') || 'start';
      const align = anchor === 'middle' ? 1 : anchor === 'end' ? 2 : 0;
      const x = attr(node, 'x', 0), y = attr(node, 'y', 0);
      const h = Math.max(1.5, attr(node, 'font-size', 8) * ((sx + sy) / 2));
      add(...startEntity('TEXT', layer, style), 10, px(x), 20, py(y), 30, 0, 40, h, 1, value, 7, 'STANDARD', 72, align, 73, 0, 11, px(x), 21, py(y), 31, 0);
      count(layer);
    };

    doc.querySelectorAll('line,rect,circle,polyline,polygon,text,path').forEach((node) => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'rect' && node.parentElement === svg && node.getAttribute('fill') === '#ffffff' && !node.getAttribute('stroke')) return;
      const layer = layerFor(node);
      const style = styleFor(node, layer, sx, sy, manifest);
      if (node.getAttribute('transform')) warnings.push('未处理 SVG transform；请在 CAD 中检查该图元位置。');
      if (tag === 'line') line(attr(node, 'x1', 0), attr(node, 'y1', 0), attr(node, 'x2', 0), attr(node, 'y2', 0), layer, style);
      if (tag === 'rect') {
        const x = attr(node, 'x', 0), y = attr(node, 'y', 0), w = attr(node, 'width', 0), h = attr(node, 'height', 0);
        if (w > 0 && h > 0) poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], layer, true, style);
      }
      if (tag === 'circle') {
        add(...startEntity('CIRCLE', layer, style), 10, px(attr(node, 'cx', 0)), 20, py(attr(node, 'cy', 0)), 30, 0, 40, attr(node, 'r', 1) * ((sx + sy) / 2)); count(layer);
      }
      if (tag === 'polyline' || tag === 'polygon') poly(parsePoints(node.getAttribute('points')), layer, tag === 'polygon', style);
      if (tag === 'text') addText(node, layer, style);
      if (tag === 'path') {
        const points = parseStraightPath(node.getAttribute('d'), warnings);
        if (points.length > 1) poly(points, layer, false, style);
      }
    });

    const header = pairs(
      0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1024',
      9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1,
      9, '$LUNITS', 70, 2, 9, '$LTSCALE', 40, 1.0,
      9, '$DWGCODEPAGE', 3, 'ANSI_936', 0, 'ENDSEC'
    );
    const comment = cleanText((options && options.comment) || 'EVSE 可编辑 DXF 方案级草图；复杂符号、尺寸、保护与设备型号须由项目 CAD 模板和专业人员复核。');
    const manifestData = {
      schema: LEGACY_MANIFEST_SCHEMA, output: 'DXF_R2010_CONCEPT', units: 'mm', paperMm: [paperW, paperH], document: documentControl,
      layers: cloneManifest(manifest),
      scope: {
        included: ['SVG primitive geometry', 'EVSE layer table', 'text annotations'],
        excluded: ['native CAD blocks', 'dimensioning', 'protection settings', 'cable schedules', 'approval/signature', 'construction-level verification'],
        status: 'CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED'
      }
    };
    const dxf = header + tables(manifest) + pairs(
      0, 'SECTION', 2, 'ENTITIES', 999, comment,
      999, 'EVSE-DXF-MANIFEST: ' + cleanText(JSON.stringify({ drawingNo: documentControl.drawingNo, revision: documentControl.revision, status: documentControl.documentStatus, drawingSkill: documentControl.drawingSkill && documentControl.drawingSkill.id, rulePackVersion: documentControl.drawingSkill && documentControl.drawingSkill.version, layerCount: manifest.length }))
    ) + entities.join('') + pairs(0, 'ENDSEC', 0, 'EOF');
    return { dxf, warnings: Array.from(new Set(warnings)), stats: { entities: entities.length, paperMm: [paperW, paperH], layerEntityCounts: entityCounts }, manifest: manifestData };
  }

  return Object.freeze({
    VERSION,
    DRAWING_IR_SCHEMA,
    MANIFEST_SCHEMA,
    LEGACY_MANIFEST_SCHEMA,
    XDATA_APP_ID,
    exportDrawingIR,
    fromIR: exportDrawingIR,
    /* Deprecated compatibility API. New code must use exportDrawingIR(). */
    exportSvg,
    exportSvgLegacy: exportSvg,
    fromSvg: exportSvg,
    layerManifest: () => cloneManifest(FALLBACK_LAYER_MANIFEST)
  });
});
