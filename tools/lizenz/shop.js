'use strict';
// License shop: fetches paid add-on orders from a BTCPay Server, issues the license keys
// and sends them by email. Runs at the publisher's, where the private key is kept as well.
// The BTCPay Server only needs read rights for this and cannot create licenses.
//
// Orders come from a BTCPay "Point of Sale" app. The item IDs of the app are the
// Kuenta feature names (e.g. "sms", "pro"). Different IDs can be mapped in shop.json under
// "artikel". The BTCPay form asks for the workshop name and email.
const fs = require('fs');
const path = require('path');

const VORLAGE = {
  btcpay: { url: 'https://pay.example.de', storeId: 'STORE-ID', apiKey: 'API-SCHLÜSSEL (nur Recht: Rechnungen ansehen)' },
  smtp: { host: 'smtp.example.de', port: 587, secure: 'starttls', user: 'benutzer', pass: 'passwort', from: 'lizenz@example.de', fromName: 'Kuenta Pro', bcc: '' },
  artikel: { sms: 'sms', pro: 'pro' },
  bekannteFunktionen: ['sms', 'pro'],
};

function dateien(home) {
  return { config: path.join(home, 'shop.json'), stand: path.join(home, 'shop-stand.json'), register: path.join(home, 'ausgestellt.csv') };
}
function ladeConfig(home) {
  const f = dateien(home).config;
  if (!fs.existsSync(f)) throw new Error(`Keine Shop-Einstellungen. Zuerst "shop einrichten" ausführen und ${f} ausfüllen.`);
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!c.btcpay || !c.btcpay.url || !c.btcpay.storeId || !c.btcpay.apiKey || /example|STORE-ID|API-SCHL/.test(JSON.stringify(c.btcpay))) throw new Error(`Bitte in ${f} Adresse, Store-ID und API-Schlüssel des BTCPay Servers eintragen.`);
  c.btcpay.url = c.btcpay.url.replace(/\/+$/, '');
  c.artikel = { ...VORLAGE.artikel, ...(c.artikel || {}) };
  c.bekannteFunktionen = c.bekannteFunktionen || VORLAGE.bekannteFunktionen;
  return c;
}
function einrichten(home) {
  const f = dateien(home).config;
  if (fs.existsSync(f)) return { datei: f, neu: false };
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(VORLAGE, null, 2), { mode: 0o600 });
  return { datei: f, neu: true };
}

function ladeStand(home) {
  try { return JSON.parse(fs.readFileSync(dateien(home).stand, 'utf8')); } catch { return null; }
}
function speichereStand(home, st) {
  const f = dateien(home).stand; const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2)); fs.renameSync(tmp, f);
}

