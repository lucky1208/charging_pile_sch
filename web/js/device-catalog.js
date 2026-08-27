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

  const VERSION = '2.5.0';
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
    if (Array.isArray(c.conductors) && c.conductors.length) return c.conductors.slice();
    const phases = Number(c.phases) === 2 ? 2 : 3;
    const list = phases === 2 ? ['L1', 'L2'] : ['L1', 'L2', 'L3'];
    if (c.neutral) list.push('N');
    return list;
  }

  function acTerminals(context, sides, directionBySide) {
    const ctx = context || {};
    const voltage = Number(ctx.voltageV) || 400;
    const domain = ctx.acDomain || 'AC_MAINS';
    const out = [];
    (sides || ['IN', 'OUT']).forEach((side) => {
      const defaults = { IN: 'in', OUT: 'out', LINE: 'in', BUS: 'bidirectional', AC: 'in' };
      const direction = (directionBySide && directionBySide[side]) || defaults[side] || 'bidirectional';
      acConductors(context).forEach((phase) => out.push(terminal(side + '_' + phase, {
        label: side + ' ' + phase,
        netClass: 'POWER_AC', domain, phase,
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
    , 'split-interface': { name: '分体式柜端电缆接口', category: 'CONNECTOR' }
    , 'ac-charge-connector': { name: '交流充电插座', category: 'CONNECTOR' }
    , 'dc-charge-inlet': { name: '直流补电座', category: 'CONNECTOR' }
    , 'dc-dc-charge-module': { name: '储能充电 DC/DC 模块', category: 'CONVERTER' }
    , 'hv-aux-converter': { name: '高压转 24V 辅助变换器', category: 'CONVERTER' }
    , 'aux-dc-converter': { name: '24V 转 12V 辅助变换器', category: 'CONVERTER' }
    , 'interface-12v-supply': { name: '充电接口隔离 12V 电源', category: 'CONVERTER' }
    , 'four-pole-safety': { name: '四触点硬联锁', category: 'SAFETY' }
    , 'battery-heater': { name: '电池高压加热负载', category: 'AUXILIARY' }
    , 'ac-ev-transformer': { name: '交流充电支路隔离变压器', category: 'CONVERTER' }
    , 'battery-box': { name: '串联储能电池箱', category: 'ESS' }
    , 'touch-display': { name: '触摸显示屏', category: 'CONTROL' }
    , 'card-reader': { name: '刷卡器', category: 'CONTROL' }
    , 'voice-board': { name: '语音控制板', category: 'CONTROL' }
    , 'loudspeaker': { name: '扬声器', category: 'AUXILIARY' }
    , 'selector-switch-dual': { name: '机械联动双触点选择开关', category: 'SAFETY' }
    , 'external-connector-12pin': { name: '12芯外部线束连接器', category: 'CONNECTOR' }
    , 'control-relay': { name: '控制中继', category: 'SWITCHING' }
    , 'temperature-sensor': { name: '两线温度传感器', category: 'MONITORING' }
    , 'ac-dc-mode-interlock': { name: '交直流模式硬互锁', category: 'SAFETY' }
    , 'heating-connector-2pin': { name: '电池加热两芯接口', category: 'CONNECTOR' }
    , 'rf-antenna': { name: '射频天线', category: 'COMMUNICATION' }
    , 'nacs-shared-inlet': { name: 'NACS交直流共享物理输入口', category: 'CONNECTOR' }
    , 'ac-dc-power-selector': { name: '交直流双极模式选择边界', category: 'SWITCHING' }
    , 'control-pilot-generator': { name: '控制导引 CP 信号发生单元', category: 'CONTROL_DIAGNOSTIC' }
    , 'control-pilot-monitor': { name: '控制导引 CP 高阻采样单元', category: 'CONTROL_DIAGNOSTIC' }
    , 'vehicle-diode-detector': { name: '车辆侧二极管存在检测单元', category: 'CONTROL_DIAGNOSTIC' }
    , 'output-precheck-monitor': { name: '送电前输出回路预检单元', category: 'SAFETY_DIAGNOSTIC' }
    , 'contactor-state-monitor': { name: '接触器逐极状态/粘连监测单元', category: 'SAFETY_DIAGNOSTIC' }
  });

  function connectorPinTerminals(context, powerDirection) {
    const c = context || {};
    const type = c.connectorType || 'gbt-dc';
    const lib = window.EVSE_CONNECTOR_LIB;
    const def = lib && lib.get(type);
    if (!def) throw new Error('Unknown connector definition: ' + type);
    const dcDirection = powerDirection || 'in';
    const dcDomain = c.dcDomain || 'HV_DC_CHARGE';
    const dcNetClass = dcDomain === 'HV_DC_ESS' ? 'POWER_DC_ESS' : 'POWER_DC';
    return def.pins.map((pin) => {
      if (pin.id === 'DC+') return terminal('DC_POS', { label: 'DC+', netClass: dcNetClass, domain: dcDomain, polarity: 'POSITIVE', direction: dcDirection, required: true });
      if (pin.id === 'DC-') return terminal('DC_NEG', { label: 'DC−', netClass: dcNetClass, domain: dcDomain, polarity: 'NEGATIVE', direction: dcDirection, required: true });
      if (pin.id === 'PE') return terminal('PE', { label: pin.label || 'PE', netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'bidirectional', required: true });
      if (pin.id === 'A+') return terminal('A_POS', { label: 'A+', netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX', polarity: 'POSITIVE', direction: 'bidirectional', required: false });
      if (pin.id === 'A-') return terminal('A_NEG', { label: 'A−', netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX', polarity: 'RETURN', direction: 'bidirectional', required: false });
      if (pin.kind === 'aux-power' && pin.id === 'CHARGER_12V') {
        return terminal('CHARGER_12V', {
          label: pin.label || 'Charger 12V', netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX_12V',
          voltageV: 12, referenceVoltageV: 12, polarity: 'POSITIVE', direction: dcDirection,
          required: pin.required !== false, multiplicity: 'one', electricalType: 'power'
        });
      }
      const comm = ['S+', 'S-', 'CAN_H', 'CAN_L'].includes(pin.id) ||
        (pin.id === 'CP' && c.physicalLayer === 'PLC');
      const signalRole = pin.signalRole || ({
        'S+': 'GB_CAN:P', 'S-': 'GB_CAN:N',
        CAN_H: 'CHADEMO_CAN:H', CAN_L: 'CHADEMO_CAN:L',
        CP: 'CP', PP: 'PP', CC1: 'CC1', CC2: 'CC2'
      })[pin.id];
      return terminal(pin.id.replace('+', '_POS').replace('-', '_NEG'), {
        label: pin.label || pin.id,
        netClass: comm ? 'SIGNAL_COMM' : 'SIGNAL_CTRL',
        domain: comm ? 'COMMUNICATION' : 'CONTROL',
        protocol: comm ? (c.protocol || def.comm) : (pin.protocol || (type === 'chademo' ? 'CHADEMO_DISCRETE' : 'DISCRETE')),
        signalRole,
        direction: pin.direction || 'bidirectional', required: pin.required !== false && pin.kind === 'signal', electricalType: 'signal'
      });
    });
  }

  function connectorTerminals(context) {
    return connectorPinTerminals(context, 'in');
  }

  function splitInterfaceTerminals() {
    const pair = (prefix, polarity) => terminal(prefix + '_DC_' + (polarity === 'POSITIVE' ? 'POS' : 'NEG'), {
      netClass: 'POWER_DC', domain: 'HV_DC_CHARGE', polarity,
      direction: prefix === 'IN' ? 'in' : 'out', required: true
    });
    const comm = (prefix, side) => terminal(prefix + '_COMM_' + side, {
      netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'SPLIT_TERMINAL_CAN',
      signalRole: 'SPLIT_LINK:' + side, direction: 'bidirectional', required: true, electricalType: 'signal'
    });
    const interlock = (prefix) => terminal(prefix + '_INTERLOCK', {
      netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'HARDWIRED_INTERLOCK',
      signalRole: 'SPLIT:INTERLOCK', direction: prefix === 'IN' ? 'in' : 'out', required: true, electricalType: 'signal'
    });
    return [pair('IN', 'POSITIVE'), pair('IN', 'NEGATIVE'), pair('OUT', 'POSITIVE'), pair('OUT', 'NEGATIVE')]
      .concat(auxPair(24, 'IN', 'in', true), auxPair(24, 'OUT', 'out', true))
      .concat(['P', 'N'].flatMap((side) => [comm('IN', side), comm('OUT', side)]))
      .concat([interlock('IN'), interlock('OUT'), peTerminal('bidirectional', true)]);
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
      case 'dc-meter': {
        if (c.measurementMode === 'SHUNT_TA_TB') {
          out = [
            terminal('SENSE_DC_POS', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: 'POSITIVE', direction: 'in', required: true, electricalType: 'high-impedance-voltage-sense' }),
            terminal('SENSE_DC_NEG', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: 'NEGATIVE', direction: 'in', required: true, electricalType: 'high-impedance-voltage-sense' }),
            terminal('SHUNT_SENSE_P', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'SHUNT_KELVIN', signalRole: 'SHUNT_KELVIN:P', direction: 'in', required: true, electricalType: 'high-impedance-shunt-sense' }),
            terminal('SHUNT_SENSE_N', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'SHUNT_KELVIN', signalRole: 'SHUNT_KELVIN:N', direction: 'in', required: true, electricalType: 'high-impedance-shunt-sense' }),
            terminal('COMM_TA', { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'TA_TB_UNKNOWN', signalRole: 'METER_LINK:TA', direction: 'bidirectional', required: true, electricalType: 'signal' }),
            terminal('COMM_TB', { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'TA_TB_UNKNOWN', signalRole: 'METER_LINK:TB', direction: 'bidirectional', required: true, electricalType: 'signal' }),
            terminal('METER_PWR_POS', { netClass: 'POWER_DC_AUX', domain: 'AUX_SUPPLY_UNRESOLVED', polarity: 'POSITIVE', direction: 'in', required: false, electricalType: 'power', evidenceStatus: 'OBSERVED_VOLTAGE_UNRESOLVED' }),
            terminal('METER_PWR_RET', { netClass: 'POWER_DC_AUX', domain: 'AUX_SUPPLY_UNRESOLVED', polarity: 'RETURN', direction: 'in', required: false, electricalType: 'power', evidenceStatus: 'OBSERVED_VOLTAGE_UNRESOLVED' })
          ];
          break;
        }
        const measuredPolarity = c.polarity === 'NEGATIVE' ? 'NEGATIVE' : 'POSITIVE';
        const sensePolarity = measuredPolarity === 'POSITIVE' ? 'NEGATIVE' : 'POSITIVE';
        out = [
          terminal('IN', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: measuredPolarity, direction: 'in', required: true }),
          terminal('OUT', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: measuredPolarity, direction: 'out', required: true }),
          terminal('SENSE_' + (sensePolarity === 'POSITIVE' ? 'POS' : 'NEG'), { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: sensePolarity, direction: 'in', required: true })
        ];
        break;
      }
      case 'dc-contactor':
      case 'ess-contactor':
      case 'precharge-contactor': out = [terminal('IN', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarity || 'POSITIVE', direction: 'in', required: true }), terminal('OUT', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarity || 'POSITIVE', direction: 'out', required: true })].concat(auxPair(24, 'COIL', 'in', true)); break;
      case 'insulation-monitor': out = dcPair('SENSE', 'in', 'HV_DC_CHARGE', true).concat([terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'out', required: true })]).concat(auxPair(24, 'PWR', 'in', true)).concat(signalPair('ALARM', 'SIGNAL_CTRL', 'DRY_CONTACT', 'out', true)); break;
      case 'control-pilot-generator': out = auxPair(24, 'PWR', 'in', true).concat([
        terminal('PWM_CMD', {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'CONTROL_PILOT_INTERNAL',
          signalRole: 'CP:PWM_COMMAND', direction: 'in', required: true,
          multiplicity: 'one', electricalType: 'pwm-command'
        }),
        terminal('CP_OUT', {
          label: 'CP OUT', netClass: c.cpNetClass || 'SIGNAL_CTRL', domain: c.cpDomain || 'CONTROL',
          protocol: c.cpProtocol || 'IEC_61851_CP', signalRole: c.cpSignalRole || 'CP',
          direction: 'out', required: true, multiplicity: 'one', electricalType: 'controlled-pilot-source'
        })
      ]); break;
      case 'control-pilot-monitor': out = auxPair(24, 'PWR', 'in', true).concat([
        terminal('CP_SENSE', {
          label: 'CP SENSE', netClass: c.cpNetClass || 'SIGNAL_CTRL', domain: c.cpDomain || 'CONTROL',
          protocol: c.cpProtocol || 'IEC_61851_CP', signalRole: c.cpSignalRole || 'CP',
          direction: 'in', required: true, multiplicity: 'one', electricalType: 'high-impedance-pilot-sense'
        }),
        terminal('CP_VALUE', {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'CONTROL_PILOT_INTERNAL',
          signalRole: 'CP:MEASURED_VALUE', direction: 'out', required: true,
          multiplicity: 'one', electricalType: 'conditioned-analog-signal'
        })
      ]); break;
      case 'vehicle-diode-detector': out = auxPair(24, 'PWR', 'in', true).concat([
        terminal('CP_SENSE', {
          label: 'CP DIODE SENSE', netClass: c.cpNetClass || 'SIGNAL_CTRL', domain: c.cpDomain || 'CONTROL',
          protocol: c.cpProtocol || 'IEC_61851_CP', signalRole: c.cpSignalRole || 'CP',
          direction: 'in', required: true, multiplicity: 'one', electricalType: 'high-impedance-diode-sense'
        }),
        terminal('DIODE_OK', {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'CONTROL_PILOT_INTERNAL',
          signalRole: 'CP:VEHICLE_DIODE_OK', direction: 'out', required: true,
          multiplicity: 'one', electricalType: 'diagnostic-result'
        })
      ]); break;
      case 'output-precheck-monitor':
      case 'contactor-state-monitor': {
        const monitorFunction = kind === 'output-precheck-monitor' ? 'OUTPUT_PRECHECK' : 'CONTACTOR_STATE';
        const senses = c.powerType === 'AC'
          ? acConductors(c).map((phase) => terminal('SENSE_' + phase, {
            label: 'SENSE ' + phase, netClass: 'POWER_AC', domain: c.acDomain || 'AC_EV_OUTPUT', phase,
            direction: 'in', required: true, multiplicity: 'one',
            electricalType: 'high-impedance-voltage-sense', voltageRangeV: [0, Math.max(600, Number(c.voltageV) || 600)]
          }))
          : dcPair('SENSE', 'in', c.domain || 'HV_DC_CHARGE', true).map((sense) => Object.assign(sense, {
            multiplicity: 'one', electricalType: 'high-impedance-voltage-sense'
          }));
        out = senses.concat(auxPair(24, 'PWR', 'in', true));
        if (kind === 'output-precheck-monitor') {
          out = out.concat([
            terminal('TEST_ENABLE', {
              netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'HARDWIRED_DIAGNOSTIC',
              signalRole: monitorFunction + ':ENABLE', direction: 'in', required: true,
              multiplicity: 'one', electricalType: 'diagnostic-command'
            }),
            terminal('TEST_RESULT', {
              netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'HARDWIRED_DIAGNOSTIC',
              signalRole: monitorFunction + ':RESULT', direction: 'out', required: true,
              multiplicity: 'one', electricalType: 'diagnostic-result'
            })
          ]);
        } else {
          out = out.concat([terminal('WELD_STATUS', {
            netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'HARDWIRED_DIAGNOSTIC',
            signalRole: monitorFunction + ':WELD_STATUS', direction: 'out', required: true,
            multiplicity: 'one', electricalType: 'diagnostic-result'
          })]);
        }
        break;
      }
      case 'charge-connector': out = connectorTerminals(c); break;
      case 'dc-charge-inlet': out = connectorPinTerminals(c, 'out'); break;
      case 'ac-charge-connector': {
        const conductors = Array.isArray(c.conductors) && c.conductors.length ? c.conductors : acConductors(c);
        const controlPins = Array.isArray(c.controlPins) ? c.controlPins : ['CP', 'PP'];
        out = conductors.map((phase) => terminal('AC_' + phase, {
          label: 'AC ' + phase, netClass: 'POWER_AC', domain: c.acDomain || 'AC_MAINS', phase,
          direction: c.powerDirection || 'in', required: true, voltageRangeV: [0, 600]
        })).concat(c.includePe === false ? [] : [peTerminal('in', true)]).concat(controlPins.map((pin) => terminal(pin, {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: pin === 'CP' ? 'IEC_61851_CP' : 'IEC_61851_PROXIMITY',
          signalRole: 'AC:' + pin, direction: 'bidirectional', required: true, electricalType: 'signal'
        })));
        break;
      }
      case 'ac-ev-transformer': {
        const input = Array.isArray(c.inputConductors) ? c.inputConductors : ['L1', 'L2'];
        const output = Array.isArray(c.outputConductors) ? c.outputConductors : ['L1', 'L2'];
        out = input.map((phase) => terminal('IN_' + phase, {
          netClass: 'POWER_AC', domain: 'AC_MAINS', phase, direction: 'in', required: true,
          voltageRangeV: [0, 600]
        })).concat(output.map((phase) => terminal('OUT_' + phase, {
          netClass: 'POWER_AC', domain: 'AC_EV_OUTPUT', phase, direction: 'out', required: true,
          voltageRangeV: [0, 600]
        }))).concat([peTerminal('in', true)]);
        break;
      }
      case 'split-interface': out = splitInterfaceTerminals(); break;
      case 'connector-lock': out = auxPair(24, 'PWR', 'in', true).concat([
        terminal('DRIVE', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'in', required: true, electricalType: 'signal' }),
        terminal('FEEDBACK', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'out', required: true, electricalType: 'signal' })
      ]).concat(c.feedbackCount > 1 ? [terminal('FEEDBACK_2', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'out', required: true, electricalType: 'signal' })] : []); break;
      case 'aux-psu': out = [
        terminal('AC_L1', { netClass: 'POWER_AC', domain: 'AC_MAINS', phase: 'L1', direction: 'in', required: true }),
        terminal(c.neutral ? 'AC_N' : 'AC_L2', { netClass: 'POWER_AC', domain: 'AC_MAINS', phase: c.neutral ? 'N' : 'L2', direction: 'in', required: true })
      ].concat(auxPair(c.outputVoltageV || 24, 'OUT', 'out', true)).concat([peTerminal()]); break;
      case 'aux-busbar': out = auxPair(24, 'BUS24', 'bidirectional', true).concat(auxPair(12, 'BUS12', 'bidirectional', true)); break;
      case 'charge-controller': out = auxPair(24, 'PWR', 'in', true); break;
      case 'comm-gateway': out = auxPair(c.supplyVoltageV || 12, 'PWR', 'in', true)
        .concat(c.rfPort === true ? [terminal('RF_PORT', {
          netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'RF_UNKNOWN',
          signalRole: 'RF_LINK', direction: 'bidirectional', required: true,
          electricalType: 'rf-port', evidenceStatus: 'OBSERVED_PHYSICAL_LINK_PROTOCOL_UNRESOLVED'
        })] : []); break;
      case 'hmi-unit': out = auxPair(c.supplyVoltageV || 12, 'PWR', 'in', true); break;
      case 'safety-device': out = [
        terminal('CONTACT_A', { netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE', direction: 'in', required: true, electricalType: 'dry-contact-input' }),
        terminal('CONTACT_B', { netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE', direction: 'out', required: true, electricalType: 'dry-contact-output' })
      ]; break;
      case 'thermal-unit': out = auxPair(c.supplyVoltageV || 24, 'CTRL_PWR', 'in', true)
        .concat(c.enableRequired === false ? [] : [terminal('ENABLE', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'in', required: true, electricalType: 'signal' })])
        .concat([peTerminal()]); break;
      case 'earth-bar': out = [terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'bidirectional', required: true, multiplicity: 'many' })]; break;
      case 'battery-cluster': out = dcPair('PACK', 'out', 'HV_DC_ESS', true).concat(signalPair('CAN', 'SIGNAL_COMM', 'BMS_CAN', 'bidirectional', true)).concat([terminal('PE', { netClass: 'PROTECTIVE_EARTH', domain: 'PROTECTIVE_EARTH', direction: 'out', required: true })]); break;
      case 'battery-box': {
        const position = c.position || 'middle';
        const hv = [];
        if (position === 'top') {
          hv.push(terminal('PACK_DC_POS', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE', localPole: 'POSITIVE', stringPosition: position, direction: 'out', required: true }));
          hv.push(terminal('SERIES_LOW', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'INTERMEDIATE', localPole: 'NEGATIVE', stringPosition: position, direction: 'bidirectional', required: true }));
        } else if (position === 'bottom') {
          hv.push(terminal('SERIES_HIGH', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'INTERMEDIATE', localPole: 'POSITIVE', stringPosition: position, direction: 'bidirectional', required: true }));
          hv.push(terminal('PACK_DC_NEG', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE', localPole: 'NEGATIVE', stringPosition: position, direction: 'out', required: true }));
        } else {
          hv.push(terminal('SERIES_HIGH', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'INTERMEDIATE', localPole: 'POSITIVE', stringPosition: position, direction: 'bidirectional', required: true }));
          hv.push(terminal('SERIES_LOW', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'INTERMEDIATE', localPole: 'NEGATIVE', stringPosition: position, direction: 'bidirectional', required: true }));
        }
        out = hv.concat(signalPair('CAN', 'SIGNAL_COMM', 'BMS_CAN', 'bidirectional', true)).concat([peTerminal('out', true)]);
        break;
      }
      case 'ess-fuse': out = [terminal('IN', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: c.polarity || 'POSITIVE', direction: 'in', required: true }), terminal('OUT', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: c.polarity || 'POSITIVE', direction: 'out', required: true })]; break;
      case 'ess-busbar': out = dcPair('BUS', 'bidirectional', 'HV_DC_ESS', true); break;
      case 'bms-controller': out = auxPair(24, 'PWR', 'in', true).concat(signalPair('CAN', 'SIGNAL_COMM', 'BMS_CAN', 'bidirectional', true)); break;
      case 'ess-dcdc': out = dcPair('ESS', 'bidirectional', 'HV_DC_ESS', true).concat(dcPair('CHARGE', 'bidirectional', 'HV_DC_CHARGE', true)).concat(auxPair(24, 'CTRL_PWR', 'in', true)).concat(signalPair('COMM', 'SIGNAL_COMM', 'ESS_CAN', 'bidirectional', true)).concat([peTerminal()]); break;
      case 'ess-pcs': {
        const observedRectification = c.energyDirection === 'AC_TO_DC_OBSERVED_REVERSE_UNRESOLVED';
        out = dcPair('ESS', observedRectification ? 'out' : 'bidirectional', 'HV_DC_ESS', true)
          .concat(acTerminals(c, ['AC'], { AC: observedRectification ? 'in' : 'bidirectional' }))
          .concat(auxPair(24, 'CTRL_PWR', 'in', true))
          .concat(signalPair('COMM', 'SIGNAL_COMM', c.protocol || 'ESS_CAN', 'bidirectional', true))
          .concat([peTerminal()]);
        break;
      }
      case 'precharge-resistor': out = [
        terminal('A', { netClass: c.netClass || 'POWER_DC_ESS', domain: c.domain || 'HV_DC_ESS', polarity: c.polarity || 'POSITIVE', direction: 'in', required: true }),
        terminal('B', { netClass: c.netClass || 'POWER_DC_ESS', domain: c.domain || 'HV_DC_ESS', polarity: c.polarity || 'POSITIVE', direction: 'out', required: true })
      ]; break;
      case 'discharge-resistor': out = [
        terminal('A', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarityA || 'POSITIVE', direction: 'in', required: true }),
        terminal('B', { netClass: c.netClass || 'POWER_DC', domain: c.domain || 'HV_DC_CHARGE', polarity: c.polarityB || 'NEGATIVE', direction: 'in', required: true })
      ]; break;
      case 'indicator-lamp': out = auxPair(c.supplyVoltageV || 24, 'PWR', 'in', true).concat([terminal('DRIVE', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'in', required: true, electricalType: 'signal' })]); break;
      case 'environment-sensor': out = auxPair(24, 'PWR', 'in', true).concat([terminal('ALARM', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', direction: 'out', required: true, electricalType: 'signal' })]); break;
      case 'touch-display': out = auxPair(5, 'PWR', 'in', true).concat([
        terminal('TX', { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'HMI_UART', signalRole: 'HMI_UART:DISPLAY_TX', direction: 'out', required: true, electricalType: 'serial-tx' }),
        terminal('RX', { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'HMI_UART', signalRole: 'HMI_UART:HOST_TX', direction: 'in', required: true, electricalType: 'serial-rx' })
      ]); break;
      case 'card-reader': out = auxPair(c.supplyVoltageV || 5, 'PWR', 'in', true).concat([
        terminal('TX', { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'CARD_READER_SERIAL_UNKNOWN', signalRole: 'CARD_UART:CARD_TX', direction: 'out', required: true, electricalType: 'serial-tx' }),
        terminal('RX', { netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'CARD_READER_SERIAL_UNKNOWN', signalRole: 'CARD_UART:HOST_TX', direction: 'in', required: true, electricalType: 'serial-rx' })
      ]); break;
      case 'voice-board': {
        const voicePower = auxPair(c.supplyVoltageV || 5, 'PWR', 'in', true);
        voicePower[0].physicalLabel = 'V';
        voicePower[0].observedOrdinal = 1;
        voicePower[1].physicalLabel = 'G';
        voicePower[1].observedOrdinal = 1;
        out = voicePower.concat([
          terminal('RAW_V2', {
            label: 'V (2)', physicalLabel: 'V', observedOrdinal: 2,
            netClass: 'POWER_DC_AUX', domain: 'AUX_5V', voltageV: 5, polarity: 'POSITIVE',
            direction: 'in', required: false, electricalType: 'observed-terminal',
            evidenceStatus: 'OBSERVED_DESTINATION_UNRESOLVED'
          }),
          terminal('RAW_G2', {
            label: 'G (2)', physicalLabel: 'G', observedOrdinal: 2,
            netClass: 'POWER_DC_AUX', domain: 'AUX_5V', voltageV: 0, referenceVoltageV: 5, polarity: 'RETURN',
            direction: 'in', required: false, electricalType: 'observed-terminal',
            evidenceStatus: 'OBSERVED_DESTINATION_UNRESOLVED'
          }),
          terminal('RX', {
          physicalLabel: 'R', observedOrdinal: 1,
          netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: c.protocol || 'HMI_UART',
          signalRole: 'HMI_UART:HOST_TX', direction: 'in', required: true, electricalType: 'serial-rx'
          }),
          terminal('T', {
            label: 'T', observedLabel: 'T', physicalLabel: 'T', observedOrdinal: 1,
            netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'VOICE_T_UNKNOWN',
            signalRole: 'VOICE:T_UNRESOLVED', direction: 'bidirectional', required: false,
            electricalType: 'observed-terminal', evidenceStatus: 'OBSERVED_DESTINATION_UNRESOLVED',
            openCircuitPolicy: 'OBSERVED_DESTINATION_UNRESOLVED'
          })])
        .concat(['P', 'N'].map((side) => terminal('AUDIO_OUT_' + side, {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'ANALOG_AUDIO', signalRole: 'AUDIO:' + side,
          direction: 'out', required: true, electricalType: 'analog-audio'
        })));
        break;
      }
      case 'loudspeaker': out = ['P', 'N'].map((side) => terminal('AUDIO_IN_' + side, {
        netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'ANALOG_AUDIO', signalRole: 'AUDIO:' + side,
        direction: 'in', required: true, electricalType: 'analog-audio'
      })); break;
      case 'selector-switch-dual': out = [
        ['XS_5', 'CONTACT_1:A'], ['XS_20', 'CONTACT_1:B'],
        ['TX_ENABLE', 'CONTACT_2:A'], ['TX_GND', 'CONTACT_2:B']
      ].map((item) => terminal(item[0], {
        label: item[0].replace('_', '/'), netClass: 'SIGNAL_CTRL', domain: 'CONTROL',
        protocol: 'HARDWIRED_CONTACT_UNKNOWN', signalRole: item[1], direction: 'bidirectional',
        required: false, electricalType: 'mechanically-linked-contact',
        evidenceStatus: 'OBSERVED_DESTINATION_UNRESOLVED'
      })); break;
      case 'external-connector-12pin': out = [
        terminal('JT_LOOP_IN', {
          netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24,
          polarity: 'POSITIVE', direction: 'bidirectional', required: true,
          electricalType: 'external-hardwired-boundary', physicalPin: 'UNRESOLVED', electricalEvidenceStatus: 'INFERRED_REVIEW_REQUIRED'
        }),
        terminal('JT_LOOP_OUT', {
          netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24,
          polarity: 'POSITIVE', direction: 'bidirectional', required: true,
          electricalType: 'external-hardwired-boundary', physicalPin: 'UNRESOLVED', electricalEvidenceStatus: 'INFERRED_REVIEW_REQUIRED'
        })
      ].concat(Array.from({ length: 10 }, (_, index) => {
        const number = index + 1;
        return terminal('CORE_' + String(number).padStart(2, '0'), {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'EXTERNAL_CORE_UNRESOLVED',
          signalRole: 'FPT12:UNRESOLVED_CORE_' + String(number).padStart(2, '0'), direction: 'bidirectional',
          required: false, electricalType: 'external-harness-core', logicalIndex: number, physicalPin: 'UNRESOLVED',
          evidenceStatus: 'OBSERVED_DESTINATION_UNRESOLVED'
        });
      })); break;
      case 'control-relay': {
        const relayVoltage = c.coilVoltageV || 24;
        out = auxPair(relayVoltage, 'COIL', 'in', c.coilRequired !== false).concat([
        terminal('CONTACT_IN', {
          netClass: c.contactNetClass || 'POWER_DC_AUX', domain: c.contactDomain || ('AUX_' + relayVoltage + 'V'),
          voltageV: c.contactVoltageV || relayVoltage, referenceVoltageV: c.contactVoltageV || relayVoltage,
          polarity: c.contactPolarity || 'POSITIVE', direction: 'in', required: true,
          electricalType: 'relay-contact-input'
        }),
        terminal('CONTACT_OUT', {
          netClass: c.contactNetClass || 'POWER_DC_AUX', domain: c.contactDomain || ('AUX_' + relayVoltage + 'V'),
          voltageV: c.contactVoltageV || relayVoltage, referenceVoltageV: c.contactVoltageV || relayVoltage,
          polarity: c.contactPolarity || 'POSITIVE', direction: 'out', required: true,
          electricalType: 'relay-contact-output'
        })
        ]).concat(c.feedbackRequired === true ? [terminal('FEEDBACK', {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'DRY_CONTACT',
          signalRole: c.feedbackSignalRole || 'RELAY:FEEDBACK', direction: 'out', required: true,
          electricalType: 'relay-feedback', evidenceStatus: c.feedbackEvidenceStatus || 'INFERRED_REVIEW_REQUIRED'
        })] : []);
        break;
      }
      case 'temperature-sensor': out = ['P', 'N'].map((side) => terminal('SENSOR_' + side, {
        netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'PASSIVE_TEMPERATURE_UNKNOWN',
        signalRole: 'TEMPERATURE:' + side, direction: 'out', required: true,
        electricalType: 'passive-sensor'
      })); break;
      case 'ac-dc-mode-interlock': out = auxPair(24, 'PWR', 'in', true).concat([
        terminal('MODE_COMMAND', {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'HARDWIRED_MODE_SELECT',
          signalRole: 'AC_DC_MODE:COMMAND', direction: 'in', required: true, electricalType: 'hardwired-input'
        }),
        terminal('AC_PERMISSION_V24', {
          netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24,
          polarity: 'POSITIVE', direction: 'out', required: true, electricalType: 'mutually-exclusive-permission'
        }),
        terminal('DC_PERMISSION_V24', {
          netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24,
          polarity: 'POSITIVE', direction: 'out', required: true, electricalType: 'mutually-exclusive-permission'
        })
      ]); break;
      case 'heating-connector-2pin': out = [
        terminal('PANEL_H02', {
          label: 'H02 柜侧 / 加热+', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE',
          direction: 'in', required: true, electricalType: 'heater-interface-pin',
          physicalPin: 'H02', connectorSide: 'PANEL', boundary: 'HEATER_TWO_CORE_INTERFACE'
        }),
        terminal('BATTERY_H02', {
          label: 'H02 电池侧 / 加热+', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE',
          direction: 'out', required: true, electricalType: 'heater-interface-pin',
          physicalPin: 'H02', connectorSide: 'BATTERY', boundary: 'HEATER_TWO_CORE_INTERFACE'
        }),
        terminal('BATTERY_H05', {
          label: 'H05 电池侧 / 加热−', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE',
          direction: 'in', required: true, electricalType: 'heater-interface-pin',
          physicalPin: 'H05', connectorSide: 'BATTERY', boundary: 'HEATER_TWO_CORE_INTERFACE'
        }),
        terminal('PANEL_H05', {
          label: 'H05 柜侧 / 加热−', netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE',
          direction: 'out', required: true, electricalType: 'heater-interface-pin',
          physicalPin: 'H05', connectorSide: 'PANEL', boundary: 'HEATER_TWO_CORE_INTERFACE'
        })
      ]; break;
      case 'rf-antenna': out = [terminal('RF', {
        netClass: 'SIGNAL_COMM', domain: 'COMMUNICATION', protocol: 'RF_UNKNOWN',
        signalRole: 'RF_LINK', direction: 'bidirectional', required: true,
        electricalType: 'rf-port', evidenceStatus: 'OBSERVED_PHYSICAL_LINK_PROTOCOL_UNRESOLVED'
      })]; break;
      case 'nacs-shared-inlet': out = ['A', 'B'].map((pole) => terminal('PWR_' + pole, {
        label: 'NACS共享功率触点 ' + pole, netClass: 'POWER_INTERFACE_MODED', domain: 'INTERFACE_POWER_MODED',
        direction: 'bidirectional', required: true, electricalType: 'mode-dependent-power-contact',
        modeDependent: true, mutualExclusionGroup: 'NACS_AC_DC_POWER'
      })).concat(['CP', 'PP'].map((pin) => terminal(pin, {
        netClass: pin === 'CP' && c.physicalLayer === 'PLC' ? 'SIGNAL_COMM' : 'SIGNAL_CTRL',
        domain: pin === 'CP' && c.physicalLayer === 'PLC' ? 'COMMUNICATION' : 'CONTROL',
        protocol: pin === 'CP' && c.physicalLayer === 'PLC' ? c.protocol : (pin === 'CP' ? 'IEC_61851_CP' : 'DISCRETE'),
        signalRole: pin, direction: 'bidirectional', required: true, electricalType: 'signal',
        activeModes: ['AC', 'DC']
      }))).concat([peTerminal('bidirectional', true)]); break;
      case 'ac-dc-power-selector': out = ['A', 'B'].map((pole) => terminal('COMMON_' + pole, {
        netClass: 'POWER_INTERFACE_MODED', domain: 'INTERFACE_POWER_MODED', direction: 'in', required: true,
        electricalType: 'break-before-make-common', modeDependent: true, mutualExclusionGroup: 'NACS_AC_DC_POWER'
      })).concat(['L1', 'L2'].map((phase) => terminal('AC_' + phase, {
        netClass: 'POWER_AC', domain: 'AC_MAINS', phase, direction: 'out', required: true,
        electricalType: 'mode-selected-ac-throw', activeMode: 'AC', mutualExclusionGroup: 'NACS_AC_DC_POWER'
      }))).concat([
        terminal('DC_POS', {
          netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'POSITIVE', direction: 'out', required: true,
          electricalType: 'mode-selected-dc-throw', activeMode: 'DC', mutualExclusionGroup: 'NACS_AC_DC_POWER'
        }),
        terminal('DC_NEG', {
          netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: 'NEGATIVE', direction: 'out', required: true,
          electricalType: 'mode-selected-dc-throw', activeMode: 'DC', mutualExclusionGroup: 'NACS_AC_DC_POWER'
        })
      ]); break;
      case 'dc-dc-charge-module': out = dcPair('ESS', 'in', 'HV_DC_ESS', true)
        .concat(dcPair('CHARGE', 'out', 'HV_DC_CHARGE', true))
        .concat(auxPair(24, 'CTRL_PWR', 'in', true))
        .concat(signalPair('COMM', 'SIGNAL_COMM', 'MODULE_CAN', 'bidirectional', true))
        .concat([peTerminal()]); break;
      case 'hv-aux-converter': out = dcPair('ESS', 'in', 'HV_DC_ESS', true)
        .concat(auxPair(24, 'OUT', 'out', true)).concat([peTerminal()]); break;
      case 'aux-dc-converter': out = auxPair(c.inputVoltageV || 24, 'IN', 'in', true).concat(auxPair(c.outputVoltageV || 12, 'OUT', 'out', true)); break;
      case 'interface-12v-supply': out = auxPair(12, 'IN', 'in', true).concat([
        terminal('CHARGER_12V', { netClass: 'POWER_DC_AUX', domain: 'CONNECTOR_AUX_12V', voltageV: 12, referenceVoltageV: 12, polarity: 'POSITIVE', direction: 'out', required: true, electricalType: 'power' }),
        terminal('ENABLE', { netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'HARDWIRED_ENABLE', signalRole: 'CONNECTOR_12V:ENABLE', direction: 'in', required: true, electricalType: 'signal' })
      ]); break;
      case 'four-pole-safety': out = ['A', 'B', 'C', 'D'].flatMap((pole) => [
        terminal(pole + '_IN', { netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE', direction: 'in', required: true, electricalType: 'dry-contact-input' }),
        terminal(pole + '_OUT', { netClass: 'POWER_DC_AUX', domain: 'AUX_24V', voltageV: 24, referenceVoltageV: 24, polarity: 'POSITIVE', direction: 'out', required: true, electricalType: 'dry-contact-output' })
      ]); break;
      case 'battery-heater': {
        const position = c.seriesPosition || 'single';
        const highPolarity = position === 'top' || position === 'single' ? 'POSITIVE' : 'INTERMEDIATE';
        const lowPolarity = position === 'bottom' || position === 'single' ? 'NEGATIVE' : 'INTERMEDIATE';
        out = [
          terminal('HEAT_HIGH', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: highPolarity, localPole: 'POSITIVE', direction: 'in', required: true }),
          terminal('HEAT_LOW', { netClass: 'POWER_DC_ESS', domain: 'HV_DC_ESS', polarity: lowPolarity, localPole: 'NEGATIVE', direction: 'out', required: true })
        ].concat([peTerminal()]);
        break;
      }
      default: out = [];
    }
    if (['ac-contactor'].includes(kind)) out = out.concat(auxPair(24, 'COIL', 'in', true));
    if (['ac-contactor', 'dc-contactor'].includes(kind) && c.feedbackRequired === true) {
      out = out.concat([terminal('FEEDBACK', {
        netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'DRY_CONTACT',
        signalRole: c.feedbackSignalRole || 'CONTACTOR:FEEDBACK', direction: 'out', required: true,
        multiplicity: 'one', electricalType: 'mechanically-linked-auxiliary-feedback',
        evidenceStatus: c.feedbackEvidenceStatus || 'FUNCTIONAL_REQUIREMENT—DEVICE_EVIDENCE_REQUIRED'
      })]);
    }
    if (kind === 'ac-meter' || (kind === 'dc-meter' && c.measurementMode !== 'SHUNT_TA_TB')) out = out.concat(signalPair('COMM', 'SIGNAL_COMM', c.protocol || 'RS485', 'bidirectional', true));
    if (kind === 'residual-current-monitor') out = out.concat(signalPair('SIGNAL', 'SIGNAL_CTRL', c.protocol || 'ANALOG_OR_DRY', 'out', true));
    if (kind === 'current-transducer') {
      out = out.concat(c.measurementMode === 'SHUNT_TA_TB'
        ? ['P', 'N'].map((side) => terminal('KELVIN_' + side, {
          netClass: 'SIGNAL_CTRL', domain: 'CONTROL', protocol: 'SHUNT_KELVIN', signalRole: 'SHUNT_KELVIN:' + side,
          direction: 'out', required: true, electricalType: 'kelvin-shunt-output'
        }))
        : signalPair('SIGNAL', 'SIGNAL_CTRL', c.protocol || 'ANALOG_OR_DRY', 'out', true));
    }
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
