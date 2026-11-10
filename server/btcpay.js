'use strict';
// Bitcoin, Lightning and USDT payments through your own BTCPay Server (Greenfield API).
//
// Invoices: Kuenta creates a "Payment Request". That is a long-lived payment page for the
// open euro amount. The exchange rate is only fixed when the customer actually pays, so the
// link can go on the PDF invoice and into the email. Which payment methods (BTC, Lightning,
// USDT on Liquid …) are offered is configured in the BTCPay store, not in Kuenta.
//
// Incoming payments: Kuenta polls BTCPay regularly (no webhook needed, Kuenta usually sits
// behind a router) and books paid invoices automatically.
const L = require('./lib');

const ZAHLART_NAME = 'Krypto (BTCPay)';

function cfg() {
  return {
    aktiv: L.sw('btcpay.aktiv', '0') === '1',
    url: L.sw('btcpay.url', '').trim().replace(/\/+$/, ''),
    store: L.sw('btcpay.storeid', '').trim(),
    key: L.sw('btcpay.apikey', '').trim(),
    tage: Math.max(1, parseInt(L.sw('btcpay.gueltigtage', '30'), 10) || 30),
    konto: parseInt(L.sw('btcpay.konto', '1360'), 10) || 1360,
    pdf: L.sw('btcpay.pdf', '1') === '1',
  };
}
function bereit(c = cfg()) { return !!(c.aktiv && c.url && c.store && c.key); }
function pruefeBereit(c = cfg()) {
  if (!c.aktiv) throw new L.HttpError(400, 'Krypto-Zahlungen sind ausgeschaltet (Einstellungen → Krypto-Zahlung).');
  if (!c.url || !c.store || !c.key) throw new L.HttpError(400, 'Bitte unter Einstellungen → Krypto-Zahlung Adresse, Store-ID und API-Schlüssel des BTCPay Servers eintragen.');
}

async function call(method, pfad, body, c = cfg()) {
  let res;
  try {
    res = await fetch(c.url + '/api/v1' + pfad, {
      method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: 'token ' + c.key },
    });
  } catch (e) { throw new L.HttpError(502, `BTCPay Server nicht erreichbar (${c.url}): ${e.cause ? e.cause.code || e.cause.message : e.message}`); }
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = Array.isArray(data) ? data.map(x => x.message).join(' ') : data.message || data.code || text.slice(0, 200);
    const hint = res.status === 401 ? ' Der API-Schlüssel ist ungültig.' : res.status === 403 ? ' Dem API-Schlüssel fehlen Rechte (siehe Handbuch).' : res.status === 404 ? ' Store-ID oder Adresse stimmt nicht.' : '';
    throw new L.HttpError(502, `BTCPay meldet Fehler ${res.status}: ${msg}${hint}`);
  }
  return data;
}

// ---------- Payment type in the database ----------
function zahlartId() {
  const d = L.db();
  const z = d.prepare('SELECT ID FROM ZAHLUNGSART WHERE ART=?').get(ZAHLART_NAME);
  if (z) return z.ID;
  const id = (d.prepare('SELECT MAX(ID) m FROM ZAHLUNGSART').get().m || 0) + 1;
  d.prepare('INSERT INTO ZAHLUNGSART (ID, ART, KASSENBUCH, EC) VALUES (?,?,0,0)').run(Math.max(id, 7), ZAHLART_NAME);
  return Math.max(id, 7);
}

