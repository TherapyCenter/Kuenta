'use strict';
/* global title, h, api, qs, fmt, showError, downloadUrl, miniGrid, Views, today, LK, T, dateRange, addMonths, addDays */
// Dutch tax system: settings tab (btw, KOR, KvK, Peppol) and the view "Btw-aangifte" (rubrieken, CSV)

const NlUI = {
  activo() { return !!(LK.data && LK.data.land === 'NL'); },
  settingsTab(p, { si, grp, ob }) {
    p.append(h('div', { class: 'groups' },
      grp('Btw',
        si('nl.btw.hoog', 'Hoog tarief %', '21', true), si('nl.btw.laag', 'Laag tarief %', '9', true),
        ob('Kleinunternehmer', 'Kleineondernemersregeling (KOR) – Rechnungen ohne btw'),
        h('div', { class: 'fld hint' }, 'Die btw-id (NL123456789B01) gehört unter Firmendaten → USt-IdNr. Beim Kunden: btw-id unter USt-IdNr., KvK-Nummer bzw. OIN (Behörden) unter Steuer & Buchhaltung. Belegsprache Nederlands unter Vorgabewerte → Sprache.')),
      grp('Bedrijfsgegevens',
        si('nl.kvk', 'KvK-nummer (8 Ziffern)', '', true), si('nl.vestiging', 'Vestigingsnummer (optional)', '', true),
        h('div', { class: 'fld hint' }, 'KvK-Nummer und btw-id stehen in der Fußzeile jedes Belegs.')),
      grp('E-factuur (Peppol)',
        h('div', { class: 'fld hint' }, 'Rechnungen an die öffentliche Hand (Rijksoverheid, Gemeinden) gehen als E-Rechnung im Format Peppol BIS Billing 3.0. KuentaPOS erzeugt die XML-Datei (Rechnung → E-factuur); senden Sie sie über Ihren Peppol-Dienstleister oder laden Sie sie im Leveranciersportaal hoch. Im Kunden die OIN (20 Ziffern) bzw. KvK-Nummer und die Referenz (Leitweg-ID-Feld oder Bestell-Nr. der Rechnung) eintragen.'))));
  },
};

Views.nlAangifte = async (main) => {
  const q0 = Math.floor((Number(today().slice(5, 7)) - 1) / 3) * 3; // previous quarter
  let von = addMonths(today().slice(0, 4) + '-' + String(q0 + 1).padStart(2, '0') + '-01', -3), bis = addDays(addMonths(von, 3), -1);
  const out = h('div');
  const berekenen = async () => {
    out.textContent = '';
    try {
      const r = await api('/api/nl/aangifte?' + qs({ von, bis }));
      const R = r.rubrieken; const e = v => (v == null ? null : v);
      const rows = [
        ['1a', 'Leveringen/diensten belast met hoog tarief', R['1a'].omzet, R['1a'].btw], ['1b', 'Leveringen/diensten belast met laag tarief', R['1b'].omzet, R['1b'].btw],
        ['1c', 'Leveringen/diensten belast met overige tarieven, behalve 0%', R['1c'].omzet, R['1c'].btw], ['1e', 'Leveringen/diensten belast met 0% of niet bij u belast', R['1e'].omzet, null],
        ['3a', 'Leveringen naar landen buiten de EU (uitvoer)', R['3a'].omzet, null], ['3b', 'Leveringen naar of diensten in landen binnen de EU', R['3b'].omzet, null],
        ['5a', 'Verschuldigde omzetbelasting', null, r['5a']], ['5b', 'Voorbelasting', null, r['5b']], ['5c', 'Subtotaal', null, r['5c']],
        ['5g', r.terug ? 'Totaal terug te vragen' : 'Totaal te betalen', null, Math.abs(r['5g'])],
      ].map(([rubriek, tekst, omzet, btw]) => ({ rubriek, tekst, omzet: e(omzet), btw: e(btw) }));
      out.append(miniGrid([{ f: 'rubriek', l: 'Rubriek', w: 70 }, { f: 'tekst', l: 'Omschrijving', w: 470 }, { f: 'omzet', l: 'Omzet (€)', w: 130, t: 'int' }, { f: 'btw', l: 'Omzetbelasting (€)', w: 150, t: 'int' }], rows).el,
        h('div', { class: 'note ' + (r.terug ? 'ok' : 'info'), style: { marginTop: '8px' } }, `${T(r.terug ? 'Terug te vragen' : 'Te betalen')}: € ${Math.abs(r['5g'])} · ${r.rechnungen} ${T('Rechnungen')}, ${r.inkoop} ${T('Eingangsrechnungen')}${r.kor ? ' · KOR' : ''}`),
        r.icp ? h('div', { class: 'hint' }, T('Rubriek 3b: die Leistungen an EU-Unternehmer gehören zusätzlich in die Opgaaf intracommunautaire prestaties (ICP).')) : '',
        (r.vrijgesteld || r.doorlopend) ? h('div', { class: 'hint' }, `${T('Nicht in der Aangifte')}: ${T('vrijgesteld')} ${fmt.money(r.vrijgesteld)} · ${T('doorlopende posten')} ${fmt.money(r.doorlopend)}`) : '');
    } catch (err) { showError(err); }
  };
  main.append(title('Btw-aangifte (Nederland)', 'Rubrieken der Aangifte omzetbelasting'),
    h('div', { class: 'view-scroll' },
      h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; }),
        h('button', { class: 'btn primary', onclick: berekenen }, '🧮 ' + T('Berechnen')),
        h('button', { class: 'btn', onclick: () => downloadUrl('/api/nl/aangifte/csv?' + qs({ von, bis }), 'Btw-aangifte.csv') }, '⬇ CSV')),
      h('div', { class: 'hint', style: { maxWidth: '900px', margin: '4px 0 10px' } }, 'Die Beträge tragen Sie in Mijn Belastingdienst Zakelijk ein. Umsätze in ganzen Euro abgerundet, Umsatzsteuer abgerundet und Vorsteuer aufgerundet (zu Ihren Gunsten). Vorsteuer aus den Eingangsrechnungen.'),
      out));
  berekenen();
};
