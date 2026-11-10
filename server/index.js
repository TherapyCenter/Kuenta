'use strict';
// Kuenta – Invoicing & POS for auto repair shops (web application)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const dbm = require('./db');
const L = require('./lib');
const G = require('./api/generic');
const VG = require('./api/vorgang');
const FI = require('./api/finanzen');
const ER = require('./api/erechnung');
const BK = require('./backup');
const KFZ = require('./import/kfz');
const { E } = require('../public/js/entities.js');
const pkg = require('../package.json');

const PORT = Number(process.env.PORT || process.env.KUENTA_PORT || 3700);
const HOST = process.env.HOST || process.env.KUENTA_HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_BODY = 1024 * 1024 * 1024;

// ---------- Sessions / permissions ----------
const sessions = new Map();
function loginRequired() {
  try {
    if (L.opt('Anmeldung', '0') !== '1') return false;
    return L.db().prepare("SELECT COUNT(*) n FROM BENUTZER WHERE LOGINBENUTZEN=1 AND COALESCE(BENUTZER,'')<>''").get().n > 0;
  } catch { return false; }
}
function userRights(benid) {
  const rows = L.db().prepare('SELECT r.KATEGORIE, r.BEZEICHNUNG FROM ZUGRIFFVERWEIGERT v JOIN ZUGRIFFSRECHTE r ON r.ID=v.RECHTEID WHERE v.BENUTZERID=?').all(benid);
  const denied = new Set();
  for (const r of rows) {
    const b = String(r.BEZEICHNUNG || '').toLowerCase();
    const op = b.includes('anzeigen') && !b.includes('preis') ? 'anzeigen' : b.includes('erstellen') ? 'erstellen' : b.includes('bearb') ? 'bearbeiten' : b.includes('lösch') ? 'löschen' : b;
    denied.add(`${r.KATEGORIE}|${op}`);
    if (b.includes('einkaufspreis')) denied.add('Einkaufspreis anzeigen');
  }
  return denied;
}
function getUser(req) {
  const m = /(?:^|;\s*)sw_session=([a-f0-9]+)/.exec(req.headers.cookie || '');
  const s = m && sessions.get(m[1]);
  if (s && s.mandant === dbm.current()) { s.seen = Date.now(); return s; }
  return null;
}
function can(user, right, op) {
  if (!user || !user.denied || !right) return true;
  return !user.denied.has(`${right}|${op}`);
}

// ---------- HTTP helpers ----------
function send(res, status, body, headers = {}) {
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  } else {
    const s = JSON.stringify(body ?? null);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(s);
  }
}
function download(res, buf, filename, type = 'application/octet-stream') {
  send(res, 200, buf, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}` });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new L.HttpError(413, 'Datei zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function json(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw new L.HttpError(400, 'Ungültige Anfrage'); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.webp': 'image/webp', '.bmp': 'image/bmp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
function serveFile(res, file, extraHeaders = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Nicht gefunden' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', ...extraHeaders });
    fs.createReadStream(file).pipe(res);
  });
}
function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  if (!p.startsWith(path.normalize(base + path.sep)) && p !== path.normalize(base)) throw new L.HttpError(400, 'Ungültiger Pfad');
  return p;
}

// ---------- Router ----------
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
}

// Warning if the data folder is on a network drive (checked at start)
let datenWarnung = null;

// session
route('GET', '/api/session', (ctx) => ({ warnung: datenWarnung, loginRequired: loginRequired(), user: ctx.user ? { name: ctx.user.name, id: ctx.user.id, denied: [...ctx.user.denied] } : null, version: pkg.version, pro: require('./lizenz').status().funktionen, firma: L.firma().FIRMENNAME, mandant: dbm.current(), mandanten: dbm.listMandanten() }), { public: true });
route('POST', '/api/login', async (ctx) => {
  const b = await json(ctx.req);
  const u = L.db().prepare('SELECT * FROM BENUTZER WHERE LOGINBENUTZEN=1 AND ulower(BENUTZER)=?').get(String(b.user || '').toLowerCase());
  if (!u || !G.checkPassword(b.pass || '', u.PASSWORT)) throw new L.HttpError(401, 'Benutzername oder Passwort falsch.');
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { id: u.BENUTZERID, name: u.BENUTZER, denied: userRights(u.BENUTZERID), seen: Date.now(), mandant: dbm.current() });
  ctx.res.setHeader('Set-Cookie', `sw_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
  return { ok: true };
}, { public: true });
// Clean shutdown for the installer (update/uninstall): only from this computer and only with
// our own header, so a foreign web page in the browser cannot stop Kuenta.
route('POST', '/api/system/beenden', (ctx) => {
  const a = String(ctx.req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!(a === '::1' || a.startsWith('127.')) || ctx.req.headers['x-kuenta-beenden'] !== '1') throw new L.HttpError(403, 'Nicht erlaubt.');
  setTimeout(() => beenden('Installer'), 200);
  return { ok: true };
}, { public: true });
route('POST', '/api/logout', (ctx) => {
  const m = /(?:^|;\s*)sw_session=([a-f0-9]+)/.exec(ctx.req.headers.cookie || '');
  if (m) sessions.delete(m[1]);
  ctx.res.setHeader('Set-Cookie', 'sw_session=; Max-Age=0; Path=/');
  return { ok: true };
}, { public: true });

