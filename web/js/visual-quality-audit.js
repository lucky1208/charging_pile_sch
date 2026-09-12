/* ============================================================
 * Renderer-neutral schematic visual-quality audit
 * ------------------------------------------------------------
 * This module estimates text extents from the Drawing IR before export.
 * It never mutates SVG/DOM geometry.  General text findings remain REVIEW
 * because browser/CAD font metrics can differ.  The IEC 61082 off-page
 * connector contract uses its own conservative, fail-closed blocking audit.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_VISUAL_QUALITY_AUDIT = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.1.0';
  const EPSILON = 1e-7;
  const DEFAULTS = Object.freeze({
    asciiWidthFactor: 0.58,
    wideWidthFactor: 1,
    whitespaceWidthFactor: 0.35,
    verticalFactor: 0.68,
    padding: 0.6,
    maximumTextItems: 5000,
    maximumSegments: 30000
  });
  const OFF_PAGE_DEFAULTS = Object.freeze({
    minimumClearance: 1.5,
    rowAssociationTolerance: 4,
    maximumConnectorDevices: 1000,
    maximumConnectorPorts: 10000,
    maximumConnectorPrimitives: 50000
  });
  const OFF_PAGE_DEVICE_KIND = /^off-page-connector-(incoming|outgoing)$/;
  const OFF_PAGE_LEAD_OR_ARROW_ROLE = /^off-page-(incoming|outgoing)-(lead|arrow)$/;

  function text(value) { return String(value == null ? '' : value); }
  function compare(left, right) {
    const a = text(left); const b = text(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function isWideCharacter(character) {
    const code = character.codePointAt(0);
    return code >= 0x1100 && (
      code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    );
  }
  function estimateTextWidth(value, height, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const size = Math.max(0, finite(height, 0));
    return Array.from(text(value)).reduce((sum, character) => {
      if (/\s/u.test(character)) return sum + size * opts.whitespaceWidthFactor;
      return sum + size * (isWideCharacter(character) ? opts.wideWidthFactor : opts.asciiWidthFactor);
    }, 0);
  }
  function rotatePoint(point, origin, radians) {
    const cosine = Math.cos(radians); const sine = Math.sin(radians);
    const dx = point.x - origin.x; const dy = point.y - origin.y;
    return { x: origin.x + dx * cosine - dy * sine, y: origin.y + dx * sine + dy * cosine };
  }
  function textBounds(item, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const height = finite(item && item.height, 0);
    const x = finite(item && item.x, NaN); const y = finite(item && item.y, NaN);
    if (!(height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const width = estimateTextWidth(item.text, height, opts);
    const anchor = ['start', 'middle', 'end'].includes(item.anchor) ? item.anchor : 'middle';
    const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
    const halfHeight = height * opts.verticalFactor;
    const corners = [
      { x: left, y: y - halfHeight }, { x: left + width, y: y - halfHeight },
      { x: left + width, y: y + halfHeight }, { x: left, y: y + halfHeight }
    ];
    const radians = finite(item.rotation, 0) * Math.PI / 180;
    const rotated = Math.abs(radians) > EPSILON
      ? corners.map((point) => rotatePoint(point, { x, y }, radians)) : corners;
    const xs = rotated.map((point) => point.x); const ys = rotated.map((point) => point.y);
    return Object.freeze({
      xMin: Math.min.apply(null, xs) - opts.padding,
      yMin: Math.min.apply(null, ys) - opts.padding,
      xMax: Math.max.apply(null, xs) + opts.padding,
      yMax: Math.max.apply(null, ys) + opts.padding
    });
  }
  function boxesOverlap(left, right) {
    return left.xMin < right.xMax - EPSILON && left.xMax > right.xMin + EPSILON &&
      left.yMin < right.yMax - EPSILON && left.yMax > right.yMin + EPSILON;
  }
  function segmentIntersectsBox(segment, box) {
    const x1 = finite(segment && segment.x1, NaN); const y1 = finite(segment && segment.y1, NaN);
    const x2 = finite(segment && segment.x2, NaN); const y2 = finite(segment && segment.y2, NaN);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
    if (Math.abs(y1 - y2) <= EPSILON) {
      return y1 > box.yMin + EPSILON && y1 < box.yMax - EPSILON &&
        Math.max(x1, x2) > box.xMin + EPSILON && Math.min(x1, x2) < box.xMax - EPSILON;
    }
    if (Math.abs(x1 - x2) <= EPSILON) {
      return x1 > box.xMin + EPSILON && x1 < box.xMax - EPSILON &&
        Math.max(y1, y2) > box.yMin + EPSILON && Math.min(y1, y2) < box.yMax - EPSILON;
    }
    /* Drawing IR routes are orthogonal.  A non-orthogonal segment is itself
       unexpected, but use a conservative segment bounding box here. */
    return boxesOverlap({ xMin: Math.min(x1, x2), yMin: Math.min(y1, y2),
      xMax: Math.max(x1, x2), yMax: Math.max(y1, y2) }, box);
  }
  function primitiveCenterY(primitive) {
    const value = primitive || {};
    if (value.kind === 'line') {
      const y1 = Number(value.y1); const y2 = Number(value.y2);
      return Number.isFinite(y1) && Number.isFinite(y2) ? (y1 + y2) / 2 : NaN;
    }
    if (value.kind === 'polyline') {
      const points = Array.isArray(value.points) ? value.points : [];
      const ys = points.map((point) => Number(point && point.y));
      return ys.length >= 2 && ys.every(Number.isFinite)
        ? ys.reduce((sum, y) => sum + y, 0) / ys.length : NaN;
    }
    if (value.kind === 'circle' || value.kind === 'text') return Number(value.y);
    return NaN;
  }
  function paintedPrimitiveBounds(primitive, minimumClearance) {
    const value = primitive || {};
    const strokeWidth = Number(value.strokeWidth == null ? 1.15 : value.strokeWidth);
    const clearance = Number(minimumClearance);
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0 || !Number.isFinite(clearance) || clearance < 0) return null;
    const padding = strokeWidth / 2 + clearance;
    let xs = []; let ys = [];
    if (value.kind === 'line') {
      xs = [Number(value.x1), Number(value.x2)];
      ys = [Number(value.y1), Number(value.y2)];
    } else if (value.kind === 'polyline') {
      const points = Array.isArray(value.points) ? value.points : [];
      if (points.length < 2) return null;
      xs = points.map((point) => Number(point && point.x));
      ys = points.map((point) => Number(point && point.y));
    } else if (value.kind === 'circle') {
      const x = Number(value.x); const y = Number(value.y); const radius = Number(value.radius);
      if (![x, y, radius].every(Number.isFinite) || radius < 0) return null;
      xs = [x - radius, x + radius]; ys = [y - radius, y + radius];
    } else return null;
    if (!xs.length || !xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return null;
    return Object.freeze({
      xMin: Math.min.apply(null, xs) - padding,
      yMin: Math.min.apply(null, ys) - padding,
      xMax: Math.max.apply(null, xs) + padding,
      yMax: Math.max.apply(null, ys) + padding
    });
  }
  function issueKey(issue) {
    return [issue.code, issue.textId || '', issue.otherTextId || '', issue.deviceId || '',
      issue.routeId || '', issue.segmentId || ''].join('|');
  }
  function freezeIssue(value) {
    const result = Object.assign({}, value, { severity: 'REVIEW' });
    if (result.bounds) result.bounds = Object.freeze(Object.assign({}, result.bounds));
    return Object.freeze(result);
  }

  function freezeOffPageIssue(value) {
    const result = Object.assign({}, value, { severity: 'BLOCKING' });
    ['glyphIds', 'glyphRoles', 'textIds'].forEach((key) => {
      if (Array.isArray(result[key])) result[key] = Object.freeze(result[key].slice());
    });
    ['textBounds', 'glyphBounds'].forEach((key) => {
      if (result[key] && typeof result[key] === 'object') {
        result[key] = Object.freeze(Object.assign({}, result[key]));
      }
    });
    return Object.freeze(result);
  }

  function offPageIssueKey(issue) {
    return [issue.code, issue.deviceId || '', issue.portId || '', issue.textId || '',
      issue.otherTextId || '', (issue.glyphIds || []).join(','), issue.role || '', issue.detail || ''].join('|');
  }

  function offPageRoleKey(primitive, expectedDirection) {
    const role = text(primitive && primitive.symbolRole);
    if (primitive && primitive.kind === 'text' && role === 'terminal-label') return 'label';
    if (role === 'off-page-terminal') return 'terminal';
    const match = OFF_PAGE_LEAD_OR_ARROW_ROLE.exec(role);
    if (!match || match[1] !== expectedDirection) return '';
    return match[2];
  }

  function expandBox(box, amount) {
    const value = Number(amount);
    return { xMin: box.xMin - value, yMin: box.yMin - value,
      xMax: box.xMax + value, yMax: box.yMax + value };
  }

  /* Cross-sheet continuation labels are part of a controlled IEC 61082
     projection symbol. Unlike the general visual audit below, clearance for
     these labels is a delivery invariant: every row must be complete and its
     label must remain clear of the arrow, short lead and terminal marker.
     The conservative envelope makes an inability to prove clearance a
     blocking result rather than silently accepting the drawing. */
  function auditOffPageConnectorLabelClearance(drawingIR, options) {
    const opts = Object.assign({}, DEFAULTS, OFF_PAGE_DEFAULTS, options || {});
    const minimumClearance = Number(opts.minimumClearance);
    const associationTolerance = Number(opts.rowAssociationTolerance);
    const ir = drawingIR || {};
    const devicesValid = Array.isArray(ir.devices);
    const primitivesValid = Array.isArray(ir.primitives);
    const devices = devicesValid ? ir.devices : [];
    const primitives = primitivesValid ? ir.primitives : [];
    const connectorDevices = devices.filter((device) => OFF_PAGE_DEVICE_KIND.test(text(device && device.type)))
      .slice().sort((left, right) => compare(left && left.id, right && right.id));
    const connectorIds = new Set(connectorDevices.map((device) => text(device && device.id)));
    const relevantPrimitives = primitives.filter((primitive) => {
      const role = text(primitive && primitive.symbolRole);
      return role === 'terminal-label' || role === 'off-page-terminal' || OFF_PAGE_LEAD_OR_ARROW_ROLE.test(role);
    });
    const connectorPrimitives = relevantPrimitives.filter((primitive) =>
      connectorIds.has(text(primitive && primitive.equipmentId)));
    const connectorPortCount = connectorDevices.reduce((sum, device) =>
      sum + (Array.isArray(device && device.ports) ? device.ports.length : 0), 0);
    const findings = [];
    function add(value) { findings.push(freezeOffPageIssue(value)); }
    function notProven(value) {
      add(Object.assign({ code: 'VIS-007-OFFPAGE-CLEARANCE-NOT-PROVEN',
        detail: 'Off-page connector label clearance could not be proven.' }, value || {}));
    }

    if (!devicesValid || !primitivesValid || !Number.isFinite(minimumClearance) || minimumClearance < 0 ||
        !Number.isFinite(associationTolerance) || associationTolerance < 0) {
      notProven({ detail: 'Drawing IR collections or off-page audit options are invalid.' });
    }
    const deviceLimit = Math.max(0, finite(opts.maximumConnectorDevices, OFF_PAGE_DEFAULTS.maximumConnectorDevices));
    const portLimit = Math.max(0, finite(opts.maximumConnectorPorts, OFF_PAGE_DEFAULTS.maximumConnectorPorts));
    const primitiveLimit = Math.max(0, finite(opts.maximumConnectorPrimitives, OFF_PAGE_DEFAULTS.maximumConnectorPrimitives));
    const capacityExceeded = connectorDevices.length > deviceLimit || connectorPortCount > portLimit ||
      connectorPrimitives.length > primitiveLimit;
    if (capacityExceeded) {
      notProven({ detail: 'Off-page connector clearance audit capacity was exceeded.',
        connectorDeviceCount: connectorDevices.length, connectorPortCount,
        connectorPrimitiveCount: connectorPrimitives.length });
    }

    relevantPrimitives.filter((primitive) =>
      !connectorIds.has(text(primitive && primitive.equipmentId)) &&
      (text(primitive && primitive.symbolRole) === 'off-page-terminal' ||
        OFF_PAGE_LEAD_OR_ARROW_ROLE.test(text(primitive && primitive.symbolRole))))
      .sort((left, right) => compare(left && left.id, right && right.id))
      .forEach((primitive) => notProven({
        detail: 'An off-page glyph is not owned by a declared off-page connector device.',
        glyphIds: [text(primitive && primitive.id) || 'UNKNOWN']
      }));

    if (!capacityExceeded) connectorDevices.forEach((device) => {
      const deviceId = text(device && device.id);
      const kindMatch = OFF_PAGE_DEVICE_KIND.exec(text(device && device.type));
      const direction = kindMatch && kindMatch[1];
      const ports = Array.isArray(device && device.ports) ? device.ports.slice()
        .sort((left, right) => finite(left && left.y, 0) - finite(right && right.y, 0) ||
          compare(left && left.id, right && right.id)) : [];
      if (!deviceId || !direction || !ports.length) {
        notProven({ deviceId: deviceId || 'UNKNOWN',
          detail: 'Off-page connector device has no auditable id, direction or ports.' });
        return;
      }
      const duplicatePortIds = ports.map((port) => text(port && port.id)).filter((id, index, values) =>
        !id || values.indexOf(id) !== index);
      const invalidPorts = ports.filter((port) => !Number.isFinite(Number(port && port.y)));
      if (duplicatePortIds.length || invalidPorts.length) {
        notProven({ deviceId, detail: 'Off-page connector ports have duplicate ids or invalid row coordinates.' });
        return;
      }
      const rows = new Map(ports.map((port) => [text(port.id), {
        port, label: [], arrow: [], lead: [], terminal: []
      }]));
      const devicePrimitives = connectorPrimitives.filter((primitive) =>
        text(primitive && primitive.equipmentId) === deviceId)
        .slice().sort((left, right) => compare(left && left.id, right && right.id));
      const records = [];

      devicePrimitives.forEach((primitive) => {
        const primitiveId = text(primitive && primitive.id);
        const role = text(primitive && primitive.symbolRole);
        const key = offPageRoleKey(primitive, direction);
        if (!primitiveId || !key) {
          notProven({ deviceId, glyphIds: primitiveId ? [primitiveId] : [], role,
            detail: key ? 'Off-page connector primitive has no traceable id.' :
              'Off-page connector contains a wrong-direction or unsupported row primitive.' });
          return;
        }
        const y = primitiveCenterY(primitive);
        if (!Number.isFinite(y)) {
          notProven({ deviceId, glyphIds: [primitiveId], role,
            detail: 'Off-page connector row primitive has invalid geometry.' });
          return;
        }
        const candidates = ports.map((port) => ({ port, distance: Math.abs(Number(port.y) - y) }))
          .sort((left, right) => left.distance - right.distance || compare(left.port.id, right.port.id));
        const nearest = candidates[0];
        const ambiguous = candidates[1] && Math.abs(nearest.distance - candidates[1].distance) <= EPSILON;
        if (!nearest || nearest.distance > associationTolerance + EPSILON || ambiguous) {
          notProven({ deviceId, glyphIds: [primitiveId], role,
            detail: 'Off-page connector row primitive cannot be associated with exactly one port.' });
          return;
        }
        rows.get(text(nearest.port.id))[key].push(primitive);
        records.push({ primitive, key, port: nearest.port });
      });

      rows.forEach((row, portId) => ['label', 'arrow', 'lead', 'terminal'].forEach((role) => {
        if (row[role].length !== 1) notProven({ deviceId, portId,
          role, detail: 'Every off-page connector port requires exactly one label, arrow, lead and terminal marker.',
          glyphIds: row[role].map((primitive) => text(primitive.id)).filter(Boolean) });
      }));

      const labels = records.filter((record) => record.key === 'label').map((record) => {
        const bounds = textBounds(record.primitive, Object.assign({}, opts, { padding: 0 }));
        if (!bounds || !text(record.primitive.text).trim()) notProven({ deviceId,
          portId: text(record.port.id), textId: text(record.primitive.id),
          detail: 'Off-page connector label has empty or invalid text geometry.' });
        return Object.assign({}, record, { bounds });
      }).filter((record) => record.bounds && text(record.primitive.text).trim());
      const glyphs = records.filter((record) => record.key !== 'label').map((record) => {
        const bounds = paintedPrimitiveBounds(record.primitive, minimumClearance);
        if (!bounds) notProven({ deviceId, portId: text(record.port.id), glyphIds: [text(record.primitive.id)],
          role: record.key, detail: 'Off-page connector glyph has invalid painted geometry.' });
        return Object.assign({}, record, { bounds });
      }).filter((record) => record.bounds);

      labels.forEach((label) => {
        const collisions = glyphs.filter((glyph) => boxesOverlap(label.bounds, glyph.bounds));
        if (!collisions.length) return;
        add({ code: 'VIS-006-OFFPAGE-LABEL-SYMBOL-COLLISION', deviceId,
          portId: text(label.port.id), terminalId: text(label.port.terminalId),
          circuitId: text(label.port.circuitId), netClass: text(label.port.netClass),
          textId: text(label.primitive.id), textBounds: label.bounds,
          glyphIds: collisions.map((glyph) => text(glyph.primitive.id)),
          glyphRoles: collisions.map((glyph) => text(glyph.primitive.symbolRole)),
          detail: 'Off-page connector property text overlaps the required clearance envelope of its symbol.' });
      });
      for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex += 1) {
          const left = labels[leftIndex]; const right = labels[rightIndex];
          if (!boxesOverlap(expandBox(left.bounds, minimumClearance / 2),
              expandBox(right.bounds, minimumClearance / 2))) continue;
          add({ code: 'VIS-008-OFFPAGE-LABEL-OVERLAP', deviceId,
            portId: text(left.port.id), textId: text(left.primitive.id),
            otherTextId: text(right.primitive.id), textIds: [text(left.primitive.id), text(right.primitive.id)],
            detail: 'Off-page connector property labels overlap or violate their minimum mutual clearance.' });
        }
      }
    });

    const seen = new Set();
    const uniqueFindings = findings.slice().sort((left, right) => compare(offPageIssueKey(left), offPageIssueKey(right)))
      .filter((finding) => {
        const key = offPageIssueKey(finding);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    return Object.freeze({
      version: VERSION,
      status: uniqueFindings.length ? 'BLOCKED' : 'PASS',
      ok: uniqueFindings.length === 0,
      blockingCount: uniqueFindings.length,
      findings: Object.freeze(uniqueFindings),
      stats: Object.freeze({ connectorDeviceCount: connectorDevices.length,
        connectorPortCount, connectorPrimitiveCount: connectorPrimitives.length }),
      minimumClearance,
      method: 'DETERMINISTIC_CONSERVATIVE_CLEARANCE_ENVELOPE'
    });
  }

  function audit(drawingIR, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const ir = drawingIR || {};
    const annotations = Array.isArray(ir.annotations) ? ir.annotations : [];
    const equipmentText = (Array.isArray(ir.primitives) ? ir.primitives : []).filter((primitive) =>
      primitive && primitive.kind === 'text' && primitive.equipmentId);
    const annotationText = annotations.filter((annotation) => annotation && annotation.kind === 'text');
    const textItems = equipmentText.concat(annotationText).map((item) => ({
      id: text(item.id), ownerId: text(item.equipmentId),
      role: text(item.annotationRole || (item.equipmentId ? 'equipment-text' : 'drawing-note')),
      item, bounds: textBounds(item, opts)
    })).sort((left, right) => compare(left.id, right.id));
    const routes = (Array.isArray(ir.routes) ? ir.routes : []).slice()
      .sort((left, right) => compare(left && left.id, right && right.id));
    const devices = (Array.isArray(ir.devices) ? ir.devices : []).slice()
      .sort((left, right) => compare(left && left.id, right && right.id));
    const segments = routes.flatMap((route) => (Array.isArray(route && route.segments) ? route.segments : [])
      .map((segment) => ({ route, segment })));
    const findings = [];
    function add(value) { findings.push(freezeIssue(value)); }

    if (textItems.length > opts.maximumTextItems || segments.length > opts.maximumSegments) {
      add({ code: 'VIS-000-AUDIT-CAPACITY', detail: 'Visual audit capacity exceeded.',
        textCount: textItems.length, segmentCount: segments.length });
    } else {
      textItems.forEach((entry) => {
        if (!entry.id || !entry.bounds) add({ code: 'VIS-001-TEXT-GEOMETRY', textId: entry.id || 'UNKNOWN',
          detail: 'Text has an invalid id, anchor, size or coordinate.' });
        if (entry.role === 'functional-zone-title' && entry.item.placementStatus !== 'CLEARANCE_CHECKED') {
          add({ code: 'VIS-002-TITLE-CLEARANCE-NOT-PROVEN', textId: entry.id,
            detail: 'Functional-zone title placement was not proven clear of routes and equipment.' });
        }
      });
      for (let leftIndex = 0; leftIndex < textItems.length; leftIndex += 1) {
        const left = textItems[leftIndex];
        if (!left.bounds) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < textItems.length; rightIndex += 1) {
          const right = textItems[rightIndex];
          if (!right.bounds || (left.ownerId && left.ownerId === right.ownerId)) continue;
          if (boxesOverlap(left.bounds, right.bounds)) add({ code: 'VIS-003-TEXT-OVERLAP',
            textId: left.id, otherTextId: right.id,
            detail: 'Text extents overlap across distinct drawing owners.' });
        }
      }
      textItems.forEach((entry) => {
        if (!entry.bounds) return;
        devices.forEach((device) => {
          const bbox = device && device.bbox;
          if (!bbox || entry.ownerId === text(device.id)) return;
          const deviceBounds = {
            xMin: finite(bbox.xMin, finite(bbox.x, NaN)),
            yMin: finite(bbox.yMin, finite(bbox.y, NaN)),
            xMax: finite(bbox.xMax, finite(bbox.x, NaN) + finite(bbox.width, NaN)),
            yMax: finite(bbox.yMax, finite(bbox.y, NaN) + finite(bbox.height, NaN))
          };
          if (Object.values(deviceBounds).every(Number.isFinite) && boxesOverlap(entry.bounds, deviceBounds)) {
            add({ code: 'VIS-004-TEXT-DEVICE-COLLISION', textId: entry.id,
              deviceId: text(device.id), bounds: entry.bounds,
              detail: 'Text crosses the body of a different device.' });
          }
        });
        segments.forEach(({ route, segment }) => {
          if (entry.ownerId && (text(route.source && route.source.deviceId) === entry.ownerId ||
              text(route.target && route.target.deviceId) === entry.ownerId)) return;
          if (segmentIntersectsBox(segment, entry.bounds)) add({ code: 'VIS-005-ROUTE-TEXT-COLLISION',
            textId: entry.id, routeId: text(route.id), segmentId: text(segment.id),
            bounds: entry.bounds, detail: 'A conductor crosses the estimated text extent.' });
        });
      });
    }

    const seen = new Set();
    const uniqueFindings = findings.sort((left, right) => compare(issueKey(left), issueKey(right)))
      .filter((finding) => {
        const key = issueKey(finding);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    const status = uniqueFindings.length ? 'REVIEW_REQUIRED' : 'PASS';
    return Object.freeze({
      version: VERSION,
      status,
      ok: status === 'PASS',
      reviewCount: uniqueFindings.length,
      findings: Object.freeze(uniqueFindings),
      stats: Object.freeze({ textCount: textItems.length, deviceCount: devices.length, segmentCount: segments.length }),
      method: 'DETERMINISTIC_APPROXIMATE_TEXT_EXTENTS',
      limitation: 'Text extents are conservative estimates, not browser/CAD font-shaping metrics.'
    });
  }

  return Object.freeze({ VERSION, DEFAULTS, OFF_PAGE_DEFAULTS, estimateTextWidth, textBounds, boxesOverlap,
    segmentIntersectsBox, paintedPrimitiveBounds, auditOffPageConnectorLabelClearance, audit });
});
