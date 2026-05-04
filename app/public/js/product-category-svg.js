const _SVG_BASE = window.APP_BASE || '';

// Mapa direto: rótulo exato de lib/categories.js → arquivo em app/svg/
const _CAT_SVG = {
  'OBS Baixa':                        'obs-baixa',
  'Porta-Malas':                      'porta-malas',
  'Forro de Porta-Malas':             'porta-malas',
  'Parafusos / Porcas / Arruelas':    'parafuso-porcas-arruelas',
  'Lâmpadas':                         'lampadas',
  'Fitas Sinalizadoras / Refletivos': 'adesivos',
  'Sinaleiros':                       'lampadas',
  'Chave de Roda':                    'ferramentas',
  'Calotas / Rodas':                  'calota',
  'Tapete':                           'tapete',
  'Forro para Porta':                 'acabamento-porta-vidro',
  'Forração':                         'acabamento-banco-interiores',
  'Forro de Painel':                  'acabamento-banco-interiores',
  'Banco':                            'acabamento-banco-interiores',
  'Soleira':                          'acabamento-externo-carroceria',
  'Trava Volante':                    'travas',
  'Trava Tanque':                     'travas',
  'Volante':                          'volante',
  'Capa de Banco':                    'capa',
  'Capa de Tanque':                   'capa',
  'Capa de Estepe':                   'capa',
  'Capa de Motor':                    'capa',
  'Coberturas':                       'capa',
  'Bolsa / Mochila':                  'capa',
  'Capa de Capô':                     'capota',
  'Capote':                           'capota',
  'Repelente / Para-Brisa':           'vidros-parabrisa',
  'Teto Solar':                       'vidros-parabrisa',
  'Cortina de Vidro':                 'vidros-parabrisa',
  'Borracha para Porta':              'borracha-para-porta',
  'Borracha (geral)':                 'borracha',
  'Limpador / Palheta':               'palheta',
  'Amortecedor':                      'amortecedores-variados',
  'Vidro Elétrico':                   'maquina-vidro',
  'Relógio / Sensor':                 'eletronicos',
  'Câmera de Ré':                     'eletronicos',
  'Módulo':                           'eletronicos',
  'Alarme':                           'eletronicos',
  'Multimídia':                       'eletronicos',
  'Carga Solar / Powerbank':          'eletronicos',
  'Ar Condicionado':                  'eletronicos',
  'Combustível':                      'fluidos-aditivos-aromatizantes',
  'Desengripante':                    'fluidos-aditivos-aromatizantes',
  'Higienização':                     'fluidos-aditivos-aromatizantes',
  'Perfume':                          'fluidos-aditivos-aromatizantes',
  'Emblema':                          'emblemas',
  'Cinto de Segurança':               'cinto-de-seguranca',
  'Limitador de Porta':               'fechadura-e-batentes',
  'Antena':                           'aplique-antenas',
  'Cabo':                             'cabo',
  'Chicote':                          'cabo',
  'Correia':                          'cabo',
  'Manutenção / Reparo':              'ferramentas',
  'Chave de Roda':                    'ferramentas',
  'Balança':                          'ferramentas',
  'Pedal':                            'ferragem',
  'Mola':                             'molas',
  'Retrovisor':                       'retrovisor-quebra-sol',
  'Escapamento':                      'difusor',
  'Extintor':                         'uso-e-consumo',
  'Desativados (D50)':                'obs-baixa',
};

// Fallback por nome do produto (para categorias digitadas manualmente ou produtos sem categoria)
const _NAME_SVG = [
  [/tapete/i,                   'tapete'],
  [/calota|roda\b/i,            'calota'],
  [/volante/i,                  'volante'],
  [/capota|capote/i,            'capota'],
  [/capa/i,                     'capa'],
  [/borracha.{0,5}porta/i,      'borracha-para-porta'],
  [/borracha/i,                 'borracha'],
  [/palheta|limpador/i,         'palheta'],
  [/amortecedor/i,              'amortecedores-variados'],
  [/para.?brisa|vidro/i,        'vidros-parabrisa'],
  [/retrovisor/i,               'retrovisor-quebra-sol'],
  [/emblema/i,                  'emblemas'],
  [/cinto/i,                    'cinto-de-seguranca'],
  [/antena/i,                   'aplique-antenas'],
  [/\bmola\b/i,                 'molas'],
  [/\bcabo\b/i,                 'cabo'],
  [/l[aâ]mpada|lanterna/i,      'lampadas'],
  [/porta.?mala/i,              'porta-malas'],
  [/parafuso|porca|arruela/i,   'parafuso-porcas-arruelas'],
  [/trava/i,                    'travas'],
  [/farol/i,                    'farol-principal'],
  [/engate/i,                   'engate'],
  [/estribo/i,                  'estribo'],
  [/rack/i,                     'rack'],
  [/defletor|calha/i,           'defletor-calha-de-chuva'],
  [/friso/i,                    'friso-lateral-teto'],
  [/fus[íi]vel/i,               'fusivel'],
  [/buzina/i,                   'buzinas'],
  [/bucha/i,                    'bucha'],
  [/grampo|presilha/i,          'grampos-buchas-presilhas'],
  [/fluido|aditivo/i,           'fluidos-aditivos-aromatizantes'],
];

function _svgImg(file) {
  return `<img src="${_SVG_BASE}/svg/${file}.svg" style="width:100%;height:100%;object-fit:contain;padding:6px;opacity:.5" draggable="false">`;
}

const _SVG_GENERIC = `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg" fill="none">
  <rect x="6" y="6" width="68" height="48" rx="5" stroke="#d4d1cb" stroke-width="2" stroke-dasharray="4 3"/>
  <text x="40" y="38" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#d4d1cb" font-weight="300">?</text>
</svg>`;

function getCategoryPlaceholder(productName, categoria) {
  if (categoria && _CAT_SVG[categoria]) return _svgImg(_CAT_SVG[categoria]);
  const n = productName || '';
  for (const [re, file] of _NAME_SVG) {
    if (re.test(n)) return _svgImg(file);
  }
  return _SVG_GENERIC;
}
