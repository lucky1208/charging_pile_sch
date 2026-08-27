'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');
const engineDir = path.join(rootDir, 'engine');
const IEC = require('../engine/iec-symbol-catalog.js');

const STANDARDS = Object.freeze(['gb', 'eu', 'us', 'nacs', 'chademo']);
const ARCHETYPES = Object.freeze(['dc-integrated', 'dc-split', 'ac-dc-combo', 'ess-mobile']);
const PILOT_KINDS = Object.freeze([
  'control-pilot-generator',
  'control-pilot-monitor',
  'vehicle-diode-detector'
]);
const DIAGNOSTIC_KINDS = Object.freeze([
  'output-precheck-monitor',
  'contactor-state-monitor'
]);
const NEW_SYMBOL_KINDS = Object.freeze(PILOT_KINDS.concat(DIAGNOSTIC_KINDS));

function runtime() {
  const win = {};
  orderedEngineFiles(engineDir).forEach((file) => {
    const source = fs.readFileSync(path.join(engineDir, file), 'utf8');
    new Function('window', 'document', source)(win, {});
  });
  return win;
}

const win = runtime();

function paramsFor(standard, archetype) {
  const archetypeParameters = {
    'dc-integrated': {
      outputKw: 120, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
      supplyMode: 'transformer', thermal: 'air', essEnabled: false
    },
    'dc-split': {
      outputKw: 180, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
      supplyMode: 'transformer', thermal: 'liquid', essEnabled: false
    },
    'ac-dc-combo': {
      outputKw: 120, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
      supplyMode: 'grid', thermal: 'air', essEnabled: false
    },
    'ess-mobile': {
      outputKw: 60, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
      supplyMode: 'offgrid', thermal: 'liquid', essEnabled: true,
      essKwh: 200, essPowerKw: 120, essCoupling: 'dc'
    }
  };
  return Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, archetypeParameters[archetype], {
    pileName: 'FUNCTIONAL-SAFETY-' + standard + '-' + archetype,
    standard,
    archetype,
    acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard],
    voltageWindow: '200-1000',
    requirementConfirmed: true
  });
}

let matrixCache = null;
function matrix() {
  if (!matrixCache) {
    matrixCache = STANDARDS.flatMap((standard) => ARCHETYPES.map((archetype) => ({
      standard,
      archetype,
      label: standard + '/' + archetype,
      design: win.EVSE_ENGINE.build(paramsFor(standard, archetype)).design
    })));
  }
  return matrixCache;
}

function outputConnectors(design) {
  return design.instances.filter((instance) =>
    (instance.kind === 'charge-connector' || instance.kind === 'ac-charge-connector') &&
    instance.interfaceRole === 'CHARGING_OUTPUT');
}

function associated(design, connectorId, kind) {
  return design.instances.filter((instance) =>
    instance.kind === kind && instance.protectedConnectorId === connectorId);
}

function netsForEndpoint(design, instanceId, terminalId) {
  return design.nets.filter((net) => (net.members || []).some((member) =>
    member.instanceId === instanceId && member.terminalId === terminalId));
}

function uniqueNetForEndpoint(design, instanceId, terminalId, label) {
  const matches = netsForEndpoint(design, instanceId, terminalId);
  assert.equal(matches.length, 1, label + ' must belong to exactly one physical net');
  return matches[0];
}

function senseTerminalId(connectorTerminalId) {
  return connectorTerminalId.startsWith('AC_')
    ? 'SENSE_' + connectorTerminalId.slice(3)
    : 'SENSE_' + connectorTerminalId;
}

