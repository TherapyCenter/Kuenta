'use strict';
/* global h, $, $$, fmt, api, qs, parseNum, LK, ENT, Win, toast, showError, confirmDlg, promptDlg, dialog, alertDlg, Overview, miniGrid, editRecord, pickKunde, pickRecord, pickFahrzeug, Vorgang, Zahlung, Print, App, today, addDays, addMonths, downloadUrl, pickFile, saveBlob, kname, r2, Pref, Views, SUBS, Form */

const fld2 = (label, el, w1) => h('label', { class: 'fld' + (w1 ? ' w1' : '') }, h('span', null, label), el);
const titel = (t, sub) => h('div', { class: 'view-title' }, t, sub ? h('span', { class: 'sub' }, sub) : null);
const fileToBase64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });

// ================= Email =================
const Mail = {
  async dialog(art, typ, id) {
    let v;
    try { v = await api(`/api/mail/vorlage/${art}/${typ || '-'}/${id}`); } catch (e) { showError(e); return; }
    const isRe = art === 'vorgang' && ENT.V[typ] && ENT.V[typ].table === 'RECHNUNGEN';
    const to = h('input', { type: 'email', value: v.to, multiple: true, style: { width: '100%' } });
    const cc = h('input', { type: 'text', style: { width: '100%' } });
    const betreff = h('input', { type: 'text', value: v.betreff, style: { width: '100%' } });
    const text = h('textarea', { rows: 10, style: { width: '100%' } }, v.text);
    const fmtSel = h('select', null, [['pdf', 'PDF'], ...(isRe ? [['zugferd', 'ZUGFeRD-PDF (PDF mit eingebetteter XRechnung)'], ['xrechnung', 'XRechnung (CII) als XML'], ['xrechnung-ubl', 'XRechnung (UBL) als XML']] : [])].map(([k, l]) => h('option', { value: k }, l)));
    fmtSel.value = isRe ? ({ 1: 'xrechnung', 2: 'xrechnung-ubl', 3: 'zugferd' }[v.format] || 'pdf') : 'pdf';
    const pdfDazu = h('input', { type: 'checkbox', checked: true });
    const extra = []; const extraList = h('div', { class: 'hint' });
    const content = h('div', { class: 'fgrid' }, fld2('An (mehrere mit Komma trennen)', to), fld2('CC', cc), fld2('Betreff', betreff), fld2('Nachricht', text),
      art === 'vorgang' ? fld2('Anhang', fmtSel) : h('div', { class: 'fld hint' }, 'Die Mahnung wird als PDF angehängt.'),
      isRe ? h('label', { class: 'fld chk' }, pdfDazu, h('span', null, 'bei XRechnung zusätzlich die PDF-Ansicht anhängen')) : null,
      h('div', { class: 'fld' }, h('button', { class: 'btn sm', onclick: async () => { const fs = await pickFile('*/*', true); for (const f of fs || []) { extra.push({ name: f.name, type: f.type, base64: await fileToBase64(f) }); } extraList.textContent = T(extra.map(e => '📎 ' + e.name).join('  ')); } }, '📎 Weitere Dateien anhängen'), extraList));
    const viaProgramm = v.versand === 'programm';
    if (viaProgramm) content.append(h('div', { class: 'fld hint' }, 'Die E-Mail wird mit Anhang in Ihrem Mailprogramm (z. B. Thunderbird) geöffnet. Dort prüfen und senden – sie liegt danach im Ordner „Gesendet“.'));
    const r = await dialog('Per E-Mail senden', content, [{ label: viaProgramm ? 'Im Mailprogramm öffnen' : 'Senden', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 680 });
    if (!r) return;
    try {
      const res = await api('/api/mail/senden', { method: 'POST', body: { art, typ, id, to: to.value, cc: cc.value, betreff: betreff.value, text: text.value, format: fmtSel.value, pdfDazu: pdfDazu.checked, anhaenge: extra } });
      toast(res.programm ? `E-Mail an ${res.programm} übergeben – bitte dort senden (${res.anhaenge})` : `E-Mail gesendet (${res.anhaenge})`, 'ok');
      if (typ && ENT.V[typ]) App.refresh(ENT.V[typ].ent);
    } catch (e) { showError(e); }
  },
};

// ================= Down payment / partial invoice =================
const Anzahlung = {
  async dialog(auftragid) {
    let data = await api('/api/anzahlung/' + auftragid);
    const cols = [{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'art', l: 'Art', w: 100, render: r => Number(r.ART) === 2 ? 'Abschlag' : 'Anzahlung' }, { f: 'BEZEICHNUNG', l: 'Bezeichnung', w: 220 }, { f: 'NETTO', l: 'Netto', w: 100, t: 'money' }, { f: 'RECHNUNGNUMMER', l: 'Rechnung', w: 90 }, { f: 'GBRUTTO', l: 'Brutto', w: 100, t: 'money' }];
    const g = miniGrid(cols, data.rows, { height: 260, empty: 'Noch keine Anzahlungen.' });
    const info = h('div', { class: 'note info' }, `Auftrag ${data.auftrag.nr} · ${data.auftrag.kunde} · Auftragswert netto ${fmt.money(data.auftrag.netto)} / brutto ${fmt.money(data.auftrag.brutto)}`);
    const refresh = async () => { data = await api('/api/anzahlung/' + auftragid); g.set(data.rows); };
    const edit = async (row = {}) => {
      const art = h('select', null, h('option', { value: 1 }, 'Anzahlung'), h('option', { value: 2 }, 'Abschlag')); art.value = row.ART || 1;
      const datum = h('input', { type: 'date', value: row.DATUM || today() });
      const bez = h('input', { type: 'text', value: row.BEZEICHNUNG || 'Anzahlung' });
      const netto = h('input', { type: 'text', class: 'num', value: row.NETTO != null ? fmt.num2(row.NETTO) : '' });
      const pct = h('input', { type: 'text', class: 'num', placeholder: '%', style: { width: '70px' } });
      const mw = h('select', null, LK.list('mwst').map(m => h('option', { value: m.id }, m.name))); mw.value = row.MWST || 61;
      const c = h('div', { class: 'fgrid' }, fld2('Art', art, 1), fld2('Datum', datum, 1), fld2('Bezeichnung', bez),
        fld2('Nettobetrag', h('div', { class: 'inline' }, netto, pct, h('button', { class: 'btn sm', onclick: () => { netto.value = fmt.num2(data.auftrag.netto * parseNum(pct.value) / 100); } }, '% berechnen')), 1), fld2('MwSt', mw, 1));
      const ok = await dialog('Anzahlung / Abschlag', c, [{ label: 'OK', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 560 });
      if (!ok) return;
      try { await api('/api/anzahlung', { method: 'POST', body: { ID: row.ID, AUFTRAGID: auftragid, ART: art.value, DATUM: datum.value, BEZEICHNUNG: bez.value, NETTO: parseNum(netto.value), MWST: mw.value } }); refresh(); } catch (e) { showError(e); }
    };
    const w = Win.open({ title: 'Anzahlungen / Abschläge', width: 820, content: h('div', { class: 'win-body flex', style: { padding: 0 } }, info, g.el) });
    w.setButtons([
      { label: 'Neu', icon: '➕', onClick: () => edit() },
      { label: 'Bearbeiten', icon: '✏️', onClick: () => { const c = g.current(); if (c) edit(c); } },
      { label: 'Löschen', icon: '🗑', onClick: async () => { const c = g.current(); if (c && await confirmDlg('Anzahlung löschen?')) { try { await api('/api/anzahlung/' + c.ID, { method: 'DELETE' }); refresh(); } catch (e) { showError(e); } } } },
      '|',
      { label: 'Anzahlungsrechnung erstellen', icon: '💶', cls: 'primary', onClick: async () => { const c = g.current(); if (!c) return; try { const r = await api(`/api/anzahlung/${c.ID}/rechnung`, { method: 'POST' }); toast(`Rechnung ${r.nr} erstellt`, 'ok'); await refresh(); App.refresh('rechnungen'); Vorgang.open('rechnung', r.id); } catch (e) { showError(e); } } },
      { label: 'Schließen', onClick: () => w.close() }]);
  },
};

// ================= Purchasing =================
const Eingang = {
  async open(id) {
    await LK.ensure();
    let d = id ? await api('/api/eingang/' + id) : { kopf: { DATUM: today(), STEUERSATZ: 19, LAGERGEBUCHT: 1, GEGENKONTO: App.setting('einkauf.gegenkonto', '3400') }, pos: [], zahlungen: [], offen: 0 };
    return new Promise(resolve => {
      const k = { ...d.kopf }; let pos = d.pos.map(p => ({ ...p }));
      const inp = (f, type = 'text', attrs = {}) => { const e = h('input', { type, value: k[f] ?? '', class: attrs.num ? 'num' : '', ...attrs }); e.addEventListener('change', () => { k[f] = attrs.num ? parseNum(e.value) : e.value; upd(); }); return e; };
      const liefTxt = h('input', { type: 'text', readonly: true, value: k.LIEFNAME || '' });
      const brutto = inp('BRUTTO', 'text', { num: true }); brutto.value = k.BRUTTO != null ? fmt.num2(k.BRUTTO) : '';
      const satz = h('select', null, [19, 7, 0].map(s => h('option', { value: s }, s + ' %'))); satz.value = k.STEUERSATZ ?? 19; satz.addEventListener('change', () => { k.STEUERSATZ = Number(satz.value); upd(); });
      const sum = h('div', { class: 'hint' });
      const lager = h('input', { type: 'checkbox', checked: Number(k.LAGERGEBUCHT) === 1, onchange: () => { k.LAGERGEBUCHT = lager.checked ? 1 : 0; } });
      const upd = () => {
        if (pos.length) { let n = 0, m = 0; for (const p of pos) { const s = r2(parseNum(p.MENGE) * parseNum(p.EKNETTO)); n += s; m += s * parseNum(p.STEUERSATZ ?? 19) / 100; } sum.textContent = T(`Netto ${fmt.money(n)} · USt ${fmt.money(m)} · Brutto ${fmt.money(n + m)} (aus Positionen)`); brutto.readOnly = true; brutto.value = fmt.num2(r2(n + m)); }
        else { const b = parseNum(k.BRUTTO); const n = r2(b / (1 + Number(k.STEUERSATZ ?? 19) / 100)); sum.textContent = T(`Netto ${fmt.money(n)} · USt ${fmt.money(r2(b - n))}`); brutto.readOnly = false; }
      };
      const kopfPane = h('div', { class: 'groups' },
        h('fieldset', { class: 'grp' }, h('legend', null, 'Rechnungsdaten'), h('div', { class: 'fgrid' },
          fld2('Lieferant', h('div', { class: 'inline' }, liefTxt, h('button', { class: 'btn icon', onclick: async () => { const l = await pickRecord('lieferanten'); if (l) { k.LIEFID = l.LIEFID; k.LIEFNAME = l.NAME; liefTxt.value = l.NAME; const full = await api('/api/rec/lieferanten/' + l.LIEFID); if (full.GEGENKONTO) { k.GEGENKONTO = full.GEGENKONTO; gk.value = full.GEGENKONTO; } } } }, '🔍'))),
          fld2('Rechnungs-Nr. des Lieferanten', inp('RECHNUNGSNR'), 1), fld2('Rechnungsdatum', inp('DATUM', 'date'), 1),
          fld2('Fällig am', inp('FAELLIG', 'date'), 1), fld2('Leistungsdatum', inp('LEISTUNGSDATUM', 'date'), 1),
          fld2('Bruttobetrag', brutto, 1), fld2('Steuersatz', satz, 1), h('div', { class: 'fld' }, sum),
          fld2('Skonto %', inp('SKONTO', 'text', { num: true }), 1), fld2('Skonto bis', inp('SKONTOBIS', 'date'), 1))),
        h('fieldset', { class: 'grp' }, h('legend', null, 'Buchung'), h('div', { class: 'fgrid' },
          fld2('Gegenkonto (Aufwand, z. B. 3400 Wareneingang)', inp('GEGENKONTO')),
          h('label', { class: 'fld chk' }, lager, h('span', null, 'Artikel-Positionen ins Lager buchen (Wareneingang)')),
          fld2('Bemerkung', (() => { const t = h('textarea', { rows: 3 }, k.BEMERKUNG || ''); t.addEventListener('change', () => { k.BEMERKUNG = t.value; }); return t; })()),
          k.ERECHNUNGFORMAT ? h('div', { class: 'fld' }, h('span', { class: 'badge ok' }, 'E-Rechnung: ' + k.ERECHNUNGFORMAT), ' ', h('button', { class: 'btn sm', onclick: () => Print.erechnungAnsicht(k.ERECHNUNG) }, '👁 Visualisieren')) : null)));
      const gk = $('input', kopfPane.children[1]);
      // line items
      const posWrap = h('div', { class: 'pos-wrap', style: { minHeight: '220px' } });
      const drawPos = () => {
        const tbl = h('table', { class: 'pos' }, h('thead', null, h('tr', null, h('th', null, 'Artikel-Nr.'), h('th', null, 'Bezeichnung'), h('th', { class: 'num' }, 'Menge'), h('th', { class: 'num' }, 'EK netto'), h('th', null, 'USt %'), h('th', { class: 'num' }, 'Summe'), h('th'))));
        const tb = h('tbody');
        pos.forEach((p, i) => {
          const cell = (f, cls, fm = x => x ?? '') => { const e = h('input', { type: 'text', class: cls || '', value: fm(p[f]) }); e.addEventListener('change', () => { p[f] = cls ? parseNum(e.value) : e.value; upd(); drawPos(); }); return e; };
          const s = h('select', null, [19, 7, 0].map(x => h('option', { value: x, selected: Number(p.STEUERSATZ ?? 19) === x }, x + ' %'))); s.addEventListener('change', () => { p.STEUERSATZ = Number(s.value); upd(); });
          tb.append(h('tr', null, h('td', null, h('div', { class: 'inline' }, cell('ARTNUMMER'), h('button', { class: 'btn icon sm', title: 'Artikel wählen', onclick: async () => { const a = await pickRecord('artikel'); if (a) { Object.assign(p, { ARTID: a.ARTID, ARTNUMMER: a.ARTNUMMER, BEZEICHNUNG: a.BEZEICHNUNG1, EKNETTO: p.EKNETTO || a.EKPNETTO }); upd(); drawPos(); } } }, '🔍'))),
            h('td', null, cell('BEZEICHNUNG')), h('td', null, cell('MENGE', 'num', x => fmt.num(x, 3))), h('td', null, cell('EKNETTO', 'num', x => fmt.num2(x))), h('td', null, s),
            h('td', { class: 'r' }, fmt.money0(r2(parseNum(p.MENGE) * parseNum(p.EKNETTO)))), h('td', null, h('button', { class: 'btn icon sm', onclick: () => { pos.splice(i, 1); upd(); drawPos(); } }, '🗑'))));
        });
        tbl.append(tb); posWrap.innerHTML = ''; posWrap.append(tbl);
        if (!pos.length) posWrap.append(h('div', { class: 'grid-empty' }, 'Positionen sind optional – nötig für Lagerbuchung und EK-Aktualisierung.'));
      };
      const posPane = h('div', { class: 'win-body flex', style: { padding: 0 } }, h('div', { class: 'form-row' },
        h('button', { class: 'btn', onclick: async () => { const a = await pickRecord('artikel'); if (a) { pos.push({ ARTID: a.ARTID, ARTNUMMER: a.ARTNUMMER, BEZEICHNUNG: a.BEZEICHNUNG1, MENGE: 1, EKNETTO: a.EKPNETTO || 0, STEUERSATZ: 19 }); upd(); drawPos(); } } }, '📦 Artikel'),
        h('button', { class: 'btn', onclick: () => { pos.push({ MENGE: 1, EKNETTO: 0, STEUERSATZ: Number(k.STEUERSATZ ?? 19) }); drawPos(); } }, '➕ Freie Position')), posWrap);
      // payments
      const zahlPane = h('div');
      const drawZahl = async () => {
        zahlPane.innerHTML = '';
        if (!k.ID) { zahlPane.append(h('div', { class: 'note info' }, 'Bitte die Eingangsrechnung zuerst speichern.')); return; }
        const cur = await api('/api/eingang/' + k.ID);
        const g = miniGrid([{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'ART', l: 'Art', w: 80 }, { f: 'BEMERKUNG', l: 'Bemerkung', w: 220 }, { f: 'BETRAG', l: 'Betrag', w: 100, t: 'money' }], cur.zahlungen, { height: 200, empty: 'Noch keine Zahlungen.' });
        zahlPane.append(h('div', { class: 'form-row', style: { marginBottom: '6px' } }, h('span', null, 'Offen: ', h('b', null, fmt.money(cur.offen))), h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn primary', onclick: async () => {
            const betrag = h('input', { type: 'text', class: 'num', value: fmt.num2(cur.offen) }), datum = h('input', { type: 'date', value: today() });
            const art = h('select', null, h('option', { value: 'bank' }, 'Überweisung / Bank'), h('option', { value: 'bar' }, 'Bar (Kassenbuch)'));
            const bem = h('input', { type: 'text' });
            if (await dialog('Zahlung an Lieferant', h('div', { class: 'fgrid' }, fld2('Betrag', betrag, 1), fld2('Datum', datum, 1), fld2('Art', art, 1), fld2('Bemerkung', bem, 1)), [{ label: 'Buchen', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }])) {
              try { await api('/api/eingang/zahlung', { method: 'POST', body: { EINGANGID: k.ID, BETRAG: parseNum(betrag.value), DATUM: datum.value, ART: art.value, BEMERKUNG: bem.value } }); drawZahl(); App.refresh('eingang'); } catch (e) { showError(e); }
            }
          } }, '💶 Zahlung erfassen'),
          h('button', { class: 'btn', onclick: async () => { const z = g.current(); if (z && await confirmDlg('Zahlung löschen?')) { await api('/api/eingang/zahlung/' + z.ID, { method: 'DELETE' }); drawZahl(); App.refresh('eingang'); } } }, '🗑 Löschen')), g.el);
      };
      const dokPane = h('div');
      const tabs = ['Rechnungsdaten', 'Positionen', 'Zahlungen', 'Dokumente'];
      const panes = [kopfPane, posPane, zahlPane, dokPane].map((p, i) => h('div', { class: 'tabpane' + (i ? ' hidden' : '') }, p));
      const tabbar = h('div', { class: 'tabs' }, tabs.map((t, i) => h('button', { class: i ? '' : 'active', onclick: ev => {
        $$('button', tabbar).forEach(b => b.classList.remove('active')); ev.target.classList.add('active'); panes.forEach((p, j) => p.classList.toggle('hidden', i !== j));
        if (t === 'Zahlungen') drawZahl();
        if (t === 'Dokumente') { dokPane.innerHTML = ''; if (k.ID) SUBS.dokumente(dokPane, k.ID, null, { bezug: 'EINGANG' }); else dokPane.append(h('div', { class: 'note info' }, 'Bitte zuerst speichern.')); }
      } }, t)));
      upd(); drawPos();
      const w = Win.open({ title: k.ID ? `Eingangsrechnung ${k.RECHNUNGSNR || ''} bearbeiten` : 'Eingangsrechnung anlegen', width: 1000, height: 680, content: h('div', null, tabbar, ...panes), onClose: r => resolve(r) });
      w.setButtons([
        k.ID ? { label: 'Löschen', icon: '🗑', onClick: async () => { if (await confirmDlg('Eingangsrechnung löschen? Lagerbuchungen werden zurückgenommen.', { danger: true, ok: 'Löschen' })) { try { await api('/api/eingang/' + k.ID, { method: 'DELETE' }); App.refresh('eingang'); w.close(null); } catch (e) { showError(e); } } } } : null,
        '|',
        { label: 'OK', icon: '✔', cls: 'primary', onClick: async () => {
          try { const r = await api('/api/eingang', { method: 'POST', body: { kopf: { ...k, BRUTTO: parseNum(brutto.value) }, pos } }); toast('Eingangsrechnung gespeichert', 'ok'); App.refresh('eingang'); w.close(r); } catch (e) { showError(e); }
        } },
        { label: 'Abbrechen', icon: '✖', onClick: () => w.close() }].filter(Boolean));
      void gk;
    });
  },
  async importieren() {
    const f = await pickFile('.xml,.pdf,application/xml,application/pdf');
    if (!f) return;
    try {
      const r = await api('/api/eingang/erechnung?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
      toast(`E-Rechnung ${r.kopf.RECHNUNGSNR} von ${r.kopf.LIEFNAME} übernommen${r.lieferantNeu ? ' (Lieferant neu angelegt)' : ''}`, 'ok');
      App.refresh('eingang');
      await Eingang.open(r.kopf.ID);
    } catch (e) { showError(e); }
  },
};

