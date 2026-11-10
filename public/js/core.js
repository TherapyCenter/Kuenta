'use strict';
/* global ENT, I18N */
// ---------- Language ----------
// Chosen per workstation (Kuenta menu or settings), German by default; ?lang=en in the address also sets it
I18N.lang = (() => {
  const q = new URLSearchParams(location.search).get('lang');
  try {
    if (q && I18N.LANGS[q]) localStorage.setItem('sw.lang', JSON.stringify(q));
    return JSON.parse(localStorage.getItem('sw.lang')) || 'de';
  } catch { return q || 'de'; }
})();
document.documentElement.lang = I18N.lang;
const T = s => I18N.tr(s);
const t = (key, vars) => I18N.t(key, vars);
const TR_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt']);

// ---------- DOM ----------
// h(tag, attrs, ...children); text children and title/placeholder are translated
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = T(v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : TR_ATTRS.has(k) ? T(v) : v);
  }
  const tr = tag !== 'textarea';   // the content of a text area is user data, never translate it
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(typeof c === 'string' && tr ? T(c) : String(c)));
  }
  return el;
}
// Text node that is never translated (user data that might look like a known word)
const raw = s => document.createTextNode(String(s ?? ''));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Formatting ----------
// Numbers follow the language (1.234,50 in German/Spanish, 1,234.50 in English); dates are always day first
const LOCALE = I18N.locale();
const DEC_POINT = LOCALE === 'en-GB';
const nfMoney = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfChf = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // Swiss francs: CHF 1'234.50
const DATE_SEP = I18N.lang === 'de' ? '.' : '/';
const fmt = {
  // currency of the tenant (lookups): euro after the number as before, pound sign in front
  money: v => { if (v == null || v === '') return ''; if (LK.data && LK.data.waehrung === 'CHF') return (Number(v) < 0 ? '-' : '') + 'CHF ' + nfChf.format(Math.abs(Number(v))).replace(/’/g, "'"); const sym = { GBP: '£', USD: '$' }[LK.data && LK.data.waehrung]; return sym ? (Number(v) < 0 ? '-' : '') + sym + nfMoney.format(Math.abs(Number(v))) : nfMoney.format(Number(v)) + ' €'; },
  money0: v => v == null || v === '' ? '' : nfMoney.format(Number(v)),
  num: (v, d = 2) => v == null || v === '' ? '' : new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: d }).format(Number(v)),
  num2: v => v == null || v === '' ? '' : nfMoney.format(Number(v)),
  int: v => v == null || v === '' ? '' : String(v),
  // day first; companies with the US tax system write the month first (MM/DD/YYYY)
  date: v => { if (!v) return ''; const s = String(v); if (s.length < 10) return s; return LK.data && LK.data.land === 'US' ? `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}` : `${s.slice(8, 10)}${DATE_SEP}${s.slice(5, 7)}${DATE_SEP}${s.slice(0, 4)}`; },
  month: v => { if (!v) return ''; const s = String(v); return s.length >= 7 ? `${s.slice(5, 7)}${LK.data && LK.data.land === 'US' ? '/' : DATE_SEP}${s.slice(0, 4)}` : s; },
  datetime: v => v ? fmt.date(v) + ' ' + String(v).slice(11, 16) : '',
  bool: v => Number(v) ? '✓' : '',
  pct: v => v == null || v === '' ? '' : fmt.num(v) + ' %',
};
function parseNum(s) {
  if (typeof s === 'number') return s;
  if (s == null) return 0;
  s = String(s).trim().replace(/\s|€|%/g, '');
  if (!s) return 0;
  if (DEC_POINT) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function parseDate(s) {
  s = String(s || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (!m) { const d = s.replace(/\D/g, ''); if (d.length === 6 || d.length === 8) m = [0, d.slice(0, 2), d.slice(2, 4), d.slice(4)]; }
  if (!m) { const t = s.match(/^(\d{1,2})[.](\d{1,2})[.]?$/); if (t) m = [0, t[1], t[2], String(new Date().getFullYear())]; }
  if (!m) return null;
  let y = Number(m[3]); if (y < 100) y += y < 70 ? 2000 : 1900;
  const mo = Number(m[2]), d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addMonths(iso, n) { const d = new Date((iso || today()) + 'T12:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date((iso || today()) + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
function kname(r, p = '') { return [r[p + 'NAME'], r[p + 'VORNAME']].filter(Boolean).join(', '); }

// ---------- API ----------
async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: { ...(opts.headers || {}) } };
  if (opts.body !== undefined) {
    if (opts.body instanceof Blob || opts.body instanceof ArrayBuffer || opts.body instanceof Uint8Array) { o.body = opts.body; }
    else { o.body = JSON.stringify(opts.body); o.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(path, o);
  if (res.status === 401 && !opts.noLogin) {
    const j = await res.json().catch(() => ({}));
    if (j.code === 'PASSWORD') { const e = new Error(j.error); e.code = 'PASSWORD'; throw e; }
    if (window.App) App.showLogin();
    throw new Error(j.error || 'Bitte anmelden');
  }
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const j = ct.includes('json') ? await res.json().catch(() => ({})) : {};
    const e = new Error(j.error || `Fehler ${res.status}`); e.status = res.status; e.code = j.code; throw e;
  }
  if (opts.raw) return res;
  return ct.includes('json') ? res.json() : res.text();
}
const qs = o => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`).join('&');
async function downloadUrl(url, fallbackName) {
  const res = await api(url, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="([^"]+)"/.exec(cd);
  saveBlob(blob, m ? decodeURIComponent(m[1]) : fallbackName);
}
function saveBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// ---------- Messages ----------
function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 7000 : 3500);
}
function showError(e) { if (e && e.code === 'PRO' && window.App) return App.proHinweis(null, e.message); console.error(e); toast(e && e.message ? e.message : String(e), 'err'); }

// ---------- Windows ----------
const Win = {
  stack: [],
  open({ title, width = 720, height, content, buttons, onClose, cls = '', modal = true, maximizable = true, flex = false, maximized = false }) {
    const host = $('#windows');
    const back = modal ? h('div', { class: 'win-backdrop' }) : null;
    const body = h('div', { class: 'win-body' + (flex ? ' flex' : '') });
    const foot = h('div', { class: 'win-foot' });
    const w = { el: null, body, foot, closed: false, dirty: false, onClose, beforeClose: null };
    const btnMax = maximizable ? h('button', { title: 'Maximieren', onclick: () => el.classList.toggle('max') }, '▢') : null;
    const el = h('div', { class: 'win ' + cls, style: { width: Math.min(width, window.innerWidth - 10) + 'px', ...(height ? { height: Math.min(height, window.innerHeight - 10) + 'px' } : {}) } },
      h('div', { class: 'win-title' }, h('span', { class: 't' }, title), btnMax, h('button', { class: 'close', title: 'Schließen (Esc)', onclick: () => w.close() }, '✕')),
      body, foot);
    w.el = el;
    if (content) body.append(content);
    if (buttons) w.setButtons(buttons);
    if (back) host.append(back);
    host.append(el);
    const rect = el.getBoundingClientRect();
    const off = Win.stack.length * 18;
    el.style.left = Math.max(5, (window.innerWidth - rect.width) / 2 + off) + 'px';
    el.style.top = Math.max(5, Math.min((window.innerHeight - rect.height) / 2.4 + off, window.innerHeight - rect.height - 5)) + 'px';
    if (maximized || window.innerWidth < 700) el.classList.add('max');
    // drag by the title bar
    const tb = $('.win-title', el);
    tb.addEventListener('mousedown', ev => {
      if (ev.target.closest('button') || el.classList.contains('max')) return;
      const sx = ev.clientX - el.offsetLeft, sy = ev.clientY - el.offsetTop;
      const mv = e => { el.style.left = Math.max(-el.offsetWidth + 80, Math.min(e.clientX - sx, window.innerWidth - 80)) + 'px'; el.style.top = Math.max(0, Math.min(e.clientY - sy, window.innerHeight - 30)) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    tb.addEventListener('dblclick', () => maximizable && el.classList.toggle('max'));
    w.close = async (result) => {
      if (w.closed) return;
      if (result === undefined && w.beforeClose && (await w.beforeClose()) === false) return;
      w.closed = true; el.remove(); if (back) back.remove();
      Win.stack = Win.stack.filter(x => x !== w);
      if (w.onClose) w.onClose(result);
    };
    w.setButtons = (btns) => {
      foot.innerHTML = '';
      for (const b of btns) {
        if (b === '|') { foot.append(h('span', { class: 'spacer' })); continue; }
        if (b instanceof Node) { foot.append(b); continue; }
        foot.append(h('button', { class: 'btn ' + (b.cls || ''), onclick: b.onClick, disabled: b.disabled, title: b.title }, b.icon ? h('span', { class: 'ico' }, b.icon) : null, b.label));
      }
    };
    Win.stack.push(w);
    setTimeout(() => { const f = $('input:not([readonly]):not([type=hidden]), select, textarea', body); if (f && !w.noAutofocus) f.focus(); }, 30);
    return w;
  },
  top() { return Win.stack[Win.stack.length - 1]; },
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const ctx = $('.ctx.float'); if (ctx) { ctx.remove(); return; }
    const w = Win.top(); if (w && !e.defaultPrevented) { e.preventDefault(); w.close(); }
  }
});

function dialog(title, content, buttons, opts = {}) {
  return new Promise(resolve => {
    const w = Win.open({ title, width: opts.width || 440, content, onClose: r => resolve(r ?? null), maximizable: false, ...opts });
    w.setButtons(['|', ...buttons.map(b => ({ ...b, onClick: async () => { const v = b.value instanceof Function ? await b.value(w) : b.value; if (v !== undefined) w.close(v); } }))]);
    if (!w.foot.parentNode) w.el.append(w.foot);
  });
}
function confirmDlg(msg, { title = 'Bitte bestätigen', ok = 'Ja', cancel = 'Nein', danger = false } = {}) {
  return dialog(title, h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.5 } }, msg), [
    { label: ok, cls: danger ? 'danger' : 'primary', value: true }, { label: cancel, value: false }]).then(r => r === true);
}
function alertDlg(msg, title = 'Hinweis') {
  return dialog(title, h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.5 } }, msg), [{ label: 'OK', cls: 'primary', value: true }]);
}
function promptDlg(label, value = '', { title = 'Eingabe', type = 'text' } = {}) {
  const inp = h('input', { type, value, style: { width: '100%' } });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.closest('.win').querySelector('.btn.primary').click(); } });
  return dialog(title, h('label', { class: 'fld' }, h('span', null, label), inp), [{ label: 'OK', cls: 'primary', value: () => inp.value }, { label: 'Abbrechen', value: null }]);
}

// ---------- Context menu ----------
function contextMenu(x, y, items) {
  $$('.ctx.float').forEach(e => e.remove());
  const build = list => h('div', { class: 'ctx popup' }, list.map(it => {
    if (it === '-') return h('hr');
    if (it.items) return h('div', { class: 'sub' }, h('button', {}, it.icon ? h('span', null, it.icon) : null, it.label, h('span', { style: { marginLeft: 'auto' } }, '▸')), build(it.items));
    return h('button', { disabled: it.disabled, onclick: () => { menu.remove(); it.onClick(); } }, h('span', { style: { width: '18px', display: 'inline-block' } }, it.icon || ''), it.label);
  }));
  const menu = build(items);
  menu.classList.add('float');
  Object.assign(menu.style, { position: 'fixed', left: x + 'px', top: y + 'px', zIndex: 2000, minWidth: '220px', padding: '4px 0' });
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - r.width - 4) + 'px';
  if (r.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - r.height - 4) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function f(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', f); } }), 0);
  return menu;
}

// ---------- File picker ----------
function pickFile(accept = '*/*', multiple = false) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(multiple ? [...inp.files] : inp.files[0] || null); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}

// ---------- Local settings (per browser) ----------
const Pref = {
  get(k, d) { try { const v = localStorage.getItem('sw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sw.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---------- Lookups (selection lists) ----------
const LK = {
  data: null,
  async load() { this.data = await api('/api/lookups'); return this.data; },
  async ensure() { return this.data || this.load(); },
  list(src) {
    const d = this.data || {};
    if (src === 'mwst') return (d.mwst || []).map(m => ({ id: m.id, name: m.name }));
    return d[src] || [];
  },
  name(src, id) { const r = this.list(src).find(x => String(x.id) === String(id)); return r ? r.name : ''; },
  rate(code) { const m = (this.data && this.data.mwst || []).find(x => x.id === Number(code)); return m ? m.rate : 0; },
  ind(n) { return this.data && this.data.ind && this.data.ind['IND' + n] ? this.data.ind['IND' + n].l : 'Feld ' + n; },
};
