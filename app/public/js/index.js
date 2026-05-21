// ── Auth ───────────────────────────────────────────────────────────────────
const BASE = window.APP_BASE || '';
const token = localStorage.getItem('gp_token');
const user  = JSON.parse(localStorage.getItem('gp_user') || 'null');

function renderAuthActions() {
  const el = document.getElementById('auth-actions');
  if (user) {
    el.innerHTML = (user.role === 'admin' ? `<a class="btn-admin" href="${BASE}/admin">⚙ Admin</a>` : '')
      + `<button class="btn-login" onclick="logout()">Sair (${user.username})</button>`;
  } else {
    el.innerHTML = `<a class="btn-login" href="${BASE}/login.html">Entrar</a>`;
  }
}
function logout() {
  _sessionClear();
  localStorage.removeItem('gp_token'); localStorage.removeItem('gp_user'); location.reload();
}
if (token) _sessionInit(logout);

// ── State ──────────────────────────────────────────────────────────────────
const _mpSvgDefault = document.getElementById('mp-svg')?.innerHTML || '';
let currentPage = 1, currentTotal = 0, loading = false;
let _fetchController = null, _fetchGen = 0;
const LIMIT = 24;
let currentDisabled  = localStorage.getItem('gp_catalog_disabled') || '';
let currentQ         = localStorage.getItem('gp_catalog_q')        || '';
let currentCatLabel  = localStorage.getItem('gp_catalog_cat') || '';

// Modal image state
let modalProductId       = null;
let modalImages          = [];   // [{id, url, is_pinned}, ...]
let modalImgIndex        = 0;    // index da foto exibida
let _modalGen            = 0;    // geração do modal — evita race condition entre aberturas
let _modalProductName       = '';
let _modalProductCategoria  = '';
let _modalProductIsDisabled = 0;

// ── Fetch helpers ──────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const baseUrl = window.APP_BASE || '';
  const r = await fetch(baseUrl + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  return r.json();
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function fetchStats() {
  const s = await apiFetch('/api/products/stats');
  document.getElementById('st').textContent = s.total.toLocaleString('pt-BR');
  document.getElementById('si').textContent = s.iguais.toLocaleString('pt-BR');
  document.getElementById('sd').textContent = s.divergentes.toLocaleString('pt-BR');
}

// ── Products list ──────────────────────────────────────────────────────────
async function fetchProducts(page = 1, reset = false) {
  // Troca de filtro/busca cancela a requisição anterior e assume o controle
  if (reset && _fetchController) {
    _fetchController.abort();
    _fetchController = null;
    loading = false;
  }

  if (loading) return;
  loading = true;
  document.getElementById('lm').disabled = true;

  const myGen = ++_fetchGen;
  const maxAttempts = reset ? 3 : 1;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (myGen !== _fetchGen) break; // requisição mais nova assumiu o controle
    if (attempt > 1) await new Promise(r => setTimeout(r, 1500 * (attempt - 1)));
    if (myGen !== _fetchGen) break;

    const controller = new AbortController();
    _fetchController = controller;
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const params = new URLSearchParams({ q: currentQ, status: 'T', page, limit: LIMIT });
      if (currentDisabled !== '') params.append('disabled', currentDisabled);
      if (currentCatLabel) params.append('cat', currentCatLabel);
      const data = await apiFetch('/api/products?' + params, { signal: controller.signal });

      if (!data || !Array.isArray(data.products)) throw new Error('Resposta inválida da API');

      if (myGen !== _fetchGen) break;

      currentTotal = data.total; currentPage = data.page;
      if (reset) document.getElementById('grid').innerHTML = '';
      renderCards(data.products);
      updateCounts(data.total, data.products.length, reset ? 0 : (page - 1) * LIMIT);

      const hasMore = page * LIMIT < currentTotal;
      document.getElementById('lmw').style.display = hasMore ? '' : 'none';
      lastErr = null;
      break;
    } catch (err) {
      if (myGen !== _fetchGen) break; // cancelado por requisição mais nova, para silenciosamente
      console.error(`Erro ao carregar produtos (tentativa ${attempt}/${maxAttempts}):`, err);
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }

  if (myGen !== _fetchGen) return; // outra requisição assumiu — não toca no estado

  if (lastErr && reset) {
    document.getElementById('grid').innerHTML =
      '<div class="empty"><h3>Erro ao carregar produtos</h3><p>Verifique a conexão ou recarregue a página.</p></div>';
  }

  document.getElementById('lm').disabled = false;
  loading = false;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = n => n != null ? 'R$ ' + Number(n).toFixed(2).replace('.', ',') : '—';
function badge(s) {
  if (s === 0) return '<span class="badge badge-eq">Igual</span>';
  if (s === 1) return '<span class="badge badge-diff">Divergente</span>';
  return '<span class="badge badge-fi">Só Fiscal</span>';
}
// ── Render cards ───────────────────────────────────────────────────────────
function renderCards(products) {
  const grid = document.getElementById('grid');
  if (!products.length && grid.children.length === 0) {
    grid.innerHTML = '<div class="empty"><h3>Nenhum produto encontrado</h3><p>Tente outros termos de busca.</p></div>';
    return;
  }
  products.forEach(p => {
    const div = document.createElement('div');
    div.className = 'card'; div.dataset.id = p.id;
    div.innerHTML = `
      <div class="card-img">
        ${p.pinned_img
          ? `<img class="ci-photo" data-src="${p.pinned_img}" alt="" loading="lazy">`
          : getCategoryPlaceholder(p.name, p.categoria, p.is_disabled)}
        <div class="card-ref">#${p.id}</div>
      </div>
      <div class="card-body">
        <div class="card-code">
          <span>Ref. ${p.id}</span>
          ${p.categoria ? `<span class="card-cat">${p.categoria}</span>` : ''}
        </div>
        <div class="card-name">${p.name}</div>
        <div class="card-footer">
          <div class="card-price">${fmt(p.price_fiscal)}</div>
          ${badge(p.status)}
        </div>
        <div class="card-stock">Est. Gerencial: <b>${p.snap_stock_mgmt != null ? Number(p.snap_stock_mgmt).toLocaleString('pt-BR') : '—'}</b></div>
        <div class="card-stock">Est. Real: <b>${p.stock_real != null ? Number(p.stock_real).toLocaleString('pt-BR') : '—'}</b></div>
      </div>`;
    div.addEventListener('click', () => openModal(p.id));
    grid.appendChild(div);
    
    // Lazy loading para imagens
    const img = div.querySelector('.ci-photo');
    if (img) {
      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const img = entry.target;
              img.src = img.dataset.src;
              img.classList.add('show');
              observer.unobserve(img);
            }
          });
        });
        observer.observe(img);
      } else {
        // Fallback para browsers antigos
        img.src = img.dataset.src;
        img.classList.add('show');
      }
    }
  });
}