Views.lagerbewegung = async (main) => {
  const datum = h('input', { type: 'date', value: today() });
  const art = h('select', null, h('option', { value: 'ein' }, 'Einlagerung'), h('option', { value: 'aus' }, 'Auslagerung'));
  const menge = h('input', { type: 'text', class: 'num', value: '1', style: { width: '80px' } });
  const text = h('input', { type: 'text', placeholder: 'Bemerkung (optional)' });
  const such = h('input', { type: 'search', placeholder: 'Artikel-Nr., EAN oder Bezeichnung + Enter', style: { width: '320px' } });
  let artikel = null; const artInfo = h('b');
  const wrap = h('div', { class: 'overview' }); let g;
  const load = async () => {
    const rows = await api('/api/lager/bewegungen?' + qs({ von: addDays(today(), -30), bis: today() }));
    const ng = miniGrid([{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'ARTNUMMER', l: 'Artikel-Nr.', w: 120 }, { f: 'BEZEICHNUNG1', l: 'Bezeichnung', w: 260 }, { f: 'ANZAHL', l: 'Menge', w: 80, t: 'num' }, { f: 'BESCHREIBUNG', l: 'Beschreibung', w: 260 }, { f: 'LAGER', l: 'Bestand jetzt', w: 100, t: 'num' }], rows);
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el); g = ng;
  };
  const waehle = a => { artikel = a; artInfo.textContent = T(a ? `${a.ARTNUMMER || ''} · ${a.BEZEICHNUNG1} (Bestand ${fmt.num(a.LAGER)})` : ''); };
  such.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const v = such.value.trim(); if (!v) return;
    for (const field of ['ARTNUMMER', 'EAN', 'BEZEICHNUNG1']) {
      const r = await api('/api/list/artikel?' + qs({ q: v, field, limit: 5, filters: { lager: 'alle' } }));
      const exact = r.rows.find(x => String(x[field] || '').toLowerCase() === v.toLowerCase()) || (field === 'BEZEICHNUNG1' && r.rows.length === 1 ? r.rows[0] : null);
      if (exact) { waehle(exact); return; }
    }
    const a = await pickRecord('artikel'); if (a) waehle(a);
  });
  const buchen = async () => {
    if (!artikel) { toast('Bitte zuerst einen Artikel wählen.', 'err'); return; }
    try { const r = await api('/api/lager/bewegung', { method: 'POST', body: { ARTID: artikel.ARTID, MENGE: parseNum(menge.value), ART: art.value, DATUM: datum.value, TEXT: text.value } }); toast(`Gebucht – neuer Bestand ${fmt.num(r.LAGER)}`, 'ok'); waehle(null); such.value = ''; text.value = ''; such.focus(); load(); } catch (e) { showError(e); }
  };
  main.append(titel('Lagerbewegung', 'Schnellerfassung für Ein- und Auslagerungen'),
    h('div', { class: 'searchbar' }, h('label', null, 'Datum', datum), h('label', null, art), h('label', null, 'Menge', menge), h('label', null, 'Artikel', such), h('button', { class: 'btn', onclick: async () => { const a = await pickRecord('artikel'); if (a) waehle(a); } }, '🔍 Suchen'), artInfo),
    h('div', { class: 'searchbar' }, text, h('button', { class: 'btn primary', onclick: buchen }, '✔ Buchen')), wrap);
  await load(); such.focus();
};

