-- ============================================================================
-- Busca por nome: search_vector_name sem radical ('simple') e com a pontuação como separador
--
-- Antes: to_tsvector('portuguese', nome sem acento). Dois problemas:
--   1. pontuação grudava nas palavras: "P.CHOQUE" virava o lexema 'p.choque' e "CIVIC/CITY"
--      'civic/city', então buscar "choque" ou "city" não achava;
--   2. o radical do 'portuguese' quebrava a busca por começo de palavra: "lampada" vira 'lamp',
--      e quem digitava "lampad" não achava nada ('lampad' não é começo de 'lamp').
-- Agora: nome sem acento, minúsculo, tudo que não é [a-z0-9] vira espaço, e 'simple' (sem radical).
-- A consulta é montada por ftsPrefixQuery (routes/products.js) com a mesma regra, e o
-- Sistema de Estoque lê esta mesma coluna: mudar aqui muda a busca dos dois.
--
-- Só o índice depende da coluna (conferido em 01/10/2026). A tabela é regravada (≈9.300
-- linhas, menos de 1 s), com trava enquanto a transação durar.
-- Desfazer: 20261001_search_vector_name_simple_ROLLBACK.sql
-- ============================================================================

begin;

drop index if exists "CatalogoProdutos".idx_products_search_vector_name;

alter table "CatalogoProdutos".products drop column search_vector_name;

alter table "CatalogoProdutos".products add column search_vector_name tsvector
  generated always as (
    to_tsvector('simple'::regconfig,
      btrim(regexp_replace(
        lower(regexp_replace(normalize(coalesce(name, ''), NFD), '[̀-ͯ]', '', 'g')),
        '[^a-z0-9]+', ' ', 'g')))
  ) stored;

create index idx_products_search_vector_name on "CatalogoProdutos".products using gin (search_vector_name);

commit;
