(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('mr7-chat-panel'), launcher = $('mr7-chat-launcher'), input = $('mr7-chat-input');
  const stream = $('mr7-chat-stream'), status = $('mr7-chat-status');
  const config = window.MR7_CHAT_CONFIG || {};
  let connected = false, busy = false, automatic = false, lastReply = '', history = [];
  let audio = null, audioUrl = null, voiceRequest = null, version = 0;
  let recorder = null, micStream = null, timer = null, cancelled = false;
  function controls() {
    const recording = recorder?.state === 'recording';
    input.disabled = !connected || busy || recording;
    document.querySelector('.lua-send').disabled = !connected || busy || recording;
    $('lua-mic').disabled = !connected || busy || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia;
    $('lua-sound-toggle').disabled = !connected;
    $('lua-read-last').disabled = !connected || !lastReply;
    $('lua-pause').disabled = !audio;
    $('lua-stop').disabled = !audio && !voiceRequest;
    $('mr7-chat-quick').hidden = !connected || recording;
  }
  function bubble(text, bot = true) {
    const div = document.createElement('div'); div.className = `mr7-bubble ${bot ? 'bot' : 'user'}`;
    div.textContent = text; stream.appendChild(div); stream.scrollTop = stream.scrollHeight;
  }
  async function api(data, signal) {
    const r = await fetch(config.endpoint || '/api/lua', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Atendimento indisponível. Fale com a equipe pelo WhatsApp.'); }
    return data.action === 'tts' ? r.blob() : r.json();
  }
  function stopVoice() {
    version++; voiceRequest?.abort(); voiceRequest = null;
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    $('lua-pause').textContent = '⏸ Pausar'; controls();
  }
  async function speak(text) {
    stopVoice(); const ownVersion = version; voiceRequest = new AbortController(); controls();
    status.textContent = 'Preparando a voz da Lua…';
    try {
      const blob = await api({ action: 'tts', text }, voiceRequest.signal);
      if (ownVersion !== version) return;
      audioUrl = URL.createObjectURL(blob); audio = new Audio(audioUrl);
      audio.addEventListener('ended', () => { stopVoice(); status.textContent = ''; });
      await audio.play(); status.textContent = 'Lua falando';
    } catch (e) { if (ownVersion === version && e.name !== 'AbortError') { stopVoice(); status.textContent = 'Não foi possível ouvir agora. A resposta permanece no chat.'; } }
    finally { if (ownVersion === version) { voiceRequest = null; controls(); } }
  }
  async function send(message) {
    if (!connected || busy || recorder?.state === 'recording' || !message.trim()) return;
    message = message.trim().slice(0, 1500); busy = true; stopVoice(); controls();
    input.value = ''; bubble(message, false); status.textContent = 'Lua está respondendo…';
    try {
      const d = await api({ action: 'chat', message, history: history.slice(-12) });
      if (typeof d.reply !== 'string' || !d.reply.trim()) throw new Error('Resposta indisponível. Tente novamente.');
      lastReply = d.reply; bubble(lastReply);
      history.push({ role: 'user', content: message }, { role: 'assistant', content: lastReply }); history = history.slice(-12);
      status.textContent = ''; if (automatic && !panel.hidden) speak(lastReply);
    } catch (e) { bubble(e.message); status.textContent = 'Falha no atendimento'; }
    finally { busy = false; controls(); if (!panel.hidden) input.focus(); }
  }
  async function connect() {
    if (connected || config.enabled !== true) return;
    status.textContent = 'Verificando conexão com o CRM7…';
    try {
      const r = await fetch(config.endpoint || '/api/lua', { cache: 'no-store' }); const d = await r.json();
      if (!r.ok || d.bridge !== true) throw new Error();
      connected = true; input.placeholder = 'Pergunte à Lua…';
      document.querySelector('.lua-head small').textContent = 'Atendimento MR7';
      if (!history.length) { stream.replaceChildren(); bubble('Olá! Sou a Lua MR7. Qual projeto você quer tirar do papel? Posso explicar os serviços e orientar você até o briefing oficial.'); }
      status.textContent = ''; controls(); if (!panel.hidden) input.focus();
    } catch { status.textContent = 'Conexão com o CRM7 ainda indisponível. Use os briefings ou o WhatsApp.'; }
  }
  function stopRecording(cancel = false) {
    cancelled = cancel; clearTimeout(timer);
    if (recorder?.state === 'recording') recorder.stop();
    micStream?.getTracks().forEach(t => t.stop()); micStream = null;
    $('lua-mic').textContent = '🎙'; $('lua-mic').setAttribute('aria-label', 'Ditar mensagem'); controls();
  }
  async function record() {
    if (recorder?.state === 'recording') { stopRecording(); return; }
    if (!connected || busy) return;
    stopVoice(); cancelled = false;
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
        if (!blob.size || blob.size > 1048576) { status.textContent = 'Grave uma mensagem mais curta, de até 60 segundos.'; return; }
        busy = true; controls(); status.textContent = 'Transcrevendo sua fala…';
        try {
          const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
          const d = await api({ action: 'transcription', audio: base64, mime });
          input.value = d.text || ''; status.textContent = 'Confira a transcrição e envie sua mensagem.';
        } catch (e) { status.textContent = e.message; }
        finally { busy = false; controls(); }
      };
      recorder.start(); controls(); timer = setTimeout(() => stopRecording(), 60000);
      $('lua-mic').textContent = '■'; $('lua-mic').setAttribute('aria-label', 'Finalizar gravação');
      status.textContent = 'Gravando. Clique novamente para finalizar.';
    } catch { stopRecording(true); status.textContent = 'Não foi possível usar o microfone. Você pode digitar sua mensagem.'; }
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
  $('lua-stop').addEventListener('click', () => { stopVoice(); status.textContent = ''; });
  $('lua-pause').addEventListener('click', async () => {
    if (!audio) return;
    if (audio.paused) { try { await audio.play(); $('lua-pause').textContent = '⏸ Pausar'; status.textContent = 'Lua falando'; } catch { status.textContent = 'Clique em Ouvir para tentar novamente.'; } }
    else { audio.pause(); $('lua-pause').textContent = '▶ Continuar'; status.textContent = 'Voz pausada'; }
  });
  $('lua-sound-toggle').addEventListener('click', () => {
    automatic = !automatic; $('lua-sound-toggle').setAttribute('aria-pressed', String(automatic));
    status.textContent = automatic ? 'Leitura automática ativada' : 'Leitura automática desativada'; if (!automatic) stopVoice();
  });
  $('mr7-quote-toggle').addEventListener('click', () => {
    stopVoice(); stopRecording(true); const quote = $('mr7-quote-form'); quote.hidden = !quote.hidden;
    stream.hidden = !quote.hidden; $('mr7-chat-form').hidden = !quote.hidden;
    $('mr7-quote-toggle').textContent = quote.hidden ? '✦ Briefings oficiais' : '← Voltar';
  });
  window.addEventListener('pagehide', () => { stopVoice(); stopRecording(true); });
  input.placeholder = 'Verificando conexão com o CRM7'; controls();
})();
