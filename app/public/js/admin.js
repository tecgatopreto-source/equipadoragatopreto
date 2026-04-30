// ── Auth guard ─────────────────────────────────────────────────────────────
const BASE = window.APP_BASE || '';
const token = localStorage.getItem('gp_token');
const user  = JSON.parse(localStorage.getItem('gp_user') || 'null');
if (!token || !user || user.role !== 'admin') {
  location.href = BASE + '/login.html';
}
document.getElementById('uname').textContent = user ? user.username : '';

function logout() {
  localStorage.removeItem('gp_token');
  localStorage.removeItem('gp_user');
  location.href = BASE + '/login.html';
}

// ── Sidebar mobile toggle ──────────────────────────────────────────────────
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}
document.addEventListener('click', e => {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !document.getElementById('menu-toggle').contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

// ── Navigation ─────────────────────────────────────────────────────────────
const VALID_PAGES = ['dashboard','products','report','deactivate','pdfs'];

function navigate(page) {
  if (!VALID_PAGES.includes(page)) page = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  history.replaceState(null, '', '#' + page);
  document.querySelector('.sidebar').classList.remove('open');
  if (page === 'products') { _restoreFilterButtons(); loadCatFilter(); loadProducts(1); }
  if (page === 'dashboard')  loadStats();
  if (page === 'report')     loadReport();
  if (page === 'deactivate') {
    // Padrão: mostra apenas mudanças de hoje
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('dact-from').value = today;
    document.getElementById('dact-to').value   = today;
    document.getElementById('dact-flag').value = '';
    loadDeactivate();
  }
  if (page === 'pdfs') loadImportHistory();
}

// ── API helper ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (res.status === 401) {
    localStorage.removeItem('gp_token');
    localStorage.removeItem('gp_user');
    location.href = BASE + '/login.html';
    return;
  }
  if (!res.ok) throw new Error(data.error || 'Erro na API');
  return data;
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api('GET', '/products/stats');
    document.getElementById('ds-total').textContent  = (s.total        ?? 0).toLocaleString('pt-BR');
    document.getElementById('ds-iguais').textContent = (s.iguais       ?? 0).toLocaleString('pt-BR');
    document.getElementById('ds-div').textContent    = (s.divergentes  ?? 0).toLocaleString('pt-BR');
    document.getElementById('ds-fi').textContent     = (s.so_fiscal    ?? 0).toLocaleString('pt-BR');
    loadActionStats();
  } catch { /* ignora — stats ficam em "—" */ }
}

async function loadActionStats() {
  try {
    const a = await api('GET', '/products/action-stats');
    document.getElementById('ac-alteracoes').textContent = a.alteracoes.toLocaleString('pt-BR');
    document.getElementById('ac-desativar').textContent  = a.desativar.toLocaleString('pt-BR');
    document.getElementById('ac-atualizar').textContent  = a.atualizar.toLocaleString('pt-BR');
  } catch (_) {}
}

// ── Regra de negócio — espelho client-side da função applyStockRule ────────
//
// PSEUDOCÓDIGO (resumo):
//   SE real < 0  → erro, impede salvar
//   SE real = 0  → gerencial = 0, ativa alerta fiscal
//   SE real > 0  → gerencial = real, remove alerta fiscal
//
function applyStockRuleUI() {
  const realInput = document.getElementById('f-sreal');
  const warnEl    = document.getElementById('fiscal-warning-msg');
  const okEl      = document.getElementById('fiscal-ok-msg');
  const raw       = realInput.value;

  if (raw === '') {
    warnEl.classList.remove('show');
    okEl.style.display = 'none';
    return;
  }

  const real = parseFloat(raw);

  if (real < 0) {
    realInput.style.borderColor = 'var(--red)';
    warnEl.classList.remove('show');
    okEl.style.display = 'none';
    return;
  }
  realInput.style.borderColor = 'var(--accent)';

  if (real === 0) {
    warnEl.classList.add('show');
    okEl.style.display = 'none';
  } else {
    warnEl.classList.remove('show');
    okEl.style.display = 'block';
  }
}

// ── Products table ─────────────────────────────────────────────────────────
let prodPage = 1;
const LIMIT = 25;
let debTimer;
let sortCol = 'id';
let sortDir = 'asc';
let alertFilter = false;
let statusFilter   = localStorage.getItem('gp_admin_status')   ?? 'T';
let disabledFilter = localStorage.getItem('gp_admin_disabled') ?? '';
let catFilter      = localStorage.getItem('gp_admin_cat')      ?? '';

