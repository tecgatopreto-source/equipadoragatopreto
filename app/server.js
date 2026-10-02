// Sobe o Catálogo: lê o .env local, abre o banco e escuta a porta. O app em si
// (rotas, segurança, páginas) é montado em app.js.

// Carrega .env em desenvolvimento local (ignorado se não existir)
try { require('fs').readFileSync('.env').toString().split('\n').forEach(l => { const [k,...v]=l.trim().split('='); if(k&&!k.startsWith('#')&&!process.env[k]) process.env[k]=v.join('='); }); } catch {}

let montado;
try {
  montado = require('./app');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const { app, BASE, LOGIN_LOCAL } = montado;
const PORT = process.env.PORT || 3001;

// ── Start ─────────────────────────────────────────────────────────────────────
// initDb() resolve o hostname para IPv4 e cria o pool com host literal (sem DNS no pg)
const { initDb, getDb } = require('./db/schema');
(async () => {
  await initDb();
  // Abre a primeira conexão do pool antes de receber tráfego, evitando cold start
  try {
    await getDb().query('SELECT 1');
    console.log('[db] Pool aquecido');
  } catch (e) {
    console.warn('[db] Aquecimento falhou (servidor sobe mesmo assim):', e.message);
  }
  app.listen(PORT, () => {
    console.log(`\n Gato Preto — Catálogo Online`);
    console.log(`   Local:     http://localhost:${PORT}/`);
    if (BASE) console.log(`   Produção: http://servidor${BASE}/`);
    if (LOGIN_LOCAL) console.warn('   ATENÇÃO: LOGIN_LOCAL=1 — formulário de senha ligado (só para desenvolvimento).');
    console.log();
  });
})();
