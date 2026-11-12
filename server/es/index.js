'use strict';
// Spanish tax system (per tenant): IVA rates, recargo de equivalencia, invoice series, NIF of the issuer.
// Switched on with the setting steuer.land = ES; without it KuentaPOS works with German tax law as before.
const L = require('../lib');
const NIF = require('../../public/js/nif.js');

const activo = () => L.sw('steuer.land', 'DE') === 'ES';

// IVA rates: tax codes 61..64 of KFZ-Faktura are reused (61 general, 62 reduced, 63 exempt, 64 super-reduced)
function tasas() {
  const n = (k, d) => { const v = Number(String(L.sw(k, d)).replace(',', '.')); return Number.isFinite(v) ? v : Number(d); };
  return { general: n('es.iva.general', '21'), reducido: n('es.iva.reducido', '10'), superreducido: n('es.iva.superreducido', '4') };
}
function mwstRates() { const t = tasas(); return { 61: t.general, 62: t.reducido, 63: 0, 64: t.superreducido }; }
function mwstList() {
  const t = tasas();
  return [
    { id: 61, name: `IVA general (${t.general} %)`, rate: t.general },
    { id: 62, name: `IVA reducido (${t.reducido} %)`, rate: t.reducido },
    { id: 64, name: `IVA superreducido (${t.superreducido} %)`, rate: t.superreducido },
    { id: 63, name: 'Exento / suplido (0 %)', rate: 0 },
  ];
}

// recargo de equivalencia (art. 161 LIVA) for customers in that regime
const RECARGO = { 21: 5.2, 10: 1.4, 5: 0.62, 4: 0.5, 2: 0.26 };
const recargo = rate => RECARGO[Number(rate)] ?? 0;

// invoice series: separate series for corrective invoices (art. 6.1.a RD 1619/2012)
const serie = typ => Number(typ) === 2 ? L.sw('es.serie.rectificativa', 'R') : L.sw('es.serie.factura', 'F');
const numSerie = k => k.ESNUMSERIE || `${serie(k.TYP)}${k.RECHNUNGNUMMER}`;

// simplified invoice (factura simplificada) up to this amount (art. 4 RD 1619/2012: 400 €, 3,000 € for some trades)
const limite = () => Number(L.sw('es.limite.simplificada', '400')) || 400;

function nifEmisor() {
  const f = L.firma();
  for (const v of [f.STEUERNR, f.USTNR]) { const r = NIF.validar(v); if (r.ok) return r.nif; }
  return '';
}

module.exports = { RECARGO, activo, tasas, mwstRates, mwstList, recargo, serie, numSerie, limite, nifEmisor, NIF };
