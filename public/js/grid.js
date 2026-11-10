'use strict';
/* global h, $, $$, fmt, api, qs, Pref, contextMenu, ENT, showError, I18N, T, raw, LOCALE */

// Cell text; plain values are only translated when they match a known word exactly (status texts like "bezahlt"),
// so customer names or item texts are never changed

function cellText(col, v) {
  switch (col.t) {
    case 'money': return fmt.money0(v);
    case 'num': return fmt.num(v);
    case 'pct': return fmt.pct(v);
    case 'date': return fmt.date(v);
    case 'month': return fmt.month(v);
    case 'datetime': return fmt.datetime(v);
    case 'bool': return fmt.bool(v);
    default: return v == null ? '' : I18N.word(String(v));
  }
}
const isNumCol = c => ['money', 'num', 'int', 'pct'].includes(c.t);

// Module overview with search bar, status filters and toolbar
class Overview {
  constructor(entName, opts = {}) {
    this.name = entName;
    this.e = ENT.E[entName];
    this.opts = opts;
    this.rows = []; this.total = 0; this.sel = new Set(); this.anchor = null;
    const saved = Pref.get('ov.' + entName, {});
    this.state = { q: '', field: saved.field || (this.e.search && this.e.search[0] && this.e.search[0].f), letter: '', sort: saved.sort || '', dir: saved.dir || '', filters: saved.filters || {}, von: opts.von || '', bis: opts.bis || '' };
    this.colState = saved.cols || null; // [{f, w, hidden}]
    this.el = this.render();
    this.load();
  }
  savePrefs() {
    Pref.set('ov.' + this.name, { field: this.state.field, sort: this.state.sort, dir: this.state.dir, filters: this.state.filters, cols: this.colState });
  }
  columns() {
    const base = this.e.columns.filter(c => !(c.right && App.denied(c.right)));
    if (!this.colState) return base.map(c => ({ ...c }));
    const out = [];
    for (const s of this.colState) { const c = base.find(x => x.f === s.f); if (c) out.push({ ...c, w: s.w || c.w, hidden: s.hidden }); }
    for (const c of base) if (!out.find(x => x.f === c.f)) out.push({ ...c });
    return out;
  }
  render() {
    const e = this.e;
    const root = h('div', { class: 'overview' });
    // search bar
    const sb = h('div', { class: 'searchbar' });
    this.inp = h('input', { type: 'search', placeholder: 'Suchbegriff + Enter', value: this.state.q });
    this.inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { this.state.q = this.inp.value; this.load(); } });
    this.inp.addEventListener('search', () => { if (!this.inp.value) { this.state.q = ''; this.load(); } });
    let tmr; this.inp.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { if (this.inp.value.length === 0 || this.inp.value.length >= 2) { this.state.q = this.inp.value; this.load(); } }, 450); });
    sb.append(h('label', null, 'Suche', this.inp));
    if (e.search && e.search.length > 1) {
      const sel = h('select', { onchange: () => { this.state.field = sel.value; this.savePrefs(); if (this.state.q) this.load(); } }, e.search.map(s => h('option', { value: s.f, selected: s.f === this.state.field }, s.l)));
      sb.append(h('label', null, 'in Spalte', sel));
    }
    for (const sf of e.statusFilters || []) {
      const cur = this.state.filters[sf.key] || sf.opts[0].k;
      const sel = h('select', { onchange: () => { this.state.filters[sf.key] = sel.value; this.savePrefs(); this.load(); } }, sf.opts.map(o => h('option', { value: o.k, selected: o.k === cur }, o.l)));
      sb.append(h('label', null, sf.l, sel));
    }
    if (e.monthFilter) {
      const von = h('input', { type: 'date', value: this.state.von, onchange: () => { this.state.von = von.value; this.load(); } });
      const bis = h('input', { type: 'date', value: this.state.bis, onchange: () => { this.state.bis = bis.value; this.load(); } });
      sb.append(h('label', null, 'von', von), h('label', null, 'bis', bis));
    }
    if (this.opts.extraSearch) sb.append(this.opts.extraSearch(this));
    if (e.letter) {
      const letters = h('div', { class: 'letters' });
      for (const l of ['*', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'Ä', 'Ö', 'Ü', '123']) {
        letters.append(h('button', { class: (l === '*' && !this.state.letter) ? 'active' : '', onclick: ev => {
          this.state.letter = l === '*' ? '' : l; $$('button', letters).forEach(b => b.classList.remove('active')); ev.target.classList.add('active'); this.load();
        } }, l));
      }
      sb.append(letters);
    }
    root.append(sb);
    // table
    this.wrap = h('div', { class: 'grid-wrap', tabindex: 0 });
    this.wrap.addEventListener('scroll', () => { if (this.wrap.scrollTop + this.wrap.clientHeight > this.wrap.scrollHeight - 200) this.more(); });
    this.wrap.addEventListener('keydown', ev => this.key(ev));
    root.append(this.wrap);
    // toolbar
    const ft = h('div', { class: 'grid-footer' });
    const more = this.opts.moreMenu;
    if (more) ft.append(h('div', { class: 'btn-split' },
      h('button', { class: 'btn', onclick: ev => this.showMenu(ev) }, 'Weitere Funktionen'),
      h('button', { class: 'btn', onclick: ev => this.showMenu(ev) }, '▾')));
    this.info = h('span', { class: 'info' });
    ft.append(this.info, h('span', { class: 'spacer' }));
    for (const b of this.opts.buttons || []) ft.append(h('button', { class: 'btn ' + (b.cls || ''), title: b.title || '', onclick: () => b.onClick(this) }, b.icon ? h('span', { class: 'ico' }, b.icon) : null, b.label));
    root.append(ft);
    return root;
  }
  showMenu(ev) {
    const r = ev.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.top - 4, this.opts.moreMenu(this)).style.transform = 'translateY(-100%)';
  }
  params(offset = 0) {
    return qs({ q: this.state.q, field: this.state.field, letter: this.state.letter, sort: this.state.sort, dir: this.state.dir, filters: this.state.filters, von: this.state.von, bis: this.state.bis, offset, limit: 200, ...(this.opts.params || {}) });
  }
  async load(keepSel = false) {
    const myReq = this.req = (this.req || 0) + 1;
    try {
      const res = await api(`/api/list/${this.name}?${this.params(0)}`);
      if (myReq !== this.req) return;
      this.rows = res.rows; this.total = res.total; this.sums = res.sums;
      if (!keepSel) { this.sel.clear(); if (this.rows[0]) this.sel.add(this.rows[0][this.e.pk]); }
      else { const ids = new Set(this.rows.map(r => r[this.e.pk])); for (const s of [...this.sel]) if (!ids.has(s)) this.sel.delete(s); }
      this.draw();
    } catch (e) { showError(e); }
  }
  async more() {
    if (this.loading || this.rows.length >= this.total) return;
    this.loading = true;
    try {
      const res = await api(`/api/list/${this.name}?${this.params(this.rows.length)}`);
      this.rows.push(...res.rows); this.appendRows(res.rows);
    } catch (e) { showError(e); } finally { this.loading = false; }
  }
  reload() { return this.load(true); }
  draw() {
    const cols = this.columns().filter(c => !c.hidden);
    this.visCols = cols;
    const tbl = h('table', { class: 'grid' });
    const cg = h('colgroup', null, cols.map(c => h('col', { style: { width: (c.w || 120) + 'px' } })));
    const tr = h('tr');
    cols.forEach((c, i) => {
      const sorted = (this.state.sort || this.e.sort) === c.f;
      const dir = this.state.dir || (sorted && !this.state.sort ? this.e.sortDir : '') || 'asc';
      const th = h('th', { class: isNumCol(c) ? 'num' : '', title: c.l }, c.l, sorted ? h('span', { class: 'sort' }, dir === 'desc' ? '▼' : '▲') : null);
      th.addEventListener('click', ev => {
        if (ev.target.classList.contains('rs')) return;
        if ((this.state.sort || this.e.sort) === c.f) this.state.dir = dir === 'asc' ? 'desc' : 'asc'; else { this.state.sort = c.f; this.state.dir = isNumCol(c) || c.t === 'date' ? 'desc' : 'asc'; }
        this.savePrefs(); this.load();
      });
      th.addEventListener('contextmenu', ev => { ev.preventDefault(); this.columnChooser(ev.clientX, ev.clientY); });
      const rs = h('span', { class: 'rs' });
      rs.addEventListener('mousedown', ev => {
        ev.preventDefault(); ev.stopPropagation();
        const col = cg.children[i]; const sx = ev.clientX; const sw = col.offsetWidth || c.w || 120;
        const mv = e2 => { col.style.width = Math.max(30, sw + e2.clientX - sx) + 'px'; };
        const up = () => {
          document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
          const all = this.columns(); const t = all.find(x => x.f === c.f); t.w = parseInt(col.style.width, 10);
          this.colState = all.map(x => ({ f: x.f, w: x.w, hidden: x.hidden })); this.savePrefs();
        };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      });
      th.style.position = 'sticky'; th.append(rs);
      tr.append(th);
    });
    this.tbody = h('tbody');
    tbl.append(cg, h('thead', null, tr), this.tbody);
    if (this.sums && Object.keys(this.sums).length) {
      tbl.append(h('tfoot', null, h('tr', null, cols.map((c, i) => h('td', { class: isNumCol(c) ? 'num' : '' }, i === 0 ? 'Summe' : (this.sums[c.f] != null ? fmt.money0(this.sums[c.f]) : ''))))));
    }
    this.wrap.innerHTML = '';
    this.wrap.append(tbl);
    if (!this.rows.length) this.wrap.append(h('div', { class: 'grid-empty' }, this.state.q || this.state.letter ? 'Keine passenden Einträge gefunden.' : 'Noch keine Einträge vorhanden.'));
    this.appendRows(this.rows);
    this.updateInfo();
  }
  appendRows(rows) {
    const cols = this.visCols; const pk = this.e.pk;
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const tr = h('tr', { class: this.sel.has(r[pk]) ? 'sel' : '' });
      tr._row = r;
      for (const c of cols) {
        let v = cellText(c, r[c.f]);
        let td;
        if (this.opts.cell && (td = this.opts.cell(c, r))) { tr.append(td); continue; }
        const td2 = h('td', { class: isNumCol(c) ? 'num' : '' }, raw(v)); if (v.length > 18) td2.title = v;
        tr.append(td2);
      }
      tr.addEventListener('mousedown', ev => this.select(r, ev));
      tr.addEventListener('dblclick', () => this.opts.onOpen && this.opts.onOpen(r, this));
      tr.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        if (!this.sel.has(r[pk])) this.select(r, {});
        if (this.opts.moreMenu) contextMenu(ev.clientX, ev.clientY, this.opts.moreMenu(this));
      });
      frag.append(tr);
    }
    this.tbody.append(frag);
    this.updateInfo();
  }
  updateInfo() { this.info.textContent = T(`${this.total.toLocaleString(LOCALE)} Einträge${this.sel.size > 1 ? ` · ${this.sel.size} markiert` : ''}`); }
  select(r, ev) {
    const pk = this.e.pk; const id = r[pk];
    if (ev.shiftKey && this.anchor != null) {
      const ids = this.rows.map(x => x[pk]); const a = ids.indexOf(this.anchor), b = ids.indexOf(id);
      this.sel = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (ev.ctrlKey || ev.metaKey) { if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id); this.anchor = id; }
    else { this.sel = new Set([id]); this.anchor = id; }
    for (const tr of this.tbody.children) tr.classList.toggle('sel', this.sel.has(tr._row[pk]));
    this.updateInfo();
    if (this.opts.onSelect) this.opts.onSelect(this.current(), this);
  }
  current() { const pk = this.e.pk; const id = [...this.sel][0]; return this.rows.find(r => r[pk] === id) || null; }
  selected() { const pk = this.e.pk; return this.rows.filter(r => this.sel.has(r[pk])); }
  key(ev) {
    const pk = this.e.pk; const ids = this.rows.map(r => r[pk]);
    let i = ids.indexOf([...this.sel][0]);
    if (ev.key === 'ArrowDown') i = Math.min(ids.length - 1, i + 1);
    else if (ev.key === 'ArrowUp') i = Math.max(0, i - 1);
    else if (ev.key === 'Enter') { const c = this.current(); if (c && this.opts.onOpen) this.opts.onOpen(c, this); return; }
    else if (ev.key === 'Delete' && this.opts.onDelete) { this.opts.onDelete(this); return; }
    else return;
    ev.preventDefault();
    this.select(this.rows[i], {});
    const tr = this.tbody.children[i]; if (tr) tr.scrollIntoView({ block: 'nearest' });
  }
  columnChooser(x, y) {
    const all = this.columns();
    const items = all.map(c => ({ label: (c.hidden ? '☐ ' : '☑ ') + c.l, onClick: () => {
      c.hidden = !c.hidden; this.colState = all.map(z => ({ f: z.f, w: z.w, hidden: z.hidden })); this.savePrefs(); this.draw();
    } }));
    items.push('-', { label: 'Spalten zurücksetzen', onClick: () => { this.colState = null; this.savePrefs(); this.draw(); } });
    items.push({ label: 'Tabelle als CSV exportieren', onClick: () => this.exportCsv() });
    contextMenu(x, y, items);
  }
  async exportCsv() {
    const res = await api(`/api/list/${this.name}?${this.params(0).replace('limit=200', 'limit=5000')}`);
    const cols = this.columns().filter(c => !c.hidden);
    const escv = v => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map(c => escv(c.l)).join(';'), ...res.rows.map(r => cols.map(c => escv(isNumCol(c) && r[c.f] != null ? String(r[c.f]).replace('.', ',') : cellText(c, r[c.f]))).join(';'))];
    saveBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), `${this.e.title}.csv`);
  }
}

