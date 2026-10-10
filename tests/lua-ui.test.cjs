const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
async function setup(online = true) {
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
    return { ok: true, json: async () => d.action === 'chat' ? { reply: '<img src=x onerror=alert(1)> Podcast é um serviço MR7.' } : { text: 'Quero gravar um podcast.' }, blob: async () => new w.Blob(['test-mp3'], { type: 'audio/mpeg' }) };
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
test('microfone transcreve pelo servidor e aguarda confirmação de envio', async () => {
  const s = await setup();
  try {
    s.$('lua-mic').click(); await wait(); assert.equal(s.recordings[0].state, 'recording'); assert.equal(s.$('mr7-chat-input').disabled, true);
    s.$('lua-mic').click(); await wait(); await wait();
    assert.equal(s.calls.length, 1); assert.equal(s.calls[0].action, 'transcription');
    assert.equal(s.$('mr7-chat-input').value, 'Quero gravar um podcast.'); assert.equal(s.stoppedTracks, 1);
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
