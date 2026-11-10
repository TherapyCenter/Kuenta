'use strict';
/* global Print, fmt, esc, api, today, qrcode, I18N, LK */
// Additional print templates: receipt, Z report, purchase contract, price tag, time sheet, stocktaking, expenses

Object.assign(Print, {
  bonCss: `@page { size: 80mm auto; margin: 3mm; } body { font-family: "Courier New", monospace; font-size: 9pt; color: #000; width: 72mm; margin: 0 auto; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; } hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
    table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 0.3mm 0; } .big { font-size: 13pt; font-weight: bold; } .small { font-size: 7pt; word-break: break-all; }
    @media screen { body { background: #fff; padding: 4mm; box-shadow: 0 2px 10px rgba(0,0,0,.4); margin: 10px auto; } html { background: #8a96a6; } }`,

  qrSvg(text, size = 38) {
    if (!text || typeof qrcode !== 'function') return '';
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0 }).replace('<svg ', `<svg style="width:${size}mm;height:${size}mm" `); } catch { return ''; }
  },

  async kassenbon(d, { kopie = false } = {}) {
    const b = d.bon, f = d.firma;
    const es = d.es; // Spain: the receipt is the invoice (factura simplificada) with the VERI*FACTU QR code
    const gb = LK.data && LK.data.land === 'GB'; // UK: no fiscal signature on receipts, VAT registration number instead
    const satzA = LK.rate(61), satzB = LK.rate(62);
    const buchstabe = s => s === satzA ? 'A' : s === satzB ? 'B' : s === 4 && es ? 'D' : 'C';
    const zeilen = d.pos.map(p => `<tr><td colspan="2">${esc(p.BEZEICHNUNG)}</td></tr><tr><td>${fmt.num(p.MENGE, 3)} x ${fmt.money0(p.EINZEL)}${Number(p.RABATT) ? ` -${fmt.num(p.RABATT)}%` : ''}</td><td class="r">${fmt.money0(p.BRUTTO)} ${buchstabe(p.MWSTSATZ)}</td></tr>`).join('');
    const vf = es && es.emitida && es.qr ? `<hr><div class="c">QR tributario:<br>${Print.qrSvg(es.qr, 32)}<br><b>VERI*FACTU</b>${es.entorno === 'pruebas' ? '<br><span class="small">Testumgebung – nicht bei der AEAT registriert</span>' : ''}</div>` : '';
    const us = LK.data && LK.data.land === 'US';
    // France: signature of the receipt (journal ISCA) and numbered duplicate on reprints
    let frBlock = '';
    if (LK.data && LK.data.land === 'FR') {
      let dup = null; if (kopie) { try { dup = await api(`/api/fr/caisse/duplicata/${b.ID}`, { method: 'POST' }); } catch { /* offline */ } }
      frBlock = `${dup && dup.numero ? `<div class="c b">*** DUPLICATA n° ${dup.numero} ***</div>` : ''}${d.fr ? `<div class="small">Ticket n° ${esc(d.fr.nr)} · Signature ${esc(d.fr.court)}</div>` : ''}`;
    }
    // Austria: machine-readable code of the RKSV with cash register id and receipt number
    const at = LK.data && LK.data.land === 'AT'; const ch = LK.data && LK.data.land === 'CH';
    const atBlock = d.at ? `<hr><div class="c">${Print.qrSvg(d.at.qr, 34)}</div><div class="small c">Kassen-ID ${esc(d.at.kassenid)} · Beleg-Nr. ${esc(d.at.nr)}${d.at.ausfall ? '<br><b>Sicherheitseinrichtung ausgefallen</b>' : ''}</div>` : '';
    const lbl = at ? 'USt' : ch ? 'MWST' : 'MwSt';
    const tse = atBlock || (frBlock ? '<hr>' + frBlock : es ? vf : (gb || us || at || ch || (LK.data && LK.data.land === 'FR')) ? '' : b.TSE_SIGNATUR ? `<hr><div class="small">TSE-Seriennr.: ${esc(b.TSE_SERIAL)}<br>Transaktion: ${esc(b.TSE_TXNR)} · Signaturzähler: ${esc(b.TSE_ZAEHLER)}<br>Start: ${esc(b.TSE_START)}<br>Ende: ${esc(b.TSE_ENDE)}<br>Signatur: ${esc(b.TSE_SIGNATUR)}</div><div class="c">${Print.qrSvg(b.TSE_QR)}</div>`
      : b.TSE_FEHLER ? `<hr><div class="small b">${esc(b.TSE_FEHLER)}</div>` : '<hr><div class="small">Keine TSE aktiv</div>');
    const html = `<div class="c b" style="font-size:11pt">${esc(f.FIRMENNAME || '')}</div><div class="c">${esc(f.STRASSE || '')}<br>${esc(Print.plzOrt(f.PLZ, f.ORT))}<br>${esc(f.TELEFON || '')}${es ? (es.nifEmisor ? '<br>NIF ' + esc(es.nifEmisor) : '') : at ? (f.USTNR ? '<br>UID ' + esc(f.USTNR) : '') : ch ? (f.USTNR ? '<br>MWST-Nr. ' + esc(f.USTNR) : '') : gb ? (f.USTNR ? '<br>VAT-Reg.-Nr. ' + esc(f.USTNR) : '') : f.USTNR ? '<br>USt-IdNr. ' + esc(f.USTNR) : f.STEUERNR ? '<br>St.-Nr. ' + esc(f.STEUERNR) : ''}</div><hr>
      ${kopie && !(LK.data && LK.data.land === 'FR') ? '<div class="c b">*** KOPIE ***</div>' : ''}${b.STORNOID ? '<div class="c b">*** STORNO ***</div>' : ''}
      ${es && es.emitida ? `<div class="b">${esc({ F1: 'Rechnung', F2: 'Vereinfachte Rechnung', R5: 'Vereinfachte Rechnungskorrektur' }[es.tipo] || 'Rechnungskorrektur')} Nr. ${esc(es.numSerie)}</div>` : ''}
      <div>${esc(b.TYP === 'Beleg' ? 'Kassenbeleg' : b.TYP)} Nr. ${b.BONNR}<br>${fmt.datetime(b.ZEIT)}${b.BEDIENER ? '<br>Bediener: ' + esc(b.BEDIENER) : ''}<br>Kasse: ${esc(d.kasse)}${b.KUNDE && b.KUNDE !== 'Barverkauf' ? '<br>Kunde: ' + esc(b.KUNDE) : ''}${d.rechnungnr && !es ? '<br>Rechnung Nr. ' + esc(d.rechnungnr) : ''}</div><hr>
      <table>${zeilen}</table><hr>
      <table><tr><td class="big">SUMME</td><td class="r big">${fmt.money(b.BRUTTO)}</td></tr>
      <tr><td>${esc({ BAR: 'Bar', EC: 'EC-Karte', KARTE: 'Kreditkarte', UEBERWEISUNG: 'Überweisung', KRYPTO: 'Krypto' }[b.ZAHLART] || b.ZAHLART)}${b.ZAHLART === 'KRYPTO' && b.VERWENDUNG ? '<br><small>' + esc(b.VERWENDUNG.replace(/^Krypto \(BTCPay\)( · )?/, 'BTCPay ')) + '</small>' : ''}</td><td class="r">${fmt.money(b.GEGEBEN)}</td></tr>
      ${Number(b.RUECKGELD) ? `<tr><td>Rückgeld</td><td class="r">${fmt.money(b.RUECKGELD)}</td></tr>` : ''}</table><hr>
      <table><tr><td>${lbl}</td><td class="r">Netto</td><td class="r">${lbl}</td><td class="r">Brutto</td></tr>${d.ust.map(u => `<tr><td>${buchstabe(u.satz)} ${fmt.num(u.satz)}%</td><td class="r">${fmt.money0(u.netto)}</td><td class="r">${fmt.money0(u.mwst)}</td><td class="r">${fmt.money0(u.brutto)}</td></tr>`).join('')}</table>
      ${tse}<hr><div class="c">${esc(d.fusstext || '')}</div>`;
    await Print.preview(`<!doctype html><html><head><meta charset="utf-8"><style>${Print.bonCss}</style></head><body>${html}</body></html>`, `Kassenbon ${b.BONNR}`);
  },

  async zbon(a) {
    const f = a.firma;
    const zp = a.ZAEHLPROTOKOLL ? Object.entries(a.ZAEHLPROTOKOLL).filter(([, n]) => Number(n)).sort((x, y) => Number(y[0]) - Number(x[0])).map(([w, n]) => `<tr><td>${n} x ${fmt.money(Number(w))}</td><td class="r">${fmt.money(Number(w) * Number(n))}</td></tr>`).join('') : '';
    const html = `<div class="c b" style="font-size:11pt">${esc(f.FIRMENNAME || '')}</div><div class="c">${esc([f.STRASSE, Print.plzOrt(f.PLZ, f.ORT)].filter(Boolean).join(', '))}</div><hr>
      <div class="c big">Kassenabschluss (Z-Bon)</div><div>Z-Nr.: ${a.ZNR}<br>Datum: ${fmt.datetime(a.ZEIT)}<br>Kasse: ${esc(a.kasse)}${a.BEDIENER ? '<br>Bediener: ' + esc(a.BEDIENER) : ''}<br>Bons: ${a.VON_BONID || '-'} bis ${a.BIS_BONID || '-'}</div><hr>
      <table><tr><td>Anfangsbestand</td><td class="r">${fmt.money(a.ANFANG)}</td></tr><tr><td>Bareinnahmen</td><td class="r">${fmt.money(a.BAR_EIN)}</td></tr><tr><td>Barausgaben</td><td class="r">${fmt.money(a.BAR_AUS)}</td></tr>
      <tr><td class="b">Soll-Bestand</td><td class="r b">${fmt.money(a.SOLL)}</td></tr><tr><td class="b">Ist-Bestand (gezählt)</td><td class="r b">${fmt.money(a.IST)}</td></tr><tr><td>Differenz</td><td class="r">${fmt.money(a.DIFFERENZ)}</td></tr></table><hr>
      <div class="b">Umsatz nach Steuersätzen</div><table>${a.UST.map(u => `<tr><td>${fmt.num(u.satz)} %</td><td class="r">netto ${fmt.money0(u.netto)}</td><td class="r">${fmt.money0(u.brutto)}</td></tr>`).join('')}<tr><td class="b">Gesamt</td><td class="r">${fmt.money0(a.UMSATZ_NETTO)}</td><td class="r b">${fmt.money0(a.UMSATZ_BRUTTO)}</td></tr></table><hr>
      <div class="b">Zahlarten</div><table>${Object.entries(a.ZAHLARTEN).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${fmt.money(v)}</td></tr>`).join('')}</table>
      ${zp ? `<hr><div class="b">Zählprotokoll</div><table>${zp}</table>` : ''}<hr><div class="c">Unterschrift: ______________________</div>`;
    await Print.preview(`<!doctype html><html><head><meta charset="utf-8"><style>${Print.bonCss}</style></head><body>${html}</body></html>`, `Z-Bon ${a.ZNR}`, { doc: false });
  },

  async kaufvertrag(v) {
    const f = await Print.ensureFirma();
    const k = JSON.parse(v.KAEUFER || '{}'); const z = JSON.parse(v.FAHRZEUG || '{}');
    const gw = { 0: 'Die Ansprüche des Käufers wegen Sachmängeln richten sich nach den gesetzlichen Bestimmungen (Verjährung 2 Jahre).', 1: 'Die Verjährungsfrist für Ansprüche wegen Sachmängeln wird auf ein Jahr ab Übergabe verkürzt. Der Käufer wurde vor Abgabe seiner Vertragserklärung eigens davon in Kenntnis gesetzt; die Verkürzung wurde ausdrücklich und gesondert vereinbart (§ 476 Abs. 2 BGB). Die Verkürzung gilt nicht für Schadensersatzansprüche wegen Verletzung von Leben, Körper oder Gesundheit sowie bei Vorsatz und grober Fahrlässigkeit.', 2: 'Das Fahrzeug wird unter Ausschluss jeglicher Sachmängelhaftung verkauft (nur zulässig gegenüber Unternehmern). Der Ausschluss gilt nicht für Schadensersatzansprüche wegen Verletzung von Leben, Körper oder Gesundheit sowie bei Vorsatz, grober Fahrlässigkeit oder arglistigem Verschweigen.' }[v.GEWAEHRLEISTUNG] || '';
    const kv = (a, b) => `<span>${esc(a)}</span><div>${esc(b ?? '') || '&nbsp;'}</div>`;
    let html = Print.headHtml(f);
    html += `<h1 style="margin-top:0">Kaufvertrag über ein ${v.ART === 'NW' ? 'neues' : 'gebrauchtes'} Kraftfahrzeug</h1><div class="muted">Vertrags-Nr. ${esc(v.NUMMER)} vom ${fmt.date(v.DATUM)}</div>
      <div class="grid2"><div class="box"><b>Verkäufer</b><br>${esc(f.FIRMENNAME || '')}<br>${esc(f.STRASSE || '')}<br>${esc(Print.plzOrt(f.PLZ, f.ORT))}<br>${esc(f.TELEFON || '')}</div>
      <div class="box"><b>Käufer</b>${Number(v.UNTERNEHMER) ? ' (Unternehmer)' : ' (Verbraucher)'}<br>${esc([k.anrede && !/firma/i.test(k.anrede) ? k.anrede : '', k.vorname, k.name].filter(Boolean).join(' '))}<br>${esc(k.zusatz || '')}${k.zusatz ? '<br>' : ''}${esc(k.strasse || '')}<br>${esc([k.plz, k.ort].filter(Boolean).join(' '))}<br>${esc(k.telefon || '')}${k.gebdatum ? '<br>geb. ' + fmt.date(k.gebdatum) : ''}</div></div>
      <div class="box"><b>Fahrzeug</b><div class="kv" style="margin-top:1mm">${kv('Hersteller / Typ', [z.marke, z.modell].filter(Boolean).join(' '))}${kv('Fahrzeug-Ident.-Nr.', z.fin)}${kv('Amtl. Kennzeichen', z.kennzeichen)}${kv('Erstzulassung', fmt.date(z.ez))}${kv('km-Stand (abgelesen)', v.KMSTAND)}${kv('Nächste HU', fmt.month(v.HU))}${kv('ZB II-Nr.', z.briefnr)}${kv('Leistung', z.kw ? `${z.kw} kW (${z.ps || Math.round(z.kw * 1.36)} PS)` : '')}${kv('Anzahl Vorbesitzer', z.vorbesitzer)}${kv('Farbe', z.farbe)}</div></div>
      <div class="box"><b>Kaufpreis und Zahlung</b><div class="kv" style="margin-top:1mm">${kv('Kaufpreis', fmt.money(v.KAUFPREIS) + (Number(v.DIFFBESTEUERT) ? ' (Differenzbesteuerung gem. § 25a UStG, keine MwSt ausweisbar)' : ' inkl. gesetzlicher MwSt'))}${Number(v.ANZAHLUNG) ? kv('Anzahlung', fmt.money(v.ANZAHLUNG)) : ''}${Number(v.INZAHLUNGNAHMEBETRAG) ? kv('Inzahlungnahme', `${v.INZAHLUNGNAHME || ''} – angerechnet mit ${fmt.money(v.INZAHLUNGNAHMEBETRAG)}`) : ''}${kv('Restbetrag', fmt.money((v.KAUFPREIS || 0) - (v.ANZAHLUNG || 0) - (v.INZAHLUNGNAHMEBETRAG || 0)))}${kv('Zahlungsweise', v.ZAHLUNGSWEISE)}${kv('Übergabe / Liefertermin', fmt.date(v.LIEFERTERMIN))}</div></div>
      <div class="box"><b>Zustand, Unfallschäden und bekannte Mängel</b><div style="margin-top:1mm;white-space:pre-wrap">${Number(v.UNFALLFREI) ? 'Das Fahrzeug ist nach Kenntnis des Verkäufers unfallfrei.\n' : ''}${v.UNFALLSCHAEDEN ? 'Unfallschäden: ' + esc(v.UNFALLSCHAEDEN) + '\n' : ''}${v.MAENGEL ? 'Bekannte Mängel: ' + esc(v.MAENGEL) : 'Keine bekannten Mängel.'}</div></div>
      <div class="box"><b>Sachmängelhaftung</b><div style="margin-top:1mm">${esc(gw)}${Number(v.AKTUALISIERUNG_AUS) ? ' Eine Pflicht zur Bereitstellung von Aktualisierungen für digitale Elemente (§ 475b BGB) besteht nach gesonderter Vereinbarung nicht.' : ''}</div></div>
      ${v.VORVERTRAGLICH ? `<div class="box"><b>Vorvertragliche Informationen</b><div style="white-space:pre-wrap;margin-top:1mm">${esc(v.VORVERTRAGLICH)}</div></div>` : ''}
      ${v.ZUSATZ ? `<div class="box"><b>Sonstige Vereinbarungen</b><div style="white-space:pre-wrap;margin-top:1mm">${esc(v.ZUSATZ)}</div></div>` : ''}
      <div class="txt muted">Das Fahrzeug bleibt bis zur vollständigen Bezahlung Eigentum des Verkäufers. Der Käufer bestätigt den Empfang einer Ausfertigung dieses Vertrags.</div>
      <div class="sign"><div>Ort, Datum, Unterschrift Verkäufer</div><div>Ort, Datum, Unterschrift Käufer</div></div>`;
    await Print.preview(Print.wrap(Print.sheet(html, f), f), `Kaufvertrag ${v.NUMMER}`);
  },

  async preisschild(fz) {
    const f = await Print.ensureFirma();
    const html = `<div class="sheet" style="padding:15mm"><div style="text-align:center"><div style="font-size:28pt;font-weight:bold">${esc(fz.MARKE || '')} ${esc(fz.MODELL || '')}</div>
      <div style="font-size:48pt;font-weight:bold;color:#1e3f6e;margin:8mm 0">${fmt.money(fz.VKPBRUTTO || fz.VKP)}</div><div class="muted">${Number(fz.MWSTAUSWEISBAR) ? 'inkl. 19 % MwSt.' : 'Differenzbesteuert nach § 25a UStG'}</div></div>
      <div class="box" style="font-size:12pt;margin-top:8mm"><div class="kv" style="grid-template-columns:60mm 1fr">
      <span>Erstzulassung</span><b>${fmt.date(fz.EZ) || 'Neufahrzeug'}</b><span>Kilometerstand</span><b>${fz.KM ? Number(fz.KM).toLocaleString(I18N.locale(Print.docLang())) + ' km' : ''}</b><span>Leistung</span><b>${fz.KW ? `${fz.KW} kW (${fz.PS || Math.round(fz.KW * 1.36)} PS)` : ''}</b>
      <span>Kraftstoff</span><b>${esc(fz.KRAFTSTOFF || '')}</b><span>Getriebe</span><b>${esc(fz.GETRIEBE || '')}</b><span>Farbe</span><b>${esc(fz.FARBE || '')}</b><span>HU</span><b>${fmt.month(fz.HU)}</b><span>Vorbesitzer</span><b>${esc(fz.VORBESITZER ?? '')}</b></div></div>
      ${fz.BESCHREIBUNG ? `<div class="box" style="font-size:11pt;white-space:pre-wrap"><b>Ausstattung</b><br>${esc(fz.BESCHREIBUNG)}</div>` : ''}
      <div class="box" style="font-size:10pt"><b>Angaben nach Pkw-EnVKV</b><br>Kraftstoffverbrauch (l/100 km): innerorts ${esc(fz.VINNERORTS || '–')}, außerorts ${esc(fz.VAUSSERORT || '–')}, kombiniert ${esc(fz.VKOMBINIERT || '–')}${fz.STROM ? ` · Stromverbrauch ${esc(fz.STROM)} kWh/100 km` : ''}<br>CO₂-Emissionen kombiniert: ${esc(fz.CO2EMMISSION || '–')} g/km · CO₂-Klasse: <b>${esc(fz.EFFIZKLASSE || '–')}</b></div>
      <div style="text-align:center;margin-top:10mm">${esc(f.FIRMENNAME || '')} · ${esc(f.TELEFON || '')}</div></div>`;
    await Print.preview(Print.wrap(html, f, { extraCss: '@page { margin: 10mm; }' }), 'Preisschild');
  },

  async stundenzettel(m) {
    const cols = [{ f: 'datum', l: 'Datum', t: 'date' }, { f: 'wochentag', l: 'Tag' }, { f: 'kommen', l: 'Kommen' }, { f: 'gehen', l: 'Gehen' }, { f: 'pausemin', l: 'Pause (Min.)' }, { f: 'soll', l: 'Soll', t: 'num' }, { f: 'ist', l: 'Ist', t: 'num' }, { f: 'saldo', l: 'Saldo', t: 'num' }, { f: 'info', l: 'Bemerkung' }];
    const rows = m.tage.map(t => ({ ...t, pausemin: t.pause || '', info: t.feiertag || t.abwesenheit || '' }));
    await Print.liste(`Stundenzettel ${m.mitarbeiter.name} – ${m.monat.slice(5, 7)}/${m.monat.slice(0, 4)}`, `Personal-Nr. ${m.mitarbeiter.personalnr || '–'} · Vortrag ${fmt.num(m.summe.vortrag)} h · Zeitkonto ${fmt.num(m.summe.konto)} h · Urlaub genommen ${m.summe.urlaub} Tage, Rest ${fmt.num(m.summe.urlaubRest)} Tage${m.abgeschlossen ? ' · abgeschlossen' : ' · NICHT abgeschlossen'}`, cols, rows, { soll: m.summe.soll, ist: m.summe.ist, saldo: m.summe.saldo });
  },

  async inventurliste(inv, mitIst) {
    const cols = [{ f: 'LAGERORT', l: 'Lagerort' }, { f: 'ARTNUMMER', l: 'Artikel-Nr.' }, { f: 'BEZEICHNUNG1', l: 'Bezeichnung' }, { f: 'SOLL', l: 'Soll', t: 'num' }, { f: 'IST', l: 'Ist' }, { f: 'ISTEK', l: 'EK', t: 'money' }];
    await Print.liste(`Inventurliste: ${inv.liste.NAME}`, `Stichtag ${fmt.date(inv.liste.DATUM)}${mitIst ? ` · Bestandswert ${fmt.money(inv.wert)}` : ' · Zählliste'}`, cols, inv.pos.map(p => ({ ...p, IST: mitIst && p.ISTLAGER != null ? fmt.num(p.ISTLAGER) : '________' })));
  },

  async aufwand(fz, list, kalk) {
    await Print.liste(`Kosten-/Aufwandsrechnung ${fz.MARKE || ''} ${fz.MODELL || ''}`, `FIN ${fz.FZIDENTNR || '–'} · EK ${fmt.money(fz.EKP)} · Aufwand ${fmt.money(kalk.aufwand)} · Einsatz ${fmt.money(kalk.einsatz)} · VK ${fmt.money(kalk.vkbrutto)} · Gewinn ${fmt.money(kalk.gewinn)}`,
      [{ f: 'DATUM', l: 'Datum', t: 'date' }, { f: 'BESCHREIBUNG', l: 'Beschreibung' }, { f: 'TYPTEXT', l: 'Art' }, { f: 'BETRAGNETTO', l: 'Betrag netto', t: 'money' }], list.map(a => ({ ...a, TYPTEXT: a.TYP === 'G' ? 'Gutschrift' : 'Kosten' })), { BETRAGNETTO: kalk.aufwand });
  },
});
