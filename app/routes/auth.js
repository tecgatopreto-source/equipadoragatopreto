// Sessão: o Catálogo não tem login próprio nem cookie (ADR 0010). O navegador
// manda o token da sessão compartilhada `gp_session` em `Authorization: Bearer`
// e cada chamada é conferida em middleware/auth.js. Aqui fica só o "quem sou eu",
// que as páginas usam para decidir o que mostrar (D1 do plano de 08/10/2026).
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

// GET /api/auth/me — dono do token e papel no Catálogo, lido agora em public.perfis.
router.get('/me', authenticate, (req, res) => {
  const { id, email, username, role } = req.user;
  res.json({ user: { id, email, username, role } });
});

module.exports = router;
