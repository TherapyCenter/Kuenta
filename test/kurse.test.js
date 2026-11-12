'use strict';
// Tests of the display rates for the currency switch (without internet, with given rates)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-kurse-'));
process.env.KUENTAPOS_DATA = tmp;

const dbm = require('../server/db');
const L = require('../server/lib');
const K = require('../server/kurse');

test.after(() => { dbm.closeAll(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('Aktuelle Kurse aus dem Zwischenspeicher, kein Abruf nötig', async () => {
  dbm.get();
  // euros per unit
  K.speichern('BTC', [['2026-01-02', 20000], [L.today(), 40000]]);
  K.speichern('USD', [['2026-01-02', 0.9], [L.today(), 0.8]]);
  K.speichern('GBP', [[L.today(), 1.17]]);
  K.speichern('CHF', [[L.today(), 1.06]]);
  for (const w of ['BTC', 'USD', 'GBP', 'CHF']) { L.setSw('kurse.geladenab.' + w, '2017-01-01'); L.setSw('kurse.abruf.' + w, new Date().toISOString()); }
  const a = await K.aktuell();
  assert.strictEqual(a.BTC.eurPro, 40000);
  assert.strictEqual(a.BTC.quelle, 'Bitstamp');
  assert.strictEqual(a.USD.eurPro, 0.8);
  assert.strictEqual(a.USD.datum, L.today());
  assert.strictEqual(a.USD.quelle, 'Europäische Zentralbank');
  assert.strictEqual(a.GBP.eurPro, 1.17);
  assert.strictEqual(a.GBP.quelle, 'Europäische Zentralbank');
  assert.strictEqual(a.CHF.eurPro, 1.06);
});

test('Ungültige oder leere Kurse werden nicht gespeichert', () => {
  K.speichern('USD', [['2026-01-05', 0], ['2026-01-06', -1]]);
  assert.strictEqual(L.db().prepare("SELECT COUNT(*) n FROM SW_KURSE WHERE WAEHRUNG='USD' AND DATUM IN ('2026-01-05','2026-01-06')").get().n, 0);
});

test('Kurse bleiben Anzeige: keine Änderung an Rechnungen oder Zahlungen', async () => {
  const vorher = L.db().prepare('SELECT (SELECT COUNT(*) FROM RECHNUNGEN) r, (SELECT COUNT(*) FROM ZAHLUNGSEINGAENGE) z, (SELECT COUNT(*) FROM FIBU) f').get();
  await K.aktuell();
  assert.deepStrictEqual(L.db().prepare('SELECT (SELECT COUNT(*) FROM RECHNUNGEN) r, (SELECT COUNT(*) FROM ZAHLUNGSEINGAENGE) z, (SELECT COUNT(*) FROM FIBU) f').get(), vorher);
});
