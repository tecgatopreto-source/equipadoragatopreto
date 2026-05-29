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

**Entry point:** `server.js` — mounts route groups and serves static HTML files with SPA fallbacks (`/admin*`, `/conferente*`, `/*`).

**Routes:**
- `routes/auth.js` — `POST /api/auth/login` (Supabase Auth + `public.perfis` gate + local JWT) and `GET /api/auth/me`
- `routes/products.js` — full CRUD for products, manual image upload/management, reports
- `routes/documents.js` — PDF upload and fiscal/gerencial import

**Database:** `db/schema.js` exports `getDb()` which returns a `pg.Pool` connected to Supabase via `DATABASE_URL`. The pool sets `search_path` and `timezone = 'America/Sao_Paulo'` on every new connection. All queries use this direct connection — RLS is bypassed entirely (access control is enforced at login). Schema (in Supabase): `products`, `product_images`, `product_audit`, `uploaded_documents`, `import_history`.

**Business rule — stock update (`PUT /api/products/:id`):**
- `stock_fiscal` and `price_fiscal` are read-only; they are never changed by this app.
- `applyStockRule(real, currentMgmt, currentAlert)` in `routes/products.js`: real < 0 → error; real = 0 → mgmt = 0, `fiscal_alert = 1`; real > 0 → mgmt = real, `fiscal_alert = 0`.
- Every write that changes any field upserts a single row in `product_audit` (one row per product, overwritten on each change).

**Images:** Manual upload only (file or URL). No external image search. Products without images display an SVG placeholder based on category keywords in the name (`public/js/product-category-svg.js`).

**Frontend pages** (all vanilla JS, no framework):
- `public/index.html` — public product catalog
- `public/admin.html` — admin dashboard (product management, reports, image management); requires `admin` role
- `public/conferente.html` — stock checker view; requires any authenticated user
- `public/login.html` — login form

## Authentication

Login is a two-step server-side flow in `routes/auth.js`:

1. **Supabase Auth** — `POST /auth/v1/token?grant_type=password` validates credentials and returns an `access_token`.
2. **Access gate** — query `public.perfis` (the central access-control table shared across all systems):
   ```
   SELECT role FROM public.perfis
   WHERE user_id = <auth.uid()> AND sistema = 'CatalogoProdutos'
   ```
   If no row is found, the Supabase session is invalidated and `401 no_access` is returned.
3. **Local JWT** — if access is granted, the server issues its own JWT (expires 12 h) containing `{ id, username, role }`. The `role` comes from `public.perfis`, not from Supabase `app_metadata`.

`middleware/auth.js` exports `authenticate` (any valid JWT) and `requireAdmin` (role must be `'admin'`). `JWT_SECRET` **must** be set as an env var — the server throws at startup if missing.

### User management

Users are created and have their system access managed exclusively via the **GestaoSistemas portal**. Do not create or manage users directly in this system. The portal writes to `public.perfis(user_id, sistema, role)` in Supabase to grant/revoke access.

### RLS

All database queries go through `pg.Pool` with `DATABASE_URL` (direct PostgreSQL connection), which bypasses Supabase RLS. Access control is enforced entirely at login via `public.perfis`. There are no RLS policies to maintain on this system's tables.

## Deployment (absam.io)

The project runs on a server at **absam.io**. `entrypoint.sh` runs `node server.js`. Database is hosted on Supabase — no local DB files needed.

## Environment Variables

See `app/.env.example` for the full list. Required:
- `DATABASE_URL` — Supabase PostgreSQL connection string (transaction pooler)
- `JWT_SECRET` — min 48 chars hex; server crashes at startup if missing
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon key (used only for Supabase Auth during login)
