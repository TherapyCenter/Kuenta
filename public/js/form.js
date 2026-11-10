'use strict';
/* global h, $, $$, fmt, api, qs, parseNum, LK, ENT, Win, toast, showError, confirmDlg, promptDlg, Overview, miniGrid, pickFile, today, addMonths, App, Vorgang, kname, alertDlg */

// ---------- Field editors ----------
function labelOf(f) {
  return String(f.l || f.f).replace(/\$IND(\d+)/g, (_, n) => LK.ind(n));
}
function makeField(f, form) {
  const t = f.t || 'text';
  let input, get, set;
  const ro = !!f.ro;
  const numFmt = v => t === 'money' ? fmt.num2(v) : fmt.num(v, 4);
  switch (t) {
    case 'int': case 'num': case 'money': case 'pct':
      input = h('input', { type: 'text', class: 'num', inputmode: 'decimal', readonly: ro });
      get = () => input.value.trim() === '' ? null : (t === 'int' ? Math.round(parseNum(input.value)) : parseNum(input.value));
      set = v => { input.value = v == null || v === '' ? '' : (t === 'int' ? String(v) : numFmt(v)); };
      input.addEventListener('blur', () => { if (input.value.trim() !== '' && t !== 'int') input.value = numFmt(parseNum(input.value)); });
      break;
    case 'date':
      input = h('input', { type: 'date', readonly: ro });
      get = () => input.value || null; set = v => { input.value = v ? String(v).slice(0, 10) : ''; };
      break;
    case 'hu': {
      input = h('input', { type: 'month', readonly: ro });
      const wrap = h('div', { class: 'inline' }, input,
        h('button', { class: 'btn sm', type: 'button', title: 'HU in 2 Jahren', onclick: () => { input.value = addMonths(today(), 24).slice(0, 7); form && form.change(); } }, '+2J'),
        h('button', { class: 'btn sm', type: 'button', title: 'HU in 1 Jahr', onclick: () => { input.value = addMonths(today(), 12).slice(0, 7); form && form.change(); } }, '+1J'));
      get = () => input.value ? input.value + '-01' : null; set = v => { input.value = v ? String(v).slice(0, 7) : ''; };
      return { input, el: wrap, get, set };
    }
    case 'bool':
      input = h('input', { type: 'checkbox', disabled: ro });
      get = () => input.checked ? 1 : 0; set = v => { input.checked = Number(v) === 1; };
      break;
    case 'select': {
      input = h('select', { disabled: ro });
      const opts = f.opts ? f.opts.map(o => Array.isArray(o) ? { id: o[0], name: o[1] } : { id: o, name: o }) : LK.list(f.src);
      if (!f.opts || f.empty) input.append(h('option', { value: '' }, ''));
      for (const o of opts) input.append(h('option', { value: o.id }, o.name));
      get = () => { const v = input.value; if (v === '') return null; return /^-?\d+$/.test(v) && !(f.opts && typeof f.opts[0][0] === 'string') ? Number(v) : v; };
      set = v => {
        const s = v == null ? '' : String(v);
        if (s && ![...input.options].some(o => o.value === s)) input.append(h('option', { value: s }, s));
        input.value = s;
      };
      break;
    }
    case 'combo': {
      const id = 'dl' + Math.random().toString(36).slice(2);
      const list = f.opts || LK.list(f.src);
      input = h('input', { type: 'text', list: id, readonly: ro });
      const dl = h('datalist', { id }, list.map(o => h('option', { value: typeof o === 'string' ? o : o.name })));
      const wrap = h('div', { class: 'inline' }, input, dl);
      get = () => input.value.trim() || null; set = v => { input.value = v ?? ''; };
      return { input, el: wrap, get, set };
    }
    case 'radio': {
      const name = 'r' + Math.random().toString(36).slice(2);
      const wrap = h('div', { class: 'radios' });
      const inputs = f.opts.map(([v, l]) => { const i = h('input', { type: 'radio', name, value: v, disabled: ro }); wrap.append(h('label', null, i, l)); return i; });
      input = wrap;
      get = () => { const c = inputs.find(i => i.checked); return c ? Number(c.value) : null; };
      set = v => { inputs.forEach(i => { i.checked = String(i.value) === String(v ?? f.opts[0][0]); }); };
      wrap.addEventListener('change', () => form && form.change());
      return { input: wrap, el: wrap, get, set };
    }
    case 'memo':
      input = h('textarea', { rows: f.rows || 3, readonly: ro });
      get = () => input.value; set = v => { input.value = v ?? ''; };
      break;
    case 'password':
      input = h('input', { type: 'password', autocomplete: 'new-password' });
      get = () => input.value || null; set = () => { input.value = ''; };
      break;
    case 'kunde': case 'fahrzeug': {
      let val = null;
      const disp = h('input', { type: 'text', readonly: true, placeholder: t === 'kunde' ? '(kein Kunde)' : '(kein Fahrzeug)' });
      const pick = async () => {
        const r = t === 'kunde' ? await pickKunde() : f.ent ? await pickRecord(f.ent) : await pickFahrzeug({ kunid: form && form.values().KUNID });
        if (r) { val = t === 'kunde' ? r.KUNID : r.FAHR_ID; show(); form && form.change(); if (form && form.onPick) form.onPick(t, r); }
      };
      const show = async () => {
        if (!val) { disp.value = ''; return; }
        try {
          if (t === 'kunde') { const k = await api('/api/rec/kunden/' + val); disp.value = `${k.NUMMER || ''} · ${kname(k)} · ${k.ORT || ''}`; }
          else { const z = await api('/api/rec/fahrzeuge/' + val); disp.value = `${z.KENNZEICHEN || ''} · ${z.MARKE || ''} ${z.MODELL || ''}`; }
        } catch { disp.value = '#' + val; }
      };
      const wrap = h('div', { class: 'inline' }, disp,
        h('button', { class: 'btn icon', type: 'button', title: 'Auswählen', onclick: pick }, '🔍'),
        h('button', { class: 'btn icon', type: 'button', title: 'Entfernen', onclick: () => { val = null; show(); form && form.change(); } }, '✕'),
        h('button', { class: 'btn icon', type: 'button', title: 'Öffnen', onclick: () => val && editRecord(t === 'kunde' ? 'kunden' : 'fahrzeuge', val) }, '↗'));
      disp.addEventListener('dblclick', pick);
      get = () => val; set = v => { val = v || null; show(); };
      return { input: disp, el: wrap, get, set };
    }
    default:
      input = h('input', { type: t === 'email' ? 'email' : t === 'tel' ? 'tel' : 'text', readonly: ro });
      if (f.upper) input.addEventListener('input', () => { const p = input.selectionStart; input.value = input.value.toUpperCase(); input.setSelectionRange(p, p); });
      get = () => { const v = input.value.trim(); return v === '' ? null : v; }; set = v => { input.value = v ?? ''; };
  }
  return { input, el: input, get, set };
}

