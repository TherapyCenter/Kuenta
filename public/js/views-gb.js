'use strict';
/* global title, h, api, qs, fmt, toast, showError, confirmDlg, dialog, downloadUrl, Views, today, LK, T, dateRange, addMonths, addDays */
// UK tax system: settings tab (VAT, scheme, Making Tax Digital) and the view "VAT & MTD" (exports, VAT return)

const GbUI = {
  activo() { return !!(LK.data && LK.data.land === 'GB'); },
  // screen and window size for HMRC's fraud prevention headers
  client() {
    return encodeURIComponent(JSON.stringify({ screens: [{ width: screen.width, height: screen.height, scaling: window.devicePixelRatio || 1, colourDepth: screen.colorDepth }], window: { width: window.innerWidth, height: window.innerHeight } }));
  },
  hm(path, opts = {}) { return api(path, { ...opts, headers: { ...(opts.headers || {}), 'X-Kuenta-Client': GbUI.client() } }); },

  settingsTab(p, { s, changes, si, grp, fld, ob }) {
    const sel = (k, label, opts, def) => {
      const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] ?? def) === v }, l)));
      x.addEventListener('change', () => { changes.sw[k] = x.value; });
      return fld(label, x);
    };
    const status = h('div', { class: 'fld' });
    const zeigen = async () => {
      try {
        const r = await api('/api/gb/estado');
        status.textContent = '';
        const zeile = (a, b, cls) => h('div', { class: cls || '' }, h('b', null, T(a) + ': '), b);
        status.append(
          zeile('Umgebung', r.entorno === 'production' ? T('Produktion – Erklärungen gehen an HMRC') : T('Sandbox – nur zum Testen'), r.entorno === 'production' ? '' : 'note warn'),
          zeile('VAT-Nummer', r.vrn ? 'GB' + r.vrn : T('fehlt – bitte unter Firmendaten → USt-IdNr. eintragen'), r.vrn ? '' : 'note err'),
          zeile('Developer-Hub-Zugang', r.app ? T('hinterlegt') : T('fehlt')),
          zeile('Verbindung', r.conectado ? T('verbunden seit ') + r.verbunden : T('nicht verbunden')),
          zeile('Rücksprung-Adresse (Redirect URI)', r.redirect));
      } catch (e) { status.textContent = '❌ ' + e.message; }
    };
    const speichern = () => api('/api/einstellungen', { method: 'PUT', body: changes });
    const zugang = async () => {
      const id = h('input', { type: 'text' }), sec = h('input', { type: 'password' });
      const ok = await dialog('HMRC Developer Hub', h('div', { class: 'fgrid' }, fld('Client ID', id), fld('Client secret', sec),
        h('div', { class: 'fld hint' }, T('Aus der Anwendung im HMRC Developer Hub (developer.service.hmrc.gov.uk) mit der API „VAT (MTD)“. Gilt für die gewählte Umgebung.'))),
      [{ label: 'Speichern', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 560 });
      if (!ok) return;
      try { await speichern(); await api('/api/gb/app', { method: 'POST', body: { clientId: id.value, clientSecret: sec.value } }); toast('Gespeichert', 'ok'); zeigen(); } catch (e) { showError(e); }
    };
    const verbinden = async () => {
      try {
        await speichern();
        const r = await api('/api/gb/conectar', { method: 'POST' });
        const w = window.open(r.url, 'hmrc', 'width=760,height=820');
        if (!w) location.href = r.url;
        const fertig = ev => { if (ev.data && 'hmrc' in ev.data) { window.removeEventListener('message', fertig); zeigen(); } };
        window.addEventListener('message', fertig);
      } catch (e) { showError(e); }
    };
    const header = async () => {
      try {
        const r = await GbUI.hm('/api/gb/probar-cabeceras', { method: 'POST' });
        const probleme = [...(r.errors || []), ...(r.warnings || [])].map(x => `${x.code || ''}: ${x.message || ''} ${(x.headers || []).join(', ')}`);
        await dialog('Prüfung der Fraud-Prevention-Header', h('div', null, h('div', { class: 'note ' + (r.code === 'VALID_HEADERS' ? 'ok' : 'warn') }, r.message || r.code || ''), probleme.length ? h('ul', null, probleme.map(x => h('li', null, x))) : null), [{ label: 'OK', value: true }], { width: 640 });
      } catch (e) { showError(e); }
    };
    p.append(h('div', { class: 'groups' },
      grp('VAT',
        si('gb.vat.standard', 'Standard rate %', '20', true), si('gb.vat.reduced', 'Reduced rate %', '5', true),
        ob('Kleinunternehmer', 'Nicht umsatzsteuerregistriert (Umsatz unter der Schwelle) – Rechnungen ohne VAT'),
        sel('gb.schema', 'VAT scheme', [['standard', 'Standard (Rechnungsdatum = tax point)'], ['cash', 'Cash accounting (VAT bei Zahlung)'], ['flat', 'Flat rate scheme']], 'standard'),
        si('gb.flatrate', 'Flat rate % (Kfz-Reparatur: 8,5)', '8.5', true),
        h('div', { class: 'fld hint' }, 'Die VAT-Nummer der Firma steht unter Firmendaten → USt-IdNr. (z. B. GB123456782). Positionen: Standard, Reduced, Zero rate oder Exempt; Auslagen (z. B. MOT-Gebühr) als durchlaufenden Posten erfassen – sie sind outside the scope. Gebrauchtwagen mit Differenzbesteuerung laufen über das second-hand margin scheme.')),
      grp('Making Tax Digital (HMRC)',
        sel('gb.mtd.entorno', 'Umgebung', [['sandbox', 'Sandbox (test-api.service.hmrc.gov.uk) – zum Testen'], ['production', 'Produktion']], 'sandbox'),
        si('gb.mtd.redirect', 'Redirect URI (leer = http://localhost:3700/api/gb/oauth/callback)', ''),
        h('div', { class: 'fld hint' }, 'Kuenta reicht die VAT return direkt bei HMRC ein. Einmalig: Zugangsdaten aus dem HMRC Developer Hub hinterlegen (die Redirect URI muss dort eingetragen sein), dann „Mit HMRC verbinden“ und mit dem Government Gateway des Unternehmens anmelden. Die Verbindung hält 18 Monate. Anmeldedaten liegen im Datenordner unter „gb“, nicht in der Sicherung.'),
        h('div', { class: 'fld inline' },
          h('button', { class: 'btn', onclick: zugang }, '🔑 Developer-Hub-Zugangsdaten'),
          h('button', { class: 'btn primary', onclick: verbinden }, '🔗 Mit HMRC verbinden'),
          h('button', { class: 'btn', onclick: header }, '🧪 Header prüfen (Sandbox)'),
          h('button', { class: 'btn', onclick: async () => { if (await confirmDlg('Verbindung zu HMRC trennen?', { ok: 'Trennen' })) { await api('/api/gb/desconectar', { method: 'POST' }); zeigen(); } } }, '✂ Trennen')),
        status),
      grp('Buchhaltung (Xero, QuickBooks, Sage)',
        si('gb.xero.sales', 'Xero: Erlöskonto', '200', true), si('gb.xero.purchases', 'Xero: Aufwandskonto', '310', true),
        si('gb.qbo.item', 'QuickBooks: Produkt/Leistung', 'Sales', true),
        si('gb.sage.sales', 'Sage 50: Erlöskonto (nominal)', '4000', true), si('gb.sage.purchases', 'Sage 50: Aufwandskonto (nominal)', '5000', true))));
    zeigen();
  },
};

