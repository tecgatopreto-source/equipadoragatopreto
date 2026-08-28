// ── Auth guard ─────────────────────────────────────────────────────────────
const BASE = document.documentElement.dataset.base || "";
function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const user = JSON.parse(localStorage.getItem("gp_user") || "null");
if (!user || user.role !== "admin") {
  location.href = BASE + "/login.html";
}
document.getElementById("uname").textContent = user ? user.username : "";

async function logout() {
  try {
    await fetch(BASE + "/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch (_) {}
  localStorage.removeItem("gp_user");
  location.href = BASE + "/login.html";
}

// ── Sidebar mobile toggle ──────────────────────────────────────────────────
function toggleSidebar() {
  document.querySelector(".sidebar").classList.toggle("open");
}
document.addEventListener("click", (e) => {
  const sidebar = document.querySelector(".sidebar");
  if (
    sidebar.classList.contains("open") &&
    !sidebar.contains(e.target) &&
    !document.getElementById("menu-toggle").contains(e.target)
  ) {
    sidebar.classList.remove("open");
  }
});

// ── Navigation ─────────────────────────────────────────────────────────────
const VALID_PAGES = [
  "dashboard",
  "products",
  "report",
  "deactivate",
  "pdfs",
  "users",
];

function navigate(page) {
  if (!VALID_PAGES.includes(page)) page = "dashboard";
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  document.querySelector(`[data-page="${page}"]`).classList.add("active");
  history.replaceState(null, "", "#" + page);
  document.querySelector(".sidebar").classList.remove("open");
  if (page === "products") {
    _restoreFilterButtons();
    loadCatFilter();
    loadProducts(1);
  }
  if (page === "dashboard") loadStats();
  if (page === "report") {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("rpt-from").value = today;
    document.getElementById("rpt-to").value = today;
    loadReport();
  }
  if (page === "deactivate") {
    // Padrão: mostra apenas mudanças de hoje
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("dact-from").value = today;
    document.getElementById("dact-to").value = today;
    document.getElementById("dact-flag").value = "";
    loadDeactivate();
  }
  if (page === "pdfs") loadImportHistory();
  if (page === "users") loadUsers();
}

function openDeactivateFlag(flag) {
  navigate("deactivate");
  document.getElementById("dact-flag").value = flag;
  loadDeactivate();
}

function goToProductsWithStatus(status) {
  _applyStatusFilter(status);
  navigate("products");
}

// ── API helper ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(BASE + "/api" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }
  if (res.status === 401) {
    localStorage.removeItem("gp_user");
    location.href = BASE + "/login.html";
    return;
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api("GET", "/products/stats");
    document.getElementById("ds-total").textContent = (
      s.total ?? 0
    ).toLocaleString("pt-BR");
    document.getElementById("ds-iguais").textContent = (
      s.iguais ?? 0
    ).toLocaleString("pt-BR");
    document.getElementById("ds-div").textContent = (
      s.divergentes ?? 0
    ).toLocaleString("pt-BR");
    document.getElementById("ds-fi").textContent = (
      s.so_fiscal ?? 0
    ).toLocaleString("pt-BR");
    loadActionStats();
  } catch {
    /* ignora — stats ficam em "—" */
  }
}

async function loadActionStats() {
  try {
    const a = await api("GET", "/products/action-stats");
    document.getElementById("ac-alteracoes").textContent =
      a.alteracoes.toLocaleString("pt-BR");
    document.getElementById("ac-desativar").textContent =
      a.desativar.toLocaleString("pt-BR");
    document.getElementById("ac-atualizar").textContent =
      a.atualizar.toLocaleString("pt-BR");
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
  const realInput = document.getElementById("f-sreal");
  const warnEl = document.getElementById("fiscal-warning-msg");
  const okEl = document.getElementById("fiscal-ok-msg");
  const raw = realInput.value;

  if (raw === "") {
    warnEl.classList.remove("show");
    okEl.style.display = "none";
    return;
  }

  const real = parseFloat(raw);

  if (real < 0) {
    realInput.style.borderColor = "var(--red)";
    warnEl.classList.remove("show");
    okEl.style.display = "none";
    return;
  }
  realInput.style.borderColor = "var(--accent)";

  if (real === 0) {
    warnEl.classList.add("show");
    okEl.style.display = "none";
  } else {
    warnEl.classList.remove("show");
    okEl.style.display = "block";
  }
}

// ── Products table ─────────────────────────────────────────────────────────
let prodPage = 1;
const LIMIT = 25;
let debTimer;
let filterTimer;
let _loadReqId = 0;
let sortCol = "id";
let sortDir = "asc";
let alertFilter = false;
let statusFilter = localStorage.getItem("gp_admin_status") ?? "T";
let disabledFilter = localStorage.getItem("gp_admin_disabled") ?? "";
let catFilter = localStorage.getItem("gp_admin_cat") ?? "";

function _applyStatusFilter(val) {
  statusFilter = val;
  localStorage.setItem("gp_admin_status", val);
  document
    .querySelectorAll("#status-group .filter-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.val === val));
}

function setStatusFilter(val) {
  _applyStatusFilter(val);
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => loadProducts(1), 150);
}

function setDisabledFilter(val) {
  disabledFilter = val;
  localStorage.setItem("gp_admin_disabled", val);
  document
    .querySelectorAll("#disabled-group .filter-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.val === val));
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => loadProducts(1), 150);
}

function _restoreFilterButtons() {
  document
    .querySelectorAll("#status-group .filter-btn")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.val === statusFilter),
    );
  document
    .querySelectorAll("#disabled-group .filter-btn")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.val === disabledFilter),
    );
}

let _cachedCategories = [];

async function _fetchCategories() {
  try {
    const data = await api("GET", "/products/categories");
    _cachedCategories = data.categories || [];
  } catch (_) {}
  return _cachedCategories;
}

function _renderAdminCatDropdown(q) {
  const dd = document.getElementById("cat-group-dropdown");
  const lc = q.toLowerCase();
  const opts = [
    { label: "Todas as categorias", value: "" },
    ..._cachedCategories.map((c) => ({ label: c, value: c })),
  ];
  const visible = lc
    ? opts.filter((o) => o.label.toLowerCase().includes(lc))
    : opts;
  if (!visible.length) {
    dd.hidden = true;
    return;
  }
  dd.innerHTML = visible
    .map(
      (o) =>
        `<div class="cat-option${o.value === catFilter ? " cat-selected" : ""}" data-val="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`,
    )
    .join("");
  dd.hidden = false;
}

async function loadCatFilter() {
  await _fetchCategories();
  const input = document.getElementById("cat-group");
  if (catFilter) input.value = catFilter;
}

function _populateFormCatSelect(currentCat) {
  const sel = document.getElementById("f-cat");
  sel.innerHTML =
    '<option value="">Sem categoria</option>' +
    _cachedCategories
      .map(
        (c) =>
          `<option value="${c}"${c === currentCat ? " selected" : ""}>${c}</option>`,
      )
      .join("");
}

function setCatFilter(val) {
  catFilter = val;
  document.getElementById("cat-group").value = val;
  const clr = document.getElementById("cat-group-clear");
  if (clr) clr.style.display = val ? "" : "none";
  if (catFilter) localStorage.setItem("gp_admin_cat", catFilter);
  else localStorage.removeItem("gp_admin_cat");
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => loadProducts(1), 150);
}