// ---------- Form ----------
class Form {
  constructor(ent, rec, opts = {}) {
    this.ent = ent; this.rec = { ...rec }; this.fields = {}; this.opts = opts; this.isDirty = false; this.subs = [];
    this.el = this.render();
    this.set(rec);
    this.isDirty = false;
  }
  change() { this.isDirty = true; if (this.opts.onChange) this.opts.onChange(this); }
  render() {
    const tabs = this.ent.form || [];
    const root = h('div', { class: 'form' });
    const tabbar = h('div', { class: 'tabs' });
    const panes = [];
    tabs.forEach((tab, i) => {
      const pane = h('div', { class: 'tabpane' + (i ? ' hidden' : '') });
      const btn = h('button', { type: 'button', class: i ? '' : 'active', onclick: () => {
        $$('button', tabbar).forEach(b => b.classList.remove('active')); btn.classList.add('active');
        panes.forEach(p => p.classList.add('hidden')); pane.classList.remove('hidden');
        if (tab.sub && !pane._loaded) { pane._loaded = true; this.loadSub(tab, pane); }
      } }, tab.tab);
      tabbar.append(btn);
      if (tab.groups) {
        const groups = h('div', { class: 'groups' });
        for (const g of tab.groups) {
          const grid = h('div', { class: 'fgrid' });
          for (const f of g.fields) {
            if (f.right && App.denied(f.right)) continue;
            const fe = makeField(f, this);
            this.fields[f.f] = { ...fe, def: f };
            const lab = h('label', { class: 'fld' + (f.w === 1 ? ' w1' : '') + (f.req ? ' req' : '') + (f.t === 'bool' ? ' chk' : '') }, h('span', null, labelOf(f)), fe.el);
            fe.input.addEventListener && fe.input.addEventListener('input', () => this.change());
            fe.input.addEventListener && fe.input.addEventListener('change', () => this.change());
            grid.append(lab);
          }
          groups.append(h('fieldset', { class: 'grp' }, h('legend', null, g.title), grid));
        }
        pane.append(groups);
      }
      panes.push(pane);
    });
    if (tabs.length > 1) root.append(tabbar);
    root.append(...panes);
    this.wireSpecial();
    return root;
  }
  wireSpecial() {
    const F = this.fields;
    // postcode -> town
    for (const [k, fe] of Object.entries(F)) {
      if (fe.def.t === 'plz') {
        fe.input.addEventListener('change', async () => {
          const ort = F.ORT; if (!ort) return;
          const list = await api('/api/plz/' + encodeURIComponent(fe.input.value.trim())).catch(() => []);
          if (list.length && (!ort.get() || list.length === 1)) ort.set(list[0]);
          if (list.length > 1) { const id = 'dlo' + k; let dl = $('#' + id); if (!dl) { dl = h('datalist', { id }); document.body.append(dl); } dl.innerHTML = ''; list.forEach(o => dl.append(h('option', { value: o }))); ort.input.setAttribute('list', id); }
        });
      }
    }
    // HSN/TSN -> KBA vehicle data
    if (F.SCHLUESSNR1 && F.SCHLUESSNR2) {
      const look = async () => {
        const hsn = F.SCHLUESSNR1.get(), tsn = F.SCHLUESSNR2.get();
        if (!hsn) return;
        const r = await api('/api/kba?' + qs({ hsn, tsn })).catch(() => null);
        if (!r) return;
        if (r.marke && F.MARKE && !F.MARKE.get()) F.MARKE.set(r.marke);
        if (r.modelle && r.modelle.length) {
          const m = r.modelle[0];
          if (F.MODELL && !F.MODELL.get()) F.MODELL.set(m.MODELL);
          if (F.KW && !F.KW.get()) { F.KW.set(m.KW); if (F.PS && !F.PS.get()) F.PS.set(Math.round(m.KW * 1.35962)); }
          if (F.HUBRAUM && !F.HUBRAUM.get()) F.HUBRAUM.set(m.HUBRAUM);
          if (F.KRAFTSTOFF && !F.KRAFTSTOFF.get() && m.KRAFTSTOFF) F.KRAFTSTOFF.set(m.KRAFTSTOFF);
          toast(`KBA: ${r.marke || ''} ${m.MODELL}`);
        }
      };
      F.SCHLUESSNR1.input.addEventListener('change', look);
      F.SCHLUESSNR2.input.addEventListener('change', look);
    }
    if (F.KW && F.PS) F.KW.input.addEventListener('change', () => { if (!F.PS.get() && F.KW.get()) F.PS.set(Math.round(F.KW.get() * 1.35962)); });
  }
  set(rec) {
    this.rec = { ...rec };
    for (const [k, fe] of Object.entries(this.fields)) fe.set(rec[k]);
  }
  values() {
    const out = { ...this.rec };
    for (const [k, fe] of Object.entries(this.fields)) out[k] = fe.get();
    return out;
  }
  validate() {
    for (const [, fe] of Object.entries(this.fields)) {
      if (fe.def.req && (fe.get() == null || fe.get() === '')) {
        fe.input.classList && fe.input.classList.add('err');
        const pane = fe.el.closest('.tabpane');
        if (pane && pane.classList.contains('hidden')) { const idx = [...pane.parentNode.querySelectorAll(':scope > .tabpane')].indexOf(pane); const b = $$('.tabs button', this.el)[idx]; if (b) b.click(); }
        fe.input.focus && fe.input.focus();
        toast(`Bitte "${labelOf(fe.def)}" ausfüllen.`, 'err');
        return false;
      }
    }
    return true;
  }
  async loadSub(tab, pane) {
    const id = this.rec[this.ent.pk];
    if (!id) { pane.append(h('div', { class: 'note info' }, 'Bitte speichern Sie den Datensatz zuerst (OK), um diesen Bereich zu nutzen.')); return; }
    const fn = SUBS[tab.sub];
    if (fn) { try { await fn(pane, id, this, tab); } catch (e) { showError(e); } }
  }
}

