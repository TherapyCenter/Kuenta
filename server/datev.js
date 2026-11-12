'use strict';
// DATEV interface: booking batch and debtors/creditors in DATEV format (EXTF, version 700)
const L = require('./lib');

// ---------- Character set ----------
// DATEV expects Windows-1252 (ANSI). Characters outside of it are replaced.
const CP1252_EXTRA = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
const ERSATZ = { 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', 'Ħ': 'H', 'ħ': 'h', 'ŀ': 'l', 'Ŀ': 'L' };
function toCp1252(text) {
  const out = [];
  for (const ch of String(text).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (CP1252_EXTRA[ch] != null) out.push(CP1252_EXTRA[ch]);
    else {
      // remove accents (e.g. ć → c), replace some special letters, otherwise a question mark
      const base = ERSATZ[ch] || ch.normalize('NFD').replace(/\p{M}/gu, '');
      const b = base.codePointAt(0);
      out.push(base.length === 1 && (b < 0x80 || (b >= 0xa0 && b <= 0xff)) ? b : 0x3f);
    }
  }
  return Buffer.from(out);
}

// ---------- Account ranges ----------
// With general ledger account length n, personal accounts have n+1 digits: debtors 10000–69999, creditors 70000–99999 (for n = 4)
function bereiche() {
  const n = Math.min(8, Math.max(4, parseInt(L.sw('datev.kontenlaenge', '4'), 10) || 4));
  const p = 10 ** n;
  return { laenge: n, debVon: p, debBis: 7 * p - 1, kredVon: 7 * p, kredBis: 10 * p - 1 };
}
const imBereich = (v, von, bis) => { const n = Number(v); return Number.isInteger(n) && n >= von && n <= bis; };

// Debtor account: own debtor no., otherwise the customer number if it is in the debtor range, otherwise the collective debtor
function debitorKonto(debitorNr, kundenNr) {
  const b = bereiche();
  if (imBereich(debitorNr, b.debVon, b.debBis)) return Number(debitorNr);
  if (imBereich(kundenNr, b.debVon, b.debBis)) return Number(kundenNr);
  const s = Number(L.sw('datev.sammeldebitor', ''));
  return imBereich(s, b.debVon, b.debBis) ? s : b.debVon;
}
// Creditor account: own creditor no., otherwise the supplier number in the creditor range, otherwise the collective creditor
function kreditorKonto(kreditorNr, lieferantNr) {
  const b = bereiche();
  if (imBereich(kreditorNr, b.kredVon, b.kredBis)) return Number(kreditorNr);
  if (imBereich(lieferantNr, b.kredVon, b.kredBis)) return Number(lieferantNr);
  const s = L.optNum('FIBU-Kreditor-Standard', 0);
  return imBereich(s, b.kredVon, b.kredBis) ? s : b.kredVon;
}

// ---------- Fiscal year ----------
function wirtschaftsjahr(datum) {
  const monat = Math.min(12, Math.max(1, parseInt(L.sw('datev.wjbeginn', '1'), 10) || 1));
  const [y, m] = datum.split('-').map(Number);
  const jahr = m >= monat ? y : y - 1;
  const beginn = `${jahr}-${String(monat).padStart(2, '0')}-01`;
  const ende = L.addDays(`${jahr + 1}-${String(monat).padStart(2, '0')}-01`, -1);
  return { beginn, ende };
}

// ---------- Shared parts ----------
const esc = s => '"' + String(s ?? '').replace(/"/g, '""').replace(/[\r\n;]+/g, ' ') + '"';
const ymd = iso => (iso || '').replace(/-/g, '');
const dmy = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '';
function stempel() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}
// header line (31 fields) as per the DATEV format
function kopf({ kategorie, formatname, formatversion, wjBeginn, von = '', bis = '', bezeichnung = '', buchungstyp = '' }) {
  const b = bereiche();
  const f = [
    '"EXTF"', 700, kategorie, esc(formatname), formatversion, stempel(), '', '"KU"', '""', '""',
    L.sw('datev.berater', '1001'), L.sw('datev.mandant', '1'), ymd(wjBeginn), b.laenge, ymd(von), ymd(bis), esc(bezeichnung.slice(0, 30)), '""',
    buchungstyp, buchungstyp === '' ? '' : 0, buchungstyp === '' ? '' : 0, buchungstyp === '' ? '""' : '"EUR"',
  ];
  while (f.length < 31) f.push('');
  return f.join(';');
}
const datei = (lines) => toCp1252(lines.join('\r\n') + '\r\n');

// ---------- Booking batch ----------
function zeitraum(q) {
  const von = q.von || L.today().slice(0, 7) + '-01', bis = q.bis || L.today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) throw new L.HttpError(400, 'Bitte einen gültigen Zeitraum wählen.');
  if (von > bis) throw new L.HttpError(400, 'Das Startdatum liegt nach dem Enddatum.');
  const wj = wirtschaftsjahr(von);
  if (bis > wj.ende) {
    throw new L.HttpError(400, `Der Zeitraum geht über das Wirtschaftsjahr hinaus (${dmy(wj.beginn)} – ${dmy(wj.ende)}). DATEV nimmt nur Buchungen aus einem Wirtschaftsjahr an. Bitte getrennt exportieren: bis ${dmy(wj.ende)} und ab ${dmy(L.addDays(wj.ende, 1))}.`);
  }
  return { von, bis, wj };
}
function buchungen(q) {
  const { von, bis } = zeitraum(q);
  const where = q.alle === '1' ? '' : 'AND COALESCE(EXPORTIERT,0)=0';
  return L.db().prepare(`SELECT * FROM FIBU WHERE BELEGDATUM BETWEEN ? AND ? ${where} ORDER BY BELEGDATUM, FIBUID`).all(von, bis);
}
// BU keys only when switched on (otherwise automatic accounts). Incoming invoices get input tax keys.
function buSchluessel(satz, eingang) {
  if (L.sw('datev.buschluessel', '0') !== '1') return '';
  const s = Number(satz);
  if (eingang) return s === 19 ? '9' : s === 7 ? '8' : '';
  return s === 19 ? '3' : s === 7 ? '2' : '';
}
function pruefeKonten(rows) {
  const b = bereiche(); const max = 10 ** (b.laenge + 1) - 1;
  const fehler = [];
  for (const r of rows) {
    for (const [feld, v] of [['Soll', r.SOLL], ['Haben', r.HABEN]]) {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0 || n > max) fehler.push(`Beleg ${r.BELEGNUMMER || r.FIBUID} vom ${dmy(r.BELEGDATUM)}: ${feld}konto „${v ?? ''}“`);
    }
  }
  if (fehler.length) throw new L.HttpError(400, `Ungültige Konten für DATEV (Sachkontenlänge ${b.laenge}, höchstens ${b.laenge + 1} Stellen):\n${fehler.slice(0, 10).join('\n')}${fehler.length > 10 ? `\n… und ${fehler.length - 10} weitere` : ''}`);
}
function buchungsstapel(q) {
  const { von, bis, wj } = zeitraum(q);
  const rows = buchungen(q);
  pruefeKonten(rows);
  const cols = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'];
  const lines = [kopf({ kategorie: 21, formatname: 'Buchungsstapel', formatversion: 13, wjBeginn: wj.beginn, von, bis, bezeichnung: `KuentaPOS ${dmy(von)}-${dmy(bis)}`, buchungstyp: 1 }), cols.join(';')];
  for (const r of rows) {
    const betrag = Number(r.BETRAG) || 0;
    const dt = r.BELEGDATUM ? r.BELEGDATUM.slice(8, 10) + r.BELEGDATUM.slice(5, 7) : '';
    lines.push([Math.abs(betrag).toFixed(2).replace('.', ','), esc(betrag >= 0 ? 'S' : 'H'), esc('EUR'), '', '', '', Number(r.SOLL), Number(r.HABEN),
      esc(buSchluessel(r.STEUERSCHLUESSEL, r.EINGANGID != null)), dt, esc(String(r.BELEGNUMMER || '').slice(0, 36)), '', '', esc(String(r.BUCHUNGSTEXT || '').slice(0, 60))].join(';'));
  }
  if (q.markieren === '1' && rows.length) {
    const st = L.db().prepare('UPDATE FIBU SET EXPORTIERT=1, EXPORTDATUM=? WHERE FIBUID=?');
    for (const r of rows) st.run(L.today(), r.FIBUID);
  }
  return { buffer: datei(lines), count: rows.length, dateiname: `EXTF_Buchungsstapel_${von}_${bis}.csv` };
}