function debSearch() {
  clearTimeout(debTimer);
  debTimer = setTimeout(() => {
    const nameVal = document.getElementById("prod-q-name").value;
    const codeVal = document.getElementById("prod-q-code").value;
    if (nameVal) localStorage.setItem("gp_admin_name_q", nameVal);
    else localStorage.removeItem("gp_admin_name_q");
    if (codeVal) localStorage.setItem("gp_admin_code_q", codeVal);
    else localStorage.removeItem("gp_admin_code_q");
    loadProducts(1);
  }, 600);
}

function toggleAlertFilter() {
  alertFilter = !alertFilter;
  const btn = document.getElementById("btn-alert-filter");
  btn.style.background = alertFilter ? "var(--amber)" : "";
  btn.style.color = alertFilter ? "#fff" : "";
  btn.style.borderColor = alertFilter ? "var(--amber)" : "";
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => loadProducts(1), 150);
}

const fmt = (n) =>
  n != null ? "R$ " + Number(n).toFixed(2).replace(".", ",") : "—";
function badge(s) {
  if (s === 0) return '<span class="badge badge-eq">Igual</span>';
  if (s === 1) return '<span class="badge badge-diff">Divergente</span>';
  return '<span class="badge badge-fi">Só Fiscal</span>';
}

function pctCell(pct) {
  if (pct == null) return '<td class="pct-cell">—</td>';
  const v = Math.round(pct);
  const cls = v === 0 ? "pct-low" : v <= 30 ? "pct-mid" : "pct-high";
  return `<td class="pct-cell ${cls}">${v}%</td>`;
}

function diffCell(pct, a, b) {
  if (a == null || b == null)
    return '<td class="pct-cell" style="color:var(--muted2)">—</td>';
  const delta = a - b;
  const pctV = pct != null ? Math.round(pct) : null;
  const cls =
    delta === 0
      ? "pct-low"
      : Math.abs(pctV ?? 100) <= 30
        ? "pct-mid"
        : "pct-high";
  const sign = delta > 0 ? "+" : "";
  const pctTxt =
    pctV != null
      ? `<span style="font-size:.65rem;opacity:.75"> (${pctV}%)</span>`
      : "";
  return `<td class="pct-cell ${cls}">${sign}${Number(delta).toLocaleString("pt-BR")}${pctTxt}</td>`;
}

// Clique nos cabeçalhos para ordenar
document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortCol = col;
      sortDir = "asc";
    }
    // Atualiza visual dos headers
    document.querySelectorAll("th.sortable").forEach((h) => {
      h.classList.remove("sort-asc", "sort-desc");
    });
    th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
    loadProducts(1);
  });
});

// Inicializa header padrão (Ref. asc)
document.querySelector('th[data-col="id"]').classList.add("sort-asc");

