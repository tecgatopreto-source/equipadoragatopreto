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

# Seed database (creates admin user + imports products from HTML catalog)
npm run seed

# Batch-fetch images for products without images
node batch_images.js [quantity] [offset]
# Example: node batch_images.js 100 0
```

There is no test suite and no linter configured.

## Architecture

Single-process Express app backed by a SQLite database (`better-sqlite3`). All code lives under `app/`.

**Entry point:** `server.js` — mounts two route groups and serves static HTML files with SPA fallbacks (`/admin*`, `/conferente*`, `/*`).

**Routes:**
- `routes/auth.js` — `POST /api/auth/login` (JWT issue) and `GET /api/auth/me`
- `routes/products.js` — full CRUD for products, images, reports, and image search

**Database:** `db/schema.js` exports a singleton `getDb()` that lazily opens the SQLite file, runs `initSchema`, and applies additive column migrations via try/catch. Tables: `users`, `products`, `product_images`, `product_audit`.

**Auth:** `middleware/auth.js` exports `authenticate` (any valid JWT) and `requireAdmin` (role must be `'admin'`). `JWT_SECRET` defaults to a hardcoded string — set the `JWT_SECRET` environment variable in production. Tokens expire in 12 h.

**Business rule — stock update (`PUT /api/products/:id`):**
- `stock_fiscal` and `price_fiscal` are read-only; they are never changed by this app.
- `applyStockRule(real, currentMgmt, currentAlert)` in `routes/products.js`: real < 0 → error; real = 0 → mgmt = 0, `fiscal_alert = 1`; real > 0 → mgmt = real, `fiscal_alert = 0`.
- Every write that changes any field upserts a single row in `product_audit` (one row per product, overwritten on each change).

**Image search:** `routes/products.js` searches DuckDuckGo (primary, returns Bing CDN thumbnails) with a Google/allorigins proxy fallback. Images are cached in `product_images` on first fetch; subsequent calls return the cached rows. `batch_images.js` is a standalone script that runs the same logic in bulk with a 1200 ms inter-request delay.

**Frontend pages** (all vanilla JS, no framework):
- `public/index.html` — public product catalog
- `public/admin.html` — admin dashboard (product management, reports, image management); requires `admin` role
- `public/conferente.html` — stock checker view; requires any authenticated user
- `public/login.html` — login form

## Deployment (Railway)

`app/railway.toml` sets `startCommand = "sh entrypoint.sh"`.

`entrypoint.sh` manages the database volume: if `/data/gatopreto.db` does not exist it copies `db_seed/gatopreto.db` there, then symlinks `/data/gatopreto.db` to `db/gatopreto.db` (the path `schema.js` hardcodes), then runs `node server.js`.

The seed database at `app/db_seed/gatopreto.db` is the pre-populated DB committed to the repo for initial Railway deploys. `seed.js` is only used locally — it reads a base64+gzip JSON payload embedded in `catalogo_gato_preto_v10.html` (not committed) to import products and creates an `admin` / `admin123` user.
