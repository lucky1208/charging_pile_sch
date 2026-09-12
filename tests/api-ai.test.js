'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE_PATH = path.resolve(__dirname, '..', 'api', 'ai.js');
const TEST_ACCESS_TOKEN = 'test-only-ai-access-token-0123456789abcdef';
const ORIGINAL_ACCESS_TOKEN = process.env.ENGINEERING_API_ACCESS_TOKEN;
process.env.ENGINEERING_API_ACCESS_TOKEN = TEST_ACCESS_TOKEN;
test.after(() => {
  if (ORIGINAL_ACCESS_TOKEN === undefined) delete process.env.ENGINEERING_API_ACCESS_TOKEN;
  else process.env.ENGINEERING_API_ACCESS_TOKEN = ORIGINAL_ACCESS_TOKEN;
});

function freshHandler() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

function fakeResponse() {
  return {
    headers: {},
    statusCode: 0,
    payload: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

async function invoke(handler, options) {
  const input = options || {};
  const req = {
    method: input.method || 'POST',
    query: input.query || {},
    headers: Object.assign({
      host: 'evse.example',
      'x-forwarded-proto': 'https',
      'content-type': 'application/json',
      authorization: 'Bearer ' + TEST_ACCESS_TOKEN,
      'x-forwarded-for': input.ip || '203.0.113.1'
    }, input.headers || {}),
    body: Object.prototype.hasOwnProperty.call(input, 'body') ? input.body : {},
    protocol: input.protocol || 'https',
    socket: { remoteAddress: input.ip || '203.0.113.1' }
  };
  const res = fakeResponse();
  await handler(req, res);
  return res;
}

function modelResponse(content, headers) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {})
  });
}

async function withDeepseekKey(callback) {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-only-secret';
  try { return await callback(); } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
}

test('status contract exposes booleans only and remains frontend-compatible', async () => {
  const oldMoonshot = process.env.MOONSHOT_API_KEY;
  const oldDeepseek = process.env.DEEPSEEK_API_KEY;
  process.env.MOONSHOT_API_KEY = 'do-not-leak';
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const res = await invoke(freshHandler(), {
      method: 'GET',
      query: { action: 'status' },
      headers: { origin: 'https://evse.example' }
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      ok: true,
      providers: { kimi: true, deepseek: false, glm: Boolean(process.env.ZHIPUAI_API_KEY) },
      authenticationRequired: true,
      accessControlConfigured: true
    });
    assert.equal(JSON.stringify(res.payload).includes('do-not-leak'), false);
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    if (oldMoonshot === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = oldMoonshot;
    if (oldDeepseek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldDeepseek;
  }
});

test('origin check rejects cross-host, cross-scheme and Sec-Fetch-Site cross-site requests', async () => {
  const handler = freshHandler();
  for (const headers of [
    { origin: 'https://attacker.example' },
    { origin: 'http://evse.example' },
    { 'sec-fetch-site': 'cross-site' }
  ]) {
    const res = await invoke(handler, { method: 'GET', query: { action: 'status' }, headers });
    assert.equal(res.statusCode, 403);
  }
});

test('method and JSON media type are enforced before provider access', async () => {
  const handler = freshHandler();
  const method = await invoke(handler, { method: 'DELETE' });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, 'GET, POST');

  const media = await invoke(handler, {
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ action: 'parse', provider: 'deepseek', text: '120kW' })
  });
  assert.equal(media.statusCode, 415);
});

