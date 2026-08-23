/* ============================================================
 * EVSE model/drawing integrity gate v3
 * ------------------------------------------------------------
 * Validates the terminal netlist, renderer-neutral Drawing IR and SVG trace
 * tags in that order. It never infers connections from pixels or colours.
 * ============================================================ */
window.EVSE_DRAWING_SKILL = (function () {
  'use strict';

  const ID = 'EVSE-MODEL-DRAWING-INTEGRITY-SKILL';
  const VERSION = '3.0.0';
  const BASIS_STATUS = 'EDEM_V4_AND_GEOMETRY_IR—PROFESSIONAL_REVIEW_REQUIRED';
  const DRAWING_KEY = 'ev-schematic';
  const SOURCE_LIBRARY = Object.freeze([
    { id: 'SRC-EV-CN', file: 'sch_lib/国标60kW充电桩原理图.svg', type: 'visual-reference', reviewed: true },
    { id: 'SRC-EV-EU', file: 'sch_lib/欧标充电桩电气原理图.svg', type: 'visual-reference', reviewed: true }
  ]);

  const RULES = Object.freeze([
    { id: 'ERC-001', group: 'model', enforcement: 'BLOCKING', text: '设备、物理端子和受控器件定义必须完整且唯一。' },
    { id: 'ERC-010', group: 'model', enforcement: 'BLOCKING', text: '网络必须引用存在的精确端子，且一个物理端子只能属于一个电气网络。' },
    { id: 'ERC-020', group: 'model', enforcement: 'BLOCKING', text: '网络类别、电气域、相别、极性、电压和协议必须兼容。' },
    { id: 'ERC-030', group: 'model', enforcement: 'BLOCKING', text: '所有必接物理端子都必须连接。' },
    { id: 'ERC-040', group: 'model', enforcement: 'BLOCKING', text: '每条可绘制回路必须与网络的精确端点等价。' },
    { id: 'ERC-050', group: 'model', enforcement: 'BLOCKING', text: '充电连接器 DC+、DC− 与 PE 必须分别接入正确网络。' },
    { id: 'G037', group: 'geometry', enforcement: 'BLOCKING', text: '不同网络正交交叉必须显示跨线，同网连接必须显示连接点。' },
    { id: 'G043', group: 'geometry', enforcement: 'BLOCKING', text: '导线不得发生共线重叠或自交。' },
    { id: 'G045', group: 'geometry', enforcement: 'BLOCKING', text: '导线不得穿过设备 keepout。' },
    { id: 'G046', group: 'geometry', enforcement: 'BLOCKING', text: '通道容量与 lane 分配必须由确定性路由器证明可行。' },
    { id: 'G047', group: 'coverage', enforcement: 'BLOCKING', text: '每台设备、每个网络、每条回路及其端点必须由 Drawing IR 精确覆盖。' },
    { id: 'G048', group: 'traceability', enforcement: 'BLOCKING', text: 'SVG 与 DXF 必须保留 equipment/net/circuit/endpoint 追溯标识。' },
    { id: 'DOC-001', group: 'document', enforcement: 'BLOCKING', text: '输出必须是完整 A3 SVG，并保留图号、修订和审核状态。' },
    { id: 'DOC-002', group: 'document', enforcement: 'BLOCKING', text: '图纸必须携带模型 schema、几何哈希和覆盖状态。' },
    { id: 'DOC-003', group: 'document', enforcement: 'BLOCKING', text: '图纸不得包含 NaN、Infinity 或 undefined 坐标。' },
    { id: 'DOC-004', group: 'document', enforcement: 'GUIDANCE', text: '自动图纸仍须专业校核、试验和签发，不得标记为施工图。' }
  ]);

  const PROFILES = Object.freeze({
    'ev-schematic': { id: 'edem-v4-terminal-schematic', rules: RULES.map((rule) => rule.id) }
  });

  function unique(values) { return Array.from(new Set((values || []).filter(Boolean))); }
  function profileFor(drawingKey) { return Object.prototype.hasOwnProperty.call(PROFILES, drawingKey) ? PROFILES[drawingKey] : null; }
  function rulesFor(drawingKey) {
    const profile = profileFor(drawingKey);
    return profile ? profile.rules.map((id) => RULES.find((rule) => rule.id === id)).filter(Boolean).map((rule) => Object.assign({}, rule)) : [];
  }
  function check(code, ruleId, ok, severity, detail, evidence) {
    return { code, ruleId, ok: !!ok, status: ok ? 'CHECKED' : 'VIOLATION', severity: severity || 'ERROR', detail, evidence: evidence || [] };
  }

  function validateGraph(result) {
    const design = result && result.design;
    let erc;
    if (!design) {
      erc = { status: 'BLOCKED', blockingCount: 1, checks: [], violations: [{ ruleId: 'ERC-001', code: 'MODEL_MISSING', message: 'EDEM 设计模型缺失。', severity: 'BLOCK' }] };
    } else if (window.EVSE_ERC && typeof window.EVSE_ERC.validate === 'function') {
      erc = window.EVSE_ERC.validate(design);
      design.modelValidation = erc;
    } else {
      erc = { status: 'BLOCKED', blockingCount: 1, checks: [], violations: [{ ruleId: 'ERC-001', code: 'ERC_MISSING', message: 'EVSE_ERC 未加载。', severity: 'BLOCK' }] };
    }
    const checks = [];
    (erc.checks || []).forEach((item) => {
      const details = (erc.violations || []).filter((violation) => violation.ruleId === item.ruleId)
        .map((violation) => violation.code + ': ' + violation.message);
      checks.push(check('EDEM-' + item.ruleId, item.ruleId, item.status === 'PASS', 'ERROR',
        item.title + (details.length ? '；' + details.join('；') : '。'), details));
    });
    if (!checks.length && erc.blockingCount) {
      checks.push(check('EDEM-ERC-MISSING', 'ERC-001', false, 'ERROR', (erc.violations[0] && erc.violations[0].message) || 'ERC 未执行。'));
    }
    return {
      status: erc.blockingCount ? 'BLOCKED' : 'CHECKED', checks,
      violations: (erc.violations || []).slice(), blockingCount: Number(erc.blockingCount || 0),
      checkedCount: checks.length, evaluatedRuleIds: unique(checks.map((item) => item.ruleId)),
      ercVersion: erc.version || null, stats: erc.stats || null
    };
  }

  function syncRuleCoverage(report) {
    if (!report) return;
    report.selectedRuleIds = PROFILES[DRAWING_KEY].rules.slice();
    report.evaluatedRuleIds = unique(report.evaluatedRuleIds || []);
    report.appliedRuleIds = report.evaluatedRuleIds.slice();
    report.guidanceRuleIds = RULES.filter((rule) => rule.enforcement === 'GUIDANCE').map((rule) => rule.id);
    report.skippedRuleIds = report.selectedRuleIds.filter((id) => !report.evaluatedRuleIds.includes(id)).map((ruleId) => ({
      ruleId,
      reason: RULES.find((rule) => rule.id === ruleId).enforcement === 'GUIDANCE'
        ? 'GUIDANCE_ONLY—PROFESSIONAL_REVIEW_REQUIRED' : 'PENDING_DRAWING_IR_AUDIT'
    }));
  }

  function updateReadiness(result) {
    if (!result || !result.drawingSkill) return;
    const report = result.drawingSkill;
    const blocked = report.status === 'BLOCKED';
    result.validation = (result.validation || []).filter((entry) => entry.id !== 'DRAW-SKILL-001');
    result.validation.push({
      id: 'DRAW-SKILL-001', result: blocked ? 'WARN' : 'CALCULATED', rule: 'EDEM/ERC/图模等价性自动闸门', ref: ID + '@' + VERSION,
      detail: blocked ? '自动闸门存在阻断项；SVG/DXF 导出已关闭。' : '端子级 ERC 与 Drawing IR 图模覆盖自动检查已通过；仍不替代专业审查。',
      evidence: report.evaluatedRuleIds.slice()
    });
    result.compliance = result.validation;
    if (result.readiness) {
      result.readiness.blockingItems = (result.readiness.blockingItems || []).filter((item) => !/^DRAWING-|^EDEM-ERC/.test(item.id || ''));
      if (blocked) result.readiness.blockingItems.push({ id: 'EDEM-ERC-DRAWING', title: 'EDEM/ERC/图模等价性闸门未通过', status: 'BLOCKED', detail: '查看 drawingSkill.graphValidation 与 drawingAudits。' });
      if (result.readiness.release) result.readiness.release.drawingRuleStatus = blocked ? 'BLOCKED—DRAWING_INTEGRITY_FAILED' : 'PASS—CONCEPT_EXPORT_ONLY';
    }
    result.releaseGate = result.readiness && result.readiness.release ? result.readiness.release : result.releaseGate;
    if (result.design) result.design.drawingSkill = {
      id: report.id, version: report.version, status: report.status,
      selectedRuleIds: report.selectedRuleIds.slice(), evaluatedRuleIds: report.evaluatedRuleIds.slice()
    };
  }

  function apply(result) {
    const graphValidation = validateGraph(result);
    const report = {
      id: ID, version: VERSION, basisStatus: BASIS_STATUS, profile: PROFILES[DRAWING_KEY].id,
      status: graphValidation.blockingCount ? 'BLOCKED' : 'READY_FOR_RENDER_AUDIT',
      selectedRuleIds: PROFILES[DRAWING_KEY].rules.slice(), evaluatedRuleIds: graphValidation.evaluatedRuleIds.slice(),
      appliedRuleIds: graphValidation.evaluatedRuleIds.slice(), skippedRuleIds: [], graphValidation,
      drawingAudits: {}, renderBlockingCount: 0, blockingCount: graphValidation.blockingCount
    };
    result.drawingSkill = report;
    syncRuleCoverage(report);
    updateReadiness(result);
    return result;
  }

  function metadata(result, drawingKey) {
    const profile = profileFor(drawingKey);
    const report = result && result.drawingSkill;
    if (!profile) return { id: ID, version: VERSION, profile: 'UNKNOWN_DRAWING_PROFILE', status: 'BLOCKED', selectedRuleIds: [], evaluatedRuleIds: [], appliedRuleIds: [] };
    return {
      id: ID, version: VERSION, profile: profile.id, basisStatus: BASIS_STATUS,
      selectedRuleIds: profile.rules.slice(), evaluatedRuleIds: report ? unique(report.evaluatedRuleIds) : [],
      appliedRuleIds: report ? unique(report.appliedRuleIds) : [], status: report ? report.status : 'NOT_APPLIED',
      modelHash: result && result.design && result.design.modelHash || null,
      geometryHash: result && result.drawingGeometryHash || null
    };
  }

  function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function attrPresent(text, name, value) {
    return value != null && new RegExp('\\b' + escapeRegExp(name) + '="' + escapeRegExp(value) + '"').test(text);
  }

  function attributeValues(text, name) {
    const values = new Set();
    const pattern = new RegExp('\\b' + escapeRegExp(name) + '="([^"]*)"', 'g');
    let match;
    while ((match = pattern.exec(text))) {
      values.add(match[1]
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    }
    return values;
  }

  function auditMarkup(markup, drawingKey, result) {
    const text = String(markup || '');
    const profile = profileFor(drawingKey);
    if (!profile) return {
      drawingKey, profile: 'UNKNOWN_DRAWING_PROFILE', status: 'BLOCKED', blockingCount: 1, evaluatedRuleIds: ['DOC-001'],
      checks: [check('G000-UNKNOWN-PROFILE', 'DOC-001', false, 'ERROR', '未知图型 profile，禁止导出。')]
    };
    const checks = [];
    const add = (code, ruleId, ok, detail, evidence) => checks.push(check(code, ruleId, ok, 'ERROR', detail, evidence));
    const ir = result && result.drawingIR;
    const design = result && result.design;
    const IR = window.EVSE_DRAWING_IR;

    add('G000-SVG-COMPLETE', 'DOC-001', /^<svg\b/.test(text) && /<\/svg>\s*$/.test(text), '输出必须是完整 SVG。');
    add('G001-A3', 'DOC-001', /width="420mm"/.test(text) && /height="297mm"/.test(text), '输出必须保留 A3 物理图幅。');
    add('G002-DOCUMENT-CONTROL', 'DOC-001', /图号:/.test(text) && /修订:/.test(text) && /校核:/.test(text) && /批准:/.test(text), 'SVG 必须包含图号、修订、校核和批准字段。');
    add('G003-FINITE', 'DOC-003', !/\b(?:undefined|NaN|Infinity|-Infinity)\b/.test(text), 'SVG 不得包含未解析值或非有限坐标。');
    add('G004-IR-ROOT', 'DOC-002', !!ir && attrPresent(text, 'data-ir-schema', ir && ir.schema), 'SVG 根必须记录 Drawing IR schema。');
    add('G005-COVERAGE-ROOT', 'DOC-002', attrPresent(text, 'data-coverage-status', 'PASS'), 'SVG 根必须记录图模覆盖 PASS。');
    add('G006-LEGEND', 'DOC-001', /图例|LEGEND/.test(text), '图面必须包含网络类别图例。');
    add('G007-SCHEDULE', 'DOC-001', /设备明细表/.test(text), '图面必须包含由 instances 派生的设备明细表。');

    let coverage = null;
    let irValid = false;
    if (ir && design && IR && typeof IR.auditCoverage === 'function') {
      try {
        coverage = IR.auditCoverage(design, ir);
        if (typeof IR.assertValidDrawingIR === 'function') IR.assertValidDrawingIR(ir);
        irValid = true;
      } catch (_) { irValid = false; }
    }
    add('G047-MODEL-COVERAGE', 'G047', !!coverage && coverage.ok, 'Drawing IR 必须精确覆盖全部设备、网络、回路及端点。', coverage && coverage.errors || []);
    add('G043-NO-OVERLAP', 'G043', !!ir && Array.isArray(ir.violations) && !ir.violations.some((item) => item.code === 'ILLEGAL_COLLINEAR_OVERLAP' || item.code === 'ILLEGAL_SELF_CROSSING'), 'Drawing IR 不得有共线重叠或自交。');
    add('G045-NO-KEEPOUT', 'G045', !!ir && Array.isArray(ir.violations) && !ir.violations.some((item) => item.code === 'ROUTE_KEEP_OUT_INTERSECTION'), 'Drawing IR 导线不得穿过设备 keepout。');
    add('G046-ROUTER-VALID', 'G046', irValid && (!ir.violations || ir.violations.length === 0), '路由器必须在通道容量内完成无几何违规的确定性布线。', ir && ir.violations || []);

    const markers = ir && Array.isArray(ir.markers) ? ir.markers : [];
    const bridges = markers.filter((marker) => marker.type === 'bridge');
    const junctions = markers.filter((marker) => marker.type === 'junction');
    const renderedBridgeCount = (text.match(/data-marker="bridge"/g) || []).length;
    const renderedJunctionCount = (text.match(/data-marker="junction"/g) || []).length;
    add('G037-CROSSINGS', 'G037', !!ir && renderedBridgeCount >= bridges.length && renderedJunctionCount >= junctions.length,
      '全部跨线与同网连接点必须由全局后处理结果渲染。', { expectedBridges: bridges.length, renderedBridgeCount, expectedJunctions: junctions.length, renderedJunctionCount });

    const missingEquipment = [];
    const missingCircuits = [];
    const missingNets = [];
    const endpointMismatch = [];
    const renderedEquipment = attributeValues(text, 'data-equipment');
    const renderedNets = attributeValues(text, 'data-net');
    const renderedCircuits = attributeValues(text, 'data-circuit');
    const routeByCircuit = new Map(((ir && ir.routes) || []).map((route) => [route.circuitId, route]));
    ((design && (design.instances || design.equipment)) || []).forEach((instance) => {
      if (!renderedEquipment.has(instance.id)) missingEquipment.push(instance.id);
    });
    ((design && design.nets) || []).forEach((net) => { if (!renderedNets.has(net.id)) missingNets.push(net.id); });
    ((design && design.circuits) || []).forEach((circuit) => {
      if (!renderedCircuits.has(circuit.id)) missingCircuits.push(circuit.id);
      const from = circuit.from + ':' + circuit.fromPort;
      const to = circuit.to + ':' + circuit.toPort;
      const route = routeByCircuit.get(circuit.id);
      if (!route || route.source.ref !== from || route.target.ref !== to) endpointMismatch.push(circuit.id);
    });
    add('G048-EQUIPMENT-TRACE', 'G048', missingEquipment.length === 0, 'SVG 必须保留每台设备的 data-equipment。', missingEquipment);
    add('G048-NET-TRACE', 'G048', missingNets.length === 0, 'SVG 必须保留每个网络的 data-net。', missingNets);
    add('G048-CIRCUIT-TRACE', 'G048', missingCircuits.length === 0, 'SVG 必须保留每条回路的 data-circuit。', missingCircuits);
    add('G048-ENDPOINT-TRACE', 'G048', endpointMismatch.length === 0, '每条图形路由必须保持模型的精确 from/to 端点。', endpointMismatch);

    let expectedHash = '';
    if (ir && IR && typeof IR.drawingIRHash === 'function') expectedHash = IR.drawingIRHash(ir);
    add('G008-GEOMETRY-HASH', 'DOC-002', !!expectedHash && attrPresent(text, 'data-geometry-hash', expectedHash), 'SVG 必须携带与 Drawing IR 一致的几何哈希。');

    const blocking = checks.filter((item) => !item.ok && item.severity === 'ERROR');
    return {
      drawingKey, profile: profile.id, status: blocking.length ? 'BLOCKED' : 'CHECKED', checks,
      blockingCount: blocking.length, evaluatedRuleIds: unique(checks.map((item) => item.ruleId)),
      coverage, geometryHash: expectedHash || null
    };
  }

  function recordDrawingAudit(result, drawingKey, audit) {
    if (!result || !result.drawingSkill) return;
    result.drawingSkill.drawingAudits[drawingKey] = audit;
    result.drawingSkill.evaluatedRuleIds = unique(result.drawingSkill.evaluatedRuleIds.concat(audit && audit.evaluatedRuleIds || []));
    syncRuleCoverage(result.drawingSkill);
  }

  function finalizeDrawingAudits(result) {
    if (!result || !result.drawingSkill) return result;
    const report = result.drawingSkill;
    if (!report.drawingAudits[DRAWING_KEY]) {
      report.drawingAudits[DRAWING_KEY] = {
        drawingKey: DRAWING_KEY, profile: PROFILES[DRAWING_KEY].id, status: 'BLOCKED', blockingCount: 1, evaluatedRuleIds: ['DOC-001'],
        checks: [check('G000-AUDIT-MISSING', 'DOC-001', false, 'ERROR', '图纸尚未执行 Drawing IR/SVG 一致性审计。')]
      };
    }
    const audits = Object.values(report.drawingAudits);
    report.renderBlockingCount = audits.reduce((sum, audit) => sum + Number(audit && audit.blockingCount || 0), 0);
    report.blockingCount = Number(report.graphValidation.blockingCount || 0) + report.renderBlockingCount;
    report.status = report.blockingCount ? 'BLOCKED' : 'ACTIVE';
    report.evaluatedRuleIds = unique(report.evaluatedRuleIds.concat(...audits.map((audit) => audit.evaluatedRuleIds || [])));
    syncRuleCoverage(report);
    updateReadiness(result);
    return result;
  }

  function canExport(result, drawingKey, format) {
    const report = result && result.drawingSkill;
    if (!report) return { allowed: false, reason: '绘图完整性报告缺失，禁止导出。', format };
    if (Number(report.graphValidation && report.graphValidation.blockingCount || 0) > 0) return { allowed: false, reason: '端子级 ERC 存在阻断项，禁止导出。', format };
    const audit = report.drawingAudits && report.drawingAudits[drawingKey];
    if (!audit) return { allowed: false, reason: '当前图纸尚未执行图模一致性审计，禁止导出。', format };
    if (Number(audit.blockingCount || 0) > 0 || Number(report.renderBlockingCount || 0) > 0) return { allowed: false, reason: 'Drawing IR/SVG 图模一致性审计未通过，禁止导出。', format };
    if (!result.drawingIR || !result.drawingIR.coverage || !result.drawingIR.coverage.ok) return { allowed: false, reason: 'Drawing IR 缺失或未完整覆盖模型，禁止导出。', format };
    return { allowed: true, reason: '允许导出方案级原理图；不得作为生产图、施工图或规范符合性证明。', format };
  }

  return {
    ID, VERSION, BASIS_STATUS, DRAWING_KEY, SOURCE_LIBRARY, RULES, PROFILES,
    profileFor, rulesFor, validateGraph, apply, metadata,
    auditMarkup, recordDrawingAudit, finalizeDrawingAudits, canExport
  };
})();
