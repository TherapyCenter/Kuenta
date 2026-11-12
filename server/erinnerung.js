'use strict';
// Reminders of vehicle due dates (HU, service, …) by email and SMS, with a log against double sending
const L = require('./lib');
const MAIL = require('./mail');
const SMS = require('./pro/sms');
const LIZENZ = require('./lizenz');
const { D, Dt, docLang } = require('./i18n');

const VORLAGE = {
  betreff: 'Erinnerung: {Terminart} für Ihr Fahrzeug {Kennzeichen}',
  text: '{Briefanrede}\n\nfür Ihr Fahrzeug {Fahrzeug} mit dem Kennzeichen {Kennzeichen} steht am {Termin} die {Terminart} an.\n\n'
    + 'Gerne übernehmen wir das für Sie. Vereinbaren Sie einfach einen Termin unter {Telefon}.\n\nMit freundlichen Grüßen\n{Firma}',
  sms: '{Firma}: Für Ihr Fahrzeug {Kennzeichen} ist am {Termin} die {Terminart} fällig. Termin unter {Telefon}.',
};
// Name used in the text (the list name "HU (Hauptuntersuchung)" reads badly in a sentence)
const TERMINART = { HU: 'Hauptuntersuchung (HU)', NAECHSTEINS: 'Inspektion', NAECHSTESP: 'Sicherheitsprüfung (SP)', NAECHSTE57B: 'Prüfung nach § 57b', NAECHSTEUVV: 'UVV-Prüfung', KLIMA: 'Klimaservice' };

// salutation and texts in the document language (Settings → Defaults)
function briefanrede(a, name) {
  a = String(a || '').trim();
  if (/^herr/i.test(a)) return D(`Sehr geehrter ${a} ${name},`);
  if (/^frau/i.test(a)) return D(`Sehr geehrte ${a} ${name},`);
  return D('Sehr geehrte Damen und Herren,');
}
const datum = iso => iso ? [String(iso).slice(8, 10), String(iso).slice(5, 7), String(iso).slice(0, 4)].join(docLang() === 'de' ? '.' : '/') : '';

function platzhalter(text, r, feld, bezeichnung) {
  const f = L.firma();
  const w = {
    Briefanrede: briefanrede(r.ANREDE, r.NAME || ''), Anrede: D(r.ANREDE || ''), Name: r.NAME || '', Vorname: r.VORNAME || '',
    Kennzeichen: r.KENNZEICHEN || '', Fahrzeug: [r.MARKE, r.MODELL].filter(Boolean).join(' '), Termin: datum(r.TERMIN),
    Terminart: D(TERMINART[feld] || bezeichnung || ''), Firma: f.FIRMENNAME || '', Telefon: f.TELEFON || '',
  };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => w[k] ?? m);
}

function vorlagen() {
  return { betreff: L.sw('erinnerung.betreff', '') || Dt(VORLAGE.betreff), text: L.sw('erinnerung.text', '') || Dt(VORLAGE.text), sms: L.sw('erinnerung.sms', '') || Dt(VORLAGE.sms) };
}

