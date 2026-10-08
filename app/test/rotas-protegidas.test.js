// Com as páginas sem proteção no servidor (D1), a proteção do dado é só a da API:
// toda rota que não é pública tem que exigir admin. A lista sai dos próprios
// routers — uma rota nova sem requireAdmin quebra este teste.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

// Públicas de propósito (catálogo aberto e busca de imagem liberada em 01/09).
const PUBLICAS = new Set([
  'GET /api/products/categories', 'GET /api/products/', 'GET /api/products/stats',
  'GET /api/products/:id', 'GET /api/products/:id/search-images',
]);

function rotas() {
  const lista = [];
  for (const [prefixo, arquivo] of [['/api/products', '../routes/products'], ['/api/documents', '../routes/documents']]) {
    for (const camada of require(arquivo).stack) {
      if (!camada.route) continue;
      for (const metodo of Object.keys(camada.route.methods)) {
        lista.push({
          nome: `${metodo.toUpperCase()} ${prefixo}${camada.route.path}`,
          funcoes: camada.route.stack.map((c) => c.handle.name),
        });
      }
    }
  }
  return lista;
}

test('a varredura achou as rotas', () => {
  const nomes = rotas().map((r) => r.nome);
  assert.ok(nomes.includes('PUT /api/products/:id') && nomes.includes('POST /api/documents/upload/:type'), nomes.join(', '));
});

test('toda rota que não é pública exige admin', () => {
  for (const { nome, funcoes } of rotas()) {
    if (PUBLICAS.has(nome)) continue;
    assert.ok(funcoes.includes('requireAdmin'), `${nome} sem requireAdmin`);
  }
});

test('sem token, as rotas de admin respondem 401 (amostra de verdade)', async () => {
  for (const [metodo, caminho] of [['GET', '/api/products/report'], ['PUT', '/api/products/1'],
    ['DELETE', '/api/products/1'], ['GET', '/api/documents/history'], ['POST', '/api/documents/apply-groups']]) {
    const r = await t.pedir(caminho, { metodo, corpo: metodo === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, `${metodo} ${caminho}`);
  }
});
