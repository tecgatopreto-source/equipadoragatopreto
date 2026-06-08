#!/usr/bin/env node
// Crawler bulk: busca imagens no Google para produtos sem imagem.
// Uso: node app/scripts/crawl-images.js [--limit 100] [--offset 0] [--ean-only]
//
// --limit N     : quantos produtos processar nesta execução (padrão: 100)
// --offset N    : pular N produtos (para retomar de onde parou)
// --ean-only    : processar apenas produtos que têm EAN
// --delay N     : ms entre requisições (padrão: 1200 — respeita cota 100/dia grátis)

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

const { getDb, initDb, DB_SCHEMA } = require('../db/schema');
const _s = `"${DB_SCHEMA}".`;
const { searchAndSaveImages } = require('../lib/image-search');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? Number(process.argv[i + 1]) : fallback;
}
const hasFlag = name => process.argv.includes(name);

const LIMIT    = arg('--limit', 100);
const OFFSET   = arg('--offset', 0);
const DELAY    = arg('--delay', 1200);
const EAN_ONLY = hasFlag('--ean-only');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_CX) {
    console.error('Defina GOOGLE_SEARCH_API_KEY e GOOGLE_SEARCH_CX no .env');
    process.exit(1);
  }

  await initDb();
  const pool = getDb();

  const eanClause = EAN_ONLY ? 'AND p.ean IS NOT NULL' : '';
  const { rows: products } = await pool.query(
    `SELECT p.id, p.name, p.ean
     FROM ${_s}products p
     WHERE p.is_disabled = 0
       AND NOT EXISTS (
         SELECT 1 FROM ${_s}product_images pi WHERE pi.product_id = p.id
       )
       ${eanClause}
     ORDER BY p.id
     LIMIT $1 OFFSET $2`,
    [LIMIT, OFFSET]
  );

  console.log(`Produtos para processar: ${products.length} (offset=${OFFSET}, ean-only=${EAN_ONLY})`);
  if (!products.length) { console.log('Nenhum produto sem imagem encontrado.'); process.exit(0); }

  let ok = 0, failed = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const label = p.ean ? `EAN ${p.ean}` : `"${p.name.slice(0, 40)}"`;
    process.stdout.write(`[${i + 1}/${products.length}] #${p.id} ${label} ... `);

    try {
      const saved = await searchAndSaveImages(p);
      console.log(`${saved.length} imagens salvas`);
      ok++;
    } catch (e) {
      console.log(`ERRO: ${e.message}`);
      failed++;
      // Parar se a API retornar 429 (cota esgotada)
      if (e.message.includes('429')) {
        console.error('Cota da API esgotada. Retome amanhã com --offset ' + (OFFSET + i));
        break;
      }
    }

    if (i < products.length - 1) await sleep(DELAY);
  }

  console.log(`\nConcluído: ${ok} OK, ${failed} erros.`);
  console.log(`Para continuar: node app/scripts/crawl-images.js --offset ${OFFSET + products.length}`);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
