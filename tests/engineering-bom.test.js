'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BOM = require('../engine/engineering-bom.js');
const APPROVAL_SECRET = 'test-only-bom-approval-secret-with-strong-entropy-0123456789';

function fixture() {
  return {
    schedule: [
      { tag: 'K1P/K1N', name: '直流接触器', spec: '500A·线圈24VDC' },
      { tag: 'M1', name: '功率模块', spec: '4 × 30kW·200–1000V' }
    ],
    design: {
      project: { id: 'PRJ-BOM-TEST' },
      modelHash: 'sha256-authoritative-model-test',
      instances: [
        { id: 'EQ-K1N', tag: 'K1N', kind: 'dc-contactor', name: '负极接触器', system: 'gun', quantity: 1 },
        { id: 'EQ-M1', tag: 'M1', kind: 'power-module-array', name: '充电功率模块阵列', system: 'power', quantity: 4 },
        { id: 'EQ-K1P', tag: 'K1P', kind: 'dc-contactor', name: '正极接触器', system: 'gun', quantity: 1 }
      ]
    }
  };
}

test('build covers every authoritative instance exactly once and remains stable', () => {
  const first = BOM.build(fixture());
  const reversed = fixture();
  reversed.design.instances.reverse();
  reversed.schedule.reverse();
  const second = BOM.build(reversed);

  assert.deepEqual(first, second);
  assert.equal(first.bomHash, second.bomHash);
  assert.deepEqual(first.columns, [
    '位号', '类别', '设备名称', '型号', '参考推荐厂家', '关键参数', '数量', '说明手册下载'
  ]);
  assert.equal(first.coverage.ok, true);
  assert.equal(first.coverage.designInstanceCount, 3);
  assert.equal(first.coverage.bomRowCount, 3);
  assert.equal(first.coverage.physicalQuantityTotal, 6);
  assert.deepEqual(first.rows.map((row) => row['位号']), ['K1N', 'K1P', 'M1']);
  assert.equal(first.rows[0]['关键参数'], '500A·线圈24VDC');
  assert.equal(first.rows[2]['数量'], 4);
});

test('unapproved research never leaks into purchasing fields', () => {
  const candidate = BOM.normaliseResearchCandidate({
    instanceId: 'EQ-K1P', reference: 'K1P', model: 'ABC-500', manufacturer: '某厂',
    datasheetUrl: 'https://manufacturer.example/datasheets/abc-500.pdf',
    evidence: [{ url: 'https://manufacturer.example/abc-500', sourceType: 'MANUFACTURER' }]
  });
  const output = BOM.build(fixture(), { approvedSelections: [candidate] });
  const row = output.rows.find((item) => item['位号'] === 'K1P');
  assert.equal(candidate.lifecycle, 'CANDIDATE');
  assert.equal(row['型号'], 'PART_SELECTION_REQUIRED');
  assert.equal(row['参考推荐厂家'], '待批准');
  assert.equal(row['说明手册下载'], '待批准');
});

test('only an intact explicitly approved candidate populates model, maker and datasheet', () => {
  const candidate = BOM.normaliseResearchCandidate({
    instanceId: 'EQ-K1P', reference: 'K1P', model: 'ABC-500', manufacturer: '厂家A',
    datasheetUrl: 'https://manufacturer.example/datasheets/abc-500.pdf',
    evidence: ['https://manufacturer.example/abc-500']
  });
  const approved = BOM.approveCandidate(candidate, {
    decision: 'APPROVE', approvedBy: '电气工程师 E01', approvedAt: '2026-09-05T10:00:00+08:00',
    basis: '已核对厂家官方数据手册与项目额定值'
  }, fixture(), { approvalSecret: APPROVAL_SECRET });
  const output = BOM.build(fixture(), { approvedSelections: [approved], approvalSecret: APPROVAL_SECRET });
  const row = output.rows.find((item) => item['位号'] === 'K1P');
  assert.equal(row['型号'], 'ABC-500');
  assert.equal(row['参考推荐厂家'], '厂家A');
  assert.equal(row['说明手册下载'], 'https://manufacturer.example/datasheets/abc-500.pdf');
  assert.equal(output.trace.find((item) => item.instanceId === 'EQ-K1P').selectionStatus, 'APPROVED');
  assert.match(approved.approvalSignature, /^hmac-sha256-[a-f0-9]{64}$/);
  assert.equal(approved.binding.projectId, 'PRJ-BOM-TEST');
  assert.equal(approved.binding.modelHash, 'sha256-authoritative-model-test');
});

