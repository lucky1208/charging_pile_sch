'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VISUAL = require('../engine/visual-quality-audit.js');

function codes(result) { return new Set(result.findings.map((finding) => finding.code)); }

function offPageRow(options) {
  const opts = Object.assign({ labelX: 25, labelY: 19.32, labelHeight: 4,
    label: '→p2 S02 EQ-CTL-A1:DI_OK', portY: 20, deviceId: 'OPB-1', portId: 'X01@C1@FROM' }, options || {});
  const direction = opts.direction || 'incoming';
  const prefix = 'DEVICE:' + opts.deviceId + ':';
  return {
    device: {
      id: opts.deviceId, type: 'off-page-connector-' + direction,
      bbox: { x: 0, y: 0, width: 120, height: 60 },
      ports: [{ id: opts.portId, terminalId: opts.terminalId || 'X01', circuitId: opts.circuitId || 'C1',
        netClass: 'SIGNAL_CTRL', x: 0, y: opts.portY, side: 'LEFT' }]
    },
    primitives: [
      { id: prefix + 'LEAD', kind: 'line', equipmentId: opts.deviceId,
        symbolRole: 'off-page-' + direction + '-lead', x1: 0, y1: opts.portY, x2: 20, y2: opts.portY,
        strokeWidth: 1.25 },
      { id: prefix + 'ARROW', kind: 'polyline', equipmentId: opts.deviceId,
        symbolRole: 'off-page-' + direction + '-arrow',
        points: [{ x: 20, y: opts.portY }, { x: 14.5, y: opts.portY - 3.5 },
          { x: 14.5, y: opts.portY + 3.5 }], strokeWidth: 1.15 },
      { id: prefix + 'TERMINAL', kind: 'circle', equipmentId: opts.deviceId,
        symbolRole: 'off-page-terminal', x: 0, y: opts.portY, radius: 1.25, strokeWidth: 0.9 },
      { id: prefix + 'LABEL', kind: 'text', equipmentId: opts.deviceId,
        symbolRole: 'terminal-label', x: opts.labelX, y: opts.labelY, text: opts.label,
        height: opts.labelHeight, anchor: 'start', strokeWidth: 0 }
    ]
  };
}

function offPageIr(rows) {
  const values = Array.isArray(rows) ? rows : [rows];
  return { devices: values.map((row) => row.device), primitives: values.flatMap((row) => row.primitives),
    annotations: [], routes: [] };
}

test('uses deterministic wide-character and rotated-anchor text extents', () => {
  assert.ok(VISUAL.estimateTextWidth('主功率', 10) > VISUAL.estimateTextWidth('POWER', 10));
  const start = VISUAL.textBounds({ x: 20, y: 20, text: 'AB', height: 10, anchor: 'start' });
  const end = VISUAL.textBounds({ x: 20, y: 20, text: 'AB', height: 10, anchor: 'end' });
  const rotated = VISUAL.textBounds({ x: 20, y: 20, text: 'ABCDE', height: 10, anchor: 'start', rotation: 90 });
  assert.ok(start.xMin < 20 && start.xMax > 20);
  assert.ok(end.xMin < 20 && end.xMax > 20);
  assert.ok((rotated.yMax - rotated.yMin) > (start.yMax - start.yMin));
});

test('reports title, cross-owner text, foreign device and route collisions without mutating IR', () => {
  const ir = {
    devices: [
      { id: 'D1', bbox: { x: 0, y: 0, width: 20, height: 20 } },
      { id: 'D2', bbox: { x: 40, y: 0, width: 20, height: 20 } }
    ],
    primitives: [
      { id: 'T1', kind: 'text', equipmentId: 'D1', x: 10, y: 10, text: 'OWN', height: 4 },
      { id: 'T2', kind: 'text', equipmentId: 'D2', x: 10, y: 10, text: 'OTHER', height: 4 }
    ],
    annotations: [
      { id: 'ZONE:TITLE', kind: 'text', annotationRole: 'functional-zone-title',
        placementStatus: 'CLEARANCE_NOT_PROVEN', x: 70, y: 10, text: 'ZONE', height: 6, anchor: 'start' },
      { id: 'NOTE', kind: 'text', annotationRole: 'drawing-note',
        x: 10, y: 30, text: 'NOTE', height: 5, anchor: 'middle' }
    ],
    routes: [{ id: 'R1', source: { deviceId: 'D1' }, target: { deviceId: 'D2' }, segments: [
      { id: 'R1:S0', x1: 0, y1: 30, x2: 20, y2: 30, orientation: 'horizontal' }
    ] }]
  };
  const snapshot = JSON.stringify(ir);
  const result = VISUAL.audit(ir);
  assert.equal(JSON.stringify(ir), snapshot);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), new Set([
    'VIS-002-TITLE-CLEARANCE-NOT-PROVEN',
    'VIS-003-TEXT-OVERLAP',
    'VIS-004-TEXT-DEVICE-COLLISION',
    'VIS-005-ROUTE-TEXT-COLLISION'
  ]));
  assert.deepEqual(result, VISUAL.audit(ir));
});

