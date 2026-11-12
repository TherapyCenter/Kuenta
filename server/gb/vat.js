'use strict';
// UK VAT return (9 boxes) from the invoices and purchase invoices in KuentaPOS.
// Schemes: standard (tax point = invoice date), cash accounting (VAT when paid), flat rate scheme
// (VAT Notice 733: box 1 = flat rate × VAT-inclusive turnover, box 6 incl. VAT, boxes 4 and 7 normally 0).
// Second-hand vehicles (margin scheme, VAT Notice 718): VAT on the margin in box 1, selling price less that VAT in box 6.
const L = require('../lib');
const GB = require('./index');

const r2 = L.r2;

// one sales invoice split into VAT categories (net, VAT, gross) using the same calculation as the invoice
function venta(k) {
  const d = L.db(); const VG = require('../api/vorgang');
  const pos = d.prepare('SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? ORDER BY PRTSORT').all(k.RECHNUNGID).map(p => ({ ...p }));
  const tax = VG.calc({ ...k }, pos);
  const fuera = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z' && GB.categoria(p, k) === 'O').reduce((s, p) => s + (Number(p.SUMME) || 0), 0);
  const margen = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z' && GB.categoria(p, k) === 'M').reduce((s, p) => s + (Number(p.SUMMEBRUTTO) || 0), 0);
  let netto = 0, vat = 0;
  for (const g of Object.values(tax)) { netto += g.netto; vat += g.mwst; }
  // VAT on the margin of second-hand vehicles (purchase price from vehicle trading)
  let vatMargen = 0;
  if (margen) {
    const fz = d.prepare('SELECT SUM(EK) ek FROM SW_FZVERKAUF WHERE RECHNUNGID=?').get(k.RECHNUNGID);
    const sign = Number(k.TYP) === 2 ? -1 : 1;
    const marge = Math.max(0, Math.abs(margen) - (Number(fz && fz.ek) || 0)) * sign;
    const std = GB.tasas().standard;
    vatMargen = r2(marge * std / (100 + std));
  }
  const brutto = Number(k.GBRUTTO) || 0;
  return { k, netto: r2(netto - fuera - vatMargen), vat: r2(vat + vatMargen), brutto: r2(brutto - fuera), fuera: r2(fuera) };
}

function compras(von, bis, efectivo) {
  const d = L.db();
  if (!efectivo) return d.prepare('SELECT NETTO, MWST, BRUTTO FROM SW_EINGANG WHERE DATUM BETWEEN ? AND ?').all(von, bis);
  // cash accounting: the paid share of each purchase invoice
  return d.prepare('SELECT z.BETRAG, e.NETTO, e.MWST, e.BRUTTO FROM SW_EINGANG_ZAHLUNG z JOIN SW_EINGANG e ON e.ID=z.EINGANGID WHERE z.DATUM BETWEEN ? AND ?').all(von, bis)
    .map(z => { const f = Number(z.BRUTTO) ? z.BETRAG / z.BRUTTO : 0; return { NETTO: z.NETTO * f, MWST: z.MWST * f, BRUTTO: z.BETRAG }; });
}

function ventas(von, bis, efectivo) {
  const d = L.db();
  if (!efectivo) return d.prepare('SELECT * FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ? ORDER BY DATUM, RECHNUNGNUMMER').all(von, bis).map(venta);
  // cash accounting: VAT is due when the customer pays (share of the invoice)
  const out = [];
  for (const z of d.prepare('SELECT RECHNUNGID, SUM(BETRAG) b FROM ZAHLUNGSEINGAENGE WHERE DATUM BETWEEN ? AND ? GROUP BY RECHNUNGID').all(von, bis)) {
    const k = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(z.RECHNUNGID);
    if (!k || !Number(k.GBRUTTO)) continue;
    const v = venta(k); const f = z.b / k.GBRUTTO;
    out.push({ ...v, netto: v.netto * f, vat: v.vat * f, brutto: v.brutto * f, fuera: v.fuera * f });
  }
  return out;
}

// boxes 6-9 are whole pounds
const libra = n => Math.round(Number(n) || 0);

function calcular({ von, bis } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  const schema = GB.schema(); const efectivo = schema === 'cash';
  const vs = ventas(von, bis, efectivo); const cs = compras(von, bis, efectivo);
  let box1, box4, box6, box7;
  if (schema === 'flat') {
    const umsatz = vs.reduce((s, v) => s + v.brutto, 0); // VAT-inclusive turnover without disbursements
    box1 = r2(umsatz * GB.flatRate() / 100);
    box4 = 0; box6 = libra(umsatz); box7 = 0;
  } else {
    box1 = r2(vs.reduce((s, v) => s + v.vat, 0));
    box4 = r2(cs.reduce((s, c) => s + (Number(c.MWST) || 0), 0));
    box6 = libra(vs.reduce((s, v) => s + v.netto, 0));
    box7 = libra(cs.reduce((s, c) => s + (Number(c.NETTO) || 0), 0));
  }
  if (!GB.registrado()) { box1 = 0; box4 = 0; }
  const box2 = 0, box8 = 0, box9 = 0; // EU acquisitions only for Northern Ireland, not supported
  const box3 = r2(box1 + box2);
  return {
    von, bis, schema, rechnungen: vs.length, eingang: cs.length,
    boxes: { vatDueSales: box1, vatDueAcquisitions: box2, totalVatDue: box3, vatReclaimedCurrPeriod: box4, netVatDue: r2(Math.abs(box3 - box4)),
      totalValueSalesExVAT: box6, totalValuePurchasesExVAT: box7, totalValueGoodsSuppliedExVAT: box8, totalAcquisitionsExVAT: box9 },
    erstattung: box4 > box3, // the business gets money back
  };
}

module.exports = { calcular, venta };
