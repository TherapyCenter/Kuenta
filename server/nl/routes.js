'use strict';
// Routes of the Dutch tax system: VAT return, Peppol BIS 3.0
module.exports = function register(route) {
  route('GET', '/api/nl/aangifte', (ctx) => { ctx.need('FIBU', 'anzeigen'); return require('./aangifte').berekenen(ctx.q); });
  route('GET', '/api/nl/aangifte/csv', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = require('./aangifte').csv(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'text/csv; charset=utf-8' }; });
  route('GET', '/api/nl/peppol/:id', (ctx) => {
    const r = require('./peppol').create(Number(ctx.p.id));
    if (ctx.q.pruefen) return { problems: r.problems, xml: r.xml };
    return { _download: Buffer.from(r.xml, 'utf8'), filename: r.filename, type: 'application/xml; charset=utf-8' };
  });
};
