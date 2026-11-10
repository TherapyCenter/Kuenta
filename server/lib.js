'use strict';
// Shared helpers: settings, number ranges, tax rates, rounding, protocol.
const dbm = require('./db');

const db = () => dbm.get();

function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function today() { return now().slice(0, 10); }
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}
const r2 = x => Math.round((Number(x) || 0) * 100 + Number.EPSILON * Math.sign(x || 0)) / 100;

// ---- OPTIONSWERTE (KFZ-Faktura settings, TYP 500) ----
function opt(name, def = null) {
  const r = db().prepare('SELECT WERT FROM OPTIONSWERTE WHERE BEZEICHNUNG=? ORDER BY OPTID DESC LIMIT 1').get(name);
  return r && r.WERT != null ? r.WERT : def;
}
function optNum(name, def = 0) {
  const v = opt(name, null);
  if (v == null || v === '') return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}
function setOpt(name, value, typ = 500) {
  const d = db();
  const r = d.prepare('SELECT OPTID FROM OPTIONSWERTE WHERE BEZEICHNUNG=? ORDER BY OPTID DESC LIMIT 1').get(name);
  if (r) d.prepare('UPDATE OPTIONSWERTE SET WERT=? WHERE OPTID=?').run(value == null ? null : String(value), r.OPTID);
  else {
    const id = (d.prepare('SELECT COALESCE(MAX(OPTID),0)+1 n FROM OPTIONSWERTE').get().n);
    d.prepare('INSERT INTO OPTIONSWERTE (OPTID, TYP, BEZEICHNUNG, WERT) VALUES (?,?,?,?)').run(Math.max(id, 1000), typ, name, value == null ? null : String(value));
  }
}

// ---- Kuenta settings ----
function sw(key, def = null) {
  const r = db().prepare('SELECT WERT FROM SW_EINSTELLUNGEN WHERE SCHLUESSEL=?').get(key);
  return r ? r.WERT : def;
}
function setSw(key, value) {
  db().prepare('INSERT OR REPLACE INTO SW_EINSTELLUNGEN (SCHLUESSEL, WERT) VALUES (?,?)').run(key, value == null ? null : String(value));
}

// ---- Number ranges: option holds the last used number ----
function nextNumber(key, table, col, extraWhere = '') {
  const d = db();
  const last = optNum(key, 0);
  let maxUsed = 0;
  if (table && col) {
    const r = d.prepare(`SELECT MAX(CAST(${col} AS INTEGER)) m FROM ${table} ${extraWhere ? 'WHERE ' + extraWhere : ''}`).get();
    maxUsed = r && r.m ? Number(r.m) : 0;
  }
  // Use option value unless the table already contains a higher number in the same range
  let next = last + 1;
  if (maxUsed >= next && maxUsed - last < 100000) next = maxUsed + 1;
  return next;
}
function commitNumber(key, value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > optNum(key, 0)) setOpt(key, n);
}

// ---- MwSt: codes 61..64 refer to OPTIONSWERTE ----
// Tax system of the current tenant: DE (default), ES or GB
function land() { const v = sw('steuer.land', 'DE'); return ['ES', 'GB', 'US'].includes(v) ? v : 'DE'; }
// Currency of the tenant's documents
const waehrung = () => ({ GB: 'GBP', US: 'USD' }[land()] || 'EUR');
const SYMBOL = { EUR: '€', GBP: '£', USD: '$' };
// amount with currency: 1.234,50 € (euro after the number, as before) or £1,234.50
function geld(v, locale) {
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const w = waehrung();
  if (w === 'EUR') return n.format(Number(v)) + ' €';
  return (Number(v) < 0 ? '-' : '') + SYMBOL[w] + n.format(Math.abs(Number(v)));
}

function mwstRates() {
  const ES = require('./es');
  if (ES.activo()) return ES.mwstRates();
  if (land() === 'GB') return require('./gb').mwstRates();
  if (land() === 'US') return require('./us').mwstRates();
  const klein = optNum('Kleinunternehmer', 0) === 1;
  return {
    61: klein ? 0 : optNum('volle MwSt', 19),
    62: klein ? 0 : optNum('verm. MwSt', 7),
    63: 0,
    64: klein ? 0 : optNum('AT.-MwSt', 0),
  };
}
function mwstList() {
  const ES = require('./es');
  if (ES.activo()) return ES.mwstList();
  if (land() === 'GB') return require('./gb').mwstList();
  if (land() === 'US') return require('./us').mwstList();
  return [
    { id: 61, name: `volle MwSt (${optNum('volle MwSt', 19)} %)`, rate: optNum('volle MwSt', 19) },
    { id: 62, name: `ermäßigte MwSt (${optNum('verm. MwSt', 7)} %)`, rate: optNum('verm. MwSt', 7) },
    { id: 63, name: 'MwSt-frei (0 %)', rate: 0 },
    { id: 64, name: `AT-MwSt (${optNum('AT.-MwSt', 0)} %)`, rate: optNum('AT.-MwSt', 0) },
  ];
}

function protocol(user, table, id, action, data) {
  try {
    db().prepare('INSERT INTO SW_PROTOKOLL (ZEIT, BENUTZER, TABELLE, DATENSATZ, AKTION, DATEN) VALUES (?,?,?,?,?,?)')
      .run(now(), user || '', table, String(id ?? ''), action, data ? JSON.stringify(data).slice(0, 20000) : null);
  } catch { /* ignore */ }
}

function tableColumns(table) {
  return new Set(dbm.columnsOf(db(), table));
}

function firma() {
  const f = db().prepare('SELECT * FROM FIRMENDATEN ORDER BY ID LIMIT 1').get() || {};
  f.LOGOFILE = sw('firma.logo');
  return f;
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

module.exports = { land, waehrung, geld, db, now, today, addDays, r2, opt, optNum, setOpt, sw, setSw, nextNumber, commitNumber, mwstRates, mwstList, protocol, tableColumns, firma, HttpError };
