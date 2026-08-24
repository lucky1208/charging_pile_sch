/* ============================================================
 * Renderer-neutral Drawing IR -> automatically sized SVG preview
 * ------------------------------------------------------------
 * All electrical geometry comes from EVSE Drawing IR.  This renderer may
 * style a primitive, but it never creates a connection or changes a route.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_SVG_IR_RENDERER = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.1.0';

  class SvgIRRenderError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'SvgIRRenderError';
      this.code = code;
      this.details = details || {};
    }
  }

  function compareText(a, b) {
    const aa = String(a);
    const bb = String(b);
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  }

  function number(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new SvgIRRenderError('INVALID_COORDINATE', 'SVG coordinate must be finite.', { value });
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
  }

  function attr(S, value) {
    return S.esc(String(value == null ? '' : value));
  }

  function layerStyle(layer, C) {
    const styles = {
      'EVSE-AC': { color: C.ac, width: 1.8 },
      'EVSE-DC': { color: C.dc, width: 1.8 },
      'EVSE-ESS': { color: C.ess, width: 1.8 },
      'EVSE-AUX': { color: C.aux, width: 1.45 },
      'EVSE-CTL': { color: C.ctl, width: 1.2 },
      'EVSE-COMM': { color: C.comm, width: 1.2 },
      'EVSE-PE': { color: C.pe, width: 1.8 }
    };
    return styles[layer] || { color: C.ink, width: 1.2 };
  }

  function routeAttributes(S, route) {
    return ' data-route="' + attr(S, route.id) + '"' +
      ' data-net="' + attr(S, route.netId) + '"' +
      ' data-circuit="' + attr(S, route.circuitId) + '"' +
      ' data-from="' + attr(S, route.source.ref) + '"' +
      ' data-to="' + attr(S, route.target.ref) + '"' +
      ' data-physical-from="' + attr(S, route.source.physicalRef || route.source.ref) + '"' +
      ' data-physical-to="' + attr(S, route.target.physicalRef || route.target.ref) + '"' +
      ' data-layer="' + attr(S, route.layer) + '"';
  }

  function renderAliasTraces(S, ir) {
    let out = '<metadata id="EVSE-IR-ALIAS-TRACES" data-alias-trace-count="' +
      number((ir.aliasTraces || []).length) + '">';
    (ir.aliasTraces || []).slice().sort((a, b) => compareText(a.id, b.id)).forEach((trace) => {
      out += '<metadata id="ALIAS-TRACE-' + attr(S, trace.circuitId) + '"' +
        ' data-alias-trace="' + attr(S, trace.id) + '"' +
        ' data-alias-reason="' + attr(S, trace.reason) + '"' +
        ' data-net="' + attr(S, trace.netId) + '"' +
        ' data-circuit="' + attr(S, trace.circuitId) + '"' +
        ' data-from="' + attr(S, trace.source.ref) + '"' +
        ' data-to="' + attr(S, trace.target.ref) + '"' +
        ' data-physical-from="' + attr(S, trace.physicalSource.ref) + '"' +
        ' data-physical-to="' + attr(S, trace.physicalTarget.ref) + '"/>';
    });
    return out + '</metadata>';
  }

  function lineElement(S, route, style, x1, y1, x2, y2) {
    if (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9) return '';
    return '<line x1="' + number(x1) + '" y1="' + number(y1) +
      '" x2="' + number(x2) + '" y2="' + number(y2) +
      '" stroke="' + style.color + '" stroke-width="' + number(style.width) +
      '" stroke-linecap="round"' + routeAttributes(S, route) + '/>';
  }

  function indexRouteEvents(ir) {
    const result = new Map();
    const add = (routeId, marker, renderKind) => {
      if (!routeId) return;
      const events = result.get(routeId) || [];
      events.push(Object.assign({ renderKind }, marker));
      result.set(routeId, events);
    };
    (ir.markers || []).forEach((marker) => {
      if (marker.type === 'bridge') add(marker.bridgeRouteId, marker, 'bridge');
      else if (marker.type === 'junction') (marker.routeIds || []).forEach((routeId) => add(routeId, marker, 'junction'));
    });
    return result;
  }

  function renderSegment(S, route, segment, style, routeEvents) {
    const events = (routeEvents || []).filter((marker) =>
      (segment.orientation === 'horizontal'
        ? Math.abs(marker.y - segment.y1) < 1e-9 && marker.x > Math.min(segment.x1, segment.x2) && marker.x < Math.max(segment.x1, segment.x2)
        : Math.abs(marker.x - segment.x1) < 1e-9 && marker.y > Math.min(segment.y1, segment.y2) && marker.y < Math.max(segment.y1, segment.y2)))
      .sort((a, b) => segment.orientation === 'horizontal' ? a.x - b.x : a.y - b.y);
    if (!events.length) return lineElement(S, route, style, segment.x1, segment.y1, segment.x2, segment.y2);
    const radius = 3;
    let out = '';
    if (segment.orientation === 'horizontal') {
      const start = Math.min(segment.x1, segment.x2);
      const end = Math.max(segment.x1, segment.x2);
      let cursor = start;
      events.forEach((marker) => {
        if (marker.renderKind === 'junction') {
          out += lineElement(S, route, style, cursor, segment.y1, marker.x, segment.y1);
          cursor = marker.x;
          return;
        }
        const left = Math.max(cursor, marker.x - radius);
        const right = Math.min(end, marker.x + radius);
        out += lineElement(S, route, style, cursor, segment.y1, left, segment.y1);
        out += '<path d="M' + number(left) + ',' + number(segment.y1) + ' A' + radius + ',' + radius +
          ' 0 0,1 ' + number(right) + ',' + number(segment.y1) + '" fill="none" stroke="' + style.color +
          '" stroke-width="' + number(style.width) + '"' + routeAttributes(S, route) +
          ' data-marker="bridge"/>';
        cursor = right;
      });
      out += lineElement(S, route, style, cursor, segment.y1, end, segment.y1);
    } else {
      const start = Math.min(segment.y1, segment.y2);
      const end = Math.max(segment.y1, segment.y2);
      let cursor = start;
      events.forEach((marker) => {
        if (marker.renderKind === 'junction') {
          out += lineElement(S, route, style, segment.x1, cursor, segment.x1, marker.y);
          cursor = marker.y;
          return;
        }
        const top = Math.max(cursor, marker.y - radius);
        const bottom = Math.min(end, marker.y + radius);
        out += lineElement(S, route, style, segment.x1, cursor, segment.x1, top);
        out += '<path d="M' + number(segment.x1) + ',' + number(top) + ' A' + radius + ',' + radius +
          ' 0 0,1 ' + number(segment.x1) + ',' + number(bottom) + '" fill="none" stroke="' + style.color +
          '" stroke-width="' + number(style.width) + '"' + routeAttributes(S, route) +
          ' data-marker="bridge"/>';
        cursor = bottom;
      });
      out += lineElement(S, route, style, segment.x1, cursor, segment.x1, end);
    }
    return out;
  }

  function renderRoutes(S, ir) {
    let out = '<g id="EVSE-IR-ROUTES">';
    const eventsByRoute = indexRouteEvents(ir);
    (ir.routes || []).slice().sort((a, b) => compareText(a.id, b.id)).forEach((route) => {
      const style = layerStyle(route.layer, S.C);
      out += '<g id="ROUTE-' + attr(S, route.id) + '"' + routeAttributes(S, route) + '>';
      const routeEvents = eventsByRoute.get(route.id) || [];
      route.segments.forEach((segment) => { out += renderSegment(S, route, segment, style, routeEvents); });
      out += '</g>';
    });
    out += '</g>';
    return out;
  }

  function renderMarkers(S, ir) {
    let out = '<g id="EVSE-IR-MARKERS" data-layer="EVSE-MARKER">';
    const routeById = new Map((ir.routes || []).map((route) => [route.id, route]));
    (ir.markers || []).filter((marker) => marker.type === 'junction').forEach((marker) => {
      const route = routeById.get(marker.routeIds[0]);
      const style = layerStyle(route ? route.layer : '', S.C);
      out += '<circle cx="' + number(marker.x) + '" cy="' + number(marker.y) +
        '" r="2.3" fill="' + style.color + '" stroke="' + style.color + '" stroke-width="0.6"' +
        ' data-marker="junction" data-net="' + attr(S, marker.netId) +
        '" data-routes="' + attr(S, marker.routeIds.join(',')) + '"/>';
    });
    out += '</g>';
    return out;
  }

  function equipmentAttributes(S, primitive) {
    return ' data-primitive="' + attr(S, primitive.id) + '"' +
      ' data-equipment="' + attr(S, primitive.equipmentId) + '"' +
      (primitive.symbolId ? ' data-symbol="' + attr(S, primitive.symbolId) + '"' : '') +
      (primitive.symbolRole ? ' data-symbol-role="' + attr(S, primitive.symbolRole) + '"' : '') +
      (primitive.endpointRef ? ' data-endpoint="' + attr(S, primitive.endpointRef) + '"' : '') +
      (primitive.terminalId ? ' data-terminal="' + attr(S, primitive.terminalId) + '"' : '');
  }

  function primitivePaint(S, primitive) {
    const fill = primitive.fill === 'ink' ? S.C.ink : primitive.fill === 'paper' ? '#ffffff' :
      primitive.fill && primitive.fill !== 'none' ? primitive.fill : 'none';
    const stroke = primitive.stroke === 'none' || primitive.kind === 'text' ? 'none' :
      (primitive.stroke || S.C.ink);
    const width = primitive.strokeWidth == null ? 1.1 : primitive.strokeWidth;
    return ' fill="' + attr(S, fill) + '" stroke="' + attr(S, stroke) + '" stroke-width="' +
      number(width) + '" stroke-linecap="round" stroke-linejoin="round"' +
      (primitive.dash ? ' stroke-dasharray="' + attr(S, primitive.dash) + '"' : '');
  }

  function arcPath(primitive) {
    const startAngle = Number(primitive.startAngle) * Math.PI / 180;
    const endAngle = Number(primitive.endAngle) * Math.PI / 180;
    const delta = ((Number(primitive.endAngle) - Number(primitive.startAngle)) % 360 + 360) % 360;
    const startX = Number(primitive.x) + Number(primitive.radius) * Math.cos(startAngle);
    const startY = Number(primitive.y) + Number(primitive.radius) * Math.sin(startAngle);
    const endX = Number(primitive.x) + Number(primitive.radius) * Math.cos(endAngle);
    const endY = Number(primitive.y) + Number(primitive.radius) * Math.sin(endAngle);
    return 'M' + number(startX) + ',' + number(startY) + ' A' + number(primitive.radius) + ',' +
      number(primitive.radius) + ' 0 ' + (delta > 180 ? '1' : '0') + ',1 ' + number(endX) + ',' + number(endY);
  }

  function renderEquipmentPrimitive(S, primitive) {
    const kind = String(primitive.kind || '').toLowerCase();
    const trace = equipmentAttributes(S, primitive);
    const paint = primitivePaint(S, primitive);
    if (kind === 'line') {
      return '<line x1="' + number(primitive.x1) + '" y1="' + number(primitive.y1) +
        '" x2="' + number(primitive.x2) + '" y2="' + number(primitive.y2) + '"' + paint + trace + '/>';
    }
    if (kind === 'polyline') {
      const tag = primitive.closed ? 'polygon' : 'polyline';
      const points = (primitive.points || []).map((point) => number(point.x) + ',' + number(point.y)).join(' ');
      return '<' + tag + ' points="' + points + '"' + paint + trace + '/>';
    }
    if (kind === 'circle') {
      return '<circle cx="' + number(primitive.x) + '" cy="' + number(primitive.y) +
        '" r="' + number(primitive.radius) + '"' + paint + trace + '/>';
    }
    if (kind === 'arc') {
      return '<path d="' + arcPath(primitive) + '"' + paint + trace + '/>';
    }
    if (kind === 'rect') {
      return '<rect x="' + number(primitive.x) + '" y="' + number(primitive.y) +
        '" width="' + number(primitive.width) + '" height="' + number(primitive.height) + '"' +
        paint + trace + '/>';
    }
    if (kind === 'text') {
      const anchor = ['start', 'middle', 'end'].includes(primitive.anchor) ? primitive.anchor : 'middle';
      const rotation = Number(primitive.rotation || 0);
      return '<text x="' + number(primitive.x) + '" y="' + number(primitive.y) +
        '" font-family="Arial,Microsoft YaHei,sans-serif" font-size="' + number(primitive.height || 4) +
        '" font-weight="' + attr(S, primitive.weight || 'normal') + '" text-anchor="' + anchor +
        '" dominant-baseline="middle" fill="' + S.C.ink + '" stroke="none"' +
        (rotation ? ' transform="rotate(' + number(rotation) + ' ' + number(primitive.x) + ' ' + number(primitive.y) + ')"' : '') +
        trace + '>' + attr(S, primitive.text) + '</text>';
    }
    if (kind === 'port') {
      return '<circle cx="' + number(primitive.x) + '" cy="' + number(primitive.y) +
        '" r="1.55" fill="#ffffff" stroke="' + S.C.ink + '" stroke-width="0.8"' + trace + '/>';
    }
    throw new SvgIRRenderError('DRAWING_IR_PRIMITIVE_UNSUPPORTED',
      'Unsupported equipment primitive kind ' + kind + '.', { primitiveId: primitive.id, kind });
  }

  function renderDevice(S, device, primitives) {
    let out = '<g id="DEVICE-' + attr(S, device.id) + '" data-equipment="' + attr(S, device.id) +
      '" data-device-kind="' + attr(S, device.type) + '" data-symbol="' + attr(S, device.symbolId) +
      '" data-symbol-fallback="' + (device.symbolFallback ? 'true' : 'false') + '" data-layer="EVSE-EQPT">';
    primitives.forEach((primitive) => { out += renderEquipmentPrimitive(S, primitive); });
    return out + '</g>';
  }

  function renderDevices(S, ir) {
    const equipment = new Map();
    (ir.primitives || []).forEach((primitive) => {
      if (!primitive.equipmentId) return;
      const list = equipment.get(primitive.equipmentId) || [];
      list.push(primitive);
      equipment.set(primitive.equipmentId, list);
    });
    let out = '<g id="EVSE-IR-DEVICES">';
    (ir.devices || []).forEach((device) => {
      const primitives = (equipment.get(device.id) || []).slice().sort((a, b) => compareText(a.id, b.id));
      out += renderDevice(S, device, primitives);
    });
    return out + '</g>';
  }

  function renderAnnotations(S, ir) {
    let out = '<g id="EVSE-IR-ANNOTATIONS" data-layer="EVSE-ANNO">';
    (ir.annotations || []).slice().sort((a, b) => compareText(a.id, b.id)).forEach((primitive) => {
      out += renderEquipmentPrimitive(S, primitive);
    });
    return out + '</g>';
  }

  function instanceSpec(instance) {
    const values = [];
    if (instance.ratedCurrentA != null) values.push(instance.ratedCurrentA + 'A');
    if (instance.voltageV != null) values.push(instance.voltageV + 'V');
    if (instance.quantity != null && Number(instance.quantity) !== 1) values.push('×' + instance.quantity);
    if (instance.spec) values.push(String(instance.spec));
    const lifecycle = instance.definition && instance.definition.lifecycle;
    if (lifecycle) values.push(lifecycle);
    return values.join(' · ') || '受控实例 · 参数见 EDEM';
  }

  function scheduleRows(compiled) {
    const placement = typeof window !== 'undefined' && window.EVSE_SCHEMATIC_PLACEMENT;
    return (compiled.instances || []).map((instance) => ({
      tag: placement ? placement.shortTag(instance) : (instance.tag || instance.id),
      name: instance.name || instance.kind,
      spec: instanceSpec(instance)
    }));
  }

  function connectorSummary(compiled) {
    const connectors = (compiled.instances || []).filter((instance) => instance.kind === 'charge-connector');
    if (!connectors.length) return '';
    const pieces = [];
    connectors.forEach((connector) => {
      const labels = new Set((connector.terminals || connector.ports || []).map((terminal) => terminal.label || terminal.id));
      if (labels.has('CC1') && labels.has('CC2')) pieces.push('CC1/CC2→A1 · S+/S-→A1');
      else if (labels.has('CP')) {
        const cpTerminal = (connector.terminals || connector.ports || []).find((terminal) => (terminal.label || terminal.id) === 'CP');
        const circuit = (compiled.circuits || []).find((item) =>
          (item.from === connector.id && item.fromPort === cpTerminal.id) ||
          (item.to === connector.id && item.toPort === cpTerminal.id));
        const otherId = circuit && (circuit.from === connector.id ? circuit.to : circuit.from);
        const other = (compiled.instances || []).find((item) => item.id === otherId);
        const placement = typeof window !== 'undefined' && window.EVSE_SCHEMATIC_PLACEMENT;
        pieces.push('CP→' + (other ? (placement ? placement.shortTag(other) : other.id) : '控制器'));
      }
    });
    return Array.from(new Set(pieces)).join('；');
  }

  function rootAttribute(markup, name, value, S) {
    const index = markup.indexOf('>');
    if (index < 0) return markup;
    return markup.slice(0, index) + ' ' + name + '="' + attr(S, value) + '"' + markup.slice(index);
  }

  function render(compiled, result, options) {
    const rootObject = typeof window !== 'undefined' ? window :
      (typeof globalThis !== 'undefined' ? globalThis : null);
    const S = rootObject && rootObject.SYM;
    const IR = rootObject && rootObject.EVSE_DRAWING_IR;
    if (!S || !IR) throw new SvgIRRenderError('SVG_DEPENDENCY_MISSING', 'SYM and EVSE_DRAWING_IR must be loaded.');
    const ir = compiled && compiled.drawingIR;
    const plan = compiled && compiled.plan;
    if (!ir || !plan || ir.schema !== IR.SCHEMA) throw new SvgIRRenderError('INVALID_DRAWING_IR', 'A compiled EVSE Drawing IR is required.');
    IR.assertValidDrawingIR(ir);
    const design = result && result.design ? result.design : {};
    const requirements = design.requirements || {};
    const title = (options && options.title) || '充电桩电气原理图';
    const subtitle = [
      requirements.standardName || requirements.standard || '受控接口标准',
      requirements.outputKw != null ? requirements.outputKw + 'kW' : '',
      requirements.gunCount != null ? requirements.gunCount + ' 枪' : '',
      'EDEM ' + String(design.schemaVersion || ''),
      '图模覆盖 ' + (ir.coverage && ir.coverage.ok ? 'PASS' : 'BLOCKED')
    ].filter(Boolean).join(' | ');
    const rowsForSchedule = scheduleRows(compiled);
    const scheduleTop = plan.schedule.y + 20;
    /* Three wrapped specification lines are possible, so reserve the full
       deterministic worst-case row height before opening the selected viewBox. */
    const scheduleBottomEstimate = scheduleTop + 20 + rowsForSchedule.length * 32;
    const width = Math.max(1680, Math.ceil(plan.width));
    const height = Math.max(1188, Math.ceil(plan.height), Math.ceil(scheduleBottomEstimate + 340));
    const plannedSheet = plan.sheet || {
      format: 'CUSTOM', orientation: width >= height ? 'LANDSCAPE' : 'PORTRAIT',
      widthMm: Math.ceil(width / 4), heightMm: Math.ceil(height / 4), scale: '1:4'
    };
    const doc = S.documentMeta(result, 'ev-schematic', {
      designer: S.clip((result && result.inputs && result.inputs.designer) || '自动生成（待校核）', 9, 120),
      page: { current: 1, total: (compiled.sheets || []).length || 1 },
      scale: plannedSheet.scale || '1:4',
      sheet: {
        format: plannedSheet.format,
        orientation: plannedSheet.orientation,
        widthMm: plannedSheet.widthMm,
        heightMm: plannedSheet.heightMm
      }
    });
    let svg = S.svgOpen(width, height, title, subtitle, doc);
    svg = rootAttribute(svg, 'data-ir-schema', ir.schema, S);
    /* drawPile computes this hash immediately before this synchronous render.
       Reuse it for the same IR object; standalone callers still compute it. */
    const geometryHash = result && result.drawingIR === ir && result.drawingGeometryHash
      ? result.drawingGeometryHash : IR.drawingIRHash(ir);
    svg = rootAttribute(svg, 'data-geometry-hash', geometryHash, S);
    svg = rootAttribute(svg, 'data-coverage-status', ir.coverage && ir.coverage.ok ? 'PASS' : 'BLOCKED', S);
    svg = rootAttribute(svg, 'data-route-count', ir.routes.length, S);
    svg = rootAttribute(svg, 'data-alias-trace-count', (ir.aliasTraces || []).length, S);
    svg = rootAttribute(svg, 'data-sheet-format-actual', plannedSheet.format, S);
    svg = rootAttribute(svg, 'data-sheet-width-mm', plannedSheet.widthMm, S);
    svg = rootAttribute(svg, 'data-sheet-height-mm', plannedSheet.heightMm, S);
    svg = rootAttribute(svg, 'data-plot-scale', plannedSheet.scale || '1:4', S);
    svg = rootAttribute(svg, 'data-terminal-pitch-min', plan.readability && plan.readability.terminalPitchMin || '', S);
    svg = rootAttribute(svg, 'data-route-lane-pitch-min', plan.readability && plan.readability.routeLanePitchMin || '', S);
    svg += S.watermark(width, height, result && result.inputs && result.inputs.watermarkText || '方案草案');
    svg += '<g id="EVSE-DRAWING-IR" data-ir-schema="' + attr(S, ir.schema) + '">';
    svg += renderAliasTraces(S, ir);
    svg += renderAnnotations(S, ir);
    svg += renderRoutes(S, ir);
    svg += renderMarkers(S, ir);
    svg += renderDevices(S, ir);
    svg += '</g>';

    const scheduleX = plan.schedule.x;
    const scheduleWidth = plan.schedule.width;
    svg += S.schedule(rowsForSchedule, scheduleX, scheduleTop, scheduleWidth,
      '设备明细表（全部条目来自 EDEM instances）');
    const legendY = Math.max(scheduleBottomEstimate + 20, height - 300);
    svg += S.legend([
      { color: S.C.ac, thick: 2, label: 'POWER_AC 交流电源回路' },
      { color: S.C.dc, thick: 2, label: 'POWER_DC 充电直流回路（DC+/DC−）' },
      { color: S.C.ess, thick: 2, label: 'POWER_DC_ESS 储能直流回路' },
      { color: S.C.aux, thick: 1.6, label: 'POWER_DC_AUX 24V / 12V 辅助电源' },
      { color: S.C.ctl, label: 'SIGNAL_CTRL 控制/联锁/采样' },
      { color: S.C.comm, label: 'SIGNAL_COMM 通信' },
      { color: S.C.pe, thick: 2, label: 'PE 保护接地排 / 等电位连接' }
    ], scheduleX, legendY, scheduleWidth);
    const summary = connectorSummary(compiled);
    if (summary) svg += S.txt(40, height - 128, '充电接口点对点连接：' + summary, 7, S.C.ctl, 'start', 'bold');
    svg += S.txt(40, height - 114,
      '全部设备、网络、回路与端点来自 EDEM；坐标仅由确定性 placement/router 产生，AI 不生成或修改坐标。',
      7, S.C.anno, 'start');
    svg += S.txt(40, height - 102,
      '本图为方案级自动草图，短路、保护配合、EMC、温升、消防、并网及接口一致性仍须专业复核和试验。',
      7, S.C.anno, 'start');
    svg += '</svg>';
    return svg;
  }

  return Object.freeze({
    VERSION,
    SvgIRRenderError,
    render,
    renderDrawingIR: render
  });
});
