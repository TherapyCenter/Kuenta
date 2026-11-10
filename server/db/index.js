'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { AsyncLocalStorage } = require('async_hooks');

// Tenants: tenant 1 lives directly in the data folder, further ones under mandanten/<id>
// Data folder: KUENTA_DATA, otherwise in the user profile (never in the program folder, so
// installations under "Program Files" work and no data ends up in the source code).
function defaultDataDir() {
  const os = require('os');
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Kuenta');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Kuenta');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'kuenta');
}
const ROOT = path.resolve(process.env.KUENTA_DATA || defaultDataDir());
const DB_NAME = 'kuenta.db';
const als = new AsyncLocalStorage();
const MANDANTEN_FILE = path.join(ROOT, 'mandanten.json');
function listMandanten() {
  try { const m = JSON.parse(fs.readFileSync(MANDANTEN_FILE, 'utf8')); if (Array.isArray(m) && m.length) return m; } catch { /* default */ }
  return [{ id: 1, name: 'Mandant 1' }];
}
function saveMandanten(list) { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(MANDANTEN_FILE, JSON.stringify(list, null, 2)); }
function dirOf(id) { return Number(id) === 1 ? ROOT : path.join(ROOT, 'mandanten', String(Number(id))); }
function current() {
  const st = als.getStore();
  const id = st && st.mandant ? Number(st.mandant) : 1;
  return listMandanten().some(m => m.id === id) ? id : 1;
}
function runAs(mandant, fn) { return als.run({ mandant }, fn); }

