'use strict';
/* global h, $, $$, api, LK, ENT, Views, Vorgang, editRecord, toast, showError, Pref, fmt, Win, Print, I18N, T */
// Application shell: menus, navigation, quick bar, global search, routing

const NAV = [
  { g: 'Stammdaten', items: [['kunden', '👤', 'Kunden'], ['fahrzeuge', '🚗', 'Fahrzeuge'], ['artikel', '📦', 'Artikel'], ['arbeitswerte', '🔧', 'Arbeitswerte'], ['lieferanten', '🚚', 'Lieferanten'], ['reifen', '⭕', 'Reifeneinlagerung']] },
  { g: 'Büro', items: [['kalender', '📅', 'Terminplaner'], ['aufgaben', '✅', 'Aufgaben'], ['briefe', '✉️', 'Briefe'], ['zeiterfassung', '⏱️', 'Zeiterfassung'], ['stempeluhr', '🕒', 'Stempeluhr']] },
  { g: 'Einkauf', items: [['eingang', '📥', 'Eingangsrechnung'], ['lager', '🏬', 'Lagerbestände'], ['lagerbewegung', '📦', 'Lagerbewegung'], ['inventur', '📋', 'Inventur'], ['evisual', '🧾', 'E-Rechnung visualisieren']] },
  { g: 'Verkauf', items: [['angebote', '📝', 'Angebote'], ['auftraege', '🛠️', 'Aufträge'], ['lieferscheine', '📃', 'Lieferscheine'], ['rechnungen', '💶', 'Rechnungen'], ['korrekturen', '↩️', 'Rechnungskorrekturen'], ['kasse', '🧮', 'Kasse']] },
  { g: 'Fahrzeughandel', items: [['fahrzeuglager', '🚙', 'Fahrzeuglager'], ['kaufvertraege', '🤝', 'Kaufverträge'], ['verkaufsstatistik', '📊', 'Verkaufsstatistik']] },
  { g: 'Finanzen', items: [['kassenbuch', '💰', 'Kassenbuch'], ['zahlungen', '🏦', 'Zahlungen'], ['op', '📌', 'Offene Posten'], ['rechnungsliste', '📋', 'Rechnungsliste'], ['mahnungen', '⚠️', 'Mahnungen'], ['fibu', '📤', 'FIBU-Export']] },
  { g: 'Auswertung', items: [['termine', '🗓️', 'Fahrzeugtermine'], ['umsatz', '📈', 'Umsatz/Roherlöse'], ['serienbriefe', '📨', 'Serienbriefe'], ['leistungsgrad', '🎯', 'Leistungsgrad']] },
];
const RIGHT_OF = { kunden: 'Kunden', fahrzeuge: 'Fahrzeuge', artikel: 'Artikel', arbeitswerte: 'Arbeitswerte', lieferanten: 'Lieferanten', reifen: 'Reifeneinlagerung', angebote: 'Angebote', auftraege: 'Aufträge', lieferscheine: 'Lieferscheine', rechnungen: 'Rechnungen', korrekturen: 'Rechnungskorrekturen', kassenbuch: 'Kassenbuch', zahlungen: 'Zahlungen', op: 'Offene Posten', rechnungsliste: 'Ausgangsrechnungliste', mahnungen: 'Mahnungen', fibu: 'FIBU', umsatz: 'Auswetung', einstellungen: 'Einstellungen', eingang: 'Einkauf', kasse: 'Kasse', fahrzeuglager: 'Fahrzeuge', kaufvertraege: 'Fahrzeuge' };