Views.inventur = async (main) => {
  const wrap = h('div', { class: 'overview' }); let g;
  const load = async () => {
    const rows = await api('/api/inventur');
    const ng = miniGrid([{ f: 'DATUM', l: 'Stichtag', w: 90, t: 'date' }, { f: 'NAME', l: 'Bezeichnung', w: 260 }, { f: 'POSITIONEN', l: 'Artikel', w: 80, t: 'int' }, { f: 'st', l: 'Status', w: 100, render: r => Number(r.GEDRUCKT) === 2 ? 'gebucht' : 'offen' }, { f: 'KOMMENTAR', l: 'Kommentar', w: 260 }], rows, { onOpen: r => oeffnen(r.LISTID) });
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el); g = ng;
  };
  const oeffnen = async id => {
    let inv = await api('/api/inventur/' + id);
    const gebucht = Number(inv.liste.GEDRUCKT) === 2;
    const tbl = h('table', { class: 'pos' });
    const draw = () => {
      tbl.innerHTML = '';
      tbl.append(h('thead', null, h('tr', null, ['Lagerort', 'Artikel-Nr.', 'Bezeichnung', 'Soll', 'Ist', 'Differenz', 'EK netto'].map(x => h('th', null, x)))));
      const tb = h('tbody');
      for (const p of inv.pos) {
        const ist = h('input', { type: 'text', class: 'num', value: p.ISTLAGER ?? '', readOnly: gebucht, placeholder: '–' });
        const ek = h('input', { type: 'text', class: 'num', value: fmt.num2(p.ISTEK), readOnly: gebucht });
        const diff = h('td', { class: 'r' }, p.ISTLAGER != null ? fmt.num(p.ISTLAGER - (p.SOLL || 0)) : '');
        ist.addEventListener('change', () => { p.ISTLAGER = ist.value.trim() === '' ? null : parseNum(ist.value); p._d = 1; diff.textContent = T(p.ISTLAGER != null ? fmt.num(p.ISTLAGER - (p.SOLL || 0)) : ''); });
        ek.addEventListener('change', () => { p.ISTEK = parseNum(ek.value); p._d = 1; });
        ist.addEventListener('keydown', e => { if (e.key === 'Enter') { const n = ist.closest('tr').nextSibling; if (n) $('input', n).focus(); } });
        tb.append(h('tr', null, h('td', null, p.LAGERORT || ''), h('td', null, p.ARTNUMMER || ''), h('td', null, p.BEZEICHNUNG1 || ''), h('td', { class: 'r' }, fmt.num(p.SOLL)), h('td', null, ist), diff, h('td', null, ek)));
      }
      tbl.append(tb);
    };
    draw();
    const save = async () => { inv = await api('/api/inventur/' + id, { method: 'PUT', body: inv.pos.filter(p => p._d).map(p => ({ LISTPOSID: p.LISTPOSID, ISTLAGER: p.ISTLAGER, ISTEK: p.ISTEK })) }); toast('Gespeichert', 'ok'); };
    const w = Win.open({ title: `Inventur: ${inv.liste.NAME} (${fmt.date(inv.liste.DATUM)})${gebucht ? ' – gebucht' : ''}`, width: 1000, height: 720, content: h('div', { class: 'pos-wrap' }, tbl) });
    w.setButtons([
      { label: 'Zählliste drucken', icon: '🖨', onClick: () => Print.inventurliste(inv, false) },
      { label: 'Ergebnis drucken', icon: '🖨', onClick: async () => { if (!gebucht) await save(); Print.inventurliste(await api('/api/inventur/' + id), true); } },
      '|',
      gebucht ? null : { label: 'Speichern', icon: '💾', onClick: save },
      gebucht ? null : { label: 'Inventur buchen', icon: '✔', cls: 'primary', onClick: async () => { await save(); if (!(await confirmDlg('Inventur jetzt buchen? Die Lagerbestände werden auf die gezählten Ist-Bestände gesetzt.'))) return; try { const r = await api(`/api/inventur/${id}/buchen`, { method: 'POST' }); toast(`Inventur gebucht (${r.korrekturen} Korrekturen)`, 'ok'); w.close(); load(); } catch (e) { showError(e); } } },
      { label: 'Schließen', onClick: () => w.close() }].filter(Boolean));
  };
  main.append(titel('Inventur'), wrap, h('div', { class: 'grid-footer' }, h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c && await confirmDlg('Inventurliste löschen?')) { try { await api('/api/inventur/' + c.LISTID, { method: 'DELETE' }); load(); } catch (e) { showError(e); } } } }, '🗑 Löschen'),
    h('button', { class: 'btn', onclick: () => { const c = g.current(); if (c) oeffnen(c.LISTID); } }, '✏️ Öffnen'),
    h('button', { class: 'btn primary', onclick: async () => {
      const name = h('input', { type: 'text', value: 'Inventur ' + today().slice(0, 4) }), datum = h('input', { type: 'date', value: today() }), wg = h('select', null, h('option', { value: '' }, 'alle Warengruppen'), LK.list('warengruppen').map(x => h('option', { value: x.id }, x.name)));
      if (!(await dialog('Neue Inventurliste', h('div', { class: 'fgrid' }, fld2('Bezeichnung', name), fld2('Stichtag', datum, 1), fld2('Warengruppe', wg, 1)), [{ label: 'Erstellen', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }]))) return;
      const inv = await api('/api/inventur', { method: 'POST', body: { NAME: name.value, DATUM: datum.value, WARENGRUPPE: wg.value } });
      toast(`${inv.pos.length} Artikel mit Lagerführung übernommen`, 'ok'); load(); oeffnen(inv.liste.LISTID);
    } }, '➕ Neue Inventur')));
  await load();
};

