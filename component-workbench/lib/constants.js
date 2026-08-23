'use strict';

const SCHEMA = Object.freeze({
  CANDIDATE: 'evse.component-candidate/v1',
  RECORD: 'evse.component-record/v1',
  CATALOG: 'evse.controlled-component-catalog/v1'
});

const STATE = Object.freeze({
  EXTRACTED_DRAFT: 'EXTRACTED_DRAFT',
  REVIEWED: 'REVIEWED',
  APPROVED: 'APPROVED',
  DEPRECATED: 'DEPRECATED'
});

const TRANSITIONS = Object.freeze({
  [STATE.EXTRACTED_DRAFT]: STATE.REVIEWED,
  [STATE.REVIEWED]: STATE.APPROVED,
  [STATE.APPROVED]: STATE.DEPRECATED
});

const LIMITS = Object.freeze({
  SOURCE_BYTES: 25 * 1024 * 1024,
  CANDIDATE_BYTES: 2 * 1024 * 1024,
  EXTRACTED_TEXT_BYTES: 10 * 1024 * 1024,
  RECORD_BYTES: 32 * 1024 * 1024,
  DIGEST_BYTES: 128,
  JSON_DEPTH: 80,
  ARRAY_ITEMS: 10000,
  STRING_LENGTH: 200000,
  ACTOR_LENGTH: 320,
  REASON_LENGTH: 4000,
  DOCUMENT_VERSION_LENGTH: 256
});

const RECORD_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[._-]|$)/i;
const ENTITY_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:+-]{0,126}[A-Za-z0-9])?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

module.exports = {
  SCHEMA,
  STATE,
  TRANSITIONS,
  LIMITS,
  RECORD_ID_RE,
  WINDOWS_RESERVED_NAME_RE,
  ENTITY_ID_RE,
  SHA256_RE
};
