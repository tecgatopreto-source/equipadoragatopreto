// Monta o app Express (rotas, segurança, páginas). Quem sobe o servidor e abre o
// banco é o server.js; separar deixa os testes (test/) carregarem o app sem rede
// nem banco de verdade.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { loginLocalLigado } = require('./config');

// Variáveis obrigatórias — falha rápido se faltar. (JWT_SECRET saiu em 08/10/2026:
// não há mais JWT próprio; a sessão é a gp_session, conferida pelo JWKS.)
['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'].forEach(k => {
  if (!process.env[k]) throw new Error(`[FATAL] Variável de ambiente ausente: ${k}`);
});
const SUPABASE_URL = process.env.SUPABASE_URL.replace(/\/$/, '');
const SUPABASE_ORIGIN = new URL(SUPABASE_URL).origin;
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

const atributo = (nome, valor) => ` ${nome}="${String(valor).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;

function renderHtml(file) {
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  // Atributos de dados em vez de <script> inline — permite CSP sem 'unsafe-inline' em script-src.
  let atributos = '';
  if (BASE) atributos += atributo('data-base', BASE);
  // Para o supabase-js do navegador (js/sessao.js) ler e renovar a gp_session.
  // A anon key é pública (é a mesma que os outros sistemas põem no front).
  atributos += atributo('data-supabase-url', SUPABASE_URL);
  atributos += atributo('data-supabase-anon', process.env.SUPABASE_ANON_KEY);
  // Modo local: a Central roda em outra origem e não compartilha a gp_session;
  // a página de passagem mostra o formulário de senha (ver js/login.js).
  if (LOGIN_LOCAL) atributos += ' data-login-local="1"';
  return html.replace('<html lang="pt-BR">', `<html lang="pt-BR"${atributos}>`);
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
      `connect-src 'self' ${SUPABASE_ORIGIN}`, // supabase-js renova o token direto no Supabase
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

// ── Páginas (sempre na raiz) ──────────────────────────────────────────────────
// Sem proteção no servidor (decisão D1 de 08/10/2026): o token vai no header
// Authorization, que uma navegação de página não leva. Cada página confere a
// sessão no próprio JS (GET /api/auth/me) antes de mostrar qualquer coisa: sem
// sessão → /login?para=…; conferente em /admin → /conferente (achado #97). O
// HTML é só a casca: TODO dado passa pela API, que exige requireAdmin.

// Até 08/10/2026 a sessão daqui era o cookie gp_auth (+ gp_csrf). Não valem mais
// nada; apaga os que sobraram no navegador. Pode sair junto com a limpeza do
// JWT_SECRET/revoked_tokens (passo final do plano).
function apagarCookiesAntigos(req, res) {
  const cookies = req.headers.cookie || '';
  for (const nome of ['gp_auth', 'gp_csrf']) {
    if (new RegExp(`(?:^|;\\s*)${nome}=`).test(cookies)) res.clearCookie(nome);
  }
}
const pagina = (html) => (req, res) => { apagarCookiesAntigos(req, res); res.send(html); };

// Página de passagem: sem formulário de senha. O bloco entre os marcadores
// login-local só fica no HTML com LOGIN_LOCAL=1 (máquina de desenvolvimento).
const passagemHtml = LOGIN_LOCAL
  ? loginHtml
  : loginHtml.replace(/<!--login-local-->[\s\S]*?<!--\/login-local-->/, '');

app.get('/login',       pagina(passagemHtml));
app.get('/login.html',  pagina(passagemHtml));
app.get('/admin*',      pagina(adminHtml));
app.get('/conferente*', pagina(conferenteHtml));
app.get('/*',           pagina(indexHtml));

module.exports = { app, BASE, LOGIN_LOCAL };
