'use strict';
/* global title, h, api, qs, fmt, showError, downloadUrl, miniGrid, Views, today, LK, T, dateRange, addMonths, addDays */
// Luxembourg tax system: settings tab (TVA, franchise, RCS, eCDF) and the view "Déclaration TVA" (eCDF fields, XML)

const LuUI = {
  activo() { return !!(LK.data && LK.data.land === 'LU'); },
  settingsTab(p, { s, changes, si, grp, fld, ob }) {
    const sel = (k, label, opts, def) => { const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] ?? def) === v }, l))); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return fld(label, x); };
    p.append(h('div', { class: 'groups' },
      grp('TVA',
        si('lu.tva.normal', 'Taux normal %', '17', true), si('lu.tva.intermediaire', 'Taux intermédiaire %', '14', true), si('lu.tva.reduit', 'Taux réduit % (8 oder 3)', '8', true),
        ob('Kleinunternehmer', 'Franchise des petites entreprises (art. 57) – Rechnungen ohne TVA'),
        sel('lu.periode', 'Periodische Erklärung', [['trimestre', 'vierteljährlich (TVA_DECT)'], ['mois', 'monatlich (TVA_DECM)']], 'trimestre'),
        h('div', { class: 'fld hint' }, 'Die TVA-Nummer (LU15027442) gehört unter Firmendaten → USt-IdNr. Belegsprache Français oder Deutsch unter Vorgabewerte → Sprache; die Rechtstexte folgen ihr.')),
      grp('Entreprise',
        si('lu.rcs', 'RCS (z. B. B123456)', '', true), si('lu.autorisation', 'Autorisation d\'établissement (Nummer)', '', true),
        h('div', { class: 'fld hint' }, 'TVA-Nummer, RCS und Niederlassungsgenehmigung stehen in der Fußzeile jedes Belegs.')),
      grp('eCDF',
        si('lu.matricule', 'Matricule (11 bis 13 Ziffern)', '', true), si('lu.ecdf.prefix', 'eCDF-Präfix (6 Zeichen)', '', true), si('lu.ecdf.interface', 'Interface', 'KUENTA', true),
        h('div', { class: 'fld hint' }, 'Die MwSt-Erklärung geht als XML-Datei über die Plattform eCDF. Das Präfix erhalten Sie bei der Anmeldung bei eCDF.')),
      grp('Facturation électronique (Peppol)',
        h('div', { class: 'fld hint' }, 'Rechnungen an öffentliche Auftraggeber gehen als E-Rechnung über Peppol (BIS Billing 3.0). Kuenta erzeugt die XML-Datei (Rechnung → E-Rechnung (Peppol)); senden Sie sie über Ihren Peppol-Dienstleister.'))));
  },
};

Views.luTva = async (main) => {
  const q0 = Math.floor((Number(today().slice(5, 7)) - 1) / 3) * 3;
  let von = addMonths(today().slice(0, 4) + '-' + String(q0 + 1).padStart(2, '0') + '-01', -3), bis = addDays(addMonths(von, 3), -1);
  const out = h('div');
  const TXT = {
    '012': 'Chiffre d\'affaires global', '014': 'Exportations', '015': 'Autres exonérations', '021': 'Exonérations et montants déductibles', '022': 'Chiffre d\'affaires imposable',
    '037': 'Base imposable', '046': 'Taxe sur le chiffre d\'affaires', '076': 'Total de la taxe due', '093': 'Taxe en amont totale', '102': 'Taxe en amont déductible',
    '103': 'Total de la taxe due', '104': 'Taxe en amont déductible', '105': 'Excédent (à payer + / à rembourser −)', '423': 'Prestations à des assujettis UE (autoliquidation)',
    '454': 'Ventes / recettes', '457': 'Livraisons intracommunautaires', '458': 'Taxe en amont facturée', '472': 'Autres ventes / recettes',
    '701': 'Base 17 %', '702': 'Taxe 17 %', '703': 'Base 14 %', '704': 'Taxe 14 %', '705': 'Base 8 %', '706': 'Taxe 8 %', '031': 'Base 3 %', '040': 'Taxe 3 %',
  };
  const berechnen = async () => {
    out.textContent = '';
    try {
      const r = await api('/api/lu/tva?' + qs({ von, bis }));
      const rows = Object.entries(r.felder).sort(([a], [b]) => Number(a) - Number(b)).map(([feld, betrag]) => ({ feld, text: TXT[feld] || '', betrag }));
      out.append(miniGrid([{ f: 'feld', l: 'Feld', w: 80 }, { f: 'text', l: 'Bezeichnung', w: 460 }, { f: 'betrag', l: 'Betrag', w: 150, t: 'money' }], rows).el,
        h('div', { class: 'note ' + (r.saldo < 0 ? 'ok' : 'info'), style: { marginTop: '8px' } }, r.saldo < 0 ? `${T('Guthaben (Feld 105)')}: ${fmt.money(-r.saldo)}` : `${T('Zu zahlen (Feld 105)')}: ${fmt.money(r.saldo)}`),
        h('div', { class: 'hint' }, `${r.periode === 'mois' ? T('monatlich') : T('vierteljährlich')} · ${r.rechnungen} ${T('Rechnungen')}, ${r.eingang} ${T('Eingangsrechnungen')}${r.durchlaufend ? ` · ${T('Auslagen (nicht in der Erklärung)')}: ${fmt.money(r.durchlaufend)}` : ''}`));
    } catch (e) { showError(e); }
  };
  main.append(title('Déclaration TVA (Lëtzebuerg)', 'Felder der eCDF-Erklärung, XML für die Plattform eCDF'),
    h('div', { class: 'view-scroll' },
      h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; }),
        h('button', { class: 'btn primary', onclick: berechnen }, '🧮 ' + T('Berechnen')),
        h('button', { class: 'btn', onclick: () => downloadUrl('/api/lu/tva/xml?' + qs({ von, bis }), 'eCDF.xml') }, '⬇ ' + T('XML für eCDF'))),
      h('div', { class: 'hint', style: { maxWidth: '900px', margin: '4px 0 10px' } }, 'Die XML-Datei laden Sie auf der Plattform eCDF hoch (Dateiname = Dateireferenz). Vorsteuer aus den Eingangsrechnungen (Feld 458). Differenzbesteuerung, Sonderfälle und die jährliche Erklärung mit dem Buchhalter abstimmen; die Zusammenfassende Meldung erstellt Kuenta nicht.'),
      out));
  berechnen();
};
