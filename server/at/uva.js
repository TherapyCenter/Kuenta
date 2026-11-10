'use strict';
// Austrian VAT return (Umsatzsteuervoranmeldung U30) with the usual Kennzahlen and the XML file for the
// upload in FinanzOnline (Erklärungsübermittlung). Accrual basis by default, cash basis (Ist-Besteuerung) by setting.
// Covered: KZ 000 (total), 011 (export), 017 (intra-community supplies), 016 (small business), 020 (other
// exempt without input tax), 022 / 029 / 006 (20 / 10 / 13 %), 060 (input tax). Services to EU businesses with
// the place of supply abroad are not taxable in Austria; they are listed separately (ZM) and not in KZ 000.
const L = require('../lib');
const AT = require('./index');
const U = require('../umsatz');

const r2 = L.r2;
const ist = () => L.sw('at.ist', '0') === '1';

function calcular({ von, bis } = {}) {
  if (!von || !bis) throw new L.HttpError(400, 'Bitte den Zeitraum angeben.');
  const klein = AT.klein();
  const u = U.umsaetze(von, bis, { ist: ist(), klein });
  const v = U.vorsteuer(von, bis, { ist: ist() });
  const t = AT.tasas();
  // margin scheme: the net margin is taxed at the normal rate
  const kz022 = r2(u.normal.netto + u.marge.netto);
  const kz029 = r2(u.ermaessigt.netto), kz006 = r2(u.ermaessigt2.netto);
  const kz011 = r2(u.ausfuhr), kz017 = r2(u.igl), kz016 = r2(u.klein), kz020 = r2(u.frei);
  const kz000 = r2(kz022 + kz029 + kz006 + kz011 + kz017 + kz016 + kz020);
  const ust = r2(kz022 * t.normal / 100 + kz029 * t.ermaessigt / 100 + kz006 * t.ermaessigt2 / 100);
  const kz060 = klein ? 0 : v.steuer;
  const zahllast = r2(ust - kz060);
  return {
    von, bis, ist: ist(), klein, rechnungen: u.rechnungen, eingang: v.belege,
    kz: { '000': kz000, '011': kz011, '017': kz017, '016': kz016, '020': kz020, '022': kz022, '029': kz029, '006': kz006, '060': kz060 },
    steuer: { '022': r2(kz022 * t.normal / 100), '029': r2(kz029 * t.ermaessigt / 100), '006': r2(kz006 * t.ermaessigt2 / 100) },
    ust, zahllast, gutschrift: zahllast < 0,
    nichtSteuerbar: u.ausland, durchlaufend: u.dp,
    hinweise: [
      ...(u.ausland ? [`${L.geld(u.ausland, 'de-AT')} Leistungen an EU-Unternehmer (Leistungsort im Ausland): nicht in KZ 000, aber in der Zusammenfassenden Meldung (ZM) anzugeben.`] : []),
      ...(u.igl ? ['Innergemeinschaftliche Lieferungen (KZ 017) sind auch in der Zusammenfassenden Meldung (ZM) anzugeben.'] : []),
    ],
  };
}

// XML for the upload in FinanzOnline: ERKLAERUNGS_UEBERMITTLUNG with one U30
function xml(q) {
  const r = calcular(q);
  const fastnr = AT.fastnr();
  if (!/^\d{9}$/.test(fastnr)) throw new L.HttpError(400, 'Steuernummer der Firma fehlt oder hat nicht 9 Ziffern (2 Ziffern Finanzamt + 7 Ziffern Steuernummer, Einstellungen → Firmendaten).');
  const kz = v => (Math.round(v * 100) / 100).toFixed(2);
  const zr = String(q.von).slice(0, 7), zb = String(q.bis).slice(0, 7);
  const now = L.now();
  const feld = (n, v) => (v ? `<KZ${n} type="kz">${kz(v)}</KZ${n}>` : '');
  const steuerfrei = [feld('011', r.kz['011']), feld('017', r.kz['017']), feld('016', r.kz['016']), feld('020', r.kz['020'])].join('');
  const versteuert = [feld('022', r.kz['022']), feld('029', r.kz['029']), feld('006', r.kz['006'])].join('');
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<ERKLAERUNGS_UEBERMITTLUNG>
<INFO_DATEN><ART_IDENTIFIKATIONSBEGRIFF>FASTNR</ART_IDENTIFIKATIONSBEGRIFF><IDENTIFIKATIONSBEGRIFF>${fastnr}</IDENTIFIKATIONSBEGRIFF><PAKET_NR>${Date.now() % 1e9}</PAKET_NR><DATUM_ERSTELLUNG type="datum">${now.slice(0, 10)}</DATUM_ERSTELLUNG><UHRZEIT_ERSTELLUNG type="uhrzeit">${now.slice(11, 19)}</UHRZEIT_ERSTELLUNG><ANZAHL_ERKLAERUNGEN>1</ANZAHL_ERKLAERUNGEN></INFO_DATEN>
<ERKLAERUNG art="U30"><SATZNR>1</SATZNR>
<ALLGEMEINE_DATEN><ANBRINGEN>U30</ANBRINGEN><ZRVON type="jahrmonat">${zr}</ZRVON><ZRBIS type="jahrmonat">${zb}</ZRBIS><FASTNR>${fastnr}</FASTNR></ALLGEMEINE_DATEN>
<LIEFERUNGEN_LEISTUNGEN_EIGENVERBRAUCH><KZ000 type="kz">${kz(r.kz['000'])}</KZ000>${steuerfrei ? `<STEUERFREI>${steuerfrei}</STEUERFREI>` : ''}${versteuert ? `<VERSTEUERT>${versteuert}</VERSTEUERT>` : ''}</LIEFERUNGEN_LEISTUNGEN_EIGENVERBRAUCH>
${r.kz['060'] ? `<VORSTEUER><KZ060 type="kz">${kz(r.kz['060'])}</KZ060></VORSTEUER>` : ''}
</ERKLAERUNG>
</ERKLAERUNGS_UEBERMITTLUNG>
`;
  return { buffer: Buffer.from(out, 'utf8'), filename: `UVA_${fastnr}_${zr}${zb !== zr ? '_' + zb : ''}.xml`, daten: r };
}

module.exports = { calcular, xml };
