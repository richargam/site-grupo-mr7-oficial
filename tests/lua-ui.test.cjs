const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
async function setup(online = true, reply = '<img src=x onerror=alert(1)> Podcast é um serviço MR7.') {
  const dom = new JSDOM(readFileSync(join(__dirname, '../index.html'), 'utf8'), { url: 'https://grupomr7.com.br', runScripts: 'outside-only' });
  const w = dom.window, calls = [], audios = [], recordings = [];
  let stoppedTracks = 0, revoked = 0;
  w.AbortController = AbortController;
  w.URL.createObjectURL = () => 'blob:audio-test'; w.URL.revokeObjectURL = () => revoked++;
  w.Audio = class {
    constructor(src) { this.src = src; this.paused = true; this.listeners = {}; audios.push(this); }
    async play() { this.paused = false; } pause() { this.paused = true; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
  };
  w.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stoppedTracks++ }] }) };
  w.MediaRecorder = class {
    static isTypeSupported(type) { return type === 'audio/webm'; }
    constructor() { this.state = 'inactive'; recordings.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new w.Blob(['test-audio']) }); setTimeout(() => this.onstop(), 0); }
  };
  w.fetch = async (_url, options) => {
    if (!options?.method) return { ok: online, json: async () => ({ bridge: online }) };
    const d = JSON.parse(options.body); calls.push(d);
    return { ok: true, json: async () => d.action === 'chat' ? { reply } : { text: 'Quero gravar um podcast.' }, blob: async () => new w.Blob(['test-mp3'], { type: 'audio/mpeg' }) };
  };
  w.eval(readFileSync(join(__dirname, '../chat-config.js'), 'utf8'));
  w.eval(readFileSync(join(__dirname, '../chat-widget.js'), 'utf8'));
  const $ = id => w.document.getElementById(id);
  $('mr7-chat-launcher').click(); await wait();
  return { w, $, calls, audios, recordings, get stoppedTracks() { return stoppedTracks; }, get revoked() { return revoked; }, close: () => dom.window.close() };
}
test('conexão habilita mensagem; resposta é texto seguro e histórico só da visita', async () => {
  const s = await setup();
  try {
    assert.equal(s.$('mr7-chat-input').disabled, false);
    s.$('mr7-chat-input').value = 'Podcast'; s.$('mr7-chat-form').dispatchEvent(new s.w.Event('submit', { cancelable: true })); await wait();
    assert.equal(s.calls[0].action, 'chat'); assert.deepEqual(s.calls[0].history, []);
    assert.ok(s.$('mr7-chat-stream').textContent.includes('<img'));
    assert.equal(s.$('mr7-chat-stream').querySelector('img'), null);
    s.$('mr7-chat-input').value = 'Branding'; s.$('mr7-chat-form').dispatchEvent(new s.w.Event('submit', { cancelable: true })); await wait();
    assert.equal(s.calls[1].history.length, 2); assert.equal(s.calls[1].history[0].content, 'Podcast');
  } finally { s.close(); }
});
test('ouvir, pausar, continuar e parar usam MP3 e liberam URL', async () => {
  const s = await setup();
  try {
    s.$('mr7-chat-input').value = 'Oi'; s.$('mr7-chat-form').dispatchEvent(new s.w.Event('submit', { cancelable: true })); await wait();
    s.$('lua-read-last').click(); await wait(); assert.equal(s.calls.at(-1).action, 'tts'); assert.equal(s.audios[0].paused, false);
    s.$('lua-pause').click(); assert.equal(s.audios[0].paused, true); assert.ok(s.$('lua-pause').textContent.includes('Continuar'));
    s.$('lua-pause').click(); await wait(); assert.equal(s.audios[0].paused, false);
    s.$('lua-stop').click(); assert.equal(s.audios[0].paused, true); assert.equal(s.revoked, 1); assert.equal(s.$('lua-pause').disabled, true);
  } finally { s.close(); }
});
test('microfone mostra que está gravando, transcreve, envia sozinho e a Lua responde falando', async () => {
  const s = await setup();
  try {
    s.$('lua-mic').click(); await wait(); assert.equal(s.recordings[0].state, 'recording'); assert.equal(s.$('mr7-chat-input').disabled, true);
    assert.ok(s.$('lua-mic').classList.contains('recording'));
    assert.ok(s.w.document.querySelector('.lua-estado.gravando .lua-rec'), 'ponto vermelho de gravação');
    assert.equal(s.w.document.querySelector('.lua-legenda').hidden, false, 'aviso de fala visível');
    s.$('lua-mic').click(); await wait(); await wait(); await wait();
    assert.equal(s.calls[0].action, 'transcription'); assert.equal(s.stoppedTracks, 1);
    assert.equal(s.calls[1].action, 'chat'); assert.equal(s.calls[1].message, 'Quero gravar um podcast.');
    assert.ok(s.$('mr7-chat-stream').textContent.includes('Quero gravar um podcast.'));
    await wait(); assert.equal(s.calls[2].action, 'tts', 'falou com a Lua, ela responde falando');
  } finally { s.close(); }
});
test('voz sai em pedaços, a primeira frase curta, sem ler o link', async () => {
  const longo = 'Que bom ter você aqui. ' + 'O MR7 Cast grava, edita e publica o seu podcast com a equipe da MR7, do roteiro aos cortes. '.repeat(3) + 'Comece pelo briefing: https://crm.grupomr7.com.br/b/mr7cast';
  const s = await setup(true, longo);
  try {
    s.$('mr7-chat-input').value = 'Oi'; s.$('mr7-chat-form').dispatchEvent(new s.w.Event('submit', { cancelable: true })); await wait();
    s.$('lua-read-last').click(); await wait();
    const tts = s.calls.filter(c => c.action === 'tts');
    assert.equal(tts[0].text, 'Que bom ter você aqui.', '1º pedaço é a 1ª frase');
    assert.equal(tts.length, 2, 'o 2º pedaço é pedido enquanto o 1º toca');
    assert.ok(tts.every(t => t.text.length <= 220 && !t.text.includes('http')));
    assert.ok(s.w.document.querySelector('.lua-estado.falando .lua-barras'), 'barrinhas de fala');
    assert.ok(s.w.document.querySelector('.lua-legenda').textContent.startsWith('Lua:'), 'legenda da fala');
  } finally { s.close(); }
});
test('botão Resposta automática é escrito e liga a conversa por voz', async () => {
  const s = await setup();
  try {
    const b = s.$('lua-sound-toggle');
    assert.ok(b.textContent.includes('Resposta automática'));
    b.click(); await wait();
    assert.equal(b.getAttribute('aria-pressed'), 'true'); assert.ok(b.classList.contains('ligada'));
    assert.equal(s.recordings[0]?.state, 'recording', 'já começa a ouvir');
    b.click(); await wait();
    assert.equal(b.getAttribute('aria-pressed'), 'false'); assert.equal(s.recordings[0].state, 'inactive');
    assert.equal(s.calls.length, 0, 'desligar não envia nada');
  } finally { s.close(); }
});
test('fechar cancela gravação e não envia áudio', async () => {
  const s = await setup();
  try { s.$('lua-mic').click(); await wait(); s.$('mr7-chat-close').click(); await wait(); assert.equal(s.calls.length, 0); assert.equal(s.stoppedTracks, 1); assert.equal(s.$('mr7-chat-panel').hidden, true); }
  finally { s.close(); }
});
test('backend indisponível mantém controles bloqueados e briefings acessíveis', async () => {
  const s = await setup(false);
  try { assert.equal(s.$('mr7-chat-input').disabled, true); s.$('mr7-quote-toggle').click(); assert.equal(s.$('mr7-quote-form').hidden, false); assert.ok(s.$('mr7-quote-form').querySelector('a[href="https://crm.grupomr7.com.br/b/branding"]')); }
  finally { s.close(); }
});
