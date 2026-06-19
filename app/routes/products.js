const router  = require('express').Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { getDb, DB_SCHEMA } = require('../db/schema');
const _s = `"${DB_SCHEMA}".`;
const { authenticate, requireAdmin } = require('../middleware/auth');
const cache = require('../lib/cache');

const PROD_IMG_DIR = path.join(
  process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  'product-images'
);
if (!fs.existsSync(PROD_IMG_DIR)) fs.mkdirSync(PROD_IMG_DIR, { recursive: true });

const imgUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PROD_IMG_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Apenas imagens são aceitas.'));
  },
});

// ════════════════════════════════════════════════════════════════════════════
//  Status calculation
// ════════════════════════════════════════════════════════════════════════════
function calcStatus(stockFiscal, stockMgmt) {
  if (stockFiscal != null && stockMgmt == null) return 2;
  if (stockFiscal == null && stockMgmt == null) return 0;
  return (stockFiscal == stockMgmt) ? 0 : 1;
}

const TTL_STATS      = 2  * 60 * 1000;
const TTL_CATEGORIES = 10 * 60 * 1000;
const TTL_PRODUCTS   = 60 * 1000;
const TTL_ACTION     = 60 * 1000;

async function _invalidateAll(pool) {
  cache.clear('products:');
  cache.clear('stats');
  cache.clear('action-stats');
  try {
    await pool.query(`REFRESH MATERIALIZED VIEW ${_s}product_stats`);
  } catch (e) {
    console.error('[cache] REFRESH MATERIALIZED VIEW falhou:', e.message);
  }
}

function _invalidateImages() {
  cache.clear('products:');
}

