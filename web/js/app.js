/* ============================================================
 * 充电桩原理图平台 — 应用交互层
 * 输入 → 受控需求翻译（可选）→ 确定性选型引擎 → 自动出图
 *
 * 安全边界：浏览器从不接收或保存模型 API Key；可选 AI 请求只发往
 * 同源服务。需求翻译、审图观察和资料检索都不能修改 EDEM、坐标、
 * 批准状态或发布闸门。
 * ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const AI_API = '/api/ai';
  const ENGINEERING_API = '/api/engineering';
  const DRAWING_KEY = 'ev-schematic';
  const REQUIREMENTS = window.EVSE_REQUIREMENT_SPEC;
  const state = {
    R: null, svg: null, zoom: 1, zoomMode: 'fit-width',
    requirement: null, providerStatus: {}, providerStatusLoaded: false,
    requirementKey: '', generating: false, automatedInputSources: {}, initialInputValues: {},
    editor: null, editorEnabled: false, editorDrag: null, editorUnsubscribe: null,
    editorKeyboardBound: false, hiddenLayers: new Set(),
    editorGrid: 5, editorSnap: true, editorGridVisible: true,
    viewportBound: false, viewportSpaceDown: false, viewportPan: null,
    engineeringStatus: { configured: false }, engineeringBom: null,
    bomResearchCandidates: [], engineeringReviewCandidate: null,
    schematicDocument: null, renderedSchematicDocument: null,
    activeSheetId: null, activePage: null, activePageGate: null,
    pageEdits: Object.create(null), pageEditorSessions: Object.create(null), systemDrawing: null,
    engineeringAccessToken: ''
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
  function engineeringAccessToken() {
    const input = $('f-ai-access-token');
    const value = String(input ? input.value : state.engineeringAccessToken || '').trim();
    state.engineeringAccessToken = value;
    return value;
  }
  function authenticatedJsonHeaders() {
    const token = engineeringAccessToken();
    if (!token) throw new Error('请先输入站点管理员分配的受控 AI 访问令牌。');
    return { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token };
  }

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
      ? (engineeringAccessToken()
        ? '对应 AI 已由服务端配置。仅发送自然语言用于参数翻译，选型与出图仍由确定性引擎完成。'
        : '对应 AI 已配置，但公网模型调用需要上方的受控 AI 访问令牌；未填写时自动退回本地规则。')
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
      headers: authenticatedJsonHeaders(),
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
    const configPanel = $('design-config-panel');
    const workspace = $('workspace-column');
    const resultArea = $('result-area');
    if (configPanel) configPanel.setAttribute('aria-busy', 'true');
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
        '编译六类功能图纸、精确跨页续接与工程 BOM'
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
      prepareEngineeringBom();
      renderEngineeringBom();
      prepareSchematicDocument();
      renderSheetTabs();
      if (workspace) workspace.hidden = false;
      if (resultArea) resultArea.hidden = false;
      document.body.classList.add('has-result');
      if (state.renderedSchematicDocument && state.activeSheetId) activateSchematicSheet(state.activeSheetId);
      renderQualityStatus();
      initializeSchematicEditor();
      logStep('✅ 已生成确定性充电桩原理图。', 'ok');
      log.style.display = 'none';
      if (workspace) workspace.focus({ preventScroll: true });
      $('result-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (workspace) workspace.hidden = true;
      if (resultArea) resultArea.hidden = true;
      document.body.classList.remove('has-result');
      logStep('生成失败：' + humanError(error), 'warn');
      alert('原理图未生成：' + humanError(error));
    } finally {
      state.generating = false;
      if (configPanel) configPanel.setAttribute('aria-busy', 'false');
    }
  };

  /* ---------- 渲染 ---------- */
  function renderDrawing() {
    const target = $('d-pile');
    const skill = window.EVSE_DRAWING_SKILL;
    state.activePage = null;
    state.activePageGate = null;
    state.systemDrawing = null;
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
    if (state.R && state.R.drawingIR && /^<svg\b/.test(String(state.svg || ''))) {
      state.systemDrawing = {
        svg: state.svg,
        drawingIR: state.R.drawingIR,
        drawingCompiled: state.R.drawingCompiled,
        drawingPlan: state.R.drawingPlan,
        drawingSheet: state.R.drawingSheet,
        drawingGeometryHash: state.R.drawingGeometryHash,
        drawingDocumentControl: state.R.drawingDocumentControl,
        schematicQuality: state.R.schematicQuality
      };
    }
    stampAudit();
    applyZoom();
  }
  function stampAudit() {
    const skill = window.EVSE_DRAWING_SKILL;
    const svg = $('d-pile') && $('d-pile').querySelector('svg');
    const report = state.R && state.R.drawingSkill;
    if (!skill || !svg || !report) return;
    const audit = state.activePageGate || (report.drawingAudits || {})[DRAWING_KEY];
    const meta = typeof skill.metadata === 'function' ? skill.metadata(state.R, DRAWING_KEY) : {};
    const auditStatus = (audit && audit.status) || 'BLOCKED';
    svg.setAttribute('data-drawing-audit-status', auditStatus);
    svg.setAttribute('data-drawing-skill-status', state.activePage ? auditStatus : (report.status || 'BLOCKED'));
    svg.setAttribute('data-evaluated-rules', (meta.evaluatedRuleIds || []).join(','));
    const metadataNode = svg.querySelector('metadata');
    if (!metadataNode) return;
    try {
      const documentMeta = JSON.parse(metadataNode.textContent || '{}');
      documentMeta.drawingSkill = Object.assign({}, documentMeta.drawingSkill || {}, meta, {
        status: state.activePage ? auditStatus : (report.status || 'BLOCKED'),
        auditStatus, auditVersion: skill.VERSION || '',
        sheetId: state.activeSheetId || '',
        projectGateStatus: state.schematicDocument && state.schematicDocument.projectGate &&
          state.schematicDocument.projectGate.status || ''
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
    const pageGate = state.activePageGate;
    const pageQuality = pageGate && pageGate.quality;
    const pageFailures = pageQuality && (pageQuality.checks || []).filter((item) => !item.ok) || [];
    host.innerHTML = '<div class="state-box" style="margin-top:8px"><b>图纸质量画像：</b>' +
      '<span style="color:' + (quality.status === 'PASS' ? '#78d8a4' : '#e3b341') + '">' + escapeHtml(quality.status) + '</span>' +
      ' · 阻断 ' + Number(quality.blockingCount || 0) + ' · 未决 ' + Number(quality.unresolvedCount || 0) +
      (failures.length ? '<br><b>需处理：</b>' + failures.slice(0, 6).map((item) =>
        escapeHtml(item.ruleId + ' ' + item.detail)).join('；') : '') +
      '<div class="quality-dimensions">' + dimensions + '</div>' +
      (pageGate ? '<div style="margin-top:8px;padding-top:7px;border-top:1px solid #29466f"><b>当前页 ' +
        escapeHtml(state.activeSheetId || '') + '：</b><span style="color:' +
        (pageGate.status === 'PASS' ? '#78d8a4' : pageGate.status === 'REVIEW_REQUIRED' ? '#e3b341' : '#f85149') + '">' +
        escapeHtml(pageGate.status) + '</span> · 精确回路 ' +
        Number(pageGate.coverage && pageGate.coverage.renderedCircuitCount || 0) + '/' +
        Number(pageGate.coverage && pageGate.coverage.expectedCircuitCount || 0) + ' · 跨页续接 ' +
        Number(pageGate.coverage && pageGate.coverage.renderedOffPageConnectorCount || 0) + '/' +
        Number(pageGate.coverage && pageGate.coverage.expectedOffPageConnectorCount || 0) +
        (pageFailures.length ? '<br><b>页面需处理：</b>' + pageFailures.slice(0, 5).map((item) =>
          escapeHtml(item.code + ' ' + item.detail)).join('；') : '') + '</div>' : '') +
      '<div style="margin-top:6px;color:var(--text2)">' + escapeHtml(quality.note || '') + '</div></div>';
  }

  /* ---------- EDEM 同源工程 BOM ---------- */
  function prepareEngineeringBom() {
    const api = window.SCHEMATIC_ENGINEERING_BOM;
    if (!api || typeof api.build !== 'function' || !state.R) {
      state.engineeringBom = null;
      return;
    }
    state.engineeringBom = api.build(state.R, { approvedSelections: state.approvedBomSelections || [] });
  }

  function safeHttpsHref(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }

  function renderEngineeringBom() {
    const body = $('bom-table-body');
    const status = $('bom-status');
    if (!body) return;
    const bom = state.engineeringBom;
    if (!bom || !Array.isArray(bom.rows)) {
      body.innerHTML = '<tr><td colspan="9">工程 BOM 模块未加载或尚未生成方案。</td></tr>';
      if (status) status.textContent = '不可用';
      return;
    }
    body.innerHTML = bom.rows.map((row, index) => {
      const trace = bom.trace && bom.trace[index] || {};
      const url = safeHttpsHref(row['说明手册下载']);
      const selected = trace.selectionStatus === 'APPROVED';
      return '<tr data-instance-id="' + escapeHtml(trace.instanceId || '') + '">' +
        '<td><b>' + escapeHtml(row['位号']) + '</b></td>' +
        '<td>' + escapeHtml(row['类别']) + '</td>' +
        '<td>' + escapeHtml(row['设备名称']) + '</td>' +
        '<td class="' + (selected ? '' : 'pending') + '">' + escapeHtml(row['型号']) + '</td>' +
        '<td class="' + (selected ? '' : 'pending') + '">' + escapeHtml(row['参考推荐厂家']) + '</td>' +
        '<td>' + escapeHtml(row['关键参数']) + '</td>' +
        '<td>' + escapeHtml(row['数量']) + '</td>' +
        '<td>' + (url && selected ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">打开厂家数据手册</a>' :
          '<span class="pending">待检索 / 待批准</span>') + '</td>' +
        '<td><span class="state-tag ' + (selected ? 'calc' : 'warn') + '">' + escapeHtml(trace.selectionStatus || 'PART_SELECTION_REQUIRED') + '</span></td></tr>';
    }).join('');
    const unresolved = (bom.trace || []).filter((item) => item.selectionStatus !== 'APPROVED').length;
    if (status) status.textContent = '实例覆盖 ' + bom.coverage.bomRowCount + '/' + bom.coverage.designInstanceCount +
      ' · 待选型 ' + unresolved + ' · ' + (bom.coverage.ok ? 'COVERAGE PASS' : 'BLOCKED');
  }

  window.downloadEngineeringBomCsv = function () {
    const delivery = window.SCHEMATIC_ENGINEERING_DELIVERY || window.EVSE_ENGINEERING_DELIVERY;
    if (!delivery || !state.engineeringBom) { alert('当前没有可导出的工程 BOM。'); return; }
    const csv = delivery.bomCsv(state.engineeringBom);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), drawingName() + '_BOM.csv');
  };

  window.downloadExactPinWiringCsv = function () {
    const delivery = window.SCHEMATIC_ENGINEERING_DELIVERY || window.EVSE_ENGINEERING_DELIVERY;
    if (!delivery || !state.R) { alert('当前没有可导出的权威 EDEM 接线数据。'); return; }
    try {
      const csv = delivery.wiringCsv(state.R);
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), drawingName() + '_WIRING.csv');
    } catch (error) { alert('精确 PIN 接线表导出失败：' + humanError(error)); }
  };

  window.downloadEngineeringRfqCsv = function () {
    const delivery = window.SCHEMATIC_ENGINEERING_DELIVERY || window.EVSE_ENGINEERING_DELIVERY;
    if (!delivery || !state.R) { alert('当前没有可导出的 RFQ 澄清数据。'); return; }
    try {
      const csv = delivery.rfqCsv(state.R);
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), drawingName() + '_RFQ.csv');
    } catch (error) { alert('RFQ 澄清表导出失败：' + humanError(error)); }
  };

  window.downloadEngineeringAuditJson = function () {
    const delivery = window.SCHEMATIC_ENGINEERING_DELIVERY || window.EVSE_ENGINEERING_DELIVERY;
    if (!delivery || !state.R) { alert('当前没有可导出的审计证据。'); return; }
    let auditedDocument = state.renderedSchematicDocument;
    try {
      if (state.activePage && state.schematicDocument) {
        const pageApi = window.EVSE_SCHEMATIC_SHEET_RENDERING || window.SCHEMATIC_FORGE_SHEET_RENDERING;
        const markup = exportSvgMarkup(getSvg());
        const replacement = Object.assign({}, state.activePage, { svg: markup });
        auditedDocument = pageApi.evaluateDocument(state.R, state.renderedSchematicDocument,
          { [state.activeSheetId]: replacement });
      }
      const json = delivery.auditJson(state.R, auditedDocument);
      downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), drawingName() + '_AUDIT.json');
    } catch (error) { alert('审计证据导出失败：' + humanError(error)); }
  };

  function renderBomCandidates(candidates, note) {
    const host = $('bom-candidate-output');
    if (!host) return;
    host.style.display = 'block';
    const list = Array.isArray(candidates) ? candidates : [];
    host.innerHTML = '<div class="candidate-banner"><b>在线研究候选，不是采购推荐</b> · 任何型号、厂家和链接必须经工程师复核并显式批准，才可进入主 BOM。</div>' +
      (note ? '<div style="margin-bottom:7px">' + escapeHtml(note) + '</div>' : '') +
      (list.length ? list.map((item) => {
        const url = safeHttpsHref(item.datasheetUrl);
        return '<div class="editor-object" style="border-color:#29466f;margin-bottom:5px"><b>' +
          escapeHtml(item.reference || item.instanceId) + '</b> · ' + escapeHtml(item.manufacturer || '厂家待核') + ' ' +
          escapeHtml(item.model || '型号待核') + ' <span class="state-tag warn">CANDIDATE / UNREVIEWED</span><br>' +
          (url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">查看候选数据手册</a>' : '未返回可验证 HTTPS 数据手册链接') +
          (item.researchNotes ? '<br>' + escapeHtml(item.researchNotes) : '') + '</div>';
      }).join('') : '<div>没有返回完整候选；主 BOM 保持 PART_SELECTION_REQUIRED。</div>');
  }

  window.researchBomCandidates = async function () {
    const button = $('bom-research-button');
    const api = window.SCHEMATIC_ENGINEERING_BOM;
    try {
      if (!state.engineeringBom || !api) throw new Error('请先生成工程 BOM。');
      const pending = (state.engineeringBom.trace || []).filter((entry) => entry.selectionStatus !== 'APPROVED').slice(0, 12);
      if (!pending.length) throw new Error('当前没有待检索的 BOM 行。');
      if (button) { button.disabled = true; button.textContent = '正在检索…'; }
      const rows = pending.map((trace) => {
        const row = state.engineeringBom.rows[trace.rowIndex] || {};
        return { rowId: trace.instanceId, reference: row['位号'], category: row['类别'],
          deviceName: row['设备名称'], keyParameters: row['关键参数'], quantity: row['数量'] };
      });
      const response = await requestEngineering({ action: 'bom-research', bom: rows });
      const rowById = new Map(pending.map((trace) => [trace.instanceId, trace]));
      const raw = [];
      (response.items || []).forEach((group) => (group.candidates || []).forEach((candidate) => {
        const trace = rowById.get(group.rowId) || {};
        const row = state.engineeringBom.rows[trace.rowIndex] || {};
        raw.push(Object.assign({}, candidate, {
          instanceId: group.rowId,
          reference: row['位号'],
          evidence: (candidate.evidenceUrls || []).map((url) => ({
            url, title: candidate.datasheetTitle || candidate.model, sourceType: candidate.sourceType
          })),
          researchNotes: candidate.notes
        }));
      }));
      const candidates = raw.map((item) => {
        try { return api.normaliseResearchCandidate(item); } catch (_) { return null; }
      }).filter(Boolean);
      state.bomResearchCandidates = candidates;
      renderBomCandidates(candidates, response.note || response.summary || '检索结果已隔离保存为候选。');
    } catch (error) {
      renderBomCandidates([], '检索未完成：' + humanError(error) + '。主 BOM 没有发生变化。');
    } finally {
      if (button) button.textContent = '🌐 检索缺失数据手册';
      updateEngineeringAccessState();
    }
  };

  /* ---------- 多 Sheet 图册（EDEM 不因分页、图形分段或编辑而截断） ---------- */
  function pageRenderOptions(page) {
    const sheet = page && page.sheet || {};
    return {
      title: sheet.title || '充电桩电气原理图',
      subtitle: (sheet.drawingNo || sheet.id || '') + ' | ' + (sheet.purpose || '') + ' | 图形投影·非权威 EDEM',
      sheetId: sheet.id || page && page.sheetId || '', drawingNo: sheet.drawingNo || '',
      pageCurrent: Number(sheet.page || 1), pageTotal: Number(sheet.total || 1),
      sourceModelHash: state.R && state.R.design && state.R.design.modelHash || '',
      includeSchedule: false, includeLegend: true,
      offPageConnectors: page && page.offPageConnectors || sheet.offPageConnectors || [],
      projectionNote: '本页是全局 EDEM 的受控图形投影；图形分段和跨页续接均以 circuitId/netId/精确 PIN 回指电气真值。'
    };
  }

  function pageRecord(sheetId) {
    const id = String(sheetId || '');
    if (state.pageEdits && state.pageEdits[id]) return state.pageEdits[id];
    const pages = state.renderedSchematicDocument && state.renderedSchematicDocument.pages || [];
    return pages.find((page) => String(page.sheetId) === id) || null;
  }

  function activateSchematicSheet(sheetId) {
    const page = pageRecord(sheetId);
    if (!page || !state.R) return false;
    const compiled = page.compiled;
    const ir = compiled && compiled.drawingIR;
    if (!compiled || !ir || !page.svg) return false;
    state.activeSheetId = String(page.sheetId);
    state.activePage = page;
    state.activePageGate = page.pageGate || null;
    state.R.drawingCompiled = compiled;
    state.R.drawingIR = ir;
    state.R.drawingPlan = compiled.plan;
    state.R.drawingSheet = compiled.plan && compiled.plan.sheet;
    state.R.drawingPages = compiled.sheets || [];
    state.R.drawingGeometryHash = page.geometryHash || (window.EVSE_DRAWING_IR && window.EVSE_DRAWING_IR.drawingIRHash(ir));
    const sheet = page.sheet || {};
    const planned = compiled.plan && compiled.plan.sheet || {};
    state.R.drawingDocumentControl = {
      source: 'EVSE_SCHEMATIC_SHEET_RENDERING', format: planned.format,
      orientation: planned.orientation, widthMm: planned.widthMm, heightMm: planned.heightMm,
      scale: planned.scale, page: { current: Number(sheet.page || 1), total: Number(sheet.total || 1) },
      sheetId: page.sheetId, drawingNo: sheet.drawingNo || ''
    };
    state.R.activeSheet = {
      sheetId: page.sheetId, drawingNo: sheet.drawingNo || '', title: sheet.title || '',
      status: state.activePageGate && state.activePageGate.status || 'BLOCKED',
      projectionHash: page.projectionHash || '', sourceModelHash: page.sourceModelHash || ''
    };
    $('d-pile').innerHTML = page.svg;
    $('d-pile').dataset.drawingRuleStatus = state.activePageGate && state.activePageGate.status || 'BLOCKED';
    state.svg = page.svg;
    stampAudit();
    applyZoom();
    return true;
  }

  function prepareSchematicDocument() {
    state.schematicDocument = null;
    state.renderedSchematicDocument = null;
    state.activeSheetId = null;
    state.activePage = null;
    state.activePageGate = null;
    state.pageEdits = Object.create(null);
    state.pageEditorSessions = Object.create(null);
    if (!state.R || !state.R.design) return;
    const renderer = window.EVSE_SCHEMATIC_SHEET_RENDERING || window.SCHEMATIC_FORGE_SHEET_RENDERING;
    const planner = window.SCHEMATIC_DOCUMENT || window.SCHEMATIC_FORGE_DOCUMENT;
    try {
      if (!renderer || typeof renderer.buildDocument !== 'function') {
        if (!planner || typeof planner.compile !== 'function') throw new Error('多 Sheet 绘图内核未加载。');
        state.schematicDocument = planner.compile(state.R.design);
        throw new Error('逐页 Drawing IR 尚未执行；图册保持 fail-closed。');
      }
      state.renderedSchematicDocument = renderer.buildDocument(state.R);
      state.schematicDocument = state.renderedSchematicDocument.document;
      const pages = state.renderedSchematicDocument.pages || [];
      state.activeSheetId = pages[0] && pages[0].sheetId || null;
    } catch (error) {
      state.renderedSchematicDocument = null;
      state.schematicDocument = Object.assign({}, state.schematicDocument || { sheets: [] }, {
        status: 'BLOCKED', error: humanError(error)
      });
    }
  }

  function renderSheetTabs() {
    const host = $('sheet-tabs');
    if (!host) return;
    const doc = state.schematicDocument;
    const sheets = doc && (doc.sheets || doc.pages) || [];
    if (!sheets.length) {
      const sheet = state.R && state.R.drawingSheet || {};
      host.innerHTML = '<button class="sheet-tab active" type="button" role="tab" aria-selected="true">回退单页 · ' +
        escapeHtml(sheet.format || 'AUTO') + '</button>' +
        (doc && doc.error ? '<span class="state-tag warn">多 Sheet 阻断：' + escapeHtml(doc.error) + '</span>' : '');
      return;
    }
    host.innerHTML = sheets.map((sheet, index) => {
      const id = sheet.id || sheet.sheetId || ('SHEET-' + (index + 1));
      const title = sheet.title || sheet.name || id;
      const count = Number((sheet.internalCircuitIds || []).length) + Number((sheet.crossCircuitIds || []).length);
      const page = pageRecord(id);
      const status = page && page.pageGate && page.pageGate.status || sheet.gate && sheet.gate.status || 'BLOCKED';
      return '<button class="sheet-tab ' + (id === state.activeSheetId ? 'active' : '') + '" type="button" role="tab" ' +
        'aria-selected="' + (id === state.activeSheetId ? 'true' : 'false') + '" ' +
        'tabindex="' + (id === state.activeSheetId ? '0' : '-1') + '" data-sheet-id="' + escapeHtml(id) + '" ' +
        'onkeydown="sheetTabKeydown(event)" ' +
        'data-sheet-status="' + escapeHtml(status) + '" onclick="selectSchematicSheet(\'' + escapeHtml(id) + '\')" ' +
        'title="' + escapeHtml(status + ' · ' + count + ' 条独立回路 · ' + (sheet.offPageConnectors || []).length + ' 个跨页续接符') + '">' +
        escapeHtml((sheet.drawingNo || ('SF-' + String(index + 1).padStart(2, '0'))) + ' · ' + title) +
        ' · ' + count + ' 回路</button>';
    }).join('') + '<span class="state-tag ' + (String(doc.status) === 'PASS' ? 'calc' : 'warn') + '">' +
      escapeHtml(doc.status || 'BLOCKED') + ' · ' + sheets.length + ' 页 · 跨页精确回路 ' +
      Number((doc.crossSheetCircuits || []).length || 0) + '</span>';
  }

  window.selectSchematicSheet = function (sheetId) {
    if (!activateSchematicSheet(String(sheetId || ''))) return;
    renderSheetTabs();
    initializeSchematicEditor();
    renderQualityStatus();
    const page = state.activePage;
    const sheet = page.sheet || {};
    const coverage = page.pageGate && page.pageGate.coverage || {};
    showReview('当前图纸：' + (sheet.drawingNo || sheet.id) + ' · ' + (sheet.title || '') + '\n' +
      '独立回路：' + Number(coverage.renderedCircuitCount || 0) + '/' + Number(coverage.expectedCircuitCount || 0) + '\n' +
      '跨页续接：' + Number(coverage.renderedOffPageConnectorCount || 0) + '/' + Number(coverage.expectedOffPageConnectorCount || 0) + '\n' +
      '页面闸门：' + (page.pageGate && page.pageGate.status || 'BLOCKED') + '\n' +
      '说明：分页和高扇出图形分段只改变表示；每条导线仍以全局 circuitId、netId 和两端精确 PIN 回指同一 EDEM。');
  };

  window.sheetTabKeydown = function (event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!event || !keys.includes(event.key)) return;
    const tabs = Array.from(document.querySelectorAll('#sheet-tabs [role="tab"][data-sheet-id]'));
    if (!tabs.length) return;
    const current = Math.max(0, tabs.indexOf(event.currentTarget));
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length : (current + 1) % tabs.length;
    const target = tabs[index];
    event.preventDefault();
    window.selectSchematicSheet(target.getAttribute('data-sheet-id'));
    const active = document.querySelector('#sheet-tabs [role="tab"][aria-selected="true"]');
    if (active) active.focus();
  };

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
    const ir = state.editor && state.editor.drawingIR;
    const layerCounts = {};
    if (ir) {
      (ir.devices || []).forEach((item) => { layerCounts[item.layer || 'EVSE-EQPT'] = (layerCounts[item.layer || 'EVSE-EQPT'] || 0) + 1; });
      (ir.routes || []).forEach((item) => { layerCounts[item.layer] = (layerCounts[item.layer] || 0) + 1; });
      (ir.markers || []).forEach(() => { layerCounts['EVSE-MARKER'] = (layerCounts['EVSE-MARKER'] || 0) + 1; });
      (ir.annotations || []).forEach((item) => { layerCounts[item.layer] = (layerCounts[item.layer] || 0) + 1; });
    }
    const layers = ((ir && ir.layers) || []).filter((layer) => Number(layerCounts[layer.id] || 0) > 0).map((layer) =>
      '<div class="editor-layer-toggle"><label><input type="checkbox" data-editor-layer="' + escapeHtml(layer.id) + '" ' +
      (state.hiddenLayers.has(layer.id) ? '' : 'checked') + '> <span>' + escapeHtml(layer.id) + '</span></label><span class="muted">' +
      Number(layerCounts[layer.id] || 0) + '</span></div>').join('');
    host.innerHTML = (layers ? '<details open><summary>CAD 图层显示</summary><div class="editor-layer-list">' + layers + '</div></details>' : '') +
      '<div class="muted" style="margin:8px 0">' + catalog.ids.length + ' 类板级符号 · ' +
      Object.keys(board.TEMPLATES).length + ' 个详细功能模板 · ' +
      Number(summary.explicitPointToPointCircuitCount || 0) + ' 条逻辑端口点对点连接（物理封装脚号未决） · ' +
      Number(summary.variantCount || 0) + ' 个候选拓扑<br>' +
      referenceSummary.referenceCount + ' 份真实系统图 · ' + referenceSummary.deviceCount + ' 个器件 · ' +
      referenceSummary.connectionCount + ' 条 partial trace 系统端点关系 · 未决 ' +
      Number(referenceSummary.unresolvedItemCount || 0) + '（明确标注 / 可见走线 / 推断待核分级）</div>' +
      '<details open><summary>真实项目系统参考（只读对照）</summary>' + referenceCards + '</details>' +
      '<details open><summary>详细功能单元模板</summary>' + templates + '</details>' +
      '<details><summary>IEC/GB 风格板级符号（' + catalog.ids.length + '）</summary><div class="editor-symbol-grid">' + symbols + '</div></details>';
    host.querySelectorAll('[data-editor-layer]').forEach((input) => input.addEventListener('change', () => {
      const layer = input.getAttribute('data-editor-layer');
      if (input.checked) state.hiddenLayers.delete(layer); else state.hiddenLayers.add(layer);
      applyLayerVisibility();
    }));
  }

  function applyLayerVisibility() {
    const svg = getSvg(); if (!svg) return;
    svg.querySelectorAll('[data-layer]').forEach((node) => {
      const hidden = state.hiddenLayers.has(node.getAttribute('data-layer'));
      if (hidden) node.setAttribute('data-editor-layer-hidden', 'true');
      else node.removeAttribute('data-editor-layer-hidden');
    });
    document.querySelectorAll('[data-editor-layer]').forEach((input) => {
      input.checked = !state.hiddenLayers.has(input.getAttribute('data-editor-layer'));
    });
  }

  function renderEditorLayerControls() {
    const host = $('editor-layer-controls'); const ir = state.editor && state.editor.drawingIR;
    if (!host || !ir) return;
    const counts = {};
    (ir.devices || []).forEach((item) => { counts[item.layer || 'EVSE-EQPT'] = (counts[item.layer || 'EVSE-EQPT'] || 0) + 1; });
    (ir.routes || []).forEach((item) => { counts[item.layer] = (counts[item.layer] || 0) + 1; });
    (ir.markers || []).forEach(() => { counts['EVSE-MARKER'] = (counts['EVSE-MARKER'] || 0) + 1; });
    (ir.annotations || []).forEach((item) => { counts[item.layer] = (counts[item.layer] || 0) + 1; });
    const rows = (ir.layers || []).filter((layer) => Number(counts[layer.id] || 0) > 0).map((layer) =>
      '<div class="editor-layer-toggle"><label><input type="checkbox" data-editor-layer="' + escapeHtml(layer.id) + '" ' +
      (state.hiddenLayers.has(layer.id) ? '' : 'checked') + '> <span>' + escapeHtml(layer.id) + '</span></label><span class="muted">' +
      Number(counts[layer.id] || 0) + '</span></div>').join('');
    host.innerHTML = rows ? '<details><summary>CAD 图层显示</summary><div class="editor-layer-list">' + rows + '</div></details>' : '';
    host.querySelectorAll('[data-editor-layer]').forEach((input) => input.addEventListener('change', () => {
      const layer = input.getAttribute('data-editor-layer');
      if (input.checked) state.hiddenLayers.delete(layer); else state.hiddenLayers.add(layer);
      applyLayerVisibility();
    }));
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
  function editorCommandOptions() {
    return { grid: state.editorSnap ? state.editorGrid : 0 };
  }
  function syncEditorGridStyle() {
    const box = $('d-pile'); const svg = getSvg(); if (!box || !svg) return;
    const pixels = Math.max(4, Number(state.editorGrid || 5) * Number(state.zoom || 1));
    svg.style.setProperty('--editor-grid-px', pixels + 'px');
    if (state.editorGridVisible) box.removeAttribute('data-editor-grid-hidden');
    else box.setAttribute('data-editor-grid-hidden', 'true');
  }
  window.editorUpdateGridPrefs = function () {
    const grid = Number($('editor-grid') && $('editor-grid').value);
    state.editorGrid = Number.isFinite(grid) && grid > 0 ? grid : 5;
    state.editorSnap = !!($('editor-snap') && $('editor-snap').checked);
    state.editorGridVisible = !!($('editor-grid-visible') && $('editor-grid-visible').checked);
    syncEditorGridStyle();
    setEditorStatus('编辑网格 ' + state.editorGrid + ' 图纸单位 · ' + (state.editorSnap ? '吸附开启' : '自由移动') +
      ' · ' + (state.editorGridVisible ? '网格可见' : '网格隐藏') + '。');
  };
  function updateEditorControls() {
    const snapshot = state.editor && state.editor.snapshot();
    if ($('editor-undo')) $('editor-undo').disabled = !snapshot || !snapshot.canUndo;
    if ($('editor-redo')) $('editor-redo').disabled = !snapshot || !snapshot.canRedo;
    if ($('editor-reset')) $('editor-reset').disabled = !snapshot || snapshot.revision === 0;
    const toggle = $('editor-toggle');
    if (toggle) {
      toggle.textContent = state.editorEnabled ? '✎ 退出编辑' : '✎ 在线编辑';
      toggle.setAttribute('aria-pressed', state.editorEnabled ? 'true' : 'false');
    }
    const workspace = $('editor-workspace');
    if (workspace) {
      const active = document.body.classList.contains('workspace-mode');
      workspace.textContent = active ? '⤢ 返回参数' : '⛶ 全屏工作台';
      workspace.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    const count = state.editor ? state.editor.selections.length : 0;
    if ($('editor-selection-count')) $('editor-selection-count').textContent = '已选 ' + count;
  }
  function setEditorEnabled(enabled) {
    state.editorEnabled = !!enabled && !!state.editor;
    const shell = $('editor-shell'); const box = $('d-pile'); const svg = getSvg();
    if (shell) shell.classList.toggle('active', state.editorEnabled);
    if (box) box.classList.toggle('editor-active', state.editorEnabled);
    if (svg) svg.classList.toggle('editor-active', state.editorEnabled);
    syncEditorGridStyle();
    updateEditorControls();
    if (state.editorEnabled) setEditorStatus('选择工具：左→右框选完全包含对象，右→左框选相交对象；Shift/Ctrl 多选；拖动已选器件可成组跟线，方向键按网格微调。每次提交都会重新运行几何和端点 ERC。');
  }
  window.toggleEditor = function () { setEditorEnabled(!state.editorEnabled); };
  window.toggleConfigPanel = function () {
    document.body.classList.toggle('config-collapsed');
    const collapsed = document.body.classList.contains('config-collapsed');
    const button = $('config-toggle');
    if (button) {
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.setAttribute('aria-label', collapsed ? '展开上方控制台' : '收起上方控制台');
      button.textContent = collapsed ? '⌄ 展开上方控制台' : '⌃ 收起上方控制台';
    }
    setTimeout(() => { if (/^fit-/.test(state.zoomMode)) applyZoom(); }, 0);
  };
  window.toggleInspectorPanels = function () {
    document.body.classList.toggle('inspector-collapsed');
    const collapsed = document.body.classList.contains('inspector-collapsed');
    const button = $('editor-console-toggle');
    if (button) {
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.textContent = collapsed ? '⌄ 展开属性栏' : '⌃ 收起属性栏';
    }
    setTimeout(() => { if (/^fit-/.test(state.zoomMode)) applyZoom(); }, 0);
  };
  window.toggleEditorWorkspace = async function () {
    if (!state.editorEnabled) setEditorEnabled(true);
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else {
        document.body.classList.toggle('workspace-mode');
      }
    } catch (_) {
      document.body.classList.toggle('workspace-mode');
    }
    if (document.fullscreenElement) document.body.classList.add('workspace-mode');
    updateEditorControls();
    setTimeout(() => { applyZoom(); }, 0);
  };

  function initializeSchematicEditor() {
    if (state.editorUnsubscribe) state.editorUnsubscribe();
    state.editor = null; state.editorDrag = null; state.hiddenLayers = new Set();
    const api = window.EVSE_SCHEMATIC_EDITOR;
    if (!api || !state.R || !state.R.drawingIR) {
      setEditorStatus('编辑内核或 Drawing IR 未加载。', true); updateEditorControls(); return;
    }
    try {
      const editingModel = state.activePage && state.activePage.pageModel || state.R.design;
      const sessionKey = state.activeSheetId || '__SYSTEM__';
      state.editor = state.pageEditorSessions[sessionKey] ||
        api.createSession({ drawingIR: state.R.drawingIR, model: editingModel, historyLimit: 100 });
      state.pageEditorSessions[sessionKey] = state.editor;
      if (state.editor.drawingIR !== state.R.drawingIR) {
        state.R.drawingIR = state.editor.drawingIR;
        state.R.drawingGeometryHash = window.EVSE_DRAWING_IR.drawingIRHash(state.editor.drawingIR);
      }
      state.editorUnsubscribe = state.editor.subscribe(() => updateEditorControls());
      renderEditorLibrary(); renderEditorLayerControls(); bindEditorEvents(); bindEditorKeyboard(); renderEditorInspector();
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
    const best = candidates.sort((a, b) => distanceToSegment(point, a) - distanceToSegment(point, b))[0] || null;
    const tolerance = Math.max(4, 8 / Math.max(0.1, Number(state.zoom) || 1));
    return best && distanceToSegment(point, best) <= tolerance ? best : null;
  }
  function clearEditorHighlight() {
    const box = $('d-pile'); if (!box) return;
    box.querySelectorAll('[data-editor-selected="true"]').forEach((node) => node.removeAttribute('data-editor-selected'));
    box.querySelectorAll('[data-editor-primary="true"]').forEach((node) => node.removeAttribute('data-editor-primary'));
  }
  function editorNodeForSelection(selection) {
    if (!selection) return null;
    if (selection.kind === 'device') return document.getElementById('DEVICE-' + selection.id);
    if (selection.kind === 'route') return document.getElementById('ROUTE-' + selection.id);
    if (selection.kind === 'annotation') return Array.from(($('d-pile') || document).querySelectorAll('[data-primitive]'))
      .find((item) => item.getAttribute('data-primitive') === selection.id) || null;
    return null;
  }
  function highlightEditorSelection() {
    clearEditorHighlight();
    if (!state.editor) return;
    state.editor.selections.forEach((item) => {
      const node = editorNodeForSelection(item); if (node) node.setAttribute('data-editor-selected', 'true');
    });
    const primary = editorNodeForSelection(state.editor.selection);
    if (primary) primary.setAttribute('data-editor-primary', 'true');
  }
  function selectEditorObject(target, mode) {
    if (!state.editor) return;
    if (!target) state.editor.select(null, null);
    else if (mode === 'toggle') state.editor.toggleSelection(target.kind, target.id);
    else if (mode === 'add') state.editor.selectMany([{ kind: target.kind, id: target.id }],
      { mode: 'add', primary: { kind: target.kind, id: target.id } });
    else state.editor.select(target.kind, target.id);
    highlightEditorSelection(); renderEditorInspector();
  }

  function renderEditorInspector() {
    const host = $('editor-inspector-content');
    if (!host || !state.editor) return;
    const selected = state.editor.selection; const selectedItems = state.editor.selections;
    if (!selected) {
      host.innerHTML = '<div class="muted">点击、Shift/Ctrl 多选，或在空白处框选对象。左→右只选完全包含对象，右→左选择相交对象。拖动已选器件/图示可原子成组移动。</div>';
      return;
    }
    if (selectedItems.length > 1) {
      const devices = selectedItems.filter((entry) => entry.kind === 'device');
      const routes = selectedItems.filter((entry) => entry.kind === 'route');
      const annotations = selectedItems.filter((entry) => entry.kind === 'annotation');
      host.innerHTML = '<div class="inspector-row"><span>多选</span><b>' + selectedItems.length + ' 个对象</b></div>' +
        '<div class="inspector-row"><span>构成</span><span>器件 ' + devices.length + ' · 导线 ' + routes.length + ' · 图示/文字 ' + annotations.length + '</span></div>' +
        (devices.length >= 2 ? '<div class="muted" style="margin-top:8px">以橙色主选器件为基准对齐；对齐/分布均为一次事务，失败整组回滚。</div>' +
          '<div class="editor-command-grid"><button class="mini-btn" onclick="editorAlignSelected(\'left\')">左对齐</button>' +
          '<button class="mini-btn" onclick="editorAlignSelected(\'centerX\')">水平居中</button><button class="mini-btn" onclick="editorAlignSelected(\'right\')">右对齐</button>' +
          '<button class="mini-btn" onclick="editorAlignSelected(\'top\')">顶对齐</button><button class="mini-btn" onclick="editorAlignSelected(\'centerY\')">垂直居中</button>' +
          '<button class="mini-btn" onclick="editorAlignSelected(\'bottom\')">底对齐</button></div>' : '') +
        (devices.length >= 3 ? '<div class="editor-command-grid" style="grid-template-columns:1fr 1fr"><button class="mini-btn" onclick="editorDistributeSelected(\'horizontal\')">水平等距</button>' +
          '<button class="mini-btn" onclick="editorDistributeSelected(\'vertical\')">垂直等距</button></div>' : '') +
        '<details open><summary>所选对象</summary><div class="inspector-pins">' + selectedItems.slice(0, 80).map((entry) =>
          '<div class="editor-object"><b>' + escapeHtml(entry.kind) + '</b> · ' + escapeHtml(entry.id) + '</div>').join('') + '</div></details>';
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
        (item.ports || []).map((port) => {
          const connections = state.editor.connectionsForPort(item.id, port.id);
          return '<div class="editor-object"><b>' + escapeHtml(port.terminalId || port.id) + '</b> · ' +
            escapeHtml(port.label || '') + '<br>' + escapeHtml(port.ref + ' @ ' + port.x + ',' + port.y) +
            (connections.length ? '<br><span style="color:#78d8a4">' + connections.map((wire) =>
              escapeHtml(wire.netId + ' · ' + wire.routeId + ' → 真实对端 ' + wire.oppositeRef +
                (wire.graphicalOppositeRef && wire.graphicalOppositeRef !== wire.oppositeRef
                  ? '（本页图形续接 ' + wire.graphicalOppositeRef + '）' : '') +
                (wire.remoteDrawingNo ? ' · ' + wire.remoteDrawingNo : ''))).join('<br>') + '</span>' :
              '<br><span style="color:#e3b341">当前图无已建模连接</span>') + '</div>';
        }).join('') + '</div></details>';
    } else if (selected.kind === 'route') {
      const globalSource = item.globalSource || item.source;
      const globalTarget = item.globalTarget || item.target;
      const hasGraphicalProjection = globalSource.ref !== item.source.ref || globalTarget.ref !== item.target.ref;
      const connector = item.offPageConnector || null;
      host.innerHTML = '<div class="inspector-row"><span>导线ID</span><b>' + escapeHtml(item.id) + '</b></div>' +
        '<div class="inspector-row"><span>网络</span><span>' + escapeHtml(item.netId) + '</span></div>' +
        '<div class="inspector-row"><span>回路</span><span>' + escapeHtml(item.circuitId) + '</span></div>' +
        '<div class="inspector-row"><span>真实起点PIN</span><span>' + escapeHtml(globalSource.ref) + '</span></div>' +
        '<div class="inspector-row"><span>真实终点PIN</span><span>' + escapeHtml(globalTarget.ref) + '</span></div>' +
        (hasGraphicalProjection ? '<div class="inspector-row"><span>本页图形端点</span><span>' +
          escapeHtml(item.source.ref + ' → ' + item.target.ref) + '</span></div>' : '') +
        (connector ? '<div class="inspector-row"><span>跨页续接</span><span>' +
          escapeHtml(connector.id + ' → ' + connector.remoteSheetId + ' / ' +
            (connector.xref && connector.xref.drawingNo || '—') + ' p' +
            (connector.xref && connector.xref.page || '—') + ' · ' +
            (connector.xref && connector.xref.endpointKey || '—')) + '</span></div>' : '') +
        '<div class="inspector-row"><span>层</span><span>' + escapeHtml(item.layer) + '</span></div>' +
        '<div class="inspector-row"><span>编辑路由</span><span>正交 · 器件硬避让 · 交叉统一后处理</span></div>' +
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
    applyEditorCommand(state.editor.moveDevice(item.id, x - oldX, y - oldY, editorCommandOptions()));
  };
  window.editorAlignSelected = function (mode) {
    if (!state.editor) return;
    const ids = state.editor.selections.filter((entry) => entry.kind === 'device').map((entry) => entry.id);
    const primary = state.editor.selection && state.editor.selection.kind === 'device' ? state.editor.selection.id : ids[0];
    applyEditorCommand(state.editor.alignDevices(ids, mode, { anchorId: primary, grid: 0 }));
  };
  window.editorDistributeSelected = function (axis) {
    if (!state.editor) return;
    const ids = state.editor.selections.filter((entry) => entry.kind === 'device').map((entry) => entry.id);
    applyEditorCommand(state.editor.distributeDevices(ids, axis, { grid: 0 }));
  };
  window.editorApplyAnnotationText = function () {
    const selection = state.editor && state.editor.selection;
    if (!selection || selection.kind !== 'annotation') return;
    applyEditorCommand(state.editor.editAnnotationText(selection.id, $('editor-annotation-text').value));
  };

  function previewPath(points) {
    return (points || []).map((point, index) => (index ? 'L' : 'M') + Number(point.x) + ' ' + Number(point.y)).join(' ');
  }
  function clearEditorPreview(drag) {
    const svg = getSvg();
    const group = svg && svg.querySelector('#EVSE-EDITOR-PREVIEW');
    if (group) group.remove();
    ((drag && drag.previewMutedNodes) || []).forEach((node) => node.removeAttribute('data-editor-preview-muted'));
    if (drag) drag.previewMutedNodes = [];
  }
  function renderEditorRoutePreview(routes, invalid, drag) {
    const svg = getSvg(); if (!svg) return;
    clearEditorPreview(drag);
    const namespace = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(namespace, 'g');
    group.setAttribute('id', 'EVSE-EDITOR-PREVIEW');
    if (invalid) group.setAttribute('data-invalid', 'true');
    (routes || []).forEach((route) => {
      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('class', 'editor-route-preview');
      path.setAttribute('d', previewPath(route.points));
      path.setAttribute('data-preview-route', route.id);
      group.appendChild(path);
      const original = document.getElementById('ROUTE-' + route.id);
      if (original) {
        original.setAttribute('data-editor-preview-muted', 'true');
        drag.previewMutedNodes.push(original);
      }
    });
    svg.appendChild(group);
  }
  function clearEditorMarquee() {
    const svg = getSvg(); const group = svg && svg.querySelector('#EVSE-EDITOR-MARQUEE');
    if (group) group.remove();
  }
  function renderEditorMarquee(drag) {
    const svg = getSvg(); if (!svg) return;
    clearEditorMarquee();
    const current = drag.current || drag.start; const namespace = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(namespace, 'g'); const box = document.createElementNS(namespace, 'rect');
    drag.marqueeMode = current.x >= drag.start.x ? 'contained' : 'intersect';
    group.setAttribute('id', 'EVSE-EDITOR-MARQUEE'); group.setAttribute('data-mode', drag.marqueeMode);
    box.setAttribute('x', Math.min(drag.start.x, current.x)); box.setAttribute('y', Math.min(drag.start.y, current.y));
    box.setAttribute('width', Math.abs(current.x - drag.start.x)); box.setAttribute('height', Math.abs(current.y - drag.start.y));
    group.appendChild(box); svg.appendChild(group);
  }
  function restoreDraggedNodes(drag) {
    ((drag && drag.nodes) || []).forEach((entry) => {
      entry.node.removeAttribute('data-editor-dragging');
      if (entry.transform) entry.node.setAttribute('transform', entry.transform); else entry.node.removeAttribute('transform');
    });
  }
  function cancelEditorDrag(message) {
    const drag = state.editorDrag; if (!drag) return false;
    state.editorDrag = null; restoreDraggedNodes(drag); clearEditorPreview(drag); clearEditorMarquee();
    highlightEditorSelection();
    setEditorStatus(message || '已取消本次拖动，图纸未发生变化。');
    return true;
  }
  function selectionIsHidden(item) {
    const value = state.editor && state.editor.inspect(item.kind, item.id);
    const layer = value && (value.layer || (item.kind === 'device' ? 'EVSE-EQPT' : ''));
    return !!(layer && state.hiddenLayers.has(layer));
  }
  function movableEditorSelections() {
    return (state.editor ? state.editor.selections : []).filter((item) =>
      ['device', 'annotation'].includes(item.kind) && !selectionIsHidden(item));
  }
  function nudgeEditorSelection(dx, dy) {
    const items = movableEditorSelections();
    if (!items.length) { setEditorStatus('当前选择中没有可移动的器件或图示对象。', true); return; }
    applyEditorCommand(state.editor.moveObjects(items, dx, dy, { grid: 0 }));
  }
  function bindEditorKeyboard() {
    if (state.editorKeyboardBound) return;
    state.editorKeyboardBound = true;
    document.addEventListener('keydown', (event) => {
      if (!state.editorEnabled || !state.editor) return;
      const target = event.target; const tag = String(target && target.tagName || '').toLowerCase();
      const typing = ['input', 'textarea', 'select'].includes(tag) || (target && target.isContentEditable);
      if (event.key === 'Escape') {
        if (typing && target.blur) target.blur();
        if (!cancelEditorDrag()) selectEditorObject(null);
        event.preventDefault(); return;
      }
      if (typing) return;
      const key = String(event.key || '').toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z' && !event.shiftKey) { event.preventDefault(); window.editorUndo(); }
        else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); window.editorRedo(); }
        else if (key === 'a') {
          event.preventDefault();
          const items = state.editor.drawingIR.devices.map((item) => ({ kind: 'device', id: item.id }))
            .concat(state.editor.drawingIR.annotations.map((item) => ({ kind: 'annotation', id: item.id })))
            .filter((item) => !selectionIsHidden(item));
          state.editor.selectMany(items, { mode: 'replace', primary: items[items.length - 1] });
          highlightEditorSelection(); renderEditorInspector(); updateEditorControls();
          setEditorStatus('已选择当前可见的 ' + items.length + ' 个器件与图示对象；导线保持可单击检查。');
        }
        return;
      }
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault(); const base = state.editorSnap ? state.editorGrid : 1; const step = event.shiftKey ? base * 5 : base;
        if (key === 'arrowleft') nudgeEditorSelection(-step, 0);
        if (key === 'arrowright') nudgeEditorSelection(step, 0);
        if (key === 'arrowup') nudgeEditorSelection(0, -step);
        if (key === 'arrowdown') nudgeEditorSelection(0, step);
      }
    });
  }

  function bindEditorEvents() {
    const svg = getSvg(); if (!svg || !state.editor) return;
    svg.classList.toggle('editor-active', state.editorEnabled);
    svg.querySelectorAll('g[id^="DEVICE-"],g[id^="ROUTE-"]').forEach((node) => {
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
      if (!node.hasAttribute('role')) node.setAttribute('role', 'button');
      if (!node.hasAttribute('aria-label')) {
        const target = editorTarget(node);
        node.setAttribute('aria-label', target ? (target.kind === 'device' ? '元器件 ' : '导线 ') + target.id : '电气图对象');
      }
    });
    svg.addEventListener('keydown', (event) => {
      if (!state.editorEnabled || !['Enter', ' '].includes(event.key)) return;
      const target = editorTarget(event.target);
      if (!target) return;
      selectEditorObject(target, event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace');
      event.preventDefault(); event.stopPropagation();
    });
    svg.addEventListener('pointerdown', (event) => {
      if (!state.editorEnabled || event.button !== 0) return;
      const target = editorTarget(event.target); const start = svgPoint(svg, event);
      const modifierMode = event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace';
      if (target && modifierMode !== 'replace') {
        selectEditorObject(target, modifierMode); event.preventDefault(); event.stopPropagation(); return;
      }
      if (!target) {
        state.editorDrag = { kind: 'marquee', pointerId: event.pointerId, start, current: start,
          clientStart: { x: event.clientX, y: event.clientY }, clientCurrent: { x: event.clientX, y: event.clientY },
          selectionMode: modifierMode, active: false, nodes: [], previewMutedNodes: [] };
      } else {
        const selected = state.editor.selections.some((item) => item.kind === target.kind && item.id === target.id);
        if (!selected) selectEditorObject(target);
        let segment = null;
        if (target.kind === 'route') segment = nearestEditableSegment(state.editor.inspect('route', target.id), start);
        if (target.kind === 'route' && !segment) {
          setEditorStatus('导线已选中；该导线没有可拖动的中间线段，端子邻接段保持锁定。');
          event.preventDefault(); event.stopPropagation(); return;
        }
        const items = target.kind === 'route' ? [{ kind: 'route', id: target.id }] : movableEditorSelections();
        const nodes = items.map((item) => ({ item, node: editorNodeForSelection(item) })).filter((entry) => entry.node)
          .map((entry) => Object.assign(entry, { transform: entry.node.getAttribute('transform') || '' }));
        state.editorDrag = { kind: target.kind === 'route' ? 'route-segment' : 'move-selection', pointerId: event.pointerId,
          target, items, nodes, start, current: start, clientStart: { x: event.clientX, y: event.clientY },
          clientCurrent: { x: event.clientX, y: event.clientY }, segment, active: false, previewMutedNodes: [] };
        nodes.forEach((entry) => entry.node.setAttribute('data-editor-dragging', 'true'));
      }
      if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
      event.preventDefault(); event.stopPropagation();
    });
    svg.addEventListener('pointermove', (event) => {
      const drag = state.editorDrag; if (!drag || drag.pointerId !== event.pointerId) return;
      drag.current = svgPoint(svg, event); drag.clientCurrent = { x: event.clientX, y: event.clientY };
      const screenDistance = Math.hypot(drag.clientCurrent.x - drag.clientStart.x, drag.clientCurrent.y - drag.clientStart.y);
      if (!drag.active && screenDistance < 4) return;
      drag.active = true;
      const dx = drag.current.x - drag.start.x; const dy = drag.current.y - drag.start.y;
      if (drag.kind === 'marquee') {
        renderEditorMarquee(drag);
        setEditorStatus((drag.current.x >= drag.start.x ? '窗口框选：仅选择完全包含对象' : '交叉框选：选择所有相交对象') + '；松开完成选择。');
      } else if (drag.kind === 'move-selection') {
        try {
          const preview = state.editor.previewObjectMove(drag.items, dx, dy, editorCommandOptions());
          drag.nodes.forEach((entry) => entry.node.setAttribute('transform', (entry.transform ? entry.transform + ' ' : '') +
            'translate(' + preview.dx + ' ' + preview.dy + ')'));
          renderEditorRoutePreview(preview.routes, !preview.placementOk, drag);
          setEditorStatus((preview.placementOk ? '成组跟线预览' : '⛔ 成组落点无效') + ' · ' + preview.items.length +
            ' 个对象 · ' + preview.routes.length + ' 条端子导线同步移动；松开后单事务避让/ERC。', !preview.placementOk);
        } catch (error) { setEditorStatus('预览失败：' + humanError(error), true); }
      } else {
        const delta = drag.segment.orientation === 'horizontal' ? dy : dx;
        try {
          const preview = state.editor.previewRouteSegment(drag.target.id, drag.segment.index, delta, editorCommandOptions());
          renderEditorRoutePreview([preview], false, drag);
          const snapped = state.editorSnap ? Math.round(delta / state.editorGrid) * state.editorGrid : delta;
          setEditorStatus('导线 ' + drag.target.id + ' · S' + drag.segment.index + ' 预移动 ' + Number(snapped.toFixed(2)) +
            '；松开后挤推重布冲突导线并执行 ERC。');
        } catch (error) { setEditorStatus('预览失败：' + humanError(error), true); }
      }
      event.preventDefault();
    });
    const finish = (event) => {
      const drag = state.editorDrag; if (!drag || drag.pointerId !== event.pointerId) return;
      state.editorDrag = null;
      restoreDraggedNodes(drag); clearEditorPreview(drag); clearEditorMarquee();
      if (event.type === 'pointercancel') {
        highlightEditorSelection(); setEditorStatus('指针操作已取消，图纸未发生变化。'); return;
      }
      const current = drag.current || drag.start; const dx = current.x - drag.start.x; const dy = current.y - drag.start.y;
      if (!drag.active) {
        if (drag.kind === 'marquee' && drag.selectionMode === 'replace') selectEditorObject(null);
        highlightEditorSelection(); renderEditorInspector(); updateEditorControls(); return;
      }
      if (drag.kind === 'marquee') {
        const bounds = { x: Math.min(drag.start.x, current.x), y: Math.min(drag.start.y, current.y),
          width: Math.abs(current.x - drag.start.x), height: Math.abs(current.y - drag.start.y) };
        const matches = state.editor.queryRect(bounds, { mode: drag.marqueeMode }).filter((item) => !selectionIsHidden(item));
        state.editor.selectMany(matches, { mode: drag.selectionMode, primary: matches[matches.length - 1] });
        highlightEditorSelection(); renderEditorInspector(); updateEditorControls();
        setEditorStatus((drag.marqueeMode === 'contained' ? '窗口框选' : '交叉框选') + '完成：命中 ' + matches.length +
          ' 个可见对象，当前共选择 ' + state.editor.selections.length + ' 个。');
        event.preventDefault(); return;
      }
      let response;
      if (drag.kind === 'move-selection') response = state.editor.moveObjects(drag.items, dx, dy, editorCommandOptions());
      else response = state.editor.moveRouteSegment(drag.target.id, drag.segment.index,
        drag.segment.orientation === 'horizontal' ? dy : dx, editorCommandOptions());
      applyEditorCommand(response);
      event.preventDefault();
    };
    svg.addEventListener('pointerup', finish); svg.addEventListener('pointercancel', finish);
    highlightEditorSelection(); applyLayerVisibility();
  }

  function rerenderEditedDrawing() {
    if (!state.editor || !state.R) return;
    const renderer = window.EVSE_SVG_IR_RENDERER; const skill = window.EVSE_DRAWING_SKILL;
    const ir = state.editor.drawingIR;
    const basePage = state.activePage;
    const compiled = Object.assign({}, basePage && basePage.compiled || state.R.drawingCompiled || {}, { drawingIR: ir });
    state.R.drawingCompiled = compiled; state.R.drawingIR = ir;
    state.R.drawingGeometryHash = window.EVSE_DRAWING_IR.drawingIRHash(ir);
    state.R.editableDocument = state.editor.exportDocument();
    state.R.editableDocuments = state.R.editableDocuments || {};
    if (state.activeSheetId) state.R.editableDocuments[state.activeSheetId] = state.R.editableDocument;
    else state.R.schematicQuality = window.EVSE_SCHEMATIC_QUALITY.reviewSystem({ design: state.R.design, drawingIR: ir });
    const markup = renderer.render(compiled, state.R, basePage ? pageRenderOptions(basePage) : undefined);
    $('d-pile').innerHTML = markup; state.svg = markup;
    if (basePage) {
      const pageApi = window.EVSE_SCHEMATIC_SHEET_RENDERING || window.SCHEMATIC_FORGE_SHEET_RENDERING;
      const pageGate = pageApi && typeof pageApi.evaluatePage === 'function'
        ? pageApi.evaluatePage(state.R, state.schematicDocument, state.activeSheetId, compiled, markup)
        : { status: 'BLOCKED', allowed: false, quality: { checks: [] }, coverage: {} };
      const edited = Object.assign({}, basePage, {
        compiled, svg: markup, pageGate,
        geometryHash: state.R.drawingGeometryHash,
        editableDocument: state.R.editableDocument
      });
      state.pageEdits[state.activeSheetId] = edited;
      if (pageApi && typeof pageApi.evaluateDocument === 'function' && state.renderedSchematicDocument) {
        const reevaluated = pageApi.evaluateDocument(state.R, state.renderedSchematicDocument, state.pageEdits);
        state.renderedSchematicDocument = reevaluated;
        state.schematicDocument = reevaluated.document;
        const evaluatedPage = reevaluated.pages.find((item) => item.sheetId === state.activeSheetId) || edited;
        state.pageEdits[state.activeSheetId] = evaluatedPage;
        state.activePage = evaluatedPage;
        state.activePageGate = evaluatedPage.pageGate;
      } else {
        state.activePage = edited;
        state.activePageGate = pageGate;
        state.schematicDocument = Object.assign({}, state.schematicDocument || {}, {
          status: 'BLOCKED', projectGate: { status: 'BLOCKED', allowed: false,
            blockedSheetIds: [state.activeSheetId], code: 'PROJECT_REEVALUATION_NOT_AVAILABLE' }
        });
      }
      if (state.R.activeSheet) state.R.activeSheet.status = state.activePageGate.status;
      $('d-pile').dataset.drawingRuleStatus = state.activePageGate.status;
      renderSheetTabs();
    } else if (skill && typeof skill.auditMarkup === 'function') {
      const audit = skill.auditMarkup(markup, DRAWING_KEY, state.R);
      skill.recordDrawingAudit(state.R, DRAWING_KEY, audit);
      $('d-pile').dataset.drawingRuleStatus = audit.status;
      if (typeof skill.finalizeDrawingAudits === 'function') skill.finalizeDrawingAudits(state.R);
    }
    stampAudit(); applyZoom(); bindEditorEvents(); applyLayerVisibility(); renderEditorInspector(); renderQualityStatus(); updateEditorControls();
  }
  function applyEditorCommand(response) {
    if (!response) return;
    if (!response.accepted) {
      const counts = response.details && ((response.details.violations || []).length + (response.details.coverageErrors || []).length);
      setEditorStatus('⛔ ' + (response.message || response.code) + (counts ? '（' + counts + ' 项违规）' : ''), true);
      highlightEditorSelection(); updateEditorControls(); return;
    }
    rerenderEditedDrawing();
    const payload = response.command.payload || {};
    const rerouted = (payload.reroutedRouteIds || []).length;
    const displaced = (payload.displacedRouteIds || []).length;
    setEditorStatus('已提交 ' + response.command.type + ' · 修订 ' + response.command.revision +
      (rerouted ? ' · 自动复核/重布 ' + rerouted + ' 条' : '') +
      (displaced ? ' · 挤推重布 ' + displaced + ' 条相邻导线' : '') + ' · ' + response.command.geometryHash +
      '；器件硬避让、全局交叉后处理和端点 ERC 通过。');
  }
  window.editorUndo = function () { if (state.editor) applyEditorCommand(state.editor.undo()); };
  window.editorRedo = function () { if (state.editor) applyEditorCommand(state.editor.redo()); };
  window.editorReset = function () { if (state.editor) applyEditorCommand(state.editor.reset()); };

  /* ---------- 工程画布缩放与平移（视图操作不修改 Drawing IR） ---------- */
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
    const availableWidth = Math.max(80, Number((host && host.clientWidth) || baseWidth) - 20);
    if (state.zoomMode === 'fit-width') {
      state.zoom = Math.max(0.02, Math.min(2, availableWidth / baseWidth));
    } else if (state.zoomMode === 'fit-sheet') {
      const availableHeight = Math.max(80, Number((host && host.clientHeight) || window.innerHeight || 800) - 20);
      state.zoom = Math.max(0.02, Math.min(2, availableWidth / baseWidth, availableHeight / baseHeight));
    }
    svg.style.width = (baseWidth * state.zoom) + 'px';
    svg.style.height = (baseHeight * state.zoom) + 'px';
    const label = $('zoom-label');
    const sheet = state.R && state.R.drawingSheet;
    const mode = state.zoomMode === 'fit-width' ? '适宽' : state.zoomMode === 'fit-sheet' ? '适页' : '手动';
    if (label) label.textContent = mode + ' · ' + (state.zoom * 100).toFixed(state.zoom < 0.1 ? 1 : 0) + '%' +
      (sheet && sheet.format ? ' · ' + sheet.format : '');
    syncEditorGridStyle();
  }
  function setManualZoom(nextZoom, clientX, clientY) {
    const host = $('d-pile');
    const oldZoom = state.zoom || 1;
    const rect = host && host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 };
    const offsetX = Number.isFinite(clientX) ? clientX - rect.left : Number(host && host.clientWidth || 0) / 2;
    const offsetY = Number.isFinite(clientY) ? clientY - rect.top : Number(host && host.clientHeight || 0) / 2;
    const drawingX = host ? (host.scrollLeft + offsetX) / oldZoom : 0;
    const drawingY = host ? (host.scrollTop + offsetY) / oldZoom : 0;
    state.zoomMode = 'manual';
    state.zoom = Math.max(0.02, Math.min(8, Number(nextZoom) || oldZoom));
    applyZoom();
    if (host) {
      host.scrollLeft = drawingX * state.zoom - offsetX;
      host.scrollTop = drawingY * state.zoom - offsetY;
    }
  }
  window.zoomIn = function () { setManualZoom(state.zoom * 1.2); };
  window.zoomOut = function () { setManualZoom(state.zoom / 1.2); };
  window.zoomActual = function () { setManualZoom(1); };
  window.zoomFitWidth = function () { state.zoomMode = 'fit-width'; applyZoom(); };
  window.zoomFitSheet = function () { state.zoomMode = 'fit-sheet'; applyZoom(); };
  window.addEventListener('resize', () => { if (/^fit-/.test(state.zoomMode)) applyZoom(); });

  function bindViewportNavigation() {
    if (state.viewportBound) return;
    const host = $('d-pile');
    if (!host) return;
    state.viewportBound = true;
    host.addEventListener('wheel', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.002);
      setManualZoom(state.zoom * factor, event.clientX, event.clientY);
    }, { passive: false });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(event.target && event.target.tagName || '')) {
        state.viewportSpaceDown = true;
        host.style.cursor = 'grab';
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        state.viewportSpaceDown = false;
        if (!state.viewportPan) host.style.cursor = '';
      }
    });
    host.addEventListener('pointerdown', (event) => {
      if (!(event.button === 1 || (event.button === 0 && state.viewportSpaceDown))) return;
      state.viewportPan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        left: host.scrollLeft, top: host.scrollTop };
      host.setPointerCapture(event.pointerId);
      host.style.cursor = 'grabbing';
      event.preventDefault();
      event.stopPropagation();
    }, true);
    host.addEventListener('pointermove', (event) => {
      const pan = state.viewportPan;
      if (!pan || pan.pointerId !== event.pointerId) return;
      host.scrollLeft = pan.left - (event.clientX - pan.x);
      host.scrollTop = pan.top - (event.clientY - pan.y);
      event.preventDefault();
      event.stopPropagation();
    }, true);
    const endPan = (event) => {
      const pan = state.viewportPan;
      if (!pan || pan.pointerId !== event.pointerId) return;
      state.viewportPan = null;
      host.style.cursor = state.viewportSpaceDown ? 'grab' : '';
      event.preventDefault();
      event.stopPropagation();
    };
    host.addEventListener('pointerup', endPan, true);
    host.addEventListener('pointercancel', endPan, true);
  }

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
    if (state.activePageGate) {
      const gate = state.activePageGate;
      (gate.quality && gate.quality.checks || []).forEach((check) => {
        const message = check.code + '：' + check.detail;
        if (check.ok) passes.push(message); else issues.push(message + ' [' + check.severity + ']');
      });
      if (gate.coverage && gate.coverage.ok) {
        passes.push('PAGE-COVERAGE：' + gate.coverage.renderedCircuitCount + '/' + gate.coverage.expectedCircuitCount +
          ' 条回路、' + gate.coverage.renderedOffPageConnectorCount + '/' + gate.coverage.expectedOffPageConnectorCount + ' 个跨页续接符精确覆盖。');
      } else issues.push('PAGE-COVERAGE：当前页图形投影与全局 EDEM 不等价 [BLOCKING]');
    } else if (skill && typeof skill.auditMarkup === 'function') {
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

  async function requestEngineering(payload) {
    const response = await fetch(ENGINEERING_API, {
      method: 'POST', headers: authenticatedJsonHeaders(),
      body: JSON.stringify(payload || {})
    });
    let body = null;
    try { body = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok || !body || body.ok === false) {
      throw new Error((body && (body.error || body.message)) || ('工程 AI 请求失败（' + response.status + '）'));
    }
    return body.data || body.result || body;
  }

  function updateEngineeringAccessState() {
    const host = $('engineering-ai-status');
    const status = state.engineeringStatus || {};
    const configured = !!status.configured;
    const tokenPresent = !!engineeringAccessToken();
    const ready = configured && tokenPresent;
    if (host) {
      if (!status.providerConfigured) host.textContent = '工程 AI 模型尚未由服务端配置；本地 EDEM/ERC/几何/经验规则仍可独立运行。';
      else if (!status.accessControlConfigured) host.textContent = '工程 AI 访问控制未配置，公网模型功能已按安全策略关闭。';
      else if (!tokenPresent) host.textContent = '受控工程 AI 已配置；请输入站点管理员分配的访问令牌后启用候选审图与数据手册检索。';
      else host.textContent = '访问令牌仅保存在当前页面内存。上传内容只用于本次候选审查；AI 不能修改 EDEM、批准物料或签发图纸。';
    }
    if ($('ai-review-button')) $('ai-review-button').disabled = !ready;
    if ($('bom-research-button')) $('bom-research-button').disabled = !ready;
  }
  async function loadEngineeringStatus() {
    const host = $('engineering-ai-status');
    try {
      const response = await fetch(ENGINEERING_API + '?action=status', {
        method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store'
      });
      if (!response.ok) throw new Error('status ' + response.status);
      const body = await response.json();
      const data = body && (body.data || body.result || body) || {};
      const configured = !!(data.configured || data.openai || data.available);
      state.engineeringStatus = Object.assign({}, data, { configured });
      updateEngineeringAccessState();
    } catch (_) {
      state.engineeringStatus = { configured: false, providerConfigured: false, accessControlConfigured: false };
      if (host) host.textContent = '未检测到受控工程 AI 服务；本地审图不受影响。';
      if ($('ai-review-button')) $('ai-review-button').disabled = true;
      if ($('bom-research-button')) $('bom-research-button').disabled = true;
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, Math.min(index + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  async function readReviewAttachment(file) {
    if (!file) return null;
    const allowed = new Set(['image/svg+xml', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/json']);
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const fallback = { svg: 'image/svg+xml', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
      jpeg: 'image/jpeg', webp: 'image/webp', json: 'application/json' }[extension];
    const mimeType = allowed.has(file.type) ? file.type : fallback;
    if (!mimeType || !allowed.has(mimeType)) throw new Error('仅支持 SVG、PDF、PNG、JPG、WebP 或 JSON。');
    if (!file.size || file.size > 2.5 * 1024 * 1024) throw new Error('待审文件必须不大于 2.5 MiB。');
    const buffer = await file.arrayBuffer();
    const digest = window.crypto && window.crypto.subtle
      ? await window.crypto.subtle.digest('SHA-256', buffer) : null;
    const sha256 = digest ? Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('') : '';
    return {
      name: String(file.name || 'drawing').slice(0, 180), mimeType, byteLength: file.size,
      sha256: sha256 ? 'sha256-' + sha256 : '', dataBase64: bytesToBase64(new Uint8Array(buffer)), buffer
    };
  }

  function reviewFindingMarkup(entry) {
    const level = escapeHtml(entry.severity || 'WARN');
    const color = level === 'BLOCK' || level === 'ERROR' ? '#f85149' : level === 'WARN' ? '#e3b341' : '#7fb8e8';
    const evidence = Array.isArray(entry.evidence) && entry.evidence.length
      ? '<br><span style="color:var(--text2)">证据/定位：' + entry.evidence.map(escapeHtml).join('；') + '</span>' : '';
    return '<div class="editor-object" style="border-color:#29466f;margin-bottom:5px"><b style="color:' + color + '">' +
      level + ' · ' + escapeHtml(entry.category || 'GENERAL') + '</b>　' + escapeHtml(entry.title || entry.id || '审查意见') +
      '<br>' + escapeHtml(entry.detail || '') + evidence + '</div>';
  }

  function renderEngineeringReview(candidate, localCase) {
    const host = $('engineering-review-output');
    if (!host) return;
    const local = localCase && Array.isArray(localCase.localFindings) ? localCase.localFindings : [];
    const ai = candidate && Array.isArray(candidate.findings) ? candidate.findings : [];
    const unresolved = candidate && Array.isArray(candidate.unresolvedItems) ? candidate.unresolvedItems : [];
    host.innerHTML =
      (candidate ? '<div class="candidate-banner"><b>CANDIDATE / UNREVIEWED</b> · ' + escapeHtml(candidate.disclaimer ||
        'AI意见不改变模型、规则结论或发布状态。') + '</div>' : '') +
      (candidate && candidate.summary ? '<div style="margin-bottom:8px"><b>AI 摘要：</b>' + escapeHtml(candidate.summary) + '</div>' : '') +
      '<details open><summary>确定性规则发现（' + local.length + '）</summary>' +
      (local.length ? local.map(reviewFindingMarkup).join('') : '<div class="editor-object">当前没有本地规则问题，仍不代表完成专业校审。</div>') + '</details>' +
      (candidate ? '<details open><summary>AI 待复核发现（' + ai.length + '）</summary>' +
        (ai.length ? ai.map(reviewFindingMarkup).join('') : '<div class="editor-object">AI 未返回可用结构化发现。</div>') + '</details>' : '') +
      (unresolved.length ? '<details open><summary>未决项（' + unresolved.length + '）</summary><div class="editor-object">' +
        unresolved.map(escapeHtml).join('<br>') + '</div></details>' : '');
  }

  window.runDeterministicEngineeringReview = async function () {
    const module = window.SCHEMATIC_ENGINEERING_REVIEW;
    const input = $('review-file');
    const file = input && input.files && input.files[0];
    try {
      if (!state.R && !file) throw new Error('请先生成方案或选择一份待审图纸。');
      if (!state.R && file) {
        const attachment = await readReviewAttachment(file);
        const host = $('engineering-review-output');
        host.innerHTML = '<div class="candidate-banner">文件结构检查不等于电气审查。</div>' +
          '<div>已读取：' + escapeHtml(attachment.name) + ' · ' + escapeHtml(attachment.mimeType) + ' · ' +
          numberText(attachment.byteLength) + ' bytes<br>独立上传图没有对应 EDEM，无法在本地证明 PIN→PIN、网络完整性或图模等价；请运行 AI 候选审查并由工程师复核。</div>';
        return;
      }
      if (!module || typeof module.buildCase !== 'function') throw new Error('工程审图封装模块未加载。');
      const reviewCase = module.buildCase(state.R);
      state.engineeringReviewCase = reviewCase;
      renderEngineeringReview(null, reviewCase);
    } catch (error) {
      $('engineering-review-output').textContent = '本地审图未完成：' + humanError(error);
    }
  };

  window.runAiEngineeringReview = async function () {
    const button = $('ai-review-button');
    const module = window.SCHEMATIC_ENGINEERING_REVIEW;
    const input = $('review-file');
    const file = input && input.files && input.files[0];
    try {
      if (!state.R && !file) throw new Error('请先生成方案或选择一份待审图纸。');
      if (button) { button.disabled = true; button.textContent = '正在审图…'; }
      const attachment = file ? await readReviewAttachment(file) : null;
      const reviewCase = state.R && module && typeof module.buildCase === 'function'
        ? module.buildCase(state.R, attachment ? { file: attachment } : null)
        : { schema: 'schematic-engineering-review/v1', subject: { domain: 'EVSE', uploadedOnly: true },
          reviewPolicy: { aiRole: 'OBSERVATION_ONLY', lifecycle: 'CANDIDATE', humanApprovalRequired: true } };
      state.engineeringReviewCase = reviewCase;
      const payload = { action: 'review', context: reviewCase };
      if (attachment) payload.file = {
        name: attachment.name, mimeType: attachment.mimeType, base64: attachment.dataBase64
      };
      const response = await requestEngineering(payload);
      const raw = response.candidate || response.review || response;
      const candidate = module && typeof module.normaliseCandidate === 'function'
        ? module.normaliseCandidate(raw, reviewCase) : raw;
      state.engineeringReviewCandidate = candidate;
      renderEngineeringReview(candidate, reviewCase);
    } catch (error) {
      $('engineering-review-output').textContent = 'AI 审图未完成：' + humanError(error) + '。本地确定性设计与闸门没有被修改。';
    } finally {
      if (button) button.textContent = 'AI + 知识库审图';
      updateEngineeringAccessState();
    }
  };

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function drawingName() {
    const base = ((state.R && state.R.pileName) || '充电桩') + '_电气原理图';
    const sheet = state.activePage && state.activePage.sheet;
    return sheet ? base + '_' + (sheet.drawingNo || sheet.id || state.activeSheetId) : base;
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
    if (state.activePage) {
      const report = state.R && state.R.drawingSkill || {};
      const graph = report.graphValidation || {};
      const globalAudit = report.drawingAudits && report.drawingAudits[DRAWING_KEY];
      const projectGate = state.schematicDocument && state.schematicDocument.projectGate;
      if (Number(graph.blockingCount || 0) > 0) return { allowed: false, reason: '全局 EDEM/ERC 存在阻断项。' };
      if (!globalAudit || Number(globalAudit.blockingCount || 0) > 0) return { allowed: false, reason: '全局单源图模审计未通过。' };
      if (!projectGate || projectGate.status === 'BLOCKED') return { allowed: false, reason: '多 Sheet 项目闸门未通过。' };
      const svg = getSvg();
      const markup = exportSvgMarkup(svg);
      const pageApi = window.EVSE_SCHEMATIC_SHEET_RENDERING || window.SCHEMATIC_FORGE_SHEET_RENDERING;
      let livePageGate;
      try {
        livePageGate = pageApi && typeof pageApi.evaluatePage === 'function'
          ? pageApi.evaluatePage(state.R, state.schematicDocument, state.activeSheetId,
            state.activePage.compiled, markup)
          : null;
      } catch (error) {
        return { allowed: false, reason: '导出时重新读取当前页失败：' + humanError(error) + '。' };
      }
      if (!livePageGate || livePageGate.allowed !== true) return {
        allowed: false,
        reason: '导出时重新读取最终 SVG，发现 Drawing IR、页面骨架、几何或跨页精确覆盖不一致。'
      };
      return { allowed: true, reason: (livePageGate.status === 'REVIEW_REQUIRED' ? '当前页需要版式复核；' : '') +
        '允许导出方案级当前页，仍须专业校审与签发。', format };
    }
    return skill.canExport(state.R, DRAWING_KEY, format, exportSvgMarkup(getSvg()));
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
        drawingIRHash: state.R && state.R.drawingGeometryHash,
        notice: '可编辑 DXF 概念草图；复杂符号、图层、线宽、比例和打印样式须在 CAD 模板中复核。'
      };
      if (!state.R || !state.R.drawingIR || typeof exporter.exportDrawingIR !== 'function') {
        throw new Error('Drawing IR 缺失或直接导出器未加载；禁止从 SVG 反向猜测 DXF 几何。');
      }
      const result = exporter.exportDrawingIR(state.R.drawingIR, options);
      const dxf = typeof result === 'string' ? result : (result && (result.dxf || result.text));
      if (!dxf || !/^\s*0\s*[\r\n]+SECTION/m.test(dxf)) throw new Error('DXF 转换结果无效');
      const auditor = window.EVSE_RENDERED_DXF_AUDIT;
      const readback = auditor && typeof auditor.audit === 'function'
        ? auditor.audit(dxf, state.R.drawingIR)
        : { ok: false, errors: [{ code: 'DXF_READBACK_AUDITOR_MISSING' }] };
      if (!readback.ok) throw new Error('最终 DXF 反读与当前 Drawing IR 不一致：' +
        (readback.errors || []).slice(0, 5).map((item) => item.code + ':' + item.id).join(', '));
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
      schema: 'SCHEMATICFORGE-DIAGNOSTIC-PACKAGE/2.0',
      exportedAt: new Date().toISOString(),
      documentStatus: state.R.documentStatus,
      artifactStatus: 'DRAFT_DIAGNOSTIC',
      notice: '方案级自动原理图；不构成生产图、施工图、标准符合性证明、型式试验结论或设备报价。',
      releaseGate: state.R.releaseGate || (state.R.readiness && state.R.readiness.release) || { constructionDrawingAllowed: false },
      drawingGeometryHash: state.R.drawingGeometryHash || null,
      drawingIR: state.R.drawingIR || null,
      schematicDocument: state.schematicDocument || null,
      renderedPageManifest: state.renderedSchematicDocument ? state.renderedSchematicDocument.pages.map((page) => ({
        sheetId: page.sheetId, drawingNo: page.sheet && page.sheet.drawingNo,
        geometryHash: (state.pageEdits[page.sheetId] || page).geometryHash,
        projectionHash: page.projectionHash,
        pageGate: (state.pageEdits[page.sheetId] || page).pageGate,
        edited: !!state.pageEdits[page.sheetId]
      })) : [],
      activeSheet: state.R.activeSheet || null,
      editableDocuments: state.R.editableDocuments || {},
      engineeringBom: state.engineeringBom || null,
      bomResearchCandidates: state.bomResearchCandidates || [],
      engineeringReviewCandidate: state.engineeringReviewCandidate || null,
      model: state.R
    };
    downloadBlob(new Blob([JSON.stringify(packageData, null, 2)], { type: 'application/json;charset=utf-8' }), 'evse-solution-' + Date.now() + '.json');
  };

  /* ---------- 初始化 ---------- */
  function toggleEssFields() {
    const enabled = $('f-ess') && $('f-ess').value === '1';
    const box = $('ess-fields');
    if (box) box.hidden = !enabled;
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
    if ($('f-ai-access-token')) $('f-ai-access-token').addEventListener('input', () => {
      updateEngineeringAccessState(); updateProviderStatus();
    });
    document.addEventListener('fullscreenchange', () => {
      document.body.classList.toggle('workspace-mode', !!document.fullscreenElement);
      updateEditorControls();
      setTimeout(() => { if (/^fit-/.test(state.zoomMode)) applyZoom(); }, 0);
    });
    toggleEssFields();
    updateStandardHelp();
    loadProviderStatus();
    loadEngineeringStatus();
    bindViewportNavigation();
    updateEditorControls();
  });

  window.EVSE_APP = { state, getParams, parseNLLocal };
})();
