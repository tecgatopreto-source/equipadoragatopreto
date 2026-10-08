// Página de passagem: o Catálogo não tem login próprio (entrada só pela Central).
// Com a sessão da Central (gp_session), confere o acesso em /api/auth/me e segue
// para a área pedida; sem sessão, mostra "Entre pela Central".
const S = window.SessaoCatalogo;
const PARA = new URLSearchParams(location.search).get('para');

function mostrar(tela) {
  document.querySelectorAll('[data-tela]').forEach((el) => { el.hidden = el.dataset.tela !== tela; });
}

async function entrar() {
  mostrar('carregando');
  const { status, usuario } = await SessaoGP.quemSou();
  if (status === 200) return location.replace(SessaoGP.BASE + S.destinoAposEntrar(usuario.role, PARA));
  mostrar(S.telaDaPassagem(status));
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'go-catalog') { e.preventDefault(); location.href = SessaoGP.BASE + '/'; }
  if (el.dataset.action === 'tentar-de-novo') entrar();
});

// Login local de desenvolvimento: o formulário só existe no HTML com LOGIN_LOCAL=1.
// Entra pelo supabase-js (grava a gp_session local) e segue pelo mesmo caminho.
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
      await SessaoGP.entrarComSenha(document.getElementById('email').value, document.getElementById('password').value);
    } catch (_) {
      document.getElementById('err-text').textContent = 'E-mail ou senha incorretos. Tente novamente.';
      err.style.display = 'flex';
      btn.disabled = false;
      btn.textContent = 'Entrar';
      return;
    }
    entrar();
  });
}

entrar();
