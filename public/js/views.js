'use strict';
/* global h, $, $$, fmt, api, qs, parseNum, LK, ENT, Win, toast, showError, confirmDlg, promptDlg, dialog, alertDlg, Overview, miniGrid, editRecord, pickKunde, pickRecord, Vorgang, Zahlung, Print, App, today, addDays, addMonths, downloadUrl, pickFile, saveBlob, kname, r2, Pref, EsUI, GbUI, UsUI, FrUI, AtUI, ChUI, ItUI, NlUI */

const Views = {};
const title = (t, sub) => h('div', { class: 'view-title' }, t, sub ? h('span', { class: 'sub' }, sub) : null);
const fld = (label, el, w1) => h('label', { class: 'fld' + (w1 ? ' w1' : '') }, h('span', null, label), el);
const simpleTable = (cols, rows, { onClick, footer, cls = '' } = {}) => {
  const isR = c => ['money', 'num', 'int'].includes(c.t);
  const val = (c, r) => c.render ? c.render(r) : c.t === 'money' ? fmt.money0(r[c.f]) : c.t === 'date' ? fmt.date(r[c.f]) : c.t === 'num' ? fmt.num(r[c.f]) : (r[c.f] ?? '');
  return h('table', { class: 'simple ' + cls },
    h('thead', null, h('tr', null, cols.map(c => h('th', { class: isR(c) ? 'num' : '' }, c.l)))),
    h('tbody', null, rows.map(r => h('tr', { class: onClick ? 'click' : '', onclick: onClick ? () => onClick(r) : null }, cols.map(c => h('td', { class: isR(c) ? 'num' : '' }, val(c, r)))))),
    footer ? h('tfoot', null, h('tr', null, cols.map((c, i) => h('td', { class: isR(c) ? 'num' : '' }, footer[c.f] != null ? val(c, footer) : (i === 0 ? 'Summe' : ''))))) : null);
};
const dateRange = (von, bis, onChange) => {
  const v = h('input', { type: 'date', value: von }), b = h('input', { type: 'date', value: bis });
  const presets = h('select', { onchange: () => {
    const t = today(); const y = t.slice(0, 4); const m = t.slice(0, 7);
    const p = { monat: [m + '-01', t], vormonat: [addMonths(m + '-01', -1), addDays(m + '-01', -1)], quartal: [y + '-' + String(Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0') + '-01', t], jahr: [y + '-01-01', t], vorjahr: [(y - 1) + '-01-01', (y - 1) + '-12-31'] }[presets.value];
    if (p) { v.value = p[0]; b.value = p[1]; onChange(v.value, b.value); }
    presets.value = '';
  } }, h('option', { value: '' }, 'Zeitraum …'), h('option', { value: 'monat' }, 'aktueller Monat'), h('option', { value: 'vormonat' }, 'Vormonat'), h('option', { value: 'quartal' }, 'aktuelles Quartal'), h('option', { value: 'jahr' }, 'aktuelles Jahr'), h('option', { value: 'vorjahr' }, 'Vorjahr'));
  v.addEventListener('change', () => onChange(v.value, b.value)); b.addEventListener('change', () => onChange(v.value, b.value));
  return [h('label', { class: 'inline' }, 'von', v), h('label', { class: 'inline' }, 'bis', b), presets];
};

// ---------------- Display currency and hiding amounts (display only – invoices and bookings stay in the company's currency) ----------------
const Anzeige = {
  kurse: null,
  NAMEN: { EUR: 'Euro', USD: 'US-Dollar', GBP: 'Britisches Pfund', CHF: 'Schweizer Franken', BTC: 'Bitcoin', SATS: 'Satoshis' },
  // currency of the company's amounts (EUR, GBP for UK, USD for US, CHF for Swiss companies)
  basis: () => (LK.data && LK.data.waehrung) || 'EUR',
  w: () => Pref.get('anzeigeWaehrung', null) || Anzeige.basis(),
  verborgen: () => Pref.get('betraegeVerbergen', false) === true,
  async laden(neu) {
    if (this.kurse && !neu) return this.kurse;
    try { this.kurse = await api('/api/kurse/aktuell'); } catch (e) { this.kurse = { fehler: e.message }; }
    return this.kurse;
  },
  kurs(w) { if (w === 'EUR') return { eurPro: 1 }; const k = this.kurse && this.kurse[w === 'SATS' ? 'BTC' : w]; return k && k.eurPro ? k : null; },
  // Format an amount in units of the currency (for EUR/USD/GBP/CHF/BTC/SATS)
  einheiten(v, w) {
    if (this.verborgen()) return '*****';
    if (w === 'EUR') return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €';
    if (w === 'USD' || w === 'GBP' || w === 'CHF') return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: w }).format(v);
    if (w === 'BTC') return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 8, maximumFractionDigits: 8 }).format(v) + ' ₿';
    if (w === 'SATS') return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(v * 1e8) + ' sats';
    return fmt.money(v);
  },
  // Amount in the company's currency shown in the chosen display currency (converted via the euro);
  // without a rate it stays in the company's currency
  betrag(v, w = this.w()) {
    if (this.verborgen()) return '*****';
    if (v == null || v === '') return '';
    const b = this.basis();
    if (w === b) return fmt.money(v);
    const kb = this.kurs(b), kz = this.kurs(w);
    return kb && kz ? this.einheiten(Number(v) * kb.eurPro / kz.eurPro, w) : fmt.money(v);
  },
  euro(eur) { return this.verborgen() ? '*****' : fmt.money(eur); },
  // Eye icon and currency switch
  leiste(onChange) {
    const w = this.w();
    const auge = h('button', { class: 'btn sm icon', title: this.verborgen() ? 'Beträge anzeigen' : 'Beträge ausblenden', 'aria-label': this.verborgen() ? 'Beträge anzeigen' : 'Beträge ausblenden',
      onclick: () => { Pref.set('betraegeVerbergen', !this.verborgen()); onChange(); } }, this.verborgen() ? '🙈' : '👁');
    const setze = k => { Pref.set('anzeigeWaehrung', k); if (k === 'BTC' || k === 'SATS') Pref.set('btcEinheit', k); onChange(); };
    const knoepfe = [['EUR', '€'], ['USD', '$'], ['GBP', '£'], ['CHF', 'CHF']].map(([k, l]) => h('button', {
      class: 'btn sm' + (k === w ? ' primary' : ''), title: `Anzeige in ${this.NAMEN[k]}`, onclick: () => setze(k) }, l));
    // One button for Bitcoin: the first click shows the last used unit, every further click toggles between ₿ and sats
    const btcAktiv = w === 'BTC' || w === 'SATS';
    const einheit = btcAktiv ? w : Pref.get('btcEinheit', 'BTC');
    knoepfe.push(h('button', {
      class: 'btn sm' + (btcAktiv ? ' primary' : ''), style: { minWidth: '42px' },
      title: btcAktiv ? `Anzeige in ${this.NAMEN[w]} – noch einmal klicken für ${w === 'BTC' ? 'Satoshis' : 'Bitcoin'}` : `Anzeige in ${this.NAMEN[einheit]}`,
      onclick: () => setze(btcAktiv ? (w === 'BTC' ? 'SATS' : 'BTC') : einheit) }, einheit === 'SATS' ? 'sats' : '₿'));
    return h('div', { class: 'inline', style: { marginLeft: 'auto', gap: '6px' } }, auge, h('div', { class: 'btn-gruppe' }, knoepfe));
  },
};