test('datasheet links are HTTPS-only and credentials/local hosts are rejected', () => {
  assert.equal(BOM.validateDatasheetUrl('https://example.com/a.pdf').ok, true);
  assert.equal(BOM.validateDatasheetUrl('http://example.com/a.pdf').code, 'HTTPS_REQUIRED');
  assert.equal(BOM.validateDatasheetUrl('https://user:pass@example.com/a.pdf').code, 'CREDENTIALS_FORBIDDEN');
  assert.equal(BOM.validateDatasheetUrl('https://localhost/a.pdf').code, 'PUBLIC_HOST_REQUIRED');
  assert.equal(BOM.validateDatasheetUrl('https://10.0.0.1/a.pdf').code, 'PUBLIC_HOST_REQUIRED');
  assert.equal(BOM.validateDatasheetUrl('https://[::1]/a.pdf').code, 'PUBLIC_HOST_REQUIRED');

  const invalid = BOM.normaliseResearchCandidate({
    instanceId: 'EQ-K1P', model: 'ABC-500', manufacturer: '厂家A', datasheetUrl: 'http://example.com/a.pdf'
  });
  assert.equal(invalid.validation.complete, false);
  assert.throws(() => BOM.approveCandidate(invalid, {
    decision: 'APPROVE', approvedBy: 'E01', approvedAt: '2026-09-05T10:00:00Z', basis: '官方手册'
  }, fixture(), { approvalSecret: APPROVAL_SECRET }), /Incomplete candidate/i);
});

test('candidate integrity and duplicate approved selections fail closed', () => {
  const candidate = BOM.normaliseResearchCandidate({
    instanceId: 'EQ-K1P', model: 'ABC-500', manufacturer: '厂家A', datasheetUrl: 'https://example.com/a.pdf',
    evidence: ['https://example.com/product/a']
  });
  const tampered = Object.assign({}, candidate, { model: 'ALTERED' });
  assert.throws(() => BOM.approveCandidate(tampered, {
    decision: 'APPROVE', approvedBy: 'E01', approvedAt: '2026-09-05T10:00:00Z', basis: '已核对'
  }, fixture(), { approvalSecret: APPROVAL_SECRET }), /modified/i);

  const approved = BOM.approveCandidate(candidate, {
    decision: 'APPROVE', approvedBy: 'E01', approvedAt: '2026-09-05T10:00:00Z', basis: '已核对'
  }, fixture(), { approvalSecret: APPROVAL_SECRET });
  assert.throws(() => BOM.build(fixture(), {
    approvedSelections: [approved, approved], approvalSecret: APPROVAL_SECRET
  }), /Multiple approved selections/i);
});

test('approval requires trusted secret, evidence, strict time and current design binding', () => {
  const noEvidence = BOM.normaliseResearchCandidate({
    instanceId: 'EQ-K1P', model: 'ABC-500', manufacturer: '厂家A',
    datasheetUrl: 'https://manufacturer.example/datasheets/abc-500.pdf'
  });
  assert.equal(noEvidence.validation.complete, false);
  assert.ok(noEvidence.validation.errors.includes('EVIDENCE_REQUIRED'));
  assert.throws(() => BOM.approveCandidate(noEvidence, {
    decision: 'APPROVE', approvedBy: 'E01', approvedAt: '2026-09-05T10:00:00Z', basis: '核对'
  }, fixture(), { approvalSecret: APPROVAL_SECRET }), /Incomplete candidate/i);

  const candidate = BOM.normaliseResearchCandidate({
    instanceId: 'EQ-K1P', model: 'ABC-500', manufacturer: '厂家A',
    datasheetUrl: 'https://manufacturer.example/datasheets/abc-500.pdf',
    evidence: ['https://manufacturer.example/products/abc-500']
  });
  assert.throws(() => BOM.approveCandidate(candidate, {
    decision: 'APPROVE', approvedBy: 'E01', approvedAt: 'not-a-date', basis: '核对'
  }, fixture(), { approvalSecret: APPROVAL_SECRET }), /strict ISO/i);
  assert.throws(() => BOM.approveCandidate(candidate, {
    decision: 'APPROVE', approvedBy: 'E01', approvedAt: '2026-09-05T10:00:00Z', basis: '核对'
  }, fixture()), /APPROVAL_SECRET/i);

  const approved = BOM.approveCandidate(candidate, {
    decision: 'APPROVE', approvedBy: 'E01', approvedAt: '2026-09-05T10:00:00Z', basis: '核对'
  }, fixture(), { approvalSecret: APPROVAL_SECRET });
  const changed = fixture();
  changed.design.instances.find((item) => item.id === 'EQ-K1P').ratedCurrentA = 1000;
  const stale = BOM.build(changed, { approvedSelections: [approved], approvalSecret: APPROVAL_SECRET });
  assert.equal(stale.rows.find((row) => row['位号'] === 'K1P')['型号'], 'PART_SELECTION_REQUIRED');
  assert.equal(stale.selectionPolicy.rejectedApprovalCount, 1);
  assert.equal(stale.selectionPolicy.rejectedApprovals[0].code, 'INVALID_OR_STALE_SIGNATURE');
});