function protokoll(e) {
  L.db().prepare('INSERT INTO SW_ERINNERUNGEN (ZEIT, FAHRID, KUNID, ART, TERMIN, KANAL, AN, STATUS, FEHLER, BENUTZER) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(L.now(), e.fahrid, e.kunid || null, e.art, e.termin || null, e.kanal, e.an || null, e.status, e.fehler || null, e.benutzer || null);
}

// recipient, and the reason if not possible
function empfaenger(r, kanal) {
  if (Number(r.KEINEERINNERUNG) === 1) return { grund: 'möchte keine Erinnerungen' };
  if (!r.KUNID) return { grund: 'kein Halter' };
  if (kanal === 'email') return /\S+@\S+\.\S+/.test(r.EMAIL || '') ? { an: String(r.EMAIL).trim() } : { grund: 'keine E-Mail-Adresse' };
  const n = SMS.mobilnummer(r.MOBIL, r.TELEFON);
  return n ? { an: n } : { grund: 'keine Mobilnummer' };
}

// Sending to the selected vehicles of the due date list
async function senden({ feld, von, bis, fahrids, kanal, user, offenAm }) {
  const FI = require('./api/finanzen');
  if (!['email', 'sms'].includes(kanal)) throw new L.HttpError(400, 'Unbekannter Versandweg.');
  if (kanal === 'sms') LIZENZ.brauche('sms');
  const liste = FI.fahrzeugtermine({ feld, von, bis });
  const ids = new Set((fahrids || []).map(Number));
  const rows = liste.rows.filter(r => ids.has(Number(r.FAHR_ID)));
  if (!rows.length) throw new L.HttpError(400, 'Keine Fahrzeuge ausgewählt.');
  const v = vorlagen();
  const viaProgramm = kanal === 'email' && L.sw('mail.versand', 'smtp') === 'programm';
  if (kanal === 'sms' && !SMS.einstellungen().url) throw new L.HttpError(400, 'Es ist kein SMS-Gateway eingerichtet (Einstellungen → Erinnerungen & SMS).');
  if (viaProgramm) {
    const MC = require('./mailclient');
    if (!offenAm || !MC.isLocalRequest(offenAm)) throw new L.HttpError(400, 'Das Mailprogramm kann nur an dem Rechner geöffnet werden, auf dem KuentaPOS läuft. Für Sammel-Erinnerungen bitte den direkten Versand (SMTP) wählen.');
    const n = rows.filter(r => empfaenger(r, 'email').an).length;
    if (n > 20) throw new L.HttpError(400, `Das wären ${n} Fenster im Mailprogramm. Bitte höchstens 20 auf einmal auswählen oder unter Einstellungen → E-Mail den direkten Versand (SMTP) wählen.`);
  }
  const out = { gesendet: 0, uebersprungen: [], fehler: [] };
  for (const r of rows) {
    const e = empfaenger(r, kanal);
    const basis = { fahrid: r.FAHR_ID, kunid: r.KUNID, art: liste.feld, termin: r.TERMIN, kanal, benutzer: user };
    if (!e.an) { out.uebersprungen.push({ kennzeichen: r.KENNZEICHEN, grund: e.grund }); continue; }
    try {
      if (kanal === 'email') {
        const mail = { to: e.an, subject: platzhalter(v.betreff, r, liste.feld, liste.bezeichnung), text: platzhalter(v.text, r, liste.feld, liste.bezeichnung) };
        if (viaProgramm) require('./mailclient').open(mail); else await MAIL.send(mail);
        MAIL.log({ to: e.an, subject: mail.subject, bezug: 'ERINNERUNG', bezugId: r.FAHR_ID, status: viaProgramm ? 'an Mailprogramm übergeben' : 'gesendet', user });
      } else {
        await SMS.senden(e.an, platzhalter(v.sms, r, liste.feld, liste.bezeichnung));
      }
      protokoll({ ...basis, an: e.an, status: viaProgramm ? 'übergeben' : 'gesendet' });
      out.gesendet++;
    } catch (err) {
      protokoll({ ...basis, an: e.an, status: 'Fehler', fehler: err.message });
      out.fehler.push({ kennzeichen: r.KENNZEICHEN, fehler: err.message });
      if (kanal === 'email' && !viaProgramm) MAIL.log({ to: e.an, subject: platzhalter(v.betreff, r, liste.feld, liste.bezeichnung), bezug: 'ERINNERUNG', bezugId: r.FAHR_ID, status: 'Fehler', fehler: err.message, user });
      // gateway/server completely unreachable: do not wait again for every recipient
      if (/nicht erreichbar|kein Mailserver|Keine Verbindung|Verbindung zu/.test(err.message)) { out.abgebrochen = true; break; }
    }
  }
  return out;
}

// Log printed reminder letters as well
function briefeProtokollieren({ feld, von, bis, fahrids, user }) {
  const FI = require('./api/finanzen');
  const liste = FI.fahrzeugtermine({ feld, von, bis });
  const ids = new Set((fahrids || []).map(Number));
  let n = 0;
  for (const r of liste.rows) if (ids.has(Number(r.FAHR_ID))) { protokoll({ fahrid: r.FAHR_ID, kunid: r.KUNID, art: liste.feld, termin: r.TERMIN, kanal: 'brief', status: 'gedruckt', benutzer: user }); n++; }
  return { ok: true, anzahl: n };
}

module.exports = { senden, briefeProtokollieren, platzhalter, vorlagen, empfaenger, VORLAGE };
