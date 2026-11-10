'use strict';
// Documents as PDF (invoices etc., dunning letters) including ZUGFeRD/Factur-X (XRechnung profile)
const fs = require('fs');
const path = require('path');
const { PDFDoc } = require('./pdf');
const L = require('../lib');
const dbm = require('../db');
const { V } = require('../../public/js/entities.js');
const { I18N, docLang } = require('../i18n');

// Number and date format follow the document language (set when a Layout is created)
let LANG = 'de';
const loc = () => I18N.locale(LANG);
const sep = () => ({ de: '.', nl: '-' }[LANG] || '/'); // 24.11.2026, 24-11-2026 (Dutch), otherwise 24/11/2026
const money = v => v == null || v === '' ? '' : L.geld(v, loc());
const num = (v, d = 3) => v == null || v === '' ? '' : new Intl.NumberFormat(loc(), { maximumFractionDigits: d }).format(Number(v));
const date = v => !v ? '' : L.land() === 'US' ? [String(v).slice(5, 7), String(v).slice(8, 10), String(v).slice(0, 4)].join('/') : [String(v).slice(8, 10), String(v).slice(5, 7), String(v).slice(0, 4)].join(sep());
const month = v => v ? String(v).slice(5, 7) + sep() + String(v).slice(0, 4) : '';
// postcode and town: "12345 Berlin", in the UK "London SW1A 1AA"
const plzOrt = (plz, ort) => (['GB', 'US'].includes(L.land()) ? [ort, plz] : [plz, ort]).filter(Boolean).join(' ');
const GREY = [85, 85, 85]; const BLUE = [30, 63, 110];
const TITLES = { angebot: 'Angebot', kostenvoranschlag: 'Kostenvoranschlag', auftrag: 'Auftrag', arbeitskarte: 'Arbeitskarte', auftrag_mit_unterschrift: 'Auftrag', lieferschein: 'Lieferschein', lieferschein_preise: 'Lieferschein', rechnung: 'Rechnung', rechnung_ohne_kopf: 'Rechnung', rechnungskorrektur: 'Rechnungskorrektur', gutschrift: 'Gutschrift', 'storno-rechnung': 'Stornorechnung', anzahlung: 'Anzahlungsrechnung', abschlag: 'Abschlagsrechnung', schluss: 'Schlussrechnung' };

class Layout {
  constructor(title, opts = {}) {
    LANG = docLang();
    this.doc = new PDFDoc({ title: I18N.tr(title, LANG), author: L.firma().FIRMENNAME, facturx: opts.facturx });
    // Labels are translated on output; data rarely matches a known text exactly
    if (LANG !== 'de') {
      const tr = s => (typeof s === 'string' ? I18N.tr(s, LANG) : s);
      const text = this.doc.text.bind(this.doc); const wrap = this.doc.wrap.bind(this.doc);
      this.doc.text = (x, y, s, o) => text(x, y, tr(s), o);
      this.doc.wrap = (s, ...rest) => wrap(tr(s), ...rest);
    }
    this.f = L.firma(); this.kopf = opts.kopf !== false && L.sw('druck.briefpapier', '0') !== '1';
    this.L = 20; this.R = 196; this.bottom = 268; this.onNewPage = null; this.qrSeiten = new Set();
    this.newPage(true);
  }
  newPage(first = false) {
    this.doc.addPage(); this.y = first ? 12 : 16;
    if (!first && this.onNewPage) this.onNewPage();
  }
  ensure(h) { if (this.y + h > this.bottom) { this.newPage(); return true; } return false; }
  header() {
    const d = this.doc, f = this.f;
    if (!this.kopf) { this.y = 45; return; }
    d.text(this.L, 19, f.FIRMENNAME || '', { f: 'B', size: 15, color: BLUE });
    let y = 24;
    if (f.FIRMENZUSATZ) { d.text(this.L, y, f.FIRMENZUSATZ, { size: 9 }); y += 4.5; }
    const maxW = f.LOGOFILE ? this.R - 76 - this.L : this.R - this.L;
    const lines = [...d.wrap([f.STRASSE, plzOrt(f.PLZ, f.ORT)].filter(Boolean).join(' · '), maxW, 'R', 8), ...d.wrap([f.TELEFON && 'Tel. ' + f.TELEFON, f.EMAIL, f.INTERNETSEITE].filter(Boolean).join(' · '), maxW, 'R', 8)];
    for (const l of lines.slice(0, 4)) { d.text(this.L, y, l, { size: 8, color: GREY }); y += 3.6; }
    if (f.LOGOFILE) {
      const p = path.join(dbm.FILES_DIR, f.LOGOFILE);
      if (fs.existsSync(p)) this.doc.image(fs.readFileSync(p), this.R - 72, 12, 72, 28);
    }
    this.y = 45;
  }
  address(a, info) {
    const d = this.doc;
    if (this.kopf) {
      const s = this.f.ABSENDER || [this.f.FIRMENNAME, this.f.STRASSE, plzOrt(this.f.PLZ, this.f.ORT)].filter(Boolean).join(' · ');
      d.text(this.L, 49, s, { size: 7, color: GREY }); d.line(this.L, 49.8, this.L + Math.min(85, d.width(s, 'R', 7)), 49.8, { w: 0.2, color: GREY });
    }
    let y = 56;
    for (const l of addrLines(a)) { d.text(this.L, y, l, { size: 10.5 }); y += 4.8; }
    let iy = 50;
    for (const [k, v] of info) { d.text(118, iy, k, { size: 8.8, color: GREY }); d.text(152, iy, String(v ?? ''), { size: 8.8, f: 'B' }); iy += 4.3; }
    this.y = Math.max(y, iy, 92);
  }
  para(text, { size = 9.6, f = 'R', color, gap = 2 } = {}) {
    if (!text || !String(text).trim()) return;
    for (const l of this.doc.wrap(text, this.R - this.L, f, size)) { this.ensure(5); this.doc.text(this.L, this.y + 3.5, l, { size, f, color }); this.y += size * 0.45; }
    this.y += gap;
  }
  footer() {
    const d = this.doc, f = this.f; const n = d.pages.length;
    d.pages.forEach((p, i) => {
      d.page = p;
      const dy = this.qrSeiten.has(p) ? -102 : 0; // page with the Swiss payment part: footer above it
      if (this.kopf) {
        d.line(this.L, 274 + dy, this.R, 274 + dy, { w: 0.3, color: [140, 140, 140] });
        const cols = [
          [f.FIRMENNAME, f.FIRMENZUSATZ, f.STRASSE, plzOrt(f.PLZ, f.ORT)],
          [f.TELEFON && 'Tel.: ' + f.TELEFON, f.FAX && 'Fax: ' + f.FAX, f.EMAIL, f.INTERNETSEITE],
          [f.BANKNAME, f.IBAN && 'IBAN: ' + f.IBAN, f.BIC && 'BIC: ' + f.BIC, f.BANKINHABER && 'Inhaber: ' + f.BANKINHABER],
          [...(L.land() === 'FR' ? require('../fr').pied() : ['AT', 'CH', 'IT', 'NL'].includes(L.land()) ? require({ AT: '../at', CH: '../ch', IT: '../it', NL: '../nl' }[L.land()]).pied() : require('../es').activo() ? [(f.STEUERNR || f.USTNR) && 'NIF: ' + (f.STEUERNR || f.USTNR)] : L.land() === 'US' ? [L.sw('us.reg.nr', '') && `${L.sw('us.reg.label', 'Registration No.')}: ${L.sw('us.reg.nr', '')}`] : L.land() === 'GB' ? [f.USTNR && 'VAT-Reg.-Nr.: ' + f.USTNR] : [f.USTNR && 'USt-IdNr.: ' + f.USTNR, f.STEUERNR && 'Steuer-Nr.: ' + f.STEUERNR]), f.HANDELSREGISTER, f.GESCHAEFTSFUEHRER && 'Inhaber/GF: ' + f.GESCHAEFTSFUEHRER],
        ];
        cols.forEach((c, ci) => { let y = 278 + dy; for (const l of c.filter(Boolean)) { d.text(this.L + ci * 44.5, y, l.slice(0, 48), { size: 6.8, color: GREY }); y += 3.1; } });
      }
      if (n > 1) d.text(this.R, dy ? 170 : 292, `Seite ${i + 1} von ${n}`, { size: 7, align: 'right', color: GREY });
    });
  }
  save() { this.footer(); return this.doc.save(); }
}

