(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('mr7-chat-panel'), launcher = $('mr7-chat-launcher'), input = $('mr7-chat-input');
  const stream = $('mr7-chat-stream'), status = $('mr7-chat-status');
  const config = window.MR7_CHAT_CONFIG || {};
  let connected = false, busy = false, automatic = false, lastReply = '', history = [];
  // Voz: a resposta é falada em pedaços (a 1ª frase sai em poucos segundos e as próximas são geradas
  // enquanto ela fala). RicharGam, 21/11/2026: "tá levando quase um minuto… tem que ser rápido".
  let audio = null, audioUrl = null, version = 0, speaking = false, paused = false;
  const requests = new Set();
  let recorder = null, micStream = null, timer = null, cancelled = false;
  let meter = null, meterFrame = 0, clock = 0, typing = null;
  // Resposta automática = conversa por voz: você fala, ela percebe a pausa, responde falando e volta a ouvir.
  let heard = false, lastLoud = 0, caption = null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const NIVEL_FALA = 26, PAUSA_MS = 1500, SEM_FALA_MS = 30000;

  // Indicador visível do que a Lua está fazendo (gravando, transcrevendo, pensando, preparando, falando).
  const state = document.createElement('span');
  state.className = 'lua-estado'; state.setAttribute('aria-hidden', 'true');
  status.before(state);
  // Legenda ao vivo: o que você está falando (computador) e o trecho que a Lua está falando.
  const legend = document.createElement('div');
  legend.className = 'lua-legenda'; legend.hidden = true; legend.setAttribute('aria-live', 'polite');
  $('mr7-chat-form').before(legend);
  function showLegend(who, text) {
    if (!who) { legend.hidden = true; legend.textContent = ''; return; }
    legend.hidden = false; legend.replaceChildren();
    const b = document.createElement('b'); b.textContent = `${who}: `;
    const t = document.createElement('span'); t.textContent = text;
    legend.append(b, t);
  }
  const BARRAS = '<i></i><i></i><i></i><i></i><i></i>';
  function setState(name, text = '') {
    state.className = `lua-estado ${name || ''}`.trim();
    state.innerHTML = name === 'gravando' ? `<b class="lua-rec"></b><em id="lua-rec-time">0:00</em><span class="lua-barras">${BARRAS}</span>`
      : name === 'falando' ? `<span class="lua-barras">${BARRAS}</span>`
      : ['transcrevendo', 'pensando', 'preparando'].includes(name) ? '<span class="lua-pontos"><i></i><i></i><i></i></span>' : '';
    status.textContent = text;
  }

  function controls() {
    const recording = recorder?.state === 'recording';
    input.disabled = !connected || busy || recording;
    document.querySelector('.lua-send').disabled = !connected || busy || recording;
    $('lua-mic').disabled = !connected || busy || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia;
    $('lua-mic').classList.toggle('recording', recording);
    $('lua-sound-toggle').disabled = !connected;
    $('lua-read-last').disabled = !connected || !lastReply;
    $('lua-pause').disabled = !speaking;
    $('lua-stop').disabled = !speaking;
    $('mr7-chat-quick').hidden = !connected || recording;
  }
  function bubble(text, bot = true) {
    const div = document.createElement('div'); div.className = `mr7-bubble ${bot ? 'bot' : 'user'}`;
    div.textContent = text; stream.appendChild(div); stream.scrollTop = stream.scrollHeight; return div;
  }
  function showTyping(on) {
    if (on && !typing) { typing = bubble(''); typing.classList.add('lua-digitando'); typing.innerHTML = '<span class="lua-pontos"><i></i><i></i><i></i></span>'; stream.scrollTop = stream.scrollHeight; }
    if (!on && typing) { typing.remove(); typing = null; }
  }
  async function api(data, signal) {
    const r = await fetch(config.endpoint || '/api/lua', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Atendimento indisponível. Fale com a equipe pelo WhatsApp.'); }
    return data.action === 'tts' ? r.blob() : r.json();
  }

  // ---------- voz em pedaços ----------
  /** O que vai para a voz: sem links (lidos em voz alta ficam enormes) e sem símbolos. */
  function speechText(text) {
    return String(text).replace(/https?:\/\/\S+/g, ' o link aqui no chat ').replace(/[*_#>`•]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** 1º pedaço curto (sai rápido); os outros de até ~220 caracteres, sempre fechando a frase. */
  function pieces(text) {
    const frases = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [];
    const out = []; let atual = '';
    const limite = () => (out.length ? 220 : 130);
    const cortar = (f) => {
      while (f.length > limite()) {
        let c = f.lastIndexOf(',', limite()); if (c < 40) c = f.lastIndexOf(' ', limite()); if (c < 40) c = limite();
        out.push(f.slice(0, c + 1).trim()); f = f.slice(c + 1).trim();
      }
      return f;
    };
    for (let f of frases) {
      f = f.trim(); if (!f) continue;
      if (atual && (atual + ' ' + f).length > limite()) { out.push(atual); atual = ''; }
      atual = cortar(atual ? `${atual} ${f}` : f);
      if (!out.length && atual.length >= 12) { out.push(atual); atual = ""; } // 1ª frase sozinha: começa a falar logo
    }
    if (atual) out.push(atual);
    return out.filter(p => /[\p{L}\d]/u.test(p)).map(p => p.slice(0, 600));
  }
  function requestVoice(text) {
    const ctrl = new AbortController(); requests.add(ctrl);
    const p = api({ action: 'tts', text }, ctrl.signal).finally(() => requests.delete(ctrl));
    p.catch(() => {}); // o erro é tratado quando a vez desse pedaço chegar
    return p;
  }
  function releaseAudio() {
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.src = ''; audio = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  }
  function stopVoice() {
    version++; requests.forEach(c => c.abort()); requests.clear(); releaseAudio();
    speaking = false; paused = false; $('lua-pause').textContent = '⏸ Pausar';
    if (legend.firstChild?.textContent === 'Lua: ') showLegend('');
    if (/falando|preparando/.test(state.className)) setState('');
    controls();
  }
  function play(blob, own) {
    return new Promise((resolve, reject) => {
      releaseAudio(); audioUrl = URL.createObjectURL(blob); audio = new Audio(audioUrl);
      audio.onended = () => resolve(); audio.onerror = () => reject(new Error('audio'));
      const start = () => {
        if (own !== version) return resolve();
        if (paused) { setState('', 'Voz pausada'); return; } // o botão Continuar dá o play
        audio.play().then(() => setState('falando', 'Lua falando'), reject);
      };
      start();
    });
  }
  async function speak(text) {
    stopVoice(); const own = version;
    const list = pieces(speechText(text)); if (!list.length) return;
    speaking = true; controls(); setState('preparando', 'Preparando a voz da Lua…');
    let next = requestVoice(list[0]);
    try {
      for (let i = 0; i < list.length; i++) {
        if (i > 0 && !paused) setState('preparando', 'Lua continua já…');
        const blob = await next; if (own !== version) return;
        next = i + 1 < list.length ? requestVoice(list[i + 1]) : null; // gera o próximo enquanto este toca
        showLegend('Lua', list[i]);
        await play(blob, own); if (own !== version) return;
      }
      releaseAudio(); speaking = false; showLegend(''); setState(''); controls();
      if (automatic && connected && !panel.hidden) setTimeout(() => { if (automatic && !speaking && !busy) record(); }, 350);
    } catch (e) {
      if (own !== version || e.name === 'AbortError') return;
      stopVoice(); setState('', 'Não foi possível ouvir agora. A resposta permanece no chat.');
    }
  }

  // ---------- conversa ----------
  async function send(message, byVoice = false) {
    if (!connected || busy || recorder?.state === 'recording' || !message.trim()) return;
    message = message.trim().slice(0, 1500); busy = true; stopVoice(); controls();
    input.value = ''; bubble(message, false); showTyping(true); setState('pensando', 'Lua está pensando…');
    try {
      const d = await api({ action: 'chat', message, history: history.slice(-12) });
      if (typeof d.reply !== 'string' || !d.reply.trim()) throw new Error('Resposta indisponível. Tente novamente.');
      showTyping(false); lastReply = d.reply; bubble(lastReply);
      history.push({ role: 'user', content: message }, { role: 'assistant', content: lastReply }); history = history.slice(-12);
      setState('');
      // Falou com a Lua? Ela responde falando. Digitou? Fala só com a leitura automática ligada.
      if ((byVoice || automatic) && !panel.hidden) speak(lastReply);
    } catch (e) { showTyping(false); bubble(e.message); setState('', 'Falha no atendimento'); }
    finally { busy = false; controls(); if (!panel.hidden) input.focus(); }
  }
  async function connect() {
    if (connected || config.enabled !== true) return;
    setState('pensando', 'Verificando conexão com o CRM7…');
    try {
      const r = await fetch(config.endpoint || '/api/lua', { cache: 'no-store' }); const d = await r.json();
      if (!r.ok || d.bridge !== true) throw new Error();
      connected = true; input.placeholder = 'Pergunte à Lua…';
      document.querySelector('.lua-head small').textContent = 'Atendimento MR7';
      if (!history.length) { stream.replaceChildren(); bubble('Olá! Sou a Lua MR7. Qual projeto você quer tirar do papel? Posso explicar os serviços e orientar você até o briefing oficial.'); }
      setState(''); controls(); if (!panel.hidden) input.focus();
    } catch { setState('', 'Conexão com o CRM7 ainda indisponível. Use os briefings ou o WhatsApp.'); }
  }

  // ---------- microfone ----------
  function startMeter(media) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      const ctx = new Ctx(), src = ctx.createMediaStreamSource(media), an = ctx.createAnalyser();
      an.fftSize = 64; src.connect(an); meter = { ctx, an, data: new Uint8Array(an.frequencyBinCount) };
      const t0 = Date.now();
      const tick = () => {
        if (!meter) return;
        meter.an.getByteFrequencyData(meter.data);
        let soma = 0; for (const v of meter.data) soma += v;
        const agora = Date.now();
        if (soma / meter.data.length > NIVEL_FALA) { heard = true; lastLoud = agora; }
        if (automatic && heard && agora - lastLoud > PAUSA_MS) { stopRecording(); return; } // você parou de falar: envia
        if (automatic && !heard && agora - t0 > SEM_FALA_MS) { stopRecording(true); setState('', 'Estou aqui. Toque no 🎙 quando quiser falar.'); return; }
        const bars = state.querySelectorAll('.lua-barras i');
        bars.forEach((b, i) => { const v = meter.data[2 + i * 3] / 255; b.style.transform = `scaleY(${0.25 + v * 1.1})`; });
        const s = Math.floor((Date.now() - t0) / 1000), el = $('lua-rec-time');
        if (el && s !== clock) { clock = s; el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
        if (window.requestAnimationFrame) meterFrame = window.requestAnimationFrame(tick);
      };
      tick();
    } catch { meter = null; }
  }
  function stopMeter() {
    if (window.cancelAnimationFrame) window.cancelAnimationFrame(meterFrame); clock = 0;
    if (meter) { meter.ctx.close().catch(() => {}); meter = null; }
  }
  function startCaption() {
    if (!SR || mobile) return; // no celular o microfone é um só: fica o gráfico do áudio
    try {
      const r = new SR(); r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true;
      r.onresult = e => { let t = ''; for (const x of e.results) t += x[0].transcript; showLegend('Você', t.trim() || '…'); };
      r.onerror = () => {};
      r.onend = () => { if (caption === r && recorder?.state === 'recording') { try { r.start(); } catch { /* segue sem legenda */ } } };
      caption = r; r.start();
    } catch { caption = null; }
  }
  function stopCaption() { const r = caption; caption = null; try { r?.stop(); } catch { /* já parou */ } }
  function stopRecording(cancel = false) {
    cancelled = cancel; clearTimeout(timer); stopMeter(); stopCaption();
    if (cancel) showLegend('');
    if (recorder?.state === 'recording') recorder.stop();
    micStream?.getTracks().forEach(t => t.stop()); micStream = null;
    $('lua-mic').textContent = '🎙'; $('lua-mic').setAttribute('aria-label', 'Ditar mensagem');
    if (cancel && /gravando/.test(state.className)) setState('');
    controls();
  }
  async function record() {
    if (recorder?.state === 'recording') { stopRecording(); return; }
    if (!connected || busy) return;
    stopVoice(); cancelled = false; heard = false; lastLoud = 0;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (panel.hidden) { media.getTracks().forEach(t => t.stop()); return; }
      micStream = media;
      const mime = ['audio/webm', 'audio/ogg', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
      if (!mime) throw new Error('Formato indisponível');
      recorder = new MediaRecorder(media, { mimeType: mime, audioBitsPerSecond: 64000 }); const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        if (cancelled) return;
        const blob = new Blob(chunks, { type: mime });
        if (!blob.size || blob.size > 1048576) { setState('', 'Grave uma mensagem mais curta, de até 60 segundos.'); return; }
        busy = true; controls(); setState('transcrevendo', 'Transcrevendo sua fala…');
        let text = '';
        try {
          const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
          const d = await api({ action: 'transcription', audio: base64, mime });
          text = String(d.text || '').trim();
          if (!text) setState('', 'Não entendi o áudio. Tente falar de novo, mais perto do microfone.');
        } catch (e) { setState('', e.message); }
        finally { busy = false; controls(); showLegend(''); }
        if (text) send(text, true); // como no ChatGPT: falou, já vai; a fala aparece no chat
        else if (automatic && !panel.hidden) setTimeout(() => { if (automatic && !busy && !speaking) record(); }, 600);
      };
      recorder.start(); controls(); timer = setTimeout(() => stopRecording(), 60000);
      $('lua-mic').textContent = '■'; $('lua-mic').setAttribute('aria-label', 'Finalizar gravação');
      setState('gravando', automatic ? 'Ouvindo… fale à vontade; quando você parar, eu respondo.' : 'Gravando… toque no ■ para enviar.');
      showLegend('Você', SR && !mobile ? '…' : 'falando… (o texto aparece quando você terminar)');
      startMeter(media); startCaption();
    } catch { stopRecording(true); setState('', 'Não foi possível usar o microfone. Você pode digitar sua mensagem.'); }
  }
  function toggle(open) {
    panel.hidden = !open; launcher.setAttribute('aria-expanded', String(open));
    if (open) { $('mr7-quote-toggle').focus(); connect(); }
    else { stopVoice(); stopRecording(true); launcher.focus(); }
  }
  launcher.addEventListener('click', () => toggle(panel.hidden));
  $('mr7-chat-close').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });
  $('mr7-chat-form').addEventListener('submit', e => { e.preventDefault(); send(input.value); });
  document.querySelectorAll('[data-msg]').forEach(b => b.addEventListener('click', () => send(b.dataset.msg)));
  $('lua-mic').addEventListener('click', record);
  $('lua-read-last').addEventListener('click', () => speak(lastReply));
  $('lua-stop').addEventListener('click', () => { stopVoice(); setState(''); });
  $('lua-pause').addEventListener('click', async () => {
    if (!speaking) return;
    if (paused) {
      paused = false; $('lua-pause').textContent = '⏸ Pausar';
      if (audio) { try { await audio.play(); setState('falando', 'Lua falando'); } catch { setState('', 'Clique em Ouvir para tentar novamente.'); } }
      else setState('preparando', 'Lua continua já…');
    } else {
      paused = true; audio?.pause(); $('lua-pause').textContent = '▶ Continuar'; setState('', 'Voz pausada');
    }
  });
  $('lua-sound-toggle').addEventListener('click', () => {
    automatic = !automatic; const b = $('lua-sound-toggle');
    b.setAttribute('aria-pressed', String(automatic)); b.classList.toggle('ligada', automatic);
    b.querySelector('.lua-auto-txt').textContent = automatic ? 'Resposta automática: LIGADA' : 'Resposta automática';
    if (automatic) {
      setState('', 'Resposta automática ligada: é só falar. A Lua responde falando e volta a ouvir.');
      if (connected && !busy && !speaking && recorder?.state !== 'recording') record();
    } else { stopVoice(); stopRecording(true); setState('', 'Resposta automática desligada.'); }
  });
  $('mr7-quote-toggle').addEventListener('click', () => {
    stopVoice(); stopRecording(true); const quote = $('mr7-quote-form'); quote.hidden = !quote.hidden;
    stream.hidden = !quote.hidden; $('mr7-chat-form').hidden = !quote.hidden;
    $('mr7-quote-toggle').textContent = quote.hidden ? '✦ Briefings oficiais' : '← Voltar';
  });
  window.addEventListener('pagehide', () => { stopVoice(); stopRecording(true); });
  input.placeholder = 'Verificando conexão com o CRM7'; controls();
})();
