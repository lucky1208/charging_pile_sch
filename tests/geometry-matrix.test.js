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

test('216 supported parameter combinations have exact, deterministic SVG/DXF geometry', () => {
  const win = runtime();
  const standards = ['gb', 'eu', 'us'];
  const powers = [60, 120, 240];
  const gunCounts = [1, 2, 3, 4];
  const storageModes = ['none', 'dc', 'ac'];
  const thermals = ['air', 'liquid'];
  const failures = [];
  let combinations = 0;
  let directDxfExports = 0;

  standards.forEach((standard) => powers.forEach((outputKw) => gunCounts.forEach((gunCount) =>
    storageModes.forEach((storageMode) => thermals.forEach((thermal) => {
      combinations += 1;
      const key = [standard, outputKw, gunCount, storageMode, thermal].join('/');
      try {
        const params = Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
          pileName: 'MATRIX-' + key,
          standard,
          archetype: 'dc-integrated',
          outputKw,
          moduleKw: 40,
          gunCount,
          gunCurrentA: 250,
          acVoltage: win.EVSE_REQUIREMENT_SPEC.STANDARD_VOLTAGES[standard],
          essEnabled: storageMode !== 'none',
          essKwh: 200,
          essPowerKw: 120,
          essCoupling: storageMode === 'ac' ? 'ac' : 'dc',
          thermal,
          requirementConfirmed: true
        });
        const result = win.EVSE_ENGINE.build(params);
        assert.equal(result.design.schemaVersion, '4.0.0');
        assert.equal(result.design.modelValidation.blockingCount, 0,
          (result.design.modelValidation.violations || [])
            .map((item) => item.code + '@' + item.location).join(','));
        const svg = win.drawPile(result);
        assert.match(svg, /^<svg\b/);
        assert.equal(result.drawingIR.coverage.ok, true);
        assert.equal(result.drawingIR.violations.length, 0);
        assert.equal(result.drawingIR.devices.length, result.design.instances.length);
        assert.equal(result.drawingIR.routes.length, result.design.circuits.length);
        const geometryHash = result.drawingGeometryHash;
        assert.match(geometryHash, /^fnv1a32:[0-9a-f]{8}$/);
        assert.match(svg, new RegExp('data-geometry-hash="' + geometryHash + '"'));
        assert.equal((svg.match(/data-circuit="/g) || []).length > 0, true);
        result.design.circuits.forEach((circuit) => {
          const route = result.drawingIR.routes.find((item) => item.id === circuit.id);
          assert.ok(route, 'missing route ' + circuit.id);
          assert.equal(route.netId, circuit.netId);
          assert.equal(route.source.ref, circuit.from + ':' + circuit.fromPort);
          assert.equal(route.target.ref, circuit.to + ':' + circuit.toPort);
        });

        const skill = win.EVSE_DRAWING_SKILL;
        const audit = skill.auditMarkup(svg, skill.DRAWING_KEY, result);
        skill.recordDrawingAudit(result, skill.DRAWING_KEY, audit);
        skill.finalizeDrawingAudits(result);
        assert.equal(audit.blockingCount, 0,
          audit.checks.filter((item) => !item.ok).map((item) => item.code).join(','));
        assert.equal(audit.status, 'CHECKED');
        assert.equal(result.drawingSkill.status, 'ACTIVE');
        assert.equal(skill.canExport(result, skill.DRAWING_KEY, 'SVG').allowed, true);
        assert.equal(skill.canExport(result, skill.DRAWING_KEY, 'DXF').allowed, true);

        /* Every combination passes the DXF export gate above.  Exercise the
           material DXF writer on the 18 boundary representatives covering
           every standard/storage mode at both gun-count extremes; primitive
           fidelity and mutation failure are exhaustively covered by the
           dedicated dxf-ir tests without serialising ~400 MB here. */
        if (outputKw === 240 && thermal === 'liquid' && (gunCount === 1 || gunCount === 4)) {
          const dxf = win.EVSE_DXF.exportDrawingIR(result.drawingIR, { title: key });
          assert.match(dxf.dxf, /^\s*0\s*[\r\n]+SECTION/m);
          assert.ok(!dxf.warnings.includes('LEGACY_SVG_PARSE'));
          directDxfExports += 1;
        }
      } catch (error) {
        failures.push(key + ': ' + (error && error.code ? error.code + ' ' : '') + (error && error.message));
      }
    })))));

  assert.equal(combinations, 216);
  assert.deepEqual(failures, []);
  assert.equal(directDxfExports, 18);
});
