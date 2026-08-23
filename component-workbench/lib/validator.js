'use strict';

const {
  SCHEMA,
  STATE,
  LIMITS,
  ENTITY_ID_RE,
  RECORD_ID_RE,
  WINDOWS_RESERVED_NAME_RE,
  SHA256_RE
} = require('./constants');
const { fail } = require('./errors');
const { nonBlank, normalizeForQuote, sha256, canonicalJson } = require('./util');

const APPROVAL_MIN_CONFIDENCE = 0.8;
const DIRECTIONS = new Set(['INPUT', 'OUTPUT', 'BIDIRECTIONAL', 'PASSIVE', 'UNKNOWN']);
const BBOX_UNITS = new Set(['PDF_PT', 'NORMALIZED', 'PIXELS', 'TEXT_LINES']);

function issue(list, path, code, message) {
  list.push({ path, code, message });
}

function objectAt(value, path, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(issues, path, 'TYPE_OBJECT', 'must be an object');
    return false;
  }
  return true;
}

function exactKeys(value, required, optional, path, issues) {
  if (!objectAt(value, path, issues)) return false;
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) issue(issues, `${path}.${key}`, 'REQUIRED', 'is required');
  for (const key of Object.keys(value)) if (!allowed.has(key)) issue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', 'is not allowed');
  return true;
}

function stringAt(value, path, issues, options = {}) {
  if (!nonBlank(value)) {
    issue(issues, path, 'TYPE_NONBLANK_STRING', 'must be a non-blank string');
    return;
  }
  if (options.pattern && !options.pattern.test(value)) issue(issues, path, 'PATTERN', `has invalid format: ${value}`);
  if (options.values && !options.values.has(value)) issue(issues, path, 'ENUM', `must be one of ${[...options.values].join(', ')}`);
}

function confidenceAt(value, path, issues) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    issue(issues, path, 'CONFIDENCE_RANGE', 'must be a finite number from 0 to 1');
  }
}

function validateBBox(value, path, issues) {
  if (!exactKeys(value, ['x', 'y', 'width', 'height', 'unit'], [], path, issues)) return;
  for (const field of ['x', 'y', 'width', 'height']) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0) {
      issue(issues, `${path}.${field}`, 'BBOX_NUMBER', 'must be a finite non-negative number');
    }
  }
  stringAt(value.unit, `${path}.unit`, issues, { values: BBOX_UNITS });
}

function validateEvidence(value, path, issues, hydrated) {
  const systemKeys = hydrated ? ['sourceSha256', 'documentVersion', 'sourceFile', 'quoteSha256'] : [];
  if (!exactKeys(value, ['page', 'bbox', 'quote', ...systemKeys], [], path, issues)) return;
  if (!Number.isInteger(value.page) || value.page < 1) issue(issues, `${path}.page`, 'PAGE_NUMBER', 'must be an integer >= 1');
  validateBBox(value.bbox, `${path}.bbox`, issues);
  stringAt(value.quote, `${path}.quote`, issues);
  if (hydrated) {
    stringAt(value.sourceSha256, `${path}.sourceSha256`, issues, { pattern: SHA256_RE });
    stringAt(value.documentVersion, `${path}.documentVersion`, issues);
    stringAt(value.sourceFile, `${path}.sourceFile`, issues);
    stringAt(value.quoteSha256, `${path}.quoteSha256`, issues, { pattern: SHA256_RE });
    if (nonBlank(value.quote) && nonBlank(value.quoteSha256) && sha256(Buffer.from(value.quote, 'utf8')) !== value.quoteSha256) {
      issue(issues, `${path}.quoteSha256`, 'QUOTE_HASH_MISMATCH', 'does not match quote');
    }
  }
}

function validateProvenance(value, path, issues, hydrated) {
  confidenceAt(value.confidence, `${path}.confidence`, issues);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    issue(issues, `${path}.evidence`, 'EVIDENCE_REQUIRED', 'must contain at least one evidence locator');
  } else {
    value.evidence.forEach((entry, index) => validateEvidence(entry, `${path}.evidence[${index}]`, issues, hydrated));
  }
}

