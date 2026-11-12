'use strict';
const L = require('../lib');

const offenExpr = "ROUND(r.GBRUTTO - COALESCE((SELECT SUM(z.BETRAG) FROM ZAHLUNGSEINGAENGE z WHERE z.RECHNUNGID=r.RECHNUNGID),0),2)";
const kname = "TRIM(COALESCE(r.KUNNAME,'')||CASE WHEN COALESCE(r.KUNVORNAME,'')<>'' THEN ', '||r.KUNVORNAME ELSE '' END)";

// ---- Open items ----
function offenePosten(q = {}) {
  const d = L.db();
  const rows = d.prepare(`SELECT r.RECHNUNGID, r.TYP, r.RECHNUNGNUMMER, r.DATUM, r.KUNID, r.KUNNUMMER, ${kname} KUNDE, r.KUNORT, r.FAHRKENNZEICHEN,
      r.GBRUTTO, ${offenExpr} OFFEN, r.FAELLING, r.KEINEMAHNUNG,
      date(r.DATUM, '+'||COALESCE(r.FAELLING,0)||' days') FAELLIG,
      COALESCE((SELECT MAX(m.MAHNSTUFE) FROM MAHNUNG m WHERE m.RECHNUNGID=r.RECHNUNGID),0) MAHNSTUFE,
      (SELECT MAX(m.MAHNDATUM) FROM MAHNUNG m WHERE m.RECHNUNGID=r.RECHNUNGID) LETZTEMAHNUNG
    FROM RECHNUNGEN r WHERE COALESCE(r.ZAHLSTATUS,0)<2 AND ABS(${offenExpr})>=0.01 ORDER BY r.DATUM, r.RECHNUNGNUMMER`).all();
  const heute = L.today();
  for (const r of rows) r.TAGE = Math.round((Date.parse(heute) - Date.parse(r.FAELLIG)) / 86400000);
  const sum = L.r2(rows.reduce((s, r) => s + r.OFFEN, 0));
  const ueberfaellig = L.r2(rows.filter(r => r.TAGE > 0).reduce((s, r) => s + r.OFFEN, 0));
  return { rows: q.nurUeberfaellig ? rows.filter(r => r.TAGE > 0) : rows, sum, ueberfaellig };
}

