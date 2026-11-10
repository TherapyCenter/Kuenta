'use strict';
/* global title, h, api, qs, fmt, showError, downloadUrl, miniGrid, Views, today, LK, T, dateRange, addMonths, addDays */
// Belgian tax system: settings tab (btw / TVA, franchise, RPR, period) and the view "Btw-aangifte / Déclaration TVA"
// (grids, XML for Intervat)

const BeUI = {
  activo() { return !!(LK.data && LK.data.land === 'BE'); },
  settingsTab(p, { s, changes, si, grp, fld, ob }) {
    const sel = (k, label, opts, def) => { const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] ?? def) === v }, l))); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return fld(label, x); };
    p.append(h('div', { class: 'groups' },
      grp('Btw / TVA',
        si('be.btw.normaal', 'Normaal tarief / taux normal %', '21', true), si('be.btw.tussen', 'Tussentarief / taux intermédiaire %', '12', true), si('be.btw.verlaagd', 'Verlaagd tarief / taux réduit %', '6', true),
        ob('Kleinunternehmer', 'Vrijstellingsregeling kleine ondernemingen / régime de franchise (art. 56bis) – Rechnungen ohne MwSt'),
        sel('be.periode', 'Periodische Erklärung', [['kwartaal', 'vierteljährlich (kwartaal / trimestre)'], ['maand', 'monatlich (maand / mois)']], 'kwartaal'),
        h('div', { class: 'fld hint' }, 'Die Unternehmensnummer (BE0123456749) gehört unter Firmendaten → USt-IdNr. Beim Kunden die Unternehmensnummer bzw. USt-IdNr. unter Steuer & Buchhaltung; sie ist zugleich seine Peppol-Adresse. Belegsprache Nederlands oder Français unter Vorgabewerte → Sprache; die Rechtstexte folgen ihr.')),
      grp('Ondernemingsgegevens / Données de l\'entreprise',
        si('be.rpr', 'RPR / RPM (z. B. Gent, afdeling Gent)', '', true),
        h('div', { class: 'fld hint' }, 'Unternehmensnummer und Rechtsgebiet des Unternehmensgerichts stehen in der Fußzeile jedes Belegs.')),
      grp('E-facturatie / Facturation électronique (Peppol)',
        h('div', { class: 'fld hint' }, 'Seit 2026 gehen Rechnungen zwischen belgischen Unternehmen als E-Rechnung über Peppol (BIS Billing 3.0). Kuenta erzeugt die XML-Datei (Rechnung → E-Rechnung (Peppol)); senden Sie sie über Ihren Peppol-Dienstleister (Access Point) oder Hermes. Kunden ohne Peppol (Privatkunden) bekommen weiter PDF oder Papier.'))));
  },
};

Views.beAangifte = async (main) => {
  const q0 = Math.floor((Number(today().slice(5, 7)) - 1) / 3) * 3;
  let von = addMonths(today().slice(0, 4) + '-' + String(q0 + 1).padStart(2, '0') + '-01', -3), bis = addDays(addMonths(von, 3), -1);
  const out = h('div');
  const terug = h('input', { type: 'checkbox' });
  const TXT = {
    '00': 'Handelingen onder bijzondere regeling (marge) / régime particulier', '01': 'Handelingen aan 6 % / opérations à 6 %', '02': 'Handelingen aan 12 % / opérations à 12 %', '03': 'Handelingen aan 21 % / opérations à 21 %',
    44: 'Diensten aan EU-afnemers (verlegd) / services intracommunautaires', 46: 'Vrijgestelde intracommunautaire leveringen / livraisons intracommunautaires', 47: 'Andere vrijgestelde handelingen en uitvoer / autres opérations exemptées',
    48: 'Creditnota\'s (44, 46) / notes de crédit (44, 46)', 49: 'Andere creditnota\'s / autres notes de crédit', 82: 'Aankopen diensten en diverse goederen / achats services et biens divers',
    85: 'Ontvangen creditnota\'s / notes de crédit reçues', 54: 'Verschuldigde btw / TVA due', 59: 'Aftrekbare btw / TVA déductible', 63: 'Btw op ontvangen creditnota\'s / TVA à reverser',
    64: 'Btw op uitgereikte creditnota\'s / TVA à récupérer', 71: 'Verschuldigd aan de Staat / dû à l\'État', 72: 'Verschuldigd door de Staat / dû par l\'État',
  };
  const berekenen = async () => {
    out.textContent = '';
    try {
      const r = await api('/api/be/aangifte?' + qs({ von, bis }));
      const rows = Object.entries(r.roosters).sort(([a], [b]) => Number(a) - Number(b)).map(([rooster, bedrag]) => ({ rooster, tekst: TXT[rooster] || '', bedrag }));
      out.append(miniGrid([{ f: 'rooster', l: 'Rooster / grille', w: 110 }, { f: 'tekst', l: 'Omschrijving / description', w: 520 }, { f: 'bedrag', l: 'Bedrag / montant', w: 150, t: 'money' }], rows).el,
        h('div', { class: 'note ' + (r.terug ? 'ok' : 'info'), style: { marginTop: '8px' } }, r.terug ? `${T('Guthaben (Rooster 72)')}: ${fmt.money(r.terug)}` : `${T('Zu zahlen (Rooster 71)')}: ${fmt.money(r.teBetalen)}`),
        h('div', { class: 'hint' }, `${r.periode === 'maand' ? T('monatlich') : T('vierteljährlich')} · ${r.rechnungen} ${T('Rechnungen')}`));
    } catch (e) { showError(e); }
  };
  main.append(title('Btw-aangifte / Déclaration TVA (België / Belgique)', 'Periodische Erklärung nach Rastern, XML für Intervat'),
    h('div', { class: 'view-scroll' },
      h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; }),
        h('button', { class: 'btn primary', onclick: berekenen }, '🧮 ' + T('Berechnen')),
        h('label', { class: 'inline' }, terug, T('Erstattung beantragen')),
        h('button', { class: 'btn', onclick: () => downloadUrl('/api/be/aangifte/xml?' + qs({ von, bis, terug: terug.checked ? '1' : '0' }), 'btw-aangifte.xml') }, '⬇ ' + T('XML für Intervat'))),
      h('div', { class: 'hint', style: { maxWidth: '900px', margin: '4px 0 10px' } }, 'Die XML-Datei laden Sie in Intervat hoch (Raster nach dem amtlichen Formular). Vorsteuer und Einkäufe aus den Eingangsrechnungen (Raster 82 / 59). Differenzbesteuerung (Raster 00) und Sonderfälle mit dem Buchhalter abstimmen; die Kundenliste (jaarlijkse klantenlisting) und die innergemeinschaftliche Liste erstellt Kuenta nicht.'),
      out));
  berekenen();
};
