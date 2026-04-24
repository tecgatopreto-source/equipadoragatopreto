const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/schema');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Diretório de uploads: /data/uploads em produção, ./uploads em dev local
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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Apenas arquivos PDF são aceitos.'));
  },
});

// POST /api/documents/upload/:type  — lê o PDF e importa direto, sem revisão manual
router.post('/upload/:type', requireAdmin, upload.single('pdf'), async (req, res) => {
  const { type } = req.params;
  if (!['fiscal', 'gerencial'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido. Use "fiscal" ou "gerencial".' });
  }
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const db = getDb();

  const docResult = db.prepare(`
    INSERT INTO uploaded_documents (filename, type, size_bytes, uploaded_by)
    VALUES (?, ?, ?, ?)
  `).run(req.file.filename, type, req.file.size, req.user.username);
  const documentId = docResult.lastInsertRowid;

  // Extrair texto
  let rawText;
  try {
    const parsed = await pdfParse(fs.readFileSync(req.file.path));
    rawText = parsed.text;
  } catch (err) {
    return res.status(422).json({ error: 'Não foi possível ler o PDF: ' + err.message });
  }

  // Apaga o arquivo PDF do disco após extração (evita acúmulo de arquivos)
  try { fs.unlinkSync(req.file.path); } catch (e) { /* ignora erro de limpeza */ }

  // Carrega produtos existentes para lookup (usado para nome e deduplicação)
  const allProducts = db.prepare('SELECT id, name FROM products').all();
  const productMap  = new Map(allProducts.map(p => [p.id, p]));
  const extracted   = parsePdf(rawText, productMap, type);

  // Upsert: atualiza se existe, cria se não existe
  const upsertStmt = db.prepare(`
    INSERT INTO products (id, name,
      price_fiscal, stock_fiscal, snap_fiscal_at,
      snap_price_mgmt, snap_stock_mgmt, snap_mgmt_at,
      is_disabled, status)
    VALUES (
      :id, :name,
      :price_fiscal, :stock_fiscal,
      CASE WHEN :price_fiscal IS NOT NULL OR :stock_fiscal IS NOT NULL THEN datetime('now') ELSE NULL END,
      :snap_price_mgmt, :snap_stock_mgmt,
      CASE WHEN :snap_price_mgmt IS NOT NULL OR :snap_stock_mgmt IS NOT NULL THEN datetime('now') ELSE NULL END,
      :is_disabled, 2
    )
    ON CONFLICT(id) DO UPDATE SET
      price_fiscal    = COALESCE(:price_fiscal,    price_fiscal),
      stock_fiscal    = COALESCE(:stock_fiscal,    stock_fiscal),
      snap_fiscal_at  = CASE WHEN :price_fiscal IS NOT NULL OR :stock_fiscal IS NOT NULL
                             THEN datetime('now') ELSE snap_fiscal_at END,
      snap_price_mgmt = COALESCE(:snap_price_mgmt, snap_price_mgmt),
      snap_stock_mgmt = COALESCE(:snap_stock_mgmt, snap_stock_mgmt),
      snap_mgmt_at    = CASE WHEN :snap_price_mgmt IS NOT NULL OR :snap_stock_mgmt IS NOT NULL
                             THEN datetime('now') ELSE snap_mgmt_at END,
      is_disabled     = :is_disabled,
      name            = CASE WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE name END,
      updated_at      = datetime('now')
  `);

  let updated = 0, created = 0;
  const doImport = db.transaction(() => {
    for (const item of extracted) {
      const params = {
        id:              item.productId,
        name:            item.name,
        price_fiscal:    type === 'fiscal'    ? item.suggested.price_fiscal    : null,
        stock_fiscal:    type === 'fiscal'    ? item.suggested.stock_fiscal    : null,
        snap_price_mgmt: type === 'gerencial' ? item.suggested.snap_price_mgmt : null,
        snap_stock_mgmt: type === 'gerencial' ? item.suggested.snap_stock_mgmt : null,
        is_disabled:     item.is_disabled,
      };
      const info = upsertStmt.run(params);
      if (info.changes > 0) {
        if (productMap.has(item.productId)) updated++;
        else created++;
      }
    }
  });

  try {
    doImport();
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao salvar: ' + err.message });
  }

  // Recalcula status de todos os produtos após import
  db.prepare(`
    UPDATE products
    SET status = CASE
      WHEN stock_fiscal IS NOT NULL AND snap_stock_mgmt IS NULL THEN 2
      WHEN stock_fiscal IS NULL     AND snap_stock_mgmt IS NULL THEN 0
      WHEN stock_fiscal = snap_stock_mgmt THEN 0
      ELSE 1
    END
  `).run();

  const status = 'success';
  db.prepare(`
    INSERT INTO import_history (document_id, type, total_products, updated_products, skipped, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(documentId, type, extracted.length, updated, 0, status);

  res.json({ documentId, type, total: extracted.length, updated, status });
});

// GET /api/documents/history  — histórico de importações
router.get('/history', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ih.*, ud.filename, ud.uploaded_by, ud.uploaded_at
    FROM import_history ih
    LEFT JOIN uploaded_documents ud ON ud.id = ih.document_id
    ORDER BY ih.imported_at DESC
    LIMIT 100
  `).all();
  res.json({ history: rows });
});

// GET /api/documents/rawtext/:id?lines=N  — diagnóstico: texto bruto extraído do PDF
// NOTA: O arquivo é deletado após import. Este endpoint retorna 404 para imports recentes.
router.get('/rawtext/:id', requireAdmin, async (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM uploaded_documents WHERE id = ?').get(req.params.id);
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
    n: i + 1,
    raw: l,
    trimmed: l.trim(),
    hasNumbers: /\d/.test(l),
  }));

  res.json({
    document: { id: doc.id, filename: doc.filename, type: doc.type },
    totalLines: allLines.length,
    showing: lines.length,
    lines,
  });
});

