-- ============================================================================
-- Desfaz 20261022_papel_catalogo_produtos_app.sql: devolve os grants em auth.users e
-- public.perfis e tira o grant em product_stats.
--
-- Rodar só DEPOIS de voltar o DATABASE_URL do servidor para o postgres (.env de backup)
-- e reiniciar o backend: sem o grant em product_stats, o catalogo_produtos_app não lê os
-- totais nem faz o REFRESH.
--
-- O papel, o BYPASSRLS e os grants das 5 tabelas ficam: já existiam antes desta migration
-- e não fazem nada enquanto ninguém conecta com eles.
-- ============================================================================

begin;

revoke select, maintain on "CatalogoProdutos".product_stats from catalogo_produtos_app;

grant select (id, email) on auth.users to catalogo_produtos_app;
grant select (user_id, sistema, role), update (role) on public.perfis to catalogo_produtos_app;

commit;
