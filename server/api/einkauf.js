'use strict';
// Purchasing: incoming invoices, stock movements, stocktaking
const path = require('path');
const fs = require('fs');
const L = require('../lib');
const dbm = require('../db');
const X = require('../xml');

const num = x => { const n = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function kreditor(liefid) {
  const l = liefid ? L.db().prepare('SELECT NUMMER, KREDITORNR FROM LIEFERANTEN WHERE LIEFID=?').get(liefid) : null;
  return require('../datev').kreditorKonto(l && l.KREDITORNR, l && l.NUMMER);
}

function load(id) {
  const d = L.db();
  const k = d.prepare('SELECT * FROM SW_EINGANG WHERE ID=?').get(id);
  if (!k) throw new L.HttpError(404, 'Eingangsrechnung nicht gefunden');
  const pos = d.prepare('SELECT * FROM SW_EINGANG_POS WHERE EINGANGID=? ORDER BY POS, ID').all(id);
  const zahlungen = d.prepare('SELECT * FROM SW_EINGANG_ZAHLUNG WHERE EINGANGID=? ORDER BY DATUM, ID').all(id);
  const offen = L.r2(k.BRUTTO - zahlungen.reduce((s, z) => s + z.BETRAG, 0));
  return { kopf: k, pos, zahlungen, offen };
}

function calc(k, pos) {
  if (pos.length) {
    let n = 0, m = 0; const groups = {};
    pos.forEach((p, i) => {
      p.POS = i + 1; p.MENGE = num(p.MENGE); p.EKNETTO = num(p.EKNETTO); p.STEUERSATZ = p.STEUERSATZ == null || p.STEUERSATZ === '' ? 19 : num(p.STEUERSATZ);
      p.SUMME = L.r2(p.MENGE * p.EKNETTO);
      groups[p.STEUERSATZ] = (groups[p.STEUERSATZ] || 0) + p.SUMME;
    });
    for (const [s, b] of Object.entries(groups)) { n += L.r2(b); m += L.r2(b * Number(s) / 100); }
    k.NETTO = L.r2(n); k.MWST = L.r2(m); k.BRUTTO = L.r2(n + m);
    const top = Object.entries(groups).sort((a, b) => b[1] - a[1])[0]; k.STEUERSATZ = top ? Number(top[0]) : 19;
  } else {
    k.BRUTTO = L.r2(num(k.BRUTTO)); const s = k.STEUERSATZ == null || k.STEUERSATZ === '' ? 19 : num(k.STEUERSATZ); k.STEUERSATZ = s;
    k.NETTO = L.r2(k.BRUTTO / (1 + s / 100)); k.MWST = L.r2(k.BRUTTO - k.NETTO);
  }
}

function lagerRevert(id) {
  const d = L.db();
  for (const b of d.prepare('SELECT ARTIKELID, ANZAHL FROM ARTBESTANDBEWEGUNGEN WHERE LIEFERUNGID=?').all(id)) d.prepare('UPDATE ARTIKEL SET LAGER=COALESCE(LAGER,0)-? WHERE ARTID=?').run(b.ANZAHL, b.ARTIKELID);
  d.prepare('DELETE FROM ARTBESTANDBEWEGUNGEN WHERE LIEFERUNGID=?').run(id);
}
function lagerBook(id, k, pos) {
  const d = L.db(); const ekAkt = L.sw('einkauf.ekaktualisieren', '1') === '1';
  for (const p of pos) {
    if (!(p.ARTID > 0) || !p.MENGE) continue;
    const a = d.prepare('SELECT LAGERFUEHRUNG FROM ARTIKEL WHERE ARTID=?').get(p.ARTID);
    if (!a) continue;
    if (Number(a.LAGERFUEHRUNG) === 1) {
      d.prepare('INSERT INTO ARTBESTANDBEWEGUNGEN (DATUM, ARTIKELID, ANZAHL, BESCHREIBUNG, LIEFERUNGID, LIEFERUNGPOSID, EINGABETYP) VALUES (?,?,?,?,?,?,?)')
        .run(k.DATUM, p.ARTID, p.MENGE, `Wareneingang ${k.LIEFNAME || ''} ${k.RECHNUNGSNR || ''}`.trim(), id, p.ID || null, 'E');
      d.prepare('UPDATE ARTIKEL SET LAGER=COALESCE(LAGER,0)+? WHERE ARTID=?').run(p.MENGE, p.ARTID);
    }
    if (ekAkt && p.EKNETTO > 0) d.prepare('UPDATE ARTIKEL SET EKPNETTO=?, AENDERUNGSDATUM=? WHERE ARTID=?').run(p.EKNETTO, L.now(), p.ARTID);
  }
}
function fibu(id, k) {
  const d = L.db();
  d.prepare('DELETE FROM FIBU WHERE EINGANGID=? AND ZAHLID IS NULL AND COALESCE(EXPORTIERT,0)=0').run(id);
  if (d.prepare('SELECT COUNT(*) n FROM FIBU WHERE EINGANGID=? AND ZAHLID IS NULL').get(id).n) return;
  const konto = k.GEGENKONTO || L.sw('einkauf.gegenkonto', '3400');
  d.prepare('INSERT INTO FIBU (BELEGDATUM, SOLL, HABEN, BUCHUNGSTEXT, BELEGNUMMER, BETRAG, ERSTELLUNGSDATUM, EXPORTIERT, STEUERSCHLUESSEL, EINGANGID) VALUES (?,?,?,?,?,?,?,0,?,?)')
    .run(k.DATUM, Number(konto) || konto, kreditor(k.LIEFID), `ER ${k.LIEFNAME || ''}`.slice(0, 60), String(k.RECHNUNGSNR || '').slice(0, 36), k.BRUTTO, L.today(), k.STEUERSATZ, id);
}
function status(id) {
  const d = L.db();
  const k = d.prepare('SELECT BRUTTO FROM SW_EINGANG WHERE ID=?').get(id);
  const paid = d.prepare('SELECT COALESCE(SUM(BETRAG),0) s FROM SW_EINGANG_ZAHLUNG WHERE EINGANGID=?').get(id).s;
  const st = Math.abs(k.BRUTTO - paid) < 0.005 ? 2 : Math.abs(paid) > 0.004 ? 1 : 0;
  d.prepare('UPDATE SW_EINGANG SET ZAHLSTATUS=? WHERE ID=?').run(st, id);
}

function save(payload, user) {
  const d = L.db();
  const k = { ...(payload.kopf || {}) }; const pos = (payload.pos || []).map(p => ({ ...p }));
  if (!k.RECHNUNGSNR) throw new L.HttpError(400, 'Bitte die Rechnungsnummer des Lieferanten eingeben.');
  if (!k.DATUM) k.DATUM = L.today();
  if (k.LIEFID) { const l = d.prepare('SELECT NAME FROM LIEFERANTEN WHERE LIEFID=?').get(k.LIEFID); if (l) k.LIEFNAME = l.NAME; }
  const dup = d.prepare('SELECT ID FROM SW_EINGANG WHERE RECHNUNGSNR=? AND COALESCE(LIEFID,0)=COALESCE(?,0)').get(k.RECHNUNGSNR, k.LIEFID || null);
  if (dup && dup.ID !== Number(k.ID)) throw new L.HttpError(409, 'Diese Rechnung des Lieferanten wurde bereits erfasst.');
  calc(k, pos);
  k.AENDERUNGSDATUM = L.now();
  const cols = [...L.tableColumns('SW_EINGANG')].filter(c => c !== 'ID' && k[c] !== undefined);
  d.exec('BEGIN');
  try {
    let id = Number(k.ID) || null;
    if (id) d.prepare(`UPDATE SW_EINGANG SET ${cols.map(c => c + '=?').join(',')} WHERE ID=?`).run(...cols.map(c => k[c] === '' ? null : k[c]), id);
    else id = Number(d.prepare(`INSERT INTO SW_EINGANG (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => k[c] === '' ? null : k[c])).lastInsertRowid);
    lagerRevert(id);
    d.prepare('DELETE FROM SW_EINGANG_POS WHERE EINGANGID=?').run(id);
    const pc = ['POS', 'ARTID', 'ARTNUMMER', 'BEZEICHNUNG', 'MENGE', 'EINHEIT', 'EKNETTO', 'STEUERSATZ', 'SUMME'];
    for (const p of pos) p.ID = Number(d.prepare(`INSERT INTO SW_EINGANG_POS (EINGANGID, ${pc.join(',')}) VALUES (?,${pc.map(() => '?').join(',')})`).run(id, ...pc.map(c => p[c] ?? null)).lastInsertRowid);
    if (Number(k.LAGERGEBUCHT) === 1) lagerBook(id, k, pos);
    fibu(id, k); status(id);
    d.exec('COMMIT');
    L.protocol(user && user.name, 'SW_EINGANG', id, k.ID ? 'geändert' : 'angelegt', { nr: k.RECHNUNGSNR, brutto: k.BRUTTO });
    return load(id);
  } catch (e) { d.exec('ROLLBACK'); throw e; }
}

function remove(id, user) {
  const d = L.db();
  if (d.prepare('SELECT COUNT(*) n FROM SW_EINGANG_ZAHLUNG WHERE EINGANGID=?').get(id).n) throw new L.HttpError(409, 'Zu dieser Eingangsrechnung sind Zahlungen erfasst. Bitte zuerst die Zahlungen löschen.');
  if (d.prepare('SELECT COUNT(*) n FROM FIBU WHERE EINGANGID=? AND EXPORTIERT=1').get(id).n) throw new L.HttpError(409, 'Die Rechnung wurde bereits an die FIBU exportiert.');
  d.exec('BEGIN');
  try {
    lagerRevert(id);
    d.prepare('DELETE FROM FIBU WHERE EINGANGID=?').run(id);
    d.prepare('DELETE FROM SW_EINGANG_POS WHERE EINGANGID=?').run(id);
    d.prepare('DELETE FROM SW_EINGANG WHERE ID=?').run(id);
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  L.protocol(user && user.name, 'SW_EINGANG', id, 'gelöscht');
  return { ok: true };
}

function addPayment(p, user) {
  const d = L.db();
  const k = d.prepare('SELECT * FROM SW_EINGANG WHERE ID=?').get(p.EINGANGID);
  if (!k) throw new L.HttpError(404, 'Eingangsrechnung nicht gefunden');
  const betrag = L.r2(num(p.BETRAG)); if (!betrag) throw new L.HttpError(400, 'Bitte einen Betrag eingeben.');
  const datum = p.DATUM || L.today(); const bar = p.ART === 'bar';
  d.exec('BEGIN');
  try {
    let kid = null;
    if (bar) kid = Number(d.prepare('INSERT INTO KASSENBUCH (ART, EMPFAENGER, VERWENDUNG, DATUM, AUSGABEN, EINNAHMEN, BELEGNUMMER, AENDERUNGSDATUM, STEUERSCHLUESSEL) VALUES (2,?,?,?,?,0,?,?,?)')
      .run(k.LIEFNAME || '', `Barzahlung Eingangsrechnung ${k.RECHNUNGSNR}`, datum, betrag, String(k.RECHNUNGSNR), L.now(), k.STEUERSATZ || 0).lastInsertRowid);
    const zid = Number(d.prepare('INSERT INTO SW_EINGANG_ZAHLUNG (EINGANGID, DATUM, BETRAG, ART, BEMERKUNG, KASSENID) VALUES (?,?,?,?,?,?)').run(k.ID, datum, betrag, p.ART || 'bank', p.BEMERKUNG || '', kid).lastInsertRowid);
    const haben = bar ? L.optNum('FIBU-Kasse', 1000) : L.optNum('FIBU-Bank1', 1200);
    d.prepare('INSERT INTO FIBU (BELEGDATUM, SOLL, HABEN, BUCHUNGSTEXT, BELEGNUMMER, ZAHLID, BETRAG, ERSTELLUNGSDATUM, EXPORTIERT, KASSENID, EINGANGID) VALUES (?,?,?,?,?,?,?,?,0,?,?)')
      .run(datum, kreditor(k.LIEFID), haben, `Zahlung ER ${k.LIEFNAME || ''}`.slice(0, 60), String(k.RECHNUNGSNR).slice(0, 36), -zid, betrag, L.today(), kid, k.ID);
    status(k.ID);
    d.exec('COMMIT');
    L.protocol(user && user.name, 'SW_EINGANG_ZAHLUNG', zid, 'angelegt', { betrag });
    return { id: zid };
  } catch (e) { d.exec('ROLLBACK'); throw e; }
}
function deletePayment(zid) {
  const d = L.db();
  const z = d.prepare('SELECT * FROM SW_EINGANG_ZAHLUNG WHERE ID=?').get(zid);
  if (!z) throw new L.HttpError(404, 'Zahlung nicht gefunden');
  if (z.KASSENID) d.prepare('DELETE FROM KASSENBUCH WHERE KASSENID=?').run(z.KASSENID);
  d.prepare('DELETE FROM FIBU WHERE ZAHLID=? AND EINGANGID=?').run(-zid, z.EINGANGID);
  d.prepare('DELETE FROM SW_EINGANG_ZAHLUNG WHERE ID=?').run(zid);
  status(z.EINGANGID);
  return { ok: true };
}

// Take over an incoming e-invoice (XML or ZUGFeRD PDF)
function importErechnung(buf, filename, user) {
  const d = L.db();
  let xml = null; let isPdf = buf.subarray(0, 5).toString() === '%PDF-';
  if (isPdf) { xml = X.xmlFromPdf(buf); if (!xml) throw new L.HttpError(400, 'In dieser PDF-Datei ist keine E-Rechnung (ZUGFeRD/XRechnung) eingebettet.'); }
  else xml = buf.toString('utf8');
  const inv = X.readInvoice(xml);
  // find or create the supplier
  const v = inv.verkaeufer;
  let lief = v.ustid ? d.prepare("SELECT * FROM LIEFERANTEN WHERE REPLACE(USTID,' ','')=?").get(v.ustid.replace(/\s/g, '')) : null;
  if (!lief && v.name) lief = d.prepare('SELECT * FROM LIEFERANTEN WHERE ulower(NAME)=?').get(v.name.toLowerCase());
  let neu = false;
  if (!lief) {
    const nr = L.nextNumber('Nummernkreis Liefranten', 'LIEFERANTEN', 'NUMMER');
    const id = Number(d.prepare('INSERT INTO LIEFERANTEN (NUMMER, NAME, STRASSE, PLZ, ORT, LAND, EMAIL, TELEFON, USTID, IBAN, BIC, AENDERUNGSDATUM) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(nr, v.name || 'Unbekannter Lieferant', v.strasse, v.plz, v.ort, v.land || 'DE', v.email, v.telefon, v.ustid, inv.iban, inv.bic, L.now()).lastInsertRowid);
    L.commitNumber('Nummernkreis Liefranten', nr);
    lief = d.prepare('SELECT * FROM LIEFERANTEN WHERE LIEFID=?').get(id); neu = true;
  }
  const credit = inv.typ === '381';
  const sgn = credit ? -1 : 1;
  const pos = inv.positionen.map(p => {
    const art = p.artnr ? d.prepare('SELECT ARTID FROM ARTIKEL WHERE ARTNUMMER=?').get(p.artnr) : null;
    return { ARTID: art ? art.ARTID : null, ARTNUMMER: p.artnr, BEZEICHNUNG: p.bezeichnung, MENGE: sgn * p.menge, EINHEIT: p.einheit, EKNETTO: p.menge ? Math.abs(p.summe / p.menge) : p.preis, STEUERSATZ: p.satz };
  });
  const kopf = { LIEFID: lief.LIEFID, RECHNUNGSNR: inv.nr, DATUM: inv.datum || L.today(), FAELLIG: inv.faellig || null, LEISTUNGSDATUM: inv.leistung || null, ERECHNUNG: xml, ERECHNUNGFORMAT: (isPdf ? 'ZUGFeRD/' : '') + inv.format, LAGERGEBUCHT: 0, GEGENKONTO: lief.GEGENKONTO || L.sw('einkauf.gegenkonto', '3400'), BEMERKUNG: inv.zahlungsbedingung || '' };
  const exist = d.prepare('SELECT ID FROM SW_EINGANG WHERE RECHNUNGSNR=? AND LIEFID=?').get(inv.nr, lief.LIEFID);
  if (exist) throw new L.HttpError(409, `Die Rechnung ${inv.nr} von ${lief.NAME} wurde bereits erfasst.`);
  const res = save({ kopf, pos }, user);
  // check the rounding difference to the amount due of the e-invoice
  const diff = L.r2(sgn * inv.brutto - res.kopf.BRUTTO);
  if (Math.abs(diff) >= 0.01) { d.prepare('UPDATE SW_EINGANG SET BRUTTO=?, NETTO=?, MWST=? WHERE ID=?').run(sgn * inv.brutto, sgn * inv.netto, sgn * inv.steuer, res.kopf.ID); }
  // store the original file as a document
  const name = path.basename(filename || `E-Rechnung_${inv.nr}.${isPdf ? 'pdf' : 'xml'}`).replace(/[<>:"/\\|?*]/g, '_');
  const rel = path.join('dokumente', 'eingang', String(res.kopf.ID), name);
  const abs = path.join(dbm.FILES_DIR, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, buf);
  d.prepare('INSERT INTO SW_DOKUMENTE (BEZUG, BEZUGID, DATEINAME, PFAD, MIME, GROESSE, BESCHREIBUNG, DATUM) VALUES (?,?,?,?,?,?,?,?)').run('EINGANG', res.kopf.ID, name, rel.replace(/\\/g, '/'), isPdf ? 'application/pdf' : 'application/xml', buf.length, 'E-Rechnung (Original)', L.today());
  return { ...load(res.kopf.ID), lieferantNeu: neu, erechnung: inv };
}

// Quick entry of a stock movement
function bewegung({ ARTID, MENGE, ART, DATUM, TEXT }) {
  const d = L.db(); const m = Math.abs(num(MENGE)) * (ART === 'aus' ? -1 : 1);
  if (!ARTID || !m) throw new L.HttpError(400, 'Artikel und Menge angeben.');
  d.prepare('INSERT INTO ARTBESTANDBEWEGUNGEN (DATUM, ARTIKELID, ANZAHL, BESCHREIBUNG, EINGABETYP) VALUES (?,?,?,?,?)').run(DATUM || L.today(), ARTID, m, TEXT || (m > 0 ? 'Einlagerung' : 'Auslagerung'), 'M');
  d.prepare('UPDATE ARTIKEL SET LAGER=COALESCE(LAGER,0)+? WHERE ARTID=?').run(m, ARTID);
  return d.prepare('SELECT ARTID, ARTNUMMER, BEZEICHNUNG1, LAGER FROM ARTIKEL WHERE ARTID=?').get(ARTID);
}
function bewegungen(q) {
  return L.db().prepare(`SELECT b.ID, b.DATUM, b.ANZAHL, b.BESCHREIBUNG, b.EINGABETYP, a.ARTNUMMER, a.BEZEICHNUNG1, a.LAGER FROM ARTBESTANDBEWEGUNGEN b LEFT JOIN ARTIKEL a ON a.ARTID=b.ARTIKELID
    WHERE b.DATUM BETWEEN ? AND ? ORDER BY b.DATUM DESC, b.ID DESC LIMIT 2000`).all(q.von || '0000', q.bis || '9999');
}

// Stocktaking
function inventurListen() { return L.db().prepare('SELECT l.*, (SELECT COUNT(*) FROM INVENTURLISTEN_POS p WHERE p.LISTID=l.LISTID) POSITIONEN FROM INVETURLISTEN l ORDER BY DATUM DESC, LISTID DESC').all(); }
function inventurNeu({ NAME, DATUM, KOMMENTAR, WARENGRUPPE }) {
  const d = L.db();
  const id = Number(d.prepare('INSERT INTO INVETURLISTEN (NAME, DATUM, KOMMENTAR, GEDRUCKT, AENDERUNGSDATUM) VALUES (?,?,?,0,?)').run(NAME || 'Inventur ' + L.today().slice(0, 4), DATUM || L.today(), KOMMENTAR || '', L.now()).lastInsertRowid);
  const arts = d.prepare(`SELECT ARTID, EKPNETTO FROM ARTIKEL WHERE COALESCE(LAGERFUEHRUNG,0)=1 ${WARENGRUPPE ? 'AND WARENGRUPPE=' + Number(WARENGRUPPE) : ''} ORDER BY LAGERORT, ARTNUMMER`).all();
  const st = d.prepare('INSERT INTO INVENTURLISTEN_POS (LISTID, ARTIKELID, ISTLAGER, ISTEK) VALUES (?,?,NULL,?)');
  for (const a of arts) st.run(id, a.ARTID, a.EKPNETTO || 0);
  return inventur(id);
}
function inventur(id) {
  const d = L.db();
  const l = d.prepare('SELECT * FROM INVETURLISTEN WHERE LISTID=?').get(id);
  if (!l) throw new L.HttpError(404, 'Inventurliste nicht gefunden');
  const pos = d.prepare('SELECT p.*, a.ARTNUMMER, a.BEZEICHNUNG1, a.LAGERORT, a.LAGER SOLL FROM INVENTURLISTEN_POS p LEFT JOIN ARTIKEL a ON a.ARTID=p.ARTIKELID WHERE p.LISTID=? ORDER BY a.LAGERORT, a.ARTNUMMER').all(id);
  return { liste: l, pos, wert: L.r2(pos.reduce((s, p) => s + (p.ISTLAGER ?? p.SOLL ?? 0) * (p.ISTEK || 0), 0)) };
}
function inventurSpeichern(id, rows) {
  const st = L.db().prepare('UPDATE INVENTURLISTEN_POS SET ISTLAGER=?, ISTEK=? WHERE LISTPOSID=? AND LISTID=?');
  for (const r of rows) st.run(r.ISTLAGER === '' || r.ISTLAGER == null ? null : num(r.ISTLAGER), num(r.ISTEK), r.LISTPOSID, id);
  return inventur(id);
}
function inventurBuchen(id) {
  const d = L.db(); const inv = inventur(id);
  if (Number(inv.liste.GEDRUCKT) === 2) throw new L.HttpError(409, 'Diese Inventur wurde bereits gebucht.');
  let n = 0;
  d.exec('BEGIN');
  try {
    for (const p of inv.pos) {
      if (p.ISTLAGER == null) continue;
      const diff = L.r2(p.ISTLAGER - (p.SOLL || 0));
      if (diff) { d.prepare('INSERT INTO ARTBESTANDBEWEGUNGEN (DATUM, ARTIKELID, ANZAHL, BESCHREIBUNG, EINGABETYP) VALUES (?,?,?,?,?)').run(inv.liste.DATUM, p.ARTIKELID, diff, `Inventur ${inv.liste.NAME}`, 'I'); n++; }
      d.prepare('UPDATE ARTIKEL SET LAGER=? WHERE ARTID=?').run(p.ISTLAGER, p.ARTIKELID);
    }
    d.prepare('UPDATE INVETURLISTEN SET GEDRUCKT=2, AENDERUNGSDATUM=? WHERE LISTID=?').run(L.now(), id);
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return { korrekturen: n };
}

module.exports = { load, save, remove, addPayment, deletePayment, importErechnung, bewegung, bewegungen, inventurListen, inventurNeu, inventur, inventurSpeichern, inventurBuchen };
