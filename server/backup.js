'use strict';
// Kuenta backup (*.kuenta): ZIP with database + files, optionally AES-256-GCM encrypted.
// Backups of the predecessor versions "KFZ-Faktotum" (*.kft) and "Schraubwerk" (*.swb) can still be read.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const dbm = require('./db');
const L = require('./lib');
const { writeZip, readZip, isZip } = require('./import/zip');

const MAGIC = Buffer.from('SWBENC01');
const VERSION = 1;
// names of the ZIP entries: current and predecessor versions
const META_NAMES = ['kuenta.json', 'faktotum.json', 'schraubwerk.json'];
const DB_NAMES = ['db/kuenta.db', 'db/faktotum.db', 'db/schraubwerk.db'];
const findEntry = (z, names) => names.map(n => z.entries.find(e => e.name === n)).find(Boolean);

function walk(dir, base, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push({ abs: p, rel: path.relative(base, p).replace(/\\/g, '/') });
  }
  return out;
}

function snapshotDb() {
  const tmp = path.join(dbm.DATA_DIR, `snapshot-${process.pid}-${Date.now()}.db`);
  dbm.get().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return buf;
}

function encrypt(buf, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}
function decrypt(buf, password) {
  if (!password) { const e = new Error('Die Sicherung ist verschlüsselt. Bitte Passwort eingeben.'); e.code = 'PASSWORD'; throw e; }
  const salt = buf.subarray(8, 24), iv = buf.subarray(24, 36), tag = buf.subarray(36, 52), data = buf.subarray(52);
  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(data), d.final()]); }
  catch { const e = new Error('Falsches Passwort für die Sicherung.'); e.code = 'PASSWORD'; throw e; }
}

function createBackup({ password, ohneDateien } = {}) {
  const files = [];
  const meta = { app: 'Kuenta', version: VERSION, erstellt: new Date().toISOString(), firma: L.firma().FIRMENNAME || '' };
  files.push({ name: 'kuenta.json', data: Buffer.from(JSON.stringify(meta, null, 2)) });
  files.push({ name: 'db/kuenta.db', data: snapshotDb() });
  if (!ohneDateien) for (const f of walk(dbm.FILES_DIR, dbm.FILES_DIR, [])) files.push({ name: 'dateien/' + f.rel, data: fs.readFileSync(f.abs) });
  let out = writeZip(files);
  if (password) out = encrypt(out, password);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '_');
  return { buffer: out, filename: `Kuenta-Sicherung_${stamp}.kuenta` };
}

function inspectBackup(buf) {
  if (buf.subarray(0, 8).equals(MAGIC)) return { encrypted: true };
  if (isZip(buf)) {
    const z = readZip(buf);
    const m = findEntry(z, META_NAMES);
    if (!m) return { error: 'Keine Kuenta-Sicherung' };
    return { encrypted: false, meta: JSON.parse(z.read(m).toString('utf8')) };
  }
  return { error: 'Unbekanntes Dateiformat' };
}

function restoreBackup(buf, { password } = {}) {
  if (buf.subarray(0, 8).equals(MAGIC)) buf = decrypt(buf, password);
  if (!isZip(buf)) throw new Error('Keine gültige Kuenta-Sicherung (*.kuenta).');
  const z = readZip(buf);
  const metaE = findEntry(z, META_NAMES);
  const dbE = findEntry(z, DB_NAMES);
  if (!metaE || !dbE) throw new Error('Die Sicherung ist unvollständig (Datenbank fehlt).');
  const meta = JSON.parse(z.read(metaE).toString('utf8'));
  const tmp = path.join(dbm.DATA_DIR, 'restore-tmp.db');
  fs.writeFileSync(tmp, z.read(dbE));
  // check integrity
  const t = new DatabaseSync(tmp);
  const ok = t.prepare('PRAGMA integrity_check').get();
  t.close();
  if (!ok || Object.values(ok)[0] !== 'ok') { fs.unlinkSync(tmp); throw new Error('Die Datenbank in der Sicherung ist beschädigt.'); }
  // safety copy of the current state
  const safety = createBackup({});
  const sdir = path.join(dbm.DATA_DIR, 'sicherheitskopien'); fs.mkdirSync(sdir, { recursive: true });
  const safetyFile = path.join(sdir, 'vor-wiederherstellung-' + safety.filename);
  fs.writeFileSync(safetyFile, safety.buffer);
  dbm.close();
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbm.DB_FILE + ext); } catch { /* ignore */ } }
  fs.renameSync(tmp, dbm.DB_FILE);
  // replace files
  const fileEntries = z.entries.filter(e => !e.dir && e.name.startsWith('dateien/'));
  if (fileEntries.length) {
    fs.rmSync(dbm.FILES_DIR, { recursive: true, force: true });
    for (const e of fileEntries) {
      const rel = e.name.slice('dateien/'.length);
      if (rel.split('/').includes('..')) continue;
      const abs = path.join(dbm.FILES_DIR, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, z.read(e));
    }
  }
  dbm.reopen();
  return { meta, safetyFile };
}