// ── GET /api/products/categories ──────────────────────────────────────────
router.get('/categories', async (_req, res) => {
  const cached = cache.get('categories');
  if (cached) return res.json(cached);
  const pool = getDb();
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT categoria FROM ${_s}products WHERE categoria IS NOT NULL ORDER BY categoria`
    );
    const result = { categories: rows.map(r => r.categoria) };
    cache.set('categories', result, TTL_CATEGORIES);
    res.json(result);
  } catch (err) {
    console.error('GET /categories error:', err);
    res.status(500).json({ error: 'Erro ao buscar categorias.' });
  }
});

// ── GET /api/products ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { q = '', name_q = '', code_q = '', status = 'T', page = 1, limit = 60, sort = 'id', order = 'asc' } = req.query;
  const { fiscal_alert: _cfa, disabled: _cdis, cat: _ccat, capota_type: _cct } = req.query;
  const cacheKey = `products:${q}|${name_q}|${code_q}|${status}|${page}|${limit}|${sort}|${order}|${_cfa ?? ''}|${_cdis ?? ''}|${_ccat ?? ''}|${_cct ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);
  const pool = getDb();
  const off = (parseInt(page) - 1) * parseInt(limit);

  const SORT_MAP = {
    id:              'p.id',
    name:            'p.name',
    price_fiscal:    'p.price_fiscal',
    price_mgmt:      'p.price_mgmt',
    stock_fiscal:    'p.stock_fiscal',
    stock_mgmt:      'p.stock_mgmt',
    snap_stock_mgmt: 'p.snap_stock_mgmt',
    stock_real:      'p.stock_real',
    diff_pct:     `(CASE WHEN GREATEST(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.snap_stock_mgmt,0))) = 0
                    THEN 0
                    ELSE ABS(COALESCE(p.stock_fiscal,0) - COALESCE(p.snap_stock_mgmt,0)) * 100.0
                         / GREATEST(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.snap_stock_mgmt,0)))
                    END)`,
    real_pct:     `(CASE WHEN GREATEST(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.stock_real,0))) = 0
                    THEN 0
                    ELSE ABS(COALESCE(p.stock_fiscal,0) - COALESCE(p.stock_real,0)) * 100.0
                         / GREATEST(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.stock_real,0)))
                    END)`,
  };
  const sortCol = SORT_MAP[sort] || 'p.id';
  const sortDir = order === 'desc' ? 'DESC' : 'ASC';

  const params = [];
  const conditions = [];

  if (code_q.trim()) {
    params.push('%' + code_q.trim().toLowerCase() + '%');
    conditions.push(`p.id ILIKE $${params.length}`);
  } else if (name_q.trim()) {
    params.push('%' + name_q.trim().toUpperCase() + '%');
    conditions.push(`upper(p.name) LIKE $${params.length}`);
  } else if (q.trim()) {
    params.push('%' + q.trim().toUpperCase() + '%');
    conditions.push(`(upper(p.name) LIKE $${params.length} OR p.id ILIKE $${params.length})`);
  }
  if (status !== 'T') {
    params.push(parseInt(status));
    conditions.push(`p.status = $${params.length}`);
  }

  const { fiscal_alert, disabled, cat, capota_type } = req.query;
  if (fiscal_alert === '1') conditions.push('p.fiscal_alert = 1');
  if (disabled === '0')      conditions.push('COALESCE(p.is_disabled, 0) = 0');
  else if (disabled === '1') conditions.push('COALESCE(p.is_disabled, 0) = 1');

  if (cat && cat.trim()) {
    params.push(cat.trim());
    conditions.push(`p.categoria = $${params.length}`);
  }

  if (capota_type === 'FF') conditions.push(`p.name ~ 'L?FF ?[0-9]+'`);
  else if (capota_type === 'P') conditions.push(`p.name ~ '[. ]P[0-9]+'`);

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // countParams snapshot before adding the exact-match param (used only in ORDER BY)
  const countParams = [...params];

  let orderBy;
  if (code_q.trim()) {
    params.push(code_q.trim().toLowerCase());
    orderBy = `CASE WHEN LOWER(p.id) = $${params.length} THEN 0 ELSE 1 END, ${sortCol} ${sortDir}`;
  } else {
    orderBy = `${sortCol} ${sortDir}`;
  }

  try {
    const dataParams = [...params, parseInt(limit), off];
    const t0 = Date.now();

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) as n FROM ${_s}products p ${where}`, countParams),
      pool.query(`
      SELECT p.id, p.name, p.price_fiscal, p.price_mgmt,
             p.stock_fiscal, p.stock_mgmt, p.snap_stock_mgmt, p.stock_real,
             p.snap_price_mgmt, p.categoria,
             p.fiscal_alert, p.status, COALESCE(p.is_disabled, 0) as is_disabled,
             pi.url as pinned_img,
             (CASE WHEN GREATEST(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.snap_stock_mgmt,0))) = 0
                   THEN 0
                   ELSE ABS(COALESCE(p.stock_fiscal,0) - COALESCE(p.snap_stock_mgmt,0)) * 100.0
                        / GREATEST(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.snap_stock_mgmt,0)))
              END) AS diff_pct,
             (CASE WHEN p.stock_real IS NULL THEN NULL
                   WHEN GREATEST(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.stock_real,0))) = 0 THEN 0
                   ELSE ABS(COALESCE(p.stock_fiscal,0) - COALESCE(p.stock_real,0)) * 100.0
                        / GREATEST(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.stock_real,0)))
              END) AS real_pct
      FROM ${_s}products p
      LEFT JOIN ${_s}product_images pi ON pi.product_id = p.id AND pi.is_pinned = 1
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `, dataParams),
    ]);
    const total = parseInt(countResult.rows[0].n);
    const rows = dataResult.rows;
    console.log(`[perf] GET /products q="${q||name_q||code_q}" → ${rows.length} rows em ${Date.now() - t0}ms`);

    const result = { total, page: parseInt(page), limit: parseInt(limit), products: rows };
    cache.set(cacheKey, result, TTL_PRODUCTS);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/stats ────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  const cached = cache.get('stats');
  if (cached) return res.json(cached);
  try {
    const pool = getDb();
    const { rows } = await pool.query(
      `SELECT total, iguais, divergentes, so_fiscal FROM ${_s}product_stats`
    );
    const s = rows[0];
    const result = {
      total:       parseInt(s.total),
      iguais:      parseInt(s.iguais),
      divergentes: parseInt(s.divergentes),
      so_fiscal:   parseInt(s.so_fiscal),
    };
    cache.set('stats', result, TTL_STATS);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/action-stats ────────────────────────────────────────
router.get('/action-stats', authenticate, async (_req, res) => {
  const cached = cache.get('action-stats');
  if (cached) return res.json(cached);
  try {
    const pool = getDb();
    const [altRes, dstRes] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT product_id) as alteracoes FROM ${_s}product_audit WHERE changed_at >= CURRENT_DATE AND changed_at < CURRENT_DATE + INTERVAL '1 day'`),
      pool.query(`SELECT COUNT(*) as desativar FROM ${_s}products WHERE fiscal_alert = 1`),
    ]);
    const alteracoes = parseInt(altRes.rows[0].alteracoes);
    const desativar  = parseInt(dstRes.rows[0].desativar);
    const result = { alteracoes, desativar, atualizar: alteracoes };
    cache.set('action-stats', result, TTL_ACTION);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/report ───────────────────────────────────────────────
