'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const REFERENCES = require('../engine/reference-system-library.js');
const SYMBOLS = require('../engine/board-symbol-catalog.js');

function mutableReference(id) {
  return structuredClone(REFERENCES.find(id));
}

test('reference validation is fail-closed for unknown net classes', () => {
  const reference = mutableReference('REF-EU-ESS-CCS2');
  reference.connections[0].netClass = 'UNREVIEWED_VENDOR_BUS';
  const result = REFERENCES.validate(reference);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'UNKNOWN_NET_CLASS' &&
    item.id === reference.connections[0].id && item.netClass === 'UNREVIEWED_VENDOR_BUS'));
});

test('every declared reference net class has an explicit domain allow-list', () => {
  const declared = new Set(Object.values(REFERENCES.SYSTEMS)
    .flatMap((reference) => reference.connections.map((wire) => wire.netClass)));
  declared.forEach((netClass) => {
    assert.ok(Object.hasOwn(REFERENCES.NET_CLASS_DOMAINS, netClass), netClass);
    assert.ok(REFERENCES.NET_CLASS_DOMAINS[netClass].length > 0, netClass);
  });
  assert.deepEqual(REFERENCES.NET_CLASS_DOMAINS.SURGE, ['AC', 'PE']);
  assert.ok(REFERENCES.NET_CLASS_DOMAINS.SENSE_HV.includes('HV_DC_ESS'));
  assert.ok(REFERENCES.NET_CLASS_DOMAINS.CONTROL.includes('SIGNAL_DIGITAL'));
});

test('reference validation rejects a known net class connected to a forbidden pin domain', () => {
  const reference = mutableReference('REF-EU-ESS-CCS2');
  const wire = reference.connections.find((item) => item.netClass === 'POWER_AC');
  const [deviceId, pinId] = wire.from.split(':');
  const device = reference.devices.find((item) => item.id === deviceId);
  device.pins.find((item) => item.id === pinId).domain = 'CAN';
  const result = REFERENCES.validate(reference);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'NETCLASS_PIN_DOMAIN_MISMATCH' &&
    item.id === wire.id && item.endpoint === wire.from && item.pinDomain === 'CAN'));
});

test('arc connectivity is limited to the rendered sweep instead of the full circle', () => {
  const fakeSymbol = {
    symbolId: 'ARC-SWEEP-NEGATIVE-CASE',
    pins: [{ id: 'P1', x: -2, y: 0 }],
    primitives: [
      { kind: 'line', x1: -2, y1: 0, x2: -1, y2: 0, symbolRole: 'pin-lead' },
      { kind: 'arc', x: 0, y: 0, radius: 1, startAngle: 0, endAngle: 90, symbolRole: 'curved-lead' },
      { kind: 'line', x1: 0, y1: 1, x2: 0, y2: 2, symbolRole: 'primary-conductor' }
    ]
  };
  const result = SYMBOLS.auditPinGeometry(fakeSymbol);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'PIN_LEAD_NOT_CONNECTED_TO_SYMBOL_BODY' && item.pinId === 'P1'));
});

test('all 29 catalog symbols remain pin-connected after angle-aware arc checks', () => {
  assert.equal(SYMBOLS.ids.length, 29);
  SYMBOLS.ids.forEach((id) => assert.equal(SYMBOLS.auditPinGeometry(id).ok, true, id));
});
