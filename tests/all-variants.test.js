'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');
const engineDir = path.join(rootDir, 'engine');

function runtime() {
  const win = {};
  orderedEngineFiles(engineDir).forEach((file) => {
    const source = fs.readFileSync(path.join(engineDir, file), 'utf8');
    new Function('window', 'document', source)(win, {});
  });
  return win;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function endpointKey(instanceId, terminalId) {
  return instanceId + ':' + terminalId;
}

function modelHashPayload(model) {
  return {
    schemaVersion: model.schemaVersion,
    requirements: model.requirements,
    instances: model.instances,
    nets: model.nets,
    circuits: model.circuits,
    assumptions: model.assumptions,
    decisions: model.decisions,
    capabilities: model.capabilities,
    topology: model.topology,
    ess: model.ess
  };
}

function rehash(win, model) {
  model.modelHash = win.EVSE_DESIGN.modelHash(modelHashPayload(model));
  return model;
}

function paramsFor(win, standard, archetype) {
  const archetypeParameters = {
    'dc-integrated': {
      outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
      supplyMode: 'transformer', thermal: 'air', essEnabled: false
    },
    'dc-split': {
      outputKw: 180, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
      supplyMode: 'transformer', thermal: 'liquid', essEnabled: false
    },
    'ac-dc-combo': {
      outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
      supplyMode: 'grid', thermal: 'air', essEnabled: false
    },
    'ess-mobile': {
      outputKw: 60, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
      supplyMode: 'offgrid', thermal: 'liquid', essEnabled: true,
      essKwh: 200, essPowerKw: 120, essCoupling: 'dc'
    }
  };
  return Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, archetypeParameters[archetype], {
    pileName: 'ALL-VARIANTS-' + standard + '-' + archetype,
    standard,
    archetype,
    acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard],
    voltageWindow: '200-1000',
    requirementConfirmed: true
  });
}

function assertRequiredTerminalMembership(design, label) {
  const memberships = new Map();
  design.nets.forEach((net) => (net.members || []).forEach((member) => {
    const key = endpointKey(member.instanceId, member.terminalId);
    memberships.set(key, (memberships.get(key) || 0) + 1);
  }));
  design.instances.forEach((instance) => {
    instance.terminals.filter((terminal) => terminal.required).forEach((terminal) => {
      const key = endpointKey(instance.id, terminal.id);
      assert.equal(memberships.get(key) || 0, 1, label + ' required terminal must belong to exactly one net: ' + key);
    });
  });
}

function assertExactCoverage(win, design, drawingIR, label) {
  const coverage = win.EVSE_DRAWING_IR.auditCoverage(design, drawingIR);
  assert.equal(coverage.ok, true, label + ' coverage: ' + JSON.stringify(coverage.errors));
  assert.deepEqual(coverage.errors, []);
  assert.equal(drawingIR.devices.length,
    design.instances.filter((instance) => instance.logicalOnlyProxy !== true).length,
    label + ' physical device coverage');
  assert.equal(drawingIR.routes.length, design.circuits.length, label + ' circuit coverage');
  design.circuits.forEach((circuit) => {
    const route = drawingIR.routes.find((item) => item.circuitId === circuit.id);
    assert.ok(route, label + ' missing route ' + circuit.id);
    assert.equal(route.netId, circuit.netId, label + ' net mismatch ' + circuit.id);
    assert.equal(route.source.ref, endpointKey(circuit.from, circuit.fromPort), label + ' source mismatch ' + circuit.id);
    assert.equal(route.target.ref, endpointKey(circuit.to, circuit.toPort), label + ' target mismatch ' + circuit.id);
  });
}