// Extension columns/tables of Kuenta (on top of the KFZ-Faktura base schema)
const EXT_COLUMNS = {
  KUNDEN: { LEITWEGID: 'TEXT', ERECHNUNG: 'INTEGER DEFAULT 0', EMAILRECHNUNG: 'TEXT', AKTIV: 'INTEGER DEFAULT 1' },
  FIRMENDATEN: { LAND: "TEXT DEFAULT 'DE'", HANDELSREGISTER: 'TEXT', GESCHAEFTSFUEHRER: 'TEXT', MOBIL: 'TEXT', FUSSZEILE: 'TEXT' },
  EINHEITEN: { UNECE: 'TEXT' },
  ZAHLUNGSBEDINUNGEN: { ERECHCODE: "TEXT DEFAULT '58'" },
  RECHNUNGEN: { STORNOVONID: 'INTEGER', BESTELLNR: 'TEXT', ERECHNUNGERSTELLT: 'TEXT' },
  FAHRZEUGE: { AKTIV: 'INTEGER DEFAULT 1' },
  ARTIKEL: { UNECE: 'TEXT' },
  BENUTZER: { PERSONALNR: 'TEXT', ZEITERFASSUNG: 'INTEGER DEFAULT 0', KASSENBEDIENER: 'INTEGER DEFAULT 0', TERMINPLANER: 'INTEGER DEFAULT 0',
    SOLLMO: 'REAL DEFAULT 8', SOLLDI: 'REAL DEFAULT 8', SOLLMI: 'REAL DEFAULT 8', SOLLDO: 'REAL DEFAULT 8', SOLLFR: 'REAL DEFAULT 8', SOLLSA: 'REAL DEFAULT 0', SOLLSO: 'REAL DEFAULT 0',
    URLAUBSANSPRUCH: 'REAL DEFAULT 30', EINTRITT: 'TEXT' },
  LIEFERANTEN: { USTID: 'TEXT', IBAN: 'TEXT', BIC: 'TEXT', KREDITORNR: 'INTEGER', GEGENKONTO: 'TEXT' },
  ANGEBOTE: { STEUERART: 'TEXT' }, AUFTRAEGE: { STEUERART: 'TEXT' }, LIEFERSCHEIN: { STEUERART: 'TEXT' },
};
EXT_COLUMNS.KUNDEN.NETTORECHNUNG = 'INTEGER DEFAULT 0';
EXT_COLUMNS.KUNDEN.KEINEERINNERUNG = 'INTEGER DEFAULT 0';
EXT_COLUMNS.FIBU = { EINGANGID: 'INTEGER' };
EXT_COLUMNS.KUNDEN.EXPORTART = 'TEXT';
EXT_COLUMNS.RECHNUNGEN.STEUERART = 'TEXT';
EXT_COLUMNS.RECHNUNGEN.MAILVERSAND = 'TEXT';
// Spanish tax system: series number and invoice type as reported to VERI*FACTU, reason of a corrective
// invoice, recargo de equivalencia
Object.assign(EXT_COLUMNS.RECHNUNGEN, { ESNUMSERIE: 'TEXT', ESTIPO: 'TEXT', ESRECT: 'TEXT', ESRECARGO: 'INTEGER DEFAULT 0', GRECARGO: 'REAL DEFAULT 0' });
for (const t of ['ANGEBOTE', 'AUFTRAEGE', 'LIEFERSCHEIN']) Object.assign(EXT_COLUMNS[t], { ESRECARGO: 'INTEGER DEFAULT 0', GRECARGO: 'REAL DEFAULT 0' });
EXT_COLUMNS.KUNDEN.RECARGO = 'INTEGER DEFAULT 0';
// US: tax exemption of the customer; odometer out, replaced parts, estimate authorizations (JSON); condition of parts
Object.assign(EXT_COLUMNS.KUNDEN, { TAXEXEMPT: 'INTEGER DEFAULT 0', EXEMPTCERT: 'TEXT', EXEMPTREASON: 'TEXT' });
EXT_COLUMNS.KUNDEN.SIREN = 'TEXT'; // France: SIREN/SIRET of business customers
// Italy: codice fiscale, recipient code of the SdI, PEC address, split payment (public bodies)
Object.assign(EXT_COLUMNS.KUNDEN, { IT_CF: 'TEXT', IT_SDI: 'TEXT', IT_PEC: 'TEXT', IT_SPLIT: 'INTEGER DEFAULT 0' });
// Netherlands: KvK number and OIN (government) of the customer, electronic address in the Peppol network
Object.assign(EXT_COLUMNS.KUNDEN, { NL_KVK: 'TEXT', NL_OIN: 'TEXT' });
for (const t of ['ANGEBOTE', 'AUFTRAEGE', 'LIEFERSCHEIN', 'RECHNUNGEN']) Object.assign(EXT_COLUMNS[t], { FAHRKMOUT: 'INTEGER', USALTTEILE: 'TEXT', USFREIGABE: 'TEXT' });
for (const t of ['ANGEBOTE_POS', 'AUFTRAEGE_POS', 'LIEFERSCHEIN_POS', 'RECHNUNGEN_POS']) EXT_COLUMNS[t] = { ...(EXT_COLUMNS[t] || {}), TEILEZUSTAND: 'TEXT' };
const EXT_TABLES = `
CREATE TABLE IF NOT EXISTS SW_EINSTELLUNGEN (SCHLUESSEL TEXT PRIMARY KEY, WERT TEXT);
CREATE TABLE IF NOT EXISTS SW_BTCPAY (ID INTEGER PRIMARY KEY, ART TEXT, RECHNUNGID INTEGER, BONID INTEGER, BTCPAYID TEXT, LINK TEXT, BETRAG REAL, WAEHRUNG TEXT,
  STATUS TEXT, ANGELEGT TEXT, ABLAUF TEXT, BEZAHLT TEXT, ZAHLID INTEGER, METHODE TEXT, GEPRUEFT TEXT, FEHLER TEXT);
CREATE INDEX IF NOT EXISTS IX_BTCPAY_RE ON SW_BTCPAY (RECHNUNGID);
CREATE TABLE IF NOT EXISTS SW_VERIFACTU (ID INTEGER PRIMARY KEY, TIPO TEXT, RECHNUNGID INTEGER, NIF TEXT, NUMSERIE TEXT, FECHA TEXT, TIPOFACTURA TEXT, CUOTA TEXT, IMPORTE TEXT,
  HUELLA TEXT, HUELLAANT TEXT, GENERADO TEXT, XML TEXT, ENTORNO TEXT, ESTADO TEXT, CSV TEXT, CODIGO TEXT, MENSAJE TEXT, ENVIADO TEXT, INTENTOS INTEGER DEFAULT 0, SUBSANA INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS IX_VERIFACTU_RE ON SW_VERIFACTU (RECHNUNGID);
CREATE TABLE IF NOT EXISTS SW_FR_JOURNAL (ID INTEGER PRIMARY KEY, TYP TEXT, NR INTEGER, REF TEXT, ZEIT TEXT, KASSE TEXT, DATEN TEXT, TOTAL REAL, GT REAL, GTABS REAL, VORHER TEXT, SIGNATUR TEXT);
CREATE INDEX IF NOT EXISTS IX_FR_JOURNAL ON SW_FR_JOURNAL (TYP, NR);
CREATE TABLE IF NOT EXISTS SW_AT_RKSV (ID INTEGER PRIMARY KEY, NR INTEGER, ART TEXT, BELEGNR TEXT, BONID INTEGER, ZEIT TEXT, KASSENID TEXT, BETRAEGE TEXT, UMSATZ INTEGER, JWS TEXT, QR TEXT, AUSFALL INTEGER DEFAULT 0, ZERT TEXT);
CREATE INDEX IF NOT EXISTS IX_AT_RKSV_BON ON SW_AT_RKSV (BONID);
CREATE TABLE IF NOT EXISTS SW_FR_CHORUS (ID INTEGER PRIMARY KEY, RECHNUNGID INTEGER, FLUX TEXT, GESENDET TEXT, STATUS TEXT, ANTWORT TEXT, BENUTZER TEXT);
CREATE TABLE IF NOT EXISTS SW_GB_RETURNS (ID INTEGER PRIMARY KEY, PERIODKEY TEXT, VON TEXT, BIS TEXT, BOXES TEXT, ENTORNO TEXT, GESENDET TEXT, ANTWORT TEXT, BENUTZER TEXT);
CREATE TABLE IF NOT EXISTS SW_KURSE (WAEHRUNG TEXT, DATUM TEXT, EURPRO REAL, PRIMARY KEY (WAEHRUNG, DATUM));
CREATE TABLE IF NOT EXISTS SW_ERINNERUNGEN (ID INTEGER PRIMARY KEY, ZEIT TEXT, FAHRID INTEGER, KUNID INTEGER, ART TEXT, TERMIN TEXT, KANAL TEXT, AN TEXT, STATUS TEXT, FEHLER TEXT, BENUTZER TEXT);
CREATE INDEX IF NOT EXISTS IX_ERINNERUNG_FZ ON SW_ERINNERUNGEN (FAHRID, ART, TERMIN);
CREATE TABLE IF NOT EXISTS SW_TERMINE (ID INTEGER PRIMARY KEY, BEGINN TEXT, ENDE TEXT, GANZTAGS INTEGER DEFAULT 0,
  TITEL TEXT, NOTIZ TEXT, KUNID INTEGER, FAHRID INTEGER, RESSOURCE TEXT, FARBE TEXT, ERLEDIGT INTEGER DEFAULT 0, AENDERUNGSDATUM TEXT);
CREATE TABLE IF NOT EXISTS SW_AUFGABEN (ID INTEGER PRIMARY KEY, TITEL TEXT, NOTIZ TEXT, FAELLIG TEXT, PRIORITAET INTEGER DEFAULT 1,
  ERLEDIGT INTEGER DEFAULT 0, BENID INTEGER, KUNID INTEGER, AENDERUNGSDATUM TEXT);
CREATE TABLE IF NOT EXISTS SW_BRIEFE (ID INTEGER PRIMARY KEY, KUNID INTEGER, DATUM TEXT, BETREFF TEXT, TEXT TEXT, AENDERUNGSDATUM TEXT);
CREATE TABLE IF NOT EXISTS SW_DOKUMENTE (ID INTEGER PRIMARY KEY, BEZUG TEXT, BEZUGID INTEGER, DATEINAME TEXT, PFAD TEXT,
  MIME TEXT, GROESSE INTEGER, BESCHREIBUNG TEXT, DATUM TEXT);
CREATE TABLE IF NOT EXISTS SW_PROTOKOLL (ID INTEGER PRIMARY KEY, ZEIT TEXT, BENUTZER TEXT, TABELLE TEXT, DATENSATZ TEXT, AKTION TEXT, DATEN TEXT);
CREATE TABLE IF NOT EXISTS SW_ANZAHLUNGEN (ID INTEGER PRIMARY KEY, AUFTRAGID INTEGER, ART INTEGER DEFAULT 1, DATUM TEXT, BEZEICHNUNG TEXT,
  NETTO REAL, MWST INTEGER DEFAULT 61, RECHNUNGID INTEGER);
CREATE TABLE IF NOT EXISTS SW_MAILS (ID INTEGER PRIMARY KEY, ZEIT TEXT, AN TEXT, BETREFF TEXT, BEZUG TEXT, BEZUGID INTEGER, ANHAENGE TEXT, STATUS TEXT, FEHLER TEXT, BENUTZER TEXT);
CREATE TABLE IF NOT EXISTS SW_EINGANG (ID INTEGER PRIMARY KEY, LIEFID INTEGER, LIEFNAME TEXT, RECHNUNGSNR TEXT, DATUM TEXT, FAELLIG TEXT, LEISTUNGSDATUM TEXT,
  NETTO REAL DEFAULT 0, MWST REAL DEFAULT 0, BRUTTO REAL DEFAULT 0, STEUERSATZ REAL DEFAULT 19, SKONTO REAL DEFAULT 0, SKONTOBIS TEXT, GEGENKONTO TEXT, BEMERKUNG TEXT,
  LAGERGEBUCHT INTEGER DEFAULT 0, ERECHNUNG TEXT, ERECHNUNGFORMAT TEXT, ZAHLSTATUS INTEGER DEFAULT 0, AENDERUNGSDATUM TEXT, EXPORTIERT INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS SW_EINGANG_POS (ID INTEGER PRIMARY KEY, EINGANGID INTEGER, POS INTEGER, ARTID INTEGER, ARTNUMMER TEXT, BEZEICHNUNG TEXT, MENGE REAL DEFAULT 1, EINHEIT TEXT, EKNETTO REAL DEFAULT 0, STEUERSATZ REAL DEFAULT 19, SUMME REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS SW_EINGANG_ZAHLUNG (ID INTEGER PRIMARY KEY, EINGANGID INTEGER, DATUM TEXT, BETRAG REAL, ART TEXT, BEMERKUNG TEXT, KASSENID INTEGER);
CREATE INDEX IF NOT EXISTS IX_EP ON SW_EINGANG_POS (EINGANGID);
CREATE TABLE IF NOT EXISTS SW_ZEIT (ID INTEGER PRIMARY KEY, BENID INTEGER, ART TEXT, DATUM TEXT, BEGINN TEXT, ENDE TEXT, MINUTEN INTEGER, AUFTRAGID INTEGER, POSID INTEGER, NOTIZ TEXT, QUELLE TEXT, AENDERUNGSDATUM TEXT);
CREATE INDEX IF NOT EXISTS IX_ZEIT ON SW_ZEIT (BENID, DATUM);
CREATE TABLE IF NOT EXISTS SW_ZEIT_MONAT (BENID INTEGER, MONAT TEXT, SOLL REAL, IST REAL, SALDO REAL, VORTRAG REAL, URLAUB REAL, KRANK REAL, URLAUBREST REAL, ABGESCHLOSSEN TEXT, PRIMARY KEY (BENID, MONAT));
CREATE TABLE IF NOT EXISTS SW_ZEIT_KORREKTUR (ID INTEGER PRIMARY KEY, BENID INTEGER, MONAT TEXT, STUNDEN REAL DEFAULT 0, URLAUBSTAGE REAL DEFAULT 0, NOTIZ TEXT);
CREATE TABLE IF NOT EXISTS SW_FZVERKAUF (ID INTEGER PRIMARY KEY, FAHRID INTEGER, RECHNUNGID INTEGER, DATUM TEXT, KUNID INTEGER, VK REAL, EK REAL, AUFWAND REAL, DIFFBESTEUERT INTEGER, FRZTYP_VORHER INTEGER, EINKAUF TEXT);
CREATE TABLE IF NOT EXISTS SW_KAUFVERTRAG (ID INTEGER PRIMARY KEY, NUMMER INTEGER, ART TEXT DEFAULT 'GW', DATUM TEXT, KUNID INTEGER, KAEUFER TEXT, FAHRID INTEGER, FAHRZEUG TEXT,
  KMSTAND TEXT, HU TEXT, KAUFPREIS REAL DEFAULT 0, DIFFBESTEUERT INTEGER DEFAULT 1, ANZAHLUNG REAL DEFAULT 0, INZAHLUNGNAHME TEXT, INZAHLUNGNAHMEBETRAG REAL DEFAULT 0,
  LIEFERTERMIN TEXT, ZAHLUNGSWEISE TEXT, GEWAEHRLEISTUNG INTEGER DEFAULT 0, UNTERNEHMER INTEGER DEFAULT 0, MAENGEL TEXT, UNFALLSCHAEDEN TEXT, UNFALLFREI INTEGER DEFAULT 0,
  AKTUALISIERUNG_AUS INTEGER DEFAULT 0, VORVERTRAGLICH TEXT, ZUSATZ TEXT, RECHNUNGID INTEGER, AENDERUNGSDATUM TEXT);
CREATE TABLE IF NOT EXISTS SW_KASSE_BON (ID INTEGER PRIMARY KEY, BONNR INTEGER, ZEIT TEXT, TYP TEXT, BENID INTEGER, BEDIENER TEXT, KUNID INTEGER, KUNDE TEXT, RECHNUNGID INTEGER,
  BRUTTO REAL, NETTO REAL, ZAHLART TEXT, GEGEBEN REAL, RUECKGELD REAL, STORNOID INTEGER, STORNIERT INTEGER DEFAULT 0, VERWENDUNG TEXT, GEGENKONTO TEXT, ABSCHLUSSID INTEGER,
  TSE_TXNR INTEGER, TSE_TXID TEXT, TSE_START TEXT, TSE_ENDE TEXT, TSE_SIGNATUR TEXT, TSE_ZAEHLER INTEGER, TSE_SERIAL TEXT, TSE_ALGO TEXT, TSE_ZEITFORMAT TEXT, TSE_PUBKEY TEXT,
  TSE_QR TEXT, TSE_VORGANGSART TEXT, TSE_DATEN TEXT, TSE_FEHLER TEXT);
CREATE TABLE IF NOT EXISTS SW_KASSE_POS (ID INTEGER PRIMARY KEY, BONID INTEGER, POS INTEGER, POSART TEXT, ARTID INTEGER, ARTNUMMER TEXT, BEZEICHNUNG TEXT, MENGE REAL, EINZEL REAL, RABATT REAL DEFAULT 0, MWSTSATZ REAL, MWSTCODE INTEGER, BRUTTO REAL, NETTO REAL, GVTYP TEXT);
CREATE INDEX IF NOT EXISTS IX_KPOS ON SW_KASSE_POS (BONID);
CREATE TABLE IF NOT EXISTS SW_KASSE_ABSCHLUSS (ID INTEGER PRIMARY KEY, ZNR INTEGER, ZEIT TEXT, VON_BONID INTEGER, BIS_BONID INTEGER, ANFANG REAL, BAR_EIN REAL, BAR_AUS REAL, SOLL REAL, IST REAL, DIFFERENZ REAL,
  UMSATZ_BRUTTO REAL, UMSATZ_NETTO REAL, UST TEXT, ZAHLARTEN TEXT, ZAEHLPROTOKOLL TEXT, BENID INTEGER, BEDIENER TEXT);
CREATE INDEX IF NOT EXISTS IX_RE_KUNID ON RECHNUNGEN (KUNID);
CREATE INDEX IF NOT EXISTS IX_RE_NR ON RECHNUNGEN (RECHNUNGNUMMER);
CREATE INDEX IF NOT EXISTS IX_RE_DATUM ON RECHNUNGEN (DATUM);
CREATE INDEX IF NOT EXISTS IX_REPOS_RE ON RECHNUNGEN_POS (RECHNUNGID);
CREATE INDEX IF NOT EXISTS IX_ANGPOS ON ANGEBOTE_POS (ANGEBOTID);
CREATE INDEX IF NOT EXISTS IX_AUFPOS ON AUFTRAEGE_POS (AUFTRAGID);
CREATE INDEX IF NOT EXISTS IX_LSPOS ON LIEFERSCHEIN_POS (LIEFERSCHEINID);
CREATE INDEX IF NOT EXISTS IX_ZE_RE ON ZAHLUNGSEINGAENGE (RECHNUNGID);
CREATE INDEX IF NOT EXISTS IX_FIBU_RE ON FIBU (RECHID);
CREATE INDEX IF NOT EXISTS IX_KB_DATUM ON KASSENBUCH (DATUM);
CREATE INDEX IF NOT EXISTS IX_OP_RE ON OP (RECHNUNGID);
CREATE INDEX IF NOT EXISTS IX_FZ_KENNZ ON FAHRZEUGE (KENNZEICHEN);
CREATE INDEX IF NOT EXISTS IX_FZHIS ON FAHRZEUGE_HISTORIE (FAHRID);
CREATE INDEX IF NOT EXISTS IX_RL_FZ ON REIFENEINLAGERUNG (KUNID);
`;

