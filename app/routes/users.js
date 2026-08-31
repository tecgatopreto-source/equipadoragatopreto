const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const { getDb } = require('../db/schema');

const SISTEMA = 'CatalogoProdutos';
const VALID_ROLES = ['admin', 'conferente'];

// GET /api/users — lista quem tem acesso a este sistema
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await getDb().query(
      `SELECT p.user_id, p.role, u.email
       FROM public.perfis p
       JOIN auth.users u ON u.id = p.user_id
       WHERE p.sistema = $1
       ORDER BY u.email`,
      [SISTEMA]
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('[users] list error:', err);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// PATCH /api/users/:userId/role — altera o papel do usuário neste sistema
router.patch('/:userId/role', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body || {};

  if (!VALID_ROLES.includes(role))
    return res.status(400).json({ error: 'Role inválido. Use: admin ou conferente' });

  try {
    const { rows: prevRows } = await getDb().query(
      `SELECT role FROM public.perfis WHERE user_id = $1 AND sistema = $2`,
      [userId, SISTEMA]
    );
    if (!prevRows[0])
      return res.status(404).json({ error: 'Usuário não encontrado neste sistema' });
    const prevRole = prevRows[0].role;

    await getDb().query(
      `UPDATE public.perfis SET role = $1 WHERE user_id = $2 AND sistema = $3`,
      [role, userId, SISTEMA]
    );

    console.warn(`[users] role alterada por admin=${req.user.username} (${req.user.id}): user=${userId} ${prevRole} -> ${role}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[users] role update error:', err);
    res.status(500).json({ error: 'Erro ao atualizar papel do usuário.' });
  }
});

module.exports = router;