function calculateModalDiscount(input) {
  const price = parseFloat(input.dataset.price);
  const discountPercent = parseFloat(input.value) || 0;
  const discountDisplay = document.getElementById('modal-discount-price');
  
  if (isNaN(price) || discountPercent < 0 || discountPercent > 100) {
    discountDisplay.textContent = '—';
    return;
  }
  
  const discountedPrice = price * (1 - discountPercent / 100);
  discountDisplay.textContent = fmt(discountedPrice);
  
  // Adicionar classe visual para desconto aplicado
  if (discountPercent > 0) {
    discountDisplay.style.color = 'var(--accent)';
    discountDisplay.style.fontWeight = '700';
  } else {
    discountDisplay.style.color = 'var(--accent)';
    discountDisplay.style.fontWeight = '700';
  }
}

function updateCounts(total, fetched, offset) {
  document.getElementById('rc').textContent = Math.min(offset + fetched, total).toLocaleString('pt-BR');
  document.getElementById('rtotal').textContent = total.toLocaleString('pt-BR');
}

// ── Modal ──────────────────────────────────────────────────────────────────
function setBadge(text, cls) {
  const el = document.getElementById('img-src-badge');
  el.textContent = text; el.className = 'img-source-badge ' + cls;
}

let _showImgTimer = null;
function showMainImg(index) {
  if (!modalImages.length) return;
  const img = modalImages[index];
  const mpImg = document.getElementById('mp-img');
  const mImg  = document.getElementById('m-img');
  // Troca suave: cancela timer anterior, apaga, troca src, acende
  clearTimeout(_showImgTimer);
  mpImg.classList.remove('on');
  _showImgTimer = setTimeout(() => {
    mImg.src = img.url;
    mpImg.classList.add('on');
  }, 150);

  // Highlight thumb
  document.querySelectorAll('.thumb').forEach((t, i) => t.classList.toggle('sel', i === index));

  // Counter
  const counter = document.getElementById('mp-counter');
  counter.textContent = `${index + 1} / ${modalImages.length}`;
  counter.style.display = modalImages.length > 1 ? '' : 'none';

  // Nav arrows
  const show = modalImages.length > 1;
  document.getElementById('mp-prev').style.display = show ? 'flex' : 'none';
  document.getElementById('mp-next').style.display = show ? 'flex' : 'none';

  // Pin / delete buttons (only for authenticated users)
  if (user) {
    const pinBtn = document.getElementById('btn-pin');
    pinBtn.style.display = '';
    pinBtn.classList.toggle('active', !!img.is_pinned);
    pinBtn.textContent = img.is_pinned ? '★ Fixada como capa' : '★ Fixar como capa';
    document.getElementById('btn-del-img').style.display = '';
  }

  document.getElementById('img-tip').style.display = '';
  modalImgIndex = index;
}

