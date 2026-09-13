/* ============================================================
 * Independent rendered-SVG -> Drawing IR reconciliation
 * ------------------------------------------------------------
 * This module intentionally does not call the SVG renderer and does not
 * trust self-declared hashes/counts.  It parses the compiler's closed SVG
 * vocabulary, reads the geometry that would actually be exported, and
 * reconciles it with the immutable Drawing IR.  Unknown or hidden geometry
 * inside EVSE-DRAWING-IR fails closed.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_RENDERED_SVG_AUDIT = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.2.0';
  const EPSILON = 0.001;
  const SHAPE_TAGS = new Set(['line', 'path', 'circle', 'rect', 'polyline', 'polygon', 'text', 'ellipse']);
  const ACTIVE_TAGS = new Set(['style', 'script', 'use', 'foreignObject', 'image', 'animate', 'animateTransform', 'set']);
  const BLOCKED_VISIBILITY_ATTRIBUTES = [
    'style', 'display', 'visibility', 'opacity', 'clip-path', 'mask', 'filter',
    'fill-opacity', 'stroke-opacity', 'href', 'xlink:href'
  ];

  function near(left, right) {
    return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) &&
      Math.abs(Number(left) - Number(right)) <= EPSILON;
  }
  function decode(value) {
    return String(value).replace(/&(?:#(x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/gi,
      (entity, numeric) => {
        if (numeric) return String.fromCodePoint(numeric[0].toLowerCase() === 'x'
          ? parseInt(numeric.slice(1), 16) : Number(numeric));
        return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[
          entity.slice(1, -1).toLowerCase()
        ];
      });
  }
  function compare(left, right) {
    const a = String(left == null ? '' : left);
    const b = String(right == null ? '' : right);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function parse(markup) {
    if (typeof markup !== 'string' || !markup.length || markup.length > 80000000) {
      throw new Error('SVG_INPUT_SIZE');
    }
    if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(markup)) throw new Error('SVG_UNSUPPORTED_XML');
    const nodes = [];
    const stack = [];
    const ids = new Set();
    const tokens = markup.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g) || [];
    if (tokens.join('') !== markup) throw new Error('SVG_XML_TOKEN');
    tokens.forEach((token) => {
      if (token.startsWith('<!--') || token.startsWith('<?')) return;
      if (!token.startsWith('<')) {
        if (stack.length) stack[stack.length - 1].text += decode(token);
        else if (token.trim()) throw new Error('SVG_XML_TEXT_OUTSIDE_ROOT');
        return;
      }
      if (token.startsWith('</')) {
        const close = /^<\/([\w:-]+)\s*>$/.exec(token);
        if (!close || !stack.length || stack.pop().tag !== close[1]) throw new Error('SVG_XML_UNBALANCED');
        return;
      }
      const open = /^<([\w:-]+)([\s\S]*?)\/?\s*>$/.exec(token);
      if (!open) throw new Error('SVG_XML_TAG');
      const attrs = {};
      const attrPattern = /\s+([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g;
      let match;
      let end = 0;
      while ((match = attrPattern.exec(open[2]))) {
        if (open[2].slice(end, match.index).trim() || Object.hasOwn(attrs, match[1])) {
          throw new Error('SVG_XML_ATTRIBUTE');
        }
        attrs[match[1]] = decode(match[2].slice(1, -1));
        end = attrPattern.lastIndex;
      }
      if (open[2].slice(end).trim()) throw new Error('SVG_XML_ATTRIBUTE');
      if (attrs.id) {
        if (ids.has(attrs.id)) throw new Error('SVG_DUPLICATE_ID:' + attrs.id);
        ids.add(attrs.id);
      }
      const node = { tag: open[1], attrs, text: '', parent: stack[stack.length - 1] || null };
      nodes.push(node);
      if (!/\/\s*>$/.test(token)) stack.push(node);
    });
    if (stack.length || nodes.filter((node) => !node.parent).length !== 1 ||
        !nodes[0] || nodes[0].tag !== 'svg') throw new Error('SVG_XML_ROOT');
    return nodes;
  }

  function arcData(value) {
    const match = /^M\s*([-\d.e+]+)[,\s]+([-\d.e+]+)\s+A\s*([-\d.e+]+)[,\s]+([-\d.e+]+)[,\s]+([-\d.e+]+)[,\s]+([01])[,\s]+([01])[,\s]+([-\d.e+]+)[,\s]+([-\d.e+]+)\s*$/i.exec(value || '');
    return match ? match.slice(1).map(Number) : null;
  }

  function routeIdentity(route) {
    const globalSource = route.globalSource || route.source;
    const globalTarget = route.globalTarget || route.target;
    const result = {
      'data-route': route.id,
      'data-net': route.netId,
      'data-circuit': route.circuitId,
      'data-from': globalSource.ref,
      'data-to': globalTarget.ref,
      'data-physical-from': globalSource.physicalRef || globalSource.ref,
      'data-physical-to': globalTarget.physicalRef || globalTarget.ref,
      'data-graphical-from': route.source.ref,
      'data-graphical-to': route.target.ref,
      'data-layer': route.layer
    };
    const connector = route.offPageConnector;
    if (connector) {
      result['data-off-page-connector'] = connector.id;
      result['data-off-page-role'] = connector.role;
      result['data-xref-sheet'] = connector.remoteSheetId;
      result['data-xref-page'] = connector.xref && connector.xref.page;
      result['data-xref-drawing-no'] = connector.xref && connector.xref.drawingNo;
      result['data-xref-endpoint'] = connector.xref && connector.xref.endpointKey;
    }
    return result;
  }

  function expectedPaint(layer, colors) {
    const C = colors || {};
    return {
      'EVSE-AC': [C.ac, 2.4, ''],
      'EVSE-DC': [C.dc, 2.4, ''],
      'EVSE-ESS': [C.ess, 2.4, ''],
      'EVSE-AUX': [C.aux, 1.7, ''],
      'EVSE-CTL': [C.ctl, 1.25, ''],
      'EVSE-COMM': [C.comm, 1.25, ''],
      'EVSE-PE': [C.pe, 2.6, '']
    }[layer] || [C.ink, 1.2, ''];
  }

  function inheritedDash(node) {
    for (let current = node; current; current = current.parent) {
      if (Object.hasOwn(current.attrs || {}, 'style')) {
        const match = /(?:^|;)\s*stroke-dasharray\s*:\s*([^;]*)/i.exec(String(current.attrs.style || ''));
        if (match) return { present: true, value: String(match[1] || '').trim() };
      }
      if (Object.hasOwn(current.attrs || {}, 'stroke-dasharray')) {
        return { present: true, value: String(current.attrs['stroke-dasharray'] || '').trim() };
      }
    }
    return { present: false, value: '' };
  }

  function isSolidDash(state) {
    /* Absence uses SVG's solid-line initial value; exact "none" is also
       solid.  An explicitly empty attribute is invalid presentation syntax
       and cannot prove that a dashed ancestor has been overridden. */
    return !state.present || state.value.toLowerCase() === 'none';
  }

  /* G050 / PAGE-Q13: independently inspect the final SVG presentation,
     instead of trusting the renderer's layer table.  Dashed mechanical
     linkages and annotation boundaries remain valid because only shapes
     carrying a real data-route identity are electrical conductors. */
  function auditElectricalConductorLineStyle(markup, ir) {
    const findings = [];
    const add = (code, routeId, detail) => {
      if (findings.length < 200) findings.push(Object.freeze({
        code, routeId: routeId || '', detail: detail == null ? '' : detail
      }));
    };
    const routes = ir && Array.isArray(ir.routes) ? ir.routes : null;
    if (!routes) {
      add('SVG_ELECTRICAL_CONDUCTOR_STYLE_NOT_PROVEN', '', 'Drawing IR routes are unavailable.');
      return Object.freeze({ version: VERSION, status: 'BLOCKED', ok: false,
        blockingCount: findings.length, findings: Object.freeze(findings),
        stats: Object.freeze({ expectedRoutes: 0, renderedRoutes: 0, renderedPieces: 0,
          dashedPieces: 0, tracedPrimitives: 0, dashedIrPrimitives: 0 }),
        scope: 'FINAL_SVG_ELECTRICAL_CONDUCTOR_LINE_STYLE', ruleId: 'G050' });
    }
    let nodes;
    try { nodes = parse(markup); }
    catch (error) {
      add('SVG_ELECTRICAL_CONDUCTOR_STYLE_NOT_PROVEN', '', error.message);
      return Object.freeze({ version: VERSION, status: 'BLOCKED', ok: false,
        blockingCount: findings.length, findings: Object.freeze(findings),
        stats: Object.freeze({ expectedRoutes: routes.length, renderedRoutes: 0, renderedPieces: 0,
          dashedPieces: 0, tracedPrimitives: 0, dashedIrPrimitives: 0 }),
        scope: 'FINAL_SVG_ELECTRICAL_CONDUCTOR_LINE_STYLE', ruleId: 'G050' });
    }
    const graph = nodes.find((node) => node.attrs.id === 'EVSE-DRAWING-IR');
    if (!graph) {
      add('SVG_ELECTRICAL_CONDUCTOR_STYLE_NOT_PROVEN', '', 'EVSE-DRAWING-IR is missing.');
      return Object.freeze({ version: VERSION, status: 'BLOCKED', ok: false,
        blockingCount: findings.length, findings: Object.freeze(findings),
        stats: Object.freeze({ expectedRoutes: routes.length, renderedRoutes: 0, renderedPieces: 0,
          dashedPieces: 0, tracedPrimitives: 0, dashedIrPrimitives: 0 }),
        scope: 'FINAL_SVG_ELECTRICAL_CONDUCTOR_LINE_STYLE', ruleId: 'G050' });
    }
    if (nodes.some((node) => node.tag === 'style')) {
      add('SVG_ELECTRICAL_CONDUCTOR_STYLE_NOT_PROVEN', '',
        'Embedded CSS can override conductor line style and is not allowed in the controlled SVG vocabulary.');
    }
    const inside = (node) => {
      for (let current = node; current; current = current.parent) if (current === graph) return true;
      return false;
    };
    const routeIds = new Set();
    let invalidRouteIds = false;
    routes.forEach((route) => {
      const id = String(route && route.id || '');
      if (!id || routeIds.has(id)) invalidRouteIds = true;
      if (id) routeIds.add(id);
    });
    if (invalidRouteIds) {
      add('SVG_ELECTRICAL_CONDUCTOR_STYLE_NOT_PROVEN', '', 'Drawing IR route identities are empty or duplicated.');
    }
    if (!Array.isArray(ir.primitives)) {
      add('SVG_ELECTRICAL_CONDUCTOR_STYLE_NOT_PROVEN', '', 'Drawing IR primitives are unavailable.');
    }
    const piecesByRoute = new Map();
    let renderedPieces = 0;
    let dashedPieces = 0;
    const tracedPrimitives = (Array.isArray(ir.primitives) ? ir.primitives : []).filter((primitive) =>
      primitive && primitive.kind !== 'text' && (primitive.routeId || primitive.netId || primitive.circuitId ||
        primitive.bridgeRouteId || Array.isArray(primitive.routeIds) && primitive.routeIds.length));
    let dashedIrPrimitives = 0;
    tracedPrimitives.forEach((primitive) => {
      const dash = String(primitive.dash == null ? '' : primitive.dash).trim();
      if (dash && dash.toLowerCase() !== 'none') {
        dashedIrPrimitives += 1;
        add('IR_ELECTRICAL_CONDUCTOR_DASHED', String(primitive.routeId || primitive.bridgeRouteId || ''),
          'Trace-bearing Drawing IR primitive ' + String(primitive.id || 'UNKNOWN') +
          ' requests dash="' + dash + '".');
      }
    });
    nodes.filter((node) => inside(node) && ['line', 'path', 'polyline'].includes(node.tag) &&
      Object.hasOwn(node.attrs, 'data-route')).forEach((node) => {
      renderedPieces += 1;
      const routeId = String(node.attrs['data-route'] || '');
      piecesByRoute.set(routeId, Number(piecesByRoute.get(routeId) || 0) + 1);
      if (!routeIds.has(routeId)) {
        add('SVG_ELECTRICAL_CONDUCTOR_STYLE_NOT_PROVEN', routeId, 'Rendered route is not present in Drawing IR.');
      }
      const dash = inheritedDash(node);
      if (!isSolidDash(dash)) {
        dashedPieces += 1;
        add('SVG_ELECTRICAL_CONDUCTOR_DASHED', routeId,
          'Electrical route uses stroke-dasharray="' + dash.value +
          '"; every electrical conductor must be solid.');
      }
    });
    routeIds.forEach((routeId) => {
      if (!piecesByRoute.has(routeId)) {
        add('SVG_ELECTRICAL_CONDUCTOR_STYLE_NOT_PROVEN', routeId,
          'No rendered conductor piece proves this route is solid.');
      }
    });
    const unique = [];
    const seen = new Set();
    findings.sort((left, right) => compare(left.code, right.code) || compare(left.routeId, right.routeId) ||
      compare(left.detail, right.detail)).forEach((finding) => {
      const key = finding.code + '|' + finding.routeId + '|' + finding.detail;
      if (!seen.has(key)) { seen.add(key); unique.push(finding); }
    });
    return Object.freeze({
      version: VERSION,
      status: unique.length ? 'BLOCKED' : 'PASS',
      ok: unique.length === 0,
      blockingCount: unique.length,
      findings: Object.freeze(unique),
      stats: Object.freeze({ expectedRoutes: routeIds.size, renderedRoutes: piecesByRoute.size,
        renderedPieces, dashedPieces, tracedPrimitives: tracedPrimitives.length, dashedIrPrimitives }),
      scope: 'FINAL_SVG_ELECTRICAL_CONDUCTOR_LINE_STYLE',
      ruleId: 'G050'
    });
  }

  function audit(markup, ir, colors) {
    const errors = [];
    const add = (code, id, detail) => {
      if (errors.length < 200) errors.push({ code, id: id || '', detail: detail == null ? '' : detail });
    };
    let nodes;
    try { nodes = parse(markup); }
    catch (error) {
      return Object.freeze({ version: VERSION, ok: false,
        errors: Object.freeze([{ code: 'SVG_PARSE', id: '', detail: error.message }]),
        stats: Object.freeze({}), scope: 'RENDERED_SVG_GEOMETRY_TO_DRAWING_IR' });
    }
    if (!ir) return Object.freeze({ version: VERSION, ok: false,
      errors: Object.freeze([{ code: 'IR_MISSING', id: '', detail: '' }]),
      stats: Object.freeze({}), scope: 'RENDERED_SVG_GEOMETRY_TO_DRAWING_IR' });

    const rootNode = nodes[0];
    const graph = nodes.find((node) => node.attrs.id === 'EVSE-DRAWING-IR');
    if (!graph) return Object.freeze({ version: VERSION, ok: false,
      errors: Object.freeze([{ code: 'SVG_IR_GROUP_MISSING', id: 'EVSE-DRAWING-IR', detail: '' }]),
      stats: Object.freeze({}), scope: 'RENDERED_SVG_GEOMETRY_TO_DRAWING_IR' });
    const inside = (node) => {
      for (let current = node; current; current = current.parent) if (current === graph) return true;
      return false;
    };
    const descendants = nodes.filter(inside);
    if (graph.parent !== rootNode) add('SVG_IR_PARENT', 'EVSE-DRAWING-IR');
    if (graph.attrs['data-ir-schema'] !== String(ir.schema || '')) add('SVG_IR_SCHEMA', 'EVSE-DRAWING-IR');
    if (nodes.filter((node) => node.tag === 'svg').length !== 1) add('SVG_NESTED_VIEWPORT', 'svg');

    const sheet = ir.metadata && ir.metadata.sheet;
    if (sheet) {
      const actual = (rootNode.attrs.viewBox || '').trim().split(/[ ,]+/).map(Number);
      const wanted = [0, 0, Math.max(1680, Number(sheet.canvasWidth)), Math.max(1188, Number(sheet.canvasHeight))];
      if (actual.length !== 4 || actual.some((value, index) => !near(value, wanted[index]))) {
        add('SVG_VIEWPORT_MISMATCH', 'svg', { actual, wanted });
      }
    }
    if (rootNode.attrs['data-route-count'] !== String((ir.routes || []).length)) add('SVG_ROUTE_COUNT', 'svg');
    if (rootNode.attrs['data-alias-trace-count'] !== String((ir.aliasTraces || []).length)) add('SVG_ALIAS_COUNT', 'svg');

    /* The reference implementation only inspected EVSE-DRAWING-IR.  A white
       rectangle appended after that group could therefore cover the whole
       drawing and still pass.  Constrain the complete top-level presentation
       skeleton as well: generated frame/title/watermark/table/legend/notes
       live in named containers, and no anonymous root geometry is accepted. */
    const rootChildren = nodes.filter((node) => node.parent === rootNode);
    const allowedRootGroups = new Set([
      'EVSE-FRAME', 'EVSE-TITLE', 'EVSE-WATERMARK', 'EVSE-DRAWING-IR',
      'EVSE-SCHEDULE', 'EVSE-LEGEND', 'EVSE-FOOTNOTES'
    ]);
    const allowedRootText = ['title', 'desc', 'metadata'];
    rootChildren.forEach((node) => {
      if (allowedRootText.includes(node.tag)) return;
      if (node.tag === 'rect' && node.attrs.id === 'EVSE-PAPER') return;
      if (node.tag === 'g' && allowedRootGroups.has(node.attrs.id)) return;
      add('SVG_UNTRACKED_ROOT_CONTENT', node.attrs.id || node.tag);
    });
    const paper = rootChildren.filter((node) => node.attrs.id === 'EVSE-PAPER');
    const viewport = (rootNode.attrs.viewBox || '').trim().split(/[ ,]+/).map(Number);
    if (paper.length !== 1 || paper[0].tag !== 'rect' || paper[0].attrs.fill !== '#ffffff' ||
        viewport.length !== 4 || !near(paper[0].attrs.x || 0, viewport[0]) ||
        !near(paper[0].attrs.y || 0, viewport[1]) || !near(paper[0].attrs.width, viewport[2]) ||
        !near(paper[0].attrs.height, viewport[3])) add('SVG_PAPER_CONTRACT', 'EVSE-PAPER');
    ['EVSE-FRAME', 'EVSE-TITLE', 'EVSE-WATERMARK', 'EVSE-LEGEND', 'EVSE-FOOTNOTES']
      .forEach((id) => {
        if (rootChildren.filter((node) => node.attrs.id === id).length !== 1) add('SVG_PRESENTATION_GROUP', id);
      });
    const scheduleExpected = rootNode.attrs['data-schedule-included'] === 'true';
    if (rootChildren.some((node) => node.attrs.id === 'EVSE-SCHEDULE') !== scheduleExpected) {
      add('SVG_SCHEDULE_CONTRACT', 'EVSE-SCHEDULE');
    }
    function descendantsOf(owner) {
      return nodes.filter((node) => {
        for (let current = node.parent; current; current = current.parent) if (current === owner) return true;
        return false;
      });
    }
    function exactShapeCounts(id, wanted) {
      const owner = rootChildren.find((node) => node.attrs.id === id);
      if (!owner) return;
      const actual = {};
      descendantsOf(owner).filter((node) => SHAPE_TAGS.has(node.tag)).forEach((node) => {
        actual[node.tag] = Number(actual[node.tag] || 0) + 1;
      });
      if (Object.keys(Object.assign({}, wanted, actual)).some((tag) =>
        Number(actual[tag] || 0) !== Number(wanted[tag] || 0))) {
        add('SVG_PRESENTATION_SHAPE_COUNT', id, { actual, wanted });
      }
    }
    exactShapeCounts('EVSE-FRAME', { rect: 3, line: 5, text: 12 });
    exactShapeCounts('EVSE-TITLE', { text: 3 });
    exactShapeCounts('EVSE-WATERMARK', { text: 1 });
    exactShapeCounts('EVSE-LEGEND', { rect: 1, line: 7, text: 8 });
    const footnotes = rootChildren.find((node) => node.attrs.id === 'EVSE-FOOTNOTES');
    if (footnotes) {
      const footnoteShapes = descendantsOf(footnotes).filter((node) => SHAPE_TAGS.has(node.tag));
      if (footnoteShapes.some((node) => node.tag !== 'text') ||
          footnoteShapes.length < 2 || footnoteShapes.length > 3) {
        add('SVG_FOOTNOTE_CONTRACT', 'EVSE-FOOTNOTES');
      }
    }
    nodes.filter((node) => !inside(node) && node !== rootNode && SHAPE_TAGS.has(node.tag)).forEach((node) => {
      let owner = node;
      while (owner.parent && owner.parent !== rootNode) owner = owner.parent;
      if (owner.tag === 'rect' && owner.attrs.id === 'EVSE-PAPER') return;
      if (owner.tag !== 'g' || !allowedRootGroups.has(owner.attrs.id) || owner.attrs.id === 'EVSE-DRAWING-IR') {
        add('SVG_UNTRACKED_PRESENTATION_GEOMETRY', node.attrs.id || node.tag);
      }
      /* Even if injected inside a named container, a viewport-sized opaque
         shape is never a legitimate frame/legend/table primitive. */
      if (node.tag === 'rect' && viewport.length === 4 &&
          Number(node.attrs.width || 0) >= viewport[2] * 0.8 &&
          Number(node.attrs.height || 0) >= viewport[3] * 0.8 &&
          node.attrs.fill && node.attrs.fill !== 'none' &&
          node.attrs.id !== 'EVSE-PAPER') add('SVG_PRESENTATION_OCCLUSION', owner.attrs.id || node.tag);
    });

    nodes.forEach((node) => {
      if (ACTIVE_TAGS.has(node.tag) || Object.keys(node.attrs).some((key) => /^on/i.test(key))) {
        add('SVG_ACTIVE_OR_EXTERNAL_CONTENT', node.attrs.id || node.tag);
      }
      if ((inside(node) || node === rootNode) &&
          BLOCKED_VISIBILITY_ATTRIBUTES.some((key) => Object.hasOwn(node.attrs, key))) {
        add('SVG_VISIBILITY_OVERRIDE', node.attrs.id || node.tag);
      }
      if ((inside(node) || node === rootNode) && node.attrs.transform && node.tag !== 'text') {
        add('SVG_TRANSFORM_OVERRIDE', node.attrs.id || node.tag);
      }
    });

    const routes = new Map((ir.routes || []).map((route) => [route.id, route]));
    const routeGroups = new Map();
    const routePieces = new Map();
    const bridgeByRoute = new Map();
    (ir.markers || []).filter((marker) => marker.type === 'bridge').forEach((marker) => {
      const values = bridgeByRoute.get(marker.bridgeRouteId) || [];
      values.push(marker);
      bridgeByRoute.set(marker.bridgeRouteId, values);
    });

    descendants.filter((node) => Object.hasOwn(node.attrs, 'data-route')).forEach((node) => {
      const id = node.attrs['data-route'];
      const route = routes.get(id);
      if (!route) { add('SVG_EXTRA_ROUTE', id); return; }
      Object.entries(routeIdentity(route)).forEach(([key, value]) => {
        if (node.attrs[key] !== String(value == null ? '' : value)) add('SVG_ROUTE_IDENTITY', id, key);
      });
      const offPageKeys = ['data-off-page-connector', 'data-off-page-role', 'data-xref-sheet',
        'data-xref-page', 'data-xref-drawing-no', 'data-xref-endpoint'];
      if (!route.offPageConnector && offPageKeys.some((key) => Object.hasOwn(node.attrs, key))) {
        add('SVG_UNEXPECTED_XREF', id);
      }
      if (node.tag === 'g') {
        if (node.attrs.id !== 'ROUTE-' + id || routeGroups.has(id) || node.parent && node.parent.attrs.id !== 'EVSE-IR-ROUTES') {
          add('SVG_ROUTE_GROUP_DUPLICATE', id);
        }
        routeGroups.set(id, node);
        return;
      }
      if (!node.parent || node.parent.attrs.id !== 'ROUTE-' + id) add('SVG_ROUTE_PARENT', id);
      const paint = expectedPaint(route.layer, colors);
      if (!near(node.attrs['stroke-width'], paint[1]) ||
          (paint[0] && node.attrs.stroke !== paint[0]) ||
          (node.attrs['stroke-dasharray'] || '') !== paint[2]) add('SVG_ROUTE_PAINT', id);
      let coords;
      let bridge = false;
      if (node.tag === 'line') coords = ['x1', 'y1', 'x2', 'y2'].map((key) => Number(node.attrs[key]));
      else if (node.tag === 'path') {
        const arc = arcData(node.attrs.d);
        if (!arc || !(arc[2] > 0 && arc[2] <= 3.001) || !near(arc[2], arc[3]) ||
            !near(arc[4], 0) || arc[5] !== 0 || arc[6] !== 1 || node.attrs['data-marker'] !== 'bridge') {
          add('SVG_BRIDGE_GEOMETRY', id); return;
        }
        coords = [arc[0], arc[1], arc[7], arc[8]];
        bridge = true;
      } else { add('SVG_ROUTE_PRIMITIVE', id, node.tag); return; }
      if (coords.some((value) => !Number.isFinite(value)) ||
          (!near(coords[0], coords[2]) && !near(coords[1], coords[3]))) {
        add('SVG_ROUTE_COORDINATE', id, coords); return;
      }
      const values = routePieces.get(id) || [];
      values.push({ coords, bridge });
      routePieces.set(id, values);
    });

    let renderedSegments = 0;
    routes.forEach((route, id) => {
      if (!routeGroups.has(id)) add('SVG_MISSING_ROUTE', id);
      const bins = (route.segments || []).map(() => []);
      (routePieces.get(id) || []).forEach((piece) => {
        const [x1, y1, x2, y2] = piece.coords;
        /* EPSILON is for serialized-coordinate comparison, not orientation:
           an adaptively shortened vertical bridge may legitimately be below
           0.001 units long. */
        const horizontal = Math.abs(y1 - y2) < 1e-8;
        const low = Math.min(horizontal ? x1 : y1, horizontal ? x2 : y2);
        const high = Math.max(horizontal ? x1 : y1, horizontal ? x2 : y2);
        const index = (route.segments || []).findIndex((segment) => {
          const isHorizontal = segment.orientation === 'horizontal';
          return isHorizontal === horizontal && near(isHorizontal ? y1 : x1,
            isHorizontal ? segment.y1 : segment.x1) &&
            low >= Math.min(isHorizontal ? segment.x1 : segment.y1,
              isHorizontal ? segment.x2 : segment.y2) - EPSILON &&
            high <= Math.max(isHorizontal ? segment.x1 : segment.y1,
              isHorizontal ? segment.x2 : segment.y2) + EPSILON;
        });
        if (index < 0 || high - low <= 1e-9) { add('SVG_ROUTE_DEVIATION', id, piece.coords); return; }
        bins[index].push([low, high]);
        renderedSegments += 1;
        if (piece.bridge) {
          const centerX = (x1 + x2) / 2;
          const centerY = (y1 + y2) / 2;
          if (!(bridgeByRoute.get(id) || []).some((marker) => near(marker.x, centerX) && near(marker.y, centerY))) {
            add('SVG_UNEXPECTED_BRIDGE', id, piece.coords);
          }
        }
      });
      (route.segments || []).forEach((segment, index) => {
        const horizontal = segment.orientation === 'horizontal';
        const start = Math.min(horizontal ? segment.x1 : segment.y1, horizontal ? segment.x2 : segment.y2);
        const end = Math.max(horizontal ? segment.x1 : segment.y1, horizontal ? segment.x2 : segment.y2);
        let cursor = start;
        bins[index].sort((left, right) => left[0] - right[0]).forEach(([low, high]) => {
          if (!near(low, cursor)) add(low > cursor ? 'SVG_WIRE_GAP' : 'SVG_WIRE_OVERLAP', id,
            { segment: index, cursor, low });
          cursor = high;
        });
        if (!near(cursor, end)) add('SVG_WIRE_GAP', id, { segment: index, cursor, end });
      });
    });

    const hitByRoute = new Map();
    descendants.filter((node) => node.attrs['data-editor-hit-target'] === 'true').forEach((node) => {
      const parentId = node.parent && node.parent.attrs.id || '';
      const routeId = parentId.startsWith('ROUTE-') ? parentId.slice(6) : '';
      const attrsOk = node.tag === 'line' && routeId && routes.has(routeId) &&
        node.attrs.class === 'editor-route-hit-target' && node.attrs.stroke === 'transparent' &&
        near(node.attrs['stroke-width'], 12) && node.attrs.fill === 'none' &&
        node.attrs['pointer-events'] === 'stroke' && node.attrs['vector-effect'] === 'non-scaling-stroke' &&
        node.attrs['aria-hidden'] === 'true' && !Object.hasOwn(node.attrs, 'data-route');
      if (!attrsOk) { add('SVG_HIT_TARGET_CONTRACT', routeId || parentId || 'hit-target'); return; }
      const values = hitByRoute.get(routeId) || [];
      values.push(['x1', 'y1', 'x2', 'y2'].map((key) => Number(node.attrs[key])));
      hitByRoute.set(routeId, values);
    });
    routes.forEach((route, id) => {
      const hits = hitByRoute.get(id) || [];
      const used = new Set();
      (route.segments || []).forEach((segment, segmentIndex) => {
        const index = hits.findIndex((coords, hitIndex) => !used.has(hitIndex) &&
          near(coords[0], segment.x1) && near(coords[1], segment.y1) &&
          near(coords[2], segment.x2) && near(coords[3], segment.y2));
        if (index < 0) add('SVG_MISSING_HIT_TARGET', id, segmentIndex);
        else used.add(index);
      });
      if (used.size !== hits.length) add('SVG_EXTRA_HIT_TARGET', id, hits.length - used.size);
    });

    const expectedPrimitives = new Map([].concat(
      (ir.primitives || []).filter((primitive) => primitive.equipmentId),
      ir.annotations || []
    ).map((primitive) => [primitive.id, primitive]));
    const seenPrimitives = new Set();
    const deviceGroups = new Set();
    const numericFields = (node, primitive, fields) => fields.forEach(([attribute, field]) => {
      if (!near(node.attrs[attribute], primitive[field])) add('SVG_PRIMITIVE_GEOMETRY', primitive.id, attribute);
    });
    const compareArc = (node, primitive) => {
      const actual = arcData(node.attrs.d);
      const start = Number(primitive.startAngle) * Math.PI / 180;
      const end = Number(primitive.endAngle) * Math.PI / 180;
      const delta = ((Number(primitive.endAngle) - Number(primitive.startAngle)) % 360 + 360) % 360;
      const wanted = [
        Number(primitive.x) + Number(primitive.radius) * Math.cos(start),
        Number(primitive.y) + Number(primitive.radius) * Math.sin(start),
        Number(primitive.radius), Number(primitive.radius), 0, delta > 180 ? 1 : 0, 1,
        Number(primitive.x) + Number(primitive.radius) * Math.cos(end),
        Number(primitive.y) + Number(primitive.radius) * Math.sin(end)
      ];
      if (!actual || actual.some((value, index) => !near(value, wanted[index]))) {
        add('SVG_PRIMITIVE_GEOMETRY', primitive.id, 'arc');
      }
    };

    descendants.forEach((node) => {
      if (node.tag === 'g' && node.attrs.id && node.attrs.id.startsWith('DEVICE-')) {
        const id = node.attrs['data-equipment'];
        const device = (ir.devices || []).find((item) => item.id === id);
        if (!device || deviceGroups.has(id) || node.attrs.id !== 'DEVICE-' + id ||
            node.attrs['data-device-kind'] !== String(device && device.type || '') ||
            node.attrs['data-symbol'] !== String(device && device.symbolId || '') ||
            node.parent && node.parent.attrs.id !== 'EVSE-IR-DEVICES') add('SVG_DEVICE_IDENTITY', id);
        deviceGroups.add(id);
      }
      if (!Object.hasOwn(node.attrs, 'data-primitive')) return;
      const id = node.attrs['data-primitive'];
      const primitive = expectedPrimitives.get(id);
      if (!primitive || seenPrimitives.has(id)) { add('SVG_EXTRA_OR_DUPLICATE_PRIMITIVE', id); return; }
      seenPrimitives.add(id);
      const kind = String(primitive.kind || '').toLowerCase();
      const wantedTag = { port: 'circle', arc: 'path', polyline: primitive.closed ? 'polygon' : 'polyline' }[kind] || kind;
      if (node.tag !== wantedTag) add('SVG_PRIMITIVE_KIND', id, node.tag);
      const identities = {
        'data-equipment': primitive.equipmentId || '',
        'data-endpoint': primitive.endpointRef || '',
        'data-terminal': primitive.terminalId || ''
      };
      Object.entries(identities).forEach(([key, value]) => {
        if ((node.attrs[key] || '') !== String(value)) add('SVG_PRIMITIVE_IDENTITY', id, key);
      });
      if (primitive.equipmentId && (!node.parent || node.parent.attrs.id !== 'DEVICE-' + primitive.equipmentId)) {
        add('SVG_PRIMITIVE_PARENT', id);
      }
      if (!primitive.equipmentId && (!node.parent || node.parent.attrs.id !== 'EVSE-IR-ANNOTATIONS')) {
        add('SVG_PRIMITIVE_PARENT', id);
      }
      if (kind === 'line') numericFields(node, primitive, [['x1', 'x1'], ['y1', 'y1'], ['x2', 'x2'], ['y2', 'y2']]);
      if (kind === 'rect') numericFields(node, primitive, [['x', 'x'], ['y', 'y'], ['width', 'width'], ['height', 'height']]);
      if (kind === 'circle' || kind === 'port') {
        numericFields(node, primitive, [['cx', 'x'], ['cy', 'y']]);
        if (!near(node.attrs.r, kind === 'port' ? 1.55 : primitive.radius)) add('SVG_PRIMITIVE_GEOMETRY', id, 'r');
      }
      if (kind === 'polyline') {
        const actual = (node.attrs.points || '').trim().split(/[ ,]+/).filter(Boolean).map(Number);
        const wanted = (primitive.points || []).flatMap((point) => [point.x, point.y]);
        if (actual.length !== wanted.length || actual.some((value, index) => !near(value, wanted[index]))) {
          add('SVG_PRIMITIVE_GEOMETRY', id, 'points');
        }
      }
      if (kind === 'arc') compareArc(node, primitive);
      if (kind === 'text') {
        numericFields(node, primitive, [['x', 'x'], ['y', 'y']]);
        const anchor = ['start', 'middle', 'end'].includes(primitive.anchor) ? primitive.anchor : 'middle';
        if (node.text !== String(primitive.text == null ? '' : primitive.text) ||
            !near(node.attrs['font-size'], primitive.height || 4) ||
            node.attrs['text-anchor'] !== anchor ||
            node.attrs['font-weight'] !== String(primitive.weight || 'normal') ||
            node.attrs['dominant-baseline'] !== 'middle') add('SVG_LABEL_MISMATCH', id);
        const rotation = Number(primitive.rotation || 0);
        const transform = node.attrs.transform || '';
        const match = /^rotate\(([^)]+)\)$/.exec(transform);
        const values = match ? match[1].trim().split(/[ ,]+/).map(Number) : [];
        if (rotation ? (values.length !== 3 || values.some((value, index) =>
          !near(value, [rotation, primitive.x, primitive.y][index]))) : !!transform) add('SVG_TEXT_TRANSFORM', id);
      }

      const C = colors || {};
      if (kind === 'text') {
        if ((C.ink && node.attrs.fill !== C.ink) || node.attrs.stroke !== 'none') add('SVG_PRIMITIVE_PAINT', id, 'text');
      } else if (kind === 'port') {
        if (node.attrs.fill !== '#ffffff' || (C.ink && node.attrs.stroke !== C.ink) ||
            !near(node.attrs['stroke-width'], 0.8)) add('SVG_PRIMITIVE_PAINT', id, 'port');
      } else {
        const stroke = primitive.stroke === 'none' ? 'none' : primitive.stroke || C.ink;
        const fill = primitive.fill === 'ink' ? C.ink : primitive.fill === 'paper' ? '#ffffff' :
          primitive.fill && primitive.fill !== 'none' ? primitive.fill : 'none';
        if ((stroke && node.attrs.stroke !== stroke) || (fill && node.attrs.fill !== fill) ||
            !near(node.attrs['stroke-width'], primitive.strokeWidth == null ? 1.1 : primitive.strokeWidth) ||
            (node.attrs['stroke-dasharray'] || '') !== (primitive.dash || '')) add('SVG_PRIMITIVE_PAINT', id);
      }
    });
    expectedPrimitives.forEach((_, id) => { if (!seenPrimitives.has(id)) add('SVG_MISSING_PRIMITIVE', id); });
    (ir.devices || []).forEach((device) => { if (!deviceGroups.has(device.id)) add('SVG_MISSING_DEVICE', device.id); });

    const aliases = new Map((ir.aliasTraces || []).map((trace) => [trace.id, trace]));
    const seenAliases = new Set();
    descendants.filter((node) => Object.hasOwn(node.attrs, 'data-alias-trace')).forEach((node) => {
      const id = node.attrs['data-alias-trace'];
      const trace = aliases.get(id);
      if (!trace || seenAliases.has(id) || node.tag !== 'metadata') { add('SVG_ALIAS_IDENTITY', id); return; }
      seenAliases.add(id);
      const fields = {
        'data-net': trace.netId,
        'data-circuit': trace.circuitId,
        'data-from': trace.source.ref,
        'data-to': trace.target.ref,
        'data-physical-from': trace.physicalSource.ref,
        'data-physical-to': trace.physicalTarget.ref,
        'data-alias-reason': trace.reason
      };
      Object.entries(fields).forEach(([key, value]) => {
        if (node.attrs[key] !== String(value)) add('SVG_ALIAS_IDENTITY', id, key);
      });
    });
    aliases.forEach((_, id) => { if (!seenAliases.has(id)) add('SVG_MISSING_ALIAS', id); });

    const expectedJunctions = (ir.markers || []).filter((marker) => marker.type === 'junction');
    const usedJunctions = new Set();
    descendants.filter((node) => node.attrs['data-marker'] === 'junction').forEach((node) => {
      const index = expectedJunctions.findIndex((marker, markerIndex) => !usedJunctions.has(markerIndex) &&
        near(node.attrs.cx, marker.x) && near(node.attrs.cy, marker.y) &&
        node.attrs['data-net'] === marker.netId && node.attrs['data-routes'] === marker.routeIds.join(','));
      if (index < 0 || node.tag !== 'circle' || !near(node.attrs.r, 2.3)) add('SVG_JUNCTION_MISMATCH', 'junction');
      else usedJunctions.add(index);
    });
    if (usedJunctions.size !== expectedJunctions.length) add('SVG_MISSING_JUNCTION', 'junctions');

    descendants.forEach((node) => {
      if (!SHAPE_TAGS.has(node.tag)) return;
      const trackedPrimitive = Object.hasOwn(node.attrs, 'data-primitive');
      const trackedRoute = Object.hasOwn(node.attrs, 'data-route');
      const trackedJunction = node.attrs['data-marker'] === 'junction';
      const trackedHit = node.attrs['data-editor-hit-target'] === 'true';
      if (!trackedPrimitive && !trackedRoute && !trackedJunction && !trackedHit) {
        add('SVG_UNTRACKED_GEOMETRY', node.attrs.id || node.tag);
      }
    });
    (ir.markers || []).filter((marker) => marker.type === 'bridge').forEach((marker) => {
      if (!(routePieces.get(marker.bridgeRouteId) || []).some((piece) => piece.bridge &&
          near((piece.coords[0] + piece.coords[2]) / 2, marker.x) &&
          near((piece.coords[1] + piece.coords[3]) / 2, marker.y))) {
        add('SVG_MISSING_BRIDGE', marker.bridgeRouteId, { x: marker.x, y: marker.y });
      }
    });

    errors.sort((left, right) => compare(left.code, right.code) || compare(left.id, right.id));
    return Object.freeze({
      version: VERSION,
      ok: errors.length === 0,
      errors: Object.freeze(errors),
      stats: Object.freeze({
        routes: routes.size,
        renderedSegments,
        hitTargets: Array.from(hitByRoute.values()).reduce((sum, items) => sum + items.length, 0),
        primitives: seenPrimitives.size,
        devices: deviceGroups.size,
        aliases: seenAliases.size
      }),
      scope: 'RENDERED_SVG_GEOMETRY_TO_DRAWING_IR'
    });
  }

  return Object.freeze({ VERSION, EPSILON, parse, auditElectricalConductorLineStyle, audit });
});
