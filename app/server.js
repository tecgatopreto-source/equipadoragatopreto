// Carrega .env em desenvolvimento local (ignorado se não existir)
try { require('fs').readFileSync('.env').toString().split('\n').forEach(l => { const [k,...v]=l.trim().split('='); if(k&&!k.startsWith('#')&&!process.env[k]) process.env[k]=v.join('='); }); } catch {}

const express = require('express');
const path = require('path');
const fs = require('fs');

// Variáveis obrigatórias — falha rápido se faltar
['DATABASE_URL', 'JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'].forEach(k => {
  if (!process.env[k]) { console.error(`[FATAL] Variável de ambiente ausente: ${k}`); process.exit(1); }
});

const app = express();
const PORT = process.env.PORT || 3001;

// BASE_PATH é usado APENAS para injetar window.APP_BASE no HTML.
// O Express sempre serve as rotas na raiz — o Nginx já faz o strip do prefixo.
// Ex: Nginx recebe /catalogo_produtos/admin → passa /admin ao Express.
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');

function renderHtml(file) {
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  if (BASE) {
    html = html.replace('<head>', `<head><script>window.APP_BASE='${BASE}';</script>`);
  }
  return html;
}
const adminHtml      = renderHtml('admin.html');
const conferenteHtml = renderHtml('conferente.html');
const indexHtml      = renderHtml('index.html');
const loginHtml      = renderHtml('login.html');

app.use(express.json({ limit: '2mb' }));

// Arquivos estáticos na raiz (.html excluídos — servidos pelas rotas SPA com APP_BASE injetado)
const staticPublic = express.static(path.join(__dirname, 'public'), { index: false });
app.use((req, res, next) => /\.html?$/i.test(req.path) ? next() : staticPublic(req, res, next));

app.use('/svg', express.static(path.join(__dirname, 'svg')));

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Health check (diagnóstico de conexão com o banco) ─────────────────────────
app.get('/api/health', async (_, res) => {
  try {
    const { getDb } = require('./db/schema');
    const { rows } = await getDb().query('SELECT COUNT(*) FROM products');
    res.json({ ok: true, products: rows[0].count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API Routes (sempre na raiz) ───────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/products',  require('./routes/products'));
app.use('/api/documents', require('./routes/documents'));

// ── SPA Fallback (sempre na raiz) ─────────────────────────────────────────────
app.get('/login',       (_, res) => res.send(loginHtml));
app.get('/login.html',  (_, res) => res.send(loginHtml));
app.get('/admin*',      (_, res) => res.send(adminHtml));
app.get('/conferente*', (_, res) => res.send(conferenteHtml));
app.get('/*',           (_, res) => res.send(indexHtml));

// ── Start ─────────────────────────────────────────────────────────────────────
// initDb() resolve o hostname para IPv4 e cria o pool com host literal (sem DNS no pg)
const { initDb, getDb } = require('./db/schema');
(async () => {
  await initDb();
  // Abre a primeira conexão do pool antes de receber tráfego, evitando cold start
  try {
    await getDb().query('SELECT 1');
    console.log('[db] Pool aquecido');
  } catch (e) {
    console.warn('[db] Aquecimento falhou (servidor sobe mesmo assim):', e.message);
  }
  app.listen(PORT, () => {
    console.log(`\n Gato Preto — Catálogo Online`);
    console.log(`   Local:     http://localhost:${PORT}/`);
    if (BASE) console.log(`   Produção: http://servidor${BASE}/`);
    console.log();
  });
})();
