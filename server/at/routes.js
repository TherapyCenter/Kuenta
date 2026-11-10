'use strict';
// Routes of the Austrian tax system: cash register (RKSV), VAT return (UVA), ebInterface
const L = require('../lib');
const RK = require('./rksv');

module.exports = function register(route, { json }) {
  route('GET', '/api/at/rksv/status', () => RK.status());
  route('POST', '/api/at/rksv/aktivieren', async (ctx) => { ctx.need('Einstellungen', 'anzeigen'); return RK.aktivieren(await json(ctx.req)); });
  route('POST', '/api/at/rksv/nullbeleg', async (ctx) => { const b = await json(ctx.req); const e = await RK.nullbeleg(b.art || 'NULL'); return { nr: e.NR, art: e.ART, qr: e.QR, ausfall: !!e.AUSFALL, zeit: e.ZEIT }; });
  route('GET', '/api/at/rksv/journal', (ctx) => RK.liste({ limit: ctx.q.limit }));
  route('GET', '/api/at/rksv/pruefen', () => RK.pruefen());
  route('GET', '/api/at/rksv/dep', (ctx) => { const r = RK.dep(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'application/json; charset=utf-8' }; });
  route('GET', '/api/at/uva', (ctx) => { ctx.need('FIBU', 'anzeigen'); return require('./uva').calcular(ctx.q); });
  route('GET', '/api/at/uva/xml', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = require('./uva').xml(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'application/xml; charset=utf-8' }; });
  route('GET', '/api/at/ebinterface/:id', (ctx) => {
    const r = require('./ebinterface').create(Number(ctx.p.id));
    if (ctx.q.pruefen) return { problems: r.problems };
    return { _download: Buffer.from(r.xml, 'utf8'), filename: r.filename, type: 'application/xml; charset=utf-8' };
  });
  route('GET', '/api/at/info', () => ({ uid: require('./index').uid(), rksv: RK.status(), land: L.land() }));
};
