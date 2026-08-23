'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const wb = require('../lib');
const { readLimited, canonicalJson } = require('../lib/util');
const { candidate, writeFixture, QUOTE } = require('./helpers');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evse-component-security-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function extract(t, options = {}) {
  const root = tempDir(t);
  const value = options.value || candidate(options.recordId || 'security.fixture');
  const { sourcePath, candidatePath } = writeFixture(root, value);
  const storeRoot = path.join(root, 'store');
  const result = await wb.extractToStore({
    sourcePath,
    candidatePath,
    documentVersion: 'SEC-REV-1',
    storeRoot,
    actor: options.actor || 'extractor@example.test',
    reason: 'Security test extraction'
  });
  return { root, value, sourcePath, candidatePath, storeRoot, result };
}

function makeLinkOrSkip(t, target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'UNKNOWN') {
      t.skip(`Symbolic links are unavailable on this host: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test('public API does not expose lifecycle-bypass write primitives', () => {
  assert.equal(wb.writeRevision, undefined);
  assert.equal(wb.createDraft, undefined);
  assert.equal(wb.transition, undefined);
});

test('recordId traversal and Windows device names are rejected', async t => {
  const root = tempDir(t);
  const traversal = candidate('safe.id');
  traversal.recordId = '../../escape';
  const files = writeFixture(root, traversal);
  await assert.rejects(
    wb.prepareDraft({ ...files, documentVersion: '1' }),
    error => error.code === 'VALIDATION_FAILED'
  );
  assert.throws(() => wb.loadLatest(path.join(root, 'store'), '..'), error => error.code === 'INVALID_RECORD_ID');

  const reserved = candidate('con');
  const reservedRoot = path.join(root, 'reserved');
  fs.mkdirSync(reservedRoot);
  const reservedFiles = writeFixture(reservedRoot, reserved);
  await assert.rejects(
    wb.prepareDraft({ ...reservedFiles, documentVersion: '1' }),
    error => error.code === 'VALIDATION_FAILED' && error.details.some(item => item.code === 'RESERVED_RECORD_ID')
  );
});

test('candidate JSON requires fatal UTF-8 and rejects duplicate keys', async t => {
  const root = tempDir(t);
  const sourcePath = path.join(root, 'manual.txt');
  const candidatePath = path.join(root, 'candidate.json');
  fs.writeFileSync(sourcePath, `${QUOTE}\n`, 'utf8');
  fs.writeFileSync(candidatePath, Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d]));
  await assert.rejects(
    wb.prepareDraft({ sourcePath, candidatePath, documentVersion: '1' }),
    error => error.code === 'INVALID_UTF8'
  );

  fs.writeFileSync(candidatePath, '{"schemaVersion":"one","schemaVersion":"two"}', 'utf8');
  await assert.rejects(
    wb.prepareDraft({ sourcePath, candidatePath, documentVersion: '1' }),
    error => error.code === 'DUPLICATE_JSON_KEY'
  );
});

test('JSON candidate cannot provide circular self-evidence, including a byte-for-byte copy', async t => {
  const root = tempDir(t);
  const bytes = Buffer.from(JSON.stringify(candidate('circular.json')), 'utf8');
  const sourcePath = path.join(root, 'source.json');
  const candidatePath = path.join(root, 'candidate.json');
  fs.writeFileSync(sourcePath, bytes);
  fs.writeFileSync(candidatePath, bytes);
  await assert.rejects(
    wb.prepareDraft({ sourcePath, documentVersion: '1' }),
    error => error.code === 'CANDIDATE_REQUIRED_FOR_JSON_SOURCE'
  );
  await assert.rejects(
    wb.prepareDraft({ sourcePath, candidatePath, documentVersion: '1' }),
    error => error.code === 'CIRCULAR_SELF_EVIDENCE'
  );
});

test('evidence quote must occur on its stated extracted PDF page', async t => {
  const root = tempDir(t);
  const value = candidate('pdf.page.boundary');
  value.partVariant.model.evidence[0].page = 2;
  const pdfPath = path.join(root, 'manual.pdf');
  const textPath = path.join(root, 'manual.txt');
  const candidatePath = path.join(root, 'candidate.json');
  fs.writeFileSync(pdfPath, '%PDF-1.7\n', 'ascii');
  fs.writeFileSync(textPath, `${QUOTE}\fSecond page without the cited sentence`, 'utf8');
  fs.writeFileSync(candidatePath, JSON.stringify(value), 'utf8');
  await assert.rejects(
    wb.prepareDraft({ sourcePath: pdfPath, pdfTextPath: textPath, candidatePath, documentVersion: '1' }),
    error => error.code === 'EVIDENCE_QUOTE_NOT_FOUND'
  );
});

test('extractor, reviewer and approver identities must be distinct after normalization', async t => {
  const fixture = await extract(t, { actor: 'Engineer@Example.Test' });
  assert.throws(
    () => wb.review(fixture.storeRoot, fixture.value.recordId, {
      actor: '  engineer@example.test  ',
      reason: 'Attempted self review'
    }),
    error => error.code === 'ROLE_SEPARATION_REQUIRED'
  );
  wb.review(fixture.storeRoot, fixture.value.recordId, { actor: 'reviewer@example.test', reason: 'Independent review' });
  assert.throws(
    () => wb.approve(fixture.storeRoot, fixture.value.recordId, {
      actor: 'REVIEWER@example.test',
      reason: 'Attempted self approval'
    }),
    error => error.code === 'ROLE_SEPARATION_REQUIRED'
  );
  const history = wb.loadHistory(fixture.storeRoot, fixture.value.recordId);
  assert.equal(history.length, 2);
  assert.equal(history.at(-1).record.state, 'REVIEWED');
});

test('source and candidate symbolic links are rejected without executing their contents', async t => {
  const root = tempDir(t);
  const sentinel = path.join(root, 'executed.txt');
  const realSource = path.join(root, 'real.txt');
  const linkedSource = path.join(root, 'linked.txt');
  const candidatePath = path.join(root, 'candidate.json');
  fs.writeFileSync(realSource, `${QUOTE}\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'bad')`, 'utf8');
  fs.writeFileSync(candidatePath, JSON.stringify(candidate('linked.input')), 'utf8');
  if (!makeLinkOrSkip(t, realSource, linkedSource, 'file')) return;
  await assert.rejects(
    wb.prepareDraft({ sourcePath: linkedSource, candidatePath, documentVersion: '1' }),
    error => error.code === 'SYMLINK_INPUT_REJECTED'
  );
  assert.equal(fs.existsSync(sentinel), false);
});

test('managed store refuses a records junction and never writes through it', async t => {
  const root = tempDir(t);
  const storeRoot = path.join(root, 'store');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(storeRoot);
  fs.mkdirSync(outside);
  if (!makeLinkOrSkip(t, outside, path.join(storeRoot, 'records'), 'junction')) return;
  const value = candidate('junction.escape');
  const inputRoot = path.join(root, 'input');
  fs.mkdirSync(inputRoot);
  const { sourcePath, candidatePath } = writeFixture(inputRoot, value);
  await assert.rejects(
    wb.extractToStore({
      sourcePath,
      candidatePath,
      documentVersion: '1',
      storeRoot,
      actor: 'extractor',
      reason: 'Must not escape'
    }),
    error => error.code === 'STORE_PATH_SYMLINK'
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('readLimited detects a file swapped between lstat and open', t => {
  const root = tempDir(t);
  const target = path.join(root, 'input.txt');
  const original = path.join(root, 'original.txt');
  fs.writeFileSync(target, 'original bytes', 'utf8');
  const nativeOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function hookedOpen(filePath, ...args) {
    if (!swapped && path.resolve(filePath) === path.resolve(target)) {
      swapped = true;
      fs.renameSync(target, original);
      fs.writeFileSync(target, 'attacker bytes', 'utf8');
    }
    return nativeOpen.call(fs, filePath, ...args);
  };
  try {
    assert.throws(() => readLimited(target, 1024), error => error.code === 'FILE_CHANGED_DURING_READ');
  } finally {
    fs.openSync = nativeOpen;
  }
});

test('revision artifacts cannot be replaced by symbolic links', async t => {
  const fixture = await extract(t);
  const revision = path.join(fixture.storeRoot, 'records', fixture.value.recordId, 'revisions', '000001.json');
  const outside = path.join(fixture.root, 'outside-revision.json');
  fs.copyFileSync(revision, outside);
  try { fs.chmodSync(revision, 0o666); } catch { /* Windows may ignore mode bits. */ }
  fs.rmSync(revision, { force: true });
  if (!makeLinkOrSkip(t, outside, revision, 'file')) return;
  assert.throws(
    () => wb.loadHistory(fixture.storeRoot, fixture.value.recordId),
    error => error.code === 'UNSAFE_REVISION_FILE'
  );
});

test('rehashing a semantically tampered record still fails invariant validation', async t => {
  const fixture = await extract(t);
  const revisions = path.join(fixture.storeRoot, 'records', fixture.value.recordId, 'revisions');
  const jsonPath = path.join(revisions, '000001.json');
  const digestPath = path.join(revisions, '000001.sha256');
  const record = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  record.payload.partVariant.model.evidence[0].sourceFile = 'different-manual.txt';
  const bytes = Buffer.from(canonicalJson(record), 'utf8');
  for (const file of [jsonPath, digestPath]) {
    try { fs.chmodSync(file, 0o666); } catch { /* best effort */ }
  }
  fs.writeFileSync(jsonPath, bytes);
  fs.writeFileSync(digestPath, `${crypto.createHash('sha256').update(bytes).digest('hex')}\n`, 'ascii');
  assert.throws(
    () => wb.loadHistory(fixture.storeRoot, fixture.value.recordId),
    error => error.code === 'INVALID_RECORD' && error.details.some(item => item.code === 'SOURCE_FILE_MISMATCH')
  );
});

test('non-canonical high-number revision artifacts block exporting an older approval', async t => {
  const fixture = await extract(t);
  wb.review(fixture.storeRoot, fixture.value.recordId, { actor: 'reviewer', reason: 'reviewed' });
  wb.approve(fixture.storeRoot, fixture.value.recordId, { actor: 'approver', reason: 'approved' });
  const revisions = path.join(fixture.storeRoot, 'records', fixture.value.recordId, 'revisions');
  fs.writeFileSync(path.join(revisions, '1000000.json'), '{}', 'utf8');
  assert.throws(
    () => wb.buildCatalog(fixture.storeRoot, [fixture.value.recordId]),
    error => error.code === 'NONCANONICAL_REVISION_FILE'
  );
});

test('catalog export rejects a symbolic-link parent and preserves the outside directory', async t => {
  const fixture = await extract(t, { recordId: 'export.parent.link' });
  wb.review(fixture.storeRoot, fixture.value.recordId, { actor: 'reviewer', reason: 'reviewed' });
  wb.approve(fixture.storeRoot, fixture.value.recordId, { actor: 'approver', reason: 'approved' });
  const outside = path.join(fixture.root, 'outside-export');
  const linkedParent = path.join(fixture.root, 'linked-export');
  fs.mkdirSync(outside);
  if (!makeLinkOrSkip(t, outside, linkedParent, 'junction')) return;
  assert.throws(
    () => wb.exportCatalog(fixture.storeRoot, [fixture.value.recordId], path.join(linkedParent, 'catalog.json')),
    error => error.code === 'STORE_PATH_SYMLINK'
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});
