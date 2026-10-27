// O Catálogo só pode escutar em 127.0.0.1: em produção o nginx chega por ali, e
// escutando em tudo a 3001 ficava aberta na internet, contornando o nginx (achado M4
// da Auditoria 3). O server.js abre o banco ao subir, então o teste lê o código.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const codigo = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('o servidor escuta só em 127.0.0.1', () => {
  assert.match(codigo, /const HOST = '127\.0\.0\.1';/);
  assert.match(codigo, /app\.listen\(PORT, HOST,/);
});