// Simple table for local data (sub lists)
function miniGrid(columns, rows, { onOpen, onSelect, empty = 'Keine Einträge', height, footer, rowClass } = {}) {
  let selIdx = rows.length ? 0 : -1;
  const tbody = h('tbody');
  const wrap = h('div', { class: 'grid-wrap', style: height ? { height: typeof height === 'number' ? height + 'px' : height, flex: 'none' } : {} });
  const tbl = h('table', { class: 'grid' },
    h('colgroup', null, columns.map(c => h('col', { style: { width: (c.w || 120) + 'px' } }))),
    h('thead', null, h('tr', null, columns.map(c => h('th', { class: isNumCol(c) ? 'num' : '' }, c.l)))), tbody);
  if (footer) tbl.append(h('tfoot', null, h('tr', null, columns.map((c, i) => h('td', { class: isNumCol(c) ? 'num' : '' }, footer[c.f] != null ? cellText(c, footer[c.f]) : (i === 0 ? 'Summe' : ''))))));
  wrap.append(tbl);
  const api2 = { el: wrap, rows, current: () => rows[selIdx] || null, set(newRows) { rows = newRows; api2.rows = rows; selIdx = rows.length ? 0 : -1; draw(); } };
  function draw() {
    tbody.innerHTML = '';
    $$('.grid-empty', wrap).forEach(e => e.remove());
    rows.forEach((r, i) => {
      const tr = h('tr', { class: (i === selIdx ? 'sel ' : '') + (rowClass ? rowClass(r) || '' : '') }, columns.map(c => {
        if (c.render) { const x = c.render(r); return x instanceof Node && x.tagName === 'TD' ? x : h('td', { class: isNumCol(c) ? 'num' : '' }, x); }
        const td = h('td', { class: isNumCol(c) ? 'num' : '' }, raw(cellText(c, r[c.f]))); td.title = String(r[c.f] ?? '');
        return td;
      }));
      tr.addEventListener('mousedown', () => { selIdx = i; $$('tr', tbody).forEach((t, j) => t.classList.toggle('sel', j === i)); if (onSelect) onSelect(r); });
      tr.addEventListener('dblclick', () => onOpen && onOpen(r));
      tbody.append(tr);
    });
    if (!rows.length) wrap.append(h('div', { class: 'grid-empty' }, empty));
  }
  draw();
  return api2;
}
