'use strict';
// Swiss MWST return (Abrechnung) by Ziffern of the ESTV form since 2024: effective method or net tax rate
// method (Saldosteuersatz), agreed (Rechnungsdatum) or received payments (vereinnahmte Entgelte).
// The figures are entered in the ESTV ePortal; the CSV keeps them for the records.
const L = require('../lib');
const CH = require('./index');
const U = require('../umsatz');

const r2 = L.r2;
const ist = () => L.sw('ch.vereinnahmt', '0') === '1';
const methode = () => (L.sw('ch.methode', 'effektiv') === 'saldo' ? 'saldo' : 'effektiv');

function calcular({ von, bis } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  if (CH.nichtPflichtig()) throw new L.HttpError(409, 'Die Firma ist nicht MWST-pflichtig (Einstellungen → Schweiz).');
  const u = U.umsaetze(von, bis, { ist: ist() });
  const v = U.vorsteuer(von, bis, { ist: ist() });
  const t = CH.tasas();
  const z = {};
  const saldo = methode() === 'saldo';
  // 200: all agreed considerations (effective method without MWST, net tax rate method including MWST)
  const steuerbar = { normal: r2(u.normal.netto + u.marge.netto), reduziert: r2(u.ermaessigt.netto), beherbergung: r2(u.ermaessigt2.netto) };
  const mwstAufUmsatz = r2(u.normal.steuer + u.ermaessigt.steuer + u.ermaessigt2.steuer + u.marge.steuer);
  z['220'] = r2(u.ausfuhr + u.igl);          // exempt supplies (exports, Art. 23)
  z['221'] = r2(u.ausland);                  // supplies abroad
  z['230'] = r2(u.frei);                     // excluded supplies (Art. 21)
  z['280'] = r2(u.marge.ek); // purchase price of margin-taxed vehicles
  const basis = r2(steuerbar.normal + steuerbar.reduziert + steuerbar.beherbergung + u.marge.ek);
  z['200'] = r2(basis + z['220'] + z['221'] + z['230'] + (saldo ? mwstAufUmsatz : 0));
  z['289'] = r2(z['220'] + z['221'] + z['230'] + z['280']);
  z['299'] = r2(z['200'] - z['289']);
  const zeilen = [];
  if (saldo) {
    const s1 = Number(String(L.sw('ch.saldo1', '0')).replace(',', '.')) || 0;
    zeilen.push({ ziffer: '322', text: `Saldosteuersatz ${s1} %`, umsatz: z['299'], steuer: r2(z['299'] * s1 / 100) });
  } else {
    zeilen.push({ ziffer: '303', text: `Normalsatz ${t.normal} %`, umsatz: steuerbar.normal, steuer: r2(u.normal.steuer + u.marge.steuer) });
    zeilen.push({ ziffer: '313', text: `Reduzierter Satz ${t.reduziert} %`, umsatz: steuerbar.reduziert, steuer: r2(u.ermaessigt.steuer) });
    zeilen.push({ ziffer: '343', text: `Beherbergungssatz ${t.beherbergung} %`, umsatz: steuerbar.beherbergung, steuer: r2(u.ermaessigt2.steuer) });
  }
  z['399'] = r2(zeilen.reduce((s, x) => s + x.steuer, 0));
  z['400'] = saldo ? 0 : v.steuer; // input tax on material and services
  z['405'] = 0;                    // input tax on investments: not separated in KuentaPOS's purchase invoices
  z['479'] = r2(z['400'] + z['405']);
  const saldoBetrag = r2(z['399'] - z['479']);
  z['500'] = saldoBetrag > 0 ? saldoBetrag : 0;
  z['510'] = saldoBetrag < 0 ? -saldoBetrag : 0;
  return { von, bis, methode: methode(), vereinnahmt: ist(), rechnungen: u.rechnungen, eingang: v.belege, ziffern: z, steuer: zeilen, durchlaufend: u.dp };
}

function csv(q) {
  const r = calcular(q);
  const n = v => (Math.round(v * 100) / 100).toFixed(2);
  const rows = [['Ziffer', 'Bezeichnung', 'Betrag CHF', 'Steuer CHF'],
    ['200', 'Total der vereinbarten bzw. vereinnahmten Entgelte', n(r.ziffern['200']), ''],
    ['220', 'Von der Steuer befreite Leistungen (Exporte, Art. 23)', n(r.ziffern['220']), ''],
    ['221', 'Leistungen im Ausland (Ort der Leistung im Ausland)', n(r.ziffern['221']), ''],
    ['230', 'Von der Steuer ausgenommene Inlandleistungen (Art. 21)', n(r.ziffern['230']), ''],
    ['280', 'Diverses (Ankaufspreis margenbesteuerter Gegenstände)', n(r.ziffern['280']), ''],
    ['289', 'Total Abzüge', n(r.ziffern['289']), ''],
    ['299', 'Steuerbarer Gesamtumsatz', n(r.ziffern['299']), ''],
    ...r.steuer.map(s => [s.ziffer, s.text, n(s.umsatz), n(s.steuer)]),
    ['399', 'Total geschuldete Steuer', '', n(r.ziffern['399'])],
    ['400', 'Vorsteuer auf Material- und Dienstleistungsaufwand', '', n(r.ziffern['400'])],
    ['405', 'Vorsteuer auf Investitionen und übrigem Betriebsaufwand', '', n(r.ziffern['405'])],
    ['479', 'Total Vorsteuer', '', n(r.ziffern['479'])],
    ['500', 'Zu bezahlender Betrag', '', n(r.ziffern['500'])],
    ['510', 'Guthaben der steuerpflichtigen Person', '', n(r.ziffern['510'])]];
  const q2 = v => (/[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return { buffer: Buffer.from('﻿' + rows.map(r0 => r0.map(q2).join(';')).join('\r\n') + '\r\n', 'utf8'), filename: `MWST_${q.von}_${q.bis}.csv` };
}

module.exports = { calcular, csv };
