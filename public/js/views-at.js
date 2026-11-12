'use strict';
/* global title, h, api, qs, fmt, toast, showError, confirmDlg, dialog, alertDlg, downloadUrl, miniGrid, Win, Views, today, LK, T, dateRange, addMonths, addDays, Print */
// Austrian tax system: settings tab (USt, company details, cash register RKSV) and the view
// "Steuer (Österreich)" (UVA with FinanzOnline XML, RKSV receipts, DEP export)

const AtUI = {
  activo() { return !!(LK.data && LK.data.land === 'AT'); },
  settingsTab(p, { s, changes, si, sb, grp, fld, ob }) {
    const sel = (k, label, opts, def) => { const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] ?? def) === v }, l))); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return fld(label, x); };
    const pw = (() => { const x = h('input', { type: 'password', value: s.sw['at.rksv.atrust.pw'] ?? '' }); x.addEventListener('change', () => { changes.sw['at.rksv.atrust.pw'] = x.value; }); return fld('A-Trust: Passwort', x); })();
    const rksvBox = h('div', { class: 'fld hint' });
    const zeigeStatus = async () => {
      try {
        const st = await api('/api/at/rksv/status');
        rksvBox.textContent = '';
        rksvBox.append(st.aktiv
          ? h('div', null, h('b', null, T('Registrierkasse aktiv')), ` · ${T('Kassen-ID')} ${st.kassenid} · ${st.belege} ${T('Belege')}${st.testbetrieb ? ' · ' + T('Testbetrieb (lokaler Schlüssel, nicht RKSV-konform)') : ''}`,
            h('br'), `${T('AES-Schlüssel für FinanzOnline')}: `, h('code', { style: { userSelect: 'all' } }, st.aeskey),
            st.ausfall ? h('div', { class: 'note err' }, T('Die Signaturerstellungseinheit ist ausgefallen. Belege werden mit „Sicherheitseinrichtung ausgefallen“ erstellt. Ausfälle über 48 Stunden sind dem Finanzamt über FinanzOnline zu melden.')) : null,
            st.fehler ? h('div', { class: 'muted' }, T('Letzter Fehler') + ': ' + st.fehler) : null)
          : T('Noch nicht aktiviert.'));
      } catch (e) { rksvBox.textContent = e.message; }
    };
    const aktivieren = async () => {
      if (!(await confirmDlg('Registrierkasse jetzt in Betrieb nehmen? KuentaPOS erzeugt den AES-Schlüssel und den Startbeleg. Kassen-ID und Schlüssel sind danach in FinanzOnline zu registrieren, der Startbeleg ist mit der BMF-Belegcheck-App zu prüfen.', { ok: 'Aktivieren' }))) return;
      try {
        await api('/api/einstellungen', { method: 'PUT', body: changes });
        const r = await api('/api/at/rksv/aktivieren', { method: 'POST', body: {} });
        await dialog('Registrierkasse aktiviert', h('div', null,
          h('p', null, T('In FinanzOnline unter Eingaben → Registrierkassen registrieren:')),
          h('div', { class: 'kv' }, h('span', null, T('Kassenidentifikationsnummer')), h('code', null, r.kassenid), h('span', null, T('AES-Schlüssel')), h('code', { style: { wordBreak: 'break-all' } }, r.aeskey),
            h('span', null, T('Signatur')), h('span', null, r.testbetrieb ? T('Testbetrieb (lokaler Schlüssel)') : 'A-Trust a.sign RK')),
          r.start ? h('div', { style: { textAlign: 'center', marginTop: '10px' } }, h('div', null, T('Startbeleg – mit der BMF-Belegcheck-App prüfen:')), h('div', { html: Print.qrSvg(r.start.qr, 45) })) : null),
        [{ label: 'OK', value: true }], { width: 620 });
        zeigeStatus();
      } catch (e) { showError(e); }
    };
    zeigeStatus();
    p.append(h('div', { class: 'groups' },
      grp('Umsatzsteuer',
        si('at.ust.normal', 'Normalsteuersatz %', '20', true), si('at.ust.ermaessigt', 'Ermäßigter Satz %', '10', true), si('at.ust.ermaessigt2', 'Zweiter ermäßigter Satz %', '13', true),
        ob('Kleinunternehmer', 'Kleinunternehmer (§ 6 Abs. 1 Z 27 UStG) – Rechnungen ohne USt'),
        sb('at.ist', 'Ist-Besteuerung (USt nach vereinnahmten Entgelten)', '0'),
        h('div', { class: 'fld hint' }, 'Die UID-Nummer (ATU…) gehört unter Firmendaten → USt-IdNr., die Steuernummer (9 Ziffern: Finanzamt + Steuernummer, z. B. 46 123/4567) unter Steuernummer. Kunden-UID im Kunden unter Steuer & Buchhaltung; ab 10.000 € brutto ist sie auf der Rechnung Pflicht.')),
      grp('Angaben der Firma (§ 14 UGB)',
        si('at.rechtsform', 'Rechtsform (z. B. GmbH, e.U.)', '', true), si('at.sitz', 'Sitz', '', true),
        si('at.fn', 'Firmenbuchnummer (z. B. FN 123456a)', '', true), si('at.gericht', 'Firmenbuchgericht (z. B. Landesgericht Linz)', '', true)),
      grp('Registrierkasse (RKSV)',
        si('at.rksv.kassenid', 'Kassenidentifikationsnummer', '', true),
        sel('at.rksv.signatur', 'Signaturerstellungseinheit', [['test', 'Testbetrieb (lokaler Schlüssel, nicht RKSV-konform)'], ['atrust', 'A-Trust a.sign RK HSM (online)']], 'test'),
        sel('at.rksv.umgebung', 'A-Trust: Umgebung', [['test', 'Test (hs-abnahme)'], ['produktion', 'Produktion']], 'test'),
        si('at.rksv.atrust.user', 'A-Trust: Benutzername', '', true), pw,
        h('div', { class: 'fld hint' }, 'Jeder Barumsatz (auch Karte) erhält einen signierten Beleg mit QR-Code, verketteten Signaturen und verschlüsseltem Umsatzzähler. Startbeleg bei Inbetriebnahme, Monatsbeleg beim Monatswechsel, Jahresbeleg im Dezember (mit der BMF-Belegcheck-App prüfen und 7 Jahre aufbewahren). Die Zertifikatsdaten liefert A-Trust.'),
        rksvBox,
        h('div', { class: 'fld inline' }, h('button', { class: 'btn', onclick: aktivieren }, '🔐 ' + T('Registrierkasse aktivieren'))))));
  },
};