function _applyStatusFilter(val) {
  statusFilter = val;
  localStorage.setItem('gp_admin_status', val);
  document.querySelectorAll('#status-group .filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === val));
}

function setStatusFilter(val) {
  _applyStatusFilter(val);
  loadProducts(1);
}

function setDisabledFilter(val) {
  disabledFilter = val;
  localStorage.setItem('gp_admin_disabled', val);
  document.querySelectorAll('#disabled-group .filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === val));
  loadProducts(1);
}

function _restoreFilterButtons() {
  document.querySelectorAll('#status-group .filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === statusFilter));
  document.querySelectorAll('#disabled-group .filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === disabledFilter));
}

async function loadCatFilter() {
  const sel = document.getElementById('cat-group');
  try {
    const data = await api('GET', '/products/categories');
    const current = catFilter;
    sel.innerHTML = '<option value="">Todas as categorias</option>' +
      data.categories.map(c =>
        `<option value="${c}"${c === current ? ' selected' : ''}>${c}</option>`
      ).join('');
  } catch (_) {}
}

function setCatFilter() {
  catFilter = document.getElementById('cat-group').value;
  if (catFilter) localStorage.setItem('gp_admin_cat', catFilter);
  else localStorage.removeItem('gp_admin_cat');
  loadProducts(1);
}

function debSearch() {
  clearTimeout(debTimer);
  debTimer = setTimeout(() => {
    localStorage.setItem('gp_admin_q', document.getElementById('prod-q').value);
    loadProducts(1);
  }, 350);
}

function toggleAlertFilter() {
  alertFilter = !alertFilter;
  const btn = document.getElementById('btn-alert-filter');
  btn.style.background      = alertFilter ? 'var(--amber)' : '';
  btn.style.color           = alertFilter ? '#fff' : '';
  btn.style.borderColor     = alertFilter ? 'var(--amber)' : '';
  loadProducts(1);
}

const fmt = n => n != null ? 'R$ ' + Number(n).toFixed(2).replace('.', ',') : '—';
function badge(s) {
  if (s === 0) return '<span class="badge badge-eq">Igual</span>';
  if (s === 1) return '<span class="badge badge-diff">Divergente</span>';
  return '<span class="badge badge-fi">Só Fiscal</span>';
}

function pctCell(pct) {
  if (pct == null) return '<td class="pct-cell">—</td>';
  const v = Math.round(pct);
  const cls = v === 0 ? 'pct-low' : v <= 30 ? 'pct-mid' : 'pct-high';
  return `<td class="pct-cell ${cls}">${v}%</td>`;
}

function diffCell(pct, a, b) {
  if (a == null || b == null) return '<td class="pct-cell" style="color:var(--muted2)">—</td>';
  const delta = a - b;
  const pctV  = pct != null ? Math.round(pct) : null;
  const cls   = delta === 0 ? 'pct-low' : Math.abs(pctV ?? 100) <= 30 ? 'pct-mid' : 'pct-high';
  const sign  = delta > 0 ? '+' : '';
  const pctTxt = pctV != null ? `<span style="font-size:.65rem;opacity:.75"> (${pctV}%)</span>` : '';
  return `<td class="pct-cell ${cls}">${sign}${Number(delta).toLocaleString('pt-BR')}${pctTxt}</td>`;
}

// Clique nos cabeçalhos para ordenar
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = 'asc';
    }
    // Atualiza visual dos headers
    document.querySelectorAll('th.sortable').forEach(h => {
      h.classList.remove('sort-asc', 'sort-desc');
    });
    th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    loadProducts(1);
  });
});

// Inicializa header padrão (Ref. asc)
document.querySelector('th[data-col="id"]').classList.add('sort-asc');

