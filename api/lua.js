const { createHmac, randomBytes } = require('node:crypto');
const MAX_BODY = 1500000;
const digest = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');

function allowedOrigin(origin) {
  const origins = ['https://grupomr7.com.br', 'https://www.grupomr7.com.br'];
  if (process.env.LUA_PREVIEW_ORIGIN) origins.push(process.env.LUA_PREVIEW_ORIGIN);
  if (process.env.VERCEL_ENV === 'preview') {
    for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
      if (host && /^[a-z0-9.-]+\.vercel\.app$/.test(host)) origins.push(`https://${host}`);
    }
  }
  return origins.includes(origin);
}
async function readBody(req) {
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) throw new Error('size');
  // Vercel pode entregar JSON já interpretado. Também suporta o servidor de testes.
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('size');
    return JSON.parse(raw);
  }
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    const b = Buffer.from(chunk); size += b.length;
    if (size > MAX_BODY) throw new Error('size');
    chunks.push(b);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const fail = (status, error) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error })); };
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return fail(405, 'Método inválido.'); }
  if (req.method === 'POST' && !allowedOrigin(req.headers.origin)) return fail(403, 'Origem não autorizada.');
  const secret = process.env.LUA_BRIDGE_SECRET || '';
  const endpoint = process.env.LUA_CRM_ENDPOINT || '';
  let target;
  try { target = new URL(endpoint); } catch { return fail(503, 'A conexão com o CRM7 está em preparação.'); }
  if (process.env.LUA_PUBLIC_ENABLED !== 'true' || secret.length < 32 || target.protocol !== 'https:' || target.pathname !== '/api/lua-publica' || target.search || target.username || target.password) return fail(503, 'A conexão com o CRM7 está em preparação.');
  const trustedHosts = ['crm.grupomr7.com.br'];
  if (process.env.LUA_CRM_PREVIEW_HOST) trustedHosts.push(process.env.LUA_CRM_PREVIEW_HOST);
  if (!trustedHosts.includes(target.hostname)) return fail(503, 'Configuração de atendimento indisponível.');
  let input;
  try { input = req.method === 'GET' ? { action: 'status' } : await readBody(req); }
  catch { return fail(400, 'Pedido inválido ou muito grande.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Pedido inválido.');
  if (!['chat', 'tts', 'transcription', 'status'].includes(input.action)) return fail(400, 'Operação inválida.');
  // IP pseudonimizado. Não envia cookies, autorização do cliente, IDs de CRM ou dados extras.
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const data = { action: input.action, visitor: digest(secret, `visitor:${ip}`) };
  if (input.action === 'chat') { data.message = input.message; data.history = input.history; }
  if (input.action === 'tts') data.text = input.text;
  if (input.action === 'transcription') { data.audio = input.audio; data.mime = input.mime; }
  const body = JSON.stringify(data), time = String(Date.now()), nonce = randomBytes(16).toString('hex');
  try {
    const upstream = await fetch(target, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-lua-time': time, 'x-lua-nonce': nonce, 'x-lua-signature': digest(secret, `${time}.${nonce}.${body}`) },
      body, signal: AbortSignal.timeout(290000),
    });
    if (!upstream.ok) {
      const messages = { 429: 'Limite de atendimento atingido. Fale com a equipe pelo WhatsApp.', 422: 'Nenhuma fala detectada no áudio.', 413: 'Áudio muito grande. Grave uma mensagem mais curta.', 503: 'Atendimento temporariamente indisponível.' };
      return fail([429, 422, 413, 503].includes(upstream.status) ? upstream.status : 502, messages[upstream.status] || 'Não foi possível conectar ao atendimento. Tente novamente.');
    }
    if (input.action === 'tts') {
      if (!(upstream.headers.get('content-type') || '').startsWith('audio/mpeg')) throw new Error('type');
      res.setHeader('Content-Type', 'audio/mpeg'); return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    const result = await upstream.json();
    const clean = input.action === 'status' ? { bridge: result.bridge === true } : input.action === 'chat' ? { reply: result.reply } : { text: result.text };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(clean));
  } catch { return fail(502, 'Não foi possível conectar ao atendimento. Tente novamente.'); }
}
module.exports = handler;
module.exports.config = { maxDuration: 300 };
