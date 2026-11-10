#!/usr/bin/env node
'use strict';
// Lists texts in the code that have no English or Spanish translation yet.
//
//   node tools/i18n/missing.js            all source files of the user interface and the server
//   node tools/i18n/missing.js en         only check English (default: en and es)
//
// The German text is the key. Add missing entries to public/js/lang/en.js and es.js, e.g.
//   "Neuer Kunde": "New customer",
// Values in template strings become {0}, {1} …; the translation must contain the same placeholders.
// The list also contains technical strings (CSS classes, keys, file names); simply ignore those.
const fs = require('fs');
const path = require('path');
const I18N = require('../../public/js/i18n');

const ROOT = path.join(__dirname, '..', '..');
const langs = process.argv[2] ? [process.argv[2]] : ['en', 'es'];
for (const l of langs) I18N.add(l, require(`../../public/js/lang/${l}`));

// String literals of a JavaScript file; ${…} in template strings becomes {0}, {1} …
function strings(src) {
  const out = []; let i = 0; const n = src.length; let prev = '';
  const regexOk = () => !prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(prev);
  function quoted(j) {
    const q = src[j]; let s = ''; j++;
    while (j < n && src[j] !== q) {
      if (src[j] === '\\') { const e = src[j + 1]; s += e === 'n' ? '\n' : e === 'u' ? String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)) : e; j += e === 'u' ? 6 : 2; continue; }
      s += src[j++];
    }
    return [j + 1, s];
  }
  function tmpl(j) {
    let text = ''; let k = 0;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { text += src[j + 1] === 'n' ? '\n' : src[j + 1]; j += 2; continue; }
      if (c === '`') return [j + 1, text];
      if (c === '$' && src[j + 1] === '{') {
        let depth = 1; j += 2;
        while (j < n && depth) {
          const d = src[j];
          if (d === '{') depth++; else if (d === '}') depth--;
          else if (d === '`') { const [e, inner] = tmpl(j + 1); out.push(inner); j = e; continue; }
          else if (d === "'" || d === '"') { const [e, s] = quoted(j); out.push(s); j = e; continue; }
          j++;
        }
        text += `{${k++}}`; continue;
      }
      text += c; j++;
    }
    return [j, text];
  }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") { const [e, s] = quoted(i); out.push(s); i = e; prev = 'str'; continue; }
    if (c === '`') { const [e, s] = tmpl(i + 1); out.push(s); i = e; prev = 'str'; continue; }
    if (c === '/' && regexOk()) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      i = j + 1; while (/[a-z]/.test(src[i] || '')) i++; prev = 're'; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; prev = src.slice(i, j); i = j; continue; }
    prev = c; i++;
  }
  return out;
}

// Rough filter: German-looking text, no SQL, paths, CSS classes or markup
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|WHERE|COALESCE|JOIN|VALUES|PRAGMA|CAST|ROUND|GROUP BY|ORDER BY)\b/;
function looksLikeText(s) {
  const t = s.trim();
  if (t.length < 3 || !/\p{Ll}/u.test(t) || SQL.test(t) || /[<>]|^https?:|^\/|^[\w.-]+\/[\w./-]*$/.test(t)) return false;
  if (/^[a-z0-9_.:#\-[\]=*]+( [a-z0-9_.:#\-[\]=*]+)*$/.test(t)) return /[äöüß]/.test(t);   // keys, CSS classes
  return /[A-ZÄÖÜa-zäöüß]{3}/.test(t);
}

const dirs = ['public/js', 'server', 'server/api', 'server/pdf', 'server/kasse', 'server/import', 'server/pro'];
const files = dirs.flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.js') && f !== 'i18n.js').map(f => path.join(d, f)));
const missing = new Map();
for (const f of files) {
  for (const s of strings(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
    if (!looksLikeText(s)) continue;
    const sample = s.replace(/\{\d+\}/g, '7');
    const open = langs.filter(l => I18N.tr(sample, l) === sample && !Object.prototype.hasOwnProperty.call(I18N.DICT[l], s));
    if (open.length && !missing.has(s)) missing.set(s, `${f} (${open.join(', ')})`);
  }
}
for (const [s, where] of missing) console.log(`${JSON.stringify(s)}\t${where}`);
console.error(`${missing.size} texts without translation (many are technical and can be ignored).`);