async function btcpay(c, pfad) {
  let res;
  try { res = await fetch(c.btcpay.url + '/api/v1' + pfad, { headers: { Authorization: 'token ' + c.btcpay.apiKey }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error(`BTCPay Server nicht erreichbar (${c.btcpay.url}): ${e.cause ? e.cause.code || e.cause.message : e.message}`); }
  const text = await res.text();
  if (!res.ok) throw new Error(`BTCPay meldet Fehler ${res.status}${res.status === 401 ? ' (API-Schlüssel ungültig)' : res.status === 403 ? ' (dem API-Schlüssel fehlt das Recht „Rechnungen ansehen“)' : ''}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// paid invoices of the store (paged)
async function bezahlteRechnungen(c, seitUnix) {
  const alle = [];
  for (let skip = 0; skip < 5000; skip += 100) {
    const teil = await btcpay(c, `/stores/${encodeURIComponent(c.btcpay.storeId)}/invoices?status=Settled&take=100&skip=${skip}${seitUnix ? '&startDate=' + seitUnix : ''}`);
    if (!Array.isArray(teil) || !teil.length) break;
    alle.push(...teil);
    if (teil.length < 100) break;
  }
  return alle.filter(i => /Settled|Complete|Confirmed/i.test(i.status) && (!seitUnix || Number(i.createdTime) >= seitUnix));
}

// purchased items from the invoice data of the Point of Sale app
function artikelAus(meta) {
  const m = meta || {};
  let pos = m.posData;
  if (typeof pos === 'string') { try { pos = JSON.parse(pos); } catch { pos = null; } }
  const ids = [];
  const cart = pos && (pos.cart || (pos.posData && pos.posData.cart));
  if (Array.isArray(cart)) for (const x of cart) { if (x && (x.id || x.itemCode)) ids.push(String(x.id || x.itemCode)); }
  else if (cart && typeof cart === 'object') ids.push(...Object.keys(cart));
  if (m.itemCode) ids.push(String(m.itemCode));
  return [...new Set(ids)];
}
function kundeAus(meta) {
  const m = meta || {};
  const name = m.werkstatt || m.firma || m.company || m.buyerCompany || m.buyerName || '';
  return { name: String(name).trim(), email: String(m.buyerEmail || m.email || '').trim() };
}

// earlier licenses of the same email address (for "the new key contains all add-ons")
function bisherigeFunktionen(home, email) {
  const f = dateien(home).register;
  if (!email || !fs.existsSync(f)) return [];
  const out = new Set();
  for (const zeile of fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
    const felder = csvFelder(zeile);
    if (felder.length >= 6 && felder[3].toLowerCase() === email.toLowerCase() && (felder[5] === 'unbefristet' || felder[5] >= new Date().toISOString().slice(0, 10))) {
      for (const fn of felder[4].split(',')) if (fn.trim()) out.add(fn.trim());
    }
  }
  return [...out];
}
function csvFelder(zeile) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < zeile.length; i++) {
    const ch = zeile[i];
    if (q) { if (ch === '"' && zeile[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ';') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}

function mailText(daten, key, rechnungId) {
  const fn = daten.funktionen.includes('pro') ? 'Kuenta Pro (alle Add-ons, auch künftige)' : daten.funktionen.join(', ');
  return [
    'Guten Tag,', '',
    `vielen Dank für Ihren Kauf. Hier ist Ihr Lizenzschlüssel für Kuenta (${fn}), lizenziert für „${daten.kunde}“:`, '',
    key, '',
    'So spielen Sie ihn ein:',
    '1. In Kuenta Einstellungen → Lizenz öffnen.',
    '2. Den Schlüssel vollständig in das Feld einfügen (oder die angehängte Datei öffnen und den Inhalt kopieren).',
    '3. „Lizenz einspielen“ klicken. Kuenta muss dafür nicht ins Internet.', '',
    'Der Schlüssel gilt unbefristet für eine Installation mit allen Mandanten. Bitte bewahren Sie diese E-Mail auf.', '',
    `Lizenz-Nr. ${daten.id} · Zahlung ${rechnungId}`, '',
    'Mit freundlichen Grüßen', 'Kuenta Pro',
  ].join('\n');
}

// Main flow. erzeugen(o) issues a license ({ daten, key }), senden(mail, smtp) sends it.
async function abholen({ home, erzeugen, senden, probe = false, log = console.log }) {
  const c = ladeConfig(home);
  let st = ladeStand(home);
  if (!st) {
    // first run: only orders from now on, do not deliver old payments afterwards
    st = { seit: Math.floor(Date.now() / 1000) - 3600, erledigt: {} };
    if (!probe) speichereStand(home, st);
    log(`Erster Lauf: Bestellungen ab ${new Date(st.seit * 1000).toLocaleString('de-DE')} werden beliefert.`);
  }
  const rechnungen = await bezahlteRechnungen(c, st.seit);
  const ergebnis = { neu: 0, versendet: 0, offen: [], fehler: [] };
  for (const inv of rechnungen) {
    const alt = st.erledigt[inv.id];
    if (alt && (alt.status === 'versendet' || alt.status === 'kein Add-on')) continue;
    const meta = inv.metadata || {};
    const artikel = artikelAus(meta);
    const funktionen = [...new Set(artikel.map(a => c.artikel[a]).filter(Boolean))].filter(f => c.bekannteFunktionen.includes(f));
    if (!funktionen.length) { if (!probe) { st.erledigt[inv.id] = { status: 'kein Add-on', artikel }; speichereStand(home, st); } continue; }
    const kunde = kundeAus(meta);
    if (!kunde.email || !kunde.name) {
      const grund = `Rechnung ${inv.id}: ${!kunde.email ? 'E-Mail-Adresse' : 'Name der Werkstatt'} fehlt. Bitte von Hand ausstellen (BTCPay-Formular prüfen).`;
      ergebnis.offen.push(grund);
      if (!probe && !alt) { st.erledigt[inv.id] = { status: 'unvollständig', artikel, kunde }; speichereStand(home, st); log(grund); }
      continue;
    }
    // issue the license (only once) – after a mail error, send again on the next run
    let lizenz = alt && alt.key ? { daten: alt.daten, key: alt.key } : null;
    if (!lizenz) {
      const alle = [...new Set([...bisherigeFunktionen(home, kunde.email), ...funktionen])];
      const fn = alle.includes('pro') ? ['pro'] : alle;
      if (probe) { log(`[Probe] ${inv.id}: würde Lizenz für „${kunde.name}“ <${kunde.email}> ausstellen: ${fn.join(', ')}`); ergebnis.neu++; continue; }
      lizenz = erzeugen({ kunde: kunde.name, funktionen: fn.join(','), email: kunde.email, zahlung: `BTCPay ${inv.id} · ${inv.amount || ''} ${inv.currency || ''}`.trim() });
      st.erledigt[inv.id] = { status: 'ausgestellt', daten: lizenz.daten, key: lizenz.key, email: kunde.email, zeit: new Date().toISOString() };
      speichereStand(home, st);
      ergebnis.neu++;
      log(`Lizenz ${lizenz.daten.id} für „${kunde.name}“ ausgestellt (${lizenz.daten.funktionen.join(', ')}).`);
    }
    if (probe) { log(`[Probe] ${inv.id}: würde Lizenz ${lizenz.daten.id} erneut an ${kunde.email} senden.`); continue; }
    try {
      await senden({
        to: kunde.email, subject: 'Ihr Kuenta-Lizenzschlüssel', text: mailText(lizenz.daten, lizenz.key, inv.id),
        attachments: [{ filename: 'kuenta-lizenz.txt', content: Buffer.from(lizenz.key + '\r\n', 'utf8'), contentType: 'text/plain' }],
      }, c.smtp);
      st.erledigt[inv.id] = { ...st.erledigt[inv.id], status: 'versendet', versendet: new Date().toISOString() };
      speichereStand(home, st);
      ergebnis.versendet++;
      log(`  → per E-Mail an ${kunde.email} geschickt.`);
    } catch (e) {
      st.erledigt[inv.id] = { ...st.erledigt[inv.id], status: 'nicht versendet', fehler: e.message };
      speichereStand(home, st);
      ergebnis.fehler.push(`Rechnung ${inv.id}: E-Mail an ${kunde.email} fehlgeschlagen (${e.message}). Wird beim nächsten Lauf erneut versucht.`);
      log(`  → E-Mail fehlgeschlagen: ${e.message}`);
    }
  }
  return ergebnis;
}

// hide an order that was handled by hand (e.g. incomplete details)
function erledigt(home, rechnungId, notiz = 'von Hand erledigt') {
  const st = ladeStand(home);
  if (!st) throw new Error('Der Shop ist noch nicht gelaufen.');
  st.erledigt[rechnungId] = { ...(st.erledigt[rechnungId] || {}), status: 'versendet', notiz, zeit: new Date().toISOString() };
  speichereStand(home, st);
}

async function test(home) {
  const c = ladeConfig(home);
  const liste = await btcpay(c, `/stores/${encodeURIComponent(c.btcpay.storeId)}/invoices?take=1`);
  return { ok: true, rechnungen: Array.isArray(liste) ? liste.length : 0 };
}

module.exports = { abholen, einrichten, erledigt, test, artikelAus, kundeAus, bisherigeFunktionen, VORLAGE };
