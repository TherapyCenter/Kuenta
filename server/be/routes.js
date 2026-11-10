'use strict';
// Routes of the Belgian tax system: periodic VAT return (grids, Intervat XML); Peppol see ../nl/routes.js
module.exports = function register(route) {
  route('GET', '/api/be/aangifte', (ctx) => { ctx.need('FIBU', 'anzeigen'); return require('./aangifte').berekenen(ctx.q); });
  route('GET', '/api/be/aangifte/xml', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = require('./aangifte').xml(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'application/xml; charset=utf-8' }; });
};