const BOXES = [
  ['vatDueSales', 1, 'VAT due in the period on sales and other outputs'],
  ['vatDueAcquisitions', 2, 'VAT due in the period on acquisitions of goods made in Northern Ireland from EU Member States'],
  ['totalVatDue', 3, 'Total VAT due (the sum of boxes 1 and 2)'],
  ['vatReclaimedCurrPeriod', 4, 'VAT reclaimed in the period on purchases and other inputs (including acquisitions in Northern Ireland from EU member states)'],
  ['netVatDue', 5, 'Net VAT to pay to HMRC or reclaim (difference between boxes 3 and 4)'],
  ['totalValueSalesExVAT', 6, 'Total value of sales and all other outputs excluding any VAT'],
  ['totalValuePurchasesExVAT', 7, 'Total value of purchases and all other inputs excluding any VAT'],
  ['totalValueGoodsSuppliedExVAT', 8, 'Total value of dispatches of goods and related costs (excluding VAT) from Northern Ireland to EU Member States'],
  ['totalAcquisitionsExVAT', 9, 'Total value of acquisitions of goods and related costs (excluding VAT) made in Northern Ireland from EU Member States'],
];
const DECLARATION = 'When you submit this VAT information you are making a legal declaration that the information is true and complete. A false declaration can result in prosecution.';