// generic
route('GET', '/api/lookups', () => G.lookups());
route('GET', '/api/list/:ent', (ctx) => { const e = G.entity(ctx.p.ent); ctx.need(e.right, 'anzeigen'); return G.list(ctx.p.ent, ctx.q, ctx.user); });
route('GET', '/api/rec/:ent/:id', (ctx) => { const e = G.entity(ctx.p.ent); ctx.need(e.right, 'anzeigen'); return G.getRec(ctx.p.ent, ctx.p.id); });
route('POST', '/api/rec/:ent', async (ctx) => { const e = G.entity(ctx.p.ent); ctx.need(e.right, 'erstellen'); return G.saveRec(ctx.p.ent, null, await json(ctx.req), ctx.user); });
route('PUT', '/api/rec/:ent/:id', async (ctx) => { const e = G.entity(ctx.p.ent); ctx.need(e.right, 'bearbeiten'); return G.saveRec(ctx.p.ent, ctx.p.id, await json(ctx.req), ctx.user); });
route('DELETE', '/api/rec/:ent/:id', (ctx) => { const e = G.entity(ctx.p.ent); ctx.need(e.right, 'löschen'); return G.deleteRec(ctx.p.ent, ctx.p.id, ctx.user); });
route('GET', '/api/nextnumber/:ent', (ctx) => { const e = G.entity(ctx.p.ent); return { nr: e.number ? L.nextNumber(e.number.key, e.table, e.number.f, e.where || '') : null }; });

