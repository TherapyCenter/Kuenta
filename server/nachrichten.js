'use strict';
// Messages to customers by WhatsApp Business, Telegram and SMS: documents as PDF and "vehicle ready".
// The channels themselves are Pro add-ons (server/pro); this file only prepares texts and recipients and keeps the log.
const L = require('./lib');
const LIZENZ = require('./lizenz');
const SMS = require('./pro/sms');
const WA = require('./pro/whatsapp');
const TG = require('./pro/telegram');
const { D, Dt, docLang, I18N } = require('./i18n');

const KANAELE = ['whatsapp', 'telegram', 'sms'];
const NAME = { whatsapp: 'WhatsApp', telegram: 'Telegram', sms: 'SMS' };

const VORLAGE = {
  fertig: 'Guten Tag {Name}, Ihr Fahrzeug {Kennzeichen} ist fertig und kann abgeholt werden. Bei Fragen erreichen Sie uns unter {Telefon}.\n{Firma}',
  beleg: '{Vorgang} Nr. {Nummer} von {Firma}',
};
function vorlagen() {
  return { fertig: L.sw('nachricht.fertig', '') || Dt(VORLAGE.fertig), beleg: L.sw('nachricht.beleg', '') || Dt(VORLAGE.beleg) };
}
const fuellen = (text, w) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => w[k] ?? m);

// which channels can be used right now (license and settings)
function kanaele() {
  return {
    whatsapp: { lizenz: LIZENZ.hat('whatsapp'), eingerichtet: WA.eingerichtet() },
    telegram: { lizenz: LIZENZ.hat('telegram'), eingerichtet: TG.eingerichtet() },
    sms: { lizenz: LIZENZ.hat('sms'), eingerichtet: !!SMS.einstellungen().url },
  };
}
function brauche(kanal) {
  if (!KANAELE.includes(kanal)) throw new L.HttpError(400, 'Unbekannter Versandweg.');
  LIZENZ.brauche(kanal);
}

const kunde = kunid => kunid ? L.db().prepare('SELECT KUNID, ANREDE, VORNAME, NAME, TELEFON, MOBIL, TELEGRAM_CHATID, TELEGRAM_NAME FROM KUNDEN WHERE KUNID=?').get(kunid) : null;
const kundenname = (k, ersatz) => (k ? [k.VORNAME, k.NAME].filter(Boolean).join(' ') : '') || ersatz || '';

// recipient per channel: mobile number, or the Telegram chat
function empfaenger(k) {
  const mobil = k ? SMS.mobilnummer(k.MOBIL, k.TELEFON) : null;
  return { whatsapp: mobil, sms: mobil, telegram: k && k.TELEGRAM_CHATID ? (k.TELEGRAM_NAME || 'verbunden') : null };
}

