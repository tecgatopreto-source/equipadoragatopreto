const BASE = document.documentElement.dataset.base || '';

function redirectByRole(user) {
  localStorage.setItem('gp_user', JSON.stringify(user));
  const role = user.role;
  window.location.href = role === 'admin' ? BASE + '/admin' : role === 'conferente' ? BASE + '/conferente' : BASE + '/';
}

// SSO: se existe a sessão Supabase compartilhada dos sistemas Gato Preto
// ('gp_session', gravada pela Central de Sistemas na mesma origem), troca o
// access_token pelo cookie gp_auth sem pedir senha. Falhou → formulário normal.
(async () => {
  try {
    const raw = localStorage.getItem('gp_session');
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (!stored || !stored.access_token) return;

    const res = await fetch(BASE + '/api/auth/sso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ access_token: stored.access_token })
    });
    if (!res.ok) return;

    const data = await res.json();
    redirectByRole(data.user);
  } catch (_) { /* segue para o login manual */ }
})();

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn');
  const err = document.getElementById('err');
  const errText = document.getElementById('err-text');
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  try {
    const res = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error === 'no_access'
        ? 'Acesso não autorizado a este sistema.'
        : 'E-mail ou senha incorretos. Tente novamente.';
      throw new Error(msg);
    }

    redirectByRole(data.user);
  } catch (ex) {
    errText.textContent = ex.message;
    err.style.display = 'flex';
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'go-catalog') {
    e.preventDefault();
    location.href = BASE + '/';
  }
});
