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
    const source = fs.readFileSync(path.join(rootDir, 'engine', file), 'utf8');
    new Function('window', 'document', source)(win, {});
  });
  return win;
}

function denseResult(win) {
  return win.EVSE_ENGINE.build(Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'OFF-PAGE-ROW-PLACEMENT-TEST',
    standard: 'gb', archetype: 'dc-integrated',
    outputKw: 240, moduleKw: 30, gunCount: 4, gunCurrentA: 250,
    acVoltage: 380, voltageWindow: '200-1000', thermal: 'liquid',
    essEnabled: true, essKwh: 260, essPowerKw: 120, essCoupling: 'dc',
    requirementConfirmed: true
  }));
}

function banksOn(page) {
  return page.compiled.drawingIR.devices.filter((device) =>
    device.projectionRole === 'OFF_PAGE_CONNECTOR_BANK' ||
    /^off-page-connector-(?:incoming|outgoing)$/.test(device.type));
}

function rowOrder(port) {
  return [port.terminalId || '', port.circuitId || '', port.side || '', port.id || ''].join('|');
}

test('off-page banks allocate one deterministic vertical row per connector across both sides', () => {
  const win = runtime();
  const first = win.EVSE_SCHEMATIC_SHEET_RENDERING.buildDocument(denseResult(win));
  const second = win.EVSE_SCHEMATIC_SHEET_RENDERING.buildDocument(denseResult(win));
  const firstBanks = first.pages.flatMap((page) => banksOn(page).map((bank) => ({ page, bank })));
  const secondById = new Map(second.pages.flatMap((page) => banksOn(page)
    .map((bank) => [page.sheetId + ':' + bank.id, bank])));

  assert.ok(firstBanks.length > 0, 'fixture must contain cross-page connector banks');
  assert.ok(firstBanks.some(({ bank }) =>
    new Set(bank.ports.map((port) => port.side)).size === 2),
  'fixture must exercise one bank approached from both sides');

  firstBanks.forEach(({ page, bank }) => {
    const ordered = bank.ports.slice().sort((left, right) => rowOrder(left).localeCompare(rowOrder(right)));
    const uniqueRows = new Set(ordered.map((port) => port.y.toFixed(7)));
    const pitch = bank.bbox.height / (ordered.length + 1);

    assert.equal(uniqueRows.size, ordered.length, page.sheetId + ':' + bank.id + ' row cardinality');
    assert.ok(bank.bbox.height >= 32 + ordered.length * page.compiled.plan.readability.terminalPitchMin,
      page.sheetId + ':' + bank.id + ' height must be based on total ports, not max ports per side');
    const stagger = ordered[0].y - (bank.bbox.yMin + pitch);
    assert.ok(Math.abs(stagger) <= page.compiled.plan.readability.routeLanePitchMin / 2 + 1e-7,
      page.sheetId + ':' + bank.id + ' bank stagger must stay within half a route pitch');
    ordered.forEach((port, index) => {
      const expectedY = bank.bbox.yMin + (index + 1) * pitch + stagger;
      assert.ok(Math.abs(port.y - expectedY) < 1e-7,
        page.sheetId + ':' + bank.id + ':' + port.terminalId + ' deterministic global row');
      if (index) assert.ok(port.y - ordered[index - 1].y >=
        page.compiled.plan.readability.terminalPitchMin - 1e-7,
      page.sheetId + ':' + bank.id + ' adjacent global-row pitch');
    });

    const repeated = secondById.get(page.sheetId + ':' + bank.id);
    assert.ok(repeated, page.sheetId + ':' + bank.id + ' deterministic repeat exists');
    assert.deepEqual(repeated.ports.map((port) => [port.id, port.side, port.y]),
      bank.ports.map((port) => [port.id, port.side, port.y]));
  });
});
