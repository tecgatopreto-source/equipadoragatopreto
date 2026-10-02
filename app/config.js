// Configuração lida do ambiente que decide comportamento de segurança.

/**
 * Login por senha direto no Catálogo: só na máquina de desenvolvimento, onde a
 * Central roda em outra porta (outra origem) e o login único não enxerga a
 * sessão `gp_session`. Ligado com LOGIN_LOCAL=1 no .env local.
 *
 * Recusa subir com LOGIN_LOCAL=1 e NODE_ENV=production: um erro de configuração
 * não pode reabrir a porta de senha em produção.
 */
function loginLocalLigado(env) {
  const ligado = env.LOGIN_LOCAL === '1';
  if (ligado && env.NODE_ENV === 'production') {
    throw new Error('[FATAL] LOGIN_LOCAL=1 não pode ser usado com NODE_ENV=production: em produção a entrada é só pela Central.');
  }
  return ligado;
}

module.exports = { loginLocalLigado };
