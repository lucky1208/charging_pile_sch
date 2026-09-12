/* ============================================================
 * Auxiliary circuit source/return and declared-PE integrity audit
 * ------------------------------------------------------------
 * Net membership alone does not prove a closed conductor path. This audit
 * follows actual EDEM circuit edges and a small, explicit set of permitted
 * conduction contracts. Positive and return paths must terminate at the
 * same physical supply output pair. Functional 0V is never merged with PE.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_LOOP_INTEGRITY = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.1.0';
  const FAMILIES = Object.freeze({
    'LOOP-001': '辅助负载同源正极与0V',
    'LOOP-002': '线圈正端、驱动器与同源回流',
    'LOOP-003': '辅助母排正负汇流',
    'LOOP-004': '控制器供电回流与输出公共端',
    'LOOP-005': '功率变换设备保护接地',
    'LOOP-006': '辅助电源保护接地'
  });
  const SOURCE_KINDS = new Set([
    'aux-psu', 'hv-aux-converter', 'aux-dc-converter', 'interface-12v-supply'
  ]);
  const CONTROLLER_KINDS = new Set(['charge-controller', 'bms-controller']);
  const POWER_PE_KINDS = new Set(['power-module-array', 'dc-dc-charge-module', 'ess-dcdc', 'ess-pcs']);
  const AUX_PE_KINDS = new Set(['aux-psu', 'hv-aux-converter']);

  function endpointKey(instanceId, terminalId) {
    return String(instanceId) + ':' + String(terminalId);
  }
  function compare(left, right) {
    const a = String(left == null ? '' : left);
    const b = String(right == null ? '' : right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function terminalsOf(instance) {
    return Array.isArray(instance && instance.terminals) ? instance.terminals :
      (Array.isArray(instance && instance.ports) ? instance.ports : []);
  }

  function audit(model) {
    const instances = Array.isArray(model && model.instances) ? model.instances :
      (Array.isArray(model && model.equipment) ? model.equipment : []);
    const circuits = Array.isArray(model && model.circuits) ? model.circuits : [];
    const terminals = new Map();
    const graph = new Map();
    const records = [];
    const unresolvedConduction = new Set();
    const conductionContracts = [];

    function touch(key) { if (!graph.has(key)) graph.set(key, []); }
    function join(left, right, reason) {
      if (!terminals.has(left) || !terminals.has(right)) return false;
      touch(left); touch(right);
      graph.get(left).push(right); graph.get(right).push(left);
      if (reason) conductionContracts.push({ from: left, to: right, reason });
      return true;
    }
    function add(family, status, code, deviceId, detail, evidence) {
      records.push({ family, status, code, deviceId, detail,
        evidence: Array.isArray(evidence) ? evidence : [] });
    }

    instances.forEach((instance) => {
      terminalsOf(instance).forEach((terminal) => {
        const key = endpointKey(instance.id, terminal.id);
        terminals.set(key, terminal); touch(key);
      });
    });
    circuits.forEach((circuit) => join(
      endpointKey(circuit.from, circuit.fromPort),
      endpointKey(circuit.to, circuit.toPort)
    ));

    instances.forEach((instance) => {
      const values = terminalsOf(instance);
      const byId = new Map(values.map((terminal) => [terminal.id, terminal]));
      function internal(leftId, rightId, reason) {
        const left = byId.get(leftId); const right = byId.get(rightId);
        if (!left || !right) return false;
        if (left.netClass !== right.netClass || left.domain !== right.domain || left.polarity !== right.polarity) return false;
        return join(endpointKey(instance.id, leftId), endpointKey(instance.id, rightId), reason);
      }

      if (instance.kind === 'split-interface') {
        values.filter((terminal) => /^IN_V\d+(?:_0V)?$/.test(terminal.id)).forEach((terminal) => {
          internal(terminal.id, terminal.id.replace(/^IN_/, 'OUT_'), 'CONTROLLED_SPLIT_FEEDTHROUGH');
        });
      }
      if (instance.kind === 'safety-device') internal('CONTACT_A', 'CONTACT_B', 'DRY_CONTACT_PERMITTED_CLOSED');
      if (instance.kind === 'control-relay') internal('CONTACT_IN', 'CONTACT_OUT', 'RELAY_CONTACT_PERMITTED_CLOSED');
      if (instance.kind === 'four-pole-safety') ['A', 'B', 'C'].forEach((pole) =>
        internal(pole + '_IN', pole + '_OUT', 'INTERLOCK_CONTACT_PERMITTED_CLOSED'));
      if (instance.kind === 'ac-dc-mode-interlock') {
        const positive = values.filter((terminal) => terminal.netClass === 'POWER_DC_AUX' && terminal.polarity === 'POSITIVE');
        const supply = positive.find((terminal) => /SUPPLY|PWR|IN_/.test(terminal.id));
        if (supply) positive.forEach((terminal) => {
          if (terminal !== supply) internal(supply.id, terminal.id, 'MODE_PERMISSION_CONDUCTION_ONLY');
        });
      }
      values.filter((terminal) => terminal.electricalType === 'open-collector-output').forEach((terminal) => {
        const commons = values.filter((candidate) => candidate.netClass === 'POWER_DC_AUX' &&
          candidate.domain === terminal.domain && candidate.polarity === 'RETURN' &&
          /^(?:PWR|COM|CTRL_PWR)_/.test(candidate.id));
        if (commons.length === 1) internal(terminal.id, commons[0].id, 'ABSTRACT_LOW_SIDE_DRIVER_TO_SUPPLY_RETURN');
        else unresolvedConduction.add(endpointKey(instance.id, terminal.id));
      });
      values.filter((terminal) => terminal.electricalType === 'observed-controller-output')
        .forEach((terminal) => unresolvedConduction.add(endpointKey(instance.id, terminal.id)));
    });

    const sourceAt = new Map();
    instances.filter((instance) => SOURCE_KINDS.has(instance.kind)).forEach((instance) => {
      terminalsOf(instance).filter((terminal) => /^OUT_V\d+$/.test(terminal.id)).forEach((terminal) => {
        const outputId = instance.id + '/' + terminal.id;
        sourceAt.set(endpointKey(instance.id, terminal.id), { id: outputId, pole: 'POSITIVE' });
        const returnKey = endpointKey(instance.id, terminal.id + '_0V');
        if (terminals.has(returnKey)) sourceAt.set(returnKey, { id: outputId, pole: 'RETURN' });
      });
    });

    const reachCache = new Map();
    function reach(start) {
      if (reachCache.has(start)) return reachCache.get(start);
      const seen = new Set(); const stack = [start]; const sources = new Map(); const unknown = [];
      while (stack.length) {
        const current = stack.pop();
        if (seen.has(current)) continue;
        seen.add(current);
        const source = sourceAt.get(current);
        if (source) sources.set(source.id + '|' + source.pole, source);
        if (unresolvedConduction.has(current)) unknown.push(current);
        (graph.get(current) || []).forEach((next) => { if (!seen.has(next)) stack.push(next); });
      }
      const result = {
        sources: Array.from(sources.values()).sort((a, b) => compare(a.id + a.pole, b.id + b.pole)),
        unknown: unknown.sort(compare), members: Array.from(seen).sort(compare)
      };
      seen.forEach((item) => reachCache.set(item, result));
      return result;
    }

    instances.forEach((instance) => {
      const values = terminalsOf(instance);
      const baseFamily = instance.kind === 'aux-busbar' ? 'LOOP-003' :
        CONTROLLER_KINDS.has(instance.kind) ? 'LOOP-004' : 'LOOP-001';
      const positive = values.filter((terminal) => terminal.netClass === 'POWER_DC_AUX' &&
        terminal.polarity === 'POSITIVE' && /^(?:(?:CTRL_)?PWR|IN|BUS\d+|COIL)_V\d+$/.test(terminal.id));
      positive.forEach((terminal) => {
        const family = terminal.id.startsWith('COIL_') ? 'LOOP-002' : baseFamily;
        const paired = values.find((candidate) => candidate.id === terminal.id + '_0V');
        if (terminal.required === false && !(graph.get(endpointKey(instance.id, terminal.id)) || []).length) return;
        if (!paired || paired.polarity !== 'RETURN' || paired.domain !== terminal.domain) {
          add(family, 'BLOCKED', 'RETURN_PAIR_MISSING', instance.id,
            terminal.id + ' 缺少同域0V端子。');
          return;
        }
        const positiveReach = reach(endpointKey(instance.id, terminal.id));
        const returnReach = reach(endpointKey(instance.id, paired.id));
        const positiveSources = positiveReach.sources.filter((item) => item.pole === 'POSITIVE').map((item) => item.id);
        const returnSources = returnReach.sources.filter((item) => item.pole === 'RETURN').map((item) => item.id);
        const evidence = [{ positiveTerminal: terminal.id, returnTerminal: paired.id,
          positiveSources, returnSources }];
        if (positiveReach.sources.some((item) => item.pole === 'RETURN') ||
            returnReach.sources.some((item) => item.pole === 'POSITIVE')) {
          add(family, 'BLOCKED', 'POWER_RETURN_SHORT', instance.id, '正极与回流导体意外连通。', evidence);
        } else if (positiveSources.length === 1 && returnSources.length === 1 && positiveSources[0] === returnSources[0]) {
          add(family, 'PASS', 'SAME_SOURCE_PAIR', instance.id, '正极与回流到达同一物理电源输出对。', evidence);
        } else if (positiveReach.unknown.length || returnReach.unknown.length) {
          add(family, 'NOT_EVALUATED', 'DRIVER_COMMON_UNRESOLVED', instance.id,
            '驱动器内部公共端缺少受控映射，不能证明同源回流。',
            evidence.concat(positiveReach.unknown, returnReach.unknown));
        } else {
          add(family, 'BLOCKED', !positiveSources.length || !returnSources.length
            ? 'SOURCE_OR_RETURN_DISCONNECTED' : 'SOURCE_PAIR_MISMATCH', instance.id,
          '电源缺失、回流断开或正负来自不同物理输出对。', evidence);
        }
      });
      values.filter((terminal) => terminal.electricalType === 'open-collector-output').forEach((terminal) => {
        const result = reach(endpointKey(instance.id, terminal.id));
        const sources = result.sources.filter((item) => item.pole === 'RETURN');
        add('LOOP-004', sources.length === 1 ? 'PASS' : result.unknown.length ? 'NOT_EVALUATED' : 'BLOCKED',
          sources.length === 1 ? 'DRIVER_COMMON_CONNECTED' : result.unknown.length
            ? 'DRIVER_COMMON_UNRESOLVED' : 'DRIVER_COMMON_OPEN', instance.id,
          terminal.id + ' 驱动公共端回流追踪。', sources);
      });
    });

    const earthRoots = new Set(instances.filter((instance) => instance.kind === 'earth-bar')
      .flatMap((instance) => terminalsOf(instance).filter((terminal) => terminal.netClass === 'PROTECTIVE_EARTH')
        .map((terminal) => endpointKey(instance.id, terminal.id))));
    instances.filter((instance) => POWER_PE_KINDS.has(instance.kind) || AUX_PE_KINDS.has(instance.kind))
      .forEach((instance) => {
        const family = POWER_PE_KINDS.has(instance.kind) ? 'LOOP-005' : 'LOOP-006';
        const pe = terminalsOf(instance).find((terminal) => terminal.id === 'PE' && terminal.netClass === 'PROTECTIVE_EARTH');
        const ok = !!pe && reach(endpointKey(instance.id, pe.id)).members.some((item) => earthRoots.has(item));
        add(family, ok ? 'PASS' : 'BLOCKED', ok ? 'PE_CONNECTED' : 'PE_OPEN', instance.id,
          '保护接地须有实际导体通路到PE排；PE不代替工作0V。');
      });

    records.sort((a, b) => compare(a.family, b.family) || compare(a.deviceId, b.deviceId) || compare(a.code, b.code));
    conductionContracts.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.reason, b.reason));
    const families = Object.keys(FAMILIES).map((id) => {
      const items = records.filter((record) => record.family === id);
      return Object.freeze({ id, title: FAMILIES[id], status: items.some((item) => item.status === 'BLOCKED')
        ? 'BLOCKED' : items.some((item) => item.status === 'NOT_EVALUATED')
          ? 'NOT_EVALUATED' : items.length ? 'PASS' : 'NOT_APPLICABLE', checked: items.length });
    });
    return Object.freeze({
      version: VERSION,
      status: records.some((item) => item.status === 'BLOCKED') ? 'BLOCKED' :
        records.some((item) => item.status === 'NOT_EVALUATED') ? 'PARTIAL' : 'PASS',
      blockingCount: records.filter((item) => item.status === 'BLOCKED').length,
      unresolvedCount: records.filter((item) => item.status === 'NOT_EVALUATED').length,
      families: Object.freeze(families), records: Object.freeze(records),
      conductionContracts: Object.freeze(conductionContracts),
      scope: 'AUXILIARY_CIRCUIT_SOURCE_IDENTITY_AND_DECLARED_PE',
      limits: Object.freeze([
        '不把工作0V与PE自动相连。',
        '低边驱动内部导通仅是抽象器件合同，不替代厂家针脚复核。',
        '汇总模块实例不能证明每个物理模块的PE，须由设备展开与厂家资料关闭。',
        '未映射的项目驱动公共端保持NOT_EVALUATED。'
      ])
    });
  }

  return Object.freeze({ VERSION, FAMILIES, audit });
});
