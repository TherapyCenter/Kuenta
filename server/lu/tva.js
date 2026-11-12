'use strict';
// Luxembourg VAT returns and the recapitulative statement for the eCDF platform (schema eCDF_file_v2.0-XML_schema.xsd
// of the CTIE; field numbers exactly as printed on the forms, with leading zeros: "012" is not "12").
// Periodic return TVA_DECM (monthly) / TVA_DECT (quarterly) and annual return TVA_DECA, sections I to IV:
// I. turnover: 454/472 sales, 012 overall turnover, 021 exemptions (457 intra-community supplies, 014 exports,
// 015 other exemptions, 481 small business scheme, 423 services to EU businesses), 022 taxable turnover.
// II. tax due: base and tax per rate (701/702 17 %, 703/704 14 %, 705/706 8 %, 031/040 3 %), 037 / 046 / 076.
// III./IV. input tax 458 / 093 / 102, 103 total tax due, 104 deductible, 105 balance.
// The annual return has further parts (appendices on expenses and others) that KuentaPOS does not fill.
// Recapitulative statement: TVA_LICM / TVA_LICT (intra-community supplies of goods, fields 01-04, triangular 05-08)
// and TVA_PSIM / TVA_PSIT (services to EU businesses, fields 01-04), corrections of earlier periods (16) as zero.
const L = require('../lib');
const LU = require('./index');
const U = require('../umsatz');

const r2 = L.r2;
const periode = () => (L.sw('lu.periode', 'trimestre') === 'mois' ? 'mois' : 'trimestre');
// fields of base and tax per rate (also the temporary rates of 2023)
const SATZ = { 17: ['701', '702'], 16: ['901', '902'], 14: ['703', '704'], 13: ['903', '904'], 8: ['705', '706'], 7: ['905', '906'], 3: ['031', '040'] };

// sections I to IV of a period; jahr = annual return (also for small businesses under the franchise)
function berechnen({ von, bis, jahr = false } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  const franchise = LU.franchise();
  if (franchise && !jahr) throw new L.HttpError(409, 'Kleinunternehmen mit Franchise (Art. 57) reichen nur die jährliche MwSt-Erklärung ein.');
  const u = U.umsaetze(von, bis, { klein: franchise });
  const v = U.vorsteuer(von, bis);
  const f = {}; const add = (n, x) => { f[n] = r2((f[n] || 0) + x); };
  // tax due per rate: the normal / reduced / intermediate groups and the margin scheme at the normal rate
  for (const g of [u.normal, u.ermaessigt, u.ermaessigt2]) {
    if (!g.netto && !g.steuer) continue;
    const box = SATZ[g.rate]; if (!box) throw new L.HttpError(400, `Kein eCDF-Feld für den Steuersatz ${g.rate} %.`);
    add(box[0], g.netto); add(box[1], g.steuer);
  }
  if (u.marge.netto || u.marge.steuer) { const box = SATZ[LU.tasas().normal] || SATZ[17]; add(box[0], u.marge.netto); add(box[1], u.marge.steuer); }
  add('457', u.igl); add('014', u.ausfuhr); add('015', u.frei); add('423', u.ausland); add('481', u.klein);
  const steuerbar = Object.values(SATZ).reduce((s, b) => s + (f[b[0]] || 0), 0);
  const befreit = r2(['457', '014', '015', '423', '481'].reduce((s, k) => s + (f[k] || 0), 0));
  f['454'] = r2(steuerbar + befreit); f['472'] = f['454'];
  f['012'] = f['454']; f['021'] = befreit; f['022'] = r2(f['012'] - f['021']);
  f['037'] = r2(steuerbar);
  f['046'] = r2(Object.values(SATZ).reduce((s, b) => s + (f[b[1]] || 0), 0));
  f['076'] = f['046'];
  f['458'] = franchise ? 0 : r2(v.steuer); f['093'] = f['458']; f['102'] = f['093'];
  f['103'] = f['076']; f['104'] = f['102']; f['105'] = r2(f['103'] - f['104']);
  for (const k of Object.keys(f)) if (Math.abs(f[k]) < 0.005 && !['012', '022', '103', '104', '105'].includes(k)) delete f[k];
  return { von, bis, periode: jahr ? 'annee' : periode(), rechnungen: u.rechnungen, eingang: v.belege, felder: f, saldo: f['105'] || 0, durchlaufend: r2(u.dp) };
}