function buildThumbs() {
  const strip = document.getElementById('thumb-strip');
  strip.innerHTML = '';

  if (!modalImages.length) {
    strip.innerHTML = '<span class="no-imgs">Nenhuma imagem encontrada</span>';
    document.getElementById('img-tip').style.display = 'none';
    document.getElementById('mp-nav');
    document.getElementById('mp-prev').style.display = 'none';
    document.getElementById('mp-next').style.display = 'none';
    document.getElementById('mp-counter').style.display = 'none';
    return;
  }

  modalImages.forEach((img, i) => {
    const t = document.createElement('div');
    t.className = 'thumb' + (img.is_pinned ? ' pinned' : '') + (i === 0 ? ' sel' : '');
    t.dataset.index = i;
    t.innerHTML = `<img src="${img.url}" alt="" loading="lazy">`;
    t.addEventListener('click', () => showMainImg(i));
    strip.appendChild(t);
  });
}

async function openModal(id) {
  const gen = ++_modalGen;   // cada abertura tem número único
  modalProductId = id;
  modalImages    = [];
  modalImgIndex  = 0;

  // Reset UI
  document.getElementById('mo').classList.add('open');
  document.getElementById('m-name').textContent       = '…';
  document.getElementById('m-info-name').textContent  = '…';
  document.getElementById('m-code').textContent       = '—';
  document.getElementById('m-cat').textContent        = '';
  document.getElementById('m-stats').innerHTML        = '';
  document.getElementById('mp-img').classList.remove('on');
  document.getElementById('m-img').src                = '';
  document.getElementById('ph-loader').classList.remove('off');
  document.getElementById('loader-txt').textContent   = 'Carregando produto…';
  document.getElementById('thumb-strip').innerHTML    = '';
  document.getElementById('img-tip').style.display   = 'none';
  document.getElementById('btn-pin').style.display   = 'none';
  document.getElementById('btn-del-img').style.display = 'none';
  document.getElementById('mp-prev').style.display   = 'none';
  document.getElementById('mp-next').style.display   = 'none';
  document.getElementById('mp-counter').style.display = 'none';
  document.getElementById('btn-refresh').style.display = 'none';
  setBadge('', '');

  // Load product info
  let p;
  try {
    p = await apiFetch('/api/products/' + id);
  } catch {
    if (gen !== _modalGen) return;
    document.getElementById('ph-loader').classList.add('off');
    document.getElementById('m-name').textContent     = 'Erro ao carregar';
    document.getElementById('m-info-name').textContent = '';
    setBadge('Erro', 'isb-none');
    return;
  }
  if (gen !== _modalGen) return;

  _modalProductName       = p.name || '';
  _modalProductCategoria  = p.categoria || '';
  _modalProductIsDisabled = p.is_disabled || 0;
  const mpSvgEl = document.getElementById('mp-svg');
  if (mpSvgEl && typeof getCategorySvgPath === 'function') {
    const svgPath = getCategorySvgPath(_modalProductCategoria, _modalProductIsDisabled);
    mpSvgEl.innerHTML = svgPath
      ? `<img src="${svgPath}" alt="" class="mp-svg-img">`
      : _mpSvgDefault;
  }
  document.getElementById('m-name').textContent      = p.name;
  document.getElementById('m-info-name').textContent = p.name;
  document.getElementById('m-code').textContent      = 'Ref. ' + p.id;
  document.getElementById('m-cat').textContent       = p.categoria || '';

  const snapMgmt = p.snap_stock_mgmt;
  const snapDiff = (p.stock_fiscal != null && snapMgmt != null)
    ? +(snapMgmt - p.stock_fiscal).toFixed(2) : null;
  const realDiff = (p.stock_fiscal != null && p.stock_real != null)
    ? +(p.stock_real - p.stock_fiscal).toFixed(2) : null;
  const dc = snapDiff != null && snapDiff < 0 ? 'val-red' : 'val-green';
  const rc = realDiff != null && realDiff < 0 ? 'val-red' : 'val-green';
  // Usar preço do PDF se price_mgmt for null
  const precoGerencial = p.price_mgmt != null ? p.price_mgmt : p.snap_price_mgmt;
  document.getElementById('m-stats').innerHTML = `
    <div class="info-box fiscal"><label>Preço Fiscal</label><div class="val">${fmt(p.price_fiscal)}</div></div>
    <div class="info-box fiscal"><label>Estoque Fiscal</label><div class="val">${p.stock_fiscal != null ? Number(p.stock_fiscal).toLocaleString('pt-BR') : '—'}</div></div>
    <div class="info-box mgmt"><label>Preço Gerencial</label><div class="val">${fmt(precoGerencial)}</div></div>
    <div class="info-box mgmt"><label>Estoque Gerencial (PDF)</label><div class="val">${snapMgmt != null ? Number(snapMgmt).toLocaleString('pt-BR') : '—'}</div></div>
    <div class="info-box discount"><label>Preço com Desconto</label>
      <div class="discount-calculator">
        <input type="number" id="modal-discount-input" placeholder="% desc" min="0" max="100" step="1" data-price="${p.price_fiscal}" class="modal-discount-input">
        <div id="modal-discount-price" class="modal-discount-price">—</div>
      </div>
    </div>
    <div class="info-box real"><label>Estoque Real</label><div class="val">${p.stock_real != null ? Number(p.stock_real).toLocaleString('pt-BR') : '—'}</div></div>
    ${snapDiff != null ? `<div class="info-box info-full"><label>Diferença (Ger − Fis)</label><div class="val ${dc}">${snapDiff > 0 ? '+' : ''}${snapDiff} un.</div></div>` : ''}
    ${realDiff != null ? `<div class="info-box info-full"><label>Diferença (Real − Fis)</label><div class="val ${rc}">${realDiff > 0 ? '+' : ''}${realDiff} un.</div></div>` : ''}
    <div class="info-box info-full"><label>Status</label>${badge(p.status)}</div>`;

  // Configurar evento de input para desconto no modal
  const modalDiscountInput = document.getElementById('modal-discount-input');
  if (modalDiscountInput) {
    modalDiscountInput.addEventListener('input', (e) => {
      calculateModalDiscount(e.target);
    });
  }

  // Load images: se já tem no banco mostra imediatamente, senão busca Google
  if (p.images && p.images.length) {
    if (gen !== _modalGen) return; // modal mais novo abriu — descarta
    modalImages = p.images;
    document.getElementById('ph-loader').classList.add('off');
    setBadge('⚡ Cache', 'isb-db');
    buildThumbs();
    showMainImg(0);
    document.getElementById('btn-refresh').style.display = '';
  } else {
    // Busca Google (server-side)
    document.getElementById('loader-txt').textContent = 'Buscando imagens no Google…';
    setBadge('🔍 Buscando…', 'isb-searching');
    try {
      const result = await apiFetch('/api/products/' + id + '/search-images');
      if (gen !== _modalGen) return; // modal mais novo abriu — descarta
      modalImages = result.images || [];
      document.getElementById('ph-loader').classList.add('off');

      if (modalImages.length) {
        setBadge('✓ Google Images', 'isb-google');
        buildThumbs();
        showMainImg(0);
        updateCardImg(id, modalImages.find(i => i.is_pinned)?.url || modalImages[0]?.url);
      } else {
        setBadge('Sem fotos', 'isb-none');
        buildThumbs();
      }
      document.getElementById('btn-refresh').style.display = '';
    } catch {
      if (gen !== _modalGen) return;
      document.getElementById('ph-loader').classList.add('off');
      setBadge('Erro', 'isb-none');
    }
  }
}