async function loadProducts(page) {
  const reqId = ++_loadReqId;
  prodPage = page;
  const tbody = document.getElementById("prod-tbody");
  tbody.innerHTML =
    '<tr><td colspan="12" style="text-align:center;padding:1.5rem;color:var(--muted);font-size:.8rem">Carregando…</td></tr>';
  const nameQ = document.getElementById("prod-q-name").value;
  const codeQ = document.getElementById("prod-q-code").value;
  const status = statusFilter;
  const disabled = disabledFilter;
  const alertParam = alertFilter ? "&fiscal_alert=1" : "";
  const disabledParam = disabled !== "" ? `&disabled=${disabled}` : "";
  const catParam = catFilter ? `&cat=${encodeURIComponent(catFilter)}` : "";
  const nameParam = nameQ ? `&name_q=${encodeURIComponent(nameQ)}` : "";
  const codeParam = codeQ ? `&code_q=${encodeURIComponent(codeQ)}` : "";
  try {
    const data = await api(
      "GET",
      `/products?status=${status}&page=${page}&limit=${LIMIT}&sort=${sortCol}&order=${sortDir}${nameParam}${codeParam}${alertParam}${disabledParam}${catParam}`,
    );
    if (reqId !== _loadReqId) return;

    if (!data.products.length) {
      tbody.innerHTML =
        '<tr><td colspan="12" style="text-align:center;padding:2rem;color:var(--muted)">Nenhum produto encontrado</td></tr>';
    } else {
      tbody.innerHTML = data.products
        .map(
          (p) => `
        <tr>
          <td style="font-weight:600;font-size:.72rem">${p.id}</td>
          <td>
            ${escapeHtml(p.name)}
            ${p.is_disabled ? '<span class="badge-disabled" style="margin-left:.4rem">Desativado</span>' : ""}
          </td>
          <td class="col-fiscal">${fmt(p.price_fiscal)}</td>
          <td class="col-mgmt">${fmt(p.price_mgmt ?? p.snap_price_mgmt)}</td>
          <td class="col-fiscal">${p.stock_fiscal != null ? Number(p.stock_fiscal).toLocaleString("pt-BR") : "—"}</td>
          <td class="col-mgmt">${p.snap_stock_mgmt != null ? Number(p.snap_stock_mgmt).toLocaleString("pt-BR") : "—"}</td>
          ${diffCell(p.diff_pct, p.stock_fiscal, p.snap_stock_mgmt)}
          <td class="col-real" style="font-weight:700">
            ${p.stock_real != null ? Number(p.stock_real).toLocaleString("pt-BR") : '<span style="color:var(--muted2)">·</span>'}
          </td>
          ${p.stock_real != null ? pctCell(p.real_pct) : '<td class="pct-cell" style="color:var(--muted2)">·</td>'}
          <td>${p.fiscal_alert ? '<span class="badge-alert">⚠️ Fiscal</span>' : '<span style="color:var(--muted2);font-size:.72rem">—</span>'}</td>
          <td>${badge(p.status)}</td>
          <td>
            <div class="td-actions">
              <button class="btn-sm" data-action="edit-product" data-id="${escapeHtml(p.id)}">Editar</button>
              <button class="btn-sm btn-danger" data-action="delete-product" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">Del</button>
            </div>
          </td>
        </tr>
      `,
        )
        .join("");
    }

    const totalPages = Math.ceil(data.total / LIMIT);
    const start = (page - 1) * LIMIT + 1;
    const end = Math.min(page * LIMIT, data.total);
    document.getElementById("pg-info").textContent =
      `${start}–${end} de ${data.total.toLocaleString("pt-BR")}`;
    document.getElementById("pg-prev").disabled = page <= 1;
    document.getElementById("pg-next").disabled = page >= totalPages;
  } catch (err) {
    if (reqId !== _loadReqId) return;
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:2rem;color:var(--red,#e53)">Erro ao carregar produtos: ${err.message}</td></tr>`;
  }
}

// ── Product form ───────────────────────────────────────────────────────────
let editingId = null;
let editingProductName = null;
let editingProductCategoria = null;

function openProductForm(product) {
  editingId = product ? product.id : null;
  editingProductName = product?.name || null;
  editingProductCategoria = product?.categoria || null;
  document.getElementById("form-title").textContent = product
    ? "Editar Produto"
    : "Novo Produto";
  document.getElementById("f-id").value = product?.id || "";
  document.getElementById("f-id").disabled = !!product;
  document.getElementById("f-id-original").value = product?.id || "";
  document.getElementById("f-name").value = product?.name || "";
  document.getElementById("f-pfiscal").value = product?.price_fiscal ?? "";
  document.getElementById("f-pmgmt").value = product?.price_mgmt ?? "";
  document.getElementById("f-sfiscal").value = product?.stock_fiscal ?? "";
  document.getElementById("f-snap-smgmt").value =
    product?.snap_stock_mgmt ?? "";
  document.getElementById("f-sreal").value = product?.stock_real ?? "";
  _populateFormCatSelect(product?.categoria || "");
  document.getElementById("form-err").style.display = "none";
  document.getElementById("fiscal-warning-msg").classList.remove("show");
  document.getElementById("fiscal-ok-msg").style.display = "none";
  document.getElementById("f-sreal").style.borderColor = "var(--accent)";
  if (product?.fiscal_alert) {
    document.getElementById("fiscal-warning-msg").classList.add("show");
  }
  const imgSection = document.getElementById("img-section");
  if (product) {
    imgSection.style.display = "block";
    loadProductImages(product.id, product.images || []);
  } else {
    imgSection.style.display = "none";
  }
  document.getElementById("prod-overlay").classList.add("open");
}

async function editProduct(id) {
  const p = await api("GET", "/products/" + id);
  openProductForm(p);
}

function closeProductForm() {
  document.getElementById("prod-overlay").classList.remove("open");
  document.getElementById("f-img-url").value = "";
  document.getElementById("f-img-file").value = "";
  document.getElementById("img-candidates").style.display = "none";
}

// ── Product images ─────────────────────────────────────────────────────────
function _renderImgGrid(images) {
  const grid = document.getElementById("img-grid");
  const atLimit = images.length >= 4;
  const fileInput = document.getElementById("f-img-file");
  const urlInput = document.getElementById("f-img-url");
  if (fileInput) fileInput.disabled = atLimit;
  if (urlInput) urlInput.disabled = atLimit;
  const uploadBtn = fileInput && fileInput.nextElementSibling;
  const urlBtn = urlInput && urlInput.nextElementSibling;
  if (uploadBtn) {
    uploadBtn.disabled = atLimit;
    uploadBtn.title = atLimit ? "Limite de 4 imagens atingido" : "";
  }
  if (urlBtn) {
    urlBtn.disabled = atLimit;
    urlBtn.title = atLimit ? "Limite de 4 imagens atingido" : "";
  }
  const searchBtn = document.getElementById("btn-search-imgs");
  if (searchBtn) {
    searchBtn.disabled = atLimit;
    searchBtn.style.opacity = atLimit ? "0.35" : "";
    searchBtn.title = atLimit
      ? "Limite de 4 imagens atingido — remova uma foto para adicionar outra"
      : "";
  }
  if (atLimit) {
    const cand = document.getElementById("img-candidates");
    if (cand) {
      cand.style.display = "none";
    }
  }

  if (!images.length) {
    const svg =
      typeof getCategoryPlaceholder === "function"
        ? getCategoryPlaceholder(editingProductName, editingProductCategoria)
        : "";
    grid.innerHTML = `<div class="img-tile" style="pointer-events:none;opacity:.45;display:flex;align-items:center;justify-content:center;padding:.5rem">${svg}</div><span style="font-size:.72rem;color:var(--muted);grid-column:2/-1;align-self:center">Nenhuma foto. Adicione pelo arquivo ou URL.</span>`;
    return;
  }
  grid.innerHTML = images
    .map(
      (img) => `
    <div class="img-tile${img.is_pinned ? " pinned" : ""}" title="${img.is_pinned ? "Foto principal" : "Clique para fixar como principal"}">
      <img src="${escapeHtml(img.url)}" loading="lazy" data-action="pin-image" data-img-id="${img.id}">
      ${img.is_pinned ? '<span class="img-tile-pin">✓ Principal</span>' : ""}
      ${img.is_manual ? '<span class="img-tile-badge">Manual</span>' : ""}
      <button class="img-tile-del" data-action="delete-image-by-id" data-img-id="${img.id}" title="Remover">✕</button>
    </div>
  `,
    )
    .join("");
  grid.querySelectorAll("img[data-action='pin-image']").forEach((imgEl) => {
    imgEl.addEventListener("error", () => {
      imgEl.style.display = "none";
      imgEl.insertAdjacentHTML(
        "afterend",
        "<span style=\"display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:.65rem;color:var(--muted);text-align:center;padding:.25rem\">Imagem<br>indisponível</span>",
      );
    }, { once: true });
  });
}

function loadProductImages(productId, images) {
  _renderImgGrid(images);
}

// Limpa o cache de imagens do catálogo (sessionStorage) para este produto
function _clearCatalogImgCache(productId) {
  try {
    sessionStorage.removeItem("gp_imgs_" + productId);
  } catch {}
}

async function pinImage(productId, imgId) {
  await api("PUT", `/products/${productId}/images/${imgId}/pin`);
  _clearCatalogImgCache(productId);
  const data = await api("GET", `/products/${editingId}`);
  _renderImgGrid(data.images || []);
}

async function deleteImageById(imgId) {
  try {
    await api("DELETE", `/products/${editingId}/images/${imgId}`);
    _clearCatalogImgCache(editingId);
    const data = await api("GET", `/products/${editingId}`);
    _renderImgGrid(data.images || []);
  } catch (e) {
    showToast("Erro ao remover: " + e.message);
  }
}

async function clearProductImages() {
  if (!editingId) return;
  if (!confirm("Remover todas as fotos deste produto?")) return;
  await api("DELETE", `/products/${editingId}/images`);
  _clearCatalogImgCache(editingId);
  _renderImgGrid([]);
}

async function uploadImageFile() {
  const fileInput = document.getElementById("f-img-file");
  const file = fileInput.files[0];
  if (!file) {
    showToast("Selecione um arquivo primeiro.");
    return;
  }
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(BASE + `/api/products/${editingId}/images/upload`, {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    showToast("Erro: " + (data.error || "falha no upload"));
    return;
  }
  fileInput.value = "";
  _clearCatalogImgCache(editingId);
  const imgs = await api("GET", `/products/${editingId}`);
  _renderImgGrid(imgs.images || []);
  showToast("Foto adicionada!");
}

async function addManualImage() {
  const url = document.getElementById("f-img-url").value.trim();
  if (!url) return;
  await api("POST", `/products/${editingId}/images`, {
    url,
    is_pinned: 1,
    is_manual: 1,
  });
  document.getElementById("f-img-url").value = "";
  _clearCatalogImgCache(editingId);
  const data = await api("GET", `/products/${editingId}`);
  _renderImgGrid(data.images || []);
}

async function searchProductImages() {
  if (!editingId) return;
  const btn = document.getElementById("btn-search-imgs");
  btn.disabled = true;
  btn.textContent = "⌛ Buscando…";
  try {
    const data = await api(
      "GET",
      `/products/${editingId}/search-images?fresh=1`,
    );
    _renderCandidates(data.images || []);
  } catch (e) {
    showToast("Erro na busca: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 Buscar Imagens";
  }
}

function _renderCandidates(images) {
  const container = document.getElementById("img-candidates");
  const grid = document.getElementById("candidate-grid");
  if (!images.length) {
    showToast("Nenhuma imagem encontrada. Tente adicionar por URL ou arquivo.");
    container.style.display = "none";
    return;
  }
  grid.innerHTML = images
    .map(
      (img) => `
    <div class="img-tile" title="Clique para usar esta imagem">
      <img src="${escapeHtml(img.url)}" loading="lazy" data-url="${escapeHtml(img.url)}">
      <span class="img-tile-badge" data-url="${escapeHtml(img.url)}">Usar</span>
      <button class="img-tile-del" title="Não é esse produto" data-action="remove-img-tile">✕</button>
    </div>
  `,
    )
    .join("");
  grid.querySelectorAll(".img-tile img[data-url], .img-tile-badge[data-url]").forEach((el) => {
    el.addEventListener("click", () => selectCandidateImage(el.closest(".img-tile"), el.dataset.url));
    if (el.tagName === "IMG") {
      el.addEventListener("error", () => { el.parentElement.style.display = "none"; }, { once: true });
    }
  });
  container.style.display = "block";
}

async function selectCandidateImage(tile, url) {
  const currentCount = document.querySelectorAll(
    "#img-grid .img-tile-del",
  ).length;
  if (currentCount >= 4) {
    showToast(
      "Limite de 4 imagens atingido. Remova uma foto para adicionar outra.",
    );
    return;
  }
  tile.style.opacity = ".4";
  try {
    await api("POST", `/products/${editingId}/images`, {
      url,
      is_pinned: 1,
      is_manual: 1,
    });
    document.getElementById("img-candidates").style.display = "none";
    _clearCatalogImgCache(editingId);
    const data = await api("GET", `/products/${editingId}`);
    _renderImgGrid(data.images || []);
    showToast("Foto adicionada!");
  } catch (e) {
    tile.style.opacity = "1";
    showToast(
      e.message.includes("Limite")
        ? "Limite de 4 imagens atingido."
        : "Erro ao salvar: " + e.message,
    );
  }
}

async function saveProduct() {
  const btn = document.getElementById("save-btn");
  btn.disabled = true;
  const err = document.getElementById("form-err");
  err.style.display = "none";

  const id = document.getElementById("f-id").value.trim();
  const name = document.getElementById("f-name").value.trim();
  const pf = document.getElementById("f-pfiscal").value;
  const pm = document.getElementById("f-pmgmt").value;
  const sr = document.getElementById("f-sreal").value;

  if (!id || !name) {
    err.textContent = "Código e nome são obrigatórios.";
    err.style.display = "block";
    btn.disabled = false;
    return;
  }

  const cat = document.getElementById("f-cat").value;
  const body = {
    id,
    name,
    price_fiscal: pf !== "" ? parseFloat(pf) : null,
    price_mgmt: pm !== "" ? parseFloat(pm) : null,
    stock_real: sr !== "" ? parseFloat(sr) : null,
    categoria: cat || null,
  };

  try {
    if (editingId) {
      await api("PUT", "/products/" + editingId, body);
      showToast("Produto atualizado!");
    } else {
      await api("POST", "/products", body);
      showToast("Produto criado!");
      if (cat) {
        await _fetchCategories();
        loadCatFilter();
      }
    }
    closeProductForm();
    loadProducts(prodPage);
    loadStats();
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = "block";
  }
  btn.disabled = false;
}

async function deleteProduct(id, name) {
  if (
    !confirm(
      `Remover o produto "${name}" (${id})?\n\nEsta ação não pode ser desfeita.`,
    )
  )
    return;
  try {
    await api("DELETE", "/products/" + id);
    showToast("Produto removido.");
    loadProducts(prodPage);
    loadStats();
  } catch (ex) {
    showToast("Erro: " + ex.message);
  }
}

// ── Overlay close on bg click ──────────────────────────────────────────────
document.getElementById("prod-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("prod-overlay")) closeProductForm();
});

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ── Relatório de Alterações ────────────────────────────────────────────────
let rptSort = "changed_at",
  rptDir = "desc";
let _rptData = []; // cache para exportação

// Ordenação nos headers
document.querySelectorAll("th.sortable-rpt").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (rptSort === col) {
      rptDir = rptDir === "asc" ? "desc" : "asc";
    } else {
      rptSort = col;
      rptDir = "asc";
    }
    document
      .querySelectorAll("th.sortable-rpt")
      .forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
    th.classList.add(rptDir === "asc" ? "sort-asc" : "sort-desc");
    loadReport();
  });
});
// Header padrão: Data desc
document
  .querySelector('th.sortable-rpt[data-col="changed_at"]')
  .classList.add("sort-desc");

