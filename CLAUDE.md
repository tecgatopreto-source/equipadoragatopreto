# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Catálogo de Produtos — Gato Preto Gestão. An Express/Node.js app for internal product catalog management (stock, pricing, images, PDF import). Part of the shared Supabase ecosystem managed by the GestaoSistemas portal.

## Commands

All commands run from the `app/` directory.

```bash
# Install dependencies
cd app && npm install

# Start (production)
npm start

# Start with file-watching (development)
npm run dev

# Tests (node --test, no extra dependency) — test/*.test.js
npm test
```

No linter configured. **Tests never touch Supabase nor the database** (there is no dev database: local = production): `test/apoio/app-de-teste.js` starts the app on a free port with a fake Supabase (local HTTP server serving the JWKS with an EC key generated in the test, and `/rest/v1/perfis`) and swaps `db/schema` for an in-memory fake before `app.js` loads. Tokens are really signed (ES256), so signature, expiry, `aud` and role checks run as in production. Each test file runs in its own process (the JWKS cache and the rate-limit counter are per process — that is why `jwks-fora` and `limite` have their own files).

**Local login:** in production the only way in is the Central (single sign-on). Locally the Central runs on another port (another origin) and can't share `gp_session`, so put `LOGIN_LOCAL=1` in `app/.env` to get the password form on `/login`. The form signs in with supabase-js in the browser (writes a local `gp_session`); the server has no login route (see `config.js`; the server refuses to start with `LOGIN_LOCAL=1` and `NODE_ENV=production`).

## Architecture

Single-process Express app backed by **PostgreSQL via Supabase** (`pg` pool). All code lives under `app/`.

**Entry point:** `server.js` loads `.env`, opens the DB pool and listens. The app itself is built in `app.js` — mounts route groups, injects `window.APP_BASE` into HTML for reverse-proxy path-prefix support, and serves static HTML files with SPA fallbacks (`/admin*`, `/conferente*`, `/*`). Pre-renders all HTML at startup (not per-request). The split exists so tests can load the app without a real DB.

