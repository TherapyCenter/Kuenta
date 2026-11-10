'use strict';
// Translations on the server: the same tables as in the browser (public/js/lang).
// Documents (PDF, email) use the document language from the settings (beleg.sprache).
const I18N = require('../public/js/i18n');
I18N.add('en', require('../public/js/lang/en'));
I18N.add('es', require('../public/js/lang/es'));
I18N.add('it', require('../public/js/lang/it')); // documents only

function docLang() {
  try { return require('./lib').sw('beleg.sprache', 'de') || 'de'; } catch { return 'de'; }
}
// Language of the console and of new installations: KUENTA_LANG, otherwise the operating system
// (German or Spanish system → German or Spanish, anything else → English)
function systemLang() {
  const set = String(process.env.KUENTA_LANG || '').toLowerCase().slice(0, 2);
  if (I18N.UI_LANGS[set]) return set;
  let loc = '';
  try { loc = Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch { /* ignore */ }
  loc = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || loc).toLowerCase();
  return loc.startsWith('de') ? 'de' : loc.startsWith('es') ? 'es' : 'en';
}
// Console output in the system language
const C = s => I18N.tr(s, systemLang());

// Translate a finished text into the document language
const D = (s, lang = docLang()) => I18N.tr(s, lang);
// Template with named values in the document language: Dt('Zahlbar bis {datum}', { datum })
const Dt = (key, vars, lang = docLang()) => I18N.t(key, vars, lang);

module.exports = { I18N, docLang, D, Dt, systemLang, C };