async function loadProducts(page) {
  prodPage = page;
  const q             = document.getElementById('prod-q').value;
  const status        = statusFilter;
  const disabled      = disabledFilter;
  const alertParam    = alertFilter ? '&fiscal_alert=1' : '';
  const disabledParam = disabled !== '' ? `&disabled=${disabled}` : '';
  const catParam      = catFilter   ? `&cat=${encodeURIComponent(catFilter)}` : '';
  const data = await api('GET',
    `/products?q=${encodeURIComponent(q)}&status=${status}&page=${page}&limit=${LIMIT}&sort=${sortCol}&order=${sortDir}${alertParam}${disabledParam}${catParam}`
  );

  const tbody = document.getElementById('prod-tbody');
  if (!data.products.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:2rem;color:var(--muted)">Nenhum produto encontrado</td></tr>';
  } else {
    tbody.innerHTML = data.products.map(p => `
      <tr>
        <td style="font-weight:600;font-size:.72rem">${p.id}</td>
        <td>
          ${p.name}
          ${p.is_disabled ? '<span class="badge-disabled" style="margin-left:.4rem">Desativado</span>' : ''}
        </td>
        <td class="col-fiscal">${fmt(p.price_fiscal)}</td>
        <td class="col-mgmt">${fmt(p.price_mgmt ?? p.snap_price_mgmt)}</td>
        <td class="col-fiscal">${p.stock_fiscal != null ? Number(p.stock_fiscal).toLocaleString('pt-BR') : '—'}</td>
        <td class="col-mgmt">${p.snap_stock_mgmt != null ? Number(p.snap_stock_mgmt).toLocaleString('pt-BR') : '—'}</td>
        ${diffCell(p.diff_pct, p.stock_fiscal, p.snap_stock_mgmt)}
        <td class="col-real" style="font-weight:700">
          ${p.stock_real != null ? Number(p.stock_real).toLocaleString('pt-BR') : '<span style="color:var(--muted2)">·</span>'}
        </td>
        ${p.stock_real != null ? pctCell(p.real_pct) : '<td class="pct-cell" style="color:var(--muted2)">·</td>'}
        <td>${p.fiscal_alert ? '<span class="badge-alert">⚠️ Fiscal</span>' : '<span style="color:var(--muted2);font-size:.72rem">—</span>'}</td>
        <td>${badge(p.status)}</td>
        <td>
          <div class="td-actions">
            <button class="btn-sm" onclick="editProduct('${p.id}')">Editar</button>
            <button class="btn-sm btn-danger" onclick="deleteProduct('${p.id}','${p.name.replace(/'/g,"\\'")}')">Del</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  const totalPages = Math.ceil(data.total / LIMIT);
  const start = ((page - 1) * LIMIT) + 1;
  const end   = Math.min(page * LIMIT, data.total);
  document.getElementById('pg-info').textContent = `${start}–${end} de ${data.total.toLocaleString('pt-BR')}`;
  document.getElementById('pg-prev').disabled = page <= 1;
  document.getElementById('pg-next').disabled = page >= totalPages;
}

// ── Product form ───────────────────────────────────────────────────────────
let editingId = null;
let editingProductName = null;

function openProductForm(product) {
  editingId = product ? product.id : null;
  editingProductName = product?.name || null;
  document.getElementById('form-title').textContent = product ? 'Editar Produto' : 'Novo Produto';
  document.getElementById('f-id').value        = product?.id || '';
  document.getElementById('f-id').disabled     = !!product;
  document.getElementById('f-id-original').value = product?.id || '';
  document.getElementById('f-name').value      = product?.name || '';
  document.getElementById('f-pfiscal').value   = product?.price_fiscal ?? '';
  document.getElementById('f-pmgmt').value     = product?.price_mgmt ?? '';
  document.getElementById('f-sfiscal').value   = product?.stock_fiscal ?? '';
  document.getElementById('f-snap-smgmt').value = product?.snap_stock_mgmt ?? '';
  document.getElementById('f-sreal').value     = product?.stock_real ?? '';
  document.getElementById('form-err').style.display = 'none';
  document.getElementById('fiscal-warning-msg').classList.remove('show');
  document.getElementById('fiscal-ok-msg').style.display = 'none';
  document.getElementById('f-sreal').style.borderColor = 'var(--accent)';
  if (product?.fiscal_alert) {
    document.getElementById('fiscal-warning-msg').classList.add('show');
  }
  const imgSection = document.getElementById('img-section');
  if (product) {
    imgSection.style.display = 'block';
    loadProductImages(product.id, product.images || []);
  } else {
    imgSection.style.display = 'none';
  }
  document.getElementById('prod-overlay').classList.add('open');
}

async function editProduct(id) {
  const p = await api('GET', '/products/' + id);
  openProductForm(p);
}

function closeProductForm() {
  document.getElementById('prod-overlay').classList.remove('open');
  document.getElementById('f-img-url').value = '';
  document.getElementById('f-img-file').value = '';
}

// ── Product images ─────────────────────────────────────────────────────────
function _renderImgGrid(images) {
  const grid = document.getElementById('img-grid');
  if (!images.length) {
    const svg = typeof getCategoryPlaceholder === 'function'
      ? getCategoryPlaceholder(editingProductName)
      : '';
    grid.innerHTML = `<div class="img-tile" style="pointer-events:none;opacity:.45;display:flex;align-items:center;justify-content:center;padding:.5rem">${svg}</div><span style="font-size:.72rem;color:var(--muted);grid-column:2/-1;align-self:center">Nenhuma foto. Adicione pelo arquivo ou URL.</span>`;
    return;
  }
  grid.innerHTML = images.map(img => `
    <div class="img-tile${img.is_pinned ? ' pinned' : ''}" title="${img.is_pinned ? 'Foto principal' : 'Clique para fixar como principal'}">
      <img src="${img.url}" loading="lazy" onerror="this.parentElement.style.display='none'"
           onclick="pinImage('${editingId}',${img.id})">
      ${img.is_pinned ? '<span class="img-tile-pin">✓ Principal</span>' : ''}
      ${img.is_manual ? '<span class="img-tile-badge">Manual</span>' : ''}
      <button class="img-tile-del" onclick="event.stopPropagation();deleteImageById(${img.id})" title="Remover">✕</button>
    </div>
  `).join('');
}

function loadProductImages(productId, images) {
  _renderImgGrid(images);
}

async function pinImage(productId, imgId) {
  await api('PUT', `/products/${productId}/images/${imgId}/pin`);
  const data = await api('GET', `/products/${editingId}`);
  _renderImgGrid(data.images || []);
}

async function deleteImageById(imgId) {
  try {
    await api('DELETE', `/products/${editingId}/images/${imgId}`);
    const data = await api('GET', `/products/${editingId}`);
    _renderImgGrid(data.images || []);
  } catch(e) { showToast('Erro ao remover: ' + e.message); }
}

async function clearProductImages() {
  if (!editingId) return;
  if (!confirm('Remover todas as fotos deste produto?')) return;
  await api('DELETE', `/products/${editingId}/images`);
  _renderImgGrid([]);
}

async function uploadImageFile() {
  const fileInput = document.getElementById('f-img-file');
  const file = fileInput.files[0];
  if (!file) { showToast('Selecione um arquivo primeiro.'); return; }
  const formData = new FormData();
  formData.append('image', file);
  const res = await fetch(BASE + `/api/products/${editingId}/images/upload`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) { showToast('Erro: ' + (data.error || 'falha no upload')); return; }
  fileInput.value = '';
  const imgs = await api('GET', `/products/${editingId}`);
  _renderImgGrid(imgs.images || []);
  showToast('Foto adicionada!');
}

async function addManualImage() {
  const url = document.getElementById('f-img-url').value.trim();
  if (!url) return;
  await api('POST', `/products/${editingId}/images`, { url, is_pinned: 1, is_manual: 1 });
  document.getElementById('f-img-url').value = '';
  const data = await api('GET', `/products/${editingId}`);
  _renderImgGrid(data.images || []);
}

async function saveProduct() {
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  const err = document.getElementById('form-err');
  err.style.display = 'none';

  const id   = document.getElementById('f-id').value.trim();
  const name = document.getElementById('f-name').value.trim();
  const pf   = document.getElementById('f-pfiscal').value;
  const pm   = document.getElementById('f-pmgmt').value;
  const sr   = document.getElementById('f-sreal').value;

  if (!id || !name) {
    err.textContent = 'Código e nome são obrigatórios.';
    err.style.display = 'block';
    btn.disabled = false;
    return;
  }

  const body = {
    id, name,
    price_fiscal: pf !== '' ? parseFloat(pf) : null,
    price_mgmt:   pm !== '' ? parseFloat(pm) : null,
    stock_real:   sr !== '' ? parseFloat(sr) : null,
  };

  try {
    if (editingId) {
      await api('PUT', '/products/' + editingId, body);
      showToast('Produto atualizado!');
    } else {
      await api('POST', '/products', body);
      showToast('Produto criado!');
    }
    closeProductForm();
    loadProducts(prodPage);
    loadStats();
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = 'block';
  }
  btn.disabled = false;
}

async function deleteProduct(id, name) {
  if (!confirm(`Remover o produto "${name}" (${id})?\n\nEsta ação não pode ser desfeita.`)) return;
  try {
    await api('DELETE', '/products/' + id);
    showToast('Produto removido.');
    loadProducts(prodPage);
    loadStats();
  } catch (ex) {
    showToast('Erro: ' + ex.message);
  }
}

// ── Overlay close on bg click ──────────────────────────────────────────────
document.getElementById('prod-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('prod-overlay')) closeProductForm();
});

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Relatório de Alterações ────────────────────────────────────────────────
let rptSort = 'changed_at', rptDir = 'desc';
let _rptData = []; // cache para exportação

// Ordenação nos headers
document.querySelectorAll('th.sortable-rpt').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (rptSort === col) {
      rptDir = rptDir === 'asc' ? 'desc' : 'asc';
    } else {
      rptSort = col;
      rptDir = 'asc';
    }
    document.querySelectorAll('th.sortable-rpt').forEach(h => h.classList.remove('sort-asc','sort-desc'));
    th.classList.add(rptDir === 'asc' ? 'sort-asc' : 'sort-desc');
    loadReport();
  });
});
// Header padrão: Data desc
document.querySelector('th.sortable-rpt[data-col="changed_at"]').classList.add('sort-desc');

const fmtStock = n => n != null ? Number(n).toLocaleString('pt-BR') : '<span style="color:var(--muted2)">—</span>';
const fmtStockRaw = n => n != null ? Number(n) : '';

// Limpa filtro de datas
function clearRptDates() {
  document.getElementById('rpt-from').value = '';
  document.getElementById('rpt-to').value   = '';
  loadReport();
}

async function loadReport() {
  const from  = document.getElementById('rpt-from').value; // YYYY-MM-DD
  const to    = document.getElementById('rpt-to').value;
  const params = new URLSearchParams({ sort: rptSort, order: rptDir });
  if (from) params.append('date_from', from);
  if (to)   params.append('date_to',   to);

  const data  = await api('GET', `/products/report?${params}`);
  _rptData    = data.rows; // salva para exportar

  const tbody = document.getElementById('rpt-tbody');
  const lbl   = from || to
    ? ` (filtrado${from ? ' de ' + from.split('-').reverse().join('/') : ''}${to ? ' até ' + to.split('-').reverse().join('/') : ''})`
    : '';
  document.getElementById('rpt-count').textContent =
    `${data.total.toLocaleString('pt-BR')} produto${data.total !== 1 ? 's' : ''} alterado${data.total !== 1 ? 's' : ''}${lbl}`;

  if (!data.rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:3rem;color:var(--muted)">Nenhuma alteração encontrada para o período selecionado</td></tr>';
    return;
  }

  tbody.innerHTML = data.rows.map(r => `
    <tr>
      <td style="font-weight:600;font-size:.72rem">${r.id}</td>
      <td>${r.name}</td>
      <td>${fmtStock(r.stock_fiscal)}</td>
      <td>${fmtStock(r.stock_mgmt)}</td>
      <td style="border-left:2px solid var(--accent);font-weight:700">
        ${r.stock_real != null ? Number(r.stock_real).toLocaleString('pt-BR') : '<span style="color:var(--muted2)">—</span>'}
      </td>
      <td class="date-cell">📅 ${r.data}</td>
      <td class="time-cell">🕐 ${r.hora}</td>
    </tr>
  `).join('');
}

// ── Exportação ─────────────────────────────────────────────────────────────
function buildExportRows() {
  return _rptData.map(r => ({
    'Ref.':              r.id,
    'Nome do Produto':   r.name,
    'Estoque Fiscal':    fmtStockRaw(r.stock_fiscal),
    'Estoque Gerencial': fmtStockRaw(r.stock_mgmt),
    'Estoque Real':      fmtStockRaw(r.stock_real),
    'Data':              r.data,
    'Hora':              r.hora,
  }));
}

function exportFilename(ext) {
  const from = document.getElementById('rpt-from').value;
  const to   = document.getElementById('rpt-to').value;
  const sfx  = (from || to) ? `_${(from||'inicio').replace(/-/g,'')}_${(to||'hoje').replace(/-/g,'')}` : '';
  return `relatorio_alteracoes${sfx}.${ext}`;
}

function exportCSV() {
  if (!_rptData.length) { showToast('Nenhum dado para exportar.'); return; }
  const rows  = buildExportRows();
  const cols  = Object.keys(rows[0]);
  const esc   = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    cols.map(esc).join(';'),
    ...rows.map(r => cols.map(c => esc(r[c])).join(';')),
  ];
  const bom  = '\uFEFF'; // BOM para Excel abrir UTF-8 corretamente
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: exportFilename('csv')
  });
  a.click(); URL.revokeObjectURL(a.href);
  showToast('CSV exportado!');
}

function exportXLS() {
  if (!_rptData.length) { showToast('Nenhum dado para exportar.'); return; }
  if (typeof XLSX === 'undefined') { showToast('Biblioteca XLS ainda carregando…'); return; }

  const rows = buildExportRows();
  const ws   = XLSX.utils.json_to_sheet(rows);

  // Larguras das colunas
  ws['!cols'] = [
    { wch: 10 }, { wch: 45 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 10 }
  ];

  // Estilo de cabeçalho (negrito) — suportado pelo SheetJS Community via `!rows`
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[addr]) continue;
    ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'C8102E' } }, fontColor: { rgb: 'FFFFFF' } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Alterações');
  XLSX.writeFile(wb, exportFilename('xlsx'));
  showToast('XLS exportado!');
}

// ── Desativar e Atualizar ──────────────────────────────────────────────────
let dactSort = 'changed_at', dactDir = 'desc';
let _dactData = [];

// Ordenação nos headers
document.querySelectorAll('th.sortable-dact').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (dactSort === col) {
      dactDir = dactDir === 'asc' ? 'desc' : 'asc';
    } else {
      dactSort = col;
      dactDir = 'asc';
    }
    document.querySelectorAll('th.sortable-dact').forEach(h => h.classList.remove('sort-asc','sort-desc'));
    th.classList.add(dactDir === 'asc' ? 'sort-asc' : 'sort-desc');
    loadDeactivate();
  });
});
// Header padrão: Data desc
document.querySelector('th.sortable-dact[data-col="changed_at"]').classList.add('sort-desc');

const fmtN = n => n != null ? Number(n).toLocaleString('pt-BR') : '<span style="color:var(--muted2)">—</span>';

// Gera os badges de categoria para cada produto
function dactBadges(r) {
  const badges = [];
  if (r.has_fiscal_alert) badges.push('<span class="badge-alert">⚠️ Desativar</span>');
  if (r.has_audit)        badges.push('<span style="background:rgba(0,80,160,.1);color:#004fa3;font-size:.58rem;font-weight:700;padding:.18rem .48rem;border-radius:2px;border:1px solid rgba(0,80,160,.25);white-space:nowrap">🔄 Atualizado</span>');
  return badges.join(' ') || '<span style="color:var(--muted2);font-size:.72rem">—</span>';
}

function clearDactDates() {
  document.getElementById('dact-from').value = '';
  document.getElementById('dact-to').value   = '';
  loadDeactivate();
}

async function loadDeactivate() {
  const tbody  = document.getElementById('dact-tbody');
  const countEl = document.getElementById('dact-count');
  const flag   = document.getElementById('dact-flag').value;
  const from   = document.getElementById('dact-from').value;
  const to     = document.getElementById('dact-to').value;
  const params = new URLSearchParams({ sort: dactSort, order: dactDir, flag });
  if (from) params.append('date_from', from);
  if (to)   params.append('date_to',   to);

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted);font-size:.8rem">Carregando…</td></tr>';
  countEl.textContent = '';

  try {
    const data  = await api('GET', `/products/deactivate-report?${params}`);
    _dactData   = data.rows;

    const nDesativar = data.rows.filter(r => r.has_fiscal_alert).length;
    const nAtualizar = data.rows.filter(r => r.has_audit).length;
    const dateLbl = from || to
      ? ` · ${from ? from.split('-').reverse().join('/') : '…'} → ${to ? to.split('-').reverse().join('/') : 'hoje'}`
      : '';
    countEl.textContent =
      `${data.total.toLocaleString('pt-BR')} produto${data.total !== 1 ? 's' : ''} — ⚠️ ${nDesativar} desativar · 🔄 ${nAtualizar} atualizar${dateLbl}`;

    if (!data.rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:3rem;color:var(--muted)">Nenhum produto encontrado para os filtros selecionados</td></tr>';
      return;
    }

    tbody.innerHTML = data.rows.map(r => {
      const hasEllipsis = r.name_full && r.name_full.length > 20;
      const idSafe = r.id.replace(/'/g, "\\'");
      return `
      <tr>
        <td style="font-weight:600;font-size:.72rem">${r.id}</td>
        <td title="${r.name_full}" style="font-size:.8rem;white-space:nowrap">${r.name_abbr}${hasEllipsis ? '…' : ''}</td>
        <td>${fmtN(r.stock_fiscal)}</td>
        <td>${fmtN(r.stock_mgmt)}</td>
        <td style="border-left:2px solid var(--accent);font-weight:700">${fmtN(r.stock_real)}</td>
        <td class="date-cell">📅 ${r.data}</td>
        <td style="white-space:nowrap">${dactBadges(r)}</td>
        <td>
          <div class="td-actions">
            <button class="btn-sm" onclick="editProduct('${idSafe}')" title="Editar produto">Editar</button>
            ${r.has_fiscal_alert
              ? `<button class="btn-sm" onclick="resolveAlert('${idSafe}')"
                   style="border-color:var(--green);color:var(--green)" title="Confirma que o produto foi desativado no fiscal">✓ Resolver</button>`
              : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

  } catch (ex) {
    _dactData = [];
    countEl.textContent = '';
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--red);font-size:.8rem">
      ❌ Erro ao carregar: ${ex.message}
    </td></tr>`;
  }
}

async function resolveAlert(id) {
  if (!confirm(`Marcar o produto "${id}" como resolvido?\n\nIsso indica que o produto já foi desativado no sistema fiscal e o alerta será removido.`)) return;
  try {
    await api('PATCH', `/products/${id}/resolve-alert`);
    showToast('✅ Alerta resolvido! Produto atualizado.');
    loadDeactivate();
    loadStats();
  } catch (ex) {
    showToast('Erro: ' + ex.message);
  }
}

function buildDeactivateExportRows() {
  return _dactData.map(r => {
    const tipos = [];
    if (r.has_fiscal_alert) tipos.push('Desativar Fiscal');
    if (r.has_audit)        tipos.push('Atualizado');
    return {
      'Ref.':       r.id,
      'Nome':       r.name_abbr + (r.name_full && r.name_full.length > 20 ? '…' : ''),
      'Fiscal':     r.stock_fiscal != null ? Number(r.stock_fiscal) : '',
      'Gerencial':  r.stock_mgmt   != null ? Number(r.stock_mgmt)   : '',
      'Real':       r.stock_real   != null ? Number(r.stock_real)   : '',
      'Data':       r.data,
      'Tipo':       tipos.join(' + ') || 'OK',
    };
  });
}

function exportDeactivateFilename(ext) {
  const from = document.getElementById('dact-from').value;
  const to   = document.getElementById('dact-to').value;
  const sfx  = (from || to) ? `_${(from||'inicio').replace(/-/g,'')}_${(to||'hoje').replace(/-/g,'')}` : '';
  return `desativar_atualizar${sfx}.${ext}`;
}

function exportDeactivateCSV() {
  if (!_dactData.length) { showToast('Nenhum dado para exportar.'); return; }
  const rows  = buildDeactivateExportRows();
  const cols  = Object.keys(rows[0]);
  const esc   = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    cols.map(esc).join(';'),
    ...rows.map(r => cols.map(c => esc(r[c])).join(';')),
  ];
  const bom  = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: exportDeactivateFilename('csv')
  });
  a.click(); URL.revokeObjectURL(a.href);
  showToast('CSV exportado!');
}

function exportDeactivateXLS() {
  if (!_dactData.length) { showToast('Nenhum dado para exportar.'); return; }
  if (typeof XLSX === 'undefined') { showToast('Biblioteca XLS ainda carregando…'); return; }
  const rows = buildDeactivateExportRows();
  const ws   = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 }, { wch: 23 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 18 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Desativar e Atualizar');
  XLSX.writeFile(wb, exportDeactivateFilename('xlsx'));
  showToast('XLS exportado!');
}

// ── PDF Import ─────────────────────────────────────────────────────────────
function onDrag(e, type) { e.preventDefault(); document.getElementById('drop-' + type).classList.add('drag'); }
function offDrag(type) { document.getElementById('drop-' + type).classList.remove('drag'); }

function onDropFile(e, type) {
  e.preventDefault();
  offDrag(type);
  const file = e.dataTransfer.files[0];
  if (file) uploadPdf(type, file);
}

function handleFileSelect(type) {
  const input = document.getElementById('file-' + type);
  if (input.files[0]) uploadPdf(type, input.files[0]);
}

function setStatus(type, msg, cls) {
  const el = document.getElementById('status-' + type);
  el.textContent = msg;
  el.className = 'pdf-status' + (cls ? ' ' + cls : '');
}

function closePreview() {
  document.getElementById('preview-section').classList.remove('show');
}

async function uploadPdf(type, file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    setStatus(type, 'Apenas arquivos PDF são aceitos.', 'err');
    return;
  }

  setStatus(type, `Enviando "${file.name}"…`);

  // Mostra painel de progresso
  const section = document.getElementById('preview-section');
  section.classList.add('show');
  document.getElementById('preview-title').textContent =
    (type === 'fiscal' ? '📋 Fiscal' : '📊 Gerencial') + ' — Importando…';
  document.getElementById('preview-loading').style.display = 'block';
  document.getElementById('import-result').style.display = 'none';

  const form = new FormData();
  form.append('pdf', file);

  let res, data;
  try {
    res  = await fetch(BASE + `/api/documents/upload/${type}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form,
    });
    data = await res.json();
  } catch (err) {
    setStatus(type, '❌ Erro de rede: ' + err.message, 'err');
    document.getElementById('preview-loading').style.display = 'none';
    return;
  }

  document.getElementById('preview-loading').style.display = 'none';

  if (!res.ok) {
    setStatus(type, '❌ ' + (data.error || 'Erro no upload'), 'err');
    document.getElementById('import-result').innerHTML =
      `<div style="color:var(--red);font-size:.8rem">❌ ${data.error || 'Erro desconhecido'}</div>`;
    document.getElementById('import-result').style.display = 'block';
    return;
  }

  const typeLabel = type === 'fiscal' ? 'Fiscal' : 'Gerencial';
  setStatus(type, `✅ "${file.name}" importado — ${data.updated} produto(s) atualizados.`, 'ok');
  document.getElementById('preview-title').textContent =
    (type === 'fiscal' ? '📋' : '📊') + ' Resultado — ' + typeLabel;

  const noteGerencial = type === 'gerencial'
    ? `<div style="margin-top:.75rem;padding:.55rem .75rem;background:rgba(78,130,212,.07);border:1px solid rgba(78,130,212,.3);border-radius:3px;font-size:.7rem;color:#004fa3">
        Dados manuais (Preço/Estoque Gerencial ajustados pelo sistema) <strong>não foram alterados</strong>.
        Esses valores ficam em colunas separadas para comparação.
      </div>`
    : '';

  document.getElementById('import-result').innerHTML = `
    <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
      <div style="flex:1;min-width:120px">
        <div style="font-size:.6rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem">Produtos no PDF</div>
        <div style="font-size:1.6rem;font-weight:800;color:var(--text)">${data.total.toLocaleString('pt-BR')}</div>
      </div>
      <div style="flex:1;min-width:120px">
        <div style="font-size:.6rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem">Atualizados no sistema</div>
        <div style="font-size:1.6rem;font-weight:800;color:var(--green)">${data.updated.toLocaleString('pt-BR')}</div>
      </div>
      <div style="flex:1;min-width:120px">
        <div style="font-size:.6rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem">Não encontrados no sistema</div>
        <div style="font-size:1.6rem;font-weight:800;color:var(--amber)">${(data.total - data.updated).toLocaleString('pt-BR')}</div>
      </div>
    </div>
    ${noteGerencial}
  `;
  document.getElementById('import-result').style.display = 'block';

  document.getElementById('file-' + type).value = '';
  loadImportHistory();
}

