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

No linter configured. **Tests never touch Supabase nor the database** (there is no dev database: local = production): `test/apoio/app-de-teste.js` starts the app on a free port with a fake Supabase (local HTTP server answering `/auth/v1/user`, `/auth/v1/token`, `/rest/v1/perfis`) and swaps `db/schema` for an in-memory fake before `app.js` loads. Each test file runs in its own process.

**Local login:** in production the only way in is the Central (single sign-on). Locally the Central runs on another port (another origin) and can't share `gp_session`, so put `LOGIN_LOCAL=1` in `app/.env` to get the password form on `/login` (see `config.js`; the server refuses to start with `LOGIN_LOCAL=1` and `NODE_ENV=production`).

## Architecture

Single-process Express app backed by **PostgreSQL via Supabase** (`pg` pool). All code lives under `app/`.

**Entry point:** `server.js` loads `.env`, opens the DB pool and listens. The app itself is built in `app.js` — mounts route groups, injects `window.APP_BASE` into HTML for reverse-proxy path-prefix support, and serves static HTML files with SPA fallbacks (`/admin*`, `/conferente*`, `/*`). Pre-renders all HTML at startup (not per-request). The split exists so tests can load the app without a real DB.

The page routes have their own guards, separate from the API middleware because the response differs (a page redirects, an API returns 401): `requireAuthPage(para)` needs a valid, non-revoked `gp_auth` cookie and otherwise redirects to `/login?para=admin|conferente` (fixed values set in the server, never a free URL), and `requireAdminPage` additionally needs `role === 'admin'`, sending anyone else to `/conferente`. Both mirror `authenticate` from `middleware/auth.js`, including the revocation check — see achado #97.

