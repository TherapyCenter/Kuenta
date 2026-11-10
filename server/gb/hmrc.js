'use strict';
// Making Tax Digital for VAT: connection to the HMRC VAT (MTD) API.
// - OAuth 2.0 (authorization code): the user signs in at HMRC once, Kuenta keeps the tokens (refresh token 18 months)
// - obligations (open and fulfilled periods), submitting the 9-box return, viewing submitted returns
// - fraud prevention headers (connection method DESKTOP_APP_DIRECT: Kuenta runs on the user's own computer)
// The software is registered by its publisher in the HMRC Developer Hub (client ID and secret).
// Tokens, app credentials and the device ID are kept in the data folder under "gb", outside backups.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const L = require('../lib');
const dbm = require('../db');
const GB = require('./index');
const pkg = require('../../package.json');

const BASE = { sandbox: 'https://test-api.service.hmrc.gov.uk', production: 'https://api.service.hmrc.gov.uk' };
const entorno = () => (L.sw('gb.mtd.entorno', 'sandbox') === 'production' ? 'production' : 'sandbox');
const base = () => process.env.KUENTA_HMRC_URL || BASE[entorno()];
const ACCEPT = 'application/vnd.hmrc.1.0+json';

// ---------- files ----------
const dir = () => path.join(dbm.DATA_DIR, 'gb');
const leer = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')); } catch { return def; } };
const escribir = (f, o) => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(path.join(dir(), f), JSON.stringify(o, null, 2), { mode: 0o600 }); };

// app credentials from the Developer Hub (per environment); environment variables take precedence
function app() {
  const e = entorno(); const a = leer('app.json', {})[e] || {};
  return { clientId: process.env.KUENTA_HMRC_CLIENT_ID || a.clientId || '', clientSecret: process.env.KUENTA_HMRC_CLIENT_SECRET || a.clientSecret || '' };
}
function guardarApp({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) throw new L.HttpError(400, 'Bitte Client-ID und Client-Secret aus dem HMRC Developer Hub eintragen.');
  const all = leer('app.json', {}); all[entorno()] = { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() };
  escribir('app.json', all);
  return { ok: true };
}
const redirectUri = (req) => L.sw('gb.mtd.redirect', '') || `http://localhost:${(req && req.headers.host || '').split(':')[1] || process.env.PORT || 3700}/api/gb/oauth/callback`;

// ---------- OAuth ----------
const estados = new Map(); // state → { mandant, redirect, t }
function autorizar(req) {
  const a = app();
  if (!a.clientId) throw new L.HttpError(400, 'Es sind noch keine Zugangsdaten des HMRC Developer Hub hinterlegt.');
  const state = crypto.randomBytes(16).toString('hex');
  const redirect = redirectUri(req);
  estados.set(state, { mandant: dbm.current(), redirect, t: Date.now() });
  for (const [k, v] of estados) if (Date.now() - v.t > 15 * 60000) estados.delete(k);
  const q = new URLSearchParams({ response_type: 'code', client_id: a.clientId, scope: 'read:vat write:vat', state, redirect_uri: redirect });
  return { url: `${base()}/oauth/authorize?${q}`, redirect };
}
async function token(params) {
  const a = app();
  const body = new URLSearchParams({ client_id: a.clientId, client_secret: a.clientSecret, ...params });
  const r = await http('POST', '/oauth/token', { body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, sinAuth: true });
  if (r.status !== 200) throw new L.HttpError(400, `HMRC-Anmeldung fehlgeschlagen: ${(r.json && (r.json.error_description || r.json.error)) || r.status}`);
  const t = r.json;
  const tok = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (Number(t.expires_in) || 14400) * 1000, scope: t.scope, entorno: entorno(), verbunden: L.now() };
  escribir(`token-${entorno()}.json`, tok);
  return tok;
}
// OAuth callback: runs in the tenant that started the sign-in
async function callback(q) {
  const st = estados.get(q.state);
  if (!st) throw new L.HttpError(400, 'Die Anmeldung bei HMRC ist abgelaufen oder ungültig. Bitte erneut verbinden.');
  estados.delete(q.state);
  if (q.error) throw new L.HttpError(400, `HMRC: ${q.error_description || q.error}`);
  return dbm.runAs(st.mandant, () => token({ grant_type: 'authorization_code', code: q.code, redirect_uri: st.redirect }));
}
async function accessToken() {
  let t = leer(`token-${entorno()}.json`, null);
  if (!t || !t.refresh_token) throw new L.HttpError(401, 'Kuenta ist nicht mit HMRC verbunden. Bitte unter Einstellungen → United Kingdom / MTD verbinden.');
  if (Date.now() > t.expires_at - 60000) t = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  return t.access_token;
}
function desconectar() { try { fs.unlinkSync(path.join(dir(), `token-${entorno()}.json`)); } catch { /* not connected */ } return { ok: true }; }

