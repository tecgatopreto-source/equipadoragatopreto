const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDb, DB_SCHEMA } = require('../db/schema');
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
const methodsRequiringCsrf = ['post', 'put', 'patch', 'delete'];

function signToken({ id, username, role }) {
  return jwt.sign(
    { id, username, role, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '12h', algorithm: 'HS256' }
  );
}

function _refreshCookie(res, payload) {
  res.cookie(COOKIE_NAME, signToken(payload), COOKIE_OPTS);
  const csrfToken = crypto.randomUUID();
  res.cookie('gp_csrf', csrfToken, {  ... COOKIE_OPTS,
    httpOnly: false,
  }) // JS do SPA precisa ler o CSRF});
}

async function isRevoked(jti) {
  if (!jti) return false; // tokens emitidos antes desta mudança não têm jti
  const { rows } = await getDb().query(
    `SELECT 1 FROM "${DB_SCHEMA}".revoked_tokens WHERE jti = $1`,
    [jti]
  );
  return rows.length > 0;
}

async function revokeToken(jti, exp) {
  if (!jti) return;
  const db = getDb();
  await db.query(
    `INSERT INTO "${DB_SCHEMA}".revoked_tokens (jti, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT (jti) DO NOTHING`,
    [jti, exp]
  );
  // Limpeza oportunista: remove revogações cujo token já expiraria de qualquer forma.
  db.query(`DELETE FROM "${DB_SCHEMA}".revoked_tokens WHERE expires_at < now()`).catch(() => {});
}

async function authenticate(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await isRevoked(payload.jti)) {
      res.clearCookie(COOKIE_NAME);
      return res.status(401).json({ error: 'Sessão encerrada' });
    }
    req.user = payload;
    if (methodsRequiringCsrf.includes(req.method.toLowerCase())) {
      const csrfCookie = req.cookies['gp_csrf'];
      const csrfHeader = req.get('X-CSRF-Token');
      if (!csrfCookie || csrfCookie !== csrfHeader) {
        return res.status(403).json({ error: 'Token CSRF não fornecido' });
      }
    }
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

module.exports = { authenticate, requireAdmin, _refreshCookie, signToken, revokeToken, JWT_SECRET, COOKIE_NAME, COOKIE_OPTS };
