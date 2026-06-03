#!/usr/bin/env node
// Lê export.htm (exportação do Simples Varejo) e preenche a coluna ean em products.
// Uso: node app/scripts/import-ean.js

const fs   = require('fs');
const path = require('path');

// Carrega .env sem depender do pacote dotenv
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '');
  });
}
const { getDb, initDb } = require('../db/schema');

const HTML_FILE = path.join(__dirname, '..', '..', 'export.htm');

function tdText(raw) {
  return raw.replace(/<[^>]+>/g, '').trim();
}

function parseExport(html) {
  const rows = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let trMatch;
  let isHeader = true;

  while ((trMatch = trRe.exec(html)) !== null) {
    if (isHeader) { isHeader = false; continue; }

    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(trMatch[0])) !== null) {
      tds.push(tdText(tdMatch[1]));
    }
    // col 0 = Código, col 2 = Código de barras
    if (tds.length >= 3 && tds[0]) {
      rows.push({ code: tds[0], ean: tds[2] || '' });
    }
  }
  return rows;
}

async function main() {
  if (!fs.existsSync(HTML_FILE)) {
    console.error(`Arquivo não encontrado: ${HTML_FILE}`);
    process.exit(1);
  }

  const html  = fs.readFileSync(HTML_FILE, 'latin1');
  const rows  = parseExport(html);
  const withEan = rows.filter(r => r.ean);

  console.log(`Linhas lidas: ${rows.length}`);
  console.log(`Com EAN:      ${withEan.length}`);
  console.log(`Sem EAN:      ${rows.length - withEan.length}`);
  console.log('Importando...');

  await initDb();
  const pool = getDb();
  let updated = 0;
  let notFound = 0;

  for (const row of withEan) {
    const r = await pool.query(
      'UPDATE "CatalogoProdutos".products SET ean=$1 WHERE id=$2',
      [row.ean, row.code]
    );
    if (r.rowCount > 0) updated++;
    else notFound++;
  }

  console.log(`Atualizados: ${updated}`);
  if (notFound) console.log(`Não encontrados no banco: ${notFound}`);
  console.log('Concluído.');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
