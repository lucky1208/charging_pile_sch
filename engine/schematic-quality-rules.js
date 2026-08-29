/* ============================================================
 * Evidence-backed schematic quality rules
 * ------------------------------------------------------------
 * Safety blockers and drawing quality scores are deliberately separate.
 * A pretty drawing can never compensate for an unsafe topology, and a
 * missing project calculation is reported as unresolved rather than guessed.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  let board = root && root.EVSE_BOARD_CIRCUIT_LIBRARY;
  let evidence = root && root.EVSE_EVIDENCE_LIBRARY;
  let references = root && root.EVSE_REFERENCE_SYSTEM_LIBRARY;
  let systemSymbols = root && root.EVSE_IEC_SYMBOL_CATALOG;
  if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
    board = board || require('./board-circuit-library.js');
    evidence = evidence || require('./evidence-library.js');
    references = references || require('./reference-system-library.js');
    systemSymbols = systemSymbols || require('./iec-symbol-catalog.js');
  }
  const api = factory(board, evidence, references, systemSymbols);
  if (root) root.EVSE_SCHEMATIC_QUALITY = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (BOARD, EVIDENCE, REFERENCES, SYSTEM_SYMBOLS) {
  'use strict';

  const VERSION = '1.2.0';
  const DIMENSIONS = Object.freeze([
    'ELECTRICAL_COMPLETENESS', 'FUNCTIONAL_SAFETY', 'DIAGNOSTIC_COVERAGE',
    'ISOLATION_AND_PROTECTION', 'EMC_AND_SURGE', 'TESTABILITY',
    'READABILITY', 'TRACEABILITY', 'MAINTAINABILITY'
  ]);

  function rule(id, title, dimension, severity, appliesTo, evidenceRefs, description) {
    return Object.freeze({ id, title, dimension, severity, appliesTo,
      evidenceRefs: Object.freeze(evidenceRefs || []), description });
  }

  const RULES = Object.freeze([
    rule('QR-001', '所有导线必须具有精确的器件端点与PIN脚', 'ELECTRICAL_COMPLETENESS', 'BLOCKING', 'BOTH',
      ['SRC-COMPARISON-DOCX:p1-p79', 'SRC-EU-PROJECT-SVG', 'SRC-GB60-PROJECT-SVG'],
      '不允许仅以视觉相交或文字标签猜测连接。'),
    rule('QR-002', '信号导线点对点独立表达', 'READABILITY', 'BLOCKING', 'SYSTEM',
      ['SRC-EU-PROJECT-SVG', 'SRC-GB60-PROJECT-SVG'], '电源母排以外不得把多根信号隐式合并为一根共享走线。'),
    rule('QR-003', '图、网表与端子覆盖一致', 'TRACEABILITY', 'BLOCKING', 'SYSTEM',
      ['SRC-EU-PROJECT-SVG', 'SRC-GB60-PROJECT-SVG'], '每个模型回路必须恰有可追溯图形实现。'),
    rule('QR-004', '送电前预检不得依赖先闭合主功率接触器', 'FUNCTIONAL_SAFETY', 'BLOCKING', 'BOARD',
      ['OBS-PRECHECK-NO-MAIN-CLOSE'], '测试支路必须限能、可隔离且在主接触器断开时完成。'),
    rule('QR-005', '接触器状态/粘连必须在断开命令后逐安全极覆盖', 'DIAGNOSTIC_COVERAGE', 'BLOCKING', 'BOTH',
      ['SRC-COMPARISON-DOCX:p75-p79'], '单一合并电位不得无分析地替代每个安全隔离极的反馈。'),
    rule('QR-006', 'PE连续性、剩余电流与绝缘监测分开建模', 'FUNCTIONAL_SAFETY', 'BLOCKING', 'SYSTEM',
      ['SRC-COMPARISON-DOCX:p72-p75'], '三者对象、激励、判据和认证路径不同。'),
    rule('QR-007', '高低压边界应有明确隔离或经批准的限能测量论证', 'ISOLATION_AND_PROTECTION', 'MAJOR', 'BOARD',
      ['SRC-COMPARISON-DOCX:p68-p79'], '需要额定隔离电压、爬电、电气间隙和单故障分析。'),
    rule('QR-008', '辅助电源应有浪涌、共模和差模EMI设计证据', 'EMC_AND_SURGE', 'MAJOR', 'BOARD',
      ['SRC-COMPARISON-DOCX:p39-p61'], 'NTC/限流、MOV/GDT、共模扼流和X/Y网络按接地与泄漏预算校核。'),
    rule('QR-009', '整流母线电容电压裕量需按峰值和浪涌计算', 'ISOLATION_AND_PROTECTION', 'MAJOR', 'BOARD',
      ['OBS-400V-BULK-MARGIN'], '不能只按交流有效值选择电解额定电压。'),
    rule('QR-010', 'CP发生电路需证明幅值、短路承受、钳位和EMC', 'FUNCTIONAL_SAFETY', 'MAJOR', 'BOARD',
      ['SRC-COMPARISON-DOCX:p64-p66'], '运放输入输出范围、推挽交越、保护与长线波形都需验证。'),
    rule('QR-011', '检测阈值需包含迟滞、容差、温漂和标定', 'DIAGNOSTIC_COVERAGE', 'MAJOR', 'BOARD',
      ['SRC-COMPARISON-DOCX:p62-p79'], '只给出名义阈值不能证明边界可靠性。'),
    rule('QR-012', '默认状态必须故障安全', 'FUNCTIONAL_SAFETY', 'BLOCKING', 'BOTH',
      ['SRC-COMPARISON-DOCX:p3-p5'], '掉电、断线、MCU复位和测试支路失效不得导致危险送电。'),
    rule('QR-013', 'IEC/GB符号映射与PIN锚点可追溯', 'READABILITY', 'MAJOR', 'BOTH',
      ['SRC-EU-PROJECT-SVG', 'SRC-GB60-PROJECT-SVG'], '符号几何、器件定义和实例引脚映射应分层管理。'),
    rule('QR-014', '图纸应提供测试点、状态命名与故障诊断路径', 'TESTABILITY', 'ADVISORY', 'BOTH',
      ['SRC-COMPARISON-DOCX:p1-p79'], '便于样机调试、产测和售后定位。'),
    rule('QR-015', '参考图优缺点必须保留来源和适用条件', 'TRACEABILITY', 'MAJOR', 'BOTH',
      ['SRC-COMPARISON-DOCX:p1-p79'], '经验结论不能脱离电网制式、器件数据和试验条件泛化。'),
    rule('QR-016', '共用短路/粘连前端需完成共同原因失效分析', 'DIAGNOSTIC_COVERAGE', 'MAJOR', 'BOARD',
      ['OBS-SHARED-PRECHECK-WELD'], '共享器件可能同时使两种诊断失效。'),
    rule('QR-017', '中性线粘连判据需证明可观测性', 'DIAGNOSTIC_COVERAGE', 'MAJOR', 'BOARD',
      ['OBS-N-PE-ZERO-AMBIGUITY'], 'N-PE正常近零时不能把低电位直接等价为接触器状态。'),
    rule('QR-018', 'Y电容结论应与泄漏预算和EMC试验绑定', 'EMC_AND_SURGE', 'ADVISORY', 'BOARD',
      ['OBS-EMI-Y-CAP-ABSENT'], '缺少Y电容是风险信号，但并非脱离系统条件即可判定不合格。')
    ,rule('QR-019', '系统功能单元应与真实项目参考矩阵逐项对照', 'ELECTRICAL_COMPLETENESS', 'MAJOR', 'SYSTEM',
      ['SRC-EU-PROJECT-SVG', 'SRC-GB60-PROJECT-SVG'],
      '至少对输入保护、储能安全链、功率变换、逐极输出隔离、接口信号、辅助电源、控制通信和诊断进行适用性核对。')
  ]);

  function check(ruleId, ok, result, detail, extra) {
    const definition = RULES.find((item) => item.id === ruleId);
    return Object.freeze(Object.assign({
      ruleId, title: definition ? definition.title : ruleId,
      dimension: definition ? definition.dimension : 'UNCLASSIFIED',
      severity: definition ? definition.severity : 'MAJOR',
      ok: ok === true, result: result || (ok ? 'PASS' : 'FAIL'), detail: String(detail || ''),
      evidenceRefs: definition ? definition.evidenceRefs : Object.freeze([])
    }, extra || {}));
  }

  function hasKind(instances, patterns) {
    const tests = patterns.map((pattern) => new RegExp(pattern, 'i'));
    return instances.some((item) => tests.some((test) => test.test(String(item.kind || item.type || item.id || ''))));
  }
  function circuitTouches(circuit, instanceId) {
    return !!circuit && (circuit.from === instanceId || circuit.to === instanceId ||
      String(circuit.from || '').startsWith(instanceId + ':') || String(circuit.to || '').startsWith(instanceId + ':'));
  }
  function circuitPort(circuit, instanceId) {
    if (!circuit) return '';
    if (circuit.from === instanceId) return String(circuit.fromPort || '');
    if (circuit.to === instanceId) return String(circuit.toPort || '');
    if (String(circuit.from || '').startsWith(instanceId + ':')) return String(circuit.from).slice(instanceId.length + 1);
    if (String(circuit.to || '').startsWith(instanceId + ':')) return String(circuit.to).slice(instanceId.length + 1);
    return '';
  }
  function resolvedPhysicalPin(value) {
    const text = String(value == null ? '' : value).trim();
    return !!text && !/UNRESOLVED|UNKNOWN|TBD|REVIEW_REQUIRED/i.test(text);
  }
  function systemSymbolAndPinAudit(design, ir) {
    const devices = Array.isArray(ir.devices) ? ir.devices : [];
    const primitives = Array.isArray(ir.primitives) ? ir.primitives : [];
    const instances = Array.isArray(design.instances) ? design.instances : [];
    if (!devices.length) return { geometryOk: false, physicalOk: false, geometryIssues: ['NO_DRAWING_DEVICES'], physicalIssues: [] };
    const geometryIssues = [];
    devices.forEach((device) => {
      if (device.symbolFallback || !String(device.symbolId || '').trim()) geometryIssues.push(device.id + ':UNRESOLVED_SYMBOL');
      const catalogDefinition = SYSTEM_SYMBOLS && typeof SYSTEM_SYMBOLS.get === 'function'
        ? SYSTEM_SYMBOLS.get(device.symbolId) : null;
      if (!catalogDefinition) geometryIssues.push(device.id + ':SYMBOL_NOT_IN_CONTROLLED_CATALOG');
      else if (SYSTEM_SYMBOLS.instantiate) {
        try {
          const instantiated = SYSTEM_SYMBOLS.instantiate({
            kind: device.type, symbolId: device.symbolId, bbox: device.bbox || { x: 0, y: 0, width: 100, height: 70 },
            ports: device.ports || [], label: device.label || device.id, tag: device.tag || ''
          });
          if (instantiated.symbolId !== device.symbolId || !instantiated.primitives.length) {
            geometryIssues.push(device.id + ':SYMBOL_GEOMETRY_EMPTY_OR_DIVERGED');
          }
        } catch (error) { geometryIssues.push(device.id + ':SYMBOL_GEOMETRY_ERROR'); }
      }
      const ports = Array.isArray(device.ports) ? device.ports : [];
      if (!ports.length || ports.some((port) => !port.id || !Number.isFinite(Number(port.x)) || !Number.isFinite(Number(port.y)))) {
        geometryIssues.push(device.id + ':INVALID_PIN_ANCHOR');
      }
      if (!primitives.some((primitive) => primitive.equipmentId === device.id &&
          primitive.kind !== 'port' && primitive.symbolId === device.symbolId)) {
        geometryIssues.push(device.id + ':SYMBOL_PRIMITIVES_NOT_RESOLVED');
      }
      ports.forEach((port) => {
        if (!primitives.some((primitive) => primitive.kind === 'port' && primitive.equipmentId === device.id &&
            primitive.portId === port.id && Number(primitive.x) === Number(port.x) && Number(primitive.y) === Number(port.y))) {
          geometryIssues.push(device.id + ':' + port.id + ':PIN_PRIMITIVE_MISSING');
        }
      });
    });
    const physicalIssues = [];
    instances.forEach((instance) => {
      const required = (instance.terminals || instance.physicalTerminals || []).filter((terminal) => terminal.required !== false);
      const explicitMap = instance.pinMap || instance.physicalPinMap || {};
      required.forEach((terminal) => {
        const mapped = explicitMap[terminal.id] != null ? explicitMap[terminal.id] : terminal.physicalPin;
        if (!resolvedPhysicalPin(mapped)) physicalIssues.push(instance.id + ':' + terminal.id);
      });
    });
    return { geometryOk: geometryIssues.length === 0, physicalOk: instances.length > 0 && physicalIssues.length === 0,
      geometryIssues, physicalIssues };
  }
  function safetyFunctionAudit(instances, circuits, patterns, requirements) {
    const candidates = instances.filter((item) => patterns.some((pattern) => new RegExp(pattern, 'i')
      .test(String(item.kind || item.type || item.id || ''))));
    if (!candidates.length) return { present: false, complete: false, details: ['DEVICE_MISSING'] };
    const details = [];
    candidates.forEach((item) => {
      const attached = circuits.filter((wire) => circuitTouches(wire, item.id));
      if (!attached.length) details.push(item.id + ':NO_CONNECTIONS');
      (requirements.requiredPortGroups || []).forEach((group) => {
        if (!group.some((pattern) => attached.some((wire) => new RegExp(pattern, 'i').test(circuitPort(wire, item.id))))) {
          details.push(item.id + ':MISSING_PORT_GROUP:' + group.join('|'));
        }
      });
      const targets = item.monitoredObjectIds || item.protectedObjectIds || item.monitoredCircuitIds || item.protectedCircuitIds || [];
      if (!Array.isArray(targets) || !targets.length) details.push(item.id + ':MONITORED_OBJECT_UNDECLARED');
      if (item.failureAction !== 'INHIBIT_ENERGY_TRANSFER') details.push(item.id + ':FAILURE_ACTION_UNPROVEN');
    });
    return { present: true, complete: details.length === 0, details };
  }
  function scoreChecks(checks) {
    const dimensions = {};
    DIMENSIONS.forEach((dimension) => {
      const relevant = checks.filter((item) => item.dimension === dimension && item.result !== 'NOT_ASSESSED');
      if (!relevant.length) { dimensions[dimension] = Object.freeze({ status: 'NOT_ASSESSED', score: null, assessed: 0 }); return; }
      const points = relevant.reduce((sum, item) => {
        if (item.result === 'PASS') return sum + 100;
        if (item.result === 'UNRESOLVED') return sum + 40;
        return sum;
      }, 0);
      dimensions[dimension] = Object.freeze({ status: relevant.every((item) => item.ok) ? 'PASS' : 'ISSUES',
        score: Math.round(points / relevant.length), assessed: relevant.length });
    });
    return Object.freeze(dimensions);
  }
  function result(scope, checks) {
    const blocking = checks.filter((item) => !item.ok && item.severity === 'BLOCKING' && item.result !== 'NOT_ASSESSED');
    const unresolved = checks.filter((item) => item.result === 'UNRESOLVED' || item.result === 'NOT_ASSESSED');
    return Object.freeze({
      schema: 'EVSE-SCHEMATIC-QUALITY-REPORT/1.0', version: VERSION, scope,
      status: blocking.length ? 'BLOCKED' : checks.some((item) => !item.ok && item.result !== 'NOT_ASSESSED') ? 'REVIEW_REQUIRED' : 'PASS',
      blockingCount: blocking.length, unresolvedCount: unresolved.length,
      checks: Object.freeze(checks), dimensions: scoreChecks(checks),
      note: '维度分数仅用于比较已评估项目；任何分数都不能抵消阻断规则。'
    });
  }

  function reviewSystem(input) {
    const value = input || {}; const design = value.design || {}; const ir = value.drawingIR || {};
    const instances = Array.isArray(design.instances) ? design.instances : [];
    const topology = design.topology || {}; const units = Array.isArray(topology.functionalUnits) ? topology.functionalUnits : [];
    const checks = [];
    const coverageOk = !!(ir.coverage && ir.coverage.ok);
    checks.push(check('QR-001', coverageOk, coverageOk ? 'PASS' : 'FAIL', coverageOk
      ? 'Drawing IR 的所有回路均具有精确设备端子。' : '端子覆盖缺失或尚未运行。'));
    checks.push(check('QR-003', coverageOk && !(ir.violations || []).length, coverageOk && !(ir.violations || []).length ? 'PASS' : 'FAIL',
      '图模覆盖=' + (coverageOk ? 'PASS' : 'FAIL') + '；几何违规=' + (ir.violations || []).length + '。'));
    const symbolPinAudit = systemSymbolAndPinAudit(design, ir);
    const symbolPinResult = !symbolPinAudit.geometryOk ? 'FAIL' : symbolPinAudit.physicalOk ? 'PASS' : 'UNRESOLVED';
    checks.push(check('QR-013', symbolPinResult === 'PASS', symbolPinResult, !symbolPinAudit.geometryOk
      ? '符号目录或PIN几何未解析：' + symbolPinAudit.geometryIssues.slice(0, 8).join('；')
      : symbolPinAudit.physicalOk
        ? '受控符号、PIN锚点与全部必需逻辑端子的物理pinMap均已解析。'
        : '符号/PIN几何已解析，但物理封装pinMap仍有 ' + symbolPinAudit.physicalIssues.length + ' 个必需端子未决。'));
    const diagnostics = units.filter((item) => item.type === 'OUTPUT_SAFETY_DIAGNOSTICS');
    const designCircuits = Array.isArray(design.circuits) ? design.circuits : [];
    const designCircuitIds = new Set(designCircuits.map((item) => item.id));
    const diagnosticComplete = diagnostics.length > 0 && diagnostics.every((item) =>
      Array.isArray(item.safeIsolationDeviceIds) && item.safeIsolationDeviceIds.length >= 1 &&
      Array.isArray(item.monitoredPoles) && item.monitoredPoles.length >= item.safeIsolationDeviceIds.length &&
      new Set(item.monitoredPoles.map((pole) => pole.deviceId + ':' + pole.poleId)).size === item.monitoredPoles.length &&
      item.safeIsolationDeviceIds.every((id) => item.monitoredPoles.some((pole) => pole.deviceId === id && pole.poleId &&
        pole.upstreamTerminalId && pole.downstreamTerminalId && pole.feedbackTerminalId)) &&
      item.monitoredPoles.every((pole) => designCircuits.some((wire) => circuitTouches(wire, pole.deviceId) &&
        circuitPort(wire, pole.deviceId) === pole.feedbackTerminalId)) &&
      item.monitoredPoles.every((pole) => {
        const sameFeedback = item.monitoredPoles.filter((other) => other.deviceId === pole.deviceId &&
          other.feedbackTerminalId === pole.feedbackTerminalId);
        return sameFeedback.length === 1 || (pole.mechanicallyLinkedGroup &&
          sameFeedback.every((other) => other.mechanicallyLinkedGroup === pole.mechanicallyLinkedGroup));
      }) &&
      Array.isArray(item.monitoredOutputEndpoints) && item.monitoredOutputEndpoints.length === item.monitoredPoles.length &&
      Array.isArray(item.functions) && item.functions.includes('OUTPUT_PREENERGIZATION_CHECK') &&
      item.functions.includes('CONTACTOR_STATE_MONITORING') && item.defaultState === 'TEST_PATH_ISOLATED' &&
      item.precheckEvaluationState === 'MAIN_CONTACTORS_OPEN' && item.weldEvaluationState === 'CONTACTORS_COMMAND_OPEN' &&
      item.failureAction === 'INHIBIT_ENERGY_TRANSFER' && Array.isArray(item.circuitIds) && item.circuitIds.length > 0 &&
      item.circuitIds.every((id) => designCircuitIds.has(id)));
    checks.push(check('QR-005', diagnosticComplete, diagnosticComplete ? 'PASS' : 'UNRESOLVED',
      diagnosticComplete ? diagnostics.length + ' 个输出诊断合同已进入端子模型。' : '未找到逐输出接触器状态监测合同。'));
    const hasPe = hasKind(instances, ['earth', 'protective.*earth', 'pe-bar']);
    const hasRcm = hasKind(instances, ['rcm', 'residual']);
    const hasImd = hasKind(instances, ['insulation', '\\bimd\\b']);
    const needsRcm = hasKind(instances, ['ac-incomer', 'ac-charge', 'ac-busbar', 'ac-contactor']);
    const needsImd = hasKind(instances, ['dc-busbar', 'dc-charge', 'power-module-array', 'ess-dcdc']);
    const peAudit = safetyFunctionAudit(instances, designCircuits,
      ['pe-continuity', 'earth-continuity', 'protective-earth-monitor', 'earth-bar'],
      { requiredPortGroups: [['PE'], ['SIGNAL|ALARM|STATUS|TEST']] });
    const rcmAudit = needsRcm ? safetyFunctionAudit(instances, designCircuits, ['rcm', 'residual'],
      { requiredPortGroups: [['IN_'], ['OUT_'], ['SIGNAL|ALARM|STATUS|TEST']] }) : { present: true, complete: true, details: [] };
    const imdAudit = needsImd ? safetyFunctionAudit(instances, designCircuits, ['insulation', '\\bimd\\b'],
      { requiredPortGroups: [['SENSE.*POS'], ['SENSE.*NEG'], ['PE'], ['SIGNAL|ALARM|STATUS']] }) : { present: true, complete: true, details: [] };
    const devicesPresent = hasPe && (!needsRcm || hasRcm) && (!needsImd || hasImd);
    const splitSafetyFunctions = devicesPresent && peAudit.complete && rcmAudit.complete && imdAudit.complete;
    checks.push(check('QR-006', splitSafetyFunctions, !devicesPresent ? 'FAIL' : splitSafetyFunctions ? 'PASS' : 'UNRESOLVED',
      'PE/连续性证据=' + JSON.stringify(peAudit.details) + '；RCM证据=' + JSON.stringify(rcmAudit.details) +
      '；IMD证据=' + JSON.stringify(imdAudit.details) + '；三类功能必须分别声明检测对象、端子连接与失效动作。'));
    const stateMachine = topology.safetyStateMachine;
    const failSafeStateMachine = !!(stateMachine && stateMachine.defaultState === 'ALL_OPEN' &&
      stateMachine.faultState === 'FAULT_ALL_OPEN' && stateMachine.unresolvedValuesArePass === false &&
      stateMachine.executionAllowed === false && Array.isArray(stateMachine.transitions) &&
      stateMachine.transitions.some((item) => item.from === 'READY' && item.to === 'ENERGIZED' &&
        Array.isArray(item.guards) && item.guards.some((guard) => guard.type === 'CONTACTOR_OPEN_FEEDBACK_VALID')) &&
      stateMachine.transitions.some((item) => item.to === 'FAULT_ALL_OPEN' && Array.isArray(item.actions) && item.actions.length > 0));
    checks.push(check('QR-012', failSafeStateMachine, failSafeStateMachine ? 'PASS' : 'FAIL', failSafeStateMachine
      ? '状态机默认/故障态全开、未决值不放行，READY→ENERGIZED要求接触器开态反馈。' : '状态机缺少故障安全默认态、未决值阻断或关键联锁。'));
    const routes = Array.isArray(ir.routes) ? ir.routes : []; const aliases = Array.isArray(ir.aliasTraces) ? ir.aliasTraces : [];
    const circuitIds = routes.map((item) => item.circuitId).concat(aliases.map((item) => item.circuitId));
    const signalsIndependent = coverageOk && circuitIds.length > 0 && circuitIds.every(Boolean) &&
      circuitIds.length === new Set(circuitIds).size && routes.every((item) => item.source && item.source.ref && item.target && item.target.ref);
    checks.push(check('QR-002', signalsIndependent, signalsIndependent ? 'PASS' : 'FAIL', signalsIndependent
      ? circuitIds.length + ' 条物理/别名回路各有唯一 circuitId 和精确端点。' : '存在共享/缺失 circuitId 或无精确端点的路由。'));
    checks.push(check('QR-014', false, 'NOT_ASSESSED', '测试点与产测覆盖尚未在系统图级自动评分。'));
    checks.push(check('QR-015', !!EVIDENCE, EVIDENCE ? 'PASS' : 'FAIL', EVIDENCE
      ? '用户项目证据源、页码与哈希已登记。' : '证据库未加载。'));
    const referenceSummary = REFERENCES && typeof REFERENCES.summary === 'function' ? REFERENCES.summary() : null;
    const referenceStructural = !!(referenceSummary && referenceSummary.allStructurallyValid);
    checks.push(check('QR-019', false, referenceStructural ? 'UNRESOLVED' : 'FAIL', referenceStructural
      ? referenceSummary.referenceCount + ' 个真实项目的部分走线索引结构有效，但仍有 ' +
        referenceSummary.unresolvedItemCount + ' 个未决项；尚未实现当前设计到适用参考能力/PIN路径的签核映射，不能判PASS。'
      : '真实项目参考库缺失或结构校验失败。'));
    return result('SYSTEM_SCHEMATIC', checks);
  }

  function reviewBoardTemplate(template) {
    const value = typeof template === 'string' && BOARD ? BOARD.findTemplate(template) : template;
    if (!value) return result('BOARD_TEMPLATE', [check('QR-001', false, 'FAIL', '板级模板不存在。')]);
    const checks = []; const validation = BOARD && BOARD.validateTemplate ? BOARD.validateTemplate(value) : { ok: false, errors: [] };
    checks.push(check('QR-001', validation.ok, validation.ok ? 'PASS' : 'FAIL', validation.ok
      ? value.circuits.length + ' 条导线均为精确 PIN→PIN 端点。' : JSON.stringify(validation.errors)));
    checks.push(check('QR-015', Array.isArray(value.sourceRefs) && value.sourceRefs.length > 0,
      value.sourceRefs && value.sourceRefs.length ? 'PASS' : 'FAIL', '证据定位：' + JSON.stringify(value.sourceRefs || [])));
    checks.push(check('QR-012', false, 'NOT_ASSESSED',
      '禁止自动选型只证明生命周期受控，不能证明掉电/断线/复位时故障安全；需项目FMEA与默认态电路证据。'));
    if (value.family === 'sc_det') {
      const contacts = value.components.filter((item) => item.symbolId === 'relay-contact-no');
      const coils = value.components.filter((item) => item.symbolId === 'relay-coil');
      const connected = (id, pinId) => value.circuits.some((wire) => wire.from === id + ':' + pinId || wire.to === id + ':' + pinId);
      const paired = contacts.length > 0 && contacts.every((contact) => coils.some((coil) =>
        String(coil.ref || coil.id).split('.')[0] === String(contact.ref || contact.id).split('.')[0] &&
        connected(coil.id, 'A1') && connected(coil.id, 'A2') && value.circuits.some((wire) =>
          (wire.from === coil.id + ':A1' || wire.to === coil.id + ':A1' || wire.from === coil.id + ':A2' || wire.to === coil.id + ':A2') &&
          /ENABLE|DRIVE|CONTROL|MCU/i.test(String(wire.net || '') + ' ' + String(wire.netClass || '')))));
      const contract = value.precheckControl || {};
      const structural = paired && contract.mainContactorState === 'OPEN' && contract.defaultState === 'TEST_PATH_OPEN' &&
        contract.exitState === 'TEST_PATH_OPEN' && contract.failureAction === 'INHIBIT_ENERGY_TRANSFER';
      checks.push(check('QR-004', structural, structural ? 'PASS' : 'UNRESOLVED', structural
        ? '测试触点均有独立线圈/驱动，主接触器保持开路，默认态与退出态均证明测试支路断开。'
        : '说明文字不能证明预检安全：缺少测试继电器线圈/驱动、主接触器开态或默认/退出开路状态的完整结构证据。'));
    }
    else checks.push(check('QR-004', false, 'NOT_ASSESSED', '此规则不适用于该功能单元。'));
    if (value.family === 'adh_det') {
      const channels = Array.isArray(value.diagnosticChannels) ? value.diagnosticChannels : [];
      const channelKeys = new Set(channels.map((item) => String(item.poleId || '') + ':' + String(item.outputEndpoint || '')));
      const endpoints = new Set(value.circuits.flatMap((wire) => [wire.from, wire.to]));
      const structurallyIndependent = channels.length >= 2 && channelKeys.size === channels.length && channels.every((item) =>
        item.poleId && item.senseInputEndpoint && item.outputEndpoint && item.evaluationState === 'CONTACTORS_COMMAND_OPEN' &&
        item.failureAction === 'INHIBIT_ENERGY_TRANSFER' && endpoints.has(item.senseInputEndpoint) && endpoints.has(item.outputEndpoint));
      checks.push(check('QR-005', structurallyIndependent, structurallyIndependent ? 'PASS' : 'UNRESOLVED', structurallyIndependent
        ? channels.length + ' 个安全极具有独立端点与断开命令后诊断通道。'
        : '当前整流桥/光耦为合并电位单通道，未形成逐安全极独立反馈；safetyInvariant文字不能替代结构证据。'));
    }
    else checks.push(check('QR-005', false, 'NOT_ASSESSED', '此规则不适用于该功能单元。'));
    const highVoltage = value.circuits.some((item) => /SENSE_HV|POWER_AC|POWER_TEST/.test(item.netClass));
    const isolated = value.components.some((item) => item.symbolId === 'optocoupler' || item.symbolId === 'transformer');
    checks.push(check('QR-007', !highVoltage, !highVoltage ? 'PASS' : 'UNRESOLVED',
      !highVoltage ? '模板无高压检测边界。' : isolated
        ? '检测链包含隔离器件，但尚未证明所有HV→LV路径均被隔离割集截断，且额定/爬电数据未批准。'
        : '高压测量链未显示隔离器件，需批准的限能/隔离论证。'));
    if (value.family === 'psu') {
      const symbols = new Set(value.components.map((item) => item.symbolId));
      const emi = ['ntc', 'mov', 'gdt', 'common-mode-choke', 'bridge-rectifier'].every((id) => symbols.has(id));
      checks.push(check('QR-008', false, emi ? 'UNRESOLVED' : 'FAIL', emi
        ? '浪涌/EMI器件和端点链已建，但额定、接地型式、泄漏预算和试验尚未批准。' : '浪涌/EMI前端器件或连接链不完整。'));
      checks.push(check('QR-009', false, 'UNRESOLVED', 'CBULK 额定电压、输入峰值、容差与浪涌数据均为项目待填。'));
      const yCaps = value.components.filter((item) => /^Y_CLASS_REQUIRED/.test(String(item.value || '')));
      const conditional = yCaps.length > 0 && yCaps.every((item) => item.assemblyMode === 'CONDITIONAL_DNI_BY_DEFAULT' &&
        item.fittedByDefault === false && Array.isArray(item.closureRequirements) &&
        ['LEAKAGE_CURRENT_BUDGET_APPROVED', 'EMC_TEST_PASSED', 'EARTHING_SYSTEM_CONFIRMED']
          .every((gate) => item.closureRequirements.includes(gate)));
      const closed = conditional && yCaps.every((item) => item.leakageBudgetStatus === 'APPROVED' &&
        item.emcTestStatus === 'PASSED' && item.earthingSystemStatus === 'CONFIRMED');
      checks.push(check('QR-018', closed, !conditional ? 'FAIL' : closed ? 'PASS' : 'UNRESOLVED', !conditional
        ? 'Y电容未建成默认DNI的条件装配项，或缺少泄漏/EMC/接地型式关闭门槛。'
        : closed ? 'Y电容条件装配已完成泄漏预算、接地型式与EMC试验签核。'
          : 'Y电容为默认DNI条件装配项；泄漏预算、接地型式与EMC试验未全部关闭，不能判PASS。'));
    }
    if (value.family === 'cp_gen') {
      const tvs = value.components.find((item) => item.symbolId === 'tvs');
      const tvsWires = tvs ? value.circuits.filter((item) => item.from.startsWith(tvs.id + ':') || item.to.startsWith(tvs.id + ':')) : [];
      const tvsConnected = !!tvs && tvsWires.length === 2;
      checks.push(check('QR-010', false, tvsConnected ? 'UNRESOLVED' : 'FAIL', tvsConnected
        ? '双向TVS跨接CP与回路参考点，但幅值、短路、带载、波形与额定值仍未批准。'
        : 'CP钳位器件未形成两个独立端点的完整支路。'));
    }
    if (['cp_det', 'diode_det', 'gnd_det', 'adh_det'].includes(value.family)) {
      checks.push(check('QR-011', false, 'UNRESOLVED', '阈值、迟滞、温漂与标定参数尚未获得项目批准。'));
    }
    const symbolAudit = BOARD && BOARD.auditSymbolGeometry ? BOARD.auditSymbolGeometry(value) : { ok: false, issues: ['AUDITOR_MISSING'] };
    const pinMapComplete = validation.physicalPinMapComplete === true;
    checks.push(check('QR-013', symbolAudit.ok && pinMapComplete, !symbolAudit.ok ? 'FAIL' : pinMapComplete ? 'PASS' : 'UNRESOLVED',
      !symbolAudit.ok ? '板级符号目录/PIN几何解析失败：' + JSON.stringify(symbolAudit.issues)
        : pinMapComplete ? '符号PIN几何与全部必需逻辑→物理封装pinMap均已解析。'
          : '符号PIN几何已验证，但仍有 ' + (validation.physicalPinIssues || []).length + ' 个器件缺少完整物理封装pinMap。'));
    return result('BOARD_TEMPLATE:' + value.id, checks);
  }

  function ruleById(id) { return RULES.find((item) => item.id === id) || null; }

  return Object.freeze({
    VERSION, DIMENSIONS, RULES, ruleById, reviewSystem, reviewBoardTemplate
  });
});
