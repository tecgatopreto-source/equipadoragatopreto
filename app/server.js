const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve PDFs enviados via upload
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/products',  require('./routes/products'));
app.use('/api/documents', require('./routes/documents'));

// ── SPA Fallback ──────────────────────────────────────────────────────────
app.get('/admin*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/conferente*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'conferente.html')));
app.get('*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐱 Gato Preto — Catálogo Online`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin\n`);
});
