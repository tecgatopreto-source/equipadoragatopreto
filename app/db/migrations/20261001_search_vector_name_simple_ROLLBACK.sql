-- Desfaz 20261001_search_vector_name_simple.sql: volta a coluna como estava antes
-- (expressão lida da produção em 01/10/2026). Voltar também o ftsPrefixQuery e o
-- to_tsquery('portuguese', ...) de routes/products.js, senão a consulta não casa com a coluna.

begin;

drop index if exists "CatalogoProdutos".idx_products_search_vector_name;

alter table "CatalogoProdutos".products drop column search_vector_name;

alter table "CatalogoProdutos".products add column search_vector_name tsvector
  generated always as (
    to_tsvector('portuguese'::regconfig,
      regexp_replace(normalize(coalesce(name, ''), NFD), '[̀-ͯ]', '', 'g'))
  ) stored;

create index idx_products_search_vector_name on "CatalogoProdutos".products using gin (search_vector_name);

commit;
