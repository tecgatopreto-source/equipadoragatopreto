const router  = require('express').Router();
const https   = require('https');
const http    = require('http');
const zlib    = require('zlib');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { getDb } = require('../db/schema');
const { authenticate, requireAdmin } = require('../middleware/auth');

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
//  HTTP helper — GET com suporte a gzip/brotli + redirect follow
// ════════════════════════════════════════════════════════════════════════════
function httpGet(url, extraHeaders = {}, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 5) return resolve('');
    const lib = url.startsWith('https') ? https : http;
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        ...extraHeaders,
      },
    };

    const req = lib.get(url, opts, (res) => {
      // Segue redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(httpGet(redirectUrl, extraHeaders, redirects + 1));
      }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'] || '';
        const decode = (b) => resolve(b.toString('utf8'));

        if (enc === 'br')
          zlib.brotliDecompress(buf, (e, d) => e ? resolve('') : decode(d));
        else if (enc === 'gzip')
          zlib.gunzip(buf, (e, d) => e ? resolve('') : decode(d));
        else if (enc === 'deflate')
          zlib.inflate(buf, (e, d) => e ? resolve('') : decode(d));
        else
          decode(buf);
      });
    });

    req.setTimeout(18000, () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  DuckDuckGo Image Search — thumbnails via Bing CDN (alta qualidade)
// ════════════════════════════════════════════════════════════════════════════
async function duckduckgoSearch(query) {
  try {
    const q = encodeURIComponent(query + ' autopeça');

    // Passo 1: página de imagens DDG para obter token vqd
    const html = await httpGet(
      `https://duckduckgo.com/?q=${q}&t=h_&iar=images&iax=images&ia=images`,
      { 'Referer': 'https://duckduckgo.com/' }
    );

    const vqdMatch = html.match(/vqd="([^"]+)"/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];

    // Passo 2: API de imagens com parâmetros corretos
    const jsonStr = await httpGet(
      `https://duckduckgo.com/i.js?q=${q}&o=json&p=1&vqd=${encodeURIComponent(vqd)}&f=,,,,,&l=pt-br&s=0`,
      {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        'Referer': 'https://duckduckgo.com/',
      }
    );

    const data = JSON.parse(jsonStr);
    return (data.results || [])
      .filter(r => r.thumbnail)
      .slice(0, 10)
      .map(r => r.thumbnail);
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Google Image Search via proxy allorigins.win (mesmo método do HTML original)
// ════════════════════════════════════════════════════════════════════════════
async function googleSearchProxy(query) {
  try {
    const q = encodeURIComponent(query + ' autopeça');
    const target = encodeURIComponent(
      `https://www.google.com/search?q=${q}&tbm=isch&hl=pt-BR&gl=BR`
    );
    const json = await httpGet(`https://api.allorigins.win/get?url=${target}`);
    const { contents = '' } = JSON.parse(json);
    const re = /https:\/\/encrypted-tbn0\.gstatic\.com\/images\?q=tbn:[A-Za-z0-9_:%-]+/g;
    return [...new Set(contents.match(re) || [])].slice(0, 10);
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Busca combinada: DDG (primário) + Google via proxy (fallback)
// ════════════════════════════════════════════════════════════════════════════
async function searchImages(query) {
  const [ddg, goog] = await Promise.allSettled([
    duckduckgoSearch(query),
    googleSearchProxy(query),
  ]);

  const ddgUrls  = ddg.status  === 'fulfilled' ? ddg.value  : [];
  const googUrls = goog.status === 'fulfilled' ? goog.value : [];

  // Prioriza DDG (melhor qualidade); usa Google como fallback
  if (ddgUrls.length >= 3) return ddgUrls.slice(0, 10);
  if (googUrls.length > 0) return googUrls.slice(0, 10);
  return ddgUrls;
}

// ════════════════════════════════════════════════════════════════════════════
//  Calcula status automaticamente a partir dos estoques
//  0 = Igual, 1 = Divergente, 2 = Só Fiscal
// ════════════════════════════════════════════════════════════════════════════
function calcStatus(stockFiscal, stockMgmt) {
  if (stockFiscal != null && stockMgmt == null) return 2; // só fiscal
  if (stockFiscal == null && stockMgmt == null) return 0;
  return (stockFiscal == stockMgmt) ? 0 : 1;
}

// ── GET /api/products ──────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { q = '', status = 'T', page = 1, limit = 60, sort = 'id', order = 'asc' } = req.query;
  const off = (parseInt(page) - 1) * parseInt(limit);

  // Mapeamento seguro de colunas para evitar SQL injection
  const SORT_MAP = {
    id:              'p.id',
    name:            'p.name',
    price_fiscal:    'p.price_fiscal',
    price_mgmt:      'p.price_mgmt',
    stock_fiscal:    'p.stock_fiscal',
    stock_mgmt:      'p.stock_mgmt',
    snap_stock_mgmt: 'p.snap_stock_mgmt',
    stock_real:      'p.stock_real',
    // % de diferença entre estoques: |fis - ger| / max(|fis|, |ger|, 1) * 100
    diff_pct:     `(CASE WHEN MAX(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.snap_stock_mgmt,0))) = 0
                    THEN 0
                    ELSE ABS(COALESCE(p.stock_fiscal,0) - COALESCE(p.snap_stock_mgmt,0)) * 100.0
                         / MAX(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.snap_stock_mgmt,0)))
                    END)`,
    // % diferença real vs fiscal
    real_pct:     `(CASE WHEN MAX(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.stock_real,0))) = 0
                    THEN 0
                    ELSE ABS(COALESCE(p.stock_fiscal,0) - COALESCE(p.stock_real,0)) * 100.0
                         / MAX(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.stock_real,0)))
                    END)`,
  };
  const sortCol = SORT_MAP[sort] || 'p.id';
  const sortDir = order === 'desc' ? 'DESC' : 'ASC';

  let where = '1=1';
  const params = [];

  if (q.trim()) {
    where += ' AND (LOWER(p.name) LIKE ? OR LOWER(p.id) LIKE ?)';
    const qLike = '%' + q.trim().toLowerCase() + '%';
    params.push(qLike, qLike);
  }
  if (status !== 'T') {
    where += ' AND p.status = ?';
    params.push(parseInt(status));
  }
  // Filtro especial: apenas produtos com alerta fiscal ativo
  const { fiscal_alert, disabled } = req.query;
  if (fiscal_alert === '1') { where += ' AND p.fiscal_alert = 1'; }
  // Filtro de desativados: '0'=ativos, '1'=desativados, omitido=todos
  if (disabled === '0') { where += ' AND COALESCE(p.is_disabled, 0) = 0'; }
  else if (disabled === '1') { where += ' AND COALESCE(p.is_disabled, 0) = 1'; }

  const total = db.prepare(`SELECT COUNT(*) as n FROM products p WHERE ${where}`).get(...params).n;
  const rows  = db.prepare(
    `SELECT p.id, p.name, p.price_fiscal, p.price_mgmt,
            p.stock_fiscal, p.stock_mgmt, p.snap_stock_mgmt, p.stock_real,
            p.fiscal_alert, p.status, COALESCE(p.is_disabled, 0) as is_disabled,
            pi.url as pinned_img,
            (CASE WHEN MAX(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.snap_stock_mgmt,0))) = 0
                  THEN 0
                  ELSE ABS(COALESCE(p.stock_fiscal,0) - COALESCE(p.snap_stock_mgmt,0)) * 100.0
                       / MAX(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.snap_stock_mgmt,0)))
             END) AS diff_pct,
            (CASE WHEN p.stock_real IS NULL THEN NULL
                  WHEN MAX(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.stock_real,0))) = 0 THEN 0
                  ELSE ABS(COALESCE(p.stock_fiscal,0) - COALESCE(p.stock_real,0)) * 100.0
                       / MAX(ABS(COALESCE(p.stock_fiscal,0)), ABS(COALESCE(p.stock_real,0)))
             END) AS real_pct
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_pinned = 1
     WHERE ${where}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit), off);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), products: rows });
});

// ── GET /api/products/stats ────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status=0 THEN 1 ELSE 0 END) as iguais,
      SUM(CASE WHEN status=1 THEN 1 ELSE 0 END) as divergentes,
      SUM(CASE WHEN status=2 THEN 1 ELSE 0 END) as so_fiscal
    FROM products
  `).get();
  res.json(stats);
});

// ── GET /api/products/action-stats ────────────────────────────────────────
router.get('/action-stats', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { alteracoes } = db.prepare(
      `SELECT COUNT(DISTINCT product_id) as alteracoes FROM product_audit
       WHERE date(changed_at) = date('now')`
    ).get();
    const { desativar } = db.prepare(
      `SELECT COUNT(*) as desativar FROM products WHERE fiscal_alert = 1`
    ).get();
    res.json({ alteracoes, desativar, atualizar: alteracoes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/report ───────────────────────────────────────────────
// ATENÇÃO: deve ficar ANTES de /:id para não ser capturado como ID
router.get('/report', authenticate, (req, res) => {
  const db = getDb();
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

  // Filtro por intervalo de datas (formato YYYY-MM-DD vindo do input date)
  let where = '1=1';
  const params = [];
  if (date_from) { where += ' AND date(a.changed_at) >= ?'; params.push(date_from); }
  if (date_to)   { where += ' AND date(a.changed_at) <= ?'; params.push(date_to); }

  const rows = db.prepare(`
    SELECT
      a.product_id  AS id,
      a.name,
      a.stock_fiscal,
      a.stock_mgmt,
      a.stock_real,
      strftime('%d/%m/%Y', a.changed_at) AS data,
      strftime('%H:%M:%S', a.changed_at) AS hora,
      a.changed_at
    FROM product_audit a
    WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}
  `).all(...params);

  res.json({ total: rows.length, rows });
});

// ── GET /api/products/deactivate-report ───────────────────────────────────
// ATENÇÃO: deve ficar ANTES de /:id para não ser capturado como ID
//
// Categorias:
//   ⚠️  Desativar → fiscal_alert = 1  (Real = 0, desativar no sistema fiscal)
//   🔄  Atualizar → existem em product_audit (foram modificados)
//
// Estratégia: duas queries simples + merge em JS (evita JOIN/COALESCE complexo)
router.get('/deactivate-report', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { sort = 'changed_at', order = 'desc', flag = '', date_from = '', date_to = '' } = req.query;

    // ── Query 1: produtos a desativar (fiscal_alert = 1) ──────────────────
    const desativarRows = db.prepare(`
      SELECT
        p.id,
        SUBSTR(p.name, 1, 20) AS name_abbr,
        p.name                AS name_full,
        p.stock_fiscal,
        p.stock_mgmt,
        p.stock_real,
        p.fiscal_alert,
        p.updated_at          AS ref_date
      FROM products p
      WHERE p.fiscal_alert = 1
    `).all();

    // ── Query 2: produtos modificados (em product_audit) ──────────────────
    const atualizarRows = db.prepare(`
      SELECT
        p.id,
        SUBSTR(p.name, 1, 20) AS name_abbr,
        p.name                AS name_full,
        p.stock_fiscal,
        p.stock_mgmt,
        p.stock_real,
        p.fiscal_alert,
        a.changed_at          AS ref_date
      FROM products p
      INNER JOIN product_audit a ON a.product_id = p.id
    `).all();

    // ── Merge: um Map por id para deduplicar ──────────────────────────────
    const map = new Map();

    for (const r of desativarRows) {
      map.set(r.id, { ...r, has_fiscal_alert: 1, has_audit: 0 });
    }
    for (const r of atualizarRows) {
      if (map.has(r.id)) {
        // Produto nos dois: marca ambas as flags e usa a data do audit (mais recente)
        const ex = map.get(r.id);
        map.set(r.id, { ...ex, has_audit: 1, ref_date: r.ref_date });
      } else {
        map.set(r.id, { ...r, has_fiscal_alert: 0, has_audit: 1 });
      }
    }

    // ── Formata data/hora a partir de ref_date ────────────────────────────
    let rows = Array.from(map.values()).map(r => {
      const dt = r.ref_date || '';
      const data = dt ? dt.substring(8, 10) + '/' + dt.substring(5, 7) + '/' + dt.substring(0, 4) : '—';
      const hora = dt.length >= 19 ? dt.substring(11, 19) : '—';
      return { ...r, data, hora };
    });

    // ── Filtro por categoria ───────────────────────────────────────────────
    if (flag === 'desativar')    rows = rows.filter(r => r.has_fiscal_alert === 1);
    else if (flag === 'atualizar') rows = rows.filter(r => r.has_audit === 1);
    // flag = '' → mostra todos

    // ── Filtro por data ────────────────────────────────────────────────────
    if (date_from || date_to) {
      rows = rows.filter(r => {
        const d = (r.ref_date || '').substring(0, 10); // YYYY-MM-DD
        if (!d) return false;
        if (date_from && d < date_from) return false;
        if (date_to   && d > date_to)   return false;
        return true;
      });
    }

    // ── Ordenação ─────────────────────────────────────────────────────────
    const SORT_KEY = {
      id: 'id', name: 'name_full',
      stock_fiscal: 'stock_fiscal', stock_mgmt: 'stock_mgmt', stock_real: 'stock_real',
      changed_at: 'ref_date', fiscal_alert: 'fiscal_alert',
    };
    const key = SORT_KEY[sort] || 'ref_date';
    rows.sort((a, b) => {
      const av = a[key] ?? '', bv = b[key] ?? '';
      if (av < bv) return order === 'asc' ? -1 : 1;
      if (av > bv) return order === 'asc' ? 1 : -1;
      return 0;
    });

    res.json({ total: rows.length, rows });
  } catch (err) {
    console.error('[deactivate-report] ERRO:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/products/:id/resolve-alert ─────────────────────────────────
// Marca o alerta fiscal como resolvido (produto desativado no fiscal)
// ATENÇÃO: deve ficar ANTES de /:id
router.patch('/:id/resolve-alert', requireAdmin, (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  // Limpa o alerta fiscal no produto
  db.prepare(
    `UPDATE products SET fiscal_alert = 0, updated_at = datetime('now') WHERE id = ?`
  ).run(req.params.id);

  // Atualiza a auditoria para refletir a resolução
  db.prepare(
    `UPDATE product_audit SET fiscal_alert = 0, changed_at = datetime('now') WHERE product_id = ?`
  ).run(req.params.id);

  res.json({ message: 'Alerta resolvido' });
});

// ── GET /api/products/:id ──────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  const images = db.prepare(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_pinned DESC, id ASC'
  ).all(req.params.id);

  res.json({ ...product, images });
});

// ── GET /api/products/:id/search-images ───────────────────────────────────
router.get('/:id/search-images', async (req, res) => {
  const db = getDb();

  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  // Fotos manuais têm prioridade — se existirem, não busca no Google
  const manualCount = db.prepare(
    'SELECT COUNT(*) as n FROM product_images WHERE product_id = ? AND is_manual = 1'
  ).get(req.params.id).n;

  if (manualCount > 0) {
    const images = db.prepare(
      'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_pinned DESC, id ASC'
    ).all(req.params.id);
    return res.json({ source: 'manual', images });
  }

  // Se já tem imagens auto-buscadas → retorna cache
  const cached = db.prepare(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_pinned DESC, id ASC'
  ).all(req.params.id);

  if (cached.length > 0) return res.json({ source: 'db', images: cached });

  // Busca Google + DuckDuckGo em paralelo
  const urls = await searchImages(product.name);

  if (!urls.length) return res.json({ source: 'not_found', images: [] });

  // Salva no banco — primeira como pinned
  const insertImg = db.prepare(
    'INSERT OR IGNORE INTO product_images (product_id, url, is_pinned, is_manual) VALUES (?, ?, ?, 0)'
  );
  const saved = db.transaction((list) =>
    list.map((url, i) => {
      const r = insertImg.run(product.id, url, i === 0 ? 1 : 0);
      return { id: r.lastInsertRowid, product_id: product.id, url, is_pinned: i === 0 ? 1 : 0, is_manual: 0 };
    })
  )(urls);

  res.json({ source: 'google+ddg', images: saved });
});

// ── POST /api/products ─────────────────────────────────────────────────────
router.post('/', requireAdmin, (req, res) => {
  const db = getDb();
  const { id, name, price_fiscal, price_mgmt, stock_fiscal, stock_mgmt, stock_real } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id e name são obrigatórios' });

  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (existing) return res.status(409).json({ error: 'Produto com este ID já existe' });

  const autoStatus = calcStatus(stock_fiscal ?? null, stock_mgmt ?? null);

  db.prepare(`
    INSERT INTO products (id, name, price_fiscal, price_mgmt, stock_fiscal, stock_mgmt, stock_real, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, price_fiscal ?? null, price_mgmt ?? null,
         stock_fiscal ?? null, stock_mgmt ?? null, stock_real ?? null, autoStatus);

  res.status(201).json({ message: 'Produto criado', id });
});

// ════════════════════════════════════════════════════════════════════════════
//  REGRA DE NEGÓCIO — Atualização de estoque
//
//  PSEUDOCÓDIGO:
//  ─────────────────────────────────────────────────────────────────────────
//  função aplicarRegraEstoque(real, gerencialAtual, alertaFiscalAtual):
//
//    SE real < 0:
//      RETORNAR erro("O campo Real não pode ser negativo")
//
//    SE real == 0:
//      novoGerencial  ← 0
//      novoAlerta     ← 1   // ⚠️ produto deve ser desativado no fiscal
//
//    SE real > 0:
//      novoGerencial  ← real
//      novoAlerta     ← 0   // ✅ sem alerta
//
//    RETORNAR (novoGerencial, novoAlerta)
//
//  OBSERVAÇÕES:
//    • O campo Estoque Fiscal é SOMENTE LEITURA — nunca é alterado aqui
//    • O flag fiscal_alert é independente do campo status
//    • Valores negativos são rejeitados com erro HTTP 400
// ════════════════════════════════════════════════════════════════════════════

/**
 * Aplica a regra de negócio de estoque Real → Gerencial + flag fiscal.
 *
 * @param {number|null} real  - Valor digitado no campo Real
 * @param {number}      mgmt  - Valor atual do Estoque Gerencial
 * @param {number}      alert - Flag fiscal_alert atual (0|1)
 * @returns {{ stockMgmt: number, fiscalAlert: number, error: string|null }}
 */
function applyStockRule(real, mgmt, alert) {
  // Sem Real informado → sem alteração
  if (real === null) return { stockMgmt: mgmt, fiscalAlert: alert, error: null };

  // Validação: impede valores negativos
  if (real < 0) {
    return { stockMgmt: mgmt, fiscalAlert: alert, error: 'O campo Real não pode ser negativo.' };
  }

  if (real === 0) {
    // Real = 0 → Gerencial = 0 e sinaliza que o produto deve ser desativado no fiscal
    return { stockMgmt: 0, fiscalAlert: 1, error: null };
  } else {
    // Real > 0 → Gerencial recebe o valor Real e remove o alerta
    return { stockMgmt: real, fiscalAlert: 0, error: null };
  }
}

// ── PUT /api/products/:id ──────────────────────────────────────────────────
router.put('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, price_mgmt, stock_mgmt, stock_real, status } = req.body;
  // NOTA: stock_fiscal e price_fiscal são somente leitura — ignorados no body

  // Lê valores atuais ANTES de alterar para detectar mudanças
  const before = db.prepare(
    'SELECT name, price_fiscal, price_mgmt, stock_fiscal, stock_mgmt, snap_stock_mgmt, stock_real, status, fiscal_alert FROM products WHERE id = ?'
  ).get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Produto não encontrado' });

  const realVal = (stock_real != null && stock_real !== '') ? parseFloat(stock_real) : null;

  // ── Aplica regra de negócio ──────────────────────────────────────────────
  const rule = applyStockRule(
    realVal,
    stock_mgmt ?? before.stock_mgmt,
    before.fiscal_alert
  );
  if (rule.error) return res.status(400).json({ error: rule.error });

  // Resolve os valores finais
  // stock_fiscal NUNCA é alterado (campo somente leitura)
  const newName        = name     ?? before.name;
  const newPriceMgmt   = price_mgmt ?? before.price_mgmt;
  const newStockFiscal = before.stock_fiscal;   // imutável
  const newStockMgmt   = rule.stockMgmt;
  const newStockReal   = realVal;
  const newFiscalAlert = rule.fiscalAlert;
  // Status compara fiscal (PDF) vs gerencial (PDF snapshot) — independente do stock_real
  const newStatus      = calcStatus(newStockFiscal, before.snap_stock_mgmt);

  db.prepare(`
    UPDATE products SET
      name = ?, price_mgmt = ?,
      stock_fiscal = ?, stock_mgmt = ?, stock_real = ?,
      fiscal_alert = ?,
      status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newName, newPriceMgmt,
         newStockFiscal, newStockMgmt, newStockReal,
         newFiscalAlert, newStatus, req.params.id);

  // ── Detecta mudança real e registra auditoria ────────────────────────────
  const changed =
    newName        !== before.name        ||
    newPriceMgmt   != before.price_mgmt   ||
    newStockMgmt   != before.stock_mgmt   ||
    newStockReal   != before.stock_real   ||
    newFiscalAlert !== before.fiscal_alert ||
    newStatus      !== before.status;

  if (changed) {
    db.prepare(`
      INSERT INTO product_audit (product_id, name, stock_fiscal, stock_mgmt, stock_real, fiscal_alert, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET
        name         = excluded.name,
        stock_fiscal = excluded.stock_fiscal,
        stock_mgmt   = excluded.stock_mgmt,
        stock_real   = excluded.stock_real,
        fiscal_alert = excluded.fiscal_alert,
        changed_at   = excluded.changed_at
    `).run(req.params.id, newName, newStockFiscal, newStockMgmt, newStockReal, newFiscalAlert);
  }

  res.json({ message: 'Produto atualizado', changed });
});

// ── DELETE /api/products/:id ───────────────────────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json({ message: 'Produto removido' });
});

// ── POST /api/products/:id/images/upload  (multipart file) ────────────────
router.post('/:id/images/upload', authenticate, imgUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const db = getDb();
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Produto não encontrado.' });
  }
  const url = `/uploads/product-images/${req.file.filename}`;
  db.prepare('DELETE FROM product_images WHERE product_id = ? AND is_manual = 0').run(req.params.id);
  db.prepare('UPDATE product_images SET is_pinned = 0 WHERE product_id = ?').run(req.params.id);
  const result = db.prepare(
    'INSERT INTO product_images (product_id, url, is_pinned, is_manual) VALUES (?, ?, 1, 1)'
  ).run(req.params.id, url);
  res.status(201).json({ id: result.lastInsertRowid, url, message: 'Imagem salva' });
});

