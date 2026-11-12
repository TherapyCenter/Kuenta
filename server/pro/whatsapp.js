'use strict';
// KuentaPOS Pro – not open source. Use only with a valid KuentaPOS Pro license, see server/pro/LICENSE.md.
//
// WhatsApp Business via the WhatsApp Cloud API of Meta (graph.facebook.com).
// Messages that the business starts (reminders, documents, "vehicle ready") must use message templates
// approved by Meta. KuentaPOS fills their body variables in a fixed order (see PARAMETER).
const L = require('../lib');
const LIZENZ = require('../lizenz');
const SMS = require('./sms');

const BASIS = () => (process.env.KUENTAPOS_WHATSAPP_URL || 'https://graph.facebook.com').replace(/\/+$/, '');

// order of the body variables {{1}}, {{2}} … of the templates (shown in the settings as well)
const PARAMETER = {
  erinnerung: ['Name', 'Terminart', 'Kennzeichen', 'Termin', 'Firma', 'Telefon'],
  beleg: ['Name', 'Vorgang', 'Nummer', 'Firma'],
  fertig: ['Name', 'Kennzeichen', 'Firma', 'Telefon'],
};
// language code of the templates by document language
const SPRACHE = { de: 'de', en: 'en', es: 'es', fr: 'fr', it: 'it', nl: 'nl' };

function einstellungen() {
  const { docLang } = require('../i18n');
  return {
    nummerId: L.sw('whatsapp.nummerid', '').trim(),
    token: L.sw('whatsapp.token', '').trim(),
    version: L.sw('whatsapp.version', '').trim() || 'v21.0',
    sprache: L.sw('whatsapp.sprache', '').trim() || SPRACHE[docLang()] || 'de',
    vorlagen: {
      erinnerung: L.sw('whatsapp.vorlage.erinnerung', '').trim() || 'fahrzeugtermin',
      beleg: L.sw('whatsapp.vorlage.beleg', '').trim() || 'beleg',
      fertig: L.sw('whatsapp.vorlage.fertig', '').trim() || 'fahrzeug_fertig',
    },
  };
}
const eingerichtet = () => { const c = einstellungen(); return !!(c.nummerId && c.token); };

function pruefen(c) {
  LIZENZ.brauche('whatsapp');
  if (!c.nummerId || !c.token) throw new L.HttpError(400, 'WhatsApp Business ist nicht eingerichtet (Einstellungen → WhatsApp & Telegram).');
}

async function aufruf(c, pfad, opts) {
  let r;
  try { r = await fetch(`${BASIS()}/${c.version}/${c.nummerId}/${pfad}`, { ...opts, headers: { Authorization: 'Bearer ' + c.token, ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) }); }
  catch (e) { throw new Error(`WhatsApp nicht erreichbar (${e.cause && e.cause.code ? e.cause.code : e.message}).`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const f = j.error || {};
    throw new Error(`WhatsApp meldet Fehler ${f.code || r.status}: ${f.error_data && f.error_data.details ? f.error_data.details : f.message || r.statusText}`);
  }
  return j;
}

// number for the API: international without "+"
function empfaenger(an) {
  const n = SMS.nummer(an);
  if (!n) throw new L.HttpError(400, `„${an}“ ist keine gültige Rufnummer.`);
  return n;
}

// template message; werte = values in the order of PARAMETER[art]
async function vorlageSenden(an, art, werte, dokument) {
  const c = einstellungen(); pruefen(c);
  const n = empfaenger(an);
  const components = [];
  if (dokument) components.push({ type: 'header', parameters: [{ type: 'document', document: { id: dokument.id, filename: dokument.filename } }] });
  // Meta rejects empty variables
  if (werte && werte.length) components.push({ type: 'body', parameters: werte.map(w => ({ type: 'text', text: String(w ?? '').trim() || '-' })) });
  const j = await aufruf(c, 'messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: n.slice(1), type: 'template', template: { name: c.vorlagen[art] || art, language: { code: c.sprache }, components } }),
  });
  return { ok: true, an: n, id: j.messages && j.messages[0] ? j.messages[0].id : null };
}

// PDF to Meta's media storage; returns the media id for the template header
async function hochladen(buf, filename) {
  const c = einstellungen(); pruefen(c);
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', 'application/pdf');
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), filename);
  const j = await aufruf(c, 'media', { method: 'POST', body: fd });
  return { id: j.id, filename };
}

const werteAus = (art, w) => PARAMETER[art].map(k => w[k]);

async function erinnerung(an, w) { return vorlageSenden(an, 'erinnerung', werteAus('erinnerung', w)); }
async function fertig(an, w) { return vorlageSenden(an, 'fertig', werteAus('fertig', w)); }
async function beleg(an, w, pdf, filename) { const dok = await hochladen(pdf, filename); return vorlageSenden(an, 'beleg', werteAus('beleg', w), dok); }
// "hello_world" exists in every WhatsApp Business account (English)
async function test(an) {
  const c = einstellungen(); pruefen(c);
  const n = empfaenger(an);
  const j = await aufruf(c, 'messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: n.slice(1), type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } }) });
  return { ok: true, an: n, id: j.messages && j.messages[0] ? j.messages[0].id : null };
}

module.exports = { einstellungen, eingerichtet, erinnerung, fertig, beleg, test, hochladen, PARAMETER };
