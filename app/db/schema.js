const { Pool } = require('pg');

let pool = null;

function getDb() {
  if (!pool) throw new Error('[db] Pool not initialized — initDb() must complete first');
  return pool;
}

async function initDb() {
  const { URL } = require('url');
  const dns = require('dns').promises;

  const raw = process.env.DATABASE_URL;
  const u = new URL(raw);

  let host = u.hostname;
  try {
    const { address } = await dns.lookup(u.hostname, { family: 4 });
    host = address;
    console.log(`[db] Resolved to IPv4: ${address}`);
  } catch (e) {
    console.warn('[db] IPv4 resolve failed, using hostname:', e.message);
  }

  pool = new Pool({
    host,
    port: parseInt(u.port, 10) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('connect', client => {
    client.query('SET search_path TO "CatalogoProdutos"');
    client.query("SET timezone = 'America/Sao_Paulo'");
    client.query("SET statement_timeout = '20000'");
  });
}

module.exports = { getDb, initDb };