// ================= Time tracking =================
const ZEITARTEN = { A: 'Arbeitszeit', P: 'Pause', J: 'Auftrag', U: 'Urlaub', K: 'Krankheit', S: 'Sonstige Abwesenheit', B: 'Berufsschule' };
async function zeitDialog(row = {}, mitarbeiter = []) {
  const ma = h('select', null, mitarbeiter.map(m => h('option', { value: m.BENUTZERID }, [m.VORNAME, m.NAME].filter(Boolean).join(' '))));
  if (row.BENID) ma.value = row.BENID;
  const art = h('select', null, Object.entries(ZEITARTEN).map(([k, l]) => h('option', { value: k }, l))); art.value = row.ART || 'A';
  const datum = h('input', { type: 'date', value: row.DATUM || today() }), bis = h('input', { type: 'date' });
  const beginn = h('input', { type: 'time', value: row.BEGINN || '' }), ende = h('input', { type: 'time', value: row.ENDE || '' });
  const auftrag = h('input', { type: 'text', value: row.AUFTRAGNUMMER || '', placeholder: 'Auftrags-Nr.' });
  const notiz = h('input', { type: 'text', value: row.NOTIZ || '' });
  const bisFld = fld2('bis Datum (mehrere Tage)', bis, 1);
  const sync = () => { const abw = ['U', 'K', 'S', 'B'].includes(art.value); bisFld.style.display = abw && !row.ID ? '' : 'none'; beginn.disabled = ende.disabled = abw; };
  art.addEventListener('change', sync); sync();
  const ok = await dialog(row.ID ? 'Zeitbuchung bearbeiten' : 'Manuelle Zeitbuchung', h('div', { class: 'fgrid' }, fld2('Mitarbeiter', ma), fld2('Art', art, 1), fld2('Datum', datum, 1), bisFld, fld2('von', beginn, 1), fld2('bis', ende, 1), fld2('Auftrag', auftrag, 1), fld2('Notiz', notiz)),
    [{ label: 'OK', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 560 });
  if (!ok) return false;
  let AUFTRAGID = null;
  if (auftrag.value.trim()) { const r = await api('/api/list/auftraege?' + qs({ q: auftrag.value.trim(), field: 'AUFTRAGNUMMER', limit: 3, filters: { status: 'alle', archiv: 'beide' } })); const a = r.rows.find(x => String(x.AUFTRAGNUMMER) === auftrag.value.trim()); if (!a) { toast('Auftrag nicht gefunden', 'err'); return false; } AUFTRAGID = a.AUFTRAGID; }
  try { await api('/api/zeit', { method: 'POST', body: { ID: row.ID, BENID: Number(ma.value), ART: art.value, DATUM: datum.value, BISDATUM: bis.value, BEGINN: beginn.disabled ? null : beginn.value, ENDE: ende.disabled ? null : ende.value, AUFTRAGID, NOTIZ: notiz.value } }); return true; }
  catch (e) { showError(e); return false; }
}

Views.zeiterfassung = async (main) => {
  const mitarbeiter = await api('/api/zeit/mitarbeiter');
  if (!mitarbeiter.length) { main.append(titel('Zeiterfassung'), h('div', { class: 'note info' }, 'Es sind noch keine Mitarbeiter für die Zeiterfassung eingerichtet. Legen Sie unter Stammdaten → Benutzer / Mitarbeiter einen Mitarbeiter an und aktivieren Sie "Mitarbeiter in der Zeiterfassung" sowie eine Personal-Nr.'), h('div', null, h('button', { class: 'btn primary', onclick: () => Views.tabelleDialog('benutzer') }, 'Benutzer / Mitarbeiter öffnen'))); return; }
  const maSel = h('select', null, mitarbeiter.map(m => h('option', { value: m.BENUTZERID }, [m.VORNAME, m.NAME].filter(Boolean).join(' '))));
  maSel.value = Pref.get('zeit.ma', mitarbeiter[0].BENUTZERID);
  const monat = h('input', { type: 'month', value: today().slice(0, 7) });
  const tabs = h('div', { class: 'tabs' }); const pane = h('div', { class: 'overview', style: { paddingTop: '6px' } });
  let aktiv = 'summen';
  const show = async (t = aktiv) => {
    aktiv = t; Pref.set('zeit.ma', maSel.value);
    $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.k === t));
    pane.innerHTML = '';
    const benid = Number(maSel.value), mon = monat.value;
    const von = mon + '-01', bis = addDays(addMonths(von, 1), -1);
    if (t === 'summen') {
      const m = await api(`/api/zeit/monat/${benid}/${mon}`);
      const g = miniGrid([{ f: 'datum', l: 'Datum', w: 90, t: 'date' }, { f: 'wochentag', l: 'Tag', w: 40 }, { f: 'kommen', l: 'Kommen', w: 70 }, { f: 'gehen', l: 'Gehen', w: 70 }, { f: 'pause', l: 'Pause (Min.)', w: 90, t: 'int' }, { f: 'soll', l: 'Soll', w: 70, t: 'num' }, { f: 'ist', l: 'Ist', w: 70, t: 'num' },
        { f: 'saldo', l: 'Saldo', w: 70, render: r => h('td', { class: 'num', style: { color: r.saldo < 0 ? 'var(--err)' : r.saldo > 0 ? 'var(--ok)' : '' } }, r.soll || r.ist ? fmt.num(r.saldo) : '') }, { f: 'info', l: 'Feiertag / Abwesenheit', w: 200, render: r => r.feiertag || r.abwesenheit || '' }],
      m.tage, { footer: { soll: m.summe.soll, ist: m.summe.ist }, rowClass: r => r.wochentag === 'Sa' || r.wochentag === 'So' || r.feiertag ? 't-row' : '', onOpen: r => { aktiv = 'stempel'; show('stempel'); void r; } });
      const s = m.summe;
      const konto = h('div', { class: 'panel', style: { minWidth: '260px' } }, h('h3', null, 'Zeitkonto ', m.abgeschlossen ? h('span', { class: 'badge ok' }, 'abgeschlossen') : h('span', { class: 'badge warn' }, 'offen')),
        h('div', { class: 'pb' }, h('table', { class: 'simple' }, h('tbody', null, [['Vortrag Vormonat', s.vortrag], ['Soll', s.soll], ['Ist', s.ist], ['Saldo Monat', s.saldo], ['Korrekturen', s.korrektur], ['Zeitkonto', s.konto]].map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'num' }, fmt.num(b) + ' h'))),
          h('tr', null, h('td', null, 'Urlaub genommen'), h('td', { class: 'num' }, s.urlaub + ' Tage')), h('tr', null, h('td', null, 'Resturlaub'), h('td', { class: 'num' }, fmt.num(s.urlaubRest) + ' Tage')), h('tr', null, h('td', null, 'Krankheitstage'), h('td', { class: 'num' }, s.krank)))),
          h('h4', null, 'Korrekturen'), m.korrekturen.length ? h('table', { class: 'simple' }, h('tbody', null, m.korrekturen.map(k => h('tr', { class: 'click', onclick: async () => { if (!m.abgeschlossen && await confirmDlg(`Korrektur "${k.NOTIZ || ''}" löschen?`)) { await api('/api/zeit/korrektur/' + k.ID, { method: 'DELETE' }); show(); } } }, h('td', null, k.NOTIZ || ''), h('td', { class: 'num' }, fmt.num(k.STUNDEN) + ' h'), h('td', { class: 'num' }, fmt.num(k.URLAUBSTAGE) + ' T'))))) : h('div', { class: 'hint' }, 'keine'),
          h('div', { class: 'form-row', style: { marginTop: '8px' } },
            m.abgeschlossen ? h('button', { class: 'btn', onclick: async () => { if (await confirmDlg('Monatsabschluss wieder öffnen?')) { await api('/api/zeit/oeffnen', { method: 'POST', body: { benid, monat: mon } }); show(); } } }, '🔓 Monat öffnen')
              : h('button', { class: 'btn', onclick: async () => {
                const std = h('input', { type: 'text', class: 'num', value: '0' }), url = h('input', { type: 'text', class: 'num', value: '0' }), no = h('input', { type: 'text', placeholder: 'z. B. Überstunden ausbezahlt' });
                if (await dialog('Zeitkonto korrigieren', h('div', { class: 'fgrid' }, fld2('Stunden (+/−)', std, 1), fld2('Urlaubstage (+/−)', url, 1), fld2('Grund', no)), [{ label: 'OK', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }])) { try { await api('/api/zeit/korrektur', { method: 'POST', body: { BENID: benid, MONAT: mon, STUNDEN: parseNum(std.value), URLAUBSTAGE: parseNum(url.value), NOTIZ: no.value } }); show(); } catch (e) { showError(e); } }
              } }, '➕ Korrektur'),
            m.abgeschlossen ? null : h('button', { class: 'btn primary', onclick: async () => { if (await confirmDlg(`Monatsabschluss ${mon.slice(5)}/${mon.slice(0, 4)} für ${m.mitarbeiter.name} durchführen? Danach sind keine Änderungen mehr möglich.`)) { await api('/api/zeit/abschluss', { method: 'POST', body: { benid, monat: mon } }); toast('Monat abgeschlossen', 'ok'); show(); } } }, '✔ Monatsabschluss'),
            h('button', { class: 'btn', onclick: () => Print.stundenzettel(m) }, '🖨 Stundenzettel'))));
      pane.append(h('div', { style: { display: 'flex', gap: '8px', flex: 1, minHeight: 0 } }, h('div', { style: { flex: 1, display: 'flex', minWidth: 0 } }, g.el), konto));
    } else {
      const arten = { stempel: 'A,P', auftraege: 'J', abwesenheit: 'U,K,S,B' }[t];
      const rows = await api('/api/zeit/liste?' + qs({ benid, von, bis, arten }));
      const cols = [{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'ARTTEXT', l: 'Art', w: 130 }, { f: 'BEGINN', l: 'von', w: 70 }, { f: 'ENDE', l: 'bis', w: 70 }, { f: 'STUNDEN', l: 'Stunden', w: 80, t: 'num' }];
      if (t === 'auftraege') cols.push({ f: 'AUFTRAGNUMMER', l: 'Auftrag', w: 90 }, { f: 'KUNNAME', l: 'Kunde', w: 180 }, { f: 'FAHRKENNZEICHEN', l: 'Kennzeichen', w: 110 });
      cols.push({ f: 'NOTIZ', l: 'Notiz', w: 240 }, { f: 'QUELLE', l: 'Quelle', w: 90 });
      const g = miniGrid(cols, rows, { onOpen: async r => { if (await zeitDialog(r, mitarbeiter)) show(); }, footer: { STUNDEN: r2(rows.reduce((s, r) => s + (r.ART === 'P' ? -r.STUNDEN : r.STUNDEN), 0)) } });
      pane.append(g.el, h('div', { class: 'grid-footer' }, h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c && await confirmDlg('Zeitbuchung löschen?')) { try { await api('/api/zeit/' + c.ID, { method: 'DELETE' }); show(); } catch (e) { showError(e); } } } }, '🗑 Löschen'),
        h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c && await zeitDialog(c, mitarbeiter)) show(); } }, '✏️ Bearbeiten'),
        h('button', { class: 'btn primary', onclick: async () => { if (await zeitDialog({ BENID: benid, ART: t === 'abwesenheit' ? 'U' : t === 'auftraege' ? 'J' : 'A' }, mitarbeiter)) show(); } }, '➕ Neu')));
    }
  };
  for (const [k, l] of [['summen', 'Summen / Zeitkonto'], ['stempel', 'Zeitstempelung'], ['auftraege', 'Aufträge'], ['abwesenheit', 'Abwesenheit']]) tabs.append(h('button', { 'data-k': k, onclick: () => show(k) }, l));
  maSel.addEventListener('change', () => show()); monat.addEventListener('change', () => show());
  main.append(titel('Zeiterfassung'), h('div', { class: 'searchbar' }, h('label', null, 'Mitarbeiter', maSel), h('label', null, 'Monat', monat),
    h('button', { class: 'btn', onclick: async () => { if (await confirmDlg(`Monatsabschluss ${monat.value} für ALLE Mitarbeiter durchführen?`)) { const r = await api('/api/zeit/abschluss', { method: 'POST', body: { monat: monat.value } }); toast(`${r.abgeschlossen.length} Mitarbeiter abgeschlossen`, 'ok'); show(); } } }, 'Monatsabschluss für alle')), tabs, pane);
  show('summen');
};