// Atualiza o card no grid após obter imagem
function updateCardImg(id, url) {
  if (!url) return;
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const imgWrap = card.querySelector('.card-img');
  let img = imgWrap.querySelector('.ci-photo');
  if (!img) {
    imgWrap.innerHTML = `<img class="ci-photo" src="" alt="" loading="lazy"><div class="card-ref">#${id}</div>`;
    img = imgWrap.querySelector('.ci-photo');
  }
  img.src = url;
  img.classList.add('show');
  const svg = imgWrap.querySelector('svg');
  if (svg) svg.style.opacity = '0';
}

// ── Pin button ─────────────────────────────────────────────────────────────
document.getElementById('btn-pin').addEventListener('click', async () => {
  if (!token || !modalImages.length) return;
  const img = modalImages[modalImgIndex];
  if (img.is_pinned) return; // já está fixada
  try {
    await apiFetch(`/api/products/${modalProductId}/images/${img.id}/pin`, { method: 'PUT' });
    // Atualiza estado local
    modalImages.forEach(i => i.is_pinned = 0);
    img.is_pinned = 1;
    buildThumbs();
    showMainImg(modalImgIndex);
    updateCardImg(modalProductId, img.url);
    showToast('★ Imagem fixada como capa!');
  } catch {
    showToast('Erro ao fixar imagem');
  }
});

