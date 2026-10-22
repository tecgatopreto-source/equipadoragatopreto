-- ============================================================================
-- Papel próprio do backend: catalogo_produtos_app (achado M2 da Auditoria 3, antigo SEC-018)
--
-- O backend conectava como postgres: dono de tudo, passa por cima da RLS e alcança
-- auth.users e os schemas dos outros sistemas. Qualquer falha futura no Catálogo, que é
-- público (dependência com RCE, vazamento do .env), valeria para o banco inteiro.
--
-- catalogo_produtos_app só entra no schema "CatalogoProdutos":
--   - SELECT/INSERT/UPDATE/DELETE nas 5 tabelas que o código usa, USAGE nas sequências;
--   - SELECT e MAINTAIN na materialized view product_stats: o código lê os totais
--     (routes/products.js) e faz REFRESH depois de importar e de agrupar (routes/products.js,
--     routes/documents.js). MAINTAIN (PostgreSQL 17) permite o REFRESH sem ser dono.
--     Sem ele, o REFRESH falharia em silêncio (o erro só vai para o log) e os totais
--     ficariam congelados;
--   - não é dono de nada: não cria, altera nem apaga estrutura (o startup não roda DDL;
--     mudança de estrutura vem por migration, aplicada como postgres);
--   - sem acesso a auth, public.perfis, aos outros schemas nem às funções SECURITY DEFINER.
--
-- O que sai: SELECT em auth.users(id, email) e SELECT/UPDATE em public.perfis. Eram da
-- tela de usuários do Catálogo (routes/users.js), removida na tarefa 6.2 do RBAC: a troca
-- de papel hoje é só no GestaoSistemas, e o papel da pessoa é lido pelo REST com o token
-- dela (middleware/auth.js), não por esta conexão.
--
-- Não recebem grant (sem uso no código): revoked_tokens (sai na limpeza da sessão antiga),
-- v_product_stats e v_products_with_images.
--
-- BYPASSRLS: as tabelas têm policies com has_system_access(), que depende do auth.uid()
-- do token da pessoa. O backend conecta com usuário e senha, sem token, então sem BYPASSRLS
-- toda consulta falharia. O BYPASSRLS só vale onde o papel já tem GRANT; fora disso
-- continua "permission denied". Mesmo modelo do estoque_app e do controle_produtos_app.
--
-- O papel, o BYPASSRLS e os grants das tabelas existem desde 08/2026 (criados à mão, sem
-- arquivo); este arquivo os registra e é idempotente. As novidades de 22/10/2026 são o
-- REVOKE de auth.users e perfis e o grant em product_stats.
--
-- Aplicar como postgres. NÃO define senha: ela é definida à parte, fora do git:
--   alter role catalogo_produtos_app with password '...';
-- Use só letras e números na senha: o server.js monta a conexão com decodeURIComponent,
-- e @ : / # % quebrariam a URL.
-- DATABASE_URL (pooler de transação, host aws-1):
--   postgresql://catalogo_produtos_app.<ref>:<senha>@aws-1-us-east-2.pooler.supabase.com:6543/postgres
-- Desfazer: 20261022_papel_catalogo_produtos_app_ROLLBACK.sql
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'catalogo_produtos_app') then
    create role catalogo_produtos_app;
  end if;
end $$;

-- superuser/createdb/createrole já são "não" (conferido em 22/10/2026)
alter role catalogo_produtos_app login bypassrls;

grant usage on schema "CatalogoProdutos" to catalogo_produtos_app;

grant select, insert, update, delete on
  "CatalogoProdutos".products,
  "CatalogoProdutos".product_images,
  "CatalogoProdutos".product_audit,
  "CatalogoProdutos".uploaded_documents,
  "CatalogoProdutos".import_history
to catalogo_produtos_app;

grant usage, select on all sequences in schema "CatalogoProdutos" to catalogo_produtos_app;

grant select, maintain on "CatalogoProdutos".product_stats to catalogo_produtos_app;

-- restos da tela de usuários (grants por coluna)
revoke select (id, email) on auth.users from catalogo_produtos_app;
revoke select (user_id, sistema, role), update (role) on public.perfis from catalogo_produtos_app;

commit;
