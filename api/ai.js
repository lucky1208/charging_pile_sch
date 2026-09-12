/* ============================================================
 * Same-origin AI gateway for EVSE requirement translation/advice.
 *
 * Browser API keys are deliberately unsupported: provider credentials stay
 * in server-side environment variables. The model may translate text or
 * explain deterministic results, but it never calculates capacity, modifies
 * drawings or decides protection settings.
 * ============================================================ */
'use strict';

const crypto = require('node:crypto');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_RATE_KEYS = 2000;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_TEXT_CHARS = 6000;
const MAX_UPSTREAM_BYTES = 128 * 1024;
const MAX_MODEL_CONTENT_CHARS = 16000;
const UPSTREAM_TIMEOUT_MS = 20 * 1000;
const MIN_ACCESS_TOKEN_BYTES = 32;
const requestWindows = new Map();

const PROVIDERS = Object.freeze({
  kimi: Object.freeze({
    key: 'MOONSHOT_API_KEY', model: 'KIMI_MODEL', fallbackModel: 'moonshot-v1-8k',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions'
  }),
  deepseek: Object.freeze({
    key: 'DEEPSEEK_API_KEY', model: 'DEEPSEEK_MODEL', fallbackModel: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/chat/completions'
  }),
  glm: Object.freeze({
    key: 'ZHIPUAI_API_KEY', model: 'ZHIPUAI_MODEL', fallbackModel: 'glm-4-flash',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
  })
});

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function firstHeader(value) {
  return String(value == null ? '' : value).split(',')[0].trim();
}

function sameOrigin(req) {
  const headers = req.headers || {};
  const fetchSite = firstHeader(headers['sec-fetch-site']).toLowerCase();
  if (fetchSite === 'cross-site') return false;

  const origin = firstHeader(headers.origin);
  if (!origin) return true; // permits non-browser/local operational clients
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = firstHeader(headers['x-forwarded-host'] || headers.host);
    if (!host || parsed.host !== host) return false;
    const forwardedProto = firstHeader(headers['x-forwarded-proto']);
    const requestProto = forwardedProto || req.protocol || (req.socket && req.socket.encrypted ? 'https' : 'http');
    return parsed.protocol === String(requestProto).replace(/:$/, '') + ':';
  } catch (_) {
    return false;
  }
}

function configuredAccessToken() {
  const token = typeof process.env.ENGINEERING_API_ACCESS_TOKEN === 'string'
    ? process.env.ENGINEERING_API_ACCESS_TOKEN.trim() : '';
  return Buffer.byteLength(token, 'utf8') >= MIN_ACCESS_TOKEN_BYTES ? token : '';
}

function suppliedAccessToken(req) {
  const headers = req.headers || {};
  const authorization = firstHeader(headers.authorization);
  const bearer = authorization.match(/^Bearer[ \t]+([^\s]+)$/i);
  const bearerToken = bearer ? bearer[1] : '';
  const explicitToken = firstHeader(headers['x-engineering-access-token']);
  if (bearerToken && explicitToken && bearerToken !== explicitToken) return '';
  return bearerToken || explicitToken;
}

function accessAllowed(req) {
  const configured = configuredAccessToken();
  if (!configured) return { ok: false, configured: false };
  const supplied = suppliedAccessToken(req);
  const left = crypto.createHash('sha256').update(supplied, 'utf8').digest();
  const right = crypto.createHash('sha256').update(configured, 'utf8').digest();
  return { ok: !!supplied && Buffer.byteLength(supplied, 'utf8') === Buffer.byteLength(configured, 'utf8') &&
    crypto.timingSafeEqual(left, right), configured: true };
}

function pruneRateWindows(now) {
  for (const [key, value] of requestWindows) {
    if (!value || now - value.startedAt >= WINDOW_MS) requestWindows.delete(key);
  }
  while (requestWindows.size >= MAX_RATE_KEYS) {
    const oldest = requestWindows.keys().next();
    if (oldest.done) break;
    requestWindows.delete(oldest.value);
  }
}

function clientKey(req) {
  const headers = req.headers || {};
  const candidate = firstHeader(
    headers['x-vercel-forwarded-for'] ||
    headers['x-forwarded-for'] ||
    headers['x-real-ip'] ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown'
  );
  return candidate.slice(0, 128) || 'unknown';
}

