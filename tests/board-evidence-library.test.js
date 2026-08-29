'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EVIDENCE = require('../engine/evidence-library.js');
const SYMBOLS = require('../engine/board-symbol-catalog.js');
const CIRCUITS = require('../engine/board-circuit-library.js');
const REFERENCES = require('../engine/reference-system-library.js');
const QUALITY = require('../engine/schematic-quality-rules.js');

test('user project evidence is hash-pinned and page-indexed', () => {
  const summary = EVIDENCE.summary();
  assert.equal(summary.sourceCount, 3);
  assert.equal(summary.vendorSectionCount, 13);
  assert.equal(summary.functionalFamilyCount, 7);
  assert.equal(summary.observedTopologyCount, 32);
  assert.equal(EVIDENCE.source('SRC-COMPARISON-DOCX').pageCount, 79);
  assert.equal(EVIDENCE.verifySource('SRC-COMPARISON-DOCX',
    'F99678A250D165B760546F400B43C60F8F54C754D5C845A5B4EC12BF0C612D50'), true);
  assert.ok(EVIDENCE.CLAIMS.every((claim) => claim.sourceId && claim.pages.length === 2));
});

test('external real project SVGs match the evidence hashes when supplied locally', (t) => {
  const root = path.resolve(__dirname, '..');
  const sourceNames = ['欧标充电桩电气原理图.svg', '国标60kW充电桩原理图.svg'];
  const sourcePaths = sourceNames.map((name) => path.join(root, 'sch_lib', name));
  if (!sourcePaths.every((filePath) => fs.existsSync(filePath))) {
    t.skip('customer project drawings are external evidence and are not bundled in the public repository');
    return;
  }
  const hash = (name) => crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'sch_lib', name))).digest('hex').toUpperCase();
  assert.equal(hash('欧标充电桩电气原理图.svg'), EVIDENCE.source('SRC-EU-PROJECT-SVG').sha256);
  assert.equal(hash('国标60kW充电桩原理图.svg'), EVIDENCE.source('SRC-GB60-PROJECT-SVG').sha256);
});

test('board catalog reconstructs all observed elementary symbols as native pin-aware vectors', () => {
  assert.equal(SYMBOLS.ids.length, 29);
  SYMBOLS.ids.forEach((id) => {
    const symbol = SYMBOLS.instantiate({ symbolId: id, x: 0, y: 0, width: 100, height: 70 });
    assert.equal(symbol.symbolId, id);
    assert.ok(symbol.primitives.length >= 2, id);
    assert.ok(symbol.primitives.every((item) => ['line', 'polyline', 'circle', 'rect', 'arc', 'text'].includes(item.kind)), id);
    assert.ok(symbol.pins.every((pin) => pin.id && Number.isFinite(pin.x) && Number.isFinite(pin.y)), id);
    assert.equal(SYMBOLS.auditPinGeometry(symbol).ok, true, id + ' has a detached PIN anchor');
    assert.doesNotMatch(SYMBOLS.svgPreview(id), /(?:base64|<image\b|href=)/i, id);
  });
  assert.deepEqual(SYMBOLS.resolve('opamp').pins.map((pin) => pin.id), ['OUT', '-', '+', 'V-', 'V+']);
  assert.deepEqual(SYMBOLS.resolve('optocoupler').pins.map((pin) => pin.id), ['A', 'K', 'E', 'C']);
  const resistor = SYMBOLS.instantiate({ symbolId: 'resistor', x: 0, y: 0, width: 80, height: 50 });
  assert.ok(resistor.primitives.some((item) => item.kind === 'rect' && item.symbolRole === 'resistor-body'));
  const bridge = SYMBOLS.instantiate({ symbolId: 'bridge-rectifier', x: 0, y: 0, width: 80, height: 50 });
  const bridgePins = Object.fromEntries(bridge.pins.map((item) => [item.id, item]));
  assert.equal(bridgePins.AC1.side, 'LEFT'); assert.equal(bridgePins.AC2.side, 'RIGHT');
  assert.equal(bridgePins['+'].side, 'TOP'); assert.equal(bridgePins['-'].side, 'BOTTOM');
  const opto = SYMBOLS.instantiate({ symbolId: 'optocoupler', x: 0, y: 0, width: 80, height: 50 });
  const optoPins = Object.fromEntries(opto.pins.map((item) => [item.id, item]));
  assert.ok(optoPins.C.y < optoPins.E.y, 'collector must be above emitter in the rendered optocoupler');
  assert.equal(SYMBOLS.resolve('tvs').polarityIndependent, true);
});

