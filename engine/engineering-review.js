/* ============================================================
 * SchematicForge deterministic engineering-review envelope
 * ------------------------------------------------------------
 * This module does not ask a model to design, connect or approve anything.
 * It creates a bounded, reproducible review case from the authoritative
 * EDEM/result and normalises an optional AI observation as CANDIDATE data.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (root) root.SCHEMATIC_ENGINEERING_REVIEW = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (runtimeRoot) {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'schematic-engineering-review/v1';
  const CANDIDATE_SCHEMA = 'schematic-review-candidate/v1';
  const MAX_FINDINGS = 80;

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((key) => {
        if (value[key] !== undefined) out[key] = stable(value[key]);
      });
      return out;
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

  function cleanText(value, max) {
    return String(value == null ? '' : value)
      .replace(/\u0000/g, '')
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, max || 1200);
  }

  function cleanList(value, maxItems, maxChars) {
    return (Array.isArray(value) ? value : [])
      .map((item) => cleanText(item, maxChars || 500))
      .filter(Boolean)
      .slice(0, maxItems || 20);
  }

  function finiteInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
  }

  function resultStatus(value) {
    const status = cleanText(value, 40).toUpperCase();
    if (status === 'ACTIVE' || status === 'OK') return 'PASS';
    if (status === 'WARNING' || status === 'REVIEW_REQUIRED') return 'WARN';
    return ['PASS', 'WARN', 'BLOCKED', 'NOT_ASSESSED'].includes(status) ? status : 'NOT_ASSESSED';
  }

  function issue(id, severity, category, title, detail, evidence, source) {
    return {
      id: cleanText(id, 120),
      severity: ['BLOCK', 'ERROR', 'WARN', 'INFO'].includes(severity) ? severity : 'WARN',
      category: cleanText(category, 80) || 'GENERAL',
      title: cleanText(title, 240) || cleanText(id, 120),
      detail: cleanText(detail, 1400),
      evidence: cleanList(evidence, 20, 240),
      source: cleanText(source, 80) || 'DETERMINISTIC_RULE'
    };
  }

  function deterministicSeverity(entry, fallback) {
    const value = entry || {};
    const level = cleanText(value.severity, 30).toUpperCase();
    const status = cleanText(value.status || value.result, 30).toUpperCase();
    if (value.blocking === true || ['BLOCK', 'BLOCKING', 'BLOCKER', 'FATAL'].includes(level) ||
        ['BLOCKED', 'FATAL'].includes(status)) return 'BLOCK';
    if (level === 'ERROR') return 'ERROR';
    if (level === 'INFO' || status === 'NOT_ASSESSED') return 'INFO';
    if (level === 'WARN' || level === 'WARNING') return 'WARN';
    return fallback || 'WARN';
  }

  function deterministicFindings(result) {
    const findings = [];
    const model = result && result.design || {};
    const modelValidation = model.modelValidation || {};
    (modelValidation.violations || []).forEach((entry, index) => {
      findings.push(issue(
        entry.ruleId || entry.code || ('ERC-' + (index + 1)),
        deterministicSeverity(entry, 'WARN'),
        'ELECTRICAL_MODEL', entry.code || entry.ruleId || 'ERC issue', entry.message || entry.detail,
        [entry.instanceId, entry.netId, entry.circuitId, entry.terminalId].filter(Boolean), 'EDEM_ERC'
      ));
    });

    const quality = result && result.schematicQuality || {};
    (quality.checks || []).filter((entry) => entry && (!entry.ok || entry.result === 'NOT_ASSESSED')).forEach((entry) => {
      findings.push(issue(
        entry.ruleId || entry.id || 'QUALITY',
        deterministicSeverity(entry, entry.result === 'NOT_ASSESSED' ? 'INFO' : 'WARN'),
        entry.dimension || 'SCHEMATIC_QUALITY', entry.title || entry.rule || entry.ruleId,
        entry.detail || entry.message, entry.evidence || entry.evidenceRefs || [], 'QUALITY_RULE'
      ));
    });

    const skill = result && result.drawingSkill || {};
    Object.keys(skill.drawingAudits || {}).sort().forEach((drawingKey) => {
      const audit = skill.drawingAudits[drawingKey] || {};
      (audit.checks || []).filter((entry) => entry && !entry.ok).forEach((entry) => {
        findings.push(issue(
          entry.code || 'DRAWING', deterministicSeverity(entry, 'WARN'),
          'DRAWING_GEOMETRY', entry.code || 'Drawing issue', entry.detail || entry.message,
          [drawingKey], 'DRAWING_SKILL'
        ));
      });
    });

    (result && result.validation || []).filter((entry) => entry && entry.result !== 'CALCULATED').forEach((entry) => {
      findings.push(issue(
        entry.id || 'VALIDATION', entry.result === 'FAIL' ? 'BLOCK' : entry.result === 'NOT_CHECKED' ? 'INFO' : 'WARN',
        'ENGINEERING_VALIDATION', entry.rule || entry.id, entry.detail,
        (entry.evidence || []).concat(entry.ref ? [entry.ref] : []), 'VALIDATION_REGISTER'
      ));
    });

    (result && result.warnings || []).forEach((entry, index) => {
      findings.push(issue('ENGINE-WARN-' + String(index + 1).padStart(3, '0'), 'WARN', 'ENGINE_ASSUMPTION',
        '确定性引擎警告', entry, [], 'ENGINE'));
    });

    const severityOrder = { BLOCK: 0, ERROR: 1, WARN: 2, INFO: 3 };
    return findings
      .filter((entry) => entry.id)
      .sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] ||
        left.category.localeCompare(right.category, 'en') || left.id.localeCompare(right.id, 'en'))
      .slice(0, MAX_FINDINGS);
  }

  function endpoint(value) {
    if (!value || typeof value !== 'object') return null;
    const instanceId = cleanText(value.instanceId || value.deviceId, 160);
    const terminalId = cleanText(value.terminalId || value.portId, 160);
    return instanceId && terminalId ? { instanceId, terminalId } : null;
  }

  function compactCircuit(circuit) {
    const from = endpoint(circuit && circuit.fromEndpoint) || endpoint({ instanceId: circuit && circuit.from, terminalId: circuit && circuit.fromPort });
    const to = endpoint(circuit && circuit.toEndpoint) || endpoint({ instanceId: circuit && circuit.to, terminalId: circuit && circuit.toPort });
    return {
      id: cleanText(circuit && circuit.id, 120), netId: cleanText(circuit && circuit.netId, 120),
      netClass: cleanText(circuit && circuit.netClass, 80), domain: cleanText(circuit && circuit.domain, 80),
      from, to
    };
  }

  function knowledgeSnapshot() {
    const evidence = runtimeRoot && runtimeRoot.EVSE_EVIDENCE_LIBRARY;
    const quality = runtimeRoot && runtimeRoot.EVSE_SCHEMATIC_QUALITY;
    const board = runtimeRoot && runtimeRoot.EVSE_BOARD_CIRCUIT_LIBRARY;
    const references = runtimeRoot && runtimeRoot.EVSE_REFERENCE_SYSTEM_LIBRARY;
    const templates = board && board.TEMPLATES || {};
    const systems = references && references.SYSTEMS || {};
    return {
      lifecyclePolicy: {
        deterministicRulesAreAuthoritative: true,
        projectExamplesAreReferenceOnly: true,
        observedExperienceRequiresEngineerReview: true,
        aiMayPromoteKnowledge: false
      },
      deterministicQualityRules: (quality && quality.RULES || []).map((entry) => ({
        id: cleanText(entry.id, 100), title: cleanText(entry.title, 260),
        dimension: cleanText(entry.dimension, 100), severity: cleanText(entry.severity, 60),
        description: cleanText(entry.description, 900),
        evidenceRefs: cleanList(entry.evidenceRefs, 12, 120)
      })),
      observedEngineeringExperience: (evidence && evidence.CLAIMS || []).map((entry) => ({
        id: cleanText(entry.id, 100), severity: cleanText(entry.severity, 60),
        statement: cleanText(entry.statement, 1000), sourceId: cleanText(entry.sourceId, 120),
        pages: Array.isArray(entry.pages) ? entry.pages.slice(0, 8) : [], lifecycle: 'OBSERVED_REVIEW_REQUIRED'
      })),
      boardTemplateIndex: Object.keys(templates).sort().map((id) => {
        const entry = templates[id] || {};
        return { id, name: cleanText(entry.name, 240), family: cleanText(entry.family, 100),
          componentCount: (entry.components || []).length, circuitCount: (entry.circuits || []).length,
          sourceRefs: (entry.sourceRefs || []).slice(0, 6) };
      }),
      projectReferenceIndex: Object.keys(systems).sort().map((id) => {
        const entry = systems[id] || {};
        return { id, name: cleanText(entry.name, 240), sourceId: cleanText(entry.sourceId, 120),
          deviceCount: (entry.devices || []).length, connectionCount: (entry.connections || []).length,
          functionalUnits: (entry.functionalUnits || []).map((unit) => cleanText(unit.name || unit.id, 180)).slice(0, 20),
          unresolvedCount: (entry.unresolved || []).length,
          automaticSelectionAllowed: entry.automaticSelectionAllowed === true };
      })
    };
  }

  function buildCase(result, options) {
    if (!result || typeof result !== 'object') throw new TypeError('A compiled engineering result is required.');
    const model = result.design;
    if (!model || !Array.isArray(model.instances) || !Array.isArray(model.nets) || !Array.isArray(model.circuits)) {
      throw new TypeError('The result must contain an authoritative EDEM design.');
    }
    const quality = result.schematicQuality || {};
    const drawingSkill = result.drawingSkill || {};
    const localFindings = deterministicFindings(result);
    const payload = {
      schema: SCHEMA,
      version: VERSION,
      subject: {
        projectId: cleanText(model.project && model.project.id, 160),
        projectName: cleanText(model.project && model.project.name || result.pileName, 240),
        modelSchema: cleanText(model.schema, 120),
        modelHash: cleanText(model.modelHash, 120),
        standardId: cleanText(result.standardId || model.requirements && model.requirements.standard, 80),
        archetype: cleanText(result.archetype && result.archetype.id || model.requirements && model.requirements.archetype, 80)
      },
      counts: {
        instances: model.instances.length, nets: model.nets.length, circuits: model.circuits.length,
        functionalUnits: finiteInteger(model.topology && model.topology.functionalUnits && model.topology.functionalUnits.length, 0)
      },
      gates: {
        model: resultStatus(model.modelValidation && model.modelValidation.status),
        drawing: resultStatus(drawingSkill.status),
        quality: resultStatus(quality.status),
        constructionRelease: cleanText(result.releaseGate && result.releaseGate.constructionStatus, 120) || 'BLOCKED'
      },
      assumptions: (result.assumptions || []).slice(0, 30).map((entry) => ({
        id: cleanText(entry.id, 120), value: cleanText(entry.value, 300), note: cleanText(entry.note, 700)
      })),
      circuits: model.circuits.slice(0, 600).map(compactCircuit),
      localFindings,
      knowledgeContext: knowledgeSnapshot(),
      reviewPolicy: {
        aiRole: 'OBSERVATION_ONLY', lifecycle: 'CANDIDATE',
        authoritativeSources: ['EDEM', 'ERC', 'DRAWING_IR', 'APPROVED_KNOWLEDGE'],
        forbiddenClaims: ['COMPLIANT', 'PRODUCTION_READY', 'APPROVED', 'SIGNED_OFF'],
        humanApprovalRequired: true,
        note: 'AI observations cannot modify the electrical model, approve a component, close an ERC issue or release a drawing.'
      }
    };
    if (options && options.file) {
      payload.attachment = {
        name: cleanText(options.file.name, 200), mimeType: cleanText(options.file.mimeType, 100),
        byteLength: finiteInteger(options.file.byteLength, 0), sha256: cleanText(options.file.sha256, 100)
      };
    }
    payload.reviewCaseHash = hash(payload);
    return payload;
  }

  function normaliseCandidate(value, reviewCase) {
    const input = value && typeof value === 'object' ? value : {};
    const severity = { BLOCK: true, ERROR: true, WARN: true, INFO: true };
    const findings = (Array.isArray(input.findings) ? input.findings : []).slice(0, MAX_FINDINGS).map((entry, index) => {
      const rawLevel = cleanText(entry && entry.severity, 20).toUpperCase();
      const levelMap = { BLOCKER: 'BLOCK', MAJOR: 'ERROR', MINOR: 'WARN', INFO: 'INFO' };
      const level = levelMap[rawLevel] || rawLevel;
      const evidence = (Array.isArray(entry && entry.evidence) ? entry.evidence : []).map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        return [cleanText(item.source, 100), cleanText(item.locator, 180), cleanText(item.observation, 300)]
          .filter(Boolean).join(' · ');
      }).filter(Boolean);
      const recommendation = cleanText(entry && entry.recommendation, 700);
      return issue(
        'AI-CAND-' + String(index + 1).padStart(3, '0'), severity[level] ? level : 'WARN',
        entry && (entry.category || entry.code), entry && entry.title,
        cleanText(entry && (entry.detail || entry.description), 900) +
          (recommendation ? '；建议复核：' + recommendation : ''),
        cleanList(evidence, 12, 500), 'AI_OBSERVATION'
      );
    });
    const unresolvedSource = Array.isArray(input.unresolvedItems) ? input.unresolvedItems : input.unresolved;
    const unresolvedItems = (Array.isArray(unresolvedSource) ? unresolvedSource : []).map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return [cleanText(item.question, 300), cleanText(item.reason, 400),
        item.requiredEvidence ? '所需证据：' + cleanText(item.requiredEvidence, 400) : ''].filter(Boolean).join('；');
    });
    const output = {
      schema: CANDIDATE_SCHEMA, version: VERSION, lifecycle: 'CANDIDATE',
      approvalStatus: 'UNREVIEWED', modelMutationAllowed: false, releaseDecisionAllowed: false,
      reviewCaseHash: cleanText(reviewCase && reviewCase.reviewCaseHash || input.reviewCaseHash, 120),
      summary: cleanText(input.summary, 1800), findings,
      unresolvedItems: cleanList(unresolvedItems, 30, 900),
      sourceCitations: cleanList(input.sourceCitations, 30, 800),
      limitations: cleanList(input.limitations, 20, 500),
      disclaimer: 'AI审图结果仅为待复核候选意见，不改变EDEM/ERC结论，不代表标准符合、专业校审或签发。'
    };
    output.candidateHash = hash(output);
    return output;
  }

  return Object.freeze({
    VERSION, SCHEMA, CANDIDATE_SCHEMA, buildCase, deterministicFindings, deterministicSeverity, normaliseCandidate,
    knowledgeSnapshot, hash
  });
});
