'use strict';
// Swiss QR-bill (Swiss Payment Standards, Implementation Guidelines QR-bill 2.3): data of the Swiss QR code
// and of the payment part with receipt. Structured addresses only (type S), amounts in CHF.
// Reference: with a QR-IBAN the 27-digit QR reference (QRR, modulo 10 recursive), otherwise the
// creditor reference ISO 11649 (SCOR, "RF..") from the invoice number, or none (NON).
const L = require('../lib');

const clean = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();
const ibanRoh = s => String(s || '').replace(/\s/g, '').toUpperCase();

function ibanOk(iban) {
  const x = ibanRoh(iban);
  if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(x)) return false;
  const n = (x.slice(4) + x.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let r = 0; for (const ch of n) r = (r * 10 + Number(ch)) % 97;
  return r === 1;
}
// QR-IBAN: institution id (positions 5-9) 30000-31999
const istQrIban = iban => { const iid = Number(ibanRoh(iban).slice(4, 9)); return iid >= 30000 && iid <= 31999; };

// modulo 10 recursive (check digit of the QR reference)
const TAB = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
function mod10(digits) { let c = 0; for (const d of String(digits)) c = TAB[(c + Number(d)) % 10]; return String((10 - c) % 10); }
function qrReferenz(nr, prefix = '') {
  const body = (String(prefix).replace(/\D/g, '') + String(nr).replace(/\D/g, '').padStart(26 - String(prefix).replace(/\D/g, '').length, '0')).slice(-26);
  return body + mod10(body);
}
// creditor reference ISO 11649: RF + 2 check digits + up to 21 characters
function scor(ref) {
  const r = String(ref).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 21);
  if (!r) return '';
  const n = (r + 'RF00').replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let m = 0; for (const ch of n) m = (m * 10 + Number(ch)) % 97;
  return 'RF' + String(98 - m).padStart(2, '0') + r;
}
function scorOk(ref) {
  const r = String(ref).toUpperCase().replace(/\s/g, '');
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(r)) return false;
  const n = (r.slice(4) + r.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let m = 0; for (const ch of n) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}

// display: IBAN and SCOR in blocks of 4, QR reference 2 + blocks of 5
const block4 = s => String(s).replace(/(.{4})/g, '$1 ').trim();
const fmtQrr = s => String(s).slice(0, 2) + ' ' + String(s).slice(2).replace(/(.{5})/g, '$1 ').trim();

// "Bahnhofstrasse 12a" -> street and building number
function strasse(s) {
  const m = /^(.*?)\s+(\d+\s?[a-zA-Z]?(?:\s?[-/]\s?\d+[a-zA-Z]?)?)$/.exec(clean(s));
  return m ? [m[1].slice(0, 70), m[2].replace(/\s/g, '').slice(0, 16)] : [clean(s).slice(0, 70), ''];
}
function adresse(name, str, plz, ort, land) {
  const [st, nr] = strasse(str);
  return { name: clean(name).slice(0, 70), strasse: st, nr, plz: clean(plz).slice(0, 16), ort: clean(ort).slice(0, 35), land: (clean(land) || 'CH').toUpperCase().slice(0, 2) };
}
const adrZeilen = a => (a ? ['S', a.name, a.strasse, a.nr, a.plz, a.ort, a.land] : ['', '', '', '', '', '', '']);
// lines for printing
const adrDruck = a => [a.name, [a.strasse, a.nr].filter(Boolean).join(' '), [a.land !== 'CH' ? a.land + '-' + a.plz : a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean);

// data of the payment part for an invoice; betrag = open amount (empty = to be filled in by the payer)
function daten(k, betrag) {
  const f = L.firma();
  const iban = ibanRoh(L.sw('ch.qr.iban', '') || f.IBAN);
  if (!iban) throw new Error('IBAN der Firma fehlt (Einstellungen → Firmendaten).');
  if (!ibanOk(iban)) throw new Error(`Die IBAN ${iban} ist keine gültige Schweizer oder Liechtensteiner IBAN.`);
  const glaeubiger = adresse(f.FIRMENNAME, f.STRASSE, f.PLZ, f.ORT, f.LAND || 'CH');
  if (!glaeubiger.name || !glaeubiger.plz || !glaeubiger.ort) throw new Error('Name, PLZ und Ort der Firma sind für die QR-Rechnung Pflicht.');
  const name = [k.KUNNAME, k.KUNVORNAME].filter(Boolean).join(Number(k.KUNART) === 1 ? ' ' : ', ').trim();
  const schuldner = name && k.KUNPLZ && k.KUNORT ? adresse(name, k.KUNSTRASSE, k.KUNPLZ, k.KUNORT, k.KUNLAND || 'CH') : null;
  const nr = String(k.RECHNUNGNUMMER ?? '');
  let refTyp = 'NON', ref = '';
  if (istQrIban(iban)) { refTyp = 'QRR'; ref = qrReferenz(nr, L.sw('ch.qr.kundenid', '')); }
  else if (L.sw('ch.qr.referenz', 'SCOR') === 'SCOR' && nr) { refTyp = 'SCOR'; ref = scor(nr); }
  const b = Math.round((Number(betrag) || 0) * 100) / 100;
  const amount = b >= 0.01 && b <= 999999999.99 ? b.toFixed(2) : '';
  const mitteilung = clean(`Rechnung Nr. ${nr}${k.FAHRKENNZEICHEN ? ' · ' + k.FAHRKENNZEICHEN : ''}`).slice(0, 140);
  const payload = ['SPC', '0200', '1', iban, ...adrZeilen(glaeubiger), ...adrZeilen(null), amount, 'CHF', ...adrZeilen(schuldner), refTyp, ref, mitteilung, 'EPD'].join('\n');
  return {
    payload, waehrung: 'CHF', betrag: amount, konto: block4(iban), refTyp,
    referenz: refTyp === 'QRR' ? fmtQrr(ref) : refTyp === 'SCOR' ? block4(ref) : '',
    glaeubiger: adrDruck(glaeubiger), schuldner: schuldner ? adrDruck(schuldner) : null, mitteilung,
  };
}

module.exports = { daten, ibanOk, istQrIban, mod10, qrReferenz, scor, scorOk, strasse };