// sub lists
route('GET', '/api/kunden/:id/fahrzeuge', (ctx) => G.kundenFahrzeuge(ctx.p.id));
route('GET', '/api/kunden/:id/vorgaenge', (ctx) => G.kundenVorgaenge(ctx.p.id));
route('PUT', '/api/kunden/:id/fahrzeuge/:fid', (ctx) => G.link(ctx.p.id, ctx.p.fid, true));
route('DELETE', '/api/kunden/:id/fahrzeuge/:fid', (ctx) => G.link(ctx.p.id, ctx.p.fid, false));
route('GET', '/api/fahrzeuge/:id/halter', (ctx) => G.fahrzeugHalter(ctx.p.id));
route('GET', '/api/fahrzeuge/:id/historie', (ctx) => G.fahrzeugHistorie(ctx.p.id));
route('GET', '/api/fahrzeuge/:id/reifen', (ctx) => G.fahrzeugReifen(ctx.p.id));
route('GET', '/api/artikel/:id/bewegungen', (ctx) => G.artikelBewegungen(ctx.p.id));
route('POST', '/api/artikel/:id/bewegung', async (ctx) => {
  const b = await json(ctx.req); const n = Number(b.ANZAHL) || 0;
  L.db().prepare('INSERT INTO ARTBESTANDBEWEGUNGEN (DATUM, ARTIKELID, ANZAHL, BESCHREIBUNG, EINGABETYP) VALUES (?,?,?,?,?)').run(b.DATUM || L.today(), ctx.p.id, n, b.BESCHREIBUNG || 'Manuelle Buchung', 'M');
  L.db().prepare('UPDATE ARTIKEL SET LAGER=COALESCE(LAGER,0)+? WHERE ARTID=?').run(n, ctx.p.id);
  return { ok: true };
});
route('GET', '/api/kba', (ctx) => G.kba(ctx.q.hsn, ctx.q.tsn));
route('GET', '/api/plz/:plz', (ctx) => G.plz(ctx.p.plz));
route('GET', '/api/suche', (ctx) => {
  const s = '%' + String(ctx.q.q || '').toLowerCase() + '%';
  const d = L.db();
  return {
    kunden: d.prepare("SELECT KUNID id, NUMMER nr, TRIM(COALESCE(NAME,'')||' '||COALESCE(VORNAME,'')) name, ORT ort FROM KUNDEN WHERE ulower(NAME||' '||COALESCE(VORNAME,'')||' '||COALESCE(NUMMER,'')||' '||COALESCE(TELEFON,'')||' '||COALESCE(MOBIL,'')) LIKE ? LIMIT 8").all(s),
    fahrzeuge: d.prepare("SELECT FAHR_ID id, KENNZEICHEN kz, MARKE||' '||COALESCE(MODELL,'') name FROM FAHRZEUGE WHERE ulower(COALESCE(KENNZEICHEN,'')||' '||COALESCE(FZIDENTNR,'')) LIKE ? LIMIT 8").all(s),
    rechnungen: d.prepare("SELECT RECHNUNGID id, TYP typ, RECHNUNGNUMMER nr, DATUM datum, KUNNAME name, GBRUTTO brutto FROM RECHNUNGEN WHERE CAST(RECHNUNGNUMMER AS TEXT) LIKE ? ORDER BY RECHNUNGID DESC LIMIT 8").all(String(ctx.q.q || '').trim() + '%'),
  };
});

// documents (Vorgänge)
const vRight = typ => E[require('../public/js/entities.js').V[typ].ent].right;
route('GET', '/api/vorgang/:typ/neu', (ctx) => { ctx.need(vRight(ctx.p.typ), 'erstellen'); return VG.template(ctx.p.typ, ctx.q); });
route('GET', '/api/vorgang/:typ/:id', (ctx) => { ctx.need(vRight(ctx.p.typ), 'anzeigen'); return VG.load(ctx.p.typ, ctx.p.id); });
route('POST', '/api/vorgang/:typ', async (ctx) => { const b = await json(ctx.req); ctx.need(vRight(ctx.p.typ), b.kopf && b.kopf[require('../public/js/entities.js').V[ctx.p.typ].pk] ? 'bearbeiten' : 'erstellen'); return VG.save(ctx.p.typ, b, ctx.user); });
route('DELETE', '/api/vorgang/:typ/:id', (ctx) => { ctx.need(vRight(ctx.p.typ), 'löschen'); return VG.remove(ctx.p.typ, ctx.p.id, ctx.user); });
route('POST', '/api/vorgang/:typ/:id/wandeln', async (ctx) => { const b = await json(ctx.req); ctx.need(vRight(b.ziel), 'erstellen'); return VG.convert(ctx.p.typ, ctx.p.id, b.ziel, 'wandeln', ctx.user); });
route('POST', '/api/vorgang/:typ/:id/kopieren', async (ctx) => { const b = await json(ctx.req); ctx.need(vRight(b.ziel), 'erstellen'); return VG.convert(ctx.p.typ, ctx.p.id, b.ziel, 'kopieren', ctx.user); });
route('POST', '/api/vorgang/rechnung/:id/storno', (ctx) => { ctx.need('Rechnungskorrekturen', 'erstellen'); return VG.storno(ctx.p.id, ctx.user); });
route('POST', '/api/vorgang/:typ/flag', async (ctx) => { const b = await json(ctx.req); return VG.setFlag(ctx.p.typ, b.ids, b.flag, b.value); });
route('GET', '/api/kunde/:id/vorgangdaten', (ctx) => VG.kundeFelder(ctx.p.id));
route('GET', '/api/fahrzeug/:id/vorgangdaten', (ctx) => VG.fahrzeugFelder(ctx.p.id));
route('POST', '/api/vorgang/berechnen', async (ctx) => { const b = await json(ctx.req); const kopf = { ...b.kopf }; const pos = (b.pos || []).map(p => ({ ...p })); const tax = VG.calc(kopf, pos); return { kopf, pos, tax }; });
route('GET', '/api/stapel/rechnungen', (ctx) => {
  const d = L.db(); const w = ['TYP IN (1,2)']; const p = [];
  if (ctx.q.von) { w.push('DATUM>=?'); p.push(ctx.q.von); }
  if (ctx.q.bis) { w.push('DATUM<=?'); p.push(ctx.q.bis); }
  if (ctx.q.nrvon) { w.push('RECHNUNGNUMMER>=?'); p.push(Number(ctx.q.nrvon)); }
  if (ctx.q.nrbis) { w.push('RECHNUNGNUMMER<=?'); p.push(Number(ctx.q.nrbis)); }
  if (ctx.q.status === 'ged') w.push('GEDRUCKT=1'); if (ctx.q.status === 'nged') w.push('COALESCE(GEDRUCKT,0)=0');
  const ids = d.prepare(`SELECT RECHNUNGID, TYP FROM RECHNUNGEN WHERE ${w.join(' AND ')} ORDER BY RECHNUNGNUMMER LIMIT 500`).all(...p);
  return ids.map(r => VG.load(r.TYP === 2 ? 'korrektur' : 'rechnung', r.RECHNUNGID));
});

