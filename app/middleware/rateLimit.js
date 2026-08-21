const rateLimit = require('express-rate-limit');
const { JWT_SECRET, COOKIE_NAME } = require('./auth');
const jwt = require('jsonwebtoken');

// Decodifica o cookie gp_auth (se presente) só pra extrair o user id e
// escopar o limite por usuário — não por IP, já que vários usuários podem
// estar atrás do mesmo IP corporativo/NAT. Sem cookie válido, cai pro IP.
function _userOrIpKey(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      if (payload && payload.id) return `user:${payload.id}`;
    } catch { /* token ausente/expirado: cai pro IP abaixo */ }
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

// Limiter restrito pro login/SSO — chave combinada IP + e-mail, evita força
// bruta numa conta específica sem penalizar todo mundo atrás do mesmo IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => {
    const email = (req.body && req.body.email || '').toLowerCase().trim();
    return `${rateLimit.ipKeyGenerator(req.ip)}:${email}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' },
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

module.exports = { mutationLimiter, loginLimiter, imageSearchLimiter };
