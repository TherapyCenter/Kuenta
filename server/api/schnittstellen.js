'use strict';
// Data import (CSV with field mapping), DATANORM 4/5, shopping cart import from parts catalogues
const L = require('../lib');
const { E } = require('../../public/js/entities.js');

const latin = new TextDecoder('windows-1252'); const utf8 = new TextDecoder('utf-8', { fatal: true });
function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  try { return utf8.decode(buf); } catch { return latin.decode(buf); }
}
function detectDelim(line) {
  const c = { ';': 0, ',': 0, '\t': 0, '|': 0 };
  let inQ = false; for (const ch of line) { if (ch === '"') inQ = !inQ; else if (!inQ && c[ch] != null) c[ch]++; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}
function parseCsv(text, delim) {
  text = text.replace(/\r\n?/g, '\n');
  if (!delim) delim = detectDelim(text.split('\n')[0] || '');
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"' && cur === '') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return { delim, rows: rows.filter(r => r.some(c => String(c).trim() !== '')) };
}
const num = s => { s = String(s ?? '').trim().replace(/\s|€/g, ''); if (!s) return null; if (/,\d{1,4}$/.test(s) || (s.includes(',') && !s.includes('.'))) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); const n = Number(s); return Number.isFinite(n) ? n : null; };
const dat = s => { s = String(s || '').trim(); let m; if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/))) { let y = Number(m[3]); if (y < 100) y += y < 70 ? 2000 : 1900; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; } if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); return null; };

// Target fields per import type (field → label, type)
function zielfelder(ent) {
  const e = E[ent]; if (!e) throw new L.HttpError(404, 'Unbekannte Import-Art');
  const out = [];
  for (const tab of e.form || []) for (const g of tab.groups || []) for (const f of g.fields) if (!['kunde', 'fahrzeug', 'password'].includes(f.t)) out.push({ f: f.f, l: String(f.l).replace(/\$IND\d+/, 'Individuell'), t: f.t || 'text' });
  if (ent === 'fahrzeuge') out.push({ f: '_KUNDENNR', l: 'Kunden-Nr. des Halters (Zuordnung)', t: 'int' });
  return { felder: out, schluessel: { kunden: 'NUMMER', fahrzeuge: 'FRZNUMMER', artikel: 'ARTNUMMER', arbeitswerte: 'LEISTUNGNUMMER', lieferanten: 'NUMMER' }[ent] || null };
}

function vorschau(buf, { delim } = {}) {
  const { delim: d, rows } = parseCsv(decode(buf), delim);
  return { delim: d, spalten: Math.max(...rows.slice(0, 50).map(r => r.length), 0), zeilen: rows.length, beispiel: rows.slice(0, 15) };
}

