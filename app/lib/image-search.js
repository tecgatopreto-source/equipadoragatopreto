const https = require('https');
const zlib  = require('zlib');
const { getDb } = require('../db/schema');

// ── HTTP helper ──────────────────────────────────────────────────────────────
function httpGet(url, extraHeaders = {}, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 5) return resolve('');
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        ...extraHeaders,
      },
    };
    const req = https.get(url, opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(httpGet(loc, extraHeaders, redirects + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'] || '';
        const decode = (b) => resolve(b.toString('utf8'));
        if (enc === 'br')      zlib.brotliDecompress(buf, (e, d) => e ? resolve('') : decode(d));
        else if (enc === 'gzip')    zlib.gunzip(buf,  (e, d) => e ? resolve('') : decode(d));
        else if (enc === 'deflate') zlib.inflate(buf, (e, d) => e ? resolve('') : decode(d));
        else decode(buf);
      });
    });
    req.setTimeout(18000, () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
  });
}

// ── Google Custom Search API (opcional — requer chaves no .env) ──────────────
async function googleApiSearch(query) {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx  = process.env.GOOGLE_SEARCH_CX;
  if (!key || !cx) return null;
  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${encodeURIComponent(key)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&searchType=image&num=8&safe=off` +
    `&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.items || []).map(item => item.link);
  } catch { return null; }
}

// ── Bing Images (gratuito, sem chave) ────────────────────────────────────────
async function bingSearch(query) {
  try {
    const q   = encodeURIComponent(query);
    const url = `https://www.bing.com/images/async?q=${q}&first=0&count=8&relp=8&mmasync=1&adlt=off`;
    const html = await httpGet(url, {
      'Referer': `https://www.bing.com/images/search?q=${q}`,
      'X-Requested-With': 'XMLHttpRequest',
    });
    const found = [];
    // Tenta JSON puro (formato atual) e HTML-encoded (formato legado) em sequência
    const patterns = [
      /"murl":"(https?:\/\/[^"\\]+)"/g,
      /&quot;murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(html)) !== null && found.length < 8) found.push(m[1]);
      if (found.length >= 3) break;
    }
    return found;
  } catch { return []; }
}

// ── Busca combinada ──────────────────────────────────────────────────────────
// Prioridade: Google API (se configurada) → Bing
async function searchImages(query) {
  const apiResults = await googleApiSearch(query);
  if (apiResults && apiResults.length >= 3) return apiResults;

  return bingSearch(query);
}

// ── Monta query de busca para um produto ─────────────────────────────────────
// Remove prefixos internos do nome antes de buscar (ex: "D50 ", "50 ")
function _cleanProductName(name) {
  return name
    .replace(/^D?\d+\s+/i, '')        // Remove "D50 ", "50 ", "D10 " do início
    .replace(/[*().]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

// Sempre busca por nome limpo + "autopeça" — EAN não funciona em buscadores de imagem
function buildQuery(product) {
  return _cleanProductName(product.name) + ' autopeça';
}

// ── Busca e salva automaticamente no banco ───────────────────────────────────
// product: { id, name }
// Retorna rows salvas em product_images.
async function searchAndSaveImages(product) {
  const urls = await searchImages(buildQuery(product));

  if (!urls.length) return [];

  const pool = getDb();
  await pool.query('DELETE FROM product_images WHERE product_id=$1 AND is_manual=0', [product.id]);

  const { rows: remaining } = await pool.query(
    'SELECT COUNT(*) FROM product_images WHERE product_id=$1', [product.id]
  );
  const slots = 4 - parseInt(remaining[0].count);
  if (slots <= 0) return [];

  const limited = urls.slice(0, slots);
  await pool.query('UPDATE product_images SET is_pinned=0 WHERE product_id=$1', [product.id]);

  // Batch INSERT — uma query para todas as imagens
  const placeholders = limited.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}, 0)`).join(', ');
  const params = [product.id, ...limited.flatMap((url, i) => [url, i === 0 ? 1 : 0])];
  try {
    const r = await pool.query(
      `INSERT INTO product_images (product_id, url, is_pinned, is_manual)
       VALUES ${placeholders} ON CONFLICT DO NOTHING
       RETURNING id, product_id, url, is_pinned, is_manual, created_at`,
      params
    );
    return r.rows;
  } catch { return []; }
}

module.exports = { searchImages, searchAndSaveImages, buildQuery, _cleanProductName };