test('detailed functional units contain only valid explicit component-pin endpoints', () => {
  const summary = CIRCUITS.summary();
  assert.equal(summary.familyCount, 7);
  assert.equal(summary.variantCount, 32);
  assert.equal(summary.detailedTemplateCount, 7);
  assert.equal(summary.explicitPointToPointCircuitCount, 108);
  assert.equal(summary.validation.ok, true);
  Object.values(CIRCUITS.TEMPLATES).forEach((template) => {
    assert.equal(CIRCUITS.validateTemplate(template).ok, true, template.id);
    assert.equal(template.automaticSelectionAllowed, false, template.id);
    assert.equal(template.fixedValuesApproved, false, template.id);
    assert.ok(template.sourceRefs[0].pages.length === 2, template.id);
    assert.ok(template.circuits.every((wire) => /^[^:]+:[^:]+$/.test(wire.from) && /^[^:]+:[^:]+$/.test(wire.to)), template.id);
  });
});

test('required logical pins cannot disappear behind a valid symbol or partial package map', () => {
  const source = CIRCUITS.findTemplate('DIODE-DETECT-DUAL-OPAMP');
  const missingSupply = Object.assign({}, source, {
    circuits: source.circuits.filter((wire) => wire.id !== 'W16')
  });
  const invalid = CIRCUITS.validateTemplate(missingSupply);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((item) => item.code === 'REQUIRED_LOGICAL_PIN_UNCONNECTED' &&
    item.componentId === 'U1A' && item.logical === 'V+'));

  const explicitNc = Object.assign({}, missingSupply, {
    components: missingSupply.components.map((item) => item.id === 'U1A'
      ? Object.assign({}, item, { ncLogicalPins: ['V+'] }) : item)
  });
  assert.equal(CIRCUITS.validateTemplate(explicitNc).ok, true,
    'a deliberately unused logical pin must be explicit NC/optional rather than silently omitted');
  assert.equal(CIRCUITS.validateTemplate(source).requiredLogicalPinsConnected, true);
  assert.equal(CIRCUITS.validateTemplate(source).physicalPinMapComplete, false,
    'logical connectivity does not prove a package pin map');
});

test('two real project system references retain terminal evidence without becoming auto-selected topology', () => {
  const summary = REFERENCES.summary();
  assert.equal(summary.referenceCount, 2);
  assert.equal(summary.deviceCount, Object.values(REFERENCES.SYSTEMS).reduce((sum, item) => sum + item.devices.length, 0));
  assert.equal(summary.connectionCount, Object.values(REFERENCES.SYSTEMS).reduce((sum, item) => sum + item.connections.length, 0));
  assert.equal(summary.allStructurallyValid, true);
  assert.equal(summary.allComplete, false);
  assert.ok(summary.unresolvedItemCount > 0);
  Object.values(REFERENCES.SYSTEMS).forEach((reference) => {
    assert.equal(reference.automaticSelectionAllowed, false, reference.id);
    assert.equal(REFERENCES.validate(reference).ok, true, reference.id);
    assert.equal(REFERENCES.validate(reference).complete, false, reference.id);
    assert.ok(reference.unresolved.length >= 4, reference.id);
    assert.ok(reference.connections.every((wire) => wire.from.includes(':') && wire.to.includes(':')), reference.id);
  });
  const gb = REFERENCES.find('REF-GB60-MOBILE');
  assert.ok(REFERENCES.TRACE_REVIEW_MANIFEST.length >= 11);
  assert.ok(REFERENCES.TRACE_REVIEW_MANIFEST.every((item) => item.sourceId && item.objectId &&
    item.textAnchor.length === 2 && /SIGNOFF_PENDING/.test(item.status)));
  const byConnection = Object.fromEntries(gb.connections.map((item) => [item.id, item]));
  assert.equal(byConnection['GB-W044'].from, 'GB-MODS:DC-');
  assert.equal(byConnection['GB-W044'].to, 'GB-K14:IN');
  assert.equal(byConnection['GB-W046'].to, 'GB-GUN:DC-');
  assert.equal(byConnection['GB-W047'].from, 'GB-MODS:DC+');
  assert.equal(byConnection['GB-W047'].to, 'GB-K15:IN');
  assert.equal(byConnection['GB-W049'].to, 'GB-GUN:DC+');
  assert.equal(gb.devices.find((item) => item.id === 'GB-T24').pins[0].domain, 'HV_DC_ESS');
  assert.ok(gb.connections.every((wire) => !(wire.from === 'GB-K1:OUT' && wire.to === 'GB-K14:IN')));
});

