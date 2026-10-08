// Decisões da tela sobre a sessão (public/js/sessao-catalogo.js, carregado no navegador
// por todas as páginas, antes de js/sessao.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/js/sessao-catalogo');

test('botaoDoPainel: admin → Painel admin; conferente → Conferente; sem usuário, nenhum', () => {
  assert.deepEqual(S.botaoDoPainel({ role: 'admin' }), { rotulo: 'Painel admin', caminho: '/admin' });
  assert.deepEqual(S.botaoDoPainel({ role: 'user' }), { rotulo: 'Conferente', caminho: '/conferente' });
  assert.equal(S.botaoDoPainel(null), null);
  assert.equal(S.botaoDoPainel({ role: 'outro' }), null);
});

test('decidirPagina: /admin só para admin; conferente vai para /conferente (achado #97)', () => {
  assert.equal(S.decidirPagina('admin', 200, 'admin'), 'liberado');
  assert.equal(S.decidirPagina('admin', 200, 'user'), 'conferente');
  assert.equal(S.decidirPagina('admin', 200, 'outro'), 'entrar');
});

test('decidirPagina: /conferente abre para admin e conferente', () => {
  assert.equal(S.decidirPagina('conferente', 200, 'admin'), 'liberado');
  assert.equal(S.decidirPagina('conferente', 200, 'user'), 'liberado');
  assert.equal(S.decidirPagina('conferente', 200, 'outro'), 'entrar');
});

test('decidirPagina: sem sessão ou sem perfil → passagem; não deu para conferir → erro (não manda entrar)', () => {
  for (const area of ['admin', 'conferente']) {
    assert.equal(S.decidirPagina(area, 401, null), 'entrar');
    assert.equal(S.decidirPagina(area, 403, null), 'entrar');
    assert.equal(S.decidirPagina(area, 503, null), 'erro');
    assert.equal(S.decidirPagina(area, 429, null), 'erro');
    assert.equal(S.decidirPagina(area, 0, null), 'erro');
  }
});

test('destinoAposEntrar: respeita o pedido só dentro do que o papel permite', () => {
  assert.equal(S.destinoAposEntrar('admin', 'admin'), '/admin');
  assert.equal(S.destinoAposEntrar('admin', 'conferente'), '/conferente');
  assert.equal(S.destinoAposEntrar('admin', null), '/admin');
  assert.equal(S.destinoAposEntrar('user', 'admin'), '/conferente');
  assert.equal(S.destinoAposEntrar('user', null), '/conferente');
  assert.equal(S.destinoAposEntrar('outro', 'admin'), '/');
  assert.equal(S.destinoAposEntrar('admin', 'https://fora.com'), '/admin');
});

test('telaDaPassagem: o que mostrar quando /api/auth/me não liberou', () => {
  assert.equal(S.telaDaPassagem(401), 'entrar');
  assert.equal(S.telaDaPassagem(403), 'sem_acesso');
  assert.equal(S.telaDaPassagem(429), 'limite');
  assert.equal(S.telaDaPassagem(503), 'erro');
  assert.equal(S.telaDaPassagem(0), 'erro');
});
