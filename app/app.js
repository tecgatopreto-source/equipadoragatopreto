// Monta o app Express (rotas, segurança, páginas). Quem sobe o servidor e abre o
// banco é o server.js; separar deixa os testes (test/) carregarem o app sem rede
// nem banco de verdade.
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { loginLocalLigado } = require('./config');

// Variáveis obrigatórias — falha rápido se faltar
['DATABASE_URL', 'JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'].forEach(k => {
  if (!process.env[k]) throw new Error(`[FATAL] Variável de ambiente ausente: ${k}`);
});
// Login por senha só na máquina de desenvolvimento (LOGIN_LOCAL=1). Em produção
// a entrada é só pela Central (login único); se a variável aparecer lá por
// engano, o servidor não sobe — config.js recusa.
const LOGIN_LOCAL = loginLocalLigado(process.env);

const app = express();
app.disable('x-powered-by'); // segurança: não vaza versão do Express
// Roda atrás de 1 proxy reverso (Nginx, mesmo host) — "1" faz o Express confiar
// só no X-Forwarded-For/X-Forwarded-Proto desse hop, não da cadeia inteira.
// Sem isso, req.ip sempre resolve pro IP do Nginx (127.0.0.1), enfraquecendo
// o rate-limit por IP em middleware/rateLimit.js.
app.set('trust proxy', 1);

// BASE_PATH é usado APENAS para injetar o atributo data-base no HTML.
// O Express sempre serve as rotas na raiz — o Nginx já faz o strip do prefixo.
// Ex: Nginx recebe /catalogo_produtos/admin → passa /admin ao Express.
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');

function renderHtml(file) {
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  // Atributos de dados em vez de <script> inline — permite CSP sem 'unsafe-inline' em script-src.
  let atributos = '';
  if (BASE) atributos += ` data-base="${BASE.replace(/"/g, '&quot;')}"`;
  // Modo local: sem sessão da Central (outra origem), a página pública confia só
  // no cookie daqui em vez de encerrá-lo (ver iniciarSessao em js/index.js).
  if (LOGIN_LOCAL) atributos += ' data-login-local="1"';
  if (atributos) html = html.replace('<html lang="pt-BR">', `<html lang="pt-BR"${atributos}>`);
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

// Usados pelas rotas de página no fim do arquivo, para não duplicar aqui o nome
// do cookie nem a checagem de revogação.
const { isRevoked, COOKIE_NAME } = require('./middleware/auth');

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

// ── SPA Fallback (sempre na raiz) ─────────────────────────────────────────────
// Espelha o `authenticate` de middleware/auth.js, inclusive a checagem de
// revogação — sem ela um token deslogado continuava abrindo a página por até
// 12h. A diferença é só a resposta: página manda pra página de passagem
// (/login, login único pela Central), API devolve 401.
//
// `para` diz à página de passagem aonde voltar. Só aceita estes dois valores,
// fixos aqui no servidor: nunca vira redirecionamento para fora do Catálogo.
function requireAuthPage(para) {
  const entrar = `${BASE}/login?para=${para}`;
  return async (req, res, next) => {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.redirect(entrar);
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (await isRevoked(payload.jti)) {
        res.clearCookie(COOKIE_NAME);
        return res.redirect(entrar);
      }
      req.user = payload;
      next();
    } catch {
      res.clearCookie(COOKIE_NAME);
      res.redirect(entrar);
    }
  };
}

// Achado #97: /admin* era servido a qualquer sessão válida. Só a casca HTML
// vazava (todo endpoint com dado já exige requireAdmin), mas um conferente
// caía numa tela que falhava com 403 em tudo. Manda pra área dele.
const exigirSessaoAdmin = requireAuthPage('admin');
function requireAdminPage(req, res, next) {
  exigirSessaoAdmin(req, res, () => {
    if (req.user.role !== 'admin') return res.redirect(BASE + '/conferente');
    next();
  });
}

// Página de passagem: sem formulário de senha. O bloco entre os marcadores
// login-local só fica no HTML com LOGIN_LOCAL=1 (máquina de desenvolvimento).
const passagemHtml = LOGIN_LOCAL
  ? loginHtml
  : loginHtml.replace(/<!--login-local-->[\s\S]*?<!--\/login-local-->/, '');

app.get('/login',       (_, res) => res.send(passagemHtml));
app.get('/login.html',  (_, res) => res.send(passagemHtml));
app.get('/admin*',      requireAdminPage, (_, res) => res.send(adminHtml));
app.get('/conferente*', requireAuthPage('conferente'), (_, res) => res.send(conferenteHtml));
app.get('/*',           (_, res) => res.send(indexHtml));

module.exports = { app, BASE, LOGIN_LOCAL };