// ── POST /api/products/:id/images ─────────────────────────────────────────
router.post('/:id/images', authenticate, (req, res) => {
  const db = getDb();
  const { url, is_pinned = 0, is_manual = 0 } = req.body;
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' });

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  // Foto manual: remove imagens auto-buscadas anteriores para este produto
  if (is_manual) {
    db.prepare('DELETE FROM product_images WHERE product_id = ? AND is_manual = 0').run(req.params.id);
  }

  if (is_pinned)
    db.prepare('UPDATE product_images SET is_pinned=0 WHERE product_id=?').run(req.params.id);

  const result = db.prepare(
    'INSERT INTO product_images (product_id, url, is_pinned, is_manual) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, url, is_pinned ? 1 : 0, is_manual ? 1 : 0);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Imagem salva' });
});

// ── PUT /api/products/:id/images/:imgId/pin ────────────────────────────────
router.put('/:id/images/:imgId/pin', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE product_images SET is_pinned=0 WHERE product_id=?').run(req.params.id);
  const info = db.prepare(
    'UPDATE product_images SET is_pinned=1 WHERE id=? AND product_id=?'
  ).run(req.params.imgId, req.params.id);

  if (info.changes === 0) return res.status(404).json({ error: 'Imagem não encontrada' });
  res.json({ message: 'Imagem fixada' });
});

// ── DELETE /api/products/:id/images/:imgId ────────────────────────────────
router.delete('/:id/images/:imgId', authenticate, (req, res) => {
  const db = getDb();
  const info = db.prepare(
    'DELETE FROM product_images WHERE id=? AND product_id=?'
  ).run(req.params.imgId, req.params.id);

  if (info.changes === 0) return res.status(404).json({ error: 'Imagem não encontrada' });
  res.json({ message: 'Imagem removida' });
});

// ── DELETE /api/products/:id/images ───────────────────────────────────────
router.delete('/:id/images', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM product_images WHERE product_id=?').run(req.params.id);
  res.json({ message: 'Imagens removidas — próxima abertura buscará novamente' });
});

module.exports = router;
