// POST /api/products: o id do produto novo só aceita letras, números, ponto,
// underline e hífen, até 30 caracteres (achado B1 da Auditoria 3). Id fora disso
// ou que não seja texto é 400 sem consultar o banco. O banco é o falso de app-de-teste.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

/** Cria um produto como admin e devolve a resposta + as consultas que chegaram ao banco. */
async function criar(corpo) {
  t.consultas.length = 0;
  const r = await t.pedir('/api/products', { metodo: 'POST', corpo, token: await t.token('admin') });
  return { r, consultas: [...t.consultas] };
}

test('id com < é 400 e a mensagem explica o formato', async () => {
  const { r, consultas } = await criar({ id: 'a<b', name: 'Teste' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /id inválido/);
  assert.equal(consultas.length, 0, 'não pode consultar o banco');
});

test('id que não é texto (array, número, objeto) é 400', async () => {
  for (const id of [['abc'], 123, { a: 1 }]) {
    const { r, consultas } = await criar({ id, name: 'Teste' });
    assert.equal(r.status, 400, JSON.stringify(id));
    assert.equal(consultas.length, 0, JSON.stringify(id));
  }
});

test('id com mais de 30 caracteres é 400', async () => {
  const { r } = await criar({ id: 'A'.repeat(31), name: 'Teste' });
  assert.equal(r.status, 400);
});

test('id válido passa da validação e cria o produto', async () => {
  for (const id of ['ABC-123', '12345', 'a.b_c-d', 'A'.repeat(30)]) {
    const { r, consultas } = await criar({ id, name: 'Teste' });
    assert.equal(r.status, 201, id);
    assert.ok(consultas.some((c) => /INSERT INTO/.test(c.sql)), id);
  }
});
