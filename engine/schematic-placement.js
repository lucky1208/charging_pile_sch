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

  const VERSION = '1.0.0';
  const GRID_SCHEMA = 'EVSE-SCHEMATIC-PLACEMENT/1.0';

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

  const LAYER_BY_NET_CLASS = Object.freeze({
    POWER_AC: 'EVSE-AC',
    POWER_DC: 'EVSE-DC',
    POWER_DC_ESS: 'EVSE-ESS',
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
    const model = validateDesign(design);
    const opts = Object.assign({
      columns: null,
      deviceWidth: 120,
      minimumDeviceHeight: 56,
      portPitch: 8,
      lanePitch: 8,
      channelInset: 12,
      minimumHorizontalGap: 72,
      minimumVerticalGap: 84,
      left: 34,
      top: 62,
      rightMargin: 34,
      bottomMargin: 80,
      scheduleWidth: 420
    }, options || {});
    const instances = sortInstances(model.instances);
    const circuits = model.circuits.slice().sort((a, b) => compareText(a.id, b.id));
    const nets = model.nets.slice().sort((a, b) => compareText(a.id, b.id));
    const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    const terminalByKey = new Map();
    instances.forEach((instance) => instanceTerminals(instance).forEach((terminal) =>
      terminalByKey.set(endpointKey(instance.id, terminal.id), terminal)));
    const netById = new Map(nets.map((net) => [net.id, net]));
    const columns = chooseColumns(instances.length, opts.columns);
    const rows = Math.ceil(instances.length / columns);
    const cells = new Map();
    instances.forEach((instance, index) => cells.set(instance.id, {
      row: Math.floor(index / columns), col: index % columns
    }));

    const occurrencesByInstance = new Map(instances.map((instance) => [instance.id, { LEFT: [], RIGHT: [] }]));
    const occurrenceByRole = new Map();
    let occurrenceOrder = 0;
    function addOccurrence(circuit, role, instanceId, terminalId, otherId, side) {
      const terminal = terminalByKey.get(endpointKey(instanceId, terminalId));
      const occurrence = {
        id: circuit.id + ':' + role,
        circuitId: circuit.id,
        role,
        instanceId,
        terminalId,
        otherId,
        side,
        terminal,
        order: occurrenceOrder++
      };
      occurrencesByInstance.get(instanceId)[side].push(occurrence);
      occurrenceByRole.set(occurrence.id, occurrence);
    }

    circuits.forEach((circuit) => {
      const fromCell = cells.get(circuit.from);
      const toCell = cells.get(circuit.to);
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
      dimensions.set(instance.id, {
        width: opts.deviceWidth,
        height: Math.max(opts.minimumDeviceHeight, 24 + maximumPorts * opts.portPitch)
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
    circuits.forEach((circuit) => {
      const sourceOccurrence = occurrenceByRole.get(circuit.id + ':FROM');
      const targetOccurrence = occurrenceByRole.get(circuit.id + ':TO');
      const sourceCorridor = corridorIndex(circuit.from, sourceOccurrence.side);
      const targetCorridor = corridorIndex(circuit.to, targetOccurrence.side);
      const sourceRow = cells.get(circuit.from).row;
      const targetRow = cells.get(circuit.to).row;
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
    const verticalGapLeft = [];
    const columnLeft = [];
    let xCursor = opts.left;
    for (let gap = 0; gap <= columns; gap += 1) {
      verticalGapLeft[gap] = xCursor;
      xCursor += verticalGapWidths[gap];
      if (gap < columns) {
        columnLeft[gap] = xCursor;
        xCursor += opts.deviceWidth;
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
      ['LEFT', 'RIGHT'].forEach((side) => sides[side].forEach((occurrence) => {
        const draft = anchorDrafts.get(occurrence.id);
        const terminal = occurrence.terminal || {};
        const anchor = {
          id: occurrence.terminalId + '@' + (occurrence.circuitId || 'OPEN') + '@' + occurrence.role,
          ref: endpointKey(instance.id, occurrence.terminalId),
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

    const routes = circuits.map((circuit) => {
      const entry = circuitPlan.get(circuit.id);
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
          portId: circuit.fromPort, x: sourceAnchor.x, y: sourceAnchor.y
        },
        target: {
          ref: endpointKey(circuit.to, circuit.toPort), deviceId: circuit.to,
          portId: circuit.toPort, x: targetAnchor.x, y: targetAnchor.y
        },
        points,
        layer: LAYER_BY_NET_CLASS[netClass] || 'EVSE-CTL',
        bridgePriority: /^POWER_/.test(netClass || '') || netClass === 'PROTECTIVE_EARTH' ? 20 : 10
      });
    });

    const drawingIR = IR.buildDrawingIR({
      devices: placedDevices,
      routes,
      model: design,
      metadata: {
        sourceModelSchema: design.schemaVersion || '',
        placementSchema: GRID_SCHEMA,
        placementVersion: VERSION,
        circuitCount: circuits.length,
        netCount: nets.length,
        instanceCount: instances.length
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
      width: contentRight + opts.scheduleWidth + opts.rightMargin,
      height: contentBottom + opts.bottomMargin,
      content: Object.freeze({ left: opts.left, top: opts.top, right: contentRight, bottom: contentBottom }),
      schedule: Object.freeze({ x: contentRight + 24, y: opts.top, width: opts.scheduleWidth - 34 }),
      rows,
      columns,
      rowTop: Object.freeze(rowTop.slice()),
      rowHeights: Object.freeze(rowHeights.slice()),
      columnLeft: Object.freeze(columnLeft.slice()),
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
      nets: Object.freeze(nets.slice()),
      circuits: Object.freeze(circuits.slice()),
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
    endpointKey,
    shortTag,
    validateDesign,
    compile,
    build: compile
  });
});
