// Entrada só pela Central (login único). Ver CLAUDE.md, seção Authentication.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

// Login por senha ------------------------------------------------------------
test('sem LOGIN_LOCAL, a rota de login por senha não existe', async () => {
  const r = await t.pedir('/api/auth/login', { metodo: 'POST', corpo: { email: 'admin@teste.com', password: 'certa' } });
  assert.equal(r.status, 404);
});

test('a página de passagem não tem formulário de senha', async () => {
  for (const caminho of ['/login', '/login.html']) {
    const html = await (await t.pedir(caminho)).text();
    assert.doesNotMatch(html, /type="password"/, caminho);
    assert.doesNotMatch(html, /<form/, caminho);
    assert.match(html, /Entre pela Central/, caminho);
  }
});

// Ponte do login único -------------------------------------------------------
test('sso com token válido e perfil emite o cookie e devolve o papel', async () => {
  const r = await t.pedir('/api/auth/sso', { metodo: 'POST', corpo: { access_token: 'token-admin' } });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).user, { id: 'u-admin', username: 'admin@teste.com', role: 'admin' });
  assert.ok(r.headers.getSetCookie().some((c) => c.startsWith('gp_auth=')));
});

test('sso com token inválido: 401 invalid_token, sem cookie', async () => {
  const r = await t.pedir('/api/auth/sso', { metodo: 'POST', corpo: { access_token: 'lixo' } });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'invalid_token');
  assert.ok(!r.headers.getSetCookie().some((c) => c.startsWith('gp_auth=')));
});

test('sso sem perfil no Catálogo: 401 no_access', async () => {
  const r = await t.pedir('/api/auth/sso', { metodo: 'POST', corpo: { access_token: 'token-sem-perfil' } });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'no_access');
});

// Páginas protegidas ---------------------------------------------------------
test('sem cookie, /admin e /conferente vão para a passagem dizendo aonde voltar', async () => {
  const admin = await t.pedir('/admin');
  assert.equal(admin.status, 302);
  assert.equal(admin.headers.get('location'), '/login?para=admin');
  const conf = await t.pedir('/conferente');
  assert.equal(conf.status, 302);
  assert.equal(conf.headers.get('location'), '/login?para=conferente');
});

test('conferente que abre /admin vai para /conferente; admin abre /admin', async () => {
  const conf = await t.entrar('token-conferente');
  const r1 = await t.pedir('/admin', { cookies: conf });
  assert.equal(r1.status, 302);
  assert.equal(r1.headers.get('location'), '/conferente');

  const admin = await t.entrar('token-admin');
  const r2 = await t.pedir('/admin', { cookies: admin });
  assert.equal(r2.status, 200);
});

test('a página pública abre para qualquer um, sem cookie, e sem a marca de modo local', async () => {
  const r = await t.pedir('/');
  assert.equal(r.status, 200);
  assert.doesNotMatch(await r.text(), /data-login-local/);
});

// Encerrar a sessão do Catálogo ----------------------------------------------
// Usado quando a sessão da Central sumiu: derruba só o cookie daqui. Não chama
// mais o logout global do Supabase (o "Sair" saiu do Catálogo; sai-se pela Central).
test('logout revoga o cookie do Catálogo e não encerra a sessão da Central', async () => {
  const cookies = await t.entrar('token-admin');
  const antes = t.supabase.chamadas.length;
  const r = await t.pedir('/api/auth/logout', { metodo: 'POST', cookies, corpo: { access_token: 'token-admin' } });
  assert.equal(r.status, 200);
  assert.equal((await t.pedir('/admin', { cookies })).status, 302, 'cookie revogado não abre mais o admin');
  const novas = t.supabase.chamadas.slice(antes);
  assert.ok(!novas.some((c) => c.includes('/auth/v1/logout')), `não pode chamar o logout do Supabase: ${novas}`);
});
