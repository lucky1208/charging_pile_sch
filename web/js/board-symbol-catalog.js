/* ============================================================
 * IEC/GB-style board schematic symbol catalog
 * ------------------------------------------------------------
 * Native vector reconstruction of the elementary symbols observed in the
 * user project schematics.  Geometry is renderer-neutral and carries pin
 * identity; no raster crop is used as a production symbol.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_BOARD_SYMBOL_CATALOG = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.0.0';
  const STANDARD_BASELINE = 'IEC 60617 / GB/T 4728 project reconstruction baseline—NOT_CERTIFIED';
  const REVIEW_STATUS = 'SYMBOL_GEOMETRY_RECONSTRUCTED—LIBRARY_MANAGER_REVIEW_REQUIRED';

  function pin(id, name, electricalType, side, number, ratio) {
    return Object.freeze({
      id: String(id), number: String(number == null ? id : number), name: String(name || id),
      electricalType: String(electricalType || 'PASSIVE'), side: String(side || 'AUTO').toUpperCase(),
      ratio: Number.isFinite(Number(ratio)) ? Number(ratio) : null
    });
  }
  function def(id, name, category, glyph, pins, options) {
    return Object.freeze(Object.assign({
      id, name, category, glyph, pins: Object.freeze(pins || []),
      standardFamily: STANDARD_BASELINE,
      lifecycle: REVIEW_STATUS,
      sourceRefs: Object.freeze(['SRC-COMPARISON-DOCX'])
    }, options || {}));
  }

  const DEFINITIONS = Object.freeze({
    resistor: def('resistor', '电阻', 'PASSIVE', 'iec-resistor', [pin('1', '1'), pin('2', '2')]),
    capacitor: def('capacitor', '无极性电容', 'PASSIVE', 'capacitor', [pin('1', '1'), pin('2', '2')]),
    'polarized-capacitor': def('polarized-capacitor', '有极性电容', 'PASSIVE', 'polarized-capacitor',
      [pin('+', '+', 'PASSIVE', 'LEFT', '1'), pin('-', '-', 'PASSIVE', 'RIGHT', '2')]),
    inductor: def('inductor', '电感', 'PASSIVE', 'inductor', [pin('1', '1'), pin('2', '2')]),
    transformer: def('transformer', '变压器', 'MAGNETIC', 'transformer', [
      pin('P1', 'P1', 'PASSIVE', 'LEFT', '1'), pin('P2', 'P2', 'PASSIVE', 'LEFT', '2'),
      pin('S1', 'S1', 'PASSIVE', 'RIGHT', '3'), pin('S2', 'S2', 'PASSIVE', 'RIGHT', '4')
    ]),
    'common-mode-choke': def('common-mode-choke', '共模扼流圈', 'MAGNETIC', 'common-mode-choke', [
      pin('L_IN', 'L in', 'PASSIVE', 'LEFT', '1'), pin('N_IN', 'N in', 'PASSIVE', 'LEFT', '2'),
      pin('L_OUT', 'L out', 'PASSIVE', 'RIGHT', '3'), pin('N_OUT', 'N out', 'PASSIVE', 'RIGHT', '4')
    ]),
    fuse: def('fuse', '熔断器', 'PROTECTION', 'fuse', [pin('1', '1'), pin('2', '2')]),
    ntc: def('ntc', 'NTC浪涌抑制器', 'PROTECTION', 'iec-ntc', [pin('1', '1'), pin('2', '2')]),
    mov: def('mov', '压敏电阻', 'PROTECTION', 'iec-varistor', [pin('1', '1'), pin('2', '2')]),
    gdt: def('gdt', '气体放电管', 'PROTECTION', 'gdt', [pin('1', '1'), pin('2', '2')]),
    diode: def('diode', '二极管', 'SEMICONDUCTOR', 'diode', [
      pin('A', 'A', 'PASSIVE', 'LEFT', '1'), pin('K', 'K', 'PASSIVE', 'RIGHT', '2')
    ]),
    zener: def('zener', '稳压二极管', 'PROTECTION', 'zener', [
      pin('A', 'A', 'PASSIVE', 'LEFT', '1'), pin('K', 'K', 'PASSIVE', 'RIGHT', '2')
    ]),
    tvs: def('tvs', '双向TVS', 'PROTECTION', 'tvs-bidirectional', [
      pin('A', 'A', 'PASSIVE', 'LEFT', '1'), pin('K', 'K', 'PASSIVE', 'RIGHT', '2')
    ], { polarityIndependent: true }),
    'bridge-rectifier': def('bridge-rectifier', '整流桥', 'SEMICONDUCTOR', 'bridge', [
      pin('AC1', '~', 'POWER_IN', 'LEFT', '1'), pin('AC2', '~', 'POWER_IN', 'RIGHT', '2'),
      pin('+', '+', 'POWER_OUT', 'TOP', '3'), pin('-', '-', 'POWER_OUT', 'BOTTOM', '4')
    ]),
    'bjt-npn': def('bjt-npn', 'NPN三极管', 'SEMICONDUCTOR', 'bjt-npn', [
      pin('B', 'B', 'INPUT', 'LEFT', '1'), pin('C', 'C', 'PASSIVE', 'TOP', '2'), pin('E', 'E', 'PASSIVE', 'BOTTOM', '3')
    ]),
    'bjt-pnp': def('bjt-pnp', 'PNP三极管', 'SEMICONDUCTOR', 'bjt-pnp', [
      pin('B', 'B', 'INPUT', 'LEFT', '1'), pin('C', 'C', 'PASSIVE', 'BOTTOM', '2'), pin('E', 'E', 'PASSIVE', 'TOP', '3')
    ]),
    'mosfet-n': def('mosfet-n', 'N沟道MOSFET', 'SEMICONDUCTOR', 'mosfet-n', [
      pin('G', 'G', 'INPUT', 'LEFT', '1'), pin('D', 'D', 'PASSIVE', 'TOP', '2'), pin('S', 'S', 'PASSIVE', 'BOTTOM', '3')
    ]),
    'mosfet-p': def('mosfet-p', 'P沟道MOSFET', 'SEMICONDUCTOR', 'mosfet-p', [
      pin('G', 'G', 'INPUT', 'LEFT', '1'), pin('D', 'D', 'PASSIVE', 'BOTTOM', '2'), pin('S', 'S', 'PASSIVE', 'TOP', '3')
    ]),
    opamp: def('opamp', '运算放大器单元', 'ANALOG', 'opamp', [
      pin('OUT', 'OUT', 'OUTPUT', 'RIGHT', '1'), pin('-', '−', 'INPUT', 'LEFT', '2'),
      pin('+', '+', 'INPUT', 'LEFT', '3'), pin('V-', 'V−', 'POWER_IN', 'BOTTOM', '4'),
      pin('V+', 'V+', 'POWER_IN', 'TOP', '8')
    ]),
    comparator: def('comparator', '比较器单元', 'ANALOG', 'comparator', [
      pin('OUT', 'OUT', 'OPEN_COLLECTOR', 'RIGHT', '1'), pin('-', '−', 'INPUT', 'LEFT', '2'),
      pin('+', '+', 'INPUT', 'LEFT', '3'), pin('V-', 'V−', 'POWER_IN', 'BOTTOM', '4'),
      pin('V+', 'V+', 'POWER_IN', 'TOP', '8')
    ]),
    optocoupler: def('optocoupler', '晶体管输出光耦', 'ISOLATION', 'optocoupler', [
      pin('A', 'A', 'INPUT', 'LEFT', '1'), pin('K', 'K', 'INPUT', 'LEFT', '2'),
      pin('E', 'E', 'OUTPUT', 'RIGHT', '3', 2 / 3), pin('C', 'C', 'OUTPUT', 'RIGHT', '4', 1 / 3)
    ]),
    'relay-coil': def('relay-coil', '继电器线圈', 'SWITCHING', 'relay-coil', [
      pin('A1', 'A1', 'COIL', 'LEFT', 'A1'), pin('A2', 'A2', 'COIL', 'RIGHT', 'A2')
    ]),
    'relay-contact-no': def('relay-contact-no', '继电器常开触点', 'SWITCHING', 'contact-no', [
      pin('COM', '11', 'PASSIVE', 'LEFT', '11'), pin('NO', '14', 'PASSIVE', 'RIGHT', '14')
    ]),
    'relay-contact-nc': def('relay-contact-nc', '继电器常闭触点', 'SWITCHING', 'contact-nc', [
      pin('COM', '11', 'PASSIVE', 'LEFT', '11'), pin('NC', '12', 'PASSIVE', 'RIGHT', '12')
    ]),
    'current-transformer': def('current-transformer', '电流互感器', 'SENSING', 'current-transformer', [
      pin('P1', 'P1', 'PASSIVE', 'LEFT', '1'), pin('P2', 'P2', 'PASSIVE', 'RIGHT', '2'),
      pin('S1', 'S1', 'OUTPUT', 'BOTTOM', '3'), pin('S2', 'S2', 'OUTPUT', 'BOTTOM', '4')
    ]),
    shunt: def('shunt', '分流器', 'SENSING', 'shunt', [
      pin('I+', 'I+', 'POWER_IN', 'LEFT', '1'), pin('I-', 'I-', 'POWER_OUT', 'RIGHT', '2'),
      pin('S+', 'S+', 'OUTPUT', 'TOP', '3', .38), pin('S-', 'S-', 'OUTPUT', 'BOTTOM', '4', .62)
    ]),
    connector: def('connector', '连接器', 'INTERFACE', 'connector', [
      pin('1', '1', 'PASSIVE', 'LEFT', '1'), pin('2', '2', 'PASSIVE', 'RIGHT', '2')
    ], { variablePinCount: true }),
    testpoint: def('testpoint', '测试点', 'INTERFACE', 'testpoint', [pin('1', 'TP', 'PASSIVE', 'LEFT', '1')]),
    'integrated-circuit': def('integrated-circuit', '集成电路', 'IC', 'ic', [], { variablePinCount: true })
  });

  const ALIASES = Object.freeze({
    r: 'resistor', c: 'capacitor', cp: 'polarized-capacitor', l: 'inductor', t: 'transformer',
    d: 'diode', zd: 'zener', q_npn: 'bjt-npn', q_pnp: 'bjt-pnp', q_nmos: 'mosfet-n',
    q_pmos: 'mosfet-p', u_opamp: 'opamp', u_cmp: 'comparator', u_opto: 'optocoupler',
    k_coil: 'relay-coil', k_no: 'relay-contact-no', k_nc: 'relay-contact-nc', br: 'bridge-rectifier'
  });

  function n(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function p(kind, values, role) {
    return Object.freeze(Object.assign({ kind, symbolRole: role || kind }, values || {}));
  }
  function line(x1, y1, x2, y2, role) { return p('line', { x1, y1, x2, y2 }, role); }
  function polyline(points, role, closed) { return p('polyline', { points, closed: !!closed }, role); }
  function circle(x, y, radius, role, fill) { return p('circle', { x, y, radius, fill: fill || 'none' }, role); }
  function rect(x, y, width, height, role) { return p('rect', { x, y, width, height }, role); }
  function text(x, y, value, role, height) {
    return p('text', { x, y, text: String(value), height: height || 4, anchor: 'middle' }, role || 'pin-label');
  }

  function terminalPositions(definition, box, pinOverrides) {
    const pins = (Array.isArray(pinOverrides) && pinOverrides.length ? pinOverrides : definition.pins)
      .map((value) => Object.assign({}, value));
    const bySide = { LEFT: [], RIGHT: [], TOP: [], BOTTOM: [], AUTO: [] };
    pins.forEach((item) => (bySide[item.side] || bySide.AUTO).push(item));
    bySide.AUTO.forEach((item, index) => (index % 2 ? bySide.RIGHT : bySide.LEFT).push(item));
    const result = [];
    ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].forEach((side) => {
      bySide[side].forEach((item, index, list) => {
        const ratio = item.ratio != null && Number.isFinite(Number(item.ratio))
          ? Number(item.ratio) : (index + 1) / (list.length + 1);
        let x; let y;
        if (side === 'LEFT') { x = box.x; y = box.y + box.height * ratio; }
        if (side === 'RIGHT') { x = box.x + box.width; y = box.y + box.height * ratio; }
        if (side === 'TOP') { x = box.x + box.width * ratio; y = box.y; }
        if (side === 'BOTTOM') { x = box.x + box.width * ratio; y = box.y + box.height; }
        result.push(Object.freeze(Object.assign({}, item, { x, y, side })));
      });
    });
    return Object.freeze(result);
  }

  function twoTerminalGlyph(glyph, b, out) {
    const cy = b.cy; const x1 = b.x + b.width * 0.25; const x2 = b.x + b.width * 0.75;
    out.push(line(b.x, cy, x1, cy, 'pin-lead'), line(x2, cy, b.x + b.width, cy, 'pin-lead'));
    if (glyph === 'iec-resistor' || glyph === 'iec-ntc' || glyph === 'iec-varistor') {
      out.push(rect(x1, cy - b.height * .16, x2 - x1, b.height * .32, 'resistor-body'));
      if (glyph === 'iec-ntc' || glyph === 'iec-varistor') {
        out.push(line(x1 + b.width * .06, cy + b.height * .29,
          x2 - b.width * .02, cy - b.height * .29, 'nonlinear-mark'));
        out.push(text(x2 - b.width * .04, cy - b.height * .29,
          glyph === 'iec-ntc' ? '−t°' : 'V', glyph === 'iec-ntc' ? 'temperature-code' : 'voltage-code', 4));
      }
    } else if (glyph === 'capacitor' || glyph === 'polarized-capacitor') {
      const a = b.cx - b.width * .06; const c = b.cx + b.width * .06;
      out.push(line(x1, cy, a, cy, 'capacitor-lead'), line(c, cy, x2, cy, 'capacitor-lead'),
        line(a, cy - b.height * .24, a, cy + b.height * .24, 'capacitor-plate'));
      if (glyph === 'polarized-capacitor') {
        out.push(p('arc', { x: c + b.width * .08, y: cy, radius: b.width * .08,
          startAngle: 110, endAngle: 250 }, 'capacitor-curved-negative-plate'),
        text(a - b.width * .04, cy - b.height * .34, '+', 'polarity', 5));
      } else out.push(line(c, cy - b.height * .24, c, cy + b.height * .24, 'capacitor-plate'));
    } else if (glyph === 'fuse') {
      out.push(rect(x1, cy - b.height * .13, x2 - x1, b.height * .26, 'fuse-body'),
        line(x1 + b.width * .05, cy + b.height * .09, x2 - b.width * .05, cy - b.height * .09, 'fusible-link'));
    } else if (glyph === 'diode' || glyph === 'zener') {
      const anode = b.cx - b.width * .13; const cathode = b.cx + b.width * .1;
      out.push(line(x1, cy, anode, cy, 'diode-lead'), line(cathode, cy, x2, cy, 'diode-lead'),
      polyline([{ x: anode, y: cy - b.height * .22 }, { x: cathode, y: cy },
        { x: anode, y: cy + b.height * .22 }], 'diode-anode', true),
      line(cathode, cy - b.height * .23, cathode, cy + b.height * .23, 'diode-cathode'));
      if (glyph === 'zener') out.push(polyline([{ x: cathode - b.width * .04, y: cy - b.height * .23 },
        { x: cathode + b.width * .05, y: cy - b.height * .3 }], 'zener-knee'),
      polyline([{ x: cathode - b.width * .04, y: cy + b.height * .23 },
        { x: cathode + b.width * .05, y: cy + b.height * .3 }], 'zener-knee'));
    } else if (glyph === 'tvs-bidirectional') {
      const left = b.cx - b.width * .12; const right = b.cx + b.width * .12;
      out.push(line(x1, cy, left, cy, 'tvs-lead'), line(right, cy, x2, cy, 'tvs-lead'),
      polyline([{ x: left, y: cy - b.height * .21 }, { x: right, y: cy },
        { x: left, y: cy + b.height * .21 }], 'tvs-diode-a', true),
      line(right, cy - b.height * .22, right, cy + b.height * .22, 'tvs-cathode-a'),
      polyline([{ x: right, y: cy - b.height * .21 }, { x: left, y: cy },
        { x: right, y: cy + b.height * .21 }], 'tvs-diode-b', true),
      line(left, cy - b.height * .22, left, cy + b.height * .22, 'tvs-cathode-b'));
    } else if (glyph === 'inductor') {
      const r = b.width * .0625;
      for (let i = 0; i < 4; i += 1) out.push(p('arc', {
        x: x1 + r * (1 + i * 2), y: cy, radius: r, startAngle: 180, endAngle: 360
      }, 'inductor-turn'));
    } else if (glyph === 'gdt') {
      out.push(line(x1, cy, b.cx - b.width * .07, cy, 'gdt-lead'),
        line(b.cx + b.width * .07, cy, x2, cy, 'gdt-lead'),
        line(b.cx - b.width * .07, cy - b.height * .2, b.cx - b.width * .07, cy + b.height * .2, 'gdt-electrode'),
        line(b.cx + b.width * .07, cy - b.height * .2, b.cx + b.width * .07, cy + b.height * .2, 'gdt-electrode'),
        circle(b.cx, cy, b.height * .31, 'gdt-envelope'));
    }
  }

  function pinIndex(terminals) {
    const result = {};
    (terminals || []).forEach((terminal) => { result[terminal.id] = terminal; });
    return result;
  }

  function opampGlyph(b, out, comparator, terminals) {
    const ports = pinIndex(terminals); const left = b.x + b.width * .22; const tip = b.x + b.width * .78;
    out.push(polyline([{ x: left, y: b.y + b.height * .18 },
      { x: left, y: b.y + b.height * .82 }, { x: tip, y: b.cy }],
    comparator ? 'comparator-body' : 'opamp-body', true));
    ['-', '+'].forEach((id) => {
      const port = ports[id]; if (port) out.push(line(port.x, port.y, left, port.y, 'pin-lead'));
    });
    if (ports.OUT) out.push(line(tip, b.cy, ports.OUT.x, ports.OUT.y, 'pin-lead'));
    if (ports['V+']) out.push(line(ports['V+'].x, ports['V+'].y, ports['V+'].x, b.y + b.height * .34, 'supply-lead'));
    if (ports['V-']) out.push(line(ports['V-'].x, b.y + b.height * .66, ports['V-'].x, ports['V-'].y, 'supply-lead'));
    out.push(text(left + b.width * .08, ports['-'] ? ports['-'].y : b.y + b.height * .35, '−', 'inverting-input', 5),
      text(left + b.width * .08, ports['+'] ? ports['+'].y : b.y + b.height * .65, '+', 'noninverting-input', 5));
    if (comparator) out.push(circle(tip, b.cy, b.height * .035, 'open-collector'));
  }

  function transistorGlyph(glyph, b, out, terminals) {
    const npn = /npn|mosfet-n/.test(glyph); const mos = /mosfet/.test(glyph); const ports = pinIndex(terminals);
    const input = ports[mos ? 'G' : 'B']; const top = terminals.find((item) => item.side === 'TOP');
    const bottom = terminals.find((item) => item.side === 'BOTTOM'); const emitter = ports.E || ports.S;
    const bx = b.x + b.width * .36; const cx = b.x + b.width * .64;
    if (input) out.push(line(input.x, input.y, bx, input.y, mos ? 'gate-lead' : 'base-lead'));
    if (mos) {
      out.push(line(bx, b.y + b.height * .28, bx, b.y + b.height * .72, 'gate'),
        line(cx, b.y + b.height * .25, cx, b.y + b.height * .75, 'channel'),
        line(cx, b.y + b.height * .25, top.x, top.y, top.id === 'D' ? 'drain-lead' : 'source-lead'),
        line(cx, b.y + b.height * .75, bottom.x, bottom.y, bottom.id === 'D' ? 'drain-lead' : 'source-lead'));
    } else {
      out.push(line(bx, b.y + b.height * .28, bx, b.y + b.height * .72, 'base'),
        line(bx, b.y + b.height * .4, top.x, top.y, top.id === 'C' ? 'collector-lead' : 'emitter-lead'),
        line(bx, b.y + b.height * .6, bottom.x, bottom.y, bottom.id === 'C' ? 'collector-lead' : 'emitter-lead'));
    }
    const towardBottom = emitter && emitter.side === 'BOTTOM';
    const startY = towardBottom ? b.y + b.height * .66 : b.y + b.height * .34;
    const endY = towardBottom ? b.y + b.height * .8 : b.y + b.height * .2;
    out.push(polyline([{ x: b.x + b.width * .56, y: startY }, { x: b.x + b.width * .69, y: endY },
      { x: b.x + b.width * (npn ? .54 : .72), y: endY }], npn ? 'arrow-out' : 'arrow-in'));
    out.push(circle(b.cx, b.cy, Math.min(b.width, b.height) * .37, 'semiconductor-envelope'));
  }

  function multiGlyph(glyph, b, out, terminals) {
    const ports = pinIndex(terminals);
    if (glyph === 'opamp' || glyph === 'comparator') return opampGlyph(b, out, glyph === 'comparator', terminals);
    if (/^bjt|^mosfet/.test(glyph)) return transistorGlyph(glyph, b, out, terminals);
    if (glyph === 'transformer') {
      const primaryX = b.cx - b.width * .1; const secondaryX = b.cx + b.width * .1;
      const turns = 4; const primaryRadius = (ports.P2.y - ports.P1.y) / (turns * 2);
      const secondaryRadius = (ports.S2.y - ports.S1.y) / (turns * 2);
      for (let i = 0; i < turns; i += 1) {
        out.push(p('arc', { x: primaryX, y: ports.P1.y + primaryRadius * (1 + i * 2), radius: primaryRadius,
          startAngle: 270, endAngle: 90 }, 'primary-winding'));
        out.push(p('arc', { x: secondaryX, y: ports.S1.y + secondaryRadius * (1 + i * 2), radius: secondaryRadius,
          startAngle: 270, endAngle: 90 }, 'secondary-winding'));
      }
      out.push(line(b.cx - b.width * .025, b.y + b.height * .18, b.cx - b.width * .025, b.y + b.height * .82, 'magnetic-core'),
        line(b.cx + b.width * .025, b.y + b.height * .18, b.cx + b.width * .025, b.y + b.height * .82, 'magnetic-core'));
      if (ports.P1) out.push(line(ports.P1.x, ports.P1.y, primaryX, ports.P1.y, 'pin-lead'));
      if (ports.P2) out.push(line(ports.P2.x, ports.P2.y, primaryX, ports.P2.y, 'pin-lead'));
      if (ports.S1) out.push(line(secondaryX, ports.S1.y, ports.S1.x, ports.S1.y, 'pin-lead'));
      if (ports.S2) out.push(line(secondaryX, ports.S2.y, ports.S2.x, ports.S2.y, 'pin-lead'));
    } else if (glyph === 'current-transformer') {
      out.push(line(ports.P1.x, ports.P1.y, ports.P2.x, ports.P2.y, 'primary-conductor'),
        circle(b.cx, b.cy, Math.min(b.width, b.height) * .27, 'current-transformer-core'));
      const y = b.y + b.height * .72; const x1 = b.x + b.width * .34; const x2 = b.x + b.width * .66;
      out.push(line(ports.S1.x, ports.S1.y, ports.S1.x, y, 'secondary-lead'),
        line(ports.S1.x, y, x1, y, 'secondary-lead'),
        p('arc', { x: b.cx - b.width * .08, y, radius: b.width * .08, startAngle: 180, endAngle: 360 }, 'secondary-winding'),
        p('arc', { x: b.cx + b.width * .08, y, radius: b.width * .08, startAngle: 180, endAngle: 360 }, 'secondary-winding'),
        line(x2, y, ports.S2.x, y, 'secondary-lead'), line(ports.S2.x, y, ports.S2.x, ports.S2.y, 'secondary-lead'));
    } else if (glyph === 'common-mode-choke') {
      const y1 = ports.L_IN.y; const y2 = ports.N_IN.y;
      out.push(line(ports.L_IN.x, y1, b.x + b.width * .22, y1, 'lead'), line(b.x + b.width * .78, y1, ports.L_OUT.x, ports.L_OUT.y, 'lead'),
        line(ports.N_IN.x, y2, b.x + b.width * .22, y2, 'lead'), line(b.x + b.width * .78, y2, ports.N_OUT.x, ports.N_OUT.y, 'lead'));
      [y1, y2].forEach((y) => { for (let i = 0; i < 4; i += 1) out.push(p('arc', {
        x: b.x + b.width * (.29 + i * .14), y, radius: b.width * .07, startAngle: 180, endAngle: 360
      }, 'winding')); });
      out.push(line(b.cx - b.width * .03, b.y + b.height * .18, b.cx - b.width * .03, b.y + b.height * .82, 'magnetic-core'),
        line(b.cx + b.width * .03, b.y + b.height * .18, b.cx + b.width * .03, b.y + b.height * .82, 'magnetic-core'));
    } else if (glyph === 'bridge') {
      const topY = b.y + b.height * .18; const bottomY = b.y + b.height * .82;
      const leftX = b.x + b.width * .22; const rightX = b.x + b.width * .78;
      out.push(line(ports.AC1.x, ports.AC1.y, leftX, b.cy, 'pin-lead'),
      line(rightX, b.cy, ports.AC2.x, ports.AC2.y, 'pin-lead'),
      line(ports['+'].x, ports['+'].y, b.cx, topY, 'pin-lead'),
      line(b.cx, bottomY, ports['-'].x, ports['-'].y, 'pin-lead'),
      polyline([{ x: b.cx, y: topY }, { x: rightX, y: b.cy },
        { x: b.cx, y: bottomY }, { x: leftX, y: b.cy }], 'bridge-body', true),
      text(b.cx, b.y + b.height * .27, '+', 'polarity', 5), text(b.cx, b.y + b.height * .73, '−', 'polarity', 5),
      text(b.x + b.width * .3, b.cy, '~', 'ac-terminal', 5), text(b.x + b.width * .7, b.cy, '~', 'ac-terminal', 5));
    } else if (glyph === 'optocoupler') {
      out.push(rect(b.x + b.width * .14, b.y + b.height * .12, b.width * .72, b.height * .76, 'isolation-envelope'));
      const ax = b.x + b.width * .34; const kx = b.x + b.width * .44;
      out.push(line(ports.A.x, ports.A.y, ax, b.y + b.height * .36, 'pin-lead'),
      line(ports.K.x, ports.K.y, kx, b.y + b.height * .58, 'pin-lead'),
      polyline([{ x: ax, y: b.y + b.height * .36 }, { x: kx, y: b.y + b.height * .46 },
        { x: ax, y: b.y + b.height * .56 }], 'led-anode', true),
      line(kx, b.y + b.height * .34, kx, b.y + b.height * .58, 'led-cathode'),
      line(b.x + b.width * .66, b.y + b.height * .31, b.x + b.width * .66, b.y + b.height * .69, 'phototransistor-base'),
      line(b.x + b.width * .66, b.y + b.height * .4, ports.C.x, ports.C.y, 'collector'),
      line(b.x + b.width * .66, b.y + b.height * .6, ports.E.x, ports.E.y, 'emitter'),
      line(b.x + b.width * .49, b.y + b.height * .38, b.x + b.width * .57, b.y + b.height * .42, 'light-arrow'),
      line(b.x + b.width * .49, b.y + b.height * .54, b.x + b.width * .57, b.y + b.height * .58, 'light-arrow'));
    } else if (glyph === 'relay-coil') {
      out.push(line(b.x, b.cy, b.x + b.width * .22, b.cy, 'coil-lead'),
        line(b.x + b.width * .78, b.cy, b.x + b.width, b.cy, 'coil-lead'),
        rect(b.x + b.width * .22, b.y + b.height * .34, b.width * .56, b.height * .32, 'coil-body'));
    } else if (glyph === 'contact-no' || glyph === 'contact-nc') {
      const y = b.cy; const left = b.x + b.width * .32; const right = b.x + b.width * .68;
      out.push(line(b.x, y, left, y, 'contact-lead'), line(right, y, b.x + b.width, y, 'contact-lead'),
        circle(left, y, b.height * .04, 'fixed-contact', 'ink'), circle(right, y, b.height * .04, 'fixed-contact', 'ink'));
      out.push(line(left, y, right, glyph === 'contact-no' ? y - b.height * .24 : y, 'moving-contact'));
    } else if (glyph === 'shunt') {
      out.push(line(b.x, b.cy, b.x + b.width * .25, b.cy, 'power-lead'),
        rect(b.x + b.width * .25, b.y + b.height * .38, b.width * .5, b.height * .24, 'shunt-element'),
        line(b.x + b.width * .75, b.cy, b.x + b.width, b.cy, 'power-lead'),
        line(b.x + b.width * .38, b.y + b.height * .38, ports['S+'].x, ports['S+'].y, 'kelvin-lead'),
        line(b.x + b.width * .62, b.y + b.height * .62, ports['S-'].x, ports['S-'].y, 'kelvin-lead'));
    } else if (glyph === 'testpoint') {
      const radius = b.height * .15;
      out.push(line(b.x, b.cy, b.cx - radius, b.cy, 'testpoint-lead'), circle(b.cx, b.cy, radius, 'testpoint-ring'));
    } else if (glyph === 'connector') {
      out.push(line(b.cx, b.y + b.height * .18, b.cx, b.y + b.height * .82, 'connector-boundary'));
      terminals.forEach((port) => {
        let x = b.cx; let y = port.y;
        if (port.side === 'TOP' || port.side === 'BOTTOM') { x = port.x; y = b.cy; }
        out.push(line(port.x, port.y, x, y, 'connector-lead'), circle(x, y, b.height * .045, 'connector-pin'));
      });
    } else if (glyph === 'ic') {
      out.push(rect(b.x + b.width * .2, b.y + b.height * .12, b.width * .6, b.height * .76, 'ic-body'),
        text(b.cx, b.cy, 'IC', 'function-code', 5));
      terminals.forEach((port) => {
        if (port.side === 'LEFT') out.push(line(port.x, port.y, b.x + b.width * .2, port.y, 'pin-lead'));
        if (port.side === 'RIGHT') out.push(line(b.x + b.width * .8, port.y, port.x, port.y, 'pin-lead'));
        if (port.side === 'TOP') out.push(line(port.x, port.y, port.x, b.y + b.height * .12, 'pin-lead'));
        if (port.side === 'BOTTOM') out.push(line(port.x, b.y + b.height * .88, port.x, port.y, 'pin-lead'));
      });
    }
  }

  function resolve(id) {
    const key = String(id || '').trim().toLowerCase();
    return DEFINITIONS[ALIASES[key] || key] || null;
  }

  function instantiate(spec) {
    const value = spec || {};
    const definition = resolve(value.symbolId || value.kind || value.id);
    if (!definition) throw new Error('Unknown board symbol: ' + String(value.symbolId || value.kind || value.id));
    const box = {
      x: n(value.x != null ? value.x : value.bbox && value.bbox.x, 0),
      y: n(value.y != null ? value.y : value.bbox && value.bbox.y, 0),
      width: Math.max(20, n(value.width != null ? value.width : value.bbox && value.bbox.width, 80)),
      height: Math.max(16, n(value.height != null ? value.height : value.bbox && value.bbox.height, 50))
    };
    box.cx = box.x + box.width / 2; box.cy = box.y + box.height / 2;
    const terminals = terminalPositions(definition, box, value.pins);
    const primitives = [];
    if (['iec-resistor', 'iec-ntc', 'iec-varistor', 'capacitor', 'polarized-capacitor', 'fuse', 'diode', 'zener', 'tvs-bidirectional', 'inductor', 'gdt']
      .includes(definition.glyph)) twoTerminalGlyph(definition.glyph, box, primitives);
    else multiGlyph(definition.glyph, box, primitives, terminals);
    terminals.forEach((terminal) => {
      primitives.push(circle(terminal.x, terminal.y, 1.5, 'pin-anchor', 'paper'));
    });
    return Object.freeze({
      symbolId: definition.id, definition, bbox: Object.freeze(box), pins: terminals,
      primitives: Object.freeze(primitives), ref: String(value.ref || ''), value: String(value.value || '')
    });
  }

  function escapeXml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function primitiveSvg(item) {
    const stroke = '#172033'; const common = ' fill="none" stroke="' + stroke + '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
    if (item.kind === 'line') return '<line x1="' + item.x1 + '" y1="' + item.y1 + '" x2="' + item.x2 + '" y2="' + item.y2 + '"' + common + '/>';
    if (item.kind === 'rect') return '<rect x="' + item.x + '" y="' + item.y + '" width="' + item.width + '" height="' + item.height + '"' + common + '/>';
    if (item.kind === 'circle') return '<circle cx="' + item.x + '" cy="' + item.y + '" r="' + item.radius + '"' + common + (item.fill === 'ink' ? ' fill="' + stroke + '"' : item.fill === 'paper' ? ' fill="#fff"' : '') + '/>';
    if (item.kind === 'polyline') return '<' + (item.closed ? 'polygon' : 'polyline') + ' points="' + item.points.map((q) => q.x + ',' + q.y).join(' ') + '"' + common + '/>';
    if (item.kind === 'arc') {
      const s = item.startAngle * Math.PI / 180; const e = item.endAngle * Math.PI / 180;
      const x1 = item.x + item.radius * Math.cos(s); const y1 = item.y + item.radius * Math.sin(s);
      const x2 = item.x + item.radius * Math.cos(e); const y2 = item.y + item.radius * Math.sin(e);
      return '<path d="M' + x1 + ',' + y1 + ' A' + item.radius + ',' + item.radius + ' 0 0,1 ' + x2 + ',' + y2 + '"' + common + '/>';
    }
    if (item.kind === 'text') return '<text x="' + item.x + '" y="' + item.y + '" text-anchor="middle" dominant-baseline="middle" font-size="' + item.height + '" fill="' + stroke + '">' + escapeXml(item.text) + '</text>';
    return '';
  }
  function svgPreview(id, options) {
    const o = options || {}; const symbol = instantiate({ symbolId: id, x: 8, y: 8, width: 84, height: 54 });
    return '<svg viewBox="0 0 100 70" width="' + n(o.width, 140) + '" height="' + n(o.height, 98) + '" role="img" aria-label="' + escapeXml(symbol.definition.name) + '">' +
      symbol.primitives.map(primitiveSvg).join('') + '</svg>';
  }

  function primitiveEndpoints(item) {
    if (item.kind === 'line') return [{ x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 }];
    if (item.kind === 'polyline' && item.points && item.points.length) return [item.points[0], item.points[item.points.length - 1]];
    if (item.kind === 'arc') {
      const s = item.startAngle * Math.PI / 180; const e = item.endAngle * Math.PI / 180;
      return [{ x: item.x + item.radius * Math.cos(s), y: item.y + item.radius * Math.sin(s) },
        { x: item.x + item.radius * Math.cos(e), y: item.y + item.radius * Math.sin(e) }];
    }
    return [];
  }
  function pointOnSegment(point, a, b, tolerance) {
    const dx = b.x - a.x; const dy = b.y - a.y; const length2 = dx * dx + dy * dy;
    if (length2 < tolerance * tolerance) return Math.hypot(point.x - a.x, point.y - a.y) <= tolerance;
    const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2;
    if (t < -tolerance || t > 1 + tolerance) return false;
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) <= tolerance;
  }
  function pointOnPrimitive(point, item, tolerance) {
    if (item.kind === 'line') return pointOnSegment(point, { x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 }, tolerance);
    if (item.kind === 'polyline') {
      const pts = item.points || [];
      for (let i = 1; i < pts.length; i += 1) if (pointOnSegment(point, pts[i - 1], pts[i], tolerance)) return true;
      if (item.closed && pts.length > 2 && pointOnSegment(point, pts[pts.length - 1], pts[0], tolerance)) return true;
      return false;
    }
    if (item.kind === 'rect') {
      const left = item.x; const right = item.x + item.width; const top = item.y; const bottom = item.y + item.height;
      return pointOnSegment(point, { x: left, y: top }, { x: right, y: top }, tolerance) ||
        pointOnSegment(point, { x: right, y: top }, { x: right, y: bottom }, tolerance) ||
        pointOnSegment(point, { x: right, y: bottom }, { x: left, y: bottom }, tolerance) ||
        pointOnSegment(point, { x: left, y: bottom }, { x: left, y: top }, tolerance);
    }
    if (item.kind === 'circle') return Math.abs(Math.hypot(point.x - item.x, point.y - item.y) - item.radius) <= tolerance ||
      (item.fill === 'ink' && Math.hypot(point.x - item.x, point.y - item.y) <= item.radius + tolerance);
    if (item.kind === 'arc') {
      const radius = Math.abs(Number(item.radius));
      const dx = Number(point.x) - Number(item.x); const dy = Number(point.y) - Number(item.y);
      if (!Number.isFinite(radius) || radius <= tolerance ||
        Math.abs(Math.hypot(dx, dy) - radius) > tolerance) return false;
      const normalizeAngle = (value) => ((Number(value) % 360) + 360) % 360;
      const start = normalizeAngle(item.startAngle); const end = normalizeAngle(item.endAngle);
      let sweep = normalizeAngle(end - start);
      if (sweep === 0 && Number(item.endAngle) !== Number(item.startAngle)) sweep = 360;
      const pointAngle = normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI);
      const offset = normalizeAngle(pointAngle - start);
      const angleTolerance = Math.asin(Math.min(1, tolerance / radius)) * 180 / Math.PI + 1e-9;
      return offset <= sweep + angleTolerance || 360 - offset <= angleTolerance;
    }
    return false;
  }
  function primitivesTouch(left, right, tolerance) {
    return primitiveEndpoints(left).some((point) => pointOnPrimitive(point, right, tolerance)) ||
      primitiveEndpoints(right).some((point) => pointOnPrimitive(point, left, tolerance));
  }
  function auditPinGeometry(symbolOrId) {
    const symbol = typeof symbolOrId === 'string' ? instantiate({ symbolId: symbolOrId }) : symbolOrId;
    if (!symbol) return Object.freeze({ ok: false, errors: Object.freeze([{ code: 'SYMBOL_MISSING' }]) });
    const tolerance = 1e-5;
    const primitives = (symbol.primitives || []).filter((item) => item.symbolRole !== 'pin-anchor' && item.kind !== 'text');
    const body = (item) => item.symbolRole === 'primary-conductor' || !/(?:lead|conductor)/i.test(String(item.symbolRole || ''));
    const adjacency = primitives.map(() => []);
    for (let i = 0; i < primitives.length; i += 1) for (let j = i + 1; j < primitives.length; j += 1) {
      if (primitivesTouch(primitives[i], primitives[j], tolerance)) { adjacency[i].push(j); adjacency[j].push(i); }
    }
    const errors = [];
    (symbol.pins || []).forEach((port) => {
      const starts = primitives.map((item, index) => primitiveEndpoints(item).some((point) =>
        Math.hypot(Number(point.x) - Number(port.x), Number(point.y) - Number(port.y)) <= tolerance) ? index : -1)
        .filter((index) => index >= 0);
      if (!starts.length) {
        errors.push({ code: 'PIN_ANCHOR_NOT_CONNECTED_TO_LEAD', symbolId: symbol.symbolId, pinId: port.id, x: port.x, y: port.y });
        return;
      }
      const queue = starts.slice(); const seen = new Set(queue); let reachesBody = starts.some((index) => body(primitives[index]));
      while (queue.length && !reachesBody) {
        const index = queue.shift();
        adjacency[index].forEach((next) => {
          if (seen.has(next)) return; seen.add(next);
          if (body(primitives[next])) reachesBody = true; else queue.push(next);
        });
      }
      if (!reachesBody) errors.push({ code: 'PIN_LEAD_NOT_CONNECTED_TO_SYMBOL_BODY', symbolId: symbol.symbolId, pinId: port.id });
    });
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
  }

  return Object.freeze({
    VERSION, STANDARD_BASELINE, REVIEW_STATUS, DEFINITIONS, ALIASES,
    resolve, instantiate, svgPreview, auditPinGeometry, ids: Object.freeze(Object.keys(DEFINITIONS).sort())
  });
});