test('passes a clear drawing and ignores text belonging to its own device body', () => {
  const result = VISUAL.audit({
    devices: [{ id: 'D1', bbox: { x: 0, y: 0, width: 20, height: 20 } }],
    primitives: [{ id: 'T1', kind: 'text', equipmentId: 'D1',
      x: 10, y: 10, text: 'K1', height: 4 }],
    annotations: [{ id: 'Z1', kind: 'text', annotationRole: 'functional-zone-title',
      placementStatus: 'CLEARANCE_CHECKED', x: 30, y: 10, text: '控制', height: 6, anchor: 'start' }],
    routes: []
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.ok, true);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.method, 'DETERMINISTIC_APPROXIMATE_TEXT_EXTENTS');
});

test('off-page clearance audit blocks a PIN label on its own arrow or lead and is deterministic', () => {
  const row = offPageRow({ labelX: 18 });
  const ir = offPageIr(row);
  const snapshot = JSON.stringify(ir);
  const first = VISUAL.auditOffPageConnectorLabelClearance(ir);
  const second = VISUAL.auditOffPageConnectorLabelClearance(ir);

  assert.equal(JSON.stringify(ir), snapshot, 'audit must not mutate Drawing IR');
  assert.deepEqual(first, second);
  assert.equal(first.status, 'BLOCKED');
  assert.equal(first.ok, false);
  assert.ok(first.blockingCount > 0);
  assert.ok(codes(first).has('VIS-006-OFFPAGE-LABEL-SYMBOL-COLLISION'));
  assert.equal(first.findings.every((finding) => finding.severity === 'BLOCKING'), true);
});

test('off-page clearance boundary passes at 1.5 units and blocks below it', () => {
  /* The lead painted edge is x=20.625.  At x=22.125 the label has exactly
     1.5 units of clearance; the conservative expanded envelope only touches. */
  const exact = VISUAL.auditOffPageConnectorLabelClearance(offPageIr(offPageRow({ labelX: 22.125 })));
  const below = VISUAL.auditOffPageConnectorLabelClearance(offPageIr(offPageRow({ labelX: 22.124 })));
  assert.equal(exact.status, 'PASS');
  assert.equal(exact.minimumClearance, 1.5);
  assert.equal(below.status, 'BLOCKED');
  assert.ok(codes(below).has('VIS-006-OFFPAGE-LABEL-SYMBOL-COLLISION'));
});

test('off-page clearance audit checks all labels against all row glyphs and adjacent labels', () => {
  const deviceId = 'OPB-MIXED';
  const first = offPageRow({ deviceId, portId: 'X01@C1@FROM', portY: 20,
    labelX: 50, labelY: 18.3, labelHeight: 10, label: 'PIN-A' });
  const second = offPageRow({ deviceId, portId: 'X02@C2@FROM', terminalId: 'X02', circuitId: 'C2', portY: 30,
    labelX: 50, labelY: 28.3, labelHeight: 10, label: 'PIN-B' });
  const result = VISUAL.auditOffPageConnectorLabelClearance({
    devices: [{ id: deviceId, type: 'off-page-connector-incoming', bbox: first.device.bbox,
      ports: first.device.ports.concat(second.device.ports) }],
    primitives: first.primitives.concat(second.primitives.map((primitive) => Object.assign({}, primitive, {
      id: primitive.id.replace(/:(LEAD|ARROW|TERMINAL|LABEL)$/, ':ROW2:$1')
    }))), annotations: [], routes: []
  });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(codes(result).has('VIS-008-OFFPAGE-LABEL-OVERLAP'));
});

test('off-page clearance audit fails closed for missing, invalid and over-capacity symbol evidence', () => {
  const missing = offPageRow();
  missing.primitives = missing.primitives.filter((primitive) => primitive.symbolRole !== 'off-page-terminal');
  const missingResult = VISUAL.auditOffPageConnectorLabelClearance(offPageIr(missing));
  assert.equal(missingResult.status, 'BLOCKED');
  assert.ok(codes(missingResult).has('VIS-007-OFFPAGE-CLEARANCE-NOT-PROVEN'));

  const invalid = offPageRow();
  invalid.primitives.find((primitive) => primitive.symbolRole.endsWith('-lead')).x2 = NaN;
  const invalidResult = VISUAL.auditOffPageConnectorLabelClearance(offPageIr(invalid));
  assert.equal(invalidResult.status, 'BLOCKED');
  assert.ok(codes(invalidResult).has('VIS-007-OFFPAGE-CLEARANCE-NOT-PROVEN'));

  const capacityResult = VISUAL.auditOffPageConnectorLabelClearance(offPageIr(offPageRow()), {
    maximumConnectorPrimitives: 3
  });
  assert.equal(capacityResult.status, 'BLOCKED');
  assert.ok(codes(capacityResult).has('VIS-007-OFFPAGE-CLEARANCE-NOT-PROVEN'));
});

test('off-page clearance audit passes clean incoming/outgoing mirrors and ignores ordinary labels', () => {
  ['incoming', 'outgoing'].forEach((direction) => {
    const row = offPageRow({ direction, deviceId: 'OPB-' + direction.toUpperCase() });
    const result = VISUAL.auditOffPageConnectorLabelClearance(offPageIr(row));
    assert.equal(result.status, 'PASS', direction);
    assert.equal(result.blockingCount, 0, direction);
  });
  const ordinary = VISUAL.auditOffPageConnectorLabelClearance({
    devices: [{ id: 'K1', type: 'relay', ports: [] }],
    primitives: [{ id: 'K1:T', kind: 'text', equipmentId: 'K1', symbolRole: 'terminal-label',
      x: 10, y: 10, text: 'A1', height: 4 }], annotations: [], routes: []
  });
  assert.equal(ordinary.status, 'PASS');
});
