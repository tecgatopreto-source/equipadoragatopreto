const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SISTEMA           = 'CatalogoProdutos';

async function supabaseLogout(accessToken) {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}` },
    });
  } catch (_) {}
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
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
      `${SUPABASE_URL}/rest/v1/perfis?user_id=eq.${u.id}&sistema=eq.${SISTEMA}&select=user_id&limit=1`,
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

    const role = u?.app_metadata?.role || u?.user_metadata?.role || 'user';

    const token = jwt.sign(
      { id: u.id, username: u.email, role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, user: { id: u.id, username: u.email, role } });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