test('POST access control is mandatory, constant-boundary headers agree, and missing configuration fails closed', async () => {
  const handler = freshHandler();
  const missing = await invoke(handler, {
    headers: { authorization: '' }, body: { action: 'parse', provider: 'deepseek', text: '120kW' }
  });
  assert.equal(missing.statusCode, 401);
  assert.match(missing.headers['www-authenticate'], /Bearer/);

  const wrong = await invoke(handler, {
    headers: { authorization: 'Bearer wrong-access-token-0123456789abcdef' },
    body: { action: 'parse', provider: 'deepseek', text: '120kW' }, ip: '203.0.113.91'
  });
  assert.equal(wrong.statusCode, 401);

  const headerOnly = await invoke(handler, {
    headers: { authorization: '', 'x-engineering-access-token': TEST_ACCESS_TOKEN },
    body: { action: 'execute' }, ip: '203.0.113.92'
  });
  assert.equal(headerOnly.statusCode, 400);

  const conflicting = await invoke(handler, {
    headers: { 'x-engineering-access-token': 'different-access-token-0123456789abcdef' },
    body: { action: 'execute' }, ip: '203.0.113.93'
  });
  assert.equal(conflicting.statusCode, 401);

  const saved = process.env.ENGINEERING_API_ACCESS_TOKEN;
  delete process.env.ENGINEERING_API_ACCESS_TOKEN;
  try {
    const unconfigured = await invoke(freshHandler(), {
      body: { action: 'parse', provider: 'deepseek', text: '120kW' }, ip: '203.0.113.94'
    });
    assert.equal(unconfigured.statusCode, 503);
    assert.match(unconfigured.payload.error, /访问控制/);
  } finally {
    process.env.ENGINEERING_API_ACCESS_TOKEN = saved;
  }

  process.env.ENGINEERING_API_ACCESS_TOKEN = 'x'.repeat(31);
  try {
    const undersized = await invoke(freshHandler(), {
      body: { action: 'parse', provider: 'deepseek', text: '120kW' }, ip: '203.0.113.95'
    });
    assert.equal(undersized.statusCode, 503);
    assert.match(undersized.payload.error, /访问控制/);
  } finally {
    process.env.ENGINEERING_API_ACCESS_TOKEN = saved;
  }
});

test('declared and actual oversized request bodies fail closed', async () => {
  const handler = freshHandler();
  const declared = await invoke(handler, {
    headers: { 'content-length': String(33 * 1024) },
    body: { action: 'parse', provider: 'deepseek', text: 'x' }
  });
  assert.equal(declared.statusCode, 413);

  const actual = await invoke(handler, {
    body: JSON.stringify({ action: 'parse', provider: 'deepseek', text: 'x'.repeat(33 * 1024) }),
    ip: '203.0.113.2'
  });
  assert.equal(actual.statusCode, 413);
});

test('unknown actions/providers and unavailable providers fail closed', async () => {
  const handler = freshHandler();
  const invalid = await invoke(handler, {
    body: { action: 'execute', provider: 'deepseek', text: 'x' }
  });
  assert.equal(invalid.statusCode, 400);

  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const unavailable = await invoke(handler, {
      body: { action: 'parse', provider: 'deepseek', text: '120kW' },
      ip: '203.0.113.3'
    });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.payload.ok, false);
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});