function validateClaim(value, path, issues, hydrated, options = {}) {
  if (!exactKeys(value, ['value', 'confidence', 'evidence'], [], path, issues)) return;
  validateProvenance(value, path, issues, hydrated);
  if (options.type === 'string') stringAt(value.value, `${path}.value`, issues, options);
  if (options.type === 'scalar') {
    const ok = typeof value.value === 'string' || typeof value.value === 'number' || typeof value.value === 'boolean';
    if (!ok || (typeof value.value === 'number' && !Number.isFinite(value.value))) {
      issue(issues, `${path}.value`, 'TYPE_SCALAR', 'must be a JSON string, finite number, or boolean');
    }
  }
}

function validateClaimArray(value, path, issues, hydrated, options = {}) {
  if (!Array.isArray(value)) {
    issue(issues, path, 'TYPE_ARRAY', 'must be an array');
    return;
  }
  const min = options.min ?? 0;
  if (value.length < min) issue(issues, path, 'ARRAY_MIN', `must contain at least ${min} entries`);
  value.forEach((entry, index) => validateClaim(entry, `${path}[${index}]`, issues, hydrated, { type: 'string', pattern: options.pattern }));
}

function validateEntityBase(value, kind, requiredFields, path, issues, hydrated) {
  if (!exactKeys(value, ['kind', 'confidence', 'evidence', ...requiredFields], [], path, issues)) return false;
  if (value.kind !== kind) issue(issues, `${path}.kind`, 'KIND', `must equal ${kind}`);
  validateProvenance(value, path, issues, hydrated);
  return true;
}

function validateAttribute(value, path, issues, hydrated) {
  if (!validateEntityBase(value, 'Attribute', ['key', 'value', 'unit'], path, issues, hydrated)) return;
  validateClaim(value.key, `${path}.key`, issues, hydrated, { type: 'string', pattern: ENTITY_ID_RE });
  validateClaim(value.value, `${path}.value`, issues, hydrated, { type: 'scalar' });
  validateClaim(value.unit, `${path}.unit`, issues, hydrated, { type: 'string' });
}

function validateAttributes(value, path, issues, hydrated) {
  if (!Array.isArray(value)) {
    issue(issues, path, 'TYPE_ARRAY', 'must be an array');
    return;
  }
  value.forEach((entry, index) => validateAttribute(entry, `${path}[${index}]`, issues, hydrated));
}

function validateFunctionalPort(value, path, issues, hydrated) {
  const fields = ['id', 'name', 'direction', 'electricalDomain', 'purpose', 'physicalTerminalRefs'];
  if (!validateEntityBase(value, 'FunctionalPort', fields, path, issues, hydrated)) return;
  validateClaim(value.id, `${path}.id`, issues, hydrated, { type: 'string', pattern: ENTITY_ID_RE });
  validateClaim(value.name, `${path}.name`, issues, hydrated, { type: 'string' });
  validateClaim(value.direction, `${path}.direction`, issues, hydrated, { type: 'string', values: DIRECTIONS });
  validateClaim(value.electricalDomain, `${path}.electricalDomain`, issues, hydrated, { type: 'string', pattern: /^[A-Z][A-Z0-9_+.-]*$/ });
  validateClaim(value.purpose, `${path}.purpose`, issues, hydrated, { type: 'string' });
  validateClaimArray(value.physicalTerminalRefs, `${path}.physicalTerminalRefs`, issues, hydrated, { min: 1, pattern: /^[A-Za-z0-9._:+-]+\/[A-Za-z0-9._:+-]+$/ });
}

function validatePhysicalTerminal(value, path, issues, hydrated) {
  const fields = ['id', 'designation', 'function', 'electricalDomain', 'direction', 'functionalPortRefs', 'attributes'];
  if (!validateEntityBase(value, 'PhysicalTerminal', fields, path, issues, hydrated)) return;
  validateClaim(value.id, `${path}.id`, issues, hydrated, { type: 'string', pattern: ENTITY_ID_RE });
  validateClaim(value.designation, `${path}.designation`, issues, hydrated, { type: 'string' });
  validateClaim(value.function, `${path}.function`, issues, hydrated, { type: 'string' });
  validateClaim(value.electricalDomain, `${path}.electricalDomain`, issues, hydrated, { type: 'string', pattern: /^[A-Z][A-Z0-9_+.-]*$/ });
  validateClaim(value.direction, `${path}.direction`, issues, hydrated, { type: 'string', values: DIRECTIONS });
  validateClaimArray(value.functionalPortRefs, `${path}.functionalPortRefs`, issues, hydrated, { min: 1, pattern: ENTITY_ID_RE });
  validateAttributes(value.attributes, `${path}.attributes`, issues, hydrated);
}

