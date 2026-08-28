const _SVG_BASE = document.documentElement.dataset.base || '';

// Mapa direto: valor exato de categoria no banco (maiúsculas) → arquivo em app/svg/
const _CAT_SVG = {
  'ABRACADEIRA':                     'abracadeira',
  'ACABAMENTO BANCO/INTERIORES':     'acabamento-banco-interiores',
  'ACABAMENTO EXTERNO/CARROCERIA':   'acabamento-externo-carroceria',
  'ACABAMENTO PORTA VIDRO':          'acabamento-porta-vidro',
  'ACESSORIOS E PEÇAS COMPLEMENTA':  'acessorios-e-pecas-complementares',
  'ADESIVOS':                        'adesivos',
  'AMORTECEDORES VARIADOS':          'amortecedores-variados',
  'APLIQUE/ANTENAS':                 'aplique-antenas',
  'BATERIA':                         'bateria',
  'BOLA CAMBIO/COIFA':               'bola-cambio-coifa',
  'BOMBAS/BRUCUTUS/RESERVATORIO':    'bombas-brucutus-reservatorio',
  'BORRACHA':                        'borracha',
  'BORRACHA PARA PORTA':             'borracha-para-porta',
  'BORRACHAS/PT/PB/ML/VD':           'borrachas-pt-pb-ml-vd',
  'BUZINAS':                         'buzinas',
  'CABO':                            'cabo',
  'CALOTA':                          'calota',
  'CAPA':                            'capa',
  'CAPOTA':                          'capota',
  'CINTO DE SEGURANÇA':              'cinto-de-seguranca',
  'DEFLETOR/CALHA DE CHUVA':         'defletor-calha-de-chuva',
  'DIFUSOR':                         'difusor',
  'ELETRONICOS':                     'eletronicos',
  'EMBLEMAS':                        'emblemas',
  'ENGATE':                          'engate',
  'ESTRIBO':                         'estribo',
  'FAROL DE MILHA/AUXILIAR':         'farol-de-milha-auxiliar',
  'FAROL PRINCIPAL':                 'farol-principal',
  'FECHADURA E BATENTES':            'fechadura-e-batentes',
  'FERRAGEM':                        'ferragem',
  'FERRAMENTAS':                     'ferramentas',
  'FLUIDOS/ADITIVOS/AROMATIZANTES':  'fluidos-aditivos-aromatizantes',
  'FRISO/LATERAL TETO':              'friso-lateral-teto',
  'FUSIVEL':                         'fusivel',
  'GANCHO DA CACAMBA':               'gancho-da-cacamba',
  'GRAMPOS/BUCHAS/PRESILHAS':        'grampos-buchas-presilhas',
  'LAMEIRAS/PARA-BARROS':            'lameiras-para-barros',
  'LAMPADAS':                        'lampadas',
  'LANTERNA':                        'lanterna',
  'LENTE':                           'lente',
  'MACANETA/MANIVELA/ALÇA/PUX':      'macaneta-manivela-alca-pux',
  'MAQUINA VIDRO':                   'maquina-vidro',
  'OBS BAIXA':                       'obs-baixa',
  'PALHETA':                         'palheta',
  'PARA-CHOQUES':                    'para-choques',
  'PARAFUSO/PORCAS/ARRUELAS':        'parafuso-porcas-arruelas',
  'PINGADEIRAS':                     'pingadeiras',
  'PORTA MALAS':                     'porta-malas',
  'PROTETOR BORDA/TAMPA/CAÇAMBA/R':  'protetor-borda-tampa-cacamba-rodas',
  'RACK':                            'rack',
  'RETROVISOR/QUEBRA SOL':           'retrovisor-quebra-sol',
  'SANTO ANTONIO':                   'santo-antonio',
  'SOQUETES/BOTÕES':                 'soquetes-botoes',
  'SUBCONJUNTO':                     'subconjunto',
  'TAPETE':                          'tapete',
  'TRAVAS':                          'travas',
  'USO E CONSUMO':                   'uso-e-consumo',
  'VIDROS PARABRISA':                'vidros-parabrisa',
  'VOLANTE':                         'volante',
};

function _svgImg(file) {
  return `<img src="${_SVG_BASE}/svg/${file}.svg" style="width:100%;height:100%;object-fit:contain;padding:6px;opacity:.5" draggable="false">`;
}

const _SVG_GENERIC = `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg" fill="none">
  <rect x="6" y="6" width="68" height="48" rx="5" stroke="#d4d1cb" stroke-width="2" stroke-dasharray="4 3"/>
  <text x="40" y="38" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#d4d1cb" font-weight="300">?</text>
</svg>`;

function getCategoryPlaceholder(productName, categoria, isDisabled) {
  if (isDisabled) return _svgImg('desativado');
  if (categoria) {
    const key = categoria.trim().replace(/\s+/g, ' ').toUpperCase();
    if (_CAT_SVG[key]) return _svgImg(_CAT_SVG[key]);
  }
  return _SVG_GENERIC;
}

function getCategorySvgPath(categoria, isDisabled) {
  if (isDisabled) return `${_SVG_BASE}/svg/desativado.svg`;
  if (categoria) {
    const key = categoria.trim().replace(/\s+/g, ' ').toUpperCase();
    const file = _CAT_SVG[key];
    if (file) return `${_SVG_BASE}/svg/${file}.svg`;
  }
  return null;
}