const fmtStock = (n) =>
  n != null
    ? Number(n).toLocaleString("pt-BR")
    : '<span style="color:var(--muted2)">—</span>';
const fmtStockRaw = (n) => (n != null ? Number(n) : "");

// Limpa filtro de datas
function clearRptDates() {
  document.getElementById("rpt-from").value = "";
  document.getElementById("rpt-to").value = "";
  loadReport();
}

async function loadReport() {
  const from = document.getElementById("rpt-from").value; // YYYY-MM-DD
  const to = document.getElementById("rpt-to").value;
  const params = new URLSearchParams({ sort: rptSort, order: rptDir });
  if (from) params.append("date_from", from);
  if (to) params.append("date_to", to);

  const data = await api("GET", `/products/report?${params}`);
  _rptData = data.rows; // salva para exportar

  const tbody = document.getElementById("rpt-tbody");
  const lbl =
    from || to
      ? ` (filtrado${from ? " de " + from.split("-").reverse().join("/") : ""}${to ? " até " + to.split("-").reverse().join("/") : ""})`
      : "";
  document.getElementById("rpt-count").textContent =
    `${data.total.toLocaleString("pt-BR")} produto${data.total !== 1 ? "s" : ""} alterado${data.total !== 1 ? "s" : ""}${lbl}`;

  if (!data.rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;padding:3rem;color:var(--muted)">Nenhuma alteração encontrada para o período selecionado</td></tr>';
    return;
  }

  const cellDiff = (changed, newVal, prevVal) => {
    const formatted = fmtStock(newVal);
    if (!changed) return formatted;
    return `<span style="color:var(--muted2);text-decoration:line-through;font-size:.65rem;margin-right:.3rem">${fmtStock(prevVal)}</span><span style="color:var(--amber);font-weight:700">${formatted}</span>`;
  };

  tbody.innerHTML = data.rows
    .map((r) => {
      const fiscalChanged = r.stock_fiscal != null && (r.prev_stock_fiscal == null || Number(r.prev_stock_fiscal) !== Number(r.stock_fiscal));
      const mgmtChanged   = r.prev_stock_mgmt   != null && Number(r.prev_stock_mgmt)   !== Number(r.stock_mgmt);
      const realChanged   = r.prev_stock_real   != null && Number(r.prev_stock_real)   !== Number(r.stock_real);
      const catChanged    = r.prev_categoria !== r.categoria && r.last_categoria_changed_at != null && r.last_categoria_changed_at === r.changed_at;
      const catBadge = r.categoria
        ? catChanged
          ? `<span style="background:rgba(181,98,10,.12);color:var(--amber);padding:.15rem .45rem;border-radius:4px;white-space:nowrap;font-weight:700">${escapeHtml(r.categoria)}</span>`
          : `<span style="background:#ebebeb;color:#666;padding:.15rem .45rem;border-radius:4px;white-space:nowrap">${escapeHtml(r.categoria)}</span>`
        : '<span style="color:var(--muted2)">—</span>';
      return `
    <tr>
      <td style="font-weight:600;font-size:.72rem">${r.id}</td>
      <td>${escapeHtml(r.name)}</td>
      <td style="font-size:.7rem">${catBadge}</td>
      <td>${cellDiff(fiscalChanged, r.stock_fiscal, r.prev_stock_fiscal)}</td>
      <td>${cellDiff(mgmtChanged, r.stock_mgmt, r.prev_stock_mgmt)}</td>
      <td style="border-left:2px solid var(--accent);font-weight:700">
        ${cellDiff(realChanged, r.stock_real, r.prev_stock_real)}
      </td>
      <td class="date-cell">📅 ${r.data}</td>
      <td class="time-cell">🕐 ${r.hora}</td>
    </tr>
  `;
    })
    .join("");
}