Views.atSteuer = async (main) => {
  let von = addMonths(today().slice(0, 7) + '-01', -1), bis = addDays(today().slice(0, 7) + '-01', -1);
  const out = h('div');
  const K = { '000': 'Gesamtbetrag der Bemessungsgrundlagen (Lieferungen, sonstige Leistungen)', '011': 'davon steuerfrei: Ausfuhrlieferungen (§ 6 Abs. 1 Z 1)', '017': 'davon steuerfrei: innergemeinschaftliche Lieferungen', '016': 'davon steuerfrei: Kleinunternehmer (§ 6 Abs. 1 Z 27)', '020': 'davon übrige steuerfreie Umsätze ohne Vorsteuerabzug', '022': 'zu versteuern mit 20 %', '029': 'zu versteuern mit 10 %', '006': 'zu versteuern mit 13 %', '060': 'Gesamtbetrag der Vorsteuern' };
  const berechnen = async () => {
    out.textContent = '';
    try {
      const r = await api('/api/at/uva?' + qs({ von, bis }));
      const rows = Object.entries(K).map(([kz, text]) => ({ kz, text: T(text), betrag: r.kz[kz], steuer: r.steuer[kz] ?? null }));
      out.append(miniGrid([{ f: 'kz', l: 'KZ', w: 60 }, { f: 'text', l: 'Bezeichnung', w: 470 }, { f: 'betrag', l: 'Bemessungsgrundlage', w: 150, t: 'money' }, { f: 'steuer', l: 'Steuer', w: 120, t: 'money' }], rows).el,
        h('div', { class: 'note ' + (r.gutschrift ? 'ok' : 'info'), style: { marginTop: '8px' } }, `${T(r.gutschrift ? 'Überschuss (Gutschrift)' : 'Vorauszahlung (Zahllast)')}: ${fmt.money(Math.abs(r.zahllast))} · ${T('Umsatzsteuer')} ${fmt.money(r.ust)} − ${T('Vorsteuer')} ${fmt.money(r.kz['060'])} · ${r.rechnungen} ${T('Rechnungen')}, ${r.eingang} ${T('Eingangsrechnungen')}${r.ist ? ' · ' + T('Ist-Besteuerung') : ''}`),
        ...r.hinweise.map(x => h('div', { class: 'hint' }, x)),
        r.durchlaufend ? h('div', { class: 'hint' }, `${T('Durchlaufende Posten (nicht in der UVA)')}: ${fmt.money(r.durchlaufend)}`) : '');
    } catch (e) { showError(e); }
  };
  const journal = async () => {
    try {
      const rows = await api('/api/at/rksv/journal?limit=3000');
      const ART = { START: 'Startbeleg', BELEG: 'Beleg', STORNO: 'Storno', TRAINING: 'Training', NULL: 'Nullbeleg', MONAT: 'Monatsbeleg', JAHR: 'Jahresbeleg', SAMMEL: 'Sammelbeleg', SCHLUSS: 'Schlussbeleg' };
      Win.open({ title: 'RKSV-Belege', width: 1100, height: 600, content: miniGrid([{ f: 'NR', l: 'Nr.', w: 60, t: 'int' }, { f: 'ART', l: 'Art', w: 120, render: x => T(ART[x.ART] || x.ART) }, { f: 'ZEIT', l: 'Zeit', w: 160 }, { f: 'BONID', l: 'Bon-ID', w: 70 },
        { f: 'BETRAEGE', l: 'Beträge 20/10/13/0/19 % (Cent)', w: 220 }, { f: 'AUSFALL', l: 'Ausfall', w: 70, render: x => (x.AUSFALL ? '⚠' : '') }, { f: 'CODE', l: 'Code', w: 380 }], rows).el });
    } catch (e) { showError(e); }
  };
  const pruefen = async () => {
    try {
      const r = await api('/api/at/rksv/pruefen');
      await dialog('RKSV-Prüfung', h('div', null, h('div', { class: 'note ' + (r.ok ? 'ok' : 'err') }, r.ok ? T(`✔ Alle ${r.belege} Belege sind lückenlos verkettet, Umsatzzähler und Signaturen stimmen.`) : T(`❌ ${r.fehler.length} Fehler gefunden.`)),
        r.fehler.length ? h('ul', null, r.fehler.slice(0, 50).map(e => h('li', null, e))) : null), [{ label: 'OK', value: true }], { width: 620 });
    } catch (e) { showError(e); }
  };
  const nullbeleg = async (art, text) => {
    if (!(await confirmDlg(text, { ok: 'Erstellen' }))) return;
    try {
      const r = await api('/api/at/rksv/nullbeleg', { method: 'POST', body: { art } });
      await dialog('Beleg erstellt', h('div', { style: { textAlign: 'center' } }, h('div', null, `${T('Beleg Nr.')} ${r.nr} · ${fmt.datetime(r.zeit)}${r.ausfall ? ' · ' + T('Sicherheitseinrichtung ausgefallen') : ''}`), h('div', { html: Print.qrSvg(r.qr, 45) }),
        h('div', { class: 'hint' }, art === 'JAHR' || art === 'START' ? T('Mit der BMF-Belegcheck-App prüfen und ausgedruckt 7 Jahre aufbewahren.') : '')), [{ label: 'OK', value: true }], { width: 460 });
    } catch (e) { showError(e); }
  };
  main.append(title('Steuer (Österreich)', 'Umsatzsteuervoranmeldung und Registrierkasse (RKSV)'),
    h('div', { class: 'view-scroll' },
      h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; }),
        h('button', { class: 'btn primary', onclick: berechnen }, '🧮 ' + T('UVA berechnen')),
        h('button', { class: 'btn', onclick: () => downloadUrl('/api/at/uva/xml?' + qs({ von, bis }), 'UVA.xml') }, '⬇ ' + T('XML für FinanzOnline'))),
      h('div', { class: 'hint', style: { maxWidth: '900px', margin: '4px 0 10px' } }, 'Die XML-Datei laden Sie in FinanzOnline unter Eingaben → Übermittlung → Erklärungen hoch (U30). Vorsteuer aus den Eingangsrechnungen. Leistungen an EU-Unternehmer und innergemeinschaftliche Lieferungen gehören zusätzlich in die Zusammenfassende Meldung (ZM).'),
      out,
      h('fieldset', { class: 'grp', style: { marginTop: '12px' } }, h('legend', null, 'Registrierkasse (RKSV)'),
        h('div', { class: 'searchbar' },
          h('button', { class: 'btn', onclick: journal }, '📋 ' + T('Belege')), h('button', { class: 'btn', onclick: pruefen }, '🔍 ' + T('Prüfen')),
          h('button', { class: 'btn', onclick: () => downloadUrl('/api/at/rksv/dep', 'DEP.json') }, '⬇ ' + T('DEP-Export')),
          h('button', { class: 'btn', onclick: () => nullbeleg('JAHR', 'Jahresbeleg erstellen? (Der Monatsbeleg für Dezember; KuentaPOS erstellt Monats- und Jahresbelege beim Monatswechsel auch selbst.)') }, T('Jahresbeleg')),
          h('button', { class: 'btn', onclick: () => nullbeleg('NULL', 'Nullbeleg erstellen (z. B. zur Kontrolle)?') }, T('Nullbeleg')),
          h('button', { class: 'btn', onclick: () => nullbeleg('SCHLUSS', 'Schlussbeleg erstellen? Danach ist die Kasse in FinanzOnline außer Betrieb zu nehmen.') }, T('Schlussbeleg'))),
        h('div', { class: 'hint' }, 'Das Datenerfassungsprotokoll (DEP) enthält alle signierten Belege im Exportformat der RKSV und ist der Finanzverwaltung auf Verlangen zu übergeben.'))));
  berechnen();
};