function protokoll(e) {
  L.db().prepare('INSERT INTO SW_NACHRICHTEN (ZEIT, KANAL, ART, AN, KUNID, BEZUG, BEZUGID, TEXT, STATUS, FEHLER, BENUTZER) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(L.now(), e.kanal, e.art, e.an || null, e.kunid || null, e.bezug || null, e.bezugId || null, e.text || null, e.status, e.fehler || null, e.benutzer || null);
}

// sends and logs; "werte" are the template values (WhatsApp), "text" the free text (Telegram, SMS)
async function zustellen({ kanal, art, k, an, text, werte, pdf, bezug, bezugId, benutzer }) {
  brauche(kanal);
  const eintrag = { kanal, art, kunid: k && k.KUNID, bezug, bezugId, benutzer };
  let ziel = an;
  try {
    let r;
    if (kanal === 'telegram') {
      if (!k || !k.TELEGRAM_CHATID) throw new L.HttpError(400, 'Der Kunde ist noch nicht mit Telegram verbunden.');
      ziel = k.TELEGRAM_NAME || k.TELEGRAM_CHATID;
      r = pdf ? await TG.dokument(k.TELEGRAM_CHATID, pdf.buf, pdf.name, text) : await TG.nachricht(k.TELEGRAM_CHATID, text);
    } else {
      if (!String(an || '').trim()) throw new L.HttpError(400, 'Für den Kunden ist keine Mobilnummer hinterlegt.');
      if (kanal === 'whatsapp') {
        r = art === 'beleg' ? await WA.beleg(an, werte, pdf.buf, pdf.name) : art === 'fertig' ? await WA.fertig(an, werte) : await WA.erinnerung(an, werte);
        text = WA.PARAMETER[art].map(p => `${p}: ${werte[p] ?? ''}`).join(' · ');
      } else {
        if (pdf) throw new L.HttpError(400, 'Per SMS lassen sich keine Belege senden.');
        r = await SMS.senden(an, text);
      }
      ziel = r.an || an;
    }
    protokoll({ ...eintrag, an: ziel, text: pdf ? `${pdf.name}${text ? ' · ' + text : ''}` : text, status: 'gesendet' });
    return { ok: true, kanal, an: ziel };
  } catch (e) {
    protokoll({ ...eintrag, an: ziel, text, status: 'Fehler', fehler: e.message });
    throw e;
  }
}

// ---------- "vehicle ready" (from a work order) ----------
function fertigDaten(auftragid) {
  const a = L.db().prepare('SELECT AUFTRAGID, AUFTRAGNUMMER, KUNID, KUNNAME, FAHRKENNZEICHEN FROM AUFTRAEGE WHERE AUFTRAGID=?').get(auftragid);
  if (!a) throw new L.HttpError(404, 'Auftrag nicht gefunden.');
  const k = kunde(a.KUNID); const f = L.firma();
  const w = { Name: kundenname(k, a.KUNNAME), Kennzeichen: a.FAHRKENNZEICHEN || '', Firma: f.FIRMENNAME || '', Telefon: f.TELEFON || '' };
  return { a, k, w };
}
function fertigVorschau(auftragid) {
  const { a, k, w } = fertigDaten(auftragid);
  return { auftrag: a.AUFTRAGNUMMER, kunid: a.KUNID || null, kunde: w.Name, kennzeichen: w.Kennzeichen, text: fuellen(vorlagen().fertig, w), empfaenger: empfaenger(k), kanaele: kanaele(), vorlage: WA.einstellungen().vorlagen.fertig };
}
async function fertigSenden({ auftragid, kanal, an, text, benutzer }) {
  const { a, k, w } = fertigDaten(auftragid);
  if (!a.KUNID) throw new L.HttpError(400, 'Der Auftrag hat keinen Kunden.');
  return zustellen({ kanal, art: 'fertig', k, an, text: String(text || '').trim() || fuellen(vorlagen().fertig, w), werte: w, bezug: 'auftrag', bezugId: a.AUFTRAGID, benutzer });
}

// ---------- documents as PDF (quote, order, delivery note, invoice …) ----------
function belegDaten(typ, id) {
  const { V } = require('../public/js/entities.js');
  const v = V[typ]; if (!v) throw new L.HttpError(400, 'Unbekannte Belegart.');
  const kk = require('./api/vorgang').load(typ, id).kopf;
  const k = kunde(kk.KUNID); const f = L.firma();
  const betrag = new Intl.NumberFormat(I18N.locale(docLang()), { style: 'currency', currency: L.waehrung() }).format(kk.GBRUTTO || 0);
  const w = { Name: kundenname(k, kk.KUNNAME), Vorgang: D(v.title), Nummer: String(kk[v.nr] ?? ''), Firma: f.FIRMENNAME || '', Telefon: f.TELEFON || '', Betrag: betrag };
  return { v, kk, k, w };
}
function belegVorschau(typ, id) {
  const { kk, k, w } = belegDaten(typ, id);
  return { kunid: kk.KUNID || null, kunde: w.Name, vorgang: w.Vorgang, nummer: w.Nummer, text: fuellen(vorlagen().beleg, w), empfaenger: empfaenger(k), kanaele: kanaele(), vorlage: WA.einstellungen().vorlagen.beleg };
}
async function belegSenden({ typ, id, kanal, an, text, benutzer, pdf }) {
  if (kanal === 'sms') throw new L.HttpError(400, 'Per SMS lassen sich keine Belege senden.');
  const { v, kk, k, w } = belegDaten(typ, id);
  if (!kk.KUNID) throw new L.HttpError(400, 'Der Beleg hat keinen Kunden.');
  const r = await zustellen({ kanal, art: 'beleg', k, an, text: String(text || '').trim() || fuellen(vorlagen().beleg, w), werte: w, pdf, bezug: typ, bezugId: Number(id), benutzer });
  L.db().prepare(`UPDATE ${v.table} SET GEDRUCKT=1 WHERE ${v.pk}=?`).run(id);
  return r;
}

const liste = () => L.db().prepare(`SELECT n.*, TRIM(COALESCE(k.VORNAME,'') || ' ' || COALESCE(k.NAME,'')) KUNDE FROM SW_NACHRICHTEN n
  LEFT JOIN KUNDEN k ON k.KUNID=n.KUNID ORDER BY n.ID DESC LIMIT 1000`).all();

module.exports = { KANAELE, NAME, VORLAGE, vorlagen, kanaele, empfaenger, zustellen, fertigVorschau, fertigSenden, belegVorschau, belegSenden, liste, kunde, kundenname };
