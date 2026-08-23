'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SCHEMA } = require('./constants');
const { fail } = require('./errors');
const { canonicalJson, sha256, utcNow, nonBlank, assertNoSymlinkPath } = require('./util');
const { loadLatest } = require('./store');
const { assertAutoWiringEligible } = require('./validator');

function buildCatalog(storeRoot, recordIds) {
  if (!Array.isArray(recordIds) || recordIds.length === 0) fail('RECORDS_REQUIRED', 'At least one recordId is required for export');
  const unique = [...new Set(recordIds)];
  if (unique.length !== recordIds.length) fail('DUPLICATE_EXPORT_RECORD', 'Duplicate recordIds are not allowed in one catalog export');
  const records = unique.sort().map(recordId => {
    const latest = loadLatest(storeRoot, recordId);
    assertAutoWiringEligible(latest.record);
    return {
      recordId,
      revision: latest.record.revision,
      recordSha256: latest.digest,
      state: latest.record.state,
      autoWiringAllowed: true,
      source: latest.record.source,
      payload: latest.record.payload
    };
  });
  const versionMaterial = { schemaVersion: SCHEMA.CATALOG, records };
  const catalogVersion = `sha256:${sha256(Buffer.from(canonicalJson(versionMaterial), 'utf8'))}`;
  return {
    schemaVersion: SCHEMA.CATALOG,
    catalogVersion,
    generatedAt: utcNow(),
    records
  };
}

function exportCatalog(storeRoot, recordIds, outPath) {
  if (!nonBlank(outPath)) fail('OUTPUT_REQUIRED', 'An output path is required');
  if (/[\u0000-\u001f\u007f]/u.test(outPath)) fail('INVALID_OUTPUT_PATH', 'Output path cannot contain control characters');
  const catalog = buildCatalog(storeRoot, recordIds);
  const resolved = path.resolve(outPath);
  const parent = path.dirname(resolved);
  assertNoSymlinkPath(parent, { allowMissingLeaf: true });
  fs.mkdirSync(parent, { recursive: true });
  assertNoSymlinkPath(parent);
  const realParent = fs.realpathSync(parent);
  try {
    fs.lstatSync(resolved);
    fail('OUTPUT_EXISTS', `Refusing to overwrite catalog export: ${resolved}`);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, 'wx', 0o444);
    if (!fs.fstatSync(descriptor).isFile()) fail('UNSAFE_OUTPUT_TARGET', `Catalog output is not a regular file: ${resolved}`);
    fs.writeFileSync(descriptor, canonicalJson(catalog));
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error.code === 'EEXIST') fail('OUTPUT_EXISTS', `Refusing to overwrite catalog export: ${resolved}`);
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  assertNoSymlinkPath(parent);
  if (fs.realpathSync(parent) !== realParent) fail('OUTPUT_PATH_CHANGED', 'Output parent changed during catalog export');
  try { fs.chmodSync(resolved, 0o444); } catch { /* best effort */ }
  return { catalog, outPath: resolved };
}

module.exports = { buildCatalog, exportCatalog };