// ── Delete image ───────────────────────────────────────────────────────────
document.getElementById('btn-del-img').addEventListener('click', async () => {
  if (!token || !modalImages.length) return;
  const img = modalImages[modalImgIndex];
  if (!confirm('Remover esta imagem do produto?')) return;
  try {
    await apiFetch(`/api/products/${modalProductId}/images/${img.id}`, { method: 'DELETE' });
    modalImages.splice(modalImgIndex, 1);
    if (!modalImages.length) {
      buildThumbs();
      document.getElementById('mp-img').classList.remove('on');
      document.getElementById('m-img').src = '';
      document.getElementById('btn-pin').style.display = 'none';
      document.getElementById('btn-del-img').style.display = 'none';
      setBadge('Sem fotos', 'isb-none');
    } else {
      buildThumbs();
      showMainImg(Math.min(modalImgIndex, modalImages.length - 1));
    }
    showToast('Imagem removida');
  } catch {
    showToast('Erro ao remover imagem');
  }
});

// ── Refresh images (limpa cache e rebusca) ─────────────────────────────────
document.getElementById('btn-refresh').addEventListener('click', async () => {
  if (!confirm('Remover as imagens atuais e buscar novas no Google?')) return;
  await apiFetch(`/api/products/${modalProductId}/images`, { method: 'DELETE' });
  modalImages = [];
  buildThumbs();
  document.getElementById('mp-img').classList.remove('on');
  document.getElementById('ph-loader').classList.remove('off');
  document.getElementById('loader-txt').textContent = 'Buscando novas imagens…';
  setBadge('🔍 Buscando…', 'isb-searching');

  const result = await apiFetch('/api/products/' + modalProductId + '/search-images');
  modalImages = result.images || [];
  document.getElementById('ph-loader').classList.add('off');

  if (modalImages.length) {
    setBadge('✓ Google Images', 'isb-google');
    buildThumbs();
    showMainImg(0);
    updateCardImg(modalProductId, modalImages.find(i => i.is_pinned)?.url || modalImages[0]?.url);
  } else {
    setBadge('Sem fotos', 'isb-none');
  }
  showToast('Imagens atualizadas');
});

// ── Nav arrows ─────────────────────────────────────────────────────────────
document.getElementById('mp-prev').addEventListener('click', () => {
  if (modalImages.length < 2) return;
  showMainImg((modalImgIndex - 1 + modalImages.length) % modalImages.length);
});
document.getElementById('mp-next').addEventListener('click', () => {
  if (modalImages.length < 2) return;
  showMainImg((modalImgIndex + 1) % modalImages.length);
});

// Teclado: ← → para navegar
document.addEventListener('keydown', e => {
  if (!document.getElementById('mo').classList.contains('open')) return;
  if (e.key === 'Escape')      document.getElementById('mo').classList.remove('open');
  if (e.key === 'ArrowLeft')   document.getElementById('mp-prev').click();
  if (e.key === 'ArrowRight')  document.getElementById('mp-next').click();
});

// ── Search debounce ────────────────────────────────────────────────────────
let debTimer;
document.getElementById('q').addEventListener('input', e => {
  clearTimeout(debTimer);
  document.getElementById('qc').style.display = e.target.value ? '' : 'none';
  debTimer = setTimeout(() => {
    currentQ = e.target.value;
    localStorage.setItem('gp_catalog_q', currentQ);
    fetchProducts(1, true);
  }, 380);
});
document.getElementById('qc').addEventListener('click', () => {
  document.getElementById('q').value = '';
  document.getElementById('qc').style.display = 'none';
  currentQ = '';
  localStorage.removeItem('gp_catalog_q');
  fetchProducts(1, true);
});