// ---------- Connection test ----------
async function test() {
  const c = cfg();
  if (!c.url || !c.store || !c.key) throw new L.HttpError(400, 'Bitte Adresse, Store-ID und API-Schlüssel eintragen.');
  const store = await call('GET', `/stores/${encodeURIComponent(c.store)}`, null, c);
  let methoden = [];
  try {
    const pm = await call('GET', `/stores/${encodeURIComponent(c.store)}/payment-methods`, null, c);
    // BTCPay 2.x: list [{ paymentMethodId, enabled }], 1.x: object { "BTC": { enabled } }
    const liste = Array.isArray(pm) ? pm : Object.entries(pm || {}).map(([k, v]) => ({ paymentMethodId: k, ...(v || {}) }));
    methoden = liste.filter(m => m.enabled !== false).map(m => methodeName(m.paymentMethodId || m.paymentMethod || m.cryptoCode));
  } catch { /* the right "canviewstoresettings" is enough for the store, the list is only extra */ }
  methoden = [...new Set(methoden)];
  if (methoden.length) L.setSw('btcpay.methoden', methoden.join('|'));
  return { store: store.name || c.store, methoden, waehrung: store.defaultCurrency || '' };
}
// "Bitcoin, Lightning oder USDT" – from the payment methods found in the connection test
function artenText() {
  const kurz = { 'Bitcoin (on-chain)': 'Bitcoin', 'Lightning': 'Lightning', 'USDT (Liquid)': 'USDT', 'Liquid-Bitcoin': 'Liquid-Bitcoin' };
  const a = L.sw('btcpay.methoden', '').split('|').filter(Boolean).map(m => kurz[m] || m);
  const liste = a.length ? a : ['Bitcoin', 'Lightning', 'USDT'];
  return liste.length > 1 ? liste.slice(0, -1).join(', ') + ' oder ' + liste[liste.length - 1] : liste[0];
}
function methodeName(id) {
  const s = String(id || '');
  if (/^BTC(-CHAIN)?$/i.test(s) || /^BTC_?OnChain$/i.test(s)) return 'Bitcoin (on-chain)';
  if (/LN|Lightning/i.test(s)) return 'Lightning';
  if (/USDT/i.test(s)) return 'USDT (Liquid)';
  if (/^LBTC/i.test(s)) return 'Liquid-Bitcoin';
  return s;
}

// ---------- Payment link for an invoice ----------
function eintrag(rid) {
  return L.db().prepare("SELECT * FROM SW_BTCPAY WHERE RECHNUNGID=? AND ART='anfrage' AND STATUS IN ('offen','Pending','Processing') ORDER BY ID DESC LIMIT 1").get(rid) || null;
}
function offenBetrag(rid) {
  const d = L.db();
  const r = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  if (!r) throw new L.HttpError(404, 'Rechnung nicht gefunden');
  const paid = d.prepare('SELECT COALESCE(SUM(BETRAG),0) s FROM ZAHLUNGSEINGAENGE WHERE RECHNUNGID=?').get(rid).s;
  return { r, offen: L.r2(r.GBRUTTO - paid) };
}

