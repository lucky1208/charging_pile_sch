/* ============================================================
 * SchematicForge deterministic engineering BOM
 * ------------------------------------------------------------
 * The authoritative EDEM instance list is the only source of BOM rows.
 * Online/model research is kept as CANDIDATE data and cannot populate a
 * purchasing field until an explicit, traceable approval is supplied.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const commonJs = typeof window === 'undefined' && typeof module === 'object' && module && module.exports;
  const nodeCrypto = commonJs ? require('node:crypto') : null;
  const api = factory(nodeCrypto);
  if (root) {
    root.SCHEMATIC_ENGINEERING_BOM = api;
    root.EVSE_ENGINEERING_BOM = api;
  }
  if (commonJs) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (nodeCrypto) {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'schematic-engineering-bom/v1';
  const CANDIDATE_SCHEMA = 'schematic-bom-research-candidate/v1';
  const APPROVED_SCHEMA = 'schematic-bom-approved-selection/v1';
  const APPROVAL_BINDING_SCHEMA = 'schematic-bom-approval-binding/v1';
  const APPROVAL_SIGNATURE_ALGORITHM = 'HMAC-SHA256';
  const MIN_APPROVAL_SECRET_BYTES = 32;
  const PART_SELECTION_REQUIRED = 'PART_SELECTION_REQUIRED';
  const APPROVAL_REQUIRED = '待批准';
  const COLUMNS = Object.freeze([
    '位号', '类别', '设备名称', '型号', '参考推荐厂家', '关键参数', '数量', '说明手册下载'
  ]);

  const CATEGORY_BY_SYSTEM = Object.freeze({
    ac: '交流输入与保护',
    power: '功率变换',
    dc: '直流母线与保护',
    gun: '充电输出接口',
    aux: '辅助电源与热管理',
    control: '控制、通信与安全',
    ess: '储能系统',
    earth: '保护接地与等电位',
    'split-cabinet': '分体式功率柜接口',
    'split-terminal': '分体式充电终端'
  });

  const PARAM_FIELDS = Object.freeze([
    ['ratedCurrentA', '额定电流', 'A'],
    ['currentA', '工作电流', 'A'],
    ['rangeA', '量程', 'A'],
    ['ratedVoltageV', '额定电压', 'V'],
    ['voltageV', '电压', 'V'],
    ['outputVoltageV', '输出电压', 'V'],
    ['supplyVoltageV', '供电电压', 'V'],
    ['breakingKa', '分断能力', ''],
    ['unitKw', '单机功率', 'kW'],
    ['installedKw', '装机功率', 'kW'],
    ['outputRange', '输出范围', ''],
    ['resistanceOhm', '阻值', 'Ω'],
    ['ratedPowerW', '额定功率', 'W'],
    ['connectorType', '接口', ''],
    ['standardId', '标准', ''],
    ['protocol', '协议', '']
  ]);

  function cleanText(value, max) {
    return String(value == null ? '' : value)
      .replace(/\u0000/g, '')
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, max || 1200);
  }

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const output = {};
      Object.keys(value).sort().forEach((key) => {
        if (value[key] !== undefined) output[key] = stable(value[key]);
      });
      return output;
    }
    return value;
  }

  function hash(value) {
    const text = JSON.stringify(stable(value));
    let output = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      output ^= text.charCodeAt(index);
      output = Math.imul(output, 16777619);
    }
    return 'fnv1a32-' + (output >>> 0).toString(16).padStart(8, '0');
  }

  function requireNodeCrypto() {
    if (!nodeCrypto || typeof nodeCrypto.createHmac !== 'function') {
      throw new TypeError('Trusted BOM approval is available only in a Node.js server/offline approval boundary.');
    }
    return nodeCrypto;
  }

  function sha256(value) {
    const crypto = requireNodeCrypto();
    return 'sha256-' + crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
  }

  function approvalSecret(options, required) {
    const explicit = options && typeof options.approvalSecret === 'string' ? options.approvalSecret : '';
    const environment = typeof process !== 'undefined' && process && process.env &&
      typeof process.env.ENGINEERING_BOM_APPROVAL_SECRET === 'string'
      ? process.env.ENGINEERING_BOM_APPROVAL_SECRET : '';
    const secret = explicit || environment;
    if (!nodeCrypto || Buffer.byteLength(secret, 'utf8') < MIN_APPROVAL_SECRET_BYTES) {
      if (required) throw new TypeError('A server/offline ENGINEERING_BOM_APPROVAL_SECRET of at least 32 bytes is required.');
      return '';
    }
    return secret;
  }

  function hmac(value, secret) {
    const crypto = requireNodeCrypto();
    return 'hmac-sha256-' + crypto.createHmac('sha256', secret)
      .update(JSON.stringify(stable(value)), 'utf8').digest('hex');
  }

  function constantTimeEqual(leftValue, rightValue) {
    if (!nodeCrypto) return false;
    const left = Buffer.from(String(leftValue || ''), 'utf8');
    const right = Buffer.from(String(rightValue || ''), 'utf8');
    const leftDigest = nodeCrypto.createHash('sha256').update(left).digest();
    const rightDigest = nodeCrypto.createHash('sha256').update(right).digest();
    return nodeCrypto.timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
  }

  function fingerprintPort(port) {
    const input = port && typeof port === 'object' ? port : {};
    const output = {};
    [
      'id', 'netClass', 'domain', 'direction', 'required', 'multiplicity', 'electricalType',
      'phase', 'polarity', 'protocol', 'signalRole', 'voltageV', 'referenceVoltageV',
      'voltageRangeV', 'currentA', 'currentRangeA', 'physicalTerminalIds'
    ].forEach((key) => {
      if (input[key] !== undefined) output[key] = input[key];
    });
    return output;
  }

  function instanceFingerprint(instance) {
    requireNodeCrypto();
    if (!instance || typeof instance !== 'object' || !cleanText(instance.id, 180)) {
      throw new TypeError('A valid authoritative instance is required for approval fingerprinting.');
    }
    const excluded = new Set([
      'id', 'ref', 'tag', 'referenceDesignation', 'name', 'source', 'lifecycle', 'status',
      'terminals', 'physicalTerminals', 'ports', 'functionalPorts'
    ]);
    const parameters = {};
    Object.keys(instance).sort().forEach((key) => {
      if (!excluded.has(key) && instance[key] !== undefined && typeof instance[key] !== 'function') {
        parameters[key] = instance[key];
      }
    });
    const physicalPorts = (Array.isArray(instance.physicalTerminals) ? instance.physicalTerminals :
      (Array.isArray(instance.terminals) ? instance.terminals : (Array.isArray(instance.ports) ? instance.ports : [])))
      .map(fingerprintPort).sort((left, right) => compareText(left.id, right.id));
    const functionalPorts = (Array.isArray(instance.functionalPorts) ? instance.functionalPorts : [])
      .map(fingerprintPort).sort((left, right) => compareText(left.id, right.id));
    return sha256({
      kind: cleanText(instance.kind, 180),
      definitionRef: cleanText(instance.definitionRef, 500),
      parameters,
      physicalPorts,
      functionalPorts
    });
  }

  function authoritativeDesign(value) {
    const source = value && typeof value === 'object' ? value : {};
    return source.design && typeof source.design === 'object' ? source.design : source;
  }

  function approvalBinding(value, instanceId) {
    const design = authoritativeDesign(value);
    const projectId = cleanText(design && design.project && design.project.id, 180);
    const modelHash = cleanText(design && design.modelHash, 180);
    const wanted = cleanText(instanceId, 180);
    const instance = design && Array.isArray(design.instances)
      ? design.instances.find((entry) => cleanText(entry && entry.id, 180) === wanted)
      : null;
    if (!projectId || !modelHash || !instance) {
      throw new TypeError('Approval binding requires projectId, modelHash and a matching authoritative instance.');
    }
    return {
      schema: APPROVAL_BINDING_SCHEMA,
      projectId,
      modelHash,
      instanceId: wanted,
      instanceFingerprint: instanceFingerprint(instance)
    };
  }

  function compareText(leftValue, rightValue) {
    const left = cleanText(leftValue, 400).toUpperCase().match(/\d+|\D+/g) || [];
    const right = cleanText(rightValue, 400).toUpperCase().match(/\d+|\D+/g) || [];
    const count = Math.max(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      if (left[index] === undefined) return -1;
      if (right[index] === undefined) return 1;
      const leftNumber = /^\d+$/.test(left[index]);
      const rightNumber = /^\d+$/.test(right[index]);
      if (leftNumber && rightNumber) {
        const delta = Number(left[index]) - Number(right[index]);
        if (delta) return delta;
        if (left[index].length !== right[index].length) return left[index].length - right[index].length;
      } else if (left[index] !== right[index]) {
        return left[index] < right[index] ? -1 : 1;
      }
    }
    return 0;
  }

  function normalTag(value) {
    return cleanText(value, 160).replace(/[\s‐-―]/g, '').toUpperCase();
  }

  function expandScheduleTag(value) {
    const text = normalTag(value);
    if (!text) return [];
    const output = new Set();
    text.split(/[\/、，,]/).filter(Boolean).forEach((part) => {
      output.add(part);
      const range = part.match(/^([^0-9]*)(\d+)~(?:([^0-9]*)(\d+)|\d+)$/);
      if (!range) return;
      const prefix = range[1] || range[3] || '';
      const start = Number(range[2]);
      const end = Number(range[4]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start > 500) return;
      for (let index = start; index <= end; index += 1) output.add(prefix + index);
    });
    return Array.from(output);
  }

  function scheduleIndex(schedule) {
    const index = new Map();
    (Array.isArray(schedule) ? schedule : []).slice().sort((left, right) =>
      compareText(left && left.tag, right && right.tag) || compareText(left && left.name, right && right.name)
    ).forEach((entry) => {
      expandScheduleTag(entry && entry.tag).forEach((tag) => {
        if (!index.has(tag)) index.set(tag, entry);
      });
    });
    return index;
  }

  function quantity(value, instanceId) {
    const number = value == null ? 1 : Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new TypeError('Invalid physical quantity for instance: ' + instanceId);
    }
    return number;
  }

  function category(instance) {
    const system = cleanText(instance && instance.system, 80).toLowerCase();
    if (CATEGORY_BY_SYSTEM[system]) return CATEGORY_BY_SYSTEM[system];
    const kind = cleanText(instance && instance.kind, 120).toLowerCase();
    if (/earth|\bpe\b/.test(kind)) return CATEGORY_BY_SYSTEM.earth;
    if (/battery|\bess\b|dcdc|pcs/.test(kind)) return CATEGORY_BY_SYSTEM.ess;
    if (/connector|contactor|fuse/.test(kind)) return '电气设备';
    return system ? system : '未分类设备';
  }

  function criticalParams(instance, scheduleEntry) {
    const scheduled = cleanText(scheduleEntry && scheduleEntry.spec, 1600);
    if (scheduled) return scheduled;
    const direct = cleanText(instance && instance.spec, 1600);
    if (direct) return direct;
    const parts = [];
    PARAM_FIELDS.forEach(([key, label, unit]) => {
      const value = instance && instance[key];
      if (value === undefined || value === null || value === '') return;
      parts.push(label + ' ' + cleanText(value, 160) + unit);
    });
    return parts.length ? parts.join('·') : 'PROJECT_PARAMETER_CONFIRMATION_REQUIRED';
  }

  function parseHttpsUrl(value) {
    const text = cleanText(value, 2048);
    if (!text) return { ok: false, value: '', code: 'URL_REQUIRED' };
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== 'https:') return { ok: false, value: '', code: 'HTTPS_REQUIRED' };
      if (parsed.username || parsed.password) return { ok: false, value: '', code: 'CREDENTIALS_FORBIDDEN' };
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      const privateIpv4 = ipv4 && (() => {
        const parts = ipv4.slice(1).map(Number);
        return parts.some((part) => part > 255) || parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
          (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
          (parts[0] === 169 && parts[1] === 254) ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
      })();
      if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
          privateIpv4 || host.includes(':')) {
        return { ok: false, value: '', code: 'PUBLIC_HOST_REQUIRED' };
      }
      return { ok: true, value: parsed.href, code: 'VALID_HTTPS_URL' };
    } catch (_error) {
      return { ok: false, value: '', code: 'INVALID_URL' };
    }
  }

  function validateDatasheetUrl(value) {
    return parseHttpsUrl(value);
  }

  function normaliseEvidence(value) {
    return (Array.isArray(value) ? value : []).slice(0, 20).map((entry) => {
      const item = typeof entry === 'string' ? { url: entry } : (entry || {});
      const url = parseHttpsUrl(item.url);
      if (!url.ok) return null;
      return {
        url: url.value,
        title: cleanText(item.title, 300),
        sourceType: cleanText(item.sourceType, 80) || 'WEB_RESEARCH'
      };
    }).filter(Boolean).sort((left, right) => compareText(left.url, right.url));
  }

  function normaliseResearchCandidate(value) {
    const input = value && typeof value === 'object' ? value : {};
    const instanceId = cleanText(input.instanceId, 180);
    if (!instanceId) throw new TypeError('Research candidate requires instanceId.');
    const proposedUrl = cleanText(input.datasheetUrl, 2048);
    const url = parseHttpsUrl(proposedUrl);
    const evidence = normaliseEvidence(input.evidence || input.sourceCitations);
    const payload = {
      schema: CANDIDATE_SCHEMA,
      version: VERSION,
      lifecycle: 'CANDIDATE',
      approvalStatus: 'UNREVIEWED',
      instanceId,
      reference: cleanText(input.reference || input.ref, 160),
      model: cleanText(input.model, 300),
      manufacturer: cleanText(input.manufacturer || input.vendor, 300),
      datasheetUrl: url.ok ? url.value : '',
      evidence,
      researchNotes: cleanText(input.researchNotes || input.notes, 1200),
      validation: {
        complete: !!(cleanText(input.model, 300) && cleanText(input.manufacturer || input.vendor, 300) && url.ok && evidence.length),
        datasheetUrl: url.code,
        errors: [
          cleanText(input.model, 300) ? '' : 'MODEL_REQUIRED',
          cleanText(input.manufacturer || input.vendor, 300) ? '' : 'MANUFACTURER_REQUIRED',
          url.ok ? '' : url.code,
          evidence.length ? '' : 'EVIDENCE_REQUIRED'
        ].filter(Boolean)
      },
      authoritativeMutationAllowed: false,
      procurementUseAllowed: false
    };
    payload.candidateId = 'BOM-CAND-' + hash({
      instanceId: payload.instanceId,
      model: payload.model,
      manufacturer: payload.manufacturer,
      datasheetUrl: payload.datasheetUrl
    }).slice(-8).toUpperCase();
    payload.candidateHash = hash(payload);
    return payload;
  }

  function candidateHashValid(candidate) {
    if (!candidate || candidate.lifecycle !== 'CANDIDATE' || !candidate.candidateHash) return false;
    const copy = Object.assign({}, candidate);
    delete copy.candidateHash;
    return candidate.candidateHash === hash(copy);
  }

  function strictIsoInstant(value) {
    const text = cleanText(value, 80);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return '';
    return Number.isFinite(Date.parse(text)) ? text : '';
  }

  function unsignedApprovedSelection(selection) {
    const output = Object.assign({}, selection);
    delete output.approvalSignature;
    delete output.approvedHash;
    return output;
  }

  function approveCandidate(candidate, approval, designValue, options) {
    const secret = approvalSecret(options, true);
    if (!candidateHashValid(candidate)) throw new TypeError('Candidate is missing or has been modified.');
    if (!candidate.validation || candidate.validation.complete !== true) {
      throw new TypeError('Incomplete candidate cannot be approved.');
    }
    if (!Array.isArray(candidate.evidence) || !candidate.evidence.length) {
      throw new TypeError('At least one valid HTTPS evidence record is required for approval.');
    }
    const decision = cleanText(approval && approval.decision, 40).toUpperCase();
    const approvedBy = cleanText(approval && approval.approvedBy, 240);
    const approvedAt = strictIsoInstant(approval && approval.approvedAt);
    const basis = cleanText(approval && approval.basis, 1000);
    if (decision !== 'APPROVE' || !approvedBy || !approvedAt || !basis) {
      throw new TypeError('Explicit APPROVE decision, named approver, strict ISO timestamp and basis are required.');
    }
    const url = parseHttpsUrl(candidate.datasheetUrl);
    if (!url.ok) throw new TypeError('Approved selection requires a valid HTTPS datasheet URL.');
    const binding = approvalBinding(designValue, candidate.instanceId);
    const output = {
      schema: APPROVED_SCHEMA,
      version: VERSION,
      lifecycle: 'APPROVED',
      approvalStatus: 'APPROVED',
      instanceId: candidate.instanceId,
      reference: candidate.reference,
      model: candidate.model,
      manufacturer: candidate.manufacturer,
      datasheetUrl: url.value,
      evidence: candidate.evidence.slice(),
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      binding,
      approval: { decision: 'APPROVE', approvedBy, approvedAt, basis },
      signatureAlgorithm: APPROVAL_SIGNATURE_ALGORITHM,
      authoritativeMutationAllowed: false,
      procurementUseAllowed: true
    };
    output.approvalSignature = hmac(unsignedApprovedSelection(output), secret);
    output.approvedHash = sha256(output);
    return output;
  }

  function approvedSelectionValid(selection, design, secret) {
    if (!nodeCrypto || !secret || !selection || selection.lifecycle !== 'APPROVED' ||
        selection.approvalStatus !== 'APPROVED' || selection.signatureAlgorithm !== APPROVAL_SIGNATURE_ALGORITHM ||
        !selection.approvalSignature || !selection.approvedHash || !parseHttpsUrl(selection.datasheetUrl).ok ||
        !Array.isArray(selection.evidence) || !selection.evidence.length ||
        !strictIsoInstant(selection.approval && selection.approval.approvedAt)) return false;
    let expectedBinding;
    try { expectedBinding = approvalBinding(design, selection.instanceId); } catch (_) { return false; }
    if (JSON.stringify(stable(selection.binding)) !== JSON.stringify(stable(expectedBinding))) return false;
    const expectedSignature = hmac(unsignedApprovedSelection(selection), secret);
    if (!constantTimeEqual(selection.approvalSignature, expectedSignature)) return false;
    const copy = Object.assign({}, selection);
    delete copy.approvedHash;
    return constantTimeEqual(selection.approvedHash, sha256(copy));
  }

  function approvedIndex(values, design, instanceIds, options) {
    const output = new Map();
    const rejected = [];
    const secret = approvalSecret(options, false);
    (Array.isArray(values) ? values : []).slice().sort((left, right) =>
      compareText(left && left.instanceId, right && right.instanceId) || compareText(left && left.approvedHash, right && right.approvedHash)
    ).forEach((selection) => {
      if (!secret || !instanceIds.has(selection && selection.instanceId) || !approvedSelectionValid(selection, design, secret)) {
        rejected.push({ instanceId: cleanText(selection && selection.instanceId, 180), code: secret ? 'INVALID_OR_STALE_SIGNATURE' : 'TRUSTED_APPROVAL_SECRET_UNAVAILABLE' });
        return;
      }
      if (output.has(selection.instanceId)) throw new TypeError('Multiple approved selections for instance: ' + selection.instanceId);
      output.set(selection.instanceId, selection);
    });
    return { selections: output, rejected, trustedBoundaryAvailable: !!secret && !!nodeCrypto };
  }

  function inputParts(value, options) {
    const source = value && typeof value === 'object' ? value : {};
    const design = source.design && typeof source.design === 'object' ? source.design : source;
    const schedule = Array.isArray(source.schedule) ? source.schedule : (options && options.schedule || []);
    if (!design || !Array.isArray(design.instances)) {
      throw new TypeError('An authoritative design.instances array is required.');
    }
    return { design, schedule };
  }

  function build(value, options) {
    const source = inputParts(value, options);
    const ids = new Set();
    source.design.instances.forEach((instance) => {
      const id = cleanText(instance && instance.id, 180);
      if (!id) throw new TypeError('Every design instance requires an id.');
      if (ids.has(id)) throw new TypeError('Duplicate design instance id: ' + id);
      ids.add(id);
    });
    const schedules = scheduleIndex(source.schedule);
    const approvalIndex = approvedIndex(options && options.approvedSelections, source.design, ids, options);
    const selections = approvalIndex.selections;
    const ordered = source.design.instances.slice().sort((left, right) =>
      compareText(left && (left.tag || left.ref || left.id), right && (right.tag || right.ref || right.id)) ||
      compareText(left && left.id, right && right.id)
    );
    const rows = [];
    const trace = [];
    let physicalQuantityTotal = 0;
    ordered.forEach((instance, rowIndex) => {
      const instanceId = cleanText(instance.id, 180);
      const reference = cleanText(instance.tag || instance.ref || instance.referenceDesignation || instanceId, 180) || instanceId;
      const count = quantity(instance.quantity, instanceId);
      const scheduleEntry = schedules.get(normalTag(reference));
      const selection = selections.get(instanceId);
      physicalQuantityTotal += count;
      rows.push({
        '位号': reference,
        '类别': category(instance),
        '设备名称': cleanText(instance.name, 500) || cleanText(scheduleEntry && scheduleEntry.name, 500) || instanceId,
        '型号': selection ? selection.model : PART_SELECTION_REQUIRED,
        '参考推荐厂家': selection ? selection.manufacturer : APPROVAL_REQUIRED,
        '关键参数': criticalParams(instance, scheduleEntry),
        '数量': count,
        '说明手册下载': selection ? selection.datasheetUrl : APPROVAL_REQUIRED
      });
      trace.push({
        rowIndex,
        instanceId,
        reference,
        definitionRef: cleanText(instance.definitionRef, 500),
        selectionStatus: selection ? 'APPROVED' : PART_SELECTION_REQUIRED,
        approvedHash: selection ? selection.approvedHash : null
      });
    });
    const payload = {
      schema: SCHEMA,
      version: VERSION,
      lifecycle: 'DERIVED_FROM_EDEM',
      columns: COLUMNS.slice(),
      rows,
      trace,
      coverage: {
        ok: rows.length === ids.size && trace.length === ids.size,
        designInstanceCount: ids.size,
        bomRowCount: rows.length,
        physicalQuantityTotal,
        coveredInstanceIds: trace.map((item) => item.instanceId),
        missingInstanceIds: [],
        duplicateInstanceIds: []
      },
      selectionPolicy: {
        unselectedModel: PART_SELECTION_REQUIRED,
        candidateVisibility: 'RESEARCH_REGISTER_ONLY',
        mainBomRequiresLifecycle: 'APPROVED',
        datasheetTransport: 'HTTPS_ONLY',
        fakeVendorCatalogAllowed: false,
        approvedSelectionVerification: 'SERVER_OR_OFFLINE_HMAC_SHA256',
        trustedApprovalBoundaryAvailable: approvalIndex.trustedBoundaryAvailable,
        rejectedApprovalCount: approvalIndex.rejected.length,
        rejectedApprovals: approvalIndex.rejected
      }
    };
    payload.bomHash = hash(payload);
    return payload;
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCsv(value, options) {
    const rows = Array.isArray(value) ? value : (value && Array.isArray(value.rows) ? value.rows : []);
    const lines = [COLUMNS.map(csvCell).join(',')];
    rows.forEach((row) => lines.push(COLUMNS.map((column) => csvCell(row && row[column])).join(',')));
    return ((options && options.byteOrderMark === false) ? '' : '\uFEFF') + lines.join('\r\n') + '\r\n';
  }

  return Object.freeze({
    VERSION,
    SCHEMA,
    CANDIDATE_SCHEMA,
    APPROVED_SCHEMA,
    APPROVAL_BINDING_SCHEMA,
    COLUMNS,
    PART_SELECTION_REQUIRED,
    APPROVAL_REQUIRED,
    build,
    normaliseResearchCandidate,
    approveCandidate,
    approvalBinding,
    instanceFingerprint,
    approvedSelectionValid,
    validateDatasheetUrl,
    toCsv,
    hash
  });
});
