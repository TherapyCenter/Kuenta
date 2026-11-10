'use strict';
// Import of KFZ-Faktura data: .kfz backup (ZIP), raw gbak (.bak/.fbk) or an installation folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { parseGbak, BLR } = require('./gbak');
const { readZip, isZip, is7z } = require('./zip');
const dbm = require('../db');

const SENTINEL_DATE_COLS = {
  FAHRZEUGE: ['LETZTEINS', 'NAECHSTEINS', 'ZR', 'KLIMA', 'LETZTESP', 'NAECHSTESP', 'LETZTE57B', 'NAECHSTE57B', 'LETZTEUVV', 'NAECHSTEUVV', 'INDTERMIN1', 'INDTERMIN2', 'INDTERMIN3', 'EINKAUF', 'VERKAUF', 'ABGEMELDET'],
  KUNDEN: ['GEBDATUM'],
  FIBU: ['EXPORTDATUM'],
  REIFENEINLAGERUNG: ['AUSDATUM'],
};
const VORGANG_TABLES = ['ANGEBOTE', 'AUFTRAEGE', 'LIEFERSCHEIN', 'RECHNUNGEN'];
const SENTINELS = new Set(['2000-01-01', '1900-01-01', '1899-12-30']);

function sqlType(col) {
  switch (col.type) {
    case BLR.short: case BLR.long: case BLR.int64: case BLR.bool:
      return col.scale ? 'REAL' : 'INTEGER';
    case BLR.float: case BLR.double: case BLR.d_float: return 'REAL';
    case BLR.blob: return col.subType === 1 ? 'TEXT' : 'BLOB';
    default: return 'TEXT';
  }
}

// Inspect an uploaded file: which databases are inside, is a password needed?
function inspect(buf) {
  if (is7z(buf)) return { kind: '7z', databases: [], error: 'Diese Sicherung wurde im 7-Zip-Format erstellt (neuere KFZ-Faktura-Version). Bitte entpacken Sie die Datei mit 7-Zip und laden Sie die enthaltene Datei "DB1.bak" hoch.' };
  if (isZip(buf)) {
    const z = readZip(buf);
    const dbs = z.entries.filter(e => /(^|\/)db\/DB\d\.bak$/i.test(e.name) || /\.(bak|fbk)$/i.test(e.name)).map(e => e.name);
    const files = z.entries.filter(e => !e.dir).length;
    return { kind: 'zip', databases: dbs, encrypted: z.encrypted, files };
  }
  if (buf[0] === 0 && buf[1] === 2) return { kind: 'gbak', databases: ['(Datenbank)'] };
  return { kind: 'unknown', databases: [], error: 'Unbekanntes Dateiformat. Erwartet wird eine KFZ-Faktura-Sicherung (*.kfz) oder eine Datenbanksicherung (*.bak / *.fbk).' };
}

function pickDatabase(names, wanted) {
  if (wanted) { const w = names.find(n => n === wanted); if (w) return w; }
  return names.find(n => /DB1\.bak$/i.test(n)) || names.find(n => !/DB0\.bak$/i.test(n)) || names[0];
}

