const rateLimit = require('express-rate-limit');
const { tokenDoCabecalho, validarToken } = require('./auth');

// Escopa o limite por usuário — não por IP, já que vários usuários podem estar
// atrás do mesmo IP corporativo/NAT. Só usa o `sub` de um token com ASSINATURA
// CONFERIDA: este limiter roda antes da autenticação das rotas, e um `sub` lido
// sem conferir deixaria qualquer um gastar o limite de outra pessoa. Sem token
// válido, cai pro IP. (Conferir a assinatura é local: o JWKS fica em memória.)
async function _userOrIpKey(req) {
  const token = tokenDoCabecalho(req);
  if (token) {
    try {
      return `user:${(await validarToken(token)).sub}`;
    } catch { /* token ausente/inválido/vencido ou JWKS fora: cai pro IP abaixo */ }
  }
  return rateLimit.ipKeyGenerator(req.ip);
}

// Limiter geral pra qualquer rota /api — mutação de dados por usuário autenticado.
const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: _userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições em pouco tempo. Aguarde um momento e tente novamente.' },
});

// Limiter dedicado pra busca de imagens (?fresh=1 em /search-images) — rota
// pública sem auth que dispara busca real (Google CSE pago, se configurado,
// ou scraping do Bing). Chave só por IP: o custo é por origem de rede, não
// por usuário (a rota nem exige login). Bem mais apertado que o mutationLimiter
// geral porque cada chamada tem custo real, não é só escrita no banco (SEC-002).
const imageSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  keyGenerator: (req) => rateLimit.ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas buscas de imagem em pouco tempo. Aguarde um momento e tente novamente.' },
});

module.exports = { mutationLimiter, imageSearchLimiter };
