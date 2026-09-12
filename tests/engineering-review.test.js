'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderedEngineFiles } = require('../scripts/core-modules.js');
const review = require('../engine/engineering-review.js');

function result() {
  return {
    pileName: 'demo', standardId: 'gb', archetype: { id: 'dc-integrated' },
    design: {
      schema: 'EVSE-EDEM/4.1', modelHash: 'model-1', project: { id: 'P1', name: 'Demo' },
      instances: [{ id: 'QF1' }, { id: 'KM1' }], nets: [{ id: 'N1' }],
      circuits: [{ id: 'C1', netId: 'N1', netClass: 'POWER_DC', domain: 'HV_DC',
        from: 'QF1', fromPort: 'OUT', to: 'KM1', toPort: 'IN' }],
      topology: { functionalUnits: [{ id: 'F1' }] },
      modelValidation: { status: 'BLOCKED', violations: [{ ruleId: 'ERC-X', severity: 'BLOCK', message: 'bad', circuitId: 'C1' }] }
    },
    drawingSkill: { status: 'ACTIVE', drawingAudits: {} },
    schematicQuality: { status: 'BLOCKED', checks: [{ ruleId: 'QR-X', ok: false, result: 'FAIL',
      severity: 'BLOCKING', detail: 'check me', dimension: 'READABILITY' }] },
    validation: [{ id: 'V1', result: 'NOT_CHECKED', rule: 'thermal', detail: 'missing', evidence: [] }],
    assumptions: [{ id: 'A1', value: 'x', note: 'y' }], warnings: ['warning'],
    releaseGate: { constructionStatus: 'BLOCKED' }
  };
}

test('buildCase binds deterministic findings to a stable authoritative snapshot', () => {
  const first = review.buildCase(result());
  const second = review.buildCase(result());
  assert.deepEqual(second, first);
  assert.equal(first.reviewCaseHash, second.reviewCaseHash);
  assert.equal(first.counts.circuits, 1);
  assert.deepEqual(first.circuits[0].from, { instanceId: 'QF1', terminalId: 'OUT' });
  assert.equal(first.localFindings[0].severity, 'BLOCK');
  assert.equal(first.localFindings.find((item) => item.id === 'QR-X').severity, 'BLOCK');
  assert.equal(first.reviewPolicy.aiRole, 'OBSERVATION_ONLY');
  assert.equal(first.reviewPolicy.humanApprovalRequired, true);
  assert.equal(first.knowledgeContext.lifecyclePolicy.aiMayPromoteKnowledge, false);
});

test('browser review case carries human-authored rules and labelled project evidence as non-authoritative context', () => {
  const win = {};
  const engineDir = path.resolve(__dirname, '..', 'engine');
  orderedEngineFiles(engineDir).forEach((file) => {
    new Function('window', 'document', fs.readFileSync(path.join(engineDir, file), 'utf8'))(win, {});
  });
  const built = win.EVSE_ENGINE.build(Object.assign({}, win.EVSE_REQUIREMENT_SPEC.DEFAULTS, {
    pileName: 'REVIEW-KNOWLEDGE', requirementConfirmed: true
  }));
  const reviewCase = win.SCHEMATIC_ENGINEERING_REVIEW.buildCase(built);
  assert.ok(reviewCase.knowledgeContext.deterministicQualityRules.length >= 10);
  assert.ok(reviewCase.knowledgeContext.observedEngineeringExperience.length >= 5);
  assert.ok(reviewCase.knowledgeContext.boardTemplateIndex.length >= 7);
  assert.ok(reviewCase.knowledgeContext.projectReferenceIndex.length >= 2);
  reviewCase.knowledgeContext.projectReferenceIndex.forEach((entry) => {
    assert.equal(entry.automaticSelectionAllowed, false);
  });
});

test('normaliseCandidate cannot manufacture approval or model mutation authority', () => {
  const reviewCase = review.buildCase(result());
  const candidate = review.normaliseCandidate({
    lifecycle: 'APPROVED', approvalStatus: 'APPROVED', modelMutationAllowed: true,
    summary: '<script>observation</script>',
    findings: [{ severity: 'BLOCK', category: 'PIN', title: '端子', detail: '复核', evidence: ['C1'] }],
    unresolvedItems: ['需要工程师确认']
  }, reviewCase);
  assert.equal(candidate.lifecycle, 'CANDIDATE');
  assert.equal(candidate.approvalStatus, 'UNREVIEWED');
  assert.equal(candidate.modelMutationAllowed, false);
  assert.equal(candidate.releaseDecisionAllowed, false);
  assert.equal(candidate.reviewCaseHash, reviewCase.reviewCaseHash);
  assert.match(candidate.candidateHash, /^fnv1a32-/);
});

test('buildCase rejects drawings without an authoritative EDEM model', () => {
  assert.throws(() => review.buildCase({ design: { instances: [] } }), /authoritative EDEM/i);
});
