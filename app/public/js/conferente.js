'use strict';

const BASE = window.APP_BASE || '';
/* ═══ STATE ══════════════════════════════════════════════════════════ */
let products = [];
let page     = 1;
let total    = 0;
const limit  = 20;
let statusFilter  = 'T';
let alertFilter   = false;
let searchNameQuery = '';
let searchCodeQuery = '';
let currentProduct = null;
let searchTimer   = null;

/* ═══ AUTH ══════════════════════════════════════════════════════════ */
function init() {
  const user = localStorage.getItem('gp_user');
  if (!user) {
    window.location.replace(BASE + '/login');
    return;
  }
  const userData = JSON.parse(user);
  const userEl = document.getElementById('header-user');
  if (userEl && userData?.username) userEl.textContent = userData.username;
  loadProducts(1);
}

async function logout() {
  try { await fetch(BASE + '/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (_) {}
  localStorage.removeItem('gp_user');
  window.location.replace(BASE + '/login');
}

/* ═══ FILTERS ════════════════════════════════════════════════════════ */
document.getElementById('search-name').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchNameQuery = e.target.value.trim();
  searchTimer = setTimeout(() => loadProducts(1), 350);
});
document.getElementById('search-code').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchCodeQuery = e.target.value.trim();
  searchTimer = setTimeout(() => loadProducts(1), 350);
});

function setStatus(s, el) {
  statusFilter = s;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  loadProducts(1);
}

function toggleAlertFilter() {
  alertFilter = !alertFilter;
  const btn = document.getElementById('alert-filter-btn');
  btn.classList.toggle('active', alertFilter);
  loadProducts(1);
}

/* ═══ PRODUCT LIST ═══════════════════════════════════════════════════ */
async function loadProducts(p = 1) {
  page = p;
  const list = document.getElementById('product-list');
  list.innerHTML = skeletons(4);

  const params = new URLSearchParams({
    page: p, limit,
    sort: 'name', order: 'asc'
  });
  if (searchNameQuery) params.set('name_q', searchNameQuery);
  if (searchCodeQuery) params.set('code_q', searchCodeQuery);
  if (statusFilter !== 'T') params.set('status', statusFilter);
  if (alertFilter)  params.set('fiscal_alert', '1');

  try {
    const res  = await fetch(BASE + '/api/products?' + params, {
      credentials: 'same-origin',
    });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    products = data.products || [];
    total    = data.total    || 0;
    renderList();
    renderPagination();
  } catch {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Erro ao carregar produtos.<br>Verifique sua conexão.</p></div>';
  }
}

function renderList() {
  const list = document.getElementById('product-list');
  if (!products.length) {
    list.innerHTML = '<div class="empty-state"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg><p>Nenhum produto encontrado.</p></div>';
    return;
  }
  list.innerHTML = products.map((p, i) => {
    const badge    = statusBadge(p.status);
    const alertTag = p.fiscal_alert ? `<span class="badge badge-alert">⚠️ Alerta</span>` : '';
    const realVal  = p.stock_real !== null && p.stock_real !== undefined
      ? `<span class="stock-value real">${fmt(p.stock_real)}</span>`
      : `<span class="stock-value empty">—</span>`;

    return `
    <div class="product-card status-${p.status}" onclick="openSheet('${esc(p.id)}')" style="animation-delay:${Math.min(i,8)*30}ms">
      <div class="card-side"></div>
      <div class="card-body">
        <div class="card-top">
          <div class="card-meta">
            <div class="card-ref">${esc(p.id)}</div>
            <div class="card-name">${esc(p.name)}</div>
            <div class="card-badges">${badge}${alertTag}</div>
          </div>
          <div class="card-chevron">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
        <div class="card-stocks">
          <div class="stock-item">
            <div class="stock-label">Est. Fiscal</div>
            <div class="stock-value">${fmt(p.stock_fiscal)}</div>
          </div>
          <div class="stock-item">
            <div class="stock-label">Est. Gerencial</div>
            <div class="stock-value">${fmt(p.snap_stock_mgmt)}</div>
          </div>
          <div class="stock-item real-col">
            <div class="stock-label">Real</div>
            ${realVal}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderPagination() {
  const pages = Math.ceil(total / limit);
  const info  = document.getElementById('pg-info');
  const pag   = document.getElementById('pagination');

  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);
  info.textContent = total ? `Exibindo ${from}–${to} de ${total} produtos` : '';

  if (pages <= 1) { pag.innerHTML = ''; return; }

  let html = `<button class="pg-btn" onclick="loadProducts(${page-1})" ${page===1?'disabled':''}>← Ant.</button>`;

  const start = Math.max(1, page - 2);
  const end   = Math.min(pages, page + 2);
  for (let i = start; i <= end; i++) {
    html += `<button class="pg-btn ${i===page?'active':''}" onclick="loadProducts(${i})">${i}</button>`;
  }
  html += `<button class="pg-btn" onclick="loadProducts(${page+1})" ${page===pages?'disabled':''}>Próx. →</button>`;
  pag.innerHTML = html;
}

/* ═══ BOTTOM SHEET ═══════════════════════════════════════════════════ */
async function openSheet(id) {
  let p;
  try {
    const res = await fetch(BASE + `/api/products/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
    });
    p = await res.json();
  } catch { return; }
  currentProduct = p;

  renderSheetImage(p);
  const hasPinned = (p.images || []).some(i => i.is_pinned);
  if (!hasPinned) autoAssignImage();

  document.getElementById('sheet-name').textContent = p.name;
  document.getElementById('sheet-ref').textContent  = p.id;
  document.getElementById('sh-fiscal').textContent  = fmt(p.stock_fiscal);
  document.getElementById('sh-mgmt').textContent    = fmt(p.snap_stock_mgmt);

  const realEl = document.getElementById('sh-real');
  if (p.stock_real !== null && p.stock_real !== undefined) {
    realEl.textContent = fmt(p.stock_real);
    realEl.className   = 'info-box-value accent';
  } else {
    realEl.textContent = '—';
    realEl.className   = 'info-box-value muted';
  }

  const banner = document.getElementById('fiscal-banner');
  banner.classList.toggle('show', !!p.fiscal_alert);

  const inp = document.getElementById('inp-real');
  inp.value = p.stock_real !== null && p.stock_real !== undefined ? p.stock_real : '';
  inp.classList.remove('invalid');

  document.getElementById('rule-hint').className = 'rule-hint';
  document.getElementById('sheet-err').style.display = 'none';
  document.getElementById('btn-save').disabled = false;

  updateRuleHint(inp.value);

  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('bottom-sheet').classList.add('open');

  setTimeout(() => inp.focus(), 350);
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('open');
  document.getElementById('bottom-sheet').classList.remove('open');
  const cand = document.getElementById('img-candidates');
  cand.style.display = 'none';
  cand.innerHTML = '';
  currentProduct = null;
  document.activeElement?.blur();
}