// Build a new SQLite database file from a gbak buffer. Returns statistics.
function gbakToSqlite(gbakBuf, targetFile, log = () => {}) {
  if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
  const d = new DatabaseSync(targetFile);
  d.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
  dbm.initSchema(d);
  // remove seeded defaults? initSchema does not seed, tables are empty.
  const stats = {}; const stmts = new Map(); const skipped = []; const relCols = {};
  let current = null;
  d.exec('BEGIN');
  const parser = parseGbak(gbakBuf, (rel, ev) => {
    if (ev !== 'start') return;
    if (/^(RDB|MON|SEC)\$/.test(rel.name) || rel.name === 'TEMPIMPORTKDFZ') { current = null; return; }
    let have = dbm.columnsOf(d, rel.name);
    if (!have.length) {
      d.exec(`CREATE TABLE "${rel.name}" (${rel.columns.map(c => `"${c.name}" ${sqlType(c)}`).join(', ')})`);
      have = dbm.columnsOf(d, rel.name);
    }
    const hs = new Set(have);
    for (const c of rel.columns) if (!hs.has(c.name)) { d.exec(`ALTER TABLE "${rel.name}" ADD COLUMN "${c.name}" ${sqlType(c)}`); hs.add(c.name); }
    const cols = rel.columns.map(c => c.name);
    relCols[rel.name] = new Set(cols.map(c => c.toUpperCase()));
    stmts.set(rel.name, { cols, st: d.prepare(`INSERT OR REPLACE INTO "${rel.name}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`) });
    current = rel.name;
    log(`Tabelle ${rel.name} …`);
  }, (rel, row) => {
    if (current !== rel.name) return;
    const s = stmts.get(rel.name);
    cleanRow(rel.name, row);
    const vals = s.cols.map(c => {
      const v = row[c];
      if (v === undefined) return null;
      if (typeof v === 'string') return v.replace(/\r\n/g, '\n').replace(/\s+$/, '');
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    });
    try { s.st.run(...vals); stats[rel.name] = (stats[rel.name] || 0) + 1; }
    catch (e) { skipped.push(`${rel.name}: ${e.message}`); }
  });
  d.exec('COMMIT');
  // Extra columns that only exist in Kuenta (not in the backup) - their values are kept during import
  const ownCols = {};
  for (const [t, cols] of Object.entries(dbm.EXT_COLUMNS)) {
    const ausSicherung = relCols[t] || new Set();
    ownCols[t] = Object.keys(cols).filter(c => !ausSicherung.has(c));
  }
  dbm.ensureExtensions(d);
  d.prepare('INSERT OR REPLACE INTO SW_EINSTELLUNGEN (SCHLUESSEL, WERT) VALUES (?,?)').run('import.datum', new Date().toISOString());
  d.prepare('INSERT OR REPLACE INTO SW_EINSTELLUNGEN (SCHLUESSEL, WERT) VALUES (?,?)').run('import.quelle', parser.header.file || '');
  d.prepare('INSERT OR REPLACE INTO SW_EINSTELLUNGEN (SCHLUESSEL, WERT) VALUES (?,?)').run('import.sicherungsdatum', parser.header.date || '');
  d.close();
  return { stats, skipped: skipped.slice(0, 50), skippedCount: skipped.length, header: parser.header, ownCols };
}

function cleanRow(table, row) {
  const cols = SENTINEL_DATE_COLS[table];
  if (cols) for (const c of cols) if (SENTINELS.has(row[c])) row[c] = null;
  if (VORGANG_TABLES.includes(table)) {
    if (!(row.FAHRID > 0)) { row.FAHREZ = null; row.FAHRHU = null; }
    for (const c of ['FAHREZ', 'FAHRHU']) if (SENTINELS.has(row[c])) row[c] = null;
  }
  if (table === 'FAHRZEUGE') for (const c of ['EZ', 'HU']) if (SENTINELS.has(row[c])) row[c] = null;
}

// Copy documents / images / logo from a map of relative path -> Buffer loader
function importFiles(list, d) {
  // list: [{rel: 'dokumente/kunden/12/x.pdf', load: () => Buffer}]
  const out = { dokumente: 0, logo: null };
  const ins = d.prepare('INSERT INTO SW_DOKUMENTE (BEZUG, BEZUGID, DATEINAME, PFAD, MIME, GROESSE, DATUM) VALUES (?,?,?,?,?,?,?)');
  const firm = d.prepare('SELECT LOGO FROM FIRMENDATEN LIMIT 1').get();
  const logoName = firm && firm.LOGO ? path.basename(String(firm.LOGO).replace(/\\/g, '/')) : null;
  for (const f of list) {
    const rel = f.rel.replace(/\\/g, '/');
    let m;
    if ((m = rel.match(/(?:^|\/)(dokumente|bilder)\/(kunden|fahrzeuge|artikel)\/([^/]+)\/(.+)$/i))) {
      const bezug = { kunden: 'KUNDE', fahrzeuge: 'FAHRZEUG', artikel: 'ARTIKEL' }[m[2].toLowerCase()];
      const id = parseInt(m[3], 10);
      const name = m[4].split('/').pop();
      const target = path.join('dokumente', bezug.toLowerCase(), String(m[3]), name);
      const abs = path.join(dbm.FILES_DIR, target);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const data = f.load();
      fs.writeFileSync(abs, data);
      ins.run(bezug, Number.isFinite(id) ? id : null, name, target.replace(/\\/g, '/'), mimeOf(name), data.length, new Date().toISOString().slice(0, 10));
      out.dokumente++;
    } else if ((m = rel.match(/(?:^|\/)reports\/logo\/([^/]+)$/i))) {
      const name = m[1];
      const abs = path.join(dbm.FILES_DIR, 'logo', name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.load());
      if (logoName && name.toLowerCase() === logoName.toLowerCase()) out.logo = 'logo/' + name;
    } else if ((m = rel.match(/(?:^|\/)reports\/bilder\/([^/]+)$/i))) {
      const abs = path.join(dbm.FILES_DIR, 'bilder', m[1]);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.load());
    }
  }
  if (out.logo) d.prepare('INSERT OR REPLACE INTO SW_EINSTELLUNGEN (SCHLUESSEL, WERT) VALUES (?,?)').run('firma.logo', out.logo);
  return out;
}

