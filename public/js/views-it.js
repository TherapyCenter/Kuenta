'use strict';
/* global title, h, api, qs, fmt, showError, downloadUrl, miniGrid, Views, today, LK, T, dateRange, addMonths, addDays */
// Italian tax system: settings tab (IVA, regime fiscale, company details, stamp duty, settlement) and the view
// "IVA (Italia)" (periodic settlement with F24 code, sales VAT register)

const ItUI = {
  activo() { return !!(LK.data && LK.data.land === 'IT'); },
  settingsTab(p, { s, changes, si, sb, grp, fld, ob }) {
    const sel = (k, label, opts, def) => { const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] ?? def) === v }, l))); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return fld(label, x); };
    p.append(h('div', { class: 'groups' },
      grp('IVA',
        si('it.iva.ordinaria', 'Aliquota ordinaria %', '22', true), si('it.iva.ridotta', 'Aliquota ridotta %', '10', true), si('it.iva.ridotta2', 'Zweiter ermäßigter Satz % (4 oder 5)', '4', true),
        ob('Kleinunternehmer', 'Regime forfettario (L. 190/2014) – Rechnungen ohne IVA'),
        sel('it.liquidazione.periodo', 'Liquidazione IVA', [['mensile', 'monatlich (mensile)'], ['trimestrale', 'vierteljährlich (trimestrale, +1 % Zinsen)']], 'mensile'),
        sb('it.bollo', 'Marca da bollo virtuale (2 €) bei Rechnungen ohne IVA über 77,47 € ausweisen', '1'),
        h('div', { class: 'fld hint' }, 'Die Partita IVA (11 Ziffern) gehört unter Firmendaten → USt-IdNr., der Codice Fiscale unter Steuernummer (leer = wie Partita IVA). Beim Kunden: Partita IVA unter USt-IdNr., Codice Fiscale, Codice destinatario SdI bzw. PEC und Split payment unter Steuer & Buchhaltung. Den Ort mit Provinz eintragen, z. B. „Milano (MI)“. Belegsprache Italiano unter Vorgabewerte → Sprache. Gedruckte Rechnungen sind gesperrt; Korrekturen als Nota di credito.')),
      grp('Dati azienda (art. 2250 c.c.)',
        si('it.provincia', 'Provinz der Firma (Sigla, z. B. MI)', '', true),
        si('it.rea.ufficio', 'REA: Ufficio (Sigla der Provinz)', '', true), si('it.rea.numero', 'REA: Numero', '', true),
        si('it.capitale', 'Capitale sociale € (z. B. 10.000,00)', '', true),
        sb('it.sociounico', 'Socio unico', '0'), sb('it.liquidazione', 'Società in liquidazione', '0')),
      grp('Fattura elettronica (SdI)',
        h('div', { class: 'fld hint' }, 'Jede Rechnung ist in Italien eine elektronische Rechnung im Format FatturaPA. KuentaPOS erzeugt die XML-Datei (Rechnung → Fattura elettronica). Sie senden sie selbst über das Portal „Fatture e Corrispettivi“ der Agenzia delle Entrate, per PEC an das SdI oder über Ihren Dienstleister. Der Ausdruck ist eine copia di cortesia. An der Kasse wird jeder Verkauf als Rechnung erfasst; der Bon selbst ist kein Steuerbeleg (für documenti commerciali ist ein zugelassenes RT-Gerät nötig).'))));
  },
};

Views.itIva = async (main) => {
  let von = addMonths(today().slice(0, 7) + '-01', -1), bis = addDays(today().slice(0, 7) + '-01', -1);
  const out = h('div');
  const credito = h('input', { type: 'text', class: 'num', value: '0,00', style: { width: '110px' } });
  const berechnen = async () => {
    out.textContent = '';
    try {
      const r = await api('/api/it/liquidazione?' + qs({ von, bis, credito: credito.value }));
      const neg = v => (v ? -v : 0); // no "-0,00"
      const rows = [
        ...r.aliquote.map(a => ({ voce: `${T('Vendite')} ${fmt.num(a.aliquota)} %`, imponibile: a.imponibile, imposta: a.imposta })),
        { voce: 'Non imponibili (esportazioni, cessioni intracomunitarie)', imponibile: r.nonImponibili, imposta: null },
        { voce: 'Non soggette (art. 7-ter, regime forfettario)', imponibile: r.nonSoggette, imposta: null },
        { voce: 'Esenti (art. 10)', imponibile: r.esenti, imposta: null },
        { voce: 'Regime del margine (vendite)', imponibile: r.margine.vendite, imposta: r.margine.imposta },
        { voce: 'IVA split payment (versata dal cliente)', imponibile: null, imposta: neg(r.split) },
        { voce: 'IVA a debito', imponibile: null, imposta: r.debito },
        { voce: 'IVA detraibile (acquisti)', imponibile: null, imposta: neg(r.detraibile) },
        { voce: 'Credito del periodo precedente', imponibile: null, imposta: neg(r.creditoPrecedente) },
        ...(r.interessi ? [{ voce: 'Interessi 1 % (liquidazione trimestrale)', imponibile: null, imposta: r.interessi }] : []),
      ];
      out.append(miniGrid([{ f: 'voce', l: 'Voce', w: 470 }, { f: 'imponibile', l: 'Imponibile', w: 150, t: 'money' }, { f: 'imposta', l: 'Imposta', w: 140, t: 'money' }], rows).el,
        h('div', { class: 'note ' + (r.aCredito ? 'ok' : 'info'), style: { marginTop: '8px' } },
          r.aCredito ? `${T('IVA a credito')}: ${fmt.money(r.aCredito)} – ${T('wird in den nächsten Zeitraum übertragen')}`
            : `${T('IVA da versare')}: ${fmt.money(r.daVersare)} · F24 codice tributo ${r.f24.codice} (${r.f24.scadenza})`),
        h('div', { class: 'hint' }, `${r.periodo === 'trimestrale' ? T('Liquidazione trimestrale') : T('Liquidazione mensile')} · ${r.rechnungen} ${T('Rechnungen')}, ${r.acquisti} ${T('Eingangsrechnungen')}${r.escluse ? ` · ${T('Escluse art. 15 (nicht in der Abrechnung)')}: ${fmt.money(r.escluse)}` : ''}`));
    } catch (e) { showError(e); }
  };
  main.append(title('IVA (Italia)', 'Liquidazione periodica und Registro IVA delle vendite'),
    h('div', { class: 'view-scroll' },
      h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; }),
        h('label', { class: 'inline' }, T('Credito precedente'), credito),
        h('button', { class: 'btn primary', onclick: berechnen }, '🧮 ' + T('Berechnen')),
        h('button', { class: 'btn', onclick: () => downloadUrl('/api/it/registro?' + qs({ von, bis }), 'Registro_IVA_vendite.csv') }, '⬇ ' + T('Registro vendite (CSV)'))),
      h('div', { class: 'hint', style: { maxWidth: '900px', margin: '4px 0 10px' } }, 'IVA a debito aus den Rechnungen (nach Rechnungsdatum), IVA detraibile aus den Eingangsrechnungen. Die Comunicazione delle liquidazioni periodiche (LIPE) und die Dichiarazione IVA reichen Sie bzw. Ihr Commercialista ein; die Zahlen dafür stehen hier.'),
      out));
  berechnen();
};