// ── Exportação ─────────────────────────────────────────────────────────────
function buildExportRows() {
  return _rptData.map((r) => ({
    "Ref.": r.id,
    "Nome do Produto": r.name,
    Grupo: r.categoria || "",
    "Estoque Fiscal": fmtStockRaw(r.stock_fiscal),
    "Estoque Gerencial": fmtStockRaw(r.stock_mgmt),
    "Estoque Real": fmtStockRaw(r.stock_real),
    Data: r.data,
    Hora: r.hora,
  }));
}

function exportFilename(ext) {
  const from = document.getElementById("rpt-from").value;
  const to = document.getElementById("rpt-to").value;
  const sfx =
    from || to
      ? `_${(from || "inicio").replace(/-/g, "")}_${(to || "hoje").replace(/-/g, "")}`
      : "";
  return `relatorio_alteracoes${sfx}.${ext}`;
}

function exportCSV() {
  if (!_rptData.length) {
    showToast("Nenhum dado para exportar.");
    return;
  }
  const rows = buildExportRows();
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    cols.map(esc).join(";"),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(";")),
  ];
  const bom = "\uFEFF"; // BOM para Excel abrir UTF-8 corretamente
  const blob = new Blob([bom + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: exportFilename("csv"),
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("CSV exportado!");
}

function exportXLS() {
  if (!_rptData.length) {
    showToast("Nenhum dado para exportar.");
    return;
  }
  if (typeof XLSX === "undefined") {
    showToast("Biblioteca XLS ainda carregando…");
    return;
  }

  const rows = buildExportRows();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Larguras das colunas
  ws["!cols"] = [
    { wch: 10 },
    { wch: 45 },
    { wch: 16 },
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
    { wch: 10 },
  ];

  // Estilo de cabeçalho (negrito) — suportado pelo SheetJS Community via `!rows`
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[addr]) continue;
    ws[addr].s = {
      font: { bold: true },
      fill: { fgColor: { rgb: "C8102E" } },
      fontColor: { rgb: "FFFFFF" },
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Alterações");
  XLSX.writeFile(wb, exportFilename("xlsx"));
  showToast("XLS exportado!");
}

// ── Desativar e Atualizar ──────────────────────────────────────────────────
let dactSort = "changed_at",
  dactDir = "desc";
let _dactData = [];

// Ordenação nos headers
document.querySelectorAll("th.sortable-dact").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (dactSort === col) {
      dactDir = dactDir === "asc" ? "desc" : "asc";
    } else {
      dactSort = col;
      dactDir = "asc";
    }
    document
      .querySelectorAll("th.sortable-dact")
      .forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
    th.classList.add(dactDir === "asc" ? "sort-asc" : "sort-desc");
    loadDeactivate();
  });
});
// Header padrão: Data desc
document
  .querySelector('th.sortable-dact[data-col="changed_at"]')
  .classList.add("sort-desc");

const fmtN = (n) =>
  n != null
    ? Number(n).toLocaleString("pt-BR")
    : '<span style="color:var(--muted2)">—</span>';

// Gera os badges de categoria para cada produto
function dactBadges(r) {
  const badges = [];
  if (r.has_fiscal_alert)
    badges.push('<span class="badge-alert">⚠️ Desativar</span>');
  if (r.has_audit)
    badges.push(
      '<span style="background:rgba(0,80,160,.1);color:#004fa3;font-size:.58rem;font-weight:700;padding:.18rem .48rem;border-radius:2px;border:1px solid rgba(0,80,160,.25);white-space:nowrap">🔄 Atualizado</span>',
    );
  return (
    badges.join(" ") ||
    '<span style="color:var(--muted2);font-size:.72rem">—</span>'
  );
}

function clearDactDates() {
  document.getElementById("dact-from").value = "";
  document.getElementById("dact-to").value = "";
  loadDeactivate();
}