function assertArchetypeContract(design, archetype, label) {
  assert.equal(design.requirements.archetype, archetype, label + ' requirement archetype marker');
  assert.ok(design.capabilities.implementedArchetypes.includes(archetype), label + ' implemented archetype marker');

  const contract = design.topology && design.topology.archetypeContract;
  assert.ok(contract, label + ' missing topology.archetypeContract');
  assert.equal(contract.id, archetype, label + ' topology contract id');
  assert.match(contract.templateVersion, /^\d+\.\d+\.\d+$/, label + ' topology template version');
  assert.ok(Array.isArray(contract.requiredKinds) && contract.requiredKinds.length > 0,
    label + ' topology requiredKinds');
  assert.ok(Array.isArray(contract.markerIds) && contract.markerIds.length > 0,
    label + ' topology markerIds');

  const kinds = new Set(design.instances.map((instance) => instance.kind));
  contract.requiredKinds.forEach((kind) => assert.ok(kinds.has(kind), label + ' missing contract kind ' + kind));
  const ids = new Set(design.instances.map((instance) => instance.id));
  const fixedMarkers = {
    'dc-integrated': ['EQ-AC-IN', 'EQ-PM', 'EQ-DC-BUS'],
    'dc-split': [],
    'ac-dc-combo': [
      'EQ-AC-EV-QF1', 'EQ-AC-EV-RCD1', 'EQ-AC-EV-PJ1',
      'EQ-AC-EV-KM1', 'EQ-AC-EV-A1', 'EQ-AC-EV-XS1'
    ],
    'ess-mobile': [
      'EQ-MOB-BAT1', 'EQ-MOB-BAT2', 'EQ-MOB-BAT3', 'EQ-MOB-FU1', 'EQ-MOB-RPRE',
      'EQ-MOB-HEATER1', 'EQ-MOB-HEATER2', 'EQ-MOB-HEATER3',
      'EQ-MOB-PCS', 'EQ-MOB-DC-IN', 'EQ-MOB-AC-IN', 'EQ-MOB-HV24',
      'EQ-MOB-24V12', 'EQ-MOB-BCU', 'EQ-MOB-VCU', 'EQ-MOB-EVCC',
      'EQ-MOB-SECC', 'EQ-MOB-OCPP', 'EQ-MOB-JT'
    ].concat(Array.from({ length: 10 }, (_, index) => 'EQ-MOB-K' + (index + 1)))
  };
  const expectedMarkers = fixedMarkers[archetype].slice();

  if (archetype === 'dc-split') {
    for (let gun = 1; gun <= design.requirements.gunCount; gun += 1) {
      expectedMarkers.push('EQ-G' + gun + '-IF-CAB', 'EQ-G' + gun + '-IF-TERM', 'EQ-G' + gun + '-LCU');
      const cableId = 'CBL-G' + gun;
      const links = design.topology.splitCableLinks || [];
      assert.ok(links.some((link) => JSON.stringify(link).includes(cableId)), label + ' missing split cable link ' + cableId);
      const cableNets = design.nets.filter((net) =>
        net.boundary === 'CABINET_TERMINAL_CABLE' && net.cableId === cableId);
      assert.ok(cableNets.length >= 2, label + ' cable must expose conductor nets ' + cableId);
    }
    assert.equal(design.topology.splitCableLinks.length, design.requirements.gunCount,
      label + ' one split boundary link per terminal');
  }

  expectedMarkers.forEach((id) => assert.ok(ids.has(id), label + ' missing topology marker ' + id));
  expectedMarkers.forEach((id) => assert.ok(contract.markerIds.includes(id), label + ' contract omits marker ' + id));

  if (archetype === 'ess-mobile') {
    assert.equal(design.requirements.essEnabled, true, label + ' mobile requirement storage marker');
    assert.equal(design.ess.enabled, true, label + ' mobile storage must be enabled');
    assert.ok(design.ess.objectIds.length > 0, label + ' mobile storage objects');
  }
}

function auditAndAssertExport(win, result, svg, label) {
  const skill = win.EVSE_DRAWING_SKILL;
  const audit = skill.auditMarkup(svg, skill.DRAWING_KEY, result);
  skill.recordDrawingAudit(result, skill.DRAWING_KEY, audit);
  skill.finalizeDrawingAudits(result);
  assert.equal(audit.blockingCount, 0,
    label + ' drawing audit: ' + audit.checks.filter((item) => !item.ok).map((item) => item.code).join(','));
  assert.equal(audit.status, 'CHECKED', label + ' drawing audit status');
  assert.equal(result.drawingSkill.status, 'ACTIVE', label + ' drawing skill status');
  assert.equal(skill.canExport(result, skill.DRAWING_KEY, 'SVG').allowed, true, label + ' SVG export gate');
  assert.equal(skill.canExport(result, skill.DRAWING_KEY, 'DXF').allowed, true, label + ' DXF export gate');
}

