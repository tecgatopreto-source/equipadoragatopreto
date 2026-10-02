// Página de passagem: o Catálogo não tem login próprio (entrada só pela Central).
// Com a sessão da Central (gp_session), troca o token pelo cookie daqui e segue
// para a área pedida; sem sessão, mostra "Entre pela Central".
const BASE = document.documentElement.dataset.base || '';
const S = window.SessaoCatalogo;
const PARA = new URLSearchParams(location.search).get('para');

function mostrar(tela) {
  document.querySelectorAll('[data-tela]').forEach((el) => { el.hidden = el.dataset.tela !== tela; });
}

function seguir(usuario) {
  localStorage.setItem('gp_user', JSON.stringify(usuario));
  location.replace(BASE + S.destinoAposEntrar(usuario.role, PARA));
}

async function entrar() {
  mostrar('carregando');
  const central = S.lerSessaoCentral(localStorage.getItem('gp_session'));
  if (!central) return mostrar('entrar');
  try {
    const r = await fetch(BASE + '/api/auth/sso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ access_token: central.token }),
    });
    const corpo = await r.json().catch(() => ({}));
    if (r.ok) return seguir(corpo.user);
    mostrar(S.telaDaPassagem(r.status, corpo.error));
  } catch (_) {
    mostrar('erro');
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'go-catalog') { e.preventDefault(); location.href = BASE + '/'; }
  if (el.dataset.action === 'tentar-de-novo') entrar();
});

// Login local de desenvolvimento: o formulário só existe no HTML com LOGIN_LOCAL=1.
const formLocal = document.getElementById('loginForm');
if (formLocal) {
  formLocal.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn');
    const err = document.getElementById('err');
    err.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const r = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(corpo.error === 'no_access'
          ? 'Acesso não autorizado a este sistema.'
          : 'E-mail ou senha incorretos. Tente novamente.');
      }
      seguir(corpo.user);
    } catch (ex) {
      document.getElementById('err-text').textContent = ex.message;
      err.style.display = 'flex';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}

entrar();