function importieren(ent, buf, { delim, ersteZeileUeberspringen, zuordnung, aktualisieren = true }, user) {
  const G = require('./generic');
  const e = E[ent]; const { felder, schluessel } = zielfelder(ent);
  const { rows } = parseCsv(decode(buf), delim);
  const daten = ersteZeileUeberspringen ? rows.slice(1) : rows;
  const typ = Object.fromEntries(felder.map(f => [f.f, f.t]));
  let neu = 0, geaendert = 0; const fehler = [];
  const d = L.db();
  d.exec('BEGIN');
  try {
    daten.forEach((r, i) => {
      const rec = {};
      for (const [feld, spalte] of Object.entries(zuordnung || {})) {
        if (spalte === '' || spalte == null) continue;
        let v = r[Number(spalte)]; if (v == null) continue; v = String(v).trim();
        const t = typ[feld];
        if (['int', 'num', 'money', 'pct'].includes(t)) v = num(v);
        else if (t === 'date' || t === 'hu') v = dat(v);
        else if (t === 'bool') v = /^(1|j|ja|x|true|wahr|y|yes)$/i.test(v) ? 1 : 0;
        rec[feld] = v === '' ? null : v;
      }
      const kundenNr = rec._KUNDENNR; delete rec._KUNDENNR;
      if (!Object.values(rec).some(v => v != null)) return;
      try {
        let id = null;
        if (schluessel && rec[schluessel] != null && aktualisieren) {
          const ex = d.prepare(`SELECT "${e.pk}" id FROM ${e.table} WHERE "${schluessel}"=? ${e.where ? 'AND ' + e.where : ''}`).get(rec[schluessel]);
          if (ex) id = ex.id;
        }
        if (id) { const cur = G.getRec(ent, id); G.saveRec(ent, id, { ...cur, ...rec }, user); geaendert++; }
        else { const s = G.saveRec(ent, null, rec, user); id = s[e.pk]; neu++; }
        if (ent === 'fahrzeuge' && kundenNr) { const k = d.prepare('SELECT KUNID FROM KUNDEN WHERE NUMMER=?').get(Number(kundenNr)); if (k) d.prepare('INSERT OR IGNORE INTO KUNDEN_FAHRZEUGE (KUNID, FAHRID) VALUES (?,?)').run(k.KUNID, id); }
      } catch (err) { fehler.push(`Zeile ${i + 1 + (ersteZeileUeberspringen ? 1 : 0)}: ${err.message}`); }
    });
    d.exec('COMMIT');
  } catch (err) { d.exec('ROLLBACK'); throw err; }
  return { neu, geaendert, fehler: fehler.slice(0, 100), fehlerAnzahl: fehler.length };
}

function vorlagen(ent) { return JSON.parse(L.sw('import.vorlagen.' + ent, '{}') || '{}'); }
function vorlageSpeichern(ent, name, cfg) { const v = vorlagen(ent); v[name] = cfg; L.setSw('import.vorlagen.' + ent, JSON.stringify(v)); return v; }