async function link(rid, { neu = false } = {}) {
  const c = cfg(); pruefeBereit(c);
  zahlartId();
  const { r, offen } = offenBetrag(rid);
  if (Number(r.TYP) !== 1) throw new L.HttpError(400, 'Zahlungslinks gibt es nur für Rechnungen.');
  if (offen < 0.01) throw new L.HttpError(400, 'Die Rechnung ist bereits bezahlt.');
  const alt = eintrag(rid);
  if (alt && !neu && Math.abs(alt.BETRAG - offen) < 0.005 && (!alt.ABLAUF || alt.ABLAUF >= L.today())) return info(alt);
  if (alt) await archivieren(alt, 'ersetzt');
  const firma = L.firma().FIRMENNAME || '';
  const ablauf = L.addDays(L.today(), c.tage);
  const kd = r.KUNID ? L.db().prepare('SELECT EMAIL, EMAILRECHNUNG FROM KUNDEN WHERE KUNID=?').get(r.KUNID) : null;
  const pr = await call('POST', `/stores/${encodeURIComponent(c.store)}/payment-requests`, {
    title: `Rechnung ${r.RECHNUNGNUMMER}${firma ? ' – ' + firma : ''}`,
    description: `Rechnung Nr. ${r.RECHNUNGNUMMER} vom ${String(r.DATUM || '').split('-').reverse().join('.')}${r.KUNNAME ? ', ' + [r.KUNVORNAME, r.KUNNAME].filter(Boolean).join(' ') : ''}`,
    amount: offen, currency: 'EUR', allowCustomPaymentAmounts: false,
    expiryDate: Math.floor(new Date(ablauf + 'T23:59:59').getTime() / 1000),
    email: (kd && (kd.EMAILRECHNUNG || kd.EMAIL)) || undefined,
    referenceId: `KUENTA-RE-${r.RECHNUNGNUMMER}`,
  }, c);
  if (!pr || !pr.id) throw new L.HttpError(502, 'BTCPay hat keine Payment-Request-ID geliefert.');
  const url = `${c.url}/payment-requests/${encodeURIComponent(pr.id)}`;
  const id = Number(L.db().prepare("INSERT INTO SW_BTCPAY (ART, RECHNUNGID, BTCPAYID, LINK, BETRAG, WAEHRUNG, STATUS, ANGELEGT, ABLAUF) VALUES ('anfrage',?,?,?,?,'EUR',?,?,?)")
    .run(rid, pr.id, url, offen, pr.status || 'Pending', L.now(), ablauf).lastInsertRowid);
  L.protocol(null, 'SW_BTCPAY', id, 'angelegt', { rechnung: r.RECHNUNGNUMMER, betrag: offen, btcpay: pr.id });
  return info(L.db().prepare('SELECT * FROM SW_BTCPAY WHERE ID=?').get(id));
}
function info(e) { return e && { id: e.ID, link: e.LINK, betrag: e.BETRAG, status: e.STATUS, ablauf: e.ABLAUF, angelegt: e.ANGELEGT, bezahlt: e.BEZAHLT, methode: e.METHODE }; }

// For PDF and email: the current link without asking BTCPay (must never throw)
function linkFuerBeleg(rid) {
  try {
    const c = cfg();
    if (!bereit(c) || !c.pdf) return null;
    const e = eintrag(rid);
    if (!e || (e.ABLAUF && e.ABLAUF < L.today())) return null;
    const { offen } = offenBetrag(rid);
    return Math.abs(e.BETRAG - offen) < 0.005 ? info(e) : null;
  } catch { return null; }
}

async function archivieren(e, status) {
  const c = cfg();
  try { await call('DELETE', `/stores/${encodeURIComponent(c.store)}/payment-requests/${encodeURIComponent(e.BTCPAYID)}`, null, c); }
  catch (err) { if (!/404/.test(err.message)) throw err; }
  L.db().prepare('UPDATE SW_BTCPAY SET STATUS=?, GEPRUEFT=? WHERE ID=?').run(status, L.now(), e.ID);
}

// Find the payment method (BTC, Lightning, USDT) of a paid BTCPay invoice – information only
async function methodeZu(e, c) {
  try {
    const liste = await call('GET', `/stores/${encodeURIComponent(c.store)}/invoices?textSearch=${encodeURIComponent(e.BTCPAYID)}&take=10`, null, c);
    const inv = (Array.isArray(liste) ? liste : []).find(i => /Settled|Complete|Confirmed|Paid/i.test(i.status));
    if (!inv) return '';
    const pm = await call('GET', `/stores/${encodeURIComponent(c.store)}/invoices/${encodeURIComponent(inv.id)}/payment-methods`, null, c);
    const bezahlt = (Array.isArray(pm) ? pm : []).filter(m => (m.payments && m.payments.length) || Number(m.totalPaid || m.paymentMethodPaid) > 0);
    return [...new Set(bezahlt.map(m => methodeName(m.paymentMethodId || m.paymentMethod || m.cryptoCode)))].join(', ');
  } catch { return ''; }
}

