// JWKS fora do ar não é sessão inválida: 503 ("tente de novo"), e volta sozinho.
// Arquivo próprio: o cache de chaves é por processo e aqui ele começa vazio.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

test('JWKS fora do ar: 503; quando volta, 200 sem reiniciar nada', async () => {
  const token = await t.token('admin');
  t.supabase.estado.jwksStatus = 500;
  const r = await t.pedir('/api/auth/me', { token });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'Não foi possível conferir o acesso agora. Tente de novo.');

  t.supabase.estado.jwksStatus = 200;
  assert.equal((await t.pedir('/api/auth/me', { token })).status, 200);
});

test('com a chave já em memória, o JWKS cair não atrapalha', async () => {
  const token = await t.token('admin');
  t.supabase.estado.jwksStatus = 500;
  try {
    assert.equal((await t.pedir('/api/auth/me', { token })).status, 200);
  } finally { t.supabase.estado.jwksStatus = 200; }
});
