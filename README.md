# Catálogo de Produtos — Gato Preto Gestão

Catálogo interno de produtos: estoque (fiscal, gerencial e real), preços, imagens, importação de documentos e conferência de estoque.

Faz parte do ecossistema Gato Preto. Visão geral, banco compartilhado, deploy e segurança: `C:\dev\Doc\README.md`.
Detalhes técnicos (rotas, imagens, autenticação): [CLAUDE.md](CLAUDE.md).

## Telas e papéis

| Tela | Quem acessa |
|---|---|
| Catálogo (`/`) | Público: consulta de produtos e busca automática de foto |
| Conferente (`/conferente`) | Qualquer usuário com acesso (`user`, mostrado como "Conferente" na Central) |
| Admin (`/admin`) | Só `admin`: produtos, relatórios, imagens e importação |

A edição manual de imagem é só para admin.

## Rotina diária (segunda a sexta)

O catálogo é atualizado todo dia útil com **três PDFs exportados do Simples Varejo**, importados pela tela Admin:

| PDF | O que atualiza |
|---|---|
| **Fiscal** | Preço e estoque fiscal |
| **Gerencial** | Preço e estoque gerencial |
| **Grupos** ("Grupos de Produto") | Categoria de cada produto. Mostra uma prévia antes de aplicar. Produtos no grupo **"01 DESATIVADO"** são desativados |

Enquanto a importação do dia não é feita, a Central mostra a ação pendente **"Atualizar o catálogo de produtos hoje"**. Cada importação fica registrada no histórico (`import_history`).

## Regras de negócio

- **Estoque e preço fiscal e gerencial não são editados à mão:** só mudam pela importação dos PDFs.
- **Estoque real informado:** negativo = erro; zero = gerencial zera e marca alerta fiscal; positivo = gerencial passa a ser igual ao real.
- **Auditoria:** cada produto alterado guarda a última mudança em `product_audit` (uma linha por produto, sobrescrita).
- **Imagens:** até 4 por produto, sempre uma fixada. As da busca automática são substituídas numa nova busca; as manuais nunca são.

## Sessão (igual aos outros sistemas desde 08/10/2026)

**Login único:** o Catálogo não tem tela de login própria. Só se entra pela Central, que é o único lugar com senha. A página pública não tem "Entrar"; o botão "Painel admin"/"Conferente" só aparece para quem entrou pela Central e tem perfil no Catálogo. `/login` é uma página de passagem ("Entre pela Central" / "Sem acesso"). Não há "Sair": sai-se pela Central. Os conferentes entram pela Central no celular.

O Catálogo usa a **mesma sessão** da Central (`gp_session`), lida e renovada pelo supabase-js no navegador; cada chamada à API leva o token, e o servidor confere a assinatura e o papel em `public.perfis` na hora (ADR 0010 em `C:\dev\Doc\adr`). Tirar o acesso na Central corta na próxima chamada. Até 08/10 era um cookie próprio (`gp_auth`, 12h, com o papel dentro).

## Rodar localmente

```bash
cd app
npm install
npm run dev      # porta 3001
```

> ⚠️ Não existe banco de desenvolvimento: rodando localmente você mexe nos **dados reais**.

**Entrar no local:** no local a Central roda em outro endereço e a sessão não é compartilhada. Ponha `LOGIN_LOCAL=1` no `app/.env` para ter o formulário de senha em `/login` (entra pelo supabase-js, como a Central).

Testes: `npm test` (dentro de `app/`). Não tocam o Supabase nem o banco.

## Variáveis de ambiente

`app/.env` (modelo em `app/.env.example`):

| Variável | Obrigatória | O que é |
|---|---|---|
| `DATABASE_URL` | Sim | Conexão direta com o banco (ignora a RLS) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Sim | Conferir o token (JWKS) e o perfil; também vão para o navegador (a anon key é pública) |
| `JWT_SECRET` | Não | **Não é mais usada** (08/10/2026). Fica no servidor só até a limpeza final, para permitir voltar a versão anterior |
| `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` | Não | Busca de imagens pelo Google (sem elas, usa o Bing) |
| `BASE_PATH`, `NODE_ENV`, `UPLOAD_DIR`, `PORT` | Não | Produção: `BASE_PATH=/catalogo_produtos`, `NODE_ENV=production` |
| `LOGIN_LOCAL` | Não | **Só na máquina de desenvolvimento**: `1` liga o login por senha. O servidor recusa subir com `LOGIN_LOCAL=1` e `NODE_ENV=production` |

