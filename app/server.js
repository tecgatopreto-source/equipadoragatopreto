// Carrega .env em desenvolvimento local (ignorado se não existir)
try { require('fs').readFileSync('.env').toString().split('\n').forEach(l => { const [k,...v]=l.trim().split('='); if(k&&!k.startsWith('#')&&!process.env[k]) process.env[k]=v.join('='); }); } catch {}

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, ''); // ex: '/catalogo_produtos'

app.use(express.json({ limit: '2mb' }));
app.use(BASE, express.static(path.join(__dirname, 'public')));

// Serve PDFs enviados via upload
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(BASE + '/uploads', express.static(UPLOAD_DIR));

// ── Routes ────────────────────────────────────────────────────────────────
app.use(BASE + '/api/auth',      require('./routes/auth'));
app.use(BASE + '/api/products',  require('./routes/products'));
app.use(BASE + '/api/documents', require('./routes/documents'));

// ── SPA Fallback ──────────────────────────────────────────────────────────
app.get(BASE + '/admin*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get(BASE + '/conferente*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'conferente.html')));
app.get(BASE + '/*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐱 Gato Preto — Catálogo Online`);
  console.log(`   http://localhost:${PORT}/catalogo_produtos`);
  console.log(`   Admin: http://localhost:${PORT}/catalogo_produtos/admin\n`);
});
