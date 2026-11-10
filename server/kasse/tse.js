'use strict';
// Technical security device (KassenSichV) via the cloud TSE "fiskaly SIGN DE" (API v2)
const crypto = require('crypto');
const L = require('../lib');

const BASE = () => L.sw('tse.url', 'https://kassensichv-middleware.fiskaly.com/api/v2');
let token = null; let tokenExp = 0;

function cfg() {
  return { aktiv: L.sw('tse.aktiv', '0') === '1', key: L.sw('tse.apikey', ''), secret: L.sw('tse.apisecret', ''), tss: L.sw('tse.tssid', ''), client: L.sw('tse.clientid', ''), adminPin: L.sw('tse.adminpin', ''), serial: L.sw('tse.seriennummer', '') };
}

async function call(method, path, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + await getToken();
  const res = await fetch(BASE() + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) { const e = new Error(`TSE-Fehler ${res.status}: ${data.message || data.error || text.slice(0, 200)}`); e.status = res.status; throw e; }
  return data;
}
async function getToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const c = cfg();
  if (!c.key || !c.secret) throw new Error('Für die TSE sind API-Key und API-Secret einzutragen (Einstellungen → Kasse → KassenSichV).');
  const r = await call('POST', '/auth', { api_key: c.key, api_secret: c.secret }, false);
  token = r.access_token; tokenExp = Date.now() + (Number(r.access_token_expires_in) || 300) * 1000;
  return token;
}

// Initial setup: create the TSS, initialise it, register the client
async function einrichten({ adminPin }) {
  if (!adminPin || String(adminPin).length < 6) throw new L.HttpError(400, 'Die Admin-PIN muss mindestens 6 Zeichen lang sein.');
  token = null;
  const tssId = L.sw('tse.tssid', '') || crypto.randomUUID();
  let tss = await call('PUT', `/tss/${tssId}`, { metadata: { kasse: 'Kuenta' } });
  L.setSw('tse.tssid', tssId);
  if (tss.admin_puk) L.setSw('tse.adminpuk', tss.admin_puk);
  if (tss.state === 'CREATED') tss = await call('PATCH', `/tss/${tssId}`, { state: 'UNINITIALIZED' });
  if (tss.state === 'UNINITIALIZED') {
    await call('PATCH', `/tss/${tssId}/admin`, { admin_puk: L.sw('tse.adminpuk', ''), new_admin_pin: String(adminPin) });
    await call('POST', `/tss/${tssId}/admin/auth`, { admin_pin: String(adminPin) });
    tss = await call('PATCH', `/tss/${tssId}`, { state: 'INITIALIZED' });
  }
  L.setSw('tse.adminpin', String(adminPin));
  const clientId = L.sw('tse.clientid', '') || crypto.randomUUID();
  const serial = L.sw('kasse.seriennummer', '') || ('SW-' + crypto.randomBytes(4).toString('hex').toUpperCase());
  await call('PUT', `/tss/${tssId}/client/${clientId}`, { serial_number: serial });
  try { await call('POST', `/tss/${tssId}/admin/logout`, {}); } catch { /* optional */ }
  L.setSw('tse.clientid', clientId); L.setSw('kasse.seriennummer', serial);
  L.setSw('tse.seriennummer', tss.serial_number || ''); L.setSw('tse.publickey', tss.public_key || '');
  L.setSw('tse.signaturalgorithmus', tss.signature_algorithm || ''); L.setSw('tse.zeitformat', tss.signature_timestamp_format || 'unixTime');
  L.setSw('tse.zertifikat', tss.certificate || ''); L.setSw('tse.aktiv', '1'); L.setSw('tse.aktiviertam', L.now());
  return { tss: tssId, client: clientId, serial: tss.serial_number, state: tss.state, puk: L.sw('tse.adminpuk', '') };
}

async function status() {
  const c = cfg();
  if (!c.tss) return { eingerichtet: false };
  const t = await call('GET', `/tss/${c.tss}`);
  return { eingerichtet: true, state: t.state, serial: t.serial_number, algorithmus: t.signature_algorithm, signaturzaehler: t.signature_counter, transaktionszaehler: t.transaction_counter };
}