// Draw a QR code as vector graphics (squares); size = edge length in mm
function qrZeichnen(doc, text, x, y, size) {
  const qrcode = require('../../public/vendor/qrcode.js');
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(); const m = size / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      let e = c; while (e + 1 < n && q.isDark(r, e + 1)) e++; // merge runs, smaller PDF
      doc.rect(x + c * m, y + r * m, (e - c + 1) * m + 0.01, m + 0.01, { fill: [0, 0, 0] });
      c = e;
    }
  }
}

function fit(doc, t, w, f, size) { if (doc.width(t, f, size) <= w) return t; while (t.length > 1 && doc.width(t + '…', f, size) > w) t = t.slice(0, -1); return t + '…'; }

function addrLines(a) {
  const out = [];
  const firma = /^firma$/i.test(a.anrede || '') || a.firma;
  if (a.anrede && !/^firma$/i.test(a.anrede)) out.push(a.anrede);
  out.push(firma ? a.name || '' : [a.vorname, a.name].filter(Boolean).join(' '));
  if (a.zusatz) out.push(a.zusatz);
  if (a.strasse) out.push(a.strasse);
  if (L.land() === 'GB') out.push(a.ort, a.plz); // UK: town, then postcode on its own line
  else if (L.land() === 'US') out.push([a.ort, a.plz].filter(Boolean).join(' ')); // US: "Springfield, IL 62701"
  else out.push([a.plz, a.ort].filter(Boolean).join(' '));
  if (a.land && a.land !== (L.firma().LAND || 'DE')) out.push(a.land);
  return out.filter(Boolean);
}