// ---------- Edit a record ----------
async function editRecord(entName, id, defaults = {}, opts = {}) {
  await LK.ensure();
  const e = ENT.E[entName];
  let rec;
  if (id) rec = await api(`/api/rec/${entName}/${id}`);
  else {
    rec = { ...defaults };
    if (e.number && rec[e.number.f] == null) { try { rec[e.number.f] = (await api('/api/nextnumber/' + entName)).nr; } catch { /* ignore */ } }
    if (entName === 'kunden') { rec.ART = rec.ART ?? 0; rec.LAND = rec.LAND || 'DE'; }
    if (entName === 'reifen') { rec.EINDATUM = rec.EINDATUM || today(); rec.STATUS = 0; rec.REIFENANZAHL = rec.REIFENANZAHL ?? 4; }
    if (entName === 'kassenbuch') { rec.DATUM = today(); rec.ART = 1; }
    if (entName === 'artikel' || entName === 'arbeitswerte') rec.MWST = rec.MWST || 61;
    if (entName === 'aufgaben') { rec.PRIORITAET = 1; rec.FAELLIG = today(); }
    if (entName === 'briefe') rec.DATUM = today();
  }
  return new Promise(resolve => {
    const form = new Form(e, rec);
    const title = id ? `${e.one} bearbeiten` : `${e.one} anlegen`;
    const big = (e.form || []).length > 1;
    const w = Win.open({ title, width: big ? 980 : 640, height: big ? 680 : undefined, content: form.el, onClose: r => resolve(r || null) });
    w.beforeClose = async () => !form.isDirty || confirmDlg('Änderungen verwerfen?', { ok: 'Verwerfen', cancel: 'Zurück' });
    const save = async (close = true) => {
      if (!form.validate()) return null;
      try {
        const vals = form.values();
        const saved = id ? await api(`/api/rec/${entName}/${id}`, { method: 'PUT', body: vals }) : await api(`/api/rec/${entName}`, { method: 'POST', body: vals });
        form.isDirty = false;
        toast(`${e.one} gespeichert`, 'ok');
        if (opts.afterSave) await opts.afterSave(saved);
        App.refresh(entName);
        if (close) w.close(saved);
        return saved;
      } catch (err) { showError(err); return null; }
    };
    const btns = [];
    if (id && !e.readonly) btns.push({ label: 'Löschen', icon: '🗑', cls: 'danger', onClick: async () => {
      if (!(await confirmDlg(`${e.one} wirklich löschen?\nDies kann nicht rückgängig gemacht werden.`, { danger: true, ok: 'Löschen' }))) return;
      try { await api(`/api/rec/${entName}/${id}`, { method: 'DELETE' }); form.isDirty = false; toast(`${e.one} gelöscht`); App.refresh(entName); w.close(null); } catch (err) { showError(err); }
    } });
    if (entName === 'kunden' && id) btns.push(vorgangNeuButton(() => ({ kunid: id })));
    if (entName === 'fahrzeuge' && id) btns.push(vorgangNeuButton(async () => { const hl = await api(`/api/fahrzeuge/${id}/halter`); return { fahrid: id, kunid: hl[0] && hl[0].KUNID }; }));
    if (entName === 'reifen' && id) btns.push({ label: 'Drucken', icon: '🖨', onClick: async () => { const s = await save(false); if (s) Print.reifen(s); } });
    if (entName === 'briefe' && id) btns.push({ label: 'Drucken', icon: '🖨', onClick: async () => { const s = await save(false); if (s) Print.brief(s); } });
    if (entName === 'benutzer' && id) btns.push({ label: 'Rechte…', icon: '🔑', onClick: () => editRechte(id) });
    btns.push('|', { label: 'OK', icon: '✔', cls: 'primary', onClick: () => save(true) }, { label: 'Abbrechen', icon: '✖', onClick: () => w.close() });
    w.setButtons(btns);
    if (!w.foot.parentNode) w.el.append(w.foot);
    form.el.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.ctrlKey) save(true); });
    if (opts.onOpen) opts.onOpen(form, w);
  });
}
function vorgangNeuButton(getParams) {
  const btn = h('button', { class: 'btn', onclick: async ev => {
    const p = await getParams();
    contextMenu(ev.clientX, ev.clientY - 160, [
      { label: 'Neues Angebot', icon: '📝', onClick: () => Vorgang.open('angebot', null, p) },
      { label: 'Neuer Auftrag', icon: '🛠️', onClick: () => Vorgang.open('auftrag', null, p) },
      { label: 'Neuer Lieferschein', icon: '📃', onClick: () => Vorgang.open('lieferschein', null, p) },
      { label: 'Neue Rechnung', icon: '💶', onClick: () => Vorgang.open('rechnung', null, p) },
    ]);
  } }, h('span', { class: 'ico' }, '➕'), 'Neuer Vorgang ▾');
  return btn;
}

