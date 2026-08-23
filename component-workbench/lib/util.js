'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { LIMITS, RECORD_ID_RE, WINDOWS_RESERVED_NAME_RE } = require('./constants');
const { fail } = require('./errors');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

function decodeUtf8(bytes, label = 'Input') {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.includes(0)) fail('BINARY_TEXT_REJECTED', `${label} contains NUL bytes and is not accepted as text`);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('INVALID_UTF8', `${label} is not valid UTF-8`);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// JSON.parse intentionally accepts duplicate object keys and keeps the last value.
// That is unsafe for reviewed/audited data because two tools can display different
// meanings for the same bytes. This small syntax walk rejects duplicates before the
// native parser is used; JSON.parse remains the authority for JSON semantics.
function assertNoDuplicateJsonKeys(text, label = 'JSON') {
  let at = 0;
  const whitespace = () => { while (/\s/u.test(text[at] || '')) at += 1; };
  const stringToken = () => {
    const start = at;
    if (text[at] !== '"') fail('INVALID_JSON', `${label} is not valid JSON`);
    at += 1;
    while (at < text.length) {
      const ch = text[at++];
      if (ch === '"') {
        try { return JSON.parse(text.slice(start, at)); } catch { fail('INVALID_JSON', `${label} is not valid JSON`); }
      }
      if (ch === '\\') {
        if (at >= text.length) fail('INVALID_JSON', `${label} is not valid JSON`);
        const escaped = text[at++];
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(at, at + 4))) fail('INVALID_JSON', `${label} is not valid JSON`);
          at += 4;
        } else if (!'"\\/bfnrt'.includes(escaped)) {
          fail('INVALID_JSON', `${label} is not valid JSON`);
        }
      } else if (ch.charCodeAt(0) < 0x20) {
        fail('INVALID_JSON', `${label} is not valid JSON`);
      }
    }
    fail('INVALID_JSON', `${label} is not valid JSON`);
  };
  const value = depth => {
    if (depth > LIMITS.JSON_DEPTH) fail('JSON_TOO_DEEP', `JSON nesting exceeds ${LIMITS.JSON_DEPTH}`);
    whitespace();
    if (text[at] === '{') {
      at += 1;
      whitespace();
      const keys = new Set();
      if (text[at] === '}') { at += 1; return; }
      while (at < text.length) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) fail('DUPLICATE_JSON_KEY', `${label} contains duplicate object key '${key}'`);
        keys.add(key);
        whitespace();
        if (text[at++] !== ':') fail('INVALID_JSON', `${label} is not valid JSON`);
        value(depth + 1);
        whitespace();
        const delimiter = text[at++];
        if (delimiter === '}') return;
        if (delimiter !== ',') fail('INVALID_JSON', `${label} is not valid JSON`);
      }
      fail('INVALID_JSON', `${label} is not valid JSON`);
    }
    if (text[at] === '[') {
      at += 1;
      whitespace();
      if (text[at] === ']') { at += 1; return; }
      while (at < text.length) {
        value(depth + 1);
        whitespace();
        const delimiter = text[at++];
        if (delimiter === ']') return;
        if (delimiter !== ',') fail('INVALID_JSON', `${label} is not valid JSON`);
      }
      fail('INVALID_JSON', `${label} is not valid JSON`);
    }
    if (text[at] === '"') { stringToken(); return; }
    const rest = text.slice(at);
    const scalar = rest.match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!scalar) fail('INVALID_JSON', `${label} is not valid JSON`);
    at += scalar[0].length;
  };
  value(0);
  whitespace();
  if (at !== text.length) fail('INVALID_JSON', `${label} is not valid JSON`);
}

function assertPlainData(value, at = '$', depth = 0) {
  if (depth > LIMITS.JSON_DEPTH) fail('JSON_TOO_DEEP', `JSON nesting exceeds ${LIMITS.JSON_DEPTH} at ${at}`);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('NON_FINITE_NUMBER', `Non-finite number at ${at}`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > LIMITS.STRING_LENGTH) fail('STRING_TOO_LONG', `String is too long at ${at}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > LIMITS.ARRAY_ITEMS) fail('ARRAY_TOO_LARGE', `Array has too many entries at ${at}`);
    value.forEach((item, index) => assertPlainData(item, `${at}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('NON_DATA_VALUE', `Only JSON data is allowed at ${at}`);
  }
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      fail('UNSAFE_JSON_KEY', `Unsafe JSON key '${key}' at ${at}`);
    }
    assertPlainData(value[key], `${at}.${key}`, depth + 1);
  }
}