Views.stempeluhr = async (main) => {
  const uhr = h('div', { style: { fontSize: '54px', fontWeight: 700, textAlign: 'center', fontVariantNumeric: 'tabular-nums' } });
  const datum = h('div', { style: { textAlign: 'center', color: 'var(--muted)', marginBottom: '14px' } });
  const meldung = h('div', { class: 'note info', style: { textAlign: 'center', fontSize: '16px', minHeight: '24px' } }, 'Bitte Aktion wählen und Personalnummer eingeben.');
  const tick = () => { const d = new Date(); uhr.textContent = d.toLocaleTimeString(LOCALE); datum.textContent = (d.toLocaleDateString(LOCALE, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })); };
  tick(); const t = setInterval(() => { if (!document.body.contains(uhr)) clearInterval(t); else tick(); }, 1000);
  const liste = h('div');
  const loadListe = async () => {
    const rows = await api('/api/zeit/anwesenheit');
    liste.innerHTML = '';
    liste.append(h('table', { class: 'simple' }, h('thead', null, h('tr', null, h('th', null, 'Mitarbeiter'), h('th', null, 'Status'), h('th', null, 'seit'), h('th', null, 'Auftrag'))),
      h('tbody', null, rows.map(r => h('tr', null, h('td', null, r.NAME), h('td', null, h('span', { class: 'badge ' + (r.status === 'anwesend' ? 'ok' : r.status === 'Pause' ? 'warn' : '') }, r.status)), h('td', null, r.seit || ''), h('td', null, r.auftrag || ''))))));
  };
  const nummernblock = async (titelText, mitAuftrag) => {
    const pnr = h('input', { type: 'password', inputmode: 'numeric', style: { fontSize: '26px', width: '100%', height: '44px', textAlign: 'center' }, autocomplete: 'off' });
    const anr = h('input', { type: 'text', inputmode: 'numeric', style: { fontSize: '22px', width: '100%', height: '40px', textAlign: 'center' }, placeholder: 'Auftrags-Nr. (oder scannen)' });
    let ziel = pnr;
    const pad = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '8px' } },
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'C'].map(k => h('button', { class: 'btn', style: { height: '54px', fontSize: '22px' }, onclick: () => { if (k === 'C') ziel.value = ''; else if (k === '⌫') ziel.value = ziel.value.slice(0, -1); else ziel.value += k; ziel.focus(); } }, k)));
    pnr.addEventListener('focus', () => { ziel = pnr; }); anr.addEventListener('focus', () => { ziel = anr; });
    const c = h('div', null, h('div', { class: 'hint' }, 'Personalnummer'), pnr, mitAuftrag ? h('div', { style: { marginTop: '8px' } }, h('div', { class: 'hint' }, 'Auftrag'), anr) : null, pad);
    const enterOk = e => { if (e.key === 'Enter') { e.preventDefault(); c.closest('.win').querySelector('.btn.primary').click(); } };
    pnr.addEventListener('keydown', enterOk); anr.addEventListener('keydown', enterOk);
    const r = await dialog(titelText, c, [{ label: 'OK', cls: 'primary', value: () => ({ pnr: pnr.value, anr: anr.value }) }, { label: 'Abbrechen', value: null }], { width: 340 });
    return r;
  };
  const aktion = async (a, l, mitAuftrag) => {
    const r = await nummernblock(l, mitAuftrag); if (!r || !r.pnr) return;
    try { const res = await api('/api/zeit/stempeln', { method: 'POST', body: { PERSONALNR: r.pnr, AKTION: a, AUFTRAGNR: r.anr } }); meldung.className = 'note ok'; meldung.textContent = res.meldung; loadListe(); }
    catch (e) { meldung.className = 'note err'; meldung.textContent = e.message; }
    setTimeout(() => { meldung.className = 'note info'; meldung.textContent = T('Bitte Aktion wählen und Personalnummer eingeben.'); }, 8000);
  };
  const big = (l, a, color, mitAuftrag) => h('button', { class: 'btn', style: { height: '86px', fontSize: '20px', fontWeight: 700, background: color, color: '#fff', borderColor: 'transparent' }, onclick: () => aktion(a, l, mitAuftrag) }, l);
  main.append(titel('Stempeluhr'), h('div', { class: 'view-scroll' }, h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(300px, 420px)', gap: '12px' } },
    h('div', { class: 'panel' }, h('div', { class: 'pb' }, uhr, datum,
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, big('KOMMEN', 'kommen', '#2e8b3e'), big('GEHEN', 'gehen', '#c0392b'), big('PAUSE', 'pause', '#c77d00'), big('ENDE PAUSE', 'pauseende', '#8a6d00'), big('AUFTRAG', 'auftrag', '#1e66c8', true), big('ENDE AUFTRAG', 'auftragende', '#174c94')),
      h('div', { style: { marginTop: '12px' } }, meldung))),
    h('div', { class: 'panel' }, h('h3', null, 'Anwesenheit heute', h('button', { class: 'btn sm', onclick: loadListe }, '↻')), h('div', { class: 'pb' }, liste)))));
  loadListe();
  const r = setInterval(() => { if (!document.body.contains(liste)) clearInterval(r); else loadListe(); }, 30000);
};