// ---------- fraud prevention headers (DESKTOP_APP_DIRECT) ----------
const enc = s => encodeURIComponent(String(s ?? ''));
function deviceId() {
  const f = path.join(dir(), 'device-id.txt');
  try { const s = fs.readFileSync(f, 'utf8').trim(); if (s) return s; } catch { /* new */ }
  const id = crypto.randomUUID(); fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(f, id); return id;
}
function zona() {
  const off = -new Date().getTimezoneOffset(); const a = Math.abs(off); const p = n => String(n).padStart(2, '0');
  return `UTC${off >= 0 ? '+' : '-'}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}
// client = information from the browser window that starts the request (screens, window size)
function cabeceras(client = {}, usuario) {
  const nets = Object.values(os.networkInterfaces()).flat().filter(n => n && !n.internal);
  const ips = [...new Set(nets.map(n => n.address))];
  const macs = [...new Set(nets.map(n => n.mac).filter(m => m && m !== '00:00:00:00:00:00'))];
  let osUser = ''; try { osUser = os.userInfo().username; } catch { /* no user */ }
  const screens = (Array.isArray(client.screens) && client.screens.length ? client.screens : [{ width: 1920, height: 1080, scaling: 1, colourDepth: 24 }])
    .map(s => `width=${Number(s.width) || 0}&height=${Number(s.height) || 0}&scaling-factor=${Number(s.scaling) || 1}&colour-depth=${Number(s.colourDepth) || 24}`).join(',');
  const w = client.window || {};
  const h = {
    'Gov-Client-Connection-Method': 'DESKTOP_APP_DIRECT',
    'Gov-Client-Device-ID': deviceId(),
    'Gov-Client-User-IDs': [`os=${enc(osUser)}`, usuario ? `kuenta=${enc(usuario)}` : null].filter(Boolean).join('&'),
    'Gov-Client-Timezone': zona(),
    'Gov-Client-Local-IPs': ips.map(enc).join(','),
    'Gov-Client-Local-IPs-Timestamp': new Date().toISOString(),
    'Gov-Client-MAC-Addresses': macs.map(enc).join(','),
    'Gov-Client-Screens': screens,
    'Gov-Client-Window-Size': `width=${Number(w.width) || 0}&height=${Number(w.height) || 0}`,
    'Gov-Client-User-Agent': `os-family=${enc(os.type())}&os-version=${enc(os.release())}&device-manufacturer=${enc(process.env.KUENTA_DEVICE_MANUFACTURER || '')}&device-model=${enc(process.env.KUENTA_DEVICE_MODEL || os.hostname())}`,
    'Gov-Vendor-Version': `Kuenta=${enc(pkg.version)}`,
    'Gov-Vendor-Product-Name': 'Kuenta',
  };
  for (const k of Object.keys(h)) if (h[k] === '') delete h[k];
  return h;
}

// ---------- HTTP ----------
let transporte = null; // tests replace fetch
async function http(method, ruta, { body, headers = {}, sinAuth = false, client, usuario } = {}) {
  const hd = { Accept: ACCEPT, ...headers };
  if (!sinAuth) { hd.Authorization = 'Bearer ' + await accessToken(); Object.assign(hd, cabeceras(client, usuario)); }
  if (body && !hd['Content-Type']) hd['Content-Type'] = 'application/json';
  const url = base() + ruta;
  const res = transporte ? await transporte(method, url, hd, body) : await fetch(url, { method, headers: hd, body, signal: AbortSignal.timeout(60000) }).then(async r => ({ status: r.status, text: await r.text(), headers: r.headers }));
  let json = null; try { json = res.text ? JSON.parse(res.text) : null; } catch { /* not JSON */ }
  return { status: res.status, json, text: res.text };
}
function fallo(r, que) {
  const j = r.json || {};
  const errs = [j.message, ...(j.errors || []).map(e => e.message)].filter(Boolean).join(' · ');
  return new L.HttpError(r.status === 401 ? 401 : 400, `${que}: HMRC ${r.status}${j.code ? ' ' + j.code : ''}${errs ? ' – ' + errs : ''}`);
}
function vrn() {
  const v = GB.vrn();
  if (!v) throw new L.HttpError(400, 'Die VAT-Nummer der Firma fehlt oder ist ungültig (Einstellungen → Firmendaten → USt-IdNr.).');
  return v;
}

// open and fulfilled periods from 'from' to 'to'
async function obligaciones({ from, to, status } = {}, ctx = {}) {
  const q = new URLSearchParams({ from: from || `${new Date().getFullYear() - 1}-01-01`, to: to || L.today() });
  if (status) q.set('status', status);
  const r = await http('GET', `/organisations/vat/${vrn()}/obligations?${q}`, ctx);
  if (r.status === 404) return [];
  if (r.status !== 200) throw fallo(r, 'Zeiträume abrufen');
  return (r.json && r.json.obligations) || [];
}

// submit the return of a period: the figures are calculated by Kuenta and confirmed by the user
async function enviar({ periodKey, start, end, confirmado }, ctx = {}) {
  if (!confirmado) throw new L.HttpError(400, 'Bitte die Erklärung gegenüber HMRC bestätigen.');
  if (!periodKey) throw new L.HttpError(400, 'Zeitraum fehlt.');
  const calc = require('./vat').calcular({ von: start, bis: end });
  const body = { periodKey, ...calc.boxes, finalised: true };
  const r = await http('POST', `/organisations/vat/${vrn()}/returns`, { ...ctx, body: JSON.stringify(body) });
  if (r.status !== 201 && r.status !== 200) throw fallo(r, 'VAT return einreichen');
  const d = L.db();
  d.prepare('INSERT INTO SW_GB_RETURNS (PERIODKEY, VON, BIS, BOXES, ENTORNO, GESENDET, ANTWORT, BENUTZER) VALUES (?,?,?,?,?,?,?,?)')
    .run(periodKey, start, end, JSON.stringify(body), entorno(), L.now(), JSON.stringify(r.json || {}), ctx.usuario || '');
  L.protocol(ctx.usuario, 'SW_GB_RETURNS', periodKey, 'eingereicht', { ...body, antwort: r.json });
  return { ...(r.json || {}), boxes: body };
}

async function verReturn(periodKey, ctx = {}) {
  const r = await http('GET', `/organisations/vat/${vrn()}/returns/${encodeURIComponent(periodKey)}`, ctx);
  if (r.status !== 200) throw fallo(r, 'VAT return abrufen');
  return r.json;
}

// sandbox only: HMRC checks the fraud prevention headers
async function probarCabeceras(ctx = {}) {
  const r = await http('GET', '/test/fraud-prevention-headers/validate', ctx);
  if (r.status !== 200) throw fallo(r, 'Header-Prüfung');
  return r.json;
}

function estado() {
  const t = leer(`token-${entorno()}.json`, null); const a = app();
  return {
    activo: GB.activo(), entorno: entorno(), vrn: GB.vrn(), app: !!a.clientId, conectado: !!(t && t.refresh_token), verbunden: t && t.verbunden,
    schema: GB.schema(), registrado: GB.registrado(), redirect: redirectUri(),
    enviadas: L.db().prepare('SELECT ID, PERIODKEY, VON, BIS, ENTORNO, GESENDET, ANTWORT, BENUTZER FROM SW_GB_RETURNS ORDER BY ID DESC LIMIT 50').all(),
  };
}

module.exports = { autorizar, callback, obligaciones, enviar, verReturn, probarCabeceras, estado, guardarApp, desconectar, cabeceras, _setTransporte(fn) { transporte = fn; } };
