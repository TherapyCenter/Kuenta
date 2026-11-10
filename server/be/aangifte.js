'use strict';
// Belgian periodic VAT return (periodieke btw-aangifte / déclaration TVA périodique) by grids (roosters / grilles):
// outgoing 00 (margin scheme), 01 / 02 / 03 (6 / 12 / 21 %), 44 (services to EU businesses), 46 (intra-community
// supplies), 47 (other exempt operations and exports), 48 / 49 (credit notes issued), incoming 82 / 85 (purchases,
// credit notes received), taxes 54 (VAT due), 59 (deductible), 63 / 64 (VAT on credit notes), balance 71 / 72.
// The XML is the VATConsignment of Intervat (schema NewTVA-in_v0_9.xsd of the SPF Finances).
// Small businesses under the exemption scheme file no periodic return.
const L = require('../lib');
const BE = require('./index');
const U = require('../umsatz');

const r2 = L.r2;
const periodiek = () => (L.sw('be.periode', 'kwartaal') === 'maand' ? 'maand' : 'kwartaal');

function berekenen({ von, bis } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  if (BE.franchise()) throw new L.HttpError(409, 'Kleine Unternehmen mit Vrijstellingsregeling / Franchise reichen keine periodische MwSt-Erklärung ein.');
  const d = L.db(); const g = {}; const add = (n, v) => { g[n] = r2((g[n] || 0) + v); };
  let n = 0;
  for (const k of d.prepare('SELECT * FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ?').all(von, bis)) {
    const u = U.rechnung(k, false); n++;
    const credit = Number(k.TYP) === 2 || Number(k.GBRUTTO) < 0;
    const s = credit ? -1 : 1;
    const basis = u.normal.netto + u.ermaessigt.netto + u.ermaessigt2.netto;
    const btw = u.normal.steuer + u.ermaessigt.steuer + u.ermaessigt2.steuer + u.marge.steuer;
    if (!credit) {
      add('01', u.ermaessigt.netto); add('02', u.ermaessigt2.netto); add('03', u.normal.netto);
      add('00', u.marge.verkauf);
      add('44', u.ausland); add('46', u.igl); add('47', u.ausfuhr + u.frei);
      add('54', btw);
    } else {
      add('48', s * (u.ausland + u.igl));
      add('49', s * (basis + u.ausfuhr + u.frei + u.marge.verkauf));
      add('64', s * btw);
    }
  }
  // purchases: base and deductible VAT; received credit notes (negative purchase invoices) separately
  for (const e of d.prepare('SELECT NETTO, MWST FROM SW_EINGANG WHERE DATUM BETWEEN ? AND ?').all(von, bis)) {
    const net = Number(e.NETTO) || 0, vat = Number(e.MWST) || 0;
    if (net >= 0) { add('82', net); add('59', vat); } else { add('85', -net); add('63', -vat); }
  }
  for (const k of Object.keys(g)) if (Math.abs(g[k]) < 0.005) delete g[k];
  const xx = r2((g['54'] || 0) + (g['63'] || 0));
  const yy = r2((g['59'] || 0) + (g['64'] || 0));
  if (xx - yy > 0.004) g['71'] = r2(xx - yy); else if (yy - xx > 0.004) g['72'] = r2(yy - xx);
  return { von, bis, periode: periodiek(), rechnungen: n, roosters: g, xx, yy, teBetalen: g['71'] || 0, terug: g['72'] || 0 };
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// VATConsignment for Intervat: one declaration for a month or a quarter
function xml(q) {
  const r = berekenen(q);
  const o = BE.ondernemingsnr();
  if (!o) throw new L.HttpError(400, 'Ondernemingsnummer der Firma fehlt oder ist ungültig.');
  const f = L.firma();
  const jaar = String(q.von).slice(0, 4); const maand = Number(String(q.von).slice(5, 7));
  const periode = r.periode === 'maand' ? `<ns2:Month>${String(maand).padStart(2, '0')}</ns2:Month>` : `<ns2:Quarter>${Math.ceil(maand / 3)}</ns2:Quarter>`;
  const roosters = Object.entries(r.roosters).filter(([, v]) => v > 0).sort(([a], [b]) => Number(a) - Number(b));
  if (!roosters.length) roosters.push(['71', 0]); // nil return: the schema needs at least one amount
  const decl = [`<VATNumber>${o.nr}</VATNumber>`, f.FIRMENNAME && `<Name>${esc(String(f.FIRMENNAME).slice(0, 200))}</Name>`, f.STRASSE && `<Street>${esc(String(f.STRASSE).slice(0, 100))}</Street>`,
    f.PLZ && `<PostCode>${esc(String(f.PLZ).replace(/\s/g, '').slice(0, 10))}</PostCode>`, f.ORT && `<City>${esc(String(f.ORT).slice(0, 100))}</City>`, '<CountryCode>BE</CountryCode>',
    f.EMAIL && `<EmailAddress>${esc(f.EMAIL)}</EmailAddress>`, f.TELEFON && `<Phone>${esc(String(f.TELEFON).replace(/[^\d+]/g, '').slice(0, 20))}</Phone>`].filter(Boolean).join('');
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:VATConsignment xmlns="http://www.minfin.fgov.be/InputCommon" xmlns:ns2="http://www.minfin.fgov.be/VATConsignment" VATDeclarationsNbr="1">
<ns2:VATDeclaration SequenceNumber="1">
<ns2:Declarant>${decl}</ns2:Declarant>
<ns2:Period>${periode}<ns2:Year>${jaar}</ns2:Year></ns2:Period>
<ns2:Data>${roosters.map(([n, v]) => `<ns2:Amount GridNumber="${Number(n)}">${(Math.round(v * 100) / 100).toFixed(2)}</ns2:Amount>`).join('')}</ns2:Data>
<ns2:ClientListingNihil>NO</ns2:ClientListingNihil>
<ns2:Ask Restitution="${q.terug === '1' && r.terug ? 'YES' : 'NO'}" Payment="NO"/>
</ns2:VATDeclaration>
</ns2:VATConsignment>
`;
  return { buffer: Buffer.from(out, 'utf8'), filename: `BTW_${o.nr}_${jaar}_${r.periode === 'maand' ? 'M' + String(maand).padStart(2, '0') : 'Q' + Math.ceil(maand / 3)}.xml`, daten: r };
}

module.exports = { berekenen, xml };