// ---- Dunning ----
function mahnSettings() {
  const st = [];
  for (let i = 1; i <= 4; i++) st.push({ stufe: i, tage: L.optNum(`Mahntage${i}`, i * 7), gebuehr: L.optNum(`Mahntage${i}Gebuehren`, 0) });
  return st;
}
function mahnVorschlag() {
  const st = mahnSettings();
  const op = offenePosten().rows.filter(r => r.TYP === 1 && r.OFFEN > 0 && !r.KEINEMAHNUNG);
  const out = [];
  for (const r of op) {
    const next = Math.min(r.MAHNSTUFE + 1, 4);
    const s = st[next - 1];
    if (r.TAGE >= s.tage && r.MAHNSTUFE < 4) out.push({ ...r, NAECHSTESTUFE: next, GEBUEHR: s.gebuehr });
  }
  return { rows: out, stufen: st };
}
function mahnungErstellen({ RECHNUNGID, MAHNSTUFE, MAHNGEBUEHREN, VORTEXT, NACHTEXT, BETREFFTXT, MAHNDATUM }, user) {
  const d = L.db();
  const stufe = Number(MAHNSTUFE) || 1;
  const txt = d.prepare('SELECT * FROM DRUCKTEXTBAUSTEINE WHERE TXTART=6 AND TXTARTVARIABLE=?').get(String(stufe))
    || d.prepare('SELECT * FROM DRUCKTEXTBAUSTEINE WHERE TXTART=6 ORDER BY TXTARTVARIABLE DESC').get() || {};
  const geb = MAHNGEBUEHREN != null && MAHNGEBUEHREN !== '' ? Number(MAHNGEBUEHREN) : L.optNum(`Mahntage${stufe}Gebuehren`, 0);
  const r = d.prepare('INSERT INTO MAHNUNG (RECHNUNGID, MAHNDATUM, VORTEXT, NACHTEXT, MAHNGEBUEHREN, BETREFFTXT, MAHNSTUFE, DRUCKFORMULAR) VALUES (?,?,?,?,?,?,?,?)')
    .run(RECHNUNGID, MAHNDATUM || L.today(), VORTEXT ?? txt.EINLEITUNG ?? '', NACHTEXT ?? txt.SCHLUSSTEXT ?? '', geb, BETREFFTXT || txt.TXTBETREFF || `${stufe}. Mahnung`, stufe, 'mahnung');
  d.prepare('UPDATE OP SET MAHNSTUFE=? WHERE RECHNUNGID=?').run(stufe, RECHNUNGID);
  L.protocol(user && user.name, 'MAHNUNG', r.lastInsertRowid, 'angelegt', { RECHNUNGID, stufe });
  return mahnung(Number(r.lastInsertRowid));
}
function mahnung(id) {
  const d = L.db();
  const m = d.prepare('SELECT * FROM MAHNUNG WHERE MAHNID=?').get(id);
  if (!m) throw new L.HttpError(404, 'Mahnung nicht gefunden');
  const r = d.prepare(`SELECT r.*, ${offenExpr} OFFEN FROM RECHNUNGEN r WHERE r.RECHNUNGID=?`).get(m.RECHNUNGID);
  const fruehere = d.prepare('SELECT MAHNDATUM, MAHNSTUFE, MAHNGEBUEHREN FROM MAHNUNG WHERE RECHNUNGID=? AND MAHNID<>? ORDER BY MAHNDATUM').all(m.RECHNUNGID, id);
  return { mahnung: m, rechnung: r, fruehere };
}
function mahnungenListe() {
  return L.db().prepare(`SELECT m.MAHNID, m.MAHNDATUM, m.MAHNSTUFE, m.MAHNGEBUEHREN, m.BETREFFTXT, r.RECHNUNGID, r.RECHNUNGNUMMER, r.DATUM, ${kname} KUNDE, r.GBRUTTO, ${offenExpr} OFFEN
    FROM MAHNUNG m JOIN RECHNUNGEN r ON r.RECHNUNGID=m.RECHNUNGID ORDER BY m.MAHNDATUM DESC, m.MAHNID DESC LIMIT 1000`).all();
}
function mahnungLoeschen(id) {
  const d = L.db();
  const m = d.prepare('SELECT RECHNUNGID FROM MAHNUNG WHERE MAHNID=?').get(id);
  d.prepare('DELETE FROM MAHNUNG WHERE MAHNID=?').run(id);
  if (m) d.prepare('UPDATE OP SET MAHNSTUFE=COALESCE((SELECT MAX(MAHNSTUFE) FROM MAHNUNG WHERE RECHNUNGID=?),0) WHERE RECHNUNGID=?').run(m.RECHNUNGID, m.RECHNUNGID);
  return { ok: true };
}

// ---- Cash book ----
function kassenbuch(q) {
  const d = L.db();
  const von = q.von || L.today().slice(0, 7) + '-01';
  const bis = q.bis || L.today();
  const anfang = L.optNum('Kassenanfang', 0);
  const vor = d.prepare('SELECT COALESCE(SUM(COALESCE(EINNAHMEN,0)-COALESCE(AUSGABEN,0)),0) s FROM KASSENBUCH WHERE DATUM < ?').get(von).s;
  const rows = d.prepare('SELECT * FROM KASSENBUCH WHERE DATUM BETWEEN ? AND ? ORDER BY DATUM, KASSENID').all(von, bis);
  let saldo = L.r2(anfang + vor);
  const start = saldo;
  for (const r of rows) { saldo = L.r2(saldo + (r.EINNAHMEN || 0) - (r.AUSGABEN || 0)); r.SALDO = saldo; }
  return { von, bis, anfangsbestand: start, endbestand: saldo, einnahmen: L.r2(rows.reduce((s, r) => s + (r.EINNAHMEN || 0), 0)), ausgaben: L.r2(rows.reduce((s, r) => s + (r.AUSGABEN || 0), 0)), rows };
}