function validateConnector(value, path, issues, hydrated) {
  const fields = ['id', 'name', 'type', 'terminals'];
  if (!validateEntityBase(value, 'Connector', fields, path, issues, hydrated)) return;
  validateClaim(value.id, `${path}.id`, issues, hydrated, { type: 'string', pattern: ENTITY_ID_RE });
  validateClaim(value.name, `${path}.name`, issues, hydrated, { type: 'string' });
  validateClaim(value.type, `${path}.type`, issues, hydrated, { type: 'string' });
  if (!Array.isArray(value.terminals) || value.terminals.length === 0) {
    issue(issues, `${path}.terminals`, 'TERMINALS_REQUIRED', 'must contain at least one physical terminal');
  } else {
    value.terminals.forEach((entry, index) => validatePhysicalTerminal(entry, `${path}.terminals[${index}]`, issues, hydrated));
  }
}

function validateFunctionalUnit(value, path, issues, hydrated) {
  const fields = ['id', 'name', 'type', 'connectorRefs', 'functionalPortRefs', 'attributes'];
  if (!validateEntityBase(value, 'FunctionalUnit', fields, path, issues, hydrated)) return;
  validateClaim(value.id, `${path}.id`, issues, hydrated, { type: 'string', pattern: ENTITY_ID_RE });
  validateClaim(value.name, `${path}.name`, issues, hydrated, { type: 'string' });
  validateClaim(value.type, `${path}.type`, issues, hydrated, { type: 'string' });
  validateClaimArray(value.connectorRefs, `${path}.connectorRefs`, issues, hydrated, { min: 1, pattern: ENTITY_ID_RE });
  validateClaimArray(value.functionalPortRefs, `${path}.functionalPortRefs`, issues, hydrated, { min: 1, pattern: ENTITY_ID_RE });
  validateAttributes(value.attributes, `${path}.attributes`, issues, hydrated);
}

function validateDeviceClass(value, path, issues, hydrated) {
  const fields = ['id', 'name', 'description', 'functionalPorts'];
  if (!validateEntityBase(value, 'DeviceClass', fields, path, issues, hydrated)) return;
  validateClaim(value.id, `${path}.id`, issues, hydrated, { type: 'string', pattern: ENTITY_ID_RE });
  validateClaim(value.name, `${path}.name`, issues, hydrated, { type: 'string' });
  validateClaim(value.description, `${path}.description`, issues, hydrated, { type: 'string' });
  if (!Array.isArray(value.functionalPorts) || value.functionalPorts.length === 0) {
    issue(issues, `${path}.functionalPorts`, 'PORTS_REQUIRED', 'must contain at least one functional port');
  } else {
    value.functionalPorts.forEach((entry, index) => validateFunctionalPort(entry, `${path}.functionalPorts[${index}]`, issues, hydrated));
  }
}

function validatePartVariant(value, path, issues, hydrated) {
  const fields = ['id', 'manufacturer', 'model', 'deviceClassRef', 'documentRevision', 'description', 'connectors', 'functionalUnits', 'attributes'];
  if (!validateEntityBase(value, 'PartVariant', fields, path, issues, hydrated)) return;
  validateClaim(value.id, `${path}.id`, issues, hydrated, { type: 'string', pattern: ENTITY_ID_RE });
  validateClaim(value.manufacturer, `${path}.manufacturer`, issues, hydrated, { type: 'string' });
  validateClaim(value.model, `${path}.model`, issues, hydrated, { type: 'string' });
  validateClaim(value.deviceClassRef, `${path}.deviceClassRef`, issues, hydrated, { type: 'string', pattern: ENTITY_ID_RE });
  validateClaim(value.documentRevision, `${path}.documentRevision`, issues, hydrated, { type: 'string' });
  validateClaim(value.description, `${path}.description`, issues, hydrated, { type: 'string' });
  if (!Array.isArray(value.connectors) || value.connectors.length === 0) {
    issue(issues, `${path}.connectors`, 'CONNECTORS_REQUIRED', 'must contain at least one connector');
  } else {
    value.connectors.forEach((entry, index) => validateConnector(entry, `${path}.connectors[${index}]`, issues, hydrated));
  }
  if (!Array.isArray(value.functionalUnits) || value.functionalUnits.length === 0) {
    issue(issues, `${path}.functionalUnits`, 'FUNCTIONAL_UNITS_REQUIRED', 'must contain at least one functional unit');
  } else {
    value.functionalUnits.forEach((entry, index) => validateFunctionalUnit(entry, `${path}.functionalUnits[${index}]`, issues, hydrated));
  }
  validateAttributes(value.attributes, `${path}.attributes`, issues, hydrated);
}