// ---------- Debtors / creditors ----------
const LAENDER = { D: 'DE', DEUTSCHLAND: 'DE', GERMANY: 'DE', A: 'AT', 'ÖSTERREICH': 'AT', OESTERREICH: 'AT', AUSTRIA: 'AT', CH: 'CH', SCHWEIZ: 'CH',
  NL: 'NL', NIEDERLANDE: 'NL', B: 'BE', BELGIEN: 'BE', F: 'FR', FRANKREICH: 'FR', I: 'IT', ITALIEN: 'IT', L: 'LU', LUXEMBURG: 'LU', DK: 'DK', 'DÄNEMARK': 'DK', PL: 'PL', POLEN: 'PL', CZ: 'CZ', TSCHECHIEN: 'CZ', E: 'ES', SPANIEN: 'ES' };
function landIso(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  if (LAENDER[s]) return LAENDER[s];
  return /^[A-Z]{2}$/.test(s) ? s : '';
}
function ustid(v) {
  const s = String(v || '').replace(/\s+/g, '').toUpperCase();
  const m = /^([A-Z]{2})([0-9A-Z+*.]{2,13})$/.exec(s);
  return m ? { land: m[1] === 'EL' ? 'EL' : m[1], nr: m[2] } : { land: '', nr: '' };
}
// All personal accounts with master data (customers → debtors, suppliers → creditors)
function personenkonten() {
  const d = L.db(); const map = new Map(); const doppelt = new Set();
  const add = (konto, rec) => { if (map.has(konto)) doppelt.add(konto); else map.set(konto, rec); };
  const b = bereiche();
  for (const k of d.prepare('SELECT * FROM KUNDEN').all()) {
    const konto = debitorKonto(k.DEBITORNR, k.NUMMER);
    if (!imBereich(k.DEBITORNR, b.debVon, b.debBis) && !imBereich(k.NUMMER, b.debVon, b.debBis)) continue; // collective debtor
    add(konto, { typ: 'K', firma: Number(k.ART) === 1, name: k.NAME, vorname: k.VORNAME, anrede: k.ANREDE, strasse: k.STRASSE, plz: k.PLZ, ort: k.ORT, land: k.LAND, ustid: k.USTID });
  }
  const lcols = new Set(d.prepare('PRAGMA table_info(LIEFERANTEN)').all().map(c => c.name));
  for (const l of d.prepare('SELECT * FROM LIEFERANTEN').all()) {
    const konto = kreditorKonto(lcols.has('KREDITORNR') ? l.KREDITORNR : null, l.NUMMER);
    if (!imBereich(l.KREDITORNR, b.kredVon, b.kredBis) && !imBereich(l.NUMMER, b.kredVon, b.kredBis)) continue; // collective creditor
    add(konto, { typ: 'L', firma: true, name: [l.NAME, l.ZUSATZ].filter(Boolean).join(' '), strasse: l.STRASSE, plz: l.PLZ, ort: l.ORT, land: l.LAND, ustid: l.USTID });
  }
  return { map, doppelt };
}
function stammdaten(q) {
  const { von, bis, wj } = zeitraum(q);
  const { map, doppelt } = personenkonten();
  const b = bereiche();
  let konten;
  if (q.alle === '1') konten = [...map.keys()];
  else {
    // only accounts with bookings in the period
    const used = new Set();
    for (const r of L.db().prepare('SELECT SOLL, HABEN FROM FIBU WHERE BELEGDATUM BETWEEN ? AND ?').all(von, bis)) for (const v of [r.SOLL, r.HABEN]) if (imBereich(v, b.debVon, b.kredBis)) used.add(Number(v));
    konten = [...used].filter(k => map.has(k));
  }
  konten.sort((x, y) => x - y);
  const cols = ['Konto', 'Name (Adressattyp Unternehmen)', 'Unternehmensgegenstand', 'Name (Adressattyp natürl. Person)', 'Vorname (Adressattyp natürl. Person)', 'Name (Adressattyp keine Angabe)',
    'Adressattyp', 'Kurzbezeichnung', 'EU-Land', 'EU-UStID', 'Anrede', 'Titel/Akad. Grad', 'Adelstitel', 'Namensvorsatz', 'Adressart', 'Straße', 'Postfach', 'Postleitzahl', 'Ort', 'Land'];
  const lines = [kopf({ kategorie: 16, formatname: 'Debitoren/Kreditoren', formatversion: 5, wjBeginn: wj.beginn, bezeichnung: 'KuentaPOS Stammdaten' }), cols.join(';')];
  for (const konto of konten) {
    const r = map.get(konto); const u = ustid(r.ustid);
    const cut = (s, n) => esc(String(s || '').trim().slice(0, n));
    lines.push([konto, r.firma ? cut(r.name, 50) : '""', '""', r.firma ? '""' : cut(r.name, 30), r.firma ? '""' : cut(r.vorname, 30), '""',
      r.firma ? 2 : 1, cut(r.name, 15), esc(u.land), esc(u.nr), r.firma ? '""' : cut(/^(herr|frau)$/i.test(String(r.anrede || '').trim()) ? r.anrede : '', 30), '""', '""', '""',
      esc('STR'), cut(r.strasse, 36), '""', cut(r.plz, 10), cut(r.ort, 30), esc(landIso(r.land))].join(';'));
  }
  return { buffer: datei(lines), count: konten.length, doppelt: [...doppelt], dateiname: `EXTF_Debitoren_Kreditoren_${von}_${bis}.csv` };
}

module.exports = { toCp1252, bereiche, debitorKonto, kreditorKonto, wirtschaftsjahr, buchungsstapel, stammdaten, buSchluessel, zeitraum, landIso, ustid };
