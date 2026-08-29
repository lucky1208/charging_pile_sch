/* ============================================================
 * User-project system reference library
 * ------------------------------------------------------------
 * These records are a reviewable transcription of the two user-supplied
 * system schematics.  They are deliberately kept separate from the design
 * selector: a visible trace may be reused as evidence, but it never becomes
 * an automatically approved product topology.
 *
 * Endpoint policy:
 *   LABELLED_TERMINAL_TRACE  both terminal labels and the trace are visible
 *   VISIBLE_TRACE            the trace is visible; one block pin is generic
 *   FUNCTIONAL_INFERENCE     relationship needs source-CAD/engineer review
 * ============================================================ */
(function (root, factory) {
  'use strict';
  let evidence = root && root.EVSE_EVIDENCE_LIBRARY;
  if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
    evidence = evidence || require('./evidence-library.js');
  }
  const api = factory(evidence);
  if (root) root.EVSE_REFERENCE_SYSTEM_LIBRARY = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (EVIDENCE) {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'EVSE-REFERENCE-SYSTEM/1.0';
  const TRACE = Object.freeze({
    LABELLED: 'LABELLED_TERMINAL_TRACE',
    VISIBLE: 'VISIBLE_TRACE',
    INFERRED: 'FUNCTIONAL_INFERENCE_REVIEW_REQUIRED'
  });

  function pin(id, label, domain, evidenceStatus) {
    return Object.freeze({
      id: String(id), label: String(label || id), domain: String(domain || 'UNCLASSIFIED'),
      evidenceStatus: evidenceStatus || TRACE.LABELLED
    });
  }
  function device(id, ref, name, kind, pins, options) {
    return Object.freeze(Object.assign({
      id, ref, name, kind, pins: Object.freeze((pins || []).map((item) =>
        typeof item === 'string' ? pin(item, item) : item))
    }, options || {}));
  }
  function contactorPins(domain) {
    return [pin('IN', '主触点输入', domain, TRACE.VISIBLE), pin('OUT', '主触点输出', domain, TRACE.VISIBLE),
      pin('A1', '线圈+', 'AUX_24V'), pin('A2', '线圈-', 'AUX_24V'),
      pin('FB', '辅助触点/反馈', 'SIGNAL_DIGITAL', TRACE.VISIBLE)];
  }
  function twoTerminalPins(domain) {
    return [pin('1', '1', domain, TRACE.VISIBLE), pin('2', '2', domain, TRACE.VISIBLE)];
  }
  function connection(id, net, from, to, netClass, evidenceStatus, note) {
    return Object.freeze({ id, net, from, to, netClass,
      evidenceStatus: evidenceStatus || TRACE.VISIBLE, note: String(note || '') });
  }
  function unit(id, name, deviceIds, connectionIds, functions) {
    return Object.freeze({ id, name, deviceIds: Object.freeze(deviceIds.slice()),
      connectionIds: Object.freeze(connectionIds.slice()), functions: Object.freeze(functions.slice()) });
  }
  function system(id, name, sourceId, devices, connections, units, unresolved, options) {
    return Object.freeze(Object.assign({
      schema: SCHEMA, id, name, sourceId,
      lifecycle: 'USER_PROJECT_PARTIAL_TRACE_REFERENCE—ENGINEER_REVIEW_REQUIRED',
      automaticSelectionAllowed: false,
      devices: Object.freeze(devices), connections: Object.freeze(connections),
      functionalUnits: Object.freeze(units), unresolved: Object.freeze(unresolved.slice())
    }, options || {}));
  }

  const EURO_DEVICES = [
    device('EU-BAT1', 'GB1', '储能电池箱1', 'battery-box', [pin('POS', '+', 'HV_DC_ESS'), pin('NEG', '-', 'HV_DC_ESS'), pin('CANH', '通信/CANH', 'CAN'), pin('CANL', '通信/CANL', 'CAN'), pin('HEAT+', '加热+', 'HV_DC_ESS'), pin('HEAT-', '加热-', 'HV_DC_ESS')]),
    device('EU-BAT2', 'GB2', '储能电池箱2', 'battery-box', [pin('POS', '+', 'HV_DC_ESS'), pin('NEG', '-', 'HV_DC_ESS'), pin('CANH', '通信/CANH', 'CAN'), pin('CANL', '通信/CANL', 'CAN'), pin('HEAT+', '加热+', 'HV_DC_ESS'), pin('HEAT-', '加热-', 'HV_DC_ESS')]),
    device('EU-BAT3', 'GB3', '储能电池箱3', 'battery-box', [pin('POS', '+', 'HV_DC_ESS'), pin('NEG', '-', 'HV_DC_ESS'), pin('CANH', '通信/CANH', 'CAN'), pin('CANL', '通信/CANL', 'CAN'), pin('HEAT+', '加热+', 'HV_DC_ESS'), pin('HEAT-', '加热-', 'HV_DC_ESS')]),
    device('EU-FU1', 'FU1', '电池总正熔断器', 'ess-fuse', twoTerminalPins('HV_DC_ESS')),
    device('EU-K1', 'K1', '电池总正接触器 200A/24V', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('EU-K2', 'K2', '电池总负接触器 200A/24V', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('EU-K3', 'K3', '预充接触器 50A/24V', 'precharge-contactor', contactorPins('HV_DC_ESS')),
    device('EU-RPRE', 'RPRE', '预充电阻 200W-30R', 'precharge-resistor', twoTerminalPins('HV_DC_ESS')),
    device('EU-RS2', 'RS2', '电池总负电流传感器', 'current-transducer', [pin('IP+', 'I+', 'HV_DC_ESS'), pin('IP-', 'I-', 'HV_DC_ESS'), pin('OUT', '采样输出', 'SIGNAL_ANALOG', TRACE.VISIBLE)]),
    device('EU-K5', 'K5', '电池加热接触器 50A/24V', 'ess-contactor', contactorPins('HV_DC_ESS'), { traceCompleteness: 'UNRESOLVED', unresolvedReason: '主触点加热支路需源CAD逐线确认。' }),
    device('EU-K6', 'K6', '整流回充接触器 200A/24V', 'ess-contactor', contactorPins('HV_DC_ESS'), { traceCompleteness: 'UNRESOLVED', unresolvedReason: '整流/补电主触点去向需源CAD逐线确认。' }),
    device('EU-WB3', 'WB3', '储能直流母线', 'ess-busbar', [pin('POS', '总正', 'HV_DC_ESS'), pin('NEG', '总负', 'HV_DC_ESS')]),
    device('EU-BCU', 'BCU', '电池控制单元', 'bms-controller', [pin('CANH', '整车CANH', 'CAN'), pin('CANL', '整车CANL', 'CAN'), pin('BAT_CANH', '电池CANH', 'CAN'), pin('BAT_CANL', '电池CANL', 'CAN'), pin('K1+', 'K1+', 'AUX_24V'), pin('K2+', 'K2+', 'AUX_24V'), pin('K3+', 'K3+', 'AUX_24V'), pin('K5+', 'K5+', 'AUX_24V'), pin('K6+', 'K6+', 'AUX_24V'), pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V')]),
    device('EU-AC-IN', 'XS-AC', '欧标交流补电座', 'ac-charge-inlet', [pin('L1', 'L1', 'AC'), pin('L2', 'L2', 'AC'), pin('L3', 'L3', 'AC'), pin('N', 'N', 'AC'), pin('PE', 'PE', 'PE'), pin('CP', 'CP', 'CONTROL_PILOT'), pin('PP', 'PP', 'PROXIMITY')]),
    device('EU-RCM1', 'RCM1', '交流补电漏电检测', 'residual-current-monitor', [pin('L1_IN', 'L1输入', 'AC', TRACE.VISIBLE), pin('L2_IN', 'L2输入', 'AC', TRACE.VISIBLE), pin('L3_IN', 'L3输入', 'AC', TRACE.VISIBLE), pin('N_IN', 'N输入', 'AC', TRACE.VISIBLE), pin('L1_OUT', 'L1输出', 'AC', TRACE.VISIBLE), pin('L2_OUT', 'L2输出', 'AC', TRACE.VISIBLE), pin('L3_OUT', 'L3输出', 'AC', TRACE.VISIBLE), pin('N_OUT', 'N输出', 'AC', TRACE.VISIBLE), pin('SIGNAL', '信号', 'SIGNAL_DIGITAL'), pin('TEST', '试验', 'SIGNAL_DIGITAL')]),
    device('EU-FV1', 'FV1', '3P+N 浪涌保护器', 'surge-protector', [pin('L1', 'L1', 'AC'), pin('L2', 'L2', 'AC'), pin('L3', 'L3', 'AC'), pin('N', 'N', 'AC'), pin('PE', 'PE', 'PE')]),
    device('EU-KM1', 'KM1', 'PCS交流输入主接触器', 'ac-contactor', [pin('L1_IN', 'L1输入', 'AC', TRACE.VISIBLE), pin('L2_IN', 'L2输入', 'AC', TRACE.VISIBLE), pin('L3_IN', 'L3输入', 'AC', TRACE.VISIBLE), pin('N_IN', 'N输入', 'AC', TRACE.VISIBLE), pin('L1_OUT', 'L1输出', 'AC', TRACE.VISIBLE), pin('L2_OUT', 'L2输出', 'AC', TRACE.VISIBLE), pin('L3_OUT', 'L3输出', 'AC', TRACE.VISIBLE), pin('N_OUT', 'N输出', 'AC', TRACE.VISIBLE), pin('A1', '线圈+', 'AUX_24V'), pin('A2', '线圈-', 'AUX_24V'), pin('FB', '辅助触点', 'SIGNAL_DIGITAL')]),
    device('EU-KM2', 'KM2', '交流中继/联锁', 'control-relay', contactorPins('AC'), { traceCompleteness: 'UNRESOLVED', unresolvedReason: 'NCH8-40/11+ZB中继触点和线圈端子需源CAD/器件表确认。' }),
    device('EU-PCS', 'PCS1', '22kW PCS模块', 'ess-pcs', [pin('L1', 'L1', 'AC', TRACE.VISIBLE), pin('L2', 'L2', 'AC', TRACE.VISIBLE), pin('L3', 'L3', 'AC', TRACE.VISIBLE), pin('N', 'N', 'AC', TRACE.VISIBLE), pin('PE', 'PE', 'PE'), pin('DC+', 'DC+', 'HV_DC_ESS'), pin('DC-', 'DC-', 'HV_DC_ESS'), pin('CANH', 'CANH', 'CAN', TRACE.VISIBLE), pin('CANL', 'CANL', 'CAN', TRACE.VISIBLE)]),
    device('EU-K9', 'K9', 'PCS回充正接触器 200A/24V', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('EU-K10', 'K10', 'PCS回充负接触器 200A/24V', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('EU-FU3', 'FU3', 'PCS回充快熔', 'ess-fuse', twoTerminalPins('HV_DC_ESS')),
    device('EU-RS1', 'RS1', '直流电流传感器', 'current-transducer', [pin('IP+', 'I+', 'HV_DC_ESS'), pin('IP-', 'I-', 'HV_DC_ESS'), pin('OUT', '采样输出', 'SIGNAL_ANALOG', TRACE.VISIBLE)]),
    device('EU-PJ1', 'PJ1', '直流电表', 'dc-meter', [pin('I+', 'I+', 'HV_DC_ESS'), pin('I-', 'I-', 'HV_DC_ESS'), pin('DV+', 'DV+', 'SENSE_HV'), pin('DV-', 'DV-', 'SENSE_HV', TRACE.VISIBLE), pin('TA', 'TA', 'SIGNAL'), pin('TB', 'TB', 'SIGNAL')]),
    device('EU-DCDC', 'M1~M2', '30kW DC/DC充电模块阵列', 'ess-dcdc', [pin('IN+', '输入DC+', 'HV_DC_ESS', TRACE.VISIBLE), pin('IN-', '输入DC-', 'HV_DC_ESS', TRACE.VISIBLE), pin('OUT+', '输出DC+', 'HV_DC_CHARGE', TRACE.VISIBLE), pin('OUT-', '输出DC-', 'HV_DC_CHARGE', TRACE.VISIBLE), pin('CANH', 'CANH', 'CAN'), pin('CANL', 'CANL', 'CAN')]),
    device('EU-K7', 'K7', '枪侧正接触器 200A/24V', 'dc-contactor', contactorPins('HV_DC_CHARGE')),
    device('EU-K8', 'K8', '枪侧负接触器 200A/24V', 'dc-contactor', contactorPins('HV_DC_CHARGE')),
    device('EU-FU2', 'FU2', '枪侧直流快熔', 'dc-fuse', twoTerminalPins('HV_DC_CHARGE')),
    device('EU-CCS2', 'XS-CCS2', 'CCS2直流输出枪座', 'ccs2-connector', [pin('DC+', 'DC+', 'HV_DC_CHARGE'), pin('DC-', 'DC-', 'HV_DC_CHARGE'), pin('PE', 'PE', 'PE'), pin('CP', 'CP', 'CONTROL_PILOT'), pin('PP', 'PP', 'PROXIMITY'), pin('LOCK+', '电子锁+', 'AUX_12V'), pin('LOCK-', '电子锁-', 'AUX_12V'), pin('LOCK_FB1', '电子锁反馈1', 'SIGNAL_DIGITAL'), pin('LOCK_FB2', '电子锁反馈2', 'SIGNAL_DIGITAL')]),
    device('EU-T1', 'T1', '4500W高压至24V开关电源', 'hv-aux-converter', [pin('HV+', 'DC+', 'HV_DC_ESS', TRACE.VISIBLE), pin('HV-', 'DC-', 'HV_DC_ESS', TRACE.VISIBLE), pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V')]),
    device('EU-T2', 'T2', '300W 24V至12V开关电源', 'aux-dc-converter', [pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V'), pin('12V+', '12V+', 'AUX_12V'), pin('12V-', '12V-', 'AUX_12V')]),
    device('EU-VCU', 'VCU', '整车/充电控制主板', 'charge-controller', [pin('CANH', 'CANH', 'CAN'), pin('CANL', 'CANL', 'CAN'), pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V'), pin('K7', 'K7控制', 'SIGNAL_DIGITAL'), pin('K8', 'K8控制', 'SIGNAL_DIGITAL'), pin('K9', 'K9控制', 'SIGNAL_DIGITAL'), pin('K10', 'K10控制', 'SIGNAL_DIGITAL'), pin('LOCK+', '电子锁+', 'AUX_12V'), pin('LOCK-', '电子锁-', 'AUX_12V'), pin('LOCK_FB1', '电子锁反馈1', 'SIGNAL_DIGITAL'), pin('LOCK_FB2', '电子锁反馈2', 'SIGNAL_DIGITAL'), pin('RCM_SIGNAL', '漏电信号', 'SIGNAL_DIGITAL'), pin('RCM_TEST', '漏电试验', 'SIGNAL_DIGITAL')]),
    device('EU-EVCC', 'EVCC', '补电接口控制器', 'charge-controller', [pin('CP', 'CP', 'CONTROL_PILOT'), pin('PP', 'PP', 'PROXIMITY'), pin('PE', 'PE', 'PE'), pin('CANH', 'CAN/H', 'CAN'), pin('CANL', 'CAN/L', 'CAN'), pin('12V', '12V', 'AUX_12V'), pin('GND', 'GND', 'AUX_12V')]),
    device('EU-SECC', 'SECC', 'CCS2输出通信控制器', 'charge-controller', [pin('CP', 'CP', 'CONTROL_PILOT'), pin('PP', 'PP', 'PROXIMITY'), pin('PE', 'PE/接地', 'PE'), pin('CANH', 'CAN/H', 'CAN'), pin('CANL', 'CAN/L', 'CAN'), pin('12V', '12V', 'AUX_12V'), pin('GND', 'GND', 'AUX_12V')]),
    device('EU-OCPP', 'OCPP', 'OCPP通信控制板', 'comm-gateway', [pin('TXD', 'TXD', 'UART'), pin('RXD', 'RXD', 'UART'), pin('GND', 'GND', 'AUX_12V'), pin('12V', '12V', 'AUX_12V'), pin('ETH', '网络接口', 'ETHERNET', TRACE.VISIBLE)]),
    device('EU-ROUTER', 'R1', '路由器', 'comm-gateway', [pin('ETH', '有线网络', 'ETHERNET', TRACE.VISIBLE), pin('ANT', '天线', 'RF'), pin('12V+', '12V+', 'AUX_12V'), pin('12V-', '12V-', 'AUX_12V')]),
    device('EU-ANT', 'ANT1', '三合一天线', 'rf-antenna', [pin('RF', 'RF', 'RF', TRACE.VISIBLE)]),
    device('EU-PE', 'PE', '保护接地汇流排', 'earth-bar', [pin('PE', 'PE', 'PE')])
  ];

  const EURO_CONNECTIONS = [
    connection('EU-W001', 'BAT_SERIES_12', 'EU-BAT1:NEG', 'EU-BAT2:POS', 'POWER_DC_ESS', TRACE.LABELLED),
    connection('EU-W002', 'BAT_SERIES_23', 'EU-BAT2:NEG', 'EU-BAT3:POS', 'POWER_DC_ESS', TRACE.LABELLED),
    connection('EU-W003', 'BAT_CANH_12', 'EU-BAT1:CANH', 'EU-BAT2:CANH', 'CAN', TRACE.VISIBLE),
    connection('EU-W004', 'BAT_CANL_12', 'EU-BAT1:CANL', 'EU-BAT2:CANL', 'CAN', TRACE.VISIBLE),
    connection('EU-W005', 'BAT_CANH_23', 'EU-BAT2:CANH', 'EU-BAT3:CANH', 'CAN', TRACE.VISIBLE),
    connection('EU-W006', 'BAT_CANL_23', 'EU-BAT2:CANL', 'EU-BAT3:CANL', 'CAN', TRACE.VISIBLE),
    connection('EU-W007', 'BAT_TOTAL_POS_FUSE', 'EU-BAT1:POS', 'EU-FU1:1', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W008', 'BAT_TOTAL_POS_MAIN', 'EU-FU1:2', 'EU-K1:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W009', 'ESS_BUS_POS', 'EU-K1:OUT', 'EU-WB3:POS', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W010', 'PRECHARGE_ENABLE', 'EU-FU1:2', 'EU-K3:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W011', 'PRECHARGE_RESISTOR_A', 'EU-K3:OUT', 'EU-RPRE:1', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W012', 'PRECHARGE_RESISTOR_B', 'EU-RPRE:2', 'EU-WB3:POS', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W013', 'BAT_TOTAL_NEG_SENSE', 'EU-BAT3:NEG', 'EU-RS2:IP+', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W014', 'BAT_TOTAL_NEG_MAIN', 'EU-RS2:IP-', 'EU-K2:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W015', 'ESS_BUS_NEG', 'EU-K2:OUT', 'EU-WB3:NEG', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W016', 'BATTERY_CANH_BCU', 'EU-BAT3:CANH', 'EU-BCU:BAT_CANH', 'CAN', TRACE.VISIBLE),
    connection('EU-W017', 'BATTERY_CANL_BCU', 'EU-BAT3:CANL', 'EU-BCU:BAT_CANL', 'CAN', TRACE.VISIBLE),
    connection('EU-W018', 'BCU_K1_DRIVE', 'EU-BCU:K1+', 'EU-K1:A1', 'CONTROL', TRACE.LABELLED),
    connection('EU-W019', 'BCU_K2_DRIVE', 'EU-BCU:K2+', 'EU-K2:A1', 'CONTROL', TRACE.LABELLED),
    connection('EU-W020', 'BCU_K3_DRIVE', 'EU-BCU:K3+', 'EU-K3:A1', 'CONTROL', TRACE.LABELLED),
    connection('EU-W021', 'BCU_K5_DRIVE', 'EU-BCU:K5+', 'EU-K5:A1', 'CONTROL', TRACE.LABELLED),
    connection('EU-W022', 'BCU_K6_DRIVE', 'EU-BCU:K6+', 'EU-K6:A1', 'CONTROL', TRACE.LABELLED),
    connection('EU-W023', 'DCDC_INPUT_POS', 'EU-WB3:POS', 'EU-DCDC:IN+', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W024', 'DCDC_INPUT_NEG', 'EU-WB3:NEG', 'EU-DCDC:IN-', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W025', 'DCDC_OUTPUT_POS_CONTACTOR', 'EU-DCDC:OUT+', 'EU-K7:IN', 'POWER_DC_CHARGE', TRACE.VISIBLE),
    connection('EU-W026', 'DCDC_OUTPUT_POS_FUSE', 'EU-K7:OUT', 'EU-FU2:1', 'POWER_DC_CHARGE', TRACE.VISIBLE),
    connection('EU-W027', 'CCS2_DC_POS', 'EU-FU2:2', 'EU-CCS2:DC+', 'POWER_DC_CHARGE', TRACE.LABELLED),
    connection('EU-W028', 'DCDC_OUTPUT_NEG_CONTACTOR', 'EU-DCDC:OUT-', 'EU-K8:IN', 'POWER_DC_CHARGE', TRACE.VISIBLE),
    connection('EU-W029', 'CCS2_DC_NEG', 'EU-K8:OUT', 'EU-CCS2:DC-', 'POWER_DC_CHARGE', TRACE.LABELLED),
    connection('EU-W030', 'CCS2_PE', 'EU-CCS2:PE', 'EU-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED),
    connection('EU-W031', 'CCS2_CP', 'EU-CCS2:CP', 'EU-SECC:CP', 'CONTROL_PILOT', TRACE.LABELLED),
    connection('EU-W032', 'CCS2_PP', 'EU-CCS2:PP', 'EU-SECC:PP', 'PROXIMITY', TRACE.LABELLED),
    connection('EU-W033', 'AC_IN_PE', 'EU-AC-IN:PE', 'EU-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED),
    connection('EU-W034L1', 'AC_L1_RCM', 'EU-AC-IN:L1', 'EU-RCM1:L1_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W034L2', 'AC_L2_RCM', 'EU-AC-IN:L2', 'EU-RCM1:L2_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W034L3', 'AC_L3_RCM', 'EU-AC-IN:L3', 'EU-RCM1:L3_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W034N', 'AC_N_RCM', 'EU-AC-IN:N', 'EU-RCM1:N_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W035L1', 'RCM_L1_KM1', 'EU-RCM1:L1_OUT', 'EU-KM1:L1_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W035L2', 'RCM_L2_KM1', 'EU-RCM1:L2_OUT', 'EU-KM1:L2_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W035L3', 'RCM_L3_KM1', 'EU-RCM1:L3_OUT', 'EU-KM1:L3_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W035N', 'RCM_N_KM1', 'EU-RCM1:N_OUT', 'EU-KM1:N_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W036L1', 'KM1_L1_PCS', 'EU-KM1:L1_OUT', 'EU-PCS:L1', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W036L2', 'KM1_L2_PCS', 'EU-KM1:L2_OUT', 'EU-PCS:L2', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W036L3', 'KM1_L3_PCS', 'EU-KM1:L3_OUT', 'EU-PCS:L3', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W036N', 'KM1_N_PCS', 'EU-KM1:N_OUT', 'EU-PCS:N', 'POWER_AC', TRACE.VISIBLE),
    connection('EU-W036S1', 'SPD_L1', 'EU-RCM1:L1_OUT', 'EU-FV1:L1', 'SURGE', TRACE.VISIBLE),
    connection('EU-W036S2', 'SPD_L2', 'EU-RCM1:L2_OUT', 'EU-FV1:L2', 'SURGE', TRACE.VISIBLE),
    connection('EU-W036S3', 'SPD_L3', 'EU-RCM1:L3_OUT', 'EU-FV1:L3', 'SURGE', TRACE.VISIBLE),
    connection('EU-W036SN', 'SPD_N', 'EU-RCM1:N_OUT', 'EU-FV1:N', 'SURGE', TRACE.VISIBLE),
    connection('EU-W036PE', 'SPD_PE', 'EU-FV1:PE', 'EU-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED),
    connection('EU-W037', 'PCS_PE', 'EU-PCS:PE', 'EU-PE:PE', 'PROTECTIVE_EARTH', TRACE.VISIBLE),
    connection('EU-W038', 'PCS_DC_POS_ISOLATION', 'EU-PCS:DC+', 'EU-K9:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W039', 'PCS_DC_POS_FUSE', 'EU-K9:OUT', 'EU-FU3:1', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W040', 'PCS_DC_POS_BUS', 'EU-FU3:2', 'EU-WB3:POS', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W041', 'PCS_DC_NEG_ISOLATION', 'EU-PCS:DC-', 'EU-K10:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W042', 'PCS_DC_NEG_SENSE', 'EU-K10:OUT', 'EU-RS1:IP+', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W043', 'PCS_DC_NEG_BUS', 'EU-RS1:IP-', 'EU-WB3:NEG', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W043A', 'METER_CURRENT_HIGH', 'EU-PJ1:I+', 'EU-RS1:IP+', 'SENSE_HV', TRACE.VISIBLE),
    connection('EU-W043B', 'METER_CURRENT_LOW', 'EU-PJ1:I-', 'EU-RS1:IP-', 'SENSE_HV', TRACE.VISIBLE),
    connection('EU-W043C', 'METER_VOLTAGE_POS', 'EU-PJ1:DV+', 'EU-WB3:POS', 'SENSE_HV', TRACE.VISIBLE),
    connection('EU-W043D', 'METER_VOLTAGE_NEG', 'EU-PJ1:DV-', 'EU-WB3:NEG', 'SENSE_HV', TRACE.VISIBLE),
    connection('EU-W044', 'AUX24_HV_POS', 'EU-WB3:POS', 'EU-T1:HV+', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W045', 'AUX24_HV_NEG', 'EU-WB3:NEG', 'EU-T1:HV-', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('EU-W046', 'AUX12_INPUT_POS', 'EU-T1:24V+', 'EU-T2:24V+', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('EU-W047', 'AUX12_INPUT_NEG', 'EU-T1:24V-', 'EU-T2:24V-', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('EU-W048', 'AC_PILOT_IN', 'EU-AC-IN:CP', 'EU-EVCC:CP', 'CONTROL_PILOT', TRACE.LABELLED),
    connection('EU-W048P', 'AC_PROXIMITY_IN', 'EU-AC-IN:PP', 'EU-EVCC:PP', 'PROXIMITY', TRACE.LABELLED),
    connection('EU-W049', 'VCU_BCU_CANH', 'EU-VCU:CANH', 'EU-BCU:CANH', 'CAN', TRACE.VISIBLE),
    connection('EU-W050', 'VCU_BCU_CANL', 'EU-VCU:CANL', 'EU-BCU:CANL', 'CAN', TRACE.VISIBLE),
    connection('EU-W051', 'OCPP_ROUTER_ETH', 'EU-OCPP:ETH', 'EU-ROUTER:ETH', 'ETHERNET', TRACE.VISIBLE),
    connection('EU-W052', 'ROUTER_ANTENNA', 'EU-ROUTER:ANT', 'EU-ANT:RF', 'RF', TRACE.VISIBLE),
    connection('EU-W053', 'BCU_24V_POS', 'EU-T1:24V+', 'EU-BCU:24V+', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W054', 'BCU_24V_NEG', 'EU-T1:24V-', 'EU-BCU:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W055', 'VCU_24V_POS', 'EU-T1:24V+', 'EU-VCU:24V+', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W056', 'VCU_24V_NEG', 'EU-T1:24V-', 'EU-VCU:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W057', 'EVCC_12V_POS', 'EU-T2:12V+', 'EU-EVCC:12V', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W058', 'EVCC_12V_NEG', 'EU-T2:12V-', 'EU-EVCC:GND', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W059', 'SECC_12V_POS', 'EU-T2:12V+', 'EU-SECC:12V', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W060', 'SECC_12V_NEG', 'EU-T2:12V-', 'EU-SECC:GND', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W061', 'OCPP_12V_POS', 'EU-T2:12V+', 'EU-OCPP:12V', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W062', 'OCPP_12V_NEG', 'EU-T2:12V-', 'EU-OCPP:GND', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W063', 'ROUTER_12V_POS', 'EU-T2:12V+', 'EU-ROUTER:12V+', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W064', 'ROUTER_12V_NEG', 'EU-T2:12V-', 'EU-ROUTER:12V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W065', 'CCS2_LOCK_POS', 'EU-VCU:LOCK+', 'EU-CCS2:LOCK+', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('EU-W066', 'CCS2_LOCK_NEG', 'EU-VCU:LOCK-', 'EU-CCS2:LOCK-', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('EU-W067', 'CCS2_LOCK_FB1', 'EU-CCS2:LOCK_FB1', 'EU-VCU:LOCK_FB1', 'SIGNAL_DIGITAL', TRACE.LABELLED),
    connection('EU-W068', 'CCS2_LOCK_FB2', 'EU-CCS2:LOCK_FB2', 'EU-VCU:LOCK_FB2', 'SIGNAL_DIGITAL', TRACE.LABELLED),
    connection('EU-W069', 'VCU_K7_DRIVE', 'EU-VCU:K7', 'EU-K7:A1', 'CONTROL', TRACE.VISIBLE),
    connection('EU-W070', 'VCU_K8_DRIVE', 'EU-VCU:K8', 'EU-K8:A1', 'CONTROL', TRACE.VISIBLE),
    connection('EU-W071', 'VCU_K9_DRIVE', 'EU-VCU:K9', 'EU-K9:A1', 'CONTROL', TRACE.VISIBLE),
    connection('EU-W072', 'VCU_K10_DRIVE', 'EU-VCU:K10', 'EU-K10:A1', 'CONTROL', TRACE.VISIBLE),
    connection('EU-W073', 'K7_COIL_RETURN', 'EU-K7:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W074', 'K8_COIL_RETURN', 'EU-K8:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W075', 'K9_COIL_RETURN', 'EU-K9:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W076', 'K10_COIL_RETURN', 'EU-K10:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W077', 'K1_COIL_RETURN', 'EU-K1:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W078', 'K2_COIL_RETURN', 'EU-K2:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W079', 'K3_COIL_RETURN', 'EU-K3:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W080', 'K5_COIL_RETURN', 'EU-K5:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W081', 'K6_COIL_RETURN', 'EU-K6:A2', 'EU-T1:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('EU-W082', 'PCS_CANH', 'EU-PCS:CANH', 'EU-VCU:CANH', 'CAN', TRACE.VISIBLE),
    connection('EU-W083', 'PCS_CANL', 'EU-PCS:CANL', 'EU-VCU:CANL', 'CAN', TRACE.VISIBLE),
    connection('EU-W084', 'DCDC_CANH', 'EU-DCDC:CANH', 'EU-VCU:CANH', 'CAN', TRACE.VISIBLE),
    connection('EU-W085', 'DCDC_CANL', 'EU-DCDC:CANL', 'EU-VCU:CANL', 'CAN', TRACE.VISIBLE),
    connection('EU-W086', 'RCM_SIGNAL', 'EU-RCM1:SIGNAL', 'EU-VCU:RCM_SIGNAL', 'SIGNAL_DIGITAL', TRACE.LABELLED),
    connection('EU-W087', 'RCM_TEST', 'EU-VCU:RCM_TEST', 'EU-RCM1:TEST', 'SIGNAL_DIGITAL', TRACE.LABELLED),
    connection('EU-W088', 'EVCC_PE', 'EU-EVCC:PE', 'EU-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED),
    connection('EU-W089', 'SECC_PE', 'EU-SECC:PE', 'EU-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED)
  ];

  const EURO_UNITS = [
    unit('EU-U1', '储能电池串与高压安全链', ['EU-BAT1', 'EU-BAT2', 'EU-BAT3', 'EU-FU1', 'EU-K1', 'EU-K2', 'EU-K3', 'EU-RPRE', 'EU-RS2', 'EU-WB3', 'EU-BCU'], ['EU-W001', 'EU-W002', 'EU-W007', 'EU-W008', 'EU-W009', 'EU-W010', 'EU-W011', 'EU-W012', 'EU-W013', 'EU-W014', 'EU-W015'], ['串联电池管理', '总正/总负隔离', '预充', '总电流采样']),
    unit('EU-U2', '交流补电与PCS回充', ['EU-AC-IN', 'EU-RCM1', 'EU-FV1', 'EU-KM1', 'EU-KM2', 'EU-PCS', 'EU-K9', 'EU-K10', 'EU-FU3', 'EU-RS1', 'EU-PJ1', 'EU-WB3', 'EU-PE'], ['EU-W033', 'EU-W034L1', 'EU-W034L2', 'EU-W034L3', 'EU-W034N', 'EU-W035L1', 'EU-W035L2', 'EU-W035L3', 'EU-W035N', 'EU-W036L1', 'EU-W036L2', 'EU-W036L3', 'EU-W036N', 'EU-W036S1', 'EU-W036S2', 'EU-W036S3', 'EU-W036SN', 'EU-W036PE', 'EU-W037', 'EU-W038', 'EU-W039', 'EU-W040', 'EU-W041', 'EU-W042', 'EU-W043', 'EU-W043A', 'EU-W043B', 'EU-W043C', 'EU-W043D'], ['交流L1/L2/L3/N逐导体保护', '剩余电流监测', '并联浪涌泄放', 'PCS回充', '回充双极隔离与负极电流采样']),
    unit('EU-U3', 'DC/DC与CCS2输出', ['EU-DCDC', 'EU-K7', 'EU-K8', 'EU-FU2', 'EU-CCS2', 'EU-SECC', 'EU-WB3', 'EU-PE'], ['EU-W023', 'EU-W024', 'EU-W025', 'EU-W026', 'EU-W027', 'EU-W028', 'EU-W029', 'EU-W030', 'EU-W031', 'EU-W032'], ['储能到车辆变换', '输出双极隔离', 'CCS2 CP/PP']),
    unit('EU-U4', '控制通信与辅助电源', ['EU-T1', 'EU-T2', 'EU-BCU', 'EU-VCU', 'EU-EVCC', 'EU-SECC', 'EU-OCPP', 'EU-ROUTER', 'EU-ANT', 'EU-CCS2', 'EU-K1', 'EU-K2', 'EU-K3', 'EU-K5', 'EU-K6', 'EU-K7', 'EU-K8', 'EU-K9', 'EU-K10', 'EU-PCS', 'EU-DCDC', 'EU-RCM1', 'EU-PE'], ['EU-W003', 'EU-W004', 'EU-W005', 'EU-W006', 'EU-W016', 'EU-W017', 'EU-W018', 'EU-W019', 'EU-W020', 'EU-W021', 'EU-W022', 'EU-W044', 'EU-W045', 'EU-W046', 'EU-W047', 'EU-W048', 'EU-W048P', 'EU-W049', 'EU-W050', 'EU-W051', 'EU-W052', 'EU-W053', 'EU-W054', 'EU-W055', 'EU-W056', 'EU-W057', 'EU-W058', 'EU-W059', 'EU-W060', 'EU-W061', 'EU-W062', 'EU-W063', 'EU-W064', 'EU-W065', 'EU-W066', 'EU-W067', 'EU-W068', 'EU-W069', 'EU-W070', 'EU-W071', 'EU-W072', 'EU-W073', 'EU-W074', 'EU-W075', 'EU-W076', 'EU-W077', 'EU-W078', 'EU-W079', 'EU-W080', 'EU-W081', 'EU-W082', 'EU-W083', 'EU-W084', 'EU-W085', 'EU-W086', 'EU-W087', 'EU-W088', 'EU-W089'], ['24V/12V域', '电池CAN', '车辆接口控制', 'OCPP/蜂窝通信', '电子锁双反馈', '接触器线圈与回路', 'RCM信号/试验'])
  ];

  const GB_DEVICES = [
    device('GB-BAT1', 'BAT1', '电池箱1', 'battery-box', [pin('POS', '+', 'HV_DC_ESS'), pin('NEG', '-', 'HV_DC_ESS'), pin('COMM_IN_H', '通信进/CANH', 'CAN', TRACE.INFERRED), pin('COMM_IN_L', '通信进/CANL', 'CAN', TRACE.INFERRED), pin('COMM_OUT_H', '通信出/CANH', 'CAN', TRACE.INFERRED), pin('COMM_OUT_L', '通信出/CANL', 'CAN', TRACE.INFERRED), pin('HEAT+', '加热1+', 'HV_DC_ESS'), pin('HEAT-', '加热1-', 'HV_DC_ESS')]),
    device('GB-BAT2', 'BAT2', '电池箱2', 'battery-box', [pin('POS', '+', 'HV_DC_ESS'), pin('NEG', '-', 'HV_DC_ESS'), pin('COMM_IN_H', '通信进/CANH', 'CAN', TRACE.INFERRED), pin('COMM_IN_L', '通信进/CANL', 'CAN', TRACE.INFERRED), pin('COMM_OUT_H', '通信出/CANH', 'CAN', TRACE.INFERRED), pin('COMM_OUT_L', '通信出/CANL', 'CAN', TRACE.INFERRED), pin('HEAT+', '加热2+', 'HV_DC_ESS'), pin('HEAT-', '加热2-', 'HV_DC_ESS')]),
    device('GB-BAT3', 'BAT3', '电池箱3', 'battery-box', [pin('POS', '+', 'HV_DC_ESS'), pin('NEG', '-', 'HV_DC_ESS'), pin('COMM_IN_H', '通信进/CANH', 'CAN', TRACE.INFERRED), pin('COMM_IN_L', '通信进/CANL', 'CAN', TRACE.INFERRED), pin('COMM_OUT_H', '通信出/CANH', 'CAN', TRACE.INFERRED), pin('COMM_OUT_L', '通信出/CANL', 'CAN', TRACE.INFERRED), pin('HEAT+', '加热3+', 'HV_DC_ESS'), pin('HEAT-', '加热3-', 'HV_DC_ESS')]),
    device('GB-BAT4', 'BAT4', '电池箱4', 'battery-box', [pin('POS', '+', 'HV_DC_ESS'), pin('NEG', '-', 'HV_DC_ESS'), pin('COMM_IN_H', '通信进/CANH', 'CAN', TRACE.INFERRED), pin('COMM_IN_L', '通信进/CANL', 'CAN', TRACE.INFERRED), pin('COMM_OUT_H', '通信出/CANH', 'CAN', TRACE.INFERRED), pin('COMM_OUT_L', '通信出/CANL', 'CAN', TRACE.INFERRED), pin('HEAT+', '加热4+', 'HV_DC_ESS'), pin('HEAT-', '加热4-', 'HV_DC_ESS')]),
    device('GB-FPOS', 'F+', '电池总正保护器 NC081-1S-AON-H5', 'ess-fuse', twoTerminalPins('HV_DC_ESS')),
    device('GB-FNEG', 'F-', '电池总负保护器 NC081-1S-YBN-H5', 'ess-fuse', twoTerminalPins('HV_DC_ESS')),
    device('GB-K1', 'K1', '总正接触器', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('GB-K2', 'K2', '充电正接触器', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('GB-K3', 'K3', '加热接触器', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('GB-K4', 'K4', '放电负接触器', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('GB-K5', 'K5', '充电负接触器', 'ess-contactor', contactorPins('HV_DC_ESS')),
    device('GB-HALL', 'HAH1BVW S/05', '电池电流传感器', 'current-transducer', [pin('IP+', '电流输入', 'HV_DC_ESS', TRACE.VISIBLE), pin('IP-', '电流输出', 'HV_DC_ESS', TRACE.VISIBLE), pin('OUT', 'OUT', 'SIGNAL_ANALOG'), pin('5V+', '5V+', 'AUX_5V'), pin('5VGND', '5VGND', 'AUX_5V')]),
    device('GB-IMD', 'H100D', '绝缘检测仪', 'insulation-monitor', [pin('BAT1/BAT2+', 'BAT1/BAT2+', 'SENSE_HV'), pin('BAT3+', 'BAT3+', 'SENSE_HV'), pin('BAT4+', 'BAT4+', 'SENSE_HV'), pin('BAT5+', 'BAT5+', 'SENSE_HV'), pin('BAT1-', 'BAT1-', 'SENSE_HV'), pin('BAT2-', 'BAT2-', 'SENSE_HV'), pin('PE', 'PE', 'PE')]),
    device('GB-BMS', 'C10F', 'BMS主机', 'bms-controller', [pin('BAT_CANH', 'INCANH', 'CAN'), pin('BAT_CANL', 'INCANL', 'CAN'), pin('BAT_CANS', 'INCANS', 'CAN'), pin('CAN1H', 'CAN1H', 'CAN'), pin('CAN1L', 'CAN1L', 'CAN'), pin('K1+', 'K1+', 'AUX_24V'), pin('K2+', 'K2+', 'AUX_24V'), pin('K3+', 'K3+', 'AUX_24V'), pin('K4+', 'K4+', 'AUX_24V'), pin('K5+', 'K5+', 'AUX_24V', TRACE.INFERRED), pin('HALL_5V', '5V+', 'AUX_5V'), pin('HALL_GND', '5VGND', 'AUX_5V'), pin('HALL_OUT', 'OUT', 'SIGNAL_ANALOG'), pin('24V+', '内网24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V'), pin('WAKE', 'C10F唤醒', 'SIGNAL_DIGITAL')]),
    device('GB-DC-IN', 'XS-DC-IN', '国标直流补电座', 'gbt-dc-inlet', [pin('DC+', 'DC+', 'HV_DC_ESS'), pin('DC-', 'DC-', 'HV_DC_ESS'), pin('PE', 'PE', 'PE'), pin('S2+', 'S2+', 'CAN'), pin('S2-', 'S2-', 'CAN'), pin('CC2', 'CC2', 'SIGNAL_ANALOG'), pin('A2+', 'A2+', 'AUX_12V'), pin('A2-', 'A2-', 'AUX_12V')]),
    device('GB-AC-IN', 'XS-AC-IN', '交流供电枪座', 'ac-charge-inlet', [pin('L1', 'L1', 'AC'), pin('L2', 'L2', 'AC'), pin('L3', 'L3', 'AC'), pin('PE', 'PE', 'PE')]),
    device('GB-QS-AC', 'QS-AC', '交流供电枪三极开关', 'ac-isolator', [pin('L1_IN', 'L1输入', 'AC', TRACE.VISIBLE), pin('L2_IN', 'L2输入', 'AC', TRACE.VISIBLE), pin('L3_IN', 'L3输入', 'AC', TRACE.VISIBLE), pin('L1_OUT', 'L1输出', 'AC', TRACE.VISIBLE), pin('L2_OUT', 'L2输出', 'AC', TRACE.VISIBLE), pin('L3_OUT', 'L3输出', 'AC', TRACE.VISIBLE)]),
    device('GB-QF', 'QF', '高压直流辅助电源双极断路/分励辅助链', 'dc-breaker', [pin('DC+_IN', 'DC+输入', 'HV_DC_ESS', TRACE.VISIBLE), pin('DC-_IN', 'DC-输入', 'HV_DC_ESS', TRACE.VISIBLE), pin('DC+_OUT', 'DC+输出', 'HV_DC_ESS', TRACE.VISIBLE), pin('DC-_OUT', 'DC-输出', 'HV_DC_ESS', TRACE.VISIBLE), pin('MX', 'MX分励', 'SIGNAL_DIGITAL'), pin('OF2', 'OF2辅助', 'SIGNAL_DIGITAL')]),
    device('GB-MODS', 'M1~M3', '充电模块阵列', 'power-module-array', [pin('AC_L1', 'L1', 'AC', TRACE.VISIBLE), pin('AC_L2', 'L2', 'AC', TRACE.VISIBLE), pin('AC_L3', 'L3', 'AC', TRACE.VISIBLE), pin('DC+', 'DC+', 'HV_DC_CHARGE'), pin('DC-', 'DC-', 'HV_DC_CHARGE'), pin('CANH', 'CANH', 'CAN'), pin('CANL', 'CANL', 'CAN')]),
    device('GB-T24', 'T1', '4500W高压DC至24V DC/DC', 'hv-aux-converter', [pin('HV+', 'DC+', 'HV_DC_ESS', TRACE.VISIBLE), pin('HV-', 'DC-', 'HV_DC_ESS', TRACE.VISIBLE), pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V')]),
    device('GB-T12', 'T2', '320W 24V至12V DC/DC', 'aux-dc-converter', [pin('24V+', '24V+', 'AUX_24V', TRACE.VISIBLE), pin('24V-', '24V-', 'AUX_24V', TRACE.VISIBLE), pin('12V+', '12V+', 'AUX_12V'), pin('12V-', '12V-', 'AUX_12V')]),
    device('GB-MAIN', 'A1', '充电桩主板一', 'charge-controller', [pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V'), pin('12V+', '12V+', 'AUX_12V'), pin('12V-', '12V-', 'AUX_12V'), pin('CANH', 'CANH', 'CAN'), pin('CANL', 'CANL', 'CAN'), pin('S+', 'S+', 'CAN'), pin('S-', 'S-', 'CAN'), pin('DC_DET', '直流补电检测', 'SIGNAL_ANALOG'), pin('AC_DET', '交流补电检测', 'SIGNAL_ANALOG'), pin('FS-OUT', 'FS-OUT', 'SIGNAL_DIGITAL'), pin('LB-IN', 'LB-IN', 'SIGNAL_DIGITAL'), pin('ON_WAKE', 'ON档唤醒', 'SIGNAL_DIGITAL')]),
    device('GB-VBOX', 'VBOX', '车联网VBOX', 'comm-gateway', [pin('CAN1H', 'CAN1H', 'CAN'), pin('CAN1L', 'CAN1L', 'CAN'), pin('ETH', '有线网络接口', 'ETHERNET'), pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V')]),
    device('GB-GPS', 'GPS', 'GPS定位单元', 'gps-receiver', [pin('WAKE', '唤醒', 'SIGNAL_DIGITAL'), pin('ETH', '有线网络接口', 'ETHERNET'), pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V')]),
    device('GB-ROUTER', 'R1', '路由器', 'comm-gateway', [pin('ETH', '有线网络接口', 'ETHERNET'), pin('ANT', '天线', 'RF'), pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V')]),
    device('GB-CAN-BRIDGE', 'A2', 'CAN桥', 'comm-gateway', [pin('CANH', 'CANH', 'CAN'), pin('CANL', 'CANL', 'CAN'), pin('24V+', '24V+', 'AUX_24V'), pin('24V-', '24V-', 'AUX_24V')], { traceCompleteness: 'UNRESOLVED', unresolvedReason: '原图标出CAN桥但扁平SVG未能可靠恢复其四根端点走向。' }),
    device('GB-K14', 'K14', '国标枪负极隔离接触器', 'dc-contactor', contactorPins('HV_DC_CHARGE')),
    device('GB-K15', 'K15', '国标枪正极隔离接触器', 'dc-contactor', contactorPins('HV_DC_CHARGE')),
    device('GB-FU1', 'FU1', '国标枪直流熔断器', 'dc-fuse', twoTerminalPins('HV_DC_CHARGE')),
    device('GB-RS1', 'RS1', '国标枪直流电流传感器', 'current-transducer', [pin('IP+', 'I+', 'HV_DC_CHARGE', TRACE.VISIBLE), pin('IP-', 'I-', 'HV_DC_CHARGE', TRACE.VISIBLE), pin('OUT', '采样输出', 'SIGNAL_ANALOG', TRACE.VISIBLE)]),
    device('GB-GUN', 'XS-GBT', '国标充电枪', 'gbt-dc-connector', [pin('DC+', 'DC+', 'HV_DC_CHARGE'), pin('DC-', 'DC-', 'HV_DC_CHARGE'), pin('PE', 'PE', 'PE'), pin('S+', 'S+', 'CAN'), pin('S-', 'S-', 'CAN'), pin('A1+', 'A1+', 'AUX_12V'), pin('A1-', 'A1-', 'AUX_12V')]),
    device('GB-PE', 'PE', '保护接地汇流排', 'earth-bar', [pin('PE', 'PE', 'PE')])
  ];

  const GB_CONNECTIONS = [
    connection('GB-W001', 'BAT_SERIES_12', 'GB-BAT1:NEG', 'GB-BAT2:POS', 'POWER_DC_ESS', TRACE.LABELLED),
    connection('GB-W002', 'BAT_SERIES_23', 'GB-BAT2:NEG', 'GB-BAT3:POS', 'POWER_DC_ESS', TRACE.LABELLED),
    connection('GB-W003', 'BAT_SERIES_34', 'GB-BAT3:NEG', 'GB-BAT4:POS', 'POWER_DC_ESS', TRACE.LABELLED),
    connection('GB-W004H', 'BAT_COMM_12_H', 'GB-BAT1:COMM_OUT_H', 'GB-BAT2:COMM_IN_H', 'CAN', TRACE.INFERRED, '原图仅标“通信进/出”，CANH逐芯映射待线束表确认。'),
    connection('GB-W004L', 'BAT_COMM_12_L', 'GB-BAT1:COMM_OUT_L', 'GB-BAT2:COMM_IN_L', 'CAN', TRACE.INFERRED, '原图仅标“通信进/出”，CANL逐芯映射待线束表确认。'),
    connection('GB-W005H', 'BAT_COMM_23_H', 'GB-BAT2:COMM_OUT_H', 'GB-BAT3:COMM_IN_H', 'CAN', TRACE.INFERRED, '原图仅标“通信进/出”，CANH逐芯映射待线束表确认。'),
    connection('GB-W005L', 'BAT_COMM_23_L', 'GB-BAT2:COMM_OUT_L', 'GB-BAT3:COMM_IN_L', 'CAN', TRACE.INFERRED, '原图仅标“通信进/出”，CANL逐芯映射待线束表确认。'),
    connection('GB-W006H', 'BAT_COMM_34_H', 'GB-BAT3:COMM_OUT_H', 'GB-BAT4:COMM_IN_H', 'CAN', TRACE.INFERRED, '原图仅标“通信进/出”，CANH逐芯映射待线束表确认。'),
    connection('GB-W006L', 'BAT_COMM_34_L', 'GB-BAT3:COMM_OUT_L', 'GB-BAT4:COMM_IN_L', 'CAN', TRACE.INFERRED, '原图仅标“通信进/出”，CANL逐芯映射待线束表确认。'),
    connection('GB-W007', 'BAT_TOTAL_POS_PROTECTION', 'GB-BAT1:POS', 'GB-FPOS:1', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W008', 'BAT_TOTAL_POS_MAIN', 'GB-FPOS:2', 'GB-K1:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W009', 'BAT_CHARGE_POS', 'GB-FPOS:2', 'GB-K2:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W010', 'DC_REPLENISH_POS', 'GB-K2:OUT', 'GB-DC-IN:DC+', 'POWER_DC_ESS', TRACE.LABELLED),
    connection('GB-W011', 'BAT_HEAT_POS', 'GB-FPOS:2', 'GB-K3:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W012', 'BAT_TOTAL_NEG_PROTECTION', 'GB-BAT4:NEG', 'GB-FNEG:1', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W013', 'BAT_TOTAL_NEG_SENSE', 'GB-FNEG:2', 'GB-HALL:IP+', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W014', 'BAT_DISCHARGE_NEG', 'GB-HALL:IP-', 'GB-K4:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W015', 'BAT_CHARGE_NEG', 'GB-HALL:IP-', 'GB-K5:IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W016', 'DC_REPLENISH_NEG', 'GB-K5:OUT', 'GB-DC-IN:DC-', 'POWER_DC_ESS', TRACE.LABELLED),
    connection('GB-W016A', 'DC_REPLENISH_A2_POS_DETECT', 'GB-DC-IN:A2+', 'GB-MAIN:DC_DET', 'SIGNAL_ANALOG', TRACE.VISIBLE, '图中“直流补电检测/JC12V+”进入主板；J口针号待端子表确认。'),
    connection('GB-W016B', 'DC_REPLENISH_A2_RETURN', 'GB-DC-IN:A2-', 'GB-MAIN:12V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W016C', 'DC_REPLENISH_CC2_WAKE', 'GB-DC-IN:CC2', 'GB-BMS:WAKE', 'SIGNAL_DIGITAL', TRACE.VISIBLE, '图中C10F唤醒关系可见，精确阈值待确认。'),
    connection('GB-W017', 'DC_REPLENISH_CAN_H', 'GB-DC-IN:S2+', 'GB-MAIN:CANH', 'CAN', TRACE.LABELLED),
    connection('GB-W018', 'DC_REPLENISH_CAN_L', 'GB-DC-IN:S2-', 'GB-MAIN:CANL', 'CAN', TRACE.LABELLED),
    connection('GB-W019', 'DC_REPLENISH_PE', 'GB-DC-IN:PE', 'GB-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED),
    connection('GB-W020', 'BATTERY_COMM_TO_BMS_H', 'GB-BAT4:COMM_OUT_H', 'GB-BMS:BAT_CANH', 'CAN', TRACE.INFERRED, '原图将通信进/出画为多芯链，CANH需源CAD逐芯确认。'),
    connection('GB-W021', 'BATTERY_COMM_TO_BMS_L', 'GB-BAT4:COMM_OUT_L', 'GB-BMS:BAT_CANL', 'CAN', TRACE.INFERRED, '原图将通信进/出画为多芯链，CANL需源CAD逐芯确认。'),
    connection('GB-W022', 'BMS_K1_DRIVE', 'GB-BMS:K1+', 'GB-K1:A1', 'CONTROL', TRACE.LABELLED),
    connection('GB-W023', 'BMS_K2_DRIVE', 'GB-BMS:K2+', 'GB-K2:A1', 'CONTROL', TRACE.LABELLED),
    connection('GB-W024', 'BMS_K3_DRIVE', 'GB-BMS:K3+', 'GB-K3:A1', 'CONTROL', TRACE.LABELLED),
    connection('GB-W025', 'BMS_K4_DRIVE', 'GB-BMS:K4+', 'GB-K4:A1', 'CONTROL', TRACE.LABELLED),
    connection('GB-W025A', 'BMS_K5_DRIVE', 'GB-BMS:K5+', 'GB-K5:A1', 'CONTROL', TRACE.INFERRED, '图中K5充电负线圈存在，BMS具体针号待端子表确认。'),
    connection('GB-W025B', 'CONTACTOR_COIL_RETURN_K1', 'GB-K1:A2', 'GB-BMS:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W025C', 'CONTACTOR_COIL_RETURN_K2', 'GB-K2:A2', 'GB-BMS:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W025D', 'CONTACTOR_COIL_RETURN_K3', 'GB-K3:A2', 'GB-BMS:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W025E', 'CONTACTOR_COIL_RETURN_K4', 'GB-K4:A2', 'GB-BMS:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W025F', 'CONTACTOR_COIL_RETURN_K5', 'GB-K5:A2', 'GB-BMS:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W025G', 'HALL_SUPPLY', 'GB-BMS:HALL_5V', 'GB-HALL:5V+', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('GB-W025H', 'HALL_RETURN', 'GB-BMS:HALL_GND', 'GB-HALL:5VGND', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('GB-W025I', 'HALL_SIGNAL', 'GB-HALL:OUT', 'GB-BMS:HALL_OUT', 'SIGNAL_ANALOG', TRACE.LABELLED),
    connection('GB-W026', 'BMS_IMD_PE', 'GB-IMD:PE', 'GB-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED),
    connection('GB-W027', 'BMS_VBOX_CANH', 'GB-BMS:CAN1H', 'GB-VBOX:CAN1H', 'CAN', TRACE.LABELLED),
    connection('GB-W028', 'BMS_VBOX_CANL', 'GB-BMS:CAN1L', 'GB-VBOX:CAN1L', 'CAN', TRACE.LABELLED),
    connection('GB-W029', 'AC_IN_L1_SWITCH', 'GB-AC-IN:L1', 'GB-QS-AC:L1_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('GB-W030', 'AC_IN_L2_SWITCH', 'GB-AC-IN:L2', 'GB-QS-AC:L2_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('GB-W031', 'AC_IN_L3_SWITCH', 'GB-AC-IN:L3', 'GB-QS-AC:L3_IN', 'POWER_AC', TRACE.VISIBLE),
    connection('GB-W032', 'AC_IN_PE', 'GB-AC-IN:PE', 'GB-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED),
    connection('GB-W033L1', 'MODULE_AC_L1', 'GB-QS-AC:L1_OUT', 'GB-MODS:AC_L1', 'POWER_AC', TRACE.VISIBLE),
    connection('GB-W033L2', 'MODULE_AC_L2', 'GB-QS-AC:L2_OUT', 'GB-MODS:AC_L2', 'POWER_AC', TRACE.VISIBLE),
    connection('GB-W033L3', 'MODULE_AC_L3', 'GB-QS-AC:L3_OUT', 'GB-MODS:AC_L3', 'POWER_AC', TRACE.VISIBLE),
    connection('GB-W034P', 'AUX_HV_POS_BREAKER', 'GB-K1:OUT', 'GB-QF:DC+_IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W034N', 'AUX_HV_NEG_BREAKER', 'GB-K4:OUT', 'GB-QF:DC-_IN', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W035P', 'AUX_HV_POS_T24', 'GB-QF:DC+_OUT', 'GB-T24:HV+', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W035N', 'AUX_HV_NEG_T24', 'GB-QF:DC-_OUT', 'GB-T24:HV-', 'POWER_DC_ESS', TRACE.VISIBLE),
    connection('GB-W036', 'MODULE_CANH', 'GB-MODS:CANH', 'GB-MAIN:CANH', 'CAN', TRACE.LABELLED),
    connection('GB-W037', 'MODULE_CANL', 'GB-MODS:CANL', 'GB-MAIN:CANL', 'CAN', TRACE.LABELLED),
    connection('GB-W038', 'AUX24_MAIN_POS', 'GB-T24:24V+', 'GB-MAIN:24V+', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W039', 'AUX24_MAIN_NEG', 'GB-T24:24V-', 'GB-MAIN:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W039A', 'AUX24_TO_T12_POS', 'GB-T24:24V+', 'GB-T12:24V+', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W039B', 'AUX24_TO_T12_NEG', 'GB-T24:24V-', 'GB-T12:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W040', 'AUX12_MAIN_POS', 'GB-T12:12V+', 'GB-MAIN:12V+', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('GB-W041', 'AUX12_MAIN_NEG', 'GB-T12:12V-', 'GB-MAIN:12V-', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('GB-W041A', 'AUX24_BMS_POS', 'GB-T24:24V+', 'GB-BMS:24V+', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W041B', 'AUX24_BMS_NEG', 'GB-T24:24V-', 'GB-BMS:24V-', 'POWER_DC_AUX', TRACE.VISIBLE),
    connection('GB-W042', 'VBOX_ROUTER_ETH', 'GB-VBOX:ETH', 'GB-ROUTER:ETH', 'ETHERNET', TRACE.VISIBLE),
    connection('GB-W043', 'GPS_ROUTER_ETH', 'GB-GPS:ETH', 'GB-ROUTER:ETH', 'ETHERNET', TRACE.VISIBLE),
    connection('GB-W044', 'MODULE_DC_NEG_TO_K14', 'GB-MODS:DC-', 'GB-K14:IN', 'POWER_DC_CHARGE', TRACE.VISIBLE, '源SVG蓝色DC−支路。'),
    connection('GB-W045', 'GUN_NEG_SENSE', 'GB-K14:OUT', 'GB-RS1:IP+', 'POWER_DC_CHARGE', TRACE.VISIBLE),
    connection('GB-W046', 'GUN_DC_NEG', 'GB-RS1:IP-', 'GB-GUN:DC-', 'POWER_DC_CHARGE', TRACE.LABELLED),
    connection('GB-W047', 'MODULE_DC_POS_TO_K15', 'GB-MODS:DC+', 'GB-K15:IN', 'POWER_DC_CHARGE', TRACE.VISIBLE, '源SVG红色DC+支路。'),
    connection('GB-W048', 'GUN_POS_FUSE', 'GB-K15:OUT', 'GB-FU1:1', 'POWER_DC_CHARGE', TRACE.VISIBLE),
    connection('GB-W049', 'GUN_DC_POS', 'GB-FU1:2', 'GB-GUN:DC+', 'POWER_DC_CHARGE', TRACE.LABELLED),
    connection('GB-W050', 'GUN_CAN_H', 'GB-MAIN:S+', 'GB-GUN:S+', 'CAN', TRACE.LABELLED),
    connection('GB-W051', 'GUN_CAN_L', 'GB-MAIN:S-', 'GB-GUN:S-', 'CAN', TRACE.LABELLED),
    connection('GB-W051A', 'GUN_AUX_POS', 'GB-MAIN:12V+', 'GB-GUN:A1+', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('GB-W051B', 'GUN_AUX_NEG', 'GB-MAIN:12V-', 'GB-GUN:A1-', 'POWER_DC_AUX', TRACE.LABELLED),
    connection('GB-W052', 'GUN_PE', 'GB-GUN:PE', 'GB-PE:PE', 'PROTECTIVE_EARTH', TRACE.LABELLED)
  ];

  const GB_UNITS = [
    unit('GB-U1', '四箱电池、加热与BMS', ['GB-BAT1', 'GB-BAT2', 'GB-BAT3', 'GB-BAT4', 'GB-FPOS', 'GB-FNEG', 'GB-K1', 'GB-K2', 'GB-K3', 'GB-K4', 'GB-K5', 'GB-HALL', 'GB-IMD', 'GB-BMS', 'GB-PE'], ['GB-W001', 'GB-W002', 'GB-W003', 'GB-W004H', 'GB-W004L', 'GB-W005H', 'GB-W005L', 'GB-W006H', 'GB-W006L', 'GB-W007', 'GB-W008', 'GB-W009', 'GB-W011', 'GB-W012', 'GB-W013', 'GB-W014', 'GB-W015', 'GB-W020', 'GB-W021', 'GB-W022', 'GB-W023', 'GB-W024', 'GB-W025', 'GB-W025A', 'GB-W025B', 'GB-W025C', 'GB-W025D', 'GB-W025E', 'GB-W025F', 'GB-W025G', 'GB-W025H', 'GB-W025I', 'GB-W026'], ['四箱串联', '总正/充电正/加热/放电负/充电负独立接触器', '绝缘监测', '电流采样']),
    unit('GB-U2', '国标直流补电入口', ['GB-DC-IN', 'GB-K2', 'GB-K5', 'GB-MAIN', 'GB-BMS', 'GB-PE'], ['GB-W010', 'GB-W016', 'GB-W016A', 'GB-W016B', 'GB-W016C', 'GB-W017', 'GB-W018', 'GB-W019'], ['DC+/DC-补电', 'S2+/S2-通信', 'CC2与A2+/A2-辅助检测']),
    unit('GB-U3', '交流输入、模块与辅助电源', ['GB-AC-IN', 'GB-QS-AC', 'GB-QF', 'GB-MODS', 'GB-T24', 'GB-T12', 'GB-MAIN', 'GB-BMS', 'GB-PE'], ['GB-W029', 'GB-W030', 'GB-W031', 'GB-W032', 'GB-W033L1', 'GB-W033L2', 'GB-W033L3', 'GB-W034P', 'GB-W034N', 'GB-W035P', 'GB-W035N', 'GB-W036', 'GB-W037', 'GB-W038', 'GB-W039', 'GB-W039A', 'GB-W039B', 'GB-W040', 'GB-W041', 'GB-W041A', 'GB-W041B'], ['三相交流输入独立开关', '高压DC辅助电源QF/MX+OF2', '模块CAN', '24V/12V级联电源域']),
    unit('GB-U4', '国标输出枪功率与通信链', ['GB-MODS', 'GB-K14', 'GB-K15', 'GB-FU1', 'GB-RS1', 'GB-GUN', 'GB-MAIN', 'GB-PE'], ['GB-W044', 'GB-W045', 'GB-W046', 'GB-W047', 'GB-W048', 'GB-W049', 'GB-W050', 'GB-W051', 'GB-W051A', 'GB-W051B', 'GB-W052'], ['模块DC−→K14→RS1→枪DC−', '模块DC+→K15→FU1→枪DC+', 'S+/S- CAN', 'A1+/A1-辅助电源', 'PE独立']),
    unit('GB-U5', '车联网与外围通信', ['GB-BMS', 'GB-MAIN', 'GB-VBOX', 'GB-GPS', 'GB-ROUTER', 'GB-CAN-BRIDGE'], ['GB-W027', 'GB-W028', 'GB-W042', 'GB-W043'], ['BMS CAN', 'VBOX/GPS/路由器', '有线网络与CAN桥'])
  ];

  const SYSTEMS = Object.freeze({
    'REF-EU-ESS-CCS2': system('REF-EU-ESS-CCS2', '欧标储能充电桩项目参考', 'SRC-EU-PROJECT-SVG',
      EURO_DEVICES, EURO_CONNECTIONS, EURO_UNITS, [
        'PCS与DC/DC厂家端子号未在SVG中完整标注；当前只登记可见功能端子。',
        '3P+N交流路径已逐导体登记；RCM/KM1/PCS厂家端子号和额定值仍需源CAD/器件表复核。',
        '接触器辅助触点、线圈回路及全部线号需以源CAD/端子表复核。',
        '电池箱数量和BMS级联协议属于该项目实例，不得推广为所有欧标桩。'
      ], { standard: 'eu', archetype: 'ess-mobile', interface: 'CCS2' }),
    'REF-GB60-MOBILE': system('REF-GB60-MOBILE', '国标60kW储能/移动充电项目参考', 'SRC-GB60-PROJECT-SVG',
      GB_DEVICES, GB_CONNECTIONS, GB_UNITS, [
        '枪侧已按原图颜色/坐标纠正为：模块DC−→K14→RS1→枪DC−，模块DC+→K15→FU1→枪DC+；厂家端子号仍待确认。',
        '四箱通信为多芯连接器链；CANH/CANL与屏蔽逐芯关系需源CAD或线束表确认。',
        '充电模块块内的三相输入、DC输出及并联均流端子未完全展开。',
        '主板各J口针号、KA继电器线圈/触点映射和QF MX+OF2端子号仍需原始端子表。'
      ], { standard: 'gb', archetype: 'ess-mobile', interface: 'GB/T DC' })
  });

  const TRACE_REVIEW_MANIFEST = Object.freeze([
    { id: 'GB-K14-NEG', sourceId: 'SRC-GB60-PROJECT-SVG', objectId: 'GB-K14',
      textAnchor: Object.freeze([7101.1733, 2895.1468]), observed: '蓝色DC−支路接触器K14，下游为RS1',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'GB-K15-POS', sourceId: 'SRC-GB60-PROJECT-SVG', objectId: 'GB-K15',
      textAnchor: Object.freeze([7286.8534, 2892.3467]), observed: '红色DC+支路接触器K15，下游为FU1',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'GB-RS1-NEG', sourceId: 'SRC-GB60-PROJECT-SVG', objectId: 'GB-RS1',
      textAnchor: Object.freeze([6954.8133, 3136.8669]), observed: 'RS1串接枪侧DC−',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'GB-FU1-POS', sourceId: 'SRC-GB60-PROJECT-SVG', objectId: 'GB-FU1',
      textAnchor: Object.freeze([7253.4136, 3132.5068]), observed: 'FU1串接枪侧DC+',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'GB-T24-DCDC', sourceId: 'SRC-GB60-PROJECT-SVG', objectId: 'GB-T24',
      textAnchor: Object.freeze([5633.5736, 2771.1068]), observed: '4500W-24V块标注DC/DC，输入为红蓝HV-DC双极',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'GB-T12-DCDC', sourceId: 'SRC-GB60-PROJECT-SVG', objectId: 'GB-T12',
      textAnchor: Object.freeze([5194.0534, 3096.3467]), observed: '320W-12V块标注DC/DC，由24V域级联',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'EU-K10-NEG', sourceId: 'SRC-EU-PROJECT-SVG', objectId: 'EU-K10',
      textAnchor: Object.freeze([3100.0801, 1467.3134]), observed: '蓝色PCS DC−支路接触器K10',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'EU-K9-POS', sourceId: 'SRC-EU-PROJECT-SVG', objectId: 'EU-K9',
      textAnchor: Object.freeze([3275.5199, 1464.5934]), observed: '红色PCS DC+支路接触器K9，下游FU3',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'EU-RS1-NEG', sourceId: 'SRC-EU-PROJECT-SVG', objectId: 'EU-RS1',
      textAnchor: Object.freeze([2980.5599, 1689.6334]), observed: 'RS1串接PCS蓝色负母线',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'EU-K8-NEG', sourceId: 'SRC-EU-PROJECT-SVG', objectId: 'EU-K8',
      textAnchor: Object.freeze([3096.0801, 2337.7133]), observed: 'DCDC枪侧蓝色DC−接触器K8',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' },
    { id: 'EU-K7-POS', sourceId: 'SRC-EU-PROJECT-SVG', objectId: 'EU-K7',
      textAnchor: Object.freeze([3278.1598, 2333.7933]), observed: 'DCDC枪侧红色DC+接触器K7，下游FU2',
      status: 'MANUAL_VECTOR_REVIEW—ENGINEER_SIGNOFF_PENDING' }
  ].map((item) => Object.freeze(item)));

  function endpoint(value) {
    const text = String(value || ''); const index = text.indexOf(':');
    return index < 1 ? null : { deviceId: text.slice(0, index), pinId: text.slice(index + 1) };
  }
  const NET_CLASS_DOMAINS = Object.freeze({
    POWER_AC: Object.freeze(['AC']),
    POWER_DC_ESS: Object.freeze(['HV_DC_ESS']),
    POWER_DC_CHARGE: Object.freeze(['HV_DC_CHARGE']),
    PROTECTIVE_EARTH: Object.freeze(['PE']),
    POWER_DC_AUX: Object.freeze(['AUX_24V', 'AUX_12V', 'AUX_5V']),
    CAN: Object.freeze(['CAN']),
    ETHERNET: Object.freeze(['ETHERNET']),
    CONTROL_PILOT: Object.freeze(['CONTROL_PILOT']),
    PROXIMITY: Object.freeze(['PROXIMITY']),
    RF: Object.freeze(['RF']),
    CONTROL: Object.freeze(['SIGNAL_DIGITAL', 'AUX_24V', 'AUX_12V', 'AUX_5V']),
    SENSE_HV: Object.freeze(['SENSE_HV', 'HV_DC_ESS', 'HV_DC_CHARGE']),
    SIGNAL_ANALOG: Object.freeze(['SIGNAL_ANALOG', 'AUX_24V', 'AUX_12V', 'AUX_5V']),
    SIGNAL_DIGITAL: Object.freeze(['SIGNAL_DIGITAL', 'SIGNAL_ANALOG']),
    SURGE: Object.freeze(['AC', 'PE'])
  });
  function domainCompatible(netClass, domain) {
    const allowed = NET_CLASS_DOMAINS[String(netClass || '')];
    return !!allowed && allowed.includes(String(domain || ''));
  }
  function validate(reference) {
    const errors = []; const warnings = []; const unresolved = [];
    const deviceIds = new Set(); const connectionIds = new Set(); const connectedEndpoints = new Set();
    const deviceUse = new Map(); const connectionUse = new Map(); const connectionCount = new Map();
    const byDevice = new Map();
    (reference && reference.devices || []).forEach((item) => {
      if (deviceIds.has(item.id)) errors.push({ code: 'DUPLICATE_DEVICE', id: item.id });
      deviceIds.add(item.id); deviceUse.set(item.id, 0); connectionCount.set(item.id, 0);
      byDevice.set(item.id, new Map((item.pins || []).map((port) => [port.id, port])));
    });
    (reference && reference.connections || []).forEach((wire) => {
      if (connectionIds.has(wire.id)) errors.push({ code: 'DUPLICATE_CONNECTION', id: wire.id });
      connectionIds.add(wire.id); connectionUse.set(wire.id, 0);
      const knownNetClass = Object.prototype.hasOwnProperty.call(NET_CLASS_DOMAINS, String(wire.netClass || ''));
      if (!knownNetClass) errors.push({ code: 'UNKNOWN_NET_CLASS', id: wire.id, netClass: wire.netClass });
      const resolved = [];
      [['from', wire.from], ['to', wire.to]].forEach(([side, raw]) => {
        const parsed = endpoint(raw); const pins = parsed && byDevice.get(parsed.deviceId);
        if (!parsed || !pins) errors.push({ code: 'UNKNOWN_DEVICE_ENDPOINT', id: wire.id, side, endpoint: raw });
        else if (!pins.has(parsed.pinId)) errors.push({ code: 'UNKNOWN_PIN_ENDPOINT', id: wire.id, side, endpoint: raw });
        else {
          const port = pins.get(parsed.pinId); resolved.push({ parsed, port, side }); connectedEndpoints.add(raw);
          connectionCount.set(parsed.deviceId, (connectionCount.get(parsed.deviceId) || 0) + 1);
          if (knownNetClass && !domainCompatible(wire.netClass, port.domain)) errors.push({ code: 'NETCLASS_PIN_DOMAIN_MISMATCH',
            id: wire.id, side, endpoint: raw, netClass: wire.netClass, pinDomain: port.domain });
        }
      });
      if (resolved.length === 2 && wire.from === wire.to) errors.push({ code: 'SELF_CONNECTION', id: wire.id });
      if (wire.evidenceStatus === TRACE.INFERRED) unresolved.push({ code: 'INFERRED_CONNECTION_REVIEW_REQUIRED', id: wire.id, note: wire.note });
    });
    (reference && reference.functionalUnits || []).forEach((item) => {
      const localDevices = new Set(); const localConnections = new Set();
      item.deviceIds.forEach((id) => {
        if (localDevices.has(id)) errors.push({ code: 'UNIT_DUPLICATE_DEVICE', unitId: item.id, id });
        localDevices.add(id);
        if (!deviceIds.has(id)) errors.push({ code: 'UNIT_UNKNOWN_DEVICE', unitId: item.id, id });
        else deviceUse.set(id, (deviceUse.get(id) || 0) + 1);
      });
      item.connectionIds.forEach((id) => {
        if (localConnections.has(id)) errors.push({ code: 'UNIT_DUPLICATE_CONNECTION', unitId: item.id, id });
        localConnections.add(id);
        if (!connectionIds.has(id)) errors.push({ code: 'UNIT_UNKNOWN_CONNECTION', unitId: item.id, id });
        else connectionUse.set(id, (connectionUse.get(id) || 0) + 1);
      });
    });
    (reference && reference.devices || []).forEach((item) => {
      if (!(deviceUse.get(item.id) > 0)) errors.push({ code: 'DEVICE_NOT_ASSIGNED_TO_FUNCTIONAL_UNIT', id: item.id });
      if (!(connectionCount.get(item.id) > 0)) {
        const detail = { code: 'DEVICE_WITHOUT_CONNECTION', id: item.id, reason: item.unresolvedReason || '' };
        if (item.traceCompleteness === 'UNRESOLVED') unresolved.push(detail); else errors.push(detail);
      }
      if (item.traceCompleteness === 'UNRESOLVED') unresolved.push({ code: 'DEVICE_TRACE_INCOMPLETE', id: item.id, reason: item.unresolvedReason || '' });
      (item.pins || []).forEach((port) => {
        const ref = item.id + ':' + port.id;
        if (!connectedEndpoints.has(ref)) unresolved.push({ code: 'DECLARED_PIN_NOT_YET_TRACED', endpoint: ref,
          evidenceStatus: port.evidenceStatus, domain: port.domain });
      });
    });
    connectionUse.forEach((count, id) => { if (!(count > 0)) errors.push({ code: 'CONNECTION_NOT_ASSIGNED_TO_FUNCTIONAL_UNIT', id }); });
    if (reference && reference.automaticSelectionAllowed !== false) errors.push({ code: 'REFERENCE_AUTO_SELECTION_FORBIDDEN' });
    const completeness = errors.length === 0 && unresolved.length === 0;
    if (!completeness) warnings.push({ code: 'REFERENCE_PARTIAL_TRACE_ONLY',
      detail: '结构校验通过不等于逐PIN提取完成；未决项关闭并经工程师签核前禁止自动比较或选型。' });
    return Object.freeze({ ok: errors.length === 0, complete: completeness,
      errors: Object.freeze(errors), warnings: Object.freeze(warnings), unresolved: Object.freeze(unresolved) });
  }
  function find(id) { return SYSTEMS[id] || null; }
  function summary() {
    const values = Object.values(SYSTEMS);
    const connections = values.flatMap((item) => item.connections);
    return Object.freeze({
      schema: 'EVSE-REFERENCE-SYSTEM-SUMMARY/1.0', version: VERSION,
      referenceCount: values.length,
      deviceCount: values.reduce((sum, item) => sum + item.devices.length, 0),
      connectionCount: connections.length,
      labelledConnectionCount: connections.filter((item) => item.evidenceStatus === TRACE.LABELLED).length,
      visibleConnectionCount: connections.filter((item) => item.evidenceStatus === TRACE.VISIBLE).length,
      inferredConnectionCount: connections.filter((item) => item.evidenceStatus === TRACE.INFERRED).length,
      functionalUnitCount: values.reduce((sum, item) => sum + item.functionalUnits.length, 0),
      allStructurallyValid: values.every((item) => validate(item).ok),
      allComplete: values.every((item) => validate(item).complete),
      unresolvedItemCount: values.reduce((sum, item) => sum + validate(item).unresolved.length, 0),
      evidenceLoaded: !!EVIDENCE
    });
  }

  return Object.freeze({ VERSION, SCHEMA, TRACE, NET_CLASS_DOMAINS, SYSTEMS, TRACE_REVIEW_MANIFEST, find, validate, summary });
});
