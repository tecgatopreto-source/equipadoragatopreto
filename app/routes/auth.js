const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { JWT_SECRET, COOKIE_NAME, COOKIE_OPTS } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SISTEMA           = 'CatalogoProdutos';

async function supabaseLogout(accessToken) {
  // scope=local: revoga só a sessão recém-criada pelo login por senha. Sem o
  // parâmetro, o Supabase revoga TODAS as sessões do usuário — derrubaria a
  // sessão compartilhada 'gp_session' da plataforma inteira.
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}` },
    });
  } catch (_) {}
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email: email.toLowerCase().trim(), password }),
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const u           = data.user;
    const accessToken = data.access_token;

    const perfisRes  = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis?user_id=eq.${encodeURIComponent(u.id)}&sistema=eq.${encodeURIComponent(SISTEMA)}&select=role&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    const perfisData = await perfisRes.json();

    if (!Array.isArray(perfisData) || perfisData.length === 0) {
      supabaseLogout(accessToken);
      return res.status(401).json({ error: 'no_access' });
    }

    const role = perfisData[0].role || 'conferente';

    const token = jwt.sign(
      { id: u.id, username: u.email, role },
      JWT_SECRET,
      { expiresIn: '12h', algorithm: 'HS256' }
    );

    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.json({ user: { id: u.id, username: u.email, role } });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/sso
// SSO com a Central de Sistemas: o browser envia o access_token da sessão
// Supabase compartilhada ('gp_session', mesma origem em produção). O token é
// validado no Supabase, o gate de perfis é o mesmo do login por senha e o
// cookie gp_auth emitido é idêntico. Se qualquer etapa falhar, o cliente cai
// no formulário de login normal.
router.post('/sso', loginLimiter, async (req, res) => {
  const { access_token } = req.body || {};
  if (!access_token)
    return res.status(400).json({ error: 'access_token é obrigatório' });

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${access_token}` },
    });

    if (!r.ok) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    const u = await r.json();

    const perfisRes  = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis?user_id=eq.${encodeURIComponent(u.id)}&sistema=eq.${encodeURIComponent(SISTEMA)}&select=role&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${access_token}`,
        },
      }
    );
    const perfisData = await perfisRes.json();

    if (!Array.isArray(perfisData) || perfisData.length === 0) {
      return res.status(401).json({ error: 'no_access' });
    }

    const role = perfisData[0].role || 'conferente';

    const token = jwt.sign(
      { id: u.id, username: u.email, role },
      JWT_SECRET,
      { expiresIn: '12h', algorithm: 'HS256' }
    );

    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.json({ user: { id: u.id, username: u.email, role } });
  } catch (err) {
    console.error('[auth] sso error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
