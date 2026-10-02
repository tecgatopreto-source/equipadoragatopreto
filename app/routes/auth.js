const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { JWT_SECRET, COOKIE_NAME, revokeToken, _refreshCookie } = require('../middleware/auth');
const { loginLimiter, ssoLimiter } = require('../middleware/rateLimit');
const { loginLocalLigado } = require('../config');

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

// POST /api/auth/login — login por senha. SÓ com LOGIN_LOCAL=1 (máquina de
// desenvolvimento, onde a Central roda em outra origem e o login único não
// enxerga a sessão). Em produção a rota não existe: a entrada é só pela
// Central, via /sso abaixo.
if (loginLocalLigado(process.env)) router.post('/login', loginLimiter, async (req, res) => {
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
      console.warn(`[auth] login falhou (invalid_credentials): email=${email} ip=${req.ip}`);
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
      console.warn(`[auth] login falhou (no_access): email=${email} ip=${req.ip}`);
      supabaseLogout(accessToken);
      return res.status(401).json({ error: 'no_access' });
    }

    const role = perfisData[0].role || 'user';

    _refreshCookie(res, { id: u.id, username: u.email, role });
    res.json({ user: { id: u.id, username: u.email, role } });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: 'Erro ao autenticar.' });
  }
});

// POST /api/auth/sso
// Login único com a Central de Sistemas — a ÚNICA entrada em produção. O
// browser envia o access_token da sessão Supabase compartilhada ('gp_session',
// mesma origem em produção). O token é validado no Supabase, o perfil em
// public.perfis decide o acesso e o cookie gp_auth é emitido. Se falhar, a
// página de passagem (/login) mostra "Entre pela Central" ou "Sem acesso".
router.post('/sso', ssoLimiter, async (req, res) => {
  const { access_token } = req.body || {};
  if (!access_token)
    return res.status(400).json({ error: 'access_token é obrigatório' });

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${access_token}` },
    });

    if (!r.ok) {
      console.warn(`[auth] sso falhou (invalid_token): ip=${req.ip}`);
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
      console.warn(`[auth] sso falhou (no_access): email=${u.email} ip=${req.ip}`);
      return res.status(401).json({ error: 'no_access' });
    }

    const role = perfisData[0].role || 'user';

    _refreshCookie(res, { id: u.id, username: u.email, role });
    res.json({ user: { id: u.id, username: u.email, role } });
  } catch (err) {
    console.error('[auth] sso error:', err);
    res.status(500).json({ error: 'Erro ao autenticar.' });
  }
});

// POST /api/auth/logout — encerra SÓ a sessão do Catálogo (revoga o cookie).
// Não há mais botão "Sair" aqui: sai-se pela Central. A página pública chama
// esta rota quando a sessão da Central sumiu (ou é de outra conta), para o
// cookie de 12h daqui não continuar valendo sozinho.
router.post('/logout', async (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      await revokeToken(payload.jti, payload.exp);
    } catch (_) {
      // Token já inválido/expirado — nada a revogar.
    }
  }
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
