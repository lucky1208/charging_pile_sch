/* ============================================================
 * EVSE control / diagnostic functional-unit knowledge v1
 * ------------------------------------------------------------
 * The topology taxonomy is now indexed to the user's 79-page comparison
 * document.  Seven representative circuits also have explicit component-
 * pin-to-component-pin graphs in EVSE_BOARD_CIRCUIT_LIBRARY.  Observation
 * still does not equal engineering approval: no board variant is selected
 * automatically and all values/thresholds remain project-controlled.
 *
 * Executable generation uses only the small controlContract() API.  It
 * states which functions must be represented at an EVSE output boundary;
 * it does not invent component values, thresholds, timing or compliance.
 * ============================================================ */
window.EVSE_FUNCTIONAL_UNIT_LIBRARY = (function () {
  'use strict';

  const VERSION = '2.0.0';
  const PRIMARY = window.EVSE_EVIDENCE_LIBRARY;
  const REFERENCES = window.EVSE_REFERENCE_SYSTEM_LIBRARY;
  const BOARD = window.EVSE_BOARD_CIRCUIT_LIBRARY;
  const SOURCE_STATUS = PRIMARY && REFERENCES && BOARD
    ? 'PRIMARY_USER_EVIDENCE_INDEXED—ENGINEER_APPROVAL_REQUIRED'
    : 'PRIMARY_EVIDENCE_LIBRARY_MISSING';
  const CANDIDATE = 'OBSERVED_CANDIDATE—ENGINEER_REVIEW_REQUIRED';

  function variant(id, name, path, benefit, risk, applicability) {
    return Object.freeze({
      id, name, path, benefit, risk,
      applicability: applicability || 'PROJECT_SPECIFIC',
      lifecycle: CANDIDATE,
      automaticSelectionAllowed: false,
      fixedValuesApproved: false
    });
  }

  const GROUPS = Object.freeze({
    psu: Object.freeze({
      id: 'psu', name: '板级辅助电源', executableMapping: 'SYSTEM_PSU_ALREADY_MODELLED—BOARD_TOPOLOGY_UNRESOLVED',
      variants: Object.freeze([
        variant('self-osc-multi', '自激式多路输出', 'AC→保护/EMI→自激变换→多路整流', '成本低', '稳压及交叉调整能力需验证'),
        variant('flyback-iso', '隔离反激', 'AC→保护/EMI→整流→隔离反激→多路稳压', '隔离边界清晰', '磁件、安规与反馈环路需专项设计'),
        variant('flyback-combo', '组合反激', 'AC→多级EMI→组合变压器→多路输出', '集成度较高', '多路负载交互需验证'),
        variant('dual-flyback', '双路独立反激', 'AC→两路隔离反激→强弱电分域', '域隔离清晰', '器件、损耗和面积增加'),
        variant('integrated-flyback', '集成反激', 'AC→EMI→集成反激器件→多路输出', '实现简洁', '器件能力与失效模式受芯片限制')
      ])
    }),
    diode_det: Object.freeze({
      id: 'diode_det', name: '车辆二极管存在检测', executableMapping: 'vehicle-diode-detector',
      variants: Object.freeze([
        variant('dual-opamp-hysteresis', '双运放滞回比较', 'CP取样→整流压差→滞回比较→控制器', '抗边界抖动', '阈值及容差必须计算'),
        variant('single-opamp-clamp', '单运放比较与钳位', 'CP取样→放大/比较→钳位→控制器', '器件较少', '噪声、轨到轨范围及钳位能量需验证'),
        variant('bjt-level-shift', '晶体管电平转换', 'CP取样→晶体管开关→逻辑电平', '结构简单', '温漂、离散性和失效诊断能力较弱')
      ])
    }),
    cp_gen: Object.freeze({
      id: 'cp_gen', name: 'CP 信号发生', executableMapping: 'control-pilot-generator',
      variants: Object.freeze([
        variant('opamp-diode-clamp', '运放与二极管钳位驱动', 'PWM→运放→钳位→CP', '结构直接', '带载、短路和长线波形需验证'),
        variant('bjt-pushpull-lc', '晶体管推挽与滤波', 'PWM→推挽级→滤波/保护→CP', '驱动能力较强', '器件匹配、交越与EMC需验证'),
        variant('opamp-totem', '运放与图腾柱', 'PWM→运放→图腾柱→CP', '输出阻抗较低', '交越失真和保护边界需验证'),
        variant('opamp-pushpull', '闭环运放与推挽扩流', 'PWM→闭环运放→推挽级→CP', '幅值与带载可协同设计', '环路稳定性和器件数量增加')
      ])
    }),
    cp_det: Object.freeze({
      id: 'cp_det', name: 'CP 信号检测', executableMapping: 'control-pilot-monitor',
      variants: Object.freeze([
        variant('follower-peak', '跟随与峰值检测', 'CP→缓冲→整流/保持→ADC', '软件处理较简单', '二极管压降与动态响应需校准'),
        variant('follower-divider', '跟随与线性分压采样', 'CP→高阻缓冲→分压→ADC', '保留幅值及占空比信息', '采样带宽、输入保护和标定要求较高'),
        variant('comparator-threshold', '比较器阈值检测', 'CP→比较器/基准→数字输入', '判决快', '阈值附近抖动及迟滞需设计'),
        variant('follower-condition', '跟随与信号调理', 'CP→缓冲→钳位/滤波→后级采样', '后级信号边界清晰', '链路延迟和容差需评估')
      ])
    }),
    sc_det: Object.freeze({
      id: 'sc_det', name: '送电前输出回路预检', executableMapping: 'output-precheck-monitor',
      variants: Object.freeze([
        variant('opto-direct', '限流与光耦检测', '输出端→受控限流→光耦→控制器', '结构简洁', '隔离等级、覆盖范围和默认状态需证明'),
        variant('dual-relay-opto', '双继电器投切与隔离光耦', '控制器→双继电器测试支路→隔离检测→结果', '测试支路可受控退出', '继电器失效、限流和时序必须分析'),
        variant('bjt-opto', '晶体管驱动与光耦', '控制器→驱动级→测试开关→光耦', '时序可控', '高压开关能力和共模边界需验证'),
        variant('bridge-opto', '整流桥与光耦', '输出端→整流桥→光耦→控制器', '可弱化极性依赖', '压降、功耗和交流/直流适用性不同'),
        variant('diff-opto', '差分测量与隔离', '输出端→差分前端→隔离→控制器', '共模抑制能力可设计', '隔离供电、输入范围和故障模式复杂'),
        variant('relay-opto', '继电器与光耦组合', '受控继电器→检测网络→光耦', '可按项目配置', '不得采用需要先合主接触器的危险变体')
      ])
    }),
    gnd_det: Object.freeze({
      id: 'gnd_det', name: '接地/绝缘检测候选', executableMapping: 'SPLIT_INTO_PE_CONTINUITY_RCM_AND_IMD',
      variants: Object.freeze([
        variant('divider-leak', '高阻分压检测', '带电导体→高阻分压→测量输入', '实现直接', '隔离、容差、功耗和爬电距离需验证'),
        variant('rc-couple', '阻容耦合检测', 'PE/带电导体→阻容耦合→测量', '可隔直', '频率依赖且必须标定'),
        variant('diff-amp-iso', '隔离差分测量', '导体对地→差分前端→隔离→ADC', '可获得连续测量量', '不得替代经认证的IMD/RCM'),
        variant('single-opamp-iso', '简化缓冲隔离', '检测输入→缓冲/隔离→ADC', '器件较少', '共模抑制和诊断覆盖较弱'),
        variant('diode-clamp-hw', '硬件钳位保护', '检测输入→限流/钳位→保护边界', '可提供输入保护', '仅保护而非绝缘测量功能')
      ])
    }),
    adh_det: Object.freeze({
      id: 'adh_det', name: '接触器粘连/状态检测', executableMapping: 'contactor-state-monitor',
      variants: Object.freeze([
        variant('divider-tvs', '高阻分压与钳位', '接触器下游→高阻分压/钳位→ADC', '成本较低', '无隔离方案不得自动批准'),
        variant('rc-tvs', '阻容耦合与钳位', '接触器下游→阻容耦合→钳位→ADC', '可用于定性检测', '频率/EMC依赖且覆盖范围有限'),
        variant('opto-cond', '光耦导通检测', '下游电位→限流→光耦→数字输入', '隔离边界直观', '单极粘连覆盖必须逐极证明'),
        variant('relay-opto', '辅助触点与光耦交叉检测', '受控辅助触点→隔离反馈→控制器', '可建立逐极状态反馈', '机械联动及诊断覆盖需要器件证据'),
        variant('bridge-opto', '整流桥与光耦检测', '交流下游→整流桥→光耦→控制器', '交流极性适应性较好', '交流专用且响应/频率特性需验证')
      ])
    })
  });

  function controlContract(options) {
    const o = options || {};
    const role = o.interfaceRole || 'CHARGING_OUTPUT';
    const cpCapable = o.cpCapable === true;
    const output = role === 'CHARGING_OUTPUT';
    const required = 'REQUIRED';
    const na = 'NOT_APPLICABLE';
    return Object.freeze({
      schema: 'EVSE-OUTPUT-CONTROL-CONTRACT/1.0',
      profileId: String(o.profileId || o.connectorType || 'UNSPECIFIED'),
      interfaceRole: role,
      lifecycle: 'APPROVED',
      evidenceStatus: 'FUNCTIONAL_REQUIREMENT—PROJECT_IMPLEMENTATION_REVIEW_REQUIRED',
      functions: Object.freeze({
        controlPilot: output && cpCapable ? required : na,
        pilotMonitor: output && cpCapable ? required : na,
        diodeCheck: output && cpCapable ? required : na,
        outputPrecheck: output ? required : na,
        weldDetection: output ? required : na
      }),
      evidenceRefs: Object.freeze((o.evidenceRefs || []).slice()),
      projectValues: Object.freeze({
        precheckThreshold: Object.freeze({ value: null, unit: 'V/A/Ω—PROJECT_DEFINED', status: 'PROJECT_VALUE_REQUIRED' }),
        precheckTimeoutMs: Object.freeze({ value: null, unit: 'ms', status: 'PROJECT_VALUE_REQUIRED' }),
        weldThreshold: Object.freeze({ value: null, unit: 'V', status: 'PROJECT_VALUE_REQUIRED' })
      })
    });
  }

  function describe(design) {
    const model = design || {};
    const instances = Array.isArray(model.instances) ? model.instances : [];
    const topology = model.topology || {};
    return {
      schema: 'EVSE-FUNCTIONAL-UNIT-KNOWLEDGE-SUMMARY/1.0',
      version: VERSION,
      sourceStatus: SOURCE_STATUS,
      evidenceSummary: PRIMARY && typeof PRIMARY.summary === 'function' ? PRIMARY.summary() : null,
      referenceSystemSummary: REFERENCES && typeof REFERENCES.summary === 'function' ? REFERENCES.summary() : null,
      boardCircuitSummary: BOARD && typeof BOARD.summary === 'function' ? BOARD.summary() : null,
      automaticVariantSelectionAllowed: false,
      groupCount: Object.keys(GROUPS).length,
      variantCount: Object.keys(GROUPS).reduce((sum, id) => sum + GROUPS[id].variants.length, 0),
      groups: Object.keys(GROUPS).map((id) => ({
        id, name: GROUPS[id].name, executableMapping: GROUPS[id].executableMapping,
        evidence: PRIMARY && Array.isArray(PRIMARY.FUNCTIONAL_FAMILIES)
          ? PRIMARY.FUNCTIONAL_FAMILIES.find((item) => item.id === id) || null : null,
        variants: GROUPS[id].variants.map((item) => {
          const observed = BOARD && BOARD.VARIANTS && BOARD.VARIANTS[id]
            ? BOARD.VARIANTS[id].find((candidate) => candidate.id === item.id) : null;
          return {
            id: item.id, name: item.name, lifecycle: item.lifecycle,
            evidencePages: observed ? observed.pages.slice() : [],
            detailTemplateId: observed ? observed.detailTemplateId : null
          };
        })
      })),
      instantiated: instances.filter((instance) => Array.isArray(instance.functionalUnitIds) && instance.functionalUnitIds.length)
        .map((instance) => ({ id: instance.id, tag: instance.tag, kind: instance.kind,
          functionalUnitIds: instance.functionalUnitIds.slice(), implementationStatus: instance.implementationStatus }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      functionalContracts: Array.isArray(topology.functionalUnits) ? topology.functionalUnits.length : 0,
      safetyStateMachineStatus: topology.safetyStateMachine && topology.safetyStateMachine.status
    };
  }

  return Object.freeze({
    VERSION, SOURCE_STATUS, CANDIDATE, GROUPS, controlContract, describe
  });
})();
