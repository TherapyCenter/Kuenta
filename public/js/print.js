'use strict';
/* global h, $, fmt, api, esc, Win, App, LK, ENT, kname, today, toast, showError, r2, I18N, confirmDlg */

const Print = {
  firma: null,
  async ensureFirma() { const s = await api('/api/einstellungen'); Print.firma = s.firma; Print.settings = s; return s.firma; },

  css(extra = '') {
    return `
@page { size: A4; margin: 12mm 14mm 8mm 20mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9.6pt; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 100%; }
table.layout { width: 100%; border-collapse: collapse; }
table.layout > thead td, table.layout > tfoot td { padding: 0; }
.fspace { height: 24mm; }
.footer { position: fixed; bottom: 0; left: 0; right: 0; height: 20mm; border-top: 0.6pt solid #888; padding-top: 2mm; display: flex; gap: 6mm; font-size: 7pt; color: #444; line-height: 1.35; background: #fff; }
.footer > div { flex: 1; }
.head { display: flex; justify-content: space-between; align-items: flex-start; height: 33mm; }
.head .firm { font-size: 15pt; font-weight: bold; color: #1e3f6e; }
.head .firm small { display: block; font-size: 9pt; font-weight: normal; color: #333; margin-top: 1mm; }
.head .contact { font-size: 8pt; color: #333; line-height: 1.4; margin-top: 2mm; }
.head img.logo { max-height: 30mm; max-width: 70mm; object-fit: contain; }
.addrrow { display: flex; justify-content: space-between; gap: 8mm; min-height: 45mm; }
.addr { width: 85mm; }
.addr .sender { font-size: 7pt; text-decoration: underline; color: #444; margin-bottom: 3mm; white-space: nowrap; overflow: hidden; }
.addr .to { font-size: 10.5pt; line-height: 1.35; }
.info { width: 78mm; font-size: 8.8pt; }
.info table { width: 100%; border-collapse: collapse; }
.info td { padding: 0.4mm 0; vertical-align: top; }
.info td:first-child { color: #444; width: 36mm; }
h1 { font-size: 15pt; margin: 6mm 0 3mm; }
.fz { border: 0.6pt solid #aaa; border-radius: 1.5mm; padding: 1.5mm 2.5mm; margin-bottom: 3mm; font-size: 8.8pt; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5mm 4mm; }
.fz span { color: #555; }
.txt { white-space: pre-wrap; margin: 2mm 0 3mm; line-height: 1.4; }
table.items { width: 100%; border-collapse: collapse; margin: 2mm 0; }
table.items th { text-align: left; font-size: 8.5pt; border-bottom: 0.8pt solid #333; padding: 1.2mm 1mm; background: #eef3f9; }
table.items td { padding: 1.2mm 1mm; border-bottom: 0.3pt solid #ccc; vertical-align: top; }
table.items .r { text-align: right; white-space: nowrap; }
table.items .sub { font-size: 8pt; color: #444; white-space: pre-wrap; margin-top: 0.6mm; }
table.items tr.t td { border-bottom: 0; white-space: pre-wrap; padding-top: 2mm; }
table.items tr.z td { font-weight: bold; border-top: 0.6pt solid #333; background: #f5f7fa; }
table.items tr { page-break-inside: avoid; }
.totals { margin-left: auto; width: 88mm; border-collapse: collapse; margin-top: 2mm; page-break-inside: avoid; }
.totals td { padding: 1mm 1mm; }
.totals td.r { text-align: right; white-space: nowrap; }
.totals tr.grand td { font-weight: bold; font-size: 11pt; border-top: 0.8pt solid #333; border-bottom: 2pt double #333; }
.muted { color: #555; }
.sign { display: flex; gap: 15mm; margin-top: 18mm; page-break-inside: avoid; }
.sign div { flex: 1; border-top: 0.6pt solid #333; padding-top: 1mm; font-size: 8pt; color: #444; }
.doc { page-break-after: always; }
.doc:last-child { page-break-after: auto; }
.listtitle { font-size: 13pt; font-weight: bold; margin: 0 0 1mm; }
table.list { width: 100%; border-collapse: collapse; font-size: 8.3pt; }
table.list th { text-align: left; border-bottom: 0.8pt solid #333; padding: 1mm; background: #eef3f9; }
table.list td { padding: 0.8mm 1mm; border-bottom: 0.3pt solid #ddd; }
table.list .r { text-align: right; white-space: nowrap; }
table.list tfoot td { font-weight: bold; border-top: 0.8pt solid #333; }
.box { border: 0.6pt solid #999; border-radius: 1.5mm; padding: 2mm 3mm; margin: 2mm 0; page-break-inside: avoid; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
.kv { display: grid; grid-template-columns: 38mm 1fr; gap: 0.6mm 2mm; }
.kv span { color: #555; }
.titlerow { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; }
.vf { text-align: center; font-size: 7.5pt; line-height: 1.3; margin-top: 3mm; }
.vf svg { display: block; margin: 0.8mm auto; }
@page qrbill { size: A4; margin: 0; }
.qrpage { page: qrbill; break-before: page; break-after: auto; position: relative; width: 210mm; height: 296mm; overflow: hidden; background: #fff; }
.qrpage .zt { position: absolute; left: 0; bottom: 0; width: 210mm; height: 105mm; background: #fff; z-index: 10; border-top: 0.25mm dashed #000; font-family: Arial, Helvetica, "Liberation Sans", sans-serif; color: #000; }
.qrpage .zt .abs { position: absolute; }
.qrpage .zt .t { font-size: 11pt; font-weight: bold; }
.qrpage .zt .rh { font-size: 6pt; font-weight: bold; line-height: 9pt; } .qrpage .zt .rv { font-size: 8pt; line-height: 9pt; margin-bottom: 9pt; }
.qrpage .zt .ph { font-size: 8pt; font-weight: bold; line-height: 11pt; } .qrpage .zt .pv { font-size: 10pt; line-height: 11pt; margin-bottom: 11pt; }
.qrpage .zt .cut { position: absolute; left: 62mm; top: 0; height: 105mm; border-left: 0.25mm dashed #000; }
.qrpage .zt .note { position: absolute; top: -4mm; left: 0; width: 210mm; text-align: center; font-size: 7pt; color: #444; }
.qrpage .zt .ecken { background: linear-gradient(#000,#000) top left / 3mm 0.25mm, linear-gradient(#000,#000) top left / 0.25mm 3mm, linear-gradient(#000,#000) top right / 3mm 0.25mm, linear-gradient(#000,#000) top right / 0.25mm 3mm, linear-gradient(#000,#000) bottom left / 3mm 0.25mm, linear-gradient(#000,#000) bottom left / 0.25mm 3mm, linear-gradient(#000,#000) bottom right / 3mm 0.25mm, linear-gradient(#000,#000) bottom right / 0.25mm 3mm; background-repeat: no-repeat; }
.qrpage .kopf { position: absolute; left: 20mm; top: 15mm; font-size: 10pt; }
@media screen { .qrpage { margin: 0 auto 10px; box-shadow: 0 2px 10px rgba(0,0,0,.4); } }
@media screen { body { background: #8a96a6; padding: 10px 0; } .sheet { background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto 10px; padding: 12mm 14mm 8mm 20mm; box-shadow: 0 2px 10px rgba(0,0,0,.4); position: relative; } .footer { position: absolute; left: 20mm; right: 14mm; bottom: 8mm; } }
${extra}`;
  },

  footerHtml(f) {
    const zeile = (...xs) => xs.filter(Boolean).map(esc).join('<br>');
    const es = LK.data && LK.data.land === 'ES';
    const gb = LK.data && LK.data.land === 'GB';
    const us = LK.data && LK.data.land === 'US';
    return `<div class="footer">
      <div>${zeile(f.FIRMENNAME, f.FIRMENZUSATZ, f.STRASSE, Print.plzOrt(f.PLZ, f.ORT))}</div>
      <div>${zeile(f.TELEFON && 'Tel.: ' + f.TELEFON, f.FAX && 'Fax: ' + f.FAX, f.EMAIL, f.INTERNETSEITE)}</div>
      <div>${zeile(f.BANKNAME, f.IBAN && 'IBAN: ' + f.IBAN, f.BIC && 'BIC: ' + f.BIC, f.BANKINHABER && 'Inhaber: ' + f.BANKINHABER)}</div>
      <div>${zeile(...(LK.data && ['AT', 'CH'].includes(LK.data.land) && Print.lxPied ? Print.lxPied : LK.data && LK.data.land === 'FR' && Print.frPied ? Print.frPied : es ? [(f.STEUERNR || f.USTNR) && 'NIF: ' + (f.STEUERNR || f.USTNR)] : us ? [App.setting('us.reg.nr', '') && `${App.setting('us.reg.label', 'Registration No.')}: ${App.setting('us.reg.nr', '')}`] : gb ? [f.USTNR && 'VAT-Reg.-Nr.: ' + f.USTNR] : [f.USTNR && 'USt-IdNr.: ' + f.USTNR, f.STEUERNR && 'Steuer-Nr.: ' + f.STEUERNR]), f.HANDELSREGISTER, f.GESCHAEFTSFUEHRER && 'Inhaber/GF: ' + f.GESCHAEFTSFUEHRER, f.FUSSZEILE)}</div>
    </div>`;
  },
  headHtml(f) {
    const logo = f.LOGOFILE ? `<img class="logo" src="${location.origin}/dateien/${f.LOGOFILE.split('/').map(encodeURIComponent).join('/')}">` : '';
    return `<div class="head"><div><div class="firm">${esc(f.FIRMENNAME || '')}${f.FIRMENZUSATZ ? `<small>${esc(f.FIRMENZUSATZ)}</small>` : ''}</div>
      <div class="contact">${[f.STRASSE, Print.plzOrt(f.PLZ, f.ORT)].filter(Boolean).map(esc).join(' · ')}<br>${[f.TELEFON && 'Tel. ' + f.TELEFON, f.EMAIL, f.INTERNETSEITE].filter(Boolean).map(esc).join(' · ')}</div></div>${logo}</div>`;
  },
  // postcode and town: "12345 Berlin", in the UK "London SW1A 1AA"
  plzOrt(plz, ort) { return (LK.data && ['GB', 'US'].includes(LK.data.land) ? [ort, plz] : [plz, ort]).filter(Boolean).join(' '); },
  senderLine(f) { return esc(f.ABSENDER || [f.FIRMENNAME, f.STRASSE, Print.plzOrt(f.PLZ, f.ORT)].filter(Boolean).join(' · ')); },
  addressHtml(a) {
    const lines = [];
    if (a.anrede && !/^firma$/i.test(a.anrede)) lines.push(a.anrede);
    if (/^firma$/i.test(a.anrede || '') || a.firma) lines.push([a.name].filter(Boolean).join(' '));
    else lines.push([a.vorname, a.name].filter(Boolean).join(' '));
    if (a.zusatz) lines.push(a.zusatz);
    if (a.strasse) lines.push(a.strasse);
    if (LK.data && LK.data.land === 'GB') lines.push(a.ort, a.plz); // UK: town, then postcode on its own line
    else if (LK.data && LK.data.land === 'US') lines.push([a.ort, a.plz].filter(Boolean).join(' ')); // US: "Springfield, IL 62701"
    else lines.push([a.plz, a.ort].filter(Boolean).join(' '));
    if (a.land && a.land !== ((Print.firma && Print.firma.LAND) || 'DE')) lines.push(a.land);
    return lines.filter(Boolean).map(esc).join('<br>');
  },
  wrap(bodyHtml, f, { kopf = true, extraCss = '' } = {}) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Druck</title><style>${Print.css(extraCss)}</style></head><body>${bodyHtml}</body></html>`;
  },
  sheet(inner, f, kopf = true) {
    return `<div class="sheet doc">${kopf ? Print.footerHtml(f) : ''}<table class="layout"><tbody><tr><td>${inner}</td></tr></tbody><tfoot><tr><td><div class="fspace"></div></td></tr></tfoot></table></div>`;
  },

  // Language of customer documents (Settings → Defaults); lists and reports follow the user interface
  docLang() { return App.setting('beleg.sprache', 'de'); },
  // Translate the text of a finished HTML page (labels; data rarely matches a known text exactly)
  translateHtml(html, lang) {
    if (lang === 'de') return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.documentElement.lang = lang;
    const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.parentNode.closest('style, script')) continue;
      if (/\p{L}/u.test(n.nodeValue)) n.nodeValue = I18N.tr(n.nodeValue, lang);
    }
    return '<!doctype html>' + doc.documentElement.outerHTML;
  },

  // Preview window with a print button; doc = customer document (document language) or list (UI language)
  preview(html, title = 'Seitenvorschau', { doc = true } = {}) {
    html = Print.translateHtml(html, doc ? Print.docLang() : I18N.lang);
    return new Promise(resolve => {
      const frame = h('iframe', { style: { width: '100%', height: '100%', border: '0', background: '#8a96a6' } });
      const w = Win.open({ title, width: 1000, height: Math.min(1100, window.innerHeight - 20), content: frame, flex: true, onClose: () => resolve() });
      w.body.style.padding = '0';
      frame.srcdoc = html;
      w.setButtons([
        { label: 'Drucken / als PDF speichern', icon: '🖨', cls: 'primary', onClick: () => frame.contentWindow.print() },
        { label: 'In neuem Fenster', icon: '↗', onClick: () => { const nw = window.open('', '_blank'); if (nw) { nw.document.write(html); nw.document.close(); } } },
        '|', { label: 'Schließen', onClick: () => w.close() }]);
      w.el.append(w.foot);
      frame.addEventListener('load', () => { frame.contentWindow.addEventListener('keydown', e => { if (e.key === 'Escape') w.close(); }); });
    });
  },

  // ---------- Documents ----------
  titles: { angebot: 'Angebot', kostenvoranschlag: 'Kostenvoranschlag', auftrag: 'Auftrag', arbeitskarte: 'Arbeitskarte', auftrag_mit_unterschrift: 'Auftrag', lieferschein: 'Lieferschein', lieferschein_preise: 'Lieferschein', rechnung: 'Rechnung', rechnung_ohne_kopf: 'Rechnung', rechnungskorrektur: 'Rechnungskorrektur', gutschrift: 'Gutschrift', 'storno-rechnung': 'Stornorechnung' },
  vorgangHtml(typ, d, opts, f) {
    const v = ENT.V[typ]; const k = d.kopf;
    const formular = (opts.formular || String(k.DRUCKFORMULAR || v.form).replace(/\.fr3$/, '')).replace(/\.fr3$/, '');
    const title = Print.titles[formular] || v.title;
    const ohnePreise = ['arbeitskarte', 'lieferschein'].includes(formular);
    const kopf = opts.briefpapier !== false && formular !== 'rechnung_ohne_kopf' && App.setting('druck.briefpapier', '0') !== '1';
    const brutto = Number(k.ANSICHTBRUTTO) === 1;
    const rabatt = opts.rabatt ?? Number(k.RABATTZEIGEN) === 1;
    const klein = LK.data && LK.data.klein;
    const einheit = id => LK.name('einheiten', id);
    const isRe = v.table === 'RECHNUNGEN';
    const es = isRe && d.es && d.es.activo !== undefined ? d.es : null; // Spanish tax system
    const vf = es && es.emitida && es.qr ? es : null;
    // UK VAT invoice: VAT rate per line, tax point, own title
    const gb = LK.data && LK.data.land === 'GB'; const gbReg = gb && LK.data.gbRegistrado;
    const gbSatz = p => Number(p.DURCHLAUFER) === 1 || k.STEUERART === 'REVERSE_CHARGE' ? '–' : Number(p.DIFFSTEUER) === 1 ? 'Marge' : k.STEUERART ? '0 %' : Number(p.MWST) === 63 ? 'frei' : fmt.num(LK.rate(Number(p.MWST) || 61)) + ' %';
    // US: sales tax marker per line, condition of parts, authorizations of the estimate
    const us = LK.data && LK.data.land === 'US';
    const usTax = p => Number(p.DURCHLAUFER) === 1 || k.STEUERART || (LK.data.usLaborFree && p.POSART === 'L') ? '' : LK.rate(Number(p.MWST) || 61) > 0 ? 'T' : '';
    const zustand = p => ({ GEBRAUCHT: '(gebraucht)', AUFBEREITET: '(aufbereitet)' }[p.TEILEZUSTAND] || '');
    const freigaben = (() => { try { return JSON.parse(k.USFREIGABE || '[]'); } catch { return []; } })();
    const fr = d.fr || null; Print.frPied = fr ? fr.pied : null; // France: legal mentions and footer from the server
    const lx = d.lx || null; Print.lxPied = lx ? lx.pied : null; // Austria / Switzerland: texts, footer, QR-bill
    const ustLabel = us ? 'Sales Tax' : lx ? lx.ustLabel : 'MwSt';
    const titleGb = (gb || fr) && isRe && ['rechnung', 'rechnung_ohne_kopf', 'rechnungskorrektur', 'storno-rechnung', 'gutschrift'].includes(formular) ? (typ === 'korrektur' ? 'Gutschrift' : gbReg ? 'Umsatzsteuerrechnung' : 'Rechnung') : null;
    const titleEs = vf ? { F1: 'Rechnung', F2: 'Vereinfachte Rechnung', R5: 'Vereinfachte Rechnungskorrektur' }[vf.tipo] || 'Rechnungskorrektur' : null;
    const nrLabel = { angebot: 'Angebots-Nr.', auftrag: 'Auftrags-Nr.', lieferschein: 'Lieferschein-Nr.', rechnung: 'Rechnungs-Nr.', korrektur: 'Beleg-Nr.' }[typ];
    const info = [[nrLabel, es ? es.numSerie : k[v.nr]], ['Datum', fmt.date(k.DATUM)], ['Kunden-Nr.', k.KUNNUMMER]];
    if (isRe || typ === 'lieferschein') info.push([gb ? 'Steuerzeitpunkt' : 'Liefer-/Leistungsdatum', fmt.date(k.LIEFDATUM || k.DATUM)]);
    if (k.BENNAME) info.push(['Ansprechpartner', [k.BENVORNAME, k.BENNAME].filter(Boolean).join(' ')]);
    if (k.BESTELLNR) info.push(['Ihre Bestellung', k.BESTELLNR]);
    if (d._ust) info.push([es ? 'NIF' : lx ? lx.uidLabel : 'Ihre USt-IdNr.', d._ust]);
    if (fr && fr.sirenClient) info.push(['SIREN', fr.sirenClient]);
    const bezug = (d.verknuepft || []).find(l => l.typ === 'rechnung');
    if (typ === 'korrektur' && es && es.rectificada) info.push(['zu Rechnung', `${es.rectificada.numSerie} vom ${fmt.date(es.rectificada.fecha)}`]);
    else if (typ === 'korrektur' && bezug) info.push(['zu Rechnung', `${bezug.nr} vom ${fmt.date(bezug.datum)}`]);
    let html = '';
    if (kopf) html += Print.headHtml(f); else html += '<div style="height:33mm"></div>';
    html += `<div class="addrrow"><div class="addr"><div class="sender">${kopf ? Print.senderLine(f) : ''}</div><div class="to">${Print.addressHtml({ anrede: k.KUNANREDE, name: k.KUNNAME, vorname: k.KUNVORNAME, zusatz: k.KUNZUSATZ, strasse: k.KUNSTRASSE, plz: k.KUNPLZ, ort: k.KUNORT, land: k.KUNLAND, firma: Number(k.KUNART) === 1 })}</div></div>
      <div class="info"><table>${info.map(([a, b]) => `<tr><td>${esc(a)}</td><td><b>${esc(b ?? '')}</b></td></tr>`).join('')}</table></div></div>`;
    if (vf) {
      // VERI*FACTU QR code at the top of the invoice (art. 21 Orden HAC/1177/2024)
      html += `<div class="titlerow"><h1>${esc(titleEs)} Nr. ${esc(vf.numSerie)}</h1><div class="vf"><div>QR tributario:</div>${Print.qrSvg(vf.qr, 32)}<div><b>VERI*FACTU</b></div>${vf.entorno === 'pruebas' ? '<div class="muted">Testumgebung – nicht bei der AEAT registriert</div>' : ''}</div></div>`;
    } else html += `<h1>${esc(titleGb || title)} Nr. ${esc(es ? es.numSerie : k[v.nr])}</h1>`;
    if (k.FAHRKENNZEICHEN || k.FAHRMARKE) {
      html += `<div class="fz"><div><span>Kennzeichen:</span> <b>${esc(k.FAHRKENNZEICHEN || '')}</b></div><div><span>Fahrzeug:</span> ${esc([k.FAHRMARKE, k.FAHRMODELL].filter(Boolean).join(' '))}</div><div><span>FIN:</span> ${esc(k.FAHRIDENTNR || '')}</div>
        <div><span>Erstzulassung:</span> ${fmt.date(k.FAHREZ)}</div>${us ? `<div><span>Tacho bei Annahme:</span> ${k.FAHRKM ? fmt.num(k.FAHRKM, 0) : ''}</div><div><span>Tacho bei Rückgabe:</span> ${k.FAHRKMOUT ? fmt.num(k.FAHRKMOUT, 0) : ''}</div>` : `<div><span>KM-Stand:</span> ${k.FAHRKM ? Number(k.FAHRKM).toLocaleString(I18N.locale(Print.docLang())) : ''}</div><div><span>HU:</span> ${fmt.month(k.FAHRHU)}</div>`}
        ${k.FAHRHSN ? `<div><span>HSN/TSN:</span> ${esc(k.FAHRHSN)} / ${esc(k.FAHRTSN || '')}</div>` : ''}</div>`;
    }
    if (k.EINLEITUNGTXT) html += `<div class="txt">${esc(k.EINLEITUNGTXT)}</div>`;
    // line items
    const vatCol = (gbReg || us) && !ohnePreise;
    const cols = (ohnePreise ? 4 : (rabatt ? 7 : 6)) + (vatCol ? 1 : 0);
    html += `<table class="items"><thead><tr><th style="width:9mm">Pos.</th><th style="width:26mm">Art.-Nr.</th><th>Bezeichnung</th><th class="r" style="width:16mm">Menge</th>${ohnePreise ? '' : `<th class="r" style="width:22mm">E-Preis</th>${rabatt ? '<th class="r" style="width:13mm">Rabatt</th>' : ''}${vatCol ? `<th class="r" style="width:14mm">${us ? 'Steuer' : 'MwSt'}</th>` : ''}<th class="r" style="width:24mm">Gesamt</th>`}</tr></thead><tbody>`;
    let nr = 0; let hatDP = false; let hatMarge = false;
    for (const p of d.pos) {
      if (p.POSART === 'T') { html += `<tr class="t"><td></td><td colspan="${cols - 1}">${esc([p.BEZEICHNUNG, p.MEMOTEXT].filter(Boolean).join('\n'))}</td></tr>`; continue; }
      if (p.POSART === 'Z') { html += `<tr class="z"><td></td><td colspan="${cols - 2}">${esc(p.BEZEICHNUNG || 'Zwischensumme')}</td>${ohnePreise ? '<td></td>' : `<td class="r">${fmt.money(p.SUMME)}</td>`}</tr>`; continue; }
      nr++;
      if (Number(p.DURCHLAUFER) === 1) hatDP = true;
      if (Number(p.DIFFSTEUER) === 1) hatMarge = true;
      const sub = [p.BEZEICHNUNG ? p.BESCHREIBUNG : null, p.ARBEITSTEXT, p.MEMOTEXT].filter(x => x && String(x).trim()).join('\n');
      const ep = brutto ? p.VKBRUTTO : p.VK;
      const sum = brutto ? p.SUMMEBRUTTO : p.SUMME;
      html += `<tr><td>${nr}</td><td>${esc(p.ARTNUMMER || '')}</td><td>${esc(p.BEZEICHNUNG || p.BESCHREIBUNG || '')}${us && zustand(p) ? ` <span>${zustand(p)}</span>` : ''}${Number(p.DURCHLAUFER) === 1 ? ' <span class="muted">(DP)</span>' : ''}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</td>
        <td class="r">${fmt.num(p.MENGE, 3)} ${esc(einheit(p.EINHEITID) || '')}</td>${ohnePreise ? '' : `<td class="r">${fmt.money(ep)}</td>${rabatt ? `<td class="r">${Number(p.RABATT) ? fmt.num(p.RABATT) + ' %' : ''}</td>` : ''}${vatCol ? `<td class="r">${us ? usTax(p) : gbSatz(p)}</td>` : ''}<td class="r">${fmt.money(sum)}</td>`}</tr>`;
    }
    html += '</tbody></table>';
    // totals
    if (!ohnePreise) {
      const tax = d.tax || {};
      let t = '<table class="totals">';
      const taxRows = Object.values(tax).filter(x => x.rate > 0);
      if (brutto && !klein) {
        t += `<tr><td>${us ? 'Zwischensumme' : 'Summe netto'}</td><td class="r">${fmt.money(k.GNETTO)}</td></tr>`;
        for (const x of taxRows) t += `<tr><td>zzgl. ${fmt.num(x.rate)} % ${ustLabel} auf ${fmt.money(x.netto)}</td><td class="r">${fmt.money(x.mwst)}</td></tr>`;
      } else if (!klein) {
        t += `<tr><td>${us ? 'Zwischensumme' : 'Summe netto'}</td><td class="r">${fmt.money(k.GNETTO)}</td></tr>`;
        for (const x of taxRows) t += `<tr><td>zzgl. ${fmt.num(x.rate)} % ${ustLabel} auf ${fmt.money(x.netto)}</td><td class="r">${fmt.money(x.mwst)}</td></tr>`;
        for (const x of taxRows.filter(x => x.recargo)) t += `<tr><td>zzgl. ${fmt.num(x.reRate)} % Recargo de equivalencia auf ${fmt.money(x.netto)}</td><td class="r">${fmt.money(x.recargo)}</td></tr>`;
        const frei = Object.values(tax).filter(x => !x.rate).reduce((s, x) => s + x.netto, 0);
        if (frei) t += `<tr><td class="muted">${us ? 'davon nicht steuerpflichtig' : 'davon steuerfrei / durchlaufend'}</td><td class="r muted">${fmt.money(frei)}</td></tr>`;
      }
      t += `<tr class="grand"><td>${typ === 'korrektur' ? 'Gesamtbetrag' : isRe ? 'Rechnungsbetrag' : 'Gesamtbetrag'}</td><td class="r">${fmt.money(k.GBRUTTO)}</td></tr>`;
      if (isRe && d.zahlungen && d.zahlungen.length) {
        const bez = d.zahlungen.reduce((s, z) => s + z.BETRAG, 0);
        t += `<tr><td class="muted">bereits bezahlt (${esc([...new Set(d.zahlungen.map(z => z.ZAHLART))].join(', '))})</td><td class="r muted">${fmt.money(bez)}</td></tr>`;
        t += `<tr><td><b>Offener Betrag</b></td><td class="r"><b>${fmt.money(r2(k.GBRUTTO - bez))}</b></td></tr>`;
      }
      t += '</table>';
      html += t;
      if (klein) html += '<div class="txt muted">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</div>';
      if (hatDP && us) html += '<div class="txt muted">(DP) = Durchlaufende Gebühr, nicht steuerpflichtig.</div>';
      else if (hatDP && gb) html += '<div class="txt muted">(DP) = Auslage im Namen des Kunden (disbursement), nicht umsatzsteuerbar.</div>';
      else if (hatDP && !fr && !lx) html += es ? '<div class="txt muted">(DP) = Suplido: im Namen und für Rechnung des Kunden verauslagt, nicht Teil der Bemessungsgrundlage (Art. 78.Tres.3.º LIVA).</div>' : '<div class="txt muted">(DP) = Durchlaufender Posten gemäß § 10 Abs. 1 Satz 6 UStG, nicht umsatzsteuerpflichtig.</div>';
      if (gb && hatMarge) html += '<div class="txt">Gebrauchtwagen: Margenbesteuerung (second-hand margin scheme, VAT Notice 718). Die Umsatzsteuer wird nicht gesondert ausgewiesen.</div>';
      if (gb && k.STEUERART) html += `<div class="txt muted">${esc({ REVERSE_CHARGE: 'Im Vereinigten Königreich nicht umsatzsteuerbar (Leistungsort im Ausland); der Kunde schuldet die Steuer (reverse charge).', IG_LIEFERUNG: 'Steuerfreie Ausfuhr (zero-rated export).', AUSFUHR: 'Steuerfreie Ausfuhr (zero-rated export).' }[k.STEUERART] || '')}</div>`;
      if (es && k.STEUERART) html += `<div class="txt muted">${esc({ REVERSE_CHARGE: 'Nicht steuerbar in Spanien, Steuerschuldnerschaft des Leistungsempfängers (Art. 69 und 84.Uno.2.º LIVA).', IG_LIEFERUNG: 'Steuerfreie innergemeinschaftliche Lieferung (Art. 25 LIVA).', AUSFUHR: 'Steuerfreie Ausfuhr (Art. 21 LIVA).' }[k.STEUERART] || '')}</div>`;
      if (vf && vf.tipo && vf.tipo[0] === 'R') html += `<div class="txt muted">${esc(`Grund der Korrektur: ${vf.tipo} – ${vf.motivo}`)}</div>`;
    }
    if (isRe || typ === 'angebot' || typ === 'auftrag') {
      let zt = k.ZAHLBDTEXT || '';
      if (isRe && typ === 'rechnung' && Number(k.FAELLING) > 0) zt += (zt ? '\n' : '') + `Zahlbar bis ${fmt.date(addDaysIso(k.DATUM, k.FAELLING))}${Number(k.SKONTO) > 0 ? `, bei Zahlung bis ${fmt.date(addDaysIso(k.DATUM, k.TAGESKONTO))} abzüglich ${fmt.num(k.SKONTO)} % Skonto` : ''}.`;
      if (zt && typ !== 'korrektur') html += `<div class="txt">${esc(zt)}</div>`;
    }
    if (isRe && !es && !gb && !us && !fr && !(isRe && k.LIEFDATUM)) html += '<div class="txt muted">Leistungsdatum entspricht dem Rechnungsdatum.</div>';
    if (k.SCHLUSSTXT) html += `<div class="txt">${esc(k.SCHLUSSTXT)}</div>`;
    if (formular === 'auftrag_mit_unterschrift' && (us || fr)) html += '<div class="txt" style="margin-top:6mm">Ich beauftrage die oben genannten Arbeiten bis zum angegebenen Betrag. Zusätzliche Arbeiten oder Mehrkosten nur nach meiner weiteren Freigabe.</div><div class="sign"><div>Ort, Datum</div><div>Unterschrift Auftraggeber</div></div>';
    else if (formular === 'auftrag_mit_unterschrift') html += `<div class="txt" style="margin-top:6mm">Hiermit erteile ich den Auftrag zur Durchführung der oben genannten Arbeiten. Erforderliche Probefahrten dürfen durchgeführt werden. Es gelten die Allgemeinen Geschäftsbedingungen für die Ausführung von Arbeiten an Kraftfahrzeugen.</div><div class="sign"><div>Ort, Datum</div><div>Unterschrift Auftraggeber</div></div>`;
    if (formular === 'arbeitskarte') html += `<div class="box" style="min-height:45mm"><b>Notizen / ausgeführte Arbeiten:</b></div><div class="grid2"><div class="box">Monteur: ____________________</div><div class="box">Arbeitszeit: von _______ bis _______</div></div>`;
    if (typ === 'lieferschein') html += '<div class="sign"><div>Ware vollständig erhalten – Datum</div><div>Unterschrift Empfänger</div></div>';
    if (us) {
      if (k.STEUERART === 'EXEMPT') html += `<div class="txt">${esc(I18N.tr('Steuerfreier Verkauf (tax exempt)', Print.docLang()) + (d._kd && d._kd.EXEMPTCERT ? ' – ' + I18N.tr('Zertifikat', Print.docLang()) + ' ' + d._kd.EXEMPTCERT : '') + (d._kd && d._kd.EXEMPTREASON ? ' (' + d._kd.EXEMPTREASON + ')' : ''))}</div>`;
      if (!ohnePreise && d.pos.some(p => p.POSART === 'A')) html += '<div class="txt muted">Alle Teile sind neu, sofern nicht anders angegeben.</div>';
      if (k.USALTTEILE === 'zurueck') html += '<div class="txt">Ersetzte Teile wurden dem Kunden zurückgegeben.</div>';
      if (k.USALTTEILE === 'entsorgt') html += '<div class="txt">Ersetzte Teile wurden auf Wunsch des Kunden entsorgt.</div>';
      for (const a of freigaben) html += `<div class="txt muted">${esc(I18N.tr(`Freigegeben: ${fmt.money(a.betrag)} am ${fmt.date(a.datum)} (${I18N.tr(a.art || 'persönlich', Print.docLang())}) durch ${a.person || ''}`, Print.docLang()))}</div>`;
      if (typ === 'angebot' && formular === 'kostenvoranschlag') html += '<div class="txt">Schriftlicher Kostenvoranschlag. Ohne Ihre Freigabe werden keine Arbeiten ausgeführt und keine Beträge über diesem Kostenvoranschlag berechnet.</div><div class="sign"><div>Datum</div><div>Unterschrift Kunde (Freigabe)</div></div>';
    } else if (typ === 'angebot' && formular === 'kostenvoranschlag') html += '<div class="txt muted">Dieser Kostenvoranschlag ist unverbindlich. Abweichungen bis 15 % bleiben vorbehalten.</div>';
    if (fr) {
      for (const m of fr.mentions) html += `<div class="txt muted">${esc(m)}</div>`;
      if (typ === 'angebot' && formular === 'kostenvoranschlag') html += '<div class="txt">Schriftlicher Kostenvoranschlag. Ohne Ihre Freigabe werden keine Arbeiten ausgeführt und keine Beträge über diesem Kostenvoranschlag berechnet.</div><div class="sign"><div>Datum</div><div>Unterschrift Kunde (Freigabe)</div></div>';
    }
    if (lx) for (const m of lx.mentions) html += `<div class="txt muted">${esc(m)}</div>`;
    // Switzerland: payment part of the QR-bill on a page of its own
    const qr = lx && lx.qr && formular !== 'rechnung_ohne_kopf' ? Print.zahlteilHtml(lx.qr, k[v.nr]) : '';
    return Print.sheet(html, f, kopf) + qr;
  },
  // Swiss QR-bill: receipt and payment part (210 x 105 mm) at the bottom of an A4 page without margins
  zahlteilHtml(q, nr) {
    const kreuz = '<svg viewBox="0 0 70 70" style="position:absolute;left:19.5mm;top:19.5mm;width:7mm;height:7mm"><rect width="70" height="70" fill="#fff"/><rect x="5" y="5" width="60" height="60" fill="#000"/><rect x="29.5" y="16" width="11" height="38" fill="#fff"/><rect x="16" y="29.5" width="38" height="11" fill="#fff"/></svg>';
    const code = Print.qrSvg(unescape(encodeURIComponent(q.payload)), 46);
    const blk = (c, kopf, zeilen) => `<div class="${c}h">${esc(kopf)}</div><div class="${c}v">${zeilen.map(esc).join('<br>')}</div>`;
    const betrag = q.betrag ? q.betrag.replace(/\B(?=(\d{3})+\.)/g, ' ') : '';
    const leer = (c, w, hh) => `<div class="${c}h">Zahlbar durch (Name/Adresse)</div><div class="ecken" style="width:${w}mm;height:${hh}mm"></div>`;
    const r = [blk('r', 'Konto / Zahlbar an', [q.konto, ...q.glaeubiger]), q.referenz ? blk('r', 'Referenz', [q.referenz]) : '', q.schuldner ? blk('r', 'Zahlbar durch', q.schuldner) : leer('r', 52, 20)].join('');
    const p = [blk('p', 'Konto / Zahlbar an', [q.konto, ...q.glaeubiger]), q.referenz ? blk('p', 'Referenz', [q.referenz]) : '', q.mitteilung ? blk('p', 'Zusätzliche Informationen', [q.mitteilung]) : '',
      q.schuldner ? blk('p', 'Zahlbar durch', q.schuldner) : leer('p', 65, 25)].join('');
    return `<div class="doc qrpage"><div class="kopf">${esc(Print.firma ? Print.firma.FIRMENNAME || '' : '')} · Rechnung Nr. ${esc(nr)}</div><div class="zt"><div class="note">Vor der Einzahlung abzutrennen</div><div class="cut"></div>
      <div class="abs t" style="left:5mm;top:5mm">Empfangsschein</div><div class="abs" style="left:5mm;top:12mm;width:52mm">${r}</div>
      <div class="abs" style="left:5mm;top:65mm"><div class="rh">Währung</div><div class="rv">${esc(q.waehrung)}</div></div>
      <div class="abs" style="left:22mm;top:65mm"><div class="rh">Betrag</div>${betrag ? `<div class="rv">${esc(betrag)}</div>` : '<div class="ecken" style="width:30mm;height:10mm;margin-left:5mm"></div>'}</div>
      <div class="abs rh" style="left:5mm;width:52mm;top:80mm;text-align:right">Annahmestelle</div>
      <div class="abs t" style="left:67mm;top:5mm">Zahlteil</div><div class="abs" style="left:67mm;top:17mm;width:46mm;height:46mm">${code}${kreuz}</div>
      <div class="abs" style="left:67mm;top:66mm"><div class="ph">Währung</div><div class="pv">${esc(q.waehrung)}</div></div>
      <div class="abs" style="left:87mm;top:66mm"><div class="ph">Betrag</div>${betrag ? `<div class="pv">${esc(betrag)}</div>` : '<div class="ecken" style="width:40mm;height:15mm"></div>'}</div>
      <div class="abs" style="left:118mm;top:5mm;width:87mm">${p}</div></div></div>`;
  },
  async vorgang(typ, d, opts = {}) {
    const f = await Print.ensureFirma();
    if (d.kopf.KUNID) { try { const kd = await api('/api/rec/kunden/' + d.kopf.KUNID); d._ust = kd.USTID; d._kd = kd; } catch { /* ignore */ } }
    // US: the invoice must not exceed the amount the customer authorized
    if (LK.data && LK.data.land === 'US' && ENT.V[typ].table === 'RECHNUNGEN' && typ === 'rechnung') {
      let fr = []; try { fr = JSON.parse(d.kopf.USFREIGABE || '[]'); } catch { /* none */ }
      const max = fr.reduce((m, a) => Math.max(m, Number(a.betrag) || 0), 0);
      if (fr.length && Number(d.kopf.GBRUTTO) > max + 0.005 && !(await confirmDlg(`Der Rechnungsbetrag ${fmt.money(d.kopf.GBRUTTO)} liegt über dem freigegebenen Betrag ${fmt.money(max)}. Trotzdem drucken?`, { ok: 'Drucken' }))) return;
    }
    const html = Print.wrap(Print.vorgangHtml(typ, d, opts, f), f);
    await Print.preview(html, `${ENT.V[typ].title} ${d.kopf[ENT.V[typ].nr]} – Seitenvorschau`);
  },
  async stapel(list, opts = {}) {
    const f = await Print.ensureFirma();
    // Spain: printing issues the invoices (VERI*FACTU records with QR code)
    const neu = list.filter(d => d.es && !d.es.emitida).map(d => d.kopf.RECHNUNGID);
    if (neu.length) {
      if (!(await confirmDlg(`${neu.length} Rechnung(en) werden jetzt ausgestellt und an VERI*FACTU gemeldet. Danach können sie nicht mehr geändert werden.`, { ok: 'Ausstellen' }))) return;
      try { await api('/api/es/emitir', { method: 'POST', body: { ids: neu } }); } catch (e) { showError(e); return; }
      list = await Promise.all(list.map(d => api(`/api/vorgang/${d.kopf.TYP === 2 ? 'korrektur' : 'rechnung'}/${d.kopf.RECHNUNGID}`)));
    }
    const body = list.map(d => Print.vorgangHtml(d.kopf.TYP === 2 ? 'korrektur' : 'rechnung', d, { briefpapier: opts.briefpapier }, f)).join('');
    await Print.preview(Print.wrap(body, f), `Stapeldruck (${list.length} Belege)`);
    const ids = list.filter(d => !Number(d.kopf.GEDRUCKT)).map(d => d.kopf.RECHNUNGID);
    if (ids.length) await api('/api/vorgang/rechnung/flag', { method: 'POST', body: { ids, flag: 'GEDRUCKT', value: 1 } });
  },

  // ---------- Dunning letter ----------
  async mahnungById(id) { const m = await api('/api/finanzen/mahnung/' + id); return Print.mahnung([m]); },
  async mahnung(list) {
    const f = await Print.ensureFirma();
    const body = list.map(({ mahnung: m, rechnung: r, fruehere }) => {
      const gebuehren = (Number(m.MAHNGEBUEHREN) || 0) + fruehere.reduce((s, x) => s + (Number(x.MAHNGEBUEHREN) || 0), 0);
      let html = Print.headHtml(f);
      html += `<div class="addrrow"><div class="addr"><div class="sender">${Print.senderLine(f)}</div><div class="to">${Print.addressHtml({ anrede: r.KUNANREDE, name: r.KUNNAME, vorname: r.KUNVORNAME, zusatz: r.KUNZUSATZ, strasse: r.KUNSTRASSE, plz: r.KUNPLZ, ort: r.KUNORT, land: r.KUNLAND })}</div></div>
        <div class="info"><table><tr><td>Datum</td><td><b>${fmt.date(m.MAHNDATUM)}</b></td></tr><tr><td>Kunden-Nr.</td><td><b>${esc(r.KUNNUMMER ?? '')}</b></td></tr><tr><td>Mahnstufe</td><td><b>${esc(m.MAHNSTUFE)}</b></td></tr></table></div></div>`;
      html += `<h1>${esc(m.BETREFFTXT || 'Zahlungserinnerung')}</h1>`;
      if (m.VORTEXT) html += `<div class="txt">${esc(m.VORTEXT)}</div>`;
      html += `<table class="items"><thead><tr><th>Rechnung</th><th>Datum</th><th>Fällig seit</th><th class="r">Rechnungsbetrag</th><th class="r">offen</th></tr></thead><tbody>
        <tr><td>${esc(r.RECHNUNGNUMMER)}</td><td>${fmt.date(r.DATUM)}</td><td>${fmt.date(addDaysIso(r.DATUM, r.FAELLING || 0))}</td><td class="r">${fmt.money(r.GBRUTTO)}</td><td class="r">${fmt.money(r.OFFEN)}</td></tr></tbody></table>
        <table class="totals"><tr><td>Offener Rechnungsbetrag</td><td class="r">${fmt.money(r.OFFEN)}</td></tr>${gebuehren ? `<tr><td>Mahngebühren</td><td class="r">${fmt.money(gebuehren)}</td></tr>` : ''}<tr class="grand"><td>Zu zahlender Betrag</td><td class="r">${fmt.money(r2(r.OFFEN + gebuehren))}</td></tr></table>`;
      if (m.NACHTEXT) html += `<div class="txt">${esc(m.NACHTEXT)}</div>`;
      if (f.IBAN) html += `<div class="txt">Bitte überweisen Sie den Betrag auf unser Konto: IBAN ${esc(f.IBAN)}${f.BIC ? ' · BIC ' + esc(f.BIC) : ''} · Verwendungszweck: Rechnung ${esc(r.RECHNUNGNUMMER)}</div>`;
      return Print.sheet(html, f);
    }).join('');
    await Print.preview(Print.wrap(body, f), 'Mahnung – Seitenvorschau');
  },

  // ---------- Tyre storage ----------
  async reifen(r) {
    const f = await Print.ensureFirma();
    const fz = r.FAHRZEUGID ? await api('/api/rec/fahrzeuge/' + r.FAHRZEUGID).catch(() => ({})) : {};
    const kd = r.KUNID ? await api('/api/rec/kunden/' + r.KUNID).catch(() => ({})) : {};
    const z = n => ({ 0: '–', 1: 'gut', 2: 'mittel', 3: 'schlecht', 4: 'erneuern' }[n] || '–');
    const typ = { 1: 'Sommerreifen', 2: 'Winterreifen', 3: 'Ganzjahresreifen' }[r.REIFENTYP] || '';
    const seite = p => `${esc(r['REIFEN' + p + 'HERSTELLER'] || '')} ${esc(r['REIFEN' + p + 'BREITE'] || '')}/${esc(r['REIFEN' + p + 'QUERSCHNITT'] || '')} R${esc(r['REIFEN' + p + 'DURCHM'] || '')} ${esc(r[p === 'VORNE' ? 'REIFENVORNETRAGINX' : 'REIFENHINTENTRAGINX'] || '')}${esc(r[p === 'VORNE' ? 'REIFENVORNEGESCHINX' : 'REIFENHINTENGESCHINX'] || '')} · Zustand: ${z(r[p === 'VORNE' ? 'REIFENVORNZUSTAND' : 'REIFENHINTENZUSTAND'])}`;
    let html = Print.headHtml(f);
    html += `<div class="addrrow"><div class="addr"><div class="sender">${Print.senderLine(f)}</div><div class="to">${Print.addressHtml({ anrede: kd.ANREDE, name: kd.NAME, vorname: kd.VORNAME, zusatz: kd.ZUSATZ, strasse: kd.STRASSE, plz: kd.PLZ, ort: kd.ORT })}</div></div>
      <div class="info"><table><tr><td>Einlagerungs-Nr.</td><td><b>${esc(r.EINLNUMMER)}</b></td></tr><tr><td>Eingelagert am</td><td><b>${fmt.date(r.EINDATUM)}</b></td></tr>${r.AUSDATUM ? `<tr><td>Ausgelagert am</td><td><b>${fmt.date(r.AUSDATUM)}</b></td></tr>` : ''}<tr><td>Lagerort</td><td><b>${esc(r.LAGERORT || '')}</b></td></tr><tr><td>Kunden-Nr.</td><td><b>${esc(kd.NUMMER || '')}</b></td></tr></table></div></div>`;
    html += `<h1>Einlagerungsbeleg / Reifenverwahrung Nr. ${esc(r.EINLNUMMER)}</h1>`;
    html += `<div class="fz"><div><span>Kennzeichen:</span> <b>${esc(fz.KENNZEICHEN || '')}</b></div><div><span>Fahrzeug:</span> ${esc([fz.MARKE, fz.MODELL].filter(Boolean).join(' '))}</div><div><span>FIN:</span> ${esc(fz.FZIDENTNR || '')}</div></div>`;
    html += `<div class="box"><div class="kv"><span>Reifentyp</span><b>${typ} ${Number(r.RFT) ? '(Runflat)' : ''}</b><span>Anzahl Reifen</span><b>${esc(r.REIFENANZAHL ?? '')}</b><span>Vorne</span><div>${seite('VORNE')}</div><span>Hinten</span><div>${seite('HINTEN')}</div>
      <span>Profiltiefe (mm)</span><div>VL ${fmt.num(r.REIFENPROFILVL)} · VR ${fmt.num(r.REIFENPROFILVR)} · HL ${fmt.num(r.REIFENPROFILHL)} · HR ${fmt.num(r.REIFENPROFILHR)}${r.REIFENPROFILHL2 ? ' · Reserve ' + fmt.num(r.REIFENPROFILHL2) : ''}</div>
      <span>DOT</span><div>${[r.REIFENDOTVL, r.REIFENDOTVR, r.REIFENDOTHL, r.REIFENDOTHR].filter(Boolean).map(esc).join(' · ')}</div></div></div>`;
    html += `<div class="box"><div class="kv"><span>Felgen</span><b>${{ 1: 'Alufelgen', 2: 'Stahlfelgen' }[r.FELGENTYP] || '–'}</b><span>Felge vorne</span><div>${esc([r.FELGEVORNEMARKE, r.FELGEVORNEGROSSE].filter(Boolean).join(' '))} ${esc(r.FELGEVORNESCHADEN || '')}</div><span>Felge hinten</span><div>${esc([r.FELGEHINTENMARKE, r.FELGEHINTENGROSSE].filter(Boolean).join(' '))} ${esc(r.FELGEHINTENSCHADEN || '')}</div>
      <span>Radkappen / Schrauben</span><div>${esc(r.RADKAPPENANZAHL ?? 0)} / ${esc(r.RADSCHRAUBENANZAHL ?? 0)}</div><span>Felgenschloss</span><div>${Number(r.RADSCHLOSS) ? 'ja ' + esc(r.RADSCHLOSSNR || '') : 'nein'}</div>
      <span>Leistungen</span><div>${[Number(r.OPTWUCHTEN) && 'Wuchten', Number(r.OPTWASCHEN) && 'Waschen', Number(r.OPTSTICKSTOFF) && 'Stickstoff'].filter(Boolean).join(', ') || '–'}</div></div></div>`;
    if (r.BEMERKUNG) html += `<div class="txt"><b>Bemerkung:</b> ${esc(r.BEMERKUNG)}</div>`;
    html += '<div class="txt muted">Die eingelagerten Räder/Reifen werden gegen Vorlage dieses Belegs ausgehändigt. Für Schäden durch höhere Gewalt wird keine Haftung übernommen.</div>';
    html += '<div class="sign"><div>Datum, Unterschrift Kunde</div><div>Datum, Unterschrift Werkstatt</div></div>';
    await Print.preview(Print.wrap(Print.sheet(html, f), f), 'Einlagerungsbeleg');
  },

  // ---------- Letter / mail merge ----------
  briefHtml(f, kd, betreff, text, datum) {
    const anr = briefanrede(kd);
    const t = String(text || '').replace(/\{Briefanrede\}/g, anr).replace(/\{Anrede\}/g, kd.ANREDE || '').replace(/\{Name\}/g, kd.NAME || '').replace(/\{Vorname\}/g, kd.VORNAME || '')
      .replace(/\{Kennzeichen\}/g, kd.KENNZEICHEN || '').replace(/\{Termin\}/g, fmt.date(kd.TERMIN)).replace(/\{Fahrzeug\}/g, [kd.MARKE, kd.MODELL].filter(Boolean).join(' '));
    let html = Print.headHtml(f);
    html += `<div class="addrrow"><div class="addr"><div class="sender">${Print.senderLine(f)}</div><div class="to">${Print.addressHtml({ anrede: kd.ANREDE, name: kd.NAME, vorname: kd.VORNAME, zusatz: kd.ZUSATZ, strasse: kd.STRASSE, plz: kd.PLZ, ort: kd.ORT, land: kd.LAND })}</div></div>
      <div class="info"><table><tr><td>Datum</td><td><b>${fmt.date(datum || today())}</b></td></tr>${kd.NUMMER ? `<tr><td>Kunden-Nr.</td><td><b>${esc(kd.NUMMER)}</b></td></tr>` : ''}</table></div></div>`;
    html += `<h1 style="font-size:12pt">${esc(betreff || '')}</h1><div class="txt" style="font-size:10pt;line-height:1.5">${esc(t)}</div>`;
    return Print.sheet(html, f);
  },
  async brief(b) {
    const f = await Print.ensureFirma();
    const kd = b.KUNID ? await api('/api/rec/kunden/' + b.KUNID) : {};
    await Print.preview(Print.wrap(Print.briefHtml(f, kd, b.BETREFF, b.TEXT, b.DATUM), f), 'Brief');
  },
  async serienbrief(empfaenger, betreff, text) {
    const f = await Print.ensureFirma();
    await Print.preview(Print.wrap(empfaenger.map(k => Print.briefHtml(f, k, betreff, text)).join(''), f), `Serienbrief (${empfaenger.length} Briefe)`);
  },

  // ---------- Lists ----------
  async liste(title, sub, cols, rows, footer, { quer = false } = {}) {
    const f = await Print.ensureFirma();
    const val = (c, r) => { const v = r[c.f]; return c.t === 'money' ? fmt.money0(v) : c.t === 'date' ? fmt.date(v) : c.t === 'month' ? fmt.month(v) : c.t === 'num' ? fmt.num(v) : esc(v ?? ''); };
    const isR = c => ['money', 'num', 'int'].includes(c.t);
    const html = `<div class="sheet"><div class="listtitle">${esc(title)}</div><div class="muted" style="margin-bottom:3mm">${esc(f.FIRMENNAME || '')} · ${esc(sub || '')} · erstellt am ${fmt.date(today())}</div>
      <table class="list"><thead><tr>${cols.map(c => `<th class="${isR(c) ? 'r' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr>${cols.map(c => `<td class="${isR(c) ? 'r' : ''}">${val(c, r)}</td>`).join('')}</tr>`).join('')}</tbody>
      ${footer ? `<tfoot><tr>${cols.map((c, i) => `<td class="${isR(c) ? 'r' : ''}">${footer[c.f] != null ? val(c, footer) : (i === 0 ? 'Summe' : '')}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
    await Print.preview(Print.wrap(html, f, { extraCss: `@page { size: A4 ${quer ? 'landscape' : 'portrait'}; margin: 12mm; } @media screen { .sheet { width: ${quer ? '297mm' : '210mm'}; min-height: auto; padding: 12mm; } }` }), title, { doc: false });
  },

  // ---------- Show e-invoice ----------
  erechnungAnsicht(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) { toast('Die Datei ist kein gültiges XML.', 'err'); return; }
    const L = (el, name) => el ? [...el.getElementsByTagName('*')].filter(e => e.localName === name) : [];
    const T = (el, ...path) => { let cur = [el]; for (const p of path) { cur = cur.flatMap(c => L(c, p)); if (!cur.length) return ''; } return cur[0].textContent.trim(); };
    const root = doc.documentElement; const isCii = root.localName === 'CrossIndustryInvoice';
    let d;
    if (isCii) {
      const sel = L(root, 'SellerTradeParty')[0], buy = L(root, 'BuyerTradeParty')[0], sum = L(root, 'SpecifiedTradeSettlementHeaderMonetarySummation')[0];
      const addr = p => [T(p, 'Name'), T(p, 'LineOne'), [T(p, 'PostcodeCode'), T(p, 'CityName')].join(' '), T(p, 'CountryID')].filter(Boolean);
      d = { nr: T(root, 'ExchangedDocument', 'ID'), typ: T(root, 'ExchangedDocument', 'TypeCode'), datum: T(root, 'ExchangedDocument', 'IssueDateTime', 'DateTimeString'),
        seller: addr(sel), sellerTax: L(sel, 'SpecifiedTaxRegistration').map(e => e.textContent.trim()).join(', '), buyer: addr(buy), ref: T(root, 'BuyerReference'),
        lines: L(root, 'IncludedSupplyChainTradeLineItem').map(li => ({ id: T(li, 'LineID'), name: T(li, 'SpecifiedTradeProduct', 'Name'), qty: T(li, 'BilledQuantity'), unit: (L(li, 'BilledQuantity')[0] || { getAttribute: () => '' }).getAttribute('unitCode'), price: T(li, 'NetPriceProductTradePrice', 'ChargeAmount'), tax: T(li, 'RateApplicablePercent'), total: T(li, 'LineTotalAmount') })),
        netto: T(sum, 'TaxBasisTotalAmount'), steuer: T(sum, 'TaxTotalAmount'), brutto: T(sum, 'GrandTotalAmount'), faellig: T(sum, 'DuePayableAmount'),
        iban: T(root, 'IBANID'), zahl: T(root, 'SpecifiedTradePaymentTerms', 'Description'), notes: L(root, 'IncludedNote').map(n => n.textContent.trim()) };
    } else {
      const sel = L(root, 'AccountingSupplierParty')[0], buy = L(root, 'AccountingCustomerParty')[0], sum = L(root, 'LegalMonetaryTotal')[0];
      const addr = p => [T(p, 'RegistrationName') || T(p, 'Name'), T(p, 'StreetName'), [T(p, 'PostalZone'), T(p, 'CityName')].join(' '), T(p, 'IdentificationCode')].filter(Boolean);
      d = { nr: [...root.children].find(e => e.localName === 'ID')?.textContent, typ: T(root, 'InvoiceTypeCode') || T(root, 'CreditNoteTypeCode'), datum: [...root.children].find(e => e.localName === 'IssueDate')?.textContent,
        seller: addr(sel), sellerTax: L(sel, 'CompanyID').map(e => e.textContent).join(', '), buyer: addr(buy), ref: T(root, 'BuyerReference'),
        lines: [...L(root, 'InvoiceLine'), ...L(root, 'CreditNoteLine')].map(li => ({ id: [...li.children].find(e => e.localName === 'ID')?.textContent, name: T(li, 'Item', 'Name'), qty: T(li, 'InvoicedQuantity') || T(li, 'CreditedQuantity'), unit: '', price: T(li, 'PriceAmount'), tax: T(li, 'ClassifiedTaxCategory', 'Percent'), total: [...li.children].find(e => e.localName === 'LineExtensionAmount')?.textContent })),
        netto: T(sum, 'TaxExclusiveAmount'), steuer: T(root, 'TaxTotal', 'TaxAmount'), brutto: T(sum, 'TaxInclusiveAmount'), faellig: T(sum, 'PayableAmount'),
        iban: T(root, 'PayeeFinancialAccount', 'ID'), zahl: T(root, 'PaymentTerms', 'Note'), notes: [...root.children].filter(e => e.localName === 'Note').map(n => n.textContent) };
    }
    const n = x => x === '' ? '' : fmt.money0(Number(x));
    const dt = s => s && s.length === 8 ? `${s.slice(6)}.${s.slice(4, 6)}.${s.slice(0, 4)}` : fmt.date(s);
    const html = `<div class="sheet"><div class="listtitle">E-Rechnung (${isCii ? 'XRechnung CII' : 'XRechnung UBL'}) – ${{ 380: 'Rechnung', 381: 'Gutschrift', 384: 'Korrekturrechnung' }[d.typ] || 'Typ ' + esc(d.typ)} Nr. ${esc(d.nr)}</div>
      <div class="muted">Rechnungsdatum ${dt(d.datum)} · Käuferreferenz ${esc(d.ref)}</div>
      <div class="grid2" style="margin:4mm 0"><div class="box"><b>Verkäufer</b><br>${d.seller.map(esc).join('<br>')}<br><span class="muted">${esc(d.sellerTax)}</span></div><div class="box"><b>Käufer</b><br>${d.buyer.map(esc).join('<br>')}</div></div>
      <table class="list"><thead><tr><th>Pos</th><th>Bezeichnung</th><th class="r">Menge</th><th class="r">Preis</th><th class="r">USt %</th><th class="r">Betrag</th></tr></thead><tbody>
      ${d.lines.map(l => `<tr><td>${esc(l.id)}</td><td>${esc(l.name)}</td><td class="r">${esc(l.qty)} ${esc(l.unit || '')}</td><td class="r">${n(l.price)}</td><td class="r">${esc(l.tax)}</td><td class="r">${n(l.total)}</td></tr>`).join('')}</tbody></table>
      <table class="totals"><tr><td>Netto</td><td class="r">${n(d.netto)}</td></tr><tr><td>Umsatzsteuer</td><td class="r">${n(d.steuer)}</td></tr><tr class="grand"><td>Brutto</td><td class="r">${n(d.brutto)}</td></tr><tr><td>Zahlbetrag</td><td class="r">${n(d.faellig)}</td></tr></table>
      <div class="txt">${esc(d.zahl)}${d.iban ? '<br>IBAN: ' + esc(d.iban) : ''}</div>${d.notes.map(x => `<div class="txt muted">${esc(x)}</div>`).join('')}</div>`;
    Print.preview(Print.wrap(html, {}, { extraCss: '@media screen { .sheet { min-height: auto; } }' }), 'E-Rechnung visualisieren', { doc: false });
  },
};
function addDaysIso(iso, n) { const d = new Date((iso || today()) + 'T12:00:00'); d.setDate(d.getDate() + Number(n || 0)); return d.toISOString().slice(0, 10); }
function briefanrede(k) {
  const a = String(k.ANREDE || '').trim();
  if (/^herr/i.test(a)) return `Sehr geehrter ${a} ${k.NAME || ''},`.replace(/\s+,/, ',');
  if (/^frau/i.test(a)) return `Sehr geehrte ${a} ${k.NAME || ''},`.replace(/\s+,/, ',');
  if (/^familie/i.test(a)) return `Sehr geehrte Familie ${k.NAME || ''},`;
  return 'Sehr geehrte Damen und Herren,';
}
