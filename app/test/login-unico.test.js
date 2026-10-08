// Entrada só pela Central (login único), sem sessão própria do Catálogo
// (ADR 0010; plano de 08/10/2026). Ver CLAUDE.md, seção Authentication.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

test('as rotas da sessão antiga não existem mais', async () => {
  for (const caminho of ['/api/auth/login', '/api/auth/sso', '/api/auth/logout']) {
    const r = await t.pedir(caminho, { metodo: 'POST', corpo: {} });
    assert.equal(r.status, 404, caminho);
  }
});

test('a página de passagem não tem formulário de senha', async () => {
  for (const caminho of ['/login', '/login.html']) {
    const html = await (await t.pedir(caminho)).text();
    assert.doesNotMatch(html, /type="password"/, caminho);
    assert.doesNotMatch(html, /<form/, caminho);
    assert.match(html, /Entre pela Central/, caminho);
  }
});

test('/admin e /conferente devolvem a página sem conferir sessão (a página confere no JS)', async () => {
  for (const caminho of ['/admin', '/conferente']) {
    const r = await t.pedir(caminho);
    assert.equal(r.status, 200, caminho);
    assert.match(await r.text(), /js\/sessao\.js/, `${caminho} carrega o js/sessao.js`);
  }
});

test('as páginas levam a URL e a anon key do Supabase para o supabase-js', async () => {
  const html = await (await t.pedir('/')).text();
  assert.match(html, new RegExp(`data-supabase-url="${t.supabase.url}"`));
  assert.match(html, /data-supabase-anon="anon-de-teste"/);
});

test('a CSP libera conexão só com a própria origem e o Supabase', async () => {
  const csp = (await t.pedir('/')).headers.get('content-security-policy');
  assert.match(csp, new RegExp(`connect-src 'self' ${t.supabase.url};`));
});

test('a página pública abre para qualquer um, sem a marca de modo local', async () => {
  const r = await t.pedir('/');
  assert.equal(r.status, 200);
  assert.doesNotMatch(await r.text(), /data-login-local/);
});

test('cookies da sessão antiga (gp_auth, gp_csrf) são apagados ao abrir uma página', async () => {
  const r = await t.pedir('/admin', { cookies: 'gp_auth=velho; gp_csrf=velho; outro=fica' });
  const apagados = r.headers.getSetCookie().map((c) => c.split('=')[0]);
  assert.deepEqual(apagados.sort(), ['gp_auth', 'gp_csrf']);
  const semCookie = await t.pedir('/admin');
  assert.deepEqual(semCookie.headers.getSetCookie(), []);
});
