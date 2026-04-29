// Classifies a product by its name, returning the category label or null.
// Order matters: more specific patterns must come before broader ones.
const RULES = [
  ['OBS Baixa',                       [/obs baixa/i]],
  ['Porta-Malas',                      [/porta.?mala/i]],
  ['Parafusos / Porcas / Arruelas',    [/parafuso/i, /\bporca\b/i, /arruela/i]],
  ['Lâmpadas',                         [/l[aâ]mpada/i, /lanterna/i]],
  ['Fitas Sinalizadoras / Refletivos', [/fita sinalizadora/i, /fita refletiva/i, /refletivo/i]],
  ['Sinaleiros',                       [/sinaleiro/i]],
  ['Chave de Roda',                    [/chave.{0,4}roda/i]],
  ['Calotas / Rodas',                  [/calota/i, /\broda\b/i]],
  ['Tapete',                           [/tapete/i]],
  ['Forro para Porta',                 [/forro.{0,5}porta/i]],
  ['Forração',                         [/forra[cç][aã]o/i]],
  ['Trava Volante',                    [/trava volante/i]],
  ['Volante',                          [/volante/i]],
  ['Capa de Banco',                    [/capa.{0,5}banco/i]],
  ['Capa de Capô',                     [/capa.{0,5}cap[oô]/i]],
  ['Capa de Tanque',                   [/capa.{0,5}tanque/i]],
  ['Capa de Estepe',                   [/capa.{0,5}estepe/i]],
  ['Capa de Motor',                    [/capa.{0,5}motor/i]],
  ['Coberturas',                       [/cobertura/i]],
  ['Repelente / Para-Brisa',           [/para.?brisa/i, /repelente/i, /defri/i]],
  ['Borracha para Porta',              [/borracha.{0,5}porta/i]],
  ['Limpador / Palheta',               [/limpador/i, /palheta/i]],
  ['Borracha (geral)',                  [/borracha/i]],
  ['Escapamento',                      [/escapamento/i]],
  ['Amortecedor',                      [/amortecedor/i]],
  ['Correia',                          [/correia/i]],
  ['Pedal',                            [/pedal/i]],
  ['Vidro Elétrico',                   [/vidro el[eé]trico/i]],
  ['Relógio / Sensor',                 [/rel[oó]gio/i, /sensor/i]],
  ['Câmera de Ré',                     [/c[aâ]mera/i]],
  ['Módulo',                           [/m[oó]dulo/i]],
  ['Bolsa / Mochila',                  [/\bbolsa\b/i, /mochila/i]],
  ['Alarme',                           [/alarme/i]],
  ['Combustível',                      [/combust[ií]vel/i]],
  ['Emblema',                          [/emblema/i]],
  ['Cinto de Segurança',               [/cinto/i]],
  ['Soleira',                          [/soleira/i]],
  ['Desengripante',                    [/desengripante/i]],
  ['Limitador de Porta',               [/limitador.{0,5}porta/i]],
  ['Forro de Painel',                  [/forro.{0,5}painel/i]],
  ['Extintor',                         [/extintor/i]],
  ['Higienização',                     [/higieniza/i]],
  ['Capote',                           [/capote/i]],
  ['Teto Solar',                       [/teto solar/i]],
  ['Ar Condicionado',                  [/ar.condicionado/i]],
  ['Antena',                           [/antena/i]],
  ['Chicote',                          [/chicote/i]],
  ['Manutenção / Reparo',              [/manuten[cç][aã]o/i, /reparo/i]],
  ['Trava Tanque',                     [/trava.{0,5}tanque/i]],
  ['Cortina de Vidro',                 [/cortina.{0,5}vidro/i]],
  ['Mola',                             [/\bmola\b/i]],
  ['Balança',                          [/balan[cç]a/i]],
  ['Retrovisor',                       [/retrovisor/i]],
  ['Multimídia',                       [/multim[íi]dia/i, /multimedia/i]],
  ['Carga Solar / Powerbank',          [/carga solar/i, /powerbank/i]],
  ['Perfume',                          [/perfume/i]],
  ['Forro de Porta-Malas',             [/forro.{0,5}porta.?mala/i]],
  ['Cabo',                             [/\bcabo\b/i]],
  ['Banco',                            [/\bbanco\b/i]],
  ['Desativados (D50)',                [/\bd50\b/i]],
];

function classifyProduct(name) {
  if (!name) return null;
  for (const [label, patterns] of RULES) {
    if (patterns.some(re => re.test(name))) return label;
  }
  return null;
}

module.exports = { classifyProduct };