function addDuplicateIssues(items, idSelector, path, issues) {
  const seen = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const id = idSelector(items[index]);
    if (typeof id !== 'string') continue;
    if (seen.has(id)) issue(issues, `${path}[${index}]`, 'DUPLICATE_ID', `duplicates '${id}' from index ${seen.get(id)}`);
    else seen.set(id, index);
  }
}

function valueOf(claim) {
  return claim && typeof claim === 'object' ? claim.value : undefined;
}

function validateReferences(payload, issues) {
  const deviceClass = payload.deviceClass;
  const variant = payload.partVariant;
  if (!deviceClass || !variant || !Array.isArray(deviceClass.functionalPorts) || !Array.isArray(variant.connectors) || !Array.isArray(variant.functionalUnits)) return;

  if (valueOf(variant.deviceClassRef) !== valueOf(deviceClass.id)) {
    issue(issues, '$.partVariant.deviceClassRef.value', 'DEVICE_CLASS_REF', 'must equal deviceClass.id.value');
  }

  addDuplicateIssues(deviceClass.functionalPorts, port => valueOf(port.id), '$.deviceClass.functionalPorts', issues);
  addDuplicateIssues(variant.connectors, connector => valueOf(connector.id), '$.partVariant.connectors', issues);
  addDuplicateIssues(variant.functionalUnits, unit => valueOf(unit.id), '$.partVariant.functionalUnits', issues);
  addDuplicateIssues(variant.attributes || [], attribute => valueOf(attribute.key), '$.partVariant.attributes', issues);

  const ports = new Map(deviceClass.functionalPorts.map(port => [valueOf(port.id), port]));
  const connectors = new Map(variant.connectors.map(connector => [valueOf(connector.id), connector]));
  const terminals = new Map();
  for (let connectorIndex = 0; connectorIndex < variant.connectors.length; connectorIndex += 1) {
    const connector = variant.connectors[connectorIndex];
    const connectorId = valueOf(connector.id);
    if (!Array.isArray(connector.terminals)) continue;
    addDuplicateIssues(connector.terminals, terminal => valueOf(terminal.id), `$.partVariant.connectors[${connectorIndex}].terminals`, issues);
    for (let terminalIndex = 0; terminalIndex < connector.terminals.length; terminalIndex += 1) {
      const terminal = connector.terminals[terminalIndex];
      const ref = `${connectorId}/${valueOf(terminal.id)}`;
      terminals.set(ref, terminal);
      for (const portClaim of terminal.functionalPortRefs || []) {
        const portId = valueOf(portClaim);
        if (!ports.has(portId)) issue(issues, `$.partVariant.connectors[${connectorIndex}].terminals[${terminalIndex}].functionalPortRefs`, 'MISSING_PORT_REF', `references missing functional port '${portId}'`);
      }
    }
  }

  for (let portIndex = 0; portIndex < deviceClass.functionalPorts.length; portIndex += 1) {
    const port = deviceClass.functionalPorts[portIndex];
    const portId = valueOf(port.id);
    for (const terminalClaim of port.physicalTerminalRefs || []) {
      const terminalRef = valueOf(terminalClaim);
      const terminal = terminals.get(terminalRef);
      if (!terminal) {
        issue(issues, `$.deviceClass.functionalPorts[${portIndex}].physicalTerminalRefs`, 'MISSING_TERMINAL_REF', `references missing physical terminal '${terminalRef}'`);
      } else if (!(terminal.functionalPortRefs || []).some(claim => valueOf(claim) === portId)) {
        issue(issues, `$.deviceClass.functionalPorts[${portIndex}].physicalTerminalRefs`, 'ASYMMETRIC_PORT_MAP', `terminal '${terminalRef}' does not map back to '${portId}'`);
      }
    }
  }

  for (const [terminalRef, terminal] of terminals) {
    for (const portClaim of terminal.functionalPortRefs || []) {
      const portId = valueOf(portClaim);
      const port = ports.get(portId);
      if (port && !(port.physicalTerminalRefs || []).some(claim => valueOf(claim) === terminalRef)) {
        issue(issues, '$.partVariant.connectors', 'ASYMMETRIC_TERMINAL_MAP', `functional port '${portId}' does not map back to terminal '${terminalRef}'`);
      }
    }
  }

  for (let unitIndex = 0; unitIndex < variant.functionalUnits.length; unitIndex += 1) {
    const unit = variant.functionalUnits[unitIndex];
    for (const connectorClaim of unit.connectorRefs || []) {
      const connectorId = valueOf(connectorClaim);
      if (!connectors.has(connectorId)) issue(issues, `$.partVariant.functionalUnits[${unitIndex}].connectorRefs`, 'MISSING_CONNECTOR_REF', `references missing connector '${connectorId}'`);
    }
    for (const portClaim of unit.functionalPortRefs || []) {
      const portId = valueOf(portClaim);
      if (!ports.has(portId)) issue(issues, `$.partVariant.functionalUnits[${unitIndex}].functionalPortRefs`, 'MISSING_PORT_REF', `references missing functional port '${portId}'`);
    }
  }
}

