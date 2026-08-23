/* ============================================================
 * EVSE controlled device catalog v2
 * ------------------------------------------------------------
 * The catalog describes engineering roles and terminal semantics.  It is
 * deliberately data-only: uploaded manuals must never create executable JS.
 * Project instances may add named functional terminals (for example CCU I/O),
 * but every terminal still carries an explicit electrical domain.
 * ============================================================ */
window.EVSE_DEVICE_CATALOG = (function () {
  'use strict';

  const VERSION = '2.0.0';
  const STATUS = Object.freeze({ APPROVED: 'APPROVED', DEPRECATED: 'DEPRECATED' });

  function terminal(id, options) {
    const o = options || {};
    return Object.assign({
      id,
      label: o.label || id,
      netClass: o.netClass || 'UNCLASSIFIED',
      domain: o.domain || 'UNCLASSIFIED',
      direction: o.direction || 'bidirectional',
      required: o.required === true,
      multiplicity: o.multiplicity || 'many',
      electricalType: o.electricalType || 'passive',
      status: o.status || STATUS.APPROVED
    }, o);
  }

  function clone(items) {
    return (items || []).map((item) => Object.assign({}, item, {
      voltageRangeV: Array.isArray(item.voltageRangeV) ? item.voltageRangeV.slice() : item.voltageRangeV
    }));
  }

  function acConductors(context) {
    const c = context || {};
    const phases = Number(c.phases) === 2 ? 2 : 3;
    const list = phases === 2 ? ['L1', 'L2'] : ['L1', 'L2', 'L3'];
    if (c.neutral) list.push('N');
    return list;
  }

  function acTerminals(context, sides, directionBySide) {
    const voltage = Number((context || {}).voltageV) || 400;
    const out = [];
    (sides || ['IN', 'OUT']).forEach((side) => {
      const defaults = { IN: 'in', OUT: 'out', LINE: 'in', BUS: 'bidirectional', AC: 'in' };
      const direction = (directionBySide && directionBySide[side]) || defaults[side] || 'bidirectional';
      acConductors(context).forEach((phase) => out.push(terminal(side + '_' + phase, {
        label: side + ' ' + phase,
        netClass: 'POWER_AC', domain: 'AC_MAINS', phase,
        direction, required: true,
        voltageRangeV: [0, Math.max(600, voltage * 1.25)]
      })));
    });
    return out;
  }

  function dcPair(prefix, direction, domain, required) {
    const p = prefix ? prefix + '_' : '';
    const d = domain || 'HV_DC_CHARGE';
    return [
      terminal(p + 'DC_POS', { label: (prefix ? prefix + ' ' : '') + 'DC+', netClass: d === 'HV_DC_ESS' ? 'POWER_DC_ESS' : 'POWER_DC', domain: d, polarity: 'POSITIVE', direction, required: required !== false }),
      terminal(p + 'DC_NEG', { label: (prefix ? prefix + ' ' : '') + 'DC−', netClass: d === 'HV_DC_ESS' ? 'POWER_DC_ESS' : 'POWER_DC', domain: d, polarity: 'NEGATIVE', direction, required: required !== false })
    ];
  }

  function auxPair(voltage, prefix, direction, required) {
    const v = Number(voltage);
    const p = prefix ? prefix + '_' : '';
    const domain = 'AUX_' + v + 'V';
    return [
      terminal(p + 'V' + v, { label: (prefix ? prefix + ' ' : '') + '+' + v + 'V', netClass: 'POWER_DC_AUX', domain, voltageV: v, polarity: 'POSITIVE', direction, required: required !== false }),
      terminal(p + 'V' + v + '_0V', { label: (prefix ? prefix + ' ' : '') + '0V(' + v + 'V)', netClass: 'POWER_DC_AUX', domain, voltageV: 0, referenceVoltageV: v, polarity: 'RETURN', direction, required: required !== false })
    ];
  }

  function signalPair(prefix, netClass, protocol, direction, required) {
    const p = prefix || 'SIG';
    const nc = netClass || 'SIGNAL_CTRL';
    const domain = nc === 'SIGNAL_COMM' ? 'COMMUNICATION' : 'CONTROL';
    return [
      terminal(p + '_P', { netClass: nc, domain, protocol, signalRole: p + ':P', direction: direction || 'bidirectional', required: required === true, electricalType: 'signal' }),
      terminal(p + '_N', { netClass: nc, domain, protocol, signalRole: p + ':N', direction: direction || 'bidirectional', required: required === true, electricalType: 'signal' })
    ];
  }

  function peTerminal(direction, required) {
    return terminal('PE', {
      netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH',
      direction: direction || 'in', required: required !== false, electricalType: 'protective-earth'
    });
  }

  const DEVICE_CLASSES = Object.freeze({
    'ac-incomer': { name: '交流进线', category: 'POWER' },
    'ac-isolator': { name: '交流隔离开关', category: 'PROTECTION' },
    'ac-breaker': { name: '交流断路器', category: 'PROTECTION' },
    'surge-protector': { name: '浪涌保护器', category: 'PROTECTION' },
    'residual-current-monitor': { name: '剩余电流监测', category: 'MONITORING' },
    'ac-contactor': { name: '交流接触器', category: 'SWITCHING' },
    'ac-meter': { name: '交流电能表', category: 'METERING' },
    'ac-busbar': { name: '交流母排', category: 'DISTRIBUTION' },
    'power-module-array': { name: '充电功率模块', category: 'CONVERTER' },
    'dc-busbar': { name: '直流母排', category: 'DISTRIBUTION' },
    'dc-fuse': { name: '直流熔断器', category: 'PROTECTION' },
    'dc-contactor': { name: '直流接触器', category: 'SWITCHING' },
    'current-transducer': { name: '电流传感器', category: 'MONITORING' },
    'insulation-monitor': { name: '绝缘监测装置', category: 'MONITORING' },
    'dc-meter': { name: '直流电能表', category: 'METERING' },
    'charge-connector': { name: '充电连接器', category: 'CONNECTOR' },
    'connector-lock': { name: '连接器电子锁', category: 'ACTUATOR' },
    'charge-controller': { name: '充电控制器', category: 'CONTROL' },
    'comm-gateway': { name: '通信网关', category: 'CONTROL' },
    'hmi-unit': { name: '人机交互单元', category: 'CONTROL' },
    'safety-device': { name: '安全输入设备', category: 'SAFETY' },
    'aux-psu': { name: '辅助开关电源', category: 'CONVERTER' },
    'aux-busbar': { name: '辅助配电端子排', category: 'DISTRIBUTION' },
    'thermal-unit': { name: '热管理设备', category: 'AUXILIARY' },
    'earth-bar': { name: '保护接地排', category: 'EARTH' },
    'battery-cluster': { name: '电池簇', category: 'ESS' },
    'ess-fuse': { name: '储能簇熔断器', category: 'ESS_PROTECTION' },
    'ess-contactor': { name: '储能簇接触器', category: 'ESS_PROTECTION' },
    'precharge-contactor': { name: '预充接触器', category: 'ESS_PROTECTION' },
    'precharge-resistor': { name: '预充电阻', category: 'ESS_PROTECTION' },
    'ess-busbar': { name: '储能直流母排', category: 'ESS' },
    'bms-controller': { name: '电池管理主控', category: 'ESS_CONTROL' },
    'ess-dcdc': { name: '双向 DC/DC', category: 'CONVERTER' },
    'ess-pcs': { name: '储能 PCS', category: 'CONVERTER' },
    'discharge-resistor': { name: '母线泄放电阻', category: 'PROTECTION' },
    'indicator-lamp': { name: '状态指示灯', category: 'CONTROL' },
    'environment-sensor': { name: '环境监测', category: 'CONTROL' }
  });

  function connectorTerminals(context) {
    const type = (context || {}).connectorType || 'gbt-dc';
    const lib = window.EVSE_CONNECTOR_LIB;
    const def = lib && lib.get(type);
    if (!def) throw new Error('Unknown connector definition: ' + type);
    return def.pins.map((pin) => {
      if (pin.id === 'DC+') return terminal('DC_POS', { label: 'DC+', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'POSITIVE', direction: 'in', required: true });
      if (pin.id === 'DC-') return terminal('DC_NEG', { label: 'DC−', netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity: 'NEGATIVE', direction: 'in', required: true });
      if (pin.id === 'PE') return terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'in', required: true });
      if (pin.id === 'A+') return terminal('A_POS', { label: 'A+', netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX', polarity: 'POSITIVE', direction: 'bidirectional', required: false });
      if (pin.id === 'A-') return terminal('A_NEG', { label: 'A−', netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX', polarity: 'RETURN', direction: 'bidirectional', required: false });
      const comm = ['S+', 'S-', 'CAN_H', 'CAN_L'].includes(pin.id) ||
        (pin.id === 'CP' && (context || {}).physicalLayer === 'PLC');
      const signalRole = ({
        'S+': 'GB_CAN:P', 'S-': 'GB_CAN:N',
        CAN_H: 'CAN:H', CAN_L: 'CAN:L',
        CP: 'CP', PP: 'PP', CC1: 'CC1', CC2: 'CC2'
      })[pin.id];
      return terminal(pin.id.replace('+', '_POS').replace('-', '_NEG'), {
        label: pin.id,
        netClass: comm ? 'SIGNAL_COMM' : 'SIGNAL_CTRL',
        domain: comm ? 'COMMUNICATION' : 'CONTROL',
        protocol: comm ? ((context || {}).protocol || def.comm) : 'DISCRETE',
        signalRole,
        direction: 'bidirectional', required: pin.kind === 'signal', electricalType: 'signal'
      });
    });
  }

  function terminalsFor(kind, context) {
    const c = context || {};
    let out = [];
    switch (kind) {
      case 'ac-incomer': out = acTerminals(c, ['OUT']).concat([terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'out', required: true })]); break;
      case 'ac-isolator':
      case 'ac-breaker':
      case 'ac-contactor':
      case 'ac-meter':
      case 'residual-current-monitor': out = acTerminals(c, ['IN', 'OUT']); break;
      case 'surge-protector': out = acTerminals(c, ['LINE']).concat([terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'out', required: true })]); break;
      case 'ac-busbar': out = acTerminals(c, ['BUS']); break;
      case 'power-module-array': out = acTerminals(c, ['AC']).concat(dcPair('', 'out', 'HV_DC_CHARGE', true)).concat(signalPair('COMM', 'SIGNAL_COMM', 'MODULE_CAN', 'bidirectional', true)).concat([peTerminal()]); break;
      case 'dc-busbar': out = dcPair('BUS', 'bidirectional', c.domain || 'HV_DC_CHARGE', true); break;
      case 'dc-fuse':
      case 'current-transducer': out = [terminal('IN', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarity || 'POSITIVE', direction: 'in', required: true }), terminal('OUT', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarity || 'POSITIVE', direction: 'out', required: true })]; break;
      case 'dc-meter': out = [
        terminal('IN', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: 'POSITIVE', direction: 'in', required: true }),
        terminal('OUT', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: 'POSITIVE', direction: 'out', required: true }),
        terminal('SENSE_NEG', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: 'NEGATIVE', direction: 'in', required: true })
      ]; break;
      case 'dc-contactor':
      case 'ess-contactor':
      case 'precharge-contactor': out = [terminal('IN', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarity || 'POSITIVE', direction: 'in', required: true }), terminal('OUT', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarity || 'POSITIVE', direction: 'out', required: true })].concat(auxPair(24, 'COIL', 'in', true)); break;
      case 'insulation-monitor': out = dcPair('SENSE', 'in', 'HV_DC_CHARGE', true).concat([terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'out', required: true })]).concat(auxPair(24, 'PWR', 'in', true)).concat(signalPair('ALARM', 'SIGNAL_CTRL', 'DRY_CONTACT', 'out', true)); break;
      case 'charge-connector': out = connectorTerminals(c); break;
      case 'connector-lock': out = auxPair(24, 'PWR', 'in', true).concat([terminal('DRIVE', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'in', required: true, electricalType: 'signal' }), terminal('FEEDBACK', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'out', required: true, electricalType: 'signal' })]); break;
      case 'aux-psu': out = [
        terminal('AC_L1', { netClass: 'POWER_AC', domain: 'AC_MAINS', phase: 'L1', direction: 'in', required: true }),
        terminal(c.neutral ? 'AC_N' : 'AC_L2', { netClass: 'POWER_AC', domain: 'AC_MAINS', phase: c.neutral ? 'N' : 'L2', direction: 'in', required: true })
      ].concat(auxPair(c.outputVoltageV || 24, 'OUT', 'out', true)).concat([peTerminal()]); break;
      case 'aux-busbar': out = auxPair(24, 'BUS24', 'bidirectional', true).concat(auxPair(12, 'BUS12', 'bidirectional', true)); break;
      case 'charge-controller': out = auxPair(24, 'PWR', 'in', true); break;
      case 'comm-gateway': out = auxPair(c.supplyVoltageV || 12, 'PWR', 'in', true); break;
      case 'hmi-unit': out = auxPair(c.supplyVoltageV || 12, 'PWR', 'in', true); break;
      case 'safety-device': out = [
        terminal('CONTACT_A', { netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE', direction: 'in', required: true, electricalType: 'dry-contact-input' }),
        terminal('CONTACT_B', { netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE', direction: 'out', required: true, electricalType: 'dry-contact-output' })
      ]; break;
      case 'thermal-unit': out = auxPair(24, 'CTRL_PWR', 'in', true).concat([terminal('ENABLE', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'in', required: true, electricalType: 'signal' }), peTerminal()]); break;
      case 'earth-bar': out = [terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'bidirectional', required: true, multiplicity: 'many' })]; break;
      case 'battery-cluster': out = dcPair('PACK', 'out', 'HV_DC_ESS', true).concat(signalPair('CAN', 'SIGNAL_COMM', 'BMS_CAN', 'bidirectional', true)).concat([terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'out', required: true })]); break;
      case 'ess-fuse': out = [terminal('IN', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: c.polarity || 'POSITIVE', direction: 'in', required: true }), terminal('OUT', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: c.polarity || 'POSITIVE', direction: 'out', required: true })]; break;
      case 'ess-busbar': out = dcPair('BUS', 'bidirectional', 'HV_DC_ESS', true); break;
      case 'bms-controller': out = auxPair(24, 'PWR', 'in', true).concat(signalPair('CAN', 'SIGNAL_COMM', 'BMS_CAN', 'bidirectional', true)); break;
      case 'ess-dcdc': out = dcPair('ESS', 'bidirectional', 'HV_DC_ESS', true).concat(dcPair('CHARGE', 'bidirectional', 'HV_DC_CHARGE', true)).concat(auxPair(24, 'CTRL_PWR', 'in', true)).concat(signalPair('COMM', 'SIGNAL_COMM', 'ESS_CAN', 'bidirectional', true)).concat([peTerminal()]); break;
      case 'ess-pcs': out = dcPair('ESS', 'bidirectional', 'HV_DC_ESS', true).concat(acTerminals(c, ['AC'], { AC: 'bidirectional' })).concat(auxPair(24, 'CTRL_PWR', 'in', true)).concat(signalPair('COMM', 'SIGNAL_COMM', 'ESS_CAN', 'bidirectional', true)).concat([peTerminal()]); break;
      case 'precharge-resistor': out = [
        terminal('A', { netClass: c.netClass || 'POWER_DC_ESS', domain: c.domain || 'HV_DC_ESS', polarity: c.polarity || 'POSITIVE', direction: 'in', required: true }),
        terminal('B', { netClass: c.netClass || 'POWER_DC_ESS', domain: c.domain || 'HV_DC_ESS', polarity: c.polarity || 'POSITIVE', direction: 'out', required: true })
      ]; break;
      case 'discharge-resistor': out = [
        terminal('A', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarityA || 'POSITIVE', direction: 'in', required: true }),
        terminal('B', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarityB || 'NEGATIVE', direction: 'in', required: true })
      ]; break;
      case 'indicator-lamp': out = auxPair(24, 'PWR', 'in', true).concat([terminal('DRIVE', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'in', required: true, electricalType: 'signal' })]); break;
      case 'environment-sensor': out = auxPair(24, 'PWR', 'in', true).concat([terminal('ALARM', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'out', required: true, electricalType: 'signal' })]); break;
      default: out = [];
    }
    if (['ac-contactor'].includes(kind)) out = out.concat(auxPair(24, 'COIL', 'in', true));
    if (['ac-meter', 'dc-meter'].includes(kind)) out = out.concat(signalPair('COMM', 'SIGNAL_COMM', c.protocol || 'RS485', 'bidirectional', true));
    if (['residual-current-monitor', 'current-transducer'].includes(kind)) out = out.concat(signalPair('SIGNAL', 'SIGNAL_CTRL', c.protocol || 'ANALOG_OR_DRY', 'out', true));
    return clone(out);
  }

  function definition(kind, context) {
    const role = DEVICE_CLASSES[kind];
    if (!role) throw new Error('Unknown controlled device class: ' + kind);
    return {
      schema: 'EVSE-DEVICE-DEFINITION/2.0',
      typeId: kind,
      version: VERSION,
      lifecycle: STATUS.APPROVED,
      source: { kind: 'CONTROLLED_INTERNAL_CATALOG', id: 'EVSE-CATALOG-' + VERSION },
      name: role.name,
      category: role.category,
      terminals: terminalsFor(kind, context)
    };
  }

  return {
    VERSION, STATUS, DEVICE_CLASSES,
    terminal, acConductors, acTerminals, dcPair, auxPair, signalPair, peTerminal,
    terminalsFor, definition
  };
})();
