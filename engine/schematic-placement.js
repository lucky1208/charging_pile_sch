/* ============================================================
 * EDEM v4 -> deterministic schematic placement and routing
 * ------------------------------------------------------------
 * This compiler consumes only the engineering design model.  It never
 * reads sizing scalars and never infers or repairs electrical topology.
 * Every rendered route is one exact model circuit, with a declared net
 * and exact physical terminal references.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_SCHEMATIC_PLACEMENT = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.1.0';
  const GRID_SCHEMA = 'EVSE-SCHEMATIC-PLACEMENT/1.1';

  class SchematicCompileError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'SchematicCompileError';
      this.code = code;
      this.details = details || {};
    }
  }

  const SYSTEM_ORDER = Object.freeze({
    ac: 10, power: 20, dc: 30, gun: 40, earth: 50,
    aux: 60, control: 70, safety: 80, thermal: 90, ess: 100
  });

  const KIND_ORDER = Object.freeze({
    'ac-incomer': 10, 'ac-isolator': 20, 'ac-breaker': 30,
    'surge-protector': 35, 'residual-current-monitor': 40,
    'ac-meter': 50, 'ac-contactor': 60, 'ac-busbar': 70,
    'power-module-array': 80, 'dc-fuse': 90, 'current-transducer': 100,
    'dc-meter': 110, 'dc-busbar': 120, 'insulation-monitor': 125,
    'discharge-resistor': 130, 'charge-connector': 190,
    'connector-lock': 200, 'earth-bar': 210, 'aux-psu': 220,
    'aux-busbar': 230, 'charge-controller': 240, 'comm-gateway': 250,
    'hmi-unit': 260, 'safety-device': 270, 'indicator-lamp': 275,
    'environment-sensor': 280, 'thermal-unit': 290,
    'battery-cluster': 300, 'ess-fuse': 310, 'ess-contactor': 320,
    'precharge-contactor': 330, 'precharge-resistor': 340,
    'ess-busbar': 350, 'bms-controller': 360, 'ess-dcdc': 370, 'ess-pcs': 380
  });

  /* A schematic is read by function and electrical flow, not as an
     equipment-kind inventory.  These zones deliberately use only model
     semantics (system, kind and terminal net class); they never infer a
     connection that is absent from EDEM. */
  const ZONE_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'POWER_FLOW', order: 10,
      title: '主功率回路  AC输入 → 保护/计量 → 功率变换 → DC母线 → 充电接口',
      flow: 'AC_IN_TO_EV_OUTPUT' }),
    Object.freeze({ id: 'ESS_RECHARGE', order: 20,
      title: '储能与补电回路  补电接口/电池 → 预充与保护 → ESS母线 → 双向变换',
      flow: 'ENERGY_STORAGE_AND_RECHARGE' }),
    Object.freeze({ id: 'AUXILIARY', order: 30,
      title: '辅助电源与热管理  高压/AC → 24V → 12V → 风机/加热/执行器',
      flow: 'AUXILIARY_POWER' }),
    Object.freeze({ id: 'CONTROL_COMM', order: 40,
      title: '控制、安全与通信  BMS/CCU → 网关/HMI/OCPP → 现场执行与采样',
      flow: 'CONTROL_AND_COMMUNICATION' }),
    Object.freeze({ id: 'PROTECTIVE_EARTH', order: 50,
      title: '保护接地与等电位连接', flow: 'PROTECTIVE_EARTH' })
  ]);
  const ZONE_BY_ID = Object.freeze(Object.fromEntries(ZONE_DEFINITIONS.map((zone) => [zone.id, zone])));

  const SEMANTIC_STAGE = Object.freeze({
    /* main AC -> DC -> vehicle path */
    'ac-incomer': 0, 'ac-isolator': 10, 'ac-breaker': 20,
    'surge-protector': 22, 'residual-current-monitor': 30,
    'ac-meter': 40, 'ac-contactor': 50, 'four-pole-safety': 52,
    'ac-busbar': 60, 'power-module-array': 70, 'ac-ev-transformer': 70,
    'dc-fuse': 80, 'current-transducer': 90, 'dc-meter': 100,
    'dc-busbar': 110, 'insulation-monitor': 112, 'discharge-resistor': 114,
    'split-interface': 120, 'dc-contactor': 130,
    'ac-charge-connector': 145, 'charge-connector': 150, 'connector-lock': 155,
    /* storage / supplementary-charge path */
    'dc-charge-inlet': 0, 'nacs-shared-inlet': 0, 'ac-dc-power-selector': 2,
    'battery-cluster': 5, 'battery-box': 5, 'ess-fuse': 10,
    'ess-contactor': 20, 'precharge-contactor': 22, 'precharge-resistor': 24,
    'heating-connector-2pin': 26, 'ess-busbar': 30,
    'dc-dc-charge-module': 40, 'ess-dcdc': 45, 'ess-pcs': 50,
    /* auxiliary path */
    'hv-aux-converter': 0, 'aux-psu': 0, 'aux-busbar': 10,
    'aux-dc-converter': 20, 'interface-12v-supply': 22,
    'thermal-unit': 30, 'battery-heater': 32, 'loudspeaker': 34,
    /* control / communications */
    'bms-controller': 0, 'charge-controller': 0, 'safety-device': 5,
    'comm-gateway': 10, 'hmi-unit': 20, 'touch-display': 20,
    'card-reader': 22, 'voice-board': 24, 'environment-sensor': 25,
    'temperature-sensor': 26, 'ac-dc-mode-interlock': 27, 'selector-switch-dual': 28,
    'control-relay': 29, 'external-connector-12pin': 30, 'rf-antenna': 32,
    'indicator-lamp': 32, 'earth-bar': 0
  });

  const LAYER_BY_NET_CLASS = Object.freeze({
    POWER_AC: 'EVSE-AC',
    POWER_DC: 'EVSE-DC',
    POWER_DC_ESS: 'EVSE-ESS',
    POWER_INTERFACE_MODED: 'EVSE-ESS',
    POWER_DC_AUX: 'EVSE-AUX',
    SIGNAL_CTRL: 'EVSE-CTL',
    SIGNAL_COMM: 'EVSE-COMM',
    PROTECTIVE_EARTH: 'EVSE-PE'
  });

  function compareText(a, b) {
    const aa = String(a);
    const bb = String(b);
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function stableNumber(value) {
    const source = text(value);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function endpointKey(instanceId, terminalId) {
    return text(instanceId) + ':' + text(terminalId);
  }

  function instanceTerminals(instance) {
    return Array.isArray(instance && instance.terminals)
      ? instance.terminals
      : (Array.isArray(instance && instance.ports) ? instance.ports : []);
  }

  function shortTag(instance) {
    const explicit = text(instance && (instance.tag || instance.designation));
    if (explicit) return explicit;
    const reference = text(instance && (instance.referenceDesignation || instance.ref));
    if (reference) {
      const tokens = reference.split(/[-/]/).filter(Boolean);
      if (tokens.length) return tokens[tokens.length - 1];
    }
    return text(instance && instance.id);
  }

  function sortInstances(instances) {
    return instances.slice().sort((a, b) => {
      const systemA = SYSTEM_ORDER[text(a.system).toLowerCase()] || 500;
      const systemB = SYSTEM_ORDER[text(b.system).toLowerCase()] || 500;
      const kindA = KIND_ORDER[text(a.kind)] || 500;
      const kindB = KIND_ORDER[text(b.kind)] || 500;
      return systemA - systemB || kindA - kindB || compareText(a.id, b.id);
    });
  }

  function terminalNetClasses(instance) {
    return new Set(instanceTerminals(instance).map((terminal) => text(terminal && terminal.netClass).toUpperCase()).filter(Boolean));
  }

  function classifyFunctionalZone(instance) {
    const kind = text(instance && instance.kind).toLowerCase();
    const system = text(instance && instance.system).toLowerCase();
    const classes = terminalNetClasses(instance);
    if (kind === 'earth-bar' || system === 'earth' || system === 'pe') return 'PROTECTIVE_EARTH';
    if (kind === 'battery-heater' || kind === 'loudspeaker') return 'AUXILIARY';
    if (kind === 'touch-display' || kind === 'card-reader' || kind === 'voice-board' || kind === 'rf-antenna' ||
        kind === 'selector-switch-dual' || kind === 'external-connector-12pin' ||
        kind === 'control-relay' || kind === 'temperature-sensor' ||
        kind === 'ac-dc-mode-interlock') return 'CONTROL_COMM';
    if (kind === 'bms-controller') return 'CONTROL_COMM';
    if (kind === 'dc-charge-inlet' || kind === 'nacs-shared-inlet' || kind === 'ac-dc-power-selector' ||
        kind === 'heating-connector-2pin' || kind === 'dc-dc-charge-module' || kind === 'ess-pcs' ||
        kind === 'ess-dcdc' || kind === 'battery-box' || /^ess-/.test(kind) || /^(?:ess|storage|battery)$/.test(system)) return 'ESS_RECHARGE';
    if (kind === 'connector-lock' || kind === 'split-interface' || kind === 'charge-connector' || kind === 'ac-ev-transformer' ||
        kind === 'ac-charge-connector' || /^(?:ac|power|dc|gun|output|terminal|dispenser)$/.test(system)) return 'POWER_FLOW';
    if (kind === 'hv-aux-converter' || kind === 'aux-dc-converter' || kind === 'interface-12v-supply' ||
        kind === 'aux-psu' || kind === 'aux-busbar' || kind === 'thermal-unit' ||
        /^(?:aux|thermal|cooling|heating)$/.test(system)) return 'AUXILIARY';
    if (/^(?:control|comm|communication|safety|hmi)$/.test(system)) return 'CONTROL_COMM';
    if (classes.has('POWER_DC_ESS')) return 'ESS_RECHARGE';
    if (classes.has('POWER_AC') || classes.has('POWER_DC')) return 'POWER_FLOW';
    if (classes.has('POWER_DC_AUX')) return 'AUXILIARY';
    return 'CONTROL_COMM';
  }

  function semanticStage(instance) {
    const kind = text(instance && instance.kind).toLowerCase();
    return Object.prototype.hasOwnProperty.call(SEMANTIC_STAGE, kind) ? SEMANTIC_STAGE[kind] : 500;
  }

  function branchNumber(instance) {
    const source = [instance && instance.id, instance && instance.referenceDesignation,
      instance && instance.ref, instance && instance.tag].map(text).join(' ');
    const patterns = [/(?:^|[-_/])G(?:UN)?[-_]?0*(\d+)(?:[-_/]|$)/i,
      /(?:^|[-_/])OUT(?:PUT)?[-_]?0*(\d+)(?:[-_/]|$)/i,
      /(?:^|[-_/])TERM(?:INAL)?[-_]?0*(\d+)(?:[-_/]|$)/i];
    for (let index = 0; index < patterns.length; index += 1) {
      const match = patterns[index].exec(source);
      if (match) return Math.max(1, Number(match[1]));
    }
    return null;
  }

  function flowNetClass(zoneId, circuit) {
    const netClass = text(circuit && circuit.netClass).toUpperCase();
    if (zoneId === 'POWER_FLOW') return netClass === 'POWER_AC' || netClass === 'POWER_DC';
    if (zoneId === 'ESS_RECHARGE') return netClass === 'POWER_DC_ESS';
    if (zoneId === 'AUXILIARY') return netClass === 'POWER_DC_AUX';
    return false;
  }

  /* Longest-path depth over the directed power graph gives the primary
     left-to-right order.  Cyclic/bidirectional islands deliberately fall
     back to the controlled semantic order above. */
  function graphDepths(zoneId, zoneInstances, circuits, zoneByInstance) {
    const ids = new Set(zoneInstances.map((instance) => instance.id));
    const adjacency = new Map(zoneInstances.map((instance) => [instance.id, new Set()]));
    const indegree = new Map(zoneInstances.map((instance) => [instance.id, 0]));
    circuits.forEach((circuit) => {
      if (!flowNetClass(zoneId, circuit) || !ids.has(circuit.from) || !ids.has(circuit.to) || circuit.from === circuit.to) return;
      if (zoneByInstance.get(circuit.from) !== zoneId || zoneByInstance.get(circuit.to) !== zoneId) return;
      const targets = adjacency.get(circuit.from);
      if (!targets.has(circuit.to)) {
        targets.add(circuit.to);
        indegree.set(circuit.to, indegree.get(circuit.to) + 1);
      }
    });
    const queue = zoneInstances.filter((instance) => indegree.get(instance.id) === 0 && adjacency.get(instance.id).size)
      .map((instance) => instance.id).sort(compareText);
    const depth = new Map(queue.map((id) => [id, 0]));
    while (queue.length) {
      const id = queue.shift();
      Array.from(adjacency.get(id)).sort(compareText).forEach((target) => {
        depth.set(target, Math.max(depth.get(target) || 0, (depth.get(id) || 0) + 1));
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) {
          queue.push(target);
          queue.sort(compareText);
        }
      });
    }
    return depth;
  }

  function assignFunctionalCells(instances, circuits, options) {
    const opts = options || {};
    const zoneByInstance = new Map(instances.map((instance) => [instance.id, classifyFunctionalZone(instance)]));
    const cells = new Map();
    const zones = [];
    let baseRow = 0;
    let maximumColumn = 1;
    ZONE_DEFINITIONS.forEach((definitionValue) => {
      const members = instances.filter((instance) => zoneByInstance.get(instance.id) === definitionValue.id);
      if (!members.length) return;
      const depths = graphDepths(definitionValue.id, members, circuits, zoneByInstance);
      const staged = members.map((instance) => ({
        instance,
        /* Graph depth is primary.  Isolated/control devices use an explicit
           semantic stage and therefore remain deterministic. */
        stageKey: depths.has(instance.id) ? 'G' + String(depths.get(instance.id)).padStart(4, '0')
          : 'S' + String(semanticStage(instance)).padStart(4, '0'),
        stageOrder: depths.has(instance.id) ? depths.get(instance.id) * 1000 + semanticStage(instance)
          : 1000000 + semanticStage(instance),
        branch: branchNumber(instance)
      })).sort((a, b) => a.stageOrder - b.stageOrder || compareText(a.stageKey, b.stageKey) ||
        (a.branch || 0) - (b.branch || 0) || compareText(a.instance.id, b.instance.id));
      const stageGroups = [];
      staged.forEach((item) => {
        let group = stageGroups.find((candidate) => candidate.key === item.stageKey);
        if (!group) {
          group = { key: item.stageKey, order: item.stageOrder, items: [] };
          stageGroups.push(group);
        }
        group.items.push(item);
      });
      stageGroups.sort((a, b) => a.order - b.order || compareText(a.key, b.key));
      let stageBase = 0;
      let zoneMaximumRow = 0;
      stageGroups.forEach((group) => {
        const occupied = new Map();
        let packedIndex = 0;
        group.items.forEach((item) => {
          let preferredRow;
          if (definitionValue.id === 'POWER_FLOW' && item.branch != null) preferredRow = item.branch;
          else if (definitionValue.id === 'CONTROL_COMM' || definitionValue.id === 'AUXILIARY' ||
              definitionValue.id === 'PROTECTIVE_EARTH') {
            preferredRow = packedIndex % Math.max(1, Number(opts.zoneStackLimit || 4));
            packedIndex += 1;
          } else preferredRow = 0;
          const used = occupied.get(preferredRow) || 0;
          occupied.set(preferredRow, used + 1);
          const col = stageBase + used;
          const row = baseRow + preferredRow;
          cells.set(item.instance.id, { row, col, zoneId: definitionValue.id,
            stage: group.order, branch: item.branch });
          maximumColumn = Math.max(maximumColumn, col);
          zoneMaximumRow = Math.max(zoneMaximumRow, preferredRow);
        });
        stageBase += Math.max(1, ...Array.from(occupied.values()));
      });
      zones.push({
        id: definitionValue.id,
        title: definitionValue.title,
        flow: definitionValue.flow,
        order: definitionValue.order,
        startRow: baseRow,
        endRow: baseRow + zoneMaximumRow,
        deviceIds: members.map((instance) => instance.id).sort(compareText)
      });
      baseRow += zoneMaximumRow + 1;
    });
    return {
      cells,
      zones,
      zoneByInstance,
      rows: Math.max(1, baseRow),
      columns: Math.max(2, maximumColumn + 1)
    };
  }

  function estimatedTextWidth(value, height) {
    let units = 0;
    Array.from(text(value)).forEach((character) => { units += character.charCodeAt(0) > 255 ? 1 : 0.62; });
    return units * height;
  }

  function chooseDrawingSheet(requiredWidth, requiredHeight) {
    const width = Math.max(1, Math.ceil(Number(requiredWidth)));
    const height = Math.max(1, Math.ceil(Number(requiredHeight)));
    const landscapeStandards = [
      { format: 'A3', canvasWidth: 1680, canvasHeight: 1188, widthMm: 420, heightMm: 297 },
      { format: 'A2', canvasWidth: 2376, canvasHeight: 1680, widthMm: 594, heightMm: 420 },
      { format: 'A1', canvasWidth: 3364, canvasHeight: 2376, widthMm: 841, heightMm: 594 },
      { format: 'A0', canvasWidth: 4756, canvasHeight: 3364, widthMm: 1189, heightMm: 841 }
    ];
    const standards = landscapeStandards.flatMap((candidate) => [
      Object.assign({ orientation: 'LANDSCAPE' }, candidate),
      {
        format: candidate.format,
        orientation: 'PORTRAIT',
        canvasWidth: candidate.canvasHeight,
        canvasHeight: candidate.canvasWidth,
        widthMm: candidate.heightMm,
        heightMm: candidate.widthMm
      }
    ]).filter((candidate) => width <= candidate.canvasWidth && height <= candidate.canvasHeight)
      .sort((a, b) => a.canvasWidth * a.canvasHeight - b.canvasWidth * b.canvasHeight ||
        (a.canvasWidth - width) * (a.canvasHeight - height) - (b.canvasWidth - width) * (b.canvasHeight - height));
    const standard = standards[0];
    const customCanvasWidth = Math.ceil(width / 40) * 40;
    const customCanvasHeight = Math.ceil(height / 40) * 40;
    const selected = standard || {
      format: 'CUSTOM',
      canvasWidth: customCanvasWidth,
      canvasHeight: customCanvasHeight,
      widthMm: customCanvasWidth / 4,
      heightMm: customCanvasHeight / 4,
      orientation: width >= height ? 'LANDSCAPE' : 'PORTRAIT'
    };
    return Object.freeze(Object.assign({}, selected, {
      scale: '1:4',
      plotScaleDenominator: 4,
      requiredWidth: width,
      requiredHeight: height
    }));
  }

  function validateDesign(design) {
    const model = design || {};
    const instances = Array.isArray(model.instances)
      ? model.instances
      : (Array.isArray(model.equipment) ? model.equipment : []);
    const nets = Array.isArray(model.nets) ? model.nets : [];
    const circuits = Array.isArray(model.circuits) ? model.circuits : [];
    const problems = [];
    if (!instances.length) problems.push('instances');
    if (!nets.length) problems.push('nets');
    if (!circuits.length) problems.push('circuits');
    const instanceIds = new Set();
    const terminalKeys = new Set();
    instances.forEach((instance) => {
      if (!instance || !instance.id || instanceIds.has(instance.id)) problems.push('instance:' + text(instance && instance.id));
      if (!instance || !instance.id) return;
      instanceIds.add(instance.id);
      const terminals = instanceTerminals(instance);
      if (!terminals.length) problems.push('terminals:' + instance.id);
      terminals.forEach((terminal) => {
        const key = endpointKey(instance.id, terminal && terminal.id);
        if (!terminal || !terminal.id || terminalKeys.has(key)) problems.push('terminal:' + key);
        terminalKeys.add(key);
      });
    });
    const netIds = new Set();
    nets.forEach((net) => {
      if (!net || !net.id || netIds.has(net.id)) problems.push('net:' + text(net && net.id));
      if (net && net.id) netIds.add(net.id);
    });
    const circuitIds = new Set();
    circuits.forEach((circuit) => {
      if (!circuit || !circuit.id || circuitIds.has(circuit.id)) problems.push('circuit:' + text(circuit && circuit.id));
      if (!circuit) return;
      circuitIds.add(circuit.id);
      if (!terminalKeys.has(endpointKey(circuit.from, circuit.fromPort))) problems.push('from:' + circuit.id);
      if (!terminalKeys.has(endpointKey(circuit.to, circuit.toPort))) problems.push('to:' + circuit.id);
      if (!netIds.has(circuit.netId)) problems.push('netRef:' + circuit.id);
    });
    if (problems.length) {
      throw new SchematicCompileError('SCHEMATIC_MODEL_INCOMPLETE',
        'EDEM model cannot be compiled to a schematic: ' + problems.slice(0, 12).join(', '),
        { problems, schemaVersion: model.schemaVersion || '' });
    }
    return { instances, nets, circuits };
  }

  function isLogicalOnlyProxy(instance) {
    return !!instance && instance.logicalOnlyProxy === true;
  }

  /* Logical interface slices are useful in EDEM because every functional
     connection keeps its exact standard-specific endpoint.  They are not,
     however, additional pieces of hardware and therefore must never become
     a second schematic symbol.  This projection keeps the original circuit
     endpoint ref on every route while anchoring it on the explicitly named
     physical owner (or, for a mode-selected power throw, on that selector).
     No connection is inferred or merged: every model circuit still produces
     exactly one independently traceable route. */
  function createRenderingProjection(instances, circuits) {
    const allInstances = instances.slice();
    const instanceById = new Map(allInstances.map((instance) => [instance.id, instance]));
    const terminalByKey = new Map();
    allInstances.forEach((instance) => instanceTerminals(instance).forEach((terminal) =>
      terminalByKey.set(endpointKey(instance.id, terminal.id), terminal)));
    const renderedInstances = allInstances.filter((instance) => !isLogicalOnlyProxy(instance));
    const endpointCache = new Map();

    function fail(code, message, details) {
      throw new SchematicCompileError(code, message, details);
    }

    function selectorHost(proxy, terminal) {
      if (!/^POWER_/.test(text(terminal && terminal.netClass).toUpperCase())) return null;
      const candidates = [];
      circuits.forEach((circuit) => {
        let otherId = '';
        let otherPort = '';
        if (circuit.from === proxy.id && circuit.fromPort === terminal.id) {
          otherId = circuit.to;
          otherPort = circuit.toPort;
        } else if (circuit.to === proxy.id && circuit.toPort === terminal.id) {
          otherId = circuit.from;
          otherPort = circuit.fromPort;
        }
        if (!otherId) return;
        const other = instanceById.get(otherId);
        if (other && other.kind === 'ac-dc-power-selector' && otherPort === terminal.id) {
          candidates.push({ instance: other, terminalId: otherPort });
        }
      });
      const unique = Array.from(new Map(candidates.map((candidate) =>
        [endpointKey(candidate.instance.id, candidate.terminalId), candidate])).values());
      if (unique.length > 1) fail('LOGICAL_PROXY_RENDER_HOST_AMBIGUOUS',
        'Logical proxy endpoint has more than one physical selector host.', {
          endpoint: endpointKey(proxy.id, terminal.id),
          candidates: unique.map((candidate) => endpointKey(candidate.instance.id, candidate.terminalId))
        });
      return unique[0] || null;
    }

    function resolve(instanceId, terminalId) {
      const key = endpointKey(instanceId, terminalId);
      if (endpointCache.has(key)) return endpointCache.get(key);
      const instance = instanceById.get(instanceId);
      const modelTerminal = terminalByKey.get(key);
      if (!instance || !modelTerminal) fail('SCHEMATIC_ENDPOINT_UNKNOWN',
        'Cannot project unknown schematic endpoint ' + key + '.', { endpoint: key });
      if (!isLogicalOnlyProxy(instance)) {
        const physical = Object.freeze({
          instanceId,
          terminalId,
          instance,
          terminal: modelTerminal,
          modelInstanceId: instanceId,
          modelTerminalId: terminalId,
          modelTerminal,
          endpointRef: key,
          logicalOnlyAlias: false
        });
        endpointCache.set(key, physical);
        return physical;
      }

      const ownerId = text(instance.physicalOwnerId || modelTerminal.physicalOwnerId);
      const physicalTerminalId = text(modelTerminal.physicalTerminalId);
      const owner = instanceById.get(ownerId);
      if (!ownerId || !owner || isLogicalOnlyProxy(owner) || !physicalTerminalId ||
          modelTerminal.logicalOnly !== true ||
          (modelTerminal.physicalOwnerId && modelTerminal.physicalOwnerId !== ownerId)) {
        fail('LOGICAL_PROXY_RENDER_CONTRACT_INVALID',
          'Logical-only endpoint lacks an explicit non-proxy physical owner mapping.', {
            endpoint: key, ownerId, physicalTerminalId
          });
      }
      let host = { instance: owner, terminalId: physicalTerminalId };
      const selectedHost = selectorHost(instance, modelTerminal);
      if (selectedHost) host = selectedHost;
      const hostTerminal = terminalByKey.get(endpointKey(host.instance.id, host.terminalId));
      if (!hostTerminal) fail('LOGICAL_PROXY_RENDER_TERMINAL_UNKNOWN',
        'Logical-only endpoint points to a missing graphical host terminal.', {
          endpoint: key, graphicalHost: endpointKey(host.instance.id, host.terminalId)
        });
      const alias = Object.freeze({
        instanceId: host.instance.id,
        terminalId: host.terminalId,
        instance: host.instance,
        terminal: hostTerminal,
        modelInstanceId: instanceId,
        modelTerminalId: terminalId,
        modelTerminal,
        endpointRef: key,
        logicalOnlyAlias: true,
        physicalOwnerId: ownerId,
        physicalTerminalId
      });
      endpointCache.set(key, alias);
      return alias;
    }

    allInstances.filter(isLogicalOnlyProxy).forEach((proxy) => {
      if (instanceTerminals(proxy).length === 0) fail('LOGICAL_PROXY_RENDER_CONTRACT_INVALID',
        'Logical-only proxy must declare its functional terminals.', { instanceId: proxy.id });
      instanceTerminals(proxy).forEach((terminal) => resolve(proxy.id, terminal.id));
    });
    const projectionByCircuit = new Map();
    circuits.forEach((circuit) => projectionByCircuit.set(circuit.id, Object.assign({}, circuit, {
      from: resolve(circuit.from, circuit.fromPort).instanceId,
      fromPort: resolve(circuit.from, circuit.fromPort).terminalId,
      to: resolve(circuit.to, circuit.toPort).instanceId,
      toPort: resolve(circuit.to, circuit.toPort).terminalId
    })));
    const aliasReasonByCircuit = new Map();
    function hasLogicalEndpoint(circuit) {
      return isLogicalOnlyProxy(instanceById.get(circuit.from)) || isLogicalOnlyProxy(instanceById.get(circuit.to));
    }
    circuits.forEach((circuit) => {
      const projected = projectionByCircuit.get(circuit.id);
      if (hasLogicalEndpoint(circuit) &&
          endpointKey(projected.from, projected.fromPort) === endpointKey(projected.to, projected.toPort)) {
        aliasReasonByCircuit.set(circuit.id, 'COLOCATED_LOGICAL_ALIAS');
      }
    });

    /* A logical PE membership may project onto the exact same physical
       conductor already represented by a non-proxy circuit.  Retain the
       physical circuit as the single drawn wire and record the logical
       circuit as an alias trace; drawing both would falsely show parallel
       conductors. */
    const physicalGroups = new Map();
    circuits.forEach((circuit) => {
      const projected = projectionByCircuit.get(circuit.id);
      const endpoints = [endpointKey(projected.from, projected.fromPort),
        endpointKey(projected.to, projected.toPort)].sort(compareText);
      const key = text(circuit.netId) + '|' + endpoints.join('|');
      const group = physicalGroups.get(key) || [];
      group.push(circuit);
      physicalGroups.set(key, group);
    });
    physicalGroups.forEach((group) => {
      if (group.length < 2) return;
      const physical = group.filter((circuit) => !hasLogicalEndpoint(circuit)).sort((a, b) => compareText(a.id, b.id));
      if (!physical.length) return;
      group.filter(hasLogicalEndpoint).forEach((circuit) => {
        if (!aliasReasonByCircuit.has(circuit.id)) {
          aliasReasonByCircuit.set(circuit.id, 'DUPLICATE_PHYSICAL_ROUTE_ALIAS');
        }
      });
    });

    const aliasTraces = circuits.filter((circuit) => aliasReasonByCircuit.has(circuit.id)).map((circuit) => {
      const from = resolve(circuit.from, circuit.fromPort);
      const to = resolve(circuit.to, circuit.toPort);
      return Object.freeze({
        id: 'ALIAS:' + circuit.id,
        circuitId: circuit.id,
        netId: circuit.netId,
        netClass: circuit.netClass,
        domain: circuit.domain,
        source: { ref: endpointKey(circuit.from, circuit.fromPort), deviceId: circuit.from, portId: circuit.fromPort },
        target: { ref: endpointKey(circuit.to, circuit.toPort), deviceId: circuit.to, portId: circuit.toPort },
        physicalSource: { ref: endpointKey(from.instanceId, from.terminalId),
          deviceId: from.instanceId, portId: from.terminalId },
        physicalTarget: { ref: endpointKey(to.instanceId, to.terminalId),
          deviceId: to.instanceId, portId: to.terminalId },
        reason: aliasReasonByCircuit.get(circuit.id),
        logicalProxyIds: [circuit.from, circuit.to].filter((id) => isLogicalOnlyProxy(instanceById.get(id)))
      });
    });
    const routedCircuits = circuits.filter((circuit) => !aliasReasonByCircuit.has(circuit.id));
    const projectedCircuits = routedCircuits.map((circuit) => projectionByCircuit.get(circuit.id));
    return Object.freeze({
      instances: Object.freeze(renderedInstances),
      logicalProxyInstances: Object.freeze(allInstances.filter(isLogicalOnlyProxy)),
      routedCircuits: Object.freeze(routedCircuits),
      aliasTraces: Object.freeze(aliasTraces),
      circuits: Object.freeze(projectedCircuits),
      resolve
    });
  }

  function chooseColumns(count, requested) {
    if (requested != null) return Math.max(2, Math.floor(Number(requested)));
    return Math.max(4, Math.min(8, Math.ceil(Math.sqrt(count * 1.35))));
  }

  function laneResult(IR, intervals) {
    return IR.allocateIntervalLanes(intervals, { touchingConflicts: true });
  }

  function createPlan(design, options, rootObject) {
    const IR = rootObject && rootObject.EVSE_DRAWING_IR;
    if (!IR || typeof IR.buildDrawingIR !== 'function') {
        throw new SchematicCompileError('DRAWING_IR_MISSING', 'EVSE_DRAWING_IR must be loaded before schematic compilation.');
    }
    const symbolCatalog = rootObject && rootObject.EVSE_IEC_SYMBOL_CATALOG;
    if (!symbolCatalog || typeof symbolCatalog.resolve !== 'function') {
      throw new SchematicCompileError('IEC_SYMBOL_CATALOG_MISSING',
        'EVSE_IEC_SYMBOL_CATALOG must be loaded before schematic compilation.');
    }
    const model = validateDesign(design);
    const opts = Object.assign({
      columns: null,
      deviceWidth: 144,
      maximumDeviceWidth: 240,
      minimumDeviceHeight: 72,
      portPitch: 14,
      lanePitch: 12,
      channelInset: 18,
      minimumHorizontalGap: 88,
      minimumVerticalGap: 96,
      zoneStackLimit: 4,
      left: 40,
      top: 68,
      rightMargin: 34,
      bottomMargin: 80,
      scheduleWidth: 420
    }, options || {});
    const allInstances = sortInstances(model.instances);
    const circuits = model.circuits.slice().sort((a, b) => compareText(a.id, b.id));
    const nets = model.nets.slice().sort((a, b) => compareText(a.id, b.id));
    const projection = createRenderingProjection(allInstances, circuits);
    const instances = projection.instances;
    const routedCircuits = projection.routedCircuits;
    const instanceById = new Map(allInstances.map((instance) => [instance.id, instance]));
    const terminalByKey = new Map();
    allInstances.forEach((instance) => instanceTerminals(instance).forEach((terminal) =>
      terminalByKey.set(endpointKey(instance.id, terminal.id), terminal)));
    const netById = new Map(nets.map((net) => [net.id, net]));
    const functionalLayout = assignFunctionalCells(instances, projection.circuits, opts);
    const columns = functionalLayout.columns;
    const rows = functionalLayout.rows;
    const cells = functionalLayout.cells;

    const occurrencesByInstance = new Map(instances.map((instance) => [instance.id, { LEFT: [], RIGHT: [] }]));
    const occurrenceByRole = new Map();
    let occurrenceOrder = 0;
    function addOccurrence(circuit, role, instanceId, terminalId, otherId, side) {
      const endpoint = projection.resolve(instanceId, terminalId);
      const occurrence = {
        id: circuit.id + ':' + role,
        circuitId: circuit.id,
        role,
        instanceId: endpoint.instanceId,
        terminalId: endpoint.terminalId,
        modelInstanceId: instanceId,
        modelTerminalId: terminalId,
        endpointRef: endpoint.endpointRef,
        logicalOnlyAlias: endpoint.logicalOnlyAlias,
        otherId,
        side,
        terminal: endpoint.terminal,
        modelTerminal: endpoint.modelTerminal,
        order: occurrenceOrder++
      };
      occurrencesByInstance.get(endpoint.instanceId)[side].push(occurrence);
      occurrenceByRole.set(occurrence.id, occurrence);
    }

    routedCircuits.forEach((circuit) => {
      const fromEndpoint = projection.resolve(circuit.from, circuit.fromPort);
      const toEndpoint = projection.resolve(circuit.to, circuit.toPort);
      const fromCell = cells.get(fromEndpoint.instanceId);
      const toCell = cells.get(toEndpoint.instanceId);
      let fromSide;
      let toSide;
      if (toCell.col > fromCell.col) {
        fromSide = 'RIGHT';
        toSide = 'LEFT';
      } else if (toCell.col < fromCell.col) {
        fromSide = 'LEFT';
        toSide = 'RIGHT';
      } else if (stableNumber(circuit.id) % 2 === 0) {
        fromSide = 'RIGHT';
        toSide = 'LEFT';
      } else {
        fromSide = 'LEFT';
        toSide = 'RIGHT';
      }
      addOccurrence(circuit, 'FROM', circuit.from, circuit.fromPort, circuit.to, fromSide);
      addOccurrence(circuit, 'TO', circuit.to, circuit.toPort, circuit.from, toSide);
    });

    /* Unconnected optional terminals remain visible, but never create a route. */
    instances.forEach((instance) => {
      const connected = new Set([].concat(occurrencesByInstance.get(instance.id).LEFT,
        occurrencesByInstance.get(instance.id).RIGHT).map((item) => item.terminalId));
      instanceTerminals(instance).filter((terminal) => !connected.has(terminal.id)).forEach((terminal, index) => {
        const direction = text(terminal.direction).toLowerCase();
        const side = direction === 'in' ? 'LEFT' : direction === 'out' ? 'RIGHT' : (index % 2 ? 'RIGHT' : 'LEFT');
        occurrencesByInstance.get(instance.id)[side].push({
          id: 'OPEN:' + instance.id + ':' + terminal.id,
          circuitId: '', role: 'OPEN', instanceId: instance.id, terminalId: terminal.id,
          otherId: '', side, terminal, order: occurrenceOrder++
        });
      });
    });

    occurrencesByInstance.forEach((sides) => ['LEFT', 'RIGHT'].forEach((side) => {
      sides[side].sort((a, b) => compareText(a.terminalId, b.terminalId) ||
        compareText(a.circuitId, b.circuitId) || compareText(a.role, b.role));
    }));

    const dimensions = new Map();
    instances.forEach((instance) => {
      const sides = occurrencesByInstance.get(instance.id);
      const maximumPorts = Math.max(sides.LEFT.length, sides.RIGHT.length, 1);
      const longestTerminalLabel = Math.max(0, ...[].concat(sides.LEFT, sides.RIGHT).map((occurrence) =>
        estimatedTextWidth(occurrence.terminal && (occurrence.terminal.label || occurrence.terminal.id) || occurrence.terminalId, 10)));
      const width = Math.max(opts.deviceWidth, Math.min(opts.maximumDeviceWidth, 78 + longestTerminalLabel * 1.7));
      dimensions.set(instance.id, {
        width,
        height: Math.max(opts.minimumDeviceHeight, 32 + maximumPorts * opts.portPitch)
      });
    });
    const rowHeights = Array.from({ length: rows }, () => opts.minimumDeviceHeight);
    instances.forEach((instance) => {
      const cell = cells.get(instance.id);
      rowHeights[cell.row] = Math.max(rowHeights[cell.row], dimensions.get(instance.id).height);
    });

    function corridorIndex(instanceId, side) {
      const cell = cells.get(instanceId);
      return side === 'LEFT' ? cell.col : cell.col + 1;
    }

    const circuitPlan = new Map();
    const horizontalIntervals = Array.from({ length: rows + 1 }, () => []);
    routedCircuits.forEach((circuit) => {
      const sourceOccurrence = occurrenceByRole.get(circuit.id + ':FROM');
      const targetOccurrence = occurrenceByRole.get(circuit.id + ':TO');
      const sourceCorridor = corridorIndex(sourceOccurrence.instanceId, sourceOccurrence.side);
      const targetCorridor = corridorIndex(targetOccurrence.instanceId, targetOccurrence.side);
      const sourceRow = cells.get(sourceOccurrence.instanceId).row;
      const targetRow = cells.get(targetOccurrence.instanceId).row;
      if (sourceCorridor === targetCorridor) {
        circuitPlan.set(circuit.id, { circuit, sourceOccurrence, targetOccurrence,
          sourceCorridor, targetCorridor, direct: true, horizontalGap: null });
        return;
      }
      let candidates = [];
      if (sourceRow === targetRow) {
        candidates = [sourceRow, sourceRow + 1].filter((gap) => gap >= 0 && gap <= rows);
      } else {
        const first = Math.min(sourceRow, targetRow) + 1;
        const last = Math.max(sourceRow, targetRow);
        for (let gap = first; gap <= last; gap += 1) candidates.push(gap);
      }
      const horizontalGap = candidates[stableNumber(circuit.id) % candidates.length];
      const entry = { circuit, sourceOccurrence, targetOccurrence, sourceCorridor, targetCorridor,
        direct: false, horizontalGap };
      circuitPlan.set(circuit.id, entry);
      horizontalIntervals[horizontalGap].push({
        id: circuit.id,
        start: Math.min(sourceCorridor, targetCorridor),
        end: Math.max(sourceCorridor, targetCorridor)
      });
    });

    const horizontalAllocations = horizontalIntervals.map((intervals) => laneResult(IR, intervals));
    const horizontalGapHeights = horizontalAllocations.map((allocation) => Math.max(
      opts.minimumHorizontalGap,
      opts.channelInset * 2 + Math.max(0, allocation.laneCount - 1) * opts.lanePitch + 1
    ));
    const horizontalGapTop = [];
    const rowTop = [];
    let yCursor = opts.top;
    for (let gap = 0; gap <= rows; gap += 1) {
      horizontalGapTop[gap] = yCursor;
      yCursor += horizontalGapHeights[gap];
      if (gap < rows) {
        rowTop[gap] = yCursor;
        yCursor += rowHeights[gap];
      }
    }
    const contentBottom = yCursor;
    circuitPlan.forEach((entry) => {
      if (entry.direct) return;
      const lane = horizontalAllocations[entry.horizontalGap].byId[entry.circuit.id];
      entry.horizontalLaneIndex = lane;
      entry.horizontalY = horizontalGapTop[entry.horizontalGap] + opts.channelInset + lane * opts.lanePitch;
    });

    const anchorDrafts = new Map();
    instances.forEach((instance) => {
      const cell = cells.get(instance.id);
      const deviceHeight = dimensions.get(instance.id).height;
      const deviceY = rowTop[cell.row] + (rowHeights[cell.row] - deviceHeight) / 2;
      const sides = occurrencesByInstance.get(instance.id);
      ['LEFT', 'RIGHT'].forEach((side) => sides[side].forEach((occurrence, index) => {
        const anchorY = deviceY + (index + 1) * deviceHeight / (sides[side].length + 1) + occurrence.order * 0.0001;
        anchorDrafts.set(occurrence.id, { occurrence, y: anchorY, side });
      }));
    });

    const verticalIntervals = Array.from({ length: columns + 1 }, () => []);
    circuitPlan.forEach((entry) => {
      const sourceAnchor = anchorDrafts.get(entry.sourceOccurrence.id);
      const targetAnchor = anchorDrafts.get(entry.targetOccurrence.id);
      if (entry.direct) {
        verticalIntervals[entry.sourceCorridor].push({
          id: entry.circuit.id + ':DIRECT', start: sourceAnchor.y, end: targetAnchor.y
        });
      } else {
        verticalIntervals[entry.sourceCorridor].push({
          id: entry.circuit.id + ':FROM', start: sourceAnchor.y, end: entry.horizontalY
        });
        verticalIntervals[entry.targetCorridor].push({
          id: entry.circuit.id + ':TO', start: targetAnchor.y, end: entry.horizontalY
        });
      }
    });
    const verticalAllocations = verticalIntervals.map((intervals) => laneResult(IR, intervals));
    const verticalGapWidths = verticalAllocations.map((allocation) => Math.max(
      opts.minimumVerticalGap,
      opts.channelInset * 2 + Math.max(0, allocation.laneCount - 1) * opts.lanePitch + 1
    ));
    const columnWidths = Array.from({ length: columns }, () => opts.deviceWidth);
    instances.forEach((instance) => {
      const cell = cells.get(instance.id);
      columnWidths[cell.col] = Math.max(columnWidths[cell.col], dimensions.get(instance.id).width);
    });
    const verticalGapLeft = [];
    const columnLeft = [];
    let xCursor = opts.left;
    for (let gap = 0; gap <= columns; gap += 1) {
      verticalGapLeft[gap] = xCursor;
      xCursor += verticalGapWidths[gap];
      if (gap < columns) {
        columnLeft[gap] = xCursor;
        xCursor += columnWidths[gap];
      }
    }
    const contentRight = xCursor;

    const anchorByRole = new Map();
    const placedDevices = instances.map((instance) => {
      const cell = cells.get(instance.id);
      const dimension = dimensions.get(instance.id);
      const x = columnLeft[cell.col];
      const y = rowTop[cell.row] + (rowHeights[cell.row] - dimension.height) / 2;
      const sides = occurrencesByInstance.get(instance.id);
      const ports = [];
      const resolvedSymbol = symbolCatalog.resolve(instance.kind);
      ['LEFT', 'RIGHT'].forEach((side) => sides[side].forEach((occurrence) => {
        const draft = anchorDrafts.get(occurrence.id);
        const terminal = occurrence.terminal || {};
        const anchor = {
          id: occurrence.terminalId + '@' + (occurrence.circuitId || 'OPEN') + '@' + occurrence.role,
          ref: occurrence.endpointRef || endpointKey(instance.id, occurrence.terminalId),
          terminalId: occurrence.terminalId,
          circuitId: occurrence.circuitId,
          x: side === 'LEFT' ? x : x + dimension.width,
          y: draft.y,
          side,
          direction: terminal.direction,
          domain: terminal.domain,
          netClass: terminal.netClass,
          label: terminal.label || occurrence.terminalId
        };
        ports.push(anchor);
        if (occurrence.circuitId) anchorByRole.set(occurrence.id, anchor);
      }));
      return IR.createPlacedDevice({
        id: instance.id,
        type: instance.kind,
        symbolId: resolvedSymbol.symbolId,
        symbolFallback: resolvedSymbol.fallback,
        system: instance.system,
        tag: shortTag(instance),
        referenceDesignation: instance.referenceDesignation || instance.ref,
        label: shortTag(instance) + ' ' + text(instance.name || instance.kind),
        bbox: { x, y, width: dimension.width, height: dimension.height },
        ports
      });
    });

    function verticalX(corridor, traversalId) {
      const lane = verticalAllocations[corridor].byId[traversalId];
      if (lane == null) throw new SchematicCompileError('VERTICAL_LANE_MISSING',
        'Missing vertical lane for ' + traversalId + '.', { corridor, traversalId });
      return verticalGapLeft[corridor] + opts.channelInset + lane * opts.lanePitch;
    }

    const routes = routedCircuits.map((circuit) => {
      const entry = circuitPlan.get(circuit.id);
      const sourceOccurrence = entry.sourceOccurrence;
      const targetOccurrence = entry.targetOccurrence;
      const sourceAnchor = anchorByRole.get(circuit.id + ':FROM');
      const targetAnchor = anchorByRole.get(circuit.id + ':TO');
      let points;
      if (entry.direct) {
        const x = verticalX(entry.sourceCorridor, circuit.id + ':DIRECT');
        points = [sourceAnchor, { x, y: sourceAnchor.y }, { x, y: targetAnchor.y }, targetAnchor];
      } else {
        const sourceX = verticalX(entry.sourceCorridor, circuit.id + ':FROM');
        const targetX = verticalX(entry.targetCorridor, circuit.id + ':TO');
        points = [
          sourceAnchor,
          { x: sourceX, y: sourceAnchor.y },
          { x: sourceX, y: entry.horizontalY },
          { x: targetX, y: entry.horizontalY },
          { x: targetX, y: targetAnchor.y },
          targetAnchor
        ];
      }
      const net = netById.get(circuit.netId) || {};
      const netClass = circuit.netClass || net.netClass;
      return IR.routeOrthogonal({
        id: circuit.id,
        netId: circuit.netId,
        circuitId: circuit.id,
        netClass,
        domain: circuit.domain || net.domain,
        polarity: circuit.polarity || net.polarity,
        phase: circuit.phase || net.phase,
        protocol: circuit.protocol || net.protocol,
        source: {
          ref: endpointKey(circuit.from, circuit.fromPort), deviceId: circuit.from,
          portId: circuit.fromPort,
          physicalRef: endpointKey(sourceOccurrence.instanceId, sourceOccurrence.terminalId),
          x: sourceAnchor.x, y: sourceAnchor.y
        },
        target: {
          ref: endpointKey(circuit.to, circuit.toPort), deviceId: circuit.to,
          portId: circuit.toPort,
          physicalRef: endpointKey(targetOccurrence.instanceId, targetOccurrence.terminalId),
          x: targetAnchor.x, y: targetAnchor.y
        },
        points,
        layer: LAYER_BY_NET_CLASS[netClass] || 'EVSE-CTL',
        bridgePriority: /^POWER_/.test(netClass || '') || netClass === 'PROTECTIVE_EARTH' ? 20 : 10
      });
    });

    const zonePlans = functionalLayout.zones.map((zone) => {
      const topGap = zone.startRow;
      const bottomGap = zone.endRow + 1;
      const yMin = topGap === 0
        ? horizontalGapTop[topGap] + 3
        : horizontalGapTop[topGap] + horizontalGapHeights[topGap] / 2;
      const yMax = bottomGap === rows
        ? horizontalGapTop[bottomGap] + horizontalGapHeights[bottomGap] - 3
        : horizontalGapTop[bottomGap] + horizontalGapHeights[bottomGap] / 2;
      return Object.freeze({
        id: zone.id,
        title: zone.title,
        flow: zone.flow,
        order: zone.order,
        startRow: zone.startRow,
        endRow: zone.endRow,
        deviceIds: Object.freeze(zone.deviceIds.slice()),
        deviceCount: zone.deviceIds.length,
        x: opts.left + 2,
        y: yMin,
        width: Math.max(20, contentRight - opts.left - 4),
        height: Math.max(20, yMax - yMin)
      });
    });
    const annotations = [];
    zonePlans.forEach((zone) => {
      annotations.push({
        id: 'ZONE:' + zone.id + ':BOUNDARY',
        kind: 'rect', layer: 'EVSE-ANNO', annotationRole: 'functional-zone-boundary',
        zoneId: zone.id, x: zone.x, y: zone.y, width: zone.width, height: zone.height,
        strokeWidth: 0.8, dash: '8,5', fill: 'none'
      });
      annotations.push({
        id: 'ZONE:' + zone.id + ':TITLE',
        kind: 'text', layer: 'EVSE-TEXT', annotationRole: 'functional-zone-title',
        zoneId: zone.id, x: zone.x + 8, y: zone.y + 11,
        text: zone.title, height: 11, anchor: 'start', weight: 'bold'
      });
    });
    const requiredWidth = contentRight + opts.scheduleWidth + opts.rightMargin;
    const scheduleBottomEstimate = opts.top + 40 + instances.length * 32;
    const requiredHeight = Math.max(contentBottom + opts.bottomMargin, scheduleBottomEstimate + 340);
    const sheet = chooseDrawingSheet(requiredWidth, requiredHeight);

    const drawingIR = IR.buildDrawingIR({
      devices: placedDevices,
      routes,
      aliasTraces: projection.aliasTraces,
      annotations,
      model: design,
      metadata: {
        sourceModelSchema: design.schemaVersion || '',
        placementSchema: GRID_SCHEMA,
        placementVersion: VERSION,
        circuitCount: circuits.length,
        routedCircuitCount: routedCircuits.length,
        aliasTraceCount: projection.aliasTraces.length,
        netCount: nets.length,
        instanceCount: instances.length,
        modelInstanceCount: allInstances.length,
        logicalProxyCount: projection.logicalProxyInstances.length,
        sheet: {
          format: sheet.format,
          orientation: sheet.orientation,
          widthMm: sheet.widthMm,
          heightMm: sheet.heightMm,
          canvasWidth: sheet.canvasWidth,
          canvasHeight: sheet.canvasHeight,
          scale: sheet.scale,
          plotScaleDenominator: sheet.plotScaleDenominator
        },
        functionalZones: zonePlans.map((zone) => ({
          id: zone.id, title: zone.title, flow: zone.flow,
          deviceCount: zone.deviceCount, deviceIds: zone.deviceIds
        })),
        readability: {
          nominalPlotScale: '1:4',
          deviceWidthMin: opts.deviceWidth,
          deviceHeightMin: opts.minimumDeviceHeight,
          terminalPitchMin: opts.portPitch,
          routeLanePitchMin: opts.lanePitch,
          horizontalDeviceGapMin: opts.minimumVerticalGap,
          verticalDeviceGapMin: opts.minimumHorizontalGap,
          symbolTextHeightMin: 8,
          terminalLabelTextHeight: 10,
          zoneTitleTextHeight: 11
        }
      },
      unit: 'mm',
      yAxis: 'down',
      strict: false
    });
    if (drawingIR.violations.length || !drawingIR.coverage || !drawingIR.coverage.ok) {
      throw new SchematicCompileError('SCHEMATIC_GEOMETRY_BLOCKED',
        'Schematic geometry or model coverage is invalid.', {
          violations: drawingIR.violations,
          coverage: drawingIR.coverage
        });
    }
    IR.assertValidDrawingIR(drawingIR);

    const plan = Object.freeze({
      schema: GRID_SCHEMA,
      version: VERSION,
      width: sheet.canvasWidth,
      height: sheet.canvasHeight,
      requiredWidth,
      requiredHeight,
      sheet,
      content: Object.freeze({ left: opts.left, top: opts.top, right: contentRight, bottom: contentBottom }),
      schedule: Object.freeze({ x: contentRight + 24, y: opts.top, width: opts.scheduleWidth - 34 }),
      zones: Object.freeze(zonePlans),
      readability: Object.freeze({
        nominalPlotScale: '1:4', plotScaleDenominator: 4,
        terminalPitchMin: opts.portPitch,
        routeLanePitchMin: opts.lanePitch,
        horizontalDeviceGapMin: opts.minimumVerticalGap,
        verticalDeviceGapMin: opts.minimumHorizontalGap,
        symbolTextHeightMin: 8,
        terminalLabelTextHeight: 10,
        zoneTitleTextHeight: 11
      }),
      rows,
      columns,
      rowTop: Object.freeze(rowTop.slice()),
      rowHeights: Object.freeze(rowHeights.slice()),
      columnLeft: Object.freeze(columnLeft.slice()),
      columnWidths: Object.freeze(columnWidths.slice()),
      horizontalGapTop: Object.freeze(horizontalGapTop.slice()),
      horizontalGapHeights: Object.freeze(horizontalGapHeights.slice()),
      verticalGapLeft: Object.freeze(verticalGapLeft.slice()),
      verticalGapWidths: Object.freeze(verticalGapWidths.slice())
    });
    return Object.freeze({
      schema: GRID_SCHEMA,
      version: VERSION,
      drawingIR,
      plan,
      instances: Object.freeze(instances.slice()),
      modelInstances: Object.freeze(allInstances.slice()),
      logicalProxyInstances: Object.freeze(projection.logicalProxyInstances.slice()),
      nets: Object.freeze(nets.slice()),
      circuits: Object.freeze(circuits.slice()),
      routedCircuits: Object.freeze(routedCircuits.slice()),
      aliasTraces: Object.freeze(projection.aliasTraces.slice()),
      instanceById,
      terminalByKey,
      sheets: Object.freeze([{ index: 1, total: 1, drawingIR, plan }])
    });
  }

  function compile(design, options) {
    const rootObject = typeof window !== 'undefined' ? window :
      (typeof globalThis !== 'undefined' ? globalThis : null);
    return createPlan(design, options, rootObject);
  }

  return Object.freeze({
    VERSION,
    GRID_SCHEMA,
    SchematicCompileError,
    LAYER_BY_NET_CLASS,
    ZONE_DEFINITIONS,
    endpointKey,
    shortTag,
    classifyFunctionalZone,
    assignFunctionalCells,
    chooseDrawingSheet,
    validateDesign,
    compile,
    build: compile
  });
});
