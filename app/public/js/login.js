document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn');
  const err = document.getElementById('err');
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao fazer login');

    localStorage.setItem('gp_token', data.token);
    localStorage.setItem('gp_user', JSON.stringify(data.user));
    window.location.href = data.user.role === 'admin' ? '/admin' : '/';
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});