test('quality rules keep safety blockers separate from comparison scores', () => {
  assert.ok(QUALITY.RULES.length >= 19);
  assert.equal(QUALITY.ruleById('QR-004').severity, 'BLOCKING');
  const precheck = QUALITY.reviewBoardTemplate('PRECHECK-DUAL-RELAY-OPTO');
  assert.equal(precheck.blockingCount, 1);
  assert.equal(precheck.checks.find((item) => item.ruleId === 'QR-004').result, 'UNRESOLVED');
  assert.equal(precheck.checks.find((item) => item.ruleId === 'QR-013').result, 'UNRESOLVED');
  const weld = QUALITY.reviewBoardTemplate('WELD-BRIDGE-OPTO');
  assert.equal(weld.checks.find((item) => item.ruleId === 'QR-005').result, 'UNRESOLVED');
  const psu = QUALITY.reviewBoardTemplate('AUX-PSU-EMI-RECTIFIER');
  assert.equal(psu.checks.find((item) => item.ruleId === 'QR-018').result, 'UNRESOLVED');
  const yCaps = CIRCUITS.findTemplate('AUX-PSU-EMI-RECTIFIER').components.filter((item) => /^Y_CLASS_REQUIRED/.test(item.value));
  assert.equal(yCaps.length, 2);
  assert.ok(yCaps.every((item) => item.assemblyMode === 'CONDITIONAL_DNI_BY_DEFAULT' && item.fittedByDefault === false));
  const peFrontEnd = QUALITY.reviewBoardTemplate('PE-HIGH-OHM-SENSE');
  assert.equal(peFrontEnd.checks.find((item) => item.ruleId === 'QR-007').result, 'UNRESOLVED');
  assert.equal(peFrontEnd.dimensions.ISOLATION_AND_PROTECTION.score, 40);
  const system = QUALITY.reviewSystem({
    design: {
      instances: [{ id: 'PE', kind: 'earth-bar' }, { id: 'RCM', kind: 'residual-current-monitor' },
        { id: 'IMD', kind: 'insulation-monitor' }],
      topology: { functionalUnits: [{ type: 'OUTPUT_SAFETY_DIAGNOSTICS', functions: ['precheck', 'weld'] }],
        safetyStateMachine: { status: 'PRESENT' } }
    },
    drawingIR: { coverage: { ok: true }, violations: [], devices: [] }
  });
  assert.equal(system.checks.find((item) => item.ruleId === 'QR-019').result, 'UNRESOLVED');
  assert.equal(system.checks.find((item) => item.ruleId === 'QR-005').result, 'UNRESOLVED');
  assert.equal(system.checks.find((item) => item.ruleId === 'QR-006').result, 'UNRESOLVED');
});

test('system quality cannot infer PE RCM IMD evidence or package pins from device names', () => {
  const report = QUALITY.reviewSystem({
    design: {
      instances: [
        { id: 'PE', kind: 'earth-bar', terminals: [{ id: 'PE', required: true, physicalPin: 'UNRESOLVED' }] },
        { id: 'RCM', kind: 'residual-current-monitor' }, { id: 'IMD', kind: 'insulation-monitor' },
        { id: 'AC', kind: 'ac-busbar' }, { id: 'DC', kind: 'dc-busbar' }
      ],
      circuits: [], topology: { functionalUnits: [] }
    },
    drawingIR: {
      coverage: { ok: false }, violations: [],
      devices: [{ id: 'PE', type: 'earth-bar', symbolId: 'iec.earth.protective-bar', symbolFallback: false,
        ports: [{ id: 'PE', x: 0, y: 0 }] }],
      primitives: [
        { id: 'S1', kind: 'line', equipmentId: 'PE', symbolId: 'iec.earth.protective-bar', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'P1', kind: 'port', equipmentId: 'PE', portId: 'PE', x: 0, y: 0 }
      ]
    }
  });
  assert.equal(report.checks.find((item) => item.ruleId === 'QR-006').result, 'UNRESOLVED');
  assert.equal(report.checks.find((item) => item.ruleId === 'QR-013').result, 'UNRESOLVED');
});
