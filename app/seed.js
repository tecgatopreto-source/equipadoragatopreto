#!/usr/bin/env node
/**
 * seed.js — Importa produtos do HTML original do catálogo e cria admin padrão
 */
const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db/schema');

const HTML_PATH = path.join(__dirname, '..', 'catalogo_gato_preto_v10.html');

async function main() {
  console.log('🐱 Gato Preto — Seeder\n');

  const db = getDb();

  // ── 1. Usuário admin padrão ──────────────────────────────────────────────
  const existingAdmin = db.prepare("SELECT id FROM users WHERE username='admin'").get();
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO users (username, password, role) VALUES (?,?,?)").run('admin', hash, 'admin');
    console.log('✅ Usuário admin criado (login: admin / senha: admin123)');
  } else {
    console.log('ℹ️  Usuário admin já existe, pulando...');
  }

  // ── 2. Extrair B64 do HTML ───────────────────────────────────────────────
  const total = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
  if (total > 0) {
    console.log(`ℹ️  Banco já tem ${total} produtos, pulando importação.`);
    console.log('\n✅ Seed concluído!');
    return;
  }

  if (!fs.existsSync(HTML_PATH)) {
    console.warn(`⚠️  Arquivo de catálogo não encontrado: ${HTML_PATH}`);
    console.warn('   Pulando importação de produtos. O servidor iniciará sem produtos.');
    console.log('\n✅ Seed concluído!');
    return;
  }

  console.log('📂 Lendo HTML original...');
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  const match = html.match(/const\s+B64\s*=\s*"([A-Za-z0-9+/=]+)"/);
  if (!match) {
    console.error('❌ Variável B64 não encontrada no HTML');
    process.exit(1);
  }

  const b64 = match[1];
  console.log(`📦 Descomprimindo dados (${Math.round(b64.length / 1024)} KB base64)...`);

  const compressed = Buffer.from(b64, 'base64');
  const decompressed = await new Promise((resolve, reject) => {
    zlib.gunzip(compressed, (err, buf) => {
      if (err) reject(err);
      else resolve(buf.toString('utf8'));
    });
  });

  const products = JSON.parse(decompressed);
  console.log(`📋 ${products.length} produtos encontrados. Importando para SQLite...`);

  // ── 3. Inserir produtos em lote ──────────────────────────────────────────
  // Estrutura: [id, name, price_fiscal, price_mgmt, stock_fiscal, stock_mgmt, status]
  const insert = db.prepare(`
    INSERT OR IGNORE INTO products
      (id, name, price_fiscal, price_mgmt, stock_fiscal, stock_mgmt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    let count = 0;
    for (const p of items) {
      insert.run(
        String(p[0]),
        String(p[1]),
        p[2] != null ? Number(p[2]) : null,
        p[3] != null ? Number(p[3]) : null,
        p[4] != null ? Number(p[4]) : null,
        p[5] != null ? Number(p[5]) : null,
        Number(p[6] ?? 0)
      );
      count++;
    }
    return count;
  });

  const inserted = insertMany(products);
  console.log(`✅ ${inserted} produtos importados com sucesso!`);
  console.log('\n✅ Seed concluído!');
  console.log('   Inicie o servidor: npm start');
}

main().catch(err => { console.error('❌ Erro:', err); process.exit(1); });
