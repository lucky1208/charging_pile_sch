'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SCHEMA, STATE, TRANSITIONS, LIMITS, SHA256_RE } = require('./constants');
const { fail } = require('./errors');
const {
  canonicalJson,
  sha256,
  recordDirectory,
  utcNow,
  nonBlank,
  assertRecordId,
  assertNoSymlinkPath,
  secureRecordsRoot,
  readLimited,
  parseJsonBytes,
  decodeUtf8,
  normalizeActorIdentity
} = require('./util');
const { validateRecord, assertApprovalEligible, samePayloadAndSource } = require('./validator');

function revisionName(revision) {
  return String(revision).padStart(6, '0');
}

function revisionsDirectory(storeRoot, recordId) {
  return path.join(recordDirectory(storeRoot, recordId), 'revisions');
}

function secureRecordPaths(storeRoot, recordId) {
  const roots = secureRecordsRoot(storeRoot);
  const recordDir = recordDirectory(storeRoot, recordId);
  const revisionDir = path.join(recordDir, 'revisions');
  assertNoSymlinkPath(recordDir);
  assertNoSymlinkPath(revisionDir);
  const realRecord = fs.realpathSync(recordDir);
  const realRevisions = fs.realpathSync(revisionDir);
  if (path.dirname(realRecord) !== roots.realRecords || path.dirname(realRevisions) !== realRecord) {
    fail('UNSAFE_PATH', 'Resolved record storage escaped its managed parent directory');
  }
  if (!fs.statSync(realRecord).isDirectory() || !fs.statSync(realRevisions).isDirectory()) {
    fail('INVALID_STORE_LAYOUT', 'Record and revisions paths must be regular directories');
  }
  return { ...roots, recordDir, revisionDir, realRecord, realRevisions };
}

function createRecordDirectories(storeRoot, recordId) {
  const roots = secureRecordsRoot(storeRoot, { create: true });
  const recordDir = recordDirectory(storeRoot, recordId);
  try {
    fs.mkdirSync(recordDir, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') fail('RECORD_ALREADY_EXISTS', `Record already exists and cannot be replaced: ${recordId}`);
    throw error;
  }
  const revisionDir = path.join(recordDir, 'revisions');
  fs.mkdirSync(revisionDir, { recursive: false, mode: 0o700 });
  const paths = secureRecordPaths(storeRoot, recordId);
  if (path.dirname(paths.realRecord) !== roots.realRecords) fail('UNSAFE_PATH', 'New record directory escaped the store');
  return paths;
}

function writeExclusive(filePath, bytes) {
  const parent = path.dirname(filePath);
  assertNoSymlinkPath(parent);
  const realParentBefore = fs.realpathSync(parent);
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'wx', 0o444);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) fail('UNSAFE_REVISION_TARGET', `Revision target is not a regular file: ${filePath}`);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error.code === 'EEXIST') fail('IMMUTABLE_REVISION_EXISTS', `Refusing to overwrite immutable file: ${filePath}`);
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  assertNoSymlinkPath(parent);
  if (fs.realpathSync(parent) !== realParentBefore) fail('STORE_CHANGED_DURING_WRITE', `Revision parent changed during write: ${parent}`);
  try { fs.chmodSync(filePath, 0o444); } catch { /* Windows ACLs may ignore POSIX mode; exclusive writes remain authoritative. */ }
}

function writeRevision(storeRoot, record) {
  validateRecord(record);
  const dir = secureRecordPaths(storeRoot, record.recordId).revisionDir;
  const stem = revisionName(record.revision);
  const jsonPath = path.join(dir, `${stem}.json`);
  const digestPath = path.join(dir, `${stem}.sha256`);
  const bytes = Buffer.from(canonicalJson(record), 'utf8');
  const digest = sha256(bytes);
  writeExclusive(jsonPath, bytes);
  try {
    writeExclusive(digestPath, Buffer.from(`${digest}\n`, 'ascii'));
  } catch (error) {
    // A revision without its digest is never considered valid. Leave it visible for forensic recovery.
    throw error;
  }
  return { record, digest, jsonPath };
}

