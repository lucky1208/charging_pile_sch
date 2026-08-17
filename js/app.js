/* ============================================================
 * 充电桩原理图平台 — 应用交互层
 * 输入 → 受控需求翻译（可选）→ 确定性选型引擎 → 自动出图
 *
 * 安全边界：浏览器从不接收或保存模型 API Key；可选 AI 请求只发往
 * 同源 /api/ai 代理，且只用于自然语言参数翻译。
 * ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const AI_API = '/api/ai';
  const DRAWING_KEY = 'ev-schematic';
  const state = {
    R: null, svg: null, zoom: 1, zoomMode: 'fit-width',
    requirement: null, providerStatus: {}, providerStatusLoaded: false,
    generating: false, automatedInputSources: {}, initialInputValues: {}
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function textWithBreaks(value) { return escapeHtml(value).replace(/\n/g, '<br>'); }
  function asNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function inputNumber(id, fallback) { return asNumber($(id) && $(id).value, fallback); }
  function numberText(value, digits) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: digits == null ? 0 : digits }) : '—';
  }
  function optionExists(select, value) {
    return !!select && Array.from(select.options).some((option) => option.value === String(value));
  }
  function cleanList(value, max) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return list.map((item) => String(item).replace(/[<>]/g, '').trim()).filter(Boolean).slice(0, max || 12);
  }
  function humanError(error) {
    const message = String((error && error.message) || error || '未知错误').replace(/[<>]/g, '').slice(0, 220);
    return message || '请求未完成';
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---------- 表单 ---------- */
  const TRACKED_FIELDS = ['f-name', 'f-site', 'f-standard', 'f-archetype', 'f-output', 'f-module', 'f-guns',
    'f-gun-current', 'f-window', 'f-acv', 'f-supply', 'f-ess', 'f-ess-kwh', 'f-ess-power', 'f-ess-chem',
    'f-ess-coupling', 'f-thermal', 'f-ip', 'f-ambient', 'f-backend', 'f-hmi', 'f-pay', 'f-eff', 'f-pf', 'f-lowtemp', 'f-pref'];

  function getParams() {
    const req = state.requirement || {};
    return {
      pileName: $('f-name').value.trim() || '充电桩',
      site: $('f-site').value.trim(),
      standard: $('f-standard').value,
      archetype: $('f-archetype').value,
      outputKw: Math.max(1, inputNumber('f-output', 120)),
      moduleKw: Number($('f-module').value),
      gunCount: Number($('f-guns').value),
      gunCurrentA: Number($('f-gun-current').value),
      voltageWindow: $('f-window').value,
      acVoltage: Number($('f-acv').value),
      supplyMode: $('f-supply').value,
      essEnabled: $('f-ess').value === '1',
      essKwh: Math.max(0, inputNumber('f-ess-kwh', 100)),
      essPowerKw: Math.max(0, inputNumber('f-ess-power', 60)),
      essChem: $('f-ess-chem').value,
      essCoupling: $('f-ess-coupling').value,
      thermal: $('f-thermal').value,
      ipRating: $('f-ip').value,
      ambient: $('f-ambient').value.trim(),
      backend: $('f-backend').value,
      hmiSize: $('f-hmi').value,
      hmiPayment: $('f-pay').value,
      moduleEfficiency: inputNumber('f-eff', 0.95),
      inputPf: inputNumber('f-pf', 0.99),
      lowTemp: $('f-lowtemp').value === '1',
      pref: $('f-pref').value,
      specialRequirements: cleanList(req.specialRequirements, 20),
      requirementSource: req.source || 'FORM',
      inputSources: TRACKED_FIELDS.reduce((out, id) => {
        out[id] = state.automatedInputSources[id]
          || (String(($(id) || {}).value) === state.initialInputValues[id] ? 'FORM_DEFAULT' : 'FORM_ENTERED');
        return out;
      }, {})
    };
  }

  function logStep(message, type) {
    const box = $('step-log');
    if (!box) return null;
    const line = document.createElement('div');
    line.className = 'step ' + (type || '');
    line.textContent = message;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    return line;
  }

  /* ---------- 服务端 AI 代理（浏览器不处理密钥） ---------- */
  function providerEnabled(provider) {
    const status = state.providerStatus && state.providerStatus[provider];
    return status === true || !!(status && (status.enabled || status.configured || status.available));
  }
  function updateProviderStatus() {
    const target = $('ai-provider-status');
    if (!target) return;
    const model = $('f-model').value;
    if (model === 'local') { target.textContent = '本地规则解析：自然语言不会发送到服务端。'; return; }
    if (!state.providerStatusLoaded) { target.textContent = '正在检查同源服务端 AI 配置；不可用时将自动使用本地规则。'; return; }
    target.textContent = providerEnabled(model)
      ? '对应 AI 已由服务端配置。仅发送自然语言用于参数翻译，选型与出图仍由确定性引擎完成。'
      : '对应 AI 尚未在服务端配置；生成时会自动退回本地规则解析。浏览器不需要也不能填写 API Key。';
  }
  async function loadProviderStatus() {
    try {
      const response = await fetch(AI_API + '?action=status', { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('status ' + response.status);
      const body = await response.json();
      const payload = body && (body.data || body.result || body);
      state.providerStatus = (payload && payload.providers) || {};
    } catch (error) {
      state.providerStatus = {};
    } finally {
      state.providerStatusLoaded = true;
      updateProviderStatus();
    }
  }
  async function requestAI(action, payload) {
    const response = await fetch(AI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.assign({ action }, payload || {}))
    });
    let body = null;
    try { body = await response.json(); } catch (error) { /* handled below */ }
    if (!response.ok || !body || body.ok === false) {
      throw new Error((body && (body.error || body.message)) || ('服务端 AI 请求失败（' + response.status + '）'));
    }
    return body.data || body.result || body;
  }

  /* ---------- 需求归一化 ---------- */
  function normaliseStandard(value) {
    const v = String(value == null ? '' : value).toLowerCase();
    if (/gb|国标|中国|27930|20234/.test(v)) return 'gb';
    if (/ccs2|combo\s*2|欧标|欧洲|iec\s*62196|15118|din\s*70121/.test(v)) return 'eu';
    if (/ccs1|combo\s*1|美标|北美|j1772|sae/.test(v)) return 'us';
    return null;
  }
  function normaliseCoupling(value) {
    const v = String(value == null ? '' : value).toLowerCase();
    if (/ac|交流侧|pcs|并网/.test(v)) return 'ac';
    if (/dc|直流侧|dcdc|dc\/dc/.test(v)) return 'dc';
    return null;
  }
  function normaliseThermal(value) {
    const v = String(value == null ? '' : value).toLowerCase();
    if (/liquid|液冷/.test(v)) return 'liquid';
    if (/air|风冷/.test(v)) return 'air';
    return null;
  }
  function normalisePreference(value) {
    const v = String(value == null ? '' : value).toLowerCase();
    if (/cost|成本|预算/.test(v)) return 'cost';
    if (/reliab|可靠|高可用/.test(v)) return 'reliability';
    if (/balance|均衡|性价比/.test(v)) return 'balance';
    return null;
  }
  function normaliseBackend(value) {
    const v = String(value == null ? '' : value).toLowerCase();
    if (/2\.0\.1|ocpp2/.test(v)) return 'ocpp201';
    if (/1\.6|ocpp/.test(v)) return 'ocpp16';
    if (/私有|private/.test(v)) return 'private';
    return null;
  }
  function normaliseRequirement(payload, source) {
    const raw = payload && (payload.parsed || payload.requirements || payload.requirement || payload);
    const result = raw && typeof raw === 'object' ? raw : {};
    const getNumber = function () {
      for (let i = 0; i < arguments.length; i += 1) {
        const n = Number(result[arguments[i]]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return null;
    };
    const confidence = Number(result.confidence);
    return {
      source: source || 'AI',
      standard: normaliseStandard(result.standard || result.connector),
      outputKw: getNumber('outputKw', 'output_kw', 'powerKw', 'power_kw'),
      gunCount: getNumber('gunCount', 'gun_count', 'connectors'),
      gunCurrentA: getNumber('gunCurrentA', 'gun_current_a', 'currentA'),
      moduleKw: getNumber('moduleKw', 'module_kw'),
      essEnabled: typeof result.essEnabled === 'boolean' ? result.essEnabled : (result.ess_enabled === true ? true : (result.ess_enabled === false ? false : null)),
      essKwh: getNumber('essKwh', 'ess_kwh', 'batteryKwh', 'battery_kwh'),
      essPowerKw: getNumber('essPowerKw', 'ess_power_kw', 'pcsKw', 'pcs_kw'),
      essCoupling: normaliseCoupling(result.essCoupling || result.coupling),
      thermal: normaliseThermal(result.thermal || result.cooling),
      backend: normaliseBackend(result.backend || result.protocol),
      pref: normalisePreference(result.preference || result.pref),
      specialRequirements: cleanList(result.specialRequirements || result.special_requirements, 20),
      assumptions: cleanList(result.assumptions, 12),
      questions: cleanList(result.questions, 12),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null
    };
  }
  async function callAIParse(provider, text) {
    const payload = await requestAI('parse', { provider, text: String(text).slice(0, 5000) });
    return normaliseRequirement(payload, 'SERVER_AI:' + provider);
  }

  /* ---------- 本地规则解析：只提取，不做工程决策 ---------- */
  function parseNLLocal(text) {
    const input = String(text || '');
    const find = (regex) => { const match = input.match(regex); return match ? Number(match[1]) : null; };
    const special = [];
    if (/高盐雾|沿海|海边/.test(input)) special.push('沿海/高盐雾环境：防腐等级、材料与外壳防护要求待项目确认。');
    if (/寒区|低温|东北|高寒/.test(input)) special.push('低温环境：电池加热、枪线柔性与启动策略待热工与电池厂家确认。');
    if (/一机多充|群充|功率分配/.test(input)) special.push('一机多充：功率分配矩阵、模块投切策略与计量分账待运营方确认。');
    if (/防爆|加油站|化工/.test(input)) special.push('存在防爆/危险场所要求：区域划分与设备防爆等级必须由消防与工艺专业确认。');
    const essMatch = /储能|电池|BESS|削峰/.test(input);
    return {
      source: 'LOCAL_RULES',
      standard: normaliseStandard(input),
      outputKw: find(/([\d.]+)\s*(?:kW|千瓦)/i),
      gunCount: find(/(\d+)\s*(?:把|路|枪|把枪|个枪)/) || (/双枪/.test(input) ? 2 : (/单枪/.test(input) ? 1 : (/四枪/.test(input) ? 4 : null))),
      gunCurrentA: find(/([\d.]+)\s*A(?![a-z])/i),
      moduleKw: find(/模块\s*([\d.]+)\s*kW/i),
      essEnabled: essMatch ? true : (/不带储能|无储能/.test(input) ? false : null),
      essKwh: find(/([\d.]+)\s*(?:kWh|度电|度)/i),
      essPowerKw: find(/(?:PCS|变换器|DC\/DC)\s*([\d.]+)\s*kW/i),
      essCoupling: normaliseCoupling(input),
      thermal: normaliseThermal(input),
      backend: normaliseBackend(input),
      pref: normalisePreference(input),
      specialRequirements: special,
      assumptions: ['本地规则仅识别明显的标准、功率、枪数、电流与储能关键词；其余文字要求已保留为待确认事项。'],
      questions: [],
      confidence: 0.55
    };
  }

  function setAutomatedValue(fieldId, value, source) {
    const input = $(fieldId);
    if (!input) return;
    input.value = value;
    state.automatedInputSources[fieldId] = source || 'AI_TRANSLATION';
  }
  function applyRequirement(requirement) {
    if (!requirement) return;
    const source = requirement.source || 'AI_TRANSLATION';
    if (requirement.standard && optionExists($('f-standard'), requirement.standard)) setAutomatedValue('f-standard', requirement.standard, source);
    if (requirement.outputKw) setAutomatedValue('f-output', Math.round(requirement.outputKw), source);
    if (requirement.gunCount && optionExists($('f-guns'), String(Math.round(requirement.gunCount)))) setAutomatedValue('f-guns', String(Math.round(requirement.gunCount)), source);
    if (requirement.gunCurrentA && optionExists($('f-gun-current'), String(Math.round(requirement.gunCurrentA)))) setAutomatedValue('f-gun-current', String(Math.round(requirement.gunCurrentA)), source);
    if (requirement.moduleKw && optionExists($('f-module'), String(Math.round(requirement.moduleKw)))) setAutomatedValue('f-module', String(Math.round(requirement.moduleKw)), source);
    if (requirement.essEnabled === true) setAutomatedValue('f-ess', '1', source);
    if (requirement.essEnabled === false) setAutomatedValue('f-ess', '0', source);
    if (requirement.essKwh) setAutomatedValue('f-ess-kwh', Math.round(requirement.essKwh), source);
    if (requirement.essPowerKw) setAutomatedValue('f-ess-power', Math.round(requirement.essPowerKw), source);
    if (requirement.essCoupling && optionExists($('f-ess-coupling'), requirement.essCoupling)) setAutomatedValue('f-ess-coupling', requirement.essCoupling, source);
    if (requirement.thermal && optionExists($('f-thermal'), requirement.thermal)) setAutomatedValue('f-thermal', requirement.thermal, source);
    if (requirement.backend && optionExists($('f-backend'), requirement.backend)) setAutomatedValue('f-backend', requirement.backend, source);
    if (requirement.pref && optionExists($('f-pref'), requirement.pref)) setAutomatedValue('f-pref', requirement.pref, source);
    toggleEssFields();
  }

  /* ---------- 生成 ---------- */
  window.generateSchematic = async function () {
    if (state.generating) return;
    state.generating = true;
    const log = $('step-log');
    log.innerHTML = '';
    log.style.display = 'block';
    const text = $('f-nl').value.trim();
    const provider = $('f-model').value;
    state.requirement = { source: 'FORM', specialRequirements: [], assumptions: [], questions: [], confidence: null };

    try {
      if (text) {
        let parsed = null;
        if (provider !== 'local' && (!state.providerStatusLoaded || providerEnabled(provider))) {
          try {
            logStep('服务端 AI 正在翻译自然语言需求（不参与选型计算）…', 'running');
            parsed = await callAIParse(provider, text);
            logStep('AI 需求翻译完成；已回填可识别字段，请复核。', 'ok');
          } catch (error) {
            logStep('服务端 AI 不可用：' + humanError(error) + '；已退回本地规则。', 'warn');
          }
        }
        if (!parsed) {
          logStep(provider === 'local' ? '本地规则正在解析自然语言需求…' : '使用本地规则解析自然语言需求…', 'running');
          parsed = parseNLLocal(text);
          logStep('本地规则解析完成；未识别的内容列为待确认事项。', 'ok');
        }
        state.requirement = parsed;
        applyRequirement(parsed);
      }

      if (!window.EVSE_ENGINE || typeof window.EVSE_ENGINE.build !== 'function') {
        throw new Error('选型引擎未加载，无法生成原理图。');
      }
      const steps = [
        '解析充电标准、接口与通信协议基线',
        '计算装机功率、功率模块数量与单枪能力',
        '按进线电流选取开关、接触器、快熔与电缆档位',
        '按储能容量确定电池簇配置、预充与变换器',
        '建立命名端口工程模型并执行 sch_lib 绘图规则校验',
        '渲染 A3 充电桩电气原理图与设备明细表'
      ];
      for (let index = 0; index < steps.length; index += 1) {
        const line = logStep('[' + (index + 1) + '/' + steps.length + '] ' + steps[index], 'running');
        await sleep(60);
        if (line) line.className = 'step ok';
      }

      state.R = window.EVSE_ENGINE.build(getParams());
      const graph = (state.R.drawingSkill && state.R.drawingSkill.graphValidation) || {};
      logStep('🧭 已调用 ' + state.R.drawingSkill.id + '@' + state.R.drawingSkill.version +
        '；语义图阻断项 ' + Number(graph.blockingCount || 0) + '。', graph.blockingCount ? 'warn' : 'ok');

      renderDrawing();
      renderSummary();
      renderDesignStatus();
      $('empty-hint').style.display = 'none';
      $('result-area').style.display = 'block';
      logStep('✅ 已生成确定性充电桩原理图。', 'ok');
      $('result-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      logStep('生成失败：' + humanError(error), 'warn');
      alert('原理图未生成：' + humanError(error));
    } finally {
      state.generating = false;
    }
  };

  /* ---------- 渲染 ---------- */
  function renderDrawing() {
    const target = $('d-pile');
    const skill = window.EVSE_DRAWING_SKILL;
    try {
      const markup = typeof window.drawPile === 'function'
        ? window.drawPile(state.R)
        : '<div style="padding:16px;color:#8b9bb4">原理图渲染器未加载。</div>';
      target.innerHTML = markup;
      state.svg = markup;
      if (skill && typeof skill.auditMarkup === 'function') {
        const audit = skill.auditMarkup(markup, DRAWING_KEY, state.R);
        skill.recordDrawingAudit(state.R, DRAWING_KEY, audit);
        target.dataset.drawingRuleStatus = audit.status;
      }
    } catch (error) {
      target.innerHTML = '<div style="padding:16px;color:#e3b341">图纸渲染失败：' + escapeHtml(humanError(error)) + '</div>';
      if (skill && typeof skill.recordDrawingAudit === 'function') {
        skill.recordDrawingAudit(state.R, DRAWING_KEY, {
          drawingKey: DRAWING_KEY, status: 'BLOCKED', blockingCount: 1, evaluatedRuleIds: ['DOC-001'],
          checks: [{ code: 'G000-RENDER-ERROR', ok: false, severity: 'ERROR', detail: humanError(error) }]
        });
      }
    }
    if (skill && typeof skill.finalizeDrawingAudits === 'function') skill.finalizeDrawingAudits(state.R);
    stampAudit();
    applyZoom();
  }
  function stampAudit() {
    const skill = window.EVSE_DRAWING_SKILL;
    const svg = $('d-pile') && $('d-pile').querySelector('svg');
    const report = state.R && state.R.drawingSkill;
    if (!skill || !svg || !report) return;
    const audit = (report.drawingAudits || {})[DRAWING_KEY];
    const meta = typeof skill.metadata === 'function' ? skill.metadata(state.R, DRAWING_KEY) : {};
    svg.setAttribute('data-drawing-audit-status', (audit && audit.status) || 'BLOCKED');
    svg.setAttribute('data-drawing-skill-status', report.status || 'BLOCKED');
    svg.setAttribute('data-evaluated-rules', (meta.evaluatedRuleIds || []).join(','));
    const metadataNode = svg.querySelector('metadata');
    if (!metadataNode) return;
    try {
      const documentMeta = JSON.parse(metadataNode.textContent || '{}');
      documentMeta.drawingSkill = Object.assign({}, documentMeta.drawingSkill || {}, meta, {
        status: report.status || 'BLOCKED', auditStatus: (audit && audit.status) || 'BLOCKED', auditVersion: skill.VERSION || ''
      });
      metadataNode.textContent = JSON.stringify(documentMeta);
    } catch (_) { svg.setAttribute('data-metadata-sync-status', 'BLOCKED'); }
  }

  function renderSummary() {
    const R = state.R;
    if (!R) return;
    const dc = R.dc || {}, ac = R.ac || {}, ess = R.ess || {};
    const cards = [
      ['装机 / 额定功率', numberText(dc.installedKw) + ' / ' + numberText(dc.ratedKw) + ' kW', '#58a6ff'],
      ['功率模块', numberText(dc.moduleCount) + ' × ' + numberText(dc.moduleKw) + ' kW', '#f0883e'],
      ['充电枪', (R.guns || []).length + ' × ' + numberText((R.guns[0] || {}).currentA) + ' A', '#3fb950'],
      ['交流进线', numberText(ac.inputA, 1) + ' A · QF ' + numberText(ac.breakerA) + ' A', '#a78bfa'],
      ['储能', ess.enabled ? (numberText(ess.installedKwh, 1) + ' kWh · ' + numberText(ess.converterInstalledKw) + ' kW') : '未配置', '#e3b341'],
      ['概念造价估算', '¥' + formatWan(R.bomTotal), '#f85149']
    ];
    $('summary-cards').innerHTML = cards.map((card) =>
      '<div class="kpi"><div class="kpi-label">' + escapeHtml(card[0]) + '</div><div class="kpi-value" style="color:' + card[2] + '">' + escapeHtml(card[1]) + '</div></div>'
    ).join('');
    const warnings = Array.isArray(R.warnings) ? R.warnings : [];
    $('warn-box').innerHTML = warnings.length ? '<div class="warn-box">⚠ ' + warnings.map(escapeHtml).join('；') + '</div>' : '';
  }
  function formatWan(value) {
    const wan = Number(value);
    if (!Number.isFinite(wan)) return '—';
    return wan >= 10000 ? (wan / 10000).toFixed(2) + ' 亿' : wan.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' 万';
  }

  function renderDesignStatus() {
    const R = state.R, el = $('design-status');
    if (!R || !el) return;
    const req = state.requirement || {};
    const readiness = R.readiness || {};
    const release = readiness.release || R.releaseGate || {};
    const skill = R.drawingSkill || {};
    const notChecked = (R.validation || []).filter((item) => item.result === 'NOT_CHECKED');
    const tags = [
      '<span class="state-tag warn">文档：方案级自动原理图</span>',
      '<span class="state-tag warn">生产图发布：' + escapeHtml(release.constructionStatus || 'BLOCKED') + '</span>',
      '<span class="state-tag">工程模型：' + escapeHtml((R.design && R.design.schemaVersion) || '—') + '</span>',
      '<span class="state-tag calc">选型引擎：' + escapeHtml(R.engineVersion || '—') + '</span>',
      '<span class="state-tag ' + (skill.status === 'ACTIVE' ? 'calc' : 'warn') + '">绘图规则：' +
        escapeHtml((skill.id || 'MISSING') + '@' + (skill.version || '—')) + ' · ' + escapeHtml(skill.status || 'BLOCKED') + '</span>',
      '<span class="state-tag">机器已执行规则：' + escapeHtml((skill.evaluatedRuleIds || []).length) + ' 条</span>',
      '<span class="state-tag">需求来源：' + escapeHtml(req.source || 'FORM') + '</span>'
    ];
    if (Number.isFinite(Number(req.confidence))) {
      tags.push('<span class="state-tag">需求翻译置信度：' + escapeHtml(Math.round(Number(req.confidence) * 100)) + '%（仅供复核）</span>');
    }
    let detail = '<b>设计状态与边界</b>　设备档位由确定性算法按输入参数选取，仅用于方案比较与专业沟通。<br>' +
      '<b style="color:#f85149">生产/施工图发布已被系统永久阻止：</b>' + escapeHtml(release.reason || '');
    if (notChecked.length) {
      detail += '<br><b>尚未完成的专业校核（' + notChecked.length + ' 项）：</b>' + notChecked.map((item) => escapeHtml(item.rule)).join('、');
    }
    const special = cleanList(req.specialRequirements, 20);
    if (special.length) detail += '<br><b>已保留的专项要求：</b>' + special.map(escapeHtml).join('；');
    const assumptions = (R.assumptions || []).slice(0, 6);
    if (assumptions.length) detail += '<br><b>引擎采用的假设：</b>' + assumptions.map((item) => escapeHtml(item.id + ' = ' + item.value)).join('；');
    el.innerHTML = '<div class="state-box">' + detail + '<div class="state-tags">' + tags.join('') + '</div></div>';
  }

  /* ---------- 缩放 ---------- */
  function getSvg() {
    const box = $('d-pile');
    return box && box.querySelector('svg');
  }
  function applyZoom() {
    const svg = getSvg();
    if (!svg) return;
    if (!svg.dataset.bw) {
      const vb = (svg.getAttribute('viewBox') || '0 0 1680 1188').trim().split(/\s+/);
      svg.dataset.bw = Number(vb[2]) || 1680;
      svg.dataset.bh = Number(vb[3]) || 1188;
    }
    const baseWidth = Number(svg.dataset.bw), baseHeight = Number(svg.dataset.bh);
    const host = svg.parentElement;
    const availableWidth = Math.max(320, Number((host && host.clientWidth) || baseWidth) - 18);
    if (state.zoomMode === 'fit-width') {
      state.zoom = Math.max(0.25, Math.min(1.5, availableWidth / baseWidth));
    } else if (state.zoomMode === 'fit-sheet') {
      const top = svg.getBoundingClientRect ? svg.getBoundingClientRect().top : 0;
      const availableHeight = Math.max(360, Number(window.innerHeight || 800) - Math.max(0, top) - 24);
      state.zoom = Math.max(0.25, Math.min(1.5, availableWidth / baseWidth, availableHeight / baseHeight));
    }
    svg.style.width = (baseWidth * state.zoom) + 'px';
    svg.style.height = (baseHeight * state.zoom) + 'px';
    const label = $('zoom-label');
    if (label) label.textContent = state.zoomMode === 'fit-width' ? '适宽' : state.zoomMode === 'fit-sheet' ? '适页' : Math.round(state.zoom * 100) + '%';
  }
  window.zoomIn = function () { state.zoomMode = 'manual'; state.zoom = Math.min(4, state.zoom * 1.2); applyZoom(); };
  window.zoomOut = function () { state.zoomMode = 'manual'; state.zoom = Math.max(0.25, state.zoom / 1.2); applyZoom(); };
  window.zoomFitWidth = function () { state.zoomMode = 'fit-width'; applyZoom(); };
  window.zoomFitSheet = function () { state.zoomMode = 'fit-sheet'; applyZoom(); };
  window.addEventListener('resize', () => { if (/^fit-/.test(state.zoomMode)) applyZoom(); });

  /* ---------- 前置检查与导出 ---------- */
  function showReview(text) {
    const host = $('review-host');
    if (!host) return;
    host.innerHTML = '<div class="review-box"><div class="review-title">🧪 图纸前置检查（自动规则）</div>' +
      '<div style="font-size:12px;line-height:1.7;white-space:pre-wrap;color:var(--text)">' + textWithBreaks(text) + '</div></div>';
  }
  window.reviewDiagram = function () {
    const svg = getSvg();
    if (!svg) { showReview('当前没有可检查的 SVG 图纸。'); return; }
    const markup = svg.outerHTML;
    const issues = [], passes = [];
    const skill = window.EVSE_DRAWING_SKILL;
    if (skill && typeof skill.auditMarkup === 'function') {
      skill.auditMarkup(markup, DRAWING_KEY, state.R).checks.forEach((check) => {
        const message = check.code + '：' + check.detail;
        if (check.ok) passes.push(message); else issues.push(message + ' [' + check.severity + ']');
      });
    } else issues.push('EVSE_DRAWING_SKILL 未加载，无法执行 sch_lib 规则检查。');
    const graph = (state.R && state.R.drawingSkill && state.R.drawingSkill.graphValidation) || { checks: [] };
    (graph.checks || []).filter((check) => !check.ok).forEach((check) => issues.push(check.code + '：' + check.detail));
    if (!svg.getAttribute('viewBox')) issues.push('缺少 viewBox，无法保证跨终端缩放。'); else passes.push('已检测到 viewBox。');
    if (/\b(undefined|null|NaN)\b/i.test(markup)) issues.push('图面包含 undefined / null / NaN 占位值。'); else passes.push('未发现未解析占位值。');
    const textCount = svg.querySelectorAll('text').length;
    passes.push('检测到 ' + textCount + ' 个文本对象。');
    showReview('检查对象：充电桩电气原理图\n' +
      (passes.length ? '通过：\n- ' + passes.join('\n- ') + '\n' : '') +
      (issues.length ? '待处理：\n- ' + issues.join('\n- ') + '\n' : '') +
      '结论：这是自动前置检查，不等同于 GB/IEC/UL 规范符合性审查、型式试验、CAD 校审或专业签发。');
  };

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function drawingName() {
    return ((state.R && state.R.pileName) || '充电桩') + '_电气原理图';
  }
  function exportSvgMarkup(svg) {
    const clone = svg && svg.cloneNode ? svg.cloneNode(true) : null;
    if (!clone) return '';
    /* applyZoom() 只影响预览，导出必须保留 A3 物理图幅 */
    if (clone.style) {
      clone.style.removeProperty('width');
      clone.style.removeProperty('height');
      if (!clone.getAttribute('style') || !clone.getAttribute('style').trim()) clone.removeAttribute('style');
    }
    clone.removeAttribute('data-bw');
    clone.removeAttribute('data-bh');
    return clone.outerHTML;
  }
  function exportAllowed(format) {
    const skill = window.EVSE_DRAWING_SKILL;
    if (!skill || typeof skill.canExport !== 'function') return { allowed: false, reason: '绘图规则包未加载，禁止导出。' };
    return skill.canExport(state.R, DRAWING_KEY, format);
  }
  window.downloadSvg = function () {
    const svg = getSvg();
    if (!svg) { alert('当前没有可下载的 SVG 图纸。'); return; }
    const gate = exportAllowed('SVG');
    if (!gate.allowed) { alert('SVG 导出已被绘图规则阻止：' + gate.reason); return; }
    downloadBlob(new Blob([exportSvgMarkup(svg)], { type: 'image/svg+xml;charset=utf-8' }), drawingName() + '.svg');
  };
  window.downloadDxf = function () {
    const svg = getSvg();
    if (!svg) { alert('当前没有可导出的图纸。'); return; }
    const gate = exportAllowed('DXF');
    if (!gate.allowed) { alert('DXF 导出已被绘图规则阻止：' + gate.reason); return; }
    const exporter = window.EVSE_DXF;
    if (!exporter) { alert('DXF 导出模块尚未加载，请确认 js/dxf-export.js 已部署。'); return; }
    try {
      const options = {
        title: drawingName(), drawing: DRAWING_KEY,
        project: state.R && state.R.pileName,
        documentStatus: state.R && state.R.documentStatus,
        notice: '可编辑 DXF 概念草图；复杂符号、图层、线宽、比例和打印样式须在 CAD 模板中复核。'
      };
      const result = typeof exporter.exportSvg === 'function' ? exporter.exportSvg(exportSvgMarkup(svg), options) : null;
      const dxf = typeof result === 'string' ? result : (result && (result.dxf || result.text));
      if (!dxf || !/^\s*0\s*[\r\n]+SECTION/m.test(dxf)) throw new Error('DXF 转换结果无效');
      downloadBlob(new Blob([dxf], { type: 'application/dxf;charset=utf-8' }), drawingName() + '.dxf');
      if (result && Array.isArray(result.warnings) && result.warnings.length) {
        showReview('DXF 已导出，但转换器提示：\n- ' + result.warnings.join('\n- ') + '\n请在 CAD 中复核后使用。');
      }
    } catch (error) {
      alert('DXF 导出失败：' + humanError(error));
    }
  };
  window.downloadJson = function () {
    if (!state.R) return;
    const packageData = {
      schema: 'EVSE-SOLUTION-PACKAGE/1.0',
      exportedAt: new Date().toISOString(),
      documentStatus: state.R.documentStatus,
      notice: '方案级自动原理图；不构成生产图、施工图、标准符合性证明、型式试验结论或设备报价。',
      releaseGate: state.R.releaseGate || (state.R.readiness && state.R.readiness.release) || { constructionDrawingAllowed: false },
      model: state.R
    };
    downloadBlob(new Blob([JSON.stringify(packageData, null, 2)], { type: 'application/json;charset=utf-8' }), 'evse-solution-' + Date.now() + '.json');
  };

  /* ---------- 初始化 ---------- */
  function toggleEssFields() {
    const enabled = $('f-ess') && $('f-ess').value === '1';
    const box = $('ess-fields');
    if (box) box.style.display = enabled ? 'block' : 'none';
  }
  function updateStandardHelp() {
    const help = $('std-help');
    const std = window.EV_STD && window.EV_STD.standard($('f-standard').value);
    if (!help || !std) return;
    help.textContent = std.connector + '；通信 ' + std.protocol + '；进线 ' + std.acVoltage + '；计量 ' + std.meter + '。' + std.note;
  }
  window.addEventListener('DOMContentLoaded', () => {
    TRACKED_FIELDS.forEach((id) => {
      const input = $(id);
      if (!input) return;
      state.initialInputValues[id] = String(input.value);
      const clear = () => { delete state.automatedInputSources[id]; };
      input.addEventListener('input', clear);
      input.addEventListener('change', clear);
    });
    $('f-ess').addEventListener('change', toggleEssFields);
    $('f-standard').addEventListener('change', () => {
      updateStandardHelp();
      const std = window.EV_STD && window.EV_STD.standard($('f-standard').value);
      if (std && !state.automatedInputSources['f-acv']) {
        const select = $('f-acv');
        if (optionExists(select, String(std.acLineVoltage))) select.value = String(std.acLineVoltage);
      }
    });
    $('f-model').addEventListener('change', updateProviderStatus);
    toggleEssFields();
    updateStandardHelp();
    loadProviderStatus();
  });

  window.EVSE_APP = { state, getParams, parseNLLocal };
})();