function validatePayload(payload, { hydrated = false, throwOnError = true } = {}) {
  const issues = [];
  if (exactKeys(payload, ['deviceClass', 'partVariant'], [], '$', issues)) {
    validateDeviceClass(payload.deviceClass, '$.deviceClass', issues, hydrated);
    validatePartVariant(payload.partVariant, '$.partVariant', issues, hydrated);
    validateReferences(payload, issues);
  }
  if (issues.length && throwOnError) fail('VALIDATION_FAILED', `Component payload has ${issues.length} validation error(s)`, issues);
  return issues;
}

function validateCandidate(candidate, options = {}) {
  const issues = [];
  if (exactKeys(candidate, ['schemaVersion', 'recordId', 'deviceClass', 'partVariant'], [], '$', issues)) {
    if (candidate.schemaVersion !== SCHEMA.CANDIDATE) issue(issues, '$.schemaVersion', 'SCHEMA_VERSION', `must equal ${SCHEMA.CANDIDATE}`);
    stringAt(candidate.recordId, '$.recordId', issues, { pattern: RECORD_ID_RE });
    if (typeof candidate.recordId === 'string' && WINDOWS_RESERVED_NAME_RE.test(candidate.recordId)) {
      issue(issues, '$.recordId', 'RESERVED_RECORD_ID', 'uses a reserved Windows device name');
    }
    const payloadIssues = validatePayload({ deviceClass: candidate.deviceClass, partVariant: candidate.partVariant }, { hydrated: false, throwOnError: false });
    issues.push(...payloadIssues);
  }
  if (issues.length && options.throwOnError !== false) fail('VALIDATION_FAILED', `Component candidate has ${issues.length} validation error(s)`, issues);
  return issues;
}

function visitProvenanced(value, callback, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && Object.hasOwn(value, 'confidence') && Object.hasOwn(value, 'evidence')) callback(value, path);
  if (Array.isArray(value)) value.forEach((entry, index) => visitProvenanced(entry, callback, `${path}[${index}]`));
  else for (const [key, entry] of Object.entries(value)) visitProvenanced(entry, callback, `${path}.${key}`);
}

function hydrateAndVerifyPayload(payload, source) {
  const hydrated = structuredClone(payload);
  const pages = (Array.isArray(source.pages) && source.pages.length ? source.pages : [source.extractedText])
    .map(normalizeForQuote);
  visitProvenanced(hydrated, (node, path) => {
    node.evidence = node.evidence.map((entry, index) => {
      const quote = normalizeForQuote(entry.quote);
      const pageText = pages[entry.page - 1];
      if (!pageText) {
        fail('EVIDENCE_PAGE_NOT_FOUND', `Evidence page ${entry.page} at ${path}.evidence[${index}] is outside the ${pages.length}-page extraction`);
      }
      if (!quote || !pageText.includes(quote)) {
        fail('EVIDENCE_QUOTE_NOT_FOUND', `Evidence quote at ${path}.evidence[${index}] was not found on stated page ${entry.page}`, { quote: entry.quote });
      }
      return {
        ...entry,
        sourceSha256: source.sha256,
        documentVersion: source.documentVersion,
        sourceFile: source.fileName,
        quoteSha256: sha256(Buffer.from(entry.quote, 'utf8'))
      };
    });
  });
  validatePayload(hydrated, { hydrated: true });
  return hydrated;
}

