'use strict';
// Austrian cash register security regulation (Registrierkassensicherheitsverordnung, RKSV) and its
// detailed specification: every cash receipt carries a machine-readable code (QR) with
//   _R1-<ZDA>_<cash register id>_<receipt no>_<date-time>_<amounts 20/10/13/0/19 %>_<turnover counter AES-256-ICM>
//   _<certificate serial>_<signature of the previous receipt>_<signature value>
// signed as JWS (ES256). The turnover counter is encrypted with the AES key registered in FinanzOnline,
// receipts are chained via the first 8 bytes of SHA-256 of the previous JWS. Start receipt on the first use,
// monthly receipt (December = yearly receipt) at the change of month, collective receipt after a failure
// of the signature device, closing receipt when the register is taken out of service.
// Signature devices: A-Trust a.sign RK HSM (online) or a local test key (not RKSV compliant, for trials).
// Entries are also appended to at/dep.jsonl in the data folder (outside backups) so that restoring an
// older backup never breaks the chain; the export of the data collection protocol (DEP) is JSON as specified.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('../lib');
const dbm = require('../db');

const AUSFALL = 'Sicherheitseinrichtung ausgefallen';
const HEADER = Buffer.from('{"alg":"ES256"}').toString('base64url');
const ART_NULL = ['START', 'NULL', 'MONAT', 'JAHR', 'SAMMEL', 'SCHLUSS'];

const aktiv = () => L.land() === 'AT' && L.sw('at.rksv.aktiv', '0') === '1';
const dir = () => path.join(dbm.DATA_DIR, 'at');
const depDatei = () => path.join(dir(), 'dep.jsonl');
const kassenId = () => L.sw('at.rksv.kassenid', '') || ('KUENTA-' + String(L.sw('kasse.seriennummer', 'KASSE1')).replace(/[^0-9A-Za-z-]/g, ''));
const sha = s => crypto.createHash('sha256').update(s).digest();

// ---------- signature devices ----------
let transporte = null; // tests replace the HTTP transport
function _setTransporte(fn) { transporte = fn; }
async function http(method, url, body) {
  if (transporte) return transporte(method, url, body);
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`A-Trust: HTTP ${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
}
const atrustBase = () => (L.sw('at.rksv.umgebung', 'test') === 'produktion' ? 'https://rksv.a-trust.at/asignrkonline/v2' : 'https://hs-abnahme.a-trust.at/asignrkonline/v2');

function testSchluessel() {
  const priv = path.join(dir(), 'test-schluessel.pem');
  if (!fs.existsSync(priv)) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const key = crypto.createPrivateKey(fs.readFileSync(priv, 'utf8'));
  return { key, pub: crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }) };
}

// { zda, serial, zertifikat (base64 DER or ''), sign(payload) -> compact JWS }
async function geraet() {
  if (L.sw('at.rksv.signatur', 'test') === 'atrust') {
    const user = L.sw('at.rksv.atrust.user', ''); const pw = L.sw('at.rksv.atrust.pw', '');
    if (!user || !pw) throw new Error('Zugangsdaten der A-Trust-Signaturerstellungseinheit fehlen.');
    let z = null; try { z = JSON.parse(L.sw('at.rksv.zertifikat', '') || 'null'); } catch { /* reload */ }
    if (!z || z.user !== user) {
      const c = await http('GET', `${atrustBase()}/${encodeURIComponent(user)}/Certificate`);
      z = { user, zertifikat: c.Signaturzertifikat || '', stellen: c.Zertifizierungsstellen || [], serial: c.ZertifikatsseriennummerHex || c.Zertifikatsseriennummer || '' };
      if (!z.serial) throw new Error('A-Trust hat keine Zertifikatsseriennummer geliefert.');
      L.setSw('at.rksv.zertifikat', JSON.stringify(z));
    }
    return {
      zda: 'AT1', serial: z.serial, zertifikat: z.zertifikat, stellen: z.stellen,
      async sign(payload) {
        const r = await http('POST', `${atrustBase()}/${encodeURIComponent(user)}/Sign/JWS`, { password: pw, jws_payload: payload });
        if (!r || typeof r.result !== 'string' || r.result.split('.').length !== 3) throw new Error('A-Trust: ungültige Antwort der Signaturerstellungseinheit');
        return r.result;
      },
    };
  }
  const { key } = testSchluessel();
  const uid = require('./index').uid() || 'ATU00000000';
  return {
    zda: 'AT0', serial: `U:${uid}-K1`, zertifikat: '', stellen: [],
    async sign(payload) {
      const input = `${HEADER}.${Buffer.from(payload, 'utf8').toString('base64url')}`;
      return `${input}.${crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    },
  };
}

