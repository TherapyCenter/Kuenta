'use strict';
// Translations on the server: the same tables as in the browser (public/js/lang).
// Documents (PDF, email) use the document language from the settings (beleg.sprache).
const I18N = require('../public/js/i18n');
I18N.add('en', require('../public/js/lang/en'));
I18N.add('es', require('../public/js/lang/es'));

function docLang() {
  try { return require('./lib').sw('beleg.sprache', 'de') || 'de'; } catch { return 'de'; }
}
// Translate a finished text into the document language
const D = (s, lang = docLang()) => I18N.tr(s, lang);
// Template with named values in the document language: Dt('Zahlbar bis {datum}', { datum })
const Dt = (key, vars, lang = docLang()) => I18N.t(key, vars, lang);

module.exports = { I18N, docLang, D, Dt };