function collectApprovalIssues(record) {
  const issues = [];
  if (record.state !== STATE.REVIEWED && record.state !== STATE.APPROVED) {
    issue(issues, '$.state', 'NOT_REVIEWED', 'record must be REVIEWED before approval checks');
  }
  visitProvenanced(record.payload, (node, path) => {
    if (typeof node.confidence === 'number' && node.confidence < APPROVAL_MIN_CONFIDENCE) {
      issue(issues, `${path}.confidence`, 'LOW_CONFIDENCE', `must be >= ${APPROVAL_MIN_CONFIDENCE} for approval`);
    }
    if (Object.hasOwn(node, 'value') && typeof node.value === 'string' && node.value.trim().toUpperCase() === 'UNKNOWN') {
      issue(issues, `${path}.value`, 'UNKNOWN_BLOCKS_APPROVAL', 'UNKNOWN values cannot be approved or used for automatic wiring');
    }
  });
  const payloadIssues = validatePayload(record.payload, { hydrated: true, throwOnError: false });
  issues.push(...payloadIssues);
  return issues;
}

function assertApprovalEligible(record) {
  const issues = collectApprovalIssues(record);
  if (issues.length) fail('APPROVAL_BLOCKED', `Approval is blocked by ${issues.length} issue(s)`, issues);
}

function assertAutoWiringEligible(record) {
  if (record.state !== STATE.APPROVED) fail('NOT_APPROVED', 'Only an APPROVED record is eligible for automatic wiring');
  assertApprovalEligible(record);
}

