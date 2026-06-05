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
```

There is no test suite and no linter configured.

## Architecture

Single-process Express app backed by **PostgreSQL via Supabase** (`pg` pool). All code lives under `app/`.

**Entry point:** `server.js` — mounts route groups, injects `window.APP_BASE` into HTML for reverse-proxy path-prefix support, and serves static HTML files with SPA fallbacks (`/admin*`, `/conferente*`, `/*`). Pre-renders all HTML at startup (not per-request).

**Routes:**
- `routes/auth.js` — `POST /api/auth/login` (Supabase Auth + `public.perfis` gate + local JWT), `POST /api/auth/logout`, `GET /api/auth/me`
- `routes/products.js` — full CRUD for products, image upload/management (file, URL, or automatic web search), reports
- `routes/documents.js` — PDF upload and fiscal/gerencial import
- `routes/users.js` — `GET /api/users` (list users with access to this system), `PATCH /api/users/:userId/role` (change role); both require admin

**Health check:** `GET /api/health` — queries `COUNT(*) FROM products` and returns `{ ok, products }`.

**Database:** `db/schema.js` exports `getDb()` which returns a `pg.Pool` connected to Supabase via `DATABASE_URL`. The pool sets `search_path` and `timezone = 'America/Sao_Paulo'` on every new connection. All queries use this direct connection — RLS is bypassed entirely (access control is enforced at login). Schema (in Supabase): `products`, `product_images`, `product_audit`, `uploaded_documents`, `import_history`.

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
- `public/admin.html` — admin dashboard (product management, reports, image management, user role management); requires `admin` role
- `public/conferente.html` — stock checker view; requires any authenticated user
- `public/login.html` — login form

**Frontend JS modules** (`public/js/`):
- `session.js` — client-side idle timeout: 1 hour of no interaction triggers logout (tracks activity via DOM events, checks every 60 s). Call `window._sessionInit(onExpire)` from each authenticated page.
- `product-category-svg.js` — maps product name keywords to SVG filenames in `/svg/`
- `admin.js`, `conferente.js`, `index.js`, `login.js` — page-specific logic

## Authentication

Login is a two-step server-side flow in `routes/auth.js`:

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

**Client-side idle timeout:** `public/js/session.js` logs out the user after 1 hour of inactivity (no clicks, keystrokes, etc.), independent of the server-side cookie expiry.

**Logout:** `POST /api/auth/logout` clears the cookie server-side. The frontend also removes `gp_user` from localStorage.

**Cookie config:** `httpOnly: true`, `sameSite: 'lax'`, `maxAge: 12h`. `secure: true` when `NODE_ENV=production` (set this in production for HTTPS-only delivery).

`middleware/auth.js` exports `authenticate` (any valid cookie JWT) and `requireAdmin` (role must be `'admin'`). `JWT_SECRET` **must** be set as an env var — the server throws at startup if missing.

**Frontend state:** `gp_user` (JSON) is kept in localStorage for display (username, role check before first API call). It is cleared on logout. There is no `gp_token` in localStorage.

### User management

Users are **created** and **deleted** exclusively via the **GestaoSistemas portal**, which writes to `public.perfis(user_id, sistema, role)`. This system's `routes/users.js` allows admins to **list** users and **change roles** (`admin` ↔ `conferente`), but not to create or remove access.

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