function parseJsonBytes(bytes, label = 'JSON') {
  const text = decodeUtf8(bytes, label);
  assertNoDuplicateJsonKeys(text, label);
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail('INVALID_JSON', `${label} is not valid JSON: ${error.message}`);
  }
  assertPlainData(value);
  return value;
}

function readLimited(filePath, maxBytes, code = 'FILE_TOO_LARGE') {
  const resolved = path.resolve(filePath);
  let before;
  try { before = fs.lstatSync(resolved, { bigint: true }); } catch (error) {
    if (error.code === 'ENOENT') fail('FILE_NOT_FOUND', `File does not exist: ${resolved}`);
    throw error;
  }
  if (before.isSymbolicLink()) fail('SYMLINK_INPUT_REJECTED', `Symbolic-link input is not accepted: ${resolved}`);
  if (!before.isFile()) fail('NOT_A_FILE', `Not a regular file: ${resolved}`);
  if (before.size > BigInt(maxBytes)) fail(code, `File exceeds limit (${before.size} > ${maxBytes} bytes): ${resolved}`);
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) fail('NOT_A_FILE', `Not a regular file: ${resolved}`);
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      fail('FILE_CHANGED_DURING_READ', `File identity changed while it was being opened: ${resolved}`);
    }
    if (opened.size > BigInt(maxBytes)) fail(code, `File exceeds limit (${opened.size} > ${maxBytes} bytes): ${resolved}`);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
      fail('FILE_CHANGED_DURING_READ', `File changed while it was being read: ${resolved}`);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertRecordId(recordId) {
  if (typeof recordId !== 'string' || !RECORD_ID_RE.test(recordId) || WINDOWS_RESERVED_NAME_RE.test(recordId)) {
    fail('INVALID_RECORD_ID', 'recordId must be 1-128 lowercase ASCII letters/digits with . _ - separators');
  }
}

function recordDirectory(storeRoot, recordId) {
  assertRecordId(recordId);
  if (typeof storeRoot !== 'string' || storeRoot.trim() === '') fail('STORE_ROOT_REQUIRED', 'A non-blank store root is required');
  const root = path.resolve(storeRoot);
  const dir = path.resolve(root, 'records', recordId);
  const recordsRoot = path.resolve(root, 'records') + path.sep;
  if (!dir.startsWith(recordsRoot)) fail('UNSAFE_PATH', 'Resolved record path escaped the store');
  return dir;
}

function utcNow() {
  return new Date().toISOString();
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeForQuote(value) {
  return String(value).normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function sameFile(leftPath, rightPath) {
  const left = fs.statSync(path.resolve(leftPath), { bigint: true });
  const right = fs.statSync(path.resolve(rightPath), { bigint: true });
  return left.dev === right.dev && left.ino === right.ino;
}

function assertNoSymlinkPath(targetPath, { allowMissingLeaf = false } = {}) {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && allowMissingLeaf) return resolved;
      throw error;
    }
    if (stat.isSymbolicLink()) fail('STORE_PATH_SYMLINK', `Managed store paths cannot contain symbolic links or junctions: ${current}`);
  }
  return resolved;
}

function secureRecordsRoot(storeRoot, { create = false } = {}) {
  if (typeof storeRoot !== 'string' || storeRoot.trim() === '') fail('STORE_ROOT_REQUIRED', 'A non-blank store root is required');
  const root = path.resolve(storeRoot);
  if (create) {
    assertNoSymlinkPath(root, { allowMissingLeaf: true });
    fs.mkdirSync(root, { recursive: true });
  }
  assertNoSymlinkPath(root);
  const records = path.join(root, 'records');
  if (create && !fs.existsSync(records)) fs.mkdirSync(records, { recursive: false });
  assertNoSymlinkPath(records);
  const realRoot = fs.realpathSync(root);
  const realRecords = fs.realpathSync(records);
  if (path.dirname(realRecords) !== realRoot) fail('UNSAFE_PATH', 'Resolved records directory escaped the store root');
  return { root, records, realRoot, realRecords };
}

function normalizeActorIdentity(actor) {
  return String(actor).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

module.exports = {
  sha256,
  sortDeep,
  canonicalJson,
  decodeUtf8,
  assertNoDuplicateJsonKeys,
  assertPlainData,
  parseJsonBytes,
  readLimited,
  assertRecordId,
  recordDirectory,
  secureRecordsRoot,
  assertNoSymlinkPath,
  sameFile,
  utcNow,
  nonBlank,
  normalizeForQuote,
  normalizeActorIdentity
};
