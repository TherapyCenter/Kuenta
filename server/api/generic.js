'use strict';
// Generic list / record API driven by public/js/entities.js
const crypto = require('crypto');
const { E } = require('../../public/js/entities.js');
const L = require('../lib');

function entity(name) {
  const e = E[name];
  if (!e) throw new L.HttpError(404, 'Unbekanntes Modul: ' + name);
  return e;
}

function colExpr(e, f) {
  const c = e.columns.find(x => x.f === f);
  if (c && c.sql) return `(${c.sql})`;
  if (f === e.pk || (c && !c.sql) || L.tableColumns(e.table).has(f)) return `${e.table}."${f}"`;
  throw new L.HttpError(400, 'Unbekanntes Feld: ' + f);
}

function list(name, q, user) {
  const e = entity(name);
  const d = L.db();
  const cols = e.columns.filter(c => !(c.right && user && user.denied && user.denied.has(c.right)));
  const select = [`${e.table}."${e.pk}" AS "${e.pk}"`, ...cols.filter(c => c.f !== e.pk).map(c => `${c.sql ? '(' + c.sql + ')' : e.table + '."' + c.f + '"'} AS "${c.f}"`)];
  const where = []; const params = [];
  if (e.where) where.push(e.where);
  // status filters
  let filters = {};
  try { filters = q.filters ? JSON.parse(q.filters) : {}; } catch { filters = {}; }
  for (const sf of e.statusFilters || []) {
    const k = filters[sf.key] || sf.opts[0].k;
    const o = sf.opts.find(x => x.k === k) || sf.opts[0];
    where.push(o.sql);
  }
  // search
  if (q.q && String(q.q).trim()) {
    const s = String(q.q).trim();
    const field = (e.search || []).find(x => x.f === q.field) ? q.field : (e.search && e.search[0] && e.search[0].f);
    if (field) {
      const c = e.columns.find(x => x.f === field);
      const ex = colExpr(e, field);
      if (c && (c.t === 'int' || c.t === 'money') && /^\d+$/.test(s)) { where.push(`CAST(${ex} AS TEXT) LIKE ?`); params.push(s + '%'); }
      else { where.push(`ulower(${ex}) LIKE ?`); params.push('%' + s.toLowerCase() + '%'); }
    }
  }
  if (q.letter && e.letter) {
    const ex = colExpr(e, e.letter);
    if (q.letter === '123') where.push(`TRIM(${ex}) GLOB '[0-9]*'`);
    else { where.push(`ulower(TRIM(${ex})) LIKE ?`); params.push(String(q.letter).toLowerCase().slice(0, 1) + '%'); }
  }
  if (e.monthFilter && q.von) { where.push(`${e.table}.${e.monthFilter} >= ?`); params.push(q.von); }
  if (e.monthFilter && q.bis) { where.push(`${e.table}.${e.monthFilter} <= ?`); params.push(q.bis); }
  const w = where.length ? 'WHERE ' + where.map(x => '(' + x + ')').join(' AND ') : '';
  // sort
  const sortF = cols.find(c => c.f === q.sort) ? q.sort : (e.sort || e.pk);
  const dir = (q.dir || (sortF === e.sort ? e.sortDir : '') || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const sc = cols.find(c => c.f === sortF);
  const sortEx = sc && (sc.t === 'int' || sc.t === 'money' || sc.t === 'num') ? `CAST("${sortF}" AS REAL)` : `ulower(TRIM("${sortF}"))`;
  const limit = Math.min(Number(q.limit) || 300, 5000);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const total = d.prepare(`SELECT COUNT(*) n FROM ${e.table} ${w}`).get(...params).n;
  const rows = d.prepare(`SELECT * FROM (SELECT ${select.join(', ')} FROM ${e.table} ${w}) ORDER BY ${sortEx} ${dir}, "${e.pk}" ${dir} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  let sums = null;
  const moneyCols = cols.filter(c => c.t === 'money' && !c.noSum);
  if (moneyCols.length && (e.vorgang || e.table === 'KASSENBUCH' || e.table === 'ZAHLUNGSEINGAENGE')) {
    sums = d.prepare(`SELECT ${moneyCols.map(c => `ROUND(SUM(${c.sql ? '(' + c.sql + ')' : e.table + '."' + c.f + '"'}),2) AS "${c.f}"`).join(', ')} FROM ${e.table} ${w}`).get(...params);
  }
  return { total, rows, sums };
}

function getRec(name, id) {
  const e = entity(name);
  const row = L.db().prepare(`SELECT * FROM ${e.table} WHERE "${e.pk}"=?`).get(id);
  if (!row) throw new L.HttpError(404, `${e.one} nicht gefunden`);
  if (e.table === 'BENUTZER') row.PASSWORT = '';
  return row;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    const h = crypto.scryptSync(String(pw), salt, 32);
    return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
  }
  return String(pw) === stored; // imported legacy password
}

function saveRec(name, id, data, user) {
  const e = entity(name);
  if (e.table === 'SW_KAUFVERTRAG') return require('./handel').vertragSpeichern({ ...data, ID: id || null });
  if (e.table === 'FAHRZEUGE' && name === 'fahrzeuglager' && !id && !data.FRZTYP) data = { ...data, FRZTYP: 2 };
  const d = L.db();
  const cols = L.tableColumns(e.table);
  const vals = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (k === e.pk || !cols.has(k)) continue;
    vals[k] = v === '' ? null : v;
  }
  if (e.table === 'BENUTZER') {
    if (vals.PASSWORT) vals.PASSWORT = hashPassword(vals.PASSWORT); else delete vals.PASSWORT;
  }
  if (cols.has('AENDERUNGSDATUM')) vals.AENDERUNGSDATUM = L.now();
  // number range
  if (e.number && (vals[e.number.f] == null || vals[e.number.f] === '') && !id) {
    const n = L.nextNumber(e.number.key, e.table, e.number.f, e.where || '');
    vals[e.number.f] = e.number.text ? String(n) : n;
  }
  if (e.number && vals[e.number.f] != null && !e.number.text) {
    const dup = d.prepare(`SELECT "${e.pk}" id FROM ${e.table} WHERE "${e.number.f}"=? ${e.where ? 'AND ' + e.where : ''}`).get(vals[e.number.f]);
    if (dup && String(dup.id) !== String(id)) throw new L.HttpError(409, `Die Nummer ${vals[e.number.f]} ist bereits vergeben.`);
  }
  if (e.table === 'KASSENBUCH') { vals.EINNAHMEN = vals.EINNAHMEN || 0; vals.AUSGABEN = vals.AUSGABEN || 0; if (!vals.ART) vals.ART = vals.AUSGABEN > 0 ? 2 : 1; }
  const keys = Object.keys(vals);
  let newId = id;
  if (id) {
    if (keys.length) d.prepare(`UPDATE ${e.table} SET ${keys.map(k => `"${k}"=?`).join(', ')} WHERE "${e.pk}"=?`).run(...keys.map(k => vals[k]), id);
    L.protocol(user && user.name, e.table, id, 'geändert');
  } else {
    if (e.table === 'FIRMENDATEN' || !isIntegerPk(e.table, e.pk)) {
      const n = d.prepare(`SELECT COALESCE(MAX("${e.pk}"),0)+1 n FROM ${e.table}`).get().n;
      vals[e.pk] = n; keys.push(e.pk);
    }
    const r = d.prepare(`INSERT INTO ${e.table} (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(k => vals[k]));
    newId = vals[e.pk] || Number(r.lastInsertRowid);
    L.protocol(user && user.name, e.table, newId, 'angelegt');
  }
  if (e.number && vals[e.number.f] != null) L.commitNumber(e.number.key, vals[e.number.f]);
  return getRec(name, newId);
}

const pkCache = new Map();
function isIntegerPk(table, pk) {
  const key = table + '.' + pk;
  if (!pkCache.has(key)) {
    const info = L.db().prepare(`PRAGMA table_info("${table}")`).all().find(c => c.name.toUpperCase() === pk);
    pkCache.set(key, !!(info && info.pk === 1 && /INT/i.test(info.type)));
  }
  return pkCache.get(key);
}

function deleteRec(name, id, user) {
  const e = entity(name);
  const d = L.db();
  if (e.vorgang) throw new L.HttpError(400, 'Vorgänge bitte über die Vorgangsfunktionen löschen.');
  if (e.table === 'KUNDEN') {
    const n = d.prepare('SELECT COUNT(*) n FROM RECHNUNGEN WHERE KUNID=?').get(id).n;
    if (n) throw new L.HttpError(409, `Der Kunde hat ${n} Rechnung(en) und kann aus Gründen der Aufbewahrungspflicht nicht gelöscht werden.`);
    d.prepare('DELETE FROM KUNDEN_FAHRZEUGE WHERE KUNID=?').run(id);
  }
  if (e.table === 'FAHRZEUGE') d.prepare('DELETE FROM KUNDEN_FAHRZEUGE WHERE FAHRID=?').run(id);
  if (e.table === 'KASSENBUCH') {
    const k = d.prepare('SELECT ZAHLID FROM KASSENBUCH WHERE KASSENID=?').get(id);
    if (k && k.ZAHLID) throw new L.HttpError(409, 'Dieser Eintrag gehört zu einer Zahlung. Bitte löschen Sie die Zahlung unter Finanzen → Zahlungen.');
    d.prepare('DELETE FROM FIBU WHERE KASSENID=?').run(id);
  }
  const old = d.prepare(`SELECT * FROM ${e.table} WHERE "${e.pk}"=?`).get(id);
  d.prepare(`DELETE FROM ${e.table} WHERE "${e.pk}"=?`).run(id);
  L.protocol(user && user.name, e.table, id, 'gelöscht', old);
  return { ok: true };
}

function lookups() {
  const d = L.db();
  const all = (sql) => d.prepare(sql).all();
  const opts = (typ) => all(`SELECT BEZEICHNUNG FROM OPTIONSWERTE WHERE TYP=${typ} ORDER BY OPTID`).map(r => r.BEZEICHNUNG);
  const ind = {};
  for (const r of all('SELECT ID, AKTIVE, BEZEICHNUNG FROM INDIVIDUELLEFELDER')) ind['IND' + r.ID] = { l: r.BEZEICHNUNG, aktiv: r.AKTIVE };
  return {
    zahlungsbedingungen: all('SELECT ZAHLBDID id, NAME name, TEXT text, TAGEFAELLIG tage, TAGESKONTO skontotage, SKONTO skonto FROM ZAHLUNGSBEDINUNGEN ORDER BY NAME'),
    einheiten: all('SELECT EINHEITID id, BEZEICHNUNG name, UNECE unece FROM EINHEITEN ORDER BY EINHEITID'),
    kostensaetze: all('SELECT KOSTENSATZID id, BEZEICHNUNG name, AWBETRAG preis, AWKOSTEN kosten FROM KOSTENSATZ ORDER BY BEZEICHNUNG'),
    hersteller: all('SELECT HERID id, HERNAME name FROM HERSTELLER ORDER BY HERNAME'),
    lieferanten: all("SELECT LIEFID id, NAME name FROM LIEFERANTEN ORDER BY NAME"),
    warengruppen: all('SELECT GRUPPENID id, BEZEICHNUNG name FROM WARENGRUPPEN ORDER BY BEZEICHNUNG'),
    laender: all("SELECT ISO3166 id, BEZEICHNUNG name FROM LAENDERCODES WHERE ISO3166 IS NOT NULL AND ISO3166<>'' ORDER BY CASE ISO3166 WHEN 'DE' THEN 0 WHEN 'AT' THEN 1 WHEN 'CH' THEN 2 ELSE 3 END, BEZEICHNUNG"),
    reifenmarken: all('SELECT RMARKE name FROM REIFENMARKEN ORDER BY RMARKE').map(r => r.name),
    auftragsarten: all('SELECT AUFARTID id, BEZEICHNUNG name FROM AUFTRAGSART ORDER BY AUFARTID'),
    zahlungsarten: all('SELECT ID id, ART name, KASSENBUCH kasse, EC ec FROM ZAHLUNGSART ORDER BY ID'),
    benutzer: all("SELECT BENUTZERID id, TRIM(COALESCE(VORNAME,'')||' '||COALESCE(NAME,'')) name, ANREDE anrede, NAME nachname, VORNAME vorname FROM BENUTZER ORDER BY NAME"),
    textbausteine: all('SELECT TXTID id, TXTBEZEICHNUNG name, TXTTEXT text FROM TEXTBLOCK ORDER BY TXTBEZEICHNUNG'),
    drucktexte: all('SELECT IDTXT id, TXTART art, TXTARTSTANDARD std, TXTBEZEICHNUNG name, TXTBETREFF betreff, EINLEITUNG einleitung, SCHLUSSTEXT schluss, TXTARTVARIABLE var FROM DRUCKTEXTBAUSTEINE ORDER BY TXTART, TXTBEZEICHNUNG'),
    mwst: L.mwstList(),
    klein: L.optNum('Kleinunternehmer', 0) === 1,
    opt30: opts(30), opt40: opts(40), opt50: opts(50), opt60: opts(60), opt100: opts(100),
    ind,
  };
}

// ---- Sub-lists ----
function kundenFahrzeuge(kunid) {
  return L.db().prepare(`SELECT f.FAHR_ID, f.FRZNUMMER, f.KENNZEICHEN, f.FZIDENTNR, f.SCHLUESSNR1, f.SCHLUESSNR2, f.MARKE, f.MODELL, f.EZ, f.HU, f.KM
    FROM KUNDEN_FAHRZEUGE kf JOIN FAHRZEUGE f ON f.FAHR_ID=kf.FAHRID WHERE kf.KUNID=? ORDER BY f.KENNZEICHEN`).all(kunid);
}
function fahrzeugHalter(fahrid) {
  return L.db().prepare(`SELECT k.KUNID, k.NUMMER, k.ANREDE, k.NAME, k.VORNAME, k.STRASSE, k.PLZ, k.ORT, k.TELEFON, k.MOBIL
    FROM KUNDEN_FAHRZEUGE kf JOIN KUNDEN k ON k.KUNID=kf.KUNID WHERE kf.FAHRID=?`).all(fahrid);
}
function link(kunid, fahrid, on) {
  const d = L.db();
  if (on) d.prepare('INSERT OR IGNORE INTO KUNDEN_FAHRZEUGE (KUNID, FAHRID) VALUES (?,?)').run(kunid, fahrid);
  else d.prepare('DELETE FROM KUNDEN_FAHRZEUGE WHERE KUNID=? AND FAHRID=?').run(kunid, fahrid);
  return { ok: true };
}
const VG_UNION = (col) => `
  SELECT 'angebot' typ, 'Angebot' art, ANGEBOTID id, ANGEBOTNUMMER nr, DATUM, FAHRKENNZEICHEN, KUNNAME, GBRUTTO, NULL offen FROM ANGEBOTE WHERE ${col}=:id
  UNION ALL SELECT 'auftrag', 'Auftrag', AUFTRAGID, AUFTRAGNUMMER, DATUM, FAHRKENNZEICHEN, KUNNAME, GBRUTTO, NULL FROM AUFTRAEGE WHERE ${col}=:id
  UNION ALL SELECT 'lieferschein', 'Lieferschein', LIEFERSCHEINID, LIEFERSCHEINNUMMER, DATUM, FAHRKENNZEICHEN, KUNNAME, GBRUTTO, NULL FROM LIEFERSCHEIN WHERE ${col}=:id
  UNION ALL SELECT CASE TYP WHEN 2 THEN 'korrektur' ELSE 'rechnung' END, CASE TYP WHEN 2 THEN 'Rechnungskorrektur' ELSE 'Rechnung' END, RECHNUNGID, RECHNUNGNUMMER, DATUM, FAHRKENNZEICHEN, KUNNAME, GBRUTTO,
    ROUND(GBRUTTO-COALESCE((SELECT SUM(BETRAG) FROM ZAHLUNGSEINGAENGE z WHERE z.RECHNUNGID=RECHNUNGEN.RECHNUNGID),0),2) FROM RECHNUNGEN WHERE ${col}=:id
  ORDER BY DATUM DESC, nr DESC`;
function kundenVorgaenge(kunid) { return L.db().prepare(VG_UNION('KUNID')).all({ id: kunid }); }
function fahrzeugHistorie(fahrid) {
  const rows = L.db().prepare(VG_UNION('FAHRID')).all({ id: fahrid });
  // with positions summary for invoices
  const pos = L.db().prepare("SELECT GROUP_CONCAT(COALESCE(NULLIF(BEZEICHNUNG,''),BESCHREIBUNG), ' · ') t FROM RECHNUNGEN_POS WHERE RECHNUNGID=? AND POSART<>'T'");
  const km = L.db().prepare('SELECT FAHRKM FROM RECHNUNGEN WHERE RECHNUNGID=?');
  for (const r of rows) if (r.typ === 'rechnung' || r.typ === 'korrektur') { r.leistungen = (pos.get(r.id) || {}).t; r.km = (km.get(r.id) || {}).FAHRKM; }
  return rows;
}
function fahrzeugReifen(fahrid) {
  return L.db().prepare("SELECT EINLAGERUNGID, EINLNUMMER, EINDATUM, AUSDATUM, STATUS, LAGERORT, REIFENTYP, REIFENVORNEHERSTELLER, REIFENVORNEBREITE||'/'||REIFENVORNEQUERSCHNITT||' R'||REIFENVORNEDURCHM groesse FROM REIFENEINLAGERUNG WHERE FAHRZEUGID=? ORDER BY EINDATUM DESC").all(fahrid);
}
function artikelBewegungen(artid) {
  return L.db().prepare('SELECT DATUM, ANZAHL, BESCHREIBUNG, EINGABETYP, RECHNUNGID FROM ARTBESTANDBEWEGUNGEN WHERE ARTIKELID=? ORDER BY DATUM DESC, ID DESC LIMIT 500').all(artid);
}

function kba(hsn, tsn) {
  const d = L.db();
  const h = parseInt(hsn, 10);
  if (!Number.isFinite(h)) return { marke: null, modelle: [] };
  const m = d.prepare('SELECT BEZEICHNUNG FROM MARKE WHERE HSN=? LIMIT 1').get(h);
  const t = String(tsn || '').trim().toUpperCase().slice(0, 3);
  const modelle = t ? d.prepare('SELECT MODELL, KW, HUBRAUM, TREIBSTOFF, TSN FROM MODELL WHERE HSN=? AND TSN=? LIMIT 20').all(h, t) : [];
  for (const mo of modelle) {
    const tr = mo.TREIBSTOFF ? d.prepare('SELECT BEZEICHNUNG FROM TREIBSTOFF WHERE KBAID=? OR KBAID=?').get(mo.TREIBSTOFF, String(mo.TREIBSTOFF).padStart(4, '0')) : null;
    mo.KRAFTSTOFF = tr ? tr.BEZEICHNUNG : null;
  }
  return { marke: m ? m.BEZEICHNUNG : null, modelle };
}
function plz(p) {
  return L.db().prepare('SELECT DISTINCT STADT FROM PLZ WHERE PLZ=? ORDER BY STADT LIMIT 20').all(String(p).trim()).map(r => r.STADT);
}

module.exports = { list, getRec, saveRec, deleteRec, lookups, kundenFahrzeuge, fahrzeugHalter, link, kundenVorgaenge, fahrzeugHistorie, fahrzeugReifen, artikelBewegungen, kba, plz, hashPassword, checkPassword, entity };