// GET /api/documents/  — lista documentos enviados
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM uploaded_documents ORDER BY uploaded_at DESC LIMIT 50').all();
  res.json({ documents: rows });
});

// ---------------------------------------------------------------------------
// Parser para relatório SV "Preço + Estoque"
//
// Estratégia: varre todas as linhas buscando por códigos de produtos conhecidos.
// Quando encontra um código, lê as linhas seguintes para extrair estoque e preço.
// Formato esperado por produto (6 linhas):
//   CÓDIGO / NOME / UNIDADE / ESTOQUE / PREÇO / TOTAL
//
// Fallback: se o código é encontrado numa linha, as próximas 4 linhas sem ser
// TOTAL devem conter NOME, UNIDADE, ESTOQUE e PREÇO — em qualquer ordem
// identificada por parseNum().
// ---------------------------------------------------------------------------
function parsePdf(text, productMap, type) {
  const parseNum = s => {
    if (!s) return NaN;
    // Remove separadores de milhar (.) e converte vírgula para ponto decimal
    return parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  };

  const allLines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Detecta e exclui linhas de cabeçalho de página
  const headerIdx = new Set();
  allLines.forEach((l, i) => {
    if (/^Página \d+ de \d+$/i.test(l) || /^Page \d+ of \d+$/i.test(l) || /^Pág\.\s*\d+/i.test(l)) {
      for (let j = Math.max(0, i - 3); j <= Math.min(allLines.length - 1, i + 9); j++) {
        headerIdx.add(j);
      }
    }
  });
  // Primeira linha do relatório também é cabeçalho
  if (/^(PREÇO|PRECO)\s*\+\s*ESTOQUE/i.test(allLines[0])) headerIdx.add(0);

  const dataLines = allLines.filter((_, i) => !headerIdx.has(i));

  const results = [];
  const seen = new Set();

  const isCode = line => productMap.has(line) || /^\d+$/.test(line);

  for (let i = 0; i < dataLines.length; i++) {
    const code = dataLines[i];

    // Só processa se parece um código (numérico ou já conhecido) e não foi visto
    if (!isCode(code) || seen.has(code)) continue;

    // Lê as próximas linhas até achar estoque e preço válidos
    // Janela de busca: até 8 linhas após o código
    let pdfName = null;
    let stock = NaN;
    let price = NaN;
    let is_disabled = 0;

    for (let j = i + 1; j <= Math.min(i + 8, dataLines.length - 1); j++) {
      const line = dataLines[j];

      // Se bateu num outro código de produto, para
      if (isCode(line) && j > i + 2) break;

      // Primeira linha após o código é o nome
      if (pdfName === null) {
        pdfName = line;
        // Detecta prefixo D50 (produto desativado no sistema externo)
        if (/^D50\s/i.test(line)) is_disabled = 1;
        continue;
      }

      // Tentativas de parsear número (estoque ou preço)
      const num = parseNum(line);
      if (!isNaN(num)) {
        if (isNaN(stock)) {
          stock = num;
        } else if (isNaN(price)) {
          price = num;
          break; // tem os dois — chega
        }
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
