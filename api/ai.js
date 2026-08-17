/* ============================================================
 * Same-origin AI gateway for EVSE requirement translation/advice.
 * Browser API keys are deliberately unsupported: configure the provider key
 * only as a Vercel environment variable. The model may interpret text and
 * explain choices, but it never calculates capacity, modifies a drawing or
 * decides protection settings.
 * ============================================================ */
'use strict';

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_TEXT = 6000;
const requestWindows = new Map();

const PROVIDERS = {
  kimi: {
    key: 'MOONSHOT_API_KEY', model: 'KIMI_MODEL', fallbackModel: 'moonshot-v1-8k',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions'
  },
  deepseek: {
    key: 'DEEPSEEK_API_KEY', model: 'DEEPSEEK_MODEL', fallbackModel: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/chat/completions'
  },
  glm: {
    key: 'ZHIPUAI_API_KEY', model: 'ZHIPUAI_MODEL', fallbackModel: 'glm-4-flash',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
  }
};

function send(res, status, payload) {
  res.status(status).json(payload);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return Boolean(host) && originHost === host;
  } catch (_) {
    return false;
  }
}

function rateLimited(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.socket && req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const entry = requestWindows.get(ip);
  if (!entry || now - entry.startedAt > WINDOW_MS) {
    requestWindows.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  entry.count += 1;
  if (requestWindows.size > 2000) {
    for (const [key, value] of requestWindows) if (now - value.startedAt > WINDOW_MS) requestWindows.delete(key);
  }
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return null; }
  }
  return req.body && typeof req.body === 'object' ? req.body : null;
}

function cleanText(value, max = MAX_TEXT) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function extractJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  const candidate = first >= 0 && last > first ? text.slice(first, last + 1) : text;
  return JSON.parse(candidate);
}

async function chat(providerKey, system, user) {
  const provider = PROVIDERS[providerKey];
  const key = process.env[provider.key];
  if (!key) {
    const error = new Error('该 AI 服务尚未由站点管理员配置。');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  const response = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: process.env[provider.model] || provider.fallbackModel,
      temperature: 0,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!response.ok) {
    const error = new Error('AI 服务暂时不可用。');
    error.code = 'UPSTREAM_ERROR';
    throw error;
  }
  const payload = await response.json();
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
  if (!content) {
    const error = new Error('AI 服务未返回可用内容。');
    error.code = 'EMPTY_RESPONSE';
    throw error;
  }
  return String(content);
}

const PARSE_SYSTEM = `你是充电桩原理图设计平台的“需求翻译器”。只从用户自然语言中提取明确写出的需求；不得计算容量、不得选择设备型号、不得声称 GB/IEC/UL/SAE 合规、不得生成图纸、不得编造未知数据。只返回一个 JSON 对象，字段严格为：
{
  "standard": "gb"|"eu"|"us"|null,
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
standard 取值对应：国标 GB/T = "gb"，欧标 CCS2 = "eu"，美标 CCS1 = "us"。
MW 换算为 kW；“度电/度”视为 kWh。没有明确说明的字段一律为 null 或空数组，不要推测。confidence 为 0~1。`;

const ADVISE_SYSTEM = `你是充电桩方案的审查助理。只能基于已给出的结构化确定性结果，给出简短、审慎的审查建议。不得改变任何计算结果，不得报价或指定厂商型号，不得声称图纸可用于生产/施工、已合规或已完成型式试验与保护配合。优先提示数据缺口、工程假设、需专项计算（短路与保护配合、EMC 与谐波、温升与降载、绝缘监测判据、电池安全与消防、并网与计量认证）和需专业签发的事项。使用中文，最多 700 个汉字。`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (!sameOrigin(req)) return send(res, 403, { ok: false, error: '仅允许同源请求。' });
  if (req.method === 'GET' && req.query && req.query.action === 'status') {
    return send(res, 200, { ok: true, providers: Object.fromEntries(Object.entries(PROVIDERS).map(([name, cfg]) => [name, Boolean(process.env[cfg.key])])) });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: '仅支持 POST 请求。' });
  if (rateLimited(req)) return send(res, 429, { ok: false, error: '请求过于频繁，请稍后重试。' });
  const body = readBody(req);
  if (!body) return send(res, 400, { ok: false, error: '请求格式无效。' });
  const action = body.action === 'advise' ? 'advise' : body.action === 'parse' ? 'parse' : '';
  const provider = PROVIDERS[body.provider] ? body.provider : '';
  if (!action || !provider) return send(res, 400, { ok: false, error: '缺少有效的 action 或 provider。' });
  const source = action === 'parse' ? cleanText(body.text) : cleanText(JSON.stringify(body.context || {}));
  if (!source) return send(res, 400, { ok: false, error: '没有可供分析的内容。' });
  try {
    const content = await chat(provider, action === 'parse' ? PARSE_SYSTEM : ADVISE_SYSTEM, source);
    if (action === 'parse') {
      const data = extractJson(content);
      return send(res, 200, { ok: true, data });
    }
    return send(res, 200, { ok: true, text: cleanText(content, 5000) });
  } catch (error) {
    const known = error && error.code === 'PROVIDER_NOT_CONFIGURED';
    return send(res, known ? 503 : 502, { ok: false, error: known ? error.message : 'AI 服务暂时不可用；已保留本地确定性流程。' });
  }
};