const App = {
  session: {}, settings: {}, current: null, route: null,
  pro(f) { return (this.session.pro || []).includes(f); },
  // Kuenta Pro notice with a jump to the license tab
  async proHinweis(f, meldung) {
    const text = meldung || 'Diese Funktion gehört zu Kuenta Pro. Kuenta selbst ist Open Source und bleibt kostenlos. Pro-Funktionen schalten Sie mit einem Lizenzschlüssel frei, bezahlt wird mit Bitcoin oder Tether (USDT).';
    if (await dialog('Kuenta Pro', h('div', { style: { lineHeight: 1.5, maxWidth: '460px' } }, text), [{ label: 'Zur Lizenz', cls: 'primary', value: true }, { label: 'Schließen', value: false }])) { this.einstellungenTab = 'Lizenz'; this.go('einstellungen'); }
  },
  denied(right) { const d = this.session.user && this.session.user.denied; return !!(d && (d.includes(right) || d.includes(right + '|anzeigen'))); },
  setting(k, def) { return this.settings.sw && this.settings.sw[k] != null ? this.settings.sw[k] : def; },
  async loadSettings() {
    try {
      const s = await api('/api/einstellungen');
      const opt = {}; for (const o of s.optionen) opt[o.BEZEICHNUNG] = o.WERT;
      this.settings = { sw: s.sw, opt, banks: [opt['FIBU-Bank1Name'], opt['FIBU-Bank2Name'], opt['FIBU-Bank3Name']].filter(Boolean) };
      if (LK.data) LK.data.klein = opt.Kleinunternehmer === '1';
    } catch { /* ignore */ }
  },
  // Language per workstation; the page is reloaded so every view is built again
  setLang(code) { Pref.set('lang', code); location.reload(); },
  langMenu() {
    return Object.entries(I18N.UI_LANGS).map(([k, l]) => [(k === I18N.lang ? '✓ ' : '  ') + l.name, () => this.setLang(k)]);
  },
  // Static texts from index.html
  translateStatic() {
    for (const el of $$('[placeholder]')) el.placeholder = T(el.placeholder);
    for (const el of $$('[title]')) el.title = T(el.title);
  },
  async init() {
    this.translateStatic();
    this.setTheme(Pref.get('theme', 'auto'), false);
    this.setFarbe(Pref.get('farbe', 'blau'), false);
    try { this.session = await api('/api/session', { noLogin: true }); } catch (e) { showError(e); return; }
    // no language chosen on this workstation yet: use the default of the installation
    if (Pref.get('lang', null) == null && I18N.UI_LANGS[this.session.sprache] && this.session.sprache !== I18N.lang) { this.setLang(this.session.sprache); return; }
    if (this.session.loginRequired && !this.session.user) return this.showLogin();
    await LK.load();
    await this.loadSettings();
    this.buildMenus(); this.buildNav(); this.buildQuick(); this.buildSearch();
    const mand = (this.session.mandanten || []).find(m => m.id === this.session.mandant);
    $('#status-left').textContent = `${this.session.firma || ''}${mand && (this.session.mandanten || []).length > 1 ? ' · ' + T('Mandant') + ': ' + mand.name : ''}`;
    this.logoPruefen();
    $('#status-right').textContent = T(`Kuenta ${this.session.version} · F2 Artikel · F3 Arbeitswert · Strg+S Speichern · Strg+P Drucken`);
    window.addEventListener('hashchange', () => this.go(location.hash.slice(1) || 'start', false));
    this.go(location.hash.slice(1) || 'start', false);
    if (this.session.warnung) alertDlg(this.session.warnung, 'Achtung: Datenordner');
  },
  // Convert CMYK or very large logos once into an RGB PNG suitable for PDF/A (the browser can read any JPEG)
  async logoPruefen() {
    const logo = this.settings.sw && this.settings.sw['firma.logo'];
    if (!logo || /\.png$/i.test(logo) || this.settings.sw['firma.logo.geprueft'] === logo) return;
    try { await this.logoUmwandeln('/dateien/' + logo.split('/').map(encodeURIComponent).join('/')); await api('/api/einstellungen', { method: 'PUT', body: { sw: { 'firma.logo.geprueft': this.settings.sw['firma.logo'] } } }); } catch (e) { console.warn('Logo-Umwandlung', e); }
  },
  async logoUmwandeln(src) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const sc = Math.min(1, 1200 / img.naturalWidth);
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const r = await api('/api/einstellungen/logo?name=firmenlogo.png', { method: 'POST', body: blob });
    this.settings.sw['firma.logo'] = r.logo;
    return r.logo;
  },
  // Colour scheme per workstation: blau (default), gruen, graphit, bordeaux
  setFarbe(f, save = true) {
    if (!f || f === 'blau') document.documentElement.removeAttribute('data-farbe'); else document.documentElement.setAttribute('data-farbe', f);
    if (save) Pref.set('farbe', f);
  },
  setTheme(t, save = true) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    if (save) Pref.set('theme', t);
  },
  showLogin() {
    if ($('.login')) return;
    const u = h('input', { type: 'text', placeholder: 'Benutzername', autocomplete: 'username' });
    const p = h('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'current-password' });
    const err = h('div', { class: 'note err hidden' });
    const form = h('form', { onsubmit: async ev => {
      ev.preventDefault();
      try { await api('/api/login', { method: 'POST', body: { user: u.value, pass: p.value }, noLogin: true }); location.reload(); }
      catch (e) { err.textContent = T(e.message); err.classList.remove('hidden'); }
    } }, h('h2', null, h('img', { src: 'img/icon.svg', width: 28 }), 'Kuenta'), u, p, err, h('button', { class: 'btn primary', type: 'submit' }, 'Anmelden'),
      h('select', { class: 'lang', onchange: e => this.setLang(e.target.value) }, Object.entries(I18N.UI_LANGS).map(([k, l]) => h('option', { value: k, selected: k === I18N.lang }, l.name))));
    document.body.append(h('div', { class: 'login' }, form));
    setTimeout(() => u.focus(), 50);
  },
  buildMenus() {
    const M = [
      { l: 'Kuenta', items: [['Übersicht', () => this.go('start')], ['Mandant wechseln …', () => mandantenDialog()], '-', ['Daten sichern …', () => this.go('sicherung')], ['Daten wiederherstellen …', () => this.go('sicherung')], ['Daten aus KFZ-Faktura importieren …', () => this.go('import')], ['Datenimport (CSV, DATANORM) …', () => this.go('datenimport')], '-', { sub: 'Sprache / Language', items: this.langMenu() }, '-', ...(this.session.user ? [['Abmelden', async () => { await api('/api/logout', { method: 'POST' }); location.reload(); }]] : [])] },
      { l: 'Artikel', items: [['Artikelübersicht', () => this.go('artikel')], ['Neuer Artikel', () => editRecord('artikel', null)], '-', ['Warengruppen', () => Views.tabelleDialog('warengruppen')], ['Hersteller', () => Views.tabelleDialog('hersteller')], ['Einheiten', () => Views.tabelleDialog('einheiten')]] },
      { l: 'Stammdaten', items: [...NAV[0].items.map(([k, , l]) => [l, () => this.go(k)]), '-', ['Zahlungsbedingungen', () => Views.tabelleDialog('zahlungsbedingungen')], ['Stundenverrechnungssätze', () => Views.tabelleDialog('kostensaetze')], ['Textbausteine', () => Views.tabelleDialog('textbausteine')], ['Einleitungs-/Schlusstexte', () => Views.tabelleDialog('drucktexte')], ['Auftragsarten', () => Views.tabelleDialog('auftragsarten')], '-', ['Benutzer / Mitarbeiter', () => Views.tabelleDialog('benutzer')], ['Einstellungen', () => this.go('einstellungen')]] },
      { l: 'Büro', items: NAV[1].items.map(([k, , l]) => [l, () => this.go(k)]) },
      { l: 'Einkauf', items: NAV[2].items.map(([k, , l]) => [l, () => this.go(k)]) },
      { l: 'Verkauf', items: [...NAV[3].items.map(([k, , l]) => [l, () => this.go(k)]), '-', ['Neues Angebot', () => Vorgang.open('angebot')], ['Neuer Auftrag', () => Vorgang.open('auftrag')], ['Neue Rechnung', () => Vorgang.open('rechnung')], ['Neue Rechnungskorrektur / Gutschrift', () => Vorgang.open('korrektur')], '-', ['Rechnungen als Stapel drucken …', () => Vorgang.stapeldruck()]] },
      { l: 'Fahrzeughandel', items: NAV[4].items.map(([k, , l]) => [l, () => this.go(k)]) },
      { l: 'Finanzen', items: NAV[5].items.map(([k, , l]) => [l, () => this.go(k)]) },
      { l: 'Auswertung', items: NAV[6].items.map(([k, , l]) => [l, () => this.go(k)]) },
      { l: 'Hilfe', items: [['Handbuch (F1)', () => this.handbuch()], ['Tastenkürzel', () => this.help()], '-', ['Über Kuenta', () => this.about()]] },
    ];
    const host = $('#menus'); host.innerHTML = '';
    let openMenu = null;
    for (const m of M) {
      const item = it => it === '-' ? h('hr')
        : it.sub ? h('div', { class: 'menu-sub' }, h('button', null, it.sub, h('span', { style: { marginLeft: 'auto' } }, '▸')), h('div', { class: 'menu-list' }, it.items.map(item)))
        : h('button', { onclick: () => { close(); it[1](); } }, it[0]);
      const list = h('div', { class: 'menu-list' }, m.items.map(item));
      const el = h('div', { class: 'menu' }, h('button', { onclick: () => { if (openMenu === el) close(); else { close(); el.classList.add('open'); openMenu = el; } }, onmouseenter: () => { if (openMenu && openMenu !== el) { close(); el.classList.add('open'); openMenu = el; } } }, m.l), list);
      host.append(el);
    }
    function close() { if (openMenu) openMenu.classList.remove('open'); openMenu = null; }
    document.addEventListener('mousedown', e => { if (openMenu && !openMenu.contains(e.target)) close(); });
    const ub = $('#userbox'); ub.innerHTML = '';
    ub.append(h('button', { class: 'btn sm', title: 'Einstellungen', onclick: () => this.go('einstellungen') }, '⚙'));
    if (this.session.user) ub.append(h('span', { class: 'hint' }, '👤 ' + this.session.user.name));
  },
  buildNav() {
    const nav = $('#nav'); nav.innerHTML = '';
    const closed = Pref.get('nav.closed', []);
    for (const g of NAV) {
      const items = g.items.filter(([k]) => !this.denied(RIGHT_OF[k]));
      if (!items.length) continue;
      const grp = h('div', { class: 'nav-group' + (closed.includes(g.g) ? ' closed' : '') },
        h('button', { class: 'nav-head', 'data-g': g.g, onclick: () => { grp.classList.toggle('closed'); Pref.set('nav.closed', $$('.nav-group.closed .nav-head').map(b => b.dataset.g)); } }, h('span', null, g.g)),
        h('div', { class: 'nav-items' }, items.map(([k, ico, l]) => h('button', { 'data-k': k, title: l, onclick: () => this.go(k) }, h('span', { class: 'ico' }, ico), h('span', null, l)))));
      nav.append(grp);
    }
    nav.append(h('div', { class: 'nav-group' }, h('button', { class: 'nav-head', onclick: e => e.currentTarget.parentNode.classList.toggle('closed') }, h('span', null, 'System')),
      h('div', { class: 'nav-items' }, [['einstellungen', '⚙️', 'Einstellungen'], ['sicherung', '💾', 'Datensicherung'], ['import', '📥', 'KFZ-Faktura-Import'], ['datenimport', '🔌', 'Datenimport / Schnittstellen']].map(([k, ico, l]) => h('button', { 'data-k': k, title: l, onclick: () => this.go(k) }, h('span', { class: 'ico' }, ico), h('span', null, l))))));
  },
  buildQuick() {
    const q = $('#quickbar'); q.innerHTML = '';
    const b = (ico, l, fn) => h('button', { class: 'qbtn', onclick: fn }, h('span', { class: 'ico' }, ico), l);
    q.append(b('🏠', 'Übersicht', () => this.go('start')), h('span', { class: 'qsep' }),
      b('👤', 'Neuer Kunde', () => editRecord('kunden', null)), b('🚗', 'Neues Fzg.', () => editRecord('fahrzeuge', null)), b('⭕', 'Einlagerung', () => editRecord('reifen', null)), h('span', { class: 'qsep' }),
      b('📝', 'Angebot', () => Vorgang.open('angebot')), b('🛠️', 'Auftrag', () => Vorgang.open('auftrag')), b('📃', 'Lieferschein', () => Vorgang.open('lieferschein')), b('💶', 'Rechnung', () => Vorgang.open('rechnung')), h('span', { class: 'qsep' }),
      b('🧮', 'Kasse', () => this.go('kasse')), b('📌', 'Offene Posten', () => this.go('op')), b('💰', 'Kassenbuch', () => this.go('kassenbuch')), b('📅', 'Termine', () => this.go('kalender')), h('span', { class: 'qsep' }),
      b('💾', 'Sichern', () => this.go('sicherung')));
  },
  buildSearch() {
    const inp = $('#gsearch'), res = $('#gsearch-res');
    let tmr;
    const render = d => {
      res.innerHTML = '';
      const sec = (t, list, fn, txt) => { if (!list.length) return; res.append(h('h4', null, t)); list.forEach(r => res.append(h('div', { class: 'item', onmousedown: () => { res.classList.add('hidden'); fn(r); } }, h('span', null, txt(r)[0]), h('span', { class: 'hint' }, txt(r)[1])))); };
      sec('Kunden', d.kunden, r => editRecord('kunden', r.id), r => [r.name, `${r.nr || ''} ${r.ort || ''}`]);
      sec('Fahrzeuge', d.fahrzeuge, r => editRecord('fahrzeuge', r.id), r => [r.kz || '(ohne Kennz.)', r.name]);
      sec('Rechnungen', d.rechnungen, r => Vorgang.open(r.typ === 2 ? 'korrektur' : 'rechnung', r.id), r => [`${r.typ === 2 ? 'Korrektur' : 'Rechnung'} ${r.nr}`, `${r.name || ''} · ${fmt.money(r.brutto)}`]);
      if (!res.children.length) res.append(h('div', { class: 'item hint' }, 'Keine Treffer'));
      res.classList.remove('hidden');
    };
    inp.addEventListener('input', () => { clearTimeout(tmr); const v = inp.value.trim(); if (v.length < 2) { res.classList.add('hidden'); return; } tmr = setTimeout(async () => render(await api('/api/suche?q=' + encodeURIComponent(v))), 250); });
    inp.addEventListener('blur', () => setTimeout(() => res.classList.add('hidden'), 150));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = $('.item', res); if (f) f.dispatchEvent(new Event('mousedown')); } });
    document.addEventListener('keydown', e => { if (e.key === 'f' && e.ctrlKey && !Win.top()) { e.preventDefault(); inp.focus(); } });
    document.addEventListener('keydown', e => { if (e.key === 'F1') { e.preventDefault(); this.handbuch(); } });
  },
  async go(route, push = true) {
    if (push && location.hash.slice(1) !== route) { location.hash = route; return; }
    this.route = route; this.current = null;
    $$('#nav .nav-items button').forEach(b => b.classList.toggle('active', b.dataset.k === route));
    const main = $('#main'); main.innerHTML = '';
    try {
      if (ENT.E[route] && !Views[route]) await Views.entity(route)(main);
      else if (Views[route]) await Views[route](main);
      else await Views.start(main);
    } catch (e) { showError(e); }
  },
  refresh(entName) {
    if (this.current && this.current.name === entName) this.current.reload();
  },
  // Handbook in the language of the user interface, in a new browser tab
  handbuch() {
    const file = { de: 'handbuch.html', en: 'handbook-en.html', es: 'handbook-es.html' }[I18N.lang] || 'handbuch.html';
    window.open('/docs/' + file, '_blank', 'noopener');
  },
  help() {
    Win.open({ title: 'Tastenkürzel', width: 520, content: h('table', { class: 'simple' }, h('tbody', null, [
      ['F1', 'Handbuch öffnen'], ['Strg + F', 'Globale Suche'], ['Enter (in Suchleiste)', 'Suche ausführen'], ['Doppelklick / Enter', 'Eintrag öffnen'], ['Rechtsklick', 'Kontextmenü (Weitere Funktionen)'], ['Rechtsklick auf Spaltenkopf', 'Spalten ein-/ausblenden, CSV-Export'],
      ['Umschalt / Strg + Klick', 'Mehrere Einträge markieren'], ['Entf', 'Eintrag / Position löschen'], ['F2 (im Vorgang)', 'Artikel einfügen'], ['F3 (im Vorgang)', 'Arbeitswert einfügen'], ['Strg + S', 'Vorgang speichern'], ['Strg + P', 'Vorgang drucken'], ['Strg + Enter', 'Formular speichern (OK)'], ['Esc', 'Fenster schließen']].map(([a, b]) => h('tr', null, h('td', null, h('b', null, a)), h('td', null, b))))) });
  },
  about() {
    Win.open({ title: 'Über Kuenta', width: 480, content: h('div', { style: { lineHeight: 1.6 } }, h('h2', { style: { margin: '0 0 6px', color: 'var(--accent)' } }, 'Kuenta ' + this.session.version),
      h('p', null, 'Werkstatt-Faktura für Kfz-Betriebe als plattformunabhängige Webanwendung (Windows, macOS, Linux, Tablet).'),
      h('p', null, 'Kompatibel mit Datensicherungen von KFZ-Faktura (*.kfz, DB1.bak). E-Rechnung nach EN 16931 (XRechnung CII/UBL).'),
      h('p', null, '© 2026 Doc · Open Source unter der GNU AGPL 3.0. ', (this.session.pro || []).length ? 'Kuenta Pro ist freigeschaltet.' : 'Pro-Funktionen (z. B. SMS) mit Lizenzschlüssel.')) });
  },
};
window.App = App;
App.init();