// ---- Invoice list (outgoing invoices) ----
function rechnungsliste(q) {
  const d = L.db();
  const von = q.von || L.today().slice(0, 4) + '-01-01', bis = q.bis || L.today();
  const rows = d.prepare(`SELECT r.RECHNUNGID, r.TYP, r.RECHNUNGNUMMER, r.DATUM, r.KUNNUMMER, ${kname} KUNDE, r.FAHRKENNZEICHEN, r.GNETTO, r.GMWST1, r.GMWST2, r.GMWSTAT, r.GBRUTTO, ${offenExpr} OFFEN, r.ZAHLSTATUS
    FROM RECHNUNGEN r WHERE r.DATUM BETWEEN ? AND ? ORDER BY r.DATUM, r.RECHNUNGNUMMER`).all(von, bis);
  const s = k => L.r2(rows.reduce((a, r) => a + (r[k] || 0), 0));
  return { von, bis, rows, summe: { GNETTO: s('GNETTO'), GMWST1: s('GMWST1'), GMWST2: s('GMWST2'), GMWSTAT: s('GMWSTAT'), GBRUTTO: s('GBRUTTO'), OFFEN: s('OFFEN') } };
}

// ---- Accounting / DATEV ----
function fibuListe(q) {
  const d = L.db();
  const von = q.von || L.today().slice(0, 7) + '-01', bis = q.bis || L.today();
  const where = q.alle === '1' ? '' : 'AND COALESCE(EXPORTIERT,0)=0';
  return d.prepare(`SELECT * FROM FIBU WHERE BELEGDATUM BETWEEN ? AND ? ${where} ORDER BY BELEGDATUM, FIBUID`).all(von, bis);
}
// DATEV export: see server/datev.js
function datevExport(q) { return require('../datev').buchungsstapel(q); }

// ---- Reports ----
function umsatz(q) {
  const d = L.db();
  const jahr = Number(q.jahr) || new Date().getFullYear();
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const vj = `${jahr - 1}-01-01`, vjb = `${jahr - 1}-12-31`;
  const monat = d.prepare(`SELECT CAST(strftime('%m', DATUM) AS INTEGER) m, ROUND(SUM(GNETTO),2) netto, ROUND(SUM(GBRUTTO),2) brutto, ROUND(SUM(COALESCE(EINSATZ,0)),2) einsatz, COUNT(*) anzahl
    FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ? GROUP BY m ORDER BY m`).all(von, bis);
  const monatVj = d.prepare(`SELECT CAST(strftime('%m', DATUM) AS INTEGER) m, ROUND(SUM(GNETTO),2) netto FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ? GROUP BY m`).all(vj, vjb);
  const kunden = d.prepare(`SELECT r.KUNNUMMER, ${kname} KUNDE, COUNT(*) anzahl, ROUND(SUM(r.GNETTO),2) netto, ROUND(SUM(r.GBRUTTO),2) brutto FROM RECHNUNGEN r WHERE r.DATUM BETWEEN ? AND ? GROUP BY r.KUNID ORDER BY netto DESC LIMIT 50`).all(von, bis);
  const art = d.prepare(`SELECT COALESCE(a.BEZEICHNUNG,'ohne Auftragsart') artname, COUNT(*) anzahl, ROUND(SUM(r.GNETTO),2) netto FROM RECHNUNGEN r LEFT JOIN AUFTRAGSART a ON a.AUFARTID=r.AUFTYPID WHERE r.DATUM BETWEEN ? AND ? GROUP BY artname ORDER BY netto DESC`).all(von, bis);
  const postyp = d.prepare(`SELECT CASE WHEN p.DURCHLAUFER=1 THEN 'Durchlaufende Posten' WHEN p.POSART='A' THEN 'Artikel / Ersatzteile' ELSE 'Arbeitswerte / Lohn' END postyp, ROUND(SUM(p.SUMME),2) netto, ROUND(SUM(p.MENGE*COALESCE(p.EK,0)),2) einsatz
    FROM RECHNUNGEN_POS p JOIN RECHNUNGEN r ON r.RECHNUNGID=p.RECHNUNGID WHERE r.DATUM BETWEEN ? AND ? AND p.POSART NOT IN ('T','Z') GROUP BY postyp ORDER BY netto DESC`).all(von, bis);
  const jahre = d.prepare(`SELECT CAST(strftime('%Y', DATUM) AS INTEGER) j, ROUND(SUM(GNETTO),2) netto, COUNT(*) anzahl FROM RECHNUNGEN WHERE DATUM IS NOT NULL GROUP BY j ORDER BY j`).all();
  return { jahr, monat, monatVj, kunden, art, postyp, jahre };
}