// DATANORM 4.0 / 5.0: A records (articles) and B records (EAN, match code)
function datanorm(buf, { preisAls = 'auto', aufschlag = 0, lieferant } = {}, user) {
  const text = decode(buf).replace(/\r/g, '');
  const arts = new Map();
  for (const line of text.split('\n')) {
    const f = line.split(';');
    if (f[0] === 'A') {
      // A;Kennz;Artikelnr;Textkennz;Kurztext1;Kurztext2;Preiskennz;Preiseinheit;Mengeneinheit;Preis;Rabattgruppe;Warengruppe;Langtextschl.
      const pe = { 0: 1, 1: 10, 2: 100, 3: 1000 }[f[7]] || 1;
      let preis = Number(String(f[9] || '0').replace(',', '.'));
      if (!String(f[9] || '').includes(',') && !String(f[9] || '').includes('.')) preis = preis / 100; // price in cents
      preis = preis / pe;
      const a = arts.get(f[2]) || {};
      Object.assign(a, { ARTNUMMER: f[2], BEZEICHNUNG1: (f[4] || '').trim(), BEZEICHNUNG2: (f[5] || '').trim(), preis, kennz: f[6], einheit: (f[8] || '').trim(), loeschen: f[1] === 'L' });
      arts.set(f[2], a);
    } else if (f[0] === 'B') {
      const a = arts.get(f[2]) || { ARTNUMMER: f[2] };
      const ean = f.find((x, i) => i > 3 && /^\d{8}$|^\d{12,14}$/.test(String(x).trim()));
      if (ean) a.EAN = ean.trim();
      arts.set(f[2], a);
    }
  }
  const G = require('./generic');
  let neu = 0, geaendert = 0, geloescht = 0;
  const d = L.db();
  const liefid = lieferant ? Number(lieferant) : null;
  d.exec('BEGIN');
  try {
    for (const a of arts.values()) {
      if (!a.ARTNUMMER) continue;
      const ex = d.prepare('SELECT ARTID FROM ARTIKEL WHERE ARTNUMMER=?').get(a.ARTNUMMER);
      if (a.loeschen) { if (ex) { d.prepare('DELETE FROM ARTIKEL WHERE ARTID=?').run(ex.ARTID); geloescht++; } continue; }
      const istVK = preisAls === 'vk' || (preisAls === 'auto' && a.kennz === '1');
      const rec = { ARTNUMMER: a.ARTNUMMER };
      if (a.BEZEICHNUNG1) rec.BEZEICHNUNG1 = a.BEZEICHNUNG1;
      if (a.BEZEICHNUNG2) rec.BEZEICHNUNG2 = a.BEZEICHNUNG2;
      if (a.EAN) rec.EAN = a.EAN;
      if (liefid) rec.LIEFID = liefid;
      if (a.preis != null && !Number.isNaN(a.preis)) {
        if (istVK) rec.VKPNETTO = L.r2(a.preis);
        else { rec.EKPNETTO = L.r2(a.preis); if (Number(aufschlag)) rec.VKPNETTO = L.r2(a.preis * (1 + Number(aufschlag) / 100)); }
      }
      if (ex) { G.saveRec('artikel', ex.ARTID, { ...G.getRec('artikel', ex.ARTID), ...rec }, user); geaendert++; }
      else { G.saveRec('artikel', null, { MWST: 61, ...rec }, user); neu++; }
    }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return { neu, geaendert, geloescht, gelesen: arts.size };
}

// Shopping cart from parts catalogues (CSV/text/DATANORM) → line items
function warenkorb(buf) {
  const text = decode(buf);
  if (/^A;/m.test(text)) {
    const out = [];
    for (const line of text.split(/\r?\n/)) { const f = line.split(';'); if (f[0] !== 'A') continue; let p = Number(String(f[9] || 0).replace(',', '.')); if (!/[.,]/.test(f[9] || '')) p /= 100; out.push({ artnr: f[2], bezeichnung: [f[4], f[5]].filter(Boolean).join(' ').trim(), menge: 1, preis: p, ek: f[6] === '2' ? p : null }); }
    return out;
  }
  const { rows } = parseCsv(text);
  if (!rows.length) return [];
  // detect columns from the header line
  const head = rows[0].map(h => String(h).toLowerCase());
  const idx = (re) => head.findIndex(h => re.test(h));
  let iA = idx(/art.*nr|artikelnummer|teilenummer|nummer|sku|oe/), iB = idx(/bezeich|beschreib|text|name/), iM = idx(/menge|anzahl|qty|stk/), iP = idx(/vk|verkauf|preis|price|brutto/), iE = idx(/ek|einkauf|netto.*ek|händler/), iH = idx(/hersteller|marke|brand/), iEan = idx(/ean|gtin/);
  let data = rows.slice(1);
  if (iA < 0 && iB < 0) { data = rows; iA = 0; iB = 1; iM = 2; iP = 3; iE = 4; }
  return data.map(r => ({ artnr: iA >= 0 ? String(r[iA] || '').trim() : '', bezeichnung: [iH >= 0 ? r[iH] : '', iB >= 0 ? r[iB] : ''].filter(Boolean).join(' ').trim(), menge: (iM >= 0 ? num(r[iM]) : null) || 1, preis: iP >= 0 ? num(r[iP]) : null, ek: iE >= 0 && iE !== iP ? num(r[iE]) : null, ean: iEan >= 0 ? String(r[iEan] || '').trim() : '' }))
    .filter(x => x.artnr || x.bezeichnung);
}
function warenkorbAnlegen(rows, user) {
  const G = require('./generic'); const d = L.db(); const out = [];
  for (const r of rows) {
    if (!r.artnr) { out.push(null); continue; }
    const ex = d.prepare('SELECT ARTID FROM ARTIKEL WHERE ARTNUMMER=?').get(r.artnr);
    if (ex) { out.push(ex.ARTID); continue; }
    const s = G.saveRec('artikel', null, { ARTNUMMER: r.artnr, BEZEICHNUNG1: r.bezeichnung, VKPNETTO: r.preis, EKPNETTO: r.ek, EAN: r.ean || null, MWST: 61 }, user);
    out.push(s.ARTID);
  }
  return out;
}

module.exports = { zielfelder, vorschau, importieren, vorlagen, vorlageSpeichern, datanorm, warenkorb, warenkorbAnlegen, parseCsv };
