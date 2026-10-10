const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/lua.js');
const { createHmac } = require('node:crypto');
const req = (body, headers = {}) => ({ method: 'POST', body, headers: { origin: 'https://grupomr7.com.br', 'x-forwarded-for': '192.0.2.1', ...headers } });
const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } });
process.env.LUA_PUBLIC_ENABLED = 'true';
process.env.LUA_BRIDGE_SECRET = 's'.repeat(48);
process.env.LUA_CRM_ENDPOINT = 'https://crm.grupomr7.com.br/api/lua-publica';
test('origem externa rejeitada antes de conexão com CRM', async () => {
  const r = response(); await handler(req({ action: 'chat' }, { origin: 'https://evil.test' }), r); assert.equal(r.statusCode, 403);
});
test('ponte assina somente campos públicos e não encaminha cookies ou IDs administrativos', async () => {
  const original = global.fetch; let sent;
  global.fetch = async (url, init) => { sent = { url, init }; return Response.json({ reply: 'Olá', internal: 'nunca' }); };
  try {
    const r = response(); await handler(req({ action: 'chat', message: 'Oi', history: [], orgId: 'private', clientId: 'private' }, { cookie: 'crm=private', authorization: 'Bearer private' }), r);
    const { body, headers } = sent.init;
    assert.equal(headers.cookie, undefined); assert.equal(headers.authorization, undefined);
    assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['action', 'history', 'message', 'visitor']);
    const sig = createHmac('sha256', process.env.LUA_BRIDGE_SECRET).update(`${headers['x-lua-time']}.${headers['x-lua-nonce']}.${body}`).digest('hex');
    assert.equal(sig, headers['x-lua-signature']); assert.deepEqual(JSON.parse(r.body), { reply: 'Olá' });
    assert.equal(sent.init.redirect, 'error');
  } finally { global.fetch = original; }
});
test('falha interna não vaza retorno ou segredo do CRM', async () => {
  const original = global.fetch; global.fetch = async () => new Response('sk-secret contract', { status: 401 });
  try { const r = response(); await handler(req({ action: 'chat', message: 'Oi' }), r); assert.equal(r.statusCode, 502); assert.ok(!r.body.includes('secret')); }
  finally { global.fetch = original; }
});
test('ponte desativada fecha atendimento', async () => {
  process.env.LUA_PUBLIC_ENABLED = 'false'; const r = response(); await handler(req({ action: 'chat' }), r); assert.equal(r.statusCode, 503); process.env.LUA_PUBLIC_ENABLED = 'true';
});
test('endpoint fora da lista permitida recusado', async () => {
  process.env.LUA_CRM_ENDPOINT = 'https://evil.test/api/lua-publica'; const r = response(); await handler(req({ action: 'chat' }), r); assert.equal(r.statusCode, 503); process.env.LUA_CRM_ENDPOINT = 'https://crm.grupomr7.com.br/api/lua-publica';
});
test('TTS aceita somente áudio MP3 do backend', async () => {
  const original = global.fetch; global.fetch = async () => Response.json({ private: 'secret' });
  try { const r = response(); await handler(req({ action: 'tts', text: 'Oi' }), r); assert.equal(r.statusCode, 502); }
  finally { global.fetch = original; }
});
test('limite de uso mantém resposta útil e não afirma atendimento realizado', async () => {
  const original = global.fetch; global.fetch = async () => new Response('private', { status: 429 });
  try { const r = response(); await handler(req({ action: 'chat', message: 'Oi' }), r); assert.equal(r.statusCode, 429); assert.ok(r.body.includes('WhatsApp')); }
  finally { global.fetch = original; }
});
