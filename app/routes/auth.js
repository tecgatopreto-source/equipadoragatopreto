const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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
      const msg = data?.error_description || data?.msg || data?.message || 'Credenciais inválidas';
      return res.status(401).json({ error: msg });
    }

    const u    = data.user;
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
