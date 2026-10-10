// Configuração pública sem credenciais. Ativar somente após aprovação e teste da ponte CRM7.
// A ponte verifica a ativação no servidor. Nenhum segredo aqui.
window.MR7_CHAT_CONFIG = Object.freeze({ enabled: true, endpoint: '/api/lua' });