function rateLimited(req) {
  const now = Date.now();
  const key = clientKey(req);
  let entry = requestWindows.get(key);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    if (requestWindows.size >= MAX_RATE_KEYS) pruneRateWindows(now);
    entry = { startedAt: now, count: 0 };
    requestWindows.set(key, entry);
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

function byteLength(value) {
  return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
}

function declaredBodyTooLarge(req) {
  const raw = firstHeader(req.headers && req.headers['content-length']);
  if (!raw) return false;
  if (!/^\d+$/.test(raw)) return true;
  return Number(raw) > MAX_REQUEST_BYTES;
}

function readBody(req) {
  if (typeof req.body === 'string') {
    if (byteLength(req.body) > MAX_REQUEST_BYTES) return { error: 'too_large' };
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { value: parsed }
        : { error: 'invalid' };
    } catch (_) {
      return { error: 'invalid' };
    }
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return { error: 'invalid' };
  try {
    if (byteLength(JSON.stringify(req.body)) > MAX_REQUEST_BYTES) return { error: 'too_large' };
  } catch (_) {
    return { error: 'invalid' };
  }
  return { value: req.body };
}

function cleanText(value, maxChars = MAX_TEXT_CHARS) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxChars);
}

function extractJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  const candidate = first >= 0 && last > first ? text.slice(first, last + 1) : text;
  const parsed = JSON.parse(candidate);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI parse result is not an object.');
  return parsed;
}

function nullableEnum(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

function nullablePositiveNumber(value, integer) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return integer && !Number.isInteger(value) ? null : value;
}

function cleanArray(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => cleanText(item, 500))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normaliseParseResult(value, rawText) {
  const confidence = value && value.confidence;
  return {
    standard: nullableEnum(value.standard, ['gb', 'eu', 'us', 'nacs', 'chademo']),
    archetype: nullableEnum(value.archetype, ['dc-integrated', 'dc-split', 'ac-dc-combo', 'ess-mobile']),
    outputKw: nullablePositiveNumber(value.outputKw, false),
    gunCount: nullablePositiveNumber(value.gunCount, true),
    gunCurrentA: nullablePositiveNumber(value.gunCurrentA, false),
    moduleKw: nullablePositiveNumber(value.moduleKw, false),
    essEnabled: typeof value.essEnabled === 'boolean' ? value.essEnabled : null,
    essKwh: nullablePositiveNumber(value.essKwh, false),
    essPowerKw: nullablePositiveNumber(value.essPowerKw, false),
    essCoupling: nullableEnum(value.essCoupling, ['dc', 'ac']),
    thermal: nullableEnum(value.thermal, ['air', 'liquid']),
    backend: nullableEnum(value.backend, ['ocpp16', 'ocpp201', 'private']),
    preference: nullableEnum(value.preference, ['cost', 'balance', 'reliability']),
    specialRequirements: cleanArray(value.specialRequirements, 20),
    assumptions: cleanArray(value.assumptions, 12),
    questions: cleanArray(value.questions, 12),
    confidence: typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      ? confidence
      : null,
    // Provenance is server-controlled; a model-supplied rawText field is ignored.
    rawText: cleanText(rawText, 5000)
  };
}

async function readResponseTextLimited(response, maxBytes) {
  const declared = firstHeader(response.headers && response.headers.get && response.headers.get('content-length'));
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    if (response.body && typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
    const error = new Error('AI response exceeded size limit.');
    error.code = 'UPSTREAM_TOO_LARGE';
    throw error;
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let output = '';
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxBytes) {
          const error = new Error('AI response exceeded size limit.');
          error.code = 'UPSTREAM_TOO_LARGE';
          throw error;
        }
        output += decoder.decode(part.value, { stream: true });
      }
      return output + decoder.decode();
    } finally {
      if (total > maxBytes) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  const text = await response.text();
  if (byteLength(text) > maxBytes) {
    const error = new Error('AI response exceeded size limit.');
    error.code = 'UPSTREAM_TOO_LARGE';
    throw error;
  }
  return text;
}