test('browser runtime and missing secret can never accept an APPROVED record', () => {
  const candidate = BOM.normaliseResearchCandidate({
    instanceId: 'EQ-K1P', model: 'ABC-500', manufacturer: '厂家A',
    datasheetUrl: 'https://manufacturer.example/datasheets/abc-500.pdf',
    evidence: ['https://manufacturer.example/products/abc-500']
  });
  const approved = BOM.approveCandidate(candidate, {
    decision: 'APPROVE', approvedBy: 'E01', approvedAt: '2026-09-05T10:00:00Z', basis: '核对'
  }, fixture(), { approvalSecret: APPROVAL_SECRET });
  const noSecret = BOM.build(fixture(), { approvedSelections: [approved] });
  assert.equal(noSecret.trace.find((item) => item.instanceId === 'EQ-K1P').selectionStatus, 'PART_SELECTION_REQUIRED');
  assert.equal(noSecret.selectionPolicy.trustedApprovalBoundaryAvailable, false);

  const source = fs.readFileSync(path.join(__dirname, '..', 'engine', 'engineering-bom.js'), 'utf8');
  const browserWindow = {};
  const browserBom = new Function('window', source + '\nreturn window.SCHEMATIC_ENGINEERING_BOM;')(browserWindow);
  const browserOutput = browserBom.build(fixture(), { approvedSelections: [approved], approvalSecret: APPROVAL_SECRET });
  assert.equal(browserOutput.trace.find((item) => item.instanceId === 'EQ-K1P').selectionStatus, 'PART_SELECTION_REQUIRED');
  assert.throws(() => browserBom.approveCandidate(candidate, {}, fixture(), { approvalSecret: APPROVAL_SECRET }), /Node\.js|server\/offline/i);
});

test('CSV export uses the requested fixed column order and RFC-style escaping', () => {
  const output = BOM.build(fixture());
  output.rows[0]['设备名称'] = '接触器, "负极"';
  const csv = BOM.toCsv(output);
  assert.ok(csv.startsWith('\uFEFF位号,类别,设备名称,型号,参考推荐厂家,关键参数,数量,说明手册下载\r\n'));
  assert.match(csv, /"\u63a5\u89e6\u5668, ""\u8d1f\u6781"""/);
});

test('UMD module exposes the same API in a browser-like scope', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'engine', 'engineering-bom.js'), 'utf8');
  const browserWindow = {};
  const loaded = new Function('window', source + '\nreturn window.SCHEMATIC_ENGINEERING_BOM;')(browserWindow);
  assert.equal(typeof loaded.build, 'function');
  assert.equal(browserWindow.EVSE_ENGINEERING_BOM, loaded);
});

test('invalid or duplicate authoritative instances fail closed', () => {
  assert.throws(() => BOM.build({ instances: [{ id: 'X', quantity: 0 }] }), /Invalid physical quantity/i);
  assert.throws(() => BOM.build({ instances: [{ id: 'X' }, { id: 'X' }] }), /Duplicate design instance/i);
});