// ---------- Selection dialogs ----------
function pickRecord(entName, { title, params, newDefaults } = {}) {
  const e = ENT.E[entName];
  return new Promise(resolve => {
    let ov;
    const w = Win.open({ title: title || `${e.one} auswählen`, width: 1000, height: 600, flex: true, onClose: r => resolve(r || null) });
    ov = new Overview(entName, { params, onOpen: r => w.close(r) });
    w.body.append(ov.el);
    w.setButtons([
      { label: 'Neu', icon: '➕', onClick: async () => { const r = await editRecord(entName, null, newDefaults || {}); if (r) w.close(r); } },
      { label: 'Bearbeiten', icon: '✏️', onClick: async () => { const c = ov.current(); if (c) { await editRecord(entName, c[e.pk]); ov.reload(); } } },
      '|',
      { label: 'OK', icon: '✔', cls: 'primary', onClick: () => { const c = ov.current(); if (c) w.close(c); } },
      { label: 'Abbrechen', icon: '✖', onClick: () => w.close(null) }]);
    w.el.append(w.foot);
    setTimeout(() => ov.inp.focus(), 50);
  });
}
const pickKunde = () => pickRecord('kunden', { title: 'Kunde auswählen' });
async function pickFahrzeug({ kunid } = {}) {
  if (!kunid) return pickRecord('fahrzeuge', { title: 'Fahrzeug auswählen' });
  const list = await api(`/api/kunden/${kunid}/fahrzeuge`);
  return new Promise(resolve => {
    const cols = [{ f: 'KENNZEICHEN', l: 'Kennzeichen', w: 110 }, { f: 'FZIDENTNR', l: 'Fz.-Ident.-Nr.', w: 170 }, { f: 'SCHLUESSNR1', l: 'HSN', w: 55 }, { f: 'SCHLUESSNR2', l: 'TSN', w: 70 }, { f: 'MARKE', l: 'Marke', w: 150 }, { f: 'MODELL', l: 'Modell', w: 170 }, { f: 'EZ', l: 'EZ', w: 90, t: 'date' }, { f: 'KM', l: 'KM', w: 80, t: 'int' }];
    const g = miniGrid(cols, list, { onOpen: r => w.close(r), empty: 'Dem Kunden ist kein Fahrzeug zugeordnet.' });
    const w = Win.open({ title: 'Kundenfahrzeug auswählen', width: 960, height: 460, flex: true, content: g.el, onClose: r => resolve(r || null) });
    w.setButtons([
      { label: 'Neues Fahrzeug', icon: '🚗', onClick: async () => { const r = await editRecord('fahrzeuge', null, {}, { afterSave: s => api(`/api/kunden/${kunid}/fahrzeuge/${s.FAHR_ID}`, { method: 'PUT' }) }); if (r) w.close(r); } },
      { label: 'Alle Fahrzeuge…', icon: '🔍', onClick: async () => { const r = await pickRecord('fahrzeuge'); if (r) w.close(r); } },
      '|',
      { label: 'OK', icon: '✔', cls: 'primary', onClick: () => { const c = g.current(); if (c) w.close(c); } },
      { label: 'Ohne Fahrzeug', icon: '✖', onClick: () => w.close(null) }]);
    w.el.append(w.foot);
  });
}