async function chat(providerKey, system, user) {
  const provider = PROVIDERS[providerKey];
  const key = process.env[provider.key];
  if (!key) {
    const error = new Error('该 AI 服务尚未由站点管理员配置。');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
  try {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: process.env[provider.model] || provider.fallbackModel,
        temperature: 0,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      if (response.body && typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
      const error = new Error('AI service returned a non-success status.');
      error.code = 'UPSTREAM_ERROR';
      throw error;
    }
    const rawPayload = await readResponseTextLimited(response, MAX_UPSTREAM_BYTES);
    let payload;
    try { payload = JSON.parse(rawPayload); } catch (_) {
      const error = new Error('AI service returned invalid JSON.');
      error.code = 'UPSTREAM_INVALID_JSON';
      throw error;
    }
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) {
      const error = new Error('AI service returned no usable content.');
      error.code = 'EMPTY_RESPONSE';
      throw error;
    }
    if (content.length > MAX_MODEL_CONTENT_CHARS) {
      const error = new Error('AI model content exceeded size limit.');
      error.code = 'UPSTREAM_TOO_LARGE';
      throw error;
    }
    return content;
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error('AI service timed out.');
      timeout.code = 'UPSTREAM_TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const PARSE_SYSTEM = `你是充电桩原理图设计平台的“需求翻译器”。只从用户自然语言中提取明确写出的需求；不得计算容量、不得选择设备型号、不得声称 GB/IEC/UL/SAE 合规、不得生成图纸、不得编造未知数据。只返回一个 JSON 对象，字段严格为：
{
  "standard": "gb"|"eu"|"us"|"nacs"|"chademo"|null,
  "archetype": "dc-integrated"|"dc-split"|"ac-dc-combo"|"ess-mobile"|null,
  "outputKw": number|null,
  "gunCount": number|null,
  "gunCurrentA": number|null,
  "moduleKw": number|null,
  "essEnabled": true|false|null,
  "essKwh": number|null,
  "essPowerKw": number|null,
  "essCoupling": "dc"|"ac"|null,
  "thermal": "air"|"liquid"|null,
  "backend": "ocpp16"|"ocpp201"|"private"|null,
  "preference": "cost"|"balance"|"reliability"|null,
  "specialRequirements": string[],
  "assumptions": string[],
  "questions": string[],
  "confidence": number
}
standard 取值对应：国标 GB/T = "gb"，欧标 CCS2 = "eu"，美标 CCS1 = "us"，NACS = "nacs"，CHAdeMO = "chademo"。上述五种 standard 与四种 archetype 都是已实现的受控取值；用户表达不在枚举内或不明确时返回 null，不得改写成相似标准或桩型。
MW 换算为 kW；“度电/度”视为 kWh。没有明确说明的字段一律为 null 或空数组，不要推测。confidence 为 0~1。`;

const ADVISE_SYSTEM = `你是充电桩方案的审查助理。只能基于已给出的结构化确定性结果，给出简短、审慎的审查建议。不得改变任何计算结果，不得报价或指定厂商型号，不得声称图纸可用于生产/施工、已合规或已完成型式试验与保护配合。优先提示数据缺口、工程假设、需专项计算（短路与保护配合、EMC 与谐波、温升与降载、绝缘监测判据、电池安全与消防、并网与计量认证）和需专业签发的事项。使用中文，最多 700 个汉字。`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (req.method === 'GET' && req.query && req.query.action === 'status') {
    if (!sameOrigin(req)) return send(res, 403, { ok: false, error: '仅允许同源请求。' });
    const providers = Object.fromEntries(Object.entries(PROVIDERS).map(([name, cfg]) => [name, Boolean(process.env[cfg.key])]));
    return send(res, 200, { ok: true, providers, authenticationRequired: true,
      accessControlConfigured: Boolean(configuredAccessToken()) });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: '仅支持 POST 请求或 GET 状态查询。' });
  }
  const access = accessAllowed(req);
  if (!access.configured) return send(res, 503, { ok: false, error: 'AI 访问控制尚未由站点管理员配置。' });
  if (!access.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="engineering-ai"');
    return send(res, 401, { ok: false, error: '缺少或提供了无效的受控 AI 访问令牌。' });
  }
  if (!sameOrigin(req)) return send(res, 403, { ok: false, error: '浏览器请求必须来自同源页面。' });
  const mediaType = firstHeader(req.headers && req.headers['content-type']).split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return send(res, 415, { ok: false, error: '请求必须使用 application/json。' });
  if (declaredBodyTooLarge(req)) return send(res, 413, { ok: false, error: '请求内容过大。' });
  if (rateLimited(req)) {
    res.setHeader('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
    return send(res, 429, { ok: false, error: '请求过于频繁，请稍后重试。' });
  }

  const parsedBody = readBody(req);
  if (parsedBody.error === 'too_large') return send(res, 413, { ok: false, error: '请求内容过大。' });
  if (parsedBody.error) return send(res, 400, { ok: false, error: '请求格式无效。' });
  const body = parsedBody.value;
  const action = body.action === 'advise' ? 'advise' : body.action === 'parse' ? 'parse' : '';
  const provider = Object.prototype.hasOwnProperty.call(PROVIDERS, body.provider) ? body.provider : '';
  if (!action || !provider) return send(res, 400, { ok: false, error: '缺少有效的 action 或 provider。' });

  let source = '';
  if (action === 'parse') {
    source = cleanText(body.text);
  } else {
    try { source = cleanText(JSON.stringify(body.context == null ? {} : body.context)); } catch (_) { source = ''; }
  }
  if (!source) return send(res, 400, { ok: false, error: '没有可供分析的内容。' });

  try {
    const content = await chat(provider, action === 'parse' ? PARSE_SYSTEM : ADVISE_SYSTEM, source);
    if (action === 'parse') {
      const data = normaliseParseResult(extractJson(content), source);
      return send(res, 200, { ok: true, data });
    }
    return send(res, 200, { ok: true, text: cleanText(content, 5000) });
  } catch (error) {
    const known = error && error.code === 'PROVIDER_NOT_CONFIGURED';
    return send(res, known ? 503 : 502, {
      ok: false,
      error: known ? error.message : 'AI 服务暂时不可用；已保留本地确定性流程。'
    });
  }
};
