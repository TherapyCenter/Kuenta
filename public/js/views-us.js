'use strict';
/* global title, h, qs, downloadUrl, Views, today, LK, dateRange, addMonths, addDays */
// US tax system: settings tab (sales tax, shop registration, shop supplies, fees, QuickBooks) and the export view

const UsUI = {
  activo() { return !!(LK.data && LK.data.land === 'US'); },
  settingsTab(p, { s, changes, si, sb, grp, fld }) {
    const fees = h('textarea', { rows: 5 }, s.sw['us.fees'] ?? 'Hazardous waste disposal;5;n\nTire disposal fee (per tire);3;n;q\nCore charge;0;y');
    fees.addEventListener('change', () => { changes.sw['us.fees'] = fees.value; });
    p.append(h('div', { class: 'groups' },
      grp('Sales tax',
        si('us.tax.rate', 'Kombinierter Steuersatz % (State + County + City)', '0', true), si('us.tax.rate2', 'Zweiter Satz % (falls nötig)', '0', true),
        sb('us.labor.taxable', 'Arbeitsleistung ist steuerpflichtig', '0'), sb('us.fees.taxable', 'Shop supplies und Gebühren sind steuerpflichtig', '0'),
        h('div', { class: 'fld hint' }, 'Den Satz Ihres Werkstattstandorts erfahren Sie beim Department of Revenue Ihres Staates. Steuerbefreite Kunden (Resale, Government, Non-profit) stellen Sie im Kunden unter Steuer & Buchhaltung ein, mit Nummer des Exemption Certificate. Ort im Format „Springfield, IL“ eintragen, die ZIP-Code kommt ins PLZ-Feld.')),
      grp('Werkstatt-Registrierung',
        si('us.reg.label', 'Bezeichnung (z. B. BAR ARD No., MV Repair Facility No.)', 'Registration No.', true), si('us.reg.nr', 'Nummer', '', true),
        h('div', { class: 'fld hint' }, 'Erscheint in der Fußzeile jedes Belegs. Viele Staaten verlangen die Registriernummer auf Kostenvoranschlag und Rechnung.')),
      grp('Shop supplies und Gebühren',
        si('us.supplies.pct', 'Shop supplies: % der Arbeitsleistung', '10', true), si('us.supplies.max', 'Obergrenze $ (0 = keine)', '0', true),
        fld('Gebühren (je Zeile: Name;Betrag;steuerpflichtig y/n;q = Anzahl abfragen; Betrag 0 = abfragen)', fees)),
      grp('QuickBooks Online',
        si('us.qbo.parts', 'Produkt/Leistung für Teile', 'Parts', true), si('us.qbo.labor', 'Produkt/Leistung für Arbeit', 'Labor', true), si('us.qbo.fees', 'Produkt/Leistung für Gebühren', 'Fees', true))));
  },
};

Views.usExport = async (main) => {
  let von = addMonths(today().slice(0, 7) + '-01', -1), bis = addDays(today().slice(0, 7) + '-01', -1);
  main.append(title('QuickBooks Online', 'Rechnungen als CSV für den Import in QuickBooks Online (US)'),
    h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; }),
      h('button', { class: 'btn primary', onclick: () => downloadUrl('/api/us/export/quickbooks?' + qs({ von, bis }), 'QuickBooks_invoices.csv') }, '⬇ QuickBooks invoices')),
    h('div', { class: 'hint', style: { maxWidth: '760px', lineHeight: 1.6 } }, 'In QuickBooks: Settings → Import data → Invoices, die Datei wählen und die Spalten zuordnen. Steuerpflichtige Positionen haben den Steuercode TAX, alle anderen NON. Die Sales Tax berechnet QuickBooks mit den Sätzen Ihrer Steuerbehörde.'));
};