/* ═══ IMAGE ══════════════════════════════════════════════════════════ */
function renderSheetImage(p) {
  const box  = document.getElementById('sheet-img-box');
  const cand = document.getElementById('img-candidates');
  cand.style.display = 'none';
  cand.innerHTML = '';

  const pinned = (p.images || []).find(i => i.is_pinned);
  if (pinned) {
    box.innerHTML = `<img class="sheet-img" src="${esc(pinned.url)}" alt="" onerror="this.style.display='none'">`;
  } else {
    box.innerHTML = '<span style="font-size:.75rem;color:var(--muted2)">Sem foto</span>';
  }
}

async function autoAssignImage() {
  if (!currentProduct) return;
  const box = document.getElementById('sheet-img-box');
  box.innerHTML = '<span style="font-size:.7rem;color:var(--muted2)">⌛</span>';
  try {
    const res  = await fetch(BASE + `/api/products/${encodeURIComponent(currentProduct.id)}/search-images?fresh=1`, { credentials: 'same-origin' });
    const data = await res.json();
    const first = (data.images || [])[0];
    if (!first) { renderSheetImage(currentProduct); return; }

    const save = await fetch(BASE + `/api/products/${encodeURIComponent(currentProduct.id)}/images`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: first.url, is_pinned: 1, is_manual: 0 }),
    });
    if (!save.ok) throw new Error();

    if (!currentProduct.images) currentProduct.images = [];
    currentProduct.images.forEach(i => { i.is_pinned = 0; });
    currentProduct.images.push({ url: first.url, is_pinned: 1, is_manual: 0 });
    renderSheetImage(currentProduct);
  } catch {
    renderSheetImage(currentProduct);
  }
}