// ---------------- Start page ----------------
Views.start = async (main) => {
  const [d] = await Promise.all([api('/api/dashboard'), Anzeige.w() !== Anzeige.basis() ? Anzeige.laden() : null]);
  const A = Anzeige; const w = A.w(); const b = A.basis();
  const neu = () => App.go('start', false);
  const card = (kk, v, s, go) => h('div', { class: 'card' + (go ? ' click' : ''), onclick: go }, h('div', { class: 'k' }, kk), h('div', { class: 'v' }, v), h('div', { class: 's' }, s || ''));
  let kursHinweis = null;
  if (w !== b) {
    // conversion via the euro: display units per unit of the company's currency
    const kz = A.kurs(w), kb = A.kurs(b);
    const q = [kz, kb].find(k => k && k.quelle);
    const fehlt = [w, b].map(x => x === 'SATS' ? 'BTC' : x).map(x => A.kurse && A.kurse[x] && A.kurse[x].fehler).find(Boolean);
    kursHinweis = h('div', { class: 'hint', style: { margin: '6px 0 0' } }, kz && kb && q
      ? `Anzeige in ${A.NAMEN[w]}: 1 ${b} = ${A.einheiten(kb.eurPro / kz.eurPro, w)} (${q.quelle}, Stand ${fmt.date(q.datum)}${q.live ? ' aktuell' : ''}). Nur Anzeige – Rechnungen und Buchungen bleiben in ${A.NAMEN[b]}.`
      : `Kein ${A.NAMEN[w]}-Kurs verfügbar${fehlt ? ` (${fehlt})` : ''} – die Beträge werden in ${A.NAMEN[b]} angezeigt.`);
  }
  const t = title('Übersicht', `${App.session.firma || ''} · ${fmt.date(d.heute)}`);
  t.append(A.leiste(neu));
  main.append(t,
    h('div', { class: 'view-scroll' },
      (!d.zaehler.kunden && !d.zaehler.rechnungen) ? h('div', { class: 'panel', style: { marginBottom: '8px' } },
        h('h3', null, 'Willkommen bei Kuenta'),
        h('div', { class: 'pb' },
          h('p', { style: { margin: '0 0 8px' } }, 'Der Datenbestand ist noch leer. Tragen Sie zuerst Ihre Firmendaten ein oder übernehmen Sie vorhandene Daten:'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
            h('button', { class: 'btn primary', onclick: () => App.go('einstellungen') }, '🏢 Firmendaten eintragen'),
            h('button', { class: 'btn', onclick: () => App.go('import') }, '📥 Aus KFZ-Faktura importieren'),
            h('button', { class: 'btn', onclick: () => App.go('sicherung') }, '💾 Sicherung wiederherstellen (*.kuenta)'),
            h('button', { class: 'btn', onclick: () => App.go('datenimport') }, '🔌 CSV / DATANORM importieren')))) : null,
      h('div', { class: 'cards' },
        card('Umsatz aktueller Monat (netto)', A.betrag(d.umsatzMonat.n), `${d.umsatzMonat.c} Rechnungen`, () => App.go('umsatz')),
        card('Umsatz aktuelles Jahr (netto)', A.betrag(d.umsatzJahr.n), `${d.umsatzJahr.c} Rechnungen`, () => App.go('umsatz')),
        card('Offene Posten', A.betrag(d.offen.summe), `${d.offen.anzahl} Rechnungen · überfällig ${A.betrag(d.offen.ueberfaellig)}`, () => App.go('op')),
        card('HU fällig (nächste 31 Tage)', d.huFaellig, 'Fahrzeuge', () => App.go('termine')),
        card('Reifen eingelagert', d.reifenEingelagert, 'Einlagerungen', () => App.go('reifen')),
        card('Datenbestand', d.zaehler.kunden.toLocaleString(LOCALE) + ' Kunden', `${d.zaehler.fahrzeuge.toLocaleString(LOCALE)} Fahrzeuge · ${d.zaehler.rechnungen.toLocaleString(LOCALE)} Rechnungen`)),
      kursHinweis,
      h('div', { class: 'panels', style: { marginTop: '8px' } },
        h('div', { class: 'panel' }, h('h3', null, 'Letzte Rechnungen', h('button', { class: 'btn sm', onclick: () => Vorgang.open('rechnung', null).then(() => App.go('start')) }, '➕ Neue Rechnung')),
          h('div', { class: 'pb' }, simpleTable([{ f: 'RECHNUNGNUMMER', l: 'Nr.' }, { f: 'DATUM', l: 'Datum', t: 'date' }, { f: 'KUNDE', l: 'Kunde' },
            { f: 'GBRUTTO', l: 'Brutto', t: 'money', render: r => A.betrag(r.GBRUTTO) }, { f: 'OFFEN', l: 'Offen', t: 'money', render: r => A.betrag(r.OFFEN) }], d.letzte, { onClick: r => Vorgang.open(r.TYP === 2 ? 'korrektur' : 'rechnung', r.RECHNUNGID) }))),
        h('div', { class: 'panel' }, h('h3', null, 'Termine heute', h('button', { class: 'btn sm', onclick: () => App.go('kalender') }, 'Terminplaner')),
          h('div', { class: 'pb' }, d.termineHeute.length ? simpleTable([{ f: 'BEGINN', l: 'Zeit', render: r => r.GANZTAGS ? 'ganztags' : String(r.BEGINN).slice(11, 16) }, { f: 'TITEL', l: 'Termin' }, { f: 'RESSOURCE', l: 'Ressource' }], d.termineHeute, { onClick: () => App.go('kalender') }) : h('div', { class: 'hint' }, 'Keine Termine.'))),
        h('div', { class: 'panel' }, h('h3', null, 'Offene Aufgaben', h('button', { class: 'btn sm', onclick: () => editRecord('aufgaben', null).then(() => App.go('start')) }, '➕ Aufgabe')),
          h('div', { class: 'pb' }, d.aufgaben.length ? simpleTable([{ f: 'FAELLIG', l: 'Fällig', t: 'date' }, { f: 'TITEL', l: 'Aufgabe' }], d.aufgaben, { onClick: r => editRecord('aufgaben', r.ID).then(() => App.go('start')) }) : h('div', { class: 'hint' }, 'Keine offenen Aufgaben.'))),
        h('div', { class: 'panel' }, h('h3', null, 'Schnellstart'), h('div', { class: 'pb', style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
          h('button', { class: 'btn', onclick: () => editRecord('kunden', null) }, '👤 Neuer Kunde'),
          h('button', { class: 'btn', onclick: () => editRecord('fahrzeuge', null) }, '🚗 Neues Fahrzeug'),
          h('button', { class: 'btn', onclick: () => Vorgang.open('auftrag', null) }, '🛠️ Neuer Auftrag'),
          h('button', { class: 'btn', onclick: () => App.go('op') }, '💶 Offene Posten'),
          h('button', { class: 'btn', onclick: () => App.go('sicherung') }, '💾 Datensicherung'),
          h('button', { class: 'btn', onclick: () => App.go('import') }, '📥 KFZ-Faktura-Daten importieren'))))));
};

// ---------------- Generic module overview ----------------
Views.entity = (entName) => async (main) => {
  const e = ENT.E[entName];
  const isV = !!e.vorgang;
  let ov;
  const open = r => isV ? Vorgang.open(e.vorgang, r[e.pk]).then(() => ov.reload())
    : e.custom === 'eingang' ? Eingang.open(r[e.pk]).then(() => ov.reload())
    : entName === 'lager' ? editRecord('artikel', r[e.pk]).then(() => ov.reload())
    : editRecord(entName, r[e.pk]).then(() => ov.reload());
  const neu = () => isV ? Vorgang.open(e.vorgang, null).then(() => ov.reload())
    : e.custom === 'eingang' ? Eingang.open(null).then(() => ov.reload())
    : entName === 'lager' ? editRecord('artikel', null, { LAGERFUEHRUNG: 1 }).then(() => ov.reload())
    : editRecord(entName, null).then(() => ov.reload());
  const del = async () => {
    const rows = ov.selected(); if (!rows.length) return;
    if (isV) { const items = Vorgang.menu(e.vorgang, rows[0], () => ov.reload()); return items[items.length - 1].onClick(); }
    if (e.custom === 'eingang') { if (await confirmDlg('Eingangsrechnung löschen?', { danger: true, ok: 'Löschen' })) { try { await api('/api/eingang/' + rows[0].ID, { method: 'DELETE' }); ov.reload(); } catch (err) { showError(err); } } return; }
    if (!(await confirmDlg(rows.length > 1 ? `${rows.length} Einträge löschen?` : `${e.one} wirklich löschen?`, { danger: true, ok: 'Löschen' }))) return;
    for (const r of rows) { try { await api(`/api/rec/${entName}/${r[e.pk]}`, { method: 'DELETE' }); } catch (err) { showError(err); } }
    ov.reload();
  };
  const buttons = e.readonly ? [] : [
    { label: 'Neu', icon: '➕', onClick: neu },
    { label: 'Bearbeiten', icon: '✏️', onClick: () => { const c = ov.current(); if (c) open(c); } },
    { label: 'Löschen', icon: '🗑', cls: 'danger', onClick: del }];
  if (entName === 'zahlungen') buttons.push({ label: 'Zahlung erfassen', icon: '💶', onClick: async () => { const r = await pickRechnungOffen(); if (r) { await Zahlung.erfassen(r.RECHNUNGID); ov.reload(); } } },
    { label: 'Zahlung löschen', icon: '🗑', onClick: async () => { const c = ov.current(); if (c && await confirmDlg(`Zahlung über ${fmt.money(c.BETRAG)} zu Rechnung ${c.RENR} löschen?`, { danger: true, ok: 'Löschen' })) { try { await api('/api/zahlung/' + c.ID, { method: 'DELETE' }); ov.reload(); } catch (err) { showError(err); } } } });
  if (entName === 'eingang') buttons.splice(0, 0, { label: 'E-Rechnung einlesen', icon: '🧾', title: 'XRechnung (XML) oder ZUGFeRD-PDF des Lieferanten übernehmen', onClick: () => Eingang.importieren().then(() => ov.reload()) });
  if (entName === 'fahrzeuglager') {
    buttons.splice(0, 1, { label: 'NW – Neu', icon: '➕', onClick: () => editRecord('fahrzeuglager', null, { FRZTYP: 1, MWSTAUSWEISBAR: 1, EINKAUF: today() }).then(() => ov.reload()) },
      { label: 'GW – Neu', icon: '➕', onClick: () => editRecord('fahrzeuglager', null, { FRZTYP: 2, MWSTAUSWEISBAR: 0, EINKAUF: today() }).then(() => ov.reload()) });
  }
  if (entName === 'kaufvertraege') buttons.splice(0, 1,
    { label: 'GW-Verkauf Neu', icon: '➕', onClick: async () => editRecord('kaufvertraege', null, await api('/api/kaufvertrag/neu?art=GW')).then(() => ov.reload()) },
    { label: 'NW-Verkauf Neu', icon: '➕', onClick: async () => editRecord('kaufvertraege', null, await api('/api/kaufvertrag/neu?art=NW')).then(() => ov.reload()) });
  let moreMenu = null;
  if (isV) moreMenu = o => { const c = o.current(); return c ? Vorgang.menu(e.vorgang, c, () => o.reload(), o) : []; };
  else if (entName === 'eingang') moreMenu = o => { const c = o.current(); return c ? [
    { label: 'Bearbeiten', icon: '✏️', onClick: () => open(c) },
    { label: 'E-Rechnung einlesen', icon: '🧾', onClick: () => Eingang.importieren().then(() => o.reload()) },
    '-', { label: 'Tabelle als CSV exportieren', icon: '⬇', onClick: () => o.exportCsv() }, { label: 'Liste drucken', icon: '🖨', onClick: () => Print.liste('Eingangsrechnungen', '', o.columns().filter(x => !x.hidden), o.rows, o.sums, { quer: true }) }] : []; };
  else if (entName === 'fahrzeuglager') moreMenu = o => { const c = o.current(); return c ? [
    { label: 'Bearbeiten', icon: '✏️', onClick: () => open(c) },
    { label: 'Verkaufen (Rechnung erstellen)', icon: '💶', onClick: async () => { const f = await api('/api/rec/fahrzeuglager/' + c.FAHR_ID); await fahrzeugVerkaufen(f); o.reload(); } },
    { label: 'Kaufvertrag erstellen', icon: '🤝', onClick: async () => { await editRecord('kaufvertraege', null, await api('/api/kaufvertrag/neu?' + qs({ art: c.TYPTEXT === 'NW' ? 'NW' : 'GW', fahrid: c.FAHR_ID }))); } },
    { label: 'Preisschild drucken', icon: '🏷', onClick: async () => Print.preisschild(await api('/api/rec/fahrzeuglager/' + c.FAHR_ID)) },
    { label: 'In Kundenfahrzeug umbuchen…', icon: '🔁', onClick: async () => { const k = await pickKunde(); if (k) { await api(`/api/handel/${c.FAHR_ID}/umbuchen`, { method: 'POST', body: { ziel: 'kunde', kunid: k.KUNID } }); toast('Umgebucht', 'ok'); o.reload(); } } },
    '-', { label: 'Bestandsliste drucken', icon: '🖨', onClick: () => Print.liste('Fahrzeug-Bestandsliste', `Stand ${fmt.date(today())}`, o.columns().filter(x => !x.hidden), o.rows, o.sums, { quer: true }) },
    { label: 'Tabelle als CSV exportieren', icon: '⬇', onClick: () => o.exportCsv() }] : []; };
  else if (entName === 'kaufvertraege') moreMenu = o => { const c = o.current(); return c ? [
    { label: 'Bearbeiten', icon: '✏️', onClick: () => open(c) },
    { label: 'Kaufvertrag drucken', icon: '🖨', onClick: async () => Print.kaufvertrag(await api('/api/rec/kaufvertraege/' + c.ID)) },
    { label: 'Rechnung erstellen', icon: '💶', onClick: async () => { try { const r = await api(`/api/kaufvertrag/${c.ID}/rechnung`, { method: 'POST' }); toast(`Rechnung ${r.nr} erstellt`, 'ok'); o.reload(); Vorgang.open('rechnung', r.id); } catch (err) { showError(err); } } }] : []; };
  else if (entName === 'lager') moreMenu = o => [
    { label: 'Lagerbewegung buchen', icon: '📦', onClick: () => App.go('lagerbewegung') },
    { label: 'Bestandsbewertung drucken', icon: '🖨', onClick: () => Print.liste('Bestandsbewertung', `Stand ${fmt.date(today())}`, o.columns().filter(x => !x.hidden), o.rows, null, { quer: true }) },
    { label: 'Tabelle als CSV exportieren', icon: '⬇', onClick: () => o.exportCsv() }];
  else if (entName === 'kunden') moreMenu = o => { const c = o.current(); return c ? [
    { label: 'Bearbeiten', icon: '✏️', onClick: () => open(c) },
    { label: 'Neues Angebot', icon: '📝', onClick: () => Vorgang.open('angebot', null, { kunid: c.KUNID }) },
    { label: 'Neuer Auftrag', icon: '🛠️', onClick: () => Vorgang.open('auftrag', null, { kunid: c.KUNID }) },
    { label: 'Neue Rechnung', icon: '💶', onClick: () => Vorgang.open('rechnung', null, { kunid: c.KUNID }) },
    { label: 'Brief schreiben', icon: '✉️', onClick: () => editRecord('briefe', null, { KUNID: c.KUNID, DATUM: today() }) },
    '-', { label: 'Tabelle als CSV exportieren', icon: '⬇', onClick: () => o.exportCsv() }] : []; };
  else if (entName === 'fahrzeuge') moreMenu = o => { const c = o.current(); return c ? [
    { label: 'Bearbeiten', icon: '✏️', onClick: () => open(c) },
    { label: 'Neuer Auftrag', icon: '🛠️', onClick: async () => { const hl = await api(`/api/fahrzeuge/${c.FAHR_ID}/halter`); Vorgang.open('auftrag', null, { fahrid: c.FAHR_ID, kunid: hl[0] && hl[0].KUNID }); } },
    { label: 'Neue Rechnung', icon: '💶', onClick: async () => { const hl = await api(`/api/fahrzeuge/${c.FAHR_ID}/halter`); Vorgang.open('rechnung', null, { fahrid: c.FAHR_ID, kunid: hl[0] && hl[0].KUNID }); } },
    { label: 'Ins Fahrzeuglager umbuchen (GW)', icon: '🔁', onClick: async () => { if (await confirmDlg(`${c.KENNZEICHEN || 'Fahrzeug'} als Gebrauchtwagen ins Fahrzeuglager umbuchen?`)) { await api(`/api/handel/${c.FAHR_ID}/umbuchen`, { method: 'POST', body: { ziel: 'lager', frztyp: 2 } }); toast('Ins Fahrzeuglager umgebucht', 'ok'); o.reload(); } } },
    { label: 'Reifen einlagern', icon: '⭕', onClick: async () => { const hl = await api(`/api/fahrzeuge/${c.FAHR_ID}/halter`); editRecord('reifen', null, { FAHRZEUGID: c.FAHR_ID, KUNID: hl[0] && hl[0].KUNID }); } },
    '-', { label: 'Tabelle als CSV exportieren', icon: '⬇', onClick: () => o.exportCsv() }] : []; };
  else if (entName === 'reifen') moreMenu = o => { const c = o.current(); return c ? [
    { label: 'Bearbeiten', icon: '✏️', onClick: () => open(c) },
    { label: 'Einlagerungsbeleg drucken', icon: '🖨', onClick: async () => Print.reifen(await api('/api/rec/reifen/' + c.EINLAGERUNGID)) },
    { label: c.STATUSTEXT === 'eingelagert' ? 'Auslagern (heute)' : 'Wieder einlagern', icon: '↕', onClick: async () => {
      const r = await api('/api/rec/reifen/' + c.EINLAGERUNGID);
      const aus = c.STATUSTEXT === 'eingelagert';
      await api('/api/rec/reifen/' + c.EINLAGERUNGID, { method: 'PUT', body: { ...r, STATUS: aus ? 1 : 0, AUSDATUM: aus ? today() : null } }); o.reload();
    } },
    { label: 'Neue Einlagerung (Kopie, heute)', icon: '⧉', onClick: async () => { const r = await api('/api/rec/reifen/' + c.EINLAGERUNGID); delete r.EINLAGERUNGID; r.EINLNUMMER = null; r.EINDATUM = today(); r.AUSDATUM = null; r.STATUS = 0; await editRecord('reifen', null, r); o.reload(); } },
    '-', { label: 'Liste drucken', icon: '🖨', onClick: () => Print.liste('Reifeneinlagerung', 'aktueller Filter', o.columns().filter(x => !x.hidden), o.rows, null, { quer: true }) }] : []; };
  else if (entName === 'artikel') moreMenu = o => [
    { label: 'Inventurliste drucken', icon: '🖨', onClick: async () => { const r = await api('/api/list/artikel?limit=5000&filters=' + encodeURIComponent('{"lager":"lager"}')); Print.liste('Inventurliste', 'Artikel mit Lagerführung', [{ f: 'ARTNUMMER', l: 'Artikel-Nr.' }, { f: 'BEZEICHNUNG1', l: 'Bezeichnung' }, { f: 'LAGERORT', l: 'Lagerort' }, { f: 'LAGER', l: 'Soll-Bestand', t: 'num' }, { f: 'IST', l: 'Ist-Bestand' }], r.rows); } },
    { label: 'Bestandsbewertung drucken', icon: '🖨', onClick: async () => { const r = await api('/api/list/artikel?limit=5000&filters=' + encodeURIComponent('{"lager":"lager"}')); const rows = r.rows.map(x => ({ ...x, WERT: r2((x.LAGER || 0) * (x.EKPNETTO || 0)) })); Print.liste('Bestandsbewertung', 'Bewertung zum Einkaufspreis', [{ f: 'ARTNUMMER', l: 'Artikel-Nr.' }, { f: 'BEZEICHNUNG1', l: 'Bezeichnung' }, { f: 'LAGER', l: 'Bestand', t: 'num' }, { f: 'EKPNETTO', l: 'EK netto', t: 'money' }, { f: 'WERT', l: 'Wert', t: 'money' }], rows, { WERT: r2(rows.reduce((s, x) => s + x.WERT, 0)) }); } },
    '-', { label: 'Tabelle als CSV exportieren', icon: '⬇', onClick: () => o.exportCsv() }];
  else moreMenu = o => [{ label: 'Tabelle als CSV exportieren', icon: '⬇', onClick: () => o.exportCsv() }, { label: 'Liste drucken', icon: '🖨', onClick: () => Print.liste(e.title, '', o.columns().filter(x => !x.hidden), o.rows) }];
  ov = new Overview(entName, { onOpen: e.readonly ? (r => entName === 'zahlungen' && Vorgang.open('rechnung', null)) : open, buttons, moreMenu, onDelete: del,
    cell: isV ? (c, r) => {
      if (c.f === 'ZAHLSTATUSTEXT') return h('td', null, h('span', { class: 'badge ' + (r.ZAHLSTATUSTEXT === 'bezahlt' ? 'ok' : r.ZAHLSTATUSTEXT === 'offen' ? 'err' : 'warn') }, r.ZAHLSTATUSTEXT));
      if (c.f === 'STATUS' && r.STATUS) return h('td', null, h('span', { class: 'badge ok' }, r.STATUS));
      return null;
    } : null });
  if (entName === 'zahlungen') ov.opts.onOpen = async r => { const z = await api('/api/rec/zahlungen/' + r.ID); Vorgang.open('rechnung', z.RECHNUNGID).then(() => ov.reload()); };
  App.current = ov;
  main.append(title(e.title), ov.el);
};

async function pickRechnungOffen() {
  const op = await api('/api/finanzen/op');
  return new Promise(resolve => {
    const g = miniGrid([{ f: 'RECHNUNGNUMMER', l: 'Rechnung', w: 90 }, { f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'KUNDE', l: 'Kunde', w: 240 }, { f: 'GBRUTTO', l: 'Betrag', w: 100, t: 'money' }, { f: 'OFFEN', l: 'Offen', w: 100, t: 'money' }], op.rows, { onOpen: r => w.close(r), height: 420 });
    const w = Win.open({ title: 'Offene Rechnung auswählen', width: 720, content: g.el, onClose: r => resolve(r || null) });
    w.setButtons(['|', { label: 'OK', cls: 'primary', onClick: () => w.close(g.current()) }, { label: 'Abbrechen', onClick: () => w.close() }]); w.el.append(w.foot);
  });
}

// ---------------- Open items ----------------
Views.op = async (main) => {
  const wrap = h('div', { class: 'overview' });
  const nurUe = h('input', { type: 'checkbox' });
  let g, data;
  const cols = [{ f: 'RECHNUNGNUMMER', l: 'Rechnung', w: 90 }, { f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'KUNNUMMER', l: 'Kd.-Nr.', w: 70 }, { f: 'KUNDE', l: 'Kunde', w: 230 }, { f: 'FAHRKENNZEICHEN', l: 'Kennzeichen', w: 110 }, { f: 'GBRUTTO', l: 'Betrag', w: 100, t: 'money' }, { f: 'OFFEN', l: 'Offen', w: 100, t: 'money' }, { f: 'FAELLIG', l: 'Fällig', w: 90, t: 'date' },
    { f: 'TAGE', l: 'Tage überfällig', w: 105, render: r => h('td', { class: 'num' }, r.TAGE > 0 ? h('span', { class: 'badge ' + (r.TAGE > 30 ? 'err' : 'warn') }, r.TAGE) : '') }, { f: 'MAHNSTUFE', l: 'Mahnstufe', w: 80 }];
  const load = async () => {
    data = await api('/api/finanzen/op?' + qs({ nurUeberfaellig: nurUe.checked ? 1 : '' }));
    const ng = miniGrid(cols, data.rows, { onOpen: r => Vorgang.open(r.TYP === 2 ? 'korrektur' : 'rechnung', r.RECHNUNGID).then(load), footer: { GBRUTTO: data.rows.reduce((s, r) => s + r.GBRUTTO, 0), OFFEN: data.sum } });
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el);
    g = ng; info.textContent = T(`${data.rows.length} offene Posten · Summe ${fmt.money(data.sum)} · davon überfällig ${fmt.money(data.ueberfaellig)}`);
  };
  nurUe.addEventListener('change', load);
  const info = h('span', { class: 'info' });
  main.append(title('Offene Posten'), h('div', { class: 'searchbar' }, h('label', null, nurUe, 'nur überfällige anzeigen')), wrap,
    h('div', { class: 'grid-footer' }, info, h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => Print.liste('Offene Posten', `Stand ${fmt.date(today())}`, cols.filter(c => !c.render).concat([{ f: 'TAGE', l: 'Tage' }]), data.rows, { GBRUTTO: data.rows.reduce((s, r) => s + r.GBRUTTO, 0), OFFEN: data.sum }, { quer: true }) }, '🖨 Drucken'),
      h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c) { await Mahnung.erstellen([c]); load(); } } }, '✉️ Mahnung erstellen'),
      h('button', { class: 'btn primary', onclick: async () => { const c = g.current(); if (c) { await Zahlung.erfassen(c.RECHNUNGID); load(); } } }, '💶 Zahlung erfassen')));
  await load();
};

