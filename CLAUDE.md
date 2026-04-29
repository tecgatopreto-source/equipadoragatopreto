# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `routes/auth.js` — `POST /api/auth/login` (delegates to Supabase Auth, then issues a local JWT) and `GET /api/auth/me`
- `routes/products.js` — full CRUD for products, manual image upload/management, reports
- `routes/documents.js` — PDF upload and fiscal/gerencial import

**Database:** `db/schema.js` exports `getDb()` which returns a `pg.Pool` connected to Supabase via `DATABASE_URL`. The pool sets `search_path` and `timezone = 'America/Sao_Paulo'` on every new connection. Schema (in Supabase): `users`, `products`, `product_images`, `product_audit`, `uploaded_documents`, `import_history`.

**Auth:** `middleware/auth.js` exports `authenticate` (any valid JWT) and `requireAdmin` (role must be `'admin'`). `JWT_SECRET` **must** be set as an env var — the server throws at startup if missing. Tokens expire in 12 h. Login goes through Supabase Auth (`/auth/v1/token`) and a short-lived local JWT is issued for API calls.

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

## Deployment (Railway)

`app/railway.toml` sets `startCommand = "sh entrypoint.sh"`.

`entrypoint.sh` runs `node server.js`. Database is hosted on Supabase — no local DB files needed.

## Environment Variables

See `app/.env.example` for the full list. Required:
- `DATABASE_URL` — Supabase PostgreSQL connection string (transaction pooler)
- `JWT_SECRET` — min 48 chars hex; server crashes at startup if missing
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon key (used for Supabase Auth)
