'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

test('CLI exports the same six-sheet document with page Drawing IR hashes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'evse-multisheet-cli-'));
  const paramsFile = path.join(temp, 'params.json');
  fs.writeFileSync(paramsFile, JSON.stringify({
    pileName: 'CLI-MULTISHEET', standard: 'gb', archetype: 'dc-integrated',
    outputKw: 60, moduleKw: 30, gunCount: 1, gunCurrentA: 250,
    voltageWindow: '200-1000', acVoltage: 380, supplyMode: 'grid',
    thermal: 'air', essEnabled: false, requirementConfirmed: true
  }), 'utf8');
  const run = spawnSync(process.execPath, [path.join(rootDir, 'scripts', 'generate.js'),
    '--params', paramsFile, '--out', temp, '--name', 'cli-book'], {
    cwd: rootDir, encoding: 'utf8', timeout: 180000
  });
  assert.equal(run.status, 0, run.stderr + '\n' + run.stdout);
  const packageFile = path.join(temp, 'cli-book.json');
  const packageData = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  assert.equal(packageData.schema, 'SCHEMATICFORGE-DIAGNOSTIC-PACKAGE/2.0');
  assert.equal(packageData.schematicDocument.projectGate.status, 'PASS');
  assert.equal(packageData.renderedPageManifest.length, 6);
  assert.equal(packageData.exports.pages.length, 6);
  ['bom', 'wiring', 'rfq', 'audit'].forEach((key) => {
    assert.ok(packageData.exports[key], key);
    assert.equal(fs.existsSync(path.join(temp, packageData.exports[key])), true, key);
  });
  const wiring = fs.readFileSync(path.join(temp, packageData.exports.wiring), 'utf8');
  assert.match(wiring, /circuitId,netId,fromEquipment,fromPIN,toEquipment,toPIN/);
  assert.match(wiring, /CCT-\d+,NET-\d+,EQ-[^,]+,[^,]+,EQ-[^,]+,[^,]+/);
  const rfq = fs.readFileSync(path.join(temp, packageData.exports.rfq), 'utf8');
  assert.match(rfq, /USER_REFERENCE_UNVERIFIED/);
  assert.match(rfq, /UNAPPROVED_RFQ_REQUIRED/);
  const audit = JSON.parse(fs.readFileSync(path.join(temp, packageData.exports.audit), 'utf8'));
  assert.equal(audit.modelHash, packageData.sourceModelHash);
  assert.equal(audit.pages.length, 6);
  assert.equal(audit.projectGate.status, 'PASS');
  assert.ok(audit.pages.every((page) => page.renderedSvgAudit && page.renderedSvgAudit.ok === true));
  assert.ok(audit.pages.every((page) => page.renderedDxfAudit && page.renderedDxfAudit.ok === true));
  packageData.renderedPageManifest.forEach((page, index) => {
    assert.equal(page.sheetId, 'S0' + (index + 1));
    assert.match(page.geometryHash, /^fnv1a32:/);
    assert.ok(page.svg && page.dxf);
    assert.equal(page.dxfReadbackAudit.ok, true);
    const svg = fs.readFileSync(path.join(temp, page.svg), 'utf8');
    const dxf = fs.readFileSync(path.join(temp, page.dxf), 'utf8');
    assert.match(svg, new RegExp('data-sheet-id="' + page.sheetId + '"'));
    assert.match(svg, new RegExp('data-geometry-hash="' + page.geometryHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'));
    assert.ok(dxf.includes(page.geometryHash), page.sheetId + ' DXF must carry the same Drawing IR hash');
  });
});

test('CLI source has no legacy single-sheet renderer path', () => {
  const source = fs.readFileSync(path.join(rootDir, 'scripts', 'generate.js'), 'utf8');
  assert.doesNotMatch(source, /\bdrawPile\s*\(/);
  assert.match(source, /EVSE_SCHEMATIC_SHEET_RENDERING/);
  assert.match(source, /buildDocument\(R\)/);
});