// payments
route('POST', '/api/zahlung', async (ctx) => { ctx.need('Zahlungen', 'erstellen'); return VG.addPayment(await json(ctx.req), ctx.user); });
route('DELETE', '/api/zahlung/:id', (ctx) => { ctx.need('Zahlungen', 'löschen'); return VG.deletePayment(ctx.p.id, ctx.user); });

// finance / reports
route('GET', '/api/finanzen/op', (ctx) => FI.offenePosten(ctx.q));
route('GET', '/api/finanzen/mahnvorschlag', () => FI.mahnVorschlag());
route('GET', '/api/finanzen/mahnungen', () => FI.mahnungenListe());
route('GET', '/api/finanzen/mahnung/:id', (ctx) => FI.mahnung(ctx.p.id));
route('POST', '/api/finanzen/mahnung', async (ctx) => FI.mahnungErstellen(await json(ctx.req), ctx.user));
route('DELETE', '/api/finanzen/mahnung/:id', (ctx) => FI.mahnungLoeschen(ctx.p.id));
route('GET', '/api/finanzen/kassenbuch', (ctx) => FI.kassenbuch(ctx.q));
route('GET', '/api/finanzen/rechnungsliste', (ctx) => FI.rechnungsliste(ctx.q));
route('GET', '/api/finanzen/fibu', (ctx) => FI.fibuListe(ctx.q));
route('GET', '/api/finanzen/datev', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = FI.datevExport(ctx.q); return { _download: r.buffer, filename: r.dateiname, type: 'text/csv; charset=windows-1252' }; });
route('GET', '/api/finanzen/datev-stammdaten', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = require('./datev').stammdaten(ctx.q); return { _download: r.buffer, filename: r.dateiname, type: 'text/csv; charset=windows-1252' }; });
route('GET', '/api/finanzen/gobd', (ctx) => { const r = BK.gobdExport(ctx.q.von || '2000-01-01', ctx.q.bis || L.today()); return { _download: r.buffer, filename: r.filename, type: 'application/zip' }; });
route('GET', '/api/auswertung/umsatz', (ctx) => { ctx.need('Auswetung', 'anzeigen'); return FI.umsatz(ctx.q); });
route('GET', '/api/auswertung/termine', (ctx) => FI.fahrzeugtermine(ctx.q));
// reminders of vehicle due dates by email/SMS
route('GET', '/api/erinnerung/vorlagen', () => ({ ...require('./erinnerung').VORLAGE }));
route('POST', '/api/erinnerung/senden', async (ctx) => { const b = await json(ctx.req); return require('./erinnerung').senden({ ...b, user: ctx.user && ctx.user.name, offenAm: ctx.req }); });
route('POST', '/api/erinnerung/brief', async (ctx) => { const b = await json(ctx.req); return require('./erinnerung').briefeProtokollieren({ ...b, user: ctx.user && ctx.user.name }); });
route('GET', '/api/erinnerung/protokoll', () => L.db().prepare(`SELECT e.*, f.KENNZEICHEN FROM SW_ERINNERUNGEN e LEFT JOIN FAHRZEUGE f ON f.FAHR_ID=e.FAHRID ORDER BY e.ID DESC LIMIT 1000`).all());
route('POST', '/api/sms/test', async (ctx) => { const b = await json(ctx.req); return require('./pro/sms').senden(b.an, b.text || 'Testnachricht von Kuenta: Der SMS-Versand funktioniert.'); });
// Kuenta Pro license
route('GET', '/api/lizenz', () => require('./lizenz').status());
route('PUT', '/api/lizenz', async (ctx) => { ctx.need('Einstellungen', 'anzeigen'); const b = await json(ctx.req); try { return require('./lizenz').einspielen(b.schluessel); } catch (e) { throw e.status ? e : new L.HttpError(400, e.message); } });
route('DELETE', '/api/lizenz', (ctx) => { ctx.need('Einstellungen', 'anzeigen'); return require('./lizenz').entfernen(); });
route('GET', '/api/auswertung/serienbrief', (ctx) => FI.serienbriefEmpfaenger(ctx.q));
route('GET', '/api/dashboard', () => FI.dashboard());
// exchange rates for display only (invoices stay in euros)
route('GET', '/api/kurse/aktuell', () => require('./kurse').aktuell());
route('GET', '/api/protokoll', (ctx) => L.db().prepare('SELECT * FROM SW_PROTOKOLL ORDER BY ID DESC LIMIT ?').all(Math.min(Number(ctx.q.limit) || 500, 5000)));

