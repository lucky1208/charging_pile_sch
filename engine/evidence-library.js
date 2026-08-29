/* ============================================================
 * User-project schematic evidence registry
 * ------------------------------------------------------------
 * Facts in this file are observations, not automatically approved design
 * choices.  Every record retains its source locator and lifecycle so that
 * the compiler never turns an unreadable screenshot or an engineering
 * opinion into a silent electrical rule.
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_EVIDENCE_LIBRARY = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.0.0';
  const STATUS = Object.freeze({
    OBSERVED: 'OBSERVED',
    INFERRED: 'INFERRED_REVIEW_REQUIRED',
    UNRESOLVED: 'UNRESOLVED',
    APPROVED: 'ENGINEER_APPROVED'
  });

  function freezeArray(values) {
    return Object.freeze((values || []).map((value) =>
      value && typeof value === 'object' ? Object.freeze(Object.assign({}, value)) : value));
  }

  const SOURCES = Object.freeze({
    'SRC-COMPARISON-DOCX': Object.freeze({
      id: 'SRC-COMPARISON-DOCX',
      title: '对比.docx',
      kind: 'USER_PROJECT_COMPARISON_AND_SCHEMATIC_EVIDENCE',
      sha256: 'F99678A250D165B760546F400B43C60F8F54C754D5C845A5B4EC12BF0C612D50',
      pageCount: 79,
      lifecycle: STATUS.OBSERVED,
      distribution: 'REFERENCE_ONLY_NOT_BUNDLED',
      note: '包含多家充电桩控制板电路截图、作者分析以及七类功能电路的横向比较。'
    }),
    'SRC-EU-PROJECT-SVG': Object.freeze({
      id: 'SRC-EU-PROJECT-SVG',
      title: '欧标充电桩电气原理图.svg',
      kind: 'USER_PROJECT_SYSTEM_SCHEMATIC',
      sha256: '12ECBE42F1102862FD543C0837CEE84EDFB03F132631AAADDD2B3725C6FBAC41',
      viewBox: '0 0 4526.4039 3485.1669',
      lifecycle: STATUS.OBSERVED,
      distribution: 'BUNDLED_REFERENCE'
    }),
    'SRC-GB60-PROJECT-SVG': Object.freeze({
      id: 'SRC-GB60-PROJECT-SVG',
      title: '国标60kW充电桩原理图.svg',
      kind: 'USER_PROJECT_SYSTEM_SCHEMATIC',
      sha256: 'BEF8ADE3D8463D39F93B7954584CCF26932E179FCEE8C50F0980D3B471544FE4',
      viewBox: '0 0 8988 6357.3335',
      lifecycle: STATUS.OBSERVED,
      distribution: 'BUNDLED_REFERENCE'
    })
  });

  const VENDOR_SECTIONS = freezeArray([
    { id: 'V-SZJN', name: '深圳佳诺', pages: [1, 15] },
    { id: 'V-APOOL', name: '爱普拉', pages: [15, 32] },
    { id: 'V-ZHIWEI', name: '智行微', pages: [33, 35] },
    { id: 'V-QINGDA', name: '擎达', pages: [36, 38] },
    { id: 'V-NETPOWER', name: '能通', pages: [39, 41] },
    { id: 'V-CHANGAN', name: '长安通用', pages: [42, 43] },
    { id: 'V-AMSTERDAM', name: '荷兰阿姆斯特丹', pages: [43, 46] },
    { id: 'V-BULL', name: '公牛', pages: [47, 50] },
    { id: 'V-PUNUODE', name: '普诺德', pages: [51, 53] },
    { id: 'V-WANBANG', name: '万邦', pages: [54, 56] },
    { id: 'V-WINLINE', name: '科大智能', pages: [56, 56] },
    { id: 'V-EN', name: 'EN科技', pages: [57, 57] },
    { id: 'V-XPENG', name: '小鹏', pages: [57, 59] }
  ].map((item) => Object.assign({ sourceId: 'SRC-COMPARISON-DOCX', status: STATUS.OBSERVED }, item)));

  const FUNCTIONAL_FAMILIES = freezeArray([
    { id: 'psu', name: '板级辅助电源', pages: [59, 62], observedVariantCount: 5 },
    { id: 'diode_det', name: '车辆二极管存在检测', pages: [62, 64], observedVariantCount: 3 },
    { id: 'cp_gen', name: 'CP 信号发生', pages: [64, 66], observedVariantCount: 4 },
    { id: 'cp_det', name: 'CP 信号检测', pages: [66, 68], observedVariantCount: 4 },
    { id: 'sc_det', name: '送电前输出回路预检', pages: [68, 72], observedVariantCount: 6,
      note: '文档展示七幅示例；按电气原理归并为六类，重复的继电器+光耦实现保留来源差异。' },
    { id: 'gnd_det', name: 'PE连续性/剩余电流/绝缘相关检测', pages: [72, 75], observedVariantCount: 5,
      note: '这不是一个可互换的单一安全功能；实现时必须拆分 PE continuity、RCM/RCD 与 IMD。' },
    { id: 'adh_det', name: '接触器状态/粘连检测', pages: [75, 79], observedVariantCount: 5,
      note: '文档展示六幅示例；按高阻、阻容、光耦、继电器+光耦、整流桥+光耦五类归并。' }
  ].map((item) => Object.assign({ sourceId: 'SRC-COMPARISON-DOCX', status: STATUS.OBSERVED }, item)));

  const SYMBOL_FAMILIES = freezeArray([
    ['resistor', '电阻'], ['capacitor', '无极性电容'], ['polarized-capacitor', '有极性电容'],
    ['inductor', '电感'], ['transformer', '变压器'], ['common-mode-choke', '共模扼流圈'],
    ['fuse', '熔断器'], ['ntc', 'NTC浪涌抑制器'], ['mov', '压敏电阻'], ['gdt', '气体放电管'],
    ['diode', '二极管'], ['zener', '稳压二极管'], ['tvs', 'TVS'], ['bridge-rectifier', '整流桥'],
    ['bjt-npn', 'NPN三极管'], ['bjt-pnp', 'PNP三极管'], ['mosfet-n', 'N沟道MOSFET'],
    ['mosfet-p', 'P沟道MOSFET'], ['opamp', '运算放大器'], ['comparator', '比较器'],
    ['optocoupler', '晶体管输出光耦'], ['relay-coil', '继电器线圈'], ['relay-contact-no', '继电器常开触点'],
    ['relay-contact-nc', '继电器常闭触点'], ['current-transformer', '电流互感器'], ['shunt', '分流器'],
    ['connector', '连接器'], ['testpoint', '测试点'], ['integrated-circuit', '集成电路']
  ].map((item) => ({
    id: item[0], name: item[1], sourceId: 'SRC-COMPARISON-DOCX', pages: [1, 79],
    status: STATUS.OBSERVED, extraction: 'VECTOR_RECONSTRUCTION_NOT_PIXEL_COPY'
  })));

  const CLAIMS = freezeArray([
    {
      id: 'OBS-PRECHECK-NO-MAIN-CLOSE', sourceId: 'SRC-COMPARISON-DOCX', pages: [36, 38],
      status: STATUS.OBSERVED, severity: 'CRITICAL',
      statement: '擎达示例的桥式整流+光耦检测需在主继电器闭合后采样，文档将此作为明显弱点。'
    },
    {
      id: 'OBS-400V-BULK-MARGIN', sourceId: 'SRC-COMPARISON-DOCX', pages: [39, 41],
      status: STATUS.OBSERVED, severity: 'MAJOR',
      statement: '能通示例使用400V母线电解且输入浪涌/差模保护较弱，文档认为电压裕量和抗浪涌能力不足。'
    },
    {
      id: 'OBS-EMI-Y-CAP-ABSENT', sourceId: 'SRC-COMPARISON-DOCX', pages: [56, 56],
      status: STATUS.OBSERVED, severity: 'REVIEW',
      statement: '科大智能示例未见Y电容，文档提出传导EMI风险；是否不合格仍须结合泄漏电流预算和EMC试验。'
    },
    {
      id: 'OBS-N-PE-ZERO-AMBIGUITY', sourceId: 'SRC-COMPARISON-DOCX', pages: [51, 53],
      status: STATUS.OBSERVED, severity: 'REVIEW',
      statement: '普诺德示例对N线粘连的判据受到正常N-PE近零电位影响，文档认为检测意义和判据不清。'
    },
    {
      id: 'OBS-SHARED-PRECHECK-WELD', sourceId: 'SRC-COMPARISON-DOCX', pages: [56, 56],
      status: STATUS.OBSERVED, severity: 'MAJOR',
      statement: '科大智能示例将短路检测与粘连检测合用一套电路，需要分析共同原因失效与诊断覆盖。'
    }
  ]);

  function source(id) { return SOURCES[id] || null; }
  function locator(sourceId, pages, detail) {
    return Object.freeze({ sourceId, pages: Object.freeze((pages || []).slice()), detail: String(detail || '') });
  }
  function verifySource(id, sha256) {
    const item = source(id);
    return !!item && String(item.sha256).toUpperCase() === String(sha256 || '').toUpperCase();
  }
  function summary() {
    return Object.freeze({
      schema: 'EVSE-EVIDENCE-SUMMARY/1.0', version: VERSION,
      sourceCount: Object.keys(SOURCES).length,
      vendorSectionCount: VENDOR_SECTIONS.length,
      functionalFamilyCount: FUNCTIONAL_FAMILIES.length,
      observedTopologyCount: FUNCTIONAL_FAMILIES.reduce((sum, item) => sum + item.observedVariantCount, 0),
      symbolFamilyCount: SYMBOL_FAMILIES.length,
      claimCount: CLAIMS.length
    });
  }

  return Object.freeze({
    VERSION, STATUS, SOURCES, VENDOR_SECTIONS, FUNCTIONAL_FAMILIES,
    SYMBOL_FAMILIES, CLAIMS, source, locator, verifySource, summary
  });
});
