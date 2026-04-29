const SVG_TAPETE = `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg" fill="none">
  <rect x="6" y="10" width="68" height="40" rx="5" stroke="#b0a9a0" stroke-width="2.5"/>
  <rect x="13" y="17" width="54" height="26" rx="2" stroke="#c8bfb7" stroke-width="1.5" stroke-dasharray="3 2"/>
  <line x1="22" y1="17" x2="22" y2="43" stroke="#d4cec9" stroke-width="1"/>
  <line x1="32" y1="17" x2="32" y2="43" stroke="#d4cec9" stroke-width="1"/>
  <line x1="40" y1="17" x2="40" y2="43" stroke="#d4cec9" stroke-width="1"/>
  <line x1="48" y1="17" x2="48" y2="43" stroke="#d4cec9" stroke-width="1"/>
  <line x1="58" y1="17" x2="58" y2="43" stroke="#d4cec9" stroke-width="1"/>
</svg>`;

const SVG_CALOTA = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" fill="none">
  <circle cx="40" cy="40" r="33" stroke="#b0a9a0" stroke-width="2.5"/>
  <circle cx="40" cy="40" r="21" stroke="#c8bfb7" stroke-width="1.5"/>
  <circle cx="40" cy="40" r="7" stroke="#b0a9a0" stroke-width="2"/>
  <line x1="40" y1="19" x2="40" y2="33" stroke="#b0a9a0" stroke-width="1.5"/>
  <line x1="40" y1="47" x2="40" y2="61" stroke="#b0a9a0" stroke-width="1.5"/>
  <line x1="19" y1="40" x2="33" y2="40" stroke="#b0a9a0" stroke-width="1.5"/>
  <line x1="47" y1="40" x2="61" y2="40" stroke="#b0a9a0" stroke-width="1.5"/>
  <line x1="25" y1="25" x2="35" y2="35" stroke="#b0a9a0" stroke-width="1.5"/>
  <line x1="45" y1="45" x2="55" y2="55" stroke="#b0a9a0" stroke-width="1.5"/>
  <line x1="55" y1="25" x2="45" y2="35" stroke="#b0a9a0" stroke-width="1.5"/>
  <line x1="35" y1="45" x2="25" y2="55" stroke="#b0a9a0" stroke-width="1.5"/>
</svg>`;

const SVG_VOLANTE = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" fill="none">
  <circle cx="40" cy="40" r="33" stroke="#b0a9a0" stroke-width="3"/>
  <circle cx="40" cy="40" r="20" stroke="#b0a9a0" stroke-width="2.5"/>
  <circle cx="40" cy="40" r="5" fill="#b0a9a0"/>
  <line x1="40" y1="20" x2="40" y2="35" stroke="#b0a9a0" stroke-width="2.5"/>
  <line x1="23" y1="51" x2="36" y2="44" stroke="#b0a9a0" stroke-width="2.5"/>
  <line x1="57" y1="51" x2="44" y2="44" stroke="#b0a9a0" stroke-width="2.5"/>
</svg>`;

const SVG_CAPA_BANCO = `<svg viewBox="0 0 80 84" xmlns="http://www.w3.org/2000/svg" fill="none">
  <rect x="14" y="6" width="52" height="40" rx="9" stroke="#b0a9a0" stroke-width="2.5"/>
  <line x1="27" y1="46" x2="27" y2="50" stroke="#b0a9a0" stroke-width="2"/>
  <line x1="53" y1="46" x2="53" y2="50" stroke="#b0a9a0" stroke-width="2"/>
  <rect x="18" y="50" width="44" height="26" rx="6" stroke="#b0a9a0" stroke-width="2.5"/>
  <line x1="30" y1="20" x2="50" y2="20" stroke="#c8bfb7" stroke-width="1.5"/>
  <line x1="26" y1="28" x2="54" y2="28" stroke="#c8bfb7" stroke-width="1.5"/>
</svg>`;

const SVG_GENERIC = `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg" fill="none">
  <rect x="6" y="6" width="68" height="48" rx="5" stroke="#d4d1cb" stroke-width="2" stroke-dasharray="4 3"/>
  <text x="40" y="38" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#d4d1cb" font-weight="300">?</text>
</svg>`;

function getCategoryPlaceholder(productName) {
  const n = (productName || '').toLowerCase();
  if (/tapete/.test(n))         return SVG_TAPETE;
  if (/calota/.test(n))         return SVG_CALOTA;
  if (/volante/.test(n))        return SVG_VOLANTE;
  if (/capa|banco/.test(n))     return SVG_CAPA_BANCO;
  return SVG_GENERIC;
}