// ---------- Fetch incoming payments ----------
const laeuft = new Set(); // at most one query per tenant at a time
async function pruefen({ user } = {}) {
  const c = cfg();
  const mandant = require('./db').current();
  if (!bereit(c) || laeuft.has(mandant)) return { geprueft: 0, gebucht: [], fehler: [] };
  laeuft.add(mandant);
  const d = L.db();
  const VG = require('./api/vorgang');
  const gebucht = []; const fehler = [];
  try {
    const offene = d.prepare("SELECT * FROM SW_BTCPAY WHERE ART='anfrage' AND STATUS IN ('offen','Pending','Processing')").all();
    for (const e of offene) {
      try {
        const { r, offen } = offenBetrag(e.RECHNUNGID);
        if (offen < 0.01) { await archivieren(e, 'anders bezahlt'); continue; }
        const pr = await call('GET', `/stores/${encodeURIComponent(c.store)}/payment-requests/${encodeURIComponent(e.BTCPAYID)}`, null, c);
        const st = String(pr.status || '');
        if (/Completed|Settled/i.test(st)) {
          const methode = await methodeZu(e, c);
          const betrag = Math.min(e.BETRAG, offen);
          const z = VG.addPayment({ RECHNUNGID: e.RECHNUNGID, BETRAG: betrag, ZAHLUNGSARTID: zahlartId(), DATUM: L.today(), BANKNAME: `BTCPay${methode ? ' · ' + methode : ''}` }, { name: user || 'BTCPay' });
          d.prepare("UPDATE SW_BTCPAY SET STATUS='bezahlt', BEZAHLT=?, ZAHLID=?, METHODE=?, GEPRUEFT=? WHERE ID=?").run(L.now(), z.id, methode, L.now(), e.ID);
          gebucht.push({ rechnung: r.RECHNUNGNUMMER, betrag, methode });
        } else if (/Expired/i.test(st)) {
          d.prepare("UPDATE SW_BTCPAY SET STATUS='abgelaufen', GEPRUEFT=? WHERE ID=?").run(L.now(), e.ID);
        } else {
          d.prepare('UPDATE SW_BTCPAY SET STATUS=?, GEPRUEFT=?, FEHLER=NULL WHERE ID=?').run(st || 'Pending', L.now(), e.ID);
        }
      } catch (err) {
        d.prepare('UPDATE SW_BTCPAY SET FEHLER=?, GEPRUEFT=? WHERE ID=?').run(err.message, L.now(), e.ID);
        fehler.push(err.message);
      }
    }
    // Register: cancelled or abandoned payments that were paid after all
    const grenze = new Date(Date.now() - (KASSE_MINUTEN + 5) * 60000);
    const pad = n => String(n).padStart(2, '0');
    const alt = `${grenze.getFullYear()}-${pad(grenze.getMonth() + 1)}-${pad(grenze.getDate())} ${pad(grenze.getHours())}:${pad(grenze.getMinutes())}:${pad(grenze.getSeconds())}`;
    const kasse = d.prepare("SELECT ID, STATUS, ANGELEGT FROM SW_BTCPAY WHERE ART='kasse' AND BONID IS NULL AND STATUS NOT IN ('bezahlt ohne Bon','Expired','Invalid','geprüft') AND ANGELEGT >= ?").all(L.addDays(L.today(), -1));
    for (const e of kasse) {
      if (e.STATUS !== 'abgebrochen' && e.ANGELEGT > alt) continue; // may be in progress at the register right now
      try {
        const s = await kasseStatus(e.ID);
        if (s.status === 'bezahlt') d.prepare("UPDATE SW_BTCPAY SET STATUS='bezahlt ohne Bon' WHERE ID=?").run(e.ID);
        else if (s.status === 'abgelaufen' || s.status === 'ungueltig') d.prepare("UPDATE SW_BTCPAY SET STATUS='geprüft' WHERE ID=?").run(e.ID);
      } catch (err) { fehler.push(err.message); }
    }
    return { geprueft: offene.length + kasse.length, gebucht, fehler };
  } finally { laeuft.delete(mandant); }
}