async function loadImportHistory() {
  const tbody = document.getElementById('history-tbody');
  try {
    const data = await api('GET', '/documents/history');
    if (!data.history.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--muted);font-size:.8rem">Nenhuma importação realizada ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = data.history.map(h => {
      const statusColor = h.status === 'success' ? 'var(--green)' : h.status === 'error' ? 'var(--red)' : 'var(--amber)';
      const statusLabel = h.status === 'success' ? '✅ Sucesso' : h.status === 'error' ? '❌ Erro' : '⚠️ Parcial';
      const date = h.imported_at ? h.imported_at.replace('T', ' ').substring(0, 16) : '—';
      return `<tr>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);white-space:nowrap;font-size:.72rem">${date}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-weight:600;font-size:.72rem">${h.type === 'fiscal' ? '📋 Fiscal' : '📊 Gerencial'}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.72rem">${h.total_products ?? '—'}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:var(--green);font-weight:700;font-size:.72rem">${h.updated_products ?? '—'}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:var(--muted);font-size:.72rem">${h.skipped ?? '—'}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:${statusColor};font-weight:700;font-size:.72rem">${statusLabel}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:var(--muted);font-size:.68rem">${h.filename || '—'}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:var(--muted);font-size:.68rem">${h.document_id || '—'}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--red);font-size:.8rem">❌ Erro: ${err.message}</td></tr>`;
  }
}


