/* ============================================================
 * EVSE RequirementSpec v1.0
 * ------------------------------------------------------------
 * Web 与 CLI 共用的唯一需求契约：默认值、枚举、标准电压、自然语言
 * 归一化、来源/置信度/未决项，以及生成前的 fail-closed 闸门。
 *
 * 本模块只翻译和校验需求，不参与器件选型、连接决策或图纸坐标计算。
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.EVSE_REQUIREMENT_SPEC = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const VERSION = '1.2.0';
  const SCHEMA = 'EVSE-REQUIREMENT/1.0';
  const CONFIDENCE_REVIEW_THRESHOLD = 0.75;

  const ENUMS = Object.freeze({
    standard: Object.freeze(['gb', 'eu', 'us', 'nacs', 'chademo']),
    archetype: Object.freeze(['dc-integrated', 'dc-split', 'ac-dc-combo', 'ess-mobile']),
    moduleKw: Object.freeze([15, 20, 30, 40, 60]),
    gunCount: Object.freeze([1, 2, 3, 4]),
    gunCurrentA: Object.freeze([125, 200, 250, 300, 400, 500]),
    voltageWindow: Object.freeze(['200-750', '150-1000', '200-1000', '500-1000']),
    supplyMode: Object.freeze(['grid', 'transformer', 'offgrid']),
    essChem: Object.freeze(['lfp', 'nmc']),
    essCoupling: Object.freeze(['dc', 'ac']),
    thermal: Object.freeze(['air', 'liquid']),
    ipRating: Object.freeze(['IP54', 'IP55', 'IP65']),
    backend: Object.freeze(['ocpp16', 'ocpp201', 'private']),
    pref: Object.freeze(['balance', 'cost', 'reliability'])
  });

  const STANDARD_VOLTAGES = Object.freeze({ gb: 380, eu: 400, us: 480, nacs: 480, chademo: 400 });
  const SUPPORTED = Object.freeze({
    standards: Object.freeze(ENUMS.standard.slice()),
    archetypes: Object.freeze(ENUMS.archetype.slice())
  });

  /* 这些值也是 Web 表单启动后的实际值；HTML 中的 value 只作无脚本回退。 */
  const DEFAULTS = Object.freeze({
    pileName: '充电桩',
    site: '',
    standard: 'gb',
    archetype: 'dc-integrated',
    outputKw: 120,
    moduleKw: 40,
    gunCount: 2,
    gunCurrentA: 250,
    voltageWindow: '200-1000',
    acVoltage: 380,
    supplyMode: 'transformer',
    essEnabled: false,
    essKwh: 200,
    essPowerKw: 120,
    essChem: 'lfp',
    essCoupling: 'dc',
    thermal: 'liquid',
    ipRating: 'IP54',
    ambient: '',
    backend: 'ocpp16',
    hmiSize: '10 英寸',
    hmiPayment: '扫码 / 刷卡',
    moduleEfficiency: 0.95,
    inputPf: 0.99,
    lowTemp: false,
    pref: 'balance',
    specialRequirements: Object.freeze([]),
    designer: 'Jixiong Lu',
    watermarkText: '卢继雄',
    requirementSource: 'FORM'
  });

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const text = (value) => String(value == null ? '' : value).trim();
  const lower = (value) => text(value).toLowerCase();
  const finite = (value) => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const positive = (value) => {
    const number = finite(value);
    return number != null && number > 0 ? number : null;
  };
  const clampConfidence = (value) => {
    const number = finite(value);
    return number == null ? null : Math.max(0, Math.min(1, number));
  };
  const cleanList = (value, max) => {
    const items = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
    const seen = new Set();
    return items.map((item) => text(item).replace(/[<>]/g, '')).filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    }).slice(0, max || 20);
  };
  /* 原始需求是审计证据，不用于 HTML 拼接。保留换行与文字语义，
   * 仅去掉会破坏 JSON/日志/DOM 文本节点的不可见控制字符并限制长度。 */
  const cleanRawText = (value, max) => String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, max || 5000)
    .trim();
  const firstPresent = (object, names) => {
    for (let index = 0; index < names.length; index += 1) {
      if (hasOwn(object, names[index])) return object[names[index]];
    }
    return undefined;
  };
  const firstPositive = (object, names) => {
    for (let index = 0; index < names.length; index += 1) {
      const number = positive(object[names[index]]);
      if (number != null) return number;
    }
    return null;
  };
  const normaliseBoolean = (value) => {
    if (value === true || value === false) return value;
    const valueText = lower(value);
    if (/^(1|true|yes|on|enabled|enable|是|有|启用)$/.test(valueText)) return true;
    if (/^(0|false|no|off|disabled|disable|否|无|不启用)$/.test(valueText)) return false;
    return null;
  };

  function normaliseStandard(value) {
    const valueText = lower(value);
    /* 专有接口必须排在“美标/SAE”和“CAN”等宽泛词之前。 */
    if (/nacs|j3400|north\s*american\s*charging|特斯拉(?:接口|充电)?/.test(valueText)) return 'nacs';
    if (/chademo|茶?德?莫|日标(?:直流)?/.test(valueText)) return 'chademo';
    if (/ccs2|combo\s*2|欧标|欧洲|iec\s*62196(?:-3)?\s*(?:ff)?/.test(valueText)) return 'eu';
    if (/ccs1|combo\s*1|美标|北美|j1772/.test(valueText)) return 'us';
    if (/\bgb\b|国标|中国|27930|20234/.test(valueText)) return 'gb';
    if (ENUMS.standard.includes(valueText)) return valueText;
    return null;
  }

  function normaliseArchetype(value) {
    const valueText = lower(value);
    if (/移动|充电车|ess[-_\s]*mobile|mobile/.test(valueText)) return 'ess-mobile';
    if (/交直流|交流一体|ac[-_\s]*dc[-_\s]*(?:combo|integrated)|combo/.test(valueText)) return 'ac-dc-combo';
    if (/分体|功率柜.*终端|dc[-_\s]*split|split/.test(valueText)) return 'dc-split';
    if (/一体|dc[-_\s]*integrated|integrated/.test(valueText)) return 'dc-integrated';
    if (ENUMS.archetype.includes(valueText)) return valueText;
    return null;
  }

  function normaliseCoupling(value) {
    const valueText = lower(value);
    if (/交流侧|\bac\b|pcs|并网/.test(valueText)) return 'ac';
    if (/直流侧|\bdc\b|dcdc|dc\s*\/\s*dc/.test(valueText)) return 'dc';
    return null;
  }
  function normaliseThermal(value) {
    const valueText = lower(value);
    if (/liquid|液冷/.test(valueText)) return 'liquid';
    if (/air|风冷/.test(valueText)) return 'air';
    return null;
  }
  function normalisePreference(value) {
    const valueText = lower(value);
    if (/cost|成本|预算/.test(valueText)) return 'cost';
    if (/reliab|可靠|高可用/.test(valueText)) return 'reliability';
    if (/balance|均衡|性价比/.test(valueText)) return 'balance';
    return null;
  }
  function normaliseBackend(value) {
    const valueText = lower(value);
    if (/2\.0\.1|ocpp\s*2/.test(valueText)) return 'ocpp201';
    if (/1\.6|ocpp/.test(valueText)) return 'ocpp16';
    if (/私有|private/.test(valueText)) return 'private';
    return null;
  }

  function unwrapRequirement(payload) {
    const outer = payload && typeof payload === 'object' ? payload : {};
    const inner = outer.parsed || outer.requirements || outer.requirement || outer;
    return inner && typeof inner === 'object' ? inner : {};
  }

  function normaliseRequirement(payload, source) {
    const outer = payload && typeof payload === 'object' ? payload : {};
    const result = unwrapRequirement(payload);
    const rawQuestions = cleanList(firstPresent(result, ['questions', 'clarifyingQuestions', 'clarifying_questions']), 20);
    const rawUnresolved = cleanList(firstPresent(result, ['unresolvedItems', 'unresolved_items', 'pendingItems', 'pending_items']), 20);
    const unresolvedItems = cleanList(rawUnresolved.concat(rawQuestions), 20);
    const sourceValue = text(source || result.source || result.requirementSource || 'AI') || 'AI';
    const rawTextValue = firstPresent(result, ['rawText', 'sourceText', 'source_text', 'inputText', 'input_text']);
    const outerRawTextValue = firstPresent(outer, ['rawText', 'sourceText', 'source_text', 'inputText', 'input_text']);
    const essRaw = firstPresent(result, ['essEnabled', 'ess_enabled', 'storageEnabled', 'storage_enabled']);
    return {
      schema: SCHEMA,
      source: sourceValue,
      rawText: cleanRawText(rawTextValue === undefined ? outerRawTextValue : rawTextValue, 5000),
      standard: normaliseStandard(result.standard || result.connector || result.interface),
      archetype: normaliseArchetype(result.archetype || result.pileType || result.pile_type),
      outputKw: firstPositive(result, ['outputKw', 'output_kw', 'powerKw', 'power_kw']),
      gunCount: firstPositive(result, ['gunCount', 'gun_count', 'connectors']),
      gunCurrentA: firstPositive(result, ['gunCurrentA', 'gun_current_a', 'currentA', 'current_a']),
      moduleKw: firstPositive(result, ['moduleKw', 'module_kw']),
      essEnabled: normaliseBoolean(essRaw),
      essKwh: firstPositive(result, ['essKwh', 'ess_kwh', 'batteryKwh', 'battery_kwh']),
      essPowerKw: firstPositive(result, ['essPowerKw', 'ess_power_kw', 'pcsKw', 'pcs_kw']),
      essCoupling: normaliseCoupling(result.essCoupling || result.ess_coupling || result.coupling),
      thermal: normaliseThermal(result.thermal || result.cooling),
      backend: normaliseBackend(result.backend || result.protocol),
      pref: normalisePreference(result.preference || result.pref),
      specialRequirements: cleanList(result.specialRequirements || result.special_requirements, 20),
      assumptions: cleanList(result.assumptions, 20),
      questions: rawQuestions,
      unresolvedItems,
      confidence: clampConfidence(result.confidence),
      confirmed: normaliseBoolean(result.confirmed) === true
    };
  }

  /* 本地规则只提取明显字段；它不推断电气连接或器件选型。 */
  function parseLocal(inputText) {
    const input = text(inputText);
    const find = (regex) => {
      const match = input.match(regex);
      return match ? positive(match[1]) : null;
    };
    const specialRequirements = [];
    if (/高盐雾|沿海|海边/.test(input)) specialRequirements.push('沿海/高盐雾环境：防腐等级、材料与外壳防护要求待项目确认。');
    if (/寒区|低温|东北|高寒/.test(input)) specialRequirements.push('低温环境：电池加热、枪线柔性与启动策略待热工与电池厂家确认。');
    if (/一机多充|群充|功率分配/.test(input)) specialRequirements.push('一机多充：功率分配矩阵、模块投切策略与计量分账待运营方确认。');
    if (/防爆|加油站|化工/.test(input)) specialRequirements.push('存在防爆/危险场所要求：区域划分与设备防爆等级必须由消防与工艺专业确认。');

    const explicitNoEss = /(?:无|不带|不要|取消|未配置|不配置)\s*(?:储能|电池|bess)|(?:储能|电池|bess)\s*(?:关闭|禁用|不要)/i.test(input);
    const explicitEss = /储能|电池|bess|削峰/i.test(input);
    const gunCount = find(/(\d+)\s*(?:把|路|枪|个枪)/) || (/四枪/.test(input) ? 4 : (/三枪/.test(input) ? 3 : (/双枪/.test(input) ? 2 : (/单枪/.test(input) ? 1 : null))));

    return normaliseRequirement({
      source: 'LOCAL_RULES',
      rawText: input,
      standard: normaliseStandard(input),
      archetype: normaliseArchetype(input),
      outputKw: find(/([\d.]+)\s*(?:kw|千瓦)/i),
      gunCount,
      gunCurrentA: find(/([\d.]+)\s*a(?![a-z])/i),
      moduleKw: find(/模块\s*([\d.]+)\s*kw/i),
      essEnabled: explicitNoEss ? false : (explicitEss ? true : null),
      essKwh: find(/([\d.]+)\s*(?:kwh|度电|度)/i),
      essPowerKw: find(/(?:pcs|变换器|dc\s*\/\s*dc)\s*([\d.]+)\s*kw/i),
      essCoupling: normaliseCoupling(input),
      thermal: normaliseThermal(input),
      backend: normaliseBackend(input),
      pref: normalisePreference(input),
      specialRequirements,
      assumptions: ['本地规则仅识别明确关键词；已回填字段和原始文字仍须由用户复核。'],
      questions: [],
      confidence: 0.55
    }, 'LOCAL_RULES');
  }

  function requirementFromParams(input, sourceFallback) {
    const raw = input && typeof input === 'object' ? input : {};
    const nested = raw.requirement && typeof raw.requirement === 'object' ? raw.requirement : {};
    return normaliseRequirement(Object.assign({}, nested, {
      source: nested.source || raw.requirementSource || sourceFallback || 'FORM',
      rawText: hasOwn(nested, 'rawText') ? nested.rawText
        : (hasOwn(nested, 'sourceText') ? nested.sourceText
          : firstPresent(raw, ['requirementRawText', 'rawText', 'sourceText'])),
      confidence: hasOwn(nested, 'confidence') ? nested.confidence : raw.requirementConfidence,
      unresolvedItems: nested.unresolvedItems || raw.unresolvedItems || raw.requirementQuestions,
      questions: nested.questions || raw.requirementQuestions,
      confirmed: raw.requirementConfirmed === true || (hasOwn(nested, 'confirmed') ? nested.confirmed : false)
    }));
  }

  function normaliseParams(input, options) {
    const raw = input && typeof input === 'object' ? input : {};
    const opts = options && typeof options === 'object' ? options : {};
    const params = Object.assign({}, DEFAULTS, raw);
    params.specialRequirements = cleanList(raw.specialRequirements || DEFAULTS.specialRequirements, 20);
    const standardRaw = hasOwn(raw, 'standard') ? raw.standard : DEFAULTS.standard;
    const archetypeRaw = hasOwn(raw, 'archetype') ? raw.archetype : DEFAULTS.archetype;
    params.standard = normaliseStandard(standardRaw) || lower(standardRaw);
    params.archetype = normaliseArchetype(archetypeRaw) || lower(archetypeRaw);

    const inputDiagnostics = [];
    const numericKeys = ['outputKw', 'moduleKw', 'gunCount', 'gunCurrentA', 'essKwh', 'essPowerKw', 'moduleEfficiency', 'inputPf'];
    numericKeys.forEach((key) => {
      if (!hasOwn(raw, key)) {
        params[key] = DEFAULTS[key];
        return;
      }
      const number = finite(raw[key]);
      if (number == null) {
        params[key] = null;
        inputDiagnostics.push({
          code: 'INVALID_NUMBER_FORMAT', field: key,
          value: text(raw[key]).slice(0, 120),
          message: key + ' 必须是有限数字，不能静默使用默认值。'
        });
        return;
      }
      params[key] = number;
    });
    ['essEnabled', 'lowTemp'].forEach((key) => {
      if (!hasOwn(raw, key)) {
        params[key] = DEFAULTS[key];
        return;
      }
      const bool = normaliseBoolean(raw[key]);
      if (bool == null) {
        params[key] = null;
        inputDiagnostics.push({
          code: 'INVALID_BOOLEAN_FORMAT', field: key,
          value: text(raw[key]).slice(0, 120),
          message: key + ' 必须是明确的 true/false（或等价受控值），不能静默使用默认值。'
        });
        return;
      }
      params[key] = bool;
    });

    const expectedVoltage = STANDARD_VOLTAGES[params.standard];
    if (!hasOwn(raw, 'acVoltage')) {
      params.acVoltage = expectedVoltage || DEFAULTS.acVoltage;
    } else {
      const voltage = finite(raw.acVoltage);
      if (voltage == null) {
        params.acVoltage = null;
        inputDiagnostics.push({
          code: 'INVALID_NUMBER_FORMAT', field: 'acVoltage',
          value: text(raw.acVoltage).slice(0, 120),
          message: 'acVoltage 必须是有限数字，不能静默改写为标准默认电压。'
        });
      } else {
        params.acVoltage = voltage;
      }
    }

    const requirement = requirementFromParams(raw, opts.source || DEFAULTS.requirementSource);
    params.requirement = requirement;
    params.requirementSource = requirement.source;
    params.requirementConfidence = requirement.confidence;
    params.unresolvedItems = requirement.unresolvedItems.slice();
    params.requirementConfirmed = requirement.confirmed || opts.confirmed === true;
    params.inputDiagnostics = inputDiagnostics;
    return params;
  }

  function supportIssues(params) {
    const value = params && typeof params === 'object' ? params : {};
    const issues = [];
    if (!SUPPORTED.standards.includes(value.standard)) {
      issues.push({
        code: 'UNSUPPORTED_STANDARD', field: 'standard', value: value.standard,
        message: '接口标准“' + (value.standard || '未识别') + '”不在受控枚举中；允许值为 GB、CCS2、CCS1、NACS、CHAdeMO。'
      });
    }
    if (!SUPPORTED.archetypes.includes(value.archetype)) {
      issues.push({
        code: 'UNSUPPORTED_ARCHETYPE', field: 'archetype', value: value.archetype,
        message: '桩型“' + (value.archetype || '未识别') + '”不在受控枚举中；允许值为直流一体式、直流分体式、交直流一体式、储能移动充电桩。'
      });
    }
    return issues;
  }

  function parameterIssues(params) {
    const value = params && typeof params === 'object' ? params : {};
    const issues = supportIssues(value).concat(Array.isArray(value.inputDiagnostics) ? value.inputDiagnostics : []);
    Object.keys(ENUMS).forEach((key) => {
      if (key === 'standard' || key === 'archetype') return;
      if (!ENUMS[key].includes(value[key])) {
        issues.push({ code: 'INVALID_ENUM', field: key, value: value[key], message: key + ' 不是受支持的枚举值：' + value[key] });
      }
    });
    const invalidFormatFields = new Set(issues.filter((issue) => /_FORMAT$/.test(issue.code)).map((issue) => issue.field));
    const inRange = (candidate, min, max) => Number.isFinite(Number(candidate)) && Number(candidate) >= min && Number(candidate) <= max;
    const rangeIssue = (field, min, max, unit, label) => {
      if (!invalidFormatFields.has(field) && !inRange(value[field], min, max)) {
        issues.push({ code: 'NUMBER_OUT_OF_RANGE', field, value: value[field], message: label + ' 必须在 ' + min + '–' + max + (unit ? ' ' + unit : '') + ' 范围内。' });
      }
    };
    rangeIssue('outputKw', 20, 2000, 'kW', 'outputKw');
    rangeIssue('essKwh', 0, 10000, 'kWh', 'essKwh');
    rangeIssue('essPowerKw', 0, 5000, 'kW', 'essPowerKw');
    rangeIssue('moduleEfficiency', 0.8, 1, '', 'moduleEfficiency');
    rangeIssue('inputPf', 0.8, 1, '', 'inputPf');
    if (value.archetype === 'ess-mobile' && value.essEnabled !== true) {
      issues.push({
        code: 'ARCHETYPE_REQUIRES_ESS', field: 'essEnabled', value: value.essEnabled,
        message: '储能移动充电桩必须显式启用储能系统，不能以无储能拓扑生成。'
      });
    }
    if (!invalidFormatFields.has('acVoltage') && (!Number.isFinite(Number(value.acVoltage)) || Number(value.acVoltage) <= 0)) {
      issues.push({ code: 'INVALID_NUMBER', field: 'acVoltage', value: value.acVoltage, message: 'acVoltage 必须是大于 0 的有限数字。' });
    } else if (!invalidFormatFields.has('acVoltage')) {
      const expectedVoltage = STANDARD_VOLTAGES[value.standard];
      if (expectedVoltage && Number(value.acVoltage) !== expectedVoltage) {
        issues.push({
          code: 'AC_VOLTAGE_STANDARD_MISMATCH', field: 'acVoltage', value: value.acVoltage,
          message: 'acVoltage=' + value.acVoltage + 'V 与接口标准 ' + value.standard + ' 的已验证输入电压 ' + expectedVoltage + 'V 不一致。'
        });
      }
    }
    /* 同一个格式错误不重复报一条范围错误，保持用户提示可读。 */
    const seen = new Set();
    return issues.filter((issue) => {
      const key = issue.code + '\u001f' + issue.field;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function confirmationGate(requirement, confirmed) {
    const value = normaliseRequirement(requirement || {}, (requirement && requirement.source) || 'FORM');
    const automatedSource = !/^(FORM|CLI|USER)(?:$|:)/i.test(value.source);
    const missingAutomatedConfidence = automatedSource && value.confidence == null;
    const lowConfidence = missingAutomatedConfidence || (value.confidence != null && value.confidence < CONFIDENCE_REVIEW_THRESHOLD);
    const hasUnresolvedItems = value.unresolvedItems.length > 0;
    const requiresConfirmation = lowConfidence || hasUnresolvedItems;
    const isConfirmed = confirmed === true || value.confirmed === true;
    const reasons = [];
    if (missingAutomatedConfidence) reasons.push('自动需求翻译未提供置信度。');
    else if (lowConfidence) reasons.push('需求翻译置信度为 ' + Math.round(value.confidence * 100) + '%，低于 ' + Math.round(CONFIDENCE_REVIEW_THRESHOLD * 100) + '%。');
    if (hasUnresolvedItems) reasons.push('仍有 ' + value.unresolvedItems.length + ' 个未决项。');
    return { allowed: !requiresConfirmation || isConfirmed, requiresConfirmation, confirmed: isConfirmed, reasons, requirement: value };
  }

  function generationGate(params, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const value = normaliseParams(params, opts);
    const issues = parameterIssues(value);
    const confirmation = confirmationGate(value.requirement, value.requirementConfirmed || opts.confirmed === true);
    return {
      allowed: issues.length === 0 && confirmation.allowed,
      issues,
      confirmation,
      params: value
    };
  }

  function assertGenerationAllowed(params, options) {
    const gate = generationGate(params, options);
    if (gate.allowed) return gate.params;
    const messages = gate.issues.map((item) => item.message).concat(gate.confirmation.allowed ? [] : gate.confirmation.reasons);
    const error = new Error(messages.join('；') || '需求闸门阻止生成。');
    error.code = gate.issues.length ? 'EVSE_REQUIREMENT_INVALID' : 'EVSE_REQUIREMENT_CONFIRMATION_REQUIRED';
    error.gate = gate;
    throw error;
  }

  return Object.freeze({
    VERSION, SCHEMA, CONFIDENCE_REVIEW_THRESHOLD,
    ENUMS, STANDARD_VOLTAGES, SUPPORTED, DEFAULTS,
    cleanList, cleanRawText, normaliseBoolean, normaliseStandard, normaliseArchetype,
    normaliseCoupling, normaliseThermal, normalisePreference, normaliseBackend,
    normaliseRequirement, parseLocal, requirementFromParams, normaliseParams,
    supportIssues, parameterIssues, confirmationGate, generationGate, assertGenerationAllowed
  });
});
