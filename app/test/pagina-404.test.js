// Caminho que não existe é 404 com a página própria (public/404.html), não o
// catálogo com 200. Roda com o BASE_PATH de produção para conferir que os
// caminhos absolutos da página levam o prefixo. O banco é o falso de app-de-teste.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp({ BASE_PATH: '/catalogo_produtos' }); });
after(() => t.fechar());

test('páginas que existem abrem com 200', async () => {
  for (const caminho of ['/', '/?q=filtro', '/index.html', '/login', '/login?para=admin', '/admin', '/conferente']) {
    const r = await t.pedir(caminho);
    assert.equal(r.status, 200, caminho);
    assert.match(r.headers.get('content-type'), /text\/html/, caminho);
  }
});

test('caminho inexistente é 404 com a página própria', async () => {
  for (const caminho of ['/qualquer-coisa', '/a/b/c', '/naada.js', '/css/naada.css', '/uploads/naada.png', '/404.html']) {
    const r = await t.pedir(caminho);
    assert.equal(r.status, 404, caminho);
    assert.match(r.headers.get('content-type'), /text\/html/, caminho);
    assert.match(await r.text(), /Página não encontrada/, caminho);
  }
});

test('a página 404 usa o prefixo nos caminhos, sem sobrar __BASE__', async () => {
  const html = await (await t.pedir('/a/b/c')).text();
  assert.doesNotMatch(html, /__BASE__/);
  assert.match(html, /href="\/catalogo_produtos\/css\/tokens\.css"/);
  assert.match(html, /href="\/catalogo_produtos\/"/);
});

test('arquivos que existem continuam vindo', async () => {
  for (const caminho of ['/css/tokens.css', '/logo.png', '/js/sessao.js']) {
    assert.equal((await t.pedir(caminho)).status, 200, caminho);
  }
});

test('/api inexistente continua 404 em JSON', async () => {
  const r = await t.pedir('/api/naada');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type'), /application\/json/);
});
