// O limite geral (100/min) é por usuário só com token de assinatura conferida.
// Arquivo próprio: o contador do limite é por processo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair } = require('jose');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

test('token forjado com o sub de outra pessoa conta no IP, não no limite dela', async () => {
  const outra = (await generateKeyPair('ES256')).privateKey;
  const forjado = await t.token('admin', { chave: outra }); // sub do admin, assinatura falsa
  for (let i = 0; i < 100; i++) {
    assert.equal((await t.pedir('/api/auth/me', { token: forjado })).status, 401);
  }
  assert.equal((await t.pedir('/api/auth/me', { token: forjado })).status, 429, 'o 101º forjado bate no limite do IP');
  assert.equal((await t.pedir('/api/auth/me', { token: await t.token('admin') })).status, 200,
    'o admin de verdade, no mesmo IP, não foi afetado');
});