## Dados

- Schema `CatalogoProdutos`: `products`, `product_images`, `product_audit`, `uploaded_documents`, `import_history`, `revoked_tokens` (sem uso desde 08/10/2026; sai numa migration depois que a sessão nova estiver estável). Views `v_product_stats` e `v_products_with_images`.
- Triggers em `products`: `audit_product_changes` e `calc_product_status`.
- As tabelas **têm** policies de RLS (usando `has_system_access`), mas o backend não passa por elas porque usa conexão direta. O CLAUDE.md diz que não há policies; o banco mostra que há.
- Imagens enviadas ficam no disco do servidor (`UPLOAD_DIR/product-images/`), **fora do backup do Supabase**.
- **Outros dependem deste:** a tela Início da Central lê `products` e `import_history` pela função `public.gp_acoes_pendentes()`; o Sistema de Estoque lê `products` (inclusive `search_vector_name`, a busca por nome) e `import_history`.
- **Busca por nome:** coluna gerada `search_vector_name` (nome sem acento, pontuação como separador, configuração `simple`) com índice GIN. A consulta é montada por `ftsPrefixQuery` em `routes/products.js` com a mesma regra: cada palavra vira começo de palavra, todas obrigatórias, e partes grudadas por pontuação ("1.4", "p.choque") precisam estar vizinhas.
- **Mudanças de banco** ficam em `app/db/migrations/` (cada uma com o seu `_ROLLBACK.sql`) e são aplicadas à mão no deploy. As tabelas mais antigas foram criadas direto no Supabase, antes dessa pasta existir.

## Deploy

`C:\dev\deploy\deploy.ps1` → entrada `catalogo-produtos`. No servidor: `/var/www/catalogo_produtos`, `npm install` e `pm2 restart catalogo_produtos`.

Se o deploy trouxer migration nova em `app/db/migrations/`, aplique-a no banco **junto com** o restart (a busca nova e a coluna nova precisam estar no ar juntas).

## Fluxos críticos (conferir antes de cada deploy)

- [ ] Catálogo público abre sem login e a busca de produto funciona
- [ ] Busca por nome acha pedaço de palavra e ignora pontuação ("lampad" acha LAMPADA; "choque" acha P.CHOQUE)
- [ ] Entrar pela Central sem pedir senha de novo (login único)
- [ ] Conferente: informar o estoque real (testar zero e positivo) e o gerencial e o alerta mudarem conforme a regra
- [ ] Conferente **não** consegue abrir `/admin`
- [ ] Admin: editar um produto; enviar imagem por arquivo e por URL; fixar outra imagem
- [ ] Admin: busca automática de imagem sem apagar as imagens manuais
- [ ] **Admin: importar os 3 PDFs do dia:** fiscal e gerencial (estoque e preço mudam) e grupos (prévia aparece; ao aplicar, as categorias mudam)
- [ ] Produto no grupo "01 DESATIVADO" fica desativado
- [ ] Após importar, o aviso "Atualizar o catálogo de produtos hoje" some da Central
- [ ] `/login` sem ter entrado na Central → "Entre pela Central", **sem** formulário de senha (se aparecer, o servidor está sem `NODE_ENV=production`: conferir `pm2 env`)
- [ ] Página pública sem "Entrar" e sem "Sair"; depois de sair na Central, o botão "Painel admin"/"Conferente" some
- [ ] Tirar o acesso de alguém ao Catálogo na Central: a próxima ação dele no Catálogo é recusada
- [ ] Deixar o Catálogo aberto mais de 1 hora sem abrir a Central e continuar usando (a sessão se renova sozinha)
- [ ] Conferente entra pela Central no celular
