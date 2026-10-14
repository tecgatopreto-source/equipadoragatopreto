// GET /api/products (pública): page/limit/status validados (400, não 500), teto
// de 100 por página, desempate pela chave no ORDER BY; e /api/<inexistente> é
// 404 em JSON, não o HTML do catálogo. O banco é o falso de app-de-teste.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

/** Pede a lista e devolve a resposta + a consulta de dados (a com LIMIT) que chegou ao banco. */
async function listar(qs) {
  t.consultas.length = 0;
  const r = await t.pedir('/api/products' + qs);
  const dados = t.consultas.find((c) => /LIMIT \$\d+ OFFSET \$\d+/.test(c.sql));
  return { r, dados };
}

test('sem parâmetros: página 1 com 60 itens', async () => {
  const { r, dados } = await listar('?sort=name&order=asc&q=padrao-' + Date.now());
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual([corpo.page, corpo.limit, corpo.total], [1, 60, 0]);
  assert.deepEqual(dados.params.slice(-2), [60, 0]);
});

test('page e limit viram LIMIT/OFFSET', async () => {
  const { r, dados } = await listar('?page=3&limit=24&q=pag-' + Date.now());
  assert.equal(r.status, 200);
  assert.deepEqual(dados.params.slice(-2), [24, 48]);
  const corpo = await r.json();
  assert.deepEqual([corpo.page, corpo.limit], [3, 24]);
});

test('limit até 100 passa; acima de 100 é 400', async () => {
  assert.equal((await listar('?limit=100&q=cem-' + Date.now())).r.status, 200);
  const { r, dados } = await listar('?limit=101');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /limit/);
  assert.equal(dados, undefined, 'não pode consultar o banco');
});

test('page, limit e status inválidos são 400, sem consultar o banco', async () => {
  for (const qs of ['?page=0', '?page=-1', '?page=abc', '?page=1.5', '?page=2x', '?page=',
    '?limit=0', '?limit=abc', '?limit=10&limit=20', '?status=abc', '?status=3']) {
    const { r, dados } = await listar(qs);
    assert.equal(r.status, 400, qs);
    assert.ok((await r.json()).error, qs);
    assert.equal(dados, undefined, qs);
  }
});

test('status T, vazio e 0/1/2 passam', async () => {
  for (const s of ['T', '', '0', '1', '2']) {
    const { r } = await listar(`?status=${s}&q=st${s}-${Date.now()}`);
    assert.equal(r.status, 200, `status=${s}`);
  }
});

test('ORDER BY desempata pela chave, menos quando já ordena por ela', async () => {
  const porNome = await listar('?sort=name&order=desc&q=ord-' + Date.now());
  assert.match(porNome.dados.sql, /ORDER BY .*p\.name DESC, p\.id\s/s);
  const porId = await listar('?sort=id&q=id-' + Date.now());
  assert.doesNotMatch(porId.dados.sql, /p\.id ASC, p\.id/);
});

test('/api/<inexistente> é 404 em JSON', async () => {
  for (const [metodo, caminho] of [['GET', '/api/xxxxx'], ['GET', '/api/products/1/inexistente'], ['POST', '/api/xxxxx']]) {
    const r = await t.pedir(caminho, { metodo, corpo: metodo === 'POST' ? {} : undefined });
    assert.equal(r.status, 404, `${metodo} ${caminho}`);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await r.json(), { error: 'Rota não encontrada.' });
  }
});

test('páginas continuam abrindo (o 404 é só para /api)', async () => {
  for (const caminho of ['/', '/qualquer-coisa', '/admin', '/conferente']) {
    const r = await t.pedir(caminho);
    assert.equal(r.status, 200, caminho);
    assert.match(r.headers.get('content-type'), /text\/html/);
  }
});
