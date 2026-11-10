// Translation of the user interface (German, English, Spanish). Shared by server and browser.
//
// The German text is the key: the code keeps writing German, and lang/en.js and lang/es.js map
// German text to the translation. Missing entries simply stay German, so nothing breaks.
//
// tr() works on finished strings, so most call sites need no change at all:
//   - exact match:                 'Speichern'                  -> 'Save'
//   - leading icons, trailing ':'  '💾 Speichern'               -> '💾 Save'
//   - patterns with placeholders:  key '{0} Rechnungen' matches  '12 Rechnungen' -> '12 invoices'
//   - pieces glued together in the code: segments split at ' · ', 'Label: value',
//     known prefixes ('Offen: ') and suffixes (' – abgelaufen')
// h() in core.js runs every text child and the title/placeholder attributes through tr().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18N = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // doc: only for customer documents (no translation of the user interface)
  const LANGS = { de: { name: 'Deutsch', locale: 'de-DE' }, en: { name: 'English', locale: 'en-GB' }, es: { name: 'Español', locale: 'es-ES' }, it: { name: 'Italiano', locale: 'it-IT', doc: true }, nl: { name: 'Nederlands', locale: 'nl-NL', doc: true }, fr: { name: 'Français', locale: 'fr-FR', doc: true } };
  const UI_LANGS = Object.fromEntries(Object.entries(LANGS).filter(([, l]) => !l.doc));
  const DICT = { en: {}, es: {}, it: {}, nl: {}, fr: {} };
  const compiled = {};   // per language: { patterns, prefixes, suffixes, cache }
  let current = 'de';

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PH = /\{(\w*)\}/g;
  const MAX_DEPTH = 4;

  // Register translations: add('en', { 'Speichern': 'Save', ... })
  function add(code, table) {
    if (!DICT[code]) DICT[code] = {};
    Object.assign(DICT[code], table);
    compiled[code] = null;
  }

  // Keys with placeholders become anchored regular expressions; keys that start or end with
  // a separator are remembered as prefixes/suffixes for strings concatenated in the code
  function compile(code) {
    if (compiled[code]) return compiled[code];
    const patterns = []; const prefixes = []; const suffixes = [];
    for (const [key, val] of Object.entries(DICT[code] || {})) {
      if (!key.includes('{')) {
        if (key.length > 2 && /^[ ,·–(]/.test(key)) suffixes.push(key);
        if (key.length > 3 && /\S(: | )$/.test(key)) prefixes.push(key);
        continue;
      }
      const names = []; const lits = [];
      let last = 0; let src = '^';
      key.replace(PH, (m, name, pos) => { const lit = key.slice(last, pos); lits.push(lit); src += reEsc(lit) + '([\\s\\S]+?)'; names.push(name || String(names.length)); last = pos + m.length; return m; });
      if (!names.length) continue;
      const tail = key.slice(last); lits.push(tail); src += reEsc(tail) + '$';
      const anchor = lits.reduce((a, b) => (b.trim().length > a.trim().length ? b : a), '');
      if (anchor.trim().length < 2) continue;   // "{0} {1}" would match everything
      // placeholders directly next to each other ("{0}{1}") are ambiguous: split them later
      const adj = []; for (let i = 1; i < lits.length - 1; i++) if (lits[i] === '') adj.push(i - 1);
      patterns.push({ re: new RegExp(src), names, anchor, val, adj, lit: lits.join('').length });
    }
    // the more fixed text a pattern has, the more specific it is
    patterns.sort((a, b) => b.lit - a.lit);
    prefixes.sort((a, b) => b.length - a.length);
    suffixes.sort((a, b) => b.length - a.length);
    return (compiled[code] = { patterns, prefixes, suffixes, cache: new Map() });
  }

  function fill(text, vars) {
    return vars == null ? text : text.replace(PH, (m, name) => (own(vars, name) ? String(vars[name]) : m));
  }

  const exact = (d, s) => (own(d, s) ? d[s] : null);

  function byPattern(d, c, s, depth) {
    for (const p of c.patterns) {
      if (!s.includes(p.anchor)) continue;
      const m = p.re.exec(s);
      if (!m) continue;
      const caps = m.slice(1);
      // "{0}{1}": the second part is usually an optional piece of text, find where it starts
      for (const i of p.adj) {
        const all = caps[i] + caps[i + 1];
        let k = 1;
        for (; k < all.length; k++) {
          if (!/[\s,;(·–]/.test(all[k]) && all[k - 1] !== ' ') continue;   // the optional piece starts at a separator
          const b = all.slice(k); if (find(d, c, b, depth + 1) !== b) break;
        }
        caps[i] = all.slice(0, k); caps[i + 1] = all.slice(k);
      }
      const vars = {};
      p.names.forEach((n, i) => { vars[n] = caps[i] ? find(d, c, caps[i], depth + 1) : caps[i]; });
      return fill(p.val, vars);
    }
    return null;
  }

  function core(d, c, s, depth) {
    const hit = exact(d, s);
    if (hit != null) return hit;
    if (depth > MAX_DEPTH) return null;
    const pat = byPattern(d, c, s, depth);
    if (pat != null) return pat;
    // "A · B · C": translate each segment on its own
    if (s.includes(' · ')) {
      const parts = s.split(' · ');
      const out = parts.map(x => find(d, c, x, depth + 1));
      if (out.some((x, i) => x !== parts[i])) return out.join(' · ');
    }
    // known endings and beginnings of texts that the code glues together
    for (const suf of c.suffixes) if (s.length > suf.length && s.endsWith(suf)) return find(d, c, s.slice(0, -suf.length), depth + 1) + d[suf];
    for (const pre of c.prefixes) if (s.length > pre.length && s.startsWith(pre)) return d[pre] + find(d, c, s.slice(pre.length), depth + 1);
    // "Label: value" with a known label
    const lv = /^([^:\n]{2,60}):(\s+)([\s\S]*)$/.exec(s);
    if (lv) {
      const label = exact(d, lv[1]);
      if (label != null) return label + ':' + lv[2] + find(d, c, lv[3], depth + 1);
    }
    return null;
  }

  // Translate s; leading icons/punctuation and trailing ':' or '…' are kept
  function find(d, c, s, depth) {
    if (!s || !/\p{L}/u.test(s)) return s;
    const whole = core(d, c, s, depth);
    if (whole != null) return whole;
    const m = /^([^\p{L}\p{N}„"'({[]*)([\s\S]*?)([\s:…*]*)$/u.exec(s);
    const mid = m[2];
    if (!mid || mid === s || !/\p{L}/u.test(mid)) return s;
    const r = core(d, c, mid, depth);
    return r == null ? s : m[1] + r + m[3];
  }

  // Translate a finished string into the given (or current) language
  function tr(s, code = current) {
    if (code === 'de' || typeof s !== 'string' || !s || !DICT[code]) return s;
    const d = DICT[code];
    const hit = exact(d, s);
    if (hit != null) return hit;
    const c = compile(code);
    let r = c.cache.get(s);
    if (r !== undefined) return r;
    r = find(d, c, s, 0);
    if (c.cache.size > 20000) c.cache.clear();
    c.cache.set(s, r);
    return r;
  }

  // Exact match only (for values from the database such as status texts)
  function word(s, code = current) {
    if (code === 'de' || typeof s !== 'string' || !DICT[code]) return s;
    const hit = exact(DICT[code], s);
    return hit == null ? s : hit;
  }

  // Explicit translation with named values: t('{n} Einträge', { n: 5 })
  function t(key, vars, code = current) {
    const d = DICT[code];
    const text = code !== 'de' && d && own(d, key) ? d[key] : key;
    return fill(text, vars);
  }

  return {
    LANGS, UI_LANGS, DICT, add, tr, t, word,
    get lang() { return current; },
    set lang(code) { current = UI_LANGS[code] ? code : 'de'; },
    locale(code = current) { return (LANGS[code] || LANGS.de).locale; },
  };
});