async function searchImages() {
  if (!currentProduct) return;
  const btn  = document.getElementById('btn-search-imgs');
  const cand = document.getElementById('img-candidates');
  btn.disabled    = true;
  btn.textContent = '⌛ Buscando…';
  cand.style.display = 'none';
  try {
    const res  = await fetch(BASE + `/api/products/${encodeURIComponent(currentProduct.id)}/search-images?fresh=1`, { credentials: 'same-origin' });
    const data = await res.json();
    renderCandidates(data.images || []);
  } catch {
    showToast('Erro ao buscar imagens', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '🔍 Buscar Imagem';
  }
}

function renderCandidates(images) {
  const cand = document.getElementById('img-candidates');
  if (!images.length) {
    cand.innerHTML = '<p style="font-size:.75rem;color:var(--muted);text-align:center;padding:.5rem 0">Nenhuma imagem encontrada.</p>';
    cand.style.display = 'block';
    return;
  }
  cand.innerHTML = images.slice(0, 6).map(img =>
    `<div class="img-candidate" onclick="selectImage('${esc(img.url)}',this)">
       <img src="${esc(img.url)}" alt="" loading="lazy" onerror="this.closest('.img-candidate').style.display='none'">
     </div>`
  ).join('');
  cand.style.display = 'grid';
}

async function selectImage(url, el) {
  if (!currentProduct) return;
  document.querySelectorAll('.img-candidate').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  try {
    const res = await fetch(BASE + `/api/products/${encodeURIComponent(currentProduct.id)}/images`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, is_pinned: 1, is_manual: 1 }),
    });
    if (!res.ok) throw new Error();
    if (!currentProduct.images) currentProduct.images = [];
    currentProduct.images.forEach(i => { i.is_pinned = 0; });
    currentProduct.images.push({ url, is_pinned: 1, is_manual: 1 });
    renderSheetImage(currentProduct);
    showToast('✅ Imagem salva!', 'success');
  } catch {
    showToast('Erro ao salvar imagem', 'error');
    el.classList.remove('selected');
  }
}

/* ═══ STOCK RULE ═════════════════════════════════════════════════════ */
document.getElementById('inp-real').addEventListener('input', (e) => {
  updateRuleHint(e.target.value);
});

function updateRuleHint(val) {
  const hint  = document.getElementById('rule-hint');
  const inp   = document.getElementById('inp-real');
  const v     = val.trim();

  inp.classList.remove('invalid');
  hint.className = 'rule-hint';

  if (v === '' || v === null) return;

  const num = parseFloat(v.replace(',', '.'));

  if (isNaN(num)) return;

  if (num < 0) {
    inp.classList.add('invalid');
    hint.className   = 'rule-hint err show';
    hint.textContent = '❌ O valor Real não pode ser negativo.';
    return;
  }

  if (num === 0) {
    hint.className   = 'rule-hint warn show';
    hint.innerHTML   = '⚠️ <strong>Real = 0</strong> — Estoque Gerencial será zerado e o produto será marcado para desativação no fiscal.';
  } else {
    hint.className   = 'rule-hint ok show';
    hint.innerHTML   = `✅ <strong>Estoque Gerencial</strong> será atualizado para <strong>${fmt(num)}</strong> automaticamente.`;
  }
}

/* ═══ SAVE ═══════════════════════════════════════════════════════════ */
async function saveProduct() {
  if (!currentProduct) return;

  const inp    = document.getElementById('inp-real');
  const errEl  = document.getElementById('sheet-err');
  const btn    = document.getElementById('btn-save');
  const rawVal = inp.value.trim().replace(',', '.');

  errEl.style.display = 'none';

  if (rawVal === '') {
    errEl.textContent  = 'Informe a contagem de estoque real.';
    errEl.style.display = 'block';
    inp.focus();
    return;
  }

  const num = parseFloat(rawVal);
  if (isNaN(num) || num < 0) {
    errEl.textContent  = 'Valor inválido. Informe um número maior ou igual a zero.';
    errEl.style.display = 'block';
    inp.classList.add('invalid');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Salvando…';

  try {
    const res = await fetch(BASE + `/api/products/${encodeURIComponent(currentProduct.id)}/stock-real`, {
      method:  'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_real: parseFloat(rawVal) })
    });

    if (res.status === 401) { logout(); return; }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar');

    showToast('✅ Produto atualizado!', 'success');
    closeSheet();
    loadProducts(page);
  } catch (ex) {
    errEl.textContent  = ex.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Salvar';
  }
}

/* ═══ HELPERS ════════════════════════════════════════════════════════ */
function fmt(v) {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace('.', ',');
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function statusBadge(s) {
  const map = {
    0: ['badge-eq',   'Igual'],
    1: ['badge-diff', 'Divergente'],
    2: ['badge-fi',   'Só Fiscal'],
  };
  const [cls, label] = map[s] || ['badge-fi','—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function skeletons(n) {
  return Array.from({length:n}, () => `
    <div class="skeleton-card" style="padding:.85rem 1rem">
      <div class="skel-line" style="width:30%;height:9px;margin-bottom:.5rem"></div>
      <div class="skel-line" style="width:75%;height:14px"></div>
      <div style="display:flex;gap:.5rem;margin-top:.65rem">
        <div class="skel-line" style="flex:1;height:10px"></div>
        <div class="skel-line" style="flex:1;height:10px"></div>
        <div class="skel-line" style="flex:1;height:10px"></div>
      </div>
    </div>`).join('');
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent  = msg;
  t.className    = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast ' + type; }, 2800);
}

/* ═══ KEYBOARD ═══════════════════════════════════════════════════════ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

document.getElementById('inp-real').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveProduct(); }
});

/* ═══ BOOT ═══════════════════════════════════════════════════════════ */
init();
