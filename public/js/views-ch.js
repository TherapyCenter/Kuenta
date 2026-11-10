'use strict';
/* global title, h, api, qs, fmt, showError, downloadUrl, miniGrid, Views, today, LK, T, dateRange, addMonths, addDays */
// Swiss tax system: settings tab (MWST, method, QR-bill) and the view "MWST-Abrechnung"

const ChUI = {
  activo() { return !!(LK.data && LK.data.land === 'CH'); },
  settingsTab(p, { s, changes, si, sb, grp, fld, ob }) {
    const sel = (k, label, opts, def) => { const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] ?? def) === v }, l))); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return fld(label, x); };
    p.append(h('div', { class: 'groups' },
      grp('Mehrwertsteuer',
        si('ch.mwst.normal', 'Normalsatz %', '8.1', true), si('ch.mwst.reduziert', 'Reduzierter Satz %', '2.6', true), si('ch.mwst.beherbergung', 'Sondersatz Beherbergung %', '3.8', true),
        ob('Kleinunternehmer', 'Nicht MWST-pflichtig (Umsatz unter CHF 100 000) – Rechnungen ohne MWST'),
        sel('ch.methode', 'Abrechnungsmethode', [['effektiv', 'Effektive Methode (mit Vorsteuerabzug)'], ['saldo', 'Saldosteuersatzmethode']], 'effektiv'),
        si('ch.saldo1', 'Saldosteuersatz % (bei Saldosteuersatzmethode)', '', true),
        sb('ch.vereinnahmt', 'Abrechnung nach vereinnahmten Entgelten', '0'),
        h('div', { class: 'fld hint' }, 'Die UID / MWST-Nummer (CHE-123.456.789) gehört unter Firmendaten → USt-IdNr., der Handelsregistereintrag unter Handelsregister. Beträge in Schweizer Franken; Barzahlungen an der Kasse werden auf 5 Rappen gerundet.')),
      grp('QR-Rechnung',
        sb('ch.qr.aktiv', 'Zahlteil mit QR-Code auf jeder Rechnung drucken', '1'),
        si('ch.qr.iban', 'QR-IBAN (leer = IBAN der Firmendaten)', '', true),
        sel('ch.qr.referenz', 'Referenz bei normaler IBAN', [['SCOR', 'Creditor Reference (RF…) aus der Rechnungsnummer'], ['NON', 'ohne Referenz (Rechnungsnummer als Mitteilung)']], 'SCOR'),
        si('ch.qr.kundenid', 'Bank-Kunden-ID für die QR-Referenz (falls von der Bank vorgegeben)', '', true),
        h('div', { class: 'fld hint' }, 'Mit einer QR-IBAN (IID 30000–31999) erhält jede Rechnung eine 27-stellige QR-Referenz, die Ihre Bank beim Zahlungseingang meldet. Der Zahlteil steht unten auf der Rechnung (bei langen Rechnungen auf der letzten Seite) und wird mit der offenen Summe gedruckt.'))));
  },
};

Views.chMwst = async (main) => {
  let von = addMonths(today().slice(0, 7) + '-01', -3), bis = addDays(today().slice(0, 7) + '-01', -1);
  const out = h('div');
  const berechnen = async () => {
    out.textContent = '';
    try {
      const r = await api('/api/ch/mwst?' + qs({ von, bis }));
      const z = r.ziffern;
      const rows = [
        ['200', 'Total der vereinbarten bzw. vereinnahmten Entgelte', z['200']], ['220', 'Von der Steuer befreite Leistungen (Exporte, Art. 23)', z['220']],
        ['221', 'Leistungen im Ausland', z['221']], ['230', 'Von der Steuer ausgenommene Inlandleistungen (Art. 21)', z['230']],
        ['280', 'Diverses (Ankaufspreis margenbesteuerter Gegenstände)', z['280']], ['289', 'Total Abzüge', z['289']], ['299', 'Steuerbarer Gesamtumsatz', z['299']],
        ...r.steuer.map(s => [s.ziffer, s.text, s.umsatz, s.steuer]),
        ['399', 'Total geschuldete Steuer', null, z['399']], ['400', 'Vorsteuer auf Material- und Dienstleistungsaufwand', null, z['400']],
        ['405', 'Vorsteuer auf Investitionen und übrigem Betriebsaufwand', null, z['405']], ['479', 'Total Vorsteuer', null, z['479']],
        ['500', 'Zu bezahlender Betrag', null, z['500']], ['510', 'Guthaben der steuerpflichtigen Person', null, z['510']],
      ].map(([ziffer, text, betrag, steuer]) => ({ ziffer, text: T(text), betrag, steuer }));
      out.append(miniGrid([{ f: 'ziffer', l: 'Ziffer', w: 60 }, { f: 'text', l: 'Bezeichnung', w: 470 }, { f: 'betrag', l: 'Betrag', w: 140, t: 'money' }, { f: 'steuer', l: 'Steuer', w: 130, t: 'money' }], rows).el,
        h('div', { class: 'hint' }, `${r.methode === 'saldo' ? T('Saldosteuersatzmethode') : T('Effektive Methode')} · ${r.vereinnahmt ? T('vereinnahmte Entgelte') : T('vereinbarte Entgelte')} · ${r.rechnungen} ${T('Rechnungen')}, ${r.eingang} ${T('Eingangsrechnungen')}${r.durchlaufend ? ` · ${T('Durchlaufende Posten (nicht deklariert)')}: ${fmt.money(r.durchlaufend)}` : ''}`));
    } catch (e) { showError(e); }
  };
  main.append(title('MWST-Abrechnung (Schweiz)', 'Ziffern des ESTV-Formulars für die Eingabe im ePortal'),
    h('div', { class: 'view-scroll' },
      h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; }),
        h('button', { class: 'btn primary', onclick: berechnen }, '🧮 ' + T('Berechnen')),
        h('button', { class: 'btn', onclick: () => downloadUrl('/api/ch/mwst/csv?' + qs({ von, bis }), 'MWST.csv') }, '⬇ CSV')),
      h('div', { class: 'hint', style: { maxWidth: '900px', margin: '4px 0 10px' } }, 'Die Beträge tragen Sie im ePortal der ESTV in die gleichnamigen Ziffern ein. Vorsteuer aus den Eingangsrechnungen (Ziffer 400); Vorsteuer auf Investitionen trennen Sie bei Bedarf selbst ab (Ziffer 405).'),
      out));
  berechnen();
};