function vorgangPdf(typ, d, opts = {}) {
  const v = V[typ]; const k = d.kopf;
  const formular = String(opts.formular || k.DRUCKFORMULAR || v.form).replace(/\.fr3$/, '');
  const title = TITLES[formular] || v.title;
  const ohnePreise = ['arbeitskarte', 'lieferschein'].includes(formular);
  const brutto = Number(k.ANSICHTBRUTTO) === 1;
  const rabatt = opts.rabatt ?? Number(k.RABATTZEIGEN) === 1;
  const klein = L.optNum('Kleinunternehmer', 0) === 1;
  const isRe = v.table === 'RECHNUNGEN';
  const es = isRe && d.es ? d.es : null; // Spanish tax system
  const vf = es && es.emitida && es.qr ? es : null;
  const nrText = es ? es.numSerie : k[v.nr];
  // UK VAT invoice: VAT rate per line, tax point, own title
  const gb = L.land() === 'GB'; const gbReg = gb && require('../gb').registrado();
  const rates = L.mwstRates();
  const gbSatz = p => Number(p.DURCHLAUFER) === 1 || k.STEUERART === 'REVERSE_CHARGE' ? '–' : Number(p.DIFFSTEUER) === 1 ? 'Marge' : k.STEUERART ? '0 %' : Number(p.MWST) === 63 ? 'frei' : num(rates[Number(p.MWST) || 61] ?? 0, 2) + ' %';
  // US: sales tax marker per line, condition of parts, authorizations of the estimate
  const us = L.land() === 'US'; const usLaborFree = us && L.sw('us.labor.taxable', '0') !== '1';
  const usTax = p => Number(p.DURCHLAUFER) === 1 || k.STEUERART || (usLaborFree && p.POSART === 'L') ? '' : (rates[Number(p.MWST) || 61] ?? 0) > 0 ? 'T' : '';
  const zustand = p => ({ GEBRAUCHT: '(gebraucht)', AUFBEREITET: '(aufbereitet)' }[p.TEILEZUSTAND] || '');
  const freigaben = (() => { try { return JSON.parse(k.USFREIGABE || '[]'); } catch { return []; } })();
  const fr = d.fr || null; // France: legal mentions from the server module
  const lx = d.lx || null; // Austria / Switzerland: texts, labels, QR-bill
  const ustLabel = us ? 'Sales Tax' : lx ? lx.ustLabel : 'MwSt';
  const titleGb = (gb || fr) && isRe && ['rechnung', 'rechnung_ohne_kopf', 'rechnungskorrektur', 'storno-rechnung', 'gutschrift'].includes(formular) ? (typ === 'korrektur' ? 'Gutschrift' : gbReg ? 'Umsatzsteuerrechnung' : 'Rechnung') : null;
  const ein = Object.fromEntries(L.db().prepare('SELECT EINHEITID, BEZEICHNUNG FROM EINHEITEN').all().map(e => [e.EINHEITID, e.BEZEICHNUNG]));
  const titel = vf ? ({ F1: 'Rechnung', F2: 'Vereinfachte Rechnung', R5: 'Vereinfachte Rechnungskorrektur' }[vf.tipo] || 'Rechnungskorrektur') : titleGb || title;
  const lay = new Layout(`${titel} ${nrText}`, { kopf: formular !== 'rechnung_ohne_kopf', facturx: opts.facturx });
  const doc = lay.doc;
  lay.header();
  const nrLabel = { angebot: 'Angebots-Nr.', auftrag: 'Auftrags-Nr.', lieferschein: 'Lieferschein-Nr.', rechnung: 'Rechnungs-Nr.', korrektur: 'Beleg-Nr.' }[typ];
  const info = [[nrLabel, nrText], ['Datum', date(k.DATUM)], ['Kunden-Nr.', k.KUNNUMMER ?? '']];
  if (isRe || typ === 'lieferschein') info.push([gb ? 'Steuerzeitpunkt' : 'Leistungsdatum', date(k.LIEFDATUM || k.DATUM)]);
  if (k.BENNAME) info.push(['Ansprechpartner', [k.BENVORNAME, k.BENNAME].filter(Boolean).join(' ')]);
  if (k.BESTELLNR) info.push(['Ihre Bestellung', k.BESTELLNR]);
  const kd = k.KUNID ? L.db().prepare('SELECT USTID FROM KUNDEN WHERE KUNID=?').get(k.KUNID) : null;
  if (kd && kd.USTID) info.push([es ? 'NIF' : lx ? lx.uidLabel : 'Ihre USt-IdNr.', kd.USTID]);
  if (fr && fr.sirenClient) info.push(['SIREN', fr.sirenClient]);
  if (lx && lx.cfCliente) info.push(['C.F. cliente', lx.cfCliente]);
  const bezug = (d.verknuepft || []).find(l => l.typ === 'rechnung');
  if (typ === 'korrektur' && es && es.rectificada) info.push(['zu Rechnung', `${es.rectificada.numSerie} vom ${date(es.rectificada.fecha)}`]);
  else if (typ === 'korrektur' && bezug) info.push(['zu Rechnung', `${bezug.nr} vom ${date(bezug.datum)}`]);
  lay.address({ anrede: k.KUNANREDE, name: k.KUNNAME, vorname: k.KUNVORNAME, zusatz: k.KUNZUSATZ, strasse: k.KUNSTRASSE, plz: k.KUNPLZ, ort: k.KUNORT, land: k.KUNLAND, firma: Number(k.KUNART) === 1 }, info);
  doc.text(lay.L, lay.y + 6, `${titel} Nr. ${nrText}`, { f: 'B', size: 15 });
  if (vf) {
    // VERI*FACTU QR code at the top of the invoice (art. 21 Orden HAC/1177/2024), 30 mm
    const Q = 30, qx = lay.R - Q, qy = lay.y + 4;
    doc.text(qx + Q / 2, qy, 'QR tributario:', { size: 7.5, align: 'center' });
    qrZeichnen(doc, vf.qr, qx, qy + 1.5, Q);
    doc.text(qx + Q / 2, qy + Q + 5, 'VERI*FACTU', { size: 8, f: 'B', align: 'center' });
    if (vf.entorno === 'pruebas') doc.text(qx + Q / 2, qy + Q + 8.5, 'Testumgebung – nicht bei der AEAT registriert', { size: 6.5, align: 'center', color: GREY });
    lay.y = qy + Q + 11;
  } else lay.y += 11;
  if (k.FAHRKENNZEICHEN || k.FAHRMARKE) {
    const cells = [['Kennzeichen', k.FAHRKENNZEICHEN], ['Fahrzeug', [k.FAHRMARKE, k.FAHRMODELL].filter(Boolean).join(' ')], ['FIN', k.FAHRIDENTNR], ['Erstzulassung', date(k.FAHREZ)], ...(us ? [['Tacho bei Annahme', k.FAHRKM ? num(k.FAHRKM, 0) : ''], ['Tacho bei Rückgabe', k.FAHRKMOUT ? num(k.FAHRKMOUT, 0) : '']] : [['KM-Stand', k.FAHRKM ? num(k.FAHRKM, 0) : ''], ['HU', month(k.FAHRHU)]])];
    doc.rect(lay.L, lay.y, lay.R - lay.L, 11, { stroke: [170, 170, 170], lw: 0.5 });
    cells.forEach(([a, b], i) => { const x = lay.L + 2.5 + (i % 3) * 58, y = lay.y + 4 + Math.floor(i / 3) * 4.5; doc.text(x, y, a + ':', { size: 8.3, color: GREY }); const lw = doc.width(a + ': ', 'R', 8.3); doc.text(x + lw, y, fit(doc, String(b || ''), 55 - lw, i === 0 ? 'B' : 'R', 8.3), { size: 8.3, f: i === 0 ? 'B' : 'R' }); });
    lay.y += 14;
  }
  lay.para(k.EINLEITUNGTXT);
  // table
  const vatCol = (gbReg || us) && !ohnePreise;
  const C = ohnePreise ? { pos: 20, art: 29, bez: 56, menge: 196 }
    : vatCol ? { pos: 20, art: 29, bez: 56, menge: rabatt ? 128 : 136, ep: rabatt ? 148 : 156, vat: rabatt ? 160 : 170, rab: 172, sum: 196 }
      : { pos: 20, art: 29, bez: 56, menge: rabatt ? 138 : 146, ep: rabatt ? 158 : 170, rab: 172, sum: 196 };
  const bezW = (ohnePreise ? 160 : C.menge - 16) - C.bez;
  const head = () => {
    doc.rect(lay.L, lay.y, lay.R - lay.L, 6, { fill: [238, 243, 249] });
    const y = lay.y + 4.2; const o = { f: 'B', size: 8.3 };
    doc.text(C.pos + 1, y, 'Pos.', o); doc.text(C.art, y, 'Art.-Nr.', o); doc.text(C.bez, y, 'Bezeichnung', o); doc.text(C.menge, y, 'Menge', { ...o, align: 'right' });
    if (!ohnePreise) { doc.text(C.ep, y, 'E-Preis', { ...o, align: 'right' }); if (rabatt) doc.text(C.rab, y, 'Rabatt', { ...o, align: 'right' }); if (vatCol) doc.text(C.vat, y, us ? 'Steuer' : 'MwSt', { ...o, align: 'right' }); doc.text(C.sum, y, 'Gesamt', { ...o, align: 'right' }); }
    doc.line(lay.L, lay.y + 6, lay.R, lay.y + 6, { w: 0.6 });
    lay.y += 7.5;
  };
  lay.onNewPage = () => { lay.y = 16; head(); };
  head();
  let nr = 0, hatDP = false, hatDiff = false;
  for (const p of d.pos) {
    if (p.POSART === 'T') {
      const lines = doc.wrap([p.BEZEICHNUNG, p.MEMOTEXT].filter(Boolean).join('\n'), lay.R - C.art, 'R', 9);
      for (const l of lines) { lay.ensure(5); doc.text(C.art, lay.y + 3, l, { size: 9 }); lay.y += 4.2; }
      lay.y += 1.5; continue;
    }
    if (p.POSART === 'Z') {
      lay.ensure(7); doc.rect(lay.L, lay.y, lay.R - lay.L, 5.5, { fill: [245, 247, 250] }); doc.line(lay.L, lay.y, lay.R, lay.y, { w: 0.5 });
      doc.text(C.art, lay.y + 4, p.BEZEICHNUNG || 'Zwischensumme', { f: 'B', size: 9 });
      if (!ohnePreise) doc.text(C.sum, lay.y + 4, money(p.SUMME), { f: 'B', size: 9, align: 'right' });
      lay.y += 7; continue;
    }
    nr++;
    if (Number(p.DURCHLAUFER) === 1) hatDP = true;
    if (Number(p.DIFFSTEUER) === 1) hatDiff = true;
    const name = (p.BEZEICHNUNG || p.BESCHREIBUNG || '') + (us && zustand(p) ? ' ' + I18N.tr(zustand(p), LANG) : '') + (Number(p.DURCHLAUFER) === 1 ? ' (DP)' : '');
    const sub = [p.BEZEICHNUNG ? p.BESCHREIBUNG : null, p.ARBEITSTEXT, p.MEMOTEXT].filter(x => x && String(x).trim()).join('\n');
    const l1 = doc.wrap(name, bezW, 'R', 9); const l2 = sub ? doc.wrap(sub, bezW, 'R', 7.8) : [];
    const h = l1.length * 4 + l2.length * 3.4 + 2.5;
    lay.ensure(Math.min(h, 40));
    const y = lay.y + 3.3;
    doc.text(C.pos + 1, y, String(nr), { size: 9 }); doc.text(C.art, y, String(p.ARTNUMMER || '').slice(0, 16), { size: 8.5 });
    doc.text(C.menge, y, `${num(p.MENGE)} ${ein[p.EINHEITID] || ''}`.trim(), { size: 9, align: 'right' });
    if (!ohnePreise) {
      doc.text(C.ep, y, money(brutto ? p.VKBRUTTO : p.VK), { size: 9, align: 'right' });
      if (rabatt && Number(p.RABATT)) doc.text(C.rab, y, num(p.RABATT, 2) + ' %', { size: 9, align: 'right' });
      if (vatCol) doc.text(C.vat, y, us ? usTax(p) : gbSatz(p), { size: 8.5, align: 'right' });
      doc.text(C.sum, y, money(brutto ? p.SUMMEBRUTTO : p.SUMME), { size: 9, align: 'right' });
    }
    let yy = lay.y;
    for (const l of l1) { if (yy + 4 > lay.bottom) { lay.newPage(); yy = lay.y; } doc.text(C.bez, yy + 3.3, l, { size: 9 }); yy += 4; }
    for (const l of l2) { if (yy + 3.4 > lay.bottom) { lay.newPage(); yy = lay.y; } doc.text(C.bez, yy + 3, l, { size: 7.8, color: GREY }); yy += 3.4; }
    lay.y = yy + 1.5;
    doc.line(lay.L, lay.y - 0.5, lay.R, lay.y - 0.5, { w: 0.15, color: [200, 200, 200] });
  }
  lay.onNewPage = null;
  // totals
  if (!ohnePreise) {
    const rows = [];
    const tax = d.tax || {};
    if (!klein) {
      rows.push([us ? 'Zwischensumme' : 'Summe netto', money(k.GNETTO)]);
      for (const t of Object.values(tax).filter(x => x.rate > 0)) rows.push([`zzgl. ${num(t.rate, 2)} % ${ustLabel} auf ${money(t.netto)}`, money(t.mwst)]);
      for (const t of Object.values(tax).filter(x => x.recargo)) rows.push([`zzgl. ${num(t.reRate, 2)} % Recargo de equivalencia auf ${money(t.netto)}`, money(t.recargo)]);
      const frei = Object.values(tax).filter(x => !x.rate).reduce((s, x) => s + x.netto, 0);
      if (frei) rows.push([us ? 'davon nicht steuerpflichtig' : 'davon steuerfrei / durchlaufend', money(frei), GREY]);
    }
    lay.ensure(rows.length * 5 + 18);
    lay.y += 2;
    for (const [a, b, col] of rows) { doc.text(110, lay.y + 3.5, a, { size: 9.2, color: col }); doc.text(lay.R, lay.y + 3.5, b, { size: 9.2, align: 'right', color: col }); lay.y += 5; }
    doc.line(108, lay.y + 0.5, lay.R, lay.y + 0.5, { w: 0.6 });
    doc.text(110, lay.y + 5.3, isRe && typ !== 'korrektur' ? 'Rechnungsbetrag' : 'Gesamtbetrag', { f: 'B', size: 11 });
    doc.text(lay.R, lay.y + 5.3, money(k.GBRUTTO), { f: 'B', size: 11, align: 'right' });
    doc.line(108, lay.y + 7.2, lay.R, lay.y + 7.2, { w: 0.4 }); doc.line(108, lay.y + 7.9, lay.R, lay.y + 7.9, { w: 0.4 });
    lay.y += 10;
    // Italy, split payment: the customer pays the IVA to the treasury
    if (lx && lx.split) {
      doc.text(110, lay.y + 3.5, 'IVA versata dal cliente (art. 17-ter)', { size: 9.2, color: GREY }); doc.text(lay.R, lay.y + 3.5, money(-lx.split), { size: 9.2, align: 'right', color: GREY }); lay.y += 5;
      doc.text(110, lay.y + 3.5, 'Netto a pagare', { size: 9.2, f: 'B' }); doc.text(lay.R, lay.y + 3.5, money(L.r2(k.GBRUTTO - lx.split)), { size: 9.2, f: 'B', align: 'right' }); lay.y += 7;
    }
    if (isRe && d.zahlungen && d.zahlungen.length) {
      const bez = d.zahlungen.reduce((s, z) => s + z.BETRAG, 0);
      doc.text(110, lay.y + 3.5, 'bereits bezahlt', { size: 9.2, color: GREY }); doc.text(lay.R, lay.y + 3.5, money(bez), { size: 9.2, align: 'right', color: GREY }); lay.y += 5;
      doc.text(110, lay.y + 3.5, 'Offener Betrag', { size: 9.2, f: 'B' }); doc.text(lay.R, lay.y + 3.5, money(L.r2(k.GBRUTTO - bez)), { size: 9.2, f: 'B', align: 'right' }); lay.y += 7;
    }
    if (klein && L.land() === 'DE') lay.para('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', { color: GREY });
    if (hatDP && us) lay.para('(DP) = Durchlaufende Gebühr, nicht steuerpflichtig.', { color: GREY, size: 8.5 });
    else if (hatDP && gb) lay.para('(DP) = Auslage im Namen des Kunden (disbursement), nicht umsatzsteuerbar.', { color: GREY, size: 8.5 });
    else if (hatDP && !fr && !lx) lay.para(es ? '(DP) = Suplido: im Namen und für Rechnung des Kunden verauslagt, nicht Teil der Bemessungsgrundlage (Art. 78.Tres.3.º LIVA).' : '(DP) = Durchlaufender Posten gemäß § 10 Abs. 1 Satz 6 UStG, nicht umsatzsteuerpflichtig.', { color: GREY, size: 8.5 });
    if (es && k.STEUERART) lay.para({ REVERSE_CHARGE: 'Nicht steuerbar in Spanien, Steuerschuldnerschaft des Leistungsempfängers (Art. 69 und 84.Uno.2.º LIVA).', IG_LIEFERUNG: 'Steuerfreie innergemeinschaftliche Lieferung (Art. 25 LIVA).', AUSFUHR: 'Steuerfreie Ausfuhr (Art. 21 LIVA).' }[k.STEUERART] || '', { size: 9 });
    if (vf && vf.tipo && vf.tipo[0] === 'R') lay.para(`Grund der Korrektur: ${vf.tipo} – ${vf.motivo}`, { size: 9, color: GREY });
    if (gb && k.STEUERART) lay.para({ REVERSE_CHARGE: 'Im Vereinigten Königreich nicht umsatzsteuerbar (Leistungsort im Ausland); der Kunde schuldet die Steuer (reverse charge).', IG_LIEFERUNG: 'Steuerfreie Ausfuhr (zero-rated export).', AUSFUHR: 'Steuerfreie Ausfuhr (zero-rated export).' }[k.STEUERART] || '', { size: 9 });
    if (hatDiff && gb) lay.para('Gebrauchtwagen: Margenbesteuerung (second-hand margin scheme, VAT Notice 718). Die Umsatzsteuer wird nicht gesondert ausgewiesen.', { size: 9 });
    else if (hatDiff && !fr && !lx) lay.para('Gebrauchtgegenstände / Sonderregelung – Differenzbesteuerung nach § 25a UStG. Die Umsatzsteuer wird nicht gesondert ausgewiesen.', { size: 9 });
    if (d._steuerhinweis) lay.para(d._steuerhinweis, { size: 9 });
  }
  if (isRe || typ === 'angebot' || typ === 'auftrag') {
    let zt = k.ZAHLBDTEXT || '';
    if (typ === 'rechnung' && Number(k.FAELLING) > 0) zt += (zt ? '\n' : '') + `Zahlbar bis ${date(L.addDays(k.DATUM, k.FAELLING))}${Number(k.SKONTO) > 0 ? `, bei Zahlung bis ${date(L.addDays(k.DATUM, k.TAGESKONTO))} abzüglich ${num(k.SKONTO, 2)} % Skonto` : ''}.`;
    if (typ !== 'korrektur') lay.para(zt);
  }
  const krypto = typ === 'rechnung' && k.RECHNUNGID ? require('../btcpay').linkFuerBeleg(k.RECHNUNGID) : null;
  if (krypto) {
    const Q = 26; lay.ensure(Q + 4);
    const y0 = lay.y + 1;
    qrZeichnen(doc, krypto.link, lay.L, y0, Q);
    const tx = lay.L + Q + 5; const tw = lay.R - tx;
    let ty = y0 + 4;
    doc.text(tx, ty, 'Bezahlen mit ' + require('../btcpay').artenText(), { f: 'B', size: 9.6 }); ty += 5;
    for (const l of doc.wrap(`QR-Code scannen oder Link öffnen. Betrag: ${money(krypto.betrag)}, umgerechnet zum Kurs am Zahltag. Gültig bis ${date(krypto.ablauf)}.`, tw, 'R', 8.8)) { doc.text(tx, ty, l, { size: 8.8, color: GREY }); ty += 4; }
    ty += 1;
    const zeilen = []; let rest = krypto.link; // break a link without spaces character by character
    while (rest) { let i = rest.length; while (i > 1 && doc.width(rest.slice(0, i), 'R', 8.2) > tw) i--; zeilen.push(rest.slice(0, i)); rest = rest.slice(i); }
    for (const l of zeilen) { doc.text(tx, ty, l, { size: 8.2, color: BLUE }); ty += 3.8; }
    lay.y = Math.max(y0 + Q, ty) + 3;
  }
  if (us) {
    if (k.STEUERART === 'EXEMPT') {
      const kd = k.KUNID ? L.db().prepare('SELECT EXEMPTCERT, EXEMPTREASON FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {};
      lay.para(I18N.tr('Steuerfreier Verkauf (tax exempt)', LANG) + (kd.EXEMPTCERT ? ' – ' + I18N.tr('Zertifikat', LANG) + ' ' + kd.EXEMPTCERT : '') + (kd.EXEMPTREASON ? ` (${kd.EXEMPTREASON})` : ''), { size: 9 });
    }
    if (!ohnePreise && d.pos.some(p => p.POSART === 'A')) lay.para('Alle Teile sind neu, sofern nicht anders angegeben.', { size: 8.5, color: GREY });
    if (k.USALTTEILE === 'zurueck') lay.para('Ersetzte Teile wurden dem Kunden zurückgegeben.', { size: 9 });
    if (k.USALTTEILE === 'entsorgt') lay.para('Ersetzte Teile wurden auf Wunsch des Kunden entsorgt.', { size: 9 });
    for (const a of freigaben) lay.para(`Freigegeben: ${money(a.betrag)} am ${date(a.datum)} (${I18N.tr(a.art || 'persönlich', LANG)}) durch ${a.person || ''}`, { size: 8.5, color: GREY });
  }
  lay.para(k.SCHLUSSTXT);
  const sign = (a, b) => { lay.ensure(24); lay.y += 16; doc.line(lay.L, lay.y, lay.L + 75, lay.y, { w: 0.4 }); doc.line(115, lay.y, lay.R, lay.y, { w: 0.4 }); doc.text(lay.L, lay.y + 3.5, a, { size: 8, color: GREY }); doc.text(115, lay.y + 3.5, b, { size: 8, color: GREY }); lay.y += 6; };
  if (fr) for (const m of fr.mentions) lay.para(m, { size: 8.5, color: GREY });
  if (lx) for (const m of lx.mentions) lay.para(m, { size: 8.5, color: GREY });
  if ((us || fr) && typ === 'angebot' && formular === 'kostenvoranschlag') { lay.para('Schriftlicher Kostenvoranschlag. Ohne Ihre Freigabe werden keine Arbeiten ausgeführt und keine Beträge über diesem Kostenvoranschlag berechnet.'); sign('Datum', 'Unterschrift Kunde (Freigabe)'); }
  if ((us || fr) && formular === 'auftrag_mit_unterschrift') { lay.para('Ich beauftrage die oben genannten Arbeiten bis zum angegebenen Betrag. Zusätzliche Arbeiten oder Mehrkosten nur nach meiner weiteren Freigabe.'); sign('Ort, Datum', 'Unterschrift Auftraggeber'); } else if (formular === 'auftrag_mit_unterschrift') { lay.para('Hiermit erteile ich den Auftrag zur Durchführung der oben genannten Arbeiten. Erforderliche Probefahrten dürfen durchgeführt werden. Es gelten die Allgemeinen Geschäftsbedingungen für die Ausführung von Arbeiten an Kraftfahrzeugen.'); sign('Ort, Datum', 'Unterschrift Auftraggeber'); }
  if (formular === 'arbeitskarte') { lay.ensure(50); doc.rect(lay.L, lay.y + 2, lay.R - lay.L, 40, { stroke: [150, 150, 150] }); doc.text(lay.L + 2, lay.y + 6, 'Notizen / ausgeführte Arbeiten:', { f: 'B', size: 9 }); lay.y += 45; lay.para('Monteur: ______________________     Arbeitszeit: von ________ bis ________'); }
  if (typ === 'lieferschein') sign('Ware vollständig erhalten – Datum', 'Unterschrift Empfänger');
  if (lx && lx.qr && formular !== 'rechnung_ohne_kopf' && opts.qr !== false) zahlteil(lay, lx.qr);
  if (opts.attach) doc.attach(opts.attach.name, opts.attach.data, { mime: 'text/xml', relationship: 'Alternative', description: opts.attach.description });
  return lay.save();
}

// Swiss QR-bill: receipt (62 mm) and payment part (148 mm) at the bottom of an A4 page, 105 mm high
// (Swiss Implementation Guidelines QR-bill, chapter 3). On a page of its own if the invoice is too long.
function zahlteil(lay, q) {
  const doc = lay.doc;
  if (lay.y > 166) lay.newPage();
  lay.qrSeiten.add(doc.page);
  const y0 = 192; const K = [0, 0, 0];
  // dividing lines (dashed) with the note above
  const strich = (x1, y1, x2, y2) => { const len = Math.hypot(x2 - x1, y2 - y1); for (let t = 0; t < len; t += 2) { const e = Math.min(t + 1, len); doc.line(x1 + (x2 - x1) * t / len, y1 + (y2 - y1) * t / len, x1 + (x2 - x1) * e / len, y1 + (y2 - y1) * e / len, { w: 0.2, color: K }); } };
  doc.rect(0, y0, 210, 105, { fill: [255, 255, 255] });
  strich(0, y0, 210, y0); strich(62, y0, 62, 297);
  doc.text(105, y0 - 1.5, 'Vor der Einzahlung abzutrennen', { size: 7, align: 'center', color: GREY });
  const block = (x, y, kopf, zeilen, hs, vs, w) => {
    doc.text(x, y, kopf, { f: 'B', size: hs }); y += hs * 0.42 + 0.6;
    for (const z of zeilen) for (const l of doc.wrap(z, w, 'R', vs)) { doc.text(x, y, l, { size: vs }); y += vs * 0.42 + 0.3; }
    return y + 2.5;
  };
  const ecken = (x, y, w, h) => { const c = 3; for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) { doc.line(px, py, px + c * dx, py, { w: 0.25 }); doc.line(px, py, px, py + c * dy, { w: 0.25 }); } };
  // receipt
  doc.text(5, y0 + 9, 'Empfangsschein', { f: 'B', size: 11 });
  let y = y0 + 14;
  y = block(5, y, 'Konto / Zahlbar an', [q.konto, ...q.glaeubiger], 6, 8, 52);
  if (q.referenz) y = block(5, y, 'Referenz', [q.referenz], 6, 8, 52);
  if (q.schuldner) block(5, y, 'Zahlbar durch', q.schuldner, 6, 8, 52);
  else { doc.text(5, y, 'Zahlbar durch (Name/Adresse)', { f: 'B', size: 6 }); ecken(5, y + 1.5, 52, 20); }
  doc.text(5, y0 + 68, 'Währung', { f: 'B', size: 6 }); doc.text(22, y0 + 68, 'Betrag', { f: 'B', size: 6 });
  doc.text(5, y0 + 72, q.waehrung, { size: 8 });
  if (q.betrag) doc.text(22, y0 + 72, q.betrag.replace(/\B(?=(\d{3})+\.)/g, ' '), { size: 8 }); else ecken(27, y0 + 69, 30, 10);
  doc.text(57, y0 + 82, 'Annahmestelle', { f: 'B', size: 6, align: 'right' });
  // payment part
  doc.text(67, y0 + 9, 'Zahlteil', { f: 'B', size: 11 });
  const qx = 67, qy = y0 + 17;
  qrZeichnen(doc, Buffer.from(q.payload, 'utf8').toString('latin1'), qx, qy, 46);
  // Swiss cross in the middle of the code: 7 mm, white border, black square, white cross
  const cx = qx + 23 - 3.5, cy = qy + 23 - 3.5;
  doc.rect(cx, cy, 7, 7, { fill: [255, 255, 255] }); doc.rect(cx + 0.5, cy + 0.5, 6, 6, { fill: K });
  doc.rect(cx + 2.95, cy + 1.6, 1.1, 3.8, { fill: [255, 255, 255] }); doc.rect(cx + 1.6, cy + 2.95, 3.8, 1.1, { fill: [255, 255, 255] });
  doc.text(67, y0 + 68, 'Währung', { f: 'B', size: 8 }); doc.text(87, y0 + 68, 'Betrag', { f: 'B', size: 8 });
  doc.text(67, y0 + 73, q.waehrung, { size: 10 });
  if (q.betrag) doc.text(87, y0 + 73, q.betrag.replace(/\B(?=(\d{3})+\.)/g, ' '), { size: 10 }); else ecken(78, y0 + 70, 40, 15);
  y = y0 + 9;
  y = block(118, y - 3.5, 'Konto / Zahlbar an', [q.konto, ...q.glaeubiger], 8, 10, 87);
  if (q.referenz) y = block(118, y, 'Referenz', [q.referenz], 8, 10, 87);
  if (q.mitteilung) y = block(118, y, 'Zusätzliche Informationen', [q.mitteilung], 8, 10, 87);
  if (q.schuldner) block(118, y, 'Zahlbar durch', q.schuldner, 8, 10, 87);
  else { doc.text(118, y, 'Zahlbar durch (Name/Adresse)', { f: 'B', size: 8 }); ecken(118, y + 1.5, 65, 25); }
}