test('all five standards x four archetypes apply pilot and output diagnostics per physical output interface', () => {
  matrix().forEach(({ standard, archetype, label, design }) => {
    const connectors = outputConnectors(design);
    assert.equal(connectors.length, archetype === 'ac-dc-combo' ? 2 : 1,
      label + ' output interface count');

    connectors.forEach((connector) => {
      const interfaceLabel = label + '/' + connector.id;
      const contract = connector.controlContract;
      assert.ok(contract, interfaceLabel + ' missing output control contract');
      assert.equal(contract.schema, 'EVSE-OUTPUT-CONTROL-CONTRACT/1.0', interfaceLabel);
      assert.equal(contract.interfaceRole, 'CHARGING_OUTPUT', interfaceLabel);
      assert.equal(contract.lifecycle, 'APPROVED', interfaceLabel);
      assert.equal(contract.functions.outputPrecheck, 'REQUIRED', interfaceLabel);
      assert.equal(contract.functions.weldDetection, 'REQUIRED', interfaceLabel);
      Object.values(contract.projectValues).forEach((projectValue) => {
        assert.equal(projectValue.value, null, interfaceLabel + ' must not invent a project threshold');
        assert.equal(projectValue.status, 'PROJECT_VALUE_REQUIRED', interfaceLabel);
      });

      const prechecks = associated(design, connector.id, 'output-precheck-monitor');
      const stateMonitors = associated(design, connector.id, 'contactor-state-monitor');
      assert.equal(prechecks.length, 1, interfaceLabel + ' requires exactly one output precheck unit');
      assert.equal(stateMonitors.length, 1, interfaceLabel + ' requires exactly one contactor-state unit');
      assert.deepEqual(prechecks[0].functionalUnitIds, ['sc_det'], interfaceLabel);
      assert.deepEqual(stateMonitors[0].functionalUnitIds, ['adh_det'], interfaceLabel);
      assert.equal(prechecks[0].automaticVariantSelectionAllowed, false, interfaceLabel);
      assert.equal(stateMonitors[0].automaticVariantSelectionAllowed, false, interfaceLabel);

      const outputPowerTerminals = connector.terminals.filter((terminal) =>
        terminal.required && (terminal.netClass === 'POWER_DC' || terminal.netClass === 'POWER_AC'));
      assert.ok(outputPowerTerminals.length >= 2, interfaceLabel + ' must expose at least two power conductors');
      outputPowerTerminals.forEach((terminal) => {
        const connectorNet = uniqueNetForEndpoint(design, connector.id, terminal.id,
          interfaceLabel + ':' + terminal.id);
        const senseId = senseTerminalId(terminal.id);
        [prechecks[0], stateMonitors[0]].forEach((monitor) => {
          assert.ok(monitor.terminals.some((candidate) => candidate.id === senseId),
            interfaceLabel + '/' + monitor.id + ' missing ' + senseId);
          const monitorNet = uniqueNetForEndpoint(design, monitor.id, senseId,
            interfaceLabel + '/' + monitor.id + ':' + senseId);
          assert.equal(monitorNet.id, connectorNet.id,
            interfaceLabel + '/' + monitor.id + ':' + senseId + ' must sense the connector-side conductor');
        });
      });

      const cpTerminal = connector.terminals.find((terminal) => terminal.id === 'CP' && terminal.required);
      const pilotRequired = !!cpTerminal;
      const expectedStatus = pilotRequired ? 'REQUIRED' : 'NOT_APPLICABLE';
      assert.equal(contract.functions.controlPilot, expectedStatus, interfaceLabel);
      assert.equal(contract.functions.pilotMonitor, expectedStatus, interfaceLabel);
      assert.equal(contract.functions.diodeCheck, expectedStatus, interfaceLabel);

      const pilotInstances = Object.fromEntries(PILOT_KINDS.map((kind) => [kind, associated(design, connector.id, kind)]));
      PILOT_KINDS.forEach((kind) => {
        assert.equal(pilotInstances[kind].length, pilotRequired ? 1 : 0,
          interfaceLabel + '/' + kind + ' applicability');
      });

      if (pilotRequired) {
        const cpNet = uniqueNetForEndpoint(design, connector.id, 'CP', interfaceLabel + ':CP');
        const expectedEndpoints = [
          [pilotInstances['control-pilot-generator'][0], 'CP_OUT'],
          [pilotInstances['control-pilot-monitor'][0], 'CP_SENSE'],
          [pilotInstances['vehicle-diode-detector'][0], 'CP_SENSE']
        ];
        expectedEndpoints.forEach(([instance, terminalId]) => {
          const unitNet = uniqueNetForEndpoint(design, instance.id, terminalId,
            interfaceLabel + '/' + instance.id + ':' + terminalId);
          assert.equal(unitNet.id, cpNet.id,
            interfaceLabel + ' CP generation, sampling, diode check and connector must share one physical net');
        });
        const generatorMembers = cpNet.members.filter((member) => {
          const instance = design.instances.find((candidate) => candidate.id === member.instanceId);
          return instance && instance.kind === 'control-pilot-generator' && member.terminalId === 'CP_OUT';
        });
        assert.equal(generatorMembers.length, 1, interfaceLabel + ' physical CP net requires exactly one generator');
      }
    });
  });
});

