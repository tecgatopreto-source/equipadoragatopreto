// Decisões sobre a sessão, sem tocar em DOM nem rede — testadas em
// test/sessao-catalogo.test.js. No navegador viram `window.SessaoCatalogo`
// (carregado antes de js/sessao.js e das páginas); no Node, `module.exports`.
//
// Entrada só pela Central (login único). O Catálogo não tem sessão própria: usa a
// `gp_session` compartilhada e manda o token em `Authorization: Bearer` (ADR 0010).
// Quem é a pessoa e qual o papel vem sempre de GET /api/auth/me (o servidor lê o
// public.perfis na hora).
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.SessaoCatalogo = m;
})(typeof self !== 'undefined' ? self : this, function () {
  /** Botão da página pública conforme o papel no Catálogo; null = nenhum botão. */
  function botaoDoPainel(usuario) {
    if (!usuario) return null;
    if (usuario.role === 'admin') return { rotulo: 'Painel admin', caminho: '/admin' };
    if (usuario.role === 'user') return { rotulo: 'Conferente', caminho: '/conferente' };
    return null;
  }

  /**
   * /admin e /conferente, a partir do status de /api/auth/me e do papel:
   * 'liberado' | 'conferente' (conferente que abriu /admin — achado #97) |
   * 'entrar' (sem sessão, sem perfil ou papel desconhecido: a página de passagem
   * explica) | 'erro' (503, rede…: não deu para conferir, tentar de novo).
   */
  function decidirPagina(area, status, papel) {
    if (status === 200) {
      if (papel === 'admin') return 'liberado';
      if (papel === 'user') return area === 'conferente' ? 'liberado' : 'conferente';
      return 'entrar';
    }
    if (status === 401 || status === 403) return 'entrar';
    return 'erro';
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

  /** Página de passagem: o que mostrar quando /api/auth/me não liberou. */
  function telaDaPassagem(status) {
    if (status === 401) return 'entrar';
    if (status === 403) return 'sem_acesso';
    if (status === 429) return 'limite';
    return 'erro';
  }

  /**
   * Login local (LOGIN_LOCAL=1): mensagem a partir do erro do supabase-js. Só
   * credencial errada vira "senha incorreta" — rede, Supabase fora ou bloqueio por
   * excesso de tentativas não podem mandar a pessoa tentar a senha de novo.
   */
  function mensagemDoLoginLocal(erro) {
    const status = erro && erro.status;
    const codigo = erro && erro.code;
    if (codigo === 'invalid_credentials' || (status === 400 && /invalid login credentials/i.test((erro && erro.message) || ''))) {
      return 'E-mail ou senha incorretos. Tente novamente.';
    }
    if (status === 429 || codigo === 'over_request_rate_limit') return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    if (codigo === 'email_not_confirmed') return 'E-mail ainda não confirmado.';
    return 'Não foi possível entrar agora. Tente de novo.';
  }

  return { botaoDoPainel, decidirPagina, destinoAposEntrar, telaDaPassagem, mensagemDoLoginLocal };
});