const TERMIN_FELDER = { HU: 'HU (Hauptuntersuchung)', NAECHSTEINS: 'Inspektion', NAECHSTESP: 'SP', NAECHSTE57B: '§57b', NAECHSTEUVV: 'UVV', KLIMA: 'Klimaservice', INDTERMIN1: 'Termin 1', INDTERMIN2: 'Termin 2', INDTERMIN3: 'Termin 3' };
function fahrzeugtermine(q) {
  const d = L.db();
  const feld = TERMIN_FELDER[q.feld] ? q.feld : 'HU';
  const von = q.von || L.today().slice(0, 7) + '-01';
  const bis = q.bis || L.addDays(von, 60);
  let datumExpr = `f.${feld}`;
  if (feld === 'KLIMA') datumExpr = "date(f.KLIMA, '+2 years')";
  const rows = d.prepare(`SELECT f.FAHR_ID, f.KENNZEICHEN, f.MARKE, f.MODELL, f.FZIDENTNR, f.KM, ${datumExpr} TERMIN,
      k.KUNID, k.NUMMER, k.ANREDE, k.NAME, k.VORNAME, k.ZUSATZ, k.STRASSE, k.PLZ, k.ORT, k.TELEFON, k.MOBIL, k.EMAIL, k.LAND, k.KEINEERINNERUNG, k.TELEGRAM_CHATID,
      (SELECT e.ZEIT || ' · ' || e.KANAL FROM SW_ERINNERUNGEN e WHERE e.FAHRID=f.FAHR_ID AND e.ART=? AND e.TERMIN=${datumExpr} AND e.STATUS<>'Fehler' ORDER BY e.ZEIT DESC LIMIT 1) ERINNERT
    FROM FAHRZEUGE f LEFT JOIN KUNDEN_FAHRZEUGE kf ON kf.FAHRID=f.FAHR_ID LEFT JOIN KUNDEN k ON k.KUNID=kf.KUNID
    WHERE ${datumExpr} BETWEEN ? AND ? GROUP BY f.FAHR_ID ORDER BY TERMIN, f.KENNZEICHEN`).all(feld, von, bis);
  return { feld, bezeichnung: TERMIN_FELDER[feld], von, bis, rows, felder: TERMIN_FELDER };
}

function serienbriefEmpfaenger(q) {
  const d = L.db();
  const where = ['1=1']; const p = [];
  if (q.plz) { where.push('k.PLZ LIKE ?'); p.push(q.plz + '%'); }
  if (q.ort) { where.push('ulower(k.ORT) LIKE ?'); p.push('%' + String(q.ort).toLowerCase() + '%'); }
  if (q.art === '0' || q.art === '1') { where.push('k.ART=?'); p.push(Number(q.art)); }
  if (q.seit) { where.push('EXISTS (SELECT 1 FROM RECHNUNGEN r WHERE r.KUNID=k.KUNID AND r.DATUM>=?)'); p.push(q.seit); }
  if (q.nichtSeit) { where.push('NOT EXISTS (SELECT 1 FROM RECHNUNGEN r WHERE r.KUNID=k.KUNID AND r.DATUM>=?)'); p.push(q.nichtSeit); }
  if (q.email === '1') where.push("COALESCE(k.EMAIL,'')<>''");
  where.push("COALESCE(k.STRASSE,'')<>''");
  return d.prepare(`SELECT k.KUNID, k.NUMMER, k.ANREDE, k.NAME, k.VORNAME, k.ZUSATZ, k.STRASSE, k.PLZ, k.ORT, k.EMAIL, k.LAND,
     (SELECT MAX(r.DATUM) FROM RECHNUNGEN r WHERE r.KUNID=k.KUNID) LETZTERBESUCH FROM KUNDEN k WHERE ${where.join(' AND ')} ORDER BY k.NAME, k.VORNAME LIMIT 5000`).all(...p);
}

