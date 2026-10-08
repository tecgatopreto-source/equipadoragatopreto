// Conferência do token (ADR 0010): assinatura pelo JWKS + papel em perfis a cada
// chamada. Ver middleware/auth.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair, SignJWT } = require('jose');
const { subirApp } = require('./apoio/app-de-teste');

let t;
before(async () => { t = await subirApp(); });
after(() => t.fechar());

const me = (token) => t.pedir('/api/auth/me', { token });
const erro = async (r) => (await r.json()).error;

test('sem token: 401', async () => {
  const r = await t.pedir('/api/auth/me');
  assert.equal(r.status, 401);
  assert.equal(await erro(r), 'Token não fornecido');
});

test('admin: 200 com id, e-mail e papel lidos agora', async () => {
  const r = await me(await t.token('admin'));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).user,
    { id: t.USUARIOS.admin.id, email: 'admin@teste.com', username: 'admin@teste.com', role: 'admin' });
});

test('perfis é lido com o token do próprio usuário e a chave anon', async () => {
  const token = await t.token('conferente');
  await me(token);
  const ultima = t.supabase.estado.chamadas.filter((c) => c.caminho === '/rest/v1/perfis').at(-1);
  assert.equal(ultima.auth, `Bearer ${token}`);
  assert.equal(ultima.apikey, 'anon-de-teste');
});

test('conferente: /me 200 com papel user; rota de admin 403', async () => {
  const token = await t.token('conferente');
  assert.equal((await (await me(token)).json()).user.role, 'user');
  const r = await t.pedir('/api/products/report', { token });
  assert.equal(r.status, 403);
});

test('sem perfil no Catálogo: 403', async () => {
  const r = await me(await t.token('semPerfil'));
  assert.equal(r.status, 403);
  assert.equal(await erro(r), 'Sem acesso ao Catálogo');
});

test('vencido há 60 s: 401 "Sessão expirada"', async () => {
  const r = await me(await t.token('admin', { expiraEm: -60 }));
  assert.equal(r.status, 401);
  assert.equal(await erro(r), 'Sessão expirada');
});

test('relógio um pouco diferente do Supabase: vencido há 5 s ainda vale', async () => {
  assert.equal((await me(await t.token('admin', { expiraEm: -5 }))).status, 200);
});

test('tokens que não servem: 401', async () => {
  const outra = (await generateKeyPair('ES256')).privateKey;
  const casos = {
    'assinado por outra chave com o mesmo kid': await t.token('admin', { chave: outra }),
    'kid desconhecido': await t.token('admin', { kid: 'kid-intruso' }),
    'aud errado': await t.token('admin', { aud: 'anon' }),
    'sub que não é UUID': await t.token('admin', { sub: 'admin' }),
    'HS256 com segredo qualquer': await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'kid-de-teste' })
      .setSubject(t.USUARIOS.admin.id).setAudience('authenticated').setExpirationTime('1h')
      .sign(new TextEncoder().encode('segredo-qualquer-com-32-bytes-ok!')),
    'alg none': [Buffer.from('{"alg":"none","kid":"kid-de-teste"}').toString('base64url'),
      Buffer.from(JSON.stringify({ sub: t.USUARIOS.admin.id, aud: 'authenticated', exp: 9e9 })).toString('base64url'), ''].join('.'),
    'lixo': 'isto.nao.e-um-token',
  };
  for (const [nome, token] of Object.entries(casos)) {
    const r = await me(token);
    assert.equal(r.status, 401, nome);
  }
});

test('perfis recusando o token (401 do PostgREST): 401, não 503', async () => {
  t.supabase.estado.perfisStatus = 401;
  try {
    assert.equal((await me(await t.token('admin'))).status, 401);
  } finally { t.supabase.estado.perfisStatus = 200; }
});

test('perfis com erro: 503 "tente de novo"', async () => {
  t.supabase.estado.perfisStatus = 500;
  try {
    const r = await me(await t.token('admin'));
    assert.equal(r.status, 503);
    assert.equal(await erro(r), 'Não foi possível conferir o acesso agora. Tente de novo.');
  } finally { t.supabase.estado.perfisStatus = 200; }
});

test('perfis em formato inesperado: 503', async () => {
  for (const corpo of [{ role: 'admin' }, [{}], [{ role: null }]]) {
    t.supabase.estado.perfisCorpo = corpo;
    try {
      assert.equal((await me(await t.token('admin'))).status, 503, JSON.stringify(corpo));
    } finally { t.supabase.estado.perfisCorpo = null; }
  }
});

test('a importação grava o e-mail de quem importou (req.user.username)', async () => {
  // routes/documents.js usa req.user.username; garante que continua sendo o e-mail.
  const { authenticate } = require('../middleware/auth');
  const token = await t.token('admin');
  const req = { get: () => `Bearer ${token}`, ip: '127.0.0.1' };
  await new Promise((ok, falha) => authenticate(req, { status: () => ({ json: falha }) }, ok));
  assert.equal(req.user.username, 'admin@teste.com');
});