// ---------- Sub sections ----------
const SUBS = {
  async kundenFahrzeuge(pane, id) {
    const cols = [{ f: 'FRZNUMMER', l: 'Fz.-Nr.', w: 70 }, { f: 'KENNZEICHEN', l: 'Kennzeichen', w: 110 }, { f: 'MARKE', l: 'Marke', w: 140 }, { f: 'MODELL', l: 'Modell', w: 170 }, { f: 'FZIDENTNR', l: 'Fz.-Ident.-Nr.', w: 160 }, { f: 'EZ', l: 'EZ', w: 90, t: 'date' }, { f: 'HU', l: 'HU', w: 70, t: 'month' }, { f: 'KM', l: 'KM', w: 80 }];
    const g = miniGrid(cols, await api(`/api/kunden/${id}/fahrzeuge`), { onOpen: r => editRecord('fahrzeuge', r.FAHR_ID).then(refresh), height: 330 });
    const refresh = async () => g.set(await api(`/api/kunden/${id}/fahrzeuge`));
    pane.append(h('div', { class: 'form-row', style: { marginBottom: '6px' } },
      h('button', { class: 'btn', onclick: async () => { await editRecord('fahrzeuge', null, {}, { afterSave: s => api(`/api/kunden/${id}/fahrzeuge/${s.FAHR_ID}`, { method: 'PUT' }) }); refresh(); } }, '🚗 Neues Fahrzeug'),
      h('button', { class: 'btn', onclick: async () => { const f = await pickRecord('fahrzeuge', { title: 'Fahrzeug zuordnen' }); if (f) { await api(`/api/kunden/${id}/fahrzeuge/${f.FAHR_ID}`, { method: 'PUT' }); refresh(); } } }, '🔗 Fahrzeug zuordnen'),
      h('button', { class: 'btn', onclick: () => { const c = g.current(); if (c) editRecord('fahrzeuge', c.FAHR_ID).then(refresh); } }, '✏️ Bearbeiten'),
      h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c && await confirmDlg(`Zuordnung von ${c.KENNZEICHEN || 'Fahrzeug'} entfernen?\n(Das Fahrzeug selbst bleibt erhalten.)`)) { await api(`/api/kunden/${id}/fahrzeuge/${c.FAHR_ID}`, { method: 'DELETE' }); refresh(); } } }, '✂ Zuordnung entfernen')), g.el);
  },
  async kundenVorgaenge(pane, id) {
    const cols = [{ f: 'art', l: 'Vorgang', w: 130 }, { f: 'nr', l: 'Nummer', w: 90 }, { f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'FAHRKENNZEICHEN', l: 'Kennzeichen', w: 110 }, { f: 'GBRUTTO', l: 'Brutto', w: 100, t: 'money' }, { f: 'offen', l: 'Offen', w: 100, t: 'money' }];
    const rows = await api(`/api/kunden/${id}/vorgaenge`);
    const umsatz = rows.filter(r => r.typ === 'rechnung' || r.typ === 'korrektur').reduce((s, r) => s + r.GBRUTTO, 0);
    const g = miniGrid(cols, rows, { onOpen: r => Vorgang.open(r.typ, r.id), height: 360 });
    pane.append(h('div', { class: 'form-row', style: { marginBottom: '6px' } }, h('span', { class: 'hint' }, `${rows.length} Vorgänge · Umsatz brutto gesamt: ${fmt.money(umsatz)}`)), g.el);
  },
  async fahrzeugHalter(pane, id) {
    const cols = [{ f: 'NUMMER', l: 'Kd.-Nr.', w: 80 }, { f: 'NAME', l: 'Name', w: 180 }, { f: 'VORNAME', l: 'Vorname', w: 120 }, { f: 'STRASSE', l: 'Straße', w: 160 }, { f: 'PLZ', l: 'PLZ', w: 60 }, { f: 'ORT', l: 'Ort', w: 120 }, { f: 'TELEFON', l: 'Telefon', w: 120 }];
    const g = miniGrid(cols, await api(`/api/fahrzeuge/${id}/halter`), { onOpen: r => editRecord('kunden', r.KUNID), height: 300 });
    const refresh = async () => g.set(await api(`/api/fahrzeuge/${id}/halter`));
    pane.append(h('div', { class: 'form-row', style: { marginBottom: '6px' } },
      h('button', { class: 'btn', onclick: async () => { const k = await pickKunde(); if (k) { await api(`/api/kunden/${k.KUNID}/fahrzeuge/${id}`, { method: 'PUT' }); refresh(); } } }, '🔗 Halter zuordnen'),
      h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c && await confirmDlg('Zuordnung entfernen?')) { await api(`/api/kunden/${c.KUNID}/fahrzeuge/${id}`, { method: 'DELETE' }); refresh(); } } }, '✂ Zuordnung entfernen')), g.el);
  },
  async fahrzeugReifen(pane, id, form) {
    const cols = [{ f: 'EINLNUMMER', l: 'Einl.-Nr.', w: 80 }, { f: 'EINDATUM', l: 'Eingelagert', w: 95, t: 'date' }, { f: 'AUSDATUM', l: 'Ausgelagert', w: 95, t: 'date' }, { f: 'st', l: 'Status', w: 90, render: r => r.STATUS ? 'ausgelagert' : 'eingelagert' }, { f: 'LAGERORT', l: 'Lagerort', w: 100 }, { f: 'groesse', l: 'Größe', w: 110 }, { f: 'REIFENVORNEHERSTELLER', l: 'Hersteller', w: 120 }];
    const g = miniGrid(cols, await api(`/api/fahrzeuge/${id}/reifen`), { onOpen: r => editRecord('reifen', r.EINLAGERUNGID).then(refresh), height: 300 });
    const refresh = async () => g.set(await api(`/api/fahrzeuge/${id}/reifen`));
    pane.append(h('div', { class: 'form-row', style: { marginBottom: '6px' } },
      h('button', { class: 'btn', onclick: async () => { const hl = await api(`/api/fahrzeuge/${id}/halter`); await editRecord('reifen', null, { FAHRZEUGID: id, KUNID: hl[0] && hl[0].KUNID, REIFENVORNEBREITE: null }); refresh(); } }, '⭕ Neue Einlagerung')), g.el);
    void form;
  },
  async fahrzeugHistorie(pane, id) {
    const cols = [{ f: 'art', l: 'Vorgang', w: 120 }, { f: 'nr', l: 'Nummer', w: 85 }, { f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'km', l: 'KM', w: 75 }, { f: 'leistungen', l: 'Leistungen', w: 380 }, { f: 'GBRUTTO', l: 'Brutto', w: 90, t: 'money' }];
    pane.append(miniGrid(cols, await api(`/api/fahrzeuge/${id}/historie`), { onOpen: r => Vorgang.open(r.typ, r.id), height: 380 }).el);
  },
  async artikelBewegungen(pane, id) {
    const cols = [{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'ANZAHL', l: 'Menge', w: 80, t: 'num' }, { f: 'BESCHREIBUNG', l: 'Beschreibung', w: 360 }, { f: 'EINGABETYP', l: 'Typ', w: 50 }];
    const g = miniGrid(cols, await api(`/api/artikel/${id}/bewegungen`), { height: 320 });
    pane.append(h('div', { class: 'form-row', style: { marginBottom: '6px' } },
      h('button', { class: 'btn', onclick: async () => {
        const v = await promptDlg('Menge (positiv = Zugang, negativ = Abgang)', '', { title: 'Lagerbewegung buchen' });
        if (v == null || v === '') return;
        const t = await promptDlg('Beschreibung', 'Wareneingang', { title: 'Lagerbewegung buchen' });
        await api(`/api/artikel/${id}/bewegung`, { method: 'POST', body: { ANZAHL: parseNum(v), BESCHREIBUNG: t } });
        g.set(await api(`/api/artikel/${id}/bewegungen`)); toast('Lagerbewegung gebucht', 'ok');
      } }, '📦 Lagerbewegung buchen')), g.el);
  },
  async dokumente(pane, id, form, tab) {
    const bezug = tab.bezug;
    const list = h('div', { class: 'docs' });
    const refresh = async () => {
      const docs = await api('/api/dokumente?' + qs({ bezug, id }));
      list.innerHTML = '';
      if (!docs.length) list.append(h('div', { class: 'hint' }, 'Noch keine Dokumente oder Fotos.'));
      for (const d of docs) {
        const url = '/dateien/' + d.PFAD.split('/').map(encodeURIComponent).join('/');
        const isImg = /^image\//.test(d.MIME || '') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(d.DATEINAME);
        list.append(h('div', { class: 'doc' },
          h('a', { class: 'thumb', href: url, target: '_blank' }, isImg ? h('img', { src: url, loading: 'lazy', alt: '' }) : (/\.pdf$/i.test(d.DATEINAME) ? '📄' : '📎')),
          h('div', { class: 'n', title: d.DATEINAME }, d.DATEINAME),
          h('div', { class: 'hint' }, fmt.date(d.DATUM), ' · ', Math.max(1, Math.round((d.GROESSE || 0) / 1024)) + ' KB'),
          h('div', { class: 'inline' }, h('a', { class: 'btn sm', href: url + '?download=1' }, '⬇'), h('button', { class: 'btn sm', onclick: async () => { if (await confirmDlg(`"${d.DATEINAME}" löschen?`)) { await api('/api/dokumente/' + d.ID, { method: 'DELETE' }); refresh(); } } }, '🗑'))));
      }
    };
    const upload = async files => {
      for (const f of files) await api('/api/dokumente?' + qs({ bezug, id, name: f.name }), { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
      toast(`${files.length} Datei(en) hochgeladen`, 'ok'); refresh();
    };
    const dz = h('div', { class: 'dropzone', onclick: async () => { const f = await pickFile('*/*', true); if (f && f.length) upload(f); } }, '📂 Dateien hierher ziehen oder klicken (Fotos, PDF, Fahrzeugschein, …)');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]); });
    pane.append(dz, list);
    refresh();
    void form;
  },
};