function validateRecord(record, options = {}) {
  const issues = [];
  const required = ['schemaVersion', 'recordId', 'revision', 'state', 'createdAt', 'actor', 'previousRevisionSha256', 'change', 'source', 'payload'];
  if (exactKeys(record, required, [], '$', issues)) {
    if (record.schemaVersion !== SCHEMA.RECORD) issue(issues, '$.schemaVersion', 'SCHEMA_VERSION', `must equal ${SCHEMA.RECORD}`);
    stringAt(record.recordId, '$.recordId', issues, { pattern: RECORD_ID_RE });
    if (typeof record.recordId === 'string' && WINDOWS_RESERVED_NAME_RE.test(record.recordId)) {
      issue(issues, '$.recordId', 'RESERVED_RECORD_ID', 'uses a reserved Windows device name');
    }
    if (!Number.isInteger(record.revision) || record.revision < 1) issue(issues, '$.revision', 'REVISION', 'must be an integer >= 1');
    if (!Object.values(STATE).includes(record.state)) issue(issues, '$.state', 'STATE', 'has an invalid lifecycle state');
    if (!nonBlank(record.createdAt) || Number.isNaN(Date.parse(record.createdAt)) ||
        (() => { try { return new Date(record.createdAt).toISOString() !== record.createdAt; } catch { return true; } })()) {
      issue(issues, '$.createdAt', 'TIMESTAMP', 'must be a canonical UTC ISO timestamp');
    }
    stringAt(record.actor, '$.actor', issues);
    if (typeof record.actor === 'string' && (record.actor.length > LIMITS.ACTOR_LENGTH || /[\u0000-\u001f\u007f]/u.test(record.actor))) {
      issue(issues, '$.actor', 'INVALID_ACTOR', `must be at most ${LIMITS.ACTOR_LENGTH} characters without controls`);
    }
    if (record.previousRevisionSha256 !== null && (typeof record.previousRevisionSha256 !== 'string' || !SHA256_RE.test(record.previousRevisionSha256))) {
      issue(issues, '$.previousRevisionSha256', 'PREVIOUS_HASH', 'must be null or a SHA-256 hex string');
    }
    if (exactKeys(record.change, ['action', 'reason'], [], '$.change', issues)) {
      stringAt(record.change.action, '$.change.action', issues);
      stringAt(record.change.reason, '$.change.reason', issues);
      if (!['EXTRACT', 'REVIEW', 'APPROVE', 'DEPRECATE'].includes(record.change.action)) {
        issue(issues, '$.change.action', 'ACTION', 'has an invalid lifecycle action');
      }
      if (typeof record.change.reason === 'string' &&
          (record.change.reason.length > LIMITS.REASON_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(record.change.reason))) {
        issue(issues, '$.change.reason', 'INVALID_REASON', `must be at most ${LIMITS.REASON_LENGTH} characters without unsafe controls`);
      }
    }
    if (exactKeys(record.source, ['fileName', 'mediaType', 'sha256', 'documentVersion', 'extraction'], [], '$.source', issues)) {
      stringAt(record.source.fileName, '$.source.fileName', issues);
      if (typeof record.source.fileName === 'string' && /[\u0000-\u001f\u007f/\\]/u.test(record.source.fileName)) {
        issue(issues, '$.source.fileName', 'SOURCE_FILE_NAME', 'must be a plain base name without separators or controls');
      }
      stringAt(record.source.mediaType, '$.source.mediaType', issues, { values: new Set(['text/plain', 'application/json', 'application/pdf']) });
      stringAt(record.source.sha256, '$.source.sha256', issues, { pattern: SHA256_RE });
      stringAt(record.source.documentVersion, '$.source.documentVersion', issues);
      if (typeof record.source.documentVersion === 'string' &&
          (record.source.documentVersion.length > LIMITS.DOCUMENT_VERSION_LENGTH || /[\u0000-\u001f\u007f]/u.test(record.source.documentVersion))) {
        issue(issues, '$.source.documentVersion', 'DOCUMENT_VERSION', `must be at most ${LIMITS.DOCUMENT_VERSION_LENGTH} characters without controls`);
      }
      if (objectAt(record.source.extraction, '$.source.extraction', issues)) {
        const extraction = record.source.extraction;
        const descriptorKeys = ['mode', 'extractorId', 'extractorVersion', 'outputSha256', 'safety'];
        exactKeys(extraction, descriptorKeys, [], '$.source.extraction', issues);
        stringAt(extraction.mode, '$.source.extraction.mode', issues, {
          values: new Set(['PLAIN_TEXT', 'JSON_DATA', 'EXTERNAL_TEXT_FILE', 'CALLER_CALLBACK'])
        });
        stringAt(extraction.extractorId, '$.source.extraction.extractorId', issues);
        stringAt(extraction.extractorVersion, '$.source.extraction.extractorVersion', issues);
        stringAt(extraction.outputSha256, '$.source.extraction.outputSha256', issues, { pattern: SHA256_RE });
        stringAt(extraction.safety, '$.source.extraction.safety', issues);
      }
    }
    const payloadIssues = validatePayload(record.payload, { hydrated: true, throwOnError: false });
    issues.push(...payloadIssues);
    if (record.payload && record.source && record.source.sha256) {
      visitProvenanced(record.payload, (node, path) => {
        for (let index = 0; index < (node.evidence || []).length; index += 1) {
          const evidence = node.evidence[index];
          if (evidence.sourceSha256 !== record.source.sha256) issue(issues, `${path}.evidence[${index}].sourceSha256`, 'SOURCE_HASH_MISMATCH', 'must equal record source SHA-256');
          if (evidence.documentVersion !== record.source.documentVersion) issue(issues, `${path}.evidence[${index}].documentVersion`, 'DOCUMENT_VERSION_MISMATCH', 'must equal record document version');
          if (evidence.sourceFile !== record.source.fileName) issue(issues, `${path}.evidence[${index}].sourceFile`, 'SOURCE_FILE_MISMATCH', 'must equal record source file name');
        }
      });
    }
  }
  if (issues.length && options.throwOnError !== false) fail('INVALID_RECORD', `Record has ${issues.length} validation error(s)`, issues);
  return issues;
}

function samePayloadAndSource(left, right) {
  return canonicalJson({ payload: left.payload, source: left.source }) === canonicalJson({ payload: right.payload, source: right.source });
}

module.exports = {
  APPROVAL_MIN_CONFIDENCE,
  validateCandidate,
  validatePayload,
  validateRecord,
  hydrateAndVerifyPayload,
  collectApprovalIssues,
  assertApprovalEligible,
  assertAutoWiringEligible,
  samePayloadAndSource,
  visitProvenanced,
  valueOf
};
