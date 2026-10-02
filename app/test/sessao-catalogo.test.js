// Decisões da tela sobre a sessão (public/js/sessao-catalogo.js, carregado no navegador
// pela página pública e pela página de passagem).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/js/sessao-catalogo');

test('lerSessaoCentral: token e usuário do gp_session; qualquer outra coisa é null', () => {
  const bruto = JSON.stringify({ access_token: 'tk', user: { id: 'u1' } });
  assert.deepEqual(S.lerSessaoCentral(bruto), { token: 'tk', userId: 'u1' });
  assert.equal(S.lerSessaoCentral(null), null);
  assert.equal(S.lerSessaoCentral('{"user":{}}'), null);
  assert.equal(S.lerSessaoCentral('não é json'), null);
});

test('botaoDoPainel: admin → Painel admin; conferente → Conferente; sem usuário, nenhum', () => {
  assert.deepEqual(S.botaoDoPainel({ role: 'admin' }), { rotulo: 'Painel admin', caminho: '/admin' });
  assert.deepEqual(S.botaoDoPainel({ role: 'user' }), { rotulo: 'Conferente', caminho: '/conferente' });
  assert.equal(S.botaoDoPainel(null), null);
  assert.equal(S.botaoDoPainel({ role: 'outro' }), null);
});

test('precisaEntrarDeNovo: sem sessão do Catálogo ou de outra conta → sim; mesma conta → não', () => {
  const central = { token: 'tk', userId: 'u1' };
  assert.equal(S.precisaEntrarDeNovo(central, null), true);
  assert.equal(S.precisaEntrarDeNovo(central, { id: 'u2' }), true);
  assert.equal(S.precisaEntrarDeNovo(central, { id: 'u1' }), false);
});

test('semSessaoDaCentral: em produção encerra a sessão daqui; no modo local confia no cookie', () => {
  assert.equal(S.semSessaoDaCentral(false), 'encerrar');
  assert.equal(S.semSessaoDaCentral(true), 'usar_cookie');
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

test('telaDaPassagem: o que mostrar quando a ponte não deu certo', () => {
  assert.equal(S.telaDaPassagem(401, 'no_access'), 'sem_acesso');
  assert.equal(S.telaDaPassagem(401, 'invalid_token'), 'entrar');
  assert.equal(S.telaDaPassagem(429, null), 'limite');
  assert.equal(S.telaDaPassagem(500, null), 'erro');
  assert.equal(S.telaDaPassagem(0, null), 'erro');
});
