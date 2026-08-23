'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const wb = require('../lib');
const { candidate, writeFixture } = require('./helpers');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evse-component-wb-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function extractFixture(t, mutate = value => value) {
  const root = tempDir(t);
  const value = mutate(candidate());
  const { sourcePath, candidatePath } = writeFixture(root, value);
  const storeRoot = path.join(root, 'store');
  const result = await wb.extractToStore({
    sourcePath,
    candidatePath,
    documentVersion: 'MANUAL-REV-C',
    storeRoot,
    actor: 'extractor@example.test',
    reason: 'Initial evidence extraction'
  });
  return { root, storeRoot, sourcePath, candidatePath, result, value };
}

test('illegal lifecycle skip EXTRACTED_DRAFT -> APPROVED is rejected without a new revision', async t => {
  const fixture = await extractFixture(t);
  assert.throws(
    () => wb.approve(fixture.storeRoot, fixture.value.recordId, { actor: 'approver', reason: 'skip review' }),
    error => error.code === 'ILLEGAL_STATE_TRANSITION'
  );
  assert.equal(wb.loadHistory(fixture.storeRoot, fixture.value.recordId).length, 1);
});

test('candidate with missing field evidence is rejected', async t => {
  const root = tempDir(t);
  const value = candidate('missing.evidence');
  value.partVariant.model.evidence = [];
  const { sourcePath, candidatePath } = writeFixture(root, value);
  await assert.rejects(
    wb.extractToStore({
      sourcePath,
      candidatePath,
      documentVersion: 'REV-1',
      storeRoot: path.join(root, 'store'),
      actor: 'extractor',
      reason: 'negative validation test'
    }),
    error => error.code === 'VALIDATION_FAILED' && error.details.some(item => item.code === 'EVIDENCE_REQUIRED')
  );
});

test('UNKNOWN terminal data blocks approval and therefore blocks automatic wiring', async t => {
  const fixture = await extractFixture(t, value => {
    value.recordId = 'unknown.terminal';
    value.partVariant.connectors[0].terminals[0].function.value = 'UNKNOWN';
    return value;
  });
  wb.review(fixture.storeRoot, fixture.value.recordId, { actor: 'reviewer', reason: 'Evidence pages checked' });
  assert.throws(
    () => wb.approve(fixture.storeRoot, fixture.value.recordId, { actor: 'approver', reason: 'Attempt approval' }),
    error => error.code === 'APPROVAL_BLOCKED' && error.details.some(item => item.code === 'UNKNOWN_BLOCKS_APPROVAL')
  );
  assert.throws(
    () => wb.assertAutoWiringEligible(wb.loadLatest(fixture.storeRoot, fixture.value.recordId).record),
    error => error.code === 'NOT_APPROVED'
  );
});