// ---------------- Dunning ----------------
const Mahnung = {
  async erstellen(rows) {
    const st = (await api('/api/finanzen/mahnvorschlag')).stufen;
    const results = [];
    for (const r of rows) {
      const stufe = Math.min((r.MAHNSTUFE || 0) + 1, 4);
      results.push(await api('/api/finanzen/mahnung', { method: 'POST', body: { RECHNUNGID: r.RECHNUNGID, MAHNSTUFE: r.NAECHSTESTUFE || stufe, MAHNGEBUEHREN: (st[(r.NAECHSTESTUFE || stufe) - 1] || {}).gebuehr } }));
    }
    toast(`${results.length} Mahnung(en) erstellt`, 'ok');
    await Print.mahnung(results);
  },
};
Views.mahnungen = async (main) => {
  const tabs = h('div', { class: 'tabs' });
  const pane = h('div', { class: 'overview', style: { paddingTop: '6px' } });
  const show = async which => {
    $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.k === which));
    pane.innerHTML = '';
    if (which === 'vorschlag') {
      const d = await api('/api/finanzen/mahnvorschlag');
      const checked = new Set(d.rows.map(r => r.RECHNUNGID));
      const cols = [{ f: 'x', l: '', w: 30, render: r => { const c = h('input', { type: 'checkbox', checked: true, onchange: () => c.checked ? checked.add(r.RECHNUNGID) : checked.delete(r.RECHNUNGID) }); return h('td', null, c); } },
        { f: 'RECHNUNGNUMMER', l: 'Rechnung', w: 90 }, { f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'KUNDE', l: 'Kunde', w: 230 }, { f: 'OFFEN', l: 'Offen', w: 100, t: 'money' }, { f: 'TAGE', l: 'Tage überfällig', w: 105 }, { f: 'MAHNSTUFE', l: 'bisher', w: 70 }, { f: 'NAECHSTESTUFE', l: 'neue Stufe', w: 80 }, { f: 'GEBUEHR', l: 'Gebühr', w: 80, t: 'money' }];
      const g = miniGrid(cols, d.rows, { onOpen: r => Vorgang.open('rechnung', r.RECHNUNGID), empty: 'Aktuell sind keine Rechnungen zu mahnen.' });
      pane.append(h('div', { class: 'hint' }, `Mahnfristen: ${d.stufen.map(s => `Stufe ${s.stufe}: ${s.tage} Tage (${fmt.money(s.gebuehr)})`).join(' · ')} — änderbar unter Einstellungen → Steuer/Mahnung.`), g.el,
        h('div', { class: 'grid-footer' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => { const sel = d.rows.filter(r => checked.has(r.RECHNUNGID)); if (!sel.length) return; await Mahnung.erstellen(sel); show('vorschlag'); } }, '✉️ Markierte Mahnungen erstellen & drucken')));
    } else {
      const rows = await api('/api/finanzen/mahnungen');
      const g = miniGrid([{ f: 'MAHNDATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'MAHNSTUFE', l: 'Stufe', w: 60 }, { f: 'BETREFFTXT', l: 'Betreff', w: 180 }, { f: 'RECHNUNGNUMMER', l: 'Rechnung', w: 90 }, { f: 'KUNDE', l: 'Kunde', w: 230 }, { f: 'OFFEN', l: 'noch offen', w: 100, t: 'money' }, { f: 'MAHNGEBUEHREN', l: 'Gebühr', w: 80, t: 'money' }], rows, { onOpen: r => Print.mahnungById(r.MAHNID) });
      pane.append(g.el, h('div', { class: 'grid-footer' }, h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => { const c = g.current(); if (c) Print.mahnungById(c.MAHNID); } }, '🖨 Erneut drucken'),
        h('button', { class: 'btn', onclick: () => { const c = g.current(); if (c) downloadUrl('/api/pdf/mahnung/' + c.MAHNID, 'Mahnung.pdf'); } }, '📄 PDF'),
        h('button', { class: 'btn', onclick: () => { const c = g.current(); if (c) Mail.dialog('mahnung', '-', c.MAHNID); } }, '✉️ Per E-Mail'),
        h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c && await confirmDlg('Mahnung löschen?', { danger: true, ok: 'Löschen' })) { await api('/api/finanzen/mahnung/' + c.MAHNID, { method: 'DELETE' }); show('liste'); } } }, '🗑 Löschen')));
    }
  };
  tabs.append(h('button', { 'data-k': 'vorschlag', onclick: () => show('vorschlag') }, 'Mahnvorschlag'), h('button', { 'data-k': 'liste', onclick: () => show('liste') }, 'Erstellte Mahnungen'));
  main.append(title('Mahnungen'), tabs, pane);
  show('vorschlag');
};

// ---------------- Cash book ----------------
Views.kassenbuch = async (main) => {
  let von = today().slice(0, 7) + '-01', bis = today();
  const wrap = h('div', { class: 'overview' });
  const info = h('span', { class: 'info' });
  let data, g;
  const load = async () => {
    data = await api('/api/finanzen/kassenbuch?' + qs({ von, bis }));
    const cols = [{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'BELEGNUMMER', l: 'Beleg-Nr.', w: 100 }, { f: 'EMPFAENGER', l: 'Empfänger / Einzahler', w: 220 }, { f: 'VERWENDUNG', l: 'Verwendungszweck', w: 300 }, { f: 'EINNAHMEN', l: 'Einnahmen', w: 100, t: 'money' }, { f: 'AUSGABEN', l: 'Ausgaben', w: 100, t: 'money' }, { f: 'SALDO', l: 'Bestand', w: 110, t: 'money' }];
    const ng = miniGrid(cols, data.rows, { onOpen: r => editRecord('kassenbuch', r.KASSENID).then(load), footer: { EINNAHMEN: data.einnahmen, AUSGABEN: data.ausgaben, SALDO: data.endbestand } });
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el);
    g = ng; info.textContent = T(`Anfangsbestand ${fmt.money(data.anfangsbestand)} · Einnahmen ${fmt.money(data.einnahmen)} · Ausgaben ${fmt.money(data.ausgaben)} · Endbestand ${fmt.money(data.endbestand)}`);
  };
  main.append(title('Kassenbuch'), h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; load(); })), wrap,
    h('div', { class: 'grid-footer' }, info, h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => Print.liste('Kassenbuch', `${fmt.date(von)} – ${fmt.date(bis)} · Anfangsbestand ${fmt.money(data.anfangsbestand)}`, [{ f: 'DATUM', l: 'Datum', t: 'date' }, { f: 'BELEGNUMMER', l: 'Beleg' }, { f: 'EMPFAENGER', l: 'Empfänger' }, { f: 'VERWENDUNG', l: 'Verwendungszweck' }, { f: 'EINNAHMEN', l: 'Einnahmen', t: 'money' }, { f: 'AUSGABEN', l: 'Ausgaben', t: 'money' }, { f: 'SALDO', l: 'Bestand', t: 'money' }], data.rows, { EINNAHMEN: data.einnahmen, AUSGABEN: data.ausgaben, SALDO: data.endbestand }, { quer: true }) }, '🖨 Drucken'),
      h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c) { await editRecord('kassenbuch', c.KASSENID); load(); } } }, '✏️ Bearbeiten'),
      h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c && await confirmDlg('Kassenbucheintrag löschen?', { danger: true, ok: 'Löschen' })) { try { await api('/api/rec/kassenbuch/' + c.KASSENID, { method: 'DELETE' }); load(); } catch (e) { showError(e); } } } }, '🗑 Löschen'),
      h('button', { class: 'btn', onclick: async () => { await editRecord('kassenbuch', null, { ART: 2, DATUM: today() }); load(); } }, '➖ Ausgabe'),
      h('button', { class: 'btn primary', onclick: async () => { await editRecord('kassenbuch', null, { ART: 1, DATUM: today() }); load(); } }, '➕ Einnahme')));
  await load();
};

// ---------------- Invoice list ----------------
Views.rechnungsliste = async (main) => {
  let von = today().slice(0, 7) + '-01', bis = today();
  const wrap = h('div', { class: 'overview' }); let g, data;
  const cols = [{ f: 'RECHNUNGNUMMER', l: 'Nr.', w: 90 }, { f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'KUNNUMMER', l: 'Kd.-Nr.', w: 70 }, { f: 'KUNDE', l: 'Kunde', w: 220 }, { f: 'GNETTO', l: 'Netto', w: 95, t: 'money' }, { f: 'GMWST1', l: 'MwSt voll', w: 90, t: 'money' }, { f: 'GMWST2', l: 'MwSt erm.', w: 90, t: 'money' }, { f: 'GBRUTTO', l: 'Brutto', w: 95, t: 'money' }, { f: 'OFFEN', l: 'Offen', w: 90, t: 'money' }];
  const load = async () => {
    data = await api('/api/finanzen/rechnungsliste?' + qs({ von, bis }));
    const ng = miniGrid(cols, data.rows, { onOpen: r => Vorgang.open(r.TYP === 2 ? 'korrektur' : 'rechnung', r.RECHNUNGID), footer: data.summe });
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el); g = ng;
  };
  main.append(title('Rechnungsliste', 'Ausgangsrechnungen'), h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; load(); })), wrap,
    h('div', { class: 'grid-footer' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => { const lines = [cols.map(c => c.l).join(';'), ...data.rows.map(r => cols.map(c => c.t === 'money' ? String(r[c.f] ?? '').replace('.', ',') : c.t === 'date' ? fmt.date(r[c.f]) : String(r[c.f] ?? '').replace(/;/g, ',')).join(';'))]; saveBlob(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }), `Rechnungsliste_${von}_${bis}.csv`); } }, '⬇ CSV'),
      h('button', { class: 'btn primary', onclick: () => Print.liste('Ausgangsrechnungsliste', `${fmt.date(von)} – ${fmt.date(bis)}`, cols, data.rows, data.summe, { quer: true }) }, '🖨 Drucken')));
  await load();
};

// ---------------- Accounting export (FIBU) ----------------
Views.fibu = async (main) => {
  if (EsUI.activo()) return Views.librosEs(main); // Spain: VAT books instead of DATEV
  if (GbUI.activo()) return Views.ukVat(main); // UK: Xero/QuickBooks/Sage exports and MTD VAT return
  if (UsUI.activo()) return Views.usExport(main); // US: QuickBooks Online
  if (FrUI.activo()) return Views.frCompta(main); // France: FEC, cash register journal, Chorus Pro
  if (AtUI.activo()) return Views.atSteuer(main); // Austria: UVA (FinanzOnline) and RKSV
  if (ChUI.activo()) return Views.chMwst(main); // Switzerland: MWST return
  if (ItUI.activo()) return Views.itIva(main); // Italy: IVA settlement and sales VAT register
  if (NlUI.activo()) return Views.nlAangifte(main); // Netherlands: VAT return by rubrieken
  let von = addMonths(today().slice(0, 7) + '-01', -1), bis = addDays(today().slice(0, 7) + '-01', -1);
  const alle = h('input', { type: 'checkbox' });
  const wrap = h('div', { class: 'overview' }); let g, rows = [];
  const load = async () => {
    rows = await api('/api/finanzen/fibu?' + qs({ von, bis, alle: alle.checked ? 1 : '' }));
    const ng = miniGrid([{ f: 'BELEGDATUM', l: 'Belegdatum', w: 90, t: 'date' }, { f: 'BELEGNUMMER', l: 'Beleg', w: 90 }, { f: 'SOLL', l: 'Soll', w: 70 }, { f: 'HABEN', l: 'Haben', w: 70 }, { f: 'BETRAG', l: 'Betrag', w: 100, t: 'money' }, { f: 'STEUERSCHLUESSEL', l: 'USt %', w: 60 }, { f: 'BUCHUNGSTEXT', l: 'Buchungstext', w: 300 }, { f: 'EXPORTIERT', l: 'exportiert', w: 75, t: 'bool' }], rows, { footer: { BETRAG: r2(rows.reduce((s, r) => s + r.BETRAG, 0)) } });
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el); g = ng;
  };
  alle.addEventListener('change', load);
  const exp = async (mark) => {
    if (!rows.length) { toast('Keine Buchungen im Zeitraum.'); return; }
    if (mark && !(await confirmDlg(`${rows.length} Buchungen als DATEV-Datei exportieren und als "exportiert" markieren?`))) return;
    try { await downloadUrl('/api/finanzen/datev?' + qs({ von, bis, alle: alle.checked ? 1 : '', markieren: mark ? 1 : '' }), 'EXTF_Buchungsstapel.csv'); }
    catch (e) { showError(e); return; }
    if (mark) load();
  };
  const expStamm = async () => {
    try { await downloadUrl('/api/finanzen/datev-stammdaten?' + qs({ von, bis }), 'EXTF_Debitoren_Kreditoren.csv'); } catch (e) { showError(e); }
  };
  main.append(title('FIBU-Export', 'Buchungssätze für den Steuerberater (DATEV-Format)'),
    h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; load(); }), h('label', null, alle, 'auch bereits exportierte')), wrap,
    h('div', { class: 'grid-footer' }, h('span', { class: 'hint' }, 'Berater-/Mandantennummer und Konten: Einstellungen → FIBU'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => downloadUrl('/api/finanzen/gobd?' + qs({ von, bis }), 'GoBD.zip') }, '🗂 GoBD-Datenexport (Betriebsprüfung)'),
      h('button', { class: 'btn', title: 'Namen und Anschriften der im Zeitraum bebuchten Kunden und Lieferanten', onclick: expStamm }, '👥 Debitoren/Kreditoren'),
      h('button', { class: 'btn', onclick: () => exp(false) }, '⬇ Vorschau-Export'),
      h('button', { class: 'btn primary', onclick: () => exp(true) }, '📤 DATEV-Export erstellen')));
  await load();
};

