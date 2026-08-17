/* ============================================================
 * EVSE SVG → DXF concept exporter
 * ------------------------------------------------------------
 * Creates an editable R2010 DXF concept sketch from the SVG preview.
 * It exports only primitive geometry and the EVSE CAD layer manifest.
 * This is intentionally not a DWG replacement, a construction drawing,
 * a protection study, or a compliance/certification artefact.
 * ============================================================ */
window.EVSE_DXF = (function () {
  'use strict';

  const FALLBACK_LAYER_MANIFEST = [
    { name: 'EVSE-FRAME', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.50, purpose: '图框、标题栏、修订栏' },
    { name: 'EVSE-TEXT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '标题、说明、位号' },
    { name: 'EVSE-ANNO', color: 8, linetype: 'CONTINUOUS', lineweightMm: 0.18, purpose: '待核说明、参考注释' },
    { name: 'EVSE-EQPT', color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '通用设备外形与符号' },
    { name: 'EVSE-AC', color: 5, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '交流主回路' },
    { name: 'EVSE-DC', color: 1, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '充电直流主回路' },
    { name: 'EVSE-ESS', color: 30, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '储能直流回路' },
    { name: 'EVSE-AUX', color: 4, linetype: 'CONTINUOUS', lineweightMm: 0.25, purpose: '辅助直流电源 24V/12V' },
    { name: 'EVSE-CTL', color: 8, linetype: 'DASHED', lineweightMm: 0.18, purpose: '控制、联锁与采样信号' },
    { name: 'EVSE-COMM', color: 6, linetype: 'DASHED', lineweightMm: 0.18, purpose: '通信总线与后台链路' },
    { name: 'EVSE-PE', color: 3, linetype: 'CONTINUOUS', lineweightMm: 0.35, purpose: '保护接地与等电位' }
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
    if (color === '#b45309') return 'EVSE-ESS';
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
    return out + pairs(0, 'ENDTAB', 0, 'ENDSEC');
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
    const warnings = ['DXF 仅为方案级可编辑草图；不得替代施工图、计算书、设备数据表或专业签发。'];
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
      schema: 'EVSE-DXF-MANIFEST/1.0', output: 'DXF_R2010_CONCEPT', units: 'mm', paperMm: [paperW, paperH], document: documentControl,
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

  return { exportSvg, fromSvg: exportSvg, layerManifest: () => cloneManifest(FALLBACK_LAYER_MANIFEST), MANIFEST_SCHEMA: 'EVSE-DXF-MANIFEST/1.0' };
})();
