const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'gatopreto.db');

let _db;
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT    NOT NULL UNIQUE,
      password  TEXT    NOT NULL,
      role      TEXT    NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id              TEXT    PRIMARY KEY,
      name            TEXT    NOT NULL,
      price_fiscal    REAL,
      price_mgmt      REAL,
      stock_fiscal    REAL,
      stock_mgmt      REAL,
      stock_real      REAL,
      status          INTEGER NOT NULL DEFAULT 0,   -- 0=igual 1=divergente 2=só fiscal
      created_at      DATETIME DEFAULT (datetime('now')),
      updated_at      DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url         TEXT NOT NULL,
      is_pinned   INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_products_name   ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_images_product  ON product_images(product_id);
  `);

  // Tabela de auditoria — um registro por produto, atualizado a cada mudança
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_audit (
      product_id    TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      name          TEXT,
      stock_fiscal  REAL,
      stock_mgmt    REAL,
      stock_real    REAL,
      changed_at    DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Documentos PDF enviados pelo admin
  db.exec(`
    CREATE TABLE IF NOT EXISTS uploaded_documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      filename    TEXT    NOT NULL,
      type        TEXT    NOT NULL,  -- 'fiscal' | 'gerencial'
      size_bytes  INTEGER,
      uploaded_by TEXT,
      uploaded_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id      INTEGER REFERENCES uploaded_documents(id),
      type             TEXT    NOT NULL,
      total_products   INTEGER,
      updated_products INTEGER,
      skipped          INTEGER,
      status           TEXT,    -- 'success' | 'partial' | 'error'
      imported_at      DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Migrações — adiciona colunas novas em bancos já existentes
  const migrations = [
    'ALTER TABLE products ADD COLUMN stock_real      REAL',
    'ALTER TABLE products ADD COLUMN fiscal_alert    INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE product_audit ADD COLUMN fiscal_alert INTEGER NOT NULL DEFAULT 0',
    // Snapshot dos PDFs: separado dos dados manuais do sistema
    'ALTER TABLE products ADD COLUMN snap_price_mgmt REAL',
    'ALTER TABLE products ADD COLUMN snap_stock_mgmt REAL',
    'ALTER TABLE products ADD COLUMN snap_mgmt_at    DATETIME',
    'ALTER TABLE products ADD COLUMN snap_fiscal_at  DATETIME',
    // is_disabled: produto com prefixo D50 no PDF (desativado no sistema externo)
    'ALTER TABLE products ADD COLUMN is_disabled     INTEGER NOT NULL DEFAULT 0',
    // is_manual: imagem adicionada pelo usuário (não busca Google se existir)
    'ALTER TABLE product_images ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) { /* coluna já existe */ }
  }
}

module.exports = { getDb };