function dashboard() {
  const d = L.db();
  const heute = L.today(); const monat = heute.slice(0, 7);
  const one = (sql, ...p) => d.prepare(sql).get(...p);
  const op = offenePosten();
  return {
    heute,
    umsatzMonat: one("SELECT ROUND(COALESCE(SUM(GNETTO),0),2) n, COUNT(*) c FROM RECHNUNGEN WHERE strftime('%Y-%m',DATUM)=?", monat),
    umsatzJahr: one("SELECT ROUND(COALESCE(SUM(GNETTO),0),2) n, COUNT(*) c FROM RECHNUNGEN WHERE strftime('%Y',DATUM)=?", heute.slice(0, 4)),
    offen: { summe: op.sum, anzahl: op.rows.length, ueberfaellig: op.ueberfaellig },
    kasse: kassenbuch({ von: heute, bis: heute }).endbestand,
    huFaellig: one("SELECT COUNT(*) n FROM FAHRZEUGE WHERE HU BETWEEN ? AND ?", monat + '-01', L.addDays(monat + '-01', 31)).n,
    reifenEingelagert: one('SELECT COUNT(*) n FROM REIFENEINLAGERUNG WHERE COALESCE(STATUS,0)=0').n,
    termineHeute: d.prepare("SELECT * FROM SW_TERMINE WHERE substr(BEGINN,1,10)=? ORDER BY BEGINN").all(heute),
    aufgaben: d.prepare("SELECT * FROM SW_AUFGABEN WHERE COALESCE(ERLEDIGT,0)=0 ORDER BY COALESCE(FAELLIG,'9999'), PRIORITAET DESC LIMIT 8").all(),
    letzte: d.prepare(`SELECT r.RECHNUNGID, r.TYP, r.RECHNUNGNUMMER, r.DATUM, ${kname} KUNDE, r.GBRUTTO, ${offenExpr} OFFEN FROM RECHNUNGEN r ORDER BY r.RECHNUNGID DESC LIMIT 8`).all(),
    zaehler: {
      kunden: one('SELECT COUNT(*) n FROM KUNDEN').n, fahrzeuge: one('SELECT COUNT(*) n FROM FAHRZEUGE').n,
      rechnungen: one('SELECT COUNT(*) n FROM RECHNUNGEN').n, artikel: one('SELECT COUNT(*) n FROM ARTIKEL').n,
    },
  };
}

// GoBD/GDPdU data export (CSV per table + index.xml) for tax audits
function gobdTabellen() {
  return [
    ['RECHNUNGEN', 'Ausgangsrechnungen'], ['RECHNUNGEN_POS', 'Rechnungspositionen'], ['ZAHLUNGSEINGAENGE', 'Zahlungen'],
    ['KASSENBUCH', 'Kassenbuch'], ['FIBU', 'Buchungssätze'], ['KUNDEN', 'Kunden'], ['ARTIKEL', 'Artikel'], ['MAHNUNG', 'Mahnungen'],
  ];
}

module.exports = { offenePosten, mahnSettings, mahnVorschlag, mahnungErstellen, mahnung, mahnungenListe, mahnungLoeschen, kassenbuch, rechnungsliste, fibuListe, datevExport, umsatz, fahrzeugtermine, serienbriefEmpfaenger, dashboard, gobdTabellen };
