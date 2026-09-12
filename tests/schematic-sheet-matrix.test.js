'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');

const rootDir = path.resolve(__dirname, '..');

function runtime() {
  const win = {};
  orderedEngineFiles(path.join(rootDir, 'engine')).forEach((file) => {
    new Function('window', 'document', fs.readFileSync(path.join(rootDir, 'engine', file), 'utf8'))(win, {});
  });
  return win;
}

function paramsFor(win, standard, archetype) {
  const variants = {
    'dc-integrated': { outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
      supplyMode: 'transformer', thermal: 'air', essEnabled: false },
    'dc-split': { outputKw: 180, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
      supplyMode: 'transformer', thermal: 'liquid', essEnabled: false },
    'ac-dc-combo': { outputKw: 120, moduleKw: 30, gunCount: 2, gunCurrentA: 250,
      supplyMode: 'grid', thermal: 'air', essEnabled: false },
    'ess-mobile': { outputKw: 60, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
      supplyMode: 'offgrid', thermal: 'liquid', essEnabled: true,
      essKwh: 200, essPowerKw: 120, essCoupling: 'dc' }
  };
  return Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, variants[archetype], {
    pileName: 'SHEET-MATRIX-' + standard + '-' + archetype,
    standard,
    archetype,
    acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard],
    voltageWindow: '200-1000',
    requirementConfirmed: true
  });
}

test('all five standards x four archetypes compile six exact editable functional sheets', async (t) => {
  const win = runtime();
  const standards = win.EVSE_REQUIREMENT_SPEC.SUPPORTED.standards;
  const archetypes = win.EVSE_REQUIREMENT_SPEC.SUPPORTED.archetypes;
  for (const standard of standards) {
    for (const archetype of archetypes) {
      await t.test(standard + ' x ' + archetype, () => {
        const built = win.EVSE_ENGINE.build(paramsFor(win, standard, archetype));
        const modelSnapshot = JSON.stringify(built.design);
        const rendered = win.EVSE_SCHEMATIC_SHEET_RENDERING.buildDocument(built);
        assert.equal(JSON.stringify(built.design), modelSnapshot, 'page projection mutated EDEM');
        assert.equal(rendered.pages.length, 6);
        assert.equal(rendered.projectGate.status, 'PASS');
        assert.equal(rendered.status, 'PASS');
        const source = new Map(built.design.circuits.map((circuit) => [circuit.id, circuit]));
        const cross = new Set(rendered.document.crossSheetCircuits.map((entry) => entry.circuitId));
        const occurrences = new Map();
        rendered.pages.forEach((page) => {
          assert.equal(page.pageGate.status, 'PASS', page.sheetId);
          assert.equal(page.pageGate.coverage.ok, true, page.sheetId);
          assert.doesNotMatch(page.svg, /data-symbol-fallback="true"/, page.sheetId);
          page.compiled.drawingIR.routes.forEach((route) => {
            const circuit = source.get(route.circuitId);
            assert.ok(circuit, route.circuitId);
            assert.equal(route.globalSource.ref, circuit.from + ':' + circuit.fromPort, route.circuitId);
            assert.equal(route.globalTarget.ref, circuit.to + ':' + circuit.toPort, route.circuitId);
            occurrences.set(route.circuitId, (occurrences.get(route.circuitId) || 0) + 1);
          });
        });
        built.design.circuits.forEach((circuit) => {
          assert.equal(occurrences.get(circuit.id), cross.has(circuit.id) ? 2 : 1, circuit.id);
        });
        const storage = rendered.pages.find((page) => page.sheetId === 'S04');
        assert.equal(storage.pageModel.circuits.length === 0, !built.design.requirements.essEnabled);
      });
    }
  }
});
