'use strict';
// Routes of the Italian tax system: FatturaPA, IVA settlement, sales VAT register
module.exports = function register(route) {
  route('GET', '/api/it/fattura/:id', (ctx) => {
    const r = require('./fatturapa').create(Number(ctx.p.id), { probe: !!ctx.q.pruefen });
    if (ctx.q.pruefen) return { problems: r.problems, formato: r.formato, codiceDestinatario: r.codiceDestinatario, xml: r.xml };
    return { _download: Buffer.from(r.xml, 'utf8'), filename: r.filename, type: 'application/xml; charset=utf-8' };
  });
  route('GET', '/api/it/liquidazione', (ctx) => { ctx.need('FIBU', 'anzeigen'); return require('./iva').liquidazione(ctx.q); });
  route('GET', '/api/it/registro', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = require('./iva').registro(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'text/csv; charset=utf-8' }; });
};
