// Carrega .env em desenvolvimento local (ignorado se não existir)
try { require('fs').readFileSync('.env').toString().split('\n').forEach(l => { const [k,...v]=l.trim().split('='); if(k&&!k.startsWith('#')&&!process.env[k]) process.env[k]=v.join('='); }); } catch {}

const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Variáveis obrigatórias — falha rápido se faltar
['DATABASE_URL', 'JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'].forEach(k => {
  if (!process.env[k]) { console.error(`[FATAL] Variável de ambiente ausente: ${k}`); process.exit(1); }
});

const app = express();
// Roda atrás de 1 proxy reverso (Nginx, mesmo host) — "1" faz o Express confiar
// só no X-Forwarded-For/X-Forwarded-Proto desse hop, não da cadeia inteira.
// Sem isso, req.ip sempre resolve pro IP do Nginx (127.0.0.1), enfraquecendo
// o rate-limit por IP em middleware/rateLimit.js.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// BASE_PATH é usado APENAS para injetar o atributo data-base no HTML.
// O Express sempre serve as rotas na raiz — o Nginx já faz o strip do prefixo.
// Ex: Nginx recebe /catalogo_produtos/admin → passa /admin ao Express.
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');

function renderHtml(file) {
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  if (BASE) {
    // Atributo de dados em vez de <script> inline — permite CSP sem 'unsafe-inline' em script-src.
    html = html.replace('<html lang="pt-BR">', `<html lang="pt-BR" data-base="${BASE.replace(/"/g, '&quot;')}">`);
  }
  return html;
}
const adminHtml      = renderHtml('admin.html');
const conferenteHtml = renderHtml('conferente.html');
const indexHtml      = renderHtml('index.html');
const loginHtml      = renderHtml('login.html');

// Headers de segurança (achado #25 da auditoria). CSP sem 'unsafe-inline' em
// script-src — só é possível porque todo onclick/onerror inline foi
// substituído por addEventListener (ver public/js/*.js).
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://cdn.sheetjs.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  });
  next();
});

app.use(require('cookie-parser')());
app.use(express.json({ limit: '2mb' }));

const { mutationLimiter } = require('./middleware/rateLimit');
app.use('/api', mutationLimiter);

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
    const { getDb, DB_SCHEMA } = require('./db/schema');
    const { rows } = await getDb().query(`SELECT COUNT(*) FROM "${DB_SCHEMA}".products`);
    res.json({ ok: true, products: rows[0].count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API Routes (sempre na raiz) ───────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/products',  require('./routes/products'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/users',     require('./routes/users'));

// ── SPA Fallback (sempre na raiz) ─────────────────────────────────────────────
function requireAuthPage(req, res, next) {
  const token = req.cookies && req.cookies['gp_auth'];
  if (!token) return res.redirect(BASE + '/login');
  try {
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    res.clearCookie('gp_auth');
    res.redirect(BASE + '/login');
  }
}

app.get('/login',       (_, res) => res.send(loginHtml));
app.get('/login.html',  (_, res) => res.send(loginHtml));
app.get('/admin*',      requireAuthPage, (_, res) => res.send(adminHtml));
app.get('/conferente*', requireAuthPage, (_, res) => res.send(conferenteHtml));
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
