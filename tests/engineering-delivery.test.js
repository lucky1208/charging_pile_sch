'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BOM = require('../engine/engineering-bom.js');
const DELIVERY = require('../engine/engineering-delivery.js');

function fixture() {
  return {
    schedule: [
      { tag: 'QF1', name: '直流断路器', spec: '1000VDC·250A' },
      { tag: 'K1', name: '直流接触器', spec: '1000VDC·250A·24VDC线圈' }
    ],
    releaseGate: { constructionStatus: 'BLOCKED', reason: 'PROJECT_REVIEW_REQUIRED' },
    design: {
      schema: 'EVSE-EDEM/4.1',
      modelHash: 'fnv1a32-delivery-test',
      project: { id: 'PRJ-DELIVERY', name: '交付测试' },
      instances: [
        { id: 'EQ-K1', tag: 'K1', name: '直流接触器', kind: 'dc-contactor', system: 'gun', quantity: 1,
          terminals: [
            { id: 'IN+', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE' },
            { id: 'OUT+', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE' }
          ] },
        { id: 'EQ-QF1', tag: 'QF1', name: '直流断路器', kind: 'dc-breaker', system: 'dc', quantity: 1,
          terminals: [
            { id: 'OUT+', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE' },
            { id: 'IN+', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE' }
          ] },
        { id: 'EQ-LOAD', tag: 'X1', name: '输出端子', kind: 'charging-connector', system: 'gun', quantity: 1,
          terminals: [{ id: 'DC+', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE' }] }
      ],
      nets: [
        { id: 'NET-2', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE',
          nominalVoltageV: 750, status: 'CONCEPT' },
        { id: 'NET-1', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE',
          nominalVoltageV: 750, status: 'CONCEPT' }
      ],
      circuits: [
        { id: 'CCT-10', netId: 'NET-2', from: 'EQ-K1', fromPort: 'OUT+', to: 'EQ-LOAD', toPort: 'DC+',
          netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE', voltageV: 750, status: 'CONCEPT' },
        { id: 'CCT-2', netId: 'NET-1', from: 'EQ-QF1', fromPort: 'OUT+', to: 'EQ-K1', toPort: 'IN+',
          netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE', voltageV: 750, status: 'CONCEPT' }
      ],
      modelValidation: {
        id: 'EVSE-ERC', status: 'PASS', blockingCount: 0, warningCount: 1,
        checks: [{ ruleId: 'ERC-086', status: 'PASS', violationCount: 0 }],
        violations: [{ ruleId: 'ERC-080', code: 'PROJECT_VALUE_NOT_EVALUATED', severity: 'WARN' }],
        loopIntegrity: {
          status: 'PARTIAL', blockingCount: 0, unresolvedCount: 1,
          limits: ['厂家针脚仍需复核'], records: [{ family: 'LOOP-004', status: 'NOT_EVALUATED' }]
        }
      }
    }
  };
}

function renderedDocument() {
  return {
    pages: [
      { sheetId: 'S02', sourceModelHash: 'fnv1a32-delivery-test', geometryHash: 'g2', projectionHash: 'p2',
        pageGate: { status: 'PASS', allowed: true }, renderedGeometry: { status: 'PASS', blockingCount: 0 } },
      { sheetId: 'S01', sourceModelHash: 'fnv1a32-delivery-test', geometryHash: 'g1', projectionHash: 'p1',
        pageGate: { status: 'PASS', allowed: true }, renderedGeometry: { status: 'PASS', blockingCount: 0 } }
    ],
    projectGate: { status: 'PASS', allowed: true, blockedSheetIds: [] }
  };
}

test('wiring CSV is naturally sorted and contains every exact equipment/PIN identity', () => {
  const rows = DELIVERY.wiringRows(fixture());
  assert.deepEqual(rows.map((row) => row.circuitId), ['CCT-2', 'CCT-10']);
  assert.deepEqual(rows[0], {
    circuitId: 'CCT-2', netId: 'NET-1',
    fromEquipment: 'EQ-QF1', fromPIN: 'OUT+', toEquipment: 'EQ-K1', toPIN: 'IN+',
    netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', phase: '', polarity: 'POSITIVE',
    voltage: 750, protocol: '', status: 'CONCEPT'
  });
  const csv = DELIVERY.wiringCsv(fixture(), { byteOrderMark: false });
  assert.ok(csv.startsWith(DELIVERY.WIRING_COLUMNS.join(',') + '\r\n'));
  assert.equal(csv.trimEnd().split('\r\n').length, 3);
});

test('wiring export rejects unknown devices, PINs, nets, duplicates and electrical attribute conflicts', () => {
  const unknownPin = fixture();
  unknownPin.design.circuits[0].toPort = 'MISSING';
  assert.throws(() => DELIVERY.wiringCsv(unknownPin), /unknown to PIN/i);

  const unknownNet = fixture();
  unknownNet.design.circuits[0].netId = 'MISSING';
  assert.throws(() => DELIVERY.wiringCsv(unknownNet), /unknown net/i);

  const duplicate = fixture();
  duplicate.design.circuits[1].id = duplicate.design.circuits[0].id;
  assert.throws(() => DELIVERY.wiringCsv(duplicate), /Duplicate circuit id/i);

  const mismatch = fixture();
  mismatch.design.circuits[0].domain = 'AUX_24V';
  assert.throws(() => DELIVERY.wiringCsv(mismatch), /conflicts with its authoritative net/i);
});

test('every CSV surface neutralises spreadsheet formula injection without changing numbers', () => {
  const unsafe = fixture();
  unsafe.design.circuits[0].id = '=HYPERLINK("https://bad.example")';
  const wiring = DELIVERY.wiringCsv(unsafe, { byteOrderMark: false });
  assert.match(wiring, /"'=HYPERLINK\(""https:\/\/bad\.example""\)"/);
  assert.match(wiring, /,750,/);

  const bom = BOM.build(fixture());
  bom.rows[0]['设备名称'] = ' +CMD';
  const bomCsv = DELIVERY.bomCsv(bom, { byteOrderMark: false });
  assert.match(bomCsv, /' \+CMD/);
  assert.equal(DELIVERY.csvCell('@SUM(1,1)'), '"\'@SUM(1,1)"');
  assert.equal(DELIVERY.csvCell(-12), '-12');
});

test('BOM CSV delegates authoritative row construction to engineering-bom', () => {
  const expected = BOM.build(fixture());
  const fromResult = DELIVERY.bomCsv(fixture());
  const fromPayload = DELIVERY.bomCsv(expected);
  assert.equal(fromResult, fromPayload);
  assert.ok(fromResult.startsWith('\uFEFF' + BOM.COLUMNS.join(',')));
  assert.match(fromResult, /PART_SELECTION_REQUIRED/);
  assert.match(fromResult, /待批准/);
});

test('RFQ stays an unapproved questionnaire and never invents a vendor, model or datasheet', () => {
  const rows = DELIVERY.rfqRows(fixture());
  assert.equal(rows.length, fixture().design.instances.length);
  rows.forEach((row) => {
    assert.equal(row.candidateManufacturer, '');
    assert.equal(row.candidateModel, '');
    assert.equal(row.candidateStatus, 'USER_REFERENCE_UNVERIFIED');
    assert.equal(row.approvalStatus, 'UNAPPROVED_RFQ_REQUIRED');
    assert.equal(row.datasheetUrl, '');
    assert.match(row.sourcePolicy, /NO_AUTOMATIC_SELECTION_OR_APPROVAL/);
    assert.ok(row.technicalClarifications.length > 20);
  });
  const csv = DELIVERY.rfqCsv(fixture());
  assert.match(csv, /USER_REFERENCE_UNVERIFIED/);
  assert.doesNotMatch(csv, /APPROVED,/);
});

test('audit JSON binds model hash, ERC/loop evidence, page/project gates and limitations', () => {
  const report = DELIVERY.auditReport(fixture(), renderedDocument());
  assert.equal(report.modelHash, 'fnv1a32-delivery-test');
  assert.equal(report.status, 'REVIEW_REQUIRED');
  assert.equal(report.erc.status, 'PASS');
  assert.equal(report.loopIntegrity.status, 'PARTIAL');
  assert.deepEqual(report.pages.map((page) => page.sheetId), ['S01', 'S02']);
  assert.equal(report.pages[0].renderedSvgAudit.status, 'PASS');
  assert.equal(report.projectGate.status, 'PASS');
  assert.ok(report.limitations.some((item) => item.includes('NOT_EVALUATED')));
  assert.equal(report.procurementPolicy.automaticApprovalAllowed, false);
  assert.match(report.auditHash, /^fnv1a32-/);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.pages[0].pageGate), true);

  const parsed = JSON.parse(DELIVERY.auditJson(fixture(), renderedDocument()));
  assert.equal(parsed.auditHash, report.auditHash);
  assert.equal(parsed.summary.circuitCount, 2);
});

test('audit stays NOT_EVALUATED when rendering gates are absent and is deterministic', () => {
  const first = DELIVERY.auditJson(fixture(), null);
  const second = DELIVERY.auditJson(fixture(), null);
  assert.equal(first, second);
  const report = JSON.parse(first);
  assert.equal(report.status, 'NOT_EVALUATED');
  assert.equal(report.summary.projectGateStatus, 'NOT_EVALUATED');
  assert.deepEqual(report.pages, []);
});

test('browser UMD exposes the same delivery API and uses the preloaded BOM trust boundary', () => {
  const bomSource = fs.readFileSync(path.join(__dirname, '..', 'engine', 'engineering-bom.js'), 'utf8');
  const deliverySource = fs.readFileSync(path.join(__dirname, '..', 'engine', 'engineering-delivery.js'), 'utf8');
  const browserWindow = {};
  new Function('window', bomSource)(browserWindow);
  const loaded = new Function('window', deliverySource + '\nreturn window.SCHEMATIC_ENGINEERING_DELIVERY;')(browserWindow);
  assert.equal(browserWindow.EVSE_ENGINEERING_DELIVERY, loaded);
  assert.equal(typeof loaded.wiringCsv, 'function');
  assert.match(loaded.bomCsv(fixture()), /PART_SELECTION_REQUIRED/);
});