// ---------------- Vehicle due dates ----------------
Views.termine = async (main) => {
  let von = today().slice(0, 7) + '-01', bis = addDays(addMonths(today().slice(0, 7) + '-01', 1), -1), feld = 'HU';
  const fsel = h('select');
  const wrap = h('div', { class: 'overview' }); let g, data;
  const cols = [{ f: 'TERMIN', l: 'Termin', w: 90, t: 'date' }, { f: 'KENNZEICHEN', l: 'Kennzeichen', w: 110 }, { f: 'ERINNERT', l: 'zuletzt erinnert', w: 150, render: r => Number(r.KEINEERINNERUNG) === 1 ? '– möchte keine' : r.ERINNERT ? `${fmt.date(r.ERINNERT.slice(0, 10))} · ${({ email: 'E-Mail', sms: 'SMS', brief: 'Brief' })[r.ERINNERT.split(' · ')[1]] || ''}` : '' }, { f: 'MARKE', l: 'Marke', w: 130 }, { f: 'MODELL', l: 'Modell', w: 150 }, { f: 'NUMMER', l: 'Kd.-Nr.', w: 70 }, { f: 'NAME', l: 'Name', w: 160 }, { f: 'VORNAME', l: 'Vorname', w: 110 }, { f: 'ORT', l: 'Ort', w: 120 }, { f: 'TELEFON', l: 'Telefon', w: 120 }, { f: 'MOBIL', l: 'Mobil', w: 120 }, { f: 'EMAIL', l: 'E-Mail', w: 160 }];
  const load = async () => {
    data = await api('/api/auswertung/termine?' + qs({ feld, von, bis }));
    if (!fsel.options.length) { for (const [k, l] of Object.entries(data.felder)) fsel.append(h('option', { value: k, selected: k === feld }, l)); }
    const ng = miniGrid(cols, data.rows, { onOpen: r => editRecord('fahrzeuge', r.FAHR_ID) });
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el); g = ng;
    info.textContent = T(`${data.rows.length} Fahrzeuge mit fälliger ${data.bezeichnung}`);
  };
  fsel.addEventListener('change', () => { feld = fsel.value; load(); });
  const info = h('span', { class: 'info' });
  const brief = async () => {
    const empf = data.rows.filter(r => r.NAME && r.STRASSE);
    const betreff = `Erinnerung: ${data.bezeichnung} für Ihr Fahrzeug {Kennzeichen}`;
    const text = `{Briefanrede}\n\nfür Ihr Fahrzeug {Fahrzeug} mit dem Kennzeichen {Kennzeichen} steht am {Termin} die ${data.bezeichnung} an.\n\nGerne übernehmen wir das für Sie. Vereinbaren Sie einfach telefonisch einen Termin mit uns.\n\nMit freundlichen Grüßen`;
    Views.serienbriefDialog(empf, betreff, text, { onDruck: () => api('/api/erinnerung/brief', { method: 'POST', body: { feld, von, bis, fahrids: empf.map(r => r.FAHR_ID) } }).then(load).catch(() => {}) });
  };
  // Reminder by email or SMS to the vehicles in the list
  const erinnern = async (kanal) => {
    const name = kanal === 'email' ? 'E-Mail' : 'SMS';
    const hatAdresse = r => kanal === 'email' ? /\S+@\S+\.\S+/.test(r.EMAIL || '') : !!(r.MOBIL || r.TELEFON);
    const ueberspringen = h('input', { type: 'checkbox', checked: true });
    const kandidaten = () => data.rows.filter(r => r.KUNID && Number(r.KEINEERINNERUNG) !== 1 && hatAdresse(r) && !(ueberspringen.checked && r.ERINNERT));
    const zahl = h('b'); const upd = () => { zahl.textContent = String(kandidaten().length); }; ueberspringen.addEventListener('change', upd); upd();
    const content = h('div', { style: { display: 'grid', gap: '8px', lineHeight: 1.5 } },
      h('div', null, `Erinnerung „${data.bezeichnung}“ per ${name} an `, zahl, ` von ${data.rows.length} Fahrzeugen der Liste.`),
      h('label', { class: 'fld chk' }, ueberspringen, h('span', null, 'bereits erinnerte Fahrzeuge überspringen')),
      h('div', { class: 'hint' }, `Fahrzeuge ohne ${kanal === 'email' ? 'E-Mail-Adresse' : 'Mobilnummer'} und Kunden mit „Keine Erinnerungen“ werden übersprungen. Den Text stellen Sie unter Einstellungen → Erinnerungen & SMS ein.`));
    if (!(await dialog(`Per ${name} erinnern`, content, [{ label: 'Senden', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 560 }))) return;
    const ids = kandidaten().map(r => r.FAHR_ID);
    if (!ids.length) { toast('Keine passenden Fahrzeuge in der Liste.'); return; }
    toast(`${ids.length} Erinnerungen per ${name} werden gesendet …`);
    try {
      const r = await api('/api/erinnerung/senden', { method: 'POST', body: { feld, von, bis, fahrids: ids, kanal } });
      const z = [`${r.gesendet} Erinnerung${r.gesendet === 1 ? '' : 'en'} per ${name} ${kanal === 'email' && App.setting('mail.versand', 'smtp') === 'programm' ? 'an das Mailprogramm übergeben' : 'gesendet'}.`];
      if (r.uebersprungen.length) z.push('', `Übersprungen (${r.uebersprungen.length}):`, ...r.uebersprungen.map(u => `• ${u.kennzeichen || '?'}: ${u.grund}`));
      if (r.fehler.length) z.push('', `Fehler (${r.fehler.length}):`, ...r.fehler.map(u => `• ${u.kennzeichen || '?'}: ${u.fehler}`));
      if (r.abgebrochen) z.push('', 'Der Versand wurde abgebrochen, weil der Server bzw. das Gateway nicht erreichbar war.');
      await alertDlg(z.join('\n'), `Erinnerung per ${name}`);
    } catch (e) { showError(e); }
    load();
  };
  main.append(title('Fahrzeugtermine', 'HU, Inspektion, SP, UVV …'),
    h('div', { class: 'searchbar' }, h('label', null, 'Termin', fsel), ...dateRange(von, bis, (a, b) => { von = a; bis = b; load(); })), wrap,
    h('div', { class: 'grid-footer' }, info, h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => { const lines = [cols.map(c => c.l).join(';'), ...data.rows.map(r => cols.map(c => c.t === 'date' ? fmt.date(r[c.f]) : String(r[c.f] ?? '').replace(/;/g, ',')).join(';'))]; saveBlob(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }), 'Fahrzeugtermine.csv'); } }, '⬇ CSV (für Word-Serienbrief)'),
      h('button', { class: 'btn', onclick: () => Print.liste(`Fahrzeugtermine: ${data.bezeichnung}`, `${fmt.date(von)} – ${fmt.date(bis)}`, cols.filter(c => c.f !== 'ERINNERT').slice(0, 10), data.rows, null, { quer: true }) }, '🖨 Liste drucken'),
      h('button', { class: 'btn', onclick: brief }, '✉️ Erinnerungsschreiben'),
      h('button', { class: 'btn', onclick: () => erinnern('email') }, '📧 Per E-Mail erinnern'),
      App.pro('sms') ? h('button', { class: 'btn primary', onclick: () => erinnern('sms') }, '📱 Per SMS erinnern')
        : h('button', { class: 'btn', title: 'Funktion von Kuenta Pro', onclick: () => App.proHinweis('sms') }, '🔒 Per SMS erinnern (Pro)')));
  await load();
};