// recapitulative statement: per customer (country and VAT number without the country code) the intra-community
// supplies of goods and the services to EU businesses of the period; credit notes reduce the amounts
function zusammenfassend({ von, bis } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  const d = L.db(); const waren = new Map(); const dienste = new Map(); const fehlt = [];
  for (const k of d.prepare("SELECT r.*, c.USTID FROM RECHNUNGEN r LEFT JOIN KUNDEN c ON c.KUNID=r.KUNID WHERE r.DATUM BETWEEN ? AND ? AND r.STEUERART IN ('IG_LIEFERUNG','REVERSE_CHARGE')").all(von, bis)) {
    const u = U.rechnung(k, false);
    const betrag = k.STEUERART === 'IG_LIEFERUNG' ? u.igl : u.ausland;
    if (!betrag) continue;
    const ust = String(k.USTID || '').toUpperCase().replace(/[\s.\-]/g, '');
    const m = /^([A-Z]{2})([0-9A-Z+*]{2,12})$/.exec(ust);
    if (!m || m[1] === 'LU') { fehlt.push(`${k.RECHNUNGNUMMER} (${k.KUNNAME || ''})`); continue; }
    const land = m[1] === 'GR' ? 'EL' : m[1];
    const map = k.STEUERART === 'IG_LIEFERUNG' ? waren : dienste;
    const key = land + m[2];
    const e = map.get(key) || { land, nummer: m[2], betrag: 0 };
    e.betrag = r2(e.betrag + betrag); map.set(key, e);
  }
  const liste = mp => [...mp.values()].filter(e => Math.abs(e.betrag) >= 0.005).sort((a, b) => (a.land + a.nummer).localeCompare(b.land + b.nummer));
  const w = liste(waren), s = liste(dienste);
  return { von, bis, periode: periode(), waren: w, dienste: s, summeWaren: r2(w.reduce((a, e) => a + e.betrag, 0)), summeDienste: r2(s.reduce((a, e) => a + e.betrag, 0)), ohneUstId: fehlt };
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zahl = v => { const n = Math.round((Number(v) || 0) * 100) / 100; return n.toFixed(2).replace('.', ','); };

// eCDF file with one or more declarations: the agent is the company itself (prefix, national identification number,
// RCS and VAT number from the settings); the file name is the file reference
function umschlag(deklarationen) {
  const t = LU.tva(); if (!t) throw new L.HttpError(400, 'TVA-Nummer der Firma fehlt oder ist ungültig.');
  const prefix = String(L.sw('lu.ecdf.prefix', '')).toUpperCase();
  if (!/^[0-9A-Z]{6}$/.test(prefix)) throw new L.HttpError(400, 'eCDF-Präfix fehlt (6 Zeichen, Einstellungen → Lëtzebuerg).');
  const matr = String(L.sw('lu.matricule', '')).replace(/\D/g, '');
  if (!/^\d{11,13}$/.test(matr)) throw new L.HttpError(400, 'Matricule (11 bis 13 Ziffern) fehlt (Einstellungen → Lëtzebuerg).');
  const rcs = String(L.sw('lu.rcs', '') || 'NE').replace(/\s/g, '').slice(0, 7) || 'NE';
  const now = new Date(); const p = n => String(n).padStart(2, '0');
  const ref = `${prefix}X${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}01`;
  const agent = `<MatrNbr>${matr}</MatrNbr><RCSNbr>${esc(rcs)}</RCSNbr><VATNbr>${t.nr}</VATNbr>`;
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<eCDFDeclarations xmlns="http://www.ctie.etat.lu/2011/ecdf">
<FileReference>${ref}</FileReference>
<eCDFFileVersion>2.0</eCDFFileVersion>
<Interface>${esc(String(L.sw('lu.ecdf.interface', 'KUENTA')).slice(0, 20))}</Interface>
<Agent>${agent}</Agent>
<Declarations><Declarer>${agent}
${deklarationen.join('\n')}
</Declarer></Declarations>
</eCDFDeclarations>
`;
  return { buffer: Buffer.from(out, 'utf8'), filename: `${ref}.xml` };
}
const deklaration = (typ, jahr, per, formData) => `<Declaration type="${typ}" model="1" language="${LU.de() ? 'DE' : 'FR'}"><Year>${jahr}</Year><Period>${per}</Period><FormData>${formData}</FormData></Declaration>`;
const periodeNr = (q, art) => { const m = Number(String(q.von).slice(5, 7)); return art === 'mois' ? m : Math.ceil(m / 3); };

// VAT return: periodic (TVA_DECM / TVA_DECT) or annual (TVA_DECA, q.jahr = year)
function xml(q) {
  const jahr = !!q.jahr;
  const qq = jahr ? { von: `${q.jahr}-01-01`, bis: `${q.jahr}-12-31` } : q;
  const r = berechnen({ ...qq, jahr });
  const felder = Object.entries(r.felder).sort(([a], [b]) => Number(a) - Number(b)).map(([id, v]) => `<NumericField id="${id}">${zahl(v)}</NumericField>`).join('');
  const typ = jahr ? 'TVA_DECA' : r.periode === 'mois' ? 'TVA_DECM' : 'TVA_DECT';
  const e = umschlag([deklaration(typ, String(qq.von).slice(0, 4), jahr ? 1 : periodeNr(qq, r.periode), felder)]);
  return { ...e, daten: r };
}

// recapitulative statement: one declaration for goods and one for services, each only when it has lines
function xmlZm(q) {
  const r = zusammenfassend(q);
  if (!r.waren.length && !r.dienste.length) throw new L.HttpError(409, 'Im Zeitraum gibt es keine innergemeinschaftlichen Lieferungen oder Dienstleistungen an EU-Unternehmen: keine Zusammenfassende Meldung nötig.');
  const jahr = String(q.von).slice(0, 4); const per = periodeNr(q, r.periode); const m = r.periode === 'mois';
  const zeilen = (liste, a, b, c) => `<Table>${liste.map((e, i) => `<Line num="${i + 1}"><TextField id="${a}">${e.land}</TextField><TextField id="${b}">${esc(e.nummer)}</TextField><NumericField id="${c}">${zahl(e.betrag)}</NumericField></Line>`).join('')}</Table>`;
  const dekl = [];
  if (r.waren.length) dekl.push(deklaration(m ? 'TVA_LICM' : 'TVA_LICT', jahr, per, `<NumericField id="04">${zahl(r.summeWaren)}</NumericField><NumericField id="08">${zahl(0)}</NumericField><NumericField id="16">${zahl(0)}</NumericField>${zeilen(r.waren, '01', '02', '03')}`));
  if (r.dienste.length) dekl.push(deklaration(m ? 'TVA_PSIM' : 'TVA_PSIT', jahr, per, `<NumericField id="04">${zahl(r.summeDienste)}</NumericField><NumericField id="16">${zahl(0)}</NumericField>${zeilen(r.dienste, '01', '02', '03')}`));
  return { ...umschlag(dekl), daten: r };
}

module.exports = { berechnen, zusammenfassend, xml, xmlZm, SATZ };
