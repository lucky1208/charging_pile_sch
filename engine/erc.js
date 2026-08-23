/* ============================================================
 * EVSE electrical-rule checker (ERC) v1
 * ------------------------------------------------------------
 * Pure, deterministic checks for EDEM v4.  The checker operates on exact
 * instance/terminal references.  It never repairs, guesses or aliases an
 * electrical connection.
 * ============================================================ */
window.EVSE_ERC = (function () {
  'use strict';

  const VERSION = '1.1.0';
  const KNOWN_NET_CLASSES = Object.freeze([
    'POWER_AC', 'POWER_DC', 'POWER_DC_ESS', 'POWER_DC_AUX',
    'PROTECTIVE_EARTH', 'SIGNAL_CTRL', 'SIGNAL_COMM'
  ]);
  const CONNECTOR_PROFILES = Object.freeze({
    'gbt-dc': Object.freeze({ standardId: 'gb', signals: Object.freeze({ CC1: 'CC1', CC2: 'CC2', S_POS: 'GB_CAN:P', S_NEG: 'GB_CAN:N' }) }),
    ccs2: Object.freeze({ standardId: 'eu', signals: Object.freeze({ CP: 'CP', PP: 'PP' }) }),
    ccs1: Object.freeze({ standardId: 'us', signals: Object.freeze({ CP: 'CP', PP: 'PP' }) })
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
      checks.push({ ruleId, title, status: count ? 'FAIL' : 'PASS', violationCount: count });
    }

    const instanceById = new Map();
    const terminalByKey = new Map();
    const netById = new Map();
    const membership = new Map();
    const circuitById = new Map();
    const catalog = window.EVSE_DEVICE_CATALOG;

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
        ['physicalTerminals', 'ports'].forEach((alias) => {
          if (!Array.isArray(instance[alias]) || stableText(terminalShape(instance[alias])) !== stableText(terminalShape(terminals))) {
            report('ERC-001', 'TERMINAL_ALIAS_DIVERGED', instance.id + ':' + alias + ' 与 terminals 不等价。', location + '.' + alias);
          }
        });
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
        (Array.isArray(instance.functionalPorts) ? instance.functionalPorts : []).forEach((port, portIndex) => {
          (Array.isArray(port.physicalTerminalIds) ? port.physicalTerminalIds : []).forEach((terminalId) => {
            functionalIds.push(terminalId);
            const terminal = terminals.find((item) => item.id === terminalId);
            if (!terminal) report('ERC-001', 'FUNCTIONAL_PORT_UNKNOWN_TERMINAL', '功能端口引用不存在的物理端子：' + key(instance.id, terminalId), location + '.functionalPorts[' + portIndex + ']');
            else if (terminal.netClass !== port.netClass || terminal.domain !== port.domain) report('ERC-001', 'FUNCTIONAL_PORT_SEMANTICS_MISMATCH', '功能端口与物理端子电气语义不一致：' + key(instance.id, terminalId), location + '.functionalPorts[' + portIndex + ']');
          });
        });
        const functionalCounts = new Map();
        functionalIds.forEach((id) => functionalCounts.set(id, (functionalCounts.get(id) || 0) + 1));
        terminals.forEach((terminal) => {
          if (functionalCounts.get(terminal.id) !== 1) report('ERC-001', 'FUNCTIONAL_PORT_COVERAGE', '每个物理端子必须且只能属于一个功能端口：' + key(instance.id, terminal.id), location + '.functionalPorts');
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
        if (net.netClass === 'POWER_AC') {
          if (net.domain !== 'AC_MAINS') report('ERC-010', 'AC_DOMAIN_INVALID', '交流网络必须属于 AC_MAINS：' + net.id, location + '.domain');
          if (!['L1', 'L2', 'L3', 'N'].includes(net.phase)) report('ERC-010', 'PHASE_REQUIRED', '交流导体必须显式声明 L1/L2/L3/N：' + net.id, location + '.phase');
        }
        if (net.netClass === 'POWER_DC' || net.netClass === 'POWER_DC_ESS') {
          const expectedDomain = net.netClass === 'POWER_DC_ESS' ? 'HV_DC_ESS' : 'HV_DC_CHARGE';
          if (net.domain !== expectedDomain) report('ERC-010', 'DC_DOMAIN_INVALID', '直流网络域与类别不一致：' + net.id, location + '.domain');
          if (!['POSITIVE', 'NEGATIVE'].includes(net.polarity)) report('ERC-010', 'POLARITY_REQUIRED', '高压直流导体必须显式声明正/负极：' + net.id, location + '.polarity');
          if (!finite(netVoltage(net)) || netVoltage(net) <= 0) report('ERC-010', 'DC_VOLTAGE_REQUIRED', '高压直流网络必须声明正的额定电压：' + net.id, location);
        }
        if (net.netClass === 'POWER_DC_AUX' && /^AUX_(12|24)V$/.test(String(net.domain))) {
          const domainVoltage = Number(String(net.domain).match(/^AUX_(12|24)V$/)[1]);
          if (!['POSITIVE', 'RETURN'].includes(net.polarity)) report('ERC-010', 'AUX_POLARITY_REQUIRED', '辅助电源必须明确正极或该电压域回路：' + net.id, location + '.polarity');
          const expectedVoltage = net.polarity === 'RETURN' ? 0 : domainVoltage;
          if (!finite(net.nominalVoltageV) || Math.abs(net.nominalVoltageV - expectedVoltage) > 0.01 || net.referenceVoltageV !== domainVoltage) {
            report('ERC-010', 'AUX_VOLTAGE_DOMAIN_INVALID', '辅助网络电压与电压域不一致：' + net.id, location);
          }
        }
        if (net.netClass === 'POWER_DC_AUX' && !/^AUX_(12|24)V$/.test(String(net.domain)) && net.domain !== 'CONNECTOR_AUX') {
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
          if (!match || terminal.phase !== match[1] || terminal.domain !== 'AC_MAINS') report('ERC-015', 'TERMINAL_PHASE_IDENTITY', '交流物理端子名称、相别和电气域不一致：' + endpointKey, endpointKey);
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
        const auxMatch = id.match(/(?:^|_)(V12|V24)(?:(_0V))?$/);
        if (auxMatch) {
          const voltage = Number(auxMatch[1].slice(1));
          const isReturn = !!auxMatch[2];
          if (terminal.netClass !== 'POWER_DC_AUX' || terminal.domain !== 'AUX_' + voltage + 'V' || terminal.polarity !== (isReturn ? 'RETURN' : 'POSITIVE') || terminal.voltageV !== (isReturn ? 0 : voltage) || (isReturn && terminal.referenceVoltageV !== voltage)) {
            report('ERC-015', 'AUX_TERMINAL_IDENTITY', '辅助物理端子名称与 12V/24V 电压域或回路极性不一致：' + endpointKey, endpointKey);
          }
        }
        if (terminal.netClass === 'SIGNAL_COMM' && (!terminal.protocol || !terminal.signalRole)) report('ERC-015', 'COMM_TERMINAL_SEMANTICS_REQUIRED', '通信物理端子必须声明协议与导体角色：' + endpointKey, endpointKey);
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
        const phases = uniqueNonEmpty(endpoints.map((entry) => entry.terminal.phase));
        if (phases.length > 1) report('ERC-020', 'MIXED_PHASE', '网络 ' + net.id + ' 混接相别：' + phases.join(', '), 'nets[' + netIndex + ']');
        const protocols = uniqueNonEmpty([net.protocol].concat(endpoints.map((entry) => entry.terminal.protocol)));
        if (protocols.length > 1) report('ERC-020', 'PROTOCOL_MISMATCH', '网络 ' + net.id + ' 混接协议：' + protocols.join(' | '), 'nets[' + netIndex + ']');
        const signalRoles = uniqueNonEmpty([net.signalRole].concat(endpoints.map((entry) => entry.terminal.signalRole)));
        if (signalRoles.length > 1) report('ERC-020', 'SIGNAL_ROLE_MISMATCH', '网络 ' + net.id + ' 混接差分线/接口角色：' + signalRoles.join(' | '), 'nets[' + netIndex + ']');
        const hasSource = endpoints.some((entry) => ['out', 'bidirectional'].includes(entry.terminal.direction));
        const hasSink = endpoints.some((entry) => ['in', 'bidirectional'].includes(entry.terminal.direction));
        if (['POWER_AC', 'POWER_DC', 'POWER_DC_ESS', 'POWER_DC_AUX', 'SIGNAL_CTRL', 'SIGNAL_COMM'].includes(net.netClass)) {
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
      instances.filter((instance) => instance.kind === 'charge-connector').forEach((instance) => {
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

    const blockingCount = violations.filter((item) => item.severity === 'BLOCK').length;
    const warningCount = violations.filter((item) => item.severity === 'WARN').length;
    return {
      id: 'EVSE-ERC',
      version: VERSION,
      status: blockingCount ? 'BLOCKED' : 'PASS',
      blockingCount,
      warningCount,
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
