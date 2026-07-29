const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { getDb, DB_SCHEMA } = require('../db/schema');
const _s = `"${DB_SCHEMA}".`;
const { requireAdmin } = require('../middleware/auth');
const { classifyProduct } = require('../lib/categories');
const cache = require('../lib/cache');

const router = express.Router();

// PDFs de importação (fiscal/gerencial/grupos) são só um passo de trânsito: recebidos,
// parseados e descartados — nunca precisam tocar o disco. memoryStorage evita arquivos órfãos.
const upload = multer({
  storage: multer.memoryStorage(),
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

// Serializa operações que leem e regravam products/product_audit (upload de PDF, aplicar grupos).
// Sem isso, duas importações concorrentes podem intercalar suas queries e uma sobrescreve
// a linha de auditoria da outra com dados desatualizados (mesmo a tabela products ficando correta).
let importChain = Promise.resolve();
function serializeImport(handler) {
  return (req, res) => {
    const result = importChain.then(() => handler(req, res));
    importChain = result.catch(() => {});
    return result;
  };
}

// POST /api/documents/upload/grupos — preview de grupos (sem escrever no banco)
router.post('/upload/grupos', requireAdmin, async (req, res) => {
  try { await runUpload(req, res); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  let rawText;
  try {
    const parsed = await pdfParse(req.file.buffer);
    rawText = parsed.text;
  } catch (err) {
    return res.status(422).json({ error: 'Não foi possível ler o PDF: ' + err.message });
  }

  const pool = getDb();
  let productSet;
  try {
    const { rows } = await pool.query(`SELECT id FROM ${_s}products`);
    productSet = new Set(rows.map(r => r.id));
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar produtos: ' + err.message });
  }

  const groups        = parseGrupos(rawText, productSet);
  const nonSkip       = groups.filter(g => !g.skip);
  const totalFound    = groups.reduce((s, g) => s + g.found,    0);
  const totalNotFound = groups.reduce((s, g) => s + g.notFound, 0);
  res.json({
    totalGroups:   nonSkip.length,
    totalFound,
    totalNotFound,
    totalParsed:   totalFound + totalNotFound,
    groups,
    filename: req.file.originalname,
    size:     req.file.size,
  });
});

// POST /api/documents/upload/:type
router.post('/upload/:type', requireAdmin, serializeImport(async (req, res) => {
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
      `INSERT INTO ${_s}uploaded_documents (filename, type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.file.originalname, type, req.file.size, req.user.username]
    );
    documentId = rows[0].id;
  } catch (err) {
    console.error('[upload] Erro ao registrar documento:', err.message);
    return res.status(500).json({ error: 'Erro ao registrar documento: ' + err.message });
  }

  // 3. Lê e parseia o PDF
  let rawText;
  try {
    const parsed = await pdfParse(req.file.buffer);
    rawText = parsed.text;
  } catch (err) {
    return res.status(422).json({ error: 'Não foi possível ler o PDF: ' + err.message });
  }

  // 4. Carrega produtos e extrai dados do PDF
  let productMap, extracted;
  try {
    const { rows } = await pool.query(`SELECT id, name, snap_stock_mgmt, stock_fiscal FROM ${_s}products`);
    productMap = new Map(rows.map(p => [p.id, p]));
    extracted  = parsePdf(rawText, productMap, type);
  } catch (err) {
    console.error('[upload] Erro ao carregar produtos:', err.message);
    return res.status(500).json({ error: 'Erro ao carregar produtos: ' + err.message });
  }

  // 5. Salva no banco — bulk upsert único (evita timeout por N queries)
  let updated = 0, created = 0;
  if (extracted.length > 0) {
    const ids       = extracted.map(i => i.productId);
    const names     = extracted.map(i => i.name);
    const pfs       = extracted.map(i => type === 'fiscal'    ? i.suggested.price_fiscal    : null);
    const sfs       = extracted.map(i => type === 'fiscal'    ? i.suggested.stock_fiscal    : null);
    const spms      = extracted.map(i => type === 'gerencial' ? i.suggested.snap_price_mgmt : null);
    const ssms      = extracted.map(i => type === 'gerencial' ? i.suggested.snap_stock_mgmt : null);
    const disabled  = extracted.map(i => i.is_disabled);
    const cats      = extracted.map(() => null);

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
            UNNEST($7::int[])              AS is_disabled,
            UNNEST($8::text[])             AS categoria
        )
        INSERT INTO ${_s}products (id, name, price_fiscal, stock_fiscal, snap_fiscal_at,
          snap_price_mgmt, snap_stock_mgmt, snap_mgmt_at, is_disabled, status, categoria)
        SELECT
          id, name, price_fiscal, stock_fiscal,
          CASE WHEN price_fiscal IS NOT NULL OR stock_fiscal IS NOT NULL THEN NOW() ELSE NULL END,
          snap_price_mgmt, snap_stock_mgmt,
          CASE WHEN snap_price_mgmt IS NOT NULL OR snap_stock_mgmt IS NOT NULL THEN NOW() ELSE NULL END,
          is_disabled, 2, categoria
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
          name            = CASE WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != ''
                                 THEN EXCLUDED.name ELSE products.name END,
          categoria       = COALESCE(EXCLUDED.categoria, products.categoria),
          updated_at      = NOW()
      `, [ids, names, pfs, sfs, spms, ssms, disabled, cats]);

      created = extracted.filter(i => !productMap.has(i.productId)).length;
    } catch (err) {
      console.error('[upload] Erro no bulk upsert:', err.message);
      return res.status(500).json({ error: 'Erro ao salvar produtos: ' + err.message });
    }

    const qtyField = type === 'gerencial' ? 'snap_stock_mgmt' : 'stock_fiscal';
    const changedIds = extracted
      .filter(i => {
        const prev    = productMap.get(i.productId);
        const newVal  = i.suggested[qtyField];
        const prevNum = prev != null ? parseFloat(prev[qtyField]) : NaN;
        return isNaN(prevNum) || prevNum !== newVal;
      })
      .map(i => i.productId);

    // "Atualizados" = produtos que já existiam E cujo valor realmente mudou
    // (não basta constar no PDF — extracted quase sempre bate 1:1 com o catálogo inteiro)
    updated = changedIds.filter(id => productMap.has(id)).length;

    if (changedIds.length > 0) {
      try {
        const prevFiscal = changedIds.map(id => {
          const p = productMap.get(id);
          return p != null ? parseFloat(p.stock_fiscal) : null;
        });
        const prevMgmt = changedIds.map(id => {
          const p = productMap.get(id);
          return p != null ? parseFloat(p.snap_stock_mgmt) : null;
        });
        await pool.query(`
          INSERT INTO ${_s}product_audit
            (product_id, name, stock_fiscal, stock_mgmt, stock_real,
             fiscal_alert, categoria, prev_stock_fiscal, prev_stock_mgmt, changed_at)
          SELECT p.id, p.name, p.stock_fiscal, p.snap_stock_mgmt, NULL,
                 p.fiscal_alert, p.categoria, v.pf, v.pm, NOW()
          FROM ${_s}products p
          JOIN (SELECT unnest($1::text[]) AS id,
                       unnest($2::numeric[]) AS pf,
                       unnest($3::numeric[]) AS pm) v ON v.id = p.id
          ON CONFLICT (product_id) DO UPDATE SET
            name              = EXCLUDED.name,
            stock_fiscal      = EXCLUDED.stock_fiscal,
            stock_mgmt        = EXCLUDED.stock_mgmt,
            fiscal_alert      = EXCLUDED.fiscal_alert,
            categoria         = EXCLUDED.categoria,
            prev_stock_fiscal = EXCLUDED.prev_stock_fiscal,
            prev_stock_mgmt   = EXCLUDED.prev_stock_mgmt,
            prev_stock_real   = NULL,
            changed_at        = NOW()
        `, [changedIds, prevFiscal, prevMgmt]);
      } catch (err) {
        console.error('[upload] Erro ao registrar audit de import:', err.message);
      }
    }
  }

  // 6. Recalcula status, invalida cache e grava histórico
  try {
    await pool.query(`
      UPDATE ${_s}products SET status = CASE
        WHEN stock_fiscal IS NOT NULL AND snap_stock_mgmt IS NULL THEN 2
        WHEN stock_fiscal IS NULL     AND snap_stock_mgmt IS NULL THEN 0
        WHEN stock_fiscal = snap_stock_mgmt THEN 0
        ELSE 1
      END
    `);
    cache.clear('stats');
    cache.clear('action-stats');
    cache.clear('products:');
    try {
      await pool.query(`REFRESH MATERIALIZED VIEW ${_s}product_stats`);
    } catch (e) {
      console.error('[import] REFRESH MATERIALIZED VIEW falhou:', e.message);
    }
    await pool.query(
      `INSERT INTO ${_s}import_history (document_id, type, total_products, updated_products, skipped, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [documentId, type, extracted.length, updated, created, 'success']
    );
  } catch (err) {
    console.error('[upload] Erro ao atualizar status/histórico:', err.message);
  }

  res.json({ documentId, type, total: extracted.length, updated, created, status: 'success' });
}));

// GET /api/documents/history
router.get('/history', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const { rows } = await pool.query(`
      SELECT ih.*, ud.filename, ud.uploaded_by, ud.uploaded_at
      FROM ${_s}import_history ih
      LEFT JOIN ${_s}uploaded_documents ud ON ud.id = ih.document_id
      ORDER BY ih.imported_at DESC
      LIMIT 100
    `);
    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/apply-groups — aplica as categorias de todos os grupos
router.post('/apply-groups', requireAdmin, serializeImport(async (req, res) => {
  const { groups, filename, size } = req.body || {};
  if (!Array.isArray(groups) || !groups.length)
    return res.status(400).json({ error: 'Nenhum grupo enviado.' });

  const pool = getDb();
  let updated = 0, groupsApplied = 0;

  // Registra o PDF de grupos (não persistido em disco) para aparecer no histórico
  let documentId = null;
  if (filename) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO ${_s}uploaded_documents (filename, type, size_bytes, uploaded_by)
         VALUES ($1, 'grupos', $2, $3) RETURNING id`,
        [filename, size || null, req.user.username]
      );
      documentId = rows[0].id;
    } catch (err) {
      console.error('[apply-groups] Erro ao registrar documento:', err.message);
    }
  }

  // Carrega estado atual de categoria dos produtos que serão alterados
  const allIds = groups.flatMap(g => (!g.skip && Array.isArray(g.productIds)) ? g.productIds : []);
  let currentMap = new Map();
  if (allIds.length) {
    const { rows: curRows } = await pool.query(
      `SELECT id, categoria, is_disabled FROM ${_s}products WHERE id = ANY($1::text[])`,
      [allIds]
    );
    currentMap = new Map(curRows.map(r => [r.id, r]));
  }

  const auditIds = []; // produtos cujo grupo mudou de fato

  for (const g of groups) {
    if (!Array.isArray(g.productIds) || !g.productIds.length) continue;

    if (g.skip) {
      // NIVEL MESTRE: limpa categoria e reativa — sem categoria não significa desativado
      try {
        await pool.query(
          `UPDATE ${_s}products SET categoria = NULL, is_disabled = 0, updated_at = NOW()
           WHERE id = ANY($1::text[]) AND (categoria IS NOT NULL OR COALESCE(is_disabled, 0) <> 0)`,
          [g.productIds]
        );
      } catch (err) {
        console.error('[apply-groups] NIVEL MESTRE erro:', err.message);
      }
      continue;
    }

    if (!g.name) continue;
    try {
      let rowCount;
      if (g.disabled) {
        // Grupo "01 DESATIVADO": marca is_disabled = 1, categoria = NULL
        await pool.query(
          `UPDATE ${_s}products SET is_disabled = 1, categoria = NULL, updated_at = NOW()
           WHERE id = ANY($1::text[]) AND (is_disabled IS DISTINCT FROM 1 OR categoria IS NOT NULL)`,
          [g.productIds]
        );
        // Conta apenas quem mudou de categoria (era não-nulo)
        const catChanged = g.productIds.filter(id => {
          const c = currentMap.get(id);
          return c && c.categoria !== null;
        });
        updated += catChanged.length;
        auditIds.push(...catChanged);
      } else {
        // Grupo normal: atribui categoria e reativa — só o grupo DESATIVADO marca is_disabled
        ({ rowCount } = await pool.query(
          `UPDATE ${_s}products SET categoria = $1, is_disabled = 0, updated_at = NOW()
           WHERE id = ANY($2::text[]) AND (categoria IS DISTINCT FROM $1 OR COALESCE(is_disabled, 0) <> 0)`,
          [g.name, g.productIds]
        ));
        updated += rowCount;
        auditIds.push(...g.productIds.filter(id => {
          const c = currentMap.get(id);
          return c && c.categoria !== g.name;
        }));
      }
      groupsApplied++;
    } catch (err) {
      console.error('[apply-groups] Erro grupo', g.name + ':', err.message);
    }
  }

  // Grava audit para os produtos que trocaram de grupo
  if (auditIds.length) {
    try {
      const prevCats = auditIds.map(id => currentMap.get(id)?.categoria ?? null);
      await pool.query(`
        INSERT INTO ${_s}product_audit
          (product_id, name, stock_fiscal, stock_mgmt, stock_real, fiscal_alert, categoria,
           prev_categoria, last_categoria_changed_at, changed_at)
        SELECT p.id, p.name, p.stock_fiscal, p.snap_stock_mgmt, p.stock_real, p.fiscal_alert,
               p.categoria, v.pc, NOW(), NOW()
        FROM ${_s}products p
        JOIN (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS pc) v ON v.id = p.id
        ON CONFLICT (product_id) DO UPDATE SET
          name                      = EXCLUDED.name,
          stock_fiscal              = EXCLUDED.stock_fiscal,
          stock_mgmt                = EXCLUDED.stock_mgmt,
          stock_real                = EXCLUDED.stock_real,
          fiscal_alert              = EXCLUDED.fiscal_alert,
          categoria                 = EXCLUDED.categoria,
          prev_categoria            = EXCLUDED.prev_categoria,
          last_categoria_changed_at = EXCLUDED.last_categoria_changed_at,
          changed_at                = NOW()
      `, [auditIds, prevCats]);
    } catch (err) {
      console.error('[apply-groups] Erro ao registrar audit:', err.message);
    }
  }

  cache.clear('products:');
  cache.clear('stats');
  cache.clear('action-stats');
  try {
    await pool.query(`REFRESH MATERIALIZED VIEW ${_s}product_stats`);
  } catch (e) {
    console.error('[apply-groups] REFRESH VIEW falhou:', e.message);
  }

  const totalParsed = groups.reduce((s, g) => s + (g.found || 0) + (g.notFound || 0), 0);
  const notFoundTotal = groups.reduce((s, g) => s + (g.notFound || 0), 0);
  try {
    await pool.query(
      `INSERT INTO ${_s}import_history (document_id, type, total_products, updated_products, skipped, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [documentId, 'grupos', totalParsed, updated, notFoundTotal, 'success']
    );
  } catch (err) {
    console.error('[apply-groups] Erro ao gravar histórico:', err.message);
  }

  res.json({ updated, groups: groupsApplied });
}));

// GET /api/documents/
router.get('/', requireAdmin, async (req, res) => {
  try {
    const pool = getDb();
    const { rows } = await pool.query(`SELECT * FROM ${_s}uploaded_documents ORDER BY uploaded_at DESC LIMIT 50`);
    res.json({ documents: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Parser de Grupos de Produto (PDF "Grupos de Produto" do Simples Varejo)
//
// Formato real do PDF (extraído via pdf-parse):
//   - Cabeçalhos de grupo aparecem APÓS cada bloco "Total por grupo de produto:"
//     e logo no início (primeiro grupo). Formato: "NOME DO GRUPO - <código>"
//     (NIVEL MESTRE tem decoradores: "---- NIVEL MESTRE ---- - 0")
//   - Cada produto ocupa várias linhas: NOME, EMBALAGEM, ESTOQUE, PREÇO, TOTAL, CÓDIGO
//     O CÓDIGO é um número inteiro isolado que vem por ÚLTIMO (após o total)
//   - Cabeçalhos de página se repetem em cada página (Página N de N, CÓDIGO, etc.)
// ---------------------------------------------------------------------------
function parseGrupos(rawText, productSet) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  // Linhas de cabeçalho de página que se repetem — ignorar sempre
  const PAGE_WORDS = new Set(['CÓDIGO', 'PRODUTO', 'EMBALAGEM', 'ESTOQUE', 'REFERÊNCIA', 'PREÇO', 'TOTAL']);
  const isPageSkip = l =>
    PAGE_WORDS.has(l) ||
    /^Página \d+ de \d+$/i.test(l) ||
    /^\d{2}\/\d{2}\/\d{4}/.test(l) ||
    /^PREÇO \+ ESTOQUE/i.test(l) ||
    /^ESTOQUE ZERO/i.test(l) ||
    /^ATIVO: TODOS/i.test(l) ||
    /^DESCRIÇÃO DO PRODUTO/i.test(l) ||
    /^ORDEM DE SAÍDA/i.test(l);

  // Linha numérica: inteiro puro ou decimal (ex: "81,00", "-158.406,84", "257")
  const isNumber = l => /^-?[\d.]+,\d{2}$/.test(l) || /^-?\d+$/.test(l);
  // Código de produto: inteiro puro sem sinal (ex: "9528", "10055")
  const isPureInt = l => /^\d+$/.test(l);

  const groups   = [];
  let current    = null;
  let skipNums   = false;  // após "Total por grupo", pular linhas numéricas
  let wantHeader = true;   // próxima linha não-numérica é cabeçalho de grupo

  for (const line of lines) {
    if (isPageSkip(line)) continue;

    // Marcadores de total → ativar modo de pulo de números e espera por próximo grupo
    if (line === 'Total por grupo de produto:' || /^Total geral/i.test(line)) {
      skipNums   = true;
      wantHeader = false;
      continue;
    }

    if (skipNums) {
      if (isNumber(line)) continue; // pular valores/contagem do total
      // Primeira linha não-numérica após o bloco de total = cabeçalho do próximo grupo
      skipNums   = false;
      wantHeader = true;
    }

    if (wantHeader) {
      const m = /^(.*) - (\d+)$/.exec(line);
      if (m) {
        wantHeader = false;
        if (current) groups.push(current);
        const code = parseInt(m[2]);
        // Remove decoradores "----" do NIVEL MESTRE
        const name = m[1].replace(/^[-\s]+/, '').replace(/[-\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
        current = { name, code, skip: code === 0, disabled: code === 50, productIds: [], found: 0, notFound: 0 };
      }
      // Se não casou com o padrão de cabeçalho, mantém wantHeader=true e continua tentando
      continue;
    }

    // Dentro de um grupo: código de produto é um inteiro puro (vem após nome/emb/estoque/preço/total)
    if (current && isPureInt(line)) {
      if (productSet.has(line)) { current.productIds.push(line); current.found++; }
      else                      { current.notFound++; }
    }
  }
  if (current) groups.push(current);

  return groups;
}

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
        if (/^D50[^0-9]/i.test(line)) is_disabled = 1;
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
        name: pdfName || (existing ? existing.name : null),
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
