'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const win = {};
['connector-library.js', 'ev-standards.js'].forEach((file) => {
  const source = fs.readFileSync(path.join(rootDir, 'engine', file), 'utf8');
  new Function('window', source)(win);
});

test('五种受控标准都有唯一且非回退的物理连接器定义', () => {
  assert.equal(win.EV_STD.VERSION, '1.1.0');
  assert.equal(win.EVSE_CONNECTOR_LIB.VERSION, '1.1.0');
  const expected = {
    gb: 'gbt-dc', eu: 'ccs2', us: 'ccs1', nacs: 'nacs', chademo: 'chademo'
  };
  Object.entries(expected).forEach(([standardId, connectorType]) => {
    const standard = win.EV_STD.standard(standardId);
    const connector = win.EVSE_CONNECTOR_LIB.get(connectorType);
    assert.equal(standard.id, standardId);
    assert.equal(standard.connectorType, connectorType);
    assert.ok(connector, connectorType);
    assert.equal(new Set(connector.pins.map((pin) => pin.id)).size, connector.pins.length);
  });
  assert.equal(win.EVSE_CONNECTOR_LIB.get('not-a-connector'), null);
  assert.equal(win.EV_STD.standard('not-a-standard'), null);
  assert.equal(win.EV_STD.archetype('not-an-archetype'), null);
});

test('NACS 站点三相进线与车辆侧单相复用触点分开建模', () => {
  const nacs = win.EV_STD.standard('nacs');
  assert.equal(nacs.acLineVoltage, 480);
  assert.equal(nacs.phases, 3);
  assert.equal(nacs.neutral, false);
  assert.equal(nacs.connectorAcPhases, 1);
  assert.deepEqual(nacs.connectorAcConductors, ['L1', 'L2']);
  assert.equal(nacs.acOutput.connectorType, 'nacs-ac');
  assert.equal(nacs.acOutput.lineVoltage, 240);
  assert.equal(nacs.acOutput.requiresTransformer, true);
  assert.deepEqual(nacs.dcPins, ['DC+', 'DC-', 'PE', 'CP', 'PP']);
});

test('交直流一体支路使用地区AC接口，北美480V站点显式要求降压边界', () => {
  const outputs = Object.fromEntries(['gb', 'eu', 'us', 'nacs', 'chademo']
    .map((id) => [id, win.EV_STD.standard(id).acOutput]));
  assert.deepEqual(outputs.gb.controlPins, ['CP', 'CC']);
  assert.deepEqual(outputs.eu.conductors, ['L1', 'L2', 'L3', 'N']);
  assert.deepEqual(outputs.us.conductors, ['L1', 'L2']);
  assert.equal(outputs.us.requiresTransformer, true);
  assert.equal(outputs.nacs.requiresTransformer, true);
  assert.equal(outputs.chademo.companionInterface, true);
});

test('CHAdeMO 保留十个独立物理触点而不是压成 CP 抽象口', () => {
  const standard = win.EV_STD.standard('chademo');
  const connector = win.EVSE_CONNECTOR_LIB.get('chademo');
  const required = [
    'DC+', 'DC-', 'PE', 'CHARGER_12V', 'CONNECTION_CHECK',
    'START_STOP_1', 'START_STOP_2', 'CHARGE_ENABLE', 'CAN_H', 'CAN_L'
  ];
  assert.equal(connector.pins.length, 10);
  assert.deepEqual(new Set(connector.pins.map((pin) => pin.id)), new Set(required));
  assert.deepEqual(new Set(standard.dcPins), new Set(required));
  assert.equal(connector.pins.some((pin) => pin.id === 'CP'), false);
  assert.equal(connector.pins.find((pin) => pin.id === 'CHARGER_12V').kind, 'aux-power');
  assert.match(standard.protocol, /2\.1/);
  assert.deepEqual(standard.gunCurrentOptions, [125, 200, 400, 500]);
  assert.equal(standard.gunCurrentOptions.includes(800), false,
    '协议最高能力不能在缺少受控800A枪线/温升配置时直接成为项目额定值');
});
