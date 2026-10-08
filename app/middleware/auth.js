// Validação do token da sessão Gato Preto (ADR 0010 em C:\dev\Doc\adr), em Node.
// Mesmas regras do auth_jwks.py dos backends Python:
//
// 1. O token é o access_token da sessão compartilhada `gp_session`, mandado pelo
//    navegador em `Authorization: Bearer`. A assinatura é conferida pelo JWKS do
//    Supabase, sem perguntar ao Supabase a cada requisição: chave pelo `kid`, e o
//    `alg` do token só é aceito se casar com o tipo da chave (lista fechada de
//    algoritmos assimétricos; sem HS256, sem segredo compartilhado). Exige `exp`,
//    `sub` (UUID) e `aud = authenticated`, com 30 s de tolerância de relógio.
// 2. O papel é lido em `public.perfis` a cada chamada, com o token do próprio
//    usuário (chave anon + Bearer; policy `perfis_self_read`). Nunca guardado.
//
// 401 sem token / inválido / vencido / recusado pelo Supabase · 403 sem perfil ou
// não admin · 503 não deu para conferir (JWKS ou perfis sem resposta).
const { createRemoteJWKSet, jwtVerify, errors } = require('jose');

const SISTEMA = 'CatalogoProdutos';
const TIMEOUT_MS = 10_000;
const LEEWAY_S = 30;
const ALGORITMOS = ['ES256', 'RS256'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class TokenInvalido extends Error {}            // 401
class TokenExpirado extends TokenInvalido {}    // 401
class SemPerfil extends Error {}                // 403
class ConferenciaIndisponivel extends Error {}  // 503

const supabaseUrl = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');

// Chaves em memória. cacheMaxAge infinito de propósito: com o padrão (10 min) a
// jose relê o JWKS mesmo para chave conhecida, e uma falha nessa releitura
// derrubaria todo mundo com 503. Troca de chave continua coberta: `kid`
// desconhecido força releitura, no máximo uma a cada 30 s (cooldownDuration).
// Leituras simultâneas viram uma só; quem tem a chave em cache não espera.
let _jwks;
function jwks() {
  _jwks ||= createRemoteJWKSet(new URL(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`), {
    timeoutDuration: TIMEOUT_MS,
    cacheMaxAge: Infinity,
  });
  return _jwks;
}

// Separa "o token não serve" (401) de "não deu para ler o JWKS" (503).
async function chaveDoToken(cabecalho, token) {
  try {
    return await jwks()(cabecalho, token);
  } catch (e) {
    if (e instanceof errors.JWKSNoMatchingKey || e instanceof errors.JWKSMultipleMatchingKeys
        || e instanceof errors.JOSENotSupported) {
      throw new TokenInvalido(`chave do token: ${e.code || e.name}`);
    }
    throw new ConferenciaIndisponivel(`JWKS: ${e.code || e.name}: ${e.message}`);
  }
}

/** Confere assinatura, exp, aud e sub. Devolve as claims. */
async function validarToken(token) {
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(token, chaveDoToken, {
      algorithms: ALGORITMOS,
      audience: 'authenticated',
      clockTolerance: LEEWAY_S,
      requiredClaims: ['exp', 'sub'],
    }));
  } catch (e) {
    if (e instanceof TokenInvalido || e instanceof ConferenciaIndisponivel) throw e;
    if (e instanceof errors.JWTExpired) throw new TokenExpirado('token vencido');
    if (e instanceof errors.JOSEError) throw new TokenInvalido(e.code || e.name);
    throw e;
  }
  if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) throw new TokenInvalido('sub não é UUID');
  return claims;
}

/** Papel da pessoa no Catálogo, lido em public.perfis com o token dela. */
async function lerPapel(token, sub) {
  const consulta = new URLSearchParams({
    user_id: `eq.${sub}`, sistema: `eq.${SISTEMA}`, select: 'role', limit: '1', // PK (user_id, sistema)
  });
  let r;
  try {
    r = await fetch(`${supabaseUrl()}/rest/v1/perfis?${consulta}`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ConferenciaIndisponivel(`perfis sem resposta: ${e.name}`);
  }
  // 401: o PostgREST recusou o token (venceu no caminho) — é sessão, não indisponibilidade.
  if (r.status === 401) throw new TokenInvalido('perfis respondeu 401');
  if (!r.ok) throw new ConferenciaIndisponivel(`perfis respondeu ${r.status}`);
  let linhas;
  try { linhas = await r.json(); } catch { linhas = null; }
  if (!Array.isArray(linhas)) throw new ConferenciaIndisponivel('perfis em formato inesperado');
  if (linhas.length === 0) throw new SemPerfil(SISTEMA);
  if (typeof linhas[0]?.role !== 'string') throw new ConferenciaIndisponivel('perfis sem role');
  return linhas[0].role;
}

function tokenDoCabecalho(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function responderErro(req, res, e) {
  if (e instanceof TokenExpirado) {
    console.warn(`[auth] 401 token vencido ip=${req.ip}`);
    return res.status(401).json({ error: 'Sessão expirada' });
  }
  if (e instanceof TokenInvalido) {
    console.warn(`[auth] 401 token inválido (${e.message}) ip=${req.ip}`);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
  if (e instanceof SemPerfil) {
    console.warn(`[auth] 403 sem perfil no ${SISTEMA} ip=${req.ip}`);
    return res.status(403).json({ error: 'Sem acesso ao Catálogo' });
  }
  if (e instanceof ConferenciaIndisponivel) {
    console.error(`[auth] 503 não deu para conferir: ${e.message}`);
    return res.status(503).json({ error: 'Não foi possível conferir o acesso agora. Tente de novo.' });
  }
  console.error('[auth] erro inesperado ao conferir o token:', e);
  return res.status(500).json({ error: 'Erro ao verificar credenciais' });
}

/** Qualquer pessoa com perfil no Catálogo. Preenche req.user. */
async function authenticate(req, res, next) {
  const token = tokenDoCabecalho(req);
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    const claims = await validarToken(token);
    const role = await lerPapel(token, claims.sub);
    const email = typeof claims.email === 'string' ? claims.email : null;
    // `username` = e-mail: é o que routes/documents.js grava no histórico de importação.
    req.user = { id: claims.sub, email, username: email, role };
  } catch (e) {
    return responderErro(req, res, e);
  }
  next();
}

function requireAdmin(req, res, next) {
  authenticate(req, res, () => {
    if (req.user.role !== 'admin') {
      console.warn(`[auth] 403 não é admin user=${req.user.id} ${req.method} ${req.path}`);
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }
    next();
  });
}

module.exports = {
  authenticate, requireAdmin, validarToken, lerPapel, tokenDoCabecalho,
  TokenInvalido, TokenExpirado, SemPerfil, ConferenciaIndisponivel, SISTEMA,
};
