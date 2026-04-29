const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('connect', client => {
  client.query('SET search_path TO "CatalogoProdutos"');
  client.query("SET timezone = 'America/Sao_Paulo'");
});

module.exports = { getDb: () => pool };
