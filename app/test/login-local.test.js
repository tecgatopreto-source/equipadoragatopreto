// LOGIN_LOCAL=1: formulário de senha só na máquina de desenvolvimento.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loginLocalLigado } = require('../config');
const { subirApp } = require('./apoio/app-de-teste');

test('LOGIN_LOCAL=1 com NODE_ENV=production: recusa subir', () => {
  assert.throws(() => loginLocalLigado({ LOGIN_LOCAL: '1', NODE_ENV: 'production' }), /NODE_ENV=production/);
});

test('só liga com o valor exato 1', () => {
  assert.equal(loginLocalLigado({}), false);
  assert.equal(loginLocalLigado({ LOGIN_LOCAL: 'true' }), false);
  assert.equal(loginLocalLigado({ LOGIN_LOCAL: '1' }), true);
});

let t;
before(async () => { t = await subirApp({ LOGIN_LOCAL: '1', NODE_ENV: 'development' }); });
after(() => t.fechar());

test('com LOGIN_LOCAL=1, a página de passagem mostra o formulário', async () => {
  const html = await (await t.pedir('/login')).text();
  assert.match(html, /type="password"/);
  assert.match(html, /Entre pela Central/);
});

test('com LOGIN_LOCAL=1, as páginas vêm marcadas como modo local', async () => {
  const html = await (await t.pedir('/')).text();
  assert.match(html, /<html lang="pt-BR"[^>]* data-login-local="1"/);
});

// O formulário entra pelo supabase-js no navegador (grava a gp_session local);
// o servidor não tem mais rota de login, nem no modo local.
test('com LOGIN_LOCAL=1, também não existe rota de login no servidor', async () => {
  const r = await t.pedir('/api/auth/login', { metodo: 'POST', corpo: { email: 'admin@teste.com', password: 'x' } });
  assert.equal(r.status, 404);
});
