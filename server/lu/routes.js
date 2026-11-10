'use strict';
// Routes of the Luxembourg tax system: VAT return (eCDF fields and XML); Peppol see ../nl/routes.js
module.exports = function register(route) {
  route('GET', '/api/lu/tva', (ctx) => { ctx.need('FIBU', 'anzeigen'); return require('./tva').berechnen(ctx.q); });
  route('GET', '/api/lu/tva/xml', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = require('./tva').xml(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'application/xml; charset=utf-8' }; });
};