// ---------- Register: pay immediately by QR code ----------
// Short-lived BTCPay invoice (15 minutes, fixed rate). Lightning confirms within seconds; on-chain
// "HighSpeed" already accepts the payment seen in the network (0 confirmations), so nobody waits at the counter.
const KASSE_MINUTEN = 15;
async function kasseStart({ betrag, text } = {}) {
  const c = cfg(); pruefeBereit(c);
  zahlartId();
  const eur = L.r2(Number(betrag));
  if (!(eur > 0)) throw new L.HttpError(400, 'Der Betrag muss größer als 0 sein.');
  const inv = await call('POST', `/stores/${encodeURIComponent(c.store)}/invoices`, {
    amount: eur, currency: 'EUR',
    metadata: { orderId: `KUENTA-KASSE-${Date.now()}`, itemDesc: String(text || 'Einkauf').slice(0, 100) },
    checkout: { speedPolicy: 'HighSpeed', expirationMinutes: KASSE_MINUTEN, defaultLanguage: 'de-DE' },
  }, c);
  if (!inv || !inv.id) throw new L.HttpError(502, 'BTCPay hat keine Rechnungs-ID geliefert.');
  const id = Number(L.db().prepare("INSERT INTO SW_BTCPAY (ART, BTCPAYID, LINK, BETRAG, WAEHRUNG, STATUS, ANGELEGT, ABLAUF) VALUES ('kasse',?,?,?,'EUR','New',?,?)")
    .run(inv.id, inv.checkoutLink || `${c.url}/i/${inv.id}`, eur, L.now(), new Date(Date.now() + KASSE_MINUTEN * 60000).toISOString()).lastInsertRowid);
  let methoden = [];
  try {
    const pm = await call('GET', `/stores/${encodeURIComponent(c.store)}/invoices/${encodeURIComponent(inv.id)}/payment-methods`, null, c);
    methoden = (Array.isArray(pm) ? pm : []).map(m => {
      const name = methodeName(m.paymentMethodId || m.paymentMethod || m.cryptoCode);
      let link = m.paymentLink || m.destination || '';
      if (name === 'Lightning' && link && !/^lightning:/i.test(link)) link = 'lightning:' + link;
      return { name, link, betrag: m.amount || m.due || '', waehrung: m.currency || m.cryptoCode || '' };
    }).filter(m => m.link);
    // Lightning first: fastest at the counter
    methoden.sort((a, b) => (b.name === 'Lightning') - (a.name === 'Lightning'));
  } catch { /* then only the checkout page */ }
  return { id, link: inv.checkoutLink || `${c.url}/i/${inv.id}`, betrag: eur, minuten: KASSE_MINUTEN, methoden };
}

