'use strict';
// Periodic IVA settlement (liquidazione periodica, monthly or quarterly with 1 % interest) and the sales VAT
// register (registro IVA delle vendite) as CSV. Split payment invoices: the IVA is paid by the customer and is not
// part of the IVA due. Input IVA from the purchase invoices. The F24 payment code (codice tributo) is shown;
// the quarterly communication (LIPE) is filed by the user or the accountant.
const L = require('../lib');
const U = require('../umsatz');
const IT = require('./index');

const r2 = L.r2;
const trimestrale = () => L.sw('it.liquidazione.periodo', 'mensile') === 'trimestrale';

// IVA of split payment invoices in the period
function ivaSplit(von, bis) {
  const d = L.db(); let s = 0;
  for (const k of d.prepare('SELECT r.* FROM RECHNUNGEN r JOIN KUNDEN c ON c.KUNID=r.KUNID WHERE r.DATUM BETWEEN ? AND ? AND COALESCE(c.IT_SPLIT,0)=1').all(von, bis)) {
    const u = U.rechnung(k, IT.forfettario());
    s += u.normal.steuer + u.ermaessigt.steuer + u.ermaessigt2.steuer;
  }
  return r2(s);
}

// F24 payment code: monthly 6001..6012, quarterly 6031..6033, the fourth quarter with the annual return (6099)
function codiceTributo(von) {
  const m = Number(String(von).slice(5, 7));
  if (!trimestrale()) return { codice: '60' + String(m).padStart(2, '0'), scadenza: 'entro il 16 del mese successivo' };
  const q = Math.ceil(m / 3);
  return q < 4 ? { codice: '603' + q, scadenza: 'entro il 16 del secondo mese successivo al trimestre' } : { codice: '6099', scadenza: 'con il saldo della dichiarazione annuale (entro il 16 marzo)' };
}

function liquidazione({ von, bis, credito = 0 } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  const u = U.umsaetze(von, bis, { klein: IT.forfettario() });
  const v = U.vorsteuer(von, bis);
  const t = IT.tasas();
  const aliquote = [
    { aliquota: t.ordinaria, imponibile: r2(u.normal.netto), imposta: r2(u.normal.steuer) },
    { aliquota: t.ridotta, imponibile: r2(u.ermaessigt.netto), imposta: r2(u.ermaessigt.steuer) },
    { aliquota: t.ridotta2, imponibile: r2(u.ermaessigt2.netto), imposta: r2(u.ermaessigt2.steuer) },
  ];
  const split = ivaSplit(von, bis);
  const debito = r2(aliquote.reduce((s, a) => s + a.imposta, 0) - split);
  const detraibile = IT.forfettario() ? 0 : v.steuer;
  const cred = r2(Number(String(credito).replace(',', '.')) || 0);
  const saldo = r2(debito - detraibile - cred);
  const interessi = trimestrale() && saldo > 0 && codiceTributo(von).codice !== '6099' ? r2(saldo * 0.01) : 0;
  return {
    von, bis, periodo: trimestrale() ? 'trimestrale' : 'mensile', forfettario: IT.forfettario(), rechnungen: u.rechnungen, acquisti: v.belege,
    aliquote, nonImponibili: r2(u.ausfuhr + u.igl), nonSoggette: r2(u.ausland + u.klein), esenti: r2(u.frei), escluse: r2(u.dp), margine: { vendite: r2(u.marge.verkauf), imposta: r2(u.marge.steuer) },
    split, debito, detraibile, creditoPrecedente: cred, saldo, interessi, daVersare: saldo > 0 ? r2(saldo + interessi) : 0, aCredito: saldo < 0 ? -saldo : 0,
    f24: codiceTributo(von),
  };
}

// sales VAT register: one line per invoice
function registro({ von, bis } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  const d = L.db(); const t = IT.tasas();
  const n = v => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',');
  const q = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Data', 'Numero', 'Tipo', 'Cliente', 'P.IVA / C.F.', `Imponibile ${t.ordinaria}%`, `IVA ${t.ordinaria}%`, `Imponibile ${t.ridotta}%`, `IVA ${t.ridotta}%`, `Imponibile ${t.ridotta2}%`, `IVA ${t.ridotta2}%`, 'Non imponibili', 'Non soggette', 'Esenti', 'Escluse art. 15', 'Regime del margine', 'Split payment', 'Totale documento']];
  for (const k of d.prepare('SELECT * FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ? ORDER BY DATUM, RECHNUNGNUMMER').all(von, bis)) {
    const u = U.rechnung(k, IT.forfettario()); const kd = IT.kundeOf(k);
    rows.push([String(k.DATUM).slice(0, 10).split('-').reverse().join('/'), k.RECHNUNGNUMMER, Number(k.TYP) === 2 ? 'TD04' : 'TD01', [k.KUNNAME, k.KUNVORNAME].filter(Boolean).join(' '), kd.USTID || kd.IT_CF || '',
      n(u.normal.netto), n(u.normal.steuer), n(u.ermaessigt.netto), n(u.ermaessigt.steuer), n(u.ermaessigt2.netto), n(u.ermaessigt2.steuer),
      n(u.ausfuhr + u.igl), n(u.ausland + u.klein), n(u.frei), n(u.dp), n(u.marge.verkauf), IT.split(kd) ? 'S' : '', n(k.GBRUTTO)]);
  }
  return { buffer: Buffer.from('﻿' + rows.map(r => r.map(q).join(';')).join('\r\n') + '\r\n', 'utf8'), filename: `Registro_IVA_vendite_${von}_${bis}.csv` };
}

module.exports = { liquidazione, registro, codiceTributo };
