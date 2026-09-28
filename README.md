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

## Sessão (diferente dos outros sistemas)

O login usa o Supabase (inclusive o SSO pela Central), mas depois o sistema emite **seu próprio token** num cookie HttpOnly `gp_auth`. Esse cookie dura 12 horas e renova a cada uso. A migração para o modelo dos outros sistemas está planejada (ver ADRs em `C:\dev\Doc\adr`).

## Rodar localmente

```bash
cd app
npm install
npm run dev      # porta 3001
```

> ⚠️ Não existe banco de desenvolvimento: rodando localmente você mexe nos **dados reais**.

## Variáveis de ambiente

`app/.env` (modelo em `app/.env.example`):

| Variável | Obrigatória | O que é |
|---|---|---|
| `DATABASE_URL` | Sim | Conexão direta com o banco (ignora a RLS) |
| `JWT_SECRET` | Sim | Assina o cookie de sessão; o servidor não sobe sem ela |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Sim | Login pelo Supabase |
| `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` | Não | Busca de imagens pelo Google (sem elas, usa o Bing) |
| `BASE_PATH`, `NODE_ENV`, `UPLOAD_DIR`, `PORT` | Não | Produção: `BASE_PATH=/catalogo_produtos`, `NODE_ENV=production` |

## Dados

- Schema `CatalogoProdutos`: `products`, `product_images`, `product_audit`, `uploaded_documents`, `import_history`, `revoked_tokens`. Views `v_product_stats` e `v_products_with_images`.
- Triggers em `products`: `audit_product_changes` e `calc_product_status`.
- As tabelas **têm** policies de RLS (usando `has_system_access`), mas o backend não passa por elas porque usa conexão direta. O CLAUDE.md diz que não há policies; o banco mostra que há.
- Imagens enviadas ficam no disco do servidor (`UPLOAD_DIR/product-images/`), **fora do backup do Supabase**.
- **Outros dependem deste:** a tela Início da Central lê `products` e `import_history` pela função `public.gp_acoes_pendentes()`.

## Deploy

`C:\dev\deploy\deploy.ps1` → entrada `catalogo-produtos`. No servidor: `/var/www/catalogo_produtos`, `npm install` e `pm2 restart catalogo_produtos`.

## Fluxos críticos (conferir antes de cada deploy)

- [ ] Catálogo público abre sem login e a busca de produto funciona
- [ ] Entrar pela Central sem pedir senha de novo (SSO)
- [ ] Conferente: informar o estoque real (testar zero e positivo) e o gerencial e o alerta mudarem conforme a regra
- [ ] Conferente **não** consegue abrir `/admin`
- [ ] Admin: editar um produto; enviar imagem por arquivo e por URL; fixar outra imagem
- [ ] Admin: busca automática de imagem sem apagar as imagens manuais
- [ ] **Admin: importar os 3 PDFs do dia:** fiscal e gerencial (estoque e preço mudam) e grupos (prévia aparece; ao aplicar, as categorias mudam)
- [ ] Produto no grupo "01 DESATIVADO" fica desativado
- [ ] Após importar, o aviso "Atualizar o catálogo de produtos hoje" some da Central
- [ ] Sair e o cookie ser invalidado