router.get('/report', authenticate, async (req, res) => {
  try {
    const pool = getDb();
    const { sort = 'changed_at', order = 'desc', date_from = '', date_to = '' } = req.query;

    const SORT_MAP = {
      id:           'a.product_id',
      name:         'a.name',
      stock_fiscal: 'a.stock_fiscal',
      stock_mgmt:   'a.stock_mgmt',
      stock_real:   'a.stock_real',
      changed_at:   'a.changed_at',
    };
    const sortCol = SORT_MAP[sort] || 'a.changed_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    const params = [];
    const conditions = [];
    if (date_from) { params.push(date_from); conditions.push(`a.changed_at >= $${params.length}::date`); }
    if (date_to)   { params.push(date_to);   conditions.push(`a.changed_at < ($${params.length}::date + INTERVAL '1 day')`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(`
      SELECT
        a.product_id  AS id,
        a.name,
        a.stock_fiscal,
        a.stock_mgmt,
        a.stock_real,
        TO_CHAR(a.changed_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS data,
        TO_CHAR(a.changed_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS') AS hora,
        a.changed_at
      FROM ${_s}product_audit a
      ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT 1000
    `, params);

    res.json({ total: rows.length, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/deactivate-report ───────────────────────────────────
router.get('/deactivate-report', authenticate, async (req, res) => {
  try {
    const pool = getDb();
    const { sort = 'changed_at', order = 'desc', flag = '', date_from = '', date_to = '' } = req.query;

    const refDate = 'COALESCE(a.changed_at, p.updated_at)';

    const SORT_MAP = {
      id:           'p.id',
      name:         'p.name',
      stock_fiscal: 'p.stock_fiscal',
      stock_mgmt:   'p.stock_mgmt',
      stock_real:   'p.stock_real',
      changed_at:   refDate,
      fiscal_alert: 'p.fiscal_alert',
    };
    const sortCol = SORT_MAP[sort] || refDate;
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    const params = [];
    const conditions = ['(p.fiscal_alert = 1 OR a.product_id IS NOT NULL)'];

    if (flag === 'desativar')      conditions.push('p.fiscal_alert = 1');
    else if (flag === 'atualizar') conditions.push('a.product_id IS NOT NULL');

    if (date_from) {
      params.push(date_from);
      conditions.push(`${refDate} >= $${params.length}::date`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`${refDate} < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    const { rows } = await pool.query(`
      SELECT
        p.id,
        SUBSTRING(p.name, 1, 20)                                          AS name_abbr,
        p.name                                                             AS name_full,
        p.stock_fiscal, p.stock_mgmt, p.stock_real, p.fiscal_alert,
        CASE WHEN p.fiscal_alert = 1       THEN 1 ELSE 0 END              AS has_fiscal_alert,
        CASE WHEN a.product_id IS NOT NULL THEN 1 ELSE 0 END              AS has_audit,
        TO_CHAR(${refDate} AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS data
      FROM ${_s}products p
      LEFT JOIN ${_s}product_audit a ON a.product_id = p.id
      ${where}
      ORDER BY ${sortCol} ${sortDir}
    `, params);

    res.json({ total: rows.length, rows });
  } catch (err) {
    console.error('[deactivate-report] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/products/:id/resolve-alert ─────────────────────────────────
router.patch('/:id/resolve-alert', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const { rows } = await pool.query(`SELECT id FROM ${_s}products WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });

    await Promise.all([
      pool.query(`UPDATE ${_s}products SET fiscal_alert = 0, updated_at = NOW() WHERE id = $1`, [req.params.id]),
      pool.query(`UPDATE ${_s}product_audit SET fiscal_alert = 0, changed_at = NOW() WHERE product_id = $1`, [req.params.id]),
    ]);
    await _invalidateAll(pool);
    res.json({ message: 'Alerta resolvido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getDb();
    const { rows: pRows } = await pool.query(`SELECT * FROM ${_s}products WHERE id = $1`, [req.params.id]);
    if (!pRows[0]) return res.status(404).json({ error: 'Produto não encontrado' });

    const { rows: images } = await pool.query(
      `SELECT * FROM ${_s}product_images WHERE product_id = $1 ORDER BY is_pinned DESC, id ASC`,
      [req.params.id]
    );
    res.json({ ...pRows[0], images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products ─────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const { id, name, price_fiscal, price_mgmt, stock_fiscal, stock_mgmt, stock_real, categoria } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id e name são obrigatórios' });

    const { rows: existing } = await pool.query(`SELECT id FROM ${_s}products WHERE id = $1`, [id]);
    if (existing[0]) return res.status(409).json({ error: 'Produto com este ID já existe' });

    const autoStatus = calcStatus(stock_fiscal ?? null, stock_mgmt ?? null);
    await pool.query(
      `INSERT INTO ${_s}products (id, name, price_fiscal, price_mgmt, stock_fiscal, stock_mgmt, stock_real, status, categoria)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, name, price_fiscal ?? null, price_mgmt ?? null,
       stock_fiscal ?? null, stock_mgmt ?? null, stock_real ?? null, autoStatus, categoria || null]
    );
    await _invalidateAll(pool);
    res.status(201).json({ message: 'Produto criado', id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  REGRA DE NEGÓCIO — Atualização de estoque
// ════════════════════════════════════════════════════════════════════════════
function applyStockRule(real, mgmt, alert) {
  if (real === null) return { stockMgmt: mgmt, fiscalAlert: alert, error: null };
  if (real < 0)  return { stockMgmt: mgmt, fiscalAlert: alert, error: 'O campo Real não pode ser negativo.' };
  if (real === 0) return { stockMgmt: 0, fiscalAlert: 1, error: null };
  return { stockMgmt: real, fiscalAlert: 0, error: null };
}

// ── PUT /api/products/:id ──────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const { name, price_mgmt, stock_mgmt, stock_real, categoria } = req.body;

    const { rows: bRows } = await pool.query(
      `SELECT name, price_fiscal, price_mgmt, stock_fiscal, stock_mgmt, snap_stock_mgmt, stock_real, status, fiscal_alert FROM ${_s}products WHERE id = $1`,
      [req.params.id]
    );
    if (!bRows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    const before = bRows[0];

    const realVal = (stock_real != null && stock_real !== '') ? parseFloat(stock_real) : null;
    const rule = applyStockRule(realVal, stock_mgmt ?? before.stock_mgmt, before.fiscal_alert);
    if (rule.error) return res.status(400).json({ error: rule.error });

    const newName        = name       ?? before.name;
    const newPriceMgmt   = price_mgmt ?? before.price_mgmt;
    const newStockFiscal = before.stock_fiscal;
    const newStockMgmt   = rule.stockMgmt;
    const newStockReal   = realVal;
    const newFiscalAlert = rule.fiscalAlert;
    const newStatus      = calcStatus(newStockFiscal, before.snap_stock_mgmt);

    const catVal = categoria !== undefined ? (categoria || null) : undefined;
    await pool.query(
      `UPDATE ${_s}products SET name=$1, price_mgmt=$2, stock_fiscal=$3, stock_mgmt=$4,
       stock_real=$5, fiscal_alert=$6, status=$7,
       categoria=COALESCE($9, categoria), updated_at=NOW() WHERE id=$8`,
      [newName, newPriceMgmt, newStockFiscal, newStockMgmt,
       newStockReal, newFiscalAlert, newStatus, req.params.id, catVal ?? null]
    );

    const changed =
      newName        !== before.name        ||
      newPriceMgmt   != before.price_mgmt   ||
      newStockMgmt   != before.stock_mgmt   ||
      newStockReal   != before.stock_real   ||
      newFiscalAlert !== before.fiscal_alert ||
      newStatus      !== before.status;

    if (changed) {
      await pool.query(
        `INSERT INTO ${_s}product_audit (product_id, name, stock_fiscal, stock_mgmt, stock_real, fiscal_alert, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT(product_id) DO UPDATE SET
           name         = EXCLUDED.name,
           stock_fiscal = EXCLUDED.stock_fiscal,
           stock_mgmt   = EXCLUDED.stock_mgmt,
           stock_real   = EXCLUDED.stock_real,
           fiscal_alert = EXCLUDED.fiscal_alert,
           changed_at   = EXCLUDED.changed_at`,
        [req.params.id, newName, newStockFiscal, newStockMgmt, newStockReal, newFiscalAlert]
      );
    }

    await _invalidateAll(pool);
    res.json({ message: 'Produto atualizado', changed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/products/:id/stock-real (conferente) ───────────────────────
router.patch('/:id/stock-real', authenticate, async (req, res) => {
  try {
    const pool = getDb();
    const { stock_real } = req.body;

    if (stock_real === undefined || stock_real === null || stock_real === '')
      return res.status(400).json({ error: 'stock_real é obrigatório' });

    const realVal = parseFloat(stock_real);
    if (isNaN(realVal)) return res.status(400).json({ error: 'Valor inválido' });

    const { rows: bRows } = await pool.query(
      `SELECT stock_fiscal, stock_mgmt, snap_stock_mgmt, stock_real, fiscal_alert FROM ${_s}products WHERE id = $1`,
      [req.params.id]
    );
    if (!bRows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    const before = bRows[0];

    const rule = applyStockRule(realVal, before.stock_mgmt, before.fiscal_alert);
    if (rule.error) return res.status(400).json({ error: rule.error });

    const newStockMgmt   = rule.stockMgmt;
    const newFiscalAlert = rule.fiscalAlert;
    const newStatus      = calcStatus(before.stock_fiscal, before.snap_stock_mgmt);

    await pool.query(
      `UPDATE ${_s}products SET stock_real=$1, stock_mgmt=$2, fiscal_alert=$3, updated_at=NOW() WHERE id=$4`,
      [realVal, newStockMgmt, newFiscalAlert, req.params.id]
    );

    const changed = realVal != before.stock_real || newStockMgmt != before.stock_mgmt || newFiscalAlert !== before.fiscal_alert;
    if (changed) {
      await pool.query(
        `INSERT INTO ${_s}product_audit (product_id, name, stock_fiscal, stock_mgmt, stock_real, fiscal_alert, changed_at)
         SELECT id, name, stock_fiscal, $1, $2, $3, NOW() FROM ${_s}products WHERE id = $4
         ON CONFLICT(product_id) DO UPDATE SET
           stock_mgmt   = EXCLUDED.stock_mgmt,
           stock_real   = EXCLUDED.stock_real,
           fiscal_alert = EXCLUDED.fiscal_alert,
           changed_at   = EXCLUDED.changed_at`,
        [newStockMgmt, realVal, newFiscalAlert, req.params.id]
      );
    }

    await _invalidateAll(pool);
    res.json({ message: 'Estoque real atualizado', stock_real: realVal, stock_mgmt: newStockMgmt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/products/:id ───────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query(`DELETE FROM ${_s}products WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Produto não encontrado' });
    await _invalidateAll(pool);
    res.json({ message: 'Produto removido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products/:id/images/upload  (multipart file) ────────────────
router.post('/:id/images/upload', imgUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  try {
    const pool = getDb();
    const { rows } = await pool.query(`SELECT id FROM ${_s}products WHERE id = $1`, [req.params.id]);
    if (!rows[0]) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }
    const url = `/uploads/product-images/${req.file.filename}`;
    await pool.query(`DELETE FROM ${_s}product_images WHERE product_id = $1 AND is_manual = 0`, [req.params.id]);

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM ${_s}product_images WHERE product_id=$1`, [req.params.id]);
    if (parseInt(countRows[0].count) >= 4) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'Limite de 4 imagens por produto atingido' });
    }

    await pool.query(`UPDATE ${_s}product_images SET is_pinned = 0 WHERE product_id = $1`, [req.params.id]);
    const { rows: ins } = await pool.query(
      `INSERT INTO ${_s}product_images (product_id, url, is_pinned, is_manual) VALUES ($1, $2, 1, 1) RETURNING id`,
      [req.params.id, url]
    );
    _invalidateImages();
    res.status(201).json({ id: ins[0].id, url, message: 'Imagem salva' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products/:id/images ─────────────────────────────────────────
router.post('/:id/images', async (req, res) => {
  try {
    const pool = getDb();
    const { url, is_pinned = 0, is_manual = 0 } = req.body;
    if (!url) return res.status(400).json({ error: 'URL é obrigatória' });

    const { rows } = await pool.query(`SELECT id FROM ${_s}products WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM ${_s}product_images WHERE product_id=$1`, [req.params.id]);
    if (parseInt(countRows[0].count) >= 4) {
      return res.status(400).json({ error: 'Limite de 4 imagens por produto atingido' });
    }

    if (is_pinned) {
      await pool.query(`UPDATE ${_s}product_images SET is_pinned=0 WHERE product_id=$1`, [req.params.id]);
    }

    const { rows: ins } = await pool.query(
      `INSERT INTO ${_s}product_images (product_id, url, is_pinned, is_manual) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.params.id, url, is_pinned ? 1 : 0, is_manual ? 1 : 0]
    );
    _invalidateImages();
    res.status(201).json({ id: ins[0].id, message: 'Imagem salva' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/products/:id/images/:imgId/pin ────────────────────────────────
router.put('/:id/images/:imgId/pin', async (req, res) => {
  try {
    const pool = getDb();
    await pool.query(`UPDATE ${_s}product_images SET is_pinned=0 WHERE product_id=$1`, [req.params.id]);
    const result = await pool.query(
      `UPDATE ${_s}product_images SET is_pinned=1 WHERE id=$1 AND product_id=$2`,
      [req.params.imgId, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Imagem não encontrada' });
    _invalidateImages();
    res.json({ message: 'Imagem fixada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/products/:id/images/:imgId ────────────────────────────────
router.delete('/:id/images/:imgId', async (req, res) => {
  try {
    const pool = getDb();
    const { rows: before } = await pool.query(
      `SELECT is_pinned FROM ${_s}product_images WHERE id=$1 AND product_id=$2`,
      [req.params.imgId, req.params.id]
    );
    if (!before[0]) return res.status(404).json({ error: 'Imagem não encontrada' });
    const wasPinned = before[0].is_pinned;

    await pool.query(`DELETE FROM ${_s}product_images WHERE id=$1 AND product_id=$2`, [req.params.imgId, req.params.id]);

    if (wasPinned) {
      await pool.query(
        `UPDATE ${_s}product_images SET is_pinned=1
         WHERE id = (SELECT id FROM ${_s}product_images WHERE product_id=$1 ORDER BY id ASC LIMIT 1)`,
        [req.params.id]
      );
    }

    _invalidateImages();
    res.json({ message: 'Imagem removida' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/products/:id/images ───────────────────────────────────────
router.delete('/:id/images', async (req, res) => {
  try {
    const pool = getDb();
    await pool.query(`DELETE FROM ${_s}product_images WHERE product_id=$1`, [req.params.id]);
    _invalidateImages();
    res.json({ message: 'Imagens removidas — próxima abertura buscará novamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/:id/search-images ──────────────────────────────────
// Sem ?fresh=1 → retorna cache (se existir) ou busca+salva automaticamente.
// Com ?fresh=1  → busca sempre, retorna candidatas SEM salvar (requer auth).
const _searching = new Set();

router.get('/:id/search-images', async (req, res) => {
  const id    = req.params.id;
  const fresh = req.query.fresh === '1';

  // Modo candidatas: público — só leitura, não salva nada
  if (fresh) {
    try {
      const pool = getDb();
      const prod = await pool.query(`SELECT id, name FROM ${_s}products WHERE id=$1`, [id]);
      if (!prod.rows.length) return res.status(404).json({ error: 'Produto não encontrado' });

      const { searchImages, buildQuery } = require('../lib/image-search');
      const urls = await searchImages(buildQuery(prod.rows[0]));
      return res.json({ images: urls.map(url => ({ url })), source: 'fresh' });
    } catch (err) {
      return res.status(502).json({ error: err.message, source: 'error' });
    }
  }

  // Modo auto-save: cache-first, depois busca e persiste
  try {
    const pool = getDb();
    const cached = await pool.query(
      `SELECT * FROM ${_s}product_images WHERE product_id=$1 ORDER BY is_pinned DESC, id ASC`,
      [id]
    );
    if (cached.rows.length) return res.json({ images: cached.rows, source: 'cache' });

    if (_searching.has(id)) return res.json({ images: [], source: 'pending' });
    _searching.add(id);

    const prod = await pool.query(`SELECT id, name FROM ${_s}products WHERE id=$1`, [id]);
    if (!prod.rows.length) {
      _searching.delete(id);
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const { searchAndSaveImages } = require('../lib/image-search');
    const images = await searchAndSaveImages(prod.rows[0]);
    _searching.delete(id);
    _invalidateImages();
    res.json({ images, source: 'auto' });
  } catch (err) {
    _searching.delete(req.params.id);
    res.status(502).json({ error: err.message, source: 'error' });
  }
});

module.exports = router;