function connectorOf(model) {
  const connector = model.instances.find((instance) => instance.kind === 'charge-connector');
  assert.ok(connector, 'mutation fixture must contain a charge connector');
  return connector;
}

function swapConnectorNetAssignments(model, connectorId, terminalA, terminalB) {
  const swap = (terminalId) => terminalId === terminalA ? terminalB : (terminalId === terminalB ? terminalA : terminalId);
  model.nets.forEach((net) => (net.members || []).forEach((member) => {
    if (member.instanceId === connectorId) member.terminalId = swap(member.terminalId);
  }));
  model.circuits.forEach((circuit) => {
    if (circuit.from === connectorId) circuit.fromPort = swap(circuit.fromPort);
    if (circuit.to === connectorId) circuit.toPort = swap(circuit.toPort);
  });
}

function openConnectorTerminal(model, connectorId, terminalId) {
  model.nets.forEach((net) => {
    net.members = (net.members || []).filter((member) =>
      !(member.instanceId === connectorId && member.terminalId === terminalId));
  });
  model.circuits = model.circuits.filter((circuit) =>
    !(circuit.from === connectorId && circuit.fromPort === terminalId) &&
    !(circuit.to === connectorId && circuit.toPort === terminalId));
}

const win = runtime();
const standards = ['gb', 'eu', 'us', 'nacs', 'chademo'];
const archetypes = ['dc-integrated', 'dc-split', 'ac-dc-combo', 'ess-mobile'];

test('all 20 standard x archetype variants are ERC-clean, exactly rendered, audited, and exportable', { timeout: 300000 }, async (t) => {
  let combinations = 0;
  let materialDxfExports = 0;

  for (const standard of standards) {
    for (const archetype of archetypes) {
      await t.test(standard + ' x ' + archetype, () => {
        combinations += 1;
        const label = standard + '/' + archetype;
        const result = win.EVSE_ENGINE.build(paramsFor(win, standard, archetype));
        const design = result.design;

        assert.equal(result.ok, true, label + ' EVSE_ENGINE build');
        assert.equal(result.standardId, standard, label + ' standard marker');
        assert.equal(result.archetype.id, archetype, label + ' result archetype marker');
        assert.equal(design.schemaVersion, '4.0.0', label + ' EDEM schema');
        assert.equal(design.modelValidation.status, 'PASS',
          label + ' ERC: ' + JSON.stringify(design.modelValidation.violations));
        assert.equal(design.modelValidation.blockingCount, 0, label + ' ERC blocking count');
        assert.equal(win.EVSE_ERC.validate(design).blockingCount, 0, label + ' repeat ERC');
        assertArchetypeContract(design, archetype, label);
        assertRequiredTerminalMembership(design, label);

        const svg = win.drawPile(result);
        assert.match(svg, /^<svg\b/, label + ' SVG rendering');
        assert.match(svg, /data-ir-schema="evse-drawing-ir\/v1"/, label + ' Drawing IR schema trace');
        assert.match(svg, /data-coverage-status="PASS"/, label + ' SVG coverage marker');
        assert.equal(result.drawingIR.coverage.ok, true, label + ' compiled coverage');
        assert.equal(result.drawingIR.violations.length, 0,
          label + ' geometry: ' + JSON.stringify(result.drawingIR.violations));
        assertExactCoverage(win, design, result.drawingIR, label);
        auditAndAssertExport(win, result, svg, label);

        // Eight representatives cover every standard and every archetype while
        // avoiding unnecessary serialisation of all 20 potentially large DXFs.
        if (archetype === 'dc-integrated' || standard === 'gb') {
          const dxf = win.EVSE_DXF.exportDrawingIR(result.drawingIR, { title: label });
          assert.match(dxf.dxf, /^\s*0\s*[\r\n]+SECTION/m, label + ' material DXF');
          assert.ok(!dxf.warnings.includes('LEGACY_SVG_PARSE'), label + ' must use direct Drawing IR DXF');
          assert.equal(dxf.manifest.source.schema, win.EVSE_DRAWING_IR.SCHEMA, label + ' DXF source schema');
          assert.equal(dxf.stats.routes, design.circuits.length, label + ' DXF route count');
          materialDxfExports += 1;
        }
      });
    }
  }

  assert.equal(combinations, 20);
  assert.equal(materialDxfExports, 8);
});