// ---------------- Revenue / gross profit ----------------
Views.umsatz = async (main) => {
  let jahr = new Date().getFullYear();
  const body = h('div', { class: 'view-scroll' });
  const jsel = h('select', { onchange: () => { jahr = Number(jsel.value); load(); } });
  const load = async () => {
    const d = await api('/api/auswertung/umsatz?jahr=' + jahr);
    if (!jsel.options.length) { const ys = d.jahre.map(x => x.j).filter(Boolean); if (!ys.includes(jahr)) ys.push(jahr); for (const y of ys.sort((a, b) => b - a)) jsel.append(h('option', { value: y, selected: y === jahr }, y)); }
    const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'].map(T);
    const m = Array.from({ length: 12 }, (_, i) => d.monat.find(x => x.m === i + 1) || { m: i + 1, netto: 0, brutto: 0, einsatz: 0, anzahl: 0 });
    const vj = Array.from({ length: 12 }, (_, i) => (d.monatVj.find(x => x.m === i + 1) || { netto: 0 }).netto);
    const max = Math.max(1, ...m.map(x => x.netto), ...vj);
    const W = 720, H = 220, bw = W / 12;
    const svg = `<svg viewBox="0 0 ${W} ${H + 24}" class="chart" role="img" aria-label="Umsatz je Monat">${m.map((x, i) => {
      const hh = x.netto / max * H, hv = vj[i] / max * H;
      return `<rect x="${i * bw + bw * 0.14}" y="${H - hv}" width="${bw * 0.3}" height="${hv}" fill="#9fb7d6"><title>${jahr - 1}: ${fmt.money(vj[i])}</title></rect>
        <rect x="${i * bw + bw * 0.46}" y="${H - hh}" width="${bw * 0.4}" height="${hh}" fill="#2f7fe0" rx="2"><title>${months[i]} ${jahr}: ${fmt.money(x.netto)}</title></rect>
        <text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle" font-size="11" fill="currentColor">${months[i]}</text>`;
    }).join('')}<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="#999"/></svg>`;
    const sum = k => r2(m.reduce((s, x) => s + (x[k] || 0), 0));
    body.innerHTML = '';
    body.append(
      h('div', { class: 'cards' },
        h('div', { class: 'card' }, h('div', { class: 'k' }, `Umsatz netto ${jahr}`), h('div', { class: 'v' }, fmt.money(sum('netto'))), h('div', { class: 's' }, `Vorjahr: ${fmt.money(vj.reduce((a, b) => a + b, 0))}`)),
        h('div', { class: 'card' }, h('div', { class: 'k' }, 'Wareneinsatz'), h('div', { class: 'v' }, fmt.money(sum('einsatz')))),
        h('div', { class: 'card' }, h('div', { class: 'k' }, 'Roherlös'), h('div', { class: 'v' }, fmt.money(r2(sum('netto') - sum('einsatz'))))),
        h('div', { class: 'card' }, h('div', { class: 'k' }, 'Rechnungen'), h('div', { class: 'v' }, sum('anzahl')), h('div', { class: 's' }, `Ø ${fmt.money(sum('anzahl') ? sum('netto') / sum('anzahl') : 0)} netto`))),
      h('div', { class: 'panels', style: { marginTop: '8px' } },
        h('div', { class: 'panel', style: { gridColumn: '1 / -1' } }, h('h3', null, `Umsatz je Monat (netto) – ${jahr} im Vergleich zu ${jahr - 1}`), h('div', { class: 'pb', html: svg })),
        h('div', { class: 'panel' }, h('h3', null, 'Monatsübersicht'), h('div', { class: 'pb' }, simpleTable([{ f: 'mn', l: 'Monat', render: r => months[r.m - 1] }, { f: 'anzahl', l: 'Anzahl', t: 'int' }, { f: 'netto', l: 'Netto', t: 'money' }, { f: 'einsatz', l: 'Einsatz', t: 'money' }, { f: 'roh', l: 'Roherlös', t: 'money', render: r => fmt.money0(r.netto - r.einsatz) }], m, { footer: { anzahl: sum('anzahl'), netto: sum('netto'), einsatz: sum('einsatz') } }))),
        h('div', { class: 'panel' }, h('h3', null, 'Umsatz je Positionstyp'), h('div', { class: 'pb' }, simpleTable([{ f: 'postyp', l: 'Typ' }, { f: 'netto', l: 'Netto', t: 'money' }, { f: 'einsatz', l: 'Einsatz', t: 'money' }], d.postyp))),
        h('div', { class: 'panel' }, h('h3', null, 'Umsatz je Auftragsart'), h('div', { class: 'pb' }, simpleTable([{ f: 'artname', l: 'Auftragsart' }, { f: 'anzahl', l: 'Anzahl', t: 'int' }, { f: 'netto', l: 'Netto', t: 'money' }], d.art))),
        h('div', { class: 'panel' }, h('h3', null, 'Top-Kunden'), h('div', { class: 'pb', style: { maxHeight: '360px' } }, simpleTable([{ f: 'KUNNUMMER', l: 'Kd.-Nr.' }, { f: 'KUNDE', l: 'Kunde' }, { f: 'anzahl', l: 'Rechn.', t: 'int' }, { f: 'netto', l: 'Netto', t: 'money' }], d.kunden))),
        h('div', { class: 'panel' }, h('h3', null, 'Jahresvergleich'), h('div', { class: 'pb' }, simpleTable([{ f: 'j', l: 'Jahr' }, { f: 'anzahl', l: 'Rechnungen', t: 'int' }, { f: 'netto', l: 'Umsatz netto', t: 'money' }], d.jahre.slice().reverse())))));
  };
  main.append(title('Umsatz / Roherlöse'), h('div', { class: 'searchbar' }, h('label', null, 'Jahr', jsel)), body);
  await load();
};

// ---------------- Mail merge ----------------
Views.serienbriefDialog = (empf, betreff = '', text = '{Briefanrede}\n\n\n\nMit freundlichen Grüßen', { onDruck } = {}) => {
  const b = h('input', { type: 'text', value: betreff, style: { width: '100%' } });
  const t = h('textarea', { rows: 14, style: { width: '100%' } }, text);
  const content = h('div', { class: 'win-body flex', style: { padding: 0 } }, h('div', { class: 'note info' }, `${empf.length} Empfänger. Platzhalter: {Briefanrede} {Anrede} {Name} {Vorname} {Kennzeichen} {Fahrzeug} {Termin}`), fld('Betreff', b), fld('Text', t));
  const w = Win.open({ title: 'Serienbrief', width: 760, content });
  w.setButtons(['|', { label: 'Briefe drucken', icon: '🖨', cls: 'primary', onClick: () => { Print.serienbrief(empf, b.value, t.value); if (onDruck) onDruck(); } }, { label: 'Schließen', onClick: () => w.close() }]); w.el.append(w.foot);
};
Views.serienbriefe = async (main) => {
  const f = { plz: h('input', { type: 'text', style: { width: '80px' } }), ort: h('input', { type: 'text' }), art: h('select', null, h('option', { value: '' }, 'alle'), h('option', { value: '0' }, 'Privatkunden'), h('option', { value: '1' }, 'Firmen')), seit: h('input', { type: 'date' }), nichtSeit: h('input', { type: 'date' }) };
  const wrap = h('div', { class: 'overview' }); let rows = [], g;
  const load = async () => {
    rows = await api('/api/auswertung/serienbrief?' + qs({ plz: f.plz.value, ort: f.ort.value, art: f.art.value, seit: f.seit.value, nichtSeit: f.nichtSeit.value }));
    const ng = miniGrid([{ f: 'NUMMER', l: 'Kd.-Nr.', w: 70 }, { f: 'ANREDE', l: 'Anrede', w: 70 }, { f: 'NAME', l: 'Name', w: 180 }, { f: 'VORNAME', l: 'Vorname', w: 120 }, { f: 'STRASSE', l: 'Straße', w: 170 }, { f: 'PLZ', l: 'PLZ', w: 60 }, { f: 'ORT', l: 'Ort', w: 120 }, { f: 'LETZTERBESUCH', l: 'Letzte Rechnung', w: 110, t: 'date' }], rows, { onOpen: r => editRecord('kunden', r.KUNID) });
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el); g = ng; info.textContent = T(`${rows.length} Empfänger`);
  };
  Object.values(f).forEach(x => x.addEventListener('change', load));
  const info = h('span', { class: 'info' });
  main.append(title('Serienbriefe'), h('div', { class: 'searchbar' }, h('label', null, 'PLZ beginnt mit', f.plz), h('label', null, 'Ort', f.ort), h('label', null, 'Kundenart', f.art), h('label', null, 'Kunde seit (Rechnung ab)', f.seit), h('label', null, 'keine Rechnung seit', f.nichtSeit)), wrap,
    h('div', { class: 'grid-footer' }, info, h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => { const c = ['NUMMER', 'ANREDE', 'NAME', 'VORNAME', 'ZUSATZ', 'STRASSE', 'PLZ', 'ORT', 'EMAIL']; saveBlob(new Blob(['\ufeff' + [c.join(';'), ...rows.map(r => c.map(k => String(r[k] ?? '').replace(/;/g, ',')).join(';'))].join('\r\n')], { type: 'text/csv' }), 'Serienbrief-Empfaenger.csv'); } }, '⬇ CSV-Export'),
      h('button', { class: 'btn primary', onclick: () => Views.serienbriefDialog(rows) }, '✉️ Serienbrief schreiben')));
  await load();
};

// ---------------- Appointment planner ----------------
Views.kalender = async (main) => {
  let start = (() => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d.toISOString().slice(0, 10); })();
  const body = h('div', { class: 'view-scroll' });
  const lbl = h('b');
  const res = Pref.get('kal.ressourcen', 'Hebebühne 1, Hebebühne 2, Monteur');
  const load = async () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    lbl.textContent = `KW ${kw(start)} · ${fmt.date(days[0])} – ${fmt.date(days[6])}`;
    const evs = await api('/api/termine?' + qs({ von: days[0], bis: days[6] }));
    const cal = h('div', { class: 'cal' });
    cal.append(h('div', { class: 'hd' }, ''));
    const wdn = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    days.forEach((d, i) => cal.append(h('div', { class: 'hd' + (d === today() ? ' today' : '') }, `${wdn[i]} ${fmt.date(d).slice(0, 6)}`)));
    const hours = Array.from({ length: 13 }, (_, i) => i + 7);
    const cells = {};
    for (const hr of hours) {
      cal.append(h('div', { class: 'tm' }, String(hr).padStart(2, '0') + ':00'));
      for (const d of days) {
        const c = h('div', { class: 'slot', ondblclick: () => termin(null, { BEGINN: `${d}T${String(hr).padStart(2, '0')}:00`, ENDE: `${d}T${String(hr + 1).padStart(2, '0')}:00` }) });
        cells[d + hr] = c; cal.append(c);
      }
    }
    for (const e of evs) {
      const d = String(e.BEGINN).slice(0, 10); let hr = Number(String(e.BEGINN).slice(11, 13)) || 7; if (e.GANZTAGS) hr = 7;
      hr = Math.max(7, Math.min(19, hr));
      const min = Number(String(e.BEGINN).slice(14, 16)) || 0;
      const endH = e.ENDE ? (Number(String(e.ENDE).slice(11, 13)) + Number(String(e.ENDE).slice(14, 16)) / 60) : hr + 1;
      const dur = Math.max(0.5, Math.min(13, endH - (hr + min / 60)));
      const c = cells[d + hr]; if (!c) continue;
      c.append(h('div', { class: 'ev' + (Number(e.ERLEDIGT) ? ' done' : ''), style: { top: (min / 60 * 44) + 'px', height: (dur * 44 - 3) + 'px', background: e.FARBE || '' }, title: [e.TITEL, e.KUNDE, e.KENNZEICHEN, e.NOTIZ].filter(Boolean).join('\n'), onclick: ev => { ev.stopPropagation(); termin(e); } },
        h('b', null, e.GANZTAGS ? '' : String(e.BEGINN).slice(11, 16) + ' '), e.TITEL || '', e.KENNZEICHEN ? ` · ${e.KENNZEICHEN}` : '', e.RESSOURCE ? h('div', { class: 'muted' }, e.RESSOURCE) : null));
    }
    body.innerHTML = ''; body.append(cal);
  };
  const termin = async (e, defaults = {}) => {
    const t = { GANZTAGS: 0, ...defaults, ...(e || {}) };
    const inp = (k, type = 'text') => { const x = h('input', { type, value: type === 'datetime-local' ? String(t[k] || '').slice(0, 16).replace(' ', 'T') : (t[k] ?? '') }); x.addEventListener('change', () => { t[k] = x.value; }); return x; };
    const kunde = h('input', { type: 'text', readonly: true, value: t.KUNDE || '' });
    const fz = h('input', { type: 'text', readonly: true, value: t.KENNZEICHEN || '' });
    const erl = h('input', { type: 'checkbox', checked: Number(t.ERLEDIGT) === 1, onchange: () => { t.ERLEDIGT = erl.checked ? 1 : 0; } });
    const ganz = h('input', { type: 'checkbox', checked: Number(t.GANZTAGS) === 1, onchange: () => { t.GANZTAGS = ganz.checked ? 1 : 0; } });
    const ress = inp('RESSOURCE'); ress.setAttribute('list', 'dl-res');
    const farbe = h('select', { onchange: () => { t.FARBE = farbe.value; } }, [['', 'Standard'], ['#cfe3fb', 'Blau'], ['#d4f0d9', 'Grün'], ['#fdebc8', 'Orange'], ['#f9d6d2', 'Rot'], ['#e6dcf7', 'Lila']].map(([v, l]) => h('option', { value: v, selected: v === (t.FARBE || '') }, l)));
    const content = h('div', { class: 'fgrid' },
      fld('Titel', inp('TITEL')), fld('Beginn', inp('BEGINN', 'datetime-local'), true), fld('Ende', inp('ENDE', 'datetime-local'), true),
      h('label', { class: 'fld chk w1' }, ganz, h('span', null, 'ganztägig')), h('label', { class: 'fld chk w1' }, erl, h('span', null, 'erledigt')),
      fld('Kunde', h('div', { class: 'inline' }, kunde, h('button', { class: 'btn icon', onclick: async () => { const k = await pickKunde(); if (k) { t.KUNID = k.KUNID; kunde.value = kname(k); } } }, '🔍'))),
      fld('Fahrzeug', h('div', { class: 'inline' }, fz, h('button', { class: 'btn icon', onclick: async () => { const f = await pickRecord('fahrzeuge'); if (f) { t.FAHRID = f.FAHR_ID; fz.value = f.KENNZEICHEN; } } }, '🔍'))),
      fld('Ressource (Monteur, Hebebühne, …)', ress, true), fld('Farbe', farbe, true), h('datalist', { id: 'dl-res' }, String(res).split(',').map(x => h('option', { value: x.trim() }))),
      fld('Notiz', (() => { const x = h('textarea', { rows: 3 }, t.NOTIZ || ''); x.addEventListener('change', () => { t.NOTIZ = x.value; }); return x; })()));
    const btns = [{ label: 'Speichern', cls: 'primary', value: 'save' }, { label: 'Abbrechen', value: null }];
    if (e) btns.unshift({ label: 'Löschen', value: 'del' });
    const r = await dialog(e ? 'Termin bearbeiten' : 'Neuer Termin', content, btns, { width: 560 });
    if (r === 'save') { t.BEGINN = String(t.BEGINN || '').replace('T', ' '); t.ENDE = String(t.ENDE || '').replace('T', ' ') || null; await api('/api/termine', { method: 'POST', body: t }); load(); }
    if (r === 'del' && await confirmDlg('Termin löschen?')) { await api('/api/termine/' + e.ID, { method: 'DELETE' }); load(); }
  };
  main.append(title('Terminplaner'), h('div', { class: 'searchbar' },
    h('button', { class: 'btn', onclick: () => { start = addDays(start, -7); load(); } }, '◀'), h('button', { class: 'btn', onclick: () => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); start = d.toISOString().slice(0, 10); load(); } }, 'Heute'),
    h('button', { class: 'btn', onclick: () => { start = addDays(start, 7); load(); } }, '▶'), lbl, h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn', onclick: async () => { const v = await promptDlg('Ressourcen (durch Komma getrennt)', Pref.get('kal.ressourcen', res)); if (v != null) Pref.set('kal.ressourcen', v); } }, '⚙ Ressourcen'),
    h('button', { class: 'btn primary', onclick: () => termin(null, { BEGINN: today() + 'T08:00', ENDE: today() + 'T09:00' }) }, '➕ Neuer Termin')), body);
  await load();
};
function kw(iso) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7); const w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7); }

// ---------------- Visualise e-invoice ----------------
Views.evisual = async (main) => {
  const dz = h('div', { class: 'dropzone', style: { padding: '40px' } }, '📂 XRechnung- oder ZUGFeRD-XML-Datei hierher ziehen oder klicken');
  const open = async f => { if (!f) return; Print.erechnungAnsicht(await f.text()); };
  dz.addEventListener('click', async () => open(await pickFile('.xml,application/xml,text/xml')));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); open(e.dataTransfer.files[0]); });
  main.append(title('E-Rechnung visualisieren', 'Eingehende E-Rechnungen (XRechnung CII/UBL) lesbar anzeigen und drucken'), dz);
};

// ---------------- Settings ----------------
Views.einstellungen = async (main) => {
  const s = await api('/api/einstellungen');
  const opt = {}; for (const o of s.optionen) opt[o.BEZEICHNUNG] = o.WERT;
  const changes = { firma: {}, optionen: {}, sw: {}, individuell: null };
  const tabs = h('div', { class: 'tabs' }); const panes = []; const body = h('div', { class: 'view-scroll' });
  const addTab = (name, build) => {
    const pane = h('div', { class: 'tabpane hidden' }); panes.push(pane);
    const b = h('button', { onclick: () => { $$('button', tabs).forEach(x => x.classList.remove('active')); b.classList.add('active'); panes.forEach(p => p.classList.add('hidden')); pane.classList.remove('hidden'); if (!pane._b) { pane._b = 1; build(pane); } } }, name);
    tabs.append(b); body.append(pane); return b;
  };
  const fi = (k, label, w1, type = 'text') => { const x = h('input', { type, value: s.firma[k] ?? '' }); x.addEventListener('change', () => { changes.firma[k] = x.value; }); return fld(label, x, w1); };
  const oi = (k, label, w1, type = 'text') => { const x = h('input', { type, value: opt[k] ?? '', class: type === 'num' ? 'num' : '' }); x.addEventListener('change', () => { changes.optionen[k] = x.value; }); return fld(label, x, w1); };
  const ob = (k, label) => { const x = h('input', { type: 'checkbox', checked: opt[k] === '1' }); x.addEventListener('change', () => { changes.optionen[k] = x.checked ? '1' : '0'; }); return h('label', { class: 'fld chk' }, x, h('span', null, label)); };
  const si = (k, label, def = '', w1, type = 'text') => { const x = h('input', { type, value: s.sw[k] ?? def }); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return fld(label, x, w1); };
  const sb = (k, label, def = '0') => { const x = h('input', { type: 'checkbox', checked: (s.sw[k] ?? def) === '1' }); x.addEventListener('change', () => { changes.sw[k] = x.checked ? '1' : '0'; }); return h('label', { class: 'fld chk' }, x, h('span', null, label)); };
  const grp = (t, ...els) => h('fieldset', { class: 'grp' }, h('legend', null, t), h('div', { class: 'fgrid' }, els));
  const first = addTab('Firmendaten', p => {
    const logoImg = h('img', { style: { maxHeight: '80px', maxWidth: '240px', display: s.firma.LOGOFILE ? '' : 'none' }, src: s.firma.LOGOFILE ? '/dateien/' + s.firma.LOGOFILE : '' });
    p.append(h('div', { class: 'groups' },
      grp('Firma', fi('FIRMENNAME', 'Firmenname'), fi('FIRMENZUSATZ', 'Zusatz'), fi('STRASSE', 'Straße'), fi('PLZ', 'PLZ', true), fi('ORT', 'Ort', true), fi('LAND', 'Land (ISO, z. B. DE)', true), fi('ABSENDER', 'Absenderzeile (Fensterumschlag)')),
      grp('Kontakt', fi('TELEFON', 'Telefon', true), fi('MOBIL', 'Mobil', true), fi('FAX', 'Fax', true), fi('EMAIL', 'E-Mail (auch für E-Rechnung)', true), fi('INTERNETSEITE', 'Internetseite')),
      grp('Bank', fi('BANKNAME', 'Bank'), fi('IBAN', 'IBAN'), fi('BIC', 'BIC', true), fi('BANKINHABER', 'Kontoinhaber', true)),
      grp('Steuer & Recht', fi('USTNR', 'USt-IdNr.', true), fi('STEUERNR', 'Steuernummer', true), fi('HANDELSREGISTER', 'Handelsregister (z. B. HRB 1234, AG Frankfurt)'), fi('GESCHAEFTSFUEHRER', 'Inhaber / Geschäftsführer'), fi('FUSSZEILE', 'zusätzliche Fußzeile')),
      grp('Logo / Briefbogen', h('div', { class: 'fld' }, logoImg, h('div', { class: 'inline' }, h('button', { class: 'btn', onclick: async () => {
        const f = await pickFile('image/*'); if (!f) return;
        const url = URL.createObjectURL(f); const logo = await App.logoUmwandeln(url); URL.revokeObjectURL(url); const r = { logo };
        logoImg.src = '/dateien/' + r.logo + '?' + Date.now(); logoImg.style.display = ''; toast('Logo gespeichert', 'ok');
      } }, '🖼 Logo hochladen'))), sb('druck.briefpapier', 'Vorgedrucktes Briefpapier verwenden (Briefkopf/Fußzeile nicht drucken)'))));
  });
  addTab('Steuer / Mahnung / Kasse', p => p.append(h('div', { class: 'groups' },
    grp('Steuersystem / Tax system', (() => {
      const x = h('select', null, [['DE', 'Deutschland (UStG, TSE, DATEV, XRechnung)'], ['ES', 'España (IVA, VERI*FACTU, Facturae)'], ['GB', 'United Kingdom (VAT, Making Tax Digital, £)'], ['US', 'United States (sales tax, $)'], ['FR', 'France (TVA, Factur-X, NF525, FEC)'], ['AT', 'Österreich (USt, RKSV, UVA, ebInterface)'], ['CH', 'Schweiz (MWST, QR-Rechnung, CHF)'], ['IT', 'Italia (IVA, fattura elettronica SdI)'], ['NL', 'Nederland (btw, KOR, Peppol)']].map(([v, l]) => h('option', { value: v, selected: (s.sw['steuer.land'] || 'DE') === v }, l)));
      x.addEventListener('change', () => { changes.sw['steuer.land'] = x.value; });
      return fld('Steuersystem dieses Mandanten', x);
    })(), h('div', { class: 'fld hint' }, 'Gilt nur für den aktuellen Mandanten. Vorhandene Rechnungen, Sicherungen und der Import aus KFZ-Faktura bleiben unverändert. Großbritannien rechnet in Pfund (£), die Schweiz in Franken (CHF). Die Belegsprache stellen Sie unter Vorgabewerte → Sprache ein. Nach dem Umstellen speichern und das Programm neu laden.')),
    grp('Mehrwertsteuer', oi('volle MwSt', 'voller Satz %', true, 'num'), oi('verm. MwSt', 'ermäßigter Satz %', true, 'num'), oi('AT.-MwSt', 'AT-MwSt %', true, 'num'), ob('Kleinunternehmer', 'Kleinunternehmer nach § 19 UStG (keine MwSt)')),
    grp('Mahnwesen', ...[1, 2, 3, 4].flatMap(i => [oi(`Mahntage${i}`, `Stufe ${i}: Tage nach Fälligkeit`, true, 'num'), oi(`Mahntage${i}Gebuehren`, `Stufe ${i}: Gebühr €`, true, 'num')])),
    grp('Kasse', oi('Kassenanfang', 'Kassen-Anfangsbestand €', true, 'num')))));
  addTab('España / VERI*FACTU', p => EsUI.settingsTab(p, { s, changes, si, grp, fld }));
  addTab('United Kingdom / MTD', p => GbUI.settingsTab(p, { s, changes, si, grp, fld, ob }));
  addTab('United States / Sales tax', p => UsUI.settingsTab(p, { s, changes, si, sb, grp, fld }));
  addTab('France', p => FrUI.settingsTab(p, { s, changes, si, sb, grp, fld, ob }));
  addTab('Österreich', p => AtUI.settingsTab(p, { s, changes, si, sb, grp, fld, ob }));
  addTab('Schweiz', p => ChUI.settingsTab(p, { s, changes, si, sb, grp, fld, ob }));
  addTab('Italia', p => ItUI.settingsTab(p, { s, changes, si, sb, grp, fld, ob }));
  addTab('Nederland', p => NlUI.settingsTab(p, { s, changes, si, sb, grp, fld, ob }));
  addTab('Nummernkreise', p => p.append(h('div', { class: 'note info', style: { marginBottom: '8px' } }, 'Eingetragen ist jeweils die zuletzt vergebene Nummer. Die nächste Nummer ist um 1 höher.'),
    h('div', { class: 'groups' }, grp('Stammdaten', oi('Nummernkreis Kunden', 'Kunden', true), oi('Nummerkreis Fahrzeuge', 'Fahrzeuge', true), oi('Nummerkreis Artikel', 'Artikel', true), oi('Nummernkreis Arbeitswert', 'Arbeitswerte', true), oi('Nummernkreis Liefranten', 'Lieferanten', true), oi('Reifeneinlagerung', 'Reifeneinlagerung', true)),
      grp('Vorgänge', oi('Nummernkreis Angebot', 'Angebote', true), oi('Nummernkreis Auftrag', 'Aufträge', true), oi('Nummerkreis Lieferschein', 'Lieferscheine', true), oi('Nummernkreis Rechnung', 'Rechnungen', true), oi('Nummerkreis Gutschrift', 'Rechnungskorrekturen', true)))));
  addTab('FIBU', p => p.append(h('div', { class: 'groups' },
    grp('Konten (SKR03-Vorgabe)', oi('FIBU-Kasse', 'Kasse', true), oi('FIBU-Bank1', 'Bank 1', true), oi('FIBU-Bank1Name', 'Name Bank 1', true), oi('FIBU-Bank2', 'Bank 2', true), oi('FIBU-Bank2Name', 'Name Bank 2', true), oi('FIBU-Bank3', 'Bank 3', true), oi('FIBU-Bank3Name', 'Name Bank 3', true)),
    grp('Erlöskonten', oi('FIBU-Einnahme-Artikel', 'Erlöse Artikel', true), oi('FIBU-Einnahme-Arbeitswert', 'Erlöse Arbeitswerte', true), oi('FIBU-Einnahme-Durch.Posten', 'Durchlaufende Posten', true), oi('FIBU-Gewährte-Skonti', 'Gewährte Skonti', true), oi('FIBU-MwSt1', 'USt voll', true), oi('FIBU-MwSt2', 'USt ermäßigt', true)),
    grp('DATEV', si('datev.berater', 'Beraternummer', '1001', true), si('datev.mandant', 'Mandantennummer', '1', true), si('datev.kontenlaenge', 'Sachkontenlänge', '4', true), si('datev.wjbeginn', 'Wirtschaftsjahr beginnt im Monat (1–12)', '1', true), si('datev.sammeldebitor', 'Sammeldebitor (Kunden ohne eigenes Konto)', '10000', true), h('div', { class: 'fld hint' }, 'Personenkonten haben eine Stelle mehr als die Sachkonten: bei Sachkontenlänge 4 Debitoren 10000–69999, Kreditoren 70000–99999. Liegt die Debitoren-/Kreditoren-Nr. bzw. Kunden-/Lieferantennummer nicht in diesem Bereich, wird auf das Sammelkonto gebucht (Sammelkreditor: Einstellungen → Einkauf / Handel).'), sb('datev.buschluessel', 'BU-Schlüssel mitgeben (nur ohne Automatikkonten; Eingangsrechnungen mit Vorsteuer-Schlüssel 9/8)')))));
  addTab('Vorgabewerte', p => p.append(h('div', { class: 'groups' },
    grp('Vorgänge', sb('vorgang.ansichtbrutto', 'Neue Vorgänge mit Brutto-Preisen erfassen', '1'), sb('vorgang.fahrzeugdatenuebernahme', 'KM-Stand / HU aus Vorgängen ins Fahrzeug übernehmen', '1'), si('vorgang.ket', 'Kleinteilzuschlag KET %', '3', true), si('vorgang.mtz', 'Lackiermaterial MTZ % (0 = nachfragen)', '0', true), sb('gobd.sperre', 'Gedruckte Rechnungen sperren (GoBD-Festschreibung)')),
    grp('Anmeldung', ob('Anmeldung', 'Anmeldung mit Benutzername/Passwort erforderlich'), h('div', { class: 'hint fld' }, 'Benutzer unter Einstellungen → Benutzer anlegen und dort "Anmeldung erlaubt" setzen.')),
    grp('Darstellung', h('label', { class: 'fld' }, h('span', null, 'Farbschema'), (() => { const x = h('select', { onchange: () => App.setTheme(x.value) }, [['auto', 'automatisch'], ['light', 'hell'], ['dark', 'dunkel']].map(([v, l]) => h('option', { value: v, selected: Pref.get('theme', 'auto') === v }, l))); return x; })()),
      h('label', { class: 'fld' }, h('span', null, 'Farbe'), (() => { const x = h('select', { onchange: () => App.setFarbe(x.value) }, [['blau', 'Blau'], ['gruen', 'Grün'], ['graphit', 'Graphit'], ['bordeaux', 'Bordeaux']].map(([v, l]) => h('option', { value: v, selected: Pref.get('farbe', 'blau') === v }, l))); return x; })()),
      h('div', { class: 'fld hint' }, 'Farbschema und Farbe gelten nur für diesen Arbeitsplatz bzw. Browser. So lassen sich z. B. Mandanten oder Arbeitsplätze farblich unterscheiden.')),
    grp('Sprache / Language / Idioma',
      h('label', { class: 'fld' }, h('span', null, 'Sprache der Oberfläche'), (() => { const x = h('select', { onchange: () => App.setLang(x.value) }, Object.entries(I18N.UI_LANGS).map(([v, l]) => h('option', { value: v, selected: I18N.lang === v }, raw(l.name)))); return x; })()),
      h('label', { class: 'fld' }, h('span', null, 'Sprache der Belege (Rechnungen, PDF, Druck, E-Mail)'), (() => { const x = h('select', { onchange: () => { changes.sw['beleg.sprache'] = x.value; } }, Object.entries(I18N.LANGS).map(([v, l]) => h('option', { value: v, selected: (s.sw['beleg.sprache'] || 'de') === v }, raw(l.name)))); return x; })()),
      h('div', { class: 'fld hint' }, 'Die Oberfläche gilt nur für diesen Arbeitsplatz. Die Sprache der Belege gilt für den ganzen Mandanten. Gesetzliche Angaben (z. B. § 19 UStG) werden mit übersetzt, die Rechtslage bleibt die deutsche.')))));
  addTab('E-Mail', p => p.append(h('div', { class: 'groups' },
    grp('Versandart',
      (() => { const x = h('select', null, [['smtp', 'Direkt aus Kuenta senden (SMTP)'], ['programm', 'An Mailprogramm übergeben (z. B. Thunderbird)']].map(([k, l]) => h('option', { value: k, selected: (s.sw['mail.versand'] || 'smtp') === k }, l))); x.addEventListener('change', () => { changes.sw['mail.versand'] = x.value; }); return fld('E-Mails versenden', x); })(),
      h('div', { class: 'fld hint' }, 'Bei „An Mailprogramm übergeben“ öffnet Kuenta eine fertige E-Mail mit Anhang in Thunderbird (oder dem Standard-Mailprogramm). Sie senden sie dort selbst – so liegt sie im Ordner „Gesendet“. Funktioniert nur an dem Rechner, auf dem Kuenta läuft; die SMTP-Daten unten werden dann nicht benötigt.'),
      (() => { const x = h('input', { type: 'text', value: s.sw['mail.programm'] || '', placeholder: 'leer = Thunderbird automatisch suchen' }); x.addEventListener('change', () => { changes.sw['mail.programm'] = x.value; }); const info = h('div', { class: 'hint' }); api('/api/mail/programm').then(r => { info.textContent = T(r.container ? 'Kuenta läuft in einem Container – die Übergabe an ein Mailprogramm ist dort nicht möglich. Bitte SMTP verwenden.' : r.thunderbird ? 'Gefunden: ' + r.thunderbird : 'Thunderbird nicht gefunden – es wird das Standard-Mailprogramm verwendet.'); }).catch(() => {}); return h('label', { class: 'fld' }, h('span', null, 'Pfad zu Thunderbird (optional)'), x, info); })(),
      h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => { try { await api('/api/einstellungen', { method: 'PUT', body: changes }); const r = await api('/api/mail/programm-test', { method: 'POST', body: {} }); toast('Testnachricht an ' + r.programm + ' übergeben', 'ok'); } catch (e) { showError(e); } } }, '✉️ Einstellungen speichern & Mailprogramm testen'))),
    grp('Postausgangsserver (SMTP)', si('smtp.host', 'Server (z. B. smtp.ionos.de)', ''), si('smtp.port', 'Port', '587', true),
      (() => { const x = h('select', null, [['starttls', 'STARTTLS (Port 587)'], ['ssl', 'SSL/TLS (Port 465)'], ['none', 'unverschlüsselt']].map(([k, l]) => h('option', { value: k, selected: (s.sw['smtp.sicherheit'] || 'starttls') === k }, l))); x.addEventListener('change', () => { changes.sw['smtp.sicherheit'] = x.value; }); return fld('Verschlüsselung', x, true); })(),
      si('smtp.benutzer', 'Benutzername', '', true), si('smtp.passwort', 'Passwort', '', true, 'password'),
      si('smtp.absender', 'Absenderadresse', s.firma.EMAIL || '', true), si('smtp.absendername', 'Absendername', s.firma.FIRMENNAME || '', true), si('smtp.bcc', 'Kopie (BCC) jeder Mail an', '', true),
      sb('smtp.zertifikatpruefen', 'Serverzertifikat prüfen', '1'),
      h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => { await api('/api/einstellungen', { method: 'PUT', body: changes }); const to = await promptDlg('Testnachricht senden an', s.firma.EMAIL || ''); if (!to) return; try { await api('/api/mail/test', { method: 'POST', body: { to } }); toast('Testnachricht gesendet', 'ok'); } catch (e) { showError(e); } } }, '✉️ Einstellungen speichern & Testmail senden'))),
    grp('Vorlagen (Platzhalter: {Vorgang} {Nummer} {Name} {Briefanrede} {Betrag} {Firma} {Zahlungslink})',
      si('mail.betreff.rechnung', 'Betreff Rechnung', '{Vorgang} Nr. {Nummer} – {Firma}'),
      (() => { const t = h('textarea', { rows: 6 }, s.sw['mail.text.rechnung'] || T('{Briefanrede}\n\nanbei erhalten Sie unsere(n) {Vorgang} Nr. {Nummer}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{Firma}')); t.addEventListener('change', () => { changes.sw['mail.text.rechnung'] = t.value; ['angebot', 'auftrag', 'lieferschein', 'korrektur'].forEach(k => { if (!s.sw['mail.text.' + k]) changes.sw['mail.text.' + k] = t.value; }); }); return fld('Text Vorgänge', t); })(),
      (() => { const t = h('textarea', { rows: 3 }, s.sw['mail.signatur'] || ''); t.addEventListener('change', () => { changes.sw['mail.signatur'] = t.value; }); return fld('Signatur', t); })()),
    grp('Versandprotokoll', h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => { const rows = await api('/api/mail/protokoll'); Win.open({ title: 'E-Mail-Versandprotokoll', width: 900, height: 560, content: miniGrid([{ f: 'ZEIT', l: 'Zeit', w: 140 }, { f: 'AN', l: 'An', w: 200 }, { f: 'BETREFF', l: 'Betreff', w: 260 }, { f: 'STATUS', l: 'Status', w: 80 }, { f: 'ANHAENGE', l: 'Anhänge', w: 200 }, { f: 'FEHLER', l: 'Fehler', w: 300 }], rows).el }); } }, '📋 Protokoll anzeigen'))))));
  addTab('Erinnerungen & SMS', p => {
    const textfeld = (k, rows) => { const t = h('textarea', { rows }, s.sw[k] || ''); t.addEventListener('change', () => { changes.sw[k] = t.value; }); return t; };
    const eingabe = (k, type = 'text') => { const x = h('input', { type, value: s.sw[k] || '' }); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return x; };
    const auswahl = (k, def, opts) => { const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] || def) === v }, l))); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return x; };
    // Reminder texts (empty = default)
    const betreff = eingabe('erinnerung.betreff'); const text = textfeld('erinnerung.text', 8); const sms = textfeld('erinnerung.sms', 3);
    const zaehler = h('div', { class: 'fld hint' });
    const zaehle = () => { zaehler.textContent = T(`${sms.value.length} Zeichen vor dem Einsetzen der Platzhalter. Eine SMS hat 160 Zeichen, längere werden in mehreren Teilen verschickt und kosten entsprechend mehr.`); };
    sms.addEventListener('input', zaehle);
    api('/api/erinnerung/vorlagen').then(v => { if (!betreff.value) betreff.value = v.betreff; if (!text.value) text.value = v.text; if (!sms.value) sms.value = v.sms; zaehle(); }).catch(() => {});
    // SMS gateway
    const methode = auswahl('sms.methode', 'POST', [['POST', 'POST'], ['GET', 'GET']]);
    const format = auswahl('sms.format', 'json', [['json', 'JSON'], ['form', 'Formular (x-www-form-urlencoded)']]);
    const url = eingabe('sms.url'); const header = textfeld('sms.header', 2); const body = textfeld('sms.body', 3);
    const benutzer = eingabe('sms.benutzer'); const passwort = eingabe('sms.passwort', 'password'); const absender = eingabe('sms.absender');
    const VORLAGEN = {
      relais: { name: 'Kuenta-SMS-Relais (Surfstick mit SIM-Karte an einem anderen Rechner)', methode: 'POST', url: 'http://RECHNER:3790/sms', format: 'json', header: 'X-Token: IHR-TOKEN', body: '{"nummer":"{nummer}","text":"{text}"}', benutzer: '', passwort: '' },
      android: { name: 'Android-Telefon mit der App „SMS Gateway for Android“ (lokaler Server)', methode: 'POST', url: 'http://HANDY-IP:8080/message', format: 'json', header: '', body: '{"textMessage":{"text":"{text}"},"phoneNumbers":["{nummer}"]}', benutzer: 'sms', passwort: '' },
      seven: { name: 'SMS-Anbieter seven.io (Internet, kostenpflichtig)', methode: 'POST', url: 'https://gateway.seven.io/api/sms', format: 'form', header: 'X-Api-Key: IHR-API-SCHLÜSSEL', body: 'to={nummer}&text={text}&from={absender}', benutzer: '', passwort: '' },
    };
    const felder = [['sms.methode', methode, 'methode'], ['sms.url', url, 'url'], ['sms.format', format, 'format'], ['sms.header', header, 'header'], ['sms.body', body, 'body'], ['sms.benutzer', benutzer, 'benutzer'], ['sms.passwort', passwort, 'passwort']];
    const vorlage = h('select', { onchange: () => {
      const v = VORLAGEN[vorlage.value]; vorlage.value = ''; if (!v) return;
      for (const [k, el, f] of felder) { el.value = v[f]; changes.sw[k] = v[f]; }
      toast('Vorlage eingesetzt. Bitte die großgeschriebenen Teile (Rechner, Token, Schlüssel …) anpassen.', 'ok');
    } }, h('option', { value: '' }, 'Vorlage einsetzen …'), Object.entries(VORLAGEN).map(([k, v]) => h('option', { value: k }, v.name)));
    const testen = async () => {
      try {
        await api('/api/einstellungen', { method: 'PUT', body: changes });
        const an = await promptDlg('Test-SMS senden an (Mobilnummer)', ''); if (!an) return;
        const r = await api('/api/sms/test', { method: 'POST', body: { an } });
        toast(`Test-SMS an ${r.an} übergeben (Antwort ${r.status})`, 'ok');
      } catch (e) { showError(e); }
    };
    const protokoll = async () => {
      const rows = await api('/api/erinnerung/protokoll');
      Win.open({ title: 'Erinnerungsprotokoll', width: 900, height: 560, content: miniGrid([{ f: 'ZEIT', l: 'Zeit', w: 140 }, { f: 'KENNZEICHEN', l: 'Kennzeichen', w: 110 }, { f: 'ART', l: 'Termin', w: 90 }, { f: 'TERMIN', l: 'fällig', w: 90, t: 'date' }, { f: 'KANAL', l: 'Weg', w: 60 }, { f: 'AN', l: 'An', w: 190 }, { f: 'STATUS', l: 'Status', w: 90 }, { f: 'FEHLER', l: 'Fehler', w: 260 }], rows).el });
    };
    p.append(h('div', { class: 'groups' },
      grp('Erinnerungen an Fahrzeugtermine', fld('Betreff der E-Mail', betreff), fld('Text der E-Mail', text), fld('Text der SMS', sms), zaehler,
        h('div', { class: 'fld hint' }, 'Platzhalter: {Briefanrede} {Anrede} {Name} {Vorname} {Kennzeichen} {Fahrzeug} {Termin} {Terminart} {Firma} {Telefon}. Feld leeren = Vorgabe. E-Mails gehen über die Versandart im Reiter „E-Mail“.'),
        h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: protokoll }, '📋 Erinnerungsprotokoll'))),
      grp('SMS-Gateway', ...(App.pro('sms') ? [] : [h('div', { class: 'fld note info' }, 'SMS-Versand ist eine Funktion von Kuenta Pro. Sie können das Gateway schon einrichten, senden lassen sich SMS erst mit Lizenz (Reiter „Lizenz“).')]), fld('Vorlage', vorlage), fld('Methode', methode, true), fld('Format', format, true), fld('Adresse (URL)', url),
        fld('Zusätzliche Kopfzeilen (je Zeile „Name: Wert“)', header), fld('Inhalt (bei POST)', body),
        fld('Benutzer (Basic-Anmeldung)', benutzer, true), fld('Passwort', passwort, true), fld('Absender (höchstens 11 Zeichen, falls unterstützt)', absender),
        h('div', { class: 'fld hint' }, 'Platzhalter für das Gateway: {nummer} (+4917…), {nummer_ohne_plus}, {text}, {absender}. Sie werden automatisch passend kodiert.'),
        h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: testen }, '📱 Einstellungen speichern & Test-SMS senden')))));
  });
  addTab('Lizenz', p => {
    const box = h('div', { class: 'groups' });
    const zeige = (st) => {
      const datum = d => d ? d.split('-').reverse().join('.') : '';
      const eingabe = h('textarea', { rows: 4, placeholder: 'KUENTA1.…', style: { fontFamily: 'monospace', fontSize: '12px' } });
      const einspielen = async () => {
        try { const r = await api('/api/lizenz', { method: 'PUT', body: { schluessel: eingabe.value } }); App.session.pro = r.funktionen; toast('Lizenz eingespielt. Kuenta Pro ist freigeschaltet.', 'ok'); zeige(r); }
        catch (e) { showError(e); }
      };
      const entfernen = async () => {
        if (!(await confirmDlg('Lizenz aus dieser Installation entfernen? Den Schlüssel können Sie später wieder einspielen.'))) return;
        const r = await api('/api/lizenz', { method: 'DELETE' }); App.session.pro = r.funktionen; zeige(r);
      };
      const zustand = !st.vorhanden ? h('div', { class: 'fld' }, 'Keine Lizenz eingespielt. Alle Grundfunktionen sind frei nutzbar.')
        : st.fehler ? h('div', { class: 'fld note warn' }, 'Die gespeicherte Lizenz ist ungültig: ' + st.fehler)
        : h('div', { class: 'fld' }, h('table', { class: 'simple' }, h('tbody', null, [
          ['Lizenziert für', st.kunde], ['Lizenz-Nr.', st.id], ['Umfang', st.lizenziert.includes('pro') ? 'Kuenta Pro (alle Pro-Funktionen)' : st.lizenziert.map(f => st.katalog[f] || f).join(', ')],
          ['Ausgestellt', datum(st.ausgestellt)], ['Gültig bis', st.bis ? datum(st.bis) + (st.abgelaufen ? ' – abgelaufen' : '') : 'unbefristet']].map(([a, b]) => h('tr', null, h('td', null, h('b', null, a)), h('td', null, b))))));
      box.innerHTML = '';
      box.append(
        grp('Kuenta Pro', zustand,
          h('div', { class: 'fld' }, h('b', null, 'Pro-Funktionen'), h('ul', { style: { margin: '4px 0 0 18px', padding: 0 } }, Object.entries(st.katalog).map(([k, l]) => h('li', null, `${st.funktionen.includes(k) ? '✅' : '🔒'} ${l}`)))),
          h('div', { class: 'fld hint' }, st.angebot.text, ' ', h('a', { href: st.angebot.seite, target: '_blank', rel: 'noopener' }, 'Preise und Bestellung')),
          st.angebot.shop ? h('div', { class: 'fld' }, h('a', { class: 'btn primary', href: st.angebot.shop, target: '_blank', rel: 'noopener' }, '₿ Jetzt online kaufen (Bitcoin, Lightning, USDT)'), h('div', { class: 'hint' }, 'Der Lizenzschlüssel kommt nach der Zahlung per E-Mail.')) : null),
        grp('Lizenzschlüssel eintragen', fld('Schlüssel (vollständig einfügen)', eingabe),
          h('div', { class: 'fld inline' }, h('button', { class: 'btn primary', onclick: einspielen }, '🔑 Lizenz einspielen'), st.vorhanden ? h('button', { class: 'btn', onclick: entfernen }, 'Lizenz entfernen') : null),
          h('div', { class: 'fld hint' }, 'Die Lizenz gilt für diese Installation mit allen Mandanten und wird ohne Internetverbindung geprüft. Sie liegt als lizenz.key im Datenordner und wird bei Updates nicht verändert.')));
    };
    api('/api/lizenz').then(zeige).catch(showError);
    p.append(box);
  });
  addTab('Krypto-Zahlung', p => {
    const ergebnis = h('div', { class: 'fld hint' });
    const testen = async () => {
      try {
        await api('/api/einstellungen', { method: 'PUT', body: changes });
        ergebnis.textContent = T('Verbinde …');
        const r = await api('/api/btcpay/test', { method: 'POST' });
        ergebnis.textContent = T(`✅ Verbunden mit Store „${r.store}“.`) + T(r.methoden.length ? ` Aktive Zahlungsarten: ${r.methoden.join(', ')}.` : ' Zahlungsarten konnten nicht gelesen werden (Recht „Store-Einstellungen ansehen“ fehlt).');
        await LK.load();
      } catch (e) { ergebnis.textContent = T('❌ ' + e.message); }
    };
    p.append(h('div', { class: 'groups' },
      grp('Bitcoin, Lightning und USDT über BTCPay Server',
        sb('btcpay.aktiv', 'Krypto-Zahlungen einschalten', '0'),
        si('btcpay.url', 'Adresse des BTCPay Servers (z. B. https://pay.meine-werkstatt.de)'),
        si('btcpay.storeid', 'Store-ID', '', true), si('btcpay.apikey', 'API-Schlüssel', '', true, 'password'),
        h('div', { class: 'fld hint' }, 'Den API-Schlüssel legen Sie in BTCPay unter Konto → API-Schlüssel an. Nötige Rechte: Payment Requests ansehen und ändern, Rechnungen ansehen, anlegen und ändern, Store-Einstellungen ansehen. Welche Zahlungsarten (Bitcoin, Lightning, USDT auf Liquid) angeboten werden, stellen Sie im BTCPay-Store ein. Das Geld geht direkt in Ihr eigenes Wallet.'),
        h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: testen }, '🔌 Speichern & Verbindung testen')), ergebnis),
      grp('Rechnungen',
        si('btcpay.gueltigtage', 'Zahlungslink gültig (Tage)', '30', true),
        sb('btcpay.pdf', 'QR-Code und Link auf die PDF-Rechnung drucken, wenn ein Zahlungslink angelegt ist', '1'),
        h('div', { class: 'fld hint' }, 'Den Zahlungslink legen Sie in der Rechnung im Reiter „Zahlungen“ an. Der Euro-Betrag steht fest, umgerechnet wird zum Kurs am Zahltag. Kuenta fragt alle 2 Minuten bei BTCPay nach und bucht bezahlte Rechnungen automatisch. In E-Mails setzt der Platzhalter {Zahlungslink} den Link ein, ohne Platzhalter kommt ein Hinweis vor den Gruß.')),
      grp('Buchhaltung',
        si('btcpay.konto', 'FIBU-Konto für Krypto-Zahlungseingänge', '1360', true),
        h('div', { class: 'fld hint' }, 'Vorgabe ist 1360 (Geldtransit, SKR03). Wie Krypto-Bestände gebucht werden, stimmen Sie bitte mit Ihrem Steuerberater ab. Die Zahlungen erscheinen mit der Zahlungsart „Krypto (BTCPay)“.'))));
  });
  addTab('Kasse', p => {
    const tseInfo = h('div', { class: 'hint fld' }, s.sw['tse.aktiv'] === '1' ? `TSE aktiv seit ${s.sw['tse.aktiviertam'] || ''} · Seriennummer ${s.sw['tse.seriennummer'] || ''}` : 'TSE nicht eingerichtet.');
    const schnell = JSON.parse(s.sw['kasse.schnelltasten'] || '[]');
    const schnellList = h('div', { class: 'fld' });
    const drawSchnell = () => { schnellList.innerHTML = ''; schnell.forEach((x, i) => schnellList.append(h('span', { class: 'chip', onclick: () => { schnell.splice(i, 1); changes.sw['kasse.schnelltasten'] = JSON.stringify(schnell); drawSchnell(); }, title: 'Klicken zum Entfernen' }, `${x.label} ✕`))); };
    drawSchnell();
    const barkunde = h('input', { type: 'text', readonly: true, value: s.sw['kasse.barkunde'] ? 'Kunde #' + s.sw['kasse.barkunde'] : '(ohne – Barverkauf)' });
    p.append(h('div', { class: 'groups' },
      grp('Allgemein', fld('Barverkaufskunde (Sammelkunde)', h('div', { class: 'inline' }, barkunde, h('button', { class: 'btn icon', onclick: async () => { const k = await pickKunde(); if (k) { changes.sw['kasse.barkunde'] = k.KUNID; barkunde.value = `${k.NUMMER} ${kname(k)}`; } } }, '🔍'))),
        sb('kasse.autorechnung', 'Die Kasse erzeugt zu jedem Barumsatz automatisch eine Rechnung', '1'), sb('kasse.kassenbuch', 'Bareinnahmen/-ausgaben ins Kassenbuch übertragen', '1'),
        sb('kasse.rechnungdrucken', 'Rechnung (A4) zusätzlich zum Bon drucken', '0'), si('kasse.seriennummer', 'Kassen-ID / Seriennummer der Kasse', 'KASSE1', true),
        (() => { const t = h('textarea', { rows: 2 }, s.sw['kasse.bonfusstext'] || T('Vielen Dank für Ihren Besuch!')); t.addEventListener('change', () => { changes.sw['kasse.bonfusstext'] = t.value; }); return fld('Fußtext auf dem Bon', t); })()),
      grp('Schnelltasten', schnellList, h('div', { class: 'fld inline' },
        h('button', { class: 'btn', onclick: async () => { const a = await pickRecord('artikel'); if (a) { schnell.push({ label: a.BEZEICHNUNG1.slice(0, 24), art: 'A', id: a.ARTID }); changes.sw['kasse.schnelltasten'] = JSON.stringify(schnell); drawSchnell(); } } }, '➕ Artikel'),
        h('button', { class: 'btn', onclick: async () => { const a = await pickRecord('arbeitswerte'); if (a) { schnell.push({ label: a.BEZEICHNUNG1.slice(0, 24), art: 'L', id: a.LEISTUNGID }); changes.sw['kasse.schnelltasten'] = JSON.stringify(schnell); drawSchnell(); } } }, '➕ Arbeitswert'))),
      grp('EC-Terminal (ZVT über TCP/IP)', sb('ec.aktiv', 'EC-Terminal verwenden', '0'), si('ec.ip', 'IP-Adresse', '', true), si('ec.port', 'Port', '20007', true), si('ec.passwort', 'Passwort', '000000', true, 'password'), sb('ec.ohneanmeldung', 'Keine Registrierung vor dem Betrag senden', '0'),
        h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => { await api('/api/einstellungen', { method: 'PUT', body: changes }); try { const r = await api('/api/kasse/ec/test', { method: 'POST' }); toast(r.meldung, r.ok ? 'ok' : 'err'); } catch (e) { showError(e); } } }, '🔌 Verbindung prüfen'))),
      grp('KassenSichV – Cloud-TSE (fiskaly SIGN DE)', tseInfo, si('tse.apikey', 'API-Key', '', true), si('tse.apisecret', 'API-Secret', '', true, 'password'),
        h('div', { class: 'fld hint' }, 'API-Key und Secret erhalten Sie im fiskaly-Dashboard (dashboard.fiskaly.com) unter "API-Keys". Ohne aktive TSE werden Bons mit dem Hinweis "Keine TSE aktiv" gespeichert.'),
        h('div', { class: 'fld inline' },
          h('button', { class: 'btn', onclick: async () => { await api('/api/einstellungen', { method: 'PUT', body: changes }); const pin = await promptDlg('Admin-PIN für die TSE festlegen (mind. 6 Zeichen) – bitte sicher notieren!', '', { type: 'password' }); if (!pin) return; try { const r = await api('/api/tse/einrichten', { method: 'POST', body: { adminPin: pin } }); await alertDlg(`TSE eingerichtet.\nSeriennummer: ${r.serial}\nTSS-ID: ${r.tss}\nClient-ID: ${r.client}\nAdmin-PUK: ${r.puk}\n\nBitte PIN und PUK sicher aufbewahren und die Kasse beim Finanzamt melden (§ 146a Abs. 4 AO).`, 'TSE aktiviert'); location.reload(); } catch (e) { showError(e); } } }, '🔐 TSE einrichten / aktivieren'),
          h('button', { class: 'btn', onclick: async () => { try { const r = await api('/api/tse/status'); alertDlg(JSON.stringify(r, null, 2), 'TSE-Status'); } catch (e) { showError(e); } } }, 'ℹ Status'),
          h('button', { class: 'btn', onclick: async () => { const von = await promptDlg('Export ab Datum (JJJJ-MM-TT)', today().slice(0, 4) + '-01-01'); if (von == null) return; try { await downloadUrl('/api/tse/export?' + qs({ von, bis: today() }), 'TSE.tar'); } catch (e) { showError(e); } } }, '📤 TSE-Export (TAR)')),
        h('div', { class: 'fld inline' }, h('label', { class: 'fld chk' }, (() => { const x = h('input', { type: 'checkbox', checked: s.sw['tse.aktiv'] === '1' }); x.addEventListener('change', () => { changes.sw['tse.aktiv'] = x.checked ? '1' : '0'; }); return x; })(), h('span', null, 'TSE-Signatur aktiv'))))));
  });
  addTab('Zeiterfassung', p => p.append(h('div', { class: 'groups' },
    grp('Zeiterfassung', (() => { const x = h('select', null, [['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'], ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'], ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen']].map(([k, l]) => h('option', { value: k, selected: (s.sw['zeit.bundesland'] || 'HE') === k }, l))); x.addEventListener('change', () => { changes.sw['zeit.bundesland'] = x.value; }); return fld('Bundesland (Feiertage)', x, true); })(),
      si('zeit.awminuten', 'Minuten je Arbeitswert (AW)', '6', true), sb('zeit.autopause', 'Gesetzliche Pause abziehen, wenn keine gestempelt wurde (ArbZG § 4)', '1'), sb('zeit.resturlaubuebertragen', 'Resturlaub ins neue Jahr übertragen', '1'),
      h('div', { class: 'fld hint' }, 'Mitarbeiter, Personal-Nr., Sollzeiten und Urlaubsanspruch unter Stammdaten → Benutzer / Mitarbeiter.')))));
  addTab('Einkauf / Handel', p => p.append(h('div', { class: 'groups' },
    grp('Einkauf', si('einkauf.gegenkonto', 'Standard-Gegenkonto für Eingangsrechnungen', '3400', true), oi('FIBU-Kreditor-Standard', 'Sammelkreditor (Lieferanten ohne eigenes Kreditorenkonto)', true), sb('einkauf.ekaktualisieren', 'Einkaufspreis der Artikel bei Wareneingang aktualisieren', '1')),
    grp('Fahrzeughandel', oi('FIBU-Erlöse-Fahrzeug', 'Erlöskonto Fahrzeugverkauf (Regelbesteuerung)', true), oi('FIBU-Erlöse-Fahrzeug-Diff', 'Erlöskonto Fahrzeugverkauf (§ 25a)', true), sb('handel.halterentfernen', 'Beim Umbuchen ins Lager die Halterzuordnung entfernen', '1'),
      (() => { const t = h('textarea', { rows: 4 }, s.sw['kaufvertrag.vorvertraglich'] || ''); t.addEventListener('change', () => { changes.sw['kaufvertrag.vorvertraglich'] = t.value; }); return fld('Standardtext vorvertragliche Informationen (Kaufvertrag)', t); })()))));
  addTab('Individuelle Felder', p => {
    const list = s.individuell.map(r => ({ ...r }));
    changes.individuell = list;
    const names = { 1: 'Fahrzeug Termin 1', 2: 'Fahrzeug Termin 2', 3: 'Fahrzeug Termin 3', 4: 'Fahrzeugdaten 1', 5: 'Fahrzeugdaten 2', 6: 'Fahrzeugdaten 3', 7: 'Fahrzeugdaten 4', 8: 'Fahrzeugdaten 5' };
    p.append(h('div', { class: 'note info', style: { marginBottom: '8px' } }, 'Bezeichnungen der individuellen Felder. Felder 10–25 erscheinen in den Vorgängen (Reiter "Sonstiges"), wenn sie aktiv sind.'),
      simpleTable([{ f: 'ID', l: 'Nr.' }, { f: 'w', l: 'Verwendung', render: r => names[r.ID] || (r.ID >= 10 && r.ID <= 25 ? `Vorgang Feld ${r.ID - 9}` : r.ID >= 26 ? `Artikel Feld ${r.ID - 25}` : '') },
        { f: 'BEZEICHNUNG', l: 'Bezeichnung', render: r => { const x = h('input', { type: 'text', value: r.BEZEICHNUNG || '' }); x.addEventListener('change', () => { r.BEZEICHNUNG = x.value; }); return x; } },
        { f: 'AKTIVE', l: 'aktiv', render: r => { const x = h('input', { type: 'checkbox', checked: Number(r.AKTIVE) === 1 }); x.addEventListener('change', () => { r.AKTIVE = x.checked ? 1 : 0; }); return x; } }], list));
  });
  addTab('Stammtabellen', p => {
    const t = [['zahlungsbedingungen', 'Zahlungsbedingungen'], ['einheiten', 'Einheiten (inkl. UN/ECE-Code)'], ['kostensaetze', 'Stundenverrechnungssätze'], ['auftragsarten', 'Auftragsarten'], ['warengruppen', 'Warengruppen'], ['hersteller', 'Hersteller'], ['zahlungsarten', 'Zahlungsarten'], ['textbausteine', 'Textbausteine (Positionen)'], ['drucktexte', 'Einleitungs-/Schlusstexte & Mahntexte'], ['laender', 'Länder'], ['reifenmarken', 'Reifenmarken'], ['farben', 'Fahrzeugfarben'], ['fibukonten', 'FIBU-Konten'], ['benutzer', 'Benutzer / Mitarbeiter']];
    p.append(h('div', { class: 'cards' }, t.map(([k, l]) => h('div', { class: 'card click', onclick: () => Views.tabelleDialog(k) }, h('div', { class: 'v', style: { fontSize: '15px' } }, l), h('div', { class: 's' }, 'bearbeiten …')))));
  });
  addTab('Protokoll', async p => {
    const rows = await api('/api/protokoll?limit=1000');
    p.append(h('div', { class: 'hint', style: { marginBottom: '6px' } }, 'Änderungsprotokoll (GoBD): wer hat wann was angelegt, geändert oder gelöscht.'), miniGrid([{ f: 'ZEIT', l: 'Zeit', w: 140 }, { f: 'BENUTZER', l: 'Benutzer', w: 100 }, { f: 'TABELLE', l: 'Tabelle', w: 150 }, { f: 'DATENSATZ', l: 'Datensatz', w: 80 }, { f: 'AKTION', l: 'Aktion', w: 90 }, { f: 'DATEN', l: 'Daten', w: 420 }], rows, { height: 'calc(100vh - 290px)' }).el);
  });
  main.append(title('Einstellungen', `Datenverzeichnis: ${s.datenpfad}`), tabs, body,
    h('div', { class: 'grid-footer' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => {
      try { await api('/api/einstellungen', { method: 'PUT', body: changes }); toast('Einstellungen gespeichert', 'ok'); await LK.load(); await App.loadSettings(); } catch (e) { showError(e); }
    } }, '💾 Einstellungen speichern')));
  const ziel = App.einstellungenTab && $$('button', tabs).find(b => b.textContent === T(App.einstellungenTab)); App.einstellungenTab = null;
  (ziel || first).click();
};
Views.tabelleDialog = (ent) => {
  const e = ENT.E[ent];
  let ov;
  const w = Win.open({ title: e.title, width: 900, height: 560, flex: true });
  ov = new Overview(ent, { onOpen: r => editRecord(ent, r[e.pk]).then(() => ov.reload()), buttons: [
    { label: 'Neu', icon: '➕', onClick: () => editRecord(ent, null).then(() => { ov.reload(); LK.load(); }) },
    { label: 'Bearbeiten', icon: '✏️', onClick: () => { const c = ov.current(); if (c) editRecord(ent, c[e.pk]).then(() => { ov.reload(); LK.load(); }); } },
    ...(ent === 'benutzer' ? [{ label: 'Rechte…', icon: '🔑', onClick: () => { const c = ov.current(); if (c) editRechte(c.BENUTZERID); } }] : []),
    { label: 'Löschen', icon: '🗑', onClick: async () => { const c = ov.current(); if (c && await confirmDlg('Eintrag löschen?', { danger: true, ok: 'Löschen' })) { try { await api(`/api/rec/${ent}/${c[e.pk]}`, { method: 'DELETE' }); ov.reload(); LK.load(); } catch (er) { showError(er); } } } }] });
  w.body.append(ov.el);
  w.onClose = () => LK.load();
};

// ---------------- Backup ----------------
Views.sicherung = async (main) => {
  const s = await api('/api/einstellungen');
  const pw = h('input', { type: 'password', placeholder: 'optional, mind. 6 Zeichen', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const ohne = h('input', { type: 'checkbox' });
  const auto = h('input', { type: 'checkbox', checked: (s.sw['sicherung.auto'] ?? '1') === '1' });
  const pfad = h('input', { type: 'text', value: s.sw['sicherung.pfad'] || '', placeholder: s.datenpfad + '/sicherungen' });
  const anzahl = h('input', { type: 'text', class: 'num', value: s.sw['sicherung.anzahl'] || '14' });
  const restorePw = h('input', { type: 'password' });
  const status = h('div');
  main.append(title('Datensicherung', 'Kuenta-Sicherung (*.kuenta)'), h('div', { class: 'view-scroll' }, h('div', { class: 'groups' },
    h('fieldset', { class: 'grp' }, h('legend', null, 'Daten sichern'), h('div', { class: 'fgrid' },
      h('div', { class: 'fld hint' }, `Letzte Sicherung: ${s.sw['sicherung.letzte'] ? fmt.datetime(s.sw['sicherung.letzte']) : 'noch keine'}`),
      fld('Passwort (verschlüsselt mit AES-256)', pw, true), fld('Passwort wiederholen', pw2, true),
      h('label', { class: 'fld chk' }, ohne, h('span', null, 'ohne Dokumente/Bilder (kleinere Datei)')),
      h('div', { class: 'fld' }, h('button', { class: 'btn primary', onclick: async () => {
        if (pw.value && pw.value.length < 6) { toast('Das Passwort muss mindestens 6 Zeichen haben.', 'err'); return; }
        if (pw.value !== pw2.value) { toast('Die Passwörter stimmen nicht überein.', 'err'); return; }
        status.innerHTML = ''; status.append(h('div', { class: 'note info' }, 'Sicherung wird erstellt …'));
        try { await downloadUrl('/api/sicherung?' + qs({ passwort: pw.value, ohneDateien: ohne.checked ? 1 : '' }), 'Kuenta.kuenta'); status.innerHTML = ''; status.append(h('div', { class: 'note ok' }, '✔ Die Datensicherung wurde erstellt und heruntergeladen. Bewahren Sie sie an einem sicheren Ort auf (z. B. USB-Stick, NAS).')); }
        catch (e) { status.innerHTML = ''; showError(e); }
      } }, '💾 Jetzt sichern & herunterladen')), status)),
    h('fieldset', { class: 'grp' }, h('legend', null, 'Automatische Sicherung'), h('div', { class: 'fgrid' },
      h('label', { class: 'fld chk' }, auto, h('span', null, 'täglich automatisch sichern (beim ersten Start des Tages)')),
      fld('Sicherungsordner auf dem Server', pfad), fld('Anzahl aufbewahrter Sicherungen', anzahl, true),
      h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => { await api('/api/einstellungen', { method: 'PUT', body: { sw: { 'sicherung.auto': auto.checked ? '1' : '0', 'sicherung.pfad': pfad.value, 'sicherung.anzahl': anzahl.value } } }); toast('Gespeichert', 'ok'); } }, '💾 Übernehmen')))),
    h('fieldset', { class: 'grp' }, h('legend', null, 'Daten wiederherstellen'), h('div', { class: 'fgrid' },
      h('div', { class: 'fld note' }, 'Achtung: Die aktuellen Daten werden durch die Sicherung ersetzt. Vorher wird automatisch eine Sicherheitskopie im Datenverzeichnis angelegt.'),
      fld('Passwort der Sicherung (falls vergeben)', restorePw),
      h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => {
        const f = await pickFile('.kuenta,.kft,.swb'); if (!f) return;
        if (!(await confirmDlg(`Daten aus "${f.name}" wiederherstellen?\nAlle aktuellen Daten werden ersetzt.`, { danger: true, ok: 'Wiederherstellen' }))) return;
        try {
          const r = await api('/api/sicherung/wiederherstellen', { method: 'POST', body: f, headers: { 'X-Passwort': encodeURIComponent(restorePw.value) } });
          await alertDlg(`Die Daten wurden wiederhergestellt (Sicherung vom ${fmt.datetime(r.meta.erstellt.replace('T', ' '))}).`, 'Wiederherstellung erfolgreich');
          location.reload();
        } catch (e) { showError(e); }
      } }, '📂 Sicherung auswählen & wiederherstellen')))))));
};

// ---------------- Import from KFZ-Faktura ----------------
Views.import = async (main) => {
  const pw = h('input', { type: 'password', placeholder: 'nur falls die Sicherung ein Passwort hat' });
  const dateien = h('input', { type: 'checkbox', checked: true });
  const status = h('div');
  const dbSel = h('select', null, h('option', { value: '' }, 'Livedaten (DB1)'), h('option', { value: 'db/DB0.bak' }, 'Demodaten (DB0)'));
  const ordner = h('input', { type: 'text', placeholder: 'z. B. C:\\KFZ-Faktura' });
  const vorschlaege = await api('/api/import/ordnervorschlag').catch(() => []);
  if (vorschlaege.length) ordner.value = vorschlaege[0];
  const showResult = r => {
    const st = r.stats || {};
    const n = k => (st[k] || 0).toLocaleString(LOCALE);
    status.innerHTML = '';
    status.append(h('div', { class: 'note ok' }, h('b', null, '✔ Import erfolgreich. '), `Kunden: ${n('KUNDEN')} · Fahrzeuge: ${n('FAHRZEUGE')} · Rechnungen: ${n('RECHNUNGEN')} · Positionen: ${n('RECHNUNGEN_POS')} · Angebote: ${n('ANGEBOTE')} · Aufträge: ${n('AUFTRAEGE')} · Zahlungen: ${n('ZAHLUNGSEINGAENGE')} · Kassenbuch: ${n('KASSENBUCH')} · Reifeneinlagerungen: ${n('REIFENEINLAGERUNG')} · Artikel: ${n('ARTIKEL')}`,
      r.files ? h('div', null, `Dokumente/Bilder: ${r.files.dokumente}${r.files.logo ? ' · Firmenlogo übernommen' : ''}`) : null,
      r.header ? h('div', { class: 'hint' }, `Quelle: ${r.header.file || ''} · Sicherung vom ${r.header.date || ''}`) : null,
      r.skippedCount ? h('div', { class: 'hint' }, `${r.skippedCount} Datensätze konnten nicht übernommen werden.`) : null,
      r.behalten ? h('div', null, '✔ Kuenta-eigene Daten übernommen' + (Object.keys(r.behalten.tabellen || {}).length ? ': ' + Object.entries(r.behalten.tabellen).map(([t, c]) => `${t.replace(/^SW_/, '').toLowerCase()} ${c.toLocaleString(LOCALE)}`).join(' · ') : '') + '.') : null,
      r.safetyCopy ? h('div', { class: 'hint' }, `Die vorherigen Kuenta-Daten wurden gesichert: ${r.safetyCopy}`) : null),
      h('button', { class: 'btn primary', style: { marginTop: '8px' }, onclick: () => { location.hash = '#start'; location.reload(); } }, 'Weiter zur Übersicht'));
  };
  const busy = msg => { status.innerHTML = ''; status.append(h('div', { class: 'note info' }, '⏳ ' + msg)); };
  // Before importing, show what will be replaced and what is kept. Result: null = cancel, otherwise { behalten }
  const bestaetigen = async (quelle) => {
    let v = { ersetzt: [], bleibt: [] };
    try { v = await api('/api/import/vorschau'); } catch { /* empty database or similar */ }
    const n = x => x.toLocaleString(LOCALE);
    const behalten = h('input', { type: 'checkbox', checked: true });
    const content = h('div', { style: { display: 'grid', gap: '10px', lineHeight: 1.5 } },
      h('div', null, `Daten aus „${quelle}“ importieren?`),
      v.ersetzt.length ? h('div', { class: 'note warn' },
        h('b', null, v.letzterImport ? `Seit dem letzten Import (${fmt.datetime(v.letzterImport)}) in Kuenta angelegt oder geändert – wird durch den Stand aus KFZ-Faktura ersetzt:` : 'Diese Daten in Kuenta werden durch den Stand aus KFZ-Faktura ersetzt:'),
        h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, v.ersetzt.map(e => h('li', null, `${e.name}: ${n(e.anzahl)}`)))) : null,
      v.bleibt.length ? h('div', { class: 'note ok' },
        h('b', null, 'Bleibt erhalten (gibt es nur in Kuenta):'),
        h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, v.bleibt.map(e => h('li', null, `${e.name}: ${n(e.anzahl)}`))),
        h('div', { class: 'hint' }, 'Ebenso Kuenta-eigene Felder wie E-Rechnungs-Einstellungen der Kunden.')) : null,
      h('label', { class: 'fld chk' }, behalten, h('span', null, 'Kuenta-eigene Daten behalten (empfohlen). Ohne Haken wird alles durch die Sicherung ersetzt.')),
      h('div', { class: 'hint' }, 'Vorher wird automatisch eine Sicherheitskopie der bisherigen Daten angelegt.'));
    const ok = await dialog('Import bestätigen', content, [{ label: 'Importieren', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 620 });
    return ok ? { behalten: behalten.checked } : null;
  };
  const importFile = async (f) => {
    if (!f) return;
    busy(`Prüfe "${f.name}" …`);
    try {
      const info = await api('/api/import/pruefen', { method: 'POST', body: f });
      if (info.error) { status.innerHTML = ''; status.append(h('div', { class: 'note err' }, info.error)); return; }
      const wahl = await bestaetigen(f.name);
      if (!wahl) { status.innerHTML = ''; return; }
      busy('Importiere Daten – bei großen Datenbeständen kann das eine Minute dauern …');
      const r = await api('/api/import/kfz?' + qs({ db: dbSel.value, dateien: dateien.checked ? 1 : 0, behalten: wahl.behalten ? 1 : 0 }), { method: 'POST', body: f, headers: { 'X-Passwort': encodeURIComponent(pw.value) } });
      showResult(r);
    } catch (e) {
      status.innerHTML = '';
      status.append(h('div', { class: 'note err' }, e.code === 'PASSWORD' ? '🔒 ' + e.message + ' Bitte das Passwort der KFZ-Faktura-Datensicherung eingeben und erneut versuchen.' : e.message));
    }
  };
  const dz = h('div', { class: 'dropzone', style: { padding: '30px' } }, '📂 KFZ-Faktura-Datensicherung (*.kfz) oder Datenbanksicherung (DB1.bak / *.fbk) hierher ziehen oder klicken');
  dz.addEventListener('click', async () => importFile(await pickFile('.kfz,.bak,.fbk,.zip')));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); importFile(e.dataTransfer.files[0]); });
  main.append(title('Daten aus KFZ-Faktura übernehmen'), h('div', { class: 'view-scroll' },
    h('div', { class: 'note info', style: { marginBottom: '10px', lineHeight: 1.6 } }, 'Übernommen werden alle Daten: Kunden, Fahrzeuge, Artikel, Arbeitswerte, Lieferanten, Reifeneinlagerungen, Angebote, Aufträge, Lieferscheine, Rechnungen, Rechnungskorrekturen, Zahlungen, Offene Posten, Mahnungen, Kassenbuch, FIBU-Buchungen, Textbausteine, Einstellungen, Nummernkreise sowie Dokumente, Bilder und das Firmenlogo. Daten, die es nur in Kuenta gibt (E-Mail- und Kasseneinstellungen, Kassenbons, Zeiterfassung, Termine, Eingangsrechnungen, Kuenta-eigene Felder), bleiben dabei erhalten.'),
    h('div', { class: 'groups' },
      h('fieldset', { class: 'grp' }, h('legend', null, '1. Aus einer KFZ-Faktura-Datensicherung (empfohlen)'), h('div', { class: 'fgrid' },
        h('div', { class: 'fld hint' }, 'In KFZ-Faktura: Menü "KFZ-Faktura" → "Daten sichern" erzeugt eine Datei KFZ-FakturaBackup_….kfz.'),
        fld('Passwort der Sicherung', pw, true), fld('Datenbank', dbSel, true), h('label', { class: 'fld chk' }, dateien, h('span', null, 'Dokumente, Bilder und Logo mit übernehmen')), h('div', { class: 'fld' }, dz))),
      h('fieldset', { class: 'grp' }, h('legend', null, '2. Direkt aus dem KFZ-Faktura-Programmordner (nur Windows)'), h('div', { class: 'fgrid' },
        h('div', { class: 'fld hint' }, 'Liest die Datenbank direkt (db\\DB1.FDB). KFZ-Faktura muss dafür geschlossen sein.'),
        fld('Programmordner von KFZ-Faktura', ordner),
        h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => {
          const wahl = await bestaetigen(ordner.value);
          if (!wahl) return;
          busy('Lese KFZ-Faktura-Datenbank …');
          try { showResult(await api('/api/import/ordner', { method: 'POST', body: { pfad: ordner.value, db: dbSel.value === 'db/DB0.bak' ? 'DB0.FDB' : 'DB1.FDB', dateien: dateien.checked, behalten: wahl.behalten } })); }
          catch (e) { status.innerHTML = ''; status.append(h('div', { class: 'note err' }, e.message)); }
        } }, '📥 Aus Ordner importieren'))))),
    h('div', { style: { marginTop: '10px' } }, status)));
};