// ---------- AES key and turnover counter ----------
function aesKey() {
  const k = Buffer.from(L.sw('at.rksv.aeskey', ''), 'base64');
  if (k.length !== 32) throw new Error('AES-Schlüssel der Registrierkasse fehlt (Einstellungen → Österreich → Registrierkasse aktivieren).');
  return k;
}
// AES-256-ICM (counter mode): IV = first 16 bytes of SHA-256(cash register id + receipt no), 8-byte counter
function zaehlerVerschluesseln(cent, kid, nr, key = aesKey()) {
  const block = Buffer.alloc(16); block.writeBigInt64BE(BigInt(cent), 0);
  const c = crypto.createCipheriv('aes-256-ctr', key, sha(kid + nr).subarray(0, 16));
  return Buffer.concat([c.update(block), c.final()]).subarray(0, 8).toString('base64');
}
function zaehlerEntschluesseln(b64, kid, nr, key = aesKey()) {
  const enc = Buffer.alloc(16); Buffer.from(b64, 'base64').copy(enc);
  const c = crypto.createDecipheriv('aes-256-ctr', key, sha(kid + nr).subarray(0, 16));
  return Number(Buffer.concat([c.update(enc), c.final()]).readBigInt64BE(0));
}

const betrag = c => (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + ',' + String(Math.abs(c) % 100).padStart(2, '0');
function zeitLokal() { return L.now().replace(' ', 'T'); }

// ---------- journal (file and database) ----------
const COLS = ['ID', 'NR', 'ART', 'BELEGNR', 'BONID', 'ZEIT', 'KASSENID', 'BETRAEGE', 'UMSATZ', 'JWS', 'QR', 'AUSFALL', 'ZERT'];
function anotar(e) {
  fs.mkdirSync(dir(), { recursive: true });
  const fd = fs.openSync(depDatei(), 'a');
  try { fs.writeSync(fd, JSON.stringify(e) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
const sincronizados = new WeakSet();
function asegurar() {
  const d = L.db();
  if (sincronizados.has(d)) return d;
  sincronizados.add(d);
  const regs = new Map();
  let txt = ''; try { txt = fs.readFileSync(depDatei(), 'utf8'); } catch { /* none yet */ }
  for (const line of txt.split('\n')) { if (!line.trim()) continue; try { const e = JSON.parse(line); regs.set(e.ID, e); } catch { /* torn last line */ } }
  const enDb = new Set(d.prepare('SELECT ID FROM SW_AT_RKSV').all().map(r => r.ID));
  for (const r of d.prepare('SELECT * FROM SW_AT_RKSV').all()) if (!regs.has(r.ID)) { anotar(r); regs.set(r.ID, r); }
  const faltan = [...regs.values()].filter(e => !enDb.has(e.ID));
  if (faltan.length) {
    const ins = d.prepare(`INSERT INTO SW_AT_RKSV (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
    d.exec('BEGIN'); try { for (const e of faltan) ins.run(...COLS.map(c => e[c] ?? null)); d.exec('COMMIT'); } catch (err) { d.exec('ROLLBACK'); throw err; }
  }
  return d;
}
const letzter = d => d.prepare('SELECT * FROM SW_AT_RKSV ORDER BY NR DESC LIMIT 1').get() || null;

// receipts are created one after another (the chain needs the previous receipt)
let kette = Promise.resolve();
function seriell(fn) { const p = kette.then(fn, fn); kette = p.catch(() => {}); return p; }

// amounts in cents per tax bucket: [normal 20 %, reduced 10 %, reduced 13 %, zero, special 19 %]
function eimer(lines) {
  const b = [0, 0, 0, 0, 0];
  const rates = L.mwstRates();
  for (const l of lines) {
    const c = Math.round((Number(l.BRUTTO) || 0) * 100);
    const code = Number(l.MWSTCODE) || 61;
    const satz = Number(l.MWSTSATZ) || 0;
    if (!satz || code === 63) b[3] += c;
    else if (satz === 19) b[4] += c;
    else if (code === 62 || satz === rates[62]) b[1] += c;
    else if (code === 64 || satz === rates[64]) b[2] += c;
    else b[0] += c;
  }
  return b;
}

async function erstellen(art, { bonid = null, betraege = [0, 0, 0, 0, 0] } = {}) {
  const d = asegurar();
  const prev = letzter(d);
  const kid = prev ? prev.KASSENID : kassenId();
  const nr = prev ? prev.NR + 1 : 1;
  const belegnr = String(nr);
  const summe = betraege.reduce((s, v) => s + v, 0);
  const umsatz = (prev ? prev.UMSATZ : 0) + (art === 'TRAINING' ? 0 : summe);
  const zaehler = art === 'TRAINING' ? Buffer.from('TRA').toString('base64') : art === 'STORNO' ? Buffer.from('STO').toString('base64') : zaehlerVerschluesseln(umsatz, kid, belegnr);
  const vorher = prev ? sha(prev.JWS).subarray(0, 8).toString('base64') : sha(kid).subarray(0, 8).toString('base64');
  let g = null, fehler = null;
  try { g = await geraet(); } catch (e) { fehler = e; }
  const zda = g ? g.zda : (L.sw('at.rksv.signatur', 'test') === 'atrust' ? 'AT1' : 'AT0');
  let serial = g ? g.serial : ''; if (!serial) { try { serial = JSON.parse(L.sw('at.rksv.zertifikat', '') || '{}').serial || ''; } catch { /* none */ } }
  const payload = `_R1-${zda}_${kid}_${belegnr}_${zeitLokal()}_${betraege.map(betrag).join('_')}_${zaehler}_${serial}_${vorher}`;
  let jws, ausfall = 0;
  if (g) { try { jws = await g.sign(payload); } catch (e) { fehler = e; } }
  if (!jws) { ausfall = 1; jws = `${HEADER}.${Buffer.from(payload).toString('base64url')}.${Buffer.from(AUSFALL).toString('base64url')}`; }
  const qr = `${payload}_${Buffer.from(jws.split('.')[2], 'base64url').toString('base64')}`;
  const e = { ID: d.prepare('SELECT COALESCE(MAX(ID),0)+1 n FROM SW_AT_RKSV').get().n, NR: nr, ART: art, BELEGNR: belegnr, BONID: bonid, ZEIT: L.now(), KASSENID: kid, BETRAEGE: JSON.stringify(betraege), UMSATZ: umsatz, JWS: jws, QR: qr, AUSFALL: ausfall, ZERT: serial };
  anotar(e); // the file first: it survives restores
  d.prepare(`INSERT INTO SW_AT_RKSV (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`).run(...COLS.map(c => e[c] ?? null));
  if (fehler) L.setSw('at.rksv.fehler', `${L.now()}: ${fehler.message}`);
  return e;
}

// before a receipt: start receipt, collective receipt after a failure, monthly / yearly receipt at the change of month
async function vorbereiten(d) {
  let prev = letzter(d);
  if (!prev) prev = await erstellen('START');
  if (prev.AUSFALL && prev.ART !== 'SAMMEL') { const s = await erstellen('SAMMEL'); if (s.AUSFALL) return; prev = s; }
  const monat = L.today().slice(0, 7);
  const prevMonat = String(prev.ZEIT).slice(0, 7);
  if (prevMonat < monat && !['MONAT', 'JAHR', 'START'].includes(prev.ART)) await erstellen(prevMonat.endsWith('-12') ? 'JAHR' : 'MONAT');
}

// receipt for a sale / cancellation of the cash register (SW_KASSE_BON)
function beleg(bonid, { training = false } = {}) {
  if (!aktiv()) return Promise.resolve(null);
  return seriell(async () => {
    const d = asegurar();
    const b = d.prepare('SELECT * FROM SW_KASSE_BON WHERE ID=?').get(bonid);
    if (!b || b.TYP !== 'Beleg') return null; // deposits / withdrawals are no cash sales
    let lines = d.prepare('SELECT * FROM SW_KASSE_POS WHERE BONID=?').all(bonid);
    // payment of an invoice: amounts split like the tax groups of the invoice
    if (b.RECHNUNGID && lines.length === 1 && lines[0].GVTYP === 'Forderungsaufloesung') {
      const r = require('../api/vorgang').load('rechnung', b.RECHNUNGID);
      const groups = Object.entries(r.tax || {}); const total = groups.reduce((s, [, g]) => s + g.brutto, 0) || 1;
      lines = groups.map(([code, g]) => ({ MWSTCODE: Number(code), MWSTSATZ: g.rate, BRUTTO: lines[0].BRUTTO * g.brutto / total }));
    }
    await vorbereiten(d);
    return erstellen(training ? 'TRAINING' : b.STORNOID ? 'STORNO' : 'BELEG', { bonid, betraege: eimer(lines) });
  });
}
// null receipts on demand (monthly, yearly, closing, check)
function nullbeleg(art = 'NULL') {
  if (!aktiv()) throw new L.HttpError(409, 'Die Registrierkasse (RKSV) ist nicht aktiviert.');
  if (!ART_NULL.includes(art)) throw new L.HttpError(400, 'Unbekannte Belegart');
  return seriell(async () => { const d = asegurar(); if (art !== 'START' && !letzter(d)) await erstellen('START'); return erstellen(art); });
}

// switch on: AES key and cash register id, then the start receipt
async function aktivieren({ kassenid } = {}) {
  if (L.land() !== 'AT') throw new L.HttpError(409, 'Nur im österreichischen Steuersystem.');
  const d = asegurar();
  if (!letzter(d)) {
    if (kassenid) L.setSw('at.rksv.kassenid', String(kassenid).replace(/[^0-9A-Za-z-]/g, '').slice(0, 40));
    if (!L.sw('at.rksv.kassenid', '')) L.setSw('at.rksv.kassenid', kassenId());
    if (!L.sw('at.rksv.aeskey', '')) L.setSw('at.rksv.aeskey', crypto.randomBytes(32).toString('base64'));
  }
  L.setSw('at.rksv.aktiv', '1');
  const start = letzter(d) ? null : await nullbeleg('START');
  return { ...status(), start: start && { nr: start.NR, qr: start.QR, ausfall: !!start.AUSFALL } };
}

// data for the registration in FinanzOnline and the state of the register
function status() {
  const d = asegurar(); const l = letzter(d);
  let z = null; try { z = JSON.parse(L.sw('at.rksv.zertifikat', '') || 'null'); } catch { /* none */ }
  const key = L.sw('at.rksv.aeskey', '');
  return {
    aktiv: aktiv(), kassenid: L.sw('at.rksv.kassenid', '') || kassenId(), signatur: L.sw('at.rksv.signatur', 'test'), umgebung: L.sw('at.rksv.umgebung', 'test'),
    aeskey: key,
    zertifikat: z ? z.serial : '', belege: l ? l.NR : 0, letzter: l ? { nr: l.NR, art: l.ART, zeit: l.ZEIT, ausfall: !!l.AUSFALL } : null,
    ausfall: !!(l && l.AUSFALL), fehler: L.sw('at.rksv.fehler', ''), testbetrieb: L.sw('at.rksv.signatur', 'test') !== 'atrust',
  };
}

// integrity check: chain, turnover counter, signatures of the test key
function pruefen() {
  const d = asegurar(); const fehler = []; let prev = null; let summe = 0;
  const pub = L.sw('at.rksv.signatur', 'test') === 'test' ? testSchluessel().pub : null;
  let key = null; try { key = aesKey(); } catch { /* not active */ }
  const rows = d.prepare('SELECT * FROM SW_AT_RKSV ORDER BY NR').all();
  for (const e of rows) {
    const teile = e.QR.split('_');
    // '' R1-AT0 kid nr time n e1 e2 0 b counter serial prev sig (the code starts with _)
    const vorher = prev ? sha(prev.JWS).subarray(0, 8).toString('base64') : sha(e.KASSENID).subarray(0, 8).toString('base64');
    if (teile[12] !== vorher) fehler.push(`Beleg ${e.NR}: Verkettung mit dem vorherigen Beleg gebrochen`);
    if (prev && e.NR !== prev.NR + 1) fehler.push(`Beleg ${e.NR}: Nummerierung lückenhaft`);
    const b = JSON.parse(e.BETRAEGE);
    if (b.map(betrag).join('_') !== teile.slice(5, 10).join('_')) fehler.push(`Beleg ${e.NR}: Beträge stimmen nicht mit dem Code überein`);
    if (e.ART !== 'TRAINING') summe += b.reduce((s, v) => s + v, 0);
    if (key && !['TRAINING', 'STORNO'].includes(e.ART) && zaehlerEntschluesseln(teile[10], e.KASSENID, e.BELEGNR, key) !== summe) fehler.push(`Beleg ${e.NR}: Umsatzzähler stimmt nicht`);
    if (pub && !e.AUSFALL && e.QR.startsWith('_R1-AT0')) {
      const [h, p, s] = e.JWS.split('.');
      if (!crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))) fehler.push(`Beleg ${e.NR}: Signatur ungültig`);
    }
    if (Buffer.from(e.JWS.split('.')[1], 'base64url').toString('utf8') !== teile.slice(0, 13).join('_')) fehler.push(`Beleg ${e.NR}: signierte Daten weichen vom Code ab`);
    prev = e;
  }
  return { ok: !fehler.length, belege: rows.length, fehler };
}

// data collection protocol (DEP 7): receipts grouped by certificate
function dep({ von, bis } = {}) {
  const d = asegurar();
  const rows = d.prepare(`SELECT * FROM SW_AT_RKSV ${von ? 'WHERE substr(ZEIT,1,10) BETWEEN ? AND ?' : ''} ORDER BY NR`).all(...(von ? [von, bis || L.today()] : []));
  let z = null; try { z = JSON.parse(L.sw('at.rksv.zertifikat', '') || 'null'); } catch { /* none */ }
  const gruppen = [];
  for (const e of rows) {
    let g = gruppen[gruppen.length - 1];
    if (!g || g._serial !== e.ZERT) { g = { _serial: e.ZERT, Signaturzertifikat: z && z.serial === e.ZERT ? z.zertifikat : '', Zertifizierungsstellen: z && z.serial === e.ZERT ? z.stellen : [], 'Belege-kompakt': [] }; gruppen.push(g); }
    g['Belege-kompakt'].push(e.JWS);
  }
  const json = JSON.stringify({ 'Belege-Gruppe': gruppen.map(({ _serial, ...g }) => g) }, null, 2);
  return { buffer: Buffer.from(json, 'utf8'), filename: `DEP_${kassenId()}_${L.today()}.json` };
}

function liste({ limit = 1000 } = {}) {
  return asegurar().prepare(`SELECT NR, ART, BELEGNR, BONID, ZEIT, BETRAEGE, AUSFALL, substr(QR, 1, 60) CODE FROM SW_AT_RKSV ORDER BY NR DESC LIMIT ${Math.min(Number(limit) || 1000, 10000)}`).all();
}
// the latest receipt of a bon (after restoring an older backup a bon id can be used again)
function infoBon(bonid) {
  if (L.land() !== 'AT') return null;
  const e = asegurar().prepare('SELECT NR, ART, QR, AUSFALL FROM SW_AT_RKSV WHERE BONID=? ORDER BY NR DESC').get(bonid);
  return e ? { nr: e.NR, art: e.ART, qr: e.QR, ausfall: !!e.AUSFALL, kassenid: e.QR.split('_')[2] } : null;
}

module.exports = { aktiv, aktivieren, status, beleg, nullbeleg, pruefen, dep, liste, infoBon, eimer, zaehlerVerschluesseln, zaehlerEntschluesseln, _setTransporte, AUSFALL };