async function editRechte(benid) {
  const s = await api('/api/einstellungen');
  const denied = new Set(await api(`/api/benutzer/${benid}/rechte`));
  const groups = {};
  for (const r of s.rechte) (groups[r.KATEGORIE] = groups[r.KATEGORIE] || []).push(r);
  const boxes = [];
  const content = h('div', { class: 'groups' }, Object.entries(groups).map(([k, list]) => h('fieldset', { class: 'grp' }, h('legend', null, k),
    list.map(r => { const c = h('input', { type: 'checkbox', checked: !denied.has(r.ID) }); boxes.push([r.ID, c]); return h('label', { class: 'fld chk' }, c, h('span', null, r.BEZEICHNUNG.replace('bearbieten', 'bearbeiten'))); }))));
  const w = Win.open({ title: 'Benutzerrechte (Haken = erlaubt)', width: 900, height: 620, content });
  w.setButtons(['|', { label: 'OK', cls: 'primary', icon: '✔', onClick: async () => { await api(`/api/benutzer/${benid}/rechte`, { method: 'PUT', body: boxes.filter(([, c]) => !c.checked).map(([id]) => id) }); toast('Rechte gespeichert', 'ok'); w.close(true); } }, { label: 'Abbrechen', onClick: () => w.close() }]);
  w.el.append(w.foot);
}
