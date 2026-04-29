const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/schema');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Apenas arquivos PDF são aceitos.'));
  },
});

// Wrapper para multer v2 (API interna async — erros precisam ser capturados explicitamente)
function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('pdf')(req, res, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// POST /api/documents/upload/:type
router.post('/upload/:type', requireAdmin, async (req, res) => {
  // 1. Recebe o arquivo
  try { await runUpload(req, res); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const { type } = req.params;
  if (!['fiscal', 'gerencial'].includes(type))
    return res.status(400).json({ error: 'Tipo inválido. Use "fiscal" ou "gerencial".' });
  if (!req.file)
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const pool = getDb();

  // 2. Registra o documento
  let documentId;
  try {
    const { rows } = await pool.query(
      `INSERT INTO uploaded_documents (filename, type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.file.filename, type, req.file.size, req.user.username]
    );
    documentId = rows[0].id;
  } catch (err) {
    console.error('[upload] Erro ao registrar documento:', err.message);
    return res.status(500).json({ error: 'Erro ao registrar documento: ' + err.message });
  }

  // 3. Lê e parseia o PDF
  let rawText;
  try {
    const parsed = await pdfParse(fs.readFileSync(req.file.path));
    rawText = parsed.text;
  } catch (err) {
    return res.status(422).json({ error: 'Não foi possível ler o PDF: ' + err.message });
  }
  try { fs.unlinkSync(req.file.path); } catch (_) {}

  // 4. Carrega produtos e extrai dados do PDF
  let productMap, extracted;
  try {
    const { rows } = await pool.query('SELECT id, name FROM products');
    productMap = new Map(rows.map(p => [p.id, p]));
    extracted  = parsePdf(rawText, productMap, type);
  } catch (err) {
    console.error('[upload] Erro ao carregar produtos:', err.message);
    return res.status(500).json({ error: 'Erro ao carregar produtos: ' + err.message });
  }

  // 5. Salva no banco — bulk upsert único (evita timeout por N queries)
  let updated = 0, created = 0;
  if (extracted.length > 0) {
    const ids      = extracted.map(i => i.productId);
    const names    = extracted.map(i => i.name);
    const pfs      = extracted.map(i => type === 'fiscal'    ? i.suggested.price_fiscal    : null);
    const sfs      = extracted.map(i => type === 'fiscal'    ? i.suggested.stock_fiscal    : null);
    const spms     = extracted.map(i => type === 'gerencial' ? i.suggested.snap_price_mgmt : null);
    const ssms     = extracted.map(i => type === 'gerencial' ? i.suggested.snap_stock_mgmt : null);
    const disabled = extracted.map(i => i.is_disabled);

    try {
      await pool.query(`
        WITH data AS (
          SELECT
            UNNEST($1::text[])             AS id,
            UNNEST($2::text[])             AS name,
            UNNEST($3::double precision[]) AS price_fiscal,
            UNNEST($4::double precision[]) AS stock_fiscal,
            UNNEST($5::double precision[]) AS snap_price_mgmt,
            UNNEST($6::double precision[]) AS snap_stock_mgmt,
            UNNEST($7::int[])              AS is_disabled
        )
        INSERT INTO products (id, name, price_fiscal, stock_fiscal, snap_fiscal_at,
          snap_price_mgmt, snap_stock_mgmt, snap_mgmt_at, is_disabled, status)
        SELECT
          id, name, price_fiscal, stock_fiscal,
          CASE WHEN price_fiscal IS NOT NULL OR stock_fiscal IS NOT NULL THEN NOW() ELSE NULL END,
          snap_price_mgmt, snap_stock_mgmt,
          CASE WHEN snap_price_mgmt IS NOT NULL OR snap_stock_mgmt IS NOT NULL THEN NOW() ELSE NULL END,
          is_disabled, 2
        FROM data
        ON CONFLICT(id) DO UPDATE SET
          price_fiscal    = COALESCE(EXCLUDED.price_fiscal,    products.price_fiscal),
          stock_fiscal    = COALESCE(EXCLUDED.stock_fiscal,    products.stock_fiscal),
          snap_fiscal_at  = CASE WHEN EXCLUDED.price_fiscal    IS NOT NULL OR EXCLUDED.stock_fiscal    IS NOT NULL
                                 THEN NOW() ELSE products.snap_fiscal_at END,
          snap_price_mgmt = COALESCE(EXCLUDED.snap_price_mgmt, products.snap_price_mgmt),
          snap_stock_mgmt = COALESCE(EXCLUDED.snap_stock_mgmt, products.snap_stock_mgmt),
          snap_mgmt_at    = CASE WHEN EXCLUDED.snap_price_mgmt IS NOT NULL OR EXCLUDED.snap_stock_mgmt IS NOT NULL
                                 THEN NOW() ELSE products.snap_mgmt_at END,
          is_disabled     = EXCLUDED.is_disabled,
          name            = CASE WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != ''
                                 THEN EXCLUDED.name ELSE products.name END,
          updated_at      = NOW()
      `, [ids, names, pfs, sfs, spms, ssms, disabled]);

      updated = extracted.filter(i =>  productMap.has(i.productId)).length;
      created = extracted.filter(i => !productMap.has(i.productId)).length;
    } catch (err) {
      console.error('[upload] Erro no bulk upsert:', err.message);
      return res.status(500).json({ error: 'Erro ao salvar produtos: ' + err.message });
    }
  }

  // 6. Recalcula status e grava histórico
  try {
    await pool.query(`
      UPDATE products SET status = CASE
        WHEN stock_fiscal IS NOT NULL AND snap_stock_mgmt IS NULL THEN 2
        WHEN stock_fiscal IS NULL     AND snap_stock_mgmt IS NULL THEN 0
        WHEN stock_fiscal = snap_stock_mgmt THEN 0
        ELSE 1
      END
    `);
    await pool.query(
      `INSERT INTO import_history (document_id, type, total_products, updated_products, skipped, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [documentId, type, extracted.length, updated, 0, 'success']
    );
  } catch (err) {
    console.error('[upload] Erro ao atualizar status/histórico:', err.message);
  }

  res.json({ documentId, type, total: extracted.length, updated, status: 'success' });
});

// GET /api/documents/history
router.get('/history', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const { rows } = await pool.query(`
      SELECT ih.*, ud.filename, ud.uploaded_by, ud.uploaded_at
      FROM import_history ih
      LEFT JOIN uploaded_documents ud ON ud.id = ih.document_id
      ORDER BY ih.imported_at DESC
      LIMIT 100
    `);
    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/rawtext/:id
router.get('/rawtext/:id', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const { rows } = await pool.query('SELECT * FROM uploaded_documents WHERE id = $1', [req.params.id]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

    const filePath = path.join(UPLOAD_DIR, doc.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado (deletado após importação).' });

    let parsed;
    try {
      parsed = await pdfParse(fs.readFileSync(filePath));
    } catch (err) {
      return res.status(422).json({ error: 'Erro ao ler PDF: ' + err.message });
    }

    const maxLines = Math.min(parseInt(req.query.lines) || 200, 2000);
    const allLines = parsed.text.split('\n');
    const lines = allLines.slice(0, maxLines).map((l, i) => ({
      n: i + 1, raw: l, trimmed: l.trim(), hasNumbers: /\d/.test(l),
    }));

    res.json({
      document: { id: doc.id, filename: doc.filename, type: doc.type },
      totalLines: allLines.length, showing: lines.length, lines,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/
router.get('/', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const { rows } = await pool.query('SELECT * FROM uploaded_documents ORDER BY uploaded_at DESC LIMIT 50');
    res.json({ documents: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PDF parser (unchanged — pure JS logic, no DB calls)
// ---------------------------------------------------------------------------
function parsePdf(text, productMap, type) {
  const parseNum = s => {
    if (!s) return NaN;
    return parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  };

  const allLines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const headerIdx = new Set();
  allLines.forEach((l, i) => {
    if (/^Página \d+ de \d+$/i.test(l) || /^Page \d+ of \d+$/i.test(l) || /^Pág\.\s*\d+/i.test(l)) {
      for (let j = Math.max(0, i - 3); j <= Math.min(allLines.length - 1, i + 9); j++) {
        headerIdx.add(j);
      }
    }
  });
  if (/^(PREÇO|PRECO)\s*\+\s*ESTOQUE/i.test(allLines[0])) headerIdx.add(0);

  const dataLines = allLines.filter((_, i) => !headerIdx.has(i));
  const results = [];
  const seen = new Set();
  const isCode = line => productMap.has(line) || /^\d+$/.test(line);

  for (let i = 0; i < dataLines.length; i++) {
    const code = dataLines[i];
    if (!isCode(code) || seen.has(code)) continue;

    let pdfName = null, stock = NaN, price = NaN, is_disabled = 0;

    for (let j = i + 1; j <= Math.min(i + 8, dataLines.length - 1); j++) {
      const line = dataLines[j];
      if (isCode(line) && j > i + 2) break;
      if (pdfName === null) {
        pdfName = line;
        if (/^D50\s/i.test(line)) is_disabled = 1;
        continue;
      }
      const num = parseNum(line);
      if (!isNaN(num)) {
        if (isNaN(stock)) { stock = num; }
        else if (isNaN(price)) { price = num; break; }
      }
    }

    if (!isNaN(stock) && !isNaN(price)) {
      const existing = productMap.get(code);
      seen.add(code);
      results.push({
        productId: code,
        name: existing ? existing.name : pdfName,
        pdfName,
        is_disabled,
        current: existing && type === 'fiscal'
          ? { price_fiscal: existing.price_fiscal, stock_fiscal: existing.stock_fiscal }
          : existing
          ? { snap_price_mgmt: existing.snap_price_mgmt, snap_stock_mgmt: existing.snap_stock_mgmt }
          : {},
        suggested: type === 'fiscal'
          ? { price_fiscal: price, stock_fiscal: stock }
          : { snap_price_mgmt: price, snap_stock_mgmt: stock },
      });
    }
  }

  return results;
}

module.exports = router;