function kasseEintrag(id) {
  const e = L.db().prepare("SELECT * FROM SW_BTCPAY WHERE ID=? AND ART='kasse'").get(id);
  if (!e) throw new L.HttpError(404, 'Krypto-Zahlung nicht gefunden');
  return e;
}
// BTCPay status → Kuenta: offen | bestaetigung | bezahlt | abgelaufen | ungueltig
async function kasseStatus(id) {
  const c = cfg(); pruefeBereit(c);
  const e = kasseEintrag(id);
  const inv = await call('GET', `/stores/${encodeURIComponent(c.store)}/invoices/${encodeURIComponent(e.BTCPAYID)}`, null, c);
  const st = String(inv.status || ''); const zusatz = String(inv.additionalStatus || '');
  const status = /Settled|Complete|Confirmed/i.test(st) ? 'bezahlt' : /Processing|Paid/i.test(st) ? 'bestaetigung' : /Expired/i.test(st) ? 'abgelaufen' : /Invalid/i.test(st) ? 'ungueltig' : 'offen';
  let methode = e.METHODE;
  if (status === 'bezahlt' && !methode) methode = await methodeZuRechnung(inv.id, c);
  L.db().prepare('UPDATE SW_BTCPAY SET STATUS=?, METHODE=?, GEPRUEFT=?, BEZAHLT=COALESCE(BEZAHLT, CASE WHEN ?=\'bezahlt\' THEN ? END) WHERE ID=?')
    .run(e.STATUS === 'abgebrochen' && status === 'bezahlt' ? 'bezahlt ohne Bon' : e.STATUS === 'abgebrochen' ? 'abgebrochen' : st, methode || null, L.now(), status, L.now(), id);
  return { status, teilweise: /PaidPartial/i.test(zusatz), methode: methode || '' };
}
async function methodeZuRechnung(invoiceId, c) {
  try {
    const pm = await call('GET', `/stores/${encodeURIComponent(c.store)}/invoices/${encodeURIComponent(invoiceId)}/payment-methods`, null, c);
    const bezahlt = (Array.isArray(pm) ? pm : []).filter(m => (m.payments && m.payments.length) || Number(m.totalPaid || m.paymentMethodPaid) > 0);
    return [...new Set(bezahlt.map(m => methodeName(m.paymentMethodId || m.paymentMethod || m.cryptoCode)))].join(', ');
  } catch { return ''; }
}
// Cancelled at the register: mark the invoice invalid at BTCPay (needs the right "modify invoices").
// Without that right it expires after 15 minutes; if the customer pays anyway, the register warns.
async function kasseAbbrechen(id) {
  const c = cfg(); const e = kasseEintrag(id);
  if (e.BONID) throw new L.HttpError(409, 'Zu dieser Zahlung gibt es bereits einen Bon.');
  let ungueltig = false;
  try { await call('POST', `/stores/${encodeURIComponent(c.store)}/invoices/${encodeURIComponent(e.BTCPAYID)}/status`, { status: 'Invalid' }, c); ungueltig = true; } catch { /* expires */ }
  L.db().prepare("UPDATE SW_BTCPAY SET STATUS='abgebrochen', GEPRUEFT=? WHERE ID=?").run(L.now(), id);
  return { ungueltig };
}
// Called by the receipt: verify the payment with BTCPay, never trust what the browser shows
async function kasseVerbrauchen(id, betrag) {
  const e = kasseEintrag(id);
  if (e.BONID) throw new L.HttpError(409, 'Diese Krypto-Zahlung wurde bereits für einen Bon verwendet.');
  if (Math.abs(e.BETRAG - Number(betrag)) > 0.005) throw new L.HttpError(409, `Die Krypto-Zahlung lautet über ${e.BETRAG.toFixed(2).replace('.', ',')} €, der Bon über ${Number(betrag).toFixed(2).replace('.', ',')} €.`);
  const s = await kasseStatus(id);
  if (s.status !== 'bezahlt') throw new L.HttpError(409, 'Die Krypto-Zahlung ist bei BTCPay noch nicht als bezahlt gemeldet.');
  return { ...e, METHODE: s.methode };
}
function kasseVerknuepfen(id, bonid) {
  L.db().prepare("UPDATE SW_BTCPAY SET BONID=?, STATUS='bezahlt' WHERE ID=?").run(bonid, id);
}
// Cancelled register payments that the customer paid anyway (last 2 days)
function kasseWarnungen() {
  return L.db().prepare("SELECT ID, BETRAG, ANGELEGT, METHODE FROM SW_BTCPAY WHERE ART='kasse' AND STATUS='bezahlt ohne Bon' AND ANGELEGT >= ? ORDER BY ID DESC").all(L.addDays(L.today(), -2));
}

function liste(rid) {
  return L.db().prepare('SELECT * FROM SW_BTCPAY WHERE RECHNUNGID=? ORDER BY ID DESC').all(rid).map(e => ({ ...info(e), fehler: e.FEHLER, geprueft: e.GEPRUEFT }));
}

module.exports = { cfg, bereit, artenText, kasseStart, kasseStatus, kasseAbbrechen, kasseVerbrauchen, kasseVerknuepfen, kasseWarnungen, test, link, linkFuerBeleg, pruefen, liste, zahlartId, methodeName, ZAHLART_NAME, _call: call };