Views.ukVat = async (main) => {
  let von = addMonths(today().slice(0, 7) + '-01', -3), bis = addDays(today().slice(0, 7) + '-01', -1);
  const out = h('div'); const obl = h('div');
  const boxTabla = (b) => h('table', { class: 'simple', style: { maxWidth: '900px' } }, BOXES.map(([k, n, l]) => h('tr', null, h('td', { style: { width: '60px' } }, h('b', null, 'Box ' + n)), h('td', null, l), h('td', { class: 'r', style: { whiteSpace: 'nowrap' } }, n >= 6 ? '£' + fmt.num(b[k], 0) : fmt.money(b[k])))));
  const mostrar = async (o) => {
    out.textContent = '';
    try {
      const r = await api('/api/gb/calcular?' + qs({ von: o ? o.start : von, bis: o ? o.end : bis }));
      out.append(h('h3', null, o ? `VAT return ${fmt.date(o.start)} – ${fmt.date(o.end)} (${T('fällig')} ${fmt.date(o.due)})` : `${T('Berechnung')} ${fmt.date(von)} – ${fmt.date(bis)}`),
        boxTabla(r.boxes),
        h('div', { class: 'hint' }, T(`Schema: ${r.schema} · ${r.rechnungen} Rechnungen/Zahlungen · ${r.eingang} Eingangsrechnungen`) + (r.erstattung ? ' · ' + T('Erstattung von HMRC') : '')));
      if (o && o.status === 'O') {
        const chk = h('input', { type: 'checkbox' });
        out.append(h('label', { class: 'fld chk', style: { margin: '10px 0', maxWidth: '900px' } }, chk, h('span', null, DECLARATION)),
          h('button', { class: 'btn primary', onclick: async () => {
            if (!chk.checked) { toast('Bitte die Erklärung bestätigen.', 'err'); return; }
            if (!(await confirmDlg(`VAT return ${fmt.date(o.start)} – ${fmt.date(o.end)} jetzt an HMRC senden? Das kann nicht rückgängig gemacht werden.`, { ok: 'Senden' }))) return;
            try {
              const res = await GbUI.hm('/api/gb/enviar', { method: 'POST', body: { periodKey: o.periodKey, start: o.start, end: o.end, confirmado: true } });
              out.append(h('div', { class: 'note ok', style: { marginTop: '10px' } }, `✅ ${T('Eingereicht')} · ${res.processingDate || ''} · Form bundle ${res.formBundleNumber || ''}${res.chargeRefNumber ? ' · Charge ref ' + res.chargeRefNumber : ''}${res.paymentIndicator ? ' · ' + res.paymentIndicator : ''}`));
              laden();
            } catch (e) { showError(e); }
          } }, '📤 ' + T('An HMRC senden')));
      }
    } catch (e) { showError(e); }
  };
  const ansehen = async (o) => {
    try { const r = await GbUI.hm('/api/gb/return/' + encodeURIComponent(o.periodKey)); out.textContent = ''; out.append(h('h3', null, `${T('Eingereicht')}: ${fmt.date(o.start)} – ${fmt.date(o.end)} · ${r.processingDate || ''}`), boxTabla(r)); } catch (e) { showError(e); }
  };
  const laden = async () => {
    obl.textContent = T('Lade …');
    try {
      const list = await GbUI.hm('/api/gb/obligaciones?' + qs({ from: `${Number(today().slice(0, 4)) - 1}-01-01`, to: today() }));
      obl.textContent = '';
      if (!list.length) { obl.append(h('div', { class: 'hint' }, T('HMRC meldet keine Zeiträume.'))); return; }
      obl.append(h('table', { class: 'simple' }, h('tr', null, ['Zeitraum', 'Fällig', 'Status', ''].map(x => h('th', null, x))),
        list.map(o => h('tr', null, h('td', null, `${fmt.date(o.start)} – ${fmt.date(o.end)}`), h('td', null, fmt.date(o.due)), h('td', null, o.status === 'F' ? T('eingereicht') + (o.received ? ' ' + fmt.date(o.received) : '') : T('offen')),
          h('td', null, o.status === 'O' ? h('button', { class: 'btn sm primary', onclick: () => mostrar(o) }, T('Berechnen & einreichen')) : h('button', { class: 'btn sm', onclick: () => ansehen(o) }, T('Ansehen')))))));
    } catch (e) { obl.textContent = ''; obl.append(h('div', { class: 'note err' }, e.message)); }
  };
  const exp = (art, name) => h('button', { class: 'btn', onclick: () => downloadUrl('/api/gb/export/' + art + '?' + qs({ von, bis }), name) }, '⬇ ' + name);
  main.append(title('VAT & Making Tax Digital', 'Exporte für die Buchhaltung und VAT return an HMRC'),
    h('div', { class: 'view-scroll' },
      h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; })),
      h('div', { class: 'searchbar' }, exp('xero-sales', 'Xero sales invoices'), exp('xero-bills', 'Xero bills'), exp('quickbooks', 'QuickBooks invoices'), exp('sage', 'Sage 50 audit trail'), exp('journal', 'VAT journal'),
        h('button', { class: 'btn', onclick: () => mostrar(null) }, '🧮 ' + T('9 Boxen für den Zeitraum berechnen'))),
      h('fieldset', { class: 'grp', style: { marginTop: '10px' } }, h('legend', null, 'VAT returns (HMRC)'),
        h('div', { class: 'searchbar' }, h('button', { class: 'btn', onclick: laden }, '🔄 ' + T('Zeiträume von HMRC laden'))), obl),
      out));
};
