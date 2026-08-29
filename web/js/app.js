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
  const REQUIREMENTS = window.EVSE_REQUIREMENT_SPEC;
  const state = {
    R: null, svg: null, zoom: 1, zoomMode: 'fit-width',
    requirement: null, providerStatus: {}, providerStatusLoaded: false,
    requirementKey: '', generating: false, automatedInputSources: {}, initialInputValues: {},
    editor: null, editorEnabled: false, editorDrag: null, editorUnsubscribe: null
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
    const raw = {
      pileName: $('f-name').value.trim() || '充电桩',
      site: $('f-site').value.trim(),
      standard: $('f-standard').value,
      archetype: $('f-archetype').value,
      outputKw: $('f-output').value,
      moduleKw: $('f-module').value,
      gunCount: $('f-guns').value,
      gunCurrentA: $('f-gun-current').value,
      voltageWindow: $('f-window').value,
      acVoltage: $('f-acv').value,
      supplyMode: $('f-supply').value,
      essEnabled: $('f-ess').value === '1',
      essKwh: $('f-ess-kwh').value,
      essPowerKw: $('f-ess-power').value,
      essChem: $('f-ess-chem').value,
      essCoupling: $('f-ess-coupling').value,
      thermal: $('f-thermal').value,
      ipRating: $('f-ip').value,
      ambient: $('f-ambient').value.trim(),
      backend: $('f-backend').value,
      hmiSize: $('f-hmi').value,
      hmiPayment: $('f-pay').value,
      moduleEfficiency: $('f-eff').value,
      inputPf: $('f-pf').value,
      lowTemp: $('f-lowtemp').value === '1',
      pref: $('f-pref').value,
      specialRequirements: cleanList(req.specialRequirements, 20),
      requirementSource: req.source || 'FORM',
      requirementConfidence: req.confidence,
      unresolvedItems: cleanList(req.unresolvedItems || req.questions, 20),
      requirementConfirmed: !!($('f-requirement-confirm') && $('f-requirement-confirm').checked),
      requirement: req,
      inputSources: TRACKED_FIELDS.reduce((out, id) => {
        out[id] = state.automatedInputSources[id]
          || (String(($(id) || {}).value) === state.initialInputValues[id] ? 'FORM_DEFAULT' : 'FORM_ENTERED');
        return out;
      }, {})
    };
    return REQUIREMENTS && typeof REQUIREMENTS.normaliseParams === 'function'
      ? REQUIREMENTS.normaliseParams(raw, { source: req.source || 'FORM', confirmed: raw.requirementConfirmed })
      : raw;
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
  function normaliseRequirement(payload, source) {
    if (!REQUIREMENTS || typeof REQUIREMENTS.normaliseRequirement !== 'function') {
      throw new Error('共享 RequirementSpec 未加载，禁止使用需求翻译。');
    }
    return REQUIREMENTS.normaliseRequirement(payload, source || 'AI');
  }
  async function callAIParse(provider, text) {
    const payload = await requestAI('parse', { provider, text: String(text).slice(0, 5000) });
    return normaliseRequirement(Object.assign({}, payload || {}, { rawText: text }), 'SERVER_AI:' + provider);
  }

  /* ---------- 本地规则解析：只提取，不做工程决策 ---------- */
  function parseNLLocal(text) {
    if (!REQUIREMENTS || typeof REQUIREMENTS.parseLocal !== 'function') {
      throw new Error('共享 RequirementSpec 未加载，禁止本地需求解析。');
    }
    return REQUIREMENTS.parseLocal(text);
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
    if (requirement.archetype && optionExists($('f-archetype'), requirement.archetype)) setAutomatedValue('f-archetype', requirement.archetype, source);
    if (requirement.standard && optionExists($('f-standard'), requirement.standard)) {
      setAutomatedValue('f-standard', requirement.standard, source);
      const voltage = REQUIREMENTS && REQUIREMENTS.STANDARD_VOLTAGES[requirement.standard];
      if (voltage && optionExists($('f-acv'), String(voltage))) setAutomatedValue('f-acv', String(voltage), source);
      updateStandardHelp();
    }
    if (requirement.outputKw) setAutomatedValue('f-output', Math.round(requirement.outputKw), source);
    if (requirement.gunCount && optionExists($('f-guns'), String(Math.round(requirement.gunCount)))) setAutomatedValue('f-guns', String(Math.round(requirement.gunCount)), source);
    if (requirement.gunCurrentA && optionExists($('f-gun-current'), String(Math.round(requirement.gunCurrentA)))) setAutomatedValue('f-gun-current', String(Math.round(requirement.gunCurrentA)), source);
    if (requirement.moduleKw && optionExists($('f-module'), String(Math.round(requirement.moduleKw)))) setAutomatedValue('f-module', String(Math.round(requirement.moduleKw)), source);
    if (requirement.essEnabled === true) setAutomatedValue('f-ess', '1', source);
    if (requirement.essEnabled === false) setAutomatedValue('f-ess', '0', source);
    if (requirement.archetype === 'ess-mobile' && requirement.essEnabled !== false) {
      setAutomatedValue('f-ess', '1', source);
      setAutomatedValue('f-supply', 'offgrid', source);
    }
    if (requirement.essKwh) setAutomatedValue('f-ess-kwh', Math.round(requirement.essKwh), source);
    if (requirement.essPowerKw) setAutomatedValue('f-ess-power', Math.round(requirement.essPowerKw), source);
    if (requirement.essCoupling && optionExists($('f-ess-coupling'), requirement.essCoupling)) setAutomatedValue('f-ess-coupling', requirement.essCoupling, source);
    if (requirement.thermal && optionExists($('f-thermal'), requirement.thermal)) setAutomatedValue('f-thermal', requirement.thermal, source);
    if (requirement.backend && optionExists($('f-backend'), requirement.backend)) setAutomatedValue('f-backend', requirement.backend, source);
    if (requirement.pref && optionExists($('f-pref'), requirement.pref)) setAutomatedValue('f-pref', requirement.pref, source);
    toggleEssFields();
  }

  function renderRequirementReview(requirement, gate) {
    const host = $('requirement-review');
    const detail = $('requirement-review-detail');
    const confirmationRow = $('requirement-confirm-row');
    if (!host || !detail) return;
    const req = requirement || {};
    const confirmation = gate && gate.confirmation;
    const issues = gate && Array.isArray(gate.issues) ? gate.issues : [];
    const lines = [];
    lines.push('来源：' + (req.source || 'FORM'));
    lines.push('置信度：' + (req.confidence != null && Number.isFinite(Number(req.confidence)) ? Math.round(Number(req.confidence) * 100) + '%' : '未提供'));
    const unresolved = cleanList(req.unresolvedItems || req.questions, 20);
    lines.push('未决项：' + (unresolved.length ? unresolved.join('；') : '无'));
    if (confirmation && confirmation.reasons.length) lines.push('确认原因：' + confirmation.reasons.join('；'));
    if (issues.length) lines.push('实现阻断：' + issues.map((item) => item.message).join('；'));
    detail.textContent = lines.join('\n');
    host.style.display = 'block';
    if (confirmationRow) confirmationRow.style.display = confirmation && confirmation.requiresConfirmation ? 'flex' : 'none';
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

    try {
      if (text) {
        const requirementKey = provider + '\n' + text;
        if (state.requirementKey !== requirementKey || !state.requirement) {
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
          state.requirementKey = requirementKey;
          if ($('f-requirement-confirm')) $('f-requirement-confirm').checked = false;
          applyRequirement(parsed);
        } else {
          logStep('使用上次已回填的需求翻译结果。', 'ok');
        }
      } else {
        state.requirement = normaliseRequirement({ source: 'FORM' }, 'FORM');
        state.requirementKey = '';
        if ($('requirement-review')) $('requirement-review').style.display = 'none';
      }

      if (!REQUIREMENTS || typeof REQUIREMENTS.generationGate !== 'function') {
        throw new Error('共享 RequirementSpec 未加载，需求未经校验，禁止生成。');
      }
      const gate = REQUIREMENTS.generationGate(getParams(), {
        confirmed: !!($('f-requirement-confirm') && $('f-requirement-confirm').checked)
      });
      if (text || gate.issues.length || !gate.confirmation.allowed) renderRequirementReview(state.requirement, gate);
      else if ($('requirement-review')) $('requirement-review').style.display = 'none';
      if (gate.issues.length) {
        logStep('⛔ 当前组合尚未实现：' + gate.issues.map((item) => item.message).join('；'), 'warn');
        return;
      }
      if (!gate.confirmation.allowed) {
        logStep('⏸ 已回填需求，但尚未生成。请复核表单和未决项，勾选明确确认后再次点击生成。', 'warn');
        if ($('f-requirement-confirm')) $('f-requirement-confirm').focus();
        return;
      }
      state.requirement.confirmed = gate.confirmation.confirmed;

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

      state.R = window.EVSE_ENGINE.build(gate.params);
      const graph = (state.R.drawingSkill && state.R.drawingSkill.graphValidation) || {};
      logStep('🧭 已调用 ' + state.R.drawingSkill.id + '@' + state.R.drawingSkill.version +
        '；语义图阻断项 ' + Number(graph.blockingCount || 0) + '。', graph.blockingCount ? 'warn' : 'ok');

      renderDrawing();
      renderSummary();
      renderDesignStatus();
      renderFunctionalUnitStatus();
      renderQualityStatus();
      initializeSchematicEditor();
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
    if (req.confidence != null && Number.isFinite(Number(req.confidence))) {
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

  function renderFunctionalUnitStatus() {
    const R = state.R, el = $('functional-unit-status');
    if (!R || !el) return;
    const knowledge = R.functionalUnitKnowledge;
    const design = R.design || {};
    const units = design.topology && Array.isArray(design.topology.functionalUnits)
      ? design.topology.functionalUnits : [];
    const machine = design.topology && design.topology.safetyStateMachine;
    if (!knowledge) {
      el.innerHTML = '<div class="state-box"><b>功能安全模型：</b><span style="color:#f85149">知识库未加载，禁止把输出视为已完成控制/诊断设计。</span></div>';
      return;
    }
    const groups = Array.isArray(knowledge.groups) ? knowledge.groups : [];
    const pilotUnits = units.filter((unit) => unit && unit.type === 'CONTROL_PILOT_INTERFACE');
    const diagnosticUnits = units.filter((unit) => unit && unit.type === 'OUTPUT_SAFETY_DIAGNOSTICS');
    const groupMarkup = groups.map((group) => {
      const variants = Array.isArray(group.variants) ? group.variants : [];
      return '<div style="margin:5px 0"><b>' + escapeHtml(group.name) + '</b> · ' +
        escapeHtml(group.executableMapping || '—') + '<br><span style="color:var(--text2)">' +
        variants.map((variant) => escapeHtml(variant.name + ' [' + variant.lifecycle + ']')).join('；') + '</span></div>';
    }).join('');
    const tags = [
      '<span class="state-tag calc">端子级功能合同：' + units.length + '</span>',
      '<span class="state-tag calc">状态机：' + escapeHtml((machine && machine.status) || 'MISSING') + '</span>',
      '<span class="state-tag">候选分类：' + Number(knowledge.groupCount || groups.length) + '</span>',
      '<span class="state-tag warn">候选拓扑：' + Number(knowledge.variantCount || 0) + ' · 禁止自动选型</span>'
    ];
    const pilotSummary = pilotUnits.length
      ? '其中 ' + pilotUnits.length + ' 个具有物理 CP 触点的接口已建模 CP 发生、高阻采样与车辆二极管检查。'
      : '当前接口没有物理 CP 触点，CP 发生、采样与车辆二极管检查按标准适用性标记为 N/A，未虚构 CP 电路。';
    el.innerHTML = '<div class="state-box" style="margin-top:8px"><b>控制导引与输出诊断：</b>' +
      diagnosticUnits.length + ' 个输出接口' + (diagnosticUnits.length === 1 ? '已' : '均已') +
      '建模送电前输出预检及接触器逐极状态监测；' + pilotSummary +
      '<br><span style="color:#e3b341">板级电路、器件值、阈值和时序仍为项目待决项；下列用户项目证据化拓扑只作 CANDIDATE 浏览，系统没有自动采用任何变体。</span>' +
      '<div class="state-tags">' + tags.join('') + '</div>' +
      '<details class="engine-inputs" style="margin-bottom:0"><summary>查看 ' + groups.length + ' 类 / ' + Number(knowledge.variantCount || 0) + ' 个候选拓扑（只读）</summary>' +
      groupMarkup + '</details></div>';
  }

  /* ---------- 证据库、质量画像与对象化编辑 ---------- */
  function renderQualityStatus() {
    const host = $('quality-status');
    if (!host || !state.R) return;
    const quality = state.R.schematicQuality;
    if (!quality) {
      host.innerHTML = '<div class="state-box" style="margin-top:8px"><b>图纸质量画像：</b><span style="color:#f85149">质量规则库未加载。</span></div>';
      return;
    }
    const labels = {
      ELECTRICAL_COMPLETENESS: '电气完整性', FUNCTIONAL_SAFETY: '功能安全', DIAGNOSTIC_COVERAGE: '诊断覆盖',
      ISOLATION_AND_PROTECTION: '隔离与保护', EMC_AND_SURGE: 'EMC与浪涌', TESTABILITY: '可测试性',
      READABILITY: '可读性', TRACEABILITY: '可追溯性', MAINTAINABILITY: '可维护性'
    };
    const dimensions = Object.keys(quality.dimensions || {}).map((id) => {
      const item = quality.dimensions[id] || {};
      return '<div class="quality-dimension"><b>' + escapeHtml(labels[id] || id) + '</b><br>' +
        escapeHtml(item.score == null ? '未评估' : item.score + '/100 · ' + item.status) + '</div>';
    }).join('');
    const failures = (quality.checks || []).filter((item) => !item.ok && item.result !== 'NOT_ASSESSED');
    host.innerHTML = '<div class="state-box" style="margin-top:8px"><b>图纸质量画像：</b>' +
      '<span style="color:' + (quality.status === 'PASS' ? '#78d8a4' : '#e3b341') + '">' + escapeHtml(quality.status) + '</span>' +
      ' · 阻断 ' + Number(quality.blockingCount || 0) + ' · 未决 ' + Number(quality.unresolvedCount || 0) +
      (failures.length ? '<br><b>需处理：</b>' + failures.slice(0, 6).map((item) =>
        escapeHtml(item.ruleId + ' ' + item.detail)).join('；') : '') +
      '<div class="quality-dimensions">' + dimensions + '</div>' +
      '<div style="margin-top:6px;color:var(--text2)">' + escapeHtml(quality.note || '') + '</div></div>';
  }

  function renderEditorLibrary() {
    const host = $('editor-library-content');
    if (!host) return;
    const catalog = window.EVSE_BOARD_SYMBOL_CATALOG;
    const board = window.EVSE_BOARD_CIRCUIT_LIBRARY;
    const evidence = window.EVSE_EVIDENCE_LIBRARY;
    const references = window.EVSE_REFERENCE_SYSTEM_LIBRARY;
    if (!catalog || !board || !evidence || !references) {
      host.innerHTML = '<div class="muted" style="color:#f85149">板级符号/电路/证据/真实项目参考库未完整加载。</div>';
      return;
    }
    const summary = board.summary();
    const referenceSummary = references.summary();
    const symbols = catalog.ids.map((id) => {
      const definition = catalog.resolve(id);
      return '<div class="editor-symbol-card" title="' + escapeHtml(definition.standardFamily + ' · ' + definition.lifecycle) + '">' +
        catalog.svgPreview(id, { width: 100, height: 65 }) + '<div>' + escapeHtml(definition.name) + '</div></div>';
    }).join('');
    const templates = Object.keys(board.TEMPLATES).sort().map((id) => {
      const item = board.TEMPLATES[id];
      const pages = ((item.sourceRefs || [])[0] || {}).pages || [];
      return '<div class="editor-object" onclick="showBoardTemplate(\'' + escapeHtml(id) + '\')"><b>' +
        escapeHtml(item.name) + '</b><br><span class="muted">' + item.components.length + ' 元件 · ' + item.circuits.length +
        ' 条 PIN→PIN · 文档 p.' + escapeHtml(pages.join('–')) + '</span></div>';
    }).join('');
    const referenceCards = Object.keys(references.SYSTEMS).sort().map((id) => {
      const item = references.SYSTEMS[id];
      const inferred = item.connections.filter((wire) => wire.evidenceStatus === references.TRACE.INFERRED).length;
      return '<div class="editor-object" onclick="showReferenceSystem(\'' + escapeHtml(id) + '\')"><b>' +
        escapeHtml(item.name) + '</b><br><span class="muted">' + item.devices.length + ' 器件 · ' + item.connections.length +
        ' 条端点关系 · ' + item.functionalUnits.length + ' 功能单元 · 推断待核 ' + inferred + '</span></div>';
    }).join('');
    host.innerHTML = '<div class="muted" style="margin:8px 0">' + catalog.ids.length + ' 类板级符号 · ' +
      Object.keys(board.TEMPLATES).length + ' 个详细功能模板 · ' +
      Number(summary.explicitPointToPointCircuitCount || 0) + ' 条逻辑端口点对点连接（物理封装脚号未决） · ' +
      Number(summary.variantCount || 0) + ' 个候选拓扑<br>' +
      referenceSummary.referenceCount + ' 份真实系统图 · ' + referenceSummary.deviceCount + ' 个器件 · ' +
      referenceSummary.connectionCount + ' 条 partial trace 系统端点关系 · 未决 ' +
      Number(referenceSummary.unresolvedItemCount || 0) + '（明确标注 / 可见走线 / 推断待核分级）</div>' +
      '<details open><summary>真实项目系统参考（只读对照）</summary>' + referenceCards + '</details>' +
      '<details open><summary>详细功能单元模板</summary>' + templates + '</details>' +
      '<details><summary>IEC/GB 风格板级符号（' + catalog.ids.length + '）</summary><div class="editor-symbol-grid">' + symbols + '</div></details>';
  }

  window.showReferenceSystem = function (id) {
    const references = window.EVSE_REFERENCE_SYSTEM_LIBRARY;
    const item = references && references.find(id);
    const host = $('editor-inspector-content');
    if (!item || !host) return;
    const validation = references.validate(item);
    const traceLabel = {};
    traceLabel[references.TRACE.LABELLED] = '端子标注+走线明确';
    traceLabel[references.TRACE.VISIBLE] = '走线可见/块端口泛化';
    traceLabel[references.TRACE.INFERRED] = '功能推断—必须复核';
    host.innerHTML = '<div class="inspector-row"><span>真实项目参考</span><b>' + escapeHtml(item.name) + '</b></div>' +
      '<div class="inspector-row"><span>标准 / 接口</span><span>' + escapeHtml(item.standard + ' / ' + item.interface) + '</span></div>' +
      '<div class="inspector-row"><span>源证据</span><span>' + escapeHtml(item.sourceId) + '</span></div>' +
      '<div class="inspector-row"><span>自动选型</span><b style="color:#e3b341">禁止</b></div>' +
      '<div class="inspector-row"><span>端点校验</span><b style="color:' + (validation.ok ? '#78d8a4' : '#f85149') + '">' +
        escapeHtml(validation.ok ? '结构 PASS' : 'FAIL') + '</b></div>' +
      '<div class="inspector-row"><span>逐PIN提取</span><b style="color:' + (validation.complete ? '#78d8a4' : '#e3b341') + '">' +
        escapeHtml(validation.complete ? 'COMPLETE' : 'PARTIAL · 未决 ' + validation.unresolved.length) + '</b></div>' +
      '<details open><summary>功能单元（' + item.functionalUnits.length + '）</summary>' + item.functionalUnits.map((entry) =>
        '<div class="editor-object"><b>' + escapeHtml(entry.name) + '</b><br>' + escapeHtml(entry.functions.join(' · ')) +
        '<br><span class="muted">' + entry.deviceIds.length + ' 器件 / ' + entry.connectionIds.length + ' 关系</span></div>').join('') + '</details>' +
      '<details><summary>器件与PIN（' + item.devices.length + '）</summary><div class="inspector-pins">' + item.devices.map((part) =>
        '<div class="editor-object"><b>' + escapeHtml(part.ref + ' ' + part.name) + '</b><br>' +
        escapeHtml(part.pins.map((port) => port.id + '=' + port.label).join(' · ')) + '</div>').join('') + '</div></details>' +
      '<details><summary>端点关系（' + item.connections.length + '）</summary><div class="inspector-pins">' + item.connections.map((wire) =>
        '<div class="editor-object" style="border-color:' + (wire.evidenceStatus === references.TRACE.INFERRED ? '#8a6235' : '#29466f') + '"><b>' +
        escapeHtml(wire.id + ' ' + wire.net) + '</b><br>' + escapeHtml(wire.from + ' → ' + wire.to) +
        '<br><span class="muted">' + escapeHtml(traceLabel[wire.evidenceStatus] || wire.evidenceStatus) +
        (wire.note ? ' · ' + escapeHtml(wire.note) : '') + '</span></div>').join('') + '</div></details>' +
      '<details open><summary>未决项（生产使用前必须关闭）</summary>' + item.unresolved.map((note) =>
        '<div class="editor-object" style="color:#e3b341">' + escapeHtml(note) + '</div>').join('') + '</details>';
  };

  window.showBoardTemplate = function (id) {
    const board = window.EVSE_BOARD_CIRCUIT_LIBRARY;
    const qualityRules = window.EVSE_SCHEMATIC_QUALITY;
    const item = board && board.findTemplate(id);
    const host = $('editor-inspector-content');
    if (!item || !host) return;
    const quality = qualityRules && qualityRules.reviewBoardTemplate(id);
    host.innerHTML = '<div class="inspector-row"><span>功能单元</span><b>' + escapeHtml(item.name) + '</b></div>' +
      '<div class="inspector-row"><span>模板ID</span><span>' + escapeHtml(item.id) + '</span></div>' +
      '<div class="inspector-row"><span>生命周期</span><span>' + escapeHtml(item.lifecycle) + '</span></div>' +
      '<div class="inspector-row"><span>元件/导线</span><span>' + item.components.length + ' / ' + item.circuits.length + '</span></div>' +
      '<div class="inspector-row"><span>安全不变量</span><span>' + escapeHtml(item.safetyInvariant || item.warning || item.note || '项目复核') + '</span></div>' +
      '<details open><summary>元器件实例</summary><div class="inspector-pins">' + item.components.map((part) =>
        '<div class="editor-object"><b>' + escapeHtml(part.ref) + '</b> · ' + escapeHtml(part.symbolId) + '<br>' + escapeHtml(part.value || '') + '</div>').join('') + '</div></details>' +
      '<details><summary>PIN→PIN 连线</summary><div class="inspector-pins">' + item.circuits.map((wire) =>
        '<div class="editor-object"><b>' + escapeHtml(wire.id + ' ' + wire.net) + '</b><br>' + escapeHtml(wire.from + ' → ' + wire.to) + '</div>').join('') + '</div></details>' +
      (quality ? '<details><summary>质量规则：' + escapeHtml(quality.status) + '</summary>' + quality.checks.map((entry) =>
        '<div class="editor-object" style="color:' + (entry.ok ? '#78d8a4' : entry.result === 'NOT_ASSESSED' ? '#8b9bb4' : '#e3b341') + '"><b>' +
        escapeHtml(entry.ruleId + ' ' + entry.result) + '</b><br>' + escapeHtml(entry.detail) + '</div>').join('') + '</details>' : '');
  };

  function setEditorStatus(message, error) {
    const host = $('editor-status');
    if (!host) return;
    host.textContent = String(message || '');
    host.style.borderColor = error ? '#8a3a3a' : '#29466f';
    host.style.color = error ? '#ff9b9b' : '#b7d5f4';
  }
  function updateEditorControls() {
    const snapshot = state.editor && state.editor.snapshot();
    if ($('editor-undo')) $('editor-undo').disabled = !snapshot || !snapshot.canUndo;
    if ($('editor-redo')) $('editor-redo').disabled = !snapshot || !snapshot.canRedo;
    if ($('editor-reset')) $('editor-reset').disabled = !snapshot || snapshot.revision === 0;
    const toggle = $('editor-toggle');
    if (toggle) toggle.textContent = state.editorEnabled ? '✎ 退出编辑' : '✎ 在线编辑';
    const workspace = $('editor-workspace');
    if (workspace) workspace.textContent = document.body.classList.contains('workspace-mode') ? '⤢ 返回参数' : '⛶ 全屏工作台';
  }
  function setEditorEnabled(enabled) {
    state.editorEnabled = !!enabled && !!state.editor;
    const shell = $('editor-shell'); const box = $('d-pile'); const svg = getSvg();
    if (shell) shell.classList.toggle('active', state.editorEnabled);
    if (box) box.classList.toggle('editor-active', state.editorEnabled);
    if (svg) svg.classList.toggle('editor-active', state.editorEnabled);
    updateEditorControls();
    if (state.editorEnabled) setEditorStatus('已进入对象化编辑：拖动器件；拖动导线的中间线段；点击文字图示后可改内容。每次提交都会重新运行几何和端点 ERC。');
  }
  window.toggleEditor = function () { setEditorEnabled(!state.editorEnabled); };
  window.toggleEditorWorkspace = function () {
    document.body.classList.toggle('workspace-mode');
    if (!state.editorEnabled) setEditorEnabled(true);
    updateEditorControls();
    setTimeout(() => { applyZoom(); }, 0);
  };

  function initializeSchematicEditor() {
    if (state.editorUnsubscribe) state.editorUnsubscribe();
    state.editor = null; state.editorDrag = null;
    const api = window.EVSE_SCHEMATIC_EDITOR;
    if (!api || !state.R || !state.R.drawingIR) {
      setEditorStatus('编辑内核或 Drawing IR 未加载。', true); updateEditorControls(); return;
    }
    try {
      state.editor = api.createSession({ drawingIR: state.R.drawingIR, model: state.R.design, historyLimit: 100 });
      state.editorUnsubscribe = state.editor.subscribe(() => updateEditorControls());
      renderEditorLibrary(); bindEditorEvents(); renderEditorInspector();
      setEditorEnabled(true);
    } catch (error) {
      setEditorStatus('编辑器未能打开：' + humanError(error), true); updateEditorControls();
    }
  }

  function editorTarget(element) {
    if (!element || !element.closest) return null;
    const device = element.closest('g[id^="DEVICE-"]');
    if (device) return { kind: 'device', id: device.getAttribute('data-equipment'), node: device };
    const route = element.closest('g[id^="ROUTE-"]');
    if (route) return { kind: 'route', id: route.getAttribute('data-route'), node: route };
    const annotationRoot = element.closest('#EVSE-IR-ANNOTATIONS');
    if (annotationRoot) {
      const primitive = element.closest('[data-primitive]');
      if (primitive) return { kind: 'annotation', id: primitive.getAttribute('data-primitive'), node: primitive };
    }
    return null;
  }
  function svgPoint(svg, event) {
    if (!svg || !svg.createSVGPoint || !svg.getScreenCTM()) return { x: event.clientX, y: event.clientY };
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }
  function distanceToSegment(point, segment) {
    if (segment.orientation === 'horizontal') {
      const x = Math.max(Math.min(segment.x1, segment.x2), Math.min(Math.max(segment.x1, segment.x2), point.x));
      return Math.hypot(point.x - x, point.y - segment.y1);
    }
    const y = Math.max(Math.min(segment.y1, segment.y2), Math.min(Math.max(segment.y1, segment.y2), point.y));
    return Math.hypot(point.x - segment.x1, point.y - y);
  }
  function nearestEditableSegment(route, point) {
    const candidates = (route && route.segments || []).filter((segment) =>
      segment.index > 0 && segment.index < route.segments.length - 1);
    return candidates.sort((a, b) => distanceToSegment(point, a) - distanceToSegment(point, b))[0] || null;
  }
  function clearEditorHighlight() {
    const box = $('d-pile'); if (!box) return;
    box.querySelectorAll('[data-editor-selected="true"]').forEach((node) => node.removeAttribute('data-editor-selected'));
  }
  function highlightEditorSelection() {
    clearEditorHighlight();
    const selection = state.editor && state.editor.selection; if (!selection) return;
    let node = null;
    if (selection.kind === 'device') node = document.getElementById('DEVICE-' + selection.id);
    if (selection.kind === 'route') node = document.getElementById('ROUTE-' + selection.id);
    if (selection.kind === 'annotation') node = Array.from(($('d-pile') || document).querySelectorAll('[data-primitive]'))
      .find((item) => item.getAttribute('data-primitive') === selection.id);
    if (node) node.setAttribute('data-editor-selected', 'true');
  }
  function selectEditorObject(target) {
    if (!state.editor) return;
    state.editor.select(target ? target.kind : null, target ? target.id : null);
    highlightEditorSelection(); renderEditorInspector();
  }

  function renderEditorInspector() {
    const host = $('editor-inspector-content');
    if (!host || !state.editor) return;
    const selected = state.editor.selection;
    if (!selected) {
      host.innerHTML = '<div class="muted">点击器件、导线或图示对象查看属性。拖动器件；拖动导线中间线段可修改走线。</div>';
      return;
    }
    const item = state.editor.inspect(selected.kind, selected.id);
    if (!item) { host.innerHTML = '<div class="muted">所选对象已不存在。</div>'; return; }
    if (selected.kind === 'device') {
      const x = item.bbox.xMin != null ? item.bbox.xMin : item.bbox.x;
      const y = item.bbox.yMin != null ? item.bbox.yMin : item.bbox.y;
      host.innerHTML = '<div class="inspector-row"><span>设备ID</span><b>' + escapeHtml(item.id) + '</b></div>' +
        '<div class="inspector-row"><span>位号</span><span>' + escapeHtml(item.tag || item.referenceDesignation || '—') + '</span></div>' +
        '<div class="inspector-row"><span>器件类型</span><span>' + escapeHtml(item.type) + '</span></div>' +
        '<div class="inspector-row"><span>符号</span><span>' + escapeHtml(item.symbolId) + '</span></div>' +
        '<div class="inspector-row"><span>位置</span><span>X <input class="form-input" id="editor-x" value="' + x + '" style="width:72px;padding:3px"> Y <input class="form-input" id="editor-y" value="' + y + '" style="width:72px;padding:3px"> <button class="mini-btn" onclick="editorMoveSelectedTo()">移动</button></span></div>' +
        '<details open><summary>端子 / PIN（' + (item.ports || []).length + '）</summary><div class="inspector-pins">' +
        (item.ports || []).map((port) => '<div class="editor-object"><b>' + escapeHtml(port.terminalId || port.id) + '</b> · ' +
          escapeHtml(port.label || '') + '<br>' + escapeHtml(port.ref + ' @ ' + port.x + ',' + port.y) + '</div>').join('') + '</div></details>';
    } else if (selected.kind === 'route') {
      host.innerHTML = '<div class="inspector-row"><span>导线ID</span><b>' + escapeHtml(item.id) + '</b></div>' +
        '<div class="inspector-row"><span>网络</span><span>' + escapeHtml(item.netId) + '</span></div>' +
        '<div class="inspector-row"><span>回路</span><span>' + escapeHtml(item.circuitId) + '</span></div>' +
        '<div class="inspector-row"><span>起点PIN</span><span>' + escapeHtml(item.source.ref) + '</span></div>' +
        '<div class="inspector-row"><span>终点PIN</span><span>' + escapeHtml(item.target.ref) + '</span></div>' +
        '<div class="inspector-row"><span>层</span><span>' + escapeHtml(item.layer) + '</span></div>' +
        '<details open><summary>正交线段（' + item.segments.length + '）</summary><div class="inspector-pins">' + item.segments.map((segment) =>
          '<div class="editor-object"><b>S' + segment.index + ' ' + escapeHtml(segment.orientation) + '</b><br>' +
          escapeHtml(segment.x1 + ',' + segment.y1 + ' → ' + segment.x2 + ',' + segment.y2) +
          (segment.index === 0 || segment.index === item.segments.length - 1 ? '<br><span style="color:#e3b341">端子邻接线段锁定</span>' : '') + '</div>').join('') + '</div></details>';
    } else {
      host.innerHTML = '<div class="inspector-row"><span>图示ID</span><b>' + escapeHtml(item.id) + '</b></div>' +
        '<div class="inspector-row"><span>类型</span><span>' + escapeHtml(item.kind) + '</span></div>' +
        (item.kind === 'text' ? '<label class="form-label" style="margin-top:8px">文字内容</label><textarea class="form-input" id="editor-annotation-text" rows="4">' +
          escapeHtml(item.text) + '</textarea><button class="mini-btn" style="margin-top:6px" onclick="editorApplyAnnotationText()">应用文字</button>' :
          '<div class="muted" style="margin-top:8px">拖动此对象修改位置。</div>');
    }
  }

  window.editorMoveSelectedTo = function () {
    const selection = state.editor && state.editor.selection;
    const item = selection && state.editor.inspect(selection.kind, selection.id);
    if (!item || selection.kind !== 'device') return;
    const x = Number($('editor-x').value); const y = Number($('editor-y').value);
    const oldX = item.bbox.xMin != null ? item.bbox.xMin : item.bbox.x;
    const oldY = item.bbox.yMin != null ? item.bbox.yMin : item.bbox.y;
    applyEditorCommand(state.editor.moveDevice(item.id, x - oldX, y - oldY, { grid: 5 }));
  };
  window.editorApplyAnnotationText = function () {
    const selection = state.editor && state.editor.selection;
    if (!selection || selection.kind !== 'annotation') return;
    applyEditorCommand(state.editor.editAnnotationText(selection.id, $('editor-annotation-text').value));
  };

  function bindEditorEvents() {
    const svg = getSvg(); if (!svg || !state.editor) return;
    svg.classList.toggle('editor-active', state.editorEnabled);
    svg.addEventListener('click', (event) => {
      if (!state.editorEnabled || state.editorDrag) return;
      const target = editorTarget(event.target);
      if (target) { event.preventDefault(); event.stopPropagation(); }
      selectEditorObject(target);
    });
    svg.addEventListener('pointerdown', (event) => {
      if (!state.editorEnabled || event.button !== 0) return;
      const target = editorTarget(event.target); if (!target) return;
      const start = svgPoint(svg, event); let segment = null;
      if (target.kind === 'route') segment = nearestEditableSegment(state.editor.inspect('route', target.id), start);
      if (target.kind === 'route' && !segment) { selectEditorObject(target); setEditorStatus('该导线没有可拖动的中间线段；端子邻接段保持锁定。', true); return; }
      selectEditorObject(target);
      state.editorDrag = { pointerId: event.pointerId, target, start, current: start, segment,
        originalTransform: target.node.getAttribute('transform') || '' };
      target.node.setAttribute('data-editor-dragging', 'true');
      if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
      event.preventDefault(); event.stopPropagation();
    });
    svg.addEventListener('pointermove', (event) => {
      const drag = state.editorDrag; if (!drag || drag.pointerId !== event.pointerId) return;
      drag.current = svgPoint(svg, event);
      const dx = drag.current.x - drag.start.x; const dy = drag.current.y - drag.start.y;
      if (drag.target.kind !== 'route') {
        drag.target.node.setAttribute('transform', (drag.originalTransform ? drag.originalTransform + ' ' : '') + 'translate(' + dx + ' ' + dy + ')');
      } else {
        const delta = drag.segment.orientation === 'horizontal' ? dy : dx;
        setEditorStatus('导线 ' + drag.target.id + ' · S' + drag.segment.index + ' 预移动 ' + Math.round(delta / 5) * 5 + '；松开后执行 ERC。');
      }
      event.preventDefault();
    });
    const finish = (event) => {
      const drag = state.editorDrag; if (!drag || drag.pointerId !== event.pointerId) return;
      state.editorDrag = null;
      drag.target.node.removeAttribute('data-editor-dragging');
      if (drag.originalTransform) drag.target.node.setAttribute('transform', drag.originalTransform);
      else drag.target.node.removeAttribute('transform');
      const current = drag.current || drag.start; const dx = current.x - drag.start.x; const dy = current.y - drag.start.y;
      let response;
      if (Math.hypot(dx, dy) < 1.5) { highlightEditorSelection(); return; }
      if (drag.target.kind === 'device') response = state.editor.moveDevice(drag.target.id, dx, dy, { grid: 5 });
      else if (drag.target.kind === 'annotation') response = state.editor.moveAnnotation(drag.target.id, dx, dy, { grid: 5 });
      else response = state.editor.moveRouteSegment(drag.target.id, drag.segment.index,
        drag.segment.orientation === 'horizontal' ? dy : dx, { grid: 5 });
      applyEditorCommand(response);
      event.preventDefault();
    };
    svg.addEventListener('pointerup', finish); svg.addEventListener('pointercancel', finish);
    highlightEditorSelection();
  }

  function rerenderEditedDrawing() {
    if (!state.editor || !state.R) return;
    const renderer = window.EVSE_SVG_IR_RENDERER; const skill = window.EVSE_DRAWING_SKILL;
    const ir = state.editor.drawingIR;
    const compiled = Object.assign({}, state.R.drawingCompiled || {}, { drawingIR: ir });
    state.R.drawingCompiled = compiled; state.R.drawingIR = ir;
    state.R.drawingGeometryHash = window.EVSE_DRAWING_IR.drawingIRHash(ir);
    state.R.editableDocument = state.editor.exportDocument();
    state.R.schematicQuality = window.EVSE_SCHEMATIC_QUALITY.reviewSystem({ design: state.R.design, drawingIR: ir });
    const markup = renderer.render(compiled, state.R);
    $('d-pile').innerHTML = markup; state.svg = markup;
    if (skill && typeof skill.auditMarkup === 'function') {
      const audit = skill.auditMarkup(markup, DRAWING_KEY, state.R);
      skill.recordDrawingAudit(state.R, DRAWING_KEY, audit);
      $('d-pile').dataset.drawingRuleStatus = audit.status;
      if (typeof skill.finalizeDrawingAudits === 'function') skill.finalizeDrawingAudits(state.R);
    }
    stampAudit(); applyZoom(); bindEditorEvents(); renderEditorInspector(); renderQualityStatus(); updateEditorControls();
  }
  function applyEditorCommand(response) {
    if (!response) return;
    if (!response.accepted) {
      const counts = response.details && ((response.details.violations || []).length + (response.details.coverageErrors || []).length);
      setEditorStatus('⛔ ' + (response.message || response.code) + (counts ? '（' + counts + ' 项违规）' : ''), true);
      highlightEditorSelection(); updateEditorControls(); return;
    }
    rerenderEditedDrawing();
    setEditorStatus('已提交 ' + response.command.type + ' · 修订 ' + response.command.revision + ' · ' + response.command.geometryHash + '；几何和端点 ERC 通过。');
  }
  window.editorUndo = function () { if (state.editor) applyEditorCommand(state.editor.undo()); };
  window.editorRedo = function () { if (state.editor) applyEditorCommand(state.editor.redo()); };
  window.editorReset = function () { if (state.editor) applyEditorCommand(state.editor.reset()); };

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
  function svgMatchesDrawingIR(svg) {
    const R = state.R || {};
    const ir = R.drawingIR;
    if (!svg || !ir) return false;
    return svg.getAttribute('data-ir-schema') === String(ir.schema || '')
      && svg.getAttribute('data-geometry-hash') === String(R.drawingGeometryHash || '')
      && Number(svg.getAttribute('data-route-count')) === (Array.isArray(ir.routes) ? ir.routes.length : -1);
  }
  window.downloadSvg = function () {
    const svg = getSvg();
    if (!svg) { alert('当前没有可下载的 SVG 图纸。'); return; }
    if (!svgMatchesDrawingIR(svg)) { alert('SVG 与当前 Drawing IR 不一致或缺失，禁止导出。'); return; }
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
      if (!state.R || !state.R.drawingIR || typeof exporter.exportDrawingIR !== 'function') {
        throw new Error('Drawing IR 缺失或直接导出器未加载；禁止从 SVG 反向猜测 DXF 几何。');
      }
      const result = exporter.exportDrawingIR(state.R.drawingIR, options);
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
      drawingGeometryHash: state.R.drawingGeometryHash || null,
      drawingIR: state.R.drawingIR || null,
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
  function applyContractDefaults() {
    if (!REQUIREMENTS || !REQUIREMENTS.DEFAULTS) return;
    const defaults = REQUIREMENTS.DEFAULTS;
    const values = {
      'f-name': defaults.pileName, 'f-site': defaults.site,
      'f-standard': defaults.standard, 'f-archetype': defaults.archetype,
      'f-output': defaults.outputKw, 'f-module': defaults.moduleKw,
      'f-guns': defaults.gunCount, 'f-gun-current': defaults.gunCurrentA,
      'f-window': defaults.voltageWindow, 'f-acv': defaults.acVoltage,
      'f-supply': defaults.supplyMode, 'f-ess': defaults.essEnabled ? '1' : '0',
      'f-ess-kwh': defaults.essKwh, 'f-ess-power': defaults.essPowerKw,
      'f-ess-chem': defaults.essChem, 'f-ess-coupling': defaults.essCoupling,
      'f-thermal': defaults.thermal, 'f-ip': defaults.ipRating,
      'f-ambient': defaults.ambient, 'f-backend': defaults.backend,
      'f-hmi': defaults.hmiSize, 'f-pay': defaults.hmiPayment,
      'f-eff': defaults.moduleEfficiency, 'f-pf': defaults.inputPf,
      'f-lowtemp': defaults.lowTemp ? '1' : '0', 'f-pref': defaults.pref
    };
    Object.keys(values).forEach((id) => {
      const input = $(id);
      if (input != null && values[id] != null) input.value = String(values[id]);
    });
  }
  window.addEventListener('DOMContentLoaded', () => {
    applyContractDefaults();
    state.requirement = normaliseRequirement({ source: 'FORM' }, 'FORM');
    TRACKED_FIELDS.forEach((id) => {
      const input = $(id);
      if (!input) return;
      state.initialInputValues[id] = String(input.value);
      const clear = () => { delete state.automatedInputSources[id]; };
      input.addEventListener('input', clear);
      input.addEventListener('change', clear);
    });
    $('f-ess').addEventListener('change', toggleEssFields);
    $('f-archetype').addEventListener('change', () => {
      if ($('f-archetype').value === 'ess-mobile') {
        $('f-ess').value = '1';
        $('f-supply').value = 'offgrid';
        delete state.automatedInputSources['f-ess'];
        delete state.automatedInputSources['f-supply'];
      }
      toggleEssFields();
    });
    $('f-standard').addEventListener('change', () => {
      updateStandardHelp();
      const voltage = REQUIREMENTS && REQUIREMENTS.STANDARD_VOLTAGES[$('f-standard').value];
      const select = $('f-acv');
      if (voltage && optionExists(select, String(voltage))) select.value = String(voltage);
      delete state.automatedInputSources['f-acv'];
    });
    $('f-nl').addEventListener('input', () => {
      if ($('f-requirement-confirm')) $('f-requirement-confirm').checked = false;
    });
    $('f-model').addEventListener('change', updateProviderStatus);
    toggleEssFields();
    updateStandardHelp();
    loadProviderStatus();
  });

  window.EVSE_APP = { state, getParams, parseNLLocal };
})();
