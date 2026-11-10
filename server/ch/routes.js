'use strict';
// Routes of the Swiss tax system: MWST return, QR-bill data
const L = require('../lib');

module.exports = function register(route) {
  route('GET', '/api/ch/mwst', (ctx) => { ctx.need('FIBU', 'anzeigen'); return require('./mwst').calcular(ctx.q); });
  route('GET', '/api/ch/mwst/csv', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = require('./mwst').csv(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'text/csv; charset=utf-8' }; });
  route('GET', '/api/ch/qr/:id', (ctx) => {
    const VG = require('../api/vorgang');
    const d = VG.load('rechnung', Number(ctx.p.id));
    return require('./qrbill').daten(d.kopf, d.offen);
  });
  route('GET', '/api/ch/info', () => ({ uid: require('./index').uid(), land: L.land() }));
};
