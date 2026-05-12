'use strict';

const BASE = window.APP_BASE || '';
/* ═══ STATE ══════════════════════════════════════════════════════════ */
let token    = null;
let products = [];
let page     = 1;
let total    = 0;
const limit  = 20;
let statusFilter  = 'T';
let alertFilter   = false;
let searchQuery   = '';
let currentProduct = null;
let searchTimer   = null;

/* ═══ AUTH ══════════════════════════════════════════════════════════ */
function init() {
  token = localStorage.getItem('gp_token');
  if (token) {
    showApp();
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('screen-login').style.display = 'flex';
  document.getElementById('screen-app').style.display   = 'none';
}

function showApp() {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-app').style.display   = 'block';
  _sessionInit(logout);
  loadProducts(1);
}

function logout() {
  _sessionClear();
  localStorage.removeItem('gp_token');
  localStorage.removeItem('gp_user');
  token = null;
  showLogin();
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('lbtn');
  const err = document.getElementById('lerr');
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    const res  = await fetch(BASE + '/api/auth/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        username: document.getElementById('lu').value,
        password: document.getElementById('lp').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao fazer login');
    token = data.token;
    localStorage.setItem('gp_token', token);
    localStorage.setItem('gp_user', JSON.stringify(data.user));
    localStorage.setItem('gp_last_activity', Date.now().toString());
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

/* ═══ FILTERS ════════════════════════════════════════════════════════ */
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchQuery = e.target.value.trim();
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
  if (searchQuery)  params.set('q', searchQuery);
  if (statusFilter !== 'T') params.set('status', statusFilter);
  if (alertFilter)  params.set('fiscal_alert', '1');

  try {
    const res  = await fetch(BASE + '/api/products?' + params, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
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
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>Nenhum produto encontrado.</p></div>';
    return;
  }
  list.innerHTML = products.map(p => {
    const badge    = statusBadge(p.status);
    const alertTag = p.fiscal_alert ? `<span class="badge badge-alert">⚠️ Alerta</span>` : '';
    const realVal  = p.stock_real !== null && p.stock_real !== undefined
      ? `<span class="stock-value real">${fmt(p.stock_real)}</span>`
      : `<span class="stock-value empty">—</span>`;

    return `
    <div class="product-card" onclick="openSheet('${esc(p.id)}')">
      <div class="card-top">
        <div style="flex:1;min-width:0">
          <div class="card-ref">${esc(p.id)}</div>
          <div class="card-name">${esc(p.name)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.3rem">
          ${badge}
          ${alertTag}
        </div>
      </div>
      <div class="card-stocks">
        <div class="stock-item">
          <div class="stock-label">Est. Fiscal</div>
          <div class="stock-value">${fmt(p.stock_fiscal)}</div>
        </div>
        <div class="stock-item">
          <div class="stock-label">Est. Gerencial</div>
          <div class="stock-value">${fmt(p.stock_mgmt)}</div>
        </div>
        <div class="stock-item">
          <div class="stock-label">Real</div>
          ${realVal}
        </div>
      </div>
      <div class="card-footer">
        <span class="card-edit-hint">
          Editar produto
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </span>
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

  // Show limited page buttons
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
  // Find in current list or fetch
  let p = products.find(x => x.id === id);
  if (!p) {
    try {
      const res = await fetch(BASE + `/api/products/${encodeURIComponent(id)}`,{
        headers:{ Authorization:'Bearer '+token }
      });
      p = await res.json();
    } catch { return; }
  }
  currentProduct = p;

  document.getElementById('sheet-name').textContent = p.name;
  document.getElementById('sheet-ref').textContent  = p.id;
  document.getElementById('sh-fiscal').textContent  = fmt(p.stock_fiscal);
  document.getElementById('sh-mgmt').textContent    = fmt(p.stock_mgmt);

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

  // Focus input after animation
  setTimeout(() => inp.focus(), 350);
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('open');
  document.getElementById('bottom-sheet').classList.remove('open');
  currentProduct = null;
  // Blur to dismiss keyboard
  document.activeElement?.blur();
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

  // Validate
  if (rawVal !== '') {
    const num = parseFloat(rawVal);
    if (isNaN(num) || num < 0) {
      errEl.textContent  = 'Valor inválido. Informe um número maior ou igual a zero.';
      errEl.style.display = 'block';
      inp.classList.add('invalid');
      return;
    }
  }

  btn.disabled    = true;
  btn.textContent = 'Salvando…';

  try {
    const body = {
      name:       currentProduct.name,
      price_mgmt: currentProduct.price_mgmt,
      status:     currentProduct.status
    };
    if (rawVal !== '') body.stock_real = parseFloat(rawVal);

    const res = await fetch(BASE + `/api/products/${encodeURIComponent(currentProduct.id)}`, {
      method:  'PUT',
      headers: {
        'Content-Type':  'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify(body)
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
// Close sheet on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

// Save on Enter inside real stock input
document.getElementById('inp-real').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveProduct(); }
});

/* ═══ BOOT ═══════════════════════════════════════════════════════════ */
init();