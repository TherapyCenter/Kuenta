'use strict';
// Chorus Pro: invoices to French public bodies through the API of the State (PISTE portal).
// Authentication: OAuth 2.0 client credentials of the PISTE application plus the technical Chorus Pro account
// (header cpro-account). The invoice is deposited as Factur-X (syntax IN_DP_E2_CII_FACTURX).
// Routing data is in the Factur-X: buyer SIRET (customer field SIREN/SIRET), service code (customer field
// Leitweg-ID) and commitment number (order number of the invoice).
// Check the endpoints in the PISTE sandbox before going live; they are kept together here.
const fs = require('fs');
const path = require('path');
const L = require('../lib');
const dbm = require('../db');

const URLS = {
  sandbox: { oauth: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token', api: 'https://sandbox-api.piste.gouv.fr' },
  production: { oauth: 'https://oauth.piste.gouv.fr/api/oauth/token', api: 'https://api.piste.gouv.fr' },
};
const RUTAS = { deposer: '/cpro/factures/v1/deposer/flux', compteRendu: '/cpro/transverses/v1/consulterCRDetaille' };
const entorno = () => (L.sw('fr.chorus.entorno', 'sandbox') === 'production' ? 'production' : 'sandbox');
const dir = () => path.join(dbm.DATA_DIR, 'fr');
const acceso = () => { try { return JSON.parse(fs.readFileSync(path.join(dir(), 'chorus.json'), 'utf8'))[entorno()] || {}; } catch { return {}; } };
function guardarAcceso({ clientId, clientSecret, login, password }) {
  if (!clientId || !clientSecret || !login || !password) throw new L.HttpError(400, 'Bitte Client-ID und Secret der PISTE-Anwendung sowie Login und Passwort des technischen Chorus-Pro-Kontos eintragen.');
  let all = {}; try { all = JSON.parse(fs.readFileSync(path.join(dir(), 'chorus.json'), 'utf8')); } catch { /* new */ }
  all[entorno()] = { clientId, clientSecret, login, password };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), 'chorus.json'), JSON.stringify(all, null, 2), { mode: 0o600 });
  return { ok: true };
}

let transporte = null; // tests replace fetch
async function http(method, url, { headers = {}, body } = {}) {
  if (transporte) return transporte(method, url, headers, body);
  const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(60000) });
  return { status: r.status, text: await r.text() };
}
const json = t => { try { return JSON.parse(t); } catch { return null; } };

let token = { valor: null, hasta: 0, entorno: null };
async function accessToken() {
  const a = acceso();
  if (!a.clientId) throw new L.HttpError(400, 'Es sind noch keine Zugangsdaten für Chorus Pro hinterlegt (Einstellungen → France).');
  if (token.valor && token.entorno === entorno() && Date.now() < token.hasta - 60000) return token.valor;
  const r = await http('POST', URLS[entorno()].oauth, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: a.clientId, client_secret: a.clientSecret, scope: 'openid' }).toString() });
  const j = json(r.text);
  if (r.status !== 200 || !j || !j.access_token) throw new L.HttpError(400, `Anmeldung bei PISTE fehlgeschlagen (HTTP ${r.status}${j && j.error_description ? ' – ' + j.error_description : ''}).`);
  token = { valor: j.access_token, hasta: Date.now() + (Number(j.expires_in) || 3600) * 1000, entorno: entorno() };
  return token.valor;
}
async function api(ruta, body) {
  const a = acceso();
  const r = await http('POST', URLS[entorno()].api + ruta, {
    headers: { Authorization: 'Bearer ' + await accessToken(), 'cpro-account': Buffer.from(`${a.login}:${a.password}`).toString('base64'), 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/json;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const j = json(r.text);
  if (r.status !== 200) throw new L.HttpError(400, `Chorus Pro: HTTP ${r.status}${j && (j.libelle || j.message) ? ' – ' + (j.libelle || j.message) : ''}`);
  return j || {};
}

// deposit an invoice as Factur-X
async function deposer(rid, usuario) {
  const z = require('../pdf/belege').zugferd(rid);
  if (z.problems.length) throw new L.HttpError(400, 'Für Chorus Pro fehlen Angaben: ' + z.problems.join(' · '));
  const nombre = `Facture_${z.nr}.pdf`;
  const j = await api(RUTAS.deposer, { fichierFlux: Buffer.from(z.pdf).toString('base64'), nomFichier: nombre, syntaxeFlux: 'IN_DP_E2_CII_FACTURX', avecSignature: false });
  if (j.codeRetour && Number(j.codeRetour) !== 0) throw new L.HttpError(400, `Chorus Pro: ${j.libelle || 'Ablehnung'} (${j.codeRetour})`);
  L.db().prepare('INSERT INTO SW_FR_CHORUS (RECHNUNGID, FLUX, GESENDET, STATUS, ANTWORT, BENUTZER) VALUES (?,?,?,?,?,?)').run(rid, j.numeroFluxDepot || '', L.now(), 'déposé', JSON.stringify(j), usuario || '');
  L.protocol(usuario, 'SW_FR_CHORUS', rid, 'Chorus Pro', { flux: j.numeroFluxDepot });
  return { flux: j.numeroFluxDepot, date: j.dateDepot, libelle: j.libelle };
}
// processing report of a deposit
async function compteRendu(rid) {
  const r = L.db().prepare('SELECT * FROM SW_FR_CHORUS WHERE RECHNUNGID=? ORDER BY ID DESC LIMIT 1').get(rid);
  if (!r || !r.FLUX) throw new L.HttpError(404, 'Diese Rechnung wurde noch nicht an Chorus Pro gesendet.');
  const j = await api(RUTAS.compteRendu, { numeroFluxDepot: r.FLUX, syntaxeFlux: 'IN_DP_E2_CII_FACTURX' });
  const statut = j.etatCourantFlux || j.statut || j.libelle || 'inconnu';
  L.db().prepare('UPDATE SW_FR_CHORUS SET STATUS=?, ANTWORT=? WHERE ID=?').run(statut, JSON.stringify(j), r.ID);
  return { flux: r.FLUX, statut, detail: j };
}
function estado() {
  return { entorno: entorno(), acceso: !!acceso().clientId, envios: L.db().prepare('SELECT c.*, r.RECHNUNGNUMMER FROM SW_FR_CHORUS c LEFT JOIN RECHNUNGEN r ON r.RECHNUNGID=c.RECHNUNGID ORDER BY c.ID DESC LIMIT 100').all() };
}

module.exports = { deposer, compteRendu, estado, guardarAcceso, URLS, RUTAS, _setTransporte(fn) { transporte = fn; token = { valor: null, hasta: 0 }; } };
