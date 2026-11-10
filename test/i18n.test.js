'use strict';
// Tests of the translation (German key → English/Spanish) and of the language files
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-i18n-'));
const { I18N } = require('../server/i18n');

const en = s => I18N.tr(s, 'en');
const es = s => I18N.tr(s, 'es');

test('exact texts, icons and trailing colon', () => {
  assert.strictEqual(en('Speichern'), 'Save');
  assert.strictEqual(es('Speichern'), 'Guardar');
  assert.strictEqual(en('💾 Einstellungen speichern'), '💾 Save settings');
  assert.strictEqual(en('Datum:'), 'Date:');
  assert.strictEqual(I18N.tr('Speichern', 'de'), 'Speichern');
});

test('patterns with values, segments and glued pieces', () => {
  assert.strictEqual(en('12 Einträge · 3 markiert'), '12 entries · 3 selected');
  assert.strictEqual(en('Rechnung Nr. 1234'), 'Invoice no. 1234');
  assert.strictEqual(es('Sehr geehrter Herr Müller,'), 'Estimado Sr. Müller:');
  assert.strictEqual(en('Zahlbar bis 12.12.2026, bei Zahlung bis 01.12.2026 abzüglich 2 % Skonto.'), 'Payable by 12.12.2026, if paid by 01.12.2026 less 2 % cash discount.');
  assert.strictEqual(en('Zahlbar bis 12.12.2026.'), 'Payable by 12.12.2026.');
  assert.strictEqual(en('Kassenbestand: 120,00 € · ohne TSE'), 'Cash balance: 120,00 € · without TSE');
  assert.strictEqual(es('Rechnungsbetrag: 100,00 €'), 'Importe de la factura: 100,00 €');
});

test('unknown texts and user data stay as they are', () => {
  assert.strictEqual(en('Müller'), 'Müller');
  assert.strictEqual(en('Ölwechsel inkl. Filter'), 'Ölwechsel inkl. Filter');
  assert.strictEqual(en('12,50'), '12,50');
  assert.strictEqual(I18N.word('bezahlt', 'en'), 'paid');
  assert.strictEqual(I18N.word('Kunde: Müller', 'en'), 'Kunde: Müller', 'word() never uses patterns');
});

test('explicit templates keep named placeholders for later', () => {
  assert.strictEqual(I18N.t('{Vorgang} Nr. {Nummer} – {Firma}', null, 'en'), '{Vorgang} no. {Nummer} – {Firma}');
  assert.strictEqual(I18N.t('Sie können auch mit {arten} bezahlen:', { arten: 'Lightning' }, 'es'), 'También puede pagar con Lightning:');
});

test('language files: same keys, same placeholders, valid syntax', () => {
  const E = require('../public/js/lang/en');
  const S = require('../public/js/lang/es');
  assert.deepStrictEqual(Object.keys(E).sort(), Object.keys(S).sort());
  const ph = s => (s.match(/\{\w*\}/g) || []).sort().join(',');
  for (const k of Object.keys(E)) {
    assert.strictEqual(ph(E[k]), ph(k), 'en: ' + k);
    assert.strictEqual(ph(S[k]), ph(k), 'es: ' + k);
  }
  assert.ok(Object.keys(E).length > 2000);
});

test('document language: PDF and mail defaults follow the setting', () => {
  const L = require('../server/lib');
  const dbm = require('../server/db');
  dbm.runAs(1, () => {
    const { D, Dt, docLang } = require('../server/i18n');
    assert.strictEqual(docLang(), 'de');
    L.setSw('beleg.sprache', 'es');
    assert.strictEqual(D('Rechnung'), 'Factura');
    assert.match(Dt('{Briefanrede}\n\nanbei erhalten Sie unsere(n) {Vorgang} Nr. {Nummer}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{Firma}'), /^\{Briefanrede\}\n\nadjuntamos/);
    L.setSw('beleg.sprache', 'de');
  });
});

test('PDF invoice in English and Spanish', () => {
  const zlib = require('zlib');
  const dbm = require('../server/db');
  const L = require('../server/lib');
  const VG = require('../server/api/vorgang');
  const PDF = require('../server/pdf/belege');
  const text = buf => {
    const s = buf.toString('latin1'); let out = '';
    const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g; let m;
    while ((m = re.exec(s))) { let d = Buffer.from(m[1], 'latin1'); try { d = zlib.inflateSync(d); } catch { /* uncompressed */ } out += d.toString('latin1'); }
    return out.replace(/<([0-9a-f]+)> Tj/g, (x, hex) => Buffer.from(hex, 'hex').toString('latin1') + '\n');
  };
  dbm.runAs(1, () => {
    const t = VG.template('rechnung');
    const r = VG.save('rechnung', { kopf: { ...t.kopf, KUNNAME: 'Muster', KUNVORNAME: 'Max', DATUM: '2026-03-05' }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Ölwechsel', MENGE: 1, VKBRUTTO: 119, MWST: 61 }] }).kopf;
    const pdf = () => text(PDF.vorgangPdf('rechnung', VG.load('rechnung', r.RECHNUNGID)));
    assert.match(pdf(), /Rechnung/);
    L.setSw('beleg.sprache', 'en');
    const e = pdf();
    assert.match(e, /Invoice no\./); assert.match(e, /05\/03\/2026/); assert.match(e, /Ölwechsel/, 'item text stays as entered');
    L.setSw('beleg.sprache', 'es');
    assert.match(pdf(), /Factura n\.º/);
    L.setSw('beleg.sprache', 'de');
  });
});

test('system language for console and new installations', () => {
  const { systemLang, C } = require('../server/i18n');
  const alt = process.env.KUENTA_LANG;
  try {
    process.env.KUENTA_LANG = 'es';
    assert.strictEqual(systemLang(), 'es');
    assert.strictEqual(C('Kuenta läuft bereits auf Port 3700.'), 'Kuenta ya se está ejecutando en el puerto 3700.');
    process.env.KUENTA_LANG = 'en';
    assert.strictEqual(C('Datenverzeichnis:'), 'Data folder:');
  } finally { if (alt === undefined) delete process.env.KUENTA_LANG; else process.env.KUENTA_LANG = alt; }
});

test('license email in the language of shop.json or of the order', () => {
  const SHOP = require('../tools/lizenz/shop');
  assert.strictEqual(SHOP.mailSprache({ sprache: 'en' }, {}), 'en');
  assert.strictEqual(SHOP.mailSprache({ sprache: 'en' }, { language: 'es' }), 'es');
  assert.strictEqual(SHOP.mailSprache({}, {}), 'de');
  const text = SHOP.mailText({ funktionen: ['pro'], kunde: 'Garage Smith', id: 'x1' }, 'KUENTA1.k', 'INV1', 'en');
  assert.match(text, /^Hello,/);
  assert.match(text, /Kuenta \(Kuenta Pro \(all add-ons, including future ones\)\), licensed to "Garage Smith"/);
  assert.match(text, /License no\. x1 · payment INV1/);
});
