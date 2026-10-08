// Sessão do Catálogo no navegador (ADR 0010; plano de 08/10/2026). Vira
// `window.SessaoGP`. Precisa, antes dele: js/vendor/supabase-*.min.js e
// js/sessao-catalogo.js. Testado em test/sessao-navegador.test.js.
//
// Não há sessão própria nem cookie: o supabase-js lê a `gp_session` que a Central
// grava (mesma origem em produção) e a RENOVA sozinho (coordenando as abas), como
// nos outros sistemas. Toda chamada à API leva `Authorization: Bearer <token>`;
// o servidor confere a assinatura e lê o papel em public.perfis a cada chamada.
(function () {
  'use strict';
  const dados = document.documentElement.dataset;
  const BASE = dados.base || '';

  const cliente = window.supabase.createClient(dados.supabaseUrl, dados.supabaseAnon, {
    auth: { storageKey: 'gp_session', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  // Sobra da sessão antiga (até 08/10/2026 o papel ficava guardado aqui).
  try { localStorage.removeItem('gp_user'); } catch (_) {}

  async function tokenAtual() {
    const { data } = await cliente.auth.getSession();
    return data && data.session ? data.session.access_token : null;
  }

  // Uma renovação por vez: várias chamadas que voltam 401 juntas esperam a mesma,
  // em vez de cada uma girar o refresh token da sessão compartilhada pelos 6 sistemas.
  let renovando = null;
  function renovar() {
    renovando ||= cliente.auth.refreshSession()
      .then(({ data }) => (data && data.session ? data.session.access_token : null))
      .catch(() => null)
      .finally(() => { renovando = null; });
    return renovando;
  }

  /**
   * fetch na API daqui com o token da sessão. `caminho` começa em /api. Em 401,
   * tenta de novo com um token novo: o que outra chamada (ou aba) já renovou, ou
   * renova uma vez. Devolve a Response; quem chama decide o que fazer com o status.
   */
  async function apiFetch(caminho, opcoes = {}) {
    const pedir = (token) => fetch(BASE + caminho, {
      ...opcoes,
      headers: { ...(opcoes.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const token = await tokenAtual();
    const r = await pedir(token);
    if (r.status !== 401 || !token) return r;
    let novo = await tokenAtual();
    if (novo === token) novo = await renovar();
    return novo && novo !== token ? pedir(novo) : r;
  }

  /** Quem sou no Catálogo: { status, usuario }. Sem sessão: 401 sem chamar a API; erro/rede: 0. */
  async function quemSou() {
    try {
      if (!(await tokenAtual())) return { status: 401, usuario: null };
      const r = await apiFetch('/api/auth/me');
      const corpo = await r.json().catch(() => ({}));
      return { status: r.status, usuario: r.ok ? corpo.user : null };
    } catch (_) {
      // Inclui getSession falhando (ex.: disputa de lock entre abas, storage bloqueado).
      return { status: 0, usuario: null };
    }
  }

  /**
   * Chama `fn` quando a sessão compartilhada termina (Sair na Central) ou passa a
   * ser de OUTRA conta (entrou com outra pessoa em outra aba). `idAtual()` diz a
   * conta que a página está mostrando (null = ninguém). O supabase-js também manda
   * SIGNED_IN quando a aba volta a ficar visível, sem mudança nenhuma — por isso a
   * comparação do id (mesmo cuidado do Estoque, features/entrada/estado.js).
   */
  function aoMudarConta(idAtual, fn) {
    cliente.auth.onAuthStateChange((evento, sessao) => {
      const id = sessao && sessao.user ? sessao.user.id : null;
      if (evento === 'SIGNED_OUT' || (evento === 'SIGNED_IN' && id !== idAtual())) fn();
    });
  }

  // /admin e /conferente começam escondidos pelo próprio CSS da página
  // (html:not([data-sessao]) body), antes de qualquer desenho; isto os mostra.
  function mostrarPagina() { document.documentElement.dataset.sessao = 'conferida'; }

  function mostrarErroDeAcesso() {
    const caixa = document.createElement('div');
    caixa.setAttribute('role', 'alert');
    caixa.style.cssText = 'max-width:28rem;margin:4rem auto;padding:1.5rem;font:16px/1.5 system-ui,sans-serif;text-align:center';
    const texto = document.createElement('p');
    texto.textContent = 'Não foi possível conferir o acesso agora. Tente de novo em instantes.';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'Tentar de novo';
    botao.addEventListener('click', () => location.reload());
    caixa.append(texto, botao);
    document.body.replaceChildren(caixa);
    mostrarPagina();
  }

  /**
   * Proteção de /admin e /conferente (decisão D1): confere antes de mostrar a
   * página. Resolve com o usuário quando liberado; nos outros casos redireciona
   * (ou mostra o erro) e a promessa nunca resolve — a página não segue.
   */
  async function exigirArea(area) {
    const { status, usuario } = await quemSou();
    const decisao = window.SessaoCatalogo.decidirPagina(area, status, usuario && usuario.role);
    if (decisao === 'liberado') {
      mostrarPagina();
      // Saiu pela Central ou trocou de conta (em qualquer aba): confere tudo de novo.
      aoMudarConta(() => usuario.id, () => location.reload());
      return usuario;
    }
    if (decisao === 'conferente') location.replace(BASE + '/conferente');
    else if (decisao === 'entrar') location.replace(`${BASE}/login?para=${area}`);
    else mostrarErroDeAcesso();
    return new Promise(() => {});
  }

  /** Só no modo local (LOGIN_LOCAL=1): entra por senha e grava a gp_session local. */
  async function entrarComSenha(email, senha) {
    const { error } = await cliente.auth.signInWithPassword({ email: email.toLowerCase().trim(), password: senha });
    if (error) throw error;
  }

  window.SessaoGP = { BASE, apiFetch, quemSou, exigirArea, aoMudarConta, entrarComSenha, tokenAtual };
})();
