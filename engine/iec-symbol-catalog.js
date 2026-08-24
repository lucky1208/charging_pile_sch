/* ============================================================
 * EVSE native IEC-style symbol catalog v1
 * ------------------------------------------------------------
 * Renderer-neutral electrical symbols for the Drawing IR pipeline.
 *
 * The catalog intentionally contains geometry primitives, not SVG markup.
 * SVG and DXF therefore consume exactly the same line/polyline/circle/arc/
 * rect/text description.  The IEC 60617 references below identify the
 * source convention used when redrawing each symbol for this application;
 * they are not claims that this small concept drawing is an IEC certified
 * symbol library.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_IEC_SYMBOL_CATALOG = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.1.0';
  const SCHEMA = 'evse-iec-symbol-catalog/v1';
  const FALLBACK_SYMBOL_ID = 'evse.function-block.generic';

  const KIND_TO_SYMBOL = Object.freeze({
    'ac-incomer': 'iec.connector.incomer',
    'ac-isolator': 'iec.switch.disconnector',
    'ac-breaker': 'iec.switch.circuit-breaker',
    'surge-protector': 'iec.protection.surge',
    'residual-current-monitor': 'iec.monitor.residual-current',
    'ac-contactor': 'iec.switch.contactor-ac',
    'ac-meter': 'iec.meter.energy-ac',
    'ac-busbar': 'iec.distribution.busbar-ac',
    'power-module-array': 'iec.converter.acdc-array',
    'dc-busbar': 'iec.distribution.busbar-dc',
    'dc-fuse': 'iec.protection.fuse-dc',
    'dc-contactor': 'iec.switch.contactor-dc',
    'current-transducer': 'iec.monitor.current-transducer',
    'insulation-monitor': 'iec.monitor.insulation',
    'dc-meter': 'iec.meter.energy-dc',
    'charge-connector': 'iec.connector.ev-charge',
    'connector-lock': 'iec.actuator.connector-lock',
    'charge-controller': 'iec.control.charge-controller',
    'comm-gateway': 'iec.control.communication-gateway',
    'hmi-unit': 'iec.control.hmi',
    'safety-device': 'iec.switch.safety',
    'aux-psu': 'iec.converter.aux-power',
    'aux-busbar': 'iec.distribution.terminal-block',
    'thermal-unit': 'iec.auxiliary.thermal-management',
    'earth-bar': 'iec.earth.protective-bar',
    'battery-cluster': 'iec.source.battery',
    'ess-fuse': 'iec.protection.fuse-ess',
    'ess-contactor': 'iec.switch.contactor-ess',
    'precharge-contactor': 'iec.switch.contactor-precharge',
    'precharge-resistor': 'iec.passive.resistor-precharge',
    'ess-busbar': 'iec.distribution.busbar-ess',
    'bms-controller': 'iec.control.bms',
    'ess-dcdc': 'iec.converter.dcdc-bidirectional',
    'ess-pcs': 'iec.converter.pcs-bidirectional',
    'discharge-resistor': 'iec.passive.resistor-discharge',
    'indicator-lamp': 'iec.indicator.lamp',
    'environment-sensor': 'iec.sensor.environment'
    , 'split-interface': 'iec.connector.split-interface'
    , 'ac-charge-connector': 'iec.connector.ev-charge-ac'
    , 'dc-charge-inlet': 'iec.connector.ev-charge-dc-inlet'
    , 'dc-dc-charge-module': 'iec.converter.dcdc-charge'
    , 'hv-aux-converter': 'iec.converter.hv-auxiliary'
    , 'aux-dc-converter': 'iec.converter.aux-dcdc'
    , 'interface-12v-supply': 'iec.converter.interface-12v'
    , 'four-pole-safety': 'iec.switch.safety-four-pole'
    , 'battery-heater': 'iec.load.battery-heater'
    , 'ac-ev-transformer': 'iec.transformer.ev-isolation'
    , 'battery-box': 'iec.source.battery'
    , 'touch-display': 'iec.control.touch-display'
    , 'card-reader': 'iec.control.card-reader'
    , 'voice-board': 'iec.control.voice-board'
    , 'loudspeaker': 'iec.output.loudspeaker'
    , 'selector-switch-dual': 'iec.switch.selector-dual'
    , 'external-connector-12pin': 'iec.connector.external-12pin'
    , 'control-relay': 'iec.relay.control'
    , 'temperature-sensor': 'iec.sensor.temperature-passive'
    , 'ac-dc-mode-interlock': 'iec.control.ac-dc-mode-interlock'
    , 'heating-connector-2pin': 'iec.connector.heater-two-pole'
    , 'rf-antenna': 'iec.communication.rf-antenna'
    , 'nacs-shared-inlet': 'iec.connector.nacs-shared-inlet'
    , 'ac-dc-power-selector': 'iec.switch.ac-dc-power-selector'
  });

  const CURRENT_DEVICE_KINDS = Object.freeze(Object.keys(KIND_TO_SYMBOL).sort());

  function definition(id, family, title, iecReferences, functionCode) {
    return Object.freeze({
      id,
      family,
      title,
      iecReferences: Object.freeze((iecReferences || []).slice()),
      functionCode: String(functionCode || ''),
      elementary: family === 'elementary'
    });
  }

  const DEFINITIONS = Object.freeze({
    'iec.connector.incomer': definition('iec.connector.incomer', 'elementary', 'Supply inlet', ['IEC-60617-0003', 'IEC-60617-0011'], 'IN'),
    'iec.switch.disconnector': definition('iec.switch.disconnector', 'elementary', 'Disconnector', ['IEC-60617-0083'], 'QS'),
    'iec.switch.circuit-breaker': definition('iec.switch.circuit-breaker', 'elementary', 'Circuit breaker', ['IEC-60617-0082'], 'QF'),
    'iec.protection.surge': definition('iec.protection.surge', 'elementary', 'Surge protective device', ['IEC-60617-0115'], 'SPD'),
    'iec.monitor.residual-current': definition('iec.monitor.residual-current', 'elementary', 'Residual-current monitor', ['IEC-60617-0273', 'IEC-60617-0104'], 'RCM'),
    'iec.switch.contactor-ac': definition('iec.switch.contactor-ac', 'elementary', 'AC contactor', ['IEC-60617-0079', 'IEC-60617-0097'], 'KM'),
    'iec.meter.energy-ac': definition('iec.meter.energy-ac', 'function-block', 'AC energy meter', ['IEC-60617-0319'], 'kWh~'),
    'iec.distribution.busbar-ac': definition('iec.distribution.busbar-ac', 'elementary', 'AC busbar', ['IEC-60617-0012'], 'BUS~'),
    'iec.converter.acdc-array': definition('iec.converter.acdc-array', 'function-block', 'AC/DC module array', ['IEC-60617-0050', 'IEC-60617-0314'], 'AC/DC'),
    'iec.distribution.busbar-dc': definition('iec.distribution.busbar-dc', 'elementary', 'DC busbar', ['IEC-60617-0012'], 'BUS='),
    'iec.protection.fuse-dc': definition('iec.protection.fuse-dc', 'elementary', 'DC fuse', ['IEC-60617-0105'], 'FU'),
    'iec.switch.contactor-dc': definition('iec.switch.contactor-dc', 'elementary', 'DC contactor', ['IEC-60617-0079', 'IEC-60617-0097'], 'K'),
    'iec.monitor.current-transducer': definition('iec.monitor.current-transducer', 'elementary', 'Current transducer', ['IEC-60617-0273'], 'I'),
    'iec.monitor.insulation': definition('iec.monitor.insulation', 'function-block', 'Insulation monitoring device', ['IEC-60617-0104'], 'IMD'),
    'iec.meter.energy-dc': definition('iec.meter.energy-dc', 'function-block', 'DC energy meter', ['IEC-60617-0319'], 'kWh='),
    'iec.connector.ev-charge': definition('iec.connector.ev-charge', 'elementary', 'EV charging connector', ['IEC-60617-0024'], 'EV'),
    'iec.actuator.connector-lock': definition('iec.actuator.connector-lock', 'function-block', 'Connector lock actuator', ['IEC-60617-0097'], 'LOCK'),
    'iec.control.charge-controller': definition('iec.control.charge-controller', 'function-block', 'Charge control unit', [], 'CCU'),
    'iec.control.communication-gateway': definition('iec.control.communication-gateway', 'function-block', 'Communication gateway', [], 'GW'),
    'iec.control.hmi': definition('iec.control.hmi', 'function-block', 'Human-machine interface', [], 'HMI'),
    'iec.switch.safety': definition('iec.switch.safety', 'elementary', 'Safety switch', ['IEC-60617-0072', 'IEC-60617-0076', 'IEC-60617-0077'], 'S0'),
    'iec.converter.aux-power': definition('iec.converter.aux-power', 'function-block', 'Auxiliary power supply', ['IEC-60617-0050', 'IEC-60617-0314'], 'AC/DC\n24V'),
    'iec.distribution.terminal-block': definition('iec.distribution.terminal-block', 'elementary', 'Auxiliary terminal block', ['IEC-60617-0012'], 'X'),
    'iec.auxiliary.thermal-management': definition('iec.auxiliary.thermal-management', 'elementary', 'Fan or pump', ['IEC-60617-0370', 'IEC-60617-0371'], 'M'),
    'iec.earth.protective-bar': definition('iec.earth.protective-bar', 'elementary', 'Protective-earth bar', ['IEC-60617-0044', 'IEC-60617-0041'], 'PE'),
    'iec.source.battery': definition('iec.source.battery', 'elementary', 'Battery cluster', ['IEC-60617-0353'], 'BAT'),
    'iec.protection.fuse-ess': definition('iec.protection.fuse-ess', 'elementary', 'ESS fuse', ['IEC-60617-0105'], 'FU'),
    'iec.switch.contactor-ess': definition('iec.switch.contactor-ess', 'elementary', 'ESS contactor', ['IEC-60617-0079', 'IEC-60617-0097'], 'K'),
    'iec.switch.contactor-precharge': definition('iec.switch.contactor-precharge', 'elementary', 'Precharge contactor', ['IEC-60617-0079', 'IEC-60617-0097'], 'Kp'),
    'iec.passive.resistor-precharge': definition('iec.passive.resistor-precharge', 'elementary', 'Precharge resistor', ['IEC-60617-0188'], 'Rp'),
    'iec.distribution.busbar-ess': definition('iec.distribution.busbar-ess', 'elementary', 'ESS busbar', ['IEC-60617-0012'], 'BUS'),
    'iec.control.bms': definition('iec.control.bms', 'function-block', 'Battery management system', [], 'BMS'),
    'iec.converter.dcdc-bidirectional': definition('iec.converter.dcdc-bidirectional', 'function-block', 'Bidirectional DC/DC converter', ['IEC-60617-0313'], 'DC<->DC'),
    'iec.converter.pcs-bidirectional': definition('iec.converter.pcs-bidirectional', 'function-block', 'Bidirectional power conversion system', ['IEC-60617-0050'], 'PCS<->'),
    'iec.passive.resistor-discharge': definition('iec.passive.resistor-discharge', 'elementary', 'Discharge resistor', ['IEC-60617-0188'], 'Rd'),
    'iec.indicator.lamp': definition('iec.indicator.lamp', 'elementary', 'Indicator lamp', ['IEC-60617-0325'], 'H'),
    'iec.sensor.environment': definition('iec.sensor.environment', 'function-block', 'Environmental sensor', ['IEC-60617-0320'], 'T/RH'),
    'iec.connector.split-interface': definition('iec.connector.split-interface', 'elementary', 'Split cabinet / dispenser interface', ['IEC-60617-0024', 'IEC-60617-0012'], 'X-SPLIT'),
    'iec.connector.ev-charge-ac': definition('iec.connector.ev-charge-ac', 'elementary', 'AC EV charging connector', ['IEC-60617-0024'], 'EV~'),
    'iec.connector.ev-charge-dc-inlet': definition('iec.connector.ev-charge-dc-inlet', 'elementary', 'DC supplementary-charge inlet', ['IEC-60617-0024'], 'IN='),
    'iec.converter.dcdc-charge': definition('iec.converter.dcdc-charge', 'function-block', 'ESS charging DC/DC module', ['IEC-60617-0313'], 'DC/DC\nCHG'),
    'iec.converter.hv-auxiliary': definition('iec.converter.hv-auxiliary', 'function-block', 'High-voltage to 24 V auxiliary converter', ['IEC-60617-0313'], 'HV/24V'),
    'iec.converter.aux-dcdc': definition('iec.converter.aux-dcdc', 'function-block', '24 V to 12 V auxiliary converter', ['IEC-60617-0313'], '24/12V'),
    'iec.converter.interface-12v': definition('iec.converter.interface-12v', 'function-block', 'Isolated 12 V interface supply', ['IEC-60617-0313'], 'ISO\n12V'),
    'iec.switch.safety-four-pole': definition('iec.switch.safety-four-pole', 'elementary', 'Four-pole mechanically linked safety switch', ['IEC-60617-0072', 'IEC-60617-0076', 'IEC-60617-0077'], 'S4'),
    'iec.load.battery-heater': definition('iec.load.battery-heater', 'elementary', 'Battery high-voltage heater', ['IEC-60617-0188'], 'HTR'),
    'iec.transformer.ev-isolation': definition('iec.transformer.ev-isolation', 'elementary', 'EV charging isolation transformer', ['IEC-60617-0048', 'IEC-60617-0050'], 'T'),
    'iec.control.touch-display': definition('iec.control.touch-display', 'function-block', 'Touch display', [], 'TOUCH\nHMI'),
    'iec.control.card-reader': definition('iec.control.card-reader', 'function-block', 'Card reader', [], 'CARD'),
    'iec.control.voice-board': definition('iec.control.voice-board', 'function-block', 'Voice control board', [], 'VOICE'),
    'iec.output.loudspeaker': definition('iec.output.loudspeaker', 'elementary', 'Loudspeaker / acoustic output', ['IEC-60617-0367'], 'SPK'),
    'iec.switch.selector-dual': definition('iec.switch.selector-dual', 'elementary', 'Mechanically linked dual selector contact', ['IEC-60617-0072', 'IEC-60617-0076'], 'S2'),
    'iec.connector.external-12pin': definition('iec.connector.external-12pin', 'elementary', '12-core external connector', ['IEC-60617-0012', 'IEC-60617-0024'], 'X12'),
    'iec.relay.control': definition('iec.relay.control', 'elementary', 'Control relay with coil and contact', ['IEC-60617-0079', 'IEC-60617-0097'], 'K'),
    'iec.sensor.temperature-passive': definition('iec.sensor.temperature-passive', 'elementary', 'Passive two-wire temperature sensor', ['IEC-60617-0320'], 'ϑ'),
    'iec.control.ac-dc-mode-interlock': definition('iec.control.ac-dc-mode-interlock', 'function-block', 'Mutually exclusive AC/DC mode hard interlock', [], '=1\nAC/DC'),
    'iec.connector.heater-two-pole': definition('iec.connector.heater-two-pole', 'elementary', 'Two-pole high-voltage heater connector', ['IEC-60617-0023', 'IEC-60617-0024'], 'XH2'),
    'iec.communication.rf-antenna': definition('iec.communication.rf-antenna', 'elementary', 'RF antenna', ['IEC-60617-0352'], 'ANT'),
    'iec.connector.nacs-shared-inlet': definition('iec.connector.nacs-shared-inlet', 'elementary', 'Single physical NACS AC/DC shared inlet', ['IEC-60617-0024', 'IEC-60617-0025'], 'NACS'),
    'iec.switch.ac-dc-power-selector': definition('iec.switch.ac-dc-power-selector', 'elementary', 'Double-pole AC/DC power mode selector', ['IEC-60617-0058'], 'QS2'),
    'evse.function-block.generic': definition('evse.function-block.generic', 'function-block', 'Generic controlled function', [], 'FUNC')
  });

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeBbox(value) {
    const box = value || {};
    const xMin = finite(box.xMin, finite(box.x, 0));
    const yMin = finite(box.yMin, finite(box.y, 0));
    const width = finite(box.width, finite(box.xMax, xMin + 120) - xMin);
    const height = finite(box.height, finite(box.yMax, yMin + 64) - yMin);
    if (!(width > 0) || !(height > 0)) throw new Error('IEC symbol bbox must have positive dimensions.');
    return { xMin, yMin, xMax: xMin + width, yMax: yMin + height, width, height };
  }

  function comparePorts(a, b) {
    const coordinateOrder = finite(a.y, 0) - finite(b.y, 0) || finite(a.x, 0) - finite(b.x, 0);
    if (coordinateOrder) return coordinateOrder;
    const aa = String(a.id || '');
    const bb = String(b.id || '');
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  }

  function primitiveBuilder(spec, definitionValue) {
    const box = normalizeBbox(spec.bbox);
    const ports = (Array.isArray(spec.ports) ? spec.ports : []).slice().sort(comparePorts);
    const primitives = [];
    const titleBand = Math.max(2, Math.min(16, box.height * 0.23));
    const padX = Math.max(1, Math.min(14, box.width * 0.12));
    const padBottom = Math.max(1, Math.min(9, box.height * 0.12));
    const left = box.xMin + padX;
    const right = box.xMax - padX;
    const top = box.yMin + titleBand;
    const bottom = box.yMax - padBottom;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const w = right - left;
    const h = bottom - top;
    const scale = Math.max(4, Math.min(w, h));

    function add(kind, geometry, role, style) {
      primitives.push(Object.assign({
        kind,
        symbolRole: role || 'glyph',
        strokeWidth: 1.15,
        fill: 'none'
      }, geometry || {}, style || {}));
    }
    function line(x1, y1, x2, y2, role, style) {
      add('line', { x1, y1, x2, y2 }, role, style);
    }
    function polyline(points, role, style, closed) {
      add('polyline', { points: points.map((point) => ({ x: point.x, y: point.y })), closed: closed === true }, role, style);
    }
    function circle(x, y, radius, role, style) {
      add('circle', { x, y, radius }, role, style);
    }
    function arc(x, y, radius, startAngle, endAngle, role, style) {
      add('arc', { x, y, radius, startAngle, endAngle }, role, style);
    }
    function rect(x, y, width, height, role, style) {
      add('rect', { x, y, width, height }, role, style);
    }
    function text(x, y, value, role, options) {
      const opts = options || {};
      add('text', {
        x, y, text: String(value == null ? '' : value),
        height: finite(opts.height, 10),
        anchor: opts.anchor || 'middle',
        weight: opts.weight || 'normal',
        rotation: finite(opts.rotation, 0)
      }, role || 'function-code', { strokeWidth: 0, fill: 'ink' });
    }
    function lead(port, targetX, targetY, role) {
      const px = finite(port.x, box.xMin);
      const py = finite(port.y, cy);
      const points = [{ x: px, y: py }];
      if (String(port.side || '').toUpperCase() === 'LEFT' || px <= cx) {
        const elbowX = Math.min(targetX, box.xMin + padX * 0.58);
        if (Math.abs(px - elbowX) > 1e-9) points.push({ x: elbowX, y: py });
        if (Math.abs(py - targetY) > 1e-9) points.push({ x: elbowX, y: targetY });
      } else {
        const elbowX = Math.max(targetX, box.xMax - padX * 0.58);
        if (Math.abs(px - elbowX) > 1e-9) points.push({ x: elbowX, y: py });
        if (Math.abs(py - targetY) > 1e-9) points.push({ x: elbowX, y: targetY });
      }
      points.push({ x: targetX, y: targetY });
      const clean = points.filter((point, index) => index === 0 ||
        Math.abs(point.x - points[index - 1].x) > 1e-9 || Math.abs(point.y - points[index - 1].y) > 1e-9);
      if (clean.length >= 2) polyline(clean, role || 'terminal-lead', { strokeWidth: 0.9 });
    }
    function uniquePorts(predicate) {
      const seen = new Set();
      return ports.filter((port) => !predicate || predicate(port)).filter((port) => {
        const terminal = String(port.terminalId || port.id || '');
        if (seen.has(terminal)) return false;
        seen.add(terminal);
        return true;
      });
    }
    function portsBySide(predicate) {
      const source = uniquePorts(predicate);
      return {
        left: source.filter((port) => String(port.side || '').toUpperCase() === 'LEFT' || finite(port.x, cx) <= cx).sort(comparePorts),
        right: source.filter((port) => String(port.side || '').toUpperCase() === 'RIGHT' || finite(port.x, cx) > cx).sort(comparePorts)
      };
    }
    function title() {
      const value = String(spec.tag || spec.label || spec.kind || '').trim();
      if (value) text((box.xMin + box.xMax) / 2, box.yMin + Math.min(7.5, titleBand * 0.48), value,
        'device-title', { height: Math.max(8, Math.min(11, titleBand * 0.68)), weight: 'bold' });
    }
    function portLabels() {
      uniquePorts().forEach((port) => {
        const isLeft = String(port.side || '').toUpperCase() === 'LEFT' || finite(port.x, cx) <= cx;
        text(isLeft ? box.xMin + 3.2 : box.xMax - 3.2, finite(port.y, cy) - 1.7,
          String(port.label || port.terminalId || ''), 'terminal-label', {
            height: 10, anchor: isLeft ? 'start' : 'end'
          });
      });
    }
    function frame(code, secondary) {
      rect(left, top, w, h, 'function-frame', { strokeWidth: 1.25, fill: 'paper' });
      line(left + w * 0.1, bottom - h * 0.12, right - w * 0.1, top + h * 0.12,
        'conversion-diagonal', { strokeWidth: 0.85 });
      const codes = String(code || definitionValue.functionCode || 'FUNC').split(/\n/);
      codes.forEach((item, index) => text(cx, cy - (codes.length - 1) * 3 + index * 6, item,
        'function-code', { height: Math.max(9, Math.min(13, scale * 0.28)), weight: 'bold' }));
      if (secondary) text(cx, bottom - 5, secondary, 'function-secondary', { height: 8 });
      ports.forEach((port) => {
        const isLeft = String(port.side || '').toUpperCase() === 'LEFT' || finite(port.x, cx) <= cx;
        lead(port, isLeft ? left : right, finite(port.y, cy));
      });
    }
    function busbar(code) {
      const busX = cx;
      line(busX, top + h * 0.08, busX, bottom - h * 0.08, 'busbar', { strokeWidth: 2.8 });
      ports.forEach((port) => lead(port, busX, finite(port.y, cy), 'busbar-tap'));
      text(cx + Math.max(6, w * 0.12), cy, code || definitionValue.functionCode, 'function-code', {
        height: Math.max(8, Math.min(11, scale * 0.24)), anchor: 'start', rotation: -90
      });
    }
    function inlineRows(shape, filter) {
      const sides = portsBySide(filter);
      const count = Math.max(sides.left.length, sides.right.length, 1);
      const spanTop = top + Math.max(2, h * 0.08);
      const spanBottom = bottom - Math.max(2, h * 0.08);
      const bodyHalf = Math.max(8, Math.min(18, w * 0.18));
      const bodyLeft = cx - bodyHalf;
      const bodyRight = cx + bodyHalf;
      for (let index = 0; index < count; index += 1) {
        const leftPort = sides.left[index] || null;
        const rightPort = sides.right[index] || null;
        const y = count === 1 ? cy : spanTop + index * (spanBottom - spanTop) / (count - 1);
        if (leftPort) ports.filter((port) => String(port.terminalId || port.id) === String(leftPort.terminalId || leftPort.id))
          .forEach((port) => lead(port, bodyLeft, y));
        else line(left, y, bodyLeft, y, 'internal-lead');
        if (rightPort) ports.filter((port) => String(port.terminalId || port.id) === String(rightPort.terminalId || rightPort.id))
          .forEach((port) => lead(port, bodyRight, y));
        else line(bodyRight, y, right, y, 'internal-lead');
        shape({ y, bodyLeft, bodyRight, index, count });
      }
      return { sides, count, bodyHalf };
    }

    return {
      box, ports, primitives, left, right, top, bottom, cx, cy, w, h, scale,
      add, line, polyline, circle, arc, rect, text, lead, uniquePorts, portsBySide,
      title, portLabels, frame, busbar, inlineRows
    };
  }

  function isPowerPort(port) {
    return /^POWER_/.test(String(port.netClass || '')) ||
      /^(?:AC_MAINS|HV_DC)/.test(String(port.domain || ''));
  }

  function drawSwitch(builder, variant) {
    const b = builder;
    const result = b.inlineRows((row) => {
      const contactOffset = Math.max(2.4, Math.min(4.2, (row.bodyRight - row.bodyLeft) * 0.14));
      b.circle(row.bodyLeft + contactOffset, row.y, 1.15, 'fixed-contact', { fill: 'paper', strokeWidth: 1 });
      b.circle(row.bodyRight - contactOffset, row.y, 1.15, 'fixed-contact', { fill: 'paper', strokeWidth: 1 });
      b.line(row.bodyLeft + contactOffset + 1, row.y - 0.3,
        row.bodyRight - contactOffset - 1, row.y - Math.max(3.5, b.h * 0.12), 'moving-contact', { strokeWidth: 1.45 });
      if (variant === 'breaker') {
        const mx = b.cx;
        b.line(mx - 2.8, row.y + 2.6, mx + 2.8, row.y - 2.6, 'trip-release', { strokeWidth: 0.85 });
        b.line(mx - 2.8, row.y - 2.6, mx + 2.8, row.y + 2.6, 'trip-release', { strokeWidth: 0.85 });
      }
    }, isPowerPort);
    if (result.count > 1) {
      b.line(b.cx, b.top + 1, b.cx, b.bottom - 1, 'mechanical-linkage', {
        strokeWidth: 0.65, dash: '3,2'
      });
    }
    if (variant === 'contactor') {
      const coilY = b.bottom - Math.max(4, b.h * 0.1);
      b.rect(b.cx - 7, coilY - 2.8, 14, 5.6, 'contactor-coil', { strokeWidth: 1 });
      b.text(b.cx, coilY + 1.4, 'A1  A2', 'coil-label', { height: 8 });
      b.ports.filter((port) => !isPowerPort(port)).forEach((port) => {
        const isLeft = String(port.side || '').toUpperCase() === 'LEFT' || port.x <= b.cx;
        b.lead(port, isLeft ? b.cx - 7 : b.cx + 7, coilY, 'coil-lead');
      });
    }
  }

  function drawFuse(builder) {
    builder.inlineRows((row) => {
      const width = row.bodyRight - row.bodyLeft;
      builder.line(row.bodyLeft, row.y, row.bodyLeft + width * 0.18, row.y, 'fuse-lead');
      builder.rect(row.bodyLeft + width * 0.18, row.y - 2.3, width * 0.64, 4.6,
        'fuse-element', { fill: 'paper', strokeWidth: 1.15 });
      builder.line(row.bodyLeft + width * 0.82, row.y, row.bodyRight, row.y, 'fuse-lead');
      builder.line(row.bodyLeft + width * 0.25, row.y + 1.2,
        row.bodyLeft + width * 0.75, row.y - 1.2, 'fusible-link', { strokeWidth: 0.8 });
    }, isPowerPort);
  }

  function drawResistor(builder) {
    builder.inlineRows((row) => {
      const width = row.bodyRight - row.bodyLeft;
      builder.line(row.bodyLeft, row.y, row.bodyLeft + width * 0.18, row.y, 'resistor-lead');
      builder.rect(row.bodyLeft + width * 0.18, row.y - 3.1, width * 0.64, 6.2,
        'resistor-body', { fill: 'paper', strokeWidth: 1.15 });
      builder.line(row.bodyLeft + width * 0.82, row.y, row.bodyRight, row.y, 'resistor-lead');
    }, isPowerPort);
  }

  function drawCurrentTransducer(builder) {
    builder.inlineRows((row) => {
      builder.line(row.bodyLeft, row.y, row.bodyRight, row.y, 'primary-conductor', { strokeWidth: 1.3 });
      builder.circle(builder.cx, row.y, Math.max(4, Math.min(7, (row.bodyRight - row.bodyLeft) * 0.23)),
        'magnetic-core', { fill: 'paper', strokeWidth: 1.15 });
    }, isPowerPort);
    builder.text(builder.cx, builder.cy + Math.min(3, builder.h * 0.08), 'I', 'function-code', {
      height: Math.max(8, Math.min(11, builder.scale * 0.24)), weight: 'bold'
    });
    builder.ports.filter((port) => !isPowerPort(port)).forEach((port) => {
      const isLeft = String(port.side || '').toUpperCase() === 'LEFT' || port.x <= builder.cx;
      builder.lead(port, isLeft ? builder.cx - 5 : builder.cx + 5, builder.bottom - 2, 'signal-lead');
    });
  }

  function drawIncomer(builder) {
    const b = builder;
    const x = b.cx;
    b.line(x, b.top + 2, x, b.bottom - 2, 'terminal-spine', { strokeWidth: 1.8 });
    b.ports.forEach((port) => {
      b.lead(port, x, port.y, 'supply-conductor');
      b.circle(x, port.y, 1.25, 'terminal', { fill: 'paper', strokeWidth: 1 });
    });
    b.polyline([
      { x: x - 8, y: b.cy - 5 }, { x, y: b.cy }, { x: x - 8, y: b.cy + 5 }
    ], 'supply-direction', { strokeWidth: 1.2 });
  }

  function drawSurgeProtector(builder) {
    const b = builder;
    b.ports.forEach((port) => {
      const isLeft = String(port.side || '').toUpperCase() === 'LEFT' || port.x <= b.cx;
      b.lead(port, isLeft ? b.left : b.right, port.y);
    });
    const bodyW = Math.max(14, Math.min(24, b.w * 0.34));
    const bodyH = Math.max(13, Math.min(22, b.h * 0.55));
    b.rect(b.cx - bodyW / 2, b.cy - bodyH / 2, bodyW, bodyH, 'varistor-body', { fill: 'paper' });
    b.line(b.cx - bodyW * 0.35, b.cy + bodyH * 0.3, b.cx + bodyW * 0.35, b.cy - bodyH * 0.3,
      'varistor-diagonal');
    b.line(b.cx + bodyW * 0.05, b.cy - bodyH * 0.38, b.cx + bodyW * 0.42, b.cy - bodyH * 0.38,
      'varistor-marker', { strokeWidth: 0.8 });
    b.text(b.cx, b.cy + 1.7, 'SPD', 'function-code', { height: 9, weight: 'bold' });
  }

  function drawTransformer(builder) {
    const b = builder;
    b.inlineRows((row) => {
      const radius = Math.max(3.8, Math.min(5.8, (row.bodyRight - row.bodyLeft) * 0.13));
      const primaryX = b.cx - radius * 1.25;
      const secondaryX = b.cx + radius * 1.25;
      b.line(row.bodyLeft, row.y, primaryX - radius, row.y, 'primary-lead');
      b.circle(primaryX, row.y, radius, 'primary-winding', { fill: 'paper', strokeWidth: 1.15 });
      b.circle(secondaryX, row.y, radius, 'secondary-winding', { fill: 'paper', strokeWidth: 1.15 });
      b.line(secondaryX + radius, row.y, row.bodyRight, row.y, 'secondary-lead');
      b.line(b.cx - 1.4, row.y - radius * 1.35, b.cx - 1.4, row.y + radius * 1.35,
        'magnetic-core', { strokeWidth: 1.4 });
      b.line(b.cx + 1.4, row.y - radius * 1.35, b.cx + 1.4, row.y + radius * 1.35,
        'magnetic-core', { strokeWidth: 1.4 });
    }, isPowerPort);
  }

  function drawLoudspeaker(builder) {
    const b = builder;
    const magnetX = b.cx - Math.max(6, b.w * 0.08);
    const coneMouthX = b.cx + Math.max(8, b.w * 0.13);
    const half = Math.max(6, Math.min(11, b.h * 0.2));
    b.rect(magnetX - 5, b.cy - half * 0.52, 5, half * 1.04,
      'speaker-magnet', { fill: 'paper', strokeWidth: 1.2 });
    b.polyline([
      { x: magnetX, y: b.cy - half * 0.52 },
      { x: coneMouthX, y: b.cy - half },
      { x: coneMouthX, y: b.cy + half },
      { x: magnetX, y: b.cy + half * 0.52 }
    ], 'speaker-cone', { fill: 'paper', strokeWidth: 1.3 }, true);
    [half * 0.72, half * 1.16].forEach((radius) => b.arc(
      coneMouthX + 1, b.cy, radius, -48, 48, 'acoustic-wave', { strokeWidth: 0.9 }
    ));
    const audioPorts = b.ports.slice().sort(comparePorts);
    audioPorts.forEach((port, index) => {
      const targetY = b.cy + (index % 2 === 0 ? -half * 0.3 : half * 0.3);
      const leftSide = String(port.side || '').toUpperCase() === 'LEFT' || finite(port.x, b.cx) <= b.cx;
      b.lead(port, leftSide ? magnetX - 5 : coneMouthX, targetY, 'audio-lead');
    });
  }

  function drawSelectorDual(builder) {
    const b = builder;
    const rows = [b.cy - Math.max(7, b.h * 0.16), b.cy + Math.max(7, b.h * 0.16)];
    const contactLeft = b.cx - Math.max(8, b.w * 0.1);
    const contactRight = b.cx + Math.max(8, b.w * 0.1);
    rows.forEach((y) => {
      b.circle(contactLeft, y, 1.5, 'fixed-contact', { fill: 'paper', strokeWidth: 1 });
      b.circle(contactRight, y, 1.5, 'fixed-contact', { fill: 'paper', strokeWidth: 1 });
      /* The evidence does not establish NO or NC.  A centred, detached
         blade records a neutral contact without inventing either state. */
      b.line(contactLeft + 4, y, contactRight - 4, y, 'neutral-contact', { strokeWidth: 1.35 });
    });
    b.line(b.cx, rows[0] + 2.5, b.cx, rows[1] - 2.5,
      'mechanical-linkage', { dash: '3,2', strokeWidth: 0.8 });
    b.circle(b.cx, rows[0] - Math.max(5, b.h * 0.1), 2.2,
      'selector-actuator', { fill: 'paper', strokeWidth: 1 });
    const terminalRow = (port) => /^(?:TX_|.*CONTACT_2)/i.test(String(port.terminalId || port.id || '')) ? 1 : 0;
    b.ports.forEach((port) => {
      const leftSide = /(?:_5$|ENABLE$|CONTACT_\d+:?A$)/i.test(String(port.terminalId || port.id || '')) ||
        String(port.side || '').toUpperCase() === 'LEFT';
      b.lead(port, leftSide ? contactLeft : contactRight, rows[terminalRow(port)], 'selector-contact-lead');
    });
  }

  function drawExternalConnector(builder) {
    const b = builder;
    const shellWidth = Math.max(24, Math.min(40, b.w * 0.36));
    const shellHeight = Math.max(40, Math.min(78, b.h * 0.72));
    const shellLeft = b.cx - shellWidth / 2;
    const shellTop = b.cy - shellHeight / 2;
    b.rect(shellLeft, shellTop, shellWidth, shellHeight,
      'connector-shell', { fill: 'paper', strokeWidth: 1.3 });
    for (let index = 0; index < 12; index += 1) {
      const column = index < 6 ? 0 : 1;
      const row = index % 6;
      const x = shellLeft + shellWidth * (column ? 0.72 : 0.28);
      const y = shellTop + shellHeight * (row + 0.5) / 6;
      b.circle(x, y, 1.25, 'connector-pin', { fill: 'paper', strokeWidth: 0.85 });
      b.text(x + (column ? 3.2 : -3.2), y, String(index + 1), 'pin-number', {
        height: 8, anchor: column ? 'start' : 'end'
      });
    }
    b.ports.forEach((port) => {
      const numberMatch = /P(\d+)/i.exec(String(port.terminalId || port.id || ''));
      const pin = Math.max(1, Math.min(12, Number(numberMatch && numberMatch[1] || 1)));
      const row = (pin - 1) % 6;
      const y = shellTop + shellHeight * (row + 0.5) / 6;
      const leftSide = String(port.side || '').toUpperCase() === 'LEFT' || finite(port.x, b.cx) <= b.cx;
      b.lead(port, leftSide ? shellLeft : shellLeft + shellWidth, y, 'connector-core-lead');
    });
  }

  function drawControlRelay(builder) {
    const b = builder;
    const contactY = b.cy - Math.max(8, b.h * 0.17);
    const coilY = b.cy + Math.max(8, b.h * 0.2);
    const contactLeft = b.cx - Math.max(9, b.w * 0.1);
    const contactRight = b.cx + Math.max(9, b.w * 0.1);
    b.circle(contactLeft, contactY, 1.5, 'fixed-contact', { fill: 'paper', strokeWidth: 1 });
    b.circle(contactRight, contactY, 1.5, 'fixed-contact', { fill: 'paper', strokeWidth: 1 });
    b.line(contactLeft + 4, contactY, contactRight - 4, contactY,
      'neutral-contact', { strokeWidth: 1.35 });
    const coilWidth = Math.max(17, Math.min(28, b.w * 0.22));
    b.rect(b.cx - coilWidth / 2, coilY - 5, coilWidth, 10,
      'relay-coil', { fill: 'paper', strokeWidth: 1.2 });
    b.line(b.cx, contactY + 3, b.cx, coilY - 5,
      'mechanical-linkage', { dash: '3,2', strokeWidth: 0.8 });
    b.text(b.cx, coilY + 0.8, 'K', 'relay-code', { height: 8, weight: 'bold' });
    b.ports.forEach((port) => {
      const terminal = String(port.terminalId || port.id || '');
      const coil = /^COIL_/i.test(terminal);
      const leftSide = /(?:_POS|_IN)$/i.test(terminal) ||
        String(port.side || '').toUpperCase() === 'LEFT';
      b.lead(port,
        coil ? (leftSide ? b.cx - coilWidth / 2 : b.cx + coilWidth / 2) : (leftSide ? contactLeft : contactRight),
        coil ? coilY : contactY,
        coil ? 'relay-coil-lead' : 'relay-contact-lead');
    });
  }

  function drawTemperatureSensor(builder) {
    const b = builder;
    const radius = Math.max(7, Math.min(12, b.scale * 0.28));
    b.circle(b.cx, b.cy, radius, 'temperature-sensor-body', { fill: 'paper', strokeWidth: 1.25 });
    b.text(b.cx, b.cy + 0.8, 'ϑ', 'temperature-function', { height: 10, weight: 'bold' });
    const ports = b.ports.slice().sort(comparePorts);
    ports.forEach((port, index) => {
      const targetY = b.cy + (index % 2 === 0 ? -radius * 0.34 : radius * 0.34);
      const leftSide = String(port.side || '').toUpperCase() === 'LEFT' || finite(port.x, b.cx) <= b.cx;
      b.lead(port, leftSide ? b.cx - radius : b.cx + radius, targetY, 'sensor-lead');
    });
  }

  function drawModeInterlock(builder) {
    const b = builder;
    b.rect(b.left, b.top, b.w, b.h, 'function-frame', { fill: 'paper', strokeWidth: 1.3 });
    b.text(b.cx, b.cy - Math.max(7, b.h * 0.16), '=1', 'one-hot-function', {
      height: 11, weight: 'bold'
    });
    b.text(b.cx, b.cy + Math.max(7, b.h * 0.16), 'AC ⊻ DC', 'function-code', {
      height: 9, weight: 'bold'
    });
    const upperY = b.cy - Math.max(11, b.h * 0.28);
    const lowerY = b.cy + Math.max(11, b.h * 0.28);
    const outputX = b.right - Math.max(7, b.w * 0.08);
    [upperY, lowerY].forEach((y, index) => {
      b.circle(outputX - 5, y, 1.35, 'permission-contact', { fill: 'paper', strokeWidth: 0.9 });
      b.circle(outputX, y, 1.35, 'permission-contact', { fill: 'paper', strokeWidth: 0.9 });
      b.line(outputX - 3.2, y, outputX - 1.8, y, 'neutral-contact', { strokeWidth: 1 });
      b.text(outputX - 9, y, index ? 'DC' : 'AC', 'permission-label', {
        height: 8, anchor: 'end', weight: 'bold'
      });
    });
    b.line(outputX - 2.5, upperY + 3, outputX - 2.5, lowerY - 3,
      'mutual-exclusion-link', { dash: '3,2', strokeWidth: 0.85 });
    b.ports.forEach((port) => {
      const terminal = String(port.terminalId || port.id || '');
      let targetY = b.cy;
      if (/AC_PERMISSION/i.test(terminal)) targetY = upperY;
      else if (/DC_PERMISSION/i.test(terminal)) targetY = lowerY;
      else if (/PWR_/i.test(terminal)) targetY = b.bottom - Math.max(7, b.h * 0.12);
      const leftSide = String(port.side || '').toUpperCase() === 'LEFT' || finite(port.x, b.cx) <= b.cx;
      b.lead(port, leftSide ? b.left : b.right, targetY,
        /PERMISSION/i.test(terminal) ? 'permission-lead' : 'interlock-input-lead');
    });
  }

  function drawHeatingConnector(builder) {
    const b = builder;
    const rows = [b.cy - Math.max(8, b.h * 0.18), b.cy + Math.max(8, b.h * 0.18)];
    const panelX = b.cx - Math.max(10, b.w * 0.12);
    const batteryX = b.cx + Math.max(10, b.w * 0.12);
    rows.forEach((y, index) => {
      b.circle(panelX, y, 2.2, 'connector-socket', { fill: 'paper', strokeWidth: 1.2 });
      b.polyline([
        { x: batteryX - 3.5, y: y - 2.5 },
        { x: batteryX + 1.5, y },
        { x: batteryX - 3.5, y: y + 2.5 }
      ], 'connector-plug', { strokeWidth: 1.25 });
      b.line(panelX + 2.2, y, batteryX - 3.5, y,
        'connector-pole', { strokeWidth: 1.15 });
      b.text(b.cx, y - 5, index ? 'H05  −' : 'H02  +', 'pole-label', {
        height: 8, weight: 'bold'
      });
    });
    b.line(b.cx, rows[0] + 4, b.cx, rows[1] - 4,
      'connector-coupling', { dash: '3,2', strokeWidth: 0.8 });
    b.ports.forEach((port) => {
      const terminal = String(port.terminalId || port.id || '');
      const row = /H05/i.test(terminal) ? 1 : 0;
      const panel = /^PANEL_/i.test(terminal);
      b.lead(port, panel ? panelX : batteryX, rows[row], 'heater-core-lead');
    });
  }

  function drawRfAntenna(builder) {
    const b = builder;
    const mastBottom = b.bottom - Math.max(4, b.h * 0.08);
    const mastTop = b.top + Math.max(7, b.h * 0.18);
    b.line(b.cx, mastBottom, b.cx, mastTop, 'antenna-mast', { strokeWidth: 1.45 });
    b.line(b.cx, mastTop, b.cx - Math.max(10, b.w * 0.12), b.top + 1,
      'antenna-element', { strokeWidth: 1.35 });
    b.line(b.cx, mastTop, b.cx + Math.max(10, b.w * 0.12), b.top + 1,
      'antenna-element', { strokeWidth: 1.35 });
    [9, 15, 21].forEach((radius) => b.arc(
      b.cx + 3, mastTop + 1, radius, -52, 52, 'rf-wave', { strokeWidth: 0.9 }
    ));
    b.ports.forEach((port) => b.lead(port, b.cx, mastBottom, 'rf-feed'));
  }

  function drawNacsSharedInlet(builder) {
    const b = builder;
    const radius = Math.max(15, Math.min(24, b.scale * 0.48));
    b.circle(b.cx, b.cy, radius, 'connector-shell', { fill: 'paper', strokeWidth: 1.45 });
    b.arc(b.cx, b.cy, radius * 0.78, 205, 335, 'connector-key', { strokeWidth: 1 });
    const pins = {
      PWR_A: [-0.34, -0.28], PWR_B: [0.34, -0.28],
      CP: [-0.4, 0.28], PP: [0.4, 0.28], PE: [0, 0.48]
    };
    Object.keys(pins).forEach((terminal) => {
      const position = pins[terminal];
      const x = b.cx + position[0] * radius;
      const y = b.cy + position[1] * radius;
      b.circle(x, y, terminal.startsWith('PWR') ? 1.8 : 1.25,
        'connector-pin', { fill: terminal === 'PE' ? 'paper' : 'ink', strokeWidth: 0.75 });
      b.text(x, y - 4.2, terminal.replace('PWR_', ''), 'pin-label', {
        height: 8, weight: terminal.startsWith('PWR') ? 'bold' : 'normal'
      });
    });
    b.ports.forEach((port) => {
      const terminal = String(port.terminalId || port.id || '');
      const position = pins[terminal] || [0, 0];
      const pinY = b.cy + position[1] * radius;
      const leftSide = String(port.side || '').toUpperCase() === 'LEFT' || finite(port.x, b.cx) <= b.cx;
      b.lead(port, b.cx + (leftSide ? -radius : radius), pinY, 'nacs-terminal-lead');
    });
  }

  function drawAcDcPowerSelector(builder) {
    const b = builder;
    const poleRows = [b.cy - Math.max(11, b.h * 0.2), b.cy + Math.max(11, b.h * 0.2)];
    const commonX = b.cx - Math.max(12, b.w * 0.13);
    const throwX = b.cx + Math.max(13, b.w * 0.15);
    const throwOffset = Math.max(4.5, Math.min(7, b.h * 0.08));
    poleRows.forEach((y, index) => {
      b.circle(commonX, y, 1.6, 'selector-common', { fill: 'paper', strokeWidth: 1 });
      b.circle(throwX, y - throwOffset, 1.45, 'ac-throw', { fill: 'paper', strokeWidth: 1 });
      b.circle(throwX, y + throwOffset, 1.45, 'dc-throw', { fill: 'paper', strokeWidth: 1 });
      /* ALL_OPEN is the evidence-backed default, so the blade is centred
         between the AC and DC throws and touches neither. */
      b.line(commonX + 2, y, throwX - 4, y,
        'selector-neutral-blade', { strokeWidth: 1.45 });
      b.text(commonX - 4, y - 4.5, index ? 'B' : 'A', 'pole-label', {
        height: 8, anchor: 'end', weight: 'bold'
      });
      b.text(throwX + 4, y - throwOffset, 'AC', 'throw-label', {
        height: 8, anchor: 'start', weight: 'bold'
      });
      b.text(throwX + 4, y + throwOffset, 'DC', 'throw-label', {
        height: 8, anchor: 'start', weight: 'bold'
      });
    });
    b.line(b.cx, poleRows[0] + 4, b.cx, poleRows[1] - 4,
      'mechanical-linkage', { dash: '3,2', strokeWidth: 0.9 });
    b.arc(b.cx, b.top + Math.max(8, b.h * 0.14), Math.max(6, b.w * 0.06),
      205, 335, 'mode-selector-actuator', { strokeWidth: 1.1 });
    b.ports.forEach((port) => {
      const terminal = String(port.terminalId || port.id || '');
      const poleB = /(?:_B|L2|NEG)$/i.test(terminal);
      const y = poleRows[poleB ? 1 : 0];
      let targetX = commonX;
      let targetY = y;
      if (/^AC_/i.test(terminal)) { targetX = throwX; targetY = y - throwOffset; }
      if (/^DC_/i.test(terminal)) { targetX = throwX; targetY = y + throwOffset; }
      b.lead(port, targetX, targetY, 'selector-terminal-lead');
    });
  }

  function drawResidualCurrent(builder) {
    const b = builder;
    const radius = Math.max(7, Math.min(13, b.scale * 0.3));
    b.circle(b.cx, b.cy, radius, 'summation-transformer', { fill: 'paper', strokeWidth: 1.3 });
    const power = b.ports.filter(isPowerPort);
    const spacing = Math.max(2.2, Math.min(4, radius * 0.4));
    power.forEach((port, index) => {
      const y = b.cy + (index - (power.length - 1) / 2) * spacing;
      b.lead(port, port.x <= b.cx ? b.cx - radius : b.cx + radius, y, 'monitored-conductor');
      b.line(b.cx - radius, y, b.cx + radius, y, 'monitored-conductor', { strokeWidth: 0.75 });
    });
    b.text(b.cx, b.cy + 1.5, 'IΔ', 'function-code', { height: 9, weight: 'bold' });
    b.ports.filter((port) => !isPowerPort(port)).forEach((port) =>
      b.lead(port, port.x <= b.cx ? b.cx - radius : b.cx + radius, b.cy + radius, 'alarm-lead'));
  }

  function drawConnector(builder) {
    const b = builder;
    const radius = Math.max(8, Math.min(16, b.scale * 0.38));
    b.circle(b.cx, b.cy, radius, 'connector-shell', { fill: 'paper', strokeWidth: 1.35 });
    b.arc(b.cx, b.cy, radius * 0.72, 205, 335, 'connector-key', { strokeWidth: 1 });
    const pinLayout = [
      [-0.34, -0.35], [0.34, -0.35], [-0.48, 0.12], [0, 0.18], [0.48, 0.12], [-0.2, 0.52], [0.2, 0.52]
    ];
    pinLayout.slice(0, Math.min(Math.max(3, b.uniquePorts().length), pinLayout.length)).forEach((position) =>
      b.circle(b.cx + position[0] * radius, b.cy + position[1] * radius, Math.max(0.85, radius * 0.075),
        'connector-pin', { fill: 'ink', strokeWidth: 0.5 }));
    b.ports.forEach((port) => {
      const isLeft = String(port.side || '').toUpperCase() === 'LEFT' || port.x <= b.cx;
      b.lead(port, b.cx + (isLeft ? -radius : radius), Math.max(b.cy - radius * 0.65,
        Math.min(b.cy + radius * 0.65, port.y)), 'connector-terminal');
    });
  }

  function drawSafety(builder) {
    const b = builder;
    const power = b.ports.filter(isPowerPort);
    if (power.length) drawSwitch(b, 'isolator');
    else {
      const radius = Math.max(5, Math.min(9, b.scale * 0.22));
      b.circle(b.cx, b.cy, radius, 'mushroom-head', { fill: 'paper', strokeWidth: 1.3 });
      b.line(b.cx - radius * 0.65, b.cy, b.cx + radius * 0.65, b.cy, 'actuator-bar', { strokeWidth: 1.5 });
      b.ports.forEach((port) => b.lead(port, port.x <= b.cx ? b.cx - radius : b.cx + radius, b.cy,
        'safety-contact-lead'));
    }
  }

  function drawTerminalBlock(builder) {
    const b = builder;
    const unique = b.uniquePorts();
    const count = Math.max(2, Math.min(8, unique.length || 2));
    const cell = Math.max(5, Math.min(10, b.w / count));
    const startX = b.cx - count * cell / 2;
    for (let index = 0; index < count; index += 1) {
      b.rect(startX + index * cell, b.cy - cell / 2, cell, cell, 'terminal-cell', { fill: 'paper', strokeWidth: 0.9 });
      b.circle(startX + (index + 0.5) * cell, b.cy, Math.max(0.8, cell * 0.12), 'terminal-screw', { fill: 'paper', strokeWidth: 0.8 });
    }
    b.ports.forEach((port, index) => {
      const target = startX + ((index % count) + 0.5) * cell;
      b.lead(port, target, b.cy, 'terminal-lead');
    });
  }

  function drawThermal(builder) {
    const b = builder;
    const radius = Math.max(7, Math.min(14, b.scale * 0.34));
    b.circle(b.cx, b.cy, radius, 'motor-outline', { fill: 'paper', strokeWidth: 1.25 });
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3 - Math.PI / 2;
      const tip = { x: b.cx + Math.cos(angle) * radius * 0.78, y: b.cy + Math.sin(angle) * radius * 0.78 };
      const left = { x: b.cx + Math.cos(angle + 1.8) * radius * 0.35, y: b.cy + Math.sin(angle + 1.8) * radius * 0.35 };
      const right = { x: b.cx + Math.cos(angle - 1.8) * radius * 0.35, y: b.cy + Math.sin(angle - 1.8) * radius * 0.35 };
      b.polyline([{ x: b.cx, y: b.cy }, left, tip, right], 'fan-blade', { fill: 'none', strokeWidth: 0.9 }, true);
    }
    b.circle(b.cx, b.cy, 1.2, 'fan-hub', { fill: 'ink', strokeWidth: 0.5 });
    b.ports.forEach((port) => b.lead(port, port.x <= b.cx ? b.cx - radius : b.cx + radius,
      Math.max(b.cy - radius * 0.6, Math.min(b.cy + radius * 0.6, port.y))));
  }

  function drawEarth(builder) {
    const b = builder;
    const stemTop = b.top + Math.max(1, b.h * 0.05);
    const earthY = b.bottom - Math.max(3, b.h * 0.08);
    b.line(b.cx, stemTop, b.cx, earthY - 8, 'protective-conductor', { strokeWidth: 1.7 });
    b.line(b.cx - 10, earthY - 8, b.cx + 10, earthY - 8, 'earth-bar', { strokeWidth: 1.7 });
    b.line(b.cx - 7, earthY - 4, b.cx + 7, earthY - 4, 'earth-bar', { strokeWidth: 1.4 });
    b.line(b.cx - 3.5, earthY, b.cx + 3.5, earthY, 'earth-bar', { strokeWidth: 1.1 });
    b.ports.forEach((port) => b.lead(port, b.cx, Math.max(stemTop, Math.min(earthY - 8, port.y)), 'pe-tap'));
    b.text(b.cx + 12, earthY - 5, 'PE', 'function-code', { height: 9, anchor: 'start', weight: 'bold' });
  }

  function drawBattery(builder) {
    const b = builder;
    const plateCount = 4;
    const spacing = Math.max(5, Math.min(10, b.w / 7));
    const start = b.cx - (plateCount - 1) * spacing / 2;
    for (let index = 0; index < plateCount; index += 1) {
      const longPlate = index % 2 === 0;
      const x = start + index * spacing;
      const half = longPlate ? Math.max(7, b.h * 0.28) : Math.max(4, b.h * 0.16);
      b.line(x, b.cy - half, x, b.cy + half, longPlate ? 'battery-positive-plate' : 'battery-negative-plate', {
        strokeWidth: longPlate ? 2 : 1.4
      });
    }
    b.line(b.left, b.cy, start, b.cy, 'battery-lead');
    b.line(start + (plateCount - 1) * spacing, b.cy, b.right, b.cy, 'battery-lead');
    b.text(start - 3, b.cy - Math.max(9, b.h * 0.34), '+', 'polarity', { height: 9, weight: 'bold' });
    b.text(start + (plateCount - 1) * spacing + 3, b.cy - Math.max(9, b.h * 0.34), '−', 'polarity', { height: 9, weight: 'bold' });
    b.ports.forEach((port) => b.lead(port, port.x <= b.cx ? b.left : b.right, b.cy, 'battery-terminal'));
  }

  function drawLamp(builder) {
    const b = builder;
    const radius = Math.max(7, Math.min(13, b.scale * 0.32));
    b.circle(b.cx, b.cy, radius, 'lamp-bulb', { fill: 'paper', strokeWidth: 1.35 });
    const d = radius * 0.66;
    b.line(b.cx - d, b.cy - d, b.cx + d, b.cy + d, 'lamp-filament', { strokeWidth: 1.15 });
    b.line(b.cx - d, b.cy + d, b.cx + d, b.cy - d, 'lamp-filament', { strokeWidth: 1.15 });
    b.ports.forEach((port) => b.lead(port, port.x <= b.cx ? b.cx - radius : b.cx + radius,
      Math.max(b.cy - radius * 0.45, Math.min(b.cy + radius * 0.45, port.y)), 'lamp-lead'));
  }

  function drawFunctionBlock(builder, definitionValue) {
    const secondary = definitionValue.iecReferences.length ? definitionValue.iecReferences[0].replace('IEC-60617-', 'IEC ') : '';
    builder.frame(definitionValue.functionCode, secondary);
    if (/meter/.test(definitionValue.id)) {
      const radius = Math.max(5, Math.min(9, builder.scale * 0.2));
      builder.circle(builder.cx, builder.cy, radius, 'meter-register', { fill: 'paper', strokeWidth: 0.9 });
    }
    if (definitionValue.id === 'iec.actuator.connector-lock') {
      const r = Math.max(4, Math.min(7, builder.scale * 0.15));
      builder.arc(builder.cx, builder.cy - 1, r, 180, 360, 'lock-shackle', { strokeWidth: 1.2 });
      builder.rect(builder.cx - r, builder.cy - 1, r * 2, r * 1.35, 'lock-body', { fill: 'paper', strokeWidth: 1.1 });
    }
  }

  function drawForDefinition(builder, definitionValue) {
    switch (definitionValue.id) {
      case 'iec.connector.incomer': drawIncomer(builder); break;
      case 'iec.switch.disconnector': drawSwitch(builder, 'isolator'); break;
      case 'iec.switch.circuit-breaker': drawSwitch(builder, 'breaker'); break;
      case 'iec.protection.surge': drawSurgeProtector(builder); break;
      case 'iec.transformer.ev-isolation': drawTransformer(builder); break;
      case 'iec.output.loudspeaker': drawLoudspeaker(builder); break;
      case 'iec.monitor.residual-current': drawResidualCurrent(builder); break;
      case 'iec.switch.contactor-ac':
      case 'iec.switch.contactor-dc':
      case 'iec.switch.contactor-ess':
      case 'iec.switch.contactor-precharge': drawSwitch(builder, 'contactor'); break;
      case 'iec.distribution.busbar-ac':
      case 'iec.distribution.busbar-dc':
      case 'iec.distribution.busbar-ess': builder.busbar(definitionValue.functionCode); break;
      case 'iec.protection.fuse-dc':
      case 'iec.protection.fuse-ess': drawFuse(builder); break;
      case 'iec.monitor.current-transducer': drawCurrentTransducer(builder); break;
      case 'iec.connector.ev-charge': drawConnector(builder); break;
      case 'iec.connector.ev-charge-ac':
      case 'iec.connector.ev-charge-dc-inlet': drawConnector(builder); break;
      case 'iec.connector.split-interface': drawTerminalBlock(builder); break;
      case 'iec.switch.safety': drawSafety(builder); break;
      case 'iec.switch.safety-four-pole': drawSwitch(builder, 'isolator'); break;
      case 'iec.switch.selector-dual': drawSelectorDual(builder); break;
      case 'iec.distribution.terminal-block': drawTerminalBlock(builder); break;
      case 'iec.connector.external-12pin': drawExternalConnector(builder); break;
      case 'iec.auxiliary.thermal-management': drawThermal(builder); break;
      case 'iec.earth.protective-bar': drawEarth(builder); break;
      case 'iec.source.battery': drawBattery(builder); break;
      case 'iec.passive.resistor-precharge':
      case 'iec.passive.resistor-discharge':
      case 'iec.load.battery-heater': drawResistor(builder); break;
      case 'iec.indicator.lamp': drawLamp(builder); break;
      case 'iec.relay.control': drawControlRelay(builder); break;
      case 'iec.sensor.temperature-passive': drawTemperatureSensor(builder); break;
      case 'iec.control.ac-dc-mode-interlock': drawModeInterlock(builder); break;
      case 'iec.connector.heater-two-pole': drawHeatingConnector(builder); break;
      case 'iec.communication.rf-antenna': drawRfAntenna(builder); break;
      case 'iec.connector.nacs-shared-inlet': drawNacsSharedInlet(builder); break;
      case 'iec.switch.ac-dc-power-selector': drawAcDcPowerSelector(builder); break;
      default: drawFunctionBlock(builder, definitionValue); break;
    }
  }

  function resolve(kind) {
    const deviceKind = String(kind == null ? '' : kind);
    const mapped = KIND_TO_SYMBOL[deviceKind];
    return Object.freeze({
      kind: deviceKind,
      symbolId: mapped || FALLBACK_SYMBOL_ID,
      fallback: !mapped,
      definition: DEFINITIONS[mapped || FALLBACK_SYMBOL_ID]
    });
  }

  function get(symbolId) {
    return DEFINITIONS[String(symbolId || '')] || null;
  }

  function instantiate(spec) {
    const value = spec || {};
    const resolved = value.symbolId && get(value.symbolId)
      ? Object.freeze({ kind: String(value.kind || ''), symbolId: String(value.symbolId), fallback: String(value.symbolId) === FALLBACK_SYMBOL_ID,
        definition: get(value.symbolId) })
      : resolve(value.kind);
    const builder = primitiveBuilder(value, resolved.definition);
    builder.title();
    drawForDefinition(builder, resolved.definition);
    builder.portLabels();
    return Object.freeze({
      schema: SCHEMA,
      version: VERSION,
      kind: resolved.kind,
      symbolId: resolved.symbolId,
      fallback: resolved.fallback,
      definition: resolved.definition,
      primitives: Object.freeze(builder.primitives.map((primitive) => Object.freeze(primitive)))
    });
  }

  function assertCurrentCoverage(kinds) {
    const source = Array.isArray(kinds) ? kinds : CURRENT_DEVICE_KINDS;
    const missing = source.filter((kind) => !KIND_TO_SYMBOL[kind] || !DEFINITIONS[KIND_TO_SYMBOL[kind]]);
    if (missing.length) throw new Error('IEC symbol mapping missing for: ' + missing.join(', '));
    return true;
  }

  assertCurrentCoverage();

  return Object.freeze({
    VERSION,
    SCHEMA,
    FALLBACK_SYMBOL_ID,
    CURRENT_DEVICE_KINDS,
    KIND_TO_SYMBOL,
    DEFINITIONS,
    resolve,
    get,
    instantiate,
    assertCurrentCoverage
  });
});