Views.leistungsgrad = async (main) => {
  let von = today().slice(0, 7) + '-01', bis = today();
  const body = h('div', { class: 'view-scroll' });
  const load = async () => {
    const d = await api('/api/zeit/leistungsgrad?' + qs({ von, bis }));
    const grad = r => h('td', { class: 'num' }, r.grad == null ? '–' : h('span', { class: 'badge ' + (r.grad >= 100 ? 'ok' : r.grad >= 80 ? 'warn' : 'err') }, r.grad + ' %'));
    body.innerHTML = '';
    body.append(h('div', { class: 'hint', style: { marginBottom: '6px' } }, `Vorgabezeit = Arbeitswerte des Auftrags (1 AW = ${App.setting('zeit.awminuten', '6')} Min., Einheit „Std.“ = 1 Stunde) · Istzeit = gestempelte Auftragszeit.`),
      h('div', { class: 'panels' },
        h('div', { class: 'panel' }, h('h3', null, 'Leistungsgrad je Mitarbeiter'), h('div', { class: 'pb' }, h('table', { class: 'simple' }, h('thead', null, h('tr', null, ['Mitarbeiter', 'Aufträge', 'Vorgabe (h)', 'Ist (h)', 'Leistungsgrad'].map(x => h('th', null, x)))),
          h('tbody', null, d.proMitarbeiter.map(r => h('tr', null, h('td', null, r.mitarbeiter), h('td', { class: 'num' }, r.auftraege), h('td', { class: 'num' }, fmt.num(r.vorgabe)), h('td', { class: 'num' }, fmt.num(r.ist)), grad(r))))))),
        h('div', { class: 'panel', style: { gridColumn: '1 / -1' } }, h('h3', null, 'Leistungsgrad je Auftrag'), h('div', { class: 'pb' }, h('table', { class: 'simple' }, h('thead', null, h('tr', null, ['Auftrag', 'Datum', 'Kunde', 'Kennzeichen', 'Mitarbeiter', 'Vorgabe (h)', 'Ist (h)', 'Leistungsgrad'].map(x => h('th', null, x)))),
          h('tbody', null, d.proAuftrag.map(r => h('tr', { class: 'click', onclick: () => Vorgang.open('auftrag', r.AUFTRAGID) }, h('td', null, r.AUFTRAGNUMMER), h('td', null, fmt.date(r.DATUM)), h('td', null, r.KUNNAME || ''), h('td', null, r.FAHRKENNZEICHEN || ''), h('td', null, r.mitarbeiter), h('td', { class: 'num' }, fmt.num(r.vorgabe)), h('td', { class: 'num' }, fmt.num(r.ist)), grad(r)))))))));
  };
  const v = h('input', { type: 'date', value: von }), b = h('input', { type: 'date', value: bis });
  v.addEventListener('change', () => { von = v.value; load(); }); b.addEventListener('change', () => { bis = b.value; load(); });
  main.append(titel('Leistungsgrad'), h('div', { class: 'searchbar' }, h('label', null, 'von', v), h('label', null, 'bis', b)), body);
  await load();
};