test('reviewed and approved multi-connector/multi-unit variant exports to controlled catalog', async t => {
  const fixture = await extractFixture(t);
  wb.review(fixture.storeRoot, fixture.value.recordId, { actor: 'reviewer@example.test', reason: 'Compared all fields to cited evidence' });
  wb.approve(fixture.storeRoot, fixture.value.recordId, { actor: 'approver@example.test', reason: 'Engineering approval for controlled catalog' });
  const outPath = path.join(fixture.root, 'exports', 'catalog.json');
  const exported = wb.exportCatalog(fixture.storeRoot, [fixture.value.recordId], outPath);
  assert.equal(exported.catalog.records[0].state, 'APPROVED');
  assert.equal(exported.catalog.records[0].autoWiringAllowed, true);
  assert.equal(exported.catalog.records[0].payload.partVariant.connectors.length, 2);
  assert.equal(exported.catalog.records[0].payload.partVariant.functionalUnits.length, 2);
  assert.match(exported.catalog.catalogVersion, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')), exported.catalog);
  assert.throws(() => wb.exportCatalog(fixture.storeRoot, [fixture.value.recordId], outPath), error => error.code === 'OUTPUT_EXISTS');
});

test('source SHA-256, document version and immutable revision hash chain are preserved', async t => {
  const fixture = await extractFixture(t);
  const sourceBytes = fs.readFileSync(fixture.sourcePath);
  const expectedSourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const first = wb.loadLatest(fixture.storeRoot, fixture.value.recordId);
  assert.equal(first.record.source.sha256, expectedSourceHash);
  assert.equal(first.record.source.documentVersion, 'MANUAL-REV-C');
  const terminalEvidence = first.record.payload.partVariant.connectors[0].terminals[0].evidence[0];
  assert.equal(terminalEvidence.sourceSha256, expectedSourceHash);
  assert.equal(terminalEvidence.documentVersion, 'MANUAL-REV-C');
  wb.review(fixture.storeRoot, fixture.value.recordId, { actor: 'reviewer', reason: 'reviewed' });
  const history = wb.loadHistory(fixture.storeRoot, fixture.value.recordId);
  assert.equal(history[1].record.previousRevisionSha256, history[0].digest);
  assert.equal(history[1].record.source.sha256, expectedSourceHash);

  const firstPath = history[0].jsonPath;
  try { fs.chmodSync(firstPath, 0o644); } catch { /* best effort on Windows */ }
  fs.appendFileSync(firstPath, ' ');
  assert.throws(() => wb.loadHistory(fixture.storeRoot, fixture.value.recordId), error => error.code === 'REVISION_HASH_MISMATCH');
});

test('PDF import fails explicitly without an extractor and accepts caller-supplied external text', async t => {
  const root = tempDir(t);
  const value = candidate('pdf.external.text');
  const pdfPath = path.join(root, 'manual.pdf');
  const textPath = path.join(root, 'manual.pdf.txt');
  const candidatePath = path.join(root, 'candidate.json');
  fs.writeFileSync(pdfPath, '%PDF-1.7\n% minimal test fixture\n', 'ascii');
  fs.writeFileSync(textPath, 'EVSE component evidence statement\n', 'utf8');
  fs.writeFileSync(candidatePath, JSON.stringify(value), 'utf8');
  await assert.rejects(
    wb.prepareDraft({ sourcePath: pdfPath, candidatePath, documentVersion: 'PDF-REV-1' }),
    error => error.code === 'PDF_TEXT_EXTRACTOR_REQUIRED'
  );
  const prepared = await wb.prepareDraft({ sourcePath: pdfPath, candidatePath, pdfTextPath: textPath, documentVersion: 'PDF-REV-1' });
  assert.equal(prepared.source.mediaType, 'application/pdf');
  assert.equal(prepared.source.extraction.mode, 'EXTERNAL_TEXT_FILE');
});

test('manual JavaScript is rejected as data and never executed', async t => {
  const root = tempDir(t);
  const sentinel = path.join(root, 'executed.txt');
  const jsPath = path.join(root, 'manual.js');
  fs.writeFileSync(jsPath, `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'bad')`, 'utf8');
  await assert.rejects(
    wb.prepareDraft({ sourcePath: jsPath, documentVersion: '1' }),
    error => error.code === 'UNSUPPORTED_SOURCE_TYPE'
  );
  assert.equal(fs.existsSync(sentinel), false);
});

test('JSON evidence source is accepted only with a separate candidate file', async t => {
  const root = tempDir(t);
  const value = candidate('json.source');
  const sourcePath = path.join(root, 'manufacturer-data.json');
  const candidatePath = path.join(root, 'candidate.json');
  fs.writeFileSync(sourcePath, JSON.stringify({ statement: 'EVSE component evidence statement' }), 'utf8');
  fs.writeFileSync(candidatePath, JSON.stringify(value, null, 2), 'utf8');
  const prepared = await wb.prepareDraft({ sourcePath, candidatePath, documentVersion: 'JSON-REV-7' });
  assert.equal(prepared.recordId, 'json.source');
  assert.equal(prepared.source.mediaType, 'application/json');
  assert.equal(prepared.source.extraction.mode, 'JSON_DATA');
});

test('fabricated evidence quote that is absent from source text is rejected', async t => {
  const root = tempDir(t);
  const value = candidate('fabricated.quote');
  value.partVariant.model.evidence[0].quote = 'This phrase is not in the manufacturer source';
  const { sourcePath, candidatePath } = writeFixture(root, value);
  await assert.rejects(
    wb.prepareDraft({ sourcePath, candidatePath, documentVersion: 'REV-1' }),
    error => error.code === 'EVIDENCE_QUOTE_NOT_FOUND'
  );
});

test('deprecated latest revision cannot be exported', async t => {
  const fixture = await extractFixture(t);
  wb.review(fixture.storeRoot, fixture.value.recordId, { actor: 'reviewer', reason: 'reviewed' });
  wb.approve(fixture.storeRoot, fixture.value.recordId, { actor: 'approver', reason: 'approved' });
  wb.deprecate(fixture.storeRoot, fixture.value.recordId, { actor: 'owner', reason: 'superseded by a newer manufacturer manual' });
  assert.throws(
    () => wb.buildCatalog(fixture.storeRoot, [fixture.value.recordId]),
    error => error.code === 'NOT_APPROVED'
  );
});
