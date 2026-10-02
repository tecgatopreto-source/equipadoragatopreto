// A página pública chama a ponte do login único sozinha: o limite precisa
// aguentar uso normal de uma loja inteira atrás do mesmo IP (antes eram 5 em
// 15 min, o mesmo do login por senha), sem deixar de existir.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

test('a ponte aceita 30 chamadas em 15 minutos por IP e recusa a 31ª com 429', async () => {
  for (let i = 1; i <= 30; i++) {
    const r = await t.pedir('/api/auth/sso', { metodo: 'POST', corpo: { access_token: 'token-admin' } });
    assert.equal(r.status, 200, `chamada ${i}`);
  }
  const r = await t.pedir('/api/auth/sso', { metodo: 'POST', corpo: { access_token: 'token-admin' } });
  assert.equal(r.status, 429);
});
