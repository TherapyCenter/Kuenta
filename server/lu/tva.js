'use strict';
// Luxembourg VAT return (déclaration TVA mensuelle TVA_DECM / trimestrielle TVA_DECT) by the field numbers of the
// eCDF form, and the XML file for the eCDF portal (schema eCDF_file_v2.0-XML_schema.xsd of the CTIE).
// I. turnover: 454/472 sales, 012 overall turnover, 021 exemptions (457 intra-community supplies, 014 exports,
// 015 other exemptions, 481 small business, 423 services to EU businesses), 022 taxable turnover.
// II. tax due: base and tax per rate (701/702 17 %, 703/704 14 %, 705/706 8 %, 031/040 3 %), 037 / 046 / 076.
// III./IV. input tax 458 / 093 / 102, 103 total tax due, 104 deductible, 105 balance.
// Small businesses under the franchise file only the annual return.
const L = require('../lib');
const LU = require('./index');
const U = require('../umsatz');

const r2 = L.r2;
const periode = () => (L.sw('lu.periode', 'trimestre') === 'mois' ? 'mois' : 'trimestre');
// fields of base and tax per rate (also the temporary rates of 2023)
const SATZ = { 17: ['701', '702'], 16: ['901', '902'], 14: ['703', '704'], 13: ['903', '904'], 8: ['705', '706'], 7: ['905', '906'], 3: ['031', '040'] };

function berechnen({ von, bis } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  if (LU.franchise()) throw new L.HttpError(409, 'Kleinunternehmen mit Franchise (Art. 57) reichen nur die jährliche MwSt-Erklärung ein.');
  const u = U.umsaetze(von, bis, { klein: false });
  const v = U.vorsteuer(von, bis);
  const f = {}; const add = (n, x) => { f[n] = r2((f[n] || 0) + x); };
  // tax due per rate: the normal / reduced / intermediate groups and the margin scheme at the normal rate
  for (const g of [u.normal, u.ermaessigt, u.ermaessigt2]) {
    if (!g.netto && !g.steuer) continue;
    const box = SATZ[g.rate]; if (!box) throw new L.HttpError(400, `Kein eCDF-Feld für den Steuersatz ${g.rate} %.`);
    add(box[0], g.netto); add(box[1], g.steuer);
  }
  if (u.marge.netto || u.marge.steuer) { const box = SATZ[LU.tasas().normal] || SATZ[17]; add(box[0], u.marge.netto); add(box[1], u.marge.steuer); }
  add('457', u.igl); add('014', u.ausfuhr); add('015', u.frei); add('423', u.ausland);
  const steuerbar = Object.values(SATZ).reduce((s, b) => s + (f[b[0]] || 0), 0);
  const befreit = r2((f['457'] || 0) + (f['014'] || 0) + (f['015'] || 0) + (f['423'] || 0));
  f['454'] = r2(steuerbar + befreit); f['472'] = f['454'];
  f['012'] = f['454']; f['021'] = befreit; f['022'] = r2(f['012'] - f['021']);
  f['037'] = r2(steuerbar);
  f['046'] = r2(Object.values(SATZ).reduce((s, b) => s + (f[b[1]] || 0), 0));
  f['076'] = f['046'];
  f['458'] = r2(v.steuer); f['093'] = f['458']; f['102'] = f['093'];
  f['103'] = f['076']; f['104'] = f['102']; f['105'] = r2(f['103'] - f['104']);
  for (const k of Object.keys(f)) if (Math.abs(f[k]) < 0.005 && !['012', '022', '103', '104', '105'].includes(k)) delete f[k];
  return { von, bis, periode: periode(), rechnungen: u.rechnungen, eingang: v.belege, felder: f, saldo: f['105'] || 0, durchlaufend: r2(u.dp) };
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zahl = v => { const n = Math.round((Number(v) || 0) * 100) / 100; return n.toFixed(2).replace('.', ','); };

// eCDF file: the agent is the company itself (prefix, national identification number, RCS and VAT number from the settings)
function xml(q) {
  const r = berechnen(q);
  const t = LU.tva(); if (!t) throw new L.HttpError(400, 'TVA-Nummer der Firma fehlt oder ist ungültig.');
  const prefix = String(L.sw('lu.ecdf.prefix', '')).toUpperCase();
  if (!/^[0-9A-Z]{6}$/.test(prefix)) throw new L.HttpError(400, 'eCDF-Präfix fehlt (6 Zeichen, Einstellungen → Lëtzebuerg).');
  const matr = String(L.sw('lu.matricule', '')).replace(/\D/g, '');
  if (!/^\d{11,13}$/.test(matr)) throw new L.HttpError(400, 'Matricule (11 bis 13 Ziffern) fehlt (Einstellungen → Lëtzebuerg).');
  const rcs = String(L.sw('lu.rcs', '') || 'NE').replace(/\s/g, '').slice(0, 7) || 'NE';
  const now = new Date(); const p = n => String(n).padStart(2, '0');
  const ref = `${prefix}X${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}01`;
  const jahr = String(q.von).slice(0, 4); const monat = Number(String(q.von).slice(5, 7));
  const typ = r.periode === 'mois' ? 'TVA_DECM' : 'TVA_DECT';
  const per = r.periode === 'mois' ? monat : Math.ceil(monat / 3);
  const sprache = LU.de() ? 'DE' : 'FR';
  const felder = Object.entries(r.felder).sort(([a], [b]) => Number(a) - Number(b)).map(([id, v]) => `<NumericField id="${Number(id)}">${zahl(v)}</NumericField>`).join('');
  const agent = `<MatrNbr>${matr}</MatrNbr><RCSNbr>${esc(rcs)}</RCSNbr><VATNbr>${t.nr}</VATNbr>`;
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<eCDFDeclarations xmlns="http://www.ctie.etat.lu/2011/ecdf">
<FileReference>${ref}</FileReference>
<eCDFFileVersion>2.0</eCDFFileVersion>
<Interface>${esc(String(L.sw('lu.ecdf.interface', 'KUENTA')).slice(0, 20))}</Interface>
<Agent>${agent}</Agent>
<Declarations><Declarer>${agent}
<Declaration type="${typ}" model="1" language="${sprache}"><Year>${jahr}</Year><Period>${per}</Period><FormData>${felder}</FormData></Declaration>
</Declarer></Declarations>
</eCDFDeclarations>
`;
  return { buffer: Buffer.from(out, 'utf8'), filename: `${ref}.xml`, daten: r };
}

module.exports = { berechnen, xml, SATZ };
