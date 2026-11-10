'use strict';
// Dutch VAT return (aangifte omzetbelasting) by rubrieken: 1a hoog tarief, 1b laag tarief, 1e 0 % / not taxed
// with the supplier, 3a exports outside the EU, 3b supplies and services to EU countries, 5a-5g totals.
// Turnover in whole euros rounded down, output VAT rounded down and input VAT rounded up (in favour of the
// taxpayer, as the Belastingdienst allows). Exempt supplies and disbursements are not declared.
// The return is filed in Mijn Belastingdienst Zakelijk; services and supplies to EU businesses also go into the
// opgaaf intracommunautaire prestaties (ICP).
const L = require('../lib');
const NL = require('./index');
const U = require('../umsatz');

const r2 = L.r2;
const omlaag = v => (v >= 0 ? Math.floor(v + 1e-9) : -Math.ceil(-v - 1e-9));
const omhoog = v => (v >= 0 ? Math.ceil(v - 1e-9) : -Math.floor(-v + 1e-9));

function berekenen({ von, bis } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  const u = U.umsaetze(von, bis, { klein: NL.kor() });
  const v = U.vorsteuer(von, bis);
  const r = {
    '1a': { omzet: omlaag(u.normal.netto + u.marge.netto), btw: omlaag(u.normal.steuer + u.marge.steuer) },
    '1b': { omzet: omlaag(u.ermaessigt.netto), btw: omlaag(u.ermaessigt.steuer) },
    '1c': { omzet: omlaag(u.ermaessigt2.netto), btw: omlaag(u.ermaessigt2.steuer) },
    '1e': { omzet: 0 },
    '3a': { omzet: omlaag(u.ausfuhr) },
    '3b': { omzet: omlaag(u.igl + u.ausland) },
  };
  const a5 = r['1a'].btw + r['1b'].btw + r['1c'].btw;
  const b5 = NL.kor() ? 0 : omhoog(v.steuer);
  return {
    von, bis, kor: NL.kor(), rechnungen: u.rechnungen, inkoop: v.belege, rubrieken: r,
    '5a': a5, '5b': b5, '5c': a5 - b5, '5g': a5 - b5, terug: a5 - b5 < 0,
    vrijgesteld: r2(u.frei + u.klein), doorlopend: r2(u.dp),
    icp: r2(u.igl + u.ausland) > 0,
  };
}

function csv(q) {
  const r = berekenen(q);
  const rows = [['Rubriek', 'Omschrijving', 'Omzet', 'Omzetbelasting'],
    ['1a', 'Leveringen/diensten belast met hoog tarief', r.rubrieken['1a'].omzet, r.rubrieken['1a'].btw],
    ['1b', 'Leveringen/diensten belast met laag tarief', r.rubrieken['1b'].omzet, r.rubrieken['1b'].btw],
    ['1c', 'Leveringen/diensten belast met overige tarieven, behalve 0%', r.rubrieken['1c'].omzet, r.rubrieken['1c'].btw],
    ['1e', 'Leveringen/diensten belast met 0% of niet bij u belast', r.rubrieken['1e'].omzet, ''],
    ['3a', 'Leveringen naar landen buiten de EU (uitvoer)', r.rubrieken['3a'].omzet, ''],
    ['3b', 'Leveringen naar of diensten in landen binnen de EU', r.rubrieken['3b'].omzet, ''],
    ['5a', 'Verschuldigde omzetbelasting', '', r['5a']], ['5b', 'Voorbelasting', '', r['5b']],
    ['5c', 'Subtotaal', '', r['5c']], ['5g', r.terug ? 'Totaal terug te vragen' : 'Totaal te betalen', '', Math.abs(r['5g'])]];
  const q2 = v => { const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return { buffer: Buffer.from('﻿' + rows.map(x => x.map(q2).join(';')).join('\r\n') + '\r\n', 'utf8'), filename: `Btw-aangifte_${q.von}_${q.bis}.csv` };
}

module.exports = { berekenen, csv };
