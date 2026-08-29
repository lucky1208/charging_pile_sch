/* ============================================================
 * Board-level functional-unit and exact endpoint library
 * ------------------------------------------------------------
 * A template is a graph, never a bitmap: every conductor has one explicit
 * component pin at each end.  Values and thresholds remain unapproved until
 * a project engineer completes tolerance, isolation and safety analysis.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  let symbols = root && root.EVSE_BOARD_SYMBOL_CATALOG;
  let evidence = root && root.EVSE_EVIDENCE_LIBRARY;
  if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
    symbols = symbols || require('./board-symbol-catalog.js');
    evidence = evidence || require('./evidence-library.js');
  }
  const api = factory(symbols, evidence);
  if (root) root.EVSE_BOARD_CIRCUIT_LIBRARY = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function (SYMBOLS, EVIDENCE) {
  'use strict';

  const VERSION = '1.1.0';
  const SCHEMA = 'EVSE-BOARD-CIRCUIT-TEMPLATE/1.0';
  const OBSERVED = 'OBSERVED_TOPOLOGY—VALUES_AND_COMPLIANCE_REVIEW_REQUIRED';
  const ABSTRACT = 'ABSTRACT_CONTRACT—PIN_GRAPH_NOT_YET_CAPTURED';

  function component(id, symbolId, ref, value, extra) {
    const result = Object.assign({
      id, symbolId, ref: ref || id, value: value || '', pinMap: Object.freeze({})
    }, extra || {});
    result.optionalLogicalPins = Object.freeze((result.optionalLogicalPins || []).map(String));
    result.ncLogicalPins = Object.freeze((result.ncLogicalPins || []).map(String));
    result.physicalPinStatus = Object.keys(result.pinMap || {}).length
      ? 'LOGICAL_TO_PHYSICAL_PIN_MAP_PRESENT—PACKAGE_REVIEW_REQUIRED'
      : 'SYMBOLIC_PIN_ONLY—PACKAGE_PIN_MAP_REQUIRED';
    return Object.freeze(result);
  }
  function circuit(id, net, from, to, netClass, status) {
    return Object.freeze({
      id, net, from, to, netClass: netClass || 'SIGNAL_ANALOG',
      evidenceStatus: status || 'OBSERVED_CONNECTIVITY'
    });
  }
  function pinMap(values) { return Object.freeze(Object.assign({}, values || {})); }
  function endpointComponent(id, label) {
    return component(id, 'testpoint', label || id, '', { externalPort: true });
  }
  function template(id, family, name, pages, components, circuits, options) {
    const record = Object.assign({
      schema: SCHEMA, id, family, name, lifecycle: OBSERVED,
      sourceRefs: Object.freeze([{ sourceId: 'SRC-COMPARISON-DOCX', pages: Object.freeze(pages.slice()) }]),
      components: Object.freeze(components), circuits: Object.freeze(circuits),
      automaticSelectionAllowed: false, fixedValuesApproved: false,
      projectChecks: Object.freeze([
        '器件额定值与最坏情况容差', '隔离电压/爬电距离/电气间隙', '故障安全默认状态',
        '阈值与时序计算', 'EMC和温升试验', '适用标准版本与认证'
      ])
    }, options || {});
    return Object.freeze(record);
  }

  const TEMPLATES = Object.freeze({
    'CP-GEN-OPAMP-CLAMP': template('CP-GEN-OPAMP-CLAMP', 'cp_gen', '运放闭环与双电源钳位 CP 发生', [64, 65], [
      endpointComponent('PWM_IN', 'PWM_IN'), endpointComponent('CP_OUT', 'CP_OUT'),
      endpointComponent('P12', '+12V'), endpointComponent('N12', '-12V'), endpointComponent('GND', 'GND'),
      component('RIN', 'resistor', 'RIN', 'PROJECT_VALUE'), component('RFB', 'resistor', 'RFB', 'PROJECT_VALUE'),
      component('U1', 'opamp', 'U1A', 'RAIL_TO_RAIL_REVIEW', { pinMap: pinMap({ OUT: '1', '-': '2', '+': '3', 'V-': '4', 'V+': '8' }) }),
      component('DHI', 'diode', 'DHI', 'FAST_DIODE'), component('DLO', 'diode', 'DLO', 'FAST_DIODE'),
      component('TVS1', 'tvs', 'TVS1', 'BIDIRECTIONAL_TVS_PROJECT_VALUE'), component('COUT', 'capacitor', 'COUT', 'PROJECT_VALUE')
    ], [
      circuit('W01', 'PWM_RAW', 'PWM_IN:1', 'RIN:1', 'SIGNAL_DIGITAL'),
      circuit('W02', 'PWM_CONDITIONED', 'RIN:2', 'U1:+'),
      circuit('W03', 'CP_DRIVE', 'U1:OUT', 'CP_OUT:1'),
      circuit('W04', 'CP_FEEDBACK_A', 'U1:OUT', 'RFB:1'),
      circuit('W05', 'CP_FEEDBACK_B', 'RFB:2', 'U1:-'),
      circuit('W06', 'CP_HIGH_CLAMP_A', 'U1:OUT', 'DHI:A'),
      circuit('W07', 'CP_HIGH_CLAMP_B', 'DHI:K', 'P12:1', 'POWER_DC_AUX'),
      circuit('W08', 'CP_LOW_CLAMP_A', 'N12:1', 'DLO:A', 'POWER_DC_AUX'),
      circuit('W09', 'CP_LOW_CLAMP_B', 'DLO:K', 'U1:OUT'),
      circuit('W10', 'CP_TVS_A', 'U1:OUT', 'TVS1:A'),
      circuit('W11', 'CP_TVS_B', 'TVS1:K', 'GND:1'),
      circuit('W12', 'CP_FILTER_A', 'U1:OUT', 'COUT:1'),
      circuit('W13', 'CP_FILTER_B', 'COUT:2', 'GND:1'),
      circuit('W14', 'U1_POS_SUPPLY', 'P12:1', 'U1:V+', 'POWER_DC_AUX'),
      circuit('W15', 'U1_NEG_SUPPLY', 'N12:1', 'U1:V-', 'POWER_DC_AUX')
    ], { externalPorts: Object.freeze(['PWM_IN:1', 'CP_OUT:1', 'P12:1', 'N12:1', 'GND:1']) }),

    'CP-MONITOR-FOLLOWER-DIVIDER': template('CP-MONITOR-FOLLOWER-DIVIDER', 'cp_det', '高阻跟随、线性分压与 ADC 保护', [66, 68], [
      endpointComponent('CP_IN', 'CP_IN'), endpointComponent('ADC_OUT', 'ADC_OUT'), endpointComponent('VCC', 'VCC'), endpointComponent('GND', 'GND'),
      component('RIN', 'resistor', 'RIN', 'PROJECT_VALUE'), component('U1', 'opamp', 'U1A', 'INPUT_RANGE_REVIEW'),
      component('RTOP', 'resistor', 'RTOP', 'PROJECT_VALUE'), component('RBOT', 'resistor', 'RBOT', 'PROJECT_VALUE'),
      component('CFLT', 'capacitor', 'CFLT', 'PROJECT_VALUE'), component('DCLAMP', 'zener', 'DCLAMP', 'ADC_CLAMP_REVIEW')
    ], [
      circuit('W01', 'CP_RAW_A', 'CP_IN:1', 'RIN:1'), circuit('W02', 'CP_RAW_B', 'RIN:2', 'U1:+'),
      circuit('W03', 'FOLLOWER_FB', 'U1:OUT', 'U1:-'), circuit('W04', 'DIVIDER_TOP_A', 'U1:OUT', 'RTOP:1'),
      circuit('W05', 'ADC_NODE_A', 'RTOP:2', 'ADC_OUT:1'), circuit('W06', 'ADC_NODE_B', 'ADC_OUT:1', 'RBOT:1'),
      circuit('W07', 'ADC_RETURN', 'RBOT:2', 'GND:1'), circuit('W08', 'ADC_FILTER_A', 'ADC_OUT:1', 'CFLT:1'),
      circuit('W09', 'ADC_FILTER_B', 'CFLT:2', 'GND:1'), circuit('W10', 'ADC_CLAMP_A', 'ADC_OUT:1', 'DCLAMP:A'),
      circuit('W11', 'ADC_CLAMP_B', 'DCLAMP:K', 'VCC:1'), circuit('W12', 'U1_SUPPLY_POS', 'VCC:1', 'U1:V+', 'POWER_DC_AUX'),
      circuit('W13', 'U1_SUPPLY_RET', 'GND:1', 'U1:V-', 'POWER_DC_AUX')
    ], { externalPorts: Object.freeze(['CP_IN:1', 'ADC_OUT:1', 'VCC:1', 'GND:1']) }),

    'DIODE-DETECT-DUAL-OPAMP': template('DIODE-DETECT-DUAL-OPAMP', 'diode_det', '双运放整流压差与迟滞判决', [62, 63], [
      endpointComponent('CP_IN', 'CP_IN'), endpointComponent('MCU_OUT', 'MCU_DIODE_CHK'),
      endpointComponent('VREF', 'VREF'), endpointComponent('VCC', 'VCC'), endpointComponent('GND', 'GND'),
      component('RIN', 'resistor', 'RIN', 'PROJECT_VALUE'), component('U1A', 'opamp', 'U1A', 'BUFFER'),
      component('D1', 'diode', 'D1', 'FAST_DIODE'), component('CPEAK', 'capacitor', 'CPEAK', 'PROJECT_VALUE'),
      component('RDIS', 'resistor', 'RDIS', 'PROJECT_VALUE'), component('U1B', 'comparator', 'U1B', 'HYSTERESIS_REQUIRED'),
      component('RHYS', 'resistor', 'RHYS', 'PROJECT_VALUE'), component('RPULL', 'resistor', 'RPULL', 'PROJECT_VALUE')
    ], [
      circuit('W01', 'CP_RAW_A', 'CP_IN:1', 'RIN:1'), circuit('W02', 'CP_RAW_B', 'RIN:2', 'U1A:+'),
      circuit('W03', 'BUFFER_FB', 'U1A:OUT', 'U1A:-'), circuit('W04', 'RECTIFY_A', 'U1A:OUT', 'D1:A'),
      circuit('W05', 'PEAK_NODE_A', 'D1:K', 'CPEAK:1'), circuit('W06', 'PEAK_NODE_B', 'D1:K', 'RDIS:1'),
      circuit('W07', 'PEAK_SENSE', 'D1:K', 'U1B:+'), circuit('W08', 'PEAK_RETURN_C', 'CPEAK:2', 'GND:1'),
      circuit('W09', 'PEAK_RETURN_R', 'RDIS:2', 'GND:1'), circuit('W10', 'THRESHOLD', 'VREF:1', 'U1B:-'),
      circuit('W11', 'DECISION', 'U1B:OUT', 'MCU_OUT:1', 'SIGNAL_DIGITAL'),
      circuit('W12', 'HYSTERESIS_A', 'U1B:OUT', 'RHYS:1'), circuit('W13', 'HYSTERESIS_B', 'RHYS:2', 'U1B:+'),
      circuit('W14', 'OUTPUT_PULL_A', 'VCC:1', 'RPULL:1', 'POWER_DC_AUX'),
      circuit('W15', 'OUTPUT_PULL_B', 'RPULL:2', 'U1B:OUT', 'SIGNAL_DIGITAL'),
      circuit('W16', 'U1A_SUPPLY_POS', 'VCC:1', 'U1A:V+', 'POWER_DC_AUX'),
      circuit('W17', 'U1A_SUPPLY_RET', 'GND:1', 'U1A:V-', 'POWER_DC_AUX'),
      circuit('W18', 'U1B_SUPPLY_POS', 'VCC:1', 'U1B:V+', 'POWER_DC_AUX'),
      circuit('W19', 'U1B_SUPPLY_RET', 'GND:1', 'U1B:V-', 'POWER_DC_AUX')
    ], { externalPorts: Object.freeze(['CP_IN:1', 'MCU_OUT:1', 'VREF:1', 'VCC:1', 'GND:1']) }),

    'PRECHECK-DUAL-RELAY-OPTO': template('PRECHECK-DUAL-RELAY-OPTO', 'sc_det', '双继电器受控测试支路与隔离光耦', [68, 72], [
      endpointComponent('L_OUT', 'L_OUT'), endpointComponent('N_OUT', 'N_OUT'), endpointComponent('TEST_POS', 'TEST_POS'),
      endpointComponent('TEST_RET', 'TEST_RET'), endpointComponent('MCU_OUT', 'MCU_PRECHECK'),
      endpointComponent('VCC', 'VCC'), endpointComponent('GND', 'GND'),
      component('K1', 'relay-contact-no', 'K1.1', 'TEST_ENABLE_L'), component('K2', 'relay-contact-no', 'K2.1', 'TEST_ENABLE_N'),
      component('RLIM', 'resistor', 'RLIM', 'FAULT_ENERGY_LIMIT_REQUIRED'), component('D1', 'diode', 'D1', 'POLARITY_PROTECTION'),
      component('U1', 'optocoupler', 'U1', 'ISOLATION_RATING_REQUIRED'), component('RPULL', 'resistor', 'RPULL', 'PROJECT_VALUE')
    ], [
      circuit('W01', 'TEST_SOURCE_A', 'TEST_POS:1', 'K1:COM', 'POWER_TEST'),
      circuit('W02', 'TEST_SOURCE_B', 'K1:NO', 'RLIM:1', 'POWER_TEST'),
      circuit('W03', 'TEST_INJECT', 'RLIM:2', 'L_OUT:1', 'POWER_TEST'),
      circuit('W04', 'TEST_RETURN_A', 'N_OUT:1', 'K2:COM', 'POWER_TEST'),
      circuit('W05', 'TEST_RETURN_B', 'K2:NO', 'D1:A', 'POWER_TEST'),
      circuit('W06', 'OPTO_LED_A', 'D1:K', 'U1:A', 'POWER_TEST'),
      circuit('W07', 'OPTO_LED_B', 'U1:K', 'TEST_RET:1', 'POWER_TEST'),
      circuit('W08', 'MCU_PULL_A', 'VCC:1', 'RPULL:1', 'POWER_DC_AUX'),
      circuit('W09', 'MCU_PULL_B', 'RPULL:2', 'U1:C', 'SIGNAL_DIGITAL'),
      circuit('W10', 'MCU_SENSE', 'U1:C', 'MCU_OUT:1', 'SIGNAL_DIGITAL'),
      circuit('W11', 'MCU_RETURN', 'U1:E', 'GND:1', 'POWER_DC_AUX')
    ], {
      externalPorts: Object.freeze(['L_OUT:1', 'N_OUT:1', 'TEST_POS:1', 'TEST_RET:1', 'MCU_OUT:1', 'VCC:1', 'GND:1']),
      safetyInvariant: '主功率接触器保持断开；仅限流测试支路可受控闭合，退出后必须证明测试支路开路。'
    }),

    'PE-HIGH-OHM-SENSE': template('PE-HIGH-OHM-SENSE', 'gnd_det', '高阻链、钳位与晶体管数字判决', [72, 74], [
      endpointComponent('HV_IN', 'HV/PE_TEST_IN'), endpointComponent('MCU_OUT', 'PE_CHK'), endpointComponent('VCC', 'VCC'), endpointComponent('GND', 'GND'),
      component('R1', 'resistor', 'R1', 'HV_SERIES'), component('R2', 'resistor', 'R2', 'HV_SERIES'),
      component('R3', 'resistor', 'R3', 'HV_SERIES'), component('R4', 'resistor', 'R4', 'HV_SERIES'),
      component('RBIAS', 'resistor', 'RBIAS', 'PROJECT_VALUE'), component('C1', 'capacitor', 'C1', 'PROJECT_VALUE'),
      component('DHI', 'zener', 'DHI', 'INPUT_CLAMP'), component('DLO', 'diode', 'DLO', 'INPUT_CLAMP'),
      component('Q1', 'bjt-npn', 'Q1', '2N3904_CLASS'), component('RPULL', 'resistor', 'RPULL', 'PROJECT_VALUE')
    ], [
      circuit('W01', 'HV_CHAIN_1', 'HV_IN:1', 'R1:1', 'SENSE_HV'), circuit('W02', 'HV_CHAIN_2', 'R1:2', 'R2:1', 'SENSE_HV'),
      circuit('W03', 'HV_CHAIN_3', 'R2:2', 'R3:1', 'SENSE_HV'), circuit('W04', 'HV_CHAIN_4', 'R3:2', 'R4:1', 'SENSE_HV'),
      circuit('W05', 'SENSE_NODE_A', 'R4:2', 'Q1:B'), circuit('W06', 'SENSE_BIAS_A', 'R4:2', 'RBIAS:1'),
      circuit('W07', 'SENSE_BIAS_B', 'RBIAS:2', 'GND:1'), circuit('W08', 'SENSE_FILTER_A', 'R4:2', 'C1:1'),
      circuit('W09', 'SENSE_FILTER_B', 'C1:2', 'GND:1'), circuit('W10', 'CLAMP_HIGH_A', 'R4:2', 'DHI:A'),
      circuit('W11', 'CLAMP_HIGH_B', 'DHI:K', 'VCC:1'), circuit('W12', 'CLAMP_LOW_A', 'GND:1', 'DLO:A'),
      circuit('W13', 'CLAMP_LOW_B', 'DLO:K', 'R4:2'), circuit('W14', 'Q_RETURN', 'Q1:E', 'GND:1'),
      circuit('W15', 'Q_OUTPUT', 'Q1:C', 'MCU_OUT:1', 'SIGNAL_DIGITAL'),
      circuit('W16', 'Q_PULL_A', 'VCC:1', 'RPULL:1', 'POWER_DC_AUX'), circuit('W17', 'Q_PULL_B', 'RPULL:2', 'Q1:C', 'SIGNAL_DIGITAL')
    ], {
      externalPorts: Object.freeze(['HV_IN:1', 'MCU_OUT:1', 'VCC:1', 'GND:1']),
      warning: '只能作为项目特定检测前端；不得替代经认证的 PE 连续性测试、RCM/RCD 或 IMD。'
    }),

    'WELD-BRIDGE-OPTO': template('WELD-BRIDGE-OPTO', 'adh_det', '接触器下游整流桥与光耦状态检测', [77, 79], [
      endpointComponent('L_OUT', 'L_OUT'), endpointComponent('N_OUT', 'N_OUT'), endpointComponent('MCU_OUT', 'WELD_CHK'),
      endpointComponent('VCC', 'VCC'), endpointComponent('GND', 'GND'),
      component('RL', 'resistor', 'RL', 'HV_SERIES'), component('RN', 'resistor', 'RN', 'HV_SERIES'),
      component('BR1', 'bridge-rectifier', 'BR1', 'VOLTAGE_RATING_REQUIRED'),
      component('RLED', 'resistor', 'RLED', 'LED_CURRENT_LIMIT'), component('U1', 'optocoupler', 'U1', 'ISOLATION_RATING_REQUIRED'),
      component('CFLT', 'capacitor', 'CFLT', 'PROJECT_VALUE'), component('RPULL', 'resistor', 'RPULL', 'PROJECT_VALUE')
    ], [
      circuit('W01', 'WELD_L_A', 'L_OUT:1', 'RL:1', 'SENSE_HV'), circuit('W02', 'WELD_L_B', 'RL:2', 'BR1:AC1', 'SENSE_HV'),
      circuit('W03', 'WELD_N_A', 'N_OUT:1', 'RN:1', 'SENSE_HV'), circuit('W04', 'WELD_N_B', 'RN:2', 'BR1:AC2', 'SENSE_HV'),
      circuit('W05', 'RECTIFIED_A', 'BR1:+', 'RLED:1', 'SENSE_RECTIFIED'),
      circuit('W06', 'RECTIFIED_B', 'RLED:2', 'U1:A', 'SENSE_RECTIFIED'),
      circuit('W07', 'RECTIFIED_RETURN', 'U1:K', 'BR1:-', 'SENSE_RECTIFIED'),
      circuit('W08', 'FILTER_A', 'BR1:+', 'CFLT:1', 'SENSE_RECTIFIED'), circuit('W09', 'FILTER_B', 'CFLT:2', 'BR1:-', 'SENSE_RECTIFIED'),
      circuit('W10', 'LOGIC_PULL_A', 'VCC:1', 'RPULL:1', 'POWER_DC_AUX'),
      circuit('W11', 'LOGIC_PULL_B', 'RPULL:2', 'U1:C', 'SIGNAL_DIGITAL'),
      circuit('W12', 'LOGIC_SENSE', 'U1:C', 'MCU_OUT:1', 'SIGNAL_DIGITAL'),
      circuit('W13', 'LOGIC_RETURN', 'U1:E', 'GND:1', 'POWER_DC_AUX')
    ], {
      externalPorts: Object.freeze(['L_OUT:1', 'N_OUT:1', 'MCU_OUT:1', 'VCC:1', 'GND:1']),
      safetyInvariant: '检测在主接触器断开命令后执行；多极接触器应逐极证明反馈覆盖，不得以单路合并结果代替。'
    }),

    'AUX-PSU-EMI-RECTIFIER': template('AUX-PSU-EMI-RECTIFIER', 'psu', '交流输入浪涌/EMI/整流前端', [39, 61], [
      endpointComponent('L_IN', 'L_IN'), endpointComponent('N_IN', 'N_IN'), endpointComponent('PE', 'PE'),
      endpointComponent('HV_POS', 'HV+'), endpointComponent('HV_NEG', 'HV-'),
      component('F1', 'fuse', 'F1', 'PROJECT_VALUE'), component('NTC1', 'ntc', 'NTC1', 'PROJECT_VALUE'),
      component('MOV1', 'mov', 'MOV1', 'PROJECT_VALUE'), component('GDT1', 'gdt', 'GDT1', 'PROJECT_VALUE'),
      component('CX1', 'capacitor', 'CX1', 'X_CLASS_REQUIRED'),
      component('CYL', 'capacitor', 'CYL', 'Y_CLASS_REQUIRED_IF_FITTED', {
        assemblyMode: 'CONDITIONAL_DNI_BY_DEFAULT', fittedByDefault: false,
        closureRequirements: Object.freeze(['LEAKAGE_CURRENT_BUDGET_APPROVED', 'EMC_TEST_PASSED', 'EARTHING_SYSTEM_CONFIRMED'])
      }),
      component('CYN', 'capacitor', 'CYN', 'Y_CLASS_REQUIRED_IF_FITTED', {
        assemblyMode: 'CONDITIONAL_DNI_BY_DEFAULT', fittedByDefault: false,
        closureRequirements: Object.freeze(['LEAKAGE_CURRENT_BUDGET_APPROVED', 'EMC_TEST_PASSED', 'EARTHING_SYSTEM_CONFIRMED'])
      }), component('LCM1', 'common-mode-choke', 'LCM1', 'PROJECT_VALUE'),
      component('BR1', 'bridge-rectifier', 'BR1', 'PROJECT_VALUE'), component('CBULK', 'polarized-capacitor', 'CBULK', 'VOLTAGE_MARGIN_REQUIRED')
    ], [
      circuit('W01', 'LINE_FUSED_A', 'L_IN:1', 'F1:1', 'POWER_AC'), circuit('W02', 'LINE_FUSED_B', 'F1:2', 'NTC1:1', 'POWER_AC'),
      circuit('W03', 'LINE_PROTECTED', 'NTC1:2', 'LCM1:L_IN', 'POWER_AC'), circuit('W04', 'NEUTRAL_IN', 'N_IN:1', 'LCM1:N_IN', 'POWER_AC'),
      circuit('W05', 'MOV_LINE', 'NTC1:2', 'MOV1:1', 'SURGE'), circuit('W06', 'MOV_NEUTRAL', 'MOV1:2', 'N_IN:1', 'SURGE'),
      circuit('W07', 'GDT_LINE', 'NTC1:2', 'GDT1:1', 'SURGE'), circuit('W08', 'GDT_PE', 'GDT1:2', 'PE:1', 'PROTECTIVE_EARTH'),
      circuit('W09', 'XCAP_LINE', 'NTC1:2', 'CX1:1', 'EMI'), circuit('W10', 'XCAP_NEUTRAL', 'CX1:2', 'N_IN:1', 'EMI'),
      circuit('W11', 'YCAP_LINE', 'LCM1:L_OUT', 'CYL:1', 'EMI'), circuit('W12', 'YCAP_LINE_PE', 'CYL:2', 'PE:1', 'PROTECTIVE_EARTH'),
      circuit('W13', 'YCAP_NEUTRAL', 'LCM1:N_OUT', 'CYN:1', 'EMI'), circuit('W14', 'YCAP_NEUTRAL_PE', 'CYN:2', 'PE:1', 'PROTECTIVE_EARTH'),
      circuit('W15', 'RECTIFIER_AC1', 'LCM1:L_OUT', 'BR1:AC1', 'POWER_AC'), circuit('W16', 'RECTIFIER_AC2', 'LCM1:N_OUT', 'BR1:AC2', 'POWER_AC'),
      circuit('W17', 'DC_BUS_POS_A', 'BR1:+', 'HV_POS:1', 'POWER_DC'), circuit('W18', 'DC_BUS_NEG_A', 'BR1:-', 'HV_NEG:1', 'POWER_DC'),
      circuit('W19', 'BULK_POS', 'BR1:+', 'CBULK:+', 'POWER_DC'), circuit('W20', 'BULK_NEG', 'CBULK:-', 'BR1:-', 'POWER_DC')
    ], {
      externalPorts: Object.freeze(['L_IN:1', 'N_IN:1', 'PE:1', 'HV_POS:1', 'HV_NEG:1']),
      note: 'Y电容是否装配及容值必须由泄漏电流预算、接地型式和EMC试验共同决定，不能仅凭截图强制。'
    })
  });

  const VARIANTS = Object.freeze({
    psu: Object.freeze([
      { id: 'self-osc-multi', name: '自激式多路输出', pages: [59, 60], detailTemplateId: null },
      { id: 'flyback-iso', name: '隔离反激', pages: [60, 60], detailTemplateId: 'AUX-PSU-EMI-RECTIFIER' },
      { id: 'flyback-combo', name: '组合反激', pages: [60, 61], detailTemplateId: 'AUX-PSU-EMI-RECTIFIER' },
      { id: 'dual-flyback', name: '双路独立反激', pages: [61, 61], detailTemplateId: 'AUX-PSU-EMI-RECTIFIER' },
      { id: 'integrated-flyback', name: '集成反激', pages: [61, 62], detailTemplateId: 'AUX-PSU-EMI-RECTIFIER' }
    ]),
    diode_det: Object.freeze([
      { id: 'dual-opamp-hysteresis', name: '双运放精密整流与迟滞', pages: [62, 63], detailTemplateId: 'DIODE-DETECT-DUAL-OPAMP' },
      { id: 'single-opamp-clamp', name: '单运放开环放大与钳位', pages: [63, 63], detailTemplateId: null },
      { id: 'bjt-level-shift', name: '三极管开关电平转换', pages: [63, 64], detailTemplateId: null }
    ]),
    cp_gen: Object.freeze([
      { id: 'opamp-diode-clamp', name: '运放与二极管钳位', pages: [64, 65], detailTemplateId: 'CP-GEN-OPAMP-CLAMP' },
      { id: 'bjt-pushpull-lc', name: '三极管推挽与LC滤波', pages: [65, 65], detailTemplateId: null },
      { id: 'opamp-totem', name: '运放与三极管图腾柱', pages: [65, 66], detailTemplateId: null },
      { id: 'opamp-pushpull', name: '运放与多管推挽扩流', pages: [66, 66], detailTemplateId: null }
    ]),
    cp_det: Object.freeze([
      { id: 'follower-peak', name: '跟随与二极管峰值检测', pages: [66, 67], detailTemplateId: null },
      { id: 'follower-divider', name: '跟随与线性分压采样', pages: [67, 67], detailTemplateId: 'CP-MONITOR-FOLLOWER-DIVIDER' },
      { id: 'comparator-threshold', name: '比较器基准阈值检测', pages: [67, 68], detailTemplateId: null },
      { id: 'follower-condition', name: '跟随与二极管信号调理', pages: [68, 68], detailTemplateId: null }
    ]),
    sc_det: Object.freeze([
      { id: 'opto-direct', name: '限流与光耦检测', pages: [68, 69], detailTemplateId: null },
      { id: 'dual-relay-opto', name: '双继电器投切与隔离光耦', pages: [69, 70], detailTemplateId: 'PRECHECK-DUAL-RELAY-OPTO' },
      { id: 'bjt-opto', name: '三极管驱动与光耦', pages: [70, 70], detailTemplateId: null },
      { id: 'bridge-opto', name: '整流桥与光耦', pages: [70, 71], detailTemplateId: null },
      { id: 'diff-opto', name: '差分测量与隔离', pages: [71, 71], detailTemplateId: null },
      { id: 'relay-opto', name: '继电器与光耦组合', pages: [71, 72], detailTemplateId: null }
    ]),
    gnd_det: Object.freeze([
      { id: 'divider-leak', name: '高阻分压检测', pages: [72, 74], detailTemplateId: 'PE-HIGH-OHM-SENSE' },
      { id: 'rc-couple', name: '阻容耦合检测', pages: [73, 74], detailTemplateId: null },
      { id: 'diff-amp-iso', name: '隔离差分测量', pages: [74, 74], detailTemplateId: null },
      { id: 'single-opamp-iso', name: '简化缓冲隔离', pages: [74, 75], detailTemplateId: null },
      { id: 'diode-clamp-hw', name: '硬件钳位保护', pages: [75, 75], detailTemplateId: null }
    ]),
    adh_det: Object.freeze([
      { id: 'divider-tvs', name: '高阻分压与TVS', pages: [75, 76], detailTemplateId: null },
      { id: 'rc-tvs', name: '阻容耦合与TVS', pages: [76, 77], detailTemplateId: null },
      { id: 'opto-cond', name: '光耦导通检测', pages: [77, 77], detailTemplateId: null },
      { id: 'relay-opto', name: '继电器与光耦交叉检测', pages: [77, 78], detailTemplateId: null },
      { id: 'bridge-opto', name: '整流桥与光耦检测', pages: [78, 79], detailTemplateId: 'WELD-BRIDGE-OPTO' }
    ])
  });

  function splitEndpoint(value) {
    const text = String(value || ''); const index = text.lastIndexOf(':');
    return index > 0 ? { componentId: text.slice(0, index), pinId: text.slice(index + 1) } : null;
  }
  function componentPins(item) {
    const definition = SYMBOLS && SYMBOLS.resolve(item.symbolId);
    const pins = definition ? definition.pins : [];
    return new Set(pins.map((pin) => pin.id));
  }
  function validateTemplate(value) {
    const errors = []; const warnings = []; const componentById = new Map(); const circuitIds = new Set();
    const connectedPins = new Map();
    (value.components || []).forEach((item) => {
      if (componentById.has(item.id)) errors.push({ code: 'DUPLICATE_COMPONENT', componentId: item.id });
      componentById.set(item.id, item);
      const definition = SYMBOLS && SYMBOLS.resolve(item.symbolId);
      if (!definition) errors.push({ code: 'UNKNOWN_SYMBOL', componentId: item.id, symbolId: item.symbolId });
      const mapping = item.pinMap || {}; const known = new Set(definition ? definition.pins.map((port) => port.id) : []);
      const optional = new Set((item.optionalLogicalPins || []).map(String));
      const nc = new Set((item.ncLogicalPins || []).map(String));
      optional.forEach((logical) => {
        if (!known.has(logical)) errors.push({ code: 'OPTIONAL_UNKNOWN_LOGICAL_PIN', componentId: item.id, logical });
      });
      nc.forEach((logical) => {
        if (!known.has(logical)) errors.push({ code: 'NC_UNKNOWN_LOGICAL_PIN', componentId: item.id, logical });
        if (optional.has(logical)) errors.push({ code: 'PIN_BOTH_OPTIONAL_AND_NC', componentId: item.id, logical });
      });
      const physical = new Set();
      Object.keys(mapping).forEach((logical) => {
        const number = String(mapping[logical] == null ? '' : mapping[logical]).trim();
        if (!known.has(logical)) errors.push({ code: 'PIN_MAP_UNKNOWN_LOGICAL_PIN', componentId: item.id, logical });
        if (!number) errors.push({ code: 'PIN_MAP_EMPTY_PHYSICAL_PIN', componentId: item.id, logical });
        if (number && physical.has(number)) errors.push({ code: 'PIN_MAP_DUPLICATE_PHYSICAL_PIN', componentId: item.id, physicalPin: number });
        physical.add(number);
      });
      if (!Object.keys(mapping).length && definition && definition.pins.length > 2 && !item.externalPort) {
        warnings.push({ code: 'PACKAGE_PIN_MAP_REQUIRED', componentId: item.id, symbolId: item.symbolId });
      }
    });
    (value.circuits || []).forEach((item) => {
      if (circuitIds.has(item.id)) errors.push({ code: 'DUPLICATE_CIRCUIT', circuitId: item.id });
      circuitIds.add(item.id);
      ['from', 'to'].forEach((side) => {
        const endpoint = splitEndpoint(item[side]);
        if (!endpoint) { errors.push({ code: 'INVALID_ENDPOINT', circuitId: item.id, side, value: item[side] }); return; }
        const owner = componentById.get(endpoint.componentId);
        if (!owner) { errors.push({ code: 'UNKNOWN_COMPONENT_ENDPOINT', circuitId: item.id, side, endpoint: item[side] }); return; }
        if (!componentPins(owner).has(endpoint.pinId)) errors.push({ code: 'UNKNOWN_PIN_ENDPOINT', circuitId: item.id, side, endpoint: item[side] });
        if (!connectedPins.has(owner.id)) connectedPins.set(owner.id, new Set());
        connectedPins.get(owner.id).add(endpoint.pinId);
      });
      if (item.from === item.to) errors.push({ code: 'SELF_CONNECTION', circuitId: item.id });
    });
    const physicalPinIssues = [];
    (value.components || []).forEach((item) => {
      const definition = SYMBOLS && SYMBOLS.resolve(item.symbolId);
      if (!definition) return;
      const connected = connectedPins.get(item.id) || new Set();
      const optional = new Set((item.optionalLogicalPins || []).map(String));
      const nc = new Set((item.ncLogicalPins || []).map(String));
      definition.pins.forEach((port) => {
        if (!optional.has(port.id) && !nc.has(port.id) && !connected.has(port.id)) {
          errors.push({ code: 'REQUIRED_LOGICAL_PIN_UNCONNECTED', componentId: item.id, logical: port.id });
        }
        if (nc.has(port.id) && connected.has(port.id)) {
          errors.push({ code: 'NC_LOGICAL_PIN_CONNECTED', componentId: item.id, logical: port.id });
        }
      });
      if (!item.externalPort) {
        const mapping = item.pinMap || {};
        const missing = definition.pins.filter((port) => !optional.has(port.id) && !nc.has(port.id) && !String(mapping[port.id] || '').trim())
          .map((port) => port.id);
        if (missing.length) physicalPinIssues.push(Object.freeze({ componentId: item.id, missingLogicalPins: Object.freeze(missing) }));
      }
    });
    return Object.freeze({
      ok: errors.length === 0,
      errors: Object.freeze(errors), warnings: Object.freeze(warnings),
      requiredLogicalPinsConnected: !errors.some((item) => item.code === 'REQUIRED_LOGICAL_PIN_UNCONNECTED' || item.code === 'NC_LOGICAL_PIN_CONNECTED'),
      physicalPinMapComplete: physicalPinIssues.length === 0,
      physicalPinIssues: Object.freeze(physicalPinIssues)
    });
  }

  function auditSymbolGeometry(value) {
    const issues = [];
    (value && value.components || []).forEach((item) => {
      const definition = SYMBOLS && SYMBOLS.resolve(item.symbolId);
      if (!definition) { issues.push({ componentId: item.id, code: 'UNKNOWN_SYMBOL' }); return; }
      if (!SYMBOLS.instantiate || !SYMBOLS.auditPinGeometry) {
        issues.push({ componentId: item.id, code: 'SYMBOL_GEOMETRY_AUDITOR_UNAVAILABLE' }); return;
      }
      const audit = SYMBOLS.auditPinGeometry(SYMBOLS.instantiate({ symbolId: item.symbolId, x: 0, y: 0, width: 100, height: 70 }));
      if (!audit.ok) issues.push({ componentId: item.id, code: 'DETACHED_SYMBOL_PIN', detail: audit });
    });
    return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
  }
  function validateAll() {
    const results = Object.keys(TEMPLATES).sort().map((id) => ({ id, result: validateTemplate(TEMPLATES[id]) }));
    return Object.freeze({ ok: results.every((item) => item.result.ok), results: Object.freeze(results) });
  }
  function findTemplate(id) { return TEMPLATES[id] || null; }
  function family(id) { return VARIANTS[id] || Object.freeze([]); }
  function summary() {
    const detailCount = Object.keys(TEMPLATES).length;
    const variants = Object.keys(VARIANTS).reduce((sum, id) => sum + VARIANTS[id].length, 0);
    const circuits = Object.keys(TEMPLATES).reduce((sum, id) => sum + TEMPLATES[id].circuits.length, 0);
    return Object.freeze({ schema: 'EVSE-BOARD-CIRCUIT-LIBRARY-SUMMARY/1.0', version: VERSION,
      familyCount: Object.keys(VARIANTS).length, variantCount: variants, detailedTemplateCount: detailCount,
      explicitPointToPointCircuitCount: circuits, validation: validateAll() });
  }

  return Object.freeze({
    VERSION, SCHEMA, OBSERVED, ABSTRACT, TEMPLATES, VARIANTS,
    findTemplate, family, validateTemplate, validateAll, auditSymbolGeometry, summary,
    sourceSummary: EVIDENCE && EVIDENCE.summary ? EVIDENCE.summary() : null
  });
});