// ── Filters ────────────────────────────────────────────────────────────────
document.querySelectorAll('#cat-disabled-group .fb').forEach(b => {
  b.addEventListener('click', () => {
    currentDisabled = b.dataset.disabled;
    localStorage.setItem('gp_catalog_disabled', currentDisabled);
    document.querySelectorAll('#cat-disabled-group .fb').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    fetchProducts(1, true);
  });
});

// ── Load more ──────────────────────────────────────────────────────────────
document.getElementById('lm').addEventListener('click', () => fetchProducts(currentPage + 1, false));

// ── Modal close ────────────────────────────────────────────────────────────
document.getElementById('mcls').addEventListener('click', () => document.getElementById('mo').classList.remove('open'));
document.getElementById('mo').addEventListener('click', e => {
  if (e.target === document.getElementById('mo')) document.getElementById('mo').classList.remove('open');
});

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Category autocomplete — dropdown customizado ───────────────────────────
let _allCats = [];

function _applyCatFilter(val) {
  currentCatLabel = val;
  document.getElementById('cat-filter').value = val;
  document.getElementById('cat-clear').style.display = val ? '' : 'none';
  if (val) localStorage.setItem('gp_catalog_cat', val);
  else localStorage.removeItem('gp_catalog_cat');
  document.getElementById('cat-dropdown').hidden = true;
  fetchProducts(1, true);
}

(async function buildCatFilter() {
  try {
    const r = await fetch(BASE + '/api/products/categories');
    const d = await r.json();
    _allCats = d.categories || [];
  } catch (_) {}
  if (currentCatLabel) {
    document.getElementById('cat-filter').value = currentCatLabel;
    document.getElementById('cat-clear').style.display = '';
  }
})();

function _renderCatDropdown(q) {
  const dd = document.getElementById('cat-dropdown');
  const lc = q.toLowerCase();
  const opts = [{ label: 'Todas as categorias', value: '' },
    ..._allCats.map(c => ({ label: c, value: c }))];
  const visible = lc ? opts.filter(o => o.label.toLowerCase().includes(lc)) : opts;
  if (!visible.length) { dd.hidden = true; return; }
  dd.innerHTML = visible.map(o =>
    `<div class="cat-option${o.value === currentCatLabel ? ' cat-selected' : ''}" data-val="${o.value}">${o.label}</div>`
  ).join('');
  dd.hidden = false;
}

document.getElementById('cat-filter').addEventListener('focus', function () {
  _renderCatDropdown(this.value.trim());
});
document.getElementById('cat-filter').addEventListener('input', function () {
  _renderCatDropdown(this.value.trim());
});
document.getElementById('cat-dropdown').addEventListener('mousedown', function (e) {
  const opt = e.target.closest('.cat-option');
  if (!opt) return;
  e.preventDefault();
  _applyCatFilter(opt.dataset.val);
});
document.getElementById('cat-filter').addEventListener('blur', function () {
  setTimeout(() => { document.getElementById('cat-dropdown').hidden = true; }, 150);
});
document.getElementById('cat-filter').addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    this.value = currentCatLabel;
    document.getElementById('cat-dropdown').hidden = true;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const first = document.querySelector('#cat-dropdown .cat-option');
    if (!first) return;
    _applyCatFilter(first.dataset.val);
  }
});
document.getElementById('cat-clear').addEventListener('mousedown', function (e) {
  e.preventDefault();
  _applyCatFilter('');
});

// ── Init ───────────────────────────────────────────────────────────────────
if (currentQ) {
  document.getElementById('q').value = currentQ;
  document.getElementById('qc').style.display = '';
}
document.querySelectorAll('#cat-disabled-group .fb').forEach(b =>
  b.classList.toggle('active', b.dataset.disabled === currentDisabled));
renderAuthActions();
fetchStats();
fetchProducts(1, true);

// Quando o browser restaura a página do bfcache (botão voltar), refaz o fetch.
// Sem isso, "loading" pode ficar true e o grid ficar vazio.
window.addEventListener('pageshow', e => {
  if (e.persisted) {
    loading = false;
    fetchProducts(1, true);
  }
});