// e-invoice
route('GET', '/api/erechnung/:id', (ctx) => {
  const r = ER.create(ctx.p.id, ctx.q.format);
  if (ctx.q.pruefen === '1') return { problems: r.problems, xml: r.xml };
  return { _download: Buffer.from(r.xml, 'utf8'), filename: `XRechnung_${r.nr}${ctx.q.format === 'ubl' ? '_UBL' : ''}.xml`, type: 'application/xml' };
});

// appointments (calendar)
route('GET', '/api/termine', (ctx) => L.db().prepare(`SELECT t.*, (SELECT TRIM(COALESCE(k.NAME,'')||' '||COALESCE(k.VORNAME,'')) FROM KUNDEN k WHERE k.KUNID=t.KUNID) KUNDE,
  (SELECT f.KENNZEICHEN FROM FAHRZEUGE f WHERE f.FAHR_ID=t.FAHRID) KENNZEICHEN FROM SW_TERMINE t WHERE substr(BEGINN,1,10) BETWEEN ? AND ? ORDER BY BEGINN`).all(ctx.q.von || '0000', ctx.q.bis || '9999'));
route('POST', '/api/termine', async (ctx) => {
  const b = await json(ctx.req); const d = L.db();
  const f = ['BEGINN', 'ENDE', 'GANZTAGS', 'TITEL', 'NOTIZ', 'KUNID', 'FAHRID', 'RESSOURCE', 'FARBE', 'ERLEDIGT'];
  const v = f.map(k => b[k] === '' ? null : b[k] ?? null);
  if (b.ID) d.prepare(`UPDATE SW_TERMINE SET ${f.map(k => k + '=?').join(',')}, AENDERUNGSDATUM=? WHERE ID=?`).run(...v, L.now(), b.ID);
  else return { id: Number(d.prepare(`INSERT INTO SW_TERMINE (${f.join(',')}, AENDERUNGSDATUM) VALUES (${f.map(() => '?').join(',')},?)`).run(...v, L.now()).lastInsertRowid) };
  return { id: b.ID };
});
route('DELETE', '/api/termine/:id', (ctx) => { L.db().prepare('DELETE FROM SW_TERMINE WHERE ID=?').run(ctx.p.id); return { ok: true }; });