// Automatic backup (daily, keeps the last N)
function autoBackup() {
  try {
    if (L.sw('sicherung.auto', '1') !== '1') return null;
    const dir = L.sw('sicherung.pfad') || path.join(dbm.DATA_DIR, 'sicherungen');
    fs.mkdirSync(dir, { recursive: true });
    const today = L.today().replace(/-/g, '');
    if (fs.readdirSync(dir).some(f => f.includes(`_${today}_`) && f.endsWith('.kuenta'))) return null;
    const b = createBackup({});
    const file = path.join(dir, b.filename);
    fs.writeFileSync(file, b.buffer);
    const keep = Number(L.sw('sicherung.anzahl', '14')) || 14;
    const all = fs.readdirSync(dir).filter(f => /^Kuenta-Sicherung_.*\.kuenta$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(path.join(dir, f));
    L.setSw('sicherung.letzte', L.now());
    return file;
  } catch (e) { console.error(require('./i18n').C('Automatische Sicherung fehlgeschlagen:'), e.message); return null; }
}

// GoBD / GDPdU data carrier export: CSV per table + index.xml
function gobdExport(von, bis) {
  const d = dbm.get();
  const tables = [
    { t: 'RECHNUNGEN', l: 'Ausgangsrechnungen', w: 'DATUM BETWEEN ? AND ?' },
    { t: 'RECHNUNGEN_POS', l: 'Rechnungspositionen', w: 'RECHNUNGID IN (SELECT RECHNUNGID FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ?)' },
    { t: 'ZAHLUNGSEINGAENGE', l: 'Zahlungseingaenge', w: 'DATUM BETWEEN ? AND ?' },
    { t: 'KASSENBUCH', l: 'Kassenbuch', w: 'DATUM BETWEEN ? AND ?' },
    { t: 'FIBU', l: 'Buchungssaetze', w: 'BELEGDATUM BETWEEN ? AND ?' },
    { t: 'MAHNUNG', l: 'Mahnungen', w: 'MAHNDATUM BETWEEN ? AND ?' },
    { t: 'KUNDEN', l: 'Kunden', w: null },
    { t: 'ARTIKEL', l: 'Artikel', w: null },
  ];
  const files = []; const xmlT = [];
  for (const tb of tables) {
    const rows = tb.w ? d.prepare(`SELECT * FROM ${tb.t} WHERE ${tb.w}`).all(von, bis) : d.prepare(`SELECT * FROM ${tb.t}`).all();
    const cols = dbm.columnsOf(d, tb.t);
    const esc = v => v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : '"' + String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
    const csv = rows.map(r => cols.map(c => esc(r[c])).join(';')).join('\r\n');
    files.push({ name: `${tb.t}.csv`, data: Buffer.from(csv, 'latin1') });
    xmlT.push(`  <Table><URL>${tb.t}.csv</URL><Name>${tb.l}</Name><DecimalSymbol>,</DecimalSymbol><DigitGroupingSymbol>.</DigitGroupingSymbol><VariableLength><ColumnDelimiter>;</ColumnDelimiter><TextEncapsulator>"</TextEncapsulator>\n${cols.map(c => `    <VariableColumn><Name>${c}</Name><AlphaNumeric/></VariableColumn>`).join('\n')}\n  </VariableLength></Table>`);
  }
  const f = L.firma();
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<!DOCTYPE DataSet SYSTEM "gdpdu-01-08-2002.dtd">\n<DataSet><Version>1.0</Version><DataSupplier><Name>${(f.FIRMENNAME || '').replace(/&/g, '&amp;')}</Name><Location>${(f.ORT || '').replace(/&/g, '&amp;')}</Location><Comment>Kuenta GoBD-Export ${von} bis ${bis}</Comment></DataSupplier>\n<Media><Name>Datenexport</Name>\n${xmlT.join('\n')}\n</Media></DataSet>\n`;
  files.push({ name: 'index.xml', data: Buffer.from(xml, 'latin1') });
  return { buffer: writeZip(files), filename: `GoBD-Export_${von}_${bis}.zip` };
}

module.exports = { createBackup, restoreBackup, inspectBackup, autoBackup, gobdExport };