function mimeOf(name) {
  const ext = path.extname(name).toLowerCase();
  return ({ '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp', '.txt': 'text/plain', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })[ext] || 'application/octet-stream';
}

// ---------- Keep Kuenta's own data during import ----------
// Tables from KFZ-Faktura that can be edited in Kuenta. Whatever was created or changed in
// Kuenta since the last import is replaced by the state of the backup.
const KFZ_TABELLEN = { KUNDEN: 'Kunden', FAHRZEUGE: 'Fahrzeuge', ARTIKEL: 'Artikel', LEISTUNG: 'Arbeitswerte', LIEFERANTEN: 'Lieferanten',
  REIFENEINLAGERUNG: 'Reifeneinlagerungen', ANGEBOTE: 'Angebote', AUFTRAEGE: 'Aufträge', LIEFERSCHEIN: 'Lieferscheine',
  RECHNUNGEN: 'Rechnungen/Korrekturen', ZAHLUNGSEINGAENGE: 'Zahlungen', KASSENBUCH: 'Kassenbucheinträge' };
// Kuenta's own tables with a label for display
const SW_NAMEN = { SW_EINSTELLUNGEN: 'Einstellungen (E-Mail, Kasse, Sicherung …)', SW_TERMINE: 'Termine', SW_AUFGABEN: 'Aufgaben', SW_BRIEFE: 'Briefe',
  SW_DOKUMENTE: 'Dokumente', SW_MAILS: 'E-Mail-Protokoll', SW_EINGANG: 'Eingangsrechnungen', SW_ZEIT: 'Zeiterfassung', SW_FZVERKAUF: 'Fahrzeughandel',
  SW_KAUFVERTRAG: 'Kaufverträge', SW_KASSE_BON: 'Kassenbons', SW_KASSE_ABSCHLUSS: 'Kassenabschlüsse', SW_ANZAHLUNGEN: 'Anzahlungen', SW_PROTOKOLL: 'Änderungsprotokoll' };

const toLocalStamp = iso => {
  const d = new Date(iso); if (isNaN(d)) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const hasTable = (d, schema, t) => !!d.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type='table' AND name=?`).get(t);
const colsIn = (d, schema, t) => d.prepare(`PRAGMA ${schema}.table_info("${t}")`).all();

// What does the import replace, what is kept? (for the question before importing)
function importVorschau() {
  const d = dbm.get();
  const last = (d.prepare("SELECT WERT FROM SW_EINSTELLUNGEN WHERE SCHLUESSEL='import.datum'").get() || {}).WERT;
  const seit = last ? toLocalStamp(last) : null;
  const ersetzt = [];
  for (const [t, name] of Object.entries(KFZ_TABELLEN)) {
    if (!hasTable(d, 'main', t)) continue;
    const hasDate = colsIn(d, 'main', t).some(c => c.name.toUpperCase() === 'AENDERUNGSDATUM');
    let n;
    if (!seit) n = d.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
    else if (hasDate) n = d.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE AENDERUNGSDATUM > ?`).get(seit).n;
    else continue;
    if (n) ersetzt.push({ tabelle: t, name, anzahl: n });
  }
  const bleibt = [];
  for (const [t, name] of Object.entries(SW_NAMEN)) {
    if (!hasTable(d, 'main', t)) continue;
    const n = d.prepare(`SELECT COUNT(*) n FROM "${t}"${t === 'SW_EINSTELLUNGEN' ? " WHERE SCHLUESSEL NOT LIKE 'import.%'" : ''}`).get().n;
    if (n) bleibt.push({ tabelle: t, name, anzahl: n });
  }
  return { letzterImport: seit, ersetzt, bleibt };
}

