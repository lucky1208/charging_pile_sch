/* ============================================================
 * EVSE electrical-rule checker (ERC) v1
 * ------------------------------------------------------------
 * Pure, deterministic checks for EDEM v4.  The checker operates on exact
 * instance/terminal references.  It never repairs, guesses or aliases an
 * electrical connection.
 * ============================================================ */
window.EVSE_ERC = (function () {
  'use strict';

  const VERSION = '1.5.0';
  const KNOWN_NET_CLASSES = Object.freeze([
    'POWER_AC', 'POWER_DC', 'POWER_DC_ESS', 'POWER_DC_AUX',
    'PROTECTIVE_EARTH', 'SIGNAL_CTRL', 'SIGNAL_COMM', 'POWER_INTERFACE_MODED'
  ]);
  const CONNECTOR_PROFILES = Object.freeze({
    'gbt-dc': Object.freeze({ standardId: 'gb', signals: Object.freeze({ CC1: 'CC1', CC2: 'CC2', S_POS: 'GB_CAN:P', S_NEG: 'GB_CAN:N' }) }),
    ccs2: Object.freeze({ standardId: 'eu', signals: Object.freeze({ CP: 'CP', PP: 'PP' }) }),
    ccs1: Object.freeze({ standardId: 'us', signals: Object.freeze({ CP: 'CP', PP: 'PP' }) }),
    nacs: Object.freeze({ standardId: 'nacs', signals: Object.freeze({ CP: 'CP', PP: 'PP' }) }),
    chademo: Object.freeze({
      standardId: 'chademo',
      signals: Object.freeze({
        CONNECTION_CHECK: 'CHADEMO:CONNECTION_CHECK',
        START_STOP_1: 'CHADEMO:START_STOP_1',
        START_STOP_2: 'CHADEMO:START_STOP_2',
        CHARGE_ENABLE: 'CHADEMO:CHARGE_ENABLE',
        CAN_H: 'CHADEMO_CAN:H',
        CAN_L: 'CHADEMO_CAN:L'
      }),
      aux: Object.freeze({ CHARGER_12V: Object.freeze({ domain: 'CONNECTOR_AUX_12V', voltageV: 12 }) })
    })
  });
  const AC_OUTPUT_PROFILES = Object.freeze({
    gb: Object.freeze({ connectorType: 'gbt-ac', lineVoltage: 380, phases: 3, conductors: Object.freeze(['L1', 'L2', 'L3', 'N']), controlPins: Object.freeze(['CP', 'CC']), requiresTransformer: false }),
    eu: Object.freeze({ connectorType: 'type2-ac', lineVoltage: 400, phases: 3, conductors: Object.freeze(['L1', 'L2', 'L3', 'N']), controlPins: Object.freeze(['CP', 'PP']), requiresTransformer: false }),
    us: Object.freeze({ connectorType: 'j1772-ac', lineVoltage: 240, phases: 1, conductors: Object.freeze(['L1', 'L2']), controlPins: Object.freeze(['CP', 'PP']), requiresTransformer: true }),
    nacs: Object.freeze({ connectorType: 'nacs-ac', lineVoltage: 240, phases: 1, conductors: Object.freeze(['L1', 'L2']), controlPins: Object.freeze(['CP', 'PP']), requiresTransformer: true }),
    chademo: Object.freeze({ connectorType: 'j1772-ac', lineVoltage: 230, phases: 1, conductors: Object.freeze(['L1', 'N']), controlPins: Object.freeze(['CP', 'PP']), requiresTransformer: false, companionInterface: true })
  });

  function key(instanceId, terminalId) {
    return String(instanceId) + ':' + String(terminalId);
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function normalizedVoltage(terminal, net) {
    if (finite(terminal.voltageV)) return terminal.voltageV;
    if (finite(terminal.referenceVoltageV) && terminal.polarity === 'RETURN') return 0;
    if (finite(net.nominalVoltageV)) return net.nominalVoltageV;
    if (finite(net.ratedVoltageV)) return net.ratedVoltageV;
    return null;
  }

  function netVoltage(net) {
    if (finite(net.nominalVoltageV)) return net.nominalVoltageV;
    if (finite(net.ratedVoltageV)) return net.ratedVoltageV;
    return null;
  }

  function uniqueNonEmpty(items) {
    return Array.from(new Set(items.filter((value) => value !== undefined && value !== null && value !== '')));
  }

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((name) => { out[name] = stable(value[name]); });
      return out;
    }
    return value;
  }

  function stableText(value) {
    return JSON.stringify(stable(value));
  }

  function hashPayload(model) {
    const source = stableText({
      schemaVersion: model.schemaVersion,
      requirements: model.requirements,
      instances: model.instances,
      nets: model.nets,
      circuits: model.circuits,
      assumptions: model.assumptions,
      decisions: model.decisions,
      capabilities: model.capabilities,
      topology: model.topology,
      ess: model.ess
    });
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return 'fnv1a32-' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  function terminalShape(terminals) {
    return (Array.isArray(terminals) ? terminals : []).slice()
      .sort((left, right) => String(left && left.id).localeCompare(String(right && right.id)))
      .map((terminal) => stable(terminal));
  }

  function validate(model) {
    const violations = [];
    const checks = [];
    const instances = Array.isArray(model && model.instances)
      ? model.instances
      : (Array.isArray(model && model.equipment) ? model.equipment : []);
    const nets = Array.isArray(model && model.nets) ? model.nets : [];
    const circuits = Array.isArray(model && model.circuits) ? model.circuits : [];

    function report(ruleId, code, message, location, severity, evidence) {
      violations.push({
        ruleId,
        code,
        severity: severity || 'BLOCK',
        message,
        location: location || null,
        evidence: evidence || []
      });
    }

    function run(ruleId, title, fn) {
      const before = violations.length;
      try {
        fn();
      } catch (error) {
        report(ruleId, 'CHECK_EXCEPTION', title + '检查异常：' + error.message, null, 'BLOCK');
      }
      const count = violations.length - before;
      const added = violations.slice(before);
      const notEvaluated = count > 0 && added.every((item) =>
        item.severity === 'WARN' && item.code === 'PROJECT_VALUE_NOT_EVALUATED');
      checks.push({ ruleId, title, status: notEvaluated ? 'NOT_EVALUATED' : (count ? 'FAIL' : 'PASS'), violationCount: count });
    }

    const instanceById = new Map();
    const terminalByKey = new Map();
    const netById = new Map();
    const membership = new Map();
    const circuitById = new Map();
    const catalog = window.EVSE_DEVICE_CATALOG;
    const nacsModePortContracts = Object.freeze({
      'EQ-MOB-NACS-IN': Object.freeze({
        AC_L1: Object.freeze({ physicalOwnerId: 'EQ-MOB-NACS-IN', physicalTerminalIds: ['PWR_A'], logicalOwnerId: 'EQ-MOB-AC-IN', logicalTerminalIds: ['AC_L1'], modeId: 'AC', netClass: 'POWER_AC', domain: 'AC_MAINS' }),
        DC_POS: Object.freeze({ physicalOwnerId: 'EQ-MOB-NACS-IN', physicalTerminalIds: ['PWR_A'], logicalOwnerId: 'EQ-MOB-DC-IN', logicalTerminalIds: ['DC_POS'], modeId: 'DC', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS' }),
        AC_L2: Object.freeze({ physicalOwnerId: 'EQ-MOB-NACS-IN', physicalTerminalIds: ['PWR_B'], logicalOwnerId: 'EQ-MOB-AC-IN', logicalTerminalIds: ['AC_L2'], modeId: 'AC', netClass: 'POWER_AC', domain: 'AC_MAINS' }),
        DC_NEG: Object.freeze({ physicalOwnerId: 'EQ-MOB-NACS-IN', physicalTerminalIds: ['PWR_B'], logicalOwnerId: 'EQ-MOB-DC-IN', logicalTerminalIds: ['DC_NEG'], modeId: 'DC', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS' })
      }),
      'EQ-MOB-AC-IN': Object.freeze({
        AC: Object.freeze({ physicalOwnerId: 'EQ-MOB-NACS-IN', physicalTerminalIds: ['PWR_A', 'PWR_B'], logicalOwnerId: 'EQ-MOB-AC-IN', logicalTerminalIds: ['AC_L1', 'AC_L2'], modeId: 'AC', netClass: 'POWER_AC', domain: 'AC_MAINS' })
      }),
      'EQ-MOB-DC-IN': Object.freeze({
        DC_POS: Object.freeze({ physicalOwnerId: 'EQ-MOB-NACS-IN', physicalTerminalIds: ['PWR_A'], logicalOwnerId: 'EQ-MOB-DC-IN', logicalTerminalIds: ['DC_POS'], modeId: 'DC', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS' }),
        DC_NEG: Object.freeze({ physicalOwnerId: 'EQ-MOB-NACS-IN', physicalTerminalIds: ['PWR_B'], logicalOwnerId: 'EQ-MOB-DC-IN', logicalTerminalIds: ['DC_NEG'], modeId: 'DC', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS' })
      })
    });

    function authorizedNacsModePort(instance, port, physicalOwner) {
      if (!model || !model.requirements || model.requirements.standard !== 'nacs' || model.requirements.archetype !== 'ess-mobile') return false;
      const instanceContracts = nacsModePortContracts[instance && instance.id];
      const expected = instanceContracts && instanceContracts[port && port.id];
      if (!expected || !physicalOwner || physicalOwner.id !== 'EQ-MOB-NACS-IN' || physicalOwner.kind !== 'nacs-shared-inlet') return false;
      if (instance.id !== 'EQ-MOB-NACS-IN' && (instance.logicalOnlyProxy !== true || instance.physicalOwnerId !== 'EQ-MOB-NACS-IN')) return false;
      if (instance.id === 'EQ-MOB-NACS-IN' && (instance.kind !== 'nacs-shared-inlet' || instance.modeDependentPhysicalOwner !== true)) return false;
      return port.modeDependent === true && port.mutualExclusionGroup === 'NACS_AC_DC_POWER' &&
        (port.physicalOwnerId || instance.id) === expected.physicalOwnerId &&
        (port.logicalOwnerId || instance.id) === expected.logicalOwnerId &&
        stableText(port.physicalTerminalIds) === stableText(expected.physicalTerminalIds) &&
        stableText(port.logicalTerminalIds) === stableText(expected.logicalTerminalIds) &&
        port.modeId === expected.modeId && port.netClass === expected.netClass && port.domain === expected.domain;
    }

    run('ERC-001', 'EDEM v4 模型与实例标识', () => {
      if (!model || !/^4\./.test(String(model.schemaVersion || ''))) {
        report('ERC-001', 'SCHEMA_VERSION', '必须提供 EDEM 4.x 模型，当前为 ' + String(model && model.schemaVersion || 'MISSING'), 'model.schemaVersion');
      }
      if (!instances.length) report('ERC-001', 'NO_INSTANCES', '模型没有设备实例。', 'model.instances');
      if (!Array.isArray(model && model.instances)) report('ERC-001', 'INSTANCES_MISSING', 'EDEM v4 必须以 instances 为唯一设备源。', 'model.instances');
      if (Array.isArray(model && model.equipment)) {
        const primary = new Map(instances.map((instance) => [instance && instance.id, instance]));
        const compatibility = new Map(model.equipment.map((instance) => [instance && instance.id, instance]));
        if (primary.size !== compatibility.size || Array.from(primary.keys()).some((id) => !compatibility.has(id) || stableText(primary.get(id)) !== stableText(compatibility.get(id)))) {
          report('ERC-001', 'EQUIPMENT_ALIAS_DIVERGED', 'equipment 兼容副本与 instances 不等价，存在第二拓扑源。', 'model.equipment');
        }
      }
      const tags = new Map();
      const references = new Map();
      instances.forEach((instance, index) => {
        const location = 'instances[' + index + ']';
        if (!instance || !instance.id) {
          report('ERC-001', 'INSTANCE_ID_MISSING', '设备实例缺少 id。', location);
          return;
        }
        if (instanceById.has(instance.id)) report('ERC-001', 'INSTANCE_ID_DUPLICATE', '设备实例 id 重复：' + instance.id, location);
        instanceById.set(instance.id, instance);
        if (!instance.definition || instance.definition.lifecycle !== 'APPROVED' || instance.lifecycle !== 'APPROVED') {
          report('ERC-001', 'DEFINITION_NOT_APPROVED', '只有 APPROVED 器件定义可进入工程编译：' + instance.id, location + '.definition.lifecycle');
        }
        if (instance.definition && instance.definition.typeId !== instance.kind) {
          report('ERC-001', 'DEFINITION_KIND_MISMATCH', '实例 kind 与受控定义 typeId 不一致：' + instance.id, location + '.definition.typeId');
        }
        if (!instance.definitionRef || (instance.definition && String(instance.definitionRef).indexOf(':' + instance.definition.typeId + '@') < 0)) {
          report('ERC-001', 'DEFINITION_REF_INVALID', '实例缺少可追溯的受控定义引用：' + instance.id, location + '.definitionRef');
        }
        if (catalog && catalog.DEVICE_CLASSES && !catalog.DEVICE_CLASSES[instance.kind]) {
          report('ERC-001', 'DEVICE_KIND_UNKNOWN', '实例不属于受控设备类别：' + instance.id + ' / ' + instance.kind, location + '.kind');
        }
        if (instance.tag) {
          if (tags.has(instance.tag)) report('ERC-001', 'INSTANCE_TAG_DUPLICATE', '设备位号重复：' + instance.tag, location + '.tag');
          tags.set(instance.tag, instance.id);
        }
        if (instance.referenceDesignation) {
          if (references.has(instance.referenceDesignation)) report('ERC-001', 'REFERENCE_DUPLICATE', '参考标识重复：' + instance.referenceDesignation, location + '.referenceDesignation');
          references.set(instance.referenceDesignation, instance.id);
        }
        const terminals = Array.isArray(instance.terminals) ? instance.terminals : [];
        if (!terminals.length) report('ERC-001', 'NO_TERMINALS', '设备没有受控端子：' + instance.id, location + '.terminals');
        if (!Array.isArray(instance.ports) || stableText(terminalShape(instance.ports)) !== stableText(terminalShape(terminals))) {
          report('ERC-001', 'TERMINAL_ALIAS_DIVERGED', instance.id + ':ports 与 terminals 不等价。', location + '.ports');
        }
        const expectedPhysical = instance.logicalOnlyProxy === true ? [] : terminals;
        if (!Array.isArray(instance.physicalTerminals) || stableText(terminalShape(instance.physicalTerminals)) !== stableText(terminalShape(expectedPhysical))) {
          report('ERC-001', 'TERMINAL_ALIAS_DIVERGED', instance.id + ':physicalTerminals 与受控物理所有权不等价。', location + '.physicalTerminals');
        }
        if (instance.logicalOnlyProxy === true && (model.requirements.standard !== 'nacs' || model.requirements.archetype !== 'ess-mobile' ||
            !['EQ-MOB-DC-IN', 'EQ-MOB-AC-IN'].includes(instance.id) || instance.physicalOwnerId !== 'EQ-MOB-NACS-IN' ||
            !instances.some((item) => item.id === 'EQ-MOB-NACS-IN' && item.kind === 'nacs-shared-inlet'))) {
          report('ERC-001', 'LOGICAL_PROXY_UNAUTHORIZED', 'logicalOnlyProxy只允许NACS移动模板的受控AC/DC逻辑接口使用。', location);
        }
        if (instance.modeDependentPhysicalOwner === true && (model.requirements.standard !== 'nacs' || model.requirements.archetype !== 'ess-mobile' ||
            instance.id !== 'EQ-MOB-NACS-IN' || instance.kind !== 'nacs-shared-inlet')) {
          report('ERC-001', 'MODED_PHYSICAL_OWNER_UNAUTHORIZED', '模式依赖物理owner只允许受控NACS共享输入口使用。', location);
        }
        const localIds = new Set();
        terminals.forEach((terminal, terminalIndex) => {
          const terminalLocation = location + '.terminals[' + terminalIndex + ']';
          if (!terminal || !terminal.id) {
            report('ERC-001', 'TERMINAL_ID_MISSING', '端子缺少 id：' + instance.id, terminalLocation);
            return;
          }
          if (localIds.has(terminal.id)) report('ERC-001', 'TERMINAL_ID_DUPLICATE', '设备端子 id 重复：' + key(instance.id, terminal.id), terminalLocation);
          localIds.add(terminal.id);
          terminalByKey.set(key(instance.id, terminal.id), { instance, terminal });
          if (!terminal.netClass || !terminal.domain) {
            report('ERC-001', 'TERMINAL_SEMANTICS_MISSING', '端子缺少 netClass/domain：' + key(instance.id, terminal.id), terminalLocation);
          }
          if (terminal.status !== 'APPROVED') report('ERC-001', 'TERMINAL_NOT_APPROVED', '端子不是 APPROVED 状态：' + key(instance.id, terminal.id), terminalLocation + '.status');
          if (!['in', 'out', 'bidirectional'].includes(terminal.direction)) report('ERC-001', 'TERMINAL_DIRECTION_INVALID', '端子方向无效：' + key(instance.id, terminal.id), terminalLocation + '.direction');
          if (!['one', 'many'].includes(terminal.multiplicity)) report('ERC-001', 'TERMINAL_MULTIPLICITY_INVALID', '端子重复度无效：' + key(instance.id, terminal.id), terminalLocation + '.multiplicity');
        });
        const functionalIds = [];
        const physicalCounts = new Map();
        (Array.isArray(instance.functionalPorts) ? instance.functionalPorts : []).forEach((port, portIndex) => {
          const ownerId = port.physicalOwnerId || instance.id;
          const physicalOwner = instances.find((item) => item && item.id === ownerId);
          const authorizedModeDependent = authorizedNacsModePort(instance, port, physicalOwner);
          if (port.modeDependent === true && !authorizedModeDependent) {
            report('ERC-001', 'MODE_DEPENDENT_PORT_UNAUTHORIZED', 'modeDependent语义例外只允许受控NACS共享触点映射：' + instance.id + ':' + String(port.id), location + '.functionalPorts[' + portIndex + ']');
          }
          (Array.isArray(port.physicalTerminalIds) ? port.physicalTerminalIds : []).forEach((terminalId) => {
            const terminal = physicalOwner && (physicalOwner.terminals || []).find((item) => item.id === terminalId);
            if (!terminal) report('ERC-001', 'FUNCTIONAL_PORT_UNKNOWN_TERMINAL', '功能端口引用不存在的物理端子：' + key(ownerId, terminalId), location + '.functionalPorts[' + portIndex + ']');
            else if (!authorizedModeDependent && (terminal.netClass !== port.netClass || terminal.domain !== port.domain)) {
              report('ERC-001', 'FUNCTIONAL_PORT_SEMANTICS_MISMATCH', '功能端口与物理端子电气语义不一致：' + key(ownerId, terminalId), location + '.functionalPorts[' + portIndex + ']');
            }
            if (ownerId === instance.id) physicalCounts.set(terminalId, (physicalCounts.get(terminalId) || 0) + 1);
          });
          const logicalOwnerId = port.logicalOwnerId || instance.id;
          const logicalOwner = instances.find((item) => item && item.id === logicalOwnerId);
          (Array.isArray(port.logicalTerminalIds) ? port.logicalTerminalIds : []).forEach((terminalId) => {
            if (logicalOwnerId === instance.id) functionalIds.push(terminalId);
            if (!logicalOwner || !(logicalOwner.terminals || []).some((item) => item.id === terminalId)) {
              report('ERC-001', 'FUNCTIONAL_PORT_UNKNOWN_TERMINAL', '功能端口引用不存在的逻辑端子：' + key(logicalOwnerId, terminalId), location + '.functionalPorts[' + portIndex + ']');
            }
          });
          if (!Array.isArray(port.logicalTerminalIds) || !port.logicalTerminalIds.length) {
            (Array.isArray(port.physicalTerminalIds) ? port.physicalTerminalIds : []).forEach((terminalId) => {
              if (ownerId === instance.id) functionalIds.push(terminalId);
            });
          }
        });
        const functionalCounts = new Map();
        functionalIds.forEach((id) => functionalCounts.set(id, (functionalCounts.get(id) || 0) + 1));
        terminals.forEach((terminal) => {
          const count = instance.logicalOnlyProxy === true ? (functionalCounts.get(terminal.id) || 0) : (physicalCounts.get(terminal.id) || 0);
          const expectedCount = instance.modeDependentPhysicalOwner === true && /^PWR_[AB]$/.test(terminal.id) ? 2 : 1;
          if (count !== expectedCount) report('ERC-001', 'FUNCTIONAL_PORT_COVERAGE', '每个端子必须满足受控功能端口覆盖：' + key(instance.id, terminal.id), location + '.functionalPorts');
        });
      });
    });

    run('ERC-005', '模型完整性指纹', () => {
      if (!model || !model.modelHash) report('ERC-005', 'MODEL_HASH_MISSING', '模型缺少确定性完整性指纹。', 'model.modelHash');
      else {
        const expected = hashPayload(model);
        if (model.modelHash !== expected) report('ERC-005', 'MODEL_HASH_MISMATCH', '模型内容与 modelHash 不一致，可能在编译后被修改。', 'model.modelHash', 'BLOCK', [model.modelHash, expected]);
      }
    });

    run('ERC-010', '网络标识与精确端点', () => {
      if (!nets.length) report('ERC-010', 'NO_NETS', '模型没有显式网络。', 'model.nets');
      nets.forEach((net, netIndex) => {
        const location = 'nets[' + netIndex + ']';
        if (!net || !net.id) {
          report('ERC-010', 'NET_ID_MISSING', '网络缺少 id。', location);
          return;
        }
        if (netById.has(net.id)) report('ERC-010', 'NET_ID_DUPLICATE', '网络 id 重复：' + net.id, location);
        netById.set(net.id, net);
        if (!net.netClass || !net.domain) report('ERC-010', 'NET_SEMANTICS_MISSING', '网络缺少 netClass/domain：' + net.id, location);
        if (!KNOWN_NET_CLASSES.includes(net.netClass)) report('ERC-010', 'NET_CLASS_UNKNOWN', '网络类别不在受控集合中：' + net.id + ' / ' + net.netClass, location + '.netClass');
        if (net.netClass === 'POWER_INTERFACE_MODED' && (net.domain !== 'INTERFACE_POWER_MODED' || net.modeDependent !== true || net.mutualExclusionGroup !== 'NACS_AC_DC_POWER' || net.defaultState !== 'OPEN')) {
          report('ERC-010', 'MODED_INTERFACE_SEMANTICS', '模式复用功率触点网络必须声明中性域、互斥组和默认断开：' + net.id, location);
        }
        if (net.netClass === 'POWER_INTERFACE_MODED' && (model.requirements.standard !== 'nacs' || model.requirements.archetype !== 'ess-mobile')) {
          report('ERC-010', 'MODED_INTERFACE_UNAUTHORIZED', 'POWER_INTERFACE_MODED只能用于NACS移动模板的受控共享触点边界：' + net.id, location);
        }
        if (net.netClass === 'POWER_AC') {
          if (!['AC_MAINS', 'AC_EV_OUTPUT'].includes(net.domain)) report('ERC-010', 'AC_DOMAIN_INVALID', '交流网络必须属于 AC_MAINS 或受控 AC_EV_OUTPUT：' + net.id, location + '.domain');
          if (!['L1', 'L2', 'L3', 'N'].includes(net.phase)) report('ERC-010', 'PHASE_REQUIRED', '交流导体必须显式声明 L1/L2/L3/N：' + net.id, location + '.phase');
        }
        if (net.netClass === 'POWER_DC' || net.netClass === 'POWER_DC_ESS') {
          const expectedDomain = net.netClass === 'POWER_DC_ESS' ? 'HV_DC_ESS' : 'HV_DC_CHARGE';
          if (net.domain !== expectedDomain) report('ERC-010', 'DC_DOMAIN_INVALID', '直流网络域与类别不一致：' + net.id, location + '.domain');
          if (!['POSITIVE', 'NEGATIVE', 'INTERMEDIATE'].includes(net.polarity)) report('ERC-010', 'POLARITY_REQUIRED', '高压直流导体必须显式声明正极、负极或受控串联中间电位：' + net.id, location + '.polarity');
          if (net.polarity === 'INTERMEDIATE' && (net.seriesJunction !== true || !net.seriesJunctionId || !Object.prototype.hasOwnProperty.call(net, 'nominalPotentialV'))) {
            report('ERC-010', 'INTERMEDIATE_JUNCTION_SEMANTICS', '串联中间电位必须声明seriesJunction、唯一ID及nominalPotentialV（未知时为null）：' + net.id, location);
          }
          if (!finite(netVoltage(net)) || netVoltage(net) <= 0) report('ERC-010', 'DC_VOLTAGE_REQUIRED', '高压直流网络必须声明正的额定电压：' + net.id, location);
        }
        if (net.netClass === 'POWER_DC_AUX' && /^AUX_(5|12|24)V$/.test(String(net.domain))) {
          const domainVoltage = Number(String(net.domain).match(/^AUX_(5|12|24)V$/)[1]);
          if (!['POSITIVE', 'RETURN'].includes(net.polarity)) report('ERC-010', 'AUX_POLARITY_REQUIRED', '辅助电源必须明确正极或该电压域回路：' + net.id, location + '.polarity');
          const expectedVoltage = net.polarity === 'RETURN' ? 0 : domainVoltage;
          if (!finite(net.nominalVoltageV) || Math.abs(net.nominalVoltageV - expectedVoltage) > 0.01 || net.referenceVoltageV !== domainVoltage) {
            report('ERC-010', 'AUX_VOLTAGE_DOMAIN_INVALID', '辅助网络电压与电压域不一致：' + net.id, location);
          }
        }
        if (net.netClass === 'POWER_DC_AUX' && net.domain === 'CONNECTOR_AUX_12V') {
          if (net.polarity !== 'POSITIVE' || netVoltage(net) !== 12 || net.referenceVoltageV !== 12) {
            report('ERC-010', 'CONNECTOR_AUX_12V_INVALID', '接口 Charger 12V 必须保持独立 12V 正极电压域：' + net.id, location);
          }
        }
        if (net.netClass === 'POWER_DC_AUX' && !/^AUX_(5|12|24)V$/.test(String(net.domain)) && !['CONNECTOR_AUX', 'CONNECTOR_AUX_12V'].includes(net.domain)) {
          report('ERC-010', 'AUX_DOMAIN_INVALID', '未受控的辅助电压域：' + net.id + ' / ' + net.domain, location + '.domain');
        }
        if (net.netClass === 'PROTECTIVE_EARTH' && (net.domain !== 'PROTECTIVE_EARTH' || netVoltage(net) !== 0 || net.polarity)) {
          report('ERC-010', 'PE_SEMANTICS_INVALID', 'PE 网络必须是独立的 0V PROTECTIVE_EARTH，且不得声明直流极性：' + net.id, location);
        }
        if (net.netClass === 'SIGNAL_COMM' && (net.domain !== 'COMMUNICATION' || !net.protocol)) {
          report('ERC-010', 'COMM_SEMANTICS_REQUIRED', '通信网络必须明确 COMMUNICATION 域和协议：' + net.id, location);
        }
        if (net.netClass === 'SIGNAL_CTRL' && net.domain !== 'CONTROL') report('ERC-010', 'CONTROL_DOMAIN_INVALID', '控制信号必须属于 CONTROL 域：' + net.id, location + '.domain');
        const members = Array.isArray(net.members) ? net.members : [];
        if (members.length < 2) report('ERC-010', 'NET_TOO_SMALL', '网络至少需要两个端点：' + net.id, location + '.members');
        const local = new Set();
        members.forEach((member, memberIndex) => {
          const memberLocation = location + '.members[' + memberIndex + ']';
          const endpointKey = key(member && member.instanceId, member && member.terminalId);
          if (local.has(endpointKey)) report('ERC-010', 'NET_MEMBER_DUPLICATE', '同一端点在网络内重复：' + endpointKey, memberLocation);
          local.add(endpointKey);
          if (!terminalByKey.has(endpointKey)) {
            report('ERC-010', 'ENDPOINT_UNKNOWN', '网络引用不存在的精确端点：' + endpointKey, memberLocation);
            return;
          }
          if (!membership.has(endpointKey)) membership.set(endpointKey, []);
          membership.get(endpointKey).push(net.id);
        });
      });
      membership.forEach((netIds, endpointKey) => {
        if (netIds.length > 1) report('ERC-010', 'TERMINAL_ON_MULTIPLE_NETS', '物理端子不能同时属于多个电气网络：' + endpointKey + ' → ' + netIds.join(', '), endpointKey);
      });
    });

    run('ERC-015', '物理端子导体语义', () => {
      terminalByKey.forEach((entry, endpointKey) => {
        const terminal = entry.terminal;
        const id = String(terminal.id);
        if (terminal.netClass === 'POWER_AC') {
          const match = id.match(/_(L1|L2|L3|N)$/);
          if (!match || terminal.phase !== match[1] || !['AC_MAINS', 'AC_EV_OUTPUT'].includes(terminal.domain)) report('ERC-015', 'TERMINAL_PHASE_IDENTITY', '交流物理端子名称、相别和电气域不一致：' + endpointKey, endpointKey);
        }
        const dcMatch = id.match(/(?:^|_)DC_(POS|NEG)$/);
        if (dcMatch) {
          const expected = dcMatch[1] === 'POS' ? 'POSITIVE' : 'NEGATIVE';
          if (!['POWER_DC', 'POWER_DC_ESS'].includes(terminal.netClass) || terminal.polarity !== expected || !['HV_DC_CHARGE', 'HV_DC_ESS'].includes(terminal.domain)) {
            report('ERC-015', 'TERMINAL_POLARITY_IDENTITY', '直流物理端子名称与极性/电气域不一致：' + endpointKey, endpointKey);
          }
        }
        if (id === 'PE') {
          if (terminal.netClass !== 'PROTECTIVE_EARTH' || terminal.domain !== 'PROTECTIVE_EARTH' || terminal.polarity) report('ERC-015', 'PE_TERMINAL_IDENTITY', 'PE 物理端子不得被改作功能地、负极或其他回路：' + endpointKey, endpointKey);
        } else if (terminal.netClass === 'PROTECTIVE_EARTH' || terminal.domain === 'PROTECTIVE_EARTH') {
          report('ERC-015', 'PE_TERMINAL_NAME_INVALID', '保护接地必须使用显式 PE 物理端子：' + endpointKey, endpointKey);
        }
        const auxMatch = id.match(/(?:^|_)(V5|V12|V24)(?:(_0V))?$/);
        if (auxMatch) {
          const voltage = Number(auxMatch[1].slice(1));
          const isReturn = !!auxMatch[2];
          if (terminal.netClass !== 'POWER_DC_AUX' || terminal.domain !== 'AUX_' + voltage + 'V' || terminal.polarity !== (isReturn ? 'RETURN' : 'POSITIVE') || terminal.voltageV !== (isReturn ? 0 : voltage) || (isReturn && terminal.referenceVoltageV !== voltage)) {
            report('ERC-015', 'AUX_TERMINAL_IDENTITY', '辅助物理端子名称与 12V/24V 电压域或回路极性不一致：' + endpointKey, endpointKey);
          }
        }
        if (terminal.netClass === 'SIGNAL_COMM' && (!terminal.protocol || !terminal.signalRole)) report('ERC-015', 'COMM_TERMINAL_SEMANTICS_REQUIRED', '通信物理端子必须声明协议与导体角色：' + endpointKey, endpointKey);
        if (terminal.polarity === 'INTERMEDIATE') {
          const allowedKind = entry.instance.kind === 'battery-box' || entry.instance.kind === 'battery-heater';
          if (!allowedKind || !['POSITIVE', 'NEGATIVE'].includes(terminal.localPole)) {
            report('ERC-015', 'INTERMEDIATE_TERMINAL_INVALID', '中间电位端子只能属于受控串联电池箱/加热器并保留局部正负极：' + endpointKey, endpointKey);
          }
        }
      });
    });

    run('ERC-020', '网络电气域兼容性', () => {
      nets.forEach((net, netIndex) => {
        const members = Array.isArray(net.members) ? net.members : [];
        const endpoints = members.map((member) => terminalByKey.get(key(member.instanceId, member.terminalId))).filter(Boolean);
        endpoints.forEach((entry) => {
          const terminal = entry.terminal;
          const endpointKey = key(entry.instance.id, terminal.id);
          if (terminal.netClass !== net.netClass) {
            report('ERC-020', 'NET_CLASS_MISMATCH', endpointKey + ' 的 ' + terminal.netClass + ' 不能接入 ' + net.netClass + ' 网络 ' + net.id, 'nets[' + netIndex + ']');
          }
          if (terminal.domain !== net.domain) {
            report('ERC-020', 'DOMAIN_MISMATCH', endpointKey + ' 的电气域 ' + terminal.domain + ' 不能接入 ' + net.domain + ' 网络 ' + net.id, 'nets[' + netIndex + ']');
          }
          if (net.polarity && terminal.polarity && terminal.polarity !== net.polarity) {
            report('ERC-020', 'POLARITY_MISMATCH', endpointKey + ' 极性 ' + terminal.polarity + ' 与网络 ' + net.id + ' 的 ' + net.polarity + ' 冲突。', 'nets[' + netIndex + ']');
          }
          if (net.phase && terminal.phase && terminal.phase !== net.phase) {
            report('ERC-020', 'PHASE_MISMATCH', endpointKey + ' 相别 ' + terminal.phase + ' 与网络 ' + net.id + ' 的 ' + net.phase + ' 冲突。', 'nets[' + netIndex + ']');
          }
          const voltage = normalizedVoltage(terminal, net);
          const declaredVoltage = netVoltage(net);
          if (finite(declaredVoltage) && finite(voltage) && Math.abs(declaredVoltage - voltage) > 0.01) {
            report('ERC-020', 'VOLTAGE_MISMATCH', endpointKey + ' 电压 ' + voltage + 'V 与网络 ' + net.id + ' 的 ' + declaredVoltage + 'V 冲突。', 'nets[' + netIndex + ']');
          }
          if (Array.isArray(terminal.voltageRangeV) && finite(declaredVoltage)) {
            if (declaredVoltage < terminal.voltageRangeV[0] || declaredVoltage > terminal.voltageRangeV[1]) {
              report('ERC-020', 'VOLTAGE_OUT_OF_RANGE', endpointKey + ' 额定范围不包含网络电压 ' + declaredVoltage + 'V。', 'nets[' + netIndex + ']');
            }
          }
        });
        const polarities = uniqueNonEmpty(endpoints.map((entry) => entry.terminal.polarity));
        if (polarities.length > 1) report('ERC-020', 'MIXED_POLARITY', '网络 ' + net.id + ' 混接极性：' + polarities.join(', '), 'nets[' + netIndex + ']');
        if (net.polarity === 'INTERMEDIATE') {
          const expectedKind = net.seriesJunctionType === 'BATTERY_BOX_STRING' ? 'battery-box'
            : (net.seriesJunctionType === 'BATTERY_HEATER_STRING' ? 'battery-heater' : null);
          const localPoles = endpoints.map((entry) => entry.terminal.localPole).sort();
          if (!expectedKind || endpoints.length !== 2 || endpoints.some((entry) => entry.instance.kind !== expectedKind) || stableText(localPoles) !== stableText(['NEGATIVE', 'POSITIVE'])) {
            report('ERC-020', 'INTERMEDIATE_JUNCTION_TOPOLOGY', '中间电位网络只能连接同一受控串联类别的互补局部正/负端子，禁止接入母线或负载：' + net.id, 'nets[' + netIndex + ']');
          }
        }
        const phases = uniqueNonEmpty(endpoints.map((entry) => entry.terminal.phase));
        if (phases.length > 1) report('ERC-020', 'MIXED_PHASE', '网络 ' + net.id + ' 混接相别：' + phases.join(', '), 'nets[' + netIndex + ']');
        const protocols = uniqueNonEmpty([net.protocol].concat(endpoints.map((entry) => entry.terminal.protocol)));
        if (protocols.length > 1) report('ERC-020', 'PROTOCOL_MISMATCH', '网络 ' + net.id + ' 混接协议：' + protocols.join(' | '), 'nets[' + netIndex + ']');
        const signalRoles = uniqueNonEmpty([net.signalRole].concat(endpoints.map((entry) => entry.terminal.signalRole)));
        if (signalRoles.length > 1) report('ERC-020', 'SIGNAL_ROLE_MISMATCH', '网络 ' + net.id + ' 混接差分线/接口角色：' + signalRoles.join(' | '), 'nets[' + netIndex + ']');
        const hasSource = endpoints.some((entry) => ['out', 'bidirectional'].includes(entry.terminal.direction));
        const hasSink = endpoints.some((entry) => ['in', 'bidirectional'].includes(entry.terminal.direction));
        if (['POWER_AC', 'POWER_DC', 'POWER_DC_ESS', 'POWER_DC_AUX', 'POWER_INTERFACE_MODED', 'SIGNAL_CTRL', 'SIGNAL_COMM'].includes(net.netClass)) {
          if (!hasSource) report('ERC-020', 'NET_WITHOUT_SOURCE', '网络没有输出/双向端子：' + net.id, 'nets[' + netIndex + ']');
          if (!hasSink) report('ERC-020', 'NET_WITHOUT_SINK', '网络没有输入/双向端子：' + net.id, 'nets[' + netIndex + ']');
        }
      });
    });

    run('ERC-030', '必接端子覆盖', () => {
      terminalByKey.forEach((entry, endpointKey) => {
        if (entry.terminal.required && !membership.has(endpointKey)) {
          report('ERC-030', 'REQUIRED_TERMINAL_OPEN', '必接端子未连接：' + endpointKey, endpointKey);
        }
      });
    });

    run('ERC-040', '回路到网络等价性', () => {
      if (!Array.isArray(model && model.circuits) || !circuits.length) report('ERC-040', 'NO_CIRCUITS', '模型没有显式可绘制回路。', 'model.circuits');
      const edgeKeys = new Set();
      circuits.forEach((circuit, index) => {
        const location = 'circuits[' + index + ']';
        if (!circuit || !circuit.id) {
          report('ERC-040', 'CIRCUIT_ID_MISSING', '回路缺少 id。', location);
          return;
        }
        if (circuitById.has(circuit.id)) report('ERC-040', 'CIRCUIT_ID_DUPLICATE', '回路 id 重复：' + circuit.id, location);
        circuitById.set(circuit.id, circuit);
        const net = netById.get(circuit.netId);
        if (!net) {
          report('ERC-040', 'CIRCUIT_NET_UNKNOWN', '回路 ' + circuit.id + ' 引用不存在网络 ' + circuit.netId, location);
          return;
        }
        const sourceKey = key(circuit.from, circuit.fromPort);
        const targetKey = key(circuit.to, circuit.toPort);
        if (sourceKey === targetKey) report('ERC-040', 'CIRCUIT_SELF_LOOP', '回路两端不得是同一物理端子：' + circuit.id, location);
        const edgeKey = circuit.netId + '|' + [sourceKey, targetKey].sort().join('|');
        if (edgeKeys.has(edgeKey)) report('ERC-040', 'CIRCUIT_EDGE_DUPLICATE', '同一网络重复定义了相同物理导体：' + sourceKey + ' ↔ ' + targetKey, location);
        edgeKeys.add(edgeKey);
        if (!terminalByKey.has(sourceKey)) report('ERC-040', 'CIRCUIT_SOURCE_UNKNOWN', '回路源端点不存在：' + sourceKey, location);
        if (!terminalByKey.has(targetKey)) report('ERC-040', 'CIRCUIT_TARGET_UNKNOWN', '回路目标端点不存在：' + targetKey, location);
        const memberKeys = new Set((net.members || []).map((member) => key(member.instanceId, member.terminalId)));
        if (!memberKeys.has(sourceKey) || !memberKeys.has(targetKey)) {
          report('ERC-040', 'CIRCUIT_ENDPOINT_NOT_IN_NET', '回路 ' + circuit.id + ' 的精确端点不同时属于网络 ' + circuit.netId, location);
        }
        if (circuit.netClass !== net.netClass || circuit.domain !== net.domain ||
            circuit.phase !== net.phase || circuit.polarity !== net.polarity ||
            circuit.protocol !== net.protocol || circuit.signalRole !== net.signalRole) {
          report('ERC-040', 'CIRCUIT_SEMANTICS_MISMATCH', '回路 ' + circuit.id + ' 的电气域与网络 ' + net.id + ' 不一致。', location);
        }
        if (circuit.seriesJunction !== (net.seriesJunction === true) || circuit.seriesJunctionType !== net.seriesJunctionType ||
            circuit.seriesJunctionId !== net.seriesJunctionId || circuit.nominalPotentialV !== net.nominalPotentialV ||
            circuit.potentialStatus !== net.potentialStatus) {
          report('ERC-040', 'CIRCUIT_SERIES_SEMANTICS_MISMATCH', '回路未继承网络的串联中间电位语义：' + circuit.id, location);
        }
        const expectedVoltage = netVoltage(net);
        if ((finite(expectedVoltage) || finite(circuit.voltageV)) && (!finite(expectedVoltage) || !finite(circuit.voltageV) || Math.abs(expectedVoltage - circuit.voltageV) > 0.01)) {
          report('ERC-040', 'CIRCUIT_VOLTAGE_MISMATCH', '回路 ' + circuit.id + ' 的电压标注与网络 ' + net.id + ' 不一致。', location + '.voltageV');
        }
        const expectedKind = net.netClass && net.netClass.indexOf('SIGNAL_') === 0 ? 'signal' : 'electrical';
        if (circuit.kind !== expectedKind) report('ERC-040', 'CIRCUIT_KIND_MISMATCH', '回路类型与网络类别不一致：' + circuit.id, location + '.kind');
        const source = terminalByKey.get(sourceKey);
        const target = terminalByKey.get(targetKey);
        if (source && target && net.netClass !== 'PROTECTIVE_EARTH') {
          if (source.terminal.direction === 'in' || target.terminal.direction === 'out') {
            report('ERC-040', 'CIRCUIT_DIRECTION_INVALID', '回路 from/to 与物理端子方向不一致：' + circuit.id + ' (' + sourceKey + ' → ' + targetKey + ')', location);
          }
        }
      });

      nets.forEach((net, netIndex) => {
        const members = (net.members || []).map((member) => key(member.instanceId, member.terminalId));
        if (members.length < 2) return;
        const edges = circuits.filter((circuit) => circuit.netId === net.id);
        if (!edges.length) {
          report('ERC-040', 'NET_WITHOUT_CIRCUIT', '网络没有任何可绘制回路：' + net.id, 'nets[' + netIndex + ']');
          return;
        }
        const adjacency = new Map(members.map((member) => [member, []]));
        edges.forEach((edge) => {
          const a = key(edge.from, edge.fromPort);
          const b = key(edge.to, edge.toPort);
          if (adjacency.has(a) && adjacency.has(b)) {
            adjacency.get(a).push(b);
            adjacency.get(b).push(a);
          }
        });
        const seen = new Set();
        const stack = [members[0]];
        while (stack.length) {
          const current = stack.pop();
          if (seen.has(current)) continue;
          seen.add(current);
          (adjacency.get(current) || []).forEach((next) => stack.push(next));
        }
        if (seen.size !== members.length) {
          report('ERC-040', 'NET_CIRCUIT_DISCONNECTED', '网络 ' + net.id + ' 的回路未覆盖全部精确端点。', 'nets[' + netIndex + ']');
        }
      });
    });

    run('ERC-050', '充电接口极性与触点', () => {
      instances.filter((instance) => (instance.kind === 'charge-connector' || instance.kind === 'dc-charge-inlet') &&
        instance.logicalOnlyProxy !== true).forEach((instance) => {
        const profile = CONNECTOR_PROFILES[instance.connectorType];
        if (!profile) {
          report('ERC-050', 'CONNECTOR_TYPE_UNSUPPORTED', '充电接口型号未经受控验证：' + instance.id + ' / ' + instance.connectorType, instance.id + '.connectorType');
          return;
        }
        if (instance.standardId !== profile.standardId) report('ERC-050', 'CONNECTOR_STANDARD_MISMATCH', '充电接口物理型号与项目标准不一致：' + instance.id, instance.id + '.standardId');
        const positive = membership.get(key(instance.id, 'DC_POS')) || [];
        const negative = membership.get(key(instance.id, 'DC_NEG')) || [];
        const earth = membership.get(key(instance.id, 'PE')) || [];
        if (positive.length !== 1 || negative.length !== 1) {
          report('ERC-050', 'CONNECTOR_DC_PAIR_OPEN', '充电连接器必须各有一个 DC+ 与 DC− 网络：' + instance.id, instance.id);
          return;
        }
        if (positive[0] === negative[0]) report('ERC-050', 'CONNECTOR_POLES_SHORTED', '充电连接器 DC+ 与 DC− 被并入同一网络：' + instance.id, instance.id);
        const posNet = netById.get(positive[0]);
        const negNet = netById.get(negative[0]);
        if (!posNet || posNet.polarity !== 'POSITIVE') report('ERC-050', 'CONNECTOR_POS_WRONG', instance.id + ':DC_POS 未连接正极网络。', instance.id + ':DC_POS');
        if (!negNet || negNet.polarity !== 'NEGATIVE') report('ERC-050', 'CONNECTOR_NEG_WRONG', instance.id + ':DC_NEG 未连接负极网络。', instance.id + ':DC_NEG');
        if (earth.length !== 1 || !netById.get(earth[0]) || netById.get(earth[0]).netClass !== 'PROTECTIVE_EARTH') {
          report('ERC-050', 'CONNECTOR_PE_WRONG', instance.id + ':PE 未连接保护接地网络。', instance.id + ':PE');
        }
        Object.keys(profile.signals).forEach((terminalId) => {
          const terminalEntry = terminalByKey.get(key(instance.id, terminalId));
          const netIds = membership.get(key(instance.id, terminalId)) || [];
          if (!terminalEntry || terminalEntry.terminal.signalRole !== profile.signals[terminalId]) {
            report('ERC-050', 'CONNECTOR_SIGNAL_IDENTITY', '充电接口信号触点定义与受控引脚表不一致：' + key(instance.id, terminalId), instance.id);
          }
          if (netIds.length !== 1) report('ERC-050', 'CONNECTOR_SIGNAL_OPEN', '充电接口必接信号触点必须各属于一个独立网络：' + key(instance.id, terminalId), instance.id);
          else {
            const signalNet = netById.get(netIds[0]);
            if (!signalNet || (signalNet.signalRole && signalNet.signalRole !== profile.signals[terminalId])) report('ERC-050', 'CONNECTOR_SIGNAL_WRONG', '充电接口信号角色与网络不一致：' + key(instance.id, terminalId), instance.id);
          }
        });
        Object.keys(profile.aux || {}).forEach((terminalId) => {
          const expected = profile.aux[terminalId];
          const terminalEntry = terminalByKey.get(key(instance.id, terminalId));
          const netIds = membership.get(key(instance.id, terminalId)) || [];
          if (!terminalEntry || terminalEntry.terminal.domain !== expected.domain) {
            report('ERC-050', 'CONNECTOR_AUX_IDENTITY', '充电接口辅助触点定义与受控引脚表不一致：' + key(instance.id, terminalId), instance.id);
          }
          if (netIds.length !== 1) {
            report('ERC-050', 'CONNECTOR_AUX_OPEN', '充电接口必接辅助触点必须连接一个独立网络：' + key(instance.id, terminalId), instance.id);
          } else {
            const auxNet = netById.get(netIds[0]);
            if (!auxNet || auxNet.domain !== expected.domain || netVoltage(auxNet) !== expected.voltageV) {
              report('ERC-050', 'CONNECTOR_AUX_WRONG', '充电接口辅助触点电压域不一致：' + key(instance.id, terminalId), instance.id);
            }
          }
        });
      });
    });

    run('ERC-060', '储能预充与并网保护拓扑', () => {
      const essEnabled = !!(model && model.ess && model.ess.enabled);
      const essPowerKinds = new Set(['battery-cluster', 'ess-fuse', 'ess-contactor', 'precharge-contactor', 'precharge-resistor', 'ess-busbar', 'ess-dcdc', 'ess-pcs']);
      const essPowerInstances = instances.filter((instance) => instance.system === 'ess' && essPowerKinds.has(instance.kind));
      if (!essEnabled && essPowerInstances.length) {
        report('ERC-060', 'ESS_ENABLEMENT_MISMATCH', '模型声明未启用储能，但网表中存在储能功率设备。', 'model.ess.enabled');
        return;
      }
      if (!essEnabled) return;
      /* ESS-MOBILE-0823 has one fused battery junction plus one discharge bus,
       * dual replenishment paths and K1..K10.  It is intentionally checked by
       * the dedicated archetype contract below, not by the stationary single-
       * converter template assumptions in this rule. */
      if (model && model.requirements && model.requirements.archetype === 'ess-mobile') return;

      function netAt(instanceId, terminalId) {
        const ids = membership.get(key(instanceId, terminalId)) || [];
        return ids.length === 1 ? netById.get(ids[0]) : null;
      }
      function matchingMembers(net, kind, terminalId, predicate) {
        return (net && Array.isArray(net.members) ? net.members : []).filter((member) => {
          const instance = instanceById.get(member.instanceId);
          const terminal = terminalByKey.get(key(member.instanceId, member.terminalId));
          return instance && instance.kind === kind && (!terminalId || member.terminalId === terminalId) && (!predicate || predicate(instance, terminal && terminal.terminal));
        });
      }
      function contains(net, kind, terminalId) {
        return matchingMembers(net, kind, terminalId).length > 0;
      }
      function one(items, code, message, location) {
        if (items.length !== 1) {
          report('ERC-060', code, message + '（实际 ' + items.length + '）', location);
          return null;
        }
        return items[0];
      }
      function terminalPolarity(member) {
        const entry = member && terminalByKey.get(key(member.instanceId, member.terminalId));
        return entry && entry.terminal.polarity;
      }

      const clusters = instances.filter((instance) => instance.kind === 'battery-cluster' && instance.system === 'ess');
      const converters = instances.filter((instance) => (instance.kind === 'ess-dcdc' || instance.kind === 'ess-pcs') && instance.system === 'ess');
      if (!clusters.length) report('ERC-060', 'ESS_CLUSTER_MISSING', '启用储能时至少需要一个电池簇。', 'model.instances');
      const converter = one(converters, 'ESS_CONVERTER_COUNT', '储能系统必须有且仅有一个受控双向变换器', 'model.instances');
      const essBuses = instances.filter((instance) => instance.kind === 'ess-busbar' && instance.system === 'ess');
      one(essBuses, 'ESS_BUSBAR_COUNT', '储能系统必须有且仅有一组显式正/负直流母线', 'model.instances');

      clusters.forEach((cluster) => {
        const packPosNet = netAt(cluster.id, 'PACK_DC_POS');
        const packNegNet = netAt(cluster.id, 'PACK_DC_NEG');
        const fuseMember = one(matchingMembers(packPosNet, 'ess-fuse', 'IN'), 'ESS_CLUSTER_FUSE_TOPOLOGY', cluster.id + ' PACK+ 必须先通过独立簇熔断器', cluster.id);
        const negativeMember = one(matchingMembers(packNegNet, 'ess-contactor', 'IN', (instance, terminal) => terminal && terminal.polarity === 'NEGATIVE'), 'ESS_NEGATIVE_CONTACTOR_TOPOLOGY', cluster.id + ' PACK− 必须经独立主负接触器', cluster.id);
        if (negativeMember) {
          const downstream = netAt(negativeMember.instanceId, 'OUT');
          if (!contains(downstream, 'ess-busbar', 'BUS_DC_NEG')) report('ERC-060', 'ESS_NEGATIVE_CONTACTOR_TOPOLOGY', cluster.id + ' 主负接触器下游未连至储能负母线。', cluster.id);
        }
        if (!fuseMember) return;
        const fuseOutNet = netAt(fuseMember.instanceId, 'OUT');
        const mainPositive = one(matchingMembers(fuseOutNet, 'ess-contactor', 'IN', (instance, terminal) => terminal && terminal.polarity === 'POSITIVE'), 'ESS_POSITIVE_CONTACTOR_TOPOLOGY', cluster.id + ' 熔断器下游必须进入独立主正接触器', cluster.id);
        const precharge = one(matchingMembers(fuseOutNet, 'precharge-contactor', 'IN'), 'ESS_PRECHARGE_TOPOLOGY', cluster.id + ' 预充支路必须从熔断器下游与主正支路并联引出', cluster.id);
        const mainOutNet = mainPositive ? netAt(mainPositive.instanceId, 'OUT') : null;
        if (mainPositive && !contains(mainOutNet, 'ess-busbar', 'BUS_DC_POS')) report('ERC-060', 'ESS_POSITIVE_CONTACTOR_TOPOLOGY', cluster.id + ' 主正接触器下游未连至储能正母线。', cluster.id);
        if (precharge) {
          const preOutNet = netAt(precharge.instanceId, 'OUT');
          const resistorMember = one(matchingMembers(preOutNet, 'precharge-resistor'), 'ESS_PRECHARGE_TOPOLOGY', cluster.id + ' 预充接触器必须与独立预充电阻串联', cluster.id);
          if (resistorMember) {
            const otherTerminal = resistorMember.terminalId === 'A' ? 'B' : 'A';
            const resistorOutNet = netAt(resistorMember.instanceId, otherTerminal);
            if (!resistorOutNet || !contains(resistorOutNet, 'ess-busbar', 'BUS_DC_POS') || (mainOutNet && resistorOutNet.id !== mainOutNet.id)) {
              report('ERC-060', 'ESS_PRECHARGE_TOPOLOGY', cluster.id + ' 预充电阻下游必须与主正接触器下游在同一储能正母线汇合。', cluster.id);
            }
          }
        }
      });

      if (!converter) return;
      const converterPosNet = netAt(converter.id, 'ESS_DC_POS');
      const converterNegNet = netAt(converter.id, 'ESS_DC_NEG');
      if (!contains(converterPosNet, 'ess-busbar', 'BUS_DC_POS') || !contains(converterNegNet, 'ess-busbar', 'BUS_DC_NEG')) {
        report('ERC-060', 'ESS_CONVERTER_BUS_TOPOLOGY', '储能变换器的 ESS DC+ / DC− 必须分别连至储能正/负母线。', converter.id);
      }

      if (converter.kind === 'ess-dcdc') {
        if (model.ess.coupling !== 'dc') report('ERC-060', 'ESS_COUPLING_MISMATCH', '双向 DC/DC 与模型声明的储能耦合方式不一致。', 'model.ess.coupling');
        const chargePos = netAt(converter.id, 'CHARGE_DC_POS');
        const chargeNeg = netAt(converter.id, 'CHARGE_DC_NEG');
        const gridContactor = one(matchingMembers(chargePos, 'dc-contactor', 'OUT', (instance) => instance.system === 'ess'), 'ESS_DC_GRID_CONTACTOR', 'DC 耦合变换器正极上游必须设储能专用并网接触器', converter.id);
        if (gridContactor) {
          const contactorIn = netAt(gridContactor.instanceId, 'IN');
          const gridFuse = one(matchingMembers(contactorIn, 'dc-fuse', 'OUT', (instance) => instance.system === 'ess'), 'ESS_DC_GRID_FUSE', 'DC 并网接触器上游必须设储能专用快熔', gridContactor.instanceId);
          if (gridFuse && !contains(netAt(gridFuse.instanceId, 'IN'), 'dc-busbar', 'BUS_DC_POS')) report('ERC-060', 'ESS_DC_GRID_FUSE', 'DC 并网快熔上游未连至充电正母线。', gridFuse.instanceId);
        }
        if (!contains(chargeNeg, 'dc-busbar', 'BUS_DC_NEG')) report('ERC-060', 'ESS_DC_GRID_RETURN', 'DC 耦合变换器负极未连至充电负母线。', converter.id);
      } else {
        if (model.ess.coupling !== 'ac') report('ERC-060', 'ESS_COUPLING_MISMATCH', 'PCS 与模型声明的储能耦合方式不一致。', 'model.ess.coupling');
        converter.terminals.filter((terminal) => /^AC_(L1|L2|L3|N)$/.test(terminal.id)).forEach((terminal) => {
          const phase = terminal.id.slice(3);
          const converterAcNet = netAt(converter.id, terminal.id);
          const gridContactor = one(matchingMembers(converterAcNet, 'ac-contactor', 'OUT_' + phase, (instance) => instance.system === 'ess'), 'ESS_AC_GRID_CONTACTOR', 'PCS ' + phase + ' 上游必须经储能专用并网接触器', converter.id + ':' + terminal.id);
          if (!gridContactor) return;
          const contactorIn = netAt(gridContactor.instanceId, 'IN_' + phase);
          const gridBreaker = one(matchingMembers(contactorIn, 'ac-breaker', 'OUT_' + phase, (instance) => instance.system === 'ess'), 'ESS_AC_GRID_BREAKER', 'PCS ' + phase + ' 并网接触器上游必须经独立断路器', gridContactor.instanceId);
          if (gridBreaker && !contains(netAt(gridBreaker.instanceId, 'IN_' + phase), 'ac-busbar', 'BUS_' + phase)) report('ERC-060', 'ESS_AC_GRID_BREAKER', 'PCS ' + phase + ' 并网断路器上游未连至交流母线。', gridBreaker.instanceId);
        });
      }
    });

    run('ERC-070', '桩型独立拓扑契约', () => {
      const archetype = model && model.requirements && model.requirements.archetype;
      const topology = model && model.topology || {};
      const contract = topology.archetypeContract;
      const ids = new Set(instances.map((instance) => instance.id));
      const kinds = new Set(instances.map((instance) => instance.kind));
      const fixed = {
        'dc-integrated': {
          kinds: ['ac-incomer', 'power-module-array', 'dc-busbar', 'charge-connector'],
          markers: ['EQ-AC-IN', 'EQ-PM', 'EQ-DC-BUS']
        },
        'ac-dc-combo': {
          kinds: ['power-module-array', 'ac-breaker', 'residual-current-monitor', 'ac-meter', 'ac-contactor', 'ac-charge-connector'],
          markers: ['EQ-AC-EV-QF1', 'EQ-AC-EV-RCD1', 'EQ-AC-EV-PJ1', 'EQ-AC-EV-KM1', 'EQ-AC-EV-A1', 'EQ-AC-EV-XS1']
        },
        'ess-mobile': {
          kinds: [
            'battery-box', 'battery-heater', 'precharge-contactor', 'precharge-resistor', 'dc-dc-charge-module',
            'ess-pcs', 'dc-charge-inlet', 'four-pole-safety', 'touch-display', 'card-reader', 'voice-board',
            'loudspeaker', 'indicator-lamp', 'temperature-sensor', 'selector-switch-dual',
            'external-connector-12pin', 'control-relay', 'thermal-unit', 'heating-connector-2pin', 'rf-antenna'
          ],
          markers: [
            'EQ-MOB-BAT1', 'EQ-MOB-BAT2', 'EQ-MOB-BAT3', 'EQ-MOB-FU1', 'EQ-MOB-RPRE',
            'EQ-MOB-HEATER1', 'EQ-MOB-HEATER2', 'EQ-MOB-HEATER3', 'EQ-MOB-PCS', 'EQ-MOB-DC-IN', 'EQ-MOB-AC-IN',
            'EQ-MOB-HV24', 'EQ-MOB-24V12', 'EQ-MOB-12V5', 'EQ-MOB-BCU', 'EQ-MOB-VCU', 'EQ-MOB-EVCC',
            'EQ-MOB-SECC', 'EQ-MOB-OCPP', 'EQ-MOB-JT', 'EQ-MOB-DISPLAY', 'EQ-MOB-CARD', 'EQ-MOB-VOICE',
            'EQ-MOB-SPK', 'EQ-MOB-HL-Y', 'EQ-MOB-HL-G', 'EQ-MOB-HL-R', 'EQ-MOB-TEMP', 'EQ-MOB-QT',
            'EQ-MOB-X12', 'EQ-MOB-KA-JTA', 'EQ-MOB-KA-FAN', 'EQ-MOB-FAN', 'EQ-MOB-XH1',
            'EQ-MOB-KM2', 'EQ-MOB-KA-AC', 'EQ-MOB-ROUTER', 'EQ-MOB-ANT', 'EQ-MOB-SPD1'
          ].concat(Array.from({ length: 10 }, (_, index) => 'EQ-MOB-K' + (index + 1)))
        }
      };
      if (!['dc-integrated', 'dc-split', 'ac-dc-combo', 'ess-mobile'].includes(archetype)) {
        report('ERC-070', 'ARCHETYPE_UNKNOWN', '模型桩型没有受控独立拓扑契约：' + String(archetype), 'model.requirements.archetype');
        return;
      }
      if (!contract || contract.id !== archetype || !/^\d+\.\d+\.\d+$/.test(String(contract.templateVersion || ''))) {
        report('ERC-070', 'ARCHETYPE_CONTRACT_INVALID', 'topology.archetypeContract 与需求桩型不一致或缺少版本。', 'model.topology.archetypeContract');
        return;
      }
      let expectedKinds;
      let expectedMarkers;
      if (archetype === 'dc-split') {
        expectedKinds = ['power-module-array', 'dc-busbar', 'split-interface', 'charge-controller', 'charge-connector'];
        expectedMarkers = [];
        const gunCount = Number(model.requirements.gunCount) || 0;
        for (let gun = 1; gun <= gunCount; gun += 1) {
          expectedMarkers.push('EQ-G' + gun + '-IF-CAB', 'EQ-G' + gun + '-IF-TERM', 'EQ-G' + gun + '-LCU');
          const cableId = 'CBL-G' + gun;
          const expectedEdges = [
            ['EQ-G' + gun + '-IF-CAB', 'OUT_DC_POS', 'EQ-G' + gun + '-IF-TERM', 'IN_DC_POS'],
            ['EQ-G' + gun + '-IF-CAB', 'OUT_DC_NEG', 'EQ-G' + gun + '-IF-TERM', 'IN_DC_NEG'],
            ['EQ-G' + gun + '-IF-CAB', 'PE', 'EQ-G' + gun + '-IF-TERM', 'PE'],
            ['EQ-G' + gun + '-IF-CAB', 'OUT_COMM_P', 'EQ-G' + gun + '-IF-TERM', 'IN_COMM_P'],
            ['EQ-G' + gun + '-IF-CAB', 'OUT_COMM_N', 'EQ-G' + gun + '-IF-TERM', 'IN_COMM_N'],
            ['EQ-G' + gun + '-IF-CAB', 'OUT_INTERLOCK', 'EQ-G' + gun + '-IF-TERM', 'IN_INTERLOCK'],
            ['EQ-G' + gun + '-IF-CAB', 'OUT_V24', 'EQ-G' + gun + '-IF-TERM', 'IN_V24'],
            ['EQ-G' + gun + '-IF-CAB', 'OUT_V24_0V', 'EQ-G' + gun + '-IF-TERM', 'IN_V24_0V']
          ];
          expectedEdges.forEach((edge) => {
            const found = circuits.some((circuit) => circuit.cableId === cableId &&
              ((circuit.from === edge[0] && circuit.fromPort === edge[1] && circuit.to === edge[2] && circuit.toPort === edge[3]) ||
               (circuit.from === edge[2] && circuit.fromPort === edge[3] && circuit.to === edge[0] && circuit.toPort === edge[1])));
            if (!found) report('ERC-070', 'SPLIT_CABLE_CONDUCTOR_MISSING', cableId + ' 缺少精确边界导体：' + edge.join(':'), cableId);
          });
        }
        if (!Array.isArray(topology.splitCableLinks) || topology.splitCableLinks.length !== gunCount) {
          report('ERC-070', 'SPLIT_LINK_COUNT', '分体式必须每终端恰有一个柜端电缆边界。', 'model.topology.splitCableLinks');
        }
      } else {
        expectedKinds = fixed[archetype].kinds;
        expectedMarkers = fixed[archetype].markers;
      }
      expectedKinds.forEach((kind) => {
        if (!kinds.has(kind) || !Array.isArray(contract.requiredKinds) || !contract.requiredKinds.includes(kind)) {
          report('ERC-070', 'ARCHETYPE_REQUIRED_KIND', archetype + ' 缺少受控器件类别：' + kind, 'model.topology.archetypeContract.requiredKinds');
        }
      });
      expectedMarkers.forEach((id) => {
        if (!ids.has(id) || !Array.isArray(contract.markerIds) || !contract.markerIds.includes(id)) {
          report('ERC-070', 'ARCHETYPE_MARKER_MISSING', archetype + ' 缺少独立模板标记：' + id, 'model.topology.archetypeContract.markerIds');
        }
      });
      if (archetype !== 'dc-split' && instances.some((instance) => instance.kind === 'split-interface')) {
        report('ERC-070', 'ARCHETYPE_TEMPLATE_MIXED', archetype + ' 混入分体式接口模板。', 'model.instances');
      }
      if (archetype !== 'ac-dc-combo' && archetype !== 'ess-mobile' && instances.some((instance) => /^EQ-AC-EV-/.test(instance.id) || /^EQ-MOB-/.test(instance.id))) {
        report('ERC-070', 'ARCHETYPE_TEMPLATE_MIXED', archetype + ' 混入其他桩型模板对象。', 'model.instances');
      }

      function shareNet(aId, aTerminal, bId, bTerminal) {
        const left = membership.get(key(aId, aTerminal)) || [];
        const right = new Set(membership.get(key(bId, bTerminal)) || []);
        return left.some((netId) => right.has(netId));
      }
      function requireShared(code, aId, aTerminal, bId, bTerminal, message) {
        if (!shareNet(aId, aTerminal, bId, bTerminal)) report('ERC-070', code, message, aId + ':' + aTerminal);
      }
      function hasCircuit(aId, aTerminal, bId, bTerminal) {
        return circuits.some((circuit) =>
          (circuit.from === aId && circuit.fromPort === aTerminal && circuit.to === bId && circuit.toPort === bTerminal) ||
          (circuit.from === bId && circuit.fromPort === bTerminal && circuit.to === aId && circuit.toPort === aTerminal));
      }
      if (archetype === 'ess-mobile') {
        if (!model.ess || !model.ess.enabled || model.requirements.essEnabled !== true || model.ess.coupling !== 'mobile-dual-input') {
          report('ERC-070', 'MOBILE_ESS_ENABLEMENT', '储能移动模板必须声明启用储能和双输入补能耦合。', 'model.ess');
        }
        const boxes = instances.filter((instance) => instance.kind === 'battery-box');
        if (boxes.length !== 3 || ['EQ-MOB-BAT1', 'EQ-MOB-BAT2', 'EQ-MOB-BAT3'].some((id) => !instanceById.has(id)) || instances.some((instance) => instance.kind === 'battery-cluster' && /^EQ-MOB-/.test(instance.id))) {
          report('ERC-070', 'MOBILE_BATTERY_BOX_COUNT', '0823移动模板必须恰有GB1/GB2/GB3三只独立电池箱，禁止保留第四个聚合电池边界。', 'model.instances');
        }
        requireShared('MOBILE_BATTERY_SERIES', 'EQ-MOB-BAT1', 'SERIES_LOW', 'EQ-MOB-BAT2', 'SERIES_HIGH', 'GB1−必须直接串联GB2+。');
        requireShared('MOBILE_BATTERY_SERIES', 'EQ-MOB-BAT2', 'SERIES_LOW', 'EQ-MOB-BAT3', 'SERIES_HIGH', 'GB2−必须直接串联GB3+。');
        [['EQ-MOB-BAT1', 'SERIES_LOW'], ['EQ-MOB-BAT2', 'SERIES_LOW']].forEach((start) => {
          const netIds = membership.get(key(start[0], start[1])) || [];
          const net = netIds.length === 1 ? netById.get(netIds[0]) : null;
          if (!net || net.polarity !== 'INTERMEDIATE' || net.seriesJunctionType !== 'BATTERY_BOX_STRING') {
            report('ERC-070', 'MOBILE_BATTERY_SERIES_SEMANTICS', '电池箱串联抽头必须保持受控INTERMEDIATE语义。', start[0] + ':' + start[1]);
          }
        });
        ['P', 'N'].forEach((side) => {
          const chain = [
            ['EQ-MOB-BAT1', 'CAN_' + side, 'EQ-MOB-BAT2', 'CAN_' + side],
            ['EQ-MOB-BAT2', 'CAN_' + side, 'EQ-MOB-BAT3', 'CAN_' + side],
            ['EQ-MOB-BAT3', 'CAN_' + side, 'EQ-MOB-BCU', 'CAN_' + side]
          ];
          if (chain.some((edge) => !hasCircuit(edge[0], edge[1], edge[2], edge[3]))) {
            report('ERC-070', 'MOBILE_BATTERY_CAN_DAISY_CHAIN', 'GB1→GB2→GB3→BCU 的BMS CAN必须保持菊花链回路。', 'model.circuits');
          }
        });
        requireShared('MOBILE_FU1_ORDER', 'EQ-MOB-BAT1', 'PACK_DC_POS', 'EQ-MOB-FU1', 'IN', 'GB1总正必须先经过FU1。');
        ['K1', 'K3', 'K6'].forEach((tag) => requireShared('MOBILE_FUSED_BRANCH', 'EQ-MOB-FU1', 'OUT', 'EQ-MOB-' + tag, 'IN', 'FU1输出必须直接分支到' + tag + '.in。'));
        requireShared('MOBILE_PRECHARGE_ORDER', 'EQ-MOB-K3', 'OUT', 'EQ-MOB-RPRE', 'A', 'K3必须串联200W-30R预充电阻。');
        requireShared('MOBILE_PRECHARGE_MERGE', 'EQ-MOB-RPRE', 'B', 'EQ-MOB-ESS-BUS', 'BUS_DC_POS', '预充电阻输出必须与K1输出汇入主正母线。');
        const referenceContract = topology.mobileReference || {};
        const prechargeIntent = referenceContract.prechargeControlIntent || {};
        const expectedPrechargeSequence = ['CLOSE_K2', 'CLOSE_K3', 'MONITOR_BUS_DIFFERENTIAL_OR_TIMEOUT', 'CLOSE_K1', 'OPEN_K3'];
        if (stableText(prechargeIntent.sequence) !== stableText(expectedPrechargeSequence) ||
            prechargeIntent.completionThresholdV !== 'UNRESOLVED' || prechargeIntent.timeoutMs !== 'UNRESOLVED' ||
            prechargeIntent.monitorIntent !== 'BUS_DIFFERENTIAL_VOLTAGE_AND_TIMEOUT' ||
            prechargeIntent.candidateMappingStatus !== 'OBSERVED_DESTINATION_UNRESOLVED' ||
            prechargeIntent.failClosedState !== 'K1_OPEN_K3_OPEN') {
          report('ERC-070', 'MOBILE_PRECHARGE_CONTROL_INTENT', '预充控制意图必须保持K2→K3→压差/超时监测→K1→K3断开，阈值与超时不得猜测。', 'model.topology.mobileReference.prechargeControlIntent');
        }
        const observedBcuLabels = ['CANH', 'CANL', 'BTA1+', 'BTA2+', 'BTA5+', 'BAT1−', 'BAT2−', 'A+', 'CC2'];
        const bcuInstance = instanceById.get('EQ-MOB-BCU');
        const bcuStubs = (bcuInstance && bcuInstance.terminals || []).filter((terminal) => terminal.evidenceStatus === 'OBSERVED_DESTINATION_UNRESOLVED');
        if (!bcuInstance || observedBcuLabels.some((label) => {
          const terminal = bcuStubs.find((item) => (item.observedLabel || item.label) === label);
          return !terminal || terminal.required !== false || terminal.openCircuitPolicy !== 'OBSERVED_DESTINATION_UNRESOLVED' || membership.has(key(bcuInstance.id, terminal.id));
        }) || stableText((referenceContract.bcuObservedTerminals || []).map((item) => item.observedLabel)) !== stableText(observedBcuLabels)) {
          report('ERC-070', 'MOBILE_BCU_OBSERVED_TERMINALS', 'BCU图面可见端子必须作为显式、未猜接的OBSERVED开放stub保留。', 'EQ-MOB-BCU');
        }
        requireShared('MOBILE_K1_BUS', 'EQ-MOB-K1', 'OUT', 'EQ-MOB-ESS-BUS', 'BUS_DC_POS', 'K1输出必须进入主正母线。');
        requireShared('MOBILE_K6_BUS', 'EQ-MOB-K6', 'OUT', 'EQ-MOB-ESS-BUS', 'BUS_DC_POS', 'K6输出必须进入主正母线。');
        if (model.requirements.standard === 'nacs') {
          requireShared('MOBILE_K4_INPUT', 'EQ-MOB-NACS-SEL', 'DC_POS', 'EQ-MOB-K4', 'IN', 'NACS模式选择器DC+必须先经过K4。');
          requireShared('MOBILE_K4_INPUT', 'EQ-MOB-NACS-SEL', 'DC_NEG', 'EQ-MOB-K4N', 'IN', 'NACS模式选择器DC−必须先经过K4N。');
        } else {
          requireShared('MOBILE_K4_INPUT', 'EQ-MOB-DC-IN', 'DC_POS', 'EQ-MOB-K4', 'IN', '直流补电座DC+必须先经过K4。');
        }
        requireShared('MOBILE_K4_BUS', 'EQ-MOB-K4', 'OUT', 'EQ-MOB-ESS-BUS', 'BUS_DC_POS', 'K4输出必须直接进入主正母线。');
        requireShared('MOBILE_NEGATIVE_ORDER', 'EQ-MOB-BAT3', 'PACK_DC_NEG', 'EQ-MOB-RS2', 'IN', 'GB3总负必须先经过RS2采样。');
        requireShared('MOBILE_NEGATIVE_ORDER', 'EQ-MOB-RS2', 'OUT', 'EQ-MOB-K2', 'IN', 'RS2后必须经过K2总负。');
        requireShared('MOBILE_NEGATIVE_BUS', 'EQ-MOB-K2', 'OUT', 'EQ-MOB-ESS-BUS', 'BUS_DC_NEG', 'K2输出必须进入总负母线。');
        requireShared('MOBILE_HEATER_ORDER', 'EQ-MOB-K5', 'OUT', 'EQ-MOB-FUH', 'IN', 'K5必须串联加热熔断器。');
        requireShared('MOBILE_HEATER_INTERFACE', 'EQ-MOB-FUH', 'OUT', 'EQ-MOB-XH1', 'PANEL_H02', '加热熔断器必须先进入H02柜侧。');
        requireShared('MOBILE_HEATER_INTERFACE', 'EQ-MOB-XH1', 'BATTERY_H02', 'EQ-MOB-HEATER1', 'HEAT_HIGH', 'H02电池侧必须进入EH1正端。');
        requireShared('MOBILE_HEATER_SERIES', 'EQ-MOB-HEATER1', 'HEAT_LOW', 'EQ-MOB-HEATER2', 'HEAT_HIGH', 'EH1−必须串联EH2+。');
        requireShared('MOBILE_HEATER_SERIES', 'EQ-MOB-HEATER2', 'HEAT_LOW', 'EQ-MOB-HEATER3', 'HEAT_HIGH', 'EH2−必须串联EH3+。');
        requireShared('MOBILE_HEATER_INTERFACE', 'EQ-MOB-HEATER3', 'HEAT_LOW', 'EQ-MOB-XH1', 'BATTERY_H05', 'EH3−必须先进入H05电池侧。');
        requireShared('MOBILE_HEATER_INTERFACE', 'EQ-MOB-XH1', 'PANEL_H05', 'EQ-MOB-ESS-BUS', 'BUS_DC_NEG', 'H05柜侧必须回总负母线。');
        requireShared('MOBILE_PCS_POS_ORDER', 'EQ-MOB-PCS', 'ESS_DC_POS', 'EQ-MOB-K9', 'IN', 'PCS DC+必须依次进入K9。');
        requireShared('MOBILE_PCS_POS_ORDER', 'EQ-MOB-K9', 'OUT', 'EQ-MOB-FU3', 'IN', 'K9后必须串联FU3。');
        requireShared('MOBILE_PCS_POS_BUS', 'EQ-MOB-FU3', 'OUT', 'EQ-MOB-ESS-BUS', 'BUS_DC_POS', 'FU3输出必须直接进入主正母线。');
        requireShared('MOBILE_PCS_NEG_ORDER', 'EQ-MOB-PCS', 'ESS_DC_NEG', 'EQ-MOB-K10', 'IN', 'PCS DC−必须经过K10。');
        requireShared('MOBILE_PCS_NEG_BUS', 'EQ-MOB-K10', 'OUT', 'EQ-MOB-ESS-BUS', 'BUS_DC_NEG', 'K10输出必须进入总负母线。');
        const mobilePcs = instanceById.get('EQ-MOB-PCS');
        if (!mobilePcs || mobilePcs.energyDirection !== 'UNRESOLVED' || mobilePcs.reverseCapability !== 'UNRESOLVED' ||
            mobilePcs.name.indexOf('双向') >= 0 || !mobilePcs.terminals.filter((terminal) => /^ESS_DC_/.test(terminal.id)).every((terminal) => terminal.direction === 'out') ||
            !mobilePcs.terminals.filter((terminal) => /^AC_/.test(terminal.id)).every((terminal) => terminal.direction === 'in')) {
          report('ERC-070', 'MOBILE_PCS_DIRECTION_EVIDENCE', 'PCS只可表达图上AC→ESS DC路径；反向能力必须保留UNRESOLVED，不得擅称双向。', 'EQ-MOB-PCS');
        }
        requireShared('MOBILE_GUN_POS_ORDER', 'EQ-MOB-K7', 'OUT', 'EQ-MOB-FU2', 'IN', '枪正极必须K7→FU2。');
        requireShared('MOBILE_GUN_POS_ORDER', 'EQ-MOB-FU2', 'OUT', 'EQ-MOB-G1-XS', 'DC_POS', 'FU2后必须接枪DC+。');
        requireShared('MOBILE_GUN_NEG_ORDER', 'EQ-MOB-CHARGE-BUS', 'BUS_DC_NEG', 'EQ-MOB-RS1', 'IN', '枪侧负极必须先进入RS1采样。');
        requireShared('MOBILE_GUN_NEG_ORDER', 'EQ-MOB-RS1', 'OUT', 'EQ-MOB-K8', 'IN', 'RS1主功率端后必须直接进入K8，电表不得串入主功率路径。');
        requireShared('MOBILE_GUN_NEG_ORDER', 'EQ-MOB-K8', 'OUT', 'EQ-MOB-G1-XS', 'DC_NEG', 'K8后必须接枪DC−。');
        requireShared('MOBILE_METER_VOLTAGE_SENSE', 'EQ-MOB-CHARGE-BUS', 'BUS_DC_POS', 'EQ-MOB-PJ2', 'SENSE_DC_POS', 'PJ2必须以高阻端采样枪侧正母线。');
        requireShared('MOBILE_METER_VOLTAGE_SENSE', 'EQ-MOB-CHARGE-BUS', 'BUS_DC_NEG', 'EQ-MOB-PJ2', 'SENSE_DC_NEG', 'PJ2必须以高阻端采样枪侧负母线。');
        ['P', 'N'].forEach((side) => requireShared('MOBILE_METER_KELVIN_SENSE', 'EQ-MOB-RS1', 'KELVIN_' + side, 'EQ-MOB-PJ2', 'SHUNT_SENSE_' + side, 'RS1 Kelvin采样必须进入PJ2独立毫伏输入。'));
        ['TA', 'TB'].forEach((side) => requireShared('MOBILE_METER_TA_TB_LINK', 'EQ-MOB-PJ2', 'COMM_' + side, 'EQ-MOB-VCU', 'J6_METER_' + side, 'PJ2电表TA/TB必须独立接VCU J6。'));
        ['K7', 'K8'].forEach((tag) => requireShared('MOBILE_JT_B_PERMISSION', 'EQ-MOB-JT', 'B_OUT', 'EQ-MOB-' + tag, 'COIL_V24', 'JT-B必须硬切' + tag + '线圈许可。'));
        ['K9', 'K10'].forEach((tag) => requireShared('MOBILE_JT_C_PERMISSION', 'EQ-MOB-JT', 'C_OUT', 'EQ-MOB-' + tag, 'COIL_V24', 'JT-C必须硬切' + tag + '线圈许可。'));
        requireShared('MOBILE_JT_A_EXTERNAL_CHAIN', 'EQ-MOB-X12', 'JT_LOOP_OUT', 'EQ-MOB-KA-JTA', 'CONTACT_IN', '12芯外部链返回必须进入串联中继。');
        requireShared('MOBILE_JT_A_EXTERNAL_CHAIN', 'EQ-MOB-KA-JTA', 'CONTACT_OUT', 'EQ-MOB-JT', 'A_IN', '串联中继必须进入JT-A。');
        requireShared('MOBILE_JT_A_EXTERNAL_CHAIN', 'EQ-MOB-JT', 'A_OUT', 'EQ-MOB-VCU', 'DI_JT_A_EXTERNAL', 'JT-A输出必须进入VCU状态输入。');
        requireShared('MOBILE_FAN_RELAY', 'EQ-MOB-KA-FAN', 'CONTACT_OUT', 'EQ-MOB-FAN', 'CTRL_PWR_V12', '12V风机必须由KA2-8触点供电。');
        requireShared('MOBILE_FAN_RELAY', 'EQ-MOB-VCU', 'DO_MOB_FAN_RELAY', 'EQ-MOB-KA-FAN', 'COIL_V12_0V', 'VCU/J10必须控制12V风机中继线圈回路。');
        ['Y', 'G', 'R'].forEach((color) => {
          requireShared('MOBILE_LAMP_SUPPLY', 'EQ-MOB-AUX-BUS', 'BUS12_V12', 'EQ-MOB-HL-' + color, 'PWR_V12', '黄绿红指示灯必须使用图示12V域。');
        });
        requireShared('MOBILE_HMI_UART', 'EQ-MOB-VCU', 'HMI_TX', 'EQ-MOB-DISPLAY', 'RX', 'VCU TX必须进入4.3屏RX。');
        requireShared('MOBILE_HMI_UART', 'EQ-MOB-DISPLAY', 'RX', 'EQ-MOB-VOICE', 'RX', '语音板RX必须与4.3屏RX共用VCU TX导体。');
        requireShared('MOBILE_HMI_UART', 'EQ-MOB-DISPLAY', 'TX', 'EQ-MOB-VCU', 'HMI_RX', '4.3屏TX必须返回VCU RX。');
        requireShared('MOBILE_CARD_UART', 'EQ-MOB-VCU', 'CARD_TX', 'EQ-MOB-CARD', 'RX', 'VCU TX必须进入刷卡器RX。');
        requireShared('MOBILE_CARD_UART', 'EQ-MOB-CARD', 'TX', 'EQ-MOB-VCU', 'CARD_RX', '刷卡器TX必须进入VCU RX。');
        ['P', 'N'].forEach((side) => {
          requireShared('MOBILE_AUDIO_LINK', 'EQ-MOB-VOICE', 'AUDIO_OUT_' + side, 'EQ-MOB-SPK', 'AUDIO_IN_' + side, '语音板必须以独立音频线连接扬声器。');
          requireShared('MOBILE_TEMPERATURE_SENSOR', 'EQ-MOB-TEMP', 'SENSOR_' + side, 'EQ-MOB-BCU', 'TEMP_SENSOR_' + side, '被动两线温感必须进入BCU。');
        });
        const qt = instanceById.get('EQ-MOB-QT');
        if (!qt || qt.kind !== 'selector-switch-dual' || qt.mechanicallyLinked !== true || qt.contactForm !== 'NO_NC_UNKNOWN' ||
            stableText(qt.observedTerminalLabels) !== stableText(['XS/5', 'XS/20', 'TX/ENABLE', 'TX/GND'])) {
          report('ERC-070', 'MOBILE_QT_SWITCH_EVIDENCE', 'QT必须是单实例机械联动双触点，保留四个原始标签且NO/NC为UNKNOWN。', 'EQ-MOB-QT');
        }
        const heaterInterface = instanceById.get('EQ-MOB-XH1');
        if (!heaterInterface || heaterInterface.kind !== 'heating-connector-2pin' || (topology.mobileReference || {}).heaterInterface !== heaterInterface.id ||
            stableText(heaterInterface.terminals.filter((terminal) => terminal.required).map((terminal) => terminal.id).sort()) !==
              stableText(['BATTERY_H02', 'BATTERY_H05', 'PANEL_H02', 'PANEL_H05'])) {
          report('ERC-070', 'MOBILE_HEATER_INTERFACE', 'H02/H05必须以柜侧/电池侧四端子两芯接口进入加热串联回路。', 'EQ-MOB-XH1');
        }
        const km2Relay = instanceById.get('EQ-MOB-KM2');
        const acRelay = instanceById.get('EQ-MOB-KA-AC');
        const relayHasRequiredCircuit = (instance) => instance && instance.kind === 'control-relay' &&
          ['COIL_V24', 'COIL_V24_0V', 'CONTACT_IN', 'CONTACT_OUT', 'FEEDBACK'].every((terminalId) => {
            const terminal = instance.terminals.find((item) => item.id === terminalId);
            return terminal && terminal.required && (membership.get(key(instance.id, terminalId)) || []).length === 1;
          });
        if (!relayHasRequiredCircuit(km2Relay) || !relayHasRequiredCircuit(acRelay) ||
            !shareNet('EQ-MOB-KM2', 'CONTACT_OUT', 'EQ-MOB-KA-AC', 'CONTACT_IN') ||
            !shareNet('EQ-MOB-KA-AC', 'CONTACT_OUT', 'EQ-MOB-KM1', 'COIL_V24') ||
            (topology.mobileReference && topology.mobileReference.replenishment || {}).km2 !== 'EQ-MOB-KM2' ||
            (topology.mobileReference && topology.mobileReference.replenishment || {}).acControlRelay !== 'EQ-MOB-KA-AC') {
          report('ERC-070', 'MOBILE_AC_CONTROL_RELAY_CHAIN', 'KM2与独立交流中继必须各自保留线圈/触点/反馈，并串联许可KM1。', 'EQ-MOB-KM2');
        }
        const jtRelay = instanceById.get('EQ-MOB-KA-JTA');
        if (!jtRelay || !jtRelay.terminals.find((terminal) => terminal.id === 'COIL_V24' && terminal.required) ||
            !jtRelay.terminals.find((terminal) => terminal.id === 'COIL_V24_0V' && terminal.required) ||
            !shareNet('EQ-MOB-VCU', 'ZB_J10_4', jtRelay.id, 'COIL_V24') ||
            !shareNet(jtRelay.id, 'COIL_V24_0V', 'EQ-MOB-AUX-BUS', 'BUS24_V24_0V') ||
            jtRelay.coilSourceLabel !== 'ZB/J10/4' || jtRelay.coilReturnLabel !== '24V−') {
          report('ERC-070', 'MOBILE_JT_A_RELAY_COIL', 'JT-A串联中继必须保留ZB/J10/4→24V线圈→24V−的观察回路。', 'EQ-MOB-KA-JTA');
        }
        const routerInstance = instanceById.get('EQ-MOB-ROUTER');
        const antennaInstance = instanceById.get('EQ-MOB-ANT');
        const rfNetIds = membership.get(key('EQ-MOB-ROUTER', 'RF_PORT')) || [];
        const rfNet = rfNetIds.length === 1 ? netById.get(rfNetIds[0]) : null;
        const inventedOcppRouter = nets.some((net) => net.netClass === 'SIGNAL_COMM' && net.protocol !== 'RF_UNKNOWN' &&
          net.members.some((member) => member.instanceId === 'EQ-MOB-OCPP') && net.members.some((member) => member.instanceId === 'EQ-MOB-ROUTER'));
        if (!routerInstance || !antennaInstance || antennaInstance.kind !== 'rf-antenna' || !rfNet || rfNet.protocol !== 'RF_UNKNOWN' ||
            !rfNet.members.some((member) => member.instanceId === antennaInstance.id && member.terminalId === 'RF') || inventedOcppRouter) {
          report('ERC-070', 'MOBILE_ROUTER_ANTENNA_RF', '路由器与三合一天线必须是两个实例，只保留RF_UNKNOWN物理链且不得猜接OCPP数据线。', 'EQ-MOB-ROUTER');
        }
        const fuseExpectations = { FU1: 'CALCULATED', FU2: 'CALCULATED', FU3: 'UNKNOWN', FUH: 'UNKNOWN' };
        Object.keys(fuseExpectations).forEach((tag) => {
          const fuse = instances.find((instance) => instance.tag === tag);
          const expectedStatus = fuseExpectations[tag];
          if (!fuse || fuse.ratingStatus !== expectedStatus || !fuse.ratingSource || !fuse.ratingBasis ||
              (expectedStatus === 'CALCULATED' && (!finite(fuse.ratedCurrentA) || !fuse.calculationSource)) ||
              (expectedStatus === 'UNKNOWN' && fuse.ratedCurrentA !== null)) {
            report('ERC-070', 'MOBILE_FUSE_RATING_EVIDENCE', tag + '必须保留CALCULATED/UNKNOWN额定状态、来源与复核边界。', fuse ? fuse.id : tag);
          }
        });
        for (let number = 1; number <= 10; number += 1) {
          const contactor = instanceById.get('EQ-MOB-K' + number);
          const expectedCurrent = number === 3 || number === 5 ? 50 : 200;
          if (!contactor || contactor.ratedCurrentA !== expectedCurrent || contactor.coilVoltageV !== 24 ||
              contactor.ratingStatus !== 'OBSERVED' || contactor.ratingSource !== '0823_SVG_CONTACTOR_LABEL') {
            report('ERC-070', 'MOBILE_CONTACTOR_RATING_EVIDENCE', 'K' + number + '图面额定值或证据状态被改变。', 'EQ-MOB-K' + number);
          }
        }
        const spd = instanceById.get('EQ-MOB-SPD1');
        const expectedSpd = { gb: '3P+N', eu: '3P+N', us: '2P', nacs: '2P', chademo: '1P+N' }[model.requirements.standard];
        const referenceAcConductors = (((topology.mobileReference || {}).replenishment || {}).acOutputProfile || {}).conductors || [];
        if (!spd || spd.phaseConfiguration !== expectedSpd || String(spd.name).indexOf(expectedSpd) < 0 ||
            stableText(spd.actualConductors) !== stableText(referenceAcConductors)) {
          report('ERC-070', 'MOBILE_SPD_LABEL', '补电SPD名称与相制必须由所选交流导体集合生成。', 'EQ-MOB-SPD1');
        }
        const voice = instanceById.get('EQ-MOB-VOICE');
        const terminalT = voice && voice.terminals.find((terminal) => terminal.id === 'T');
        if (!voice || stableText(voice.observedRawTerminalLabels) !== stableText(['V', 'V', 'G', 'G', 'R', 'T']) ||
            !terminalT || terminalT.required !== false || terminalT.evidenceStatus !== 'OBSERVED_DESTINATION_UNRESOLVED' || membership.has(key(voice.id, 'T'))) {
          report('ERC-070', 'MOBILE_VOICE_T_EVIDENCE', '语音板必须保留V,V,G,G,R,T原始端子证据，T去向保持开放未解析。', 'EQ-MOB-VOICE:T');
        }
        const modeInterlock = instanceById.get('EQ-MOB-NACS-MODE-ILK');
        if (model.requirements.standard === 'nacs') {
          if (!modeInterlock || modeInterlock.kind !== 'ac-dc-mode-interlock' || modeInterlock.modeRelationship !== 'MUTUALLY_EXCLUSIVE' ||
              !contract.requiredKinds.includes('ac-dc-mode-interlock') || !contract.requiredKinds.includes('nacs-shared-inlet') ||
              !contract.requiredKinds.includes('ac-dc-power-selector') ||
              ['EQ-MOB-NACS-MODE-ILK', 'EQ-MOB-NACS-IN', 'EQ-MOB-NACS-SEL', 'EQ-MOB-K4N'].some((id) => !contract.markerIds.includes(id))) {
            report('ERC-070', 'NACS_AC_DC_HARD_INTERLOCK', 'NACS共享大电流触点必须有进入桩型契约的AC/DC模式硬互锁。', 'EQ-MOB-NACS-MODE-ILK');
          } else {
            requireShared('NACS_AC_DC_HARD_INTERLOCK', modeInterlock.id, 'DC_PERMISSION_V24', 'EQ-MOB-K4', 'COIL_V24', 'NACS DC许可必须硬串入K4线圈正端。');
            requireShared('NACS_AC_DC_HARD_INTERLOCK', modeInterlock.id, 'DC_PERMISSION_V24', 'EQ-MOB-K4N', 'COIL_V24', 'NACS DC许可必须同时硬串入K4N负极隔离线圈。');
            requireShared('NACS_AC_DC_HARD_INTERLOCK', modeInterlock.id, 'AC_PERMISSION_V24', 'EQ-MOB-KM2', 'COIL_V24', 'NACS AC许可必须硬串入KM2线圈。');
            requireShared('NACS_AC_DC_HARD_INTERLOCK', modeInterlock.id, 'AC_PERMISSION_V24', 'EQ-MOB-KA-AC', 'COIL_V24', 'NACS AC许可必须硬串入独立交流中继线圈。');
            requireShared('NACS_AC_DC_HARD_INTERLOCK', modeInterlock.id, 'MODE_COMMAND', 'EQ-MOB-EVCC', 'DO_NACS_AC_DC_MODE', 'NACS模式互锁必须有独立受控命令。');
          }
          const nacsOwner = instanceById.get('EQ-MOB-NACS-IN');
          const selector = instanceById.get('EQ-MOB-NACS-SEL');
          const dcProxy = instanceById.get('EQ-MOB-DC-IN');
          const acProxy = instanceById.get('EQ-MOB-AC-IN');
          const expectedMatrix = {
            ALL_OPEN: { acPermission: false, dcPositivePermission: false, dcNegativePermission: false },
            AC_ENABLED: { acPermission: true, dcPositivePermission: false, dcNegativePermission: false },
            DC_ENABLED: { acPermission: false, dcPositivePermission: true, dcNegativePermission: true }
          };
          const ownerPort = (id) => nacsOwner && (nacsOwner.functionalPorts || []).find((port) => port.id === id);
          const validMappedPort = (id, physicalId, modeId, logicalOwnerId) => {
            const port = ownerPort(id);
            return !!port && stableText(port.physicalTerminalIds) === stableText([physicalId]) && port.modeId === modeId &&
              port.logicalOwnerId === logicalOwnerId && port.mutualExclusionGroup === 'NACS_AC_DC_POWER' && port.modeDependent === true;
          };
          const proxyPort = (proxy, id) => proxy && (proxy.functionalPorts || []).find((port) => port.id === id);
          const validProxyTerminal = (proxy, terminalId, physicalTerminalId, modeId, group) => {
            const terminal = proxy && (proxy.terminals || []).find((item) => item.id === terminalId);
            return !!terminal && terminal.logicalOnly === true && terminal.required === false &&
              terminal.connectionPolicy === 'LOGICAL_ALIAS_ONLY_NO_NET' &&
              terminal.evidenceStatus === 'CONTROLLED_NACS_FUNCTION_ALIAS' &&
              terminal.physicalOwnerId === 'EQ-MOB-NACS-IN' && terminal.physicalTerminalId === physicalTerminalId &&
              terminal.modeId === modeId && (terminal.mutualExclusionGroup || null) === (group || null) &&
              !(membership.get(key(proxy.id, terminalId)) || []).length;
          };
          const validProxyPort = (proxy, id, logicalTerminalIds, physicalTerminalIds, modeId, group) => {
            const port = proxyPort(proxy, id);
            return !!port && port.physicalOwnerId === 'EQ-MOB-NACS-IN' &&
              stableText(port.logicalTerminalIds) === stableText(logicalTerminalIds) &&
              stableText(port.physicalTerminalIds) === stableText(physicalTerminalIds) && port.modeId === modeId &&
              (port.mutualExclusionGroup || null) === (group || null) && port.modeDependent === !!group;
          };
          const commonNets = nets.filter((net) => net.netClass === 'POWER_INTERFACE_MODED');
          if (!nacsOwner || nacsOwner.kind !== 'nacs-shared-inlet' || !selector || selector.kind !== 'ac-dc-power-selector' ||
              !dcProxy || !acProxy || dcProxy.logicalOnlyProxy !== true || acProxy.logicalOnlyProxy !== true ||
              dcProxy.physicalOwnerId !== nacsOwner.id || acProxy.physicalOwnerId !== nacsOwner.id ||
              (dcProxy.physicalTerminals || []).length !== 0 || (acProxy.physicalTerminals || []).length !== 0 ||
              stableText(nacsOwner.terminals.map((terminal) => terminal.id).sort()) !== stableText(['CP', 'PE', 'PP', 'PWR_A', 'PWR_B']) ||
              !validMappedPort('AC_L1', 'PWR_A', 'AC', acProxy.id) || !validMappedPort('DC_POS', 'PWR_A', 'DC', dcProxy.id) ||
              !validMappedPort('AC_L2', 'PWR_B', 'AC', acProxy.id) || !validMappedPort('DC_NEG', 'PWR_B', 'DC', dcProxy.id) ||
              ['CP', 'PP', 'PE'].some((id) => {
                const port = ownerPort(id);
                return !port || stableText(port.physicalTerminalIds) !== stableText([id]) || stableText(port.activeModes) !== stableText(['AC', 'DC']);
              }) ||
              !validProxyPort(acProxy, 'AC', ['AC_L1', 'AC_L2'], ['PWR_A', 'PWR_B'], 'AC', 'NACS_AC_DC_POWER') ||
              !validProxyPort(dcProxy, 'DC_POS', ['DC_POS'], ['PWR_A'], 'DC', 'NACS_AC_DC_POWER') ||
              !validProxyPort(dcProxy, 'DC_NEG', ['DC_NEG'], ['PWR_B'], 'DC', 'NACS_AC_DC_POWER') ||
              !validProxyPort(dcProxy, 'CP', ['CP'], ['CP'], 'AC_DC_SHARED', null) ||
              !validProxyPort(dcProxy, 'PP', ['PP'], ['PP'], 'AC_DC_SHARED', null) ||
              !validProxyPort(dcProxy, 'PE', ['PE'], ['PE'], 'AC_DC_SHARED', null) ||
              !validProxyTerminal(acProxy, 'AC_L1', 'PWR_A', 'AC', 'NACS_AC_DC_POWER') ||
              !validProxyTerminal(acProxy, 'AC_L2', 'PWR_B', 'AC', 'NACS_AC_DC_POWER') ||
              !validProxyTerminal(dcProxy, 'DC_POS', 'PWR_A', 'DC', 'NACS_AC_DC_POWER') ||
              !validProxyTerminal(dcProxy, 'DC_NEG', 'PWR_B', 'DC', 'NACS_AC_DC_POWER') ||
              !validProxyTerminal(dcProxy, 'CP', 'CP', 'AC_DC_SHARED', null) ||
              !validProxyTerminal(dcProxy, 'PP', 'PP', 'AC_DC_SHARED', null) ||
              !validProxyTerminal(dcProxy, 'PE', 'PE', 'AC_DC_SHARED', null) ||
              commonNets.length !== 2 ||
              !shareNet(nacsOwner.id, 'PWR_A', selector.id, 'COMMON_A') || !shareNet(nacsOwner.id, 'PWR_B', selector.id, 'COMMON_B') ||
              !shareNet(selector.id, 'AC_L1', 'EQ-MOB-RCM1', 'IN_L1') || !shareNet(selector.id, 'AC_L2', 'EQ-MOB-RCM1', 'IN_L2') ||
              !shareNet(selector.id, 'DC_POS', 'EQ-MOB-K4', 'IN') || !shareNet(selector.id, 'DC_NEG', 'EQ-MOB-K4N', 'IN') ||
              !shareNet(nacsOwner.id, 'CP', 'EQ-MOB-EVCC', 'DC_INLET_CP') ||
              !shareNet(nacsOwner.id, 'PP', 'EQ-MOB-EVCC', 'DC_INLET_PP') ||
              (membership.get(key(nacsOwner.id, 'PE')) || []).length !== 1 ||
              !netById.get((membership.get(key(nacsOwner.id, 'PE')) || [])[0]) ||
              netById.get((membership.get(key(nacsOwner.id, 'PE')) || [])[0]).netClass !== 'PROTECTIVE_EARTH' ||
              !shareNet('EQ-MOB-K4N', 'OUT', 'EQ-MOB-ESS-BUS', 'BUS_DC_NEG')) {
            report('ERC-070', 'NACS_SHARED_POWER_CONTACT_ALIAS', 'NACS必须由单一PWR_A/PWR_B物理owner经默认断开的双极选择边界映射AC/DC功能，不得保留四套物理端子或旁路K4N。', 'EQ-MOB-NACS-IN');
          }
          if (!selector || selector.defaultMode !== 'ALL_OPEN' || selector.powerModePolicy !== 'BREAK_BEFORE_MAKE_ALL_POLES' ||
              stableText(selector.modeStateMatrix) !== stableText(expectedMatrix) || modeInterlock.defaultMode !== 'ALL_OPEN' ||
              modeInterlock.powerModePolicy !== 'BREAK_BEFORE_MAKE_ALL_POLES' || stableText(modeInterlock.modeStateMatrix) !== stableText(expectedMatrix) ||
              stableText(modeInterlock.dcPermissionTargets) !== stableText(['EQ-MOB-K4:COIL_V24', 'EQ-MOB-K4N:COIL_V24']) ||
              stableText(modeInterlock.acPermissionTargets) !== stableText(['EQ-MOB-KM2:COIL_V24', 'EQ-MOB-KA-AC:COIL_V24'])) {
            report('ERC-070', 'NACS_AC_DC_HARD_INTERLOCK', 'NACS模式矩阵必须默认全断、全极break-before-make，且AC与DC许可集合无交集。', 'EQ-MOB-NACS-MODE-ILK');
          }
        } else if (modeInterlock) {
          report('ERC-070', 'NACS_AC_DC_HARD_INTERLOCK_UNEXPECTED', '非NACS输入组件不得混入NACS共享功率触点互锁模板。', modeInterlock.id);
        } else if (instances.some((instance) => ['nacs-shared-inlet', 'ac-dc-power-selector'].includes(instance.kind) || instance.id === 'EQ-MOB-K4N')) {
          report('ERC-070', 'NACS_SHARED_POWER_CONTACT_ALIAS', '非NACS标准不得混入NACS物理触点owner或双极选择边界。', 'model.instances');
        }
        const inletLock = instanceById.get('EQ-MOB-INLET-LOCK');
        if (model.requirements.standard === 'chademo') {
          if (inletLock) report('ERC-070', 'MOBILE_INLET_LOCK_UNEXPECTED', 'CHAdeMO受控profile未要求电子锁，不得从其他标准模板复制。', inletLock.id);
        } else if (!inletLock || inletLock.kind !== 'connector-lock' || inletLock.feedbackChannels !== 2 ||
                   !inletLock.terminals.some((terminal) => terminal.id === 'FEEDBACK_2' && terminal.required) ||
                   inletLock.physicalAssemblyId !== (instanceById.get('EQ-MOB-DC-IN') || {}).physicalAssemblyId) {
          report('ERC-070', 'MOBILE_INLET_LOCK_INVALID', '补电座必须有24V电子锁及两路独立反馈，并归属于实际DC/Combo输入组件。', 'EQ-MOB-INLET-LOCK');
        }
        const mobileReference = topology.mobileReference || {};
        const sizing = mobileReference.moduleSizing || {};
        const modules = instances.filter((instance) => instance.kind === 'dc-dc-charge-module');
        const calculatedInstalled = Number(sizing.moduleCount) * Number(sizing.unitKw);
        const expectedModuleIds = Array.from({ length: Number(sizing.moduleCount) || 0 }, (_, index) => 'EQ-MOB-M' + (index + 1));
        if (!Number.isInteger(sizing.moduleCount) || sizing.moduleCount < 1 || modules.length !== sizing.moduleCount ||
            stableText((mobileReference.moduleIds || []).slice().sort()) !== stableText(expectedModuleIds.slice().sort()) ||
            modules.some((instance, index) => instance.id !== 'EQ-MOB-M' + (index + 1) || instance.unitKw !== sizing.unitKw ||
              instance.installedKw !== sizing.unitKw || instance.ratingStatus !== 'CALCULATED' ||
              String(instance.name).indexOf(String(sizing.unitKw) + 'kW') < 0 || !instance.calculationSource) ||
            sizing.ratingStatus !== 'CALCULATED' || sizing.calculatedInstalledKw !== calculatedInstalled ||
            sizing.declaredInstalledKw !== calculatedInstalled || Number(model.requirements.installedOutputKw) !== calculatedInstalled ||
            calculatedInstalled < Number(sizing.requestedOutputKw) || Number(model.requirements.outputKw) !== Number(sizing.requestedOutputKw) ||
            sizing.outputContractStatus !== 'SATISFIED') {
          report('ERC-070', 'MOBILE_MODULE_SIZING', '移动模板模块数量、单机功率、装机功率与输出契约必须来自同一确定性计算。', 'model.topology.mobileReference.moduleSizing');
        }
        const protocols = new Set(nets.filter((net) => net.netClass === 'SIGNAL_COMM').map((net) => net.protocol));
        ['BMS_CAN', 'VEHICLE_CAN', 'CHARGE_CAN', 'SECC_CAN', 'MODULE_CAN', 'SERIAL_UNKNOWN', 'TA_TB_UNKNOWN', 'HMI_UART', 'CARD_READER_SERIAL_UNKNOWN'].forEach((protocol) => {
          if (!protocols.has(protocol)) report('ERC-070', 'MOBILE_COMM_NETWORK_MISSING', '移动模板缺少独立通信网络：' + protocol, 'model.nets');
        });
      }
    });

    run('ERC-075', '地区交流车辆接口与变压边界', () => {
      const standardId = model && model.requirements && model.requirements.standard;
      const expected = AC_OUTPUT_PROFILES[standardId];
      const connectors = instances.filter((instance) => instance.kind === 'ac-charge-connector');
      if (!connectors.length) return;
      if (!expected) {
        report('ERC-075', 'AC_CONNECTOR_STANDARD_UNKNOWN', '交流车辆接口没有受控地区配置：' + String(standardId), 'model.requirements.standard');
        return;
      }
      const expectedProfile = {
        connectorType: expected.connectorType,
        lineVoltage: expected.lineVoltage,
        phases: expected.phases,
        conductors: expected.conductors.slice(),
        controlPins: expected.controlPins.slice(),
        requiresTransformer: expected.requiresTransformer
      };
      if (expected.companionInterface) expectedProfile.companionInterface = true;
      connectors.forEach((instance) => {
        const sharedOwner = instance.sharedControlOwner ? instanceById.get(instance.sharedControlOwner) : null;
        const nacsPhysicalOwner = standardId === 'nacs' && instance.logicalOnlyProxy === true
          ? instanceById.get(instance.physicalOwnerId) : null;
        if (instance.connectorType !== expected.connectorType || stableText(instance.acOutputProfile) !== stableText(expectedProfile)) {
          report('ERC-075', 'AC_CONNECTOR_PROFILE_MISMATCH', '交流接口实例与所选标准受控 profile 不一致：' + instance.id, instance.id + '.acOutputProfile');
        }
        const actualConductors = instance.terminals.filter((terminal) => /^AC_(L1|L2|L3|N)$/.test(terminal.id)).map((terminal) => terminal.id.slice(3)).sort();
        const actualControl = instance.terminals.filter((terminal) => ['CP', 'PP', 'CC'].includes(terminal.id)).map((terminal) => terminal.id).sort();
        if (stableText(actualConductors) !== stableText(expected.conductors.slice().sort())) {
          report('ERC-075', 'AC_CONNECTOR_CONDUCTOR_SET', instance.id + ' 相线/中性线集合与地区接口不一致。', instance.id + '.terminals');
        }
        const expectedLocalControl = sharedOwner ? [] : expected.controlPins.slice().sort();
        if (stableText(actualControl) !== stableText(expectedLocalControl)) {
          report('ERC-075', 'AC_CONNECTOR_CONTROL_SET', instance.id + ' CP/PP/CC 触点集合与地区接口不一致。', instance.id + '.terminals');
        }
        expected.conductors.forEach((phase) => {
          if (instance.logicalOnlyProxy === true) return;
          const ids = membership.get(key(instance.id, 'AC_' + phase)) || [];
          if (ids.length !== 1) {
            report('ERC-075', 'AC_CONNECTOR_CONDUCTOR_OPEN', instance.id + ':AC_' + phase + ' 必须恰连一个网络。', instance.id);
            return;
          }
          const net = netById.get(ids[0]);
          const isOutput = instance.interfaceRole !== 'REPLENISHMENT_INPUT';
          const expectedDomain = isOutput && expected.requiresTransformer ? 'AC_EV_OUTPUT' : 'AC_MAINS';
          if (!net || net.phase !== phase || net.domain !== expectedDomain || netVoltage(net) !== expected.lineVoltage) {
            report('ERC-075', 'AC_CONNECTOR_CONDUCTOR_WRONG', instance.id + ':AC_' + phase + ' 的相别、电压或受控域错误。', instance.id + ':AC_' + phase);
          }
        });
        expected.controlPins.forEach((pin) => {
          const ownerId = nacsPhysicalOwner ? nacsPhysicalOwner.id : (sharedOwner ? sharedOwner.id : instance.id);
          const ids = membership.get(key(ownerId, pin)) || [];
          const entry = terminalByKey.get(key(ownerId, pin));
          const expectedRole = sharedOwner ? pin : 'AC:' + pin;
          if (ids.length !== 1 || !entry || entry.terminal.signalRole !== expectedRole) {
            report('ERC-075', 'AC_CONNECTOR_CONTROL_WRONG', ownerId + ':' + pin + ' 必须保持独立物理角色。', ownerId + ':' + pin);
          }
        });
        const peOwnerId = nacsPhysicalOwner ? nacsPhysicalOwner.id : (sharedOwner ? sharedOwner.id : instance.id);
        const peIds = membership.get(key(peOwnerId, 'PE')) || [];
        if (peIds.length !== 1 || !netById.get(peIds[0]) || netById.get(peIds[0]).netClass !== 'PROTECTIVE_EARTH') {
          report('ERC-075', 'AC_CONNECTOR_PE_WRONG', peOwnerId + ':PE 未连接独立保护地。', peOwnerId + ':PE');
        }
        if (instance.interfaceRole === 'REPLENISHMENT_INPUT') {
          const shouldShare = ['eu', 'us', 'nacs'].includes(standardId);
          if (shouldShare) {
            const assemblyOwner = nacsPhysicalOwner || sharedOwner;
            const expectedOwnerKind = standardId === 'nacs' ? 'nacs-shared-inlet' : 'dc-charge-inlet';
            if (!assemblyOwner || assemblyOwner.kind !== expectedOwnerKind || instance.physicalAssemblyId !== assemblyOwner.physicalAssemblyId) {
              report('ERC-075', 'AC_DC_ASSEMBLY_BOUNDARY', standardId + ' 补电组件必须由AC/DC逻辑分区共享同一受控物理组件及CP/PP/PE。', instance.id);
            }
            if (standardId === 'nacs' && (!instance.sharedPowerContacts || instance.sharedPowerContacts.mode !== 'MUTUALLY_EXCLUSIVE' || instance.assemblyMode !== 'SHARED_CONTROL_AND_POWER_CONTACTS_MODE_EXCLUSIVE')) {
              report('ERC-075', 'NACS_AC_DC_MODE_BOUNDARY', 'NACS补电口复用大电流触点时必须声明AC/DC模式互斥。', instance.id);
            }
          } else if (sharedOwner || instance.physicalAssemblyId === (instances.find((item) => item.kind === 'dc-charge-inlet') || {}).physicalAssemblyId || instance.assemblyMode !== 'SEPARATE_PHYSICAL_CONNECTORS') {
            report('ERC-075', 'AC_DC_ASSEMBLY_BOUNDARY', standardId + ' 的直流补电口与交流伴随接口必须是两个物理组件。', instance.id);
          }
        }
      });

      if (model.requirements.archetype === 'ac-dc-combo') {
        const connector = instanceById.get('EQ-AC-EV-XS1');
        const transformer = instanceById.get('EQ-AC-EV-TX1');
        if (expected.requiresTransformer && (!transformer || transformer.kind !== 'ac-ev-transformer')) {
          report('ERC-075', 'AC_EV_TRANSFORMER_MISSING', standardId + ' 480V站点到240V车辆接口缺少受控隔离变压边界。', 'EQ-AC-EV-TX1');
        }
        if (!expected.requiresTransformer && transformer) {
          report('ERC-075', 'AC_EV_TRANSFORMER_UNEXPECTED', standardId + ' 直供支路不应混入北美480/240V模板。', transformer.id);
        }
        const assumption = (model.assumptions || []).find((item) => item.id === 'AC-EV-BRANCH-RATING');
        if (!assumption || String(assumption.value).indexOf('63A') < 0 || String(assumption.value).indexOf(String(expected.lineVoltage)) < 0) {
          report('ERC-075', 'AC_EV_RATING_ASSUMPTION_MISSING', '固定63A交流支路必须作为显式方案假设记录。', 'model.assumptions');
        }
        if (!connector) return;
        expected.conductors.forEach((phase) => {
          function share(aId, aTerminal, bId, bTerminal) {
            const left = membership.get(key(aId, aTerminal)) || [];
            const right = new Set(membership.get(key(bId, bTerminal)) || []);
            return left.some((id) => right.has(id));
          }
          if (expected.requiresTransformer) {
            if (!share('EQ-AC-EV-TX1', 'OUT_' + phase, 'EQ-AC-EV-RCD1', 'IN_' + phase)) {
              report('ERC-075', 'AC_EV_TRANSFORMER_BYPASSED', '变压器 ' + phase + ' 输出未直接进入RCD。', 'EQ-AC-EV-TX1:OUT_' + phase);
            }
          } else if (!share('EQ-AC-EV-QF1', 'OUT_' + phase, 'EQ-AC-EV-RCD1', 'IN_' + phase)) {
            report('ERC-075', 'AC_EV_BRANCH_ORDER', 'QF ' + phase + ' 输出未直接进入RCD。', 'EQ-AC-EV-QF1:OUT_' + phase);
          }
          if (!share('EQ-AC-EV-RCD1', 'OUT_' + phase, 'EQ-AC-EV-PJ1', 'IN_' + phase) ||
              !share('EQ-AC-EV-PJ1', 'OUT_' + phase, 'EQ-AC-EV-KM1', 'IN_' + phase) ||
              !share('EQ-AC-EV-KM1', 'OUT_' + phase, 'EQ-AC-EV-XS1', 'AC_' + phase)) {
            report('ERC-075', 'AC_EV_BRANCH_ORDER', '交流车辆支路必须逐导体保持 RCD→表→KM→插座。', 'EQ-AC-EV-XS1:AC_' + phase);
          }
        });
      }
    });

    /*
     * ERC-080..085 consume the functional-unit contracts emitted by the
     * deterministic design model.  These checks deliberately do not invent
     * project thresholds or infer an analogue circuit implementation.
     */
    const topology = model && model.topology && typeof model.topology === 'object' ? model.topology : {};
    const functionalUnits = Array.isArray(topology.functionalUnits) ? topology.functionalUnits : [];
    const outputConnectors = instances.filter((instance) =>
      instance && instance.logicalOnlyProxy !== true && instance.interfaceRole === 'CHARGING_OUTPUT' &&
      ['charge-connector', 'ac-charge-connector'].includes(instance.kind));
    const cpDeviceKinds = Object.freeze(['control-pilot-generator', 'control-pilot-monitor', 'vehicle-diode-detector']);
    const diagnosticDeviceKinds = Object.freeze(cpDeviceKinds.concat(['output-precheck-monitor', 'contactor-state-monitor']));

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function sortedUnique(values) {
      return uniqueNonEmpty(asArray(values).map((value) => String(value))).sort();
    }

    function sameIdSet(left, right) {
      return stableText(sortedUnique(left)) === stableText(sortedUnique(right));
    }

    function oneNetId(instanceId, terminalId) {
      const ids = membership.get(key(instanceId, terminalId)) || [];
      return ids.length === 1 ? ids[0] : null;
    }

    function netMembers(netId) {
      const net = netById.get(netId);
      return net && Array.isArray(net.members) ? net.members : [];
    }

    function netHasInstance(netId, instanceId) {
      return netMembers(netId).some((member) => member.instanceId === instanceId);
    }

    function outputPathReaches(startNetId, targetNetId) {
      if (!startNetId || !targetNetId) return false;
      if (startNetId === targetNetId) return true;
      const allowedSeriesKinds = new Set(['dc-fuse', 'current-transducer', 'dc-meter']);
      const adjacency = new Map();
      const link = (left, right) => {
        if (!left || !right || left === right) return;
        adjacency.set(left, (adjacency.get(left) || []).concat(right));
        adjacency.set(right, (adjacency.get(right) || []).concat(left));
      };
      instances.filter((instance) => instance && allowedSeriesKinds.has(instance.kind)).forEach((instance) => {
        link(oneNetId(instance.id, 'IN'), oneNetId(instance.id, 'OUT'));
      });
      const visited = new Set([startNetId]);
      const queue = [startNetId];
      while (queue.length) {
        const current = queue.shift();
        for (const next of adjacency.get(current) || []) {
          if (next === targetNetId) return true;
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
      return false;
    }

    function outputConductorIds(connector) {
      const pattern = connector && connector.kind === 'ac-charge-connector'
        ? /^AC_(L1|L2|L3|N)$/ : /^DC_(POS|NEG)$/;
      return asArray(connector && connector.terminals)
        .filter((terminal) => terminal && terminal.required === true && pattern.test(String(terminal.id)))
        .map((terminal) => terminal.id)
        .sort();
    }

    function senseTerminalId(conductorId) {
      return String(conductorId).replace(/^AC_/, 'SENSE_').replace(/^DC_/, 'SENSE_DC_');
    }

    function poleIdForConductor(conductorId) {
      return String(conductorId).replace(/^AC_/, '').replace(/^DC_/, 'DC_');
    }

    function unitsFor(type, connectorId) {
      return functionalUnits.filter((unit) => unit && unit.type === type && unit.protectedConnectorId === connectorId);
    }

    function hasControllerPeer(instanceId, terminalId, controllerId) {
      const netId = oneNetId(instanceId, terminalId);
      return !!netId && netHasInstance(netId, controllerId);
    }

    function exactFunctionSet(unit, expected) {
      return sameIdSet(unit && unit.functions, expected);
    }

    function validateProjectValue(ruleId, ownerLocation, name, entry) {
      const location = ownerLocation + '.' + name;
      if (!entry || typeof entry !== 'object' || !String(entry.unit || '') || !String(entry.status || '')) {
        report(ruleId, 'PROJECT_VALUE_CONTRACT_MISSING', name + ' 缺少值/单位/状态契约。', location);
        return;
      }
      if (entry.status === 'PROJECT_VALUE_REQUIRED') {
        if (entry.value !== null) {
          report(ruleId, 'PROJECT_VALUE_STATUS_CONTRADICTED', name + ' 已填值但仍标记 PROJECT_VALUE_REQUIRED。', location);
        } else {
          report(ruleId, 'PROJECT_VALUE_NOT_EVALUATED', name + ' 尚未由项目输入，不得用于运行放行。', location, 'WARN', [
            { status: 'NOT_EVALUATED', reason: 'PROJECT_VALUE_REQUIRED' }
          ]);
        }
        return;
      }
      if (entry.value === null || entry.value === undefined || entry.value === '') {
        report(ruleId, 'PROJECT_VALUE_FALSE_PASS', name + ' 没有值却被标记为已解析。', location);
        return;
      }
      if (!entry.sourceRef && !entry.calculationRef) {
        report(ruleId, 'PROJECT_VALUE_PROVENANCE_MISSING', name + ' 已解析值缺少 sourceRef/calculationRef。', location);
      }
    }

    run('ERC-080', '车辆接口功能适用性契约', () => {
      const contracted = instances.filter((instance) => instance && instance.controlContract);
      outputConnectors.forEach((connector) => {
        if (!connector.controlContract) {
          report('ERC-080', 'OUTPUT_CONTROL_CONTRACT_MISSING', '充电输出接口缺少受控功能契约：' + connector.id, connector.id + '.controlContract');
        }
      });
      contracted.forEach((instance) => {
        const contract = instance.controlContract;
        const location = instance.id + '.controlContract';
        const isOutput = instance.interfaceRole === 'CHARGING_OUTPUT';
        const hasPhysicalCp = !!terminalByKey.get(key(instance.id, 'CP'));
        const expectedPilot = isOutput && hasPhysicalCp ? 'REQUIRED' : 'NOT_APPLICABLE';
        if (contract.schema !== 'EVSE-OUTPUT-CONTROL-CONTRACT/1.0' || contract.lifecycle !== 'APPROVED' ||
            contract.interfaceRole !== instance.interfaceRole || !String(contract.profileId || '') ||
            !String(contract.evidenceStatus || '') || !asArray(contract.evidenceRefs).length) {
          report('ERC-080', 'CONTROL_CONTRACT_HEADER_INVALID', instance.id + ' 的功能契约不完整或未受控。', location);
        }
        const functions = contract.functions || {};
        ['controlPilot', 'pilotMonitor', 'diodeCheck'].forEach((name) => {
          if (functions[name] !== expectedPilot) {
            report('ERC-080', 'PILOT_APPLICABILITY_MISMATCH', instance.id + ':' + name + ' 应为 ' + expectedPilot + '。', location + '.functions.' + name);
          }
        });
        const expectedOutputSafety = isOutput ? 'REQUIRED' : 'NOT_APPLICABLE';
        ['outputPrecheck', 'weldDetection'].forEach((name) => {
          if (functions[name] !== expectedOutputSafety) {
            report('ERC-080', 'OUTPUT_SAFETY_APPLICABILITY_MISMATCH', instance.id + ':' + name + ' 应为 ' + expectedOutputSafety + '。', location + '.functions.' + name);
          }
        });
        if (isOutput) {
          ['precheckThreshold', 'precheckTimeoutMs', 'weldThreshold'].forEach((name) => {
            validateProjectValue('ERC-080', location + '.projectValues', name, contract.projectValues && contract.projectValues[name]);
          });
        }
      });
    });

    run('ERC-081', 'CP激励、监视与车端二极管同网唯一源', () => {
      const pilotUnits = functionalUnits.filter((unit) => unit && unit.type === 'CONTROL_PILOT_INTERFACE');
      outputConnectors.forEach((connector) => {
        const functions = connector.controlContract && connector.controlContract.functions || {};
        const required = functions.controlPilot === 'REQUIRED';
        const matching = unitsFor('CONTROL_PILOT_INTERFACE', connector.id);
        const claimedDevices = instances.filter((instance) => cpDeviceKinds.includes(instance.kind) && instance.protectedConnectorId === connector.id);
        if (!required) {
          if (matching.length || claimedDevices.length) {
            report('ERC-081', 'CP_ASSEMBLY_NOT_APPLICABLE', connector.id + ' 的CP契约为不适用，但模型仍实例化了CP功能单元。', connector.id);
          }
          return;
        }
        if (matching.length !== 1) {
          report('ERC-081', 'CP_FUNCTIONAL_UNIT_CARDINALITY', connector.id + ' 必须且只能引用一个CP功能单元。', connector.id, 'BLOCK', matching.map((unit) => unit.id));
          return;
        }
        const unit = matching[0];
        const unitInstances = asArray(unit.instanceIds).map((id) => instanceById.get(id)).filter(Boolean);
        const byKind = new Map(cpDeviceKinds.map((kind) => [kind, unitInstances.filter((instance) => instance.kind === kind)]));
        if (unit.lifecycle !== 'APPROVED' || unit.failureAction !== 'INHIBIT_ENERGY_TRANSFER' || !String(unit.implementationStatus || '') ||
            !sameIdSet(unit.stateApplicability, ['ALL_OPEN', 'PRECHECK', 'READY', 'ENERGIZED']) ||
            !exactFunctionSet(unit, ['CP_GENERATION', 'CP_MONITORING', 'VEHICLE_DIODE_CHECK'])) {
          report('ERC-081', 'CP_FUNCTIONAL_UNIT_CONTRACT', unit.id + ' 缺少完整CP三功能或失效闭锁契约。', unit.id);
        }
        cpDeviceKinds.forEach((kind) => {
          if ((byKind.get(kind) || []).length !== 1) {
            report('ERC-081', 'CP_DEVICE_CARDINALITY', unit.id + ' 必须且只能包含一个 ' + kind + '。', unit.id + '.instanceIds');
          }
        });
        if (!sameIdSet(claimedDevices.map((instance) => instance.id), unit.instanceIds)) {
          report('ERC-081', 'CP_DEVICE_OWNERSHIP', connector.id + ' 的CP诊断实例与功能单元 instanceIds 不等价。', unit.id + '.instanceIds');
        }
        if (unitInstances.some((instance) => instance.branchId !== unit.branchId || instance.protectedConnectorId !== connector.id)) {
          report('ERC-081', 'CP_DEVICE_SCOPE_MISMATCH', unit.id + ' 的诊断实例引用了其他支路或接口。', unit.id + '.instanceIds');
        }
        const generator = (byKind.get('control-pilot-generator') || [])[0];
        const monitor = (byKind.get('control-pilot-monitor') || [])[0];
        const diode = (byKind.get('vehicle-diode-detector') || [])[0];
        const generatorCp = generator && terminalByKey.get(key(generator.id, 'CP_OUT'));
        const monitorCp = monitor && terminalByKey.get(key(monitor.id, 'CP_SENSE'));
        const diodeCp = diode && terminalByKey.get(key(diode.id, 'CP_SENSE'));
        if (!generatorCp || generatorCp.terminal.direction !== 'out' || generatorCp.terminal.electricalType !== 'controlled-pilot-source' ||
            !monitorCp || monitorCp.terminal.direction !== 'in' || String(monitorCp.terminal.electricalType).indexOf('high-impedance') !== 0 ||
            !diodeCp || diodeCp.terminal.direction !== 'in' || String(diodeCp.terminal.electricalType).indexOf('high-impedance') !== 0) {
          report('ERC-081', 'CP_TERMINAL_ELECTRICAL_ROLE', unit.id + ' 必须由一个受控输出源驱动，并仅由两个高阻输入监视。', unit.id + '.instanceIds');
        }
        const cpEndpoints = [
          [connector.id, 'CP'],
          [generator && generator.id, 'CP_OUT'],
          [monitor && monitor.id, 'CP_SENSE'],
          [diode && diode.id, 'CP_SENSE']
        ];
        if (unit.physicalTransceiverTerminal) cpEndpoints.push([unit.controllerId, unit.physicalTransceiverTerminal]);
        const cpNetIds = cpEndpoints.map((endpoint) => endpoint[0] && oneNetId(endpoint[0], endpoint[1]));
        if (cpNetIds.some((id) => !id) || uniqueNonEmpty(cpNetIds).length !== 1 || unit.physicalCpNetId !== cpNetIds[0]) {
          report('ERC-081', 'CP_PHYSICAL_NET_DIVERGED', connector.id + ' 的CP激励/监视/二极管检测必须共享同一个物理CP网。', unit.id + '.physicalCpNetId', 'BLOCK', cpEndpoints.map((endpoint, index) => ({ endpoint: endpoint.join(':'), netId: cpNetIds[index] })));
        } else {
          const sources = netMembers(cpNetIds[0]).filter((member) => {
            const entry = terminalByKey.get(key(member.instanceId, member.terminalId));
            return entry && entry.terminal.electricalType === 'controlled-pilot-source';
          });
          if (sources.length !== 1 || !generator || sources[0].instanceId !== generator.id || sources[0].terminalId !== 'CP_OUT') {
            report('ERC-081', 'CP_SOURCE_NOT_UNIQUE', connector.id + ' 的物理CP网必须且只能有一个受控激励源。', cpNetIds[0], 'BLOCK', sources);
          }
        }
        if (generator && (!terminalByKey.get(key(generator.id, 'CP_OUT')) || !hasControllerPeer(generator.id, 'PWM_CMD', unit.controllerId))) {
          report('ERC-081', 'CP_GENERATOR_COMMAND_MISSING', generator.id + ' 没有受控PWM命令连接。', generator.id);
        }
        [[monitor, 'CP_VALUE'], [diode, 'DIODE_OK']].forEach((item) => {
          if (item[0] && !hasControllerPeer(item[0].id, item[1], unit.controllerId)) {
            report('ERC-081', 'CP_DIAGNOSTIC_RESULT_MISSING', item[0].id + ':' + item[1] + ' 未返回所属控制器。', item[0].id + ':' + item[1]);
          }
        });
      });
      pilotUnits.forEach((unit) => {
        const connector = instanceById.get(unit.protectedConnectorId);
        if (!connector || !outputConnectors.includes(connector) || !connector.controlContract || connector.controlContract.functions.controlPilot !== 'REQUIRED') {
          report('ERC-081', 'CP_FUNCTIONAL_UNIT_ORPHAN', unit.id + ' 没有精确引用一个需要CP的物理输出接口。', unit.id + '.protectedConnectorId');
        }
      });
    });

    run('ERC-082', '输出预检下游全导体覆盖', () => {
      outputConnectors.forEach((connector) => {
        const required = connector.controlContract && connector.controlContract.functions.outputPrecheck === 'REQUIRED';
        const matching = unitsFor('OUTPUT_SAFETY_DIAGNOSTICS', connector.id);
        if (!required) {
          if (matching.length) report('ERC-082', 'PRECHECK_NOT_APPLICABLE', connector.id + ' 未要求输出预检，但仍引用了诊断单元。', connector.id);
          return;
        }
        if (matching.length !== 1) {
          report('ERC-082', 'OUTPUT_DIAGNOSTIC_CARDINALITY', connector.id + ' 必须且只能有一个输出安全诊断单元。', connector.id);
          return;
        }
        const unit = matching[0];
        const precheck = instanceById.get(unit.precheckInstanceId);
        const conductors = outputConductorIds(connector);
        const expectedEndpoints = conductors.map((terminalId) => ({
          instanceId: connector.id,
          terminalId,
          position: 'CONTACTOR_DOWNSTREAM_CONNECTOR_SIDE'
        }));
        if (!precheck || precheck.kind !== 'output-precheck-monitor' || !asArray(unit.instanceIds).includes(precheck.id)) {
          report('ERC-082', 'PRECHECK_INSTANCE_INVALID', unit.id + ' 缺少受控 output-precheck-monitor 实例。', unit.id + '.precheckInstanceId');
          return;
        }
        if (precheck.branchId !== unit.branchId || precheck.protectedConnectorId !== connector.id ||
            !sameIdSet(precheck.safeIsolationDeviceIds, unit.safeIsolationDeviceIds)) {
          report('ERC-082', 'PRECHECK_SCOPE_DIVERGED', precheck.id + ' 与所属功能单元的分支/接口/隔离器引用不等价。', precheck.id);
        }
        if (!conductors.length || stableText(asArray(unit.monitoredOutputEndpoints).slice().sort((a, b) => String(a.terminalId).localeCompare(String(b.terminalId)))) !== stableText(expectedEndpoints)) {
          report('ERC-082', 'PRECHECK_ENDPOINT_COVERAGE', connector.id + ' 的预检端点必须精确覆盖每一根输出导体。', unit.id + '.monitoredOutputEndpoints', 'BLOCK', { expected: expectedEndpoints, actual: unit.monitoredOutputEndpoints });
        }
        const actualSenseIds = asArray(precheck.terminals)
          .filter((terminal) => terminal && terminal.electricalType === 'high-impedance-voltage-sense')
          .map((terminal) => terminal.id).sort();
        const expectedSenseIds = conductors.map(senseTerminalId).sort();
        if (!sameIdSet(actualSenseIds, expectedSenseIds)) {
          report('ERC-082', 'PRECHECK_SENSE_TERMINAL_SET', precheck.id + ' 的高阻检测端子未全导体覆盖。', precheck.id + '.terminals', 'BLOCK', { expected: expectedSenseIds, actual: actualSenseIds });
        }
        conductors.forEach((conductorId) => {
          const connectorNet = oneNetId(connector.id, conductorId);
          const senseNet = oneNetId(precheck.id, senseTerminalId(conductorId));
          const poleId = poleIdForConductor(conductorId);
          const matchingPoles = asArray(unit.monitoredPoles).filter((pole) => pole && pole.poleId === poleId);
          if (!connectorNet || connectorNet !== senseNet) {
            report('ERC-082', 'PRECHECK_NOT_AT_OUTPUT_ENDPOINT', precheck.id + ':' + senseTerminalId(conductorId) + ' 必须与 ' + connector.id + ':' + conductorId + ' 共享物理网。', precheck.id + ':' + senseTerminalId(conductorId));
          }
          if (matchingPoles.length !== 1) {
            report('ERC-082', 'PRECHECK_ISOLATION_POLE_COVERAGE', conductorId + ' 没有精确一个安全隔离极记录。', unit.id + '.monitoredPoles');
          } else {
            const pole = matchingPoles[0];
            const upstreamNet = oneNetId(pole.deviceId, pole.upstreamTerminalId);
            const downstreamNet = oneNetId(pole.deviceId, pole.downstreamTerminalId);
            if (!outputPathReaches(downstreamNet, connectorNet)) {
              report('ERC-082', 'PRECHECK_ISOLATION_NOT_IN_OUTPUT_PATH', conductorId + ' 的预检点必须位于对应安全隔离器下游。', pole.deviceId + ':' + pole.downstreamTerminalId);
            }
            if (!upstreamNet || upstreamNet === connectorNet || upstreamNet === senseNet) {
              report('ERC-082', 'PRECHECK_UPSTREAM_ALIAS', conductorId + ' 预检点不得与安全隔离器上游端同网。', pole.deviceId + ':' + pole.upstreamTerminalId);
            }
          }
        });
        if (precheck.defaultState !== 'TEST_PATH_ISOLATED' || precheck.evaluationState !== 'MAIN_CONTACTORS_OPEN' ||
            unit.defaultState !== 'TEST_PATH_ISOLATED' || unit.precheckEvaluationState !== 'MAIN_CONTACTORS_OPEN' ||
            unit.failureAction !== 'INHIBIT_ENERGY_TRANSFER' ||
            stableText(precheck.requiredSequence) !== stableText(['MAIN_CONTACTORS_OPEN', 'ENABLE_TEST_PATH', 'EVALUATE_RESULT', 'DISABLE_AND_ISOLATE_TEST_PATH'])) {
          report('ERC-082', 'PRECHECK_SAFE_SEQUENCE_INVALID', unit.id + ' 预检必须在主接触器断开时执行，且测试通路默认隔离。', unit.id);
        }
        if (!hasControllerPeer(precheck.id, 'TEST_ENABLE', unit.controllerId) || !hasControllerPeer(precheck.id, 'TEST_RESULT', unit.controllerId) ||
            oneNetId(precheck.id, 'TEST_ENABLE') === oneNetId(precheck.id, 'TEST_RESULT')) {
          report('ERC-082', 'PRECHECK_CONTROL_RESULT_INVALID', precheck.id + ' 的测试使能和结果必须独立连接所属控制器。', precheck.id);
        }
      });
    });

    run('ERC-083', '安全接触器反馈与逐极粘连监测', () => {
      outputConnectors.forEach((connector) => {
        const required = connector.controlContract && connector.controlContract.functions.weldDetection === 'REQUIRED';
        const matching = unitsFor('OUTPUT_SAFETY_DIAGNOSTICS', connector.id);
        if (!required || matching.length !== 1) return;
        const unit = matching[0];
        const monitor = instanceById.get(unit.stateMonitorInstanceId);
        const conductors = outputConductorIds(connector);
        const safeIds = sortedUnique(unit.safeIsolationDeviceIds);
        const poles = asArray(unit.monitoredPoles);
        if (!monitor || monitor.kind !== 'contactor-state-monitor' || !asArray(unit.instanceIds).includes(monitor.id)) {
          report('ERC-083', 'WELD_MONITOR_INSTANCE_INVALID', unit.id + ' 缺少受控 contactor-state-monitor 实例。', unit.id + '.stateMonitorInstanceId');
          return;
        }
        if (monitor.branchId !== unit.branchId || monitor.protectedConnectorId !== connector.id ||
            !sameIdSet(monitor.safeIsolationDeviceIds, unit.safeIsolationDeviceIds)) {
          report('ERC-083', 'WELD_MONITOR_SCOPE_DIVERGED', monitor.id + ' 与所属功能单元的分支/接口/隔离器引用不等价。', monitor.id);
        }
        if (!safeIds.length || safeIds.some((id) => {
          const device = instanceById.get(id);
          return !device || device.requiredForSafeIsolation !== true;
        })) {
          report('ERC-083', 'SAFE_ISOLATION_REFERENCE_INVALID', unit.id + ' 的安全隔离器引用缺失或未声明 requiredForSafeIsolation。', unit.id + '.safeIsolationDeviceIds');
        }
        if (!sameIdSet(poles.map((pole) => pole && pole.deviceId), safeIds)) {
          report('ERC-083', 'SAFE_ISOLATION_POLE_DEVICE_COVERAGE', unit.id + ' 的逐极监测未覆盖全部安全隔离器。', unit.id + '.monitoredPoles');
        }
        const expectedPoleIds = conductors.map(poleIdForConductor).sort();
        const actualPoleIds = poles.map((pole) => pole && pole.poleId).filter(Boolean).sort();
        if (!sameIdSet(actualPoleIds, expectedPoleIds) || actualPoleIds.length !== expectedPoleIds.length) {
          report('ERC-083', 'WELD_POLE_COVERAGE', connector.id + ' 的粘连监测必须逐极精确覆盖全部输出导体。', unit.id + '.monitoredPoles', 'BLOCK', { expected: expectedPoleIds, actual: actualPoleIds });
        }
        if (stableText(asArray(monitor.monitoredPoles)) !== stableText(poles) || monitor.evaluationState !== 'CONTACTORS_COMMAND_OPEN' ||
            unit.weldEvaluationState !== 'CONTACTORS_COMMAND_OPEN' || unit.failureAction !== 'INHIBIT_ENERGY_TRANSFER') {
          report('ERC-083', 'WELD_MONITOR_CONTRACT_DIVERGED', monitor.id + ' 与所属功能单元的监测极/断开状态/故障动作契约不等价。', monitor.id + '.monitoredPoles');
        }
        poles.forEach((pole, index) => {
          if (!pole) return;
          const device = instanceById.get(pole.deviceId);
          const conductorId = String(pole.poleId).startsWith('DC_') ? pole.poleId : 'AC_' + pole.poleId;
          const connectorNet = oneNetId(connector.id, conductorId);
          const monitorNet = oneNetId(monitor.id, senseTerminalId(conductorId));
          const upstreamNet = oneNetId(pole.deviceId, pole.upstreamTerminalId);
          const downstreamNet = oneNetId(pole.deviceId, pole.downstreamTerminalId);
          const feedbackEntry = terminalByKey.get(key(pole.deviceId, pole.feedbackTerminalId));
          const location = unit.id + '.monitoredPoles[' + index + ']';
          if (!device || !terminalByKey.get(key(pole.deviceId, pole.upstreamTerminalId)) ||
              !terminalByKey.get(key(pole.deviceId, pole.downstreamTerminalId)) || !feedbackEntry) {
            report('ERC-083', 'WELD_POLE_ENDPOINT_INVALID', pole.deviceId + ':' + pole.poleId + ' 引用了不存在的主触点或反馈端子。', location);
            return;
          }
          const expectedUpstream = device.kind === 'ac-contactor' ? 'IN_' + pole.poleId : 'IN';
          const expectedDownstream = device.kind === 'ac-contactor' ? 'OUT_' + pole.poleId : 'OUT';
          const devicePoleValid = device.kind === 'ac-contactor'
            ? String(device.poleId || '').indexOf('MECHANICALLY_LINKED') >= 0
            : device.poleId === pole.poleId;
          if (!devicePoleValid || pole.upstreamTerminalId !== expectedUpstream || pole.downstreamTerminalId !== expectedDownstream || pole.feedbackTerminalId !== 'FEEDBACK') {
            report('ERC-083', 'WELD_POLE_MAPPING_DIVERGED', pole.deviceId + ':' + pole.poleId + ' 与隔离器实际极/上下游/机械反馈端子不等价。', location);
          }
          if (!connectorNet || connectorNet !== monitorNet) {
            report('ERC-083', 'WELD_SENSE_NOT_AT_OUTPUT', monitor.id + ':' + senseTerminalId(conductorId) + ' 必须在对应输出导体物理网上监测。', monitor.id + ':' + senseTerminalId(conductorId));
          }
          if (!upstreamNet || !downstreamNet || upstreamNet === downstreamNet ||
              upstreamNet === connectorNet || !outputPathReaches(downstreamNet, connectorNet) || monitorNet === upstreamNet) {
            report('ERC-083', 'WELD_POLE_NOT_DOWNSTREAM', pole.deviceId + ':' + pole.poleId + ' 的输出检测点不得与主触点上游端混同。', location);
          }
          if (feedbackEntry.terminal.electricalType !== 'mechanically-linked-auxiliary-feedback') {
            report('ERC-083', 'CONTACTOR_FEEDBACK_NOT_MECHANICALLY_LINKED', pole.deviceId + ':' + pole.feedbackTerminalId + ' 必须是机械联动辅助反馈。', location);
          }
          const feedbackNet = oneNetId(pole.deviceId, pole.feedbackTerminalId);
          if (!feedbackNet || !netHasInstance(feedbackNet, unit.controllerId)) {
            report('ERC-083', 'CONTACTOR_FEEDBACK_CONTROLLER_MISSING', pole.deviceId + ':' + pole.feedbackTerminalId + ' 未独立返回所属控制器。', pole.deviceId + ':' + pole.feedbackTerminalId);
          } else if (netMembers(feedbackNet).some((member) => /^COIL_/.test(String(member.terminalId)))) {
            report('ERC-083', 'CONTACTOR_FEEDBACK_COIL_ALIAS', pole.deviceId + ' 的反馈不得与线圈命令同网。', feedbackNet);
          }
        });
        safeIds.forEach((deviceId) => {
          const devicePoles = poles.filter((pole) => pole && pole.deviceId === deviceId);
          if (devicePoles.length <= 1) return;
          const groups = sortedUnique(devicePoles.map((pole) => pole.mechanicallyLinkedGroup));
          const device = instanceById.get(deviceId);
          if (groups.length !== 1 || !groups[0] || !device || String(device.poleId || '').indexOf('MECHANICALLY_LINKED') < 0) {
            report('ERC-083', 'MULTIPOLE_FEEDBACK_LINK_UNPROVEN', deviceId + ' 复用一路反馈覆盖多极时，必须精确声明同一机械联动组。', unit.id + '.monitoredPoles');
          }
        });
        if (!hasControllerPeer(monitor.id, 'WELD_STATUS', unit.controllerId)) {
          report('ERC-083', 'WELD_STATUS_CONTROLLER_MISSING', monitor.id + ':WELD_STATUS 未返回所属控制器。', monitor.id + ':WELD_STATUS');
        }
      });
    });

    run('ERC-084', '输出安全状态机防旁路与未解析值闭锁', () => {
      const machine = topology.safetyStateMachine;
      if (!outputConnectors.length) return;
      if (!machine || typeof machine !== 'object') {
        report('ERC-084', 'SAFETY_STATE_MACHINE_MISSING', '存在充电输出，但缺少受控安全状态机。', 'model.topology.safetyStateMachine');
        return;
      }
      const states = asArray(machine.states);
      const transitions = asArray(machine.transitions);
      const branches = asArray(machine.branches);
      const settings = asArray(machine.projectSettings);
      const stateById = new Map();
      const transitionIds = new Set();
      states.forEach((state, index) => {
        if (!state || !state.id || stateById.has(state.id)) {
          report('ERC-084', 'SAFETY_STATE_ID_INVALID', '安全状态 id 缺失或重复。', 'model.topology.safetyStateMachine.states[' + index + ']');
        } else stateById.set(state.id, state);
      });
      transitions.forEach((transition, index) => {
        if (!transition || !transition.id || transitionIds.has(transition.id)) {
          report('ERC-084', 'SAFETY_TRANSITION_ID_INVALID', '安全迁移 id 缺失或重复。', 'model.topology.safetyStateMachine.transitions[' + index + ']');
        } else transitionIds.add(transition.id);
        if (transition && transition.from !== '*' && !stateById.has(transition.from)) {
          report('ERC-084', 'SAFETY_TRANSITION_STATE_UNKNOWN', transition.id + ' 引用不存在的源状态。', transition.id + '.from');
        }
        if (transition && !stateById.has(transition.to)) {
          report('ERC-084', 'SAFETY_TRANSITION_STATE_UNKNOWN', transition.id + ' 引用不存在的目标状态。', transition.id + '.to');
        }
      });
      const requiredStates = ['ALL_OPEN', 'PRECHECK', 'READY', 'ENERGIZED', 'FAULT_ALL_OPEN'];
      requiredStates.forEach((id) => {
        if (!stateById.has(id)) report('ERC-084', 'SAFETY_STATE_MISSING', '安全状态机缺少 ' + id + '。', 'model.topology.safetyStateMachine.states');
      });
      if (machine.schema !== 'EVSE-SAFETY-STATE/1.0' || !String(machine.status || '') || machine.defaultState !== 'ALL_OPEN' || machine.faultState !== 'FAULT_ALL_OPEN' ||
          (stateById.get('ALL_OPEN') || {}).contactorCommand !== 'OPEN' || (stateById.get('FAULT_ALL_OPEN') || {}).contactorCommand !== 'OPEN') {
        report('ERC-084', 'SAFETY_DEFAULT_FAULT_NOT_OPEN', '状态机默认与故障状态必须是全断开。', 'model.topology.safetyStateMachine');
      }
      states.forEach((state) => {
        if (!state) return;
        if ((state.id === 'ENERGIZED') !== (state.contactorCommand === 'CLOSED')) {
          report('ERC-084', 'CLOSED_STATE_ALIAS', '只有 ENERGIZED 状态允许接触器命令为 CLOSED。', state.id);
        }
      });
      const precheckState = stateById.get('PRECHECK');
      const readyState = stateById.get('READY');
      if (!precheckState || precheckState.contactorCommand !== 'OPEN' || !asArray(precheckState.activeFunctions).includes('OUTPUT_PREENERGIZATION_CHECK')) {
        report('ERC-084', 'PRECHECK_STATE_BYPASS', 'PRECHECK 状态必须保持接触器断开并激活输出预检。', 'PRECHECK');
      }
      if (!readyState || readyState.contactorCommand !== 'OPEN' || !asArray(readyState.activeFunctions).includes('CONTACTOR_STATE_MONITORING')) {
        report('ERC-084', 'READY_STATE_BYPASS', 'READY 状态必须保持接触器断开并激活接触器状态监测。', 'READY');
      }
      const diagnosticUnits = functionalUnits.filter((unit) => unit && unit.type === 'OUTPUT_SAFETY_DIAGNOSTICS');
      const expectedSafeIds = sortedUnique(diagnosticUnits.flatMap((unit) => asArray(unit.safeIsolationDeviceIds)));
      const branchConnectorIds = branches.map((branch) => branch && branch.connectorId).filter(Boolean);
      if (!sameIdSet(branchConnectorIds, outputConnectors.map((connector) => connector.id)) || branchConnectorIds.length !== outputConnectors.length) {
        report('ERC-084', 'SAFETY_BRANCH_COVERAGE', '状态机分支必须与物理充电输出一对一。', 'model.topology.safetyStateMachine.branches');
      }
      branches.forEach((branch, index) => {
        if (!branch) return;
        const connector = instanceById.get(branch.connectorId);
        const diagnostics = unitsFor('OUTPUT_SAFETY_DIAGNOSTICS', branch.connectorId);
        const pilots = unitsFor('CONTROL_PILOT_INTERFACE', branch.connectorId);
        const cpRequired = !!(connector && connector.controlContract && connector.controlContract.functions.controlPilot === 'REQUIRED');
        if (!connector || diagnostics.length !== 1 || branch.outputDiagnosticFunctionalUnitId !== diagnostics[0].id ||
            branch.branchId !== diagnostics[0].branchId || !sameIdSet(branch.safeIsolationDeviceIds, diagnostics[0].safeIsolationDeviceIds) ||
            branch.controlPilotRequired !== cpRequired || (cpRequired ? (pilots.length !== 1 || branch.controlPilotFunctionalUnitId !== pilots[0].id) : branch.controlPilotFunctionalUnitId !== null)) {
          report('ERC-084', 'SAFETY_BRANCH_REFERENCE_DIVERGED', '状态机分支与接口/诊断/隔离器/CP契约不等价。', 'model.topology.safetyStateMachine.branches[' + index + ']');
        }
      });
      const toEnergized = transitions.filter((transition) => transition && transition.to === 'ENERGIZED');
      if (toEnergized.length !== 1) {
        report('ERC-084', 'ENERGIZE_TRANSITION_CARDINALITY', '状态机必须且只能有一条进入 ENERGIZED 的迁移。', 'model.topology.safetyStateMachine.transitions');
      }
      toEnergized.forEach((transition) => {
        const guards = new Map(asArray(transition.guards).map((guard) => [guard && guard.type, guard && guard.expected]));
        const closed = asArray(transition.actions).filter((action) => action && action.type === 'COMMAND_CONTACTOR_CLOSED').map((action) => action.deviceId);
        if (transition.from !== 'READY' || guards.get('CONTACTOR_OPEN_FEEDBACK_VALID') !== true || guards.get('INTERFACE_PERMISSION_VALID') !== true ||
            !sameIdSet(closed, expectedSafeIds) || closed.length !== expectedSafeIds.length) {
          report('ERC-084', 'ENERGIZE_GUARD_OR_ACTION_BYPASS', '进入 ENERGIZED 必须来自 READY，同时通过断开反馈与接口许可，并精确闭合全部安全隔离器。', transition.id);
        }
      });
      transitions.forEach((transition) => {
        if (!transition || transition.to === 'ENERGIZED') return;
        if (asArray(transition.actions).some((action) => action && action.type === 'COMMAND_CONTACTOR_CLOSED')) {
          report('ERC-084', 'CONTACTOR_CLOSE_OUTSIDE_ENERGIZE', transition.id + ' 在非 ENERGIZED 迁移中包含闭合命令。', transition.id);
        }
      });
      const openPrecheck = transitions.filter((transition) => transition && transition.to === 'PRECHECK');
      if (openPrecheck.length !== 1 || openPrecheck[0].from !== 'ALL_OPEN') {
        report('ERC-084', 'OPEN_PRECHECK_TRANSITION_CARDINALITY', '进入 PRECHECK 必须且只能来自 ALL_OPEN。', 'model.topology.safetyStateMachine.transitions');
      } else {
        const guard = asArray(openPrecheck[0].guards).find((item) => item && item.type === 'OUTPUT_DEENERGIZED');
        const actions = asArray(openPrecheck[0].actions).map((action) => action && action.type);
        if (!guard || guard.expected !== true || !actions.includes('ENABLE_OUTPUT_PRECHECK')) {
          report('ERC-084', 'OPEN_PRECHECK_GUARD_BYPASS', 'ALL_OPEN→PRECHECK 必须确认输出无电并启用受控预检通路。', openPrecheck[0].id);
        }
      }
      const precheckReady = transitions.filter((transition) => transition && transition.to === 'READY');
      if (precheckReady.length !== 1 || precheckReady[0].from !== 'PRECHECK') {
        report('ERC-084', 'PRECHECK_READY_TRANSITION_CARDINALITY', '进入 READY 必须且只能来自 PRECHECK。', 'model.topology.safetyStateMachine.transitions');
      } else {
        const guards = new Map(asArray(precheckReady[0].guards).map((guard) => [guard && guard.type, guard && guard.expected]));
        const actions = asArray(precheckReady[0].actions).map((action) => action && action.type);
        if (guards.get('ALL_APPLICABLE_PRECHECKS_PASS') !== true || guards.get('TEST_PATH_ISOLATED') !== true || !actions.includes('DISABLE_OUTPUT_PRECHECK')) {
          report('ERC-084', 'PRECHECK_READY_GUARD_BYPASS', 'PRECHECK→READY 必须要求所有适用预检通过且测试通路已隔离。', precheckReady[0].id);
        }
      }
      const faultTransitions = transitions.filter((transition) => transition && transition.from === '*' && transition.to === machine.faultState);
      if (faultTransitions.length !== 1) {
        report('ERC-084', 'FAULT_TRANSITION_CARDINALITY', '必须且只能有一条任意状态到故障全断开的迁移。', 'model.topology.safetyStateMachine.transitions');
      } else {
        const fault = faultTransitions[0];
        const guard = asArray(fault.guards).find((item) => item && item.type === 'SAFETY_FAULT');
        const opened = asArray(fault.actions).filter((action) => action && action.type === 'COMMAND_CONTACTOR_OPEN').map((action) => action.deviceId);
        if (!guard || guard.expected !== true || !sameIdSet(opened, expectedSafeIds) || opened.length !== expectedSafeIds.length) {
          report('ERC-084', 'FAULT_OPEN_ACTION_INCOMPLETE', '安全故障必须精确断开全部安全隔离器。', fault.id);
        }
      }
      const deenergize = transitions.filter((transition) => transition && transition.from === 'ENERGIZED' && transition.to === 'ALL_OPEN');
      if (deenergize.length !== 1) {
        report('ERC-084', 'DEENERGIZE_TRANSITION_CARDINALITY', '必须且只能有一条 ENERGIZED→ALL_OPEN 正常断开迁移。', 'model.topology.safetyStateMachine.transitions');
      } else {
        const opened = asArray(deenergize[0].actions).filter((action) => action && action.type === 'COMMAND_CONTACTOR_OPEN').map((action) => action.deviceId);
        if (!sameIdSet(opened, expectedSafeIds) || opened.length !== expectedSafeIds.length) {
          report('ERC-084', 'DEENERGIZE_OPEN_ACTION_INCOMPLETE', '正常退出充电必须精确断开全部安全隔离器。', deenergize[0].id);
        }
      }
      const settingIds = settings.map((setting) => setting && setting.id).filter(Boolean);
      const requiredSettingIds = ['CONTACTOR_WELD_THRESHOLD', 'OUTPUT_PRECHECK_THRESHOLD', 'OUTPUT_PRECHECK_TIMEOUT'];
      if (!sameIdSet(settingIds, requiredSettingIds) || settingIds.length !== requiredSettingIds.length) {
        report('ERC-084', 'PROJECT_SETTING_COVERAGE', '安全状态机必须精确携带预检阈值、预检时间和粘连判定项目设定。', 'model.topology.safetyStateMachine.projectSettings');
      }
      if (settingIds.length !== sortedUnique(settingIds).length) {
        report('ERC-084', 'PROJECT_SETTING_ID_DUPLICATE', '安全状态机项目设定 id 重复。', 'model.topology.safetyStateMachine.projectSettings');
      }
      settings.forEach((setting, index) => {
        validateProjectValue('ERC-084', 'model.topology.safetyStateMachine.projectSettings[' + index + ']', setting && setting.id || 'UNKNOWN', setting);
      });
      const unresolved = settings.some((setting) => setting && setting.status === 'PROJECT_VALUE_REQUIRED' && setting.value === null);
      if (machine.unresolvedValuesArePass !== false || (unresolved && machine.executionAllowed !== false)) {
        report('ERC-084', 'UNRESOLVED_VALUE_FALSE_PASS', '未解析项目值必须 fail-closed，不得许可状态机执行。', 'model.topology.safetyStateMachine');
      }
    });

    run('ERC-085', '功能单元精确引用与诊断实例唯一归属', () => {
      if (outputConnectors.length && !functionalUnits.length) {
        report('ERC-085', 'FUNCTIONAL_UNITS_MISSING', '存在充电输出，但 topology.functionalUnits 为空。', 'model.topology.functionalUnits');
        return;
      }
      const unitIds = new Set();
      const ownership = new Map();
      const circuitOwnership = new Map();
      functionalUnits.forEach((unit, index) => {
        const location = 'model.topology.functionalUnits[' + index + ']';
        if (!unit || !unit.id || unitIds.has(unit.id)) {
          report('ERC-085', 'FUNCTIONAL_UNIT_ID_INVALID', '功能单元 id 缺失或重复。', location);
          return;
        }
        unitIds.add(unit.id);
        const instanceIds = asArray(unit.instanceIds);
        const netIds = asArray(unit.netIds);
        const circuitIds = asArray(unit.circuitIds);
        if (unit.lifecycle !== 'APPROVED' || !String(unit.implementationStatus || '') || !String(unit.branchId || '') ||
            !instanceById.has(unit.protectedConnectorId) || !instanceById.has(unit.controllerId)) {
          report('ERC-085', 'FUNCTIONAL_UNIT_HEADER_INVALID', unit.id + ' 缺少受控生命周期/分支/接口/控制器引用。', location);
        }
        [
          ['instanceIds', instanceIds],
          ['netIds', netIds],
          ['circuitIds', circuitIds]
        ].forEach((entry) => {
          if (!entry[1].length || sortedUnique(entry[1]).length !== entry[1].length) {
            report('ERC-085', 'FUNCTIONAL_UNIT_REFERENCE_SET_INVALID', unit.id + '.' + entry[0] + ' 为空或含重复引用。', location + '.' + entry[0]);
          }
        });
        instanceIds.forEach((id) => {
          const instance = instanceById.get(id);
          if (!instance) {
            report('ERC-085', 'FUNCTIONAL_UNIT_INSTANCE_UNKNOWN', unit.id + ' 引用不存在的实例：' + id, location + '.instanceIds');
            return;
          }
          ownership.set(id, (ownership.get(id) || []).concat(unit.id));
          if (diagnosticDeviceKinds.includes(instance.kind) && (instance.branchId !== unit.branchId || instance.protectedConnectorId !== unit.protectedConnectorId)) {
            report('ERC-085', 'FUNCTIONAL_UNIT_INSTANCE_SCOPE', id + ' 的 branchId/protectedConnectorId 与所属功能单元不等价。', id);
          }
        });
        netIds.forEach((id) => {
          if (!netById.has(id)) report('ERC-085', 'FUNCTIONAL_UNIT_NET_UNKNOWN', unit.id + ' 引用不存在的网络：' + id, location + '.netIds');
        });
        circuitIds.forEach((id) => {
          const circuit = circuitById.get(id);
          if (!circuit) {
            report('ERC-085', 'FUNCTIONAL_UNIT_CIRCUIT_UNKNOWN', unit.id + ' 引用不存在的回路：' + id, location + '.circuitIds');
          } else if (!netIds.includes(circuit.netId)) {
            report('ERC-085', 'FUNCTIONAL_UNIT_CIRCUIT_NET_OMITTED', unit.id + ' 的回路 ' + id + ' 所属网络未列入 netIds。', location + '.netIds');
          } else {
            circuitOwnership.set(id, (circuitOwnership.get(id) || []).concat(unit.id));
            const boundaryOnly = [unit.protectedConnectorId, unit.controllerId].includes(circuit.from) &&
              [unit.protectedConnectorId, unit.controllerId].includes(circuit.to);
            if (!instanceIds.includes(circuit.from) && !instanceIds.includes(circuit.to) && !boundaryOnly) {
              report('ERC-085', 'FUNCTIONAL_UNIT_CIRCUIT_SCOPE_INVALID', unit.id + ' 引用了不经过所属功能实例的回路：' + id, location + '.circuitIds');
            }
          }
        });
        netIds.forEach((id) => {
          if (netById.has(id) && !circuitIds.some((circuitId) => (circuitById.get(circuitId) || {}).netId === id)) {
            report('ERC-085', 'FUNCTIONAL_UNIT_NET_WITHOUT_CIRCUIT', unit.id + ' 的网络 ' + id + ' 没有对应回路引用。', location + '.netIds');
          }
        });
        instanceIds.forEach((id) => {
          const instance = instanceById.get(id);
          if (!instance) return;
          circuits.forEach((circuit) => {
            const endpointPort = circuit.from === id ? circuit.fromPort : (circuit.to === id ? circuit.toPort : null);
            if (endpointPort && !/^PWR_/.test(String(endpointPort)) && !circuitIds.includes(circuit.id)) {
              report('ERC-085', 'FUNCTIONAL_UNIT_CIRCUIT_OMITTED', unit.id + ' 未引用所属诊断实例的功能回路：' + circuit.id, location + '.circuitIds');
            }
          });
        });
        if (unit.type === 'CONTROL_PILOT_INTERFACE' && (!unit.physicalCpNetId || !netIds.includes(unit.physicalCpNetId))) {
          report('ERC-085', 'FUNCTIONAL_UNIT_CP_NET_OMITTED', unit.id + ' 未在 netIds 精确引用 physicalCpNetId。', location + '.physicalCpNetId');
        }
        if (unit.type === 'OUTPUT_SAFETY_DIAGNOSTICS') {
          if (!exactFunctionSet(unit, ['OUTPUT_PREENERGIZATION_CHECK', 'CONTACTOR_STATE_MONITORING']) ||
              !sameIdSet(instanceIds, [unit.precheckInstanceId, unit.stateMonitorInstanceId]) ||
              asArray(unit.safeIsolationDeviceIds).some((id) => !instanceById.has(id))) {
            report('ERC-085', 'OUTPUT_FUNCTIONAL_UNIT_REFERENCES_INVALID', unit.id + ' 的两类诊断实例或安全隔离器引用不精确。', location);
          }
        }
      });
      instances.filter((instance) => diagnosticDeviceKinds.includes(instance.kind)).forEach((instance) => {
        const owners = ownership.get(instance.id) || [];
        if (owners.length !== 1) {
          report('ERC-085', 'DIAGNOSTIC_INSTANCE_OWNERSHIP', instance.id + ' 必须且只能归属一个功能单元。', instance.id, 'BLOCK', owners);
        }
      });
      circuitOwnership.forEach((owners, circuitId) => {
        if (owners.length !== 1) {
          report('ERC-085', 'FUNCTIONAL_UNIT_CIRCUIT_OWNERSHIP', circuitId + ' 必须且只能由一个功能单元精确拥有。', circuitId, 'BLOCK', owners);
        }
      });
    });

    let loopIntegrity = null;
    run('ERC-086', '同源回流与保护接地完整性', () => {
      const auditor = window.EVSE_LOOP_INTEGRITY;
      if (!auditor || typeof auditor.audit !== 'function') {
        report('ERC-086', 'LOOP_AUDITOR_MISSING', '回路完整性模块未加载。', 'loopIntegrity');
        return;
      }
      loopIntegrity = auditor.audit(model);
      loopIntegrity.records.filter((item) => item.status !== 'PASS').forEach((item) => {
        report('ERC-086', item.status === 'NOT_EVALUATED'
          ? 'PROJECT_VALUE_NOT_EVALUATED' : item.family + ':' + item.code,
        item.detail, item.deviceId, item.status === 'NOT_EVALUATED' ? 'WARN' : 'BLOCK', [item]);
      });
    });

    const blockingCount = violations.filter((item) => item.severity === 'BLOCK').length;
    const warningCount = violations.filter((item) => item.severity === 'WARN').length;
    return {
      id: 'EVSE-ERC',
      version: VERSION,
      status: blockingCount ? 'BLOCKED' : 'PASS',
      blockingCount,
      warningCount,
      loopIntegrity,
      checks,
      violations,
      stats: {
        instanceCount: instances.length,
        terminalCount: terminalByKey.size,
        netCount: nets.length,
        circuitCount: circuits.length
      }
    };
  }

  function assertValid(model) {
    const result = validate(model);
    if (result.blockingCount) {
      const error = new Error('EVSE ERC blocked the model with ' + result.blockingCount + ' violation(s).');
      error.code = 'EVSE_ERC_BLOCKED';
      error.result = result;
      throw error;
    }
    return result;
  }

  return { VERSION, validate, assertValid };
})();
