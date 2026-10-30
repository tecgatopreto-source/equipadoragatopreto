// GET /api/health é público: com o banco fora responde 500 { ok: false } sem a
// mensagem do pg (que cita usuário, host e schema), e o detalhe vai para o log
// (achado B5 da Auditoria 3). O 500 importa: o deploy espera a rota com curl -f.
// O banco é o falso de app-de-teste; aqui o getDb é trocado por um que falha.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { subirApp } = require('./apoio/app-de-teste');

const TEXTO_INTERNO = 'password authentication failed for user "catalogo_produtos_app"';

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

test('banco no ar: 200 { ok: true }', async () => {
  const r = await t.pedir('/api/health');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('banco fora: 500 { ok: false } sem a mensagem do pg, e a mensagem vai para o log', async () => {
  const schema = require(path.join(__dirname, '..', 'db', 'schema')); // o falso
  const getDbOriginal = schema.getDb;
  const errorOriginal = console.error;
  const log = [];
  schema.getDb = () => ({ query: async () => { throw new Error(TEXTO_INTERNO); } });
  console.error = (...partes) => log.push(partes.map(String).join(' '));
  try {
    const r = await t.pedir('/api/health');
    const texto = await r.text();
    assert.equal(r.status, 500);
    assert.deepEqual(JSON.parse(texto), { ok: false });
    assert.ok(!texto.includes(TEXTO_INTERNO));
    assert.ok(log.some((linha) => linha.includes(TEXTO_INTERNO)), 'o detalhe tem de ir para o log');
  } finally {
    schema.getDb = getDbOriginal;
    console.error = errorOriginal;
  }
});
