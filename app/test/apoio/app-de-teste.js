// Sobe o app numa porta livre com um Supabase FALSO (servidor HTTP local) e o
// banco trocado por um falso em memória. Nenhum teste toca o Supabase nem o
// banco de verdade (o Catálogo não tem banco de dev: o local é a produção).
//
// O Supabase falso serve o JWKS com uma chave EC gerada aqui e o /rest/v1/perfis;
// os tokens são assinados de verdade (ES256), então a conferência de assinatura,
// validade, aud e papel roda como em produção.
//
// Cada arquivo de teste roda num processo próprio (node --test), então cada um
// chama subirApp() uma vez, com o ambiente que quiser.

const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { generateKeyPair, exportJWK, SignJWT } = require('jose');

const KID = 'kid-de-teste';

// Contas de teste e o papel de cada uma no Catálogo (public.perfis).
const USUARIOS = {
  admin:      { id: crypto.randomUUID(), email: 'admin@teste.com' },
  conferente: { id: crypto.randomUUID(), email: 'conf@teste.com' },
  semPerfil:  { id: crypto.randomUUID(), email: 'nada@teste.com' },
};
const PERFIS = { [USUARIOS.admin.id]: 'admin', [USUARIOS.conferente.id]: 'user' };

async function subirSupabaseFalso() {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  const estado = {
    chamadas: [],
    jwksStatus: 200,   // 500: JWKS "fora do ar"
    perfisStatus: 200, // 401/500: perfis recusando o token / com erro
    perfisCorpo: null, // resposta crua do perfis, quando o teste quiser forçar
  };
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    estado.chamadas.push({ metodo: req.method, caminho: url.pathname, auth: req.headers.authorization, apikey: req.headers.apikey });
    const json = (status, corpo) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(corpo)); };

    if (url.pathname === '/auth/v1/.well-known/jwks.json') {
      return estado.jwksStatus === 200 ? json(200, { keys: [jwk] }) : json(estado.jwksStatus, { erro: 1 });
    }
    if (url.pathname === '/rest/v1/perfis') {
      if (estado.perfisStatus !== 200) return json(estado.perfisStatus, { message: 'erro de teste' });
      if (estado.perfisCorpo !== null) return json(200, estado.perfisCorpo);
      const id = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
      return json(200, PERFIS[id] ? [{ role: PERFIS[id] }] : []);
    }
    json(404, {});
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${servidor.address().port}`, estado, privateKey,
    fechar: () => servidor.close(),
  };
}

/**
 * Token como o Supabase emite. `quem`: chave de USUARIOS. Opções mudam uma coisa
 * por vez: `expiraEm` (s, negativo = vencido), `aud`, `sub`, `kid`, `chave`.
 */
async function assinarToken(supabase, quem = 'admin', op = {}) {
  const u = USUARIOS[quem] || { id: quem, email: null };
  const agora = Math.floor(Date.now() / 1000);
  const claims = { email: u.email, role: 'authenticated' };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: op.kid ?? KID })
    .setSubject(op.sub ?? u.id)
    .setAudience(op.aud ?? 'authenticated')
    .setIssuedAt(agora)
    .setExpirationTime(agora + (op.expiraEm ?? 3600))
    .sign(op.chave ?? supabase.privateKey);
}

// Troca db/schema por um falso ANTES de o app carregar.
function trocarBanco() {
  const caminho = require.resolve(path.join(__dirname, '..', '..', 'db', 'schema'));
  const falso = {
    DB_SCHEMA: 'Teste',
    initDb: async () => {},
    getDb: () => ({ query: async () => ({ rows: [] }) }),
  };
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: falso };
}

async function subirApp(ambiente = {}) {
  const supabase = await subirSupabaseFalso();
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://ninguem@127.0.0.1:1/nenhum',
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: 'anon-de-teste',
    BASE_PATH: '',
  }, ambiente);
  trocarBanco();
  const { app } = require('../../app');
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  /** fetch sem seguir redirecionamento, com token (Bearer) e cookies opcionais. */
  const pedir = (caminho, { metodo = 'GET', corpo, token, cookies } = {}) => fetch(base + caminho, {
    method: metodo,
    redirect: 'manual',
    headers: {
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  return {
    app, pedir, supabase, USUARIOS,
    token: (quem, op) => assinarToken(supabase, quem, op),
    fechar: () => { servidor.close(); supabase.fechar(); },
  };
}

module.exports = { subirApp, USUARIOS };