function listRevisionFiles(storeRoot, recordId) {
  let dir;
  try { dir = secureRecordPaths(storeRoot, recordId).revisionDir; } catch (error) {
    if (error.code === 'ENOENT') fail('RECORD_NOT_FOUND', `Record does not exist: ${recordId}`);
    throw error;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const names = new Set(entries.map(entry => entry.name));
  for (const entry of entries) {
    if (/^\d+\.(?:json|sha256)$/i.test(entry.name) && !/^\d{6}\.(?:json|sha256)$/.test(entry.name)) {
      fail('NONCANONICAL_REVISION_FILE', `Non-canonical revision artifact: ${entry.name}`);
    }
    if (/^\d{6}\.(?:json|sha256)$/.test(entry.name) && !entry.isFile()) {
      fail('UNSAFE_REVISION_FILE', `Revision artifacts must be regular files, not links or directories: ${entry.name}`);
    }
  }
  const files = entries.filter(entry => /^\d{6}\.json$/.test(entry.name)).map(entry => entry.name).sort();
  for (const name of names) {
    if (/^\d{6}\.sha256$/.test(name) && !names.has(name.replace(/\.sha256$/, '.json'))) {
      fail('ORPHAN_REVISION_DIGEST', `Digest has no corresponding revision JSON: ${name}`);
    }
  }
  return files;
}

function loadHistory(storeRoot, recordId) {
  assertRecordId(recordId);
  const dir = revisionsDirectory(storeRoot, recordId);
  const files = listRevisionFiles(storeRoot, recordId);
  if (files.length === 0) fail('RECORD_NOT_FOUND', `Record has no revisions: ${recordId}`);
  const entries = [];
  let prior = null;
  for (let index = 0; index < files.length; index += 1) {
    const expectedRevision = index + 1;
    const expectedName = `${revisionName(expectedRevision)}.json`;
    if (files[index] !== expectedName) fail('REVISION_GAP', `Expected ${expectedName}, found ${files[index]}`);
    const jsonPath = path.join(dir, files[index]);
    const bytes = readLimited(jsonPath, LIMITS.RECORD_BYTES, 'RECORD_TOO_LARGE');
    const digest = sha256(bytes);
    const digestPath = path.join(dir, `${revisionName(expectedRevision)}.sha256`);
    if (!fs.existsSync(digestPath)) fail('MISSING_REVISION_DIGEST', `Missing immutable digest: ${digestPath}`);
    const expectedDigest = decodeUtf8(readLimited(digestPath, LIMITS.DIGEST_BYTES, 'DIGEST_TOO_LARGE'), 'Revision digest').trim();
    if (!SHA256_RE.test(expectedDigest) || expectedDigest !== digest) fail('REVISION_HASH_MISMATCH', `Revision ${expectedRevision} hash does not match its digest`);
    let record;
    try { record = parseJsonBytes(bytes, `Revision ${expectedRevision}`); } catch (error) {
      if (error && error.code) throw error;
      fail('CORRUPT_REVISION_JSON', `Revision ${expectedRevision} is invalid JSON: ${error.message}`);
    }
    validateRecord(record);
    if (record.recordId !== recordId) fail('RECORD_ID_MISMATCH', `Revision ${expectedRevision} has a different recordId`);
    if (record.revision !== expectedRevision) fail('REVISION_NUMBER_MISMATCH', `Revision file ${files[index]} contains revision ${record.revision}`);
    if (!prior) {
      if (record.previousRevisionSha256 !== null) fail('INVALID_GENESIS_LINK', 'First revision previousRevisionSha256 must be null');
      if (record.state !== STATE.EXTRACTED_DRAFT) fail('INVALID_GENESIS_STATE', `First revision must be ${STATE.EXTRACTED_DRAFT}`);
      if (record.change.action !== 'EXTRACT') fail('INVALID_GENESIS_ACTION', 'First revision action must be EXTRACT');
    } else {
      if (record.previousRevisionSha256 !== prior.digest) fail('BROKEN_REVISION_CHAIN', `Revision ${expectedRevision} does not link to the exact prior revision`);
      if (TRANSITIONS[prior.record.state] !== record.state) fail('ILLEGAL_STATE_HISTORY', `Illegal stored transition ${prior.record.state} -> ${record.state}`);
      const expectedAction = record.state === STATE.REVIEWED ? 'REVIEW' : record.state === STATE.APPROVED ? 'APPROVE' : 'DEPRECATE';
      if (record.change.action !== expectedAction) fail('INVALID_HISTORY_ACTION', `State ${record.state} requires action ${expectedAction}`);
      if (!samePayloadAndSource(prior.record, record)) fail('MUTATED_REVISION_DATA', 'Payload/source changed during a lifecycle-only transition');
      if (Date.parse(record.createdAt) < Date.parse(prior.record.createdAt)) fail('NON_MONOTONIC_HISTORY_TIME', 'Revision timestamps moved backwards');
      const actor = normalizeActorIdentity(record.actor);
      const priorActors = entries.map(item => normalizeActorIdentity(item.record.actor));
      if (priorActors.includes(actor)) {
        fail('ROLE_SEPARATION_REQUIRED', `${record.change.action} actor must be distinct from every prior lifecycle actor`);
      }
    }
    const entry = { record, digest, jsonPath };
    entries.push(entry);
    prior = entry;
  }
  return entries;
}

function loadLatest(storeRoot, recordId) {
  return loadHistory(storeRoot, recordId).at(-1);
}

function requireAuditText(actor, reason) {
  if (!nonBlank(actor)) fail('ACTOR_REQUIRED', 'A non-blank reviewer/approver identity is required');
  if (!nonBlank(reason)) fail('REASON_REQUIRED', 'A non-blank audit reason is required');
  if (actor.length > LIMITS.ACTOR_LENGTH || /[\u0000-\u001f\u007f]/u.test(actor)) {
    fail('INVALID_ACTOR', `Actor must be at most ${LIMITS.ACTOR_LENGTH} characters without control characters`);
  }
  if (reason.length > LIMITS.REASON_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reason)) {
    fail('INVALID_REASON', `Reason must be at most ${LIMITS.REASON_LENGTH} characters without unsafe control characters`);
  }
}

