'use strict';
// Sales of a period split by tax treatment, for VAT returns (Austrian UVA, Swiss MWST return).
// Accrual basis (invoice date) or cash basis (share of each invoice paid in the period).
// Buckets: normal / reduced / reduced2 (net and tax as on the invoice, codes 61 / 62 / 64), exempt (code 63),
// export, intra-community supply, place of supply abroad (reverse charge), small business, margin scheme
// (net margin and its tax at the normal rate, purchase price of the vehicle), disbursements (outside the scope).
const L = require('./lib');

const r2 = L.r2;
const leer = () => ({ normal: { netto: 0, steuer: 0, rate: 0 }, ermaessigt: { netto: 0, steuer: 0, rate: 0 }, ermaessigt2: { netto: 0, steuer: 0, rate: 0 },
  frei: 0, ausfuhr: 0, igl: 0, ausland: 0, klein: 0, marge: { netto: 0, steuer: 0, ek: 0, verkauf: 0 }, dp: 0, brutto: 0 });
const BUCKET = { 61: 'normal', 62: 'ermaessigt', 64: 'ermaessigt2' };

function rechnung(k, klein) {
  const d = L.db(); const VG = require('./api/vorgang');
  const pos = d.prepare('SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? ORDER BY PRTSORT').all(k.RECHNUNGID).map(p => ({ ...p }));
  const tax = VG.calc({ ...k }, pos);
  const u = leer();
  const std = L.mwstRates()[61] || 0;
  u.brutto = Number(k.GBRUTTO) || 0;
  for (const [code, g] of Object.entries(tax)) {
    const b = BUCKET[code];
    if (b && !klein && g.rate > 0) { u[b].netto += g.netto; u[b].steuer += g.mwst; u[b].rate = g.rate; }
  }
  let margeBrutto = 0;
  for (const p of pos) {
    if (p.POSART === 'T' || p.POSART === 'Z') continue;
    const n = Number(p.SUMME) || 0;
    if (Number(p.DURCHLAUFER) === 1) { u.dp += n; continue; }
    if (Number(p.DIFFSTEUER) === 1 && !k.STEUERART) { margeBrutto += Number(p.SUMMEBRUTTO) || 0; continue; }
    if (k.STEUERART === 'AUSFUHR') u.ausfuhr += n;
    else if (k.STEUERART === 'IG_LIEFERUNG') u.igl += n;
    else if (k.STEUERART) u.ausland += n;
    else if (klein) u.klein += n;
    else if (!BUCKET[Number(p.MWST) || 61] || !(tax[Number(p.MWST) || 61] && tax[Number(p.MWST) || 61].rate > 0)) u.frei += n;
  }
  if (margeBrutto) {
    // margin scheme: tax on the margin (sale price less purchase price from vehicle trading)
    const fz = d.prepare('SELECT SUM(EK) ek FROM SW_FZVERKAUF WHERE RECHNUNGID=?').get(k.RECHNUNGID);
    const sign = margeBrutto < 0 ? -1 : 1;
    const ek = (Number(fz && fz.ek) || 0) * sign;
    const marge = Math.max(0, Math.abs(margeBrutto) - Math.abs(ek)) * sign;
    const steuer = klein ? 0 : r2(marge * std / (100 + std));
    Object.assign(u.marge, { netto: r2(marge - steuer), steuer, ek: r2(ek), verkauf: r2(margeBrutto - steuer) });
  }
  return u;
}

function addieren(a, b, f = 1) {
  for (const k of ['normal', 'ermaessigt', 'ermaessigt2']) { a[k].netto += b[k].netto * f; a[k].steuer += b[k].steuer * f; a[k].rate = a[k].rate || b[k].rate; }
  for (const k of ['frei', 'ausfuhr', 'igl', 'ausland', 'klein', 'dp', 'brutto']) a[k] += b[k] * f;
  for (const k of ['netto', 'steuer', 'ek', 'verkauf']) a.marge[k] += b.marge[k] * f;
}
function runden(u) {
  for (const k of ['normal', 'ermaessigt', 'ermaessigt2']) { u[k].netto = r2(u[k].netto); u[k].steuer = r2(u[k].steuer); }
  for (const k of ['frei', 'ausfuhr', 'igl', 'ausland', 'klein', 'dp', 'brutto']) u[k] = r2(u[k]);
  for (const k of ['netto', 'steuer', 'ek', 'verkauf']) u.marge[k] = r2(u.marge[k]);
  return u;
}

// sales of the period; ist = cash basis
function umsaetze(von, bis, { ist = false, klein = false } = {}) {
  const d = L.db(); const sum = leer(); let n = 0;
  if (!ist) {
    for (const k of d.prepare('SELECT * FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ?').all(von, bis)) { addieren(sum, rechnung(k, klein)); n++; }
  } else {
    for (const z of d.prepare('SELECT RECHNUNGID, SUM(BETRAG) b FROM ZAHLUNGSEINGAENGE WHERE DATUM BETWEEN ? AND ? GROUP BY RECHNUNGID').all(von, bis)) {
      const k = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(z.RECHNUNGID);
      if (!k || !Number(k.GBRUTTO)) continue;
      addieren(sum, rechnung(k, klein), z.b / k.GBRUTTO); n++;
    }
  }
  return { ...runden(sum), rechnungen: n };
}

// input tax from purchase invoices (cash basis: share paid in the period)
function vorsteuer(von, bis, { ist = false } = {}) {
  const d = L.db();
  if (!ist) { const r = d.prepare('SELECT COALESCE(SUM(MWST),0) m, COALESCE(SUM(NETTO),0) n, COUNT(*) c FROM SW_EINGANG WHERE DATUM BETWEEN ? AND ?').get(von, bis); return { steuer: r2(r.m), netto: r2(r.n), belege: r.c }; }
  let m = 0, nn = 0, c = 0;
  for (const z of d.prepare('SELECT z.BETRAG, e.NETTO, e.MWST, e.BRUTTO FROM SW_EINGANG_ZAHLUNG z JOIN SW_EINGANG e ON e.ID=z.EINGANGID WHERE z.DATUM BETWEEN ? AND ?').all(von, bis)) {
    const f = Number(z.BRUTTO) ? z.BETRAG / z.BRUTTO : 0; m += (Number(z.MWST) || 0) * f; nn += (Number(z.NETTO) || 0) * f; c++;
  }
  return { steuer: r2(m), netto: r2(nn), belege: c };
}

module.exports = { umsaetze, vorsteuer, rechnung };