const VAT = { 19: 'NORMAL', 7: 'REDUCED_1', 10.7: 'SPECIAL_RATE_1', 5.5: 'SPECIAL_RATE_2', 0: 'NULL' };
// Sign a receipt: returns the TSE data, or an error text on failure (the register may keep running)
async function signieren({ receiptType = 'RECEIPT', ustSummen = {}, zahlarten = {} }) {
  const c = cfg();
  if (!c.aktiv) return null;
  const txId = crypto.randomUUID();
  try {
    await call('PUT', `/tss/${c.tss}/tx/${txId}?tx_revision=1`, { state: 'ACTIVE', client_id: c.client });
    const receipt = {
      receipt_type: receiptType,
      amounts_per_vat_rate: Object.entries(ustSummen).filter(([, v]) => Math.abs(v) > 0.0049).map(([satz, v]) => ({ vat_rate: VAT[Number(satz)] || 'NULL', amount: Number(v).toFixed(2) })),
      amounts_per_payment_type: Object.entries(zahlarten).filter(([, v]) => Math.abs(v) > 0.0049).map(([art, v]) => ({ payment_type: art === 'BAR' ? 'CASH' : 'NON_CASH', amount: Number(v).toFixed(2) })),
    };
    if (!receipt.amounts_per_vat_rate.length) receipt.amounts_per_vat_rate.push({ vat_rate: 'NULL', amount: '0.00' });
    if (!receipt.amounts_per_payment_type.length) receipt.amounts_per_payment_type.push({ payment_type: 'CASH', amount: '0.00' });
    const t = await call('PUT', `/tss/${c.tss}/tx/${txId}?tx_revision=2`, { state: 'FINISHED', client_id: c.client, schema: { standard_v1: { receipt } } });
    return {
      TSE_TXID: txId, TSE_TXNR: t.number, TSE_START: unix(t.time_start), TSE_ENDE: unix(t.time_end), TSE_SIGNATUR: t.signature && t.signature.value,
      TSE_ZAEHLER: t.signature && t.signature.counter, TSE_SERIAL: t.tss_serial_number, TSE_ALGO: t.signature && t.signature.algorithm, TSE_ZEITFORMAT: (t.log && t.log.timestamp_format) || 'unixTime',
      TSE_PUBKEY: t.signature && t.signature.public_key, TSE_QR: t.qr_code_data, TSE_VORGANGSART: 'Kassenbeleg-V1', TSE_DATEN: t.process_data ? Buffer.from(t.process_data, 'base64').toString('utf8') : null,
    };
  } catch (e) {
    return { TSE_TXID: txId, TSE_FEHLER: 'TSE ausgefallen: ' + e.message, TSE_VORGANGSART: 'Kassenbeleg-V1' };
  }
}
const unix = v => v == null ? null : new Date(Number(v) * 1000).toISOString().replace(/\.\d+Z$/, '.000Z');

// Trigger and download the TSE export (TAR)
async function export_({ von, bis }) {
  const c = cfg(); const id = crypto.randomUUID();
  const q = [von && `start_date=${Math.floor(Date.parse(von) / 1000)}`, bis && `end_date=${Math.floor(Date.parse(bis + 'T23:59:59') / 1000)}`].filter(Boolean).join('&');
  await call('PUT', `/tss/${c.tss}/export/${id}${q ? '?' + q : ''}`, {});
  for (let i = 0; i < 40; i++) {
    const s = await call('GET', `/tss/${c.tss}/export/${id}`);
    if (s.state === 'COMPLETED') {
      const res = await fetch(`${BASE()}/tss/${c.tss}/export/${id}/file`, { headers: { Authorization: 'Bearer ' + await getToken() } });
      return Buffer.from(await res.arrayBuffer());
    }
    if (s.state === 'ERROR' || s.state === 'CANCELLED') throw new Error('TSE-Export fehlgeschlagen: ' + s.state);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('TSE-Export dauert zu lange – bitte später im fiskaly-Dashboard herunterladen.');
}

module.exports = { cfg, einrichten, status, signieren, export: export_, _reset: () => { token = null; } };
