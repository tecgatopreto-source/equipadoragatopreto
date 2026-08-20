const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var não definida');

const COOKIE_NAME = 'gp_auth';
const COOKIE_MAX_AGE = 12 * 60 * 60 * 1000; // 12h em ms
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: COOKIE_MAX_AGE,
  // Fixo em false: produção ainda roda em HTTP puro (sem TLS/domínio configurado).
  // secure:true com NODE_ENV=production faz o navegador recusar o cookie nessa
  // condição. Pendência de segurança: religar quando HTTPS estiver disponível.
  secure: false,
};

function _refreshCookie(res, payload) {
  const newToken = jwt.sign(
    { id: payload.id, username: payload.username, role: payload.role },
    JWT_SECRET,
    { expiresIn: '12h', algorithm: 'HS256' }
  );
  res.cookie(COOKIE_NAME, newToken, COOKIE_OPTS);
}

function authenticate(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  try {
    req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    _refreshCookie(res, req.user); // sliding window
    next();
  } catch {
    res.clearCookie(COOKIE_NAME);
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function requireAdmin(req, res, next) {
  authenticate(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }
    next();
  });
}

module.exports = { authenticate, requireAdmin, JWT_SECRET, COOKIE_NAME, COOKIE_OPTS };