**Page routes have no server-side guard** (decision D1 of `C:\dev\Auditoria\PLANO_CATALOGO_SESSAO_PADRAO.md`, 08/10/2026): the token travels in the `Authorization` header, which a page navigation does not send. Each page checks the session in its own JS before showing anything (`SessaoGP.exigirArea`, `public/js/sessao.js` → `GET /api/auth/me`): no session or no perfil → `/login?para=admin|conferente` (fixed values, never a free URL); a conferente on `/admin` → `/conferente` (achado #97); 503/network → "tente de novo". The HTML is only the shell: **every piece of data goes through the API, and every non-public API route requires `requireAdmin`** — `test/rotas-protegidas.test.js` reads the routers and fails if a new route forgets it. Page routes also clear leftover `gp_auth`/`gp_csrf` cookies from the old session model.

**Routes:**
- `routes/auth.js` — only `GET /api/auth/me` (`{ id, email, username, role }`, role read from `public.perfis` right now). There is no login, SSO bridge or logout route anymore.
- `routes/products.js` — full CRUD for products, image upload/management (file, URL, or automatic web search), reports
- `routes/documents.js` — PDF upload and fiscal/gerencial import

**Health check:** `GET /api/health` — queries `COUNT(*) FROM products` and returns `{ ok, products }`.

**Database:** `db/schema.js` exports `getDb()` which returns a `pg.Pool` connected to Supabase via `DATABASE_URL`. The pool sets `search_path` and `timezone = 'America/Sao_Paulo'` on every new connection. All queries use this direct connection — RLS is bypassed entirely (access control is enforced at login). Schema (in Supabase): `products`, `product_images`, `product_audit`, `uploaded_documents`, `import_history`. Schema changes go in `app/db/migrations/` (with a `_ROLLBACK.sql`), applied by hand at deploy.

**Name search:** `products.search_vector_name` is a generated tsvector (unaccented, punctuation → space, `'simple'` config, GIN index). `ftsPrefixQuery` in `routes/products.js` must mirror that normalization and queries with `to_tsquery('simple', ...)`. The Estoque system reads the same column, so changing it changes both searches.

**Business rule — stock update (`PUT /api/products/:id`):**
- `stock_fiscal` and `price_fiscal` are read-only; they are never changed by this app.
- `applyStockRule(real, currentMgmt, currentAlert)` in `routes/products.js`: real < 0 → error; real = 0 → mgmt = 0, `fiscal_alert = 1`; real > 0 → mgmt = real, `fiscal_alert = 0`.
- Every write that changes any field upserts a single row in `product_audit` (one row per product, overwritten on each change).

**Images:** Products support up to 4 images each, stored in `product_images` with two flags:
- `is_pinned` — exactly one image per product is pinned (shown first). When the pinned image is deleted, the next oldest becomes pinned automatically.
- `is_manual` — `1` for images added by a user (file upload or URL), `0` for images found by automatic web search.

Image sources (in priority order when a product has no images):
1. **File upload** — multipart POST, stored under `UPLOAD_DIR/product-images/`, served at `/uploads/product-images/`.
2. **URL** — stored directly in `product_images`.
3. **Automatic web search** — `lib/image-search.js` queries Bing (free, no key) or Google Custom Search API (if `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` are set). Auto-searched images use `is_manual=0` and are replaced on the next search; manually added images (`is_manual=1`) are never deleted by search.

SVG category icons live in `svg/` and are served at `/svg/`. The frontend picks one based on product name keywords (`public/js/product-category-svg.js`).

**Lib modules:**
- `lib/cache.js` — singleton in-memory TTL cache (used to avoid redundant DB/search calls)
- `lib/image-search.js` — image search via Bing scraping or Google CSE; `searchAndSaveImages(product)` saves results to `product_images` respecting the 4-image cap
- `lib/categories.js` — `classifyProduct(name)` returns a category label by matching name against regex rules (used for SVG selection and classification)

**Scripts (run directly with node, not part of the server):**
- `scripts/crawl-images.js` — bulk image crawler: finds images for products with no images; use `--limit`, `--offset`, `--ean-only`, `--delay` flags
- `scripts/import-ean.js` — reads `export.htm` (Simples Varejo export) and fills `ean` column in `products`

**Frontend pages** (all vanilla JS, no framework):
- `public/index.html` — public product catalog
- `public/admin.html` — admin dashboard (product management, reports, image management); requires `admin` role
- `public/conferente.html` — stock checker view; requires any authenticated user
- `public/login.html` — página de passagem (no password form in production): with a Central session it checks `/api/auth/me` and goes to `?para=`; otherwise "Entre pela Central" / "Sem acesso". The `<!--login-local-->` block (password form) is stripped by the server unless `LOGIN_LOCAL=1`

**Frontend JS modules** (`public/js/`), loaded by every page in this order:
- `vendor/supabase-2.103.2.min.js` — official UMD build of `@supabase/supabase-js` 2.103.2 (taken from the npm package on 08/10/2026; same version as the Financeiro). Served locally, no CDN.
- `sessao-catalogo.js` — session decisions with no DOM/network (which button, `decidirPagina`, where to go, which screen), tested in `test/sessao-catalogo.test.js`
- `sessao.js` — `window.SessaoGP`: the supabase-js client on `gp_session` (reads and refreshes the shared session), `apiFetch` (Bearer token; on 401 retries with a newer token — one another call/tab already got, or a single shared refresh), `quemSou` (never throws: errors → status 0), `exigirArea`, `aoMudarConta` (Sair at the Central, or another account in another tab → callback; ignores the SIGNED_IN supabase-js fires on tab focus), `entrarComSenha` (local only). Reads the Supabase URL and anon key from `data-supabase-url` / `data-supabase-anon`, injected by `app.js`. Tested in Node with fakes in `test/sessao-navegador.test.js`.
- `/admin` and `/conferente` start hidden by their own CSS (`html:not([data-sessao]) body { visibility: hidden }` at the top of `style.admin.css` / `style.conferente.css`), so the shell never flashes; `exigirArea` sets `data-sessao` once the check is done (or to show the "tente de novo" screen).
- `product-category-svg.js` — maps product name keywords to SVG filenames in `/svg/`
- `admin.js`, `conferente.js`, `index.js`, `login.js` — page-specific logic; every API call goes through `SessaoGP.apiFetch`

**Design system (`public/css/tokens.css`)**: tokens compartilhados Gato Preto, linkados em cada HTML antes do CSS específico da página (`style.index.css`, `style.admin.css`, `style.conferente.css`, `style.login.css`). Os 4 arquivos tinham cada um seu próprio `:root` — `style.login.css` usava o template antigo (cor de marca `#7dd33c`, já corrigida) e os outros 3 usavam uma paleta neutra mais "quente" (`#f5f5f5`/`#1a1814`), que foi unificada com a paleta cinza compartilhada por decisão explícita (antes era `#f5f5f5`/`#1a1814`/`#e8e6e1` etc., visual do catálogo mudou para bater com os outros 5 sistemas). Cores semânticas específicas do catálogo (`--green`, `--red`, `--amber`, `--col-fiscal`, `--col-mgmt`, `--col-real`, `--accent-dark`, `--safe-bottom`/`--safe-top`) continuam locais, sem equivalente na paleta compartilhada.

## Authentication

**Sem login próprio (desde 02/10/2026) e sem sessão própria (desde 08/10/2026, ADR 0010):** a entrada é só pela Central (login único), e o Catálogo usa a **mesma sessão** dos outros sistemas — a `gp_session` que a Central grava no localStorage (mesma origem em produção). Não há formulário de senha, botão "Sair", cookie de sessão, CSRF nem JWT próprio. Plano e decisões D1–D5: `C:\dev\Auditoria\PLANO_CATALOGO_SESSAO_PADRAO.md`.

**Navegador (`public/js/sessao.js`):** o supabase-js lê a `gp_session` e a **renova sozinho** (coordenando as abas pelo `navigator.locks`, como nos outros sistemas — acabou a limitação de ~1h sem renovação). Toda chamada à API leva `Authorization: Bearer <access_token>`; num 401, `apiFetch` renova a sessão uma vez e tenta de novo. O papel nunca fica guardado no navegador: cada página pergunta `GET /api/auth/me`.

- **Página pública (`/`):** aberta a qualquer um. Visitante sem sessão vê só o catálogo, sem botão nenhum e sem nenhuma chamada de sessão. Com sessão, `iniciarSessao` (`index.js`) chama `/api/auth/me` e mostra **Painel admin** (admin) ou **Conferente** (user). Sair pela Central (em qualquer aba) tira o botão na hora (`SIGNED_OUT`).
- **`/admin` e `/conferente`:** `SessaoGP.exigirArea` confere antes de mostrar (ver "Page routes" acima). Sair pela Central volta para a passagem.
- **`/login` (passagem):** com sessão e perfil, segue para `?para=`; sem sessão, "Entre pela Central"; sem perfil, "Sem acesso"; 503/rede, "tente de novo".

**Servidor (`middleware/auth.js`, padrão ADR 0010 em Node):**
- `validarToken`: assinatura pelo JWKS do Supabase com a biblioteca `jose` (chave pelo `kid`; algoritmos aceitos só `ES256`/`RS256`, e o `alg` do token tem de casar com o tipo da chave — sem HS256, sem segredo compartilhado). Exige `exp`, `sub` (UUID) e `aud = authenticated`, com 30 s de tolerância de relógio. JWKS em memória com `cacheMaxAge: Infinity` (com o padrão de 10 min a jose relê até para chave conhecida, e uma falha nessa releitura viraria 503 para todo mundo); `kid` desconhecido força releitura, no máximo 1 a cada 30 s; leituras simultâneas viram uma só. Depois de uma leitura que **falhou** não há espera antes da próxima (diferente do `auth_jwks.py`, que espera 5 s) — aceito: só quem traz `kid` desconhecido dispara leitura.
- `lerPapel`: `public.perfis` (`sistema = 'CatalogoProdutos'`) **a cada chamada, com o token do próprio usuário** (anon key + Bearer; policy `perfis_self_read`). Tirar o acesso na Central corta na próxima chamada (antes, o papel ficava dentro do cookie de 12h).
- Respostas: **401** sem token, token inválido/vencido ou `perfis` recusando o token · **403** sem perfil (`authenticate`) ou não admin (`requireAdmin`) · **503** JWKS ou `perfis` sem resposta / em formato inesperado · 500 só para erro inesperado (logado).
- `req.user = { id, email, username, role }`; `username` é o e-mail (é o que `routes/documents.js` grava no histórico de importação).
- O token continua aceito até vencer mesmo depois do "Sair" na Central (decisão de 07/10/2026, igual aos outros sistemas).

**Rate limit:** o limite geral (`mutationLimiter`, 100/min) roda antes da autenticação das rotas, então só usa o `sub` como chave **depois de conferir a assinatura** (`validarToken`); sem token válido, a chave é o IP. Um token forjado com o `sub` de outra pessoa não gasta o limite dela (`test/limite.test.js`).

**Tamanho da sessão:** vem só do Supabase Auth (`[auth.sessions]`, compartilhado pelos 6 sistemas) — achado #46, decidido em 01/09/2026 como `timebox=24h` / `inactivity_timeout=8h`. **Não assuma que está valendo:** em 11/09/2026 nenhuma sessão tinha `not_after`. Conferir antes (`select count(*) filter (where not_after is not null) from auth.sessions`) e ver `C:\dev\Auditoria\PENDENCIAS.md`.

**Restos da sessão antiga (até 08/10/2026):** cookie `gp_auth` (JWT HS256 de 12h com o papel dentro, assinado com `JWT_SECRET`, janela deslizante), `gp_csrf`, tabela `revoked_tokens`, rotas `/api/auth/sso`, `/logout`, `/login`, e `gp_user` no localStorage. O código não usa mais nada disso; as páginas apagam os cookies e o `sessao.js` apaga o `gp_user` que sobraram no navegador. **A tabela `revoked_tokens` e o `JWT_SECRET` no `.env` do servidor continuam lá de propósito** até o modelo novo estar estável em produção (decisão D4: permite voltar o código sem mexer no banco); depois saem numa migration própria, com `_ROLLBACK.sql`.

### User management

Access to this system is managed **exclusively via the GestaoSistemas portal**, which writes to `public.perfis(user_id, sistema, role)`. That includes creating users, granting and revoking access, and changing roles. This system only *reads* `perfis` — on **every** API call, with the user's own token (see Authentication) — and has no user-management screen or endpoint of its own. Removing someone's access in the portal takes effect on their next call here.

This was not always the case: `routes/users.js` used to let admins list users and change roles from inside the Catálogo. It was removed (tarefa 6.2 of `C:\dev\Auditoria\PLANO_ACAO_RBAC.md`) because it was a second write path into `public.perfis` — the table that controls access across all six systems — with its own copy of the valid-role list, which had already drifted from the central catalog `public.sistema_roles`.

The roles this system recognises are `admin` and `user` (shown as "Conferente" in the portal's role selector, per `sistema_roles.label`).

### RLS

All database queries go through `pg.Pool` with `DATABASE_URL` (direct PostgreSQL connection), which bypasses Supabase RLS. Access control is enforced in the API, on every call (`middleware/auth.js`: token signature + `public.perfis`). The tables do have RLS policies (using `has_system_access`, see README), but this backend never goes through them.

## Deployment (absam.io)

The project runs on a server at **absam.io** behind an Nginx reverse proxy. `entrypoint.sh` runs `node server.js`. Database is hosted on Supabase — no local DB files needed.

When deployed behind a path prefix (e.g. `/catalogo_produtos`), set `BASE_PATH=/catalogo_produtos`. Nginx strips the prefix before forwarding to Express; the app uses `BASE_PATH` only to inject `window.APP_BASE` into HTML for client-side routing.

## Environment Variables

See `app/.env.example` for the full list. Required:
- `DATABASE_URL` — Supabase PostgreSQL connection string (transaction pooler)
- `SUPABASE_URL` — Supabase project URL (JWKS for token checks, `/rest/v1/perfis`; also sent to the browser for supabase-js)
- `SUPABASE_ANON_KEY` — Supabase anon key: reads `perfis` with the user's token and goes to the browser (it is public)

`JWT_SECRET` is **no longer used** (08/10/2026). It stays in the server's `.env` only until the cleanup step (see "Restos da sessão antiga").

Optional:
- `NODE_ENV=production` — hides the stack trace on Express's error page and blocks `LOGIN_LOCAL`; set in production (comes from `ecosystem.config.js`)
- `BASE_PATH` — path prefix when deployed behind a reverse proxy (e.g. `/catalogo_produtos`)
- `UPLOAD_DIR` — absolute path for file uploads (default: `app/uploads/`); directory is created automatically if missing
- `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` — enables Google Custom Search for automatic image lookup (falls back to Bing scraping if not set)
- `PORT` — HTTP port (default: `3001`)