const conns = new Map();

function ensureDirs() {
  fs.mkdirSync(dirOf(current()), { recursive: true });
  fs.mkdirSync(path.join(dirOf(current()), 'dateien'), { recursive: true });
}

function open(file = path.join(dirOf(current()), DB_NAME)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(file), 'dateien'), { recursive: true });
  const fresh = !fs.existsSync(file);
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;');
  // case-insensitive search including umlauts
  d.function('ulower', { deterministic: true }, v => v == null ? null : String(v).toLowerCase());
  initSchema(d);
  if (fresh) seed(d);
  return d;
}

function initSchema(d) {
  d.exec(fs.readFileSync(path.join(__dirname, 'base-schema.sql'), 'utf8'));
  ensureExtensions(d);
}

function columnsOf(d, table) {
  return d.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name.toUpperCase());
}

function ensureExtensions(d) {
  for (const [t, cols] of Object.entries(EXT_COLUMNS)) {
    const have = new Set(columnsOf(d, t));
    if (!have.size) continue;
    for (const [c, def] of Object.entries(cols)) if (!have.has(c)) d.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
  }
  d.exec(EXT_TABLES);
  // UN/ECE Rec 20 codes for common units
  const map = { 'STK': 'H87', 'STK.': 'H87', 'STÜCK': 'H87', 'LITER': 'LTR', 'LITER.': 'LTR', 'L': 'LTR', 'STD': 'HUR', 'STD.': 'HUR', 'STUNDE': 'HUR', 'AW': 'C62', 'M': 'MTR', 'KG': 'KGM', 'SATZ': 'SET', 'PAUSCHAL': 'LS', 'PAAR': 'PR' };
  for (const e of d.prepare('SELECT EINHEITID, BEZEICHNUNG, UNECE FROM EINHEITEN').all()) {
    if (!e.UNECE) {
      const code = map[String(e.BEZEICHNUNG || '').trim().toUpperCase()] || 'C62';
      d.prepare('UPDATE EINHEITEN SET UNECE=? WHERE EINHEITID=?').run(code, e.EINHEITID);
    }
  }
  // payment means codes (UNTDID 4461)
  for (const z of d.prepare('SELECT ZAHLBDID, NAME FROM ZAHLUNGSBEDINUNGEN WHERE ERECHCODE IS NULL').all()) {
    const n = String(z.NAME || '').toLowerCase();
    const code = n.includes('bar') || n.includes('kasse') ? '10' : n.includes('abbuch') || n.includes('lastschrift') ? '59' : '58';
    d.prepare('UPDATE ZAHLUNGSBEDINUNGEN SET ERECHCODE=? WHERE ZAHLBDID=?').run(code, z.ZAHLBDID);
  }
}

