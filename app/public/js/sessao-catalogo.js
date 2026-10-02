// Decisões sobre a sessão, sem tocar em DOM nem rede — testadas em
// test/sessao-catalogo.test.js. No navegador viram `window.SessaoCatalogo`
// (carregado antes de index.js e login.js); no Node, `module.exports`.
//
// Entrada só pela Central (login único): o Catálogo lê a sessão `gp_session`
// que a Central grava (mesma origem em produção) e troca o token pelo cookie
// gp_auth daqui em /api/auth/sso.
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.SessaoCatalogo = m;
})(typeof self !== 'undefined' ? self : this, function () {
  /** gp_session (texto do localStorage) → { token, userId }, ou null se não houver sessão. */
  function lerSessaoCentral(bruto) {
    try {
      const s = JSON.parse(bruto || 'null');
      if (!s || !s.access_token) return null;
      return { token: s.access_token, userId: (s.user && s.user.id) || null };
    } catch (_) {
      return null;
    }
  }

  /** Botão da página pública conforme o papel no Catálogo; null = nenhum botão. */
  function botaoDoPainel(usuario) {
    if (!usuario) return null;
    if (usuario.role === 'admin') return { rotulo: 'Painel admin', caminho: '/admin' };
    if (usuario.role === 'user') return { rotulo: 'Conferente', caminho: '/conferente' };
    return null;
  }

  /** Trocar o token da Central pelo cookie daqui? Sim sem cookie válido ou se o cookie é de outra conta. */
  function precisaEntrarDeNovo(central, usuarioDoCatalogo) {
    return !usuarioDoCatalogo || usuarioDoCatalogo.id !== central.userId;
  }

  /**
   * Sem sessão da Central: em produção, a pessoa saiu pela Central → 'encerrar' o
   * cookie daqui. No modo local (LOGIN_LOCAL=1) a Central roda em outra origem e a
   * sessão nunca aparece → 'usar_cookie' do login local.
   */
  function semSessaoDaCentral(modoLocal) {
    return modoLocal ? 'usar_cookie' : 'encerrar';
  }

  /**
   * Aonde ir depois de entrar. `para` vem da URL (?para=), mas só escolhe entre
   * as áreas que o papel abre — nunca vira endereço livre.
   */
  function destinoAposEntrar(papel, para) {
    if (papel === 'admin') return para === 'conferente' ? '/conferente' : '/admin';
    if (papel === 'user') return '/conferente';
    return '/';
  }

  /** Página de passagem: o que mostrar quando a ponte (/api/auth/sso) não deu certo. */
  function telaDaPassagem(status, erro) {
    if (status === 401 && erro === 'no_access') return 'sem_acesso';
    if (status === 401) return 'entrar';
    if (status === 429) return 'limite';
    return 'erro';
  }

  return { lerSessaoCentral, botaoDoPainel, precisaEntrarDeNovo, semSessaoDaCentral, destinoAposEntrar, telaDaPassagem };
});