test('all 20 functional-safety variants remain fail-closed ERC clean', () => {
  const blocked = matrix().filter(({ design }) => design.modelValidation.status !== 'PASS').map(({ label, design }) => ({
    label,
    status: design.modelValidation.status,
    violations: design.modelValidation.violations.map((violation) => ({
      ruleId: violation.ruleId,
      code: violation.code,
      location: violation.location,
      message: violation.message
    }))
  }));
  assert.deepEqual(blocked, []);
});

test('the five new functional-safety symbols are explicit native IEC mappings, never fallback blocks', () => {
  const requiredRoles = {
    'control-pilot-generator': ['pwm-waveform', 'push-pull-output-node'],
    'control-pilot-monitor': ['sense-divider-resistor', 'adc-sampler'],
    'vehicle-diode-detector': ['vehicle-diode-test-symbol', 'diode-result-isolation'],
    'output-precheck-monitor': ['test-relay-moving-contact', 'precheck-isolation'],
    'contactor-state-monitor': ['weld-monitor-isolation', 'weld-state-comparator']
  };
  const allowedPrimitives = new Set(['line', 'polyline', 'circle', 'arc', 'rect', 'text']);

  NEW_SYMBOL_KINDS.forEach((kind) => {
    assert.ok(IEC.CURRENT_DEVICE_KINDS.includes(kind), kind + ' missing from controlled IEC catalog');
    const resolution = IEC.resolve(kind);
    assert.equal(resolution.fallback, false, kind);
    assert.notEqual(resolution.symbolId, IEC.FALLBACK_SYMBOL_ID, kind);
    const symbol = IEC.instantiate({
      kind,
      tag: kind,
      bbox: { x: 0, y: 0, width: 140, height: 90 },
      ports: []
    });
    assert.equal(symbol.fallback, false, kind);
    assert.ok(symbol.primitives.length >= 10, kind + ' must be an electrical glyph, not a placeholder');
    assert.ok(symbol.primitives.every((primitive) => allowedPrimitives.has(primitive.kind)), kind);
    requiredRoles[kind].forEach((role) => {
      assert.ok(symbol.primitives.some((primitive) => primitive.symbolRole === role),
        kind + ' missing recognisable electrical role ' + role);
    });
    assert.ok(!symbol.primitives.some((primitive) => primitive.symbolRole === 'function-frame'),
      kind + ' must not degrade to a generic function frame');
  });
});

test('Qwen-derived functional-unit taxonomy is exactly 32 review-only candidates and cannot auto-select', () => {
  const library = win.EVSE_FUNCTIONAL_UNIT_LIBRARY;
  assert.ok(library);
  assert.equal(library.SOURCE_STATUS, 'SECONDARY_EXTRACTION—PRIMARY_EVIDENCE_MISSING');
  assert.equal(Object.keys(library.GROUPS).length, 7);
  assert.deepEqual(Object.keys(library.GROUPS).sort(),
    ['adh_det', 'cp_det', 'cp_gen', 'diode_det', 'gnd_det', 'psu', 'sc_det']);

  const variants = Object.values(library.GROUPS).flatMap((group) => group.variants);
  assert.equal(variants.length, 32);
  variants.forEach((variant) => {
    assert.equal(variant.lifecycle, library.CANDIDATE, variant.id);
    assert.equal(variant.automaticSelectionAllowed, false, variant.id);
    assert.equal(variant.fixedValuesApproved, false, variant.id);
    assert.equal(Object.hasOwn(variant, 'score'), false, variant.id);
    assert.equal(Object.hasOwn(variant, 'selected'), false, variant.id);
    assert.equal(Object.hasOwn(variant, 'recommended'), false, variant.id);
  });

  const summary = library.describe({ instances: [], topology: {} });
  assert.equal(summary.groupCount, 7);
  assert.equal(summary.variantCount, 32);
  assert.equal(summary.automaticVariantSelectionAllowed, false);
  assert.ok(summary.groups.every((group) =>
    group.variants.every((variant) => variant.lifecycle === library.CANDIDATE)));
});