function createDraft(storeRoot, prepared, audit) {
  if (!audit || typeof audit !== 'object') fail('AUDIT_REQUIRED', 'Audit actor and reason are required');
  requireAuditText(audit.actor, audit.reason);
  createRecordDirectories(storeRoot, prepared.recordId);
  const record = {
    schemaVersion: SCHEMA.RECORD,
    recordId: prepared.recordId,
    revision: 1,
    state: STATE.EXTRACTED_DRAFT,
    createdAt: utcNow(),
    actor: audit.actor.trim(),
    previousRevisionSha256: null,
    change: { action: 'EXTRACT', reason: audit.reason.trim() },
    source: prepared.source,
    payload: prepared.payload
  };
  return writeRevision(storeRoot, record);
}

function transition(storeRoot, recordId, targetState, audit) {
  if (!audit || typeof audit !== 'object') fail('AUDIT_REQUIRED', 'Audit actor and reason are required');
  requireAuditText(audit.actor, audit.reason);
  const history = loadHistory(storeRoot, recordId);
  const prior = history.at(-1);
  const allowed = TRANSITIONS[prior.record.state];
  if (targetState !== allowed) {
    fail('ILLEGAL_STATE_TRANSITION', `Cannot transition ${prior.record.state} -> ${targetState}; expected ${allowed || 'no further state'}`);
  }
  const actorIdentity = normalizeActorIdentity(audit.actor);
  if (history.some(entry => normalizeActorIdentity(entry.record.actor) === actorIdentity)) {
    fail('ROLE_SEPARATION_REQUIRED', `${targetState} actor must be distinct from every prior lifecycle actor`);
  }
  if (targetState === STATE.APPROVED) assertApprovalEligible(prior.record);
  const action = targetState === STATE.REVIEWED ? 'REVIEW' : targetState === STATE.APPROVED ? 'APPROVE' : 'DEPRECATE';
  const record = {
    ...prior.record,
    revision: prior.record.revision + 1,
    state: targetState,
    createdAt: utcNow(),
    actor: audit.actor.trim(),
    previousRevisionSha256: prior.digest,
    change: { action, reason: audit.reason.trim() }
  };
  return writeRevision(storeRoot, record);
}

function review(storeRoot, recordId, audit) {
  return transition(storeRoot, recordId, STATE.REVIEWED, audit);
}

function approve(storeRoot, recordId, audit) {
  return transition(storeRoot, recordId, STATE.APPROVED, audit);
}

function deprecate(storeRoot, recordId, audit) {
  return transition(storeRoot, recordId, STATE.DEPRECATED, audit);
}

function historySummary(storeRoot, recordId) {
  return loadHistory(storeRoot, recordId).map(entry => ({
    revision: entry.record.revision,
    state: entry.record.state,
    createdAt: entry.record.createdAt,
    actor: entry.record.actor,
    action: entry.record.change.action,
    reason: entry.record.change.reason,
    sha256: entry.digest,
    previousRevisionSha256: entry.record.previousRevisionSha256
  }));
}

module.exports = {
  createDraft,
  transition,
  review,
  approve,
  deprecate,
  loadHistory,
  loadLatest,
  historySummary,
  writeRevision
};
