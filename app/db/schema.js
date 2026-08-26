const { Pool } = require('pg');

const DB_SCHEMA = process.env.PG_SCHEMA || 'CatalogoProdutos';

let pool = null;

function getDb() {
  if (!pool) throw new Error('[db] Pool not initialized — initDb() must complete first');
  return pool;
}

async function initDb() {
  const { URL } = require('url');
  const dns = require('dns');
  const path = require('path');

  // Prefere IPv4 sem congelar o IP: cada conexão nova re-resolve o DNS,
  // então uma troca de IP do pooler do Supabase não derruba o app até restart.
  dns.setDefaultResultOrder('ipv4first');

  const raw = process.env.DATABASE_URL;
  const u = new URL(raw);

  pool = new Pool({
    host: u.hostname,
    port: parseInt(u.port, 10) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    // O pooler do Supabase assina seu certificado com uma CA própria (Supabase
    // Root 2021 CA), que não está nos trust stores públicos — daí o Node
    // rejeitar com SELF_SIGNED_CERT_IN_CHAIN sem essa CA pinada explicitamente.
    // certs/supabase-root-ca.pem extraído direto da conexão real (SEC #8).
    ssl: {
      rejectUnauthorized: true,
      servername: u.hostname,
      ca: require('fs').readFileSync(path.join(__dirname, '..', 'certs', 'supabase-root-ca.pem'), 'utf8'),
    },
    max: 20,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('connect', client => {
    client.query(`SET search_path TO "${DB_SCHEMA}"`);
    client.query("SET timezone = 'America/Sao_Paulo'");
    client.query("SET statement_timeout = '20000'");
  });
}

module.exports = { getDb, initDb, DB_SCHEMA };