// documents (files)
route('GET', '/api/dokumente', (ctx) => L.db().prepare('SELECT * FROM SW_DOKUMENTE WHERE BEZUG=? AND BEZUGID=? ORDER BY DATUM DESC, ID DESC').all(String(ctx.q.bezug), Number(ctx.q.id)));
route('POST', '/api/dokumente', async (ctx) => {
  const buf = await readBody(ctx.req);
  const name = path.basename(String(ctx.q.name || 'datei')).replace(/[<>:"/\\|?*]/g, '_');
  const bezug = String(ctx.q.bezug || 'KUNDE').toUpperCase().replace(/[^A-Z]/g, ''); const id = Number(ctx.q.id);
  const rel = path.join('dokumente', bezug.toLowerCase(), String(id), `${Date.now()}_${name}`);
  const abs = safeJoin(dbm.FILES_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  const r = L.db().prepare('INSERT INTO SW_DOKUMENTE (BEZUG, BEZUGID, DATEINAME, PFAD, MIME, GROESSE, BESCHREIBUNG, DATUM) VALUES (?,?,?,?,?,?,?,?)')
    .run(bezug, id, name, rel.replace(/\\/g, '/'), ctx.req.headers['content-type'] || 'application/octet-stream', buf.length, ctx.q.beschreibung || '', L.today());
  return { id: Number(r.lastInsertRowid) };
});
route('DELETE', '/api/dokumente/:id', (ctx) => {
  const d = L.db(); const r = d.prepare('SELECT PFAD FROM SW_DOKUMENTE WHERE ID=?').get(ctx.p.id);
  if (r) { try { fs.unlinkSync(safeJoin(dbm.FILES_DIR, r.PFAD)); } catch { /* ignore */ } d.prepare('DELETE FROM SW_DOKUMENTE WHERE ID=?').run(ctx.p.id); }
  return { ok: true };
});

// settings
route('GET', '/api/einstellungen', () => {
  const d = L.db();
  return {
    firma: L.firma(),
    optionen: d.prepare('SELECT OPTID, BEZEICHNUNG, WERT FROM OPTIONSWERTE WHERE TYP IN (0,500) ORDER BY OPTID').all(),
    sw: Object.fromEntries(d.prepare('SELECT SCHLUESSEL, WERT FROM SW_EINSTELLUNGEN').all().map(r => [r.SCHLUESSEL, r.WERT])),
    individuell: d.prepare('SELECT * FROM INDIVIDUELLEFELDER ORDER BY ID').all(),
    rechte: d.prepare('SELECT * FROM ZUGRIFFSRECHTE ORDER BY ID').all(),
    datenpfad: dbm.DATA_DIR,
  };
});
route('PUT', '/api/einstellungen', async (ctx) => {
  ctx.need('Einstellungen', 'anzeigen');
  const b = await json(ctx.req); const d = L.db();
  if (b.firma) {
    const cols = L.tableColumns('FIRMENDATEN'); const f = Object.entries(b.firma).filter(([k]) => cols.has(k) && k !== 'ID');
    if (!d.prepare('SELECT COUNT(*) n FROM FIRMENDATEN').get().n) d.prepare('INSERT INTO FIRMENDATEN (ID) VALUES (1)').run();
    if (f.length) d.prepare(`UPDATE FIRMENDATEN SET ${f.map(([k]) => `"${k}"=?`).join(',')} WHERE ID=(SELECT MIN(ID) FROM FIRMENDATEN)`).run(...f.map(([, v]) => v === '' ? null : v));
  }
  if (b.optionen) for (const [k, v] of Object.entries(b.optionen)) L.setOpt(k, v);
  if (b.sw) for (const [k, v] of Object.entries(b.sw)) L.setSw(k, v);
  if (b.individuell) for (const r of b.individuell) d.prepare('UPDATE INDIVIDUELLEFELDER SET BEZEICHNUNG=?, AKTIVE=? WHERE ID=?').run(r.BEZEICHNUNG, r.AKTIVE ? 1 : 0, r.ID);
  return { ok: true };
});
route('POST', '/api/einstellungen/logo', async (ctx) => {
  const buf = await readBody(ctx.req);
  const ext = (path.extname(String(ctx.q.name || '')).toLowerCase() || '.png').replace(/[^.a-z]/g, '');
  const rel = 'logo/firmenlogo' + ext;
  fs.mkdirSync(path.join(dbm.FILES_DIR, 'logo'), { recursive: true });
  fs.writeFileSync(path.join(dbm.FILES_DIR, rel), buf);
  L.setSw('firma.logo', rel);
  return { logo: rel };
});
route('GET', '/api/benutzer/:id/rechte', (ctx) => L.db().prepare('SELECT RECHTEID FROM ZUGRIFFVERWEIGERT WHERE BENUTZERID=?').all(ctx.p.id).map(r => r.RECHTEID));
route('PUT', '/api/benutzer/:id/rechte', async (ctx) => {
  ctx.need('Benutzer', 'anzeigen');
  const ids = await json(ctx.req); const d = L.db();
  d.prepare('DELETE FROM ZUGRIFFVERWEIGERT WHERE BENUTZERID=?').run(ctx.p.id);
  for (const r of ids) d.prepare('INSERT INTO ZUGRIFFVERWEIGERT (BENUTZERID, RECHTEID, GEAENDERT) VALUES (?,?,?)').run(ctx.p.id, r, L.now());
  for (const s of sessions.values()) if (String(s.id) === String(ctx.p.id)) s.denied = userRights(s.id);
  return { ok: true };
});

// backup & import
route('GET', '/api/sicherung', (ctx) => { const r = BK.createBackup({ password: ctx.q.passwort || null, ohneDateien: ctx.q.ohneDateien === '1' }); L.setSw('sicherung.letzte', L.now()); return { _download: r.buffer, filename: r.filename, type: 'application/octet-stream' }; });
route('POST', '/api/sicherung/pruefen', async (ctx) => BK.inspectBackup(await readBody(ctx.req)));
route('POST', '/api/sicherung/wiederherstellen', async (ctx) => { ctx.need('Einstellungen', 'anzeigen'); return BK.restoreBackup(await readBody(ctx.req), { password: ctx.req.headers['x-passwort'] ? decodeURIComponent(ctx.req.headers['x-passwort']) : null }); });
route('GET', '/api/import/vorschau', (ctx) => { ctx.need('Einstellungen', 'anzeigen'); return KFZ.importVorschau(); });
route('POST', '/api/import/pruefen', async (ctx) => KFZ.inspect(await readBody(ctx.req)));
route('POST', '/api/import/kfz', async (ctx) => {
  ctx.need('Einstellungen', 'anzeigen');
  const buf = await readBody(ctx.req);
  const pw = ctx.req.headers['x-passwort'] ? decodeURIComponent(ctx.req.headers['x-passwort']) : null;
  const res = KFZ.importBuffer(buf, { password: pw, database: ctx.q.db || null, files: ctx.q.dateien !== '0', behalten: ctx.q.behalten !== '0' });
  return res;
});
route('POST', '/api/import/ordner', async (ctx) => {
  ctx.need('Einstellungen', 'anzeigen');
  const b = await json(ctx.req);
  const res = KFZ.importFolder(b.pfad, { database: b.db || 'DB1.FDB', files: b.dateien !== false, behalten: b.behalten !== false });
  return res;
});
route('GET', '/api/import/ordnervorschlag', () => {
  const cands = ['C:\\KFZ-Faktura', 'C:\\KFZ-Faktura_2026-11-04', 'C:\\Program Files (x86)\\KFZ-Faktura', 'C:\\Programme\\KFZ-Faktura'];
  try { for (const e of fs.readdirSync('C:\\')) if (/kfz/i.test(e)) cands.push('C:\\' + e); } catch { /* not windows */ }
  return [...new Set(cands)].filter(p => { try { return fs.existsSync(path.join(p, 'db')) || fs.existsSync(path.join(p, 'DB')); } catch { return false; } });
});

require('./routes2')(route, { json, readBody });

// ---------- Server ----------
const server = http.createServer((req, res) => {
  const mm = /(?:^|;\s*)sw_mandant=(\d+)/.exec(req.headers.cookie || '');
  dbm.runAs(mm ? Number(mm[1]) : 1, () => handle(req, res));
});
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith('/api/')) {
      const user = getUser(req);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        if (!r.opts.public && loginRequired() && !user) throw new L.HttpError(401, 'Bitte anmelden.');
        const ctx = {
          req, res, user, q: Object.fromEntries(url.searchParams), p: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
          need: (right, op) => { if (!can(user, right, op)) throw new L.HttpError(403, `Keine Berechtigung (${right}: ${op}).`); },
        };
        const out = await r.handler(ctx);
        if (out && out._download) return download(res, out._download, out.filename, out.type);
        return send(res, 200, out);
      }
      throw new L.HttpError(404, 'Unbekannte Funktion');
    }
    if (pathname.startsWith('/dateien/')) {
      if (loginRequired() && !getUser(req)) throw new L.HttpError(401, 'Bitte anmelden.');
      return serveFile(res, safeJoin(dbm.FILES_DIR, pathname.slice('/dateien/'.length)), url.searchParams.get('download') ? { 'Content-Disposition': 'attachment' } : {});
    }
    let file = pathname === '/' ? '/index.html' : pathname;
    file = safeJoin(PUBLIC, file);
    if (!fs.existsSync(file)) file = path.join(PUBLIC, 'index.html');
    return serveFile(res, file);
  } catch (e) {
    const status = e.status || (e.code === 'PASSWORD' ? 401 : 500);
    if (status >= 500) console.error(e);
    send(res, status, { error: e.message || String(e), code: e.code });
  }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

