/* ============================================================
 * SchematicForge deterministic engineering delivery exports
 * ------------------------------------------------------------
 * All exports are derived from the authoritative EDEM.  This module does
 * not select parts, approve candidates, or turn an unevaluated condition
 * into an engineering conclusion.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const commonJs = typeof window === 'undefined' && typeof module === 'object' && module && module.exports;
  const engineeringBom = commonJs ? require('./engineering-bom.js') :
    (root && (root.SCHEMATIC_ENGINEERING_BOM || root.EVSE_ENGINEERING_BOM));
  const api = factory(engineeringBom);
  if (root) {
    root.SCHEMATIC_ENGINEERING_DELIVERY = api;
    root.EVSE_ENGINEERING_DELIVERY = api;
  }
  if (commonJs) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (BOM) {
  'use strict';

  const VERSION = '1.0.0';
  const AUDIT_SCHEMA = 'schematic-engineering-delivery-audit/v1';
  const CANDIDATE_STATUS = 'USER_REFERENCE_UNVERIFIED';
  const APPROVAL_STATUS = 'UNAPPROVED_RFQ_REQUIRED';
  const WIRING_COLUMNS = Object.freeze([
    'circuitId', 'netId', 'fromEquipment', 'fromPIN', 'toEquipment', 'toPIN',
    'netClass', 'domain', 'phase', 'polarity', 'voltage', 'protocol', 'status'
  ]);
  const RFQ_COLUMNS = Object.freeze([
    'instanceId', '位号', '类别', '设备名称', '数量', '关键参数',
    'candidateManufacturer', 'candidateModel', 'candidateStatus', 'approvalStatus',
    'datasheetUrl', 'technicalClarifications', 'sourcePolicy'
  ]);
  const LIMITATIONS = Object.freeze([
    'PASS 仅表示本版本已编码且已执行的确定性检查通过，不等同于施工图批准、型式认证或法规符合性声明。',
    'NOT_EVALUATED、PROJECT_VALUE_REQUIRED 与缺失原始资料保持未关闭状态，不得自动转为 PASS。',
    'RFQ 中的候选厂家、型号和资料链接属于 USER_REFERENCE_UNVERIFIED，必须经具名工程师复核和批准。',
    '聚合设备只能证明模型中的聚合连接，不能替代每个物理单元的端子、PE、保护配合及热设计核验。',
    '导线清单来自权威 EDEM 的逐回路精确 PIN 连接，不替代线号、线径、端子排、屏蔽与安装工艺设计。'
  ]);

  function cleanText(value, max) {
    return String(value == null ? '' : value)
      .replace(/\u0000/g, '')
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, max || 2400);
  }

  function compareText(leftValue, rightValue) {
    const left = cleanText(leftValue, 500).toUpperCase().match(/\d+|\D+/g) || [];
    const right = cleanText(rightValue, 500).toUpperCase().match(/\d+|\D+/g) || [];
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

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      const output = {};
      Object.keys(value).forEach((key) => {
        if (value[key] !== undefined) output[key] = clone(value[key]);
      });
      return output;
    }
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function assertBom() {
    if (!BOM || typeof BOM.build !== 'function' || typeof BOM.hash !== 'function') {
      throw new TypeError('SCHEMATIC_ENGINEERING_BOM must be loaded before engineering delivery exports.');
    }
    return BOM;
  }

  function authoritativeResult(value) {
    if (!value || typeof value !== 'object' || !value.design || typeof value.design !== 'object') {
      throw new TypeError('An EVSE_ENGINE result with authoritative design is required.');
    }
    const design = value.design;
    if (!cleanText(design.modelHash, 300) || !Array.isArray(design.instances) ||
        !Array.isArray(design.nets) || !Array.isArray(design.circuits)) {
      throw new TypeError('Authoritative design requires modelHash, instances, nets and circuits.');
    }
    return { result: value, design };
  }

  function uniqueIndex(values, label) {
    const output = new Map();
    values.forEach((value) => {
      const id = cleanText(value && value.id, 300);
      if (!id) throw new TypeError('Every ' + label + ' requires an id.');
      if (output.has(id)) throw new TypeError('Duplicate ' + label + ' id: ' + id);
      output.set(id, value);
    });
    return output;
  }

  function terminals(instance) {
    return Array.isArray(instance && instance.terminals) ? instance.terminals :
      (Array.isArray(instance && instance.physicalTerminals) ? instance.physicalTerminals :
        (Array.isArray(instance && instance.ports) ? instance.ports : []));
  }

  function assertedEndpoint(instanceIndex, instanceIdValue, terminalIdValue, circuitId, side) {
    const instanceId = cleanText(instanceIdValue, 300);
    const terminalId = cleanText(terminalIdValue, 300);
    const instance = instanceIndex.get(instanceId);
    if (!instance) throw new TypeError(circuitId + ' references unknown ' + side + ' equipment: ' + instanceId);
    if (!terminalId || !terminals(instance).some((terminal) => cleanText(terminal && terminal.id, 300) === terminalId)) {
      throw new TypeError(circuitId + ' references unknown ' + side + ' PIN: ' + instanceId + ':' + terminalId);
    }
    return { instanceId, terminalId };
  }

  function mergedAttribute(circuit, net, key, circuitId) {
    const fromCircuit = circuit[key];
    const fromNet = net[key];
    if (fromCircuit !== undefined && fromCircuit !== null && cleanText(fromCircuit, 1000) &&
        fromNet !== undefined && fromNet !== null && cleanText(fromNet, 1000) &&
        String(fromCircuit) !== String(fromNet)) {
      throw new TypeError(circuitId + ' ' + key + ' conflicts with its authoritative net.');
    }
    return fromCircuit !== undefined && fromCircuit !== null && fromCircuit !== '' ? fromCircuit :
      (fromNet !== undefined && fromNet !== null ? fromNet : '');
  }

  function formulaSafe(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    let text = String(value).replace(/\u0000/g, '');
    if (/^[\u0009\u000D\u000A ]*[=+\-@]/.test(text) || /^[\u0009\u000D\u000A]/.test(text)) text = "'" + text;
    return text;
  }

  function csvCell(value) {
    const text = formulaSafe(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function rowsToCsv(columns, rows, options) {
    const lines = [columns.map(csvCell).join(',')];
    rows.forEach((row) => lines.push(columns.map((column) => csvCell(row && row[column])).join(',')));
    return ((options && options.byteOrderMark === false) ? '' : '\uFEFF') + lines.join('\r\n') + '\r\n';
  }

  function wiringRows(value) {
    const source = authoritativeResult(value);
    const instances = uniqueIndex(source.design.instances, 'instance');
    const nets = uniqueIndex(source.design.nets, 'net');
    const circuitIds = new Set();
    return source.design.circuits.slice().sort((left, right) => compareText(left && left.id, right && right.id))
      .map((circuit) => {
        const circuitId = cleanText(circuit && circuit.id, 300);
        const netId = cleanText(circuit && circuit.netId, 300);
        if (!circuitId) throw new TypeError('Every circuit requires an id.');
        if (circuitIds.has(circuitId)) throw new TypeError('Duplicate circuit id: ' + circuitId);
        circuitIds.add(circuitId);
        const net = nets.get(netId);
        if (!net) throw new TypeError(circuitId + ' references unknown net: ' + netId);
        const from = assertedEndpoint(instances, circuit.from, circuit.fromPort, circuitId, 'from');
        const to = assertedEndpoint(instances, circuit.to, circuit.toPort, circuitId, 'to');
        const netClass = mergedAttribute(circuit, net, 'netClass', circuitId);
        const domain = mergedAttribute(circuit, net, 'domain', circuitId);
        if (!cleanText(netClass, 300) || !cleanText(domain, 300)) {
          throw new TypeError(circuitId + ' requires exact netClass and domain.');
        }
        let voltage = circuit.voltageV;
        if (voltage === undefined || voltage === null || voltage === '') voltage = circuit.nominalPotentialV;
        if (voltage === undefined || voltage === null || voltage === '') voltage = net.nominalVoltageV;
        return {
          circuitId, netId,
          fromEquipment: from.instanceId, fromPIN: from.terminalId,
          toEquipment: to.instanceId, toPIN: to.terminalId,
          netClass, domain,
          phase: mergedAttribute(circuit, net, 'phase', circuitId),
          polarity: mergedAttribute(circuit, net, 'polarity', circuitId),
          voltage: voltage === undefined || voltage === null ? '' : voltage,
          protocol: mergedAttribute(circuit, net, 'protocol', circuitId),
          status: cleanText(circuit.status || net.status, 120) || 'CONCEPT'
        };
      });
  }

  function wiringCsv(value, options) {
    return rowsToCsv(WIRING_COLUMNS, wiringRows(value), options);
  }

  function engineeringBom(value) {
    const dependency = assertBom();
    if (value && value.schema === dependency.SCHEMA && Array.isArray(value.rows)) return value;
    return dependency.build(value);
  }

  function bomCsv(value, options) {
    const dependency = assertBom();
    const payload = engineeringBom(value);
    const columns = Array.isArray(payload.columns) && payload.columns.length ? payload.columns : dependency.COLUMNS;
    if (JSON.stringify(columns) !== JSON.stringify(dependency.COLUMNS)) {
      throw new TypeError('Engineering BOM column contract mismatch.');
    }
    return rowsToCsv(columns, payload.rows, options);
  }

  const CLARIFICATIONS = Object.freeze({
    'ac-breaker': '额定电压与使用类别；接入点短路电流和 Icu/Ics；脱扣整定、选择性与导线配合',
    'ac-contactor': '主触点使用类别与分断能力；线圈电压/功耗；实际 PIN 图；抑制方式与释放时间；辅助反馈触点',
    'dc-contactor': '直流分断电压/电流；主触点极性；线圈电压/功耗；实际 PIN 图；抑制方式；镜像/辅助反馈触点',
    'ess-contactor': '双向直流分断能力；线圈及辅助触点 PIN；抑制方式；故障安全状态',
    'precharge-contactor': '预充电流与时间；线圈及触点 PIN；与主接触器互锁时序',
    'dc-fuse': '直流额定电压与分断能力；时间电流曲线；I²t；线缆与半导体保护配合；环境降额',
    'ess-fuse': '双向故障条件；直流额定电压与分断能力；I²t；电池短路电流；环境降额',
    'power-module-array': '逐物理模块型号/数量；输入输出及 PE PIN；功率电流包络；并机均流和通信；热降额',
    'dc-dc-charge-module': '输入输出窗口；隔离方式；逐模块 PIN 与 PE；并机均流；保护和热降额',
    'ess-dcdc': '双向功率；两侧电压窗口；隔离方式；预充和故障切断；PIN/PE；控制通信',
    'ess-pcs': '双向功率；并网接口和保护；电压频率范围；PIN/PE；孤岛与故障切断',
    'aux-psu': '输入范围；持续及峰值负载；输出 0V 隔离/接地；PE 或 II 类；短路保护；实际 PIN',
    'surge-protector': '接地系统和保护模式；Uc/Up；后备保护；安装引线；状态遥信 PIN',
    'insulation-monitor': '适用系统、电压和电容范围；响应阈值与时间；自检；硬件切除接口和 PIN',
    'residual-current-monitor': '适用波形与检测范围；动作阈值/时序；测试与故障输出；系统接地兼容性',
    'charging-connector': '适用标准版本；额定电压电流；温度/锁止/通信 PIN；线缆规格；认证与寿命'
  });

  function clarificationFor(instance) {
    const kind = cleanText(instance && instance.kind, 200).toLowerCase();
    if (CLARIFICATIONS[kind]) return CLARIFICATIONS[kind];
    if (/connector/.test(kind)) return CLARIFICATIONS['charging-connector'];
    if (/contactor|relay/.test(kind)) return CLARIFICATIONS['dc-contactor'];
    if (/fuse/.test(kind)) return CLARIFICATIONS['dc-fuse'];
    return '实际厂家型号和订货号；额定值与环境降额；厂家最新数据手册；实际端子/PIN；项目适用性和认证范围';
  }

  function rfqRows(value) {
    const source = authoritativeResult(value);
    const payload = engineeringBom(value);
    const traceByInstance = new Map(payload.trace.map((entry) => [entry.instanceId, entry]));
    const instanceById = uniqueIndex(source.design.instances, 'instance');
    return payload.rows.map((row, index) => {
      const trace = payload.trace[index];
      if (!trace || !instanceById.has(trace.instanceId) || traceByInstance.get(trace.instanceId) !== trace) {
        throw new TypeError('Engineering BOM trace is not aligned with its authoritative instance.');
      }
      const instance = instanceById.get(trace.instanceId);
      return {
        instanceId: trace.instanceId,
        '位号': row['位号'], '类别': row['类别'], '设备名称': row['设备名称'],
        '数量': row['数量'], '关键参数': row['关键参数'],
        candidateManufacturer: '', candidateModel: '', candidateStatus: CANDIDATE_STATUS,
        approvalStatus: APPROVAL_STATUS, datasheetUrl: '',
        technicalClarifications: clarificationFor(instance),
        sourcePolicy: 'USER_REFERENCE_ONLY—NO_AUTOMATIC_SELECTION_OR_APPROVAL'
      };
    }).sort((left, right) => compareText(left['位号'], right['位号']) || compareText(left.instanceId, right.instanceId));
  }

  function rfqCsv(value, options) {
    return rowsToCsv(RFQ_COLUMNS, rfqRows(value), options);
  }

  function pageAudit(renderedDocument) {
    const source = renderedDocument && typeof renderedDocument === 'object' ? renderedDocument : {};
    const pages = (Array.isArray(source.pages) ? source.pages : []).map((page) => ({
      sheetId: cleanText(page && (page.sheetId || page.id), 120),
      sourceModelHash: cleanText(page && page.sourceModelHash, 300),
      geometryHash: cleanText(page && page.geometryHash, 300),
      projectionHash: cleanText(page && page.projectionHash, 300),
      pageGate: clone(page && page.pageGate || null),
      renderedSvgAudit: clone(page && (page.renderedGeometry ||
        (page.pageGate && page.pageGate.renderedGeometry)) || null),
      renderedDxfAudit: clone(page && page.dxfReadbackAudit || null)
    })).sort((left, right) => compareText(left.sheetId, right.sheetId));
    return { pages, projectGate: clone(source.projectGate ||
      (source.document && source.document.projectGate) || null) };
  }

  function statusOf(value) {
    return cleanText(value && (value.status || (value.allowed === false ? 'BLOCKED' : '')), 80).toUpperCase();
  }

  function auditReport(value, renderedDocument) {
    const source = authoritativeResult(value);
    const rendering = pageAudit(renderedDocument);
    const erc = clone(source.design.modelValidation || null);
    const loopIntegrity = clone((source.design.modelValidation && source.design.modelValidation.loopIntegrity) ||
      value.loopIntegrity || null);
    const projectStatus = statusOf(rendering.projectGate);
    const ercStatus = statusOf(erc);
    const blocked = projectStatus === 'BLOCKED' || ercStatus === 'BLOCKED';
    const unevaluated = !erc || !loopIntegrity || !rendering.projectGate || !rendering.pages.length;
    const report = {
      schema: AUDIT_SCHEMA,
      version: VERSION,
      lifecycle: 'DERIVED_AUDIT_EVIDENCE',
      status: blocked ? 'BLOCKED' : unevaluated ? 'NOT_EVALUATED' :
        (projectStatus === 'REVIEW_REQUIRED' || statusOf(loopIntegrity) === 'PARTIAL' ? 'REVIEW_REQUIRED' : 'PASS'),
      modelHash: source.design.modelHash,
      project: clone(source.design.project || null),
      summary: {
        instanceCount: source.design.instances.length,
        netCount: source.design.nets.length,
        circuitCount: source.design.circuits.length,
        sheetCount: rendering.pages.length,
        ercStatus: ercStatus || 'NOT_EVALUATED',
        loopIntegrityStatus: statusOf(loopIntegrity) || 'NOT_EVALUATED',
        projectGateStatus: projectStatus || 'NOT_EVALUATED'
      },
      erc,
      loopIntegrity,
      pages: rendering.pages,
      projectGate: rendering.projectGate,
      releaseGate: clone(value.releaseGate || null),
      schematicQuality: clone(value.schematicQuality || null),
      procurementPolicy: {
        candidateStatus: CANDIDATE_STATUS,
        automaticSelectionAllowed: false,
        automaticApprovalAllowed: false,
        humanApprovalRequired: true
      },
      limitations: LIMITATIONS.slice()
    };
    report.auditHash = assertBom().hash(report);
    return deepFreeze(report);
  }

  function auditJson(value, renderedDocument, options) {
    const indentation = options && options.compact === true ? 0 : 2;
    return JSON.stringify(stable(auditReport(value, renderedDocument)), null, indentation) + '\n';
  }

  return Object.freeze({
    VERSION,
    AUDIT_SCHEMA,
    CANDIDATE_STATUS,
    APPROVAL_STATUS,
    WIRING_COLUMNS,
    RFQ_COLUMNS,
    LIMITATIONS,
    wiringRows,
    wiringCsv,
    bomCsv,
    rfqRows,
    rfqCsv,
    auditReport,
    auditJson,
    csvCell
  });
});