async function loadDeactivate() {
  const tbody = document.getElementById("dact-tbody");
  const countEl = document.getElementById("dact-count");
  const flag = document.getElementById("dact-flag").value;
  const from = document.getElementById("dact-from").value;
  const to = document.getElementById("dact-to").value;
  const params = new URLSearchParams({ sort: dactSort, order: dactDir, flag });
  if (from) params.append("date_from", from);
  if (to) params.append("date_to", to);

  tbody.innerHTML =
    '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted);font-size:.8rem">Carregando…</td></tr>';
  countEl.textContent = "";

  try {
    const data = await api("GET", `/products/deactivate-report?${params}`);
    _dactData = data.rows;

    const nDesativar = data.rows.filter((r) => r.has_fiscal_alert).length;
    const nAtualizar = data.rows.filter((r) => r.has_audit).length;
    const dateLbl =
      from || to
        ? ` · ${from ? from.split("-").reverse().join("/") : "…"} → ${to ? to.split("-").reverse().join("/") : "hoje"}`
        : "";
    countEl.textContent = `${data.total.toLocaleString("pt-BR")} produto${data.total !== 1 ? "s" : ""} — ⚠️ ${nDesativar} desativar · 🔄 ${nAtualizar} atualizar${dateLbl}`;

    if (!data.rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;padding:3rem;color:var(--muted)">Nenhum produto encontrado para os filtros selecionados</td></tr>';
      return;
    }

    tbody.innerHTML = data.rows
      .map((r) => {
        const hasEllipsis = r.name_full && r.name_full.length > 20;
        return `
      <tr>
        <td style="font-weight:600;font-size:.72rem">${r.id}</td>
        <td title="${escapeHtml(r.name_full)}" style="font-size:.8rem;white-space:nowrap">${escapeHtml(r.name_abbr)}${hasEllipsis ? "…" : ""}</td>
        <td>${fmtN(r.stock_fiscal)}</td>
        <td>${fmtN(r.stock_mgmt)}</td>
        <td style="border-left:2px solid var(--accent);font-weight:700">${fmtN(r.stock_real)}</td>
        <td class="date-cell">📅 ${r.data}</td>
        <td style="white-space:nowrap">${dactBadges(r)}</td>
        <td>
          <div class="td-actions">
            <button class="btn-sm" data-action="edit-product" data-id="${escapeHtml(r.id)}" title="Editar produto">Editar</button>
            ${
              r.has_fiscal_alert
                ? `<button class="btn-sm" data-action="resolve-alert" data-id="${escapeHtml(r.id)}"
                   style="border-color:var(--green);color:var(--green)" title="Confirma que o produto foi desativado no fiscal">✓ Resolver</button>`
                : ""
            }
          </div>
        </td>
      </tr>`;
      })
      .join("");
  } catch (ex) {
    _dactData = [];
    countEl.textContent = "";
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--red);font-size:.8rem">
      ❌ Erro ao carregar: ${ex.message}
    </td></tr>`;
  }
}

async function resolveAlert(id) {
  if (
    !confirm(
      `Marcar o produto "${id}" como resolvido?\n\nIsso indica que o produto já foi desativado no sistema fiscal e o alerta será removido.`,
    )
  )
    return;
  try {
    await api("PATCH", `/products/${id}/resolve-alert`);
    showToast("✅ Alerta resolvido! Produto atualizado.");
    loadDeactivate();
    loadStats();
  } catch (ex) {
    showToast("Erro: " + ex.message);
  }
}

function buildDeactivateExportRows() {
  return _dactData.map((r) => {
    const tipos = [];
    if (r.has_fiscal_alert) tipos.push("Desativar Fiscal");
    if (r.has_audit) tipos.push("Atualizado");
    return {
      "Ref.": r.id,
      Nome: r.name_abbr + (r.name_full && r.name_full.length > 20 ? "…" : ""),
      Fiscal: r.stock_fiscal != null ? Number(r.stock_fiscal) : "",
      Gerencial: r.stock_mgmt != null ? Number(r.stock_mgmt) : "",
      Real: r.stock_real != null ? Number(r.stock_real) : "",
      Data: r.data,
      Tipo: tipos.join(" + ") || "OK",
    };
  });
}

function exportDeactivateFilename(ext) {
  const from = document.getElementById("dact-from").value;
  const to = document.getElementById("dact-to").value;
  const sfx =
    from || to
      ? `_${(from || "inicio").replace(/-/g, "")}_${(to || "hoje").replace(/-/g, "")}`
      : "";
  return `desativar_atualizar${sfx}.${ext}`;
}

function exportDeactivateCSV() {
  if (!_dactData.length) {
    showToast("Nenhum dado para exportar.");
    return;
  }
  const rows = buildDeactivateExportRows();
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    cols.map(esc).join(";"),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(";")),
  ];
  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: exportDeactivateFilename("csv"),
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("CSV exportado!");
}

function exportDeactivateXLS() {
  if (!_dactData.length) {
    showToast("Nenhum dado para exportar.");
    return;
  }
  if (typeof XLSX === "undefined") {
    showToast("Biblioteca XLS ainda carregando…");
    return;
  }
  const rows = buildDeactivateExportRows();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 10 },
    { wch: 23 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Desativar e Atualizar");
  XLSX.writeFile(wb, exportDeactivateFilename("xlsx"));
  showToast("XLS exportado!");
}

// ── PDF Import ─────────────────────────────────────────────────────────────
function onDrag(e, type) {
  e.preventDefault();
  document.getElementById("drop-" + type).classList.add("drag");
}
function offDrag(type) {
  document.getElementById("drop-" + type).classList.remove("drag");
}

let _uploadInProgress = false;

function setUploadDropsDisabled(disabled) {
  ["fiscal", "gerencial"].forEach((t) => {
    document.getElementById("drop-" + t).classList.toggle("disabled", disabled);
  });
}

function onDropFile(e, type) {
  e.preventDefault();
  offDrag(type);
  if (_uploadInProgress) return;
  const file = e.dataTransfer.files[0];
  if (file) uploadPdf(type, file);
}

function handleFileSelect(type) {
  if (_uploadInProgress) return;
  const input = document.getElementById("file-" + type);
  if (input.files[0]) uploadPdf(type, input.files[0]);
}

function setStatus(type, msg, cls) {
  const el = document.getElementById("status-" + type);
  el.textContent = msg;
  el.className = "pdf-status" + (cls ? " " + cls : "");
}

function closePreview() {
  document.getElementById("preview-section").classList.remove("show");
}

async function uploadPdf(type, file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    setStatus(type, "Apenas arquivos PDF são aceitos.", "err");
    return;
  }
  if (_uploadInProgress) {
    setStatus(type, "Aguarde a importação em andamento terminar…", "err");
    return;
  }
  _uploadInProgress = true;
  setUploadDropsDisabled(true);
  try {
    await _doUploadPdf(type, file);
  } finally {
    _uploadInProgress = false;
    setUploadDropsDisabled(false);
  }
}

async function _doUploadPdf(type, file) {
  setStatus(type, `Enviando "${file.name}"…`);

  // Mostra painel de progresso
  const section = document.getElementById("preview-section");
  section.classList.add("show");
  document.getElementById("preview-title").textContent =
    (type === "fiscal" ? "📋 Fiscal" : "📊 Gerencial") + " — Importando…";
  document.getElementById("preview-loading").style.display = "block";
  document.getElementById("import-result").style.display = "none";

  const form = new FormData();
  form.append("pdf", file);

  let res, data;
  try {
    res = await fetch(BASE + `/api/documents/upload/${type}`, {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    data = await res.json();
  } catch (err) {
    setStatus(type, "❌ Erro de rede: " + err.message, "err");
    document.getElementById("preview-loading").style.display = "none";
    return;
  }

  document.getElementById("preview-loading").style.display = "none";

  if (!res.ok) {
    setStatus(type, "❌ " + (data.error || "Erro no upload"), "err");
    document.getElementById("import-result").innerHTML =
      `<div style="color:var(--red);font-size:.8rem">❌ ${data.error || "Erro desconhecido"}</div>`;
    document.getElementById("import-result").style.display = "block";
    return;
  }

  const typeLabel = type === "fiscal" ? "Fiscal" : "Gerencial";
  setStatus(
    type,
    `✅ "${file.name}" importado — ${data.updated} produto(s) atualizados.`,
    "ok",
  );
  document.getElementById("preview-title").textContent =
    (type === "fiscal" ? "📋" : "📊") + " Resultado — " + typeLabel;

  const noteGerencial =
    type === "gerencial"
      ? `<div style="margin-top:.75rem;padding:.55rem .75rem;background:rgba(78,130,212,.07);border:1px solid rgba(78,130,212,.3);border-radius:3px;font-size:.7rem;color:#004fa3">
        Dados manuais (Preço/Estoque Gerencial ajustados pelo sistema) <strong>não foram alterados</strong>.
        Esses valores ficam em colunas separadas para comparação.
      </div>`
      : "";

  document.getElementById("import-result").innerHTML = `
    <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
      <div style="flex:1;min-width:120px">
        <div style="font-size:.6rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem">Produtos no PDF</div>
        <div style="font-size:1.6rem;font-weight:800;color:var(--text)">${data.total.toLocaleString("pt-BR")}</div>
      </div>
      <div style="flex:1;min-width:120px">
        <div style="font-size:.6rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem">Atualizados no sistema</div>
        <div style="font-size:1.6rem;font-weight:800;color:var(--green)">${data.updated.toLocaleString("pt-BR")}</div>
      </div>
      <div style="flex:1;min-width:120px">
        <div style="font-size:.6rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem">Novos no sistema</div>
        <div style="font-size:1.6rem;font-weight:800;color:var(--amber)">${data.created.toLocaleString("pt-BR")}</div>
      </div>
    </div>
    ${noteGerencial}
  `;
  document.getElementById("import-result").style.display = "block";

  document.getElementById("file-" + type).value = "";
  loadImportHistory();
  loadStats();
}

async function loadImportHistory() {
  const tbody = document.getElementById("history-tbody");
  try {
    const data = await api("GET", "/documents/history");
    if (!data.history.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--muted);font-size:.8rem">Nenhuma importação realizada ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = data.history
      .map((h) => {
        const statusColor =
          h.status === "success"
            ? "var(--green)"
            : h.status === "error"
              ? "var(--red)"
              : "var(--amber)";
        const statusLabel =
          h.status === "success"
            ? "✅ Sucesso"
            : h.status === "error"
              ? "❌ Erro"
              : "⚠️ Parcial";
        const date = h.imported_at
          ? h.imported_at.replace("T", " ").substring(0, 16)
          : "—";
        return `<tr>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);white-space:nowrap;font-size:.72rem">${date}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-weight:600;font-size:.72rem">${h.type === "fiscal" ? "📋 Fiscal" : h.type === "grupos" ? "🗂️ Grupos" : "📊 Gerencial"}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.72rem">${h.total_products ?? "—"}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:var(--green);font-weight:700;font-size:.72rem">${h.updated_products ?? "—"}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:var(--muted);font-size:.72rem">${h.skipped ?? "—"}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:${statusColor};font-weight:700;font-size:.72rem">${statusLabel}</td>
        <td style="padding:.6rem 1rem;border-bottom:1px solid var(--border);color:var(--muted);font-size:.68rem;max-width:220px;overflow-wrap:anywhere">${escapeHtml(h.filename) || "—"}</td>
      </tr>`;
      })
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--red);font-size:.8rem">❌ Erro: ${err.message}</td></tr>`;
  }
}

