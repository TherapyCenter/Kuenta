'use strict';
/* global h, $, $$, fmt, api, qs, parseNum, LK, ENT, Win, toast, showError, confirmDlg, promptDlg, dialog, alertDlg, pickRecord, pickKunde, pickFahrzeug, editRecord, miniGrid, contextMenu, today, addMonths, r2, App, Print, downloadUrl, kname, qrcode */

const POSART = { A: 'Artikel', L: 'Arbeitswert', T: 'Text', Z: 'Zwischensumme', F: 'Fahrzeug' };

const Vorgang = {
  // Client-side calculation (identical to the server calculation)
  calc(kopf, pos) {
    const klein = LK.data && LK.data.klein;
    const brutto = Number(kopf.ANSICHTBRUTTO) === 1;
    const groups = {}; let sub = 0; let roh = 0; let einsatz = 0;
    const usLaborFree = LK.data && LK.data.usLaborFree; // US: labor non-taxable
    for (const p of pos) {
      if (p.POSART === 'T') { p.SUMME = 0; p.SUMMEBRUTTO = 0; continue; }
      if (p.POSART === 'Z') { p.SUMME = r2(sub); p.SUMMEBRUTTO = r2(sub); sub = 0; continue; }
      let code = Number(p.DURCHLAUFER) === 1 || Number(p.DIFFSTEUER) === 1 || kopf.STEUERART ? 63 : (Number(p.MWST) || 61);
      if (usLaborFree && p.POSART === 'L') code = 63;
      const rate = klein ? 0 : LK.rate(code);
      const menge = parseNum(p.MENGE), rab = parseNum(p.RABATT);
      let vk, vkb;
      if (brutto) { vkb = parseNum(p.VKBRUTTO); vk = vkb / (1 + rate / 100); } else { vk = parseNum(p.VK); vkb = vk * (1 + rate / 100); }
      p.VK = vk; p.VKBRUTTO = vkb;
      p.SUMME = menge * vk * (1 - rab / 100); p.SUMMEBRUTTO = menge * vkb * (1 - rab / 100);
      p.ROH = p.SUMME - menge * parseNum(p.EK);
      sub += brutto ? p.SUMMEBRUTTO : p.SUMME;
      roh += p.ROH; einsatz += menge * parseNum(p.EK);
      const g = groups[code] || (groups[code] = { rate, netto: 0, brutto: 0 });
      g.netto += p.SUMME; g.brutto += p.SUMMEBRUTTO;
    }
    let n = 0, b = 0; const tax = {};
    const recargo = Number(kopf.ESRECARGO) === 1 && LK.data && LK.data.recargo; // Spain: recargo de equivalencia
    for (const [code, g] of Object.entries(groups)) {
      let gn, gm, gb;
      if (brutto) { gb = r2(g.brutto); gn = r2(gb / (1 + g.rate / 100)); gm = r2(gb - gn); } else { gn = r2(g.netto); gm = r2(gn * g.rate / 100); gb = r2(gn + gm); }
      const reRate = recargo && g.rate > 0 && Number(code) !== 63 ? (recargo[g.rate] || 0) : 0;
      const re = reRate ? r2(gn * reRate / 100) : 0;
      gb = r2(gb + re);
      tax[code] = { rate: g.rate, netto: gn, mwst: gm, brutto: gb }; if (reRate) Object.assign(tax[code], { reRate, recargo: re }); n += gn; b += gb;
    }
    return { netto: r2(n), brutto: r2(b), mwst: r2(b - n), tax, roh: r2(roh), einsatz: r2(einsatz) };
  },

  async open(typ, id, params = {}) {
    await LK.ensure();
    const v = ENT.V[typ];
    let data;
    try { data = id ? await api(`/api/vorgang/${typ}/${id}`) : await api(`/api/vorgang/${typ}/neu?${qs(params)}`); }
    catch (e) { showError(e); return; }
    return new VorgangWindow(typ, v, data, params).promise;
  },

  async openWith(typ, data, params = {}) {
    await LK.ensure();
    return new VorgangWindow(typ, ENT.V[typ], { ...data, neu: true }, params).promise;
  },

  menu(typ, row, reload, ov) {
    const v = ENT.V[typ]; const id = row[v.pk];
    const items = [
      { label: 'Bearbeiten', icon: '✏️', onClick: () => Vorgang.open(typ, id).then(reload) },
      { label: 'Drucken', icon: '🖨', onClick: () => Vorgang.printById(typ, id).then(reload) },
      { label: 'PDF herunterladen', icon: '📄', onClick: () => Vorgang.pdf(typ, id).then(reload) },
      ...(v.table === 'RECHNUNGEN' && Vorgang.land() === 'DE' ? [{ label: 'ZUGFeRD-PDF herunterladen', icon: '🧾', onClick: () => Vorgang.zugferd(id) }] : []),
      { label: 'Per E-Mail senden', icon: '✉️', onClick: () => Mail.dialog('vorgang', typ, id).then(reload) },
      '-',
    ];
    if (typ === 'auftrag') items.push({ label: 'Anzahlung / Abschlag…', icon: '💰', onClick: () => Anzahlung.dialog(id).then(reload) });
    if ((typ === 'auftrag' || typ === 'lieferschein') && ov) items.push({ label: `Sammelrechnung erstellen (${ov.selected().length} markiert)`, icon: '🧺', onClick: async () => {
      const ids = ov.selected().map(r => r[v.pk]);
      if (!(await confirmDlg(`Aus ${ids.length} ${typ === 'auftrag' ? 'Auftrag/Aufträgen' : 'Lieferschein(en)'} eine Sammelrechnung erstellen?\n(Mehrere Belege mit Strg+Klick markieren.)`))) return;
      try { const r = await api('/api/sammelrechnung', { method: 'POST', body: { typ, ids } }); toast(`Sammelrechnung ${r.nr} erstellt`, 'ok'); reload(); App.refresh('rechnungen'); Vorgang.open('rechnung', r.id); } catch (e) { showError(e); }
    } });
    const ziele = { angebot: ['auftrag', 'lieferschein', 'rechnung'], auftrag: ['lieferschein', 'rechnung'], lieferschein: ['rechnung'], rechnung: [], korrektur: [] }[typ];
    if (ziele.length) items.push({ label: 'Weiterführen als', icon: '➡', items: ziele.map(z => ({ label: ENT.V[z].title, onClick: () => Vorgang.convert(typ, id, z, 'wandeln').then(reload) })) });
    items.push({ label: 'Kopiere nach', icon: '⧉', items: ['angebot', 'auftrag', 'lieferschein', 'rechnung', 'korrektur'].map(z => ({ label: ENT.V[z].title, onClick: () => Vorgang.convert(typ, id, z, 'kopieren').then(reload) })) });
    if (typ === 'rechnung' || typ === 'korrektur') {
      items.push('-');
      if (typ === 'rechnung') items.push({ label: 'Rechnung stornieren', icon: '↩', disabled: row.GUTSCHRIFTID > 0, onClick: () => Vorgang.storno(id).then(reload) });
      items.push({ label: 'Zahlung erfassen', icon: '💶', onClick: () => Zahlung.erfassen(id).then(reload) });
      if (Vorgang.es()) items.push({ label: 'VERI*FACTU-Status', icon: '🇪🇸', onClick: () => Vorgang.esStatus(typ, id).then(reload) },
        { label: 'Facturae (E-Rechnung für Behörden)', icon: '🧾', items: [
          { label: 'Facturae 3.2.2 herunterladen', onClick: () => Vorgang.facturae(id) },
          { label: 'Pflichtangaben prüfen', onClick: () => Vorgang.facturae(id, true) }] });
      else if (Vorgang.land() === 'DE') items.push({ label: 'E-Rechnung (XRechnung)', icon: '🧾', items: [
        { label: 'XRechnung CII herunterladen', onClick: () => Vorgang.erechnung(id, 'cii') },
        { label: 'XRechnung UBL herunterladen', onClick: () => Vorgang.erechnung(id, 'ubl') },
        { label: 'Pflichtangaben prüfen', onClick: () => Vorgang.erechnungPruefen(id) }] });
      if (typ === 'rechnung') items.push({ label: 'Stapeldruck…', icon: '🗂', onClick: () => Vorgang.stapeldruck() });
    }
    items.push('-',
      { label: Number(row.ARCHIV) ? 'Reaktivieren' : 'Archivieren', icon: '🗄', onClick: async () => { await api(`/api/vorgang/${typ}/flag`, { method: 'POST', body: { ids: [id], flag: 'ARCHIV', value: !Number(row.ARCHIV) } }); reload(); } },
      { label: Number(row.GEDRUCKT) ? 'Als nicht gedruckt markieren' : 'Als gedruckt markieren', icon: '✓', onClick: async () => { await api(`/api/vorgang/${typ}/flag`, { method: 'POST', body: { ids: [id], flag: 'GEDRUCKT', value: !Number(row.GEDRUCKT) } }); reload(); } },
      '-',
      { label: 'Löschen', icon: '🗑', onClick: async () => {
        if (!(await confirmDlg(`${v.title} ${row[v.nr]} wirklich löschen?`, { danger: true, ok: 'Löschen' }))) return;
        try { await api(`/api/vorgang/${typ}/${id}`, { method: 'DELETE' }); toast(`${v.title} gelöscht`); reload(); } catch (e) { showError(e); }
      } });
    return items;
  },

  async convert(typ, id, ziel, mode) {
    try {
      const r = await api(`/api/vorgang/${typ}/${id}/${mode}`, { method: 'POST', body: { ziel } });
      toast(`${ENT.V[ziel].title} ${r.nr} erstellt`, 'ok');
      App.refresh(ENT.V[ziel].ent); App.refresh(ENT.V[typ].ent);
      await Vorgang.open(ziel, r.id);
      return r;
    } catch (e) { showError(e); }
  },
  async storno(id) {
    if (!(await confirmDlg('Soll die Rechnung storniert werden?\nEs wird eine Stornorechnung (Rechnungskorrektur) mit negativen Beträgen erstellt.', { ok: 'Stornieren' }))) return;
    try {
      const r = await api(`/api/vorgang/rechnung/${id}/storno`, { method: 'POST' });
      toast(`Stornorechnung ${r.nr} erstellt`, 'ok'); App.refresh('rechnungen'); App.refresh('korrekturen');
      await Vorgang.open('korrektur', r.id);
    } catch (e) { showError(e); }
  },
  // ---------- Spain (VERI*FACTU) ----------
  es() { return !!(LK.data && LK.data.land === 'ES'); },
  land() { return (LK.data && LK.data.land) || 'DE'; },
  // Before an invoice leaves Kuenta (print, PDF) it is issued: VERI*FACTU record, then locked
  async esEmitir(typ, id, d) {
    if (!Vorgang.es() || ENT.V[typ].table !== 'RECHNUNGEN' || (d && d.es && d.es.emitida)) return d || true;
    if (!(await confirmDlg('Die Rechnung wird jetzt ausgestellt und an VERI*FACTU gemeldet. Danach kann sie nicht mehr geändert werden, nur noch über eine Rechnungskorrektur.', { ok: 'Ausstellen' }))) return null;
    try { await api('/api/es/emitir', { method: 'POST', body: { ids: [id] } }); } catch (e) { showError(e); return null; }
    App.refresh(ENT.V[typ].ent);
    return api(`/api/vorgang/${typ}/${id}`);
  },
  async pdf(typ, id) {
    if (!(await Vorgang.esEmitir(typ, id, Vorgang.es() && ENT.V[typ].table === 'RECHNUNGEN' ? await api(`/api/vorgang/${typ}/${id}`) : null))) return;
    await downloadUrl(`/api/pdf/vorgang/${typ}/${id}`, 'Beleg.pdf');
  },
  async facturae(id, pruefen = false) {
    try {
      const chk = await api(`/api/es/facturae/${id}?pruefen=1`);
      if (pruefen) {
        const content = h('div', { class: 'win-body flex', style: { padding: 0 } },
          chk.problems.length ? h('div', { class: 'note err' }, h('b', null, 'Fehlende Angaben:'), h('ul', null, chk.problems.map(p => h('li', null, p)))) : h('div', { class: 'note ok' }, '✔ Alle Pflichtangaben für Facturae vorhanden.'),
          h('div', { class: 'hint' }, 'Vor dem Hochladen in FACe die Datei mit AutoFirma signieren (XAdES).'), h('pre', { class: 'code' }, chk.xml));
        const w = Win.open({ title: 'Facturae prüfen', width: 900, height: 640, content });
        w.setButtons(['|', { label: 'Schließen', onClick: () => w.close() }]); w.el.append(w.foot);
        return;
      }
      if (chk.problems.length && !(await confirmDlg('Für eine gültige Facturae fehlen Angaben:\n\n• ' + chk.problems.join('\n• ') + '\n\nTrotzdem erstellen?', { ok: 'Trotzdem erstellen' }))) return;
      await downloadUrl(`/api/es/facturae/${id}`, 'Facturae.xml');
      toast('Facturae erstellt. Vor dem Hochladen in FACe mit AutoFirma signieren.', 'ok');
    } catch (e) { showError(e); }
  },
  async esStatus(typ, id) {
    const d = await api(`/api/vorgang/${typ}/${id}`); const es = d.es || {};
    const T2 = { pendiente: 'wartet auf Versand', aceptado: 'von der AEAT angenommen', aceptado_errores: 'angenommen mit Fehlern – bitte korrigieren', rechazado: 'von der AEAT abgelehnt' };
    const rows = [['Rechnung', es.numSerie], ['Ausgestellt', es.emitida ? T('ja') : T('nein')], ['Typ', es.tipo ? `${es.tipo} – ${es.titulo}` : ''], ['Status', es.estado ? T(T2[es.estado] || es.estado) : ''],
      ['Fehler', [es.codigo, es.mensaje].filter(Boolean).join(' ')], ['CSV der AEAT', es.csv], ['Umgebung', es.entorno === 'produccion' ? T('Produktion') : es.entorno ? T('Test') : ''], ['Erzeugt', es.generado], ['Hash', es.huella]];
    const content = h('div', null, h('table', { class: 'simple' }, rows.filter(r => r[1]).map(([a, b]) => h('tr', null, h('td', null, a), h('td', { style: { wordBreak: 'break-all' } }, String(b))))));
    const btns = [];
    if (!es.emitida) btns.push({ label: 'Jetzt ausstellen', cls: 'primary', value: 'emitir' });
    if (es.estado === 'aceptado_errores' || es.estado === 'rechazado') btns.push({ label: 'Korrigierten Datensatz senden (Subsanación)', value: 'subsanar' });
    if (es.id) btns.push({ label: 'XML', value: 'xml' });
    btns.push({ label: 'Schließen', value: null });
    const r = await dialog('VERI*FACTU-Status', content, btns, { width: 640 });
    try {
      if (r === 'emitir') await Vorgang.esEmitir(typ, id, d);
      if (r === 'subsanar') { await api(`/api/es/subsanar/${id}`, { method: 'POST' }); toast('Neuer Datensatz erzeugt, wird gesendet', 'ok'); }
      if (r === 'xml') await downloadUrl(`/api/es/registro/${es.id}/xml`, 'VERIFACTU.xml');
    } catch (e) { showError(e); }
  },
  async printById(typ, id, opts = {}) {
    const d = await Vorgang.esEmitir(typ, id, await api(`/api/vorgang/${typ}/${id}`));
    if (!d) return;
    await Print.vorgang(typ, d, opts);
    if (!Number(d.kopf.GEDRUCKT)) await api(`/api/vorgang/${typ}/flag`, { method: 'POST', body: { ids: [id], flag: 'GEDRUCKT', value: 1 } });
  },
  async erechnung(id, format) {
    try {
      const chk = await api(`/api/erechnung/${id}?pruefen=1&format=${format}`);
      if (chk.problems.length && !(await confirmDlg('Für eine gültige E-Rechnung fehlen Angaben:\n\n• ' + chk.problems.join('\n• ') + '\n\nTrotzdem erstellen?', { ok: 'Trotzdem erstellen', cancel: 'Abbrechen' }))) return;
      await downloadUrl(`/api/erechnung/${id}?format=${format}`, 'XRechnung.xml');
      toast('E-Rechnung erstellt', 'ok');
    } catch (e) { showError(e); }
  },
  async erechnungPruefen(id) {
    const chk = await api(`/api/erechnung/${id}?pruefen=1`);
    const content = h('div', { class: 'win-body flex', style: { padding: 0 } },
      chk.problems.length ? h('div', { class: 'note err' }, h('b', null, 'Fehlende Angaben:'), h('ul', null, chk.problems.map(p => h('li', null, p)))) : h('div', { class: 'note ok' }, '✔ Alle Pflichtangaben für XRechnung 3.0 vorhanden.'),
      h('div', { class: 'hint' }, 'Vorschau XRechnung (CII):'), h('pre', { class: 'code' }, chk.xml));
    const w = Win.open({ title: 'E-Rechnung prüfen', width: 900, height: 640, content });
    w.setButtons([{ label: 'E-Rechnung visualisieren', icon: '👁', onClick: () => Print.erechnungAnsicht(chk.xml) }, '|', { label: 'Schließen', onClick: () => w.close() }]);
    w.el.append(w.foot);
  },
  async zugferd(id) {
    try {
      const chk = await api(`/api/erechnung/${id}?pruefen=1`);
      if (chk.problems.length && !(await confirmDlg('Für eine gültige E-Rechnung fehlen Angaben:\n\n• ' + chk.problems.join('\n• ') + '\n\nTrotzdem erstellen?', { ok: 'Trotzdem erstellen' }))) return;
      await downloadUrl(`/api/pdf/vorgang/rechnung/${id}?zugferd=1`, 'ZUGFeRD.pdf');
      toast('ZUGFeRD-PDF erstellt (PDF/A-3 mit XRechnung)', 'ok');
    } catch (e) { showError(e); }
  },
  async stapeldruck() {
    const von = h('input', { type: 'date', value: today().slice(0, 7) + '-01' }), bis = h('input', { type: 'date', value: today() });
    const nrvon = h('input', { type: 'text' }), nrbis = h('input', { type: 'text' });
    const st = h('select', null, h('option', { value: '' }, 'alle'), h('option', { value: 'nged' }, 'nur nicht gedruckte'), h('option', { value: 'ged' }, 'nur gedruckte'));
    const brief = h('input', { type: 'checkbox', checked: true });
    const content = h('div', { class: 'fgrid' },
      h('label', { class: 'fld w1' }, h('span', null, 'Datum von'), von), h('label', { class: 'fld w1' }, h('span', null, 'Datum bis'), bis),
      h('label', { class: 'fld w1' }, h('span', null, 'Beleg-Nr. von'), nrvon), h('label', { class: 'fld w1' }, h('span', null, 'Beleg-Nr. bis'), nrbis),
      h('label', { class: 'fld' }, h('span', null, 'Auswahl'), st), h('label', { class: 'fld chk' }, brief, h('span', null, 'Briefkopf mitdrucken')));
    const r = await dialog('Rechnungen als Stapel drucken', content, [{ label: 'Drucken / als PDF', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 480 });
    if (!r) return;
    const list = await api('/api/stapel/rechnungen?' + qs({ von: von.value, bis: bis.value, nrvon: nrvon.value, nrbis: nrbis.value, status: st.value }));
    if (!list.length) { toast('Keine Rechnungen gefunden'); return; }
    await Print.stapel(list, { briefpapier: brief.checked });
  },
};

class VorgangWindow {
  constructor(typ, v, data, params) {
    this.typ = typ; this.v = v; this.k = { ...data.kopf }; this.pos = (data.pos || []).map(p => ({ ...p })); this.data = data;
    this.sel = this.pos.length ? 0 : -1; this.dirty = !!data.neu;
    const kInfo = this.k._kunde; delete this.k._kunde;
    if (kInfo) this.k._preisgruppe = kInfo.PREISGRUPPE;
    this.promise = new Promise(res => { this.resolve = res; });
    this.build();
    if (kInfo) this.kundeHinweis(kInfo);
    if (params.kunid && !params.fahrid && data.neu) setTimeout(() => this.autoFahrzeug(), 100);
  }
  get id() { return this.k[this.v.pk]; }
  get brutto() { return Number(this.k.ANSICHTBRUTTO) === 1; }
  title() { return T(`${this.v.title} ${this.id ? 'bearbeiten' : 'anlegen'}`) + (this.k[this.v.nr] ? T(' – Nr. ') + this.k[this.v.nr] : ''); }
  change() { this.dirty = true; }

  // ---------- Layout ----------
  build() {
    const tabs = ['Eingabemaske', 'Texte', 'Sonstiges'];
    if (this.v.table === 'RECHNUNGEN') tabs.push('Zahlungen');
    const tabbar = h('div', { class: 'tabs' });
    this.panes = tabs.map(() => h('div', { class: 'tabpane', style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0 } }));
    tabs.forEach((t, i) => tabbar.append(h('button', { class: i ? '' : 'active', onclick: ev => {
      $$('button', tabbar).forEach(b => b.classList.remove('active')); ev.target.classList.add('active');
      this.panes.forEach((p, j) => p.classList.toggle('hidden', j !== i));
      if (t === 'Zahlungen') this.renderZahlungen();
      if (t === 'Sonstiges') this.renderSonstiges();
    } }, t)));
    this.panes.forEach((p, i) => i && p.classList.add('hidden'));
    this.renderMain(this.panes[0]);
    this.renderTexte(this.panes[1]);
    const content = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', height: '100%' } }, tabbar, ...this.panes);
    this.w = Win.open({ title: this.title(), width: 1200, height: 860, content, flex: true, onClose: r => this.resolve(r) });
    this.w.beforeClose = async () => !this.dirty || confirmDlg('Der Vorgang wurde geändert. Änderungen verwerfen?', { ok: 'Verwerfen', cancel: 'Zurück' });
    this.renderFooter();
    this.w.el.addEventListener('keydown', ev => {
      if (ev.key === 'F2') { ev.preventDefault(); this.insArtikel(); }
      if (ev.key === 'F3') { ev.preventDefault(); this.insArbeitswert(); }
      if (ev.key === 's' && ev.ctrlKey) { ev.preventDefault(); this.save(false); }
      if (ev.key === 'p' && ev.ctrlKey) { ev.preventDefault(); this.print(); }
    });
  }

  inp(f, attrs = {}, type = 'text') {
    const t = attrs.t || type;
    let el;
    if (t === 'date') el = h('input', { type: 'date', value: this.k[f] ? String(this.k[f]).slice(0, 10) : '' });
    else if (t === 'month') el = h('input', { type: 'month', value: this.k[f] ? String(this.k[f]).slice(0, 7) : '' });
    else el = h('input', { type: 'text', value: this.k[f] ?? '', class: attrs.num ? 'num' : '' });
    if (attrs.upper) el.addEventListener('input', () => { el.value = el.value.toUpperCase(); });
    el.addEventListener('change', () => {
      let val = el.value;
      if (t === 'month') val = val ? val + '-01' : null;
      if (attrs.int) val = val === '' ? null : parseInt(val, 10) || 0;
      this.k[f] = val === '' ? null : val; this.change();
      if (attrs.onChange) attrs.onChange(val);
    });
    this.refs[f] = el;
    return el;
  }
  sel_(f, list, attrs = {}) {
    const el = h('select', null, h('option', { value: attrs.emptyVal ?? '' }, ''), list.map(o => h('option', { value: o.id, selected: String(o.id) === String(this.k[f]) }, o.name)));
    el.addEventListener('change', () => { this.k[f] = el.value === '' || el.value === String(attrs.emptyVal) ? (attrs.emptyVal ?? null) : Number(el.value); this.change(); if (attrs.onChange) attrs.onChange(el.value); });
    this.refs[f] = el;
    return el;
  }
  setK(obj) { Object.assign(this.k, obj); for (const [f, val] of Object.entries(obj)) { const el = this.refs[f]; if (!el) continue; if (el.type === 'date') el.value = val ? String(val).slice(0, 10) : ''; else if (el.type === 'month') el.value = val ? String(val).slice(0, 7) : ''; else el.value = val ?? ''; } this.change(); }

  renderMain(pane) {
    this.refs = {};
    const k = this.k; const v = this.v;
    const row = (label, ...els) => h('div', { class: 'row' }, h('span', null, label), els.length > 1 ? h('div', { class: 'inline' }, els) : els[0]);
    const row2 = (l1, e1, l2, e2) => h('div', { class: 'row2' }, h('span', null, l1), e1, h('span', null, l2), e2);
    // customer
    const kunNr = this.inp('KUNNUMMER', { int: true });
    kunNr.addEventListener('keydown', async ev => { if (ev.key === 'Enter') { ev.preventDefault(); await this.kundeNachNummer(kunNr.value); } });
    const art = h('div', { class: 'radios' },
      h('label', null, h('input', { type: 'radio', name: 'kunart' + this.typ, checked: Number(k.KUNART) === 1, onchange: () => { k.KUNART = 1; this.change(); } }), 'Firma'),
      h('label', null, h('input', { type: 'radio', name: 'kunart' + this.typ, checked: Number(k.KUNART) !== 1, onchange: () => { k.KUNART = 0; this.change(); } }), 'Privatkunde'));
    const anrede = this.inp('KUNANREDE'); anrede.setAttribute('list', 'dl-anrede');
    const nrInp = this.inp(v.nr, { int: true, num: true, onChange: () => { this.w.el.querySelector('.win-title .t').textContent = this.title(); } });
    if (v.table === 'RECHNUNGEN') {
      // Sequential number, assigned by Kuenta itself when saving
      nrInp.readOnly = true; nrInp.tabIndex = -1;
      nrInp.title = T(this.id ? 'Die Rechnungsnummer ist fest vergeben.' : 'Vorschlag. Die endgültige Nummer vergibt Kuenta beim Speichern fortlaufend.');
    }
    const left = h('div', { class: 'vg-box' },
      row2(`${v.title}-Nr.:`, nrInp, 'Datum:', this.inp('DATUM', { t: 'date' })),
      row('Kunden-Nr.:', kunNr, art,
        h('button', { class: 'btn icon', title: 'Kunde auswählen', onclick: () => this.waehleKunde() }, '🔍'),
        h('button', { class: 'btn icon', title: 'Kunde entfernen', onclick: () => this.setK({ KUNID: null, KUNNUMMER: null, KUNANREDE: '', KUNNAME: '', KUNVORNAME: '', KUNZUSATZ: '', KUNSTRASSE: '', KUNPLZ: '', KUNORT: '' }) }, '✕'),
        h('button', { class: 'btn icon', title: 'Kunde bearbeiten / neu anlegen', onclick: () => this.kundeBearbeiten() }, '👤')),
      h('h5', null, 'Anschrift'),
      row('Anrede:', anrede, h('datalist', { id: 'dl-anrede' }, ENT.ANREDEN.map(a => h('option', { value: a })))),
      row('Name / Firma:', this.inp('KUNNAME')),
      row('Vorname:', this.inp('KUNVORNAME')),
      row('Zusatz:', this.inp('KUNZUSATZ')),
      row('Straße:', this.inp('KUNSTRASSE')),
      h('div', { class: 'row' }, h('span', null, 'Land / PLZ / Ort:'), h('div', { style: { display: 'grid', gridTemplateColumns: '60px 80px 1fr', gap: '4px' } }, this.inp('KUNLAND', { upper: true }), this.plzInput(), this.inp('KUNORT'))));
    // vehicle
    const fzNr = this.inp('FAHRNUMMER', { int: true });
    fzNr.addEventListener('keydown', async ev => { if (ev.key === 'Enter') { ev.preventDefault(); await this.fahrzeugNachNummer(fzNr.value); } });
    const hu = this.inp('FAHRHU', { t: 'month' });
    const right = h('div', { class: 'vg-box' },
      row('Fahrzeug-Nr.:', fzNr,
        h('button', { class: 'btn icon', title: 'Fahrzeug auswählen', onclick: () => this.waehleFahrzeug() }, '🔍'),
        h('button', { class: 'btn icon', title: 'Fahrzeug entfernen', onclick: () => this.setK({ FAHRID: null, FAHRNUMMER: null, FAHRKENNZEICHEN: '', FAHRHSN: '', FAHRTSN: '', FAHRMARKE: '', FAHRMODELL: '', FAHRIDENTNR: '', FAHREZ: null, FAHRKM: null, FAHRHU: null }) }, '✕'),
        h('button', { class: 'btn icon', title: 'Fahrzeug bearbeiten / neu anlegen', onclick: () => this.fahrzeugBearbeiten() }, '🚗')),
      h('h5', null, 'Fahrzeugdaten'),
      row2('Kennzeichen:', this.inp('FAHRKENNZEICHEN', { upper: true }), 'FIN:', this.inp('FAHRIDENTNR', { upper: true })),
      row2('HSN / TSN:', h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } }, this.inp('FAHRHSN'), this.inp('FAHRTSN', { upper: true })), 'EZ:', this.inp('FAHREZ', { t: 'date' })),
      row2('Marke:', this.inp('FAHRMARKE'), 'HU:', h('div', { class: 'inline' }, hu,
        h('button', { class: 'btn sm', title: 'HU +2 Jahre', onclick: () => this.setK({ FAHRHU: addMonths(today(), 24).slice(0, 7) + '-01' }) }, '+2J'),
        h('button', { class: 'btn sm', title: 'HU +1 Jahr', onclick: () => this.setK({ FAHRHU: addMonths(today(), 12).slice(0, 7) + '-01' }) }, '+1J'))),
      row2('Modell:', this.inp('FAHRMODELL'), 'KM-Stand:', this.inp('FAHRKM', { int: true, num: true })),
      h('div', { style: { borderTop: '1px solid var(--line2)', margin: '4px 0' } }),
      row2('Liefer-/Leist.-datum:', this.inp('LIEFDATUM', { t: 'date' }), 'Zahlung:', this.sel_('ZAHLBDID', LK.list('zahlungsbedingungen'), { onChange: id => {
        const z = LK.list('zahlungsbedingungen').find(x => String(x.id) === String(id));
        if (z) { this.k.FAELLING = z.tage; this.k.TAGESKONTO = z.skontotage; this.k.SKONTO = z.skonto; this.k.ZAHLBDTEXT = z.text; if (this.refs.ZAHLBDTEXT) this.refs.ZAHLBDTEXT.value = z.text || ''; }
      } })),
      row2('Auftragsart:', this.sel_('AUFTYPID', LK.list('auftragsarten'), { emptyVal: -1 }), 'Sachbearbeiter:', this.sel_('BENID', LK.list('benutzer'), { emptyVal: -1, onChange: id => {
        const b = LK.list('benutzer').find(x => String(x.id) === String(id)) || {};
        this.k.BENANREDE = b.anrede || null; this.k.BENNAME = b.nachname || null; this.k.BENVORNAME = b.vorname || null;
      } })));
    pane.append(h('div', { class: 'vg-head' }, left, right));
    // line item toolbar
    const tb = (icon, label, title, fn) => h('button', { class: 'btn', title, onclick: fn }, h('span', { class: 'ico' }, icon), label);
    pane.append(h('div', { class: 'vg-toolbar' },
      tb('📦', 'Artikel', 'Artikel einfügen (F2)', () => this.insArtikel()),
      tb('➕', 'Freier Artikel', 'Freien Artikel einfügen', () => this.insFrei('A')),
      tb('🔧', 'Arbeitswert', 'Arbeitswert einfügen (F3)', () => this.insArbeitswert()),
      tb('➕', 'Freier AW', 'Freien Arbeitswert einfügen', () => this.insFrei('L')),
      tb('📝', 'Text', 'Textbaustein / Textposition einfügen', () => this.insText()),
      tb('Σ', '', 'Zwischensumme einfügen', () => this.insert({ POSART: 'Z', BEZEICHNUNG: 'Zwischensumme' })),
      ...(Vorgang.land() === 'US' ? [
        tb('🧴', 'Shop supplies', 'Shop supplies (Prozent der Arbeitsleistung, mit Obergrenze)', () => this.insSupplies()),
        tb('♻', 'Gebühren', 'Gebühr einfügen (Altstoffe, Reifen, Core charge …)', ev => this.insGebuehr(ev))] : [
        tb('', 'KET', 'Kleinteilzuschlag (auf alle vorherigen Ersatzteile)', () => this.insKET()),
        tb('', 'MTZ', 'Lackiermaterialzuschlag (auf markierte Positionen)', () => this.insMTZ())]),
      tb('%', '', 'Rabatt', () => this.rabattDialog()),
      h('span', { class: 'sep' }),
      tb('🚙', 'Fz-Verkauf', 'Fahrzeug aus dem Fahrzeuglager verkaufen', () => this.insFahrzeug('verkauf')),
      tb('🔄', 'Fz-Ankauf', 'Fahrzeug des Kunden ankaufen (Inzahlungnahme)', () => this.insFahrzeug('ankauf')),
      tb('📥', 'Import', 'Import aus anderen Programmen (Warenkorb aus Teilekatalog, CSV, DATANORM)', () => this.insWarenkorb()),
      h('span', { class: 'sep' }),
      tb('✏️', '', 'Position bearbeiten', () => this.editPos()),
      tb('🗑', '', 'Position löschen (Entf)', () => this.delPos()),
      tb('⧉', '', 'Position duplizieren', () => { const p = this.pos[this.sel]; if (p) this.insert({ ...p, [this.v.posPk]: undefined }); }),
      tb('⬇', '', 'Position nach unten', () => this.move(1)),
      tb('⬆', '', 'Position nach oben', () => this.move(-1))));
    this.posWrap = h('div', { class: 'pos-wrap', tabindex: 0 });
    this.posWrap.addEventListener('keydown', ev => { if (ev.key === 'Delete' && ev.target === this.posWrap) this.delPos(); });
    pane.append(this.posWrap);
    // totals
    const ansicht = h('select', { onchange: () => this.switchAnsicht(ansicht.value === 'brutto') }, h('option', { value: 'netto', selected: !this.brutto }, 'Netto-Preise'), h('option', { value: 'brutto', selected: this.brutto }, 'Brutto-Preise'));
    this.sumEls = { netto: h('b'), mwst: h('b'), brutto: h('b'), roh: h('b') };
    pane.append(h('div', { class: 'vg-sum' },
      h('label', { class: 'tot' }, 'Eingabe:', ansicht),
      App.denied('Einkaufspreis anzeigen') ? null : h('span', { class: 'tot' }, 'Roherlös:', this.sumEls.roh),
      h('span', { class: 'tot' }, 'Netto:', this.sumEls.netto),
      h('span', { class: 'tot' }, 'MwSt:', this.sumEls.mwst),
      h('span', { class: 'tot' }, 'Brutto:', this.sumEls.brutto)));
    this.drawPos();
  }
  plzInput() {
    const el = this.inp('KUNPLZ');
    el.addEventListener('change', async () => {
      const l = await api('/api/plz/' + encodeURIComponent(el.value.trim())).catch(() => []);
      if (l.length && !this.k.KUNORT) this.setK({ KUNORT: l[0] });
    });
    return el;
  }

  // ---------- Line items ----------
  drawPos() {
    const showRoh = !App.denied('Einkaufspreis anzeigen');
    const einheiten = LK.list('einheiten'); const mw = LK.list('mwst');
    const tbl = h('table', { class: 'pos' });
    tbl.append(h('colgroup', null, h('col', { style: { width: '38px' } }), h('col', { style: { width: '34px' } }), h('col', { style: { width: '120px' } }), h('col'), h('col', { style: { width: '74px' } }), h('col', { style: { width: '74px' } }), h('col', { style: { width: '92px' } }), h('col', { style: { width: '60px' } }), h('col', { style: { width: '62px' } }), h('col', { style: { width: '100px' } }), showRoh ? h('col', { style: { width: '90px' } }) : null));
    tbl.append(h('thead', null, h('tr', null, h('th', null, 'Pos.'), h('th', null, 'Art'), h('th', null, 'Artikel-Nr.'), h('th', null, 'Bezeichnung / Beschreibung'), h('th', { class: 'num' }, 'Menge'), h('th', null, 'Einheit'), h('th', { class: 'num' }, this.brutto ? 'E-Preis brutto' : 'E-Preis netto'), h('th', { class: 'num' }, 'Rabatt %'), h('th', null, 'MwSt'), h('th', { class: 'num' }, 'Summe'), showRoh ? h('th', { class: 'num' }, 'Roherlös') : null)));
    const tbody = h('tbody');
    const sums = Vorgang.calc(this.k, this.pos);
    let nr = 0;
    this.pos.forEach((p, i) => {
      const tr = h('tr', { class: (i === this.sel ? 'sel ' : '') + (p.POSART === 'T' ? 't-row' : p.POSART === 'Z' ? 'z-row' : '') });
      const cellInp = (f, cls = '', fmtFn = x => x ?? '', parse = x => x) => {
        const el = h('input', { type: 'text', class: cls, value: fmtFn(p[f]) });
        el.addEventListener('focus', () => this.select(i, false));
        el.addEventListener('change', () => { p[f] = parse(el.value); this.change(); this.recalc(); });
        el.addEventListener('keydown', ev => this.cellKey(ev, i));
        return el;
      };
      tr.addEventListener('mousedown', ev => { if (!ev.target.closest('input,select,textarea')) this.select(i); });
      tr.addEventListener('dblclick', ev => { if (!ev.target.closest('input,select,textarea')) this.editPos(i); });
      if (p.POSART === 'T') {
        const ta = h('textarea', { rows: Math.min(6, Math.max(1, String(p.BEZEICHNUNG || '').split('\n').length + (p.MEMOTEXT ? String(p.MEMOTEXT).split('\n').length : 0))), style: { width: '100%', border: 0, background: 'transparent', resize: 'vertical' } }, [p.BEZEICHNUNG, p.MEMOTEXT].filter(Boolean).join('\n'));
        ta.addEventListener('focus', () => this.select(i, false));
        ta.addEventListener('change', () => { p.BEZEICHNUNG = ta.value; p.MEMOTEXT = null; this.change(); });
        tr.append(h('td', { class: 'c' }, ''), h('td', { class: 'c' }, 'T'), h('td', { colSpan: showRoh ? 9 : 8 }, ta));
      } else if (p.POSART === 'Z') {
        tr.append(h('td', { class: 'c' }), h('td', { class: 'c' }, 'Σ'), h('td', { colSpan: 7 }, cellInp('BEZEICHNUNG')), h('td', { class: 'r' }, fmt.money0(p.SUMME)), showRoh ? h('td') : null);
      } else {
        nr++;
        const menge = cellInp('MENGE', 'num', x => fmt.num(x, 3), parseNum);
        const preisF = this.brutto ? 'VKBRUTTO' : 'VK';
        const preis = cellInp(preisF, 'num', x => fmt.num2(x), parseNum);
        const einheit = h('select', null, h('option', { value: '' }), einheiten.map(e => h('option', { value: e.id, selected: String(e.id) === String(p.EINHEITID) }, e.name)));
        einheit.addEventListener('change', () => { p.EINHEITID = einheit.value ? Number(einheit.value) : null; this.change(); });
        einheit.addEventListener('focus', () => this.select(i, false));
        const mwst = h('select', { disabled: Number(p.DURCHLAUFER) === 1, title: Number(p.DURCHLAUFER) === 1 ? 'Durchlaufender Posten (ohne MwSt)' : '' }, mw.map(m => h('option', { value: m.id, selected: Number(m.id) === Number(p.MWST || 61) }, Number(p.DURCHLAUFER) === 1 ? 'DP' : (LK.rate(m.id) + ' %'))));
        mwst.addEventListener('change', () => { p.MWST = Number(mwst.value); this.change(); this.recalc(); });
        mwst.addEventListener('focus', () => this.select(i, false));
        const bez = cellInp('BEZEICHNUNG');
        const desc = [p.BESCHREIBUNG, p.ARBEITSTEXT, p.MEMOTEXT].filter(Boolean).join('\n');
        tr.append(h('td', { class: 'c' }, nr), h('td', { class: 'c', title: POSART[p.POSART] }, p.POSART), h('td', null, cellInp('ARTNUMMER')),
          h('td', null, bez, desc ? h('div', { class: 'subtext' }, desc.length > 220 ? desc.slice(0, 220) + '…' : desc) : null),
          h('td', null, menge), h('td', null, einheit), h('td', null, preis), h('td', null, cellInp('RABATT', 'num', x => Number(x) ? fmt.num(x) : '', parseNum)),
          h('td', null, mwst), h('td', { class: 'r' }, fmt.money0(this.brutto ? p.SUMMEBRUTTO : p.SUMME)), showRoh ? h('td', { class: 'r', style: { color: (p.ROH || 0) < 0 ? 'var(--err)' : '' } }, fmt.money0(p.ROH)) : null);
      }
      tbody.append(tr);
    });
    tbl.append(tbody);
    this.posWrap.innerHTML = '';
    this.posWrap.append(tbl);
    if (!this.pos.length) this.posWrap.append(h('div', { class: 'grid-empty' }, 'Noch keine Positionen. Fügen Sie Artikel (F2), Arbeitswerte (F3) oder freie Positionen über die Funktionsleiste ein.'));
    this.showSums(sums);
  }
  recalc() {
    const sums = Vorgang.calc(this.k, this.pos);
    // only update the total cells, keep the focus
    const rows = $$('tbody tr', this.posWrap);
    this.pos.forEach((p, i) => {
      const tr = rows[i]; if (!tr) return;
      const r = $$('td.r', tr);
      if (p.POSART === 'Z' && r[0]) r[0].textContent = fmt.money0(p.SUMME);
      else if (p.POSART !== 'T') { if (r[0]) r[0].textContent = fmt.money0(this.brutto ? p.SUMMEBRUTTO : p.SUMME); if (r[1]) r[1].textContent = fmt.money0(p.ROH); }
    });
    this.showSums(sums);
  }
  showSums(s) {
    this.sumEls.netto.textContent = fmt.money(s.netto);
    this.sumEls.mwst.textContent = fmt.money(s.mwst);
    this.sumEls.brutto.textContent = fmt.money(s.brutto);
    this.sumEls.roh.textContent = fmt.money(s.roh);
    this.sums = s;
  }
  select(i, redraw = true) {
    this.sel = i;
    $$('tbody tr', this.posWrap).forEach((tr, j) => tr.classList.toggle('sel', j === i));
    void redraw;
  }
  cellKey(ev, i) {
    if (ev.key === 'Enter' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const td = ev.target.closest('td'); const col = [...td.parentNode.children].indexOf(td);
      const rows = $$('tbody tr', this.posWrap);
      const ni = ev.key === 'ArrowUp' ? i - 1 : i + 1;
      if (rows[ni] && rows[ni].children[col]) { const t = $('input,select', rows[ni].children[col]); if (t) { ev.preventDefault(); ev.target.dispatchEvent(new Event('change')); t.focus(); t.select && t.select(); } }
    }
  }
  insert(p, at) {
    const idx = at ?? (this.sel >= 0 ? this.sel + 1 : this.pos.length);
    const np = { MENGE: 1, RABATT: 0, MWST: 61, EK: 0, DURCHLAUFER: 0, ...p };
    if (np.POSART === 'T' || np.POSART === 'Z') { np.MENGE = 0; np.MWST = null; }
    this.pos.splice(idx, 0, np);
    this.sel = idx; this.change(); this.drawPos();
    const row = $$('tbody tr', this.posWrap)[idx];
    if (row) { row.scrollIntoView({ block: 'nearest' }); const f = $(np.POSART === 'T' ? 'textarea' : 'td:nth-child(4) input', row) || $('input', row); if (f && !p.BEZEICHNUNG) f.focus(); }
    return np;
  }
  priceFor(netto, mwst) { return this.brutto ? { VKBRUTTO: r2(netto * (1 + LK.rate(mwst) / 100) * 10000) / 10000, VK: netto } : { VK: netto }; }
  async insArtikel() {
    const a = await pickRecord('artikel', { title: 'Artikel einfügen' });
    if (!a) return;
    const full = await api('/api/rec/artikel/' + a.ARTID);
    const pg = Number(this.k._preisgruppe || 0);
    const vk = pg && full['VKPGR' + pg] ? full['VKPGR' + pg] : full.VKPNETTO || 0;
    const mwst = full.MWST > 0 ? full.MWST : 61;
    this.insert({ POSART: 'A', ARTID: full.ARTID, ARTNUMMER: full.ARTNUMMER, BEZEICHNUNG: full.BEZEICHNUNG1, BESCHREIBUNG: full.BEZEICHNUNG2, MENGE: 1, EK: full.EKPNETTO || 0, MWST: mwst, EINHEITID: full.EINHEITID, MEMOTEXT: full.LANGTEXT, RABATT: this.k.RABATTART || 0, LIEFID: full.LIEFID, ...this.priceFor(vk, mwst) });
  }
  async insArbeitswert() {
    const a = await pickRecord('arbeitswerte', { title: 'Arbeitswert einfügen' });
    if (!a) return;
    const aw = await api('/api/rec/arbeitswerte/' + a.LEISTUNGID);
    const ks = LK.list('kostensaetze').find(x => String(x.id) === String(aw.KOSTENSATZID));
    const fest = Number(aw.FESTPREISCHECK) === 1 || !ks;
    const mwst = aw.MWST > 0 ? aw.MWST : 61;
    const vk = fest ? aw.VKPNETTO || 0 : ks.preis || 0;
    this.insert({ POSART: 'L', ARTID: aw.LEISTUNGID, ARTNUMMER: aw.LEISTUNGNUMMER, BEZEICHNUNG: aw.BEZEICHNUNG1, BESCHREIBUNG: aw.BESCHREIBUNG, MENGE: fest ? 1 : (aw.ANZAHLAW || 1), EK: fest ? 0 : (ks.kosten || 0), MWST: mwst, EINHEITID: aw.EINHEITID, ARBEITSTEXT: aw.ARBEITSTEXT, AWFESTPREIS: fest ? 1 : 0, AWKOSTENSATZID: aw.KOSTENSATZID, DURCHLAUFER: aw.DURCHLAUF || 0, RABATT: this.k.RABATTLOHN || 0, ...this.priceFor(vk, mwst) });
  }
  insFrei(art) {
    const ein = LK.list('einheiten');
    const def = art === 'L' ? (ein.find(e => /std|aw/i.test(e.name)) || {}).id : (ein.find(e => /st/i.test(e.name)) || {}).id;
    this.insert({ POSART: art, MENGE: 1, EINHEITID: def, RABATT: art === 'A' ? this.k.RABATTART || 0 : this.k.RABATTLOHN || 0, AWFESTPREIS: art === 'L' ? 1 : 0 });
  }
  async insText() {
    const tbs = LK.list('textbausteine');
    const ta = h('textarea', { rows: 6, style: { width: '100%' } });
    const g = miniGrid([{ f: 'name', l: 'Textbaustein', w: 520 }], tbs, { height: 220, onSelect: r => { ta.value = r.text || r.name; }, onOpen: r => { ta.value = r.text || r.name; } });
    const r = await dialog('Textposition einfügen', h('div', { class: 'win-body flex', style: { padding: 0 } }, g.el, h('label', { class: 'fld' }, h('span', null, 'Text'), ta)), [{ label: 'Einfügen', cls: 'primary', value: () => ta.value }, { label: 'Abbrechen', value: null }], { width: 640 });
    if (r && r.trim()) this.insert({ POSART: 'T', BEZEICHNUNG: r });
  }
  async insFahrzeug(art) {
    if (art === 'verkauf') {
      const f = await pickRecord('fahrzeuglager', { title: 'Fahrzeug aus dem Lager verkaufen' }); if (!f) return;
      const p = await api(`/api/handel/${f.FAHR_ID}/position?art=verkauf`);
      if (!this.brutto && !Number(p.DIFFSTEUER)) p.VK = p.VK; else if (!this.brutto) p.VK = p.VKBRUTTO;
      this.insert(p);
    } else {
      const f = await pickFahrzeug({ kunid: this.k.KUNID }); if (!f) return;
      const pr = await promptDlg('Ankaufspreis (wird mit dem Kaufpreis verrechnet)', '', { title: 'Fahrzeugankauf' }); if (pr == null) return;
      const p = await api(`/api/handel/${f.FAHR_ID}/position?art=ankauf`);
      p.VKBRUTTO = parseNum(pr); p.VK = parseNum(pr);
      this.insert(p);
      toast('Das angekaufte Fahrzeug wird beim Speichern der Rechnung ins Fahrzeuglager gebucht.');
    }
  }
  async insWarenkorb() {
    const rows = await warenkorbDialog(); if (!rows) return;
    for (const r of rows) {
      const vk = r.preis != null ? r.preis : 0;
      this.insert({ POSART: 'A', ARTID: r.artid || null, ARTNUMMER: r.artnr, BEZEICHNUNG: r.bezeichnung, MENGE: r.menge || 1, EK: r.ek || 0, MWST: 61, RABATT: this.k.RABATTART || 0, ...this.priceFor(vk, 61) });
    }
    toast(`${rows.length} Position(en) übernommen`, 'ok');
  }
  async insKET() {
    const pct = parseNum(App.setting('vorgang.ket', '3'));
    const upto = this.sel >= 0 ? this.sel : this.pos.length - 1;
    const base = this.pos.slice(0, upto + 1).filter(p => p.POSART === 'A' && !/kleinteil/i.test(p.BEZEICHNUNG || '')).reduce((s, p) => s + (p.SUMME || 0), 0);
    if (!base) { toast('Keine Ersatzteilpositionen vor der markierten Position.'); return; }
    const vk = r2(base * pct / 100);
    this.insert({ POSART: 'A', ARTNUMMER: 'KET', BEZEICHNUNG: `Kleinteile / Ersatzteilzuschlag ${fmt.num(pct)} %`, MENGE: 1, MWST: 61, ...this.priceFor(vk, 61) }, upto + 1);
  }
  // US: shop supplies as a percentage of labor, limited to a maximum amount (replaces an existing line)
  insSupplies() {
    const pct = parseNum(App.setting('us.supplies.pct', '10')); const max = parseNum(App.setting('us.supplies.max', '0'));
    const lohn = this.pos.filter(p => p.POSART === 'L').reduce((s, p) => s + (p.SUMME || 0), 0);
    if (!lohn) { toast('Keine Arbeitspositionen vorhanden.'); return; }
    let vk = r2(lohn * pct / 100); if (max > 0) vk = Math.min(vk, max);
    const code = App.setting('us.fees.taxable', '0') === '1' ? 61 : 63;
    const i = this.pos.findIndex(p => p.ARTNUMMER === 'SHOP');
    const line = { POSART: 'A', ARTNUMMER: 'SHOP', BEZEICHNUNG: `Shop supplies ${fmt.num(pct)} %`, MENGE: 1, MWST: code, ...this.priceFor(vk, code) };
    if (i >= 0) { Object.assign(this.pos[i], line); this.change(); this.drawPos(); } else this.insert(line);
  }
  // US: fees from the settings (environmental, tire disposal per tire, core charge …)
  insGebuehr(ev) {
    const liste = String(App.setting('us.fees', 'Hazardous waste disposal;5;n\nTire disposal fee (per tire);3;n;q\nCore charge;0;y')).split(/\r?\n/).map(l => l.split(';').map(s => s.trim())).filter(x => x[0]);
    const r = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : { left: 200, top: 200 };
    contextMenu(r.left, r.bottom || r.top, liste.map(([name, betrag, steuer, menge]) => ({ label: `${name}${Number(parseNum(betrag)) ? ' · ' + fmt.money(parseNum(betrag)) : ''}`, onClick: async () => {
      let vk = parseNum(betrag || '0'); let m = 1;
      if (!vk) { const v = await promptDlg(`Betrag für „${name}“ (negativ = Gutschrift, z. B. Core return)`, '', { title: name }); if (v == null) return; vk = parseNum(v); }
      if (menge === 'q') { const v = await promptDlg('Anzahl', '4', { title: name }); if (v == null) return; m = parseNum(v) || 1; }
      const code = /^y/i.test(steuer || '') ? 61 : 63;
      this.insert({ POSART: 'A', ARTNUMMER: 'FEE', BEZEICHNUNG: name, MENGE: m, MWST: code, ...this.priceFor(vk, code) });
    } })));
  }
  async insMTZ() {
    let pct = parseNum(App.setting('vorgang.mtz', '0'));
    if (!pct) { const v = await promptDlg('Prozentsatz für Lackiermaterial (MTZ)', '20', { title: 'MTZ' }); if (v == null) return; pct = parseNum(v); }
    const p = this.pos[this.sel];
    if (!p || p.POSART === 'T') { toast('Bitte zuerst die Lohnposition(en) markieren.'); return; }
    const vk = r2((p.SUMME || 0) * pct / 100);
    this.insert({ POSART: 'A', ARTNUMMER: 'MTZ', BEZEICHNUNG: `Lackiermaterial ${fmt.num(pct)} %`, MENGE: 1, MWST: 61, ...this.priceFor(vk, 61) });
  }
  async rabattDialog() {
    const pctI = h('input', { type: 'text', class: 'num', value: '' });
    const ziel = h('select', null, h('option', { value: 'alle' }, 'alle Positionen'), h('option', { value: 'A' }, 'nur Artikel'), h('option', { value: 'L' }, 'nur Arbeitswerte'), h('option', { value: 'sel' }, 'nur markierte Position'));
    const zeigen = h('input', { type: 'checkbox', checked: Number(this.k.RABATTZEIGEN) === 1 });
    const r = await dialog('Rabatt', h('div', { class: 'fgrid' }, h('label', { class: 'fld w1' }, h('span', null, 'Rabatt in %'), pctI), h('label', { class: 'fld w1' }, h('span', null, 'gilt für'), ziel), h('label', { class: 'fld chk' }, zeigen, h('span', null, 'Rabattspalte drucken'))),
      [{ label: 'Übernehmen', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 420 });
    if (!r) return;
    this.k.RABATTZEIGEN = zeigen.checked ? 1 : 0;
    if (pctI.value.trim() !== '') {
      const pct = parseNum(pctI.value);
      this.pos.forEach((p, i) => {
        if (p.POSART === 'T' || p.POSART === 'Z') return;
        if (ziel.value === 'alle' || ziel.value === p.POSART || (ziel.value === 'sel' && i === this.sel)) p.RABATT = pct;
      });
    }
    this.change(); this.drawPos();
  }
  editPos(i = this.sel) {
    const p = this.pos[i]; if (!p) return;
    if (p.POSART === 'T' || p.POSART === 'Z') return;
    const vals = { ...p };
    const fields = [
      { f: 'POSART', l: 'Art', t: 'select', opts: [['A', 'Artikel / Ersatzteil'], ['L', 'Arbeitswert / Lohn']], w: 1 },
      { f: 'ARTNUMMER', l: 'Artikel-/AW-Nr.', w: 1 },
      { f: 'BEZEICHNUNG', l: 'Bezeichnung' },
      { f: 'BESCHREIBUNG', l: 'Beschreibung' },
      { f: 'MENGE', l: 'Menge', t: 'num', w: 1 }, { f: 'EINHEITID', l: 'Einheit', t: 'select', src: 'einheiten', w: 1 },
      { f: 'VK', l: 'Einzelpreis netto', t: 'money', w: 1 }, { f: 'VKBRUTTO', l: 'Einzelpreis brutto', t: 'money', w: 1 },
      { f: 'RABATT', l: 'Rabatt %', t: 'pct', w: 1 }, { f: 'MWST', l: 'MwSt', t: 'select', src: 'mwst', w: 1 },
      ...(App.denied('Einkaufspreis anzeigen') ? [] : [{ f: 'EK', l: 'Einkaufspreis / Kosten netto', t: 'money', w: 1 }]),
      { f: 'DURCHLAUFER', l: 'Durchlaufender Posten (ohne MwSt)', t: 'bool', w: 1 },
      ...(Vorgang.land() === 'US' && p.POSART !== 'L' ? [{ f: 'TEILEZUSTAND', l: 'Zustand des Teils', t: 'select', opts: [['', 'neu'], ['GEBRAUCHT', 'gebraucht'], ['AUFBEREITET', 'aufbereitet (rebuilt)']], w: 1 }] : []),
      { f: p.POSART === 'L' ? 'ARBEITSTEXT' : 'MEMOTEXT', l: p.POSART === 'L' ? 'Arbeitstext' : 'Langtext', t: 'memo', rows: 4 },
    ];
    const form = new Form({ form: [{ tab: 'Position', groups: [{ title: 'Position', fields }] }] }, vals);
    // keep net and gross in sync
    const F = form.fields;
    const rate = () => (Number(F.DURCHLAUFER.get()) ? 0 : LK.rate(F.MWST.get() || 61));
    F.VK.input.addEventListener('change', () => F.VKBRUTTO.set(r2((F.VK.get() || 0) * (1 + rate() / 100) * 10000) / 10000));
    F.VKBRUTTO.input.addEventListener('change', () => F.VK.set((F.VKBRUTTO.get() || 0) / (1 + rate() / 100)));
    F.MWST.input.addEventListener('change', () => F.VKBRUTTO.set((F.VK.get() || 0) * (1 + rate() / 100)));
    const w = Win.open({ title: 'Position bearbeiten', width: 640, content: form.el });
    w.setButtons(['|', { label: 'OK', cls: 'primary', icon: '✔', onClick: () => { Object.assign(p, form.values()); this.change(); this.drawPos(); w.close(true); } }, { label: 'Abbrechen', onClick: () => w.close() }]);
    w.el.append(w.foot);
  }
  async delPos() {
    const p = this.pos[this.sel]; if (!p) return;
    this.pos.splice(this.sel, 1);
    this.sel = Math.min(this.sel, this.pos.length - 1); this.change(); this.drawPos();
  }
  move(d) {
    const i = this.sel, j = i + d;
    if (i < 0 || j < 0 || j >= this.pos.length) return;
    [this.pos[i], this.pos[j]] = [this.pos[j], this.pos[i]];
    this.sel = j; this.change(); this.drawPos();
  }
  switchAnsicht(brutto) {
    Vorgang.calc(this.k, this.pos); // keep VK and VKBRUTTO consistent
    this.k.ANSICHTBRUTTO = brutto ? 1 : 0; this.change(); this.drawPos();
  }

  // ---------- Customer / vehicle ----------
  async waehleKunde() { const k = await pickKunde(); if (k) await this.uebernehmeKunde(k.KUNID, true); }
  async kundeNachNummer(nr) {
    if (!nr) return this.waehleKunde();
    const r = await api('/api/list/kunden?' + qs({ q: nr, field: 'NUMMER', limit: 5 }));
    const k = r.rows.find(x => String(x.NUMMER) === String(nr).trim());
    if (k) await this.uebernehmeKunde(k.KUNID, true); else { toast('Kunden-Nr. nicht gefunden'); this.waehleKunde(); }
  }
  async uebernehmeKunde(kunid, fahrzeugFragen) {
    const f = await api(`/api/kunde/${kunid}/vorgangdaten`);
    const info = f._kunde; delete f._kunde;
    if (f.ANSICHTBRUTTO != null && this.pos.length) delete f.ANSICHTBRUTTO;
    this.k._preisgruppe = info.PREISGRUPPE;
    this.setK(f);
    $$('input[name^=kunart]', this.w.el).forEach(r => { r.checked = (r.parentNode.textContent.includes(T('Firma'))) === (Number(f.KUNART) === 1); });
    if (this.refs.ZAHLBDID) this.refs.ZAHLBDID.value = this.k.ZAHLBDID ?? '';
    this.kundeHinweis(info);
    if (fahrzeugFragen && !this.k.FAHRID) await this.autoFahrzeug();
  }
  kundeHinweis(info) {
    if (info && Number(info.ZEIGANMERKUNG) === 1 && info.ANMERKUNG) alertDlg(info.ANMERKUNG, 'Anmerkung zum Kunden');
  }
  async autoFahrzeug() {
    if (!this.k.KUNID) return;
    const list = await api(`/api/kunden/${this.k.KUNID}/fahrzeuge`);
    if (list.length === 1) await this.uebernehmeFahrzeug(list[0].FAHR_ID, false);
    else if (list.length > 1) { const f = await pickFahrzeug({ kunid: this.k.KUNID }); if (f) await this.uebernehmeFahrzeug(f.FAHR_ID, false); }
  }
  async waehleFahrzeug() { const f = await pickFahrzeug({ kunid: this.k.KUNID }); if (f) await this.uebernehmeFahrzeug(f.FAHR_ID, true); }
  async fahrzeugNachNummer(nr) {
    if (!nr) return this.waehleFahrzeug();
    const r = await api('/api/list/fahrzeuge?' + qs({ q: nr, field: 'FRZNUMMER', limit: 5 }));
    const f = r.rows.find(x => String(x.FRZNUMMER) === String(nr).trim());
    if (f) await this.uebernehmeFahrzeug(f.FAHR_ID, true); else { toast('Fahrzeug-Nr. nicht gefunden'); this.waehleFahrzeug(); }
  }
  async uebernehmeFahrzeug(fahrid, kundeErgaenzen) {
    this.setK(await api(`/api/fahrzeug/${fahrid}/vorgangdaten`));
    if (kundeErgaenzen && !this.k.KUNID) {
      const hl = await api(`/api/fahrzeuge/${fahrid}/halter`);
      if (hl.length) await this.uebernehmeKunde(hl[0].KUNID, false);
    }
  }
  async kundeBearbeiten() {
    const r = await editRecord('kunden', this.k.KUNID || null, this.k.KUNID ? {} : { NAME: this.k.KUNNAME, VORNAME: this.k.KUNVORNAME, STRASSE: this.k.KUNSTRASSE, PLZ: this.k.KUNPLZ, ORT: this.k.KUNORT, ANREDE: this.k.KUNANREDE });
    if (r) await this.uebernehmeKunde(r.KUNID, !this.k.FAHRID);
  }
  async fahrzeugBearbeiten() {
    const r = await editRecord('fahrzeuge', this.k.FAHRID || null, {}, { afterSave: s => this.k.KUNID && !this.k.FAHRID ? api(`/api/kunden/${this.k.KUNID}/fahrzeuge/${s.FAHR_ID}`, { method: 'PUT' }) : null });
    if (r) await this.uebernehmeFahrzeug(r.FAHR_ID, false);
  }

  // ---------- Texts / other / payments ----------
  renderTexte(pane) {
    const dts = LK.list('drucktexte').filter(d => Number(d.art) === this.v.txtArt);
    const block = (label, f, src) => {
      const ta = h('textarea', { rows: 7, style: { width: '100%' } }, this.k[f] || '');
      ta.addEventListener('change', () => { this.k[f] = ta.value; this.change(); });
      this.refs[f] = ta;
      const sel = h('select', null, h('option', { value: '' }, '– Textvorlage wählen –'), dts.map(d => h('option', { value: d.id }, d.name)));
      sel.addEventListener('change', () => { const d = dts.find(x => String(x.id) === sel.value); if (d) { ta.value = d[src] || ''; this.k[f] = ta.value; this.change(); } sel.value = ''; });
      return h('fieldset', { class: 'grp' }, h('legend', null, label), h('div', { class: 'form-row', style: { marginBottom: '4px' } }, sel), ta);
    };
    const zb = h('textarea', { rows: 2, style: { width: '100%' } }, this.k.ZAHLBDTEXT || '');
    zb.addEventListener('change', () => { this.k.ZAHLBDTEXT = zb.value; this.change(); });
    this.refs.ZAHLBDTEXT = zb;
    pane.append(block('Einleitungstext', 'EINLEITUNGTXT', 'einleitung'), block('Schlusstext', 'SCHLUSSTXT', 'schluss'),
      h('fieldset', { class: 'grp' }, h('legend', null, 'Zahlungsbedingung (Text auf dem Beleg)'), zb));
  }
  // US: odometer out, replaced parts and the customer's authorizations of the estimate
  usFreigaben() {
    const k = this.k;
    const out = this.inp('FAHRKMOUT', { int: true, num: true });
    const alt = h('select', null, [['', '–'], ['zurueck', 'dem Kunden zurückgegeben'], ['entsorgt', 'auf Wunsch entsorgt']].map(([v, l]) => h('option', { value: v, selected: (k.USALTTEILE || '') === v }, l)));
    alt.addEventListener('change', () => { k.USALTTEILE = alt.value || null; this.change(); });
    const liste = h('div');
    const lesen = () => { try { return JSON.parse(k.USFREIGABE || '[]'); } catch { return []; } };
    const zeichnen = () => {
      liste.textContent = '';
      const fr = lesen();
      if (!fr.length) liste.append(h('div', { class: 'hint' }, 'Noch keine Freigabe erfasst.'));
      fr.forEach((a, i) => liste.append(h('div', { class: 'inline' }, h('span', null, `${fmt.money(a.betrag)} · ${fmt.date(a.datum)} ${a.zeit || ''} · ${T(a.art || '')} · ${a.person || ''}${a.notiz ? ' · ' + a.notiz : ''}`),
        h('button', { class: 'btn icon sm', title: 'Entfernen', onclick: () => { const x = lesen(); x.splice(i, 1); k.USFREIGABE = JSON.stringify(x); this.change(); zeichnen(); } }, '✕'))));
    };
    const neu = async () => {
      const betrag = h('input', { type: 'text', class: 'num', value: fmt.num2(this.calcTotals ? this.calcTotals().brutto : Vorgang.calc(k, this.pos).brutto) });
      const datum = h('input', { type: 'date', value: today() }); const zeit = h('input', { type: 'time', value: new Date().toTimeString().slice(0, 5) });
      const art = h('select', null, ['persönlich', 'telefonisch', 'E-Mail / Text', 'Unterschrift'].map(x => h('option', { value: x }, x)));
      const person = h('input', { type: 'text', value: [k.KUNVORNAME, k.KUNNAME].filter(Boolean).join(' ') }); const notiz = h('input', { type: 'text' });
      const ok = await dialog('Freigabe des Kunden erfassen', h('div', { class: 'fgrid' }, h('label', { class: 'fld w1' }, h('span', null, 'Freigegebener Betrag'), betrag), h('label', { class: 'fld w1' }, h('span', null, 'Datum'), datum),
        h('label', { class: 'fld w1' }, h('span', null, 'Uhrzeit'), zeit), h('label', { class: 'fld w1' }, h('span', null, 'Art'), art), h('label', { class: 'fld' }, h('span', null, 'Freigegeben durch'), person), h('label', { class: 'fld' }, h('span', null, 'Notiz (z. B. zusätzliche Arbeiten)'), notiz)),
      [{ label: 'Übernehmen', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 560 });
      if (!ok) return;
      const x = lesen(); x.push({ betrag: parseNum(betrag.value), datum: datum.value, zeit: zeit.value, art: art.value, person: person.value, notiz: notiz.value });
      k.USFREIGABE = JSON.stringify(x); this.change(); zeichnen();
    };
    zeichnen();
    return h('fieldset', { class: 'grp' }, h('legend', null, 'Freigabe & Fahrzeug (USA)'),
      h('div', { class: 'fgrid' }, h('label', { class: 'fld w1' }, h('span', null, 'Tacho bei Rückgabe'), out), h('label', { class: 'fld w1' }, h('span', null, 'Ersetzte Teile'), alt)),
      h('div', { class: 'hint', style: { margin: '6px 0 2px' } }, 'Freigaben des Kunden (Kostenvoranschlag und Mehrkosten):'), liste,
      h('div', { class: 'fld inline' }, h('button', { class: 'btn sm', onclick: neu }, '➕ Freigabe erfassen')));
  }
  renderSonstiges() {
    const pane = this.panes[2]; pane.innerHTML = '';
    const grid = h('div', { class: 'fgrid' });
    const chk = (f, l) => { const c = h('input', { type: 'checkbox', checked: Number(this.k[f]) === 1, onchange: () => { this.k[f] = c.checked ? 1 : 0; this.change(); } }); return h('label', { class: 'fld chk' }, c, h('span', null, l)); };
    grid.append(chk('RABATTZEIGEN', 'Rabattspalte drucken'));
    const sa = h('select', null, [['', 'normal (mit MwSt)'], ['REVERSE_CHARGE', 'steuerfrei: Reverse Charge (EU-Unternehmer)'], ['IG_LIEFERUNG', 'steuerfrei: innergemeinschaftliche Lieferung'], ['AUSFUHR', 'steuerfrei: Ausfuhr / Drittland'], ...(Vorgang.land() === 'US' ? [['EXEMPT', 'steuerfrei: Exemption certificate (Resale u. a.)']] : [])].map(([k, l]) => h('option', { value: k, selected: (this.k.STEUERART || '') === k }, l)));
    sa.addEventListener('change', () => { this.k.STEUERART = sa.value || null; this.change(); this.drawPos(); });
    grid.append(h('label', { class: 'fld' }, h('span', null, 'Umsatzsteuer'), sa));
    if (this.typ === 'korrektur' && Vorgang.es()) {
      const rs = h('select', null, [['R4', 'R4 – sonstige Gründe (Resto)'], ['R1', 'R1 – Rechtsfehler, Art. 80 Uno, Dos, Seis LIVA'], ['R2', 'R2 – Insolvenz (Art. 80.3 LIVA)'], ['R3', 'R3 – uneinbringliche Forderung (Art. 80.4 LIVA)']].map(([k, l]) => h('option', { value: k, selected: (this.k.ESRECT || 'R4') === k }, l)));
      rs.addEventListener('change', () => { this.k.ESRECT = rs.value; this.change(); });
      grid.append(h('label', { class: 'fld' }, h('span', null, 'Grund der Korrektur (VERI*FACTU; bei vereinfachten Rechnungen immer R5)'), rs));
    }
    if (this.v.table === 'RECHNUNGEN') {
      grid.append(h('label', { class: 'fld w1' }, h('span', null, 'Bestell-Nr. / Referenz des Kunden'), this.inp('BESTELLNR')));
      grid.append(chk('KEINEMAHNUNG', 'Keine Mahnung für diese Rechnung'));
    }
    const ind = [];
    for (let n = 1; n <= 16; n++) {
      const meta = LK.data.ind['IND' + (n + 9)];
      if (!meta || !Number(meta.aktiv)) continue;
      const f = 'INDFELD' + n;
      ind.push(h('label', { class: 'fld w1' }, h('span', null, meta.l), this.inp(f, n >= 12 ? { t: 'date' } : {})));
    }
    const links = h('div', { class: 'vg-links' }, (this.data.verknuepft || []).map(l => h('span', { class: 'chip', onclick: () => Vorgang.open(l.typ, l.id) }, `${l.title} ${l.nr} · ${fmt.date(l.datum)}`)));
    pane.append(h('div', { class: 'groups' },
      h('fieldset', { class: 'grp' }, h('legend', null, 'Optionen'), grid),
      ...(Vorgang.land() === 'US' && this.typ !== 'lieferschein' ? [this.usFreigaben()] : []),
      h('fieldset', { class: 'grp' }, h('legend', null, 'Verknüpfte Vorgänge'), (this.data.verknuepft || []).length ? links : h('div', { class: 'hint' }, 'Keine')),
      h('fieldset', { class: 'grp' }, h('legend', null, 'Individuelle Felder'), ind.length ? h('div', { class: 'fgrid' }, ind) : h('div', { class: 'hint' }, 'Keine aktiven individuellen Felder (Einstellungen → Individuelle Felder).')),
      h('fieldset', { class: 'grp' }, h('legend', null, 'Info'), h('div', { class: 'hint', style: { lineHeight: 1.7 } },
        `Erstellt/geändert: ${fmt.datetime(this.k.AENDERUNGSDATUM) || '–'}`, h('br'), `Gedruckt: ${Number(this.k.GEDRUCKT) ? 'ja' : 'nein'}`, h('br'),
        this.v.table === 'RECHNUNGEN' ? `E-Rechnung erstellt: ${fmt.datetime(this.k.ERECHNUNGERSTELLT) || 'nein'}` : ''))));
  }
  async renderZahlungen() {
    const pane = this.panes[3]; pane.innerHTML = '';
    if (!this.id) { pane.append(h('div', { class: 'note info' }, 'Bitte speichern Sie die Rechnung zuerst.')); return; }
    const d = await api(`/api/vorgang/${this.typ}/${this.id}`);
    const cols = [{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'ZAHLART', l: 'Zahlungsart', w: 170 }, { f: 'BANKNAME', l: 'Bank / Bemerkung', w: 200 }, { f: 'BETRAG', l: 'Betrag', w: 110, t: 'money' }];
    const g = miniGrid(cols, d.zahlungen, { height: 220, empty: 'Noch keine Zahlungen erfasst.' });
    pane.append(h('div', { class: 'form-row' },
      h('span', null, 'Rechnungsbetrag: ', h('b', null, fmt.money(d.kopf.GBRUTTO))), h('span', null, 'Offen: ', h('b', { style: { color: d.offen > 0 ? 'var(--err)' : 'var(--ok)' } }, fmt.money(d.offen))),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn primary', onclick: async () => { if (this.dirty) await this.save(false); await Zahlung.erfassen(this.id); this.renderZahlungen(); } }, '💶 Zahlung erfassen'),
      h('button', { class: 'btn', onclick: async () => { const z = g.current(); if (z && await confirmDlg(`Zahlung über ${fmt.money(z.BETRAG)} löschen?\nZugehörige Kassenbuch- und FIBU-Einträge werden ebenfalls gelöscht.`, { danger: true, ok: 'Löschen' })) { try { await api('/api/zahlung/' + z.ID, { method: 'DELETE' }); this.renderZahlungen(); App.refresh('rechnungen'); } catch (e) { showError(e); } } } }, '🗑 Zahlung löschen')), g.el);
    if (this.typ === 'rechnung' && App.setting('btcpay.aktiv', '0') === '1') pane.append(await this.kryptoBox(d));
    if (d.mahnungen && d.mahnungen.length) {
      pane.append(h('h4', null, 'Mahnungen'), miniGrid([{ f: 'MAHNDATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'MAHNSTUFE', l: 'Stufe', w: 60 }, { f: 'BETREFFTXT', l: 'Betreff', w: 240 }, { f: 'MAHNGEBUEHREN', l: 'Gebühr', w: 90, t: 'money' }], d.mahnungen, { height: 140, onOpen: m => Print.mahnungById(m.MAHNID) }).el);
    }
  }

  // Bitcoin/Lightning/USDT payment link via BTCPay Server
  async kryptoBox(d) {
    const box = h('fieldset', { class: 'grp', style: { marginTop: '10px' } }, h('legend', null, '₿ Bezahlen mit Bitcoin, Lightning oder USDT'));
    let st;
    try { st = await api(`/api/btcpay/rechnung/${this.id}`); } catch (e) { box.append(h('div', { class: 'note warn' }, e.message)); return box; }
    const aktuell = st.eintraege.find(e => ['Pending', 'Processing', 'offen'].includes(e.status));
    const neuLaden = () => this.renderZahlungen();
    const anlegen = async (neu) => {
      try { if (this.dirty) await this.save(false); await api(`/api/btcpay/link/${this.id}`, { method: 'POST', body: { neu } }); toast('Zahlungslink angelegt', 'ok'); neuLaden(); } catch (e) { showError(e); }
    };
    const pruefen = async () => {
      try { const r = await api('/api/btcpay/pruefen', { method: 'POST' }); toast(r.gebucht.length ? `${r.gebucht.length} Zahlung(en) gebucht` : r.fehler && r.fehler.length ? r.fehler[0] : 'Noch kein Zahlungseingang', r.fehler && r.fehler.length && !r.gebucht.length ? 'err' : 'ok'); neuLaden(); App.refresh('rechnungen'); } catch (e) { showError(e); }
    };
    if (aktuell) {
      let qr = '';
      try { const q = qrcode(0, 'M'); q.addData(aktuell.link); q.make(); qr = q.createSvgTag({ cellSize: 3, margin: 2 }); } catch { /* without QR */ }
      const qrEl = h('div', { style: { background: '#fff', padding: '4px', borderRadius: '4px', lineHeight: 0 } }); qrEl.innerHTML = qr;
      const linkInp = h('input', { type: 'text', readonly: true, value: aktuell.link, style: { width: '100%' } });
      box.append(h('div', { class: 'inline', style: { alignItems: 'flex-start', gap: '14px' } }, qrEl,
        h('div', { style: { flex: 1 } },
          h('div', null, `Betrag ${fmt.money(aktuell.betrag)} · gültig bis ${fmt.date(aktuell.ablauf)} · Stand: ${aktuell.status === 'Processing' ? 'Zahlung wird bestätigt …' : 'wartet auf Zahlung'}`),
          aktuell.fehler ? h('div', { class: 'note warn' }, 'Letzte Abfrage: ' + aktuell.fehler) : null,
          h('div', { class: 'fld' }, linkInp),
          h('div', { class: 'inline' },
            h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(aktuell.link); toast('Link kopiert', 'ok'); } catch { linkInp.select(); } } }, '📋 Link kopieren'),
            h('button', { class: 'btn', onclick: () => window.open(aktuell.link, '_blank', 'noopener') }, '🔗 Öffnen'),
            h('button', { class: 'btn', onclick: pruefen }, '🔄 Zahlungseingang prüfen'),
            Math.abs(aktuell.betrag - d.offen) > 0.004 ? h('button', { class: 'btn primary', onclick: () => anlegen(true) }, '♻ Neuer Link über ' + fmt.money(d.offen)) : null),
          h('div', { class: 'hint' }, 'QR-Code und Link stehen automatisch auf der PDF-Rechnung und in der E-Mail.'))));
    } else if (d.offen > 0.004) {
      box.append(h('div', { class: 'inline' },
        h('button', { class: 'btn primary', onclick: () => anlegen(false) }, '₿ Zahlungslink über ' + fmt.money(d.offen) + ' anlegen'),
        h('span', { class: 'hint' }, 'Der Kunde zahlt den Euro-Betrag in Bitcoin, Lightning oder USDT, umgerechnet zum Kurs am Zahltag. Bezahlte Rechnungen bucht Kuenta automatisch.')));
    } else box.append(h('div', { class: 'hint' }, 'Die Rechnung ist bezahlt.'));
    const alt = st.eintraege.filter(e => e !== aktuell);
    if (alt.length) box.append(h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Frühere Links: ' + alt.map(e => `${fmt.date(e.angelegt)} ${fmt.money(e.betrag)} – ${e.status}${e.methode ? ' (' + e.methode + ')' : ''}`).join(' · ')));
    return box;
  }

  // ---------- Footer ----------
  renderFooter() {
    const isRe = this.v.table === 'RECHNUNGEN';
    const formulare = {
      angebot: [['angebot', 'Angebot'], ['kostenvoranschlag', 'Kostenvoranschlag']],
      auftrag: [['auftrag', 'Auftrag'], ['arbeitskarte', 'Arbeitskarte (ohne Preise)'], ['auftrag_mit_unterschrift', 'Auftrag mit Unterschrift']],
      lieferschein: [['lieferschein', 'Lieferschein'], ['lieferschein_preise', 'Lieferschein mit Preisen']],
      rechnung: [['rechnung', 'Rechnung'], ['rechnung_ohne_kopf', 'Rechnung ohne Briefkopf']],
      korrektur: [['rechnungskorrektur', 'Rechnungskorrektur'], ['gutschrift', 'Gutschrift'], ['storno-rechnung', 'Stornorechnung']],
    }[this.typ];
    const cur = String(this.k.DRUCKFORMULAR || '').replace(/\.fr3$/, '');
    this.formSel = h('select', null, formulare.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    this.formSel.addEventListener('change', () => { this.k.DRUCKFORMULAR = this.formSel.value; this.change(); });
    const items = [
      h('button', { class: 'btn', onclick: () => this.print() }, h('span', { class: 'ico' }, '🖨'), 'Drucken'),
      h('label', { class: 'inline' }, 'Formular:', this.formSel),
    ];
    if (isRe && ['DE', 'ES'].includes(Vorgang.land())) items.push(h('button', { class: 'btn', onclick: async ev => {
      const r = ev.currentTarget.getBoundingClientRect();
      const m = contextMenu(r.left, r.top, Vorgang.es() ? [
        { label: 'Facturae 3.2.2 herunterladen', onClick: () => this.withSaved(() => Vorgang.facturae(this.id)) },
        { label: 'Pflichtangaben prüfen', onClick: () => this.withSaved(() => Vorgang.facturae(this.id, true)) },
        { label: 'VERI*FACTU-Status', onClick: () => this.withSaved(() => Vorgang.esStatus(this.typ, this.id).then(() => this.reloadEs())) }] : [
        { label: 'XRechnung (CII) erstellen', onClick: () => this.withSaved(() => Vorgang.erechnung(this.id, 'cii')) },
        { label: 'XRechnung (UBL) erstellen', onClick: () => this.withSaved(() => Vorgang.erechnung(this.id, 'ubl')) },
        { label: 'Pflichtangaben prüfen / Vorschau', onClick: () => this.withSaved(() => Vorgang.erechnungPruefen(this.id)) }]);
      m.style.transform = 'translateY(-100%)';
    } }, h('span', { class: 'ico' }, '🧾'), 'E-Rechnung ▾'));
    const ziele = { angebot: ['auftrag', 'lieferschein', 'rechnung'], auftrag: ['lieferschein', 'rechnung'], lieferschein: ['rechnung'], rechnung: [], korrektur: [] }[this.typ];
    if (ziele.length) items.push(h('button', { class: 'btn', onclick: ev => {
      const r = ev.currentTarget.getBoundingClientRect();
      const m = contextMenu(r.left, r.top, ziele.map(z => ({ label: 'Weiterführen als ' + ENT.V[z].title, onClick: () => this.withSaved(async () => { this.dirty = false; this.w.close(true); await Vorgang.convert(this.typ, this.id, z, 'wandeln'); }) })));
      m.style.transform = 'translateY(-100%)';
    } }, h('span', { class: 'ico' }, '➡'), 'Weiterführen ▾'));
    if (this.typ === 'rechnung' && this.id) items.push(h('button', { class: 'btn', onclick: () => this.withSaved(async () => { await Zahlung.erfassen(this.id); }) }, h('span', { class: 'ico' }, '💶'), 'Zahlung'));
    items.push(h('button', { class: 'btn', onclick: ev => {
      const r = ev.currentTarget.getBoundingClientRect();
      const m = contextMenu(r.left, r.top, [
        { label: 'PDF herunterladen', icon: '📄', onClick: () => this.withSaved(async () => { await Vorgang.pdf(this.typ, this.id); this.reloadEs(); }) },
        ...(isRe && Vorgang.land() === 'DE' ? [{ label: 'ZUGFeRD-PDF (mit XRechnung)', icon: '🧾', onClick: () => this.withSaved(() => Vorgang.zugferd(this.id)) }] : []),
        { label: 'Per E-Mail senden…', icon: '✉️', onClick: () => this.withSaved(async () => { await Mail.dialog('vorgang', this.typ, this.id); }) }]);
      m.style.transform = 'translateY(-100%)';
    } }, h('span', { class: 'ico' }, '✉️'), 'PDF / E-Mail ▾'));
    if (this.typ === 'auftrag') items.push(h('button', { class: 'btn', onclick: () => this.withSaved(() => Anzahlung.dialog(this.id)) }, h('span', { class: 'ico' }, '💰'), 'Anzahlung'));
    if (isRe && Vorgang.es()) { this.esBox = h('span', { class: 'es-status' }); items.push(this.esBox); this.drawEs(); }
    items.push('|',
      { label: 'Speichern', icon: '💾', title: 'Speichern (Strg+S)', onClick: () => this.save(false) },
      { label: 'OK', icon: '✔', cls: 'primary', onClick: () => this.save(true) },
      { label: 'Abbrechen', icon: '✖', onClick: () => this.w.close() });
    this.w.setButtons(items);
    this.w.el.append(this.w.foot);
  }
  async withSaved(fn) { if (this.dirty || !this.id) { const ok = await this.save(false); if (!ok) return; } return fn(); }
  async save(close) {
    // take over the field that is still being edited
    if (document.activeElement && this.w.el.contains(document.activeElement)) document.activeElement.dispatchEvent(new Event('change'));
    const k = { ...this.k }; delete k._preisgruppe; delete k._kunde;
    if (!k.KUNNAME && !(await confirmDlg('Es ist kein Kunde/Name eingetragen. Trotzdem speichern?'))) return false;
    try {
      const res = await api(`/api/vorgang/${this.typ}`, { method: 'POST', body: { kopf: k, pos: this.pos } });
      this.data = res; this.k = { ...res.kopf, _preisgruppe: this.k._preisgruppe }; this.pos = res.pos.map(p => ({ ...p }));
      this.dirty = false;
      this.w.el.querySelector('.win-title .t').textContent = this.title();
      if (this.refs[this.v.nr]) this.refs[this.v.nr].value = this.k[this.v.nr];
      this.drawPos();
      toast(`${this.v.title} ${this.k[this.v.nr]} gespeichert`, 'ok');
      App.refresh(this.v.ent);
      if (close) this.w.close(res);
      return true;
    } catch (e) { showError(e); return false; }
  }
  async reloadEs() {
    if (!Vorgang.es() || this.v.table !== 'RECHNUNGEN' || !this.id) return;
    const d = await api(`/api/vorgang/${this.typ}/${this.id}`);
    this.data = d; this.k = { ...d.kopf, _preisgruppe: this.k._preisgruppe }; this.dirty = false; this.drawEs();
  }
  // Spain: status of the invoice (issued / VERI*FACTU) next to the buttons
  drawEs() {
    if (!this.esBox) return;
    const es = this.data.es;
    this.esBox.textContent = '';
    if (!es) return;
    const st = { pendiente: '⏳ wartet auf Versand', aceptado: '✅ AEAT angenommen', aceptado_errores: '⚠ angenommen mit Fehlern', rechazado: '❌ abgelehnt' }[es.estado] || '';
    this.esBox.append(h('span', { class: 'chip', onclick: () => Vorgang.esStatus(this.typ, this.id).then(() => this.reloadEs()), title: 'VERI*FACTU-Status' },
      es.emitida ? `${es.numSerie} · ${es.tipo || ''} · ${T(st)}` : `${es.numSerie} · ${T('noch nicht ausgestellt')}`));
  }
  async print() {
    await this.withSaved(async () => {
      const d = await Vorgang.esEmitir(this.typ, this.id, this.data);
      if (!d) return;
      if (d !== this.data && d !== true) { this.data = d; this.k = { ...d.kopf, _preisgruppe: this.k._preisgruppe }; this.drawEs(); }
      await Print.vorgang(this.typ, this.data, { formular: this.formSel.value, rabatt: Number(this.k.RABATTZEIGEN) === 1 });
      if (!Number(this.k.GEDRUCKT)) { await api(`/api/vorgang/${this.typ}/flag`, { method: 'POST', body: { ids: [this.id], flag: 'GEDRUCKT', value: 1 } }); this.k.GEDRUCKT = 1; App.refresh(this.v.ent); }
    });
  }
}

// ---------- Recording payments ----------
const Zahlung = {
  async erfassen(rechnungid) {
    await LK.ensure();
    const d = await api(`/api/vorgang/rechnung/${rechnungid}`).catch(() => api(`/api/vorgang/korrektur/${rechnungid}`));
    const arten = LK.list('zahlungsarten').filter(a => a.id !== 6);
    const betrag = h('input', { type: 'text', class: 'num', value: fmt.num2(d.offen) });
    const datum = h('input', { type: 'date', value: today() });
    const art = h('select', null, arten.map(a => h('option', { value: a.id }, a.name)));
    const banks = (App.settings && App.settings.banks) || [];
    const bank = h('input', { type: 'text', list: 'dl-banks', placeholder: 'z. B. Bank1' });
    const skonto = d.kopf.SKONTO > 0 ? h('button', { class: 'btn sm', onclick: () => { betrag.value = fmt.num2(d.offen * (1 - d.kopf.SKONTO / 100)); } }, `abzgl. ${fmt.num(d.kopf.SKONTO)} % Skonto`) : null;
    const content = h('div', null,
      h('div', { class: 'note info', style: { marginBottom: '8px' } }, `Rechnung ${d.kopf.RECHNUNGNUMMER} · ${kname(d.kopf, 'KUN')} · Betrag ${fmt.money(d.kopf.GBRUTTO)} · offen ${fmt.money(d.offen)}`),
      h('div', { class: 'fgrid' },
        h('label', { class: 'fld w1' }, h('span', null, 'Betrag'), betrag), h('label', { class: 'fld w1' }, h('span', null, 'Datum'), datum),
        h('label', { class: 'fld w1' }, h('span', null, 'Zahlungsart'), art), h('label', { class: 'fld w1' }, h('span', null, 'Bank / Bemerkung'), bank, h('datalist', { id: 'dl-banks' }, banks.map(b => h('option', { value: b })))),
        skonto ? h('div', { class: 'fld' }, skonto) : null));
    const r = await dialog('Zahlung erfassen', content, [{ label: 'Zahlung buchen', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 520 });
    if (!r) return null;
    try {
      const res = await api('/api/zahlung', { method: 'POST', body: { RECHNUNGID: rechnungid, BETRAG: parseNum(betrag.value), DATUM: datum.value, ZAHLUNGSARTID: Number(art.value), BANKNAME: bank.value } });
      toast('Zahlung gebucht', 'ok'); App.refresh('rechnungen'); App.refresh('zahlungen'); App.refresh('kassenbuch');
      return res;
    } catch (e) { showError(e); return null; }
  },
};
