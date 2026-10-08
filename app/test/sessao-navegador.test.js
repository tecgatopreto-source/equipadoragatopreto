// public/js/sessao.js (window.SessaoGP) rodando no Node, num contexto `vm` com
// window/document/fetch falsos e um supabase-js falso que o teste controla.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'sessao.js'), 'utf8');

/**
 * Carrega o sessao.js com fakes. `auth`: getSession/refreshSession do supabase-js
 * falso. `responder(token)`: status que a API devolve para cada token.
 */
function carregar({ auth, responder }) {
  const ouvintes = [];
  const pedidos = [];
  const cliente = { auth: { onAuthStateChange: (fn) => ouvintes.push(fn), ...auth } };
  const documentElement = { dataset: { supabaseUrl: 'http://supabase', supabaseAnon: 'anon' } };
  const ctx = {
    window: { supabase: { createClient: () => cliente }, SessaoCatalogo: require('../public/js/sessao-catalogo') },
    document: { documentElement },
    localStorage: { removeItem() {} },
    location: { reload() {}, replace() {} },
    fetch: async (url, opcoes) => {
      const token = (opcoes.headers.Authorization || '').replace('Bearer ', '') || null;
      pedidos.push({ url, token });
      await new Promise((ok) => setImmediate(ok));
      const status = responder(token);
      return { status, ok: status === 200, json: async () => ({ user: { id: 'u1', role: 'admin' } }) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx);
  return { S: ctx.window.SessaoGP, ouvintes, pedidos, documentElement };
}

const sessao = (token) => ({ data: { session: token ? { access_token: token } : null } });

test('quemSou não quebra quando o getSession falha (ex.: disputa de lock entre abas): status 0', async () => {
  const { S } = carregar({
    auth: { getSession: async () => { throw new Error('NavigatorLockAcquireTimeoutError'); } },
    responder: () => 200,
  });
  assert.deepEqual({ ...(await S.quemSou()) }, { status: 0, usuario: null });
});

test('sem sessão: quemSou responde 401 sem chamar a API', async () => {
  const { S, pedidos } = carregar({ auth: { getSession: async () => sessao(null) }, responder: () => 200 });
  assert.equal((await S.quemSou()).status, 401);
  assert.equal(pedidos.length, 0);
});

test('várias chamadas com 401 ao mesmo tempo: uma renovação só, e todas repetem com o token novo', async () => {
  let atual = 'velho';
  let renovacoes = 0;
  const { S, pedidos } = carregar({
    auth: {
      getSession: async () => sessao(atual),
      refreshSession: async () => {
        renovacoes++;
        await new Promise((ok) => setTimeout(ok, 20));
        atual = 'novo';
        return sessao('novo');
      },
    },
    responder: (token) => (token === 'novo' ? 200 : 401),
  });
  const respostas = await Promise.all([S.apiFetch('/api/a'), S.apiFetch('/api/b'), S.apiFetch('/api/c')]);
  assert.deepEqual(respostas.map((r) => r.status), [200, 200, 200]);
  assert.equal(renovacoes, 1);
  assert.equal(pedidos.filter((p) => p.token === 'novo').length, 3);
});

test('401 depois que outra chamada/aba já renovou: usa o token novo sem renovar de novo', async () => {
  let leituras = 0;
  let renovacoes = 0;
  const { S } = carregar({
    auth: {
      getSession: async () => sessao(++leituras === 1 ? 'velho' : 'novo'),
      refreshSession: async () => { renovacoes++; return sessao('outro'); },
    },
    responder: (token) => (token === 'novo' ? 200 : 401),
  });
  assert.equal((await S.apiFetch('/api/x')).status, 200);
  assert.equal(renovacoes, 0);
});

test('renovação que falha: devolve o 401 original (a página manda para a passagem)', async () => {
  const { S } = carregar({
    auth: { getSession: async () => sessao('velho'), refreshSession: async () => { throw new Error('Invalid Refresh Token'); } },
    responder: () => 401,
  });
  assert.equal((await S.apiFetch('/api/x')).status, 401);
});

test('aoMudarConta: Sair e troca de conta avisam; foco na aba (SIGNED_IN da mesma conta) e renovação não', () => {
  const { S, ouvintes } = carregar({ auth: { getSession: async () => sessao('t') }, responder: () => 200 });
  let avisos = 0;
  S.aoMudarConta(() => 'u1', () => avisos++);
  const emitir = (evento, id) => ouvintes.forEach((fn) => fn(evento, id ? { user: { id } } : null));
  emitir('SIGNED_IN', 'u1');
  emitir('TOKEN_REFRESHED', 'u1');
  assert.equal(avisos, 0);
  emitir('SIGNED_IN', 'u2');
  assert.equal(avisos, 1);
  emitir('SIGNED_OUT', null);
  assert.equal(avisos, 2);
});

test('exigirArea liberado marca a página como conferida (o CSS só mostra depois disso)', async () => {
  const { S, documentElement } = carregar({ auth: { getSession: async () => sessao('t') }, responder: () => 200 });
  assert.equal(documentElement.dataset.sessao, undefined);
  const usuario = await S.exigirArea('admin');
  assert.equal(usuario.role, 'admin');
  assert.equal(documentElement.dataset.sessao, 'conferida');
});
