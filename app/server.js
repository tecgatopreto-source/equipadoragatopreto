// Carrega .env em desenvolvimento local (ignorado se não existir)
try { require('fs').readFileSync('.env').toString().split('\n').forEach(l => { const [k,...v]=l.trim().split('='); if(k&&!k.startsWith('#')&&!process.env[k]) process.env[k]=v.join('='); }); } catch {}

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, ''); // ex: '/catalogo_produtos'

// Pre-render HTML with injected APP_BASE so client JS knows the subpath
function renderHtml(file) {
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  if (BASE) {
    html = html.replace('<head>', `<head><script>window.APP_BASE='${BASE}';</script>`);
  }
  return html;
}
const adminHtml = renderHtml('admin.html');
const conferenteHtml = renderHtml('conferente.html');
const indexHtml = renderHtml('index.html');
const loginHtml = renderHtml('login.html');

app.use(express.json({ limit: '2mb' }));

// Serve static files (CSS, JS, images, logo, etc.)
// index:false evita servir index.html cru (sem APP_BASE injetado) para requisições de diretório
app.use(BASE, express.static(path.join(__dirname, 'public'), { index: false }));

// Serve SVGs para placeholders de produtos
app.use(BASE + '/svg', express.static(path.join(__dirname, 'svg')));

// Serve PDFs enviados via upload
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(BASE + '/uploads', express.static(UPLOAD_DIR));

// ── Routes ────────────────────────────────────────────────────────────────
app.use(BASE + '/api/auth',      require('./routes/auth'));
app.use(BASE + '/api/products',  require('./routes/products'));
app.use(BASE + '/api/documents', require('./routes/documents'));

// ── SPA Fallback ──────────────────────────────────────────────────────────
app.get(BASE + '/login',      (_, res) => res.send(loginHtml));
app.get(BASE + '/login.html', (_, res) => res.send(loginHtml));
app.get(BASE + '/admin*',     (_, res) => res.send(adminHtml));
app.get(BASE + '/conferente*',(_, res) => res.send(conferenteHtml));
// Captura BASE sem barra (ex: /catalogo_produtos) e BASE/* (ex: /catalogo_produtos/qualquer)
if (BASE) app.get(BASE,      (_, res) => res.send(indexHtml));
app.get(BASE + '/*',          (_, res) => res.send(indexHtml));

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n Gato Preto — Catálogo Online`);
  console.log(`   http://localhost:${PORT}${BASE || '/'}`);
  console.log(`   Admin: http://localhost:${PORT}${BASE}/admin\n`);
});