function mahnungPdf(m) {
  const { mahnung: mh, rechnung: r, fruehere } = m;
  const lay = new Layout(mh.BETREFFTXT || 'Mahnung'); const doc = lay.doc;
  lay.header();
  lay.address({ anrede: r.KUNANREDE, name: r.KUNNAME, vorname: r.KUNVORNAME, zusatz: r.KUNZUSATZ, strasse: r.KUNSTRASSE, plz: r.KUNPLZ, ort: r.KUNORT, land: r.KUNLAND }, [['Datum', date(mh.MAHNDATUM)], ['Kunden-Nr.', r.KUNNUMMER ?? ''], ['Mahnstufe', mh.MAHNSTUFE]]);
  doc.text(lay.L, lay.y + 6, mh.BETREFFTXT || 'Zahlungserinnerung', { f: 'B', size: 15 }); lay.y += 12;
  lay.para(mh.VORTEXT);
  const geb = (Number(mh.MAHNGEBUEHREN) || 0) + fruehere.reduce((s, x) => s + (Number(x.MAHNGEBUEHREN) || 0), 0);
  doc.rect(lay.L, lay.y, lay.R - lay.L, 6, { fill: [238, 243, 249] });
  [['Rechnung', 22], ['Datum', 55], ['Fällig seit', 85]].forEach(([t, x]) => doc.text(x, lay.y + 4.2, t, { f: 'B', size: 8.5 }));
  doc.text(160, lay.y + 4.2, 'Betrag', { f: 'B', size: 8.5, align: 'right' }); doc.text(lay.R, lay.y + 4.2, 'offen', { f: 'B', size: 8.5, align: 'right' });
  lay.y += 10;
  doc.text(22, lay.y, String(r.RECHNUNGNUMMER)); doc.text(55, lay.y, date(r.DATUM)); doc.text(85, lay.y, date(L.addDays(r.DATUM, r.FAELLING || 0)));
  doc.text(160, lay.y, money(r.GBRUTTO), { align: 'right' }); doc.text(lay.R, lay.y, money(r.OFFEN), { align: 'right' });
  lay.y += 6;
  if (geb) { doc.text(110, lay.y, 'Mahngebühren'); doc.text(lay.R, lay.y, money(geb), { align: 'right' }); lay.y += 5; }
  doc.line(108, lay.y - 2, lay.R, lay.y - 2, { w: 0.6 });
  doc.text(110, lay.y + 3, 'Zu zahlender Betrag', { f: 'B', size: 11 }); doc.text(lay.R, lay.y + 3, money(L.r2(r.OFFEN + geb)), { f: 'B', size: 11, align: 'right' });
  lay.y += 10;
  lay.para(mh.NACHTEXT);
  const f = L.firma();
  if (f.IBAN) lay.para(`Bitte überweisen Sie den Betrag auf unser Konto: IBAN ${f.IBAN}${f.BIC ? ' · BIC ' + f.BIC : ''} · Verwendungszweck: Rechnung ${r.RECHNUNGNUMMER}`);
  return lay.save();
}

// ZUGFeRD 2.3 / Factur-X with XRechnung profile
function zugferd(rid) {
  const VG = require('../api/vorgang');
  const ER = require('../api/erechnung');
  const typRow = L.db().prepare('SELECT TYP FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  if (!typRow) throw new L.HttpError(404, 'Rechnung nicht gefunden');
  const typ = typRow.TYP === 2 ? 'korrektur' : 'rechnung';
  const d = VG.load(typ, rid);
  const x = ER.create(rid, 'cii');
  // France: Factur-X profile EN 16931 with the standard file name factur-x.xml
  const fr = L.land() === 'FR';
  const datei = fr ? 'factur-x.xml' : 'xrechnung.xml';
  const pdf = vorgangPdf(typ, d, { facturx: { filename: datei, level: fr ? 'EN 16931' : 'XRECHNUNG' }, attach: { name: datei, data: Buffer.from(x.xml, 'utf8'), description: fr ? 'Factur-X (EN 16931)' : 'Rechnungsdaten im XRechnung-Format (CII)' } });
  return { pdf, problems: x.problems, nr: d.kopf.RECHNUNGNUMMER };
}
module.exports = { vorgangPdf, mahnungPdf, zugferd, Layout, money, date };