test('parse response is allowlisted, typed, confidence-gated and carries server provenance', async () => {
  const oldFetch = global.fetch;
  try {
    await withDeepseekKey(async () => {
      global.fetch = async (_url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test-only-secret');
        assert.ok(options.signal instanceof AbortSignal);
        return modelResponse(JSON.stringify({
          standard: 'gb', outputKw: 120, gunCount: 2, gunCurrentA: 250,
          moduleKw: 30, essEnabled: false, essKwh: null, essPowerKw: null,
          essCoupling: null, thermal: 'air', backend: 'ocpp201', preference: 'balance',
          specialRequirements: ['高盐雾\u0000', 42], assumptions: [], questions: ['短路容量？'],
          confidence: 0.84, rawText: 'model-controlled', unknownDangerousField: '<script>'
        }));
      };
      const res = await invoke(freshHandler(), {
        body: { action: 'parse', provider: 'deepseek', text: '  国标双枪 120kW\u0000  ' },
        ip: '203.0.113.4'
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.data.rawText, '国标双枪 120kW');
      assert.equal(res.payload.data.confidence, 0.84);
      assert.deepEqual(res.payload.data.specialRequirements, ['高盐雾']);
      assert.equal(Object.hasOwn(res.payload.data, 'unknownDangerousField'), false);
      assert.equal(res.payload.data.rawText.includes('model-controlled'), false);
    });
  } finally {
    global.fetch = oldFetch;
  }
});

test('parse accepts all five standards and all four archetypes without remapping', async () => {
  const oldFetch = global.fetch;
  const standards = ['gb', 'eu', 'us', 'nacs', 'chademo'];
  const archetypes = ['dc-integrated', 'dc-split', 'ac-dc-combo', 'ess-mobile'];
  let current = null;
  try {
    await withDeepseekKey(async () => {
      global.fetch = async () => modelResponse(JSON.stringify({
        standard: current.standard,
        archetype: current.archetype,
        confidence: 0.95
      }));
      const handler = freshHandler();
      for (const standard of standards) {
        for (const archetype of archetypes) {
          current = { standard, archetype };
          const res = await invoke(handler, {
            body: {
              action: 'parse',
              provider: 'deepseek',
              text: `${standard} ${archetype}`
            },
            ip: '203.0.113.40'
          });
          assert.equal(res.statusCode, 200, `${standard}/${archetype}`);
          assert.equal(res.payload.data.standard, standard);
          assert.equal(res.payload.data.archetype, archetype);
        }
      }
    });
  } finally {
    global.fetch = oldFetch;
  }
});

test('invalid model types do not become high-confidence requirements', async () => {
  const oldFetch = global.fetch;
  try {
    await withDeepseekKey(async () => {
      global.fetch = async () => modelResponse(JSON.stringify({
        standard: 'nacs', outputKw: '120', gunCount: 2.5, essEnabled: 'false',
        confidence: 2, questions: 'not-an-array'
      }));
      const res = await invoke(freshHandler(), {
        body: { action: 'parse', provider: 'deepseek', text: 'ambiguous input' },
        ip: '203.0.113.5'
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.data.standard, 'nacs');
      assert.equal(res.payload.data.outputKw, null);
      assert.equal(res.payload.data.gunCount, null);
      assert.equal(res.payload.data.essEnabled, null);
      assert.equal(res.payload.data.confidence, null);
      assert.deepEqual(res.payload.data.questions, []);
    });
  } finally {
    global.fetch = oldFetch;
  }
});

test('per-client rate limit rejects request 21 and returns Retry-After', async () => {
  const oldFetch = global.fetch;
  try {
    await withDeepseekKey(async () => {
      global.fetch = async () => modelResponse('{"confidence":0.5}');
      const handler = freshHandler();
      let res;
      for (let index = 0; index < 20; index += 1) {
        res = await invoke(handler, {
          body: { action: 'parse', provider: 'deepseek', text: 'x' },
          ip: '198.51.100.20'
        });
        assert.equal(res.statusCode, 200);
      }
      res = await invoke(handler, {
        body: { action: 'parse', provider: 'deepseek', text: 'x' },
        ip: '198.51.100.20'
      });
      assert.equal(res.statusCode, 429);
      assert.equal(res.headers['retry-after'], '60');
    });
  } finally {
    global.fetch = oldFetch;
  }
});

test('oversized or malformed upstream responses fail with generic 502', async () => {
  const oldFetch = global.fetch;
  try {
    await withDeepseekKey(async () => {
      global.fetch = async () => new Response('x'.repeat(129 * 1024), { status: 200 });
      const oversized = await invoke(freshHandler(), {
        body: { action: 'parse', provider: 'deepseek', text: 'x' },
        ip: '203.0.113.6'
      });
      assert.equal(oversized.statusCode, 502);
      assert.equal(oversized.payload.ok, false);
      assert.equal(JSON.stringify(oversized.payload).includes('129'), false);

      global.fetch = async () => new Response('not-json', { status: 200 });
      const malformed = await invoke(freshHandler(), {
        body: { action: 'parse', provider: 'deepseek', text: 'x' },
        ip: '203.0.113.7'
      });
      assert.equal(malformed.statusCode, 502);
    });
  } finally {
    global.fetch = oldFetch;
  }
});

test('upstream timeout aborts work and returns generic 502', async () => {
  const oldFetch = global.fetch;
  const oldSetTimeout = global.setTimeout;
  const oldClearTimeout = global.clearTimeout;
  try {
    await withDeepseekKey(async () => {
      global.setTimeout = (callback) => {
        queueMicrotask(callback);
        return { unref() {} };
      };
      global.clearTimeout = () => {};
      global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted by test')), { once: true });
      });
      const res = await invoke(freshHandler(), {
        body: { action: 'parse', provider: 'deepseek', text: 'x' },
        ip: '203.0.113.8'
      });
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.payload, { ok: false, error: 'AI 服务暂时不可用；已保留本地确定性流程。' });
    });
  } finally {
    global.fetch = oldFetch;
    global.setTimeout = oldSetTimeout;
    global.clearTimeout = oldClearTimeout;
  }
});
