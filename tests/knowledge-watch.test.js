'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WATCH = require('../scripts/knowledge-watch.js');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'schematicforge-watch-'));
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function publicResolver() {
  return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
}

function evidenceFetch(modelText) {
  return async (_url, options) => {
    if (options.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/html', 'content-length': '0' }
      });
    }
    return new Response(`<html><title>official datasheet</title><body>${modelText}</body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' }
    });
  };
}

test('URL validation rejects non-HTTPS, credentials, local/private IPv4 and non-public IPv6 spellings', () => {
  assert.equal(WATCH.validatePublicHttpsUrl('https://example.com/a.pdf').ok, true);
  const invalid = [
    'http://example.com/a.pdf',
    'https://user:password@example.com/a.pdf',
    'https://localhost/a.pdf',
    'https://127.0.0.1/a.pdf',
    'https://10.2.3.4/a.pdf',
    'https://[::1]/a.pdf',
    'https://[fd00::1]/a.pdf',
    'https://[::ffff:127.0.0.1]/a.pdf',
    'https://[::ffff:7f00:1]/a.pdf'
  ];
  invalid.forEach((value) => assert.equal(WATCH.validatePublicHttpsUrl(value).ok, false, value));
});

test('DNS validation fails closed if any resolved target is private', async () => {
  await assert.rejects(
    WATCH.resolvePublicHost('manufacturer.example', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ]),
    (error) => error && error.code === 'NON_PUBLIC_DNS_TARGET'
  );
});

test('link checks require final-host, MIME and model evidence instead of accepting HTTP 200 alone', async () => {
  const entry = {
    id: 'EQ-K1P', reference: 'K1P', manufacturer: 'Vendor', model: 'ABC-500',
    datasheetUrl: 'https://manufacturer.example/products/abc-500',
    allowedFinalHosts: ['manufacturer.example'], expectedMimeTypes: ['text/html'], modelEvidence: ['ABC-500']
  };
  const good = await WATCH.checkLink(entry, { resolve: publicResolver, fetch: evidenceFetch('ABC-500') });
  assert.equal(good.ok, true);
  assert.equal(good.reviewStatus, 'PASS');
  assert.equal(good.code, 'LINK_OK');
  assert.equal(good.modelEvidenceStatus, 'MATCH');
  assert.match(good.contentSampleSha256, /^sha256-[a-f0-9]{64}$/);

  const mismatch = await WATCH.checkLink(entry, { resolve: publicResolver, fetch: evidenceFetch('unrelated device') });
  assert.equal(mismatch.ok, true);
  assert.equal(mismatch.reviewStatus, 'REVIEW_REQUIRED');
  assert.ok(mismatch.evidenceIssues.includes('MODEL_EVIDENCE_MISMATCH'));
});

test('AI research normalisation can only produce unapproved candidate observations', () => {
  const candidates = WATCH.normaliseResearch({ candidates: [{
    topicId: 'PCN-1', category: 'EOL', title: 'Possible replacement', observation: 'Needs verification',
    affectedItems: ['K1P'], confidence: 0.8, proposedAction: 'Review official PCN',
    evidence: [{ url: 'https://manufacturer.example/pcn', title: 'PCN', sourceType: 'MANUFACTURER' }],
    lifecycle: 'APPROVED', productionMutationAllowed: true, malicious: '<script>'
  }] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].lifecycle, 'CANDIDATE');
  assert.equal(candidates[0].approvalStatus, 'UNREVIEWED');
  assert.equal(candidates[0].productionMutationAllowed, false);
  assert.equal(candidates[0].humanReviewRequired, true);
  assert.equal(Object.hasOwn(candidates[0], 'malicious'), false);
});

test('candidate reports may only be written below the controlled non-symlink output root', (t) => {
  const temporary = temporaryDirectory();
  try {
    const outputRoot = path.join(temporary, 'controlled');
    const valid = path.join(outputRoot, 'nested', 'report.json');
    WATCH.writeCandidateReport(valid, { lifecycle: 'CANDIDATE' }, { outputRoot });
    assert.equal(JSON.parse(fs.readFileSync(valid, 'utf8')).lifecycle, 'CANDIDATE');
    assert.throws(
      () => WATCH.writeCandidateReport(path.join(temporary, 'escaped.json'), {}, { outputRoot }),
      (error) => error && error.code === 'OUTPUT_OUTSIDE_CONTROLLED_ROOT'
    );

    const realDirectory = path.join(outputRoot, 'real');
    const linkedDirectory = path.join(outputRoot, 'linked');
    fs.mkdirSync(realDirectory, { recursive: true });
    try {
      fs.symlinkSync(realDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(
        () => WATCH.writeCandidateReport(path.join(linkedDirectory, 'report.json'), {}, { outputRoot }),
        (error) => error && error.code === 'SYMLINK_FORBIDDEN'
      );
    } catch (error) {
      if (error && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) t.diagnostic('Symlink assertion skipped: ' + error.code);
      else throw error;
    }
  } finally {
    removeDirectory(temporary);
  }
});

test('an unconfigured approved registry is honestly REVIEW_REQUIRED and never mutates production knowledge', async () => {
  const temporary = temporaryDirectory();
  const productionConfig = path.resolve(__dirname, '..', 'knowledge', 'maintenance-watch.json');
  const productionBefore = fs.readFileSync(productionConfig, 'utf8');
  try {
    const config = path.join(temporary, 'config.json');
    const outputRoot = path.join(temporary, 'reports');
    const out = path.join(outputRoot, 'candidate-report.json');
    fs.writeFileSync(config, JSON.stringify({
      approvedSelectionRegistry: { status: 'NOT_CONFIGURED', files: [] },
      approvedComponentLinks: [], researchQueries: []
    }), 'utf8');
    const report = await WATCH.run({ config, out, noAi: true }, { outputRoot });
    assert.equal(report.lifecycle, 'CANDIDATE');
    assert.equal(report.approvalStatus, 'UNREVIEWED');
    assert.equal(report.status, 'REVIEW_REQUIRED');
    assert.equal(report.summary.checkedLinks, 0);
    assert.equal(report.summary.linkRegistryStatus, 'NOT_CONFIGURED');
    assert.equal(report.policy.productionMutationAllowed, false);
    assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).status, 'REVIEW_REQUIRED');
    assert.equal(fs.readFileSync(productionConfig, 'utf8'), productionBefore);
  } finally {
    removeDirectory(temporary);
  }
});