// Default data for an empty installation
function seed(d) {
  const ins = (sql, rows) => { const st = d.prepare(sql); for (const r of rows) st.run(...r); };
  d.exec('BEGIN');
  ins('INSERT INTO FIRMENDATEN (ID, FIRMENNAME, LAND) VALUES (?,?,?)', [[1, 'Meine Werkstatt', 'DE']]);
  ins('INSERT INTO ZAHLUNGSART (ID, ART, KASSENBUCH, EC) VALUES (?,?,?,?)', [[1, 'Barzahlung', 1, 0], [2, 'EC-Karte / E-Cash', 0, 1], [3, 'Überweisung', 0, 0], [4, 'Scheck', 0, 0], [5, 'Skonto', 0, 0], [6, 'Gutschrift verrechnet', 0, 0]]);
  ins('INSERT INTO ZAHLUNGSSTATUS (ID, TEXT) VALUES (?,?)', [[0, 'offen'], [1, 'teilweise bezahlt'], [2, 'vollständig bezahlt']]);
  ins('INSERT INTO AUFTRAGSART (AUFARTID, BEZEICHNUNG) VALUES (?,?)', [[1, 'keine Angaben'], [2, 'Inspektion'], [3, 'Ölservice'], [4, 'Reifen umstecken']]);
  ins('INSERT INTO EINHEITEN (EINHEITID, BEZEICHNUNG, UNECE) VALUES (?,?,?)', [[1, 'Stk.', 'H87'], [2, 'Liter', 'LTR'], [3, 'Std.', 'HUR'], [4, 'AW', 'C62'], [5, 'm', 'MTR']]);
  ins('INSERT INTO KOSTENSATZ (KOSTENSATZID, BEZEICHNUNG, AWBETRAG, AWKOSTEN) VALUES (?,?,?,?)', [[1, 'Meister', 0, 0], [2, 'Monteur', 0, 0], [3, 'Azubi', 0, 0]]);
  ins('INSERT INTO ZAHLUNGSBEDINUNGEN (ZAHLBDID, NAME, TEXT, TAGEFAELLIG, TAGESKONTO, SKONTO, ERECHCODE) VALUES (?,?,?,?,?,?,?)', [
    [1, 'Standard', 'Zahlbar nach Erhalt der Rechnung ohne Abzug.', 0, 0, 0, '58'],
    [2, 'Barzahlung', 'Betrag bar erhalten.', 0, 0, 0, '10'],
    [3, '14 Tage netto', 'Zahlbar innerhalb von 14 Tagen ohne Abzug.', 14, 0, 0, '58'],
  ]);
  const opt = [
    [43, 500, 'Nummernkreis Kunden', '10000'], [45, 500, 'Nummernkreis Fahrzeug', '10000'], [78, 500, 'Nummerkreis Fahrzeuge', '10000'],
    [46, 500, 'Nummernkreis Arbeitswert', '1'], [44, 500, 'Nummernkreis Liefranten', '70000'], [71, 500, 'Nummerkreis Artikel', '1'],
    [74, 500, 'Nummernkreis Angebot', '100000'], [75, 500, 'Nummernkreis Auftrag', '200000'], [76, 500, 'Nummerkreis Lieferschein', '300000'],
    [77, 500, 'Nummernkreis Rechnung', String(new Date().getFullYear()) + '0000'], [79, 500, 'Nummerkreis Gutschrift', '1'],
    [48, 500, 'Reifeneinlagerung', '1'], [47, 500, 'Kleinunternehmer', '0'],
    [61, 500, 'volle MwSt', '19'], [62, 500, 'verm. MwSt', '7'], [63, 500, 'MwSt frei', '0'], [64, 500, 'AT.-MwSt', '0'],
    [100, 500, 'Mahntage1', '7'], [101, 500, 'Mahntage2', '14'], [102, 500, 'Mahntage3', '21'], [103, 500, 'Mahntage4', '28'],
    [104, 500, 'Mahntage1Gebuehren', '0'], [105, 500, 'Mahntage2Gebuehren', '5'], [106, 500, 'Mahntage3Gebuehren', '10'], [107, 500, 'Mahntage4Gebuehren', '10'],
    [150, 500, 'FIBU-Kasse', '1000'], [151, 500, 'FIBU-Bank1', '1200'], [157, 500, 'FIBU-MwSt1', '1776'], [158, 500, 'FIBU-MwSt2', '1771'],
    [159, 500, 'FIBU-MwSt3', '1760'], [161, 500, 'FIBU-Einnahme-Artikel', '8400'], [162, 500, 'FIBU-Einnahme-Arbeitswert', '8401'],
    [163, 500, 'FIBU-Einnahme-Durch.Posten', '8402'], [164, 500, 'FIBU-Gewährte-Skonti', '8736'], [60, 500, 'Länderkürzel', 'DE'],
    [20, 60, 'Benzin', null], [21, 60, 'Diesel', null], [22, 60, 'Flüssiggas', null], [24, 60, 'Elektro', null], [26, 60, 'Hybrid', null],
    [40, 30, 'Automatik', null], [41, 30, 'Halbautomatik', null], [42, 30, 'Schaltgetriebe', null],
    [1, 100, 'GRÜN', null], [2, 100, 'GELB', null], [3, 100, 'ROT', null], [4, 100, 'OHNE', null],
    [11, 50, 'EURO1', null], [12, 50, 'EURO2', null], [13, 50, 'EURO3', null], [14, 50, 'EURO4', null], [15, 50, 'EURO5', null], [16, 50, 'EURO6', null],
    [30, 40, 'Leder', null], [31, 40, 'Teilleder', null], [32, 40, 'Velour', null], [33, 40, 'Stoff', null], [34, 40, 'Andere', null],
  ];
  ins('INSERT INTO OPTIONSWERTE (OPTID, TYP, BEZEICHNUNG, WERT) VALUES (?,?,?,?)', opt);
  ins('INSERT INTO DRUCKTEXTBAUSTEINE (IDTXT, TXTART, TXTARTSTANDARD, TXTBEZEICHNUNG, TXTBETREFF, EINLEITUNG, SCHLUSSTEXT, TXTARTVARIABLE) VALUES (?,?,?,?,?,?,?,?)', [
    [1, 6, 1, 'Zahlungserinnerung', 'Zahlungserinnerung', 'Sehr geehrte Damen und Herren,\nsicher haben Sie übersehen, dass die unten aufgeführte Rechnung noch nicht beglichen ist.', 'Wir bitten Sie, den offenen Betrag umgehend zu überweisen.\nSollten Sie die Rechnung bereits beglichen haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.', '1'],
    [3, 6, 1, '1. Mahnung', '1. Mahnung', 'Sehr geehrte Damen und Herren,\nleider konnten wir bis heute keinen Zahlungseingang zu der unten aufgeführten Rechnung feststellen.', 'Bitte überweisen Sie den offenen Betrag innerhalb von 7 Tagen.', '2'],
    [2, 6, 1, '2. Mahnung', '2. Mahnung', 'Sehr geehrte Damen und Herren,\ntrotz unserer Erinnerung ist die unten aufgeführte Rechnung weiterhin offen.', 'Wir fordern Sie auf, den Betrag zuzüglich Mahngebühren umgehend zu begleichen.', '3'],
    [4, 6, 1, 'Letzte Mahnung', 'Letzte Mahnung', 'Sehr geehrte Damen und Herren,\nder unten aufgeführte Betrag ist trotz mehrfacher Mahnung noch offen.', 'Sollte der Betrag nicht innerhalb von 7 Tagen eingehen, übergeben wir die Forderung ohne weitere Ankündigung an ein Inkassounternehmen.', '4'],
  ]);
  ins('INSERT INTO LAENDERCODES (LANDID, ISO3166, BEZEICHNUNG) VALUES (?,?,?)', [[1, 'DE', 'Deutschland'], [2, 'AT', 'Österreich'], [3, 'CH', 'Schweiz'], [4, 'NL', 'Niederlande'], [5, 'FR', 'Frankreich'], [6, 'PL', 'Polen'], [7, 'IT', 'Italien'], [8, 'BE', 'Belgien'], [9, 'LU', 'Luxemburg'], [10, 'DK', 'Dänemark'], [11, 'CZ', 'Tschechien'], [12, 'ES', 'Spanien']]);
  ins('INSERT INTO INDIVIDUELLEFELDER (ID, AKTIVE, BEZEICHNUNG) VALUES (?,?,?)', [[1, 0, 'Termin1'], [2, 0, 'Termin2'], [3, 0, 'Termin3'], [4, 0, 'Fahrzeugdaten1'], [5, 0, 'Fahrzeugdaten2'], [6, 0, 'Fahrzeugdaten3'], [7, 0, 'Fahrzeugdaten4'], [8, 0, 'Fahrzeugdaten5']]);
  ins('INSERT INTO WARENGRUPPEN (GRUPPENID, BEZEICHNUNG, ROOTID) VALUES (?,?,?)', [[1, 'Allgemein', 0]]);
  // new installations start in the language of the operating system (existing ones stay German)
  ins('INSERT OR REPLACE INTO SW_EINSTELLUNGEN (SCHLUESSEL, WERT) VALUES (?,?)', [['ui.sprache', require('../i18n').systemLang()]]);
  d.exec('COMMIT');
}

function get() {
  const m = current();
  if (!conns.has(m)) conns.set(m, open(path.join(dirOf(m), DB_NAME)));
  return conns.get(m);
}
function close() { const m = current(); const d = conns.get(m); if (d) { try { d.close(); } catch { /* ignore */ } conns.delete(m); } }
function closeAll() { for (const [m, d] of conns) { try { d.close(); } catch { /* ignore */ } conns.delete(m); } }
function reopen() { close(); return get(); }

module.exports = {
  get, open, close, closeAll, reopen, ensureDirs, initSchema, ensureExtensions, columnsOf,
  listMandanten, saveMandanten, dirOf, current, runAs, ROOT, EXT_COLUMNS,
  get DATA_DIR() { return dirOf(current()); },
  get DB_FILE() { return path.join(dirOf(current()), DB_NAME); },
  get FILES_DIR() { return path.join(dirOf(current()), 'dateien'); },
};