// Copy Kuenta's own data from the previous database into the freshly imported one
function keepKuentaData(tmpFile, ownCols = {}) {
  const live = dbm.DB_FILE;
  if (!fs.existsSync(live)) return null;
  try { dbm.get().exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  const d = new DatabaseSync(tmpFile);
  const out = { tabellen: {}, felder: {} };
  try {
    d.exec(`ATTACH DATABASE '${live.replace(/'/g, "''")}' AS alt`);
    d.exec('BEGIN');
    // 1. Kuenta's own tables (SW_...)
    const swTables = d.prepare("SELECT name, sql FROM alt.sqlite_master WHERE type='table' AND substr(name, 1, 3) = 'SW_'").all();
    for (const { name: t, sql } of swTables) {
      if (!hasTable(d, 'main', t)) d.exec(sql);
      const mainCols = new Set(colsIn(d, 'main', t).map(c => c.name));
      const altCols = colsIn(d, 'alt', t);
      const pk = altCols.find(c => c.pk === 1);
      let cols = altCols.map(c => c.name).filter(c => mainCols.has(c));
      const list = cols.map(c => `"${c}"`).join(',');
      const before = d.prepare(`SELECT COUNT(*) n FROM main."${t}"`).get().n;
      if (t === 'SW_EINSTELLUNGEN') {
        d.exec(`INSERT OR REPLACE INTO main."${t}" (${list}) SELECT ${list} FROM alt."${t}" WHERE SCHLUESSEL NOT LIKE 'import.%'`);
      } else if (t === 'SW_DOKUMENTE') {
        // documents from the backup are already there; only add those added in Kuenta (with a new ID)
        cols = cols.filter(c => !pk || c !== pk.name);
        const l2 = cols.map(c => `"${c}"`).join(',');
        d.exec(`INSERT INTO main."${t}" (${l2}) SELECT ${l2} FROM alt."${t}" WHERE PFAD IS NULL OR PFAD NOT IN (SELECT PFAD FROM main."${t}" WHERE PFAD IS NOT NULL)`);
      } else {
        d.exec(`INSERT OR IGNORE INTO main."${t}" (${list}) SELECT ${list} FROM alt."${t}"`);
      }
      const added = d.prepare(`SELECT COUNT(*) n FROM main."${t}"`).get().n - before;
      if (added > 0) out.tabellen[t] = added;
    }
    // 2. Kuenta's own extra columns in tables from KFZ-Faktura (e.g. e-invoice flag on the customer)
    for (const [t, cols] of Object.entries(ownCols)) {
      if (!cols.length || !hasTable(d, 'alt', t)) continue;
      const altHave = new Set(colsIn(d, 'alt', t).map(c => c.name.toUpperCase()));
      const use = cols.filter(c => altHave.has(c));
      if (!use.length) continue;
      if (t === 'FIRMENDATEN') {
        d.exec(`UPDATE main.FIRMENDATEN SET ${use.map(c => `"${c}"=(SELECT "${c}" FROM alt.FIRMENDATEN ORDER BY ID LIMIT 1)`).join(', ')}`);
        out.felder[t] = use;
        continue;
      }
      const pk = colsIn(d, 'main', t).find(c => c.pk === 1);
      if (!pk || !altHave.has(pk.name.toUpperCase())) continue;
      d.exec(`UPDATE main."${t}" SET ${use.map(c => `"${c}"=a."${c}"`).join(', ')} FROM alt."${t}" a WHERE a."${pk.name}" = main."${t}"."${pk.name}"`);
      out.felder[t] = use;
    }
    d.exec('COMMIT');
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    throw new Error('Kuenta-eigene Daten konnten nicht übernommen werden. Der Import wurde abgebrochen, die bisherigen Daten sind unverändert. (' + e.message + ')');
  } finally {
    try { d.exec('DETACH DATABASE alt'); } catch { /* ignore */ }
    d.close();
  }
  return out;
}

// Replace the live database with the freshly imported one (keeps a safety copy)
function activate(tmpFile) {
  const live = dbm.DB_FILE;
  dbm.close();
  let safety = null;
  if (fs.existsSync(live)) {
    const dir = path.join(dbm.DATA_DIR, 'sicherheitskopien');
    fs.mkdirSync(dir, { recursive: true });
    safety = path.join(dir, `vor-import-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    fs.copyFileSync(live, safety);
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(live + ext); } catch { /* ignore */ } }
  }
  fs.renameSync(tmpFile, live);
  dbm.reopen();
  return safety;
}

function importBuffer(buf, opts = {}) {
  dbm.ensureDirs();
  const info = inspect(buf);
  if (info.error) throw new Error(info.error);
  const tmp = path.join(dbm.DATA_DIR, 'import-tmp.db');
  let gbak; let fileList = [];
  if (info.kind === 'zip') {
    const z = readZip(buf);
    const name = pickDatabase(info.databases, opts.database);
    if (!name) throw new Error('In der Sicherung wurde keine Datenbank (DB1.bak) gefunden.');
    const entry = z.entries.find(e => e.name === name);
    gbak = z.read(entry, opts.password);
    if (opts.files !== false) {
      fileList = z.entries.filter(e => !e.dir && !/\.bak$/i.test(e.name)).map(e => ({ rel: e.name, load: () => z.read(e, opts.password) }));
    }
  } else gbak = buf;
  const res = gbakToSqlite(gbak, tmp, opts.log);
  if (fileList.length) {
    const d = new DatabaseSync(tmp);
    try { res.files = importFiles(fileList, d); } finally { d.close(); }
  }
  if (opts.behalten !== false) res.behalten = keepKuentaData(tmp, res.ownCols);
  delete res.ownCols;
  res.safetyCopy = activate(tmp);
  return res;
}

// Import directly from a KFZ-Faktura installation folder (Windows, Firebird embedded present).
function importFolder(dir, opts = {}) {
  dbm.ensureDirs();
  const dbDir = path.join(dir, 'db');
  const want = opts.database || 'DB1.FDB';
  const fdb = [path.join(dbDir, want), path.join(dir, 'DB', want)].find(p => fs.existsSync(p));
  const bak = path.join(dbDir, want.replace(/\.FDB$/i, '.bak'));
  let gbakBuf;
  if (fdb) {
    gbakBuf = backupWithEmbeddedGbak(dir, fdb, opts.log);
  } else if (fs.existsSync(bak)) {
    gbakBuf = fs.readFileSync(bak);
  } else throw new Error(`Keine Datenbank ${want} im Ordner ${dbDir} gefunden.`);
  const tmp = path.join(dbm.DATA_DIR, 'import-tmp.db');
  const res = gbakToSqlite(gbakBuf, tmp, opts.log);
  if (opts.files !== false) {
    const list = [];
    for (const sub of ['dokumente', 'bilder', path.join('reports', 'logo'), path.join('reports', 'bilder')]) {
      const base = path.join(dir, sub);
      if (!fs.existsSync(base)) continue;
      walk(base, abs => list.push({ rel: path.relative(dir, abs), load: () => fs.readFileSync(abs) }));
    }
    const d = new DatabaseSync(tmp);
    try { res.files = importFiles(list, d); } finally { d.close(); }
  }
  if (opts.behalten !== false) res.behalten = keepKuentaData(tmp, res.ownCols);
  delete res.ownCols;
  res.safetyCopy = activate(tmp);
  return res;
}

function walk(dir, cb) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, cb); else cb(p);
  }
}

function backupWithEmbeddedGbak(dir, fdb, log = () => {}) {
  if (process.platform !== 'win32') throw new Error('Der direkte Datenbankzugriff ist nur unter Windows möglich. Bitte erstellen Sie in KFZ-Faktura eine Datensicherung (*.kfz) und importieren Sie diese.');
  const gbakExe = path.join(dir, 'gbak.exe');
  if (!fs.existsSync(gbakExe)) throw new Error('gbak.exe wurde im KFZ-Faktura-Ordner nicht gefunden.');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-fb-'));
  try {
    // copy Firebird runtime; embedded engine must be named fbclient.dll
    for (const f of fs.readdirSync(dir)) {
      if (/\.(dll|msg|conf|manifest)$/i.test(f) || /^gbak\.exe$/i.test(f)) fs.copyFileSync(path.join(dir, f), path.join(work, f));
    }
    for (const sub of ['intl', 'plugins', 'udf']) if (fs.existsSync(path.join(dir, sub))) fs.cpSync(path.join(dir, sub), path.join(work, sub), { recursive: true });
    if (fs.existsSync(path.join(work, 'fbembed.dll'))) fs.copyFileSync(path.join(work, 'fbembed.dll'), path.join(work, 'fbclient.dll'));
    const dbCopy = path.join(work, 'quelle.fdb');
    fs.copyFileSync(fdb, dbCopy);
    const out = path.join(work, 'export.fbk');
    log('Erzeuge Datenbanksicherung mit gbak …');
    try {
      execFileSync(path.join(work, 'gbak.exe'), ['-b', '-g', '-user', 'SYSDBA', '-password', 'masterkey', dbCopy, out], { cwd: work, stdio: 'pipe', timeout: 600000, windowsHide: true });
    } catch (e) {
      const msg = (e.stderr || e.stdout || '').toString().trim();
      throw new Error('Firebird-Sicherung fehlgeschlagen' + (msg ? ': ' + msg : '') + '. Ist KFZ-Faktura geschlossen?');
    }
    return fs.readFileSync(out);
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { inspect, importBuffer, importFolder, gbakToSqlite, importVorschau, keepKuentaData };
