(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const launcher = byId('mr7-chat-launcher');
  const panel = byId('mr7-chat-panel');
  const input = byId('mr7-chat-input');
  function toggle(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) byId('mr7-quote-toggle').focus(); else launcher.focus();
  }
  launcher.addEventListener('click', () => toggle(panel.hidden));
  byId('mr7-chat-close').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && !panel.hidden) toggle(false); });
  // O motor público ainda não existe: nenhum fallback genérico ou voz de navegador.
  byId('mr7-chat-form').addEventListener('submit', e => e.preventDefault());
  input.disabled = true;
  input.placeholder = 'Conexão segura com CRM7 pendente';
  ['lua-mic','lua-sound-toggle','lua-read-last','lua-pause','lua-stop'].forEach(id => {
    byId(id).disabled = true;
    byId(id).title = 'Aguardando integração autorizada com o CRM7';
  });
  document.querySelector('.lua-send').disabled = true;
  byId('mr7-chat-quick').hidden = true;
  byId('mr7-chat-status').textContent = 'IA e voz do CRM7 ainda não conectadas';
  byId('mr7-quote-toggle').addEventListener('click', () => {
    const quote = byId('mr7-quote-form'); quote.hidden = !quote.hidden;
    byId('mr7-chat-stream').hidden = !quote.hidden;
    byId('mr7-chat-form').hidden = !quote.hidden;
    byId('mr7-quote-toggle').textContent = quote.hidden ? '✦ Briefings oficiais' : '← Voltar';
  });
})();