// ── Importação de Grupos ───────────────────────────────────────────────────
let _gruposData = null;

function handleGruposFile() {
  const input = document.getElementById("file-grupos");
  if (input.files[0]) processGruposPdf(input.files[0]);
}

async function processGruposPdf(file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    document.getElementById("status-grupos").textContent =
      "❌ Apenas arquivos PDF.";
    return;
  }
  const s = document.getElementById("status-grupos");
  s.className = "pdf-status";
  s.textContent = `Analisando "${file.name}"…`;
  document.getElementById("grupos-preview").style.display = "none";

  const form = new FormData();
  form.append("pdf", file);
  let res, data;
  try {
    res = await fetch(BASE + "/api/documents/upload/grupos", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    data = await res.json();
  } catch (err) {
    s.textContent = "❌ Erro de rede: " + err.message;
    return;
  }
  if (!res.ok) {
    s.textContent = "❌ " + (data.error || "Erro");
    return;
  }

  _gruposData = data;
  document.getElementById("file-grupos").value = "";
  const parsedInfo =
    data.totalParsed && data.totalParsed !== data.totalFound
      ? ` (${data.totalParsed.toLocaleString("pt-BR")} lidos no PDF)`
      : "";
  s.textContent = `${data.totalGroups} grupos encontrados, ${data.totalFound.toLocaleString("pt-BR")} produtos serão atualizados.${parsedInfo}`;

  const preview = document.getElementById("grupos-preview");
  preview.style.display = "block";
  preview.innerHTML = `
    <div style="font-size:.73rem;font-weight:600;margin-bottom:.5rem">
      ${data.totalGroups} grupos ativos
      ${data.totalNotFound > 0 ? `<span style="color:var(--amber);margin-left:.5rem">(${data.totalNotFound} códigos não encontrados no banco)</span>` : ""}
    </div>
    <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-bottom:.75rem">
      <table style="width:100%;font-size:.68rem;border-collapse:collapse">
        <thead><tr>
          <th style="padding:.3rem .75rem;text-align:left;background:var(--surface);font-size:.6rem;color:var(--muted);border-bottom:1px solid var(--border)">Grupo → Categoria</th>
          <th style="padding:.3rem .75rem;text-align:right;background:var(--surface);font-size:.6rem;color:var(--muted);border-bottom:1px solid var(--border)">Produtos</th>
          <th style="padding:.3rem .75rem;text-align:right;background:var(--surface);font-size:.6rem;color:var(--muted);border-bottom:1px solid var(--border)">Não encontrados</th>
        </tr></thead>
        <tbody>${data.groups
          .map(
            (g) => `<tr style="${g.skip ? "opacity:.45" : ""}">
          <td style="padding:.35rem .75rem;border-bottom:1px solid var(--border)">
            ${escapeHtml(g.name)}
            ${g.skip ? ' <em style="color:var(--muted)">(categoria → null, reativa)</em>' : ""}
            ${g.disabled ? ' <em style="color:var(--amber)">(is_disabled = 1, categoria → null)</em>' : ""}
          </td>
          <td style="padding:.35rem .75rem;border-bottom:1px solid var(--border);text-align:right">${g.found}</td>
          <td style="padding:.35rem .75rem;border-bottom:1px solid var(--border);text-align:right;color:${g.notFound > 0 ? "var(--amber)" : "var(--muted)"}">${g.notFound > 0 ? g.notFound : "—"}</td>
        </tr>`,
          )
          .join("")}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:.5rem">
      <button class="btn-sm btn-primary" data-action="apply-grupos">✅ Aplicar todos os grupos</button>
      <button class="btn-sm" data-action="reset-grupos">Cancelar</button>
    </div>
  `;
}

async function applyGrupos() {
  if (!_gruposData) return;
  const s = document.getElementById("status-grupos");
  s.textContent = "Aplicando categorias…";
  try {
    const data = await api("POST", "/documents/apply-groups", {
      groups: _gruposData.groups,
      filename: _gruposData.filename,
      size: _gruposData.size,
    });
    s.className = "pdf-status ok";
    s.textContent = `✅ ${data.updated} produtos atualizados em ${data.groups} grupos.`;
    document.getElementById("grupos-preview").innerHTML =
      `<div style="color:var(--green);font-weight:700;font-size:.8rem">✅ Categorias aplicadas! ${data.updated} produtos atualizados em ${data.groups} grupos.</div>`;
    _gruposData = null;
    loadStats();
    loadImportHistory();
  } catch (err) {
    s.textContent = "❌ Erro: " + err.message;
  }
}

function resetGrupos() {
  _gruposData = null;
  document.getElementById("grupos-preview").style.display = "none";
  document.getElementById("status-grupos").textContent =
    "Nenhum arquivo selecionado.";
  document.getElementById("file-grupos").value = "";
}

// ── Users ──────────────────────────────────────────────────────────────────
async function loadUsers() {
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML =
    '<tr><td colspan="2" style="text-align:center;padding:2rem;color:var(--muted);font-size:.8rem">Carregando…</td></tr>';
  try {
    const data = await api("GET", "/users");
    if (!data.users.length) {
      tbody.innerHTML =
        '<tr><td colspan="2" style="text-align:center;padding:2rem;color:var(--muted);font-size:.8rem">Nenhum usuário com acesso.</td></tr>';
      return;
    }
    tbody.innerHTML = data.users
      .map(
        (u) => `
      <tr>
        <td style="font-size:.8rem">${escapeHtml(u.email)}</td>
        <td>
          <select data-action="set-user-role" data-user-id="${escapeHtml(u.user_id)}"
                  style="border:1.5px solid var(--border2);border-radius:4px;padding:.35rem .55rem;font-size:.78rem;font-family:'Inter',sans-serif;background:var(--white);color:var(--text);cursor:pointer;width:100%">
            <option value="admin"      ${u.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="conferente" ${u.role === "conferente" ? "selected" : ""}>Conferente</option>
          </select>
        </td>
      </tr>`,
      )
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;padding:2rem;color:var(--red);font-size:.8rem">❌ Erro: ${err.message}</td></tr>`;
  }
}