// ── Categorização por PDF ──────────────────────────────────────────────────
function onDropCat(e) {
  e.preventDefault();
  offDrag('cat');
  const file = e.dataTransfer.files[0];
  if (file) processCatPdf(file);
}

function handleCatFile() {
  const input = document.getElementById('file-cat');
  if (input.files[0]) processCatPdf(input.files[0]);
}

function clearCatPreview() {
  document.getElementById('cat-preview').style.display = 'none';
  document.getElementById('cat-preview').innerHTML = '';
  const s = document.getElementById('status-cat');
  s.textContent = 'Nenhum arquivo selecionado.';
  s.className = 'pdf-status';
  document.getElementById('file-cat').value = '';
}

async function processCatPdf(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    document.getElementById('status-cat').textContent = '❌ Apenas arquivos PDF.';
    return;
  }
  const catInput = document.getElementById('cat-name');
  if (!catInput.value.trim()) {
    const auto = file.name.split('_')[0].replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, '').trim();
    if (auto) catInput.value = auto;
  }
  const s = document.getElementById('status-cat');
  s.className = 'pdf-status';
  s.textContent = `Processando "${file.name}"…`;

  const form = new FormData();
  form.append('pdf', file);
  let res, data;
  try {
    res  = await fetch(BASE + '/api/documents/categorize', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form,
    });
    data = await res.json();
  } catch (err) {
    s.textContent = '❌ Erro de rede: ' + err.message;
    return;
  }
  if (!res.ok) { s.textContent = '❌ ' + (data.error || 'Erro'); return; }

  document.getElementById('file-cat').value = '';
  const cat = catInput.value.trim() || '(sem nome)';
  const preview = document.getElementById('cat-preview');
  preview.style.display = 'block';

  if (!data.found) {
    preview.innerHTML = `<div style="color:var(--amber);font-size:.75rem">Nenhum código do PDF encontrado no banco. Total no PDF: ${data.total}.</div>`;
    s.textContent = 'Nenhum produto encontrado.';
    return;
  }

  const codesJson = JSON.stringify(data.codes);
  preview.innerHTML = `
    <div style="font-size:.73rem;font-weight:600;margin-bottom:.5rem">${data.found} de ${data.total} código(s) do PDF encontrados no banco.</div>
    <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-bottom:.75rem">
      <table style="width:100%;font-size:.68rem;border-collapse:collapse">
        <thead><tr>
          <th style="padding:.3rem .75rem;text-align:left;background:var(--surface);font-size:.6rem;color:var(--muted);border-bottom:1px solid var(--border)">Código</th>
          <th style="padding:.3rem .75rem;text-align:left;background:var(--surface);font-size:.6rem;color:var(--muted);border-bottom:1px solid var(--border)">Nome</th>
          <th style="padding:.3rem .75rem;text-align:left;background:var(--surface);font-size:.6rem;color:var(--muted);border-bottom:1px solid var(--border)">Categoria atual</th>
        </tr></thead>
        <tbody>${data.products.map(p => `<tr>
          <td style="padding:.35rem .75rem;border-bottom:1px solid var(--border);font-weight:600">${p.id}</td>
          <td style="padding:.35rem .75rem;border-bottom:1px solid var(--border)">${p.name}</td>
          <td style="padding:.35rem .75rem;border-bottom:1px solid var(--border);color:var(--muted)">${p.categoria || '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <button class="btn-sm btn-primary" onclick='applyCatUpdate(${codesJson})'>
      ✅ Atribuir categoria "<strong>${cat}</strong>" a ${data.found} produto(s)
    </button>
  `;
  s.textContent = `${data.found} produto(s) prontos para categorizar como "${cat}". Confirme abaixo.`;
}

async function applyCatUpdate(codes) {
  const cat = document.getElementById('cat-name').value.trim();
  if (!cat) { alert('Digite o nome da categoria antes de confirmar.'); return; }
  let res, data;
  try {
    res  = await fetch(BASE + '/api/documents/set-category', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, categoria: cat }),
    });
    data = await res.json();
  } catch (err) { alert('Erro: ' + err.message); return; }
  if (!res.ok) { alert('Erro: ' + (data.error || 'Erro')); return; }
  const preview = document.getElementById('cat-preview');
  preview.innerHTML = `<div style="color:var(--green);font-weight:700;font-size:.8rem">✅ Categoria "${cat}" atribuída a ${data.updated} produto(s).</div>`;
  const s = document.getElementById('status-cat');
  s.textContent = `✅ ${data.updated} produtos atualizados.`;
  s.className = 'pdf-status ok';
}

// ── Init ───────────────────────────────────────────────────────────────────
// Restaura filtros salvos
const _savedQ = localStorage.getItem('gp_admin_q') || '';
if (_savedQ) document.getElementById('prod-q').value = _savedQ;
_restoreFilterButtons();

// Restaura a seção que estava aberta (hash routing)
const initHash = location.hash.replace('#', '');
const initPage = VALID_PAGES.includes(initHash) ? initHash : 'dashboard';
navigate(initPage);
// Carrega stats e action-stats explicitamente — navigate é síncrono, loadStats é async
loadStats();
loadActionStats();