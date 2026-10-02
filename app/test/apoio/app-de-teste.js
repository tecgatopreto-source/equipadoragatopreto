// Sobe o app numa porta livre com um Supabase FALSO (servidor HTTP local) e o
// banco trocado por um falso em memória. Nenhum teste toca o Supabase nem o
// banco de verdade (o Catálogo não tem banco de dev: o local é a produção).
//
// Cada arquivo de teste roda num processo próprio (node --test), então cada um
// chama subirApp() uma vez, com o ambiente que quiser.

const http = require('node:http');
const path = require('node:path');

// Tokens de acesso que o Supabase falso aceita, e o perfil de cada um no Catálogo.
const USUARIOS = {
  'token-admin':      { id: 'u-admin', email: 'admin@teste.com' },
  'token-conferente': { id: 'u-conf',  email: 'conf@teste.com' },
  'token-sem-perfil': { id: 'u-nada',  email: 'nada@teste.com' },
};
const PERFIS = { 'u-admin': 'admin', 'u-conf': 'user' };
const SENHAS = { 'admin@teste.com': { senha: 'certa', token: 'token-admin' } };

function subirSupabaseFalso() {
  const chamadas = [];
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    chamadas.push(`${req.method} ${url.pathname}`);
    const json = (status, corpo) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(corpo)); };

    if (url.pathname === '/auth/v1/user') {
      return USUARIOS[token] ? json(200, USUARIOS[token]) : json(401, { msg: 'invalid' });
    }
    if (url.pathname === '/rest/v1/perfis') {
      const id = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
      return json(200, PERFIS[id] ? [{ role: PERFIS[id] }] : []);
    }
    if (url.pathname === '/auth/v1/token') {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        const { email, password } = JSON.parse(corpo || '{}');
        const conta = SENHAS[email];
        if (!conta || conta.senha !== password) return json(400, { error: 'invalid_grant' });
        json(200, { access_token: conta.token, user: USUARIOS[conta.token] });
      });
      return;
    }
    if (url.pathname === '/auth/v1/logout') return json(204, {});
    json(404, {});
  });
  return new Promise((ok) => servidor.listen(0, '127.0.0.1', () =>
    ok({ url: `http://127.0.0.1:${servidor.address().port}`, chamadas, fechar: () => servidor.close() })));
}

// Troca db/schema por um falso ANTES de o app carregar: isRevoked/revokeToken
// (middleware/auth.js) passam a usar este conjunto em memória.
function trocarBanco() {
  const revogados = new Set();
  const caminho = require.resolve(path.join(__dirname, '..', '..', 'db', 'schema'));
  const falso = {
    DB_SCHEMA: 'Teste',
    initDb: async () => {},
    getDb: () => ({
      query: async (sql, params = []) => {
        if (/SELECT 1 FROM .*revoked_tokens/.test(sql)) return { rows: revogados.has(params[0]) ? [{}] : [] };
        if (/INSERT INTO .*revoked_tokens/.test(sql)) { revogados.add(params[0]); return { rows: [] }; }
        return { rows: [] };
      },
    }),
  };
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: falso };
  return revogados;
}

async function subirApp(ambiente = {}) {
  const supabase = await subirSupabaseFalso();
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://ninguem@127.0.0.1:1/nenhum',
    JWT_SECRET: 'segredo-de-teste-'.padEnd(64, 'x'),
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: 'anon-de-teste',
    BASE_PATH: '',
  }, ambiente);
  const revogados = trocarBanco();
  const { app } = require('../../app');
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  /** fetch sem seguir redirecionamento, com cookies opcionais. */
  const pedir = (caminho, { metodo = 'GET', corpo, cookies } = {}) => fetch(base + caminho, {
    method: metodo,
    redirect: 'manual',
    headers: {
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  /** Entra pelo login único e devolve o cabeçalho Cookie para os pedidos seguintes. */
  const entrar = async (token) => {
    const r = await pedir('/api/auth/sso', { metodo: 'POST', corpo: { access_token: token } });
    if (!r.ok) throw new Error(`sso falhou: ${r.status}`);
    return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  };

  return {
    pedir, entrar, supabase, revogados,
    fechar: () => { servidor.close(); supabase.fechar(); },
  };
}

module.exports = { subirApp };
