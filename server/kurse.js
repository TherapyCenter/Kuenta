'use strict';
// Exchange rates for display on the start page only. Invoices and bookings stay in the company's currency.
// Sources: US dollar, pound sterling and Swiss franc – reference rates of the European Central Bank; Bitcoin – daily BTC/EUR
// rates from the Bitstamp exchange. All rates are stored as "euros per unit".
// Rates are cached in SW_KURSE (this survives a KFZ-Faktura import too); without internet the last state applies.
const L = require('./lib');
const dbm = require('./db');

const QUELLE = { USD: 'Europäische Zentralbank', GBP: 'Europäische Zentralbank', CHF: 'Europäische Zentralbank', BTC: 'Bitstamp' };
const AB = { USD: '1999-01-04', GBP: '1999-01-04', CHF: '1999-01-04', BTC: '2017-01-01' };   // rates exist from here on
const ABRUF_ALLE_MS = 3 * 3600e3;                       // reload at most every 3 hours
const laeuft = new Map();
const ticker = new Map();                               // current BTC rate per process

const db = () => L.db();
const tag = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const unix = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000);

async function holen(url, als = 'text') {
  const r = await fetch(url, { headers: { 'User-Agent': 'Kuenta' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return als === 'json' ? r.json() : r.text();
}
function speichern(w, rows) {
  const st = db().prepare('INSERT OR REPLACE INTO SW_KURSE (WAEHRUNG, DATUM, EURPRO) VALUES (?,?,?)');
  db().exec('BEGIN');
  try { for (const [datum, eurPro] of rows) if (eurPro > 0) st.run(w, datum, eurPro); db().exec('COMMIT'); } catch (e) { db().exec('ROLLBACK'); throw e; }
}

// US dollar, pound and franc: the ECB delivers "units per euro", we store "euros per unit"
async function ladeEzb(w, von) {
  const csv = await holen(`https://data-api.ecb.europa.eu/service/data/EXR/D.${w}.EUR.SP00.A?startPeriod=${von}&format=csvdata`);
  const zeilen = csv.trim().split(/\r?\n/);
  const kopf = zeilen.shift().split(',');
  const iT = kopf.indexOf('TIME_PERIOD'), iV = kopf.indexOf('OBS_VALUE');
  if (iT < 0 || iV < 0) throw new Error('unerwartetes Format der EZB-Daten');
  speichern(w, zeilen.map(z => z.split(',')).map(f => [f[iT], 1 / Number(f[iV])]).filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && isFinite(v)));
}
// Bitcoin: daily closing rates BTC/EUR (euros per bitcoin), paged by 1000 days
async function ladeBtc(von) {
  let start = unix(von);
  const ende = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 20 && start < ende; i++) {
    const j = await holen(`https://www.bitstamp.net/api/v2/ohlc/btceur/?step=86400&limit=1000&start=${start}`, 'json');
    const ohlc = (j && j.data && j.data.ohlc) || [];
    if (!ohlc.length) break;
    speichern('BTC', ohlc.map(c => [tag(Number(c.timestamp)), Number(c.close)]));
    const letzter = Number(ohlc[ohlc.length - 1].timestamp);
    if (ohlc.length < 1000 || letzter <= start) break;
    start = letzter + 86400;
  }
  try { const t = await holen('https://www.bitstamp.net/api/v2/ticker/btceur/', 'json'); if (Number(t.last) > 0) ticker.set(dbm.current(), { eurPro: Number(t.last), zeit: Date.now() }); } catch { /* the daily rate is enough */ }
}

// Load missing rates from "von" onwards. Errors (e.g. offline) are remembered, the cache stays usable.
async function aktualisieren(w, von) {
  von = von < AB[w] ? AB[w] : von;
  const key = `${dbm.current()}:${w}`;
  if (laeuft.has(key)) return laeuft.get(key);
  const p = (async () => {
    const r = db().prepare('SELECT MAX(DATUM) max FROM SW_KURSE WHERE WAEHRUNG=?').get(w);
    const geladenAb = L.sw('kurse.geladenab.' + w, '');
    const zuletzt = Date.parse(L.sw('kurse.abruf.' + w, '') || 0) || 0;
    let ab = null;
    if (!r.max || !geladenAb || von < geladenAb) ab = von;                     // older rates are missing
    else if (Date.now() - zuletzt > ABRUF_ALLE_MS) ab = L.addDays(r.max, -3);   // fetch new rates
    if (!ab) return null;
    try {
      await (w === 'BTC' ? ladeBtc(ab) : ladeEzb(w, ab));
      if (ab === von && (!geladenAb || von < geladenAb)) L.setSw('kurse.geladenab.' + w, von);
      L.setSw('kurse.abruf.' + w, new Date().toISOString());
      L.setSw('kurse.fehler.' + w, '');
      return null;
    } catch (e) {
      L.setSw('kurse.fehler.' + w, e.message);
      return e.message;
    }
  })().finally(() => laeuft.delete(key));
  laeuft.set(key, p);
  return p;
}

function kursHeute(w) {
  const t = ticker.get(dbm.current());
  if (w === 'BTC' && t && Date.now() - t.zeit < 2 * ABRUF_ALLE_MS) return { eurPro: t.eurPro, datum: L.today(), live: true };
  const r = db().prepare('SELECT DATUM, EURPRO FROM SW_KURSE WHERE WAEHRUNG=? ORDER BY DATUM DESC LIMIT 1').get(w);
  return r ? { eurPro: r.EURPRO, datum: r.DATUM } : null;
}

// Current rates for the currency switch
async function aktuell() {
  const out = {};
  for (const w of ['USD', 'GBP', 'CHF', 'BTC']) {
    const fehler = await aktualisieren(w, L.addDays(L.today(), -14));
    const k = kursHeute(w);
    out[w] = k ? { ...k, quelle: QUELLE[w], fehler: fehler || null } : { fehler: fehler || 'Noch keine Kurse geladen (Internetverbindung?)', quelle: QUELLE[w] };
  }
  return out;
}

module.exports = { aktuell, aktualisieren, speichern, kursHeute };