test('NACS CP and PP cannot be swapped or left open', () => {
  const base = win.EVSE_ENGINE.build(paramsFor(win, 'nacs', 'dc-integrated')).design;
  assert.equal(base.modelValidation.blockingCount, 0, JSON.stringify(base.modelValidation.violations));
  const connector = connectorOf(base);

  const swapped = clone(base);
  swapConnectorNetAssignments(swapped, connector.id, 'CP', 'PP');
  const swappedReport = win.EVSE_ERC.validate(rehash(win, swapped));
  assert.ok(swappedReport.blockingCount > 0);
  assert.ok(swappedReport.violations.some((item) =>
    item.code === 'CONNECTOR_SIGNAL_WRONG' || item.code === 'SIGNAL_ROLE_MISMATCH'),
  JSON.stringify(swappedReport.violations));

  ['CP', 'PP'].forEach((terminalId) => {
    const opened = clone(base);
    openConnectorTerminal(opened, connector.id, terminalId);
    const report = win.EVSE_ERC.validate(rehash(win, opened));
    assert.ok(report.blockingCount > 0, terminalId + ' open must block');
    assert.ok(report.violations.some((item) => item.code === 'CONNECTOR_SIGNAL_OPEN'),
      terminalId + ': ' + JSON.stringify(report.violations));
  });
});

test('CHAdeMO CAN, start/stop, enable, and charger 12V identities fail closed', () => {
  const base = win.EVSE_ENGINE.build(paramsFor(win, 'chademo', 'dc-integrated')).design;
  assert.equal(base.modelValidation.blockingCount, 0, JSON.stringify(base.modelValidation.violations));
  const connector = connectorOf(base);

  [
    ['CAN_H', 'CAN_L'],
    ['START_STOP_1', 'START_STOP_2'],
    ['START_STOP_1', 'CHARGE_ENABLE'],
    ['CHARGE_ENABLE', 'CHARGER_12V']
  ].forEach(([left, right]) => {
    const swapped = clone(base);
    swapConnectorNetAssignments(swapped, connector.id, left, right);
    const report = win.EVSE_ERC.validate(rehash(win, swapped));
    assert.ok(report.blockingCount > 0, left + '/' + right + ' swap must block');
    assert.ok(report.violations.some((item) =>
      ['CONNECTOR_SIGNAL_WRONG', 'CONNECTOR_AUX_WRONG', 'SIGNAL_ROLE_MISMATCH', 'NET_CLASS_MISMATCH', 'DOMAIN_MISMATCH'].includes(item.code)),
    left + '/' + right + ': ' + JSON.stringify(report.violations));
  });

  ['CAN_H', 'CAN_L', 'START_STOP_1', 'START_STOP_2', 'CHARGE_ENABLE', 'CHARGER_12V'].forEach((terminalId) => {
    const opened = clone(base);
    openConnectorTerminal(opened, connector.id, terminalId);
    const report = win.EVSE_ERC.validate(rehash(win, opened));
    assert.ok(report.blockingCount > 0, terminalId + ' open must block');
    const expectedCode = terminalId === 'CHARGER_12V' ? 'CONNECTOR_AUX_OPEN' : 'CONNECTOR_SIGNAL_OPEN';
    assert.ok(report.violations.some((item) => item.code === expectedCode),
      terminalId + ': ' + JSON.stringify(report.violations));
  });
});
