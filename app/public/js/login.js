const BASE = window.APP_BASE || '';
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

    localStorage.setItem('gp_user', JSON.stringify(data.user));
    const role = data.user.role;
    window.location.href = role === 'admin' ? BASE + '/admin' : role === 'conferente' ? BASE + '/conferente' : BASE + '/';
  } catch (ex) {
    errText.textContent = ex.message;
    err.style.display = 'flex';
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});