async function setUserRole(userId, role, selectEl) {
  const prev = selectEl.dataset.prev || selectEl.value;
  selectEl.dataset.prev = role;
  selectEl.disabled = true;
  try {
    await api("PATCH", `/users/${userId}/role`, { role });
    showToast(
      `✅ Perfil atualizado para ${role === "admin" ? "Admin" : "Conferente"}`,
    );
  } catch (err) {
    showToast("Erro: " + err.message);
    selectEl.value = prev;
    selectEl.dataset.prev = prev;
  } finally {
    selectEl.disabled = false;
  }
}

// ── Delegated actions (substitui onclick/onchange/ondrag inline — necessário pra CSP) ──
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  switch (el.dataset.action) {
    case "toggle-sidebar": toggleSidebar(); break;
    case "go-catalog": e.preventDefault(); location.href = BASE + "/"; break;
    case "logout": logout(); break;
    case "navigate": navigate(el.dataset.page); break;
    case "open-deactivate": openDeactivateFlag(el.dataset.flag); break;
    case "dashboard-status-link": goToProductsWithStatus(el.dataset.status); break;
    case "open-product-form": openProductForm(); break;
    case "set-status-filter": setStatusFilter(el.dataset.val); break;
    case "set-disabled-filter": setDisabledFilter(el.dataset.val); break;
    case "toggle-alert-filter": toggleAlertFilter(); break;
    case "prod-page-prev": loadProducts(prodPage - 1); break;
    case "prod-page-next": loadProducts(prodPage + 1); break;
    case "clear-rpt-dates": clearRptDates(); break;
    case "load-report": loadReport(); break;
    case "export-csv": exportCSV(); break;
    case "export-xls": exportXLS(); break;
    case "clear-dact-dates": clearDactDates(); break;
    case "load-deactivate": loadDeactivate(); break;
    case "export-dact-csv": exportDeactivateCSV(); break;
    case "export-dact-xls": exportDeactivateXLS(); break;
    case "load-import-history": loadImportHistory(); break;
    case "close-preview": closePreview(); break;
    case "load-users": loadUsers(); break;
    case "close-product-form": closeProductForm(); break;
    case "search-product-images": searchProductImages(); break;
    case "clear-product-images": clearProductImages(); break;
    case "close-img-candidates": document.getElementById("img-candidates").style.display = "none"; break;
    case "upload-image-file": uploadImageFile(); break;
    case "add-manual-image": addManualImage(); break;
    case "save-product": saveProduct(); break;
    case "edit-product": editProduct(el.dataset.id); break;
    case "delete-product": deleteProduct(el.dataset.id, el.dataset.name); break;
    case "pin-image": pinImage(editingId, Number(el.dataset.imgId)); break;
    case "delete-image-by-id": e.stopPropagation(); deleteImageById(Number(el.dataset.imgId)); break;
    case "remove-img-tile": el.closest(".img-tile").remove(); break;
    case "resolve-alert": resolveAlert(el.dataset.id); break;
    case "apply-grupos": applyGrupos(); break;
    case "reset-grupos": resetGrupos(); break;
    case "click-file-input": document.getElementById(el.dataset.fileInput).click(); break;
  }
});

document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  switch (el.dataset.action) {
    case "load-report": loadReport(); break;
    case "load-deactivate": loadDeactivate(); break;
    case "handle-file-select": handleFileSelect(el.dataset.type); break;
    case "handle-grupos-file": handleGruposFile(); break;
    case "set-user-role": setUserRole(el.dataset.userId, el.value, el); break;
  }
});

document.addEventListener("dragover", (e) => {
  const el = e.target.closest("[data-dropzone]");
  if (!el) return;
  onDrag(e, el.dataset.dropzone);
});
document.addEventListener("dragleave", (e) => {
  const el = e.target.closest("[data-dropzone]");
  if (!el) return;
  offDrag(el.dataset.dropzone);
});
document.addEventListener("drop", (e) => {
  const el = e.target.closest("[data-dropzone]");
  if (!el) return;
  onDropFile(e, el.dataset.dropzone);
});

document.getElementById("f-sreal").addEventListener("input", applyStockRuleUI);
document.getElementById("prod-q-name").addEventListener("input", debSearch);
document.getElementById("prod-q-code").addEventListener("input", debSearch);

// ── Init ───────────────────────────────────────────────────────────────────
// Restaura filtros salvos
const _savedNameQ = localStorage.getItem("gp_admin_name_q") || "";
const _savedCodeQ = localStorage.getItem("gp_admin_code_q") || "";
if (_savedNameQ) document.getElementById("prod-q-name").value = _savedNameQ;
if (_savedCodeQ) document.getElementById("prod-q-code").value = _savedCodeQ;
_restoreFilterButtons();

// Restaura a seção que estava aberta (hash routing)
const initHash = location.hash.replace("#", "");
const initPage = VALID_PAGES.includes(initHash) ? initHash : "dashboard";
navigate(initPage);
// Carrega stats e action-stats explicitamente — navigate é síncrono, loadStats é async
loadStats();
loadActionStats();

// ── Category autocomplete (após navigate para não bloquear init) ────────────
(function initAdminCatAutocomplete() {
  const input = document.getElementById("cat-group");
  const dd = document.getElementById("cat-group-dropdown");
  const clr = document.getElementById("cat-group-clear");
  if (!input || !dd) return;

  // Mostra X se já houver categoria salva
  if (catFilter && clr) clr.style.display = "";

  // Escapa overflow:hidden do .table-wrap e overflow-x:auto do .table-toolbar
  document.body.appendChild(dd);

  if (clr)
    clr.addEventListener("mousedown", function (e) {
      e.preventDefault();
      setCatFilter("");
      dd.hidden = true;
    });

  function _pos() {
    const r = input.getBoundingClientRect();
    dd.style.top = r.bottom + 4 + "px";
    dd.style.left = r.left + "px";
    dd.style.width = r.width + "px";
  }

  input.addEventListener("focus", async function () {
    if (!_cachedCategories.length) await _fetchCategories();
    _renderAdminCatDropdown(this.value.trim());
    _pos();
  });
  input.addEventListener("input", function () {
    _renderAdminCatDropdown(this.value.trim());
    _pos();
    if (!this.value.trim() && catFilter) setCatFilter("");
  });

  dd.addEventListener("mousedown", function (e) {
    const opt = e.target.closest(".cat-option");
    if (!opt) return;
    e.preventDefault();
    const val = opt.dataset.val;
    input.value = val;
    dd.hidden = true;
    setCatFilter(val);
  });

  input.addEventListener("blur", function () {
    setTimeout(() => {
      dd.hidden = true;
    }, 150);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      this.value = catFilter;
      dd.hidden = true;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const first = dd.querySelector(".cat-option");
      if (!first) return;
      const val = first.dataset.val;
      this.value = val;
      dd.hidden = true;
      setCatFilter(val);
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      dd.hidden = true;
    },
    true,
  );
  window.addEventListener("resize", () => {
    dd.hidden = true;
  });
})();