// stop the server and close the databases properly
function beenden(grund) {
  console.log(`\n  Kuenta wird beendet (${grund}) …`);
  try { server.close(); } catch { /* ignore */ }
  try { dbm.closeAll(); } catch { /* ignore */ }
  process.exit(0);
}

if (require.main === module) {
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => beenden(sig));
  dbm.get();
  const browser = url => { const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`; require('child_process').exec(cmd); };
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.log(`
  Kuenta läuft bereits auf Port ${PORT}.`);
      if (process.argv.includes('--open')) browser(`http://localhost:${PORT}`);
      setTimeout(() => process.exit(0), 1500);
    } else { console.error(e); process.exit(1); }
  });
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    console.log(`\n  Kuenta ${pkg.version} läuft:  ${url}`);
    if (HOST === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  Im Netzwerk erreichbar:      http://${ip}:${PORT}`);
    console.log(`  Datenverzeichnis:            ${dbm.DATA_DIR}\n`);
    if (process.argv.includes('--open')) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      require('child_process').exec(cmd);
    }
  });
  require('./datenordner').warnung(dbm.ROOT).then(w => { datenWarnung = w; if (w) console.log(`\n  ACHTUNG: ${w}\n`); });
  // daily automatic backup
  const alleSichern = () => { for (const m of dbm.listMandanten()) dbm.runAs(m.id, () => BK.autoBackup()); };
  setTimeout(alleSichern, 15000);
  setInterval(alleSichern, 60 * 60 * 1000);
  // crypto payments: ask BTCPay for incoming payments every 2 minutes
  const btcPruefen = () => { for (const m of dbm.listMandanten()) dbm.runAs(m.id, () => require('./btcpay').pruefen().catch(e => console.warn('BTCPay:', e.message))); };
  setTimeout(btcPruefen, 20000);
  setInterval(btcPruefen, 2 * 60 * 1000);
  // clean up old sessions
  setInterval(() => { const t = Date.now() - 12 * 3600 * 1000; for (const [k, s] of sessions) if (s.seen < t) sessions.delete(k); }, 600000);
}

module.exports = { server };