**Routes:**
- `routes/auth.js` — `POST /api/auth/sso` (single sign-on: Central token + `public.perfis` gate + local JWT; the only way in in production), `POST /api/auth/logout` (revokes only this system's cookie), `GET /api/auth/me`; `POST /api/auth/login` (password) exists **only with `LOGIN_LOCAL=1`**
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
- `public/login.html` — página de passagem (no password form in production): with a Central session it trades the token for the cookie and goes to `?para=`; otherwise "Entre pela Central" / "Sem acesso". The `<!--login-local-->` block (password form) is stripped by the server unless `LOGIN_LOCAL=1`

**Frontend JS modules** (`public/js/`):
- `product-category-svg.js` — maps product name keywords to SVG filenames in `/svg/`
- `admin.js`, `conferente.js`, `index.js`, `login.js` — page-specific logic
- `sessao-catalogo.js` — session decisions with no DOM/network (which button, where to go, which screen), loaded before `index.js`/`login.js` and tested in `test/sessao-catalogo.test.js`

**Design system (`public/css/tokens.css`)**: tokens compartilhados Gato Preto, linkados em cada HTML antes do CSS específico da página (`style.index.css`, `style.admin.css`, `style.conferente.css`, `style.login.css`). Os 4 arquivos tinham cada um seu próprio `:root` — `style.login.css` usava o template antigo (cor de marca `#7dd33c`, já corrigida) e os outros 3 usavam uma paleta neutra mais "quente" (`#f5f5f5`/`#1a1814`), que foi unificada com a paleta cinza compartilhada por decisão explícita (antes era `#f5f5f5`/`#1a1814`/`#e8e6e1` etc., visual do catálogo mudou para bater com os outros 5 sistemas). Cores semânticas específicas do catálogo (`--green`, `--red`, `--amber`, `--col-fiscal`, `--col-mgmt`, `--col-real`, `--accent-dark`, `--safe-bottom`/`--safe-top`) continuam locais, sem equivalente na paleta compartilhada.

## Authentication

**Sem login próprio (desde 02/10/2026):** a entrada é só pela Central (login único), como no Estoque. Não há formulário de senha nem botão "Sair" — sai-se pela Central.

- **Página pública (`/`):** aberta a qualquer um. Visitante sem sessão da Central vê só o catálogo, sem botão nenhum (e não faz nenhuma chamada de sessão). Com sessão da Central, `index.js` (`iniciarSessao`) confere em silêncio: primeiro `GET /api/auth/me` (o cookie daqui); só se faltar ou for de outra conta chama `POST /api/auth/sso`. Mostra **Painel admin** (admin) ou **Conferente** (user). Se a sessão da Central sumiu ou é de outra conta, chama `/api/auth/logout` para o cookie de 12h daqui não continuar valendo sozinho.
- **`/admin` e `/conferente` sem cookie:** vão para `/login?para=…`, a página de passagem (ver Frontend pages).
- **`/api/auth/sso`** recebe `{ access_token }` (da sessão Supabase compartilhada `gp_session` que a Central grava no localStorage — mesma origem em produção), valida via `GET /auth/v1/user`, aplica o gate de `perfis` e emite o cookie `gp_auth`. Limite próprio (`ssoLimiter`: 30 por 15 min por IP) — a página pública chama a ponte sozinha, e o limite do login por senha (5 em 15 min) travaria uma loja inteira atrás do mesmo IP.
- **Limitação conhecida:** o Catálogo não tem supabase-js no navegador, então não renova o `access_token` do `gp_session` (vale ~1h). Se ninguém abriu a Central (ou outro sistema com supabase-js) nesse tempo, a ponte recusa o token vencido e a pessoa vê "Entre pela Central"; ao abrir a Central o token é renovado.

The local password login (`LOGIN_LOCAL=1` only, `POST /api/auth/login`) is a two-step server-side flow in `routes/auth.js`:

1. **Supabase Auth** — `POST /auth/v1/token?grant_type=password` validates credentials and returns an `access_token`.
2. **Access gate** — query `public.perfis` (the central access-control table shared across all systems):
   ```
   SELECT role FROM public.perfis
   WHERE user_id = <auth.uid()> AND sistema = 'CatalogoProdutos'
   ```
   If no row is found, the Supabase session is invalidated and `401 no_access` is returned.
3. **Local JWT** — if access is granted, the server issues its own JWT (expires 12 h) containing `{ id, username, role }`. The `role` comes from `public.perfis`, not from Supabase `app_metadata`. Valid roles: `admin`, `conferente`.

**Session storage:** The JWT is stored in an **HttpOnly cookie** (`gp_auth`), not in localStorage. The token is never exposed to JavaScript. The response body on login returns only `{ user }` (no token).

**Sliding expiration:** `middleware/auth.js` re-issues the cookie on every authenticated request, resetting the 12 h window. Users are logged out if they make no API request for 12 consecutive hours.

**Inactivity/session-length limits:** this system's own 12h sliding window (above) is the only one actually enforcing anything. There used to be a `public/js/session.js` client-side 1h idle timer here, but it was never wired up to any page (`window._sessionInit` was never called) and was removed as dead code.

The plan was for session length to come from the Supabase Auth level (`[auth.sessions]`, shared by all 6 Gato Preto systems) — achado #46, decided on 01/09/2026 as `timebox=24h` / `inactivity_timeout=8h`. **Do not assume it is in force:** on 11/09/2026 `auth.sessions` had 9 live sessions, the oldest 358h old and one idle for 215h, with `not_after` null on all of them — i.e. no timebox was applied. Verify before relying on it (`select count(*) filter (where not_after is not null) from auth.sessions`), and see `C:\dev\Auditoria\PENDENCIAS.md`.

Note this system is unaffected either way for its own pages: access here is gated by the local `gp_auth` JWT, not by the Supabase session. The Supabase session only matters for the SSO bridge at login.

**Logout:** no "Sair" button anymore. `POST /api/auth/logout` revokes and clears only this system's cookie (it no longer signs out of the Supabase session — that belongs to the Central); the public page calls it when the Central session is gone.

**Cookie config:** `httpOnly: true`, `sameSite: 'lax'`, `maxAge: 12h`. `secure: true` when `NODE_ENV=production` (set this in production for HTTPS-only delivery).

`middleware/auth.js` exports `authenticate` (any valid cookie JWT) and `requireAdmin` (role must be `'admin'`) for API routes, plus `isRevoked`, which `app.js` reuses for the page guards so the revocation check is not reimplemented there. `JWT_SECRET` **must** be set as an env var — the server throws at startup if missing.

**Frontend state:** `gp_user` (JSON) is kept in localStorage for display (username, role check before first API call). It is cleared on logout. There is no `gp_token` in localStorage.

### User management

Access to this system is managed **exclusively via the GestaoSistemas portal**, which writes to `public.perfis(user_id, sistema, role)`. That includes creating users, granting and revoking access, and changing roles. This system only *reads* `perfis` at login — it has no user-management screen or endpoint of its own.

This was not always the case: `routes/users.js` used to let admins list users and change roles from inside the Catálogo. It was removed (tarefa 6.2 of `C:\dev\Auditoria\PLANO_ACAO_RBAC.md`) because it was a second write path into `public.perfis` — the table that controls access across all six systems — with its own copy of the valid-role list, which had already drifted from the central catalog `public.sistema_roles`.

The roles this system recognises are `admin` and `user` (shown as "Conferente" in the portal's role selector, per `sistema_roles.label`).

### RLS

All database queries go through `pg.Pool` with `DATABASE_URL` (direct PostgreSQL connection), which bypasses Supabase RLS. Access control is enforced entirely at login via `public.perfis`. There are no RLS policies to maintain on this system's tables.

## Deployment (absam.io)

The project runs on a server at **absam.io** behind an Nginx reverse proxy. `entrypoint.sh` runs `node server.js`. Database is hosted on Supabase — no local DB files needed.

When deployed behind a path prefix (e.g. `/catalogo_produtos`), set `BASE_PATH=/catalogo_produtos`. Nginx strips the prefix before forwarding to Express; the app uses `BASE_PATH` only to inject `window.APP_BASE` into HTML for client-side routing.

## Environment Variables

See `app/.env.example` for the full list. Required:
- `DATABASE_URL` — Supabase PostgreSQL connection string (transaction pooler)
- `JWT_SECRET` — min 48 chars hex; server crashes at startup if missing
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon key (used only for Supabase Auth during login)

Optional:
- `NODE_ENV=production` — enables `Secure` flag on the session cookie (HTTPS-only); set in production
- `BASE_PATH` — path prefix when deployed behind a reverse proxy (e.g. `/catalogo_produtos`)
- `UPLOAD_DIR` — absolute path for file uploads (default: `app/uploads/`); directory is created automatically if missing
- `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` — enables Google Custom Search for automatic image lookup (falls back to Bing scraping if not set)
- `PORT` — HTTP port (default: `3001`)
