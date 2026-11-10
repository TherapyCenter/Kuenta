'use strict';
// Routes of the Luxembourg tax system: VAT return (periodic and annual) and recapitulative statement for eCDF;
// Peppol see ../nl/routes.js
module.exports = function register(route) {
  const T = () => require('./tva');
  const jahrQ = q => (q.jahr ? { von: `${q.jahr}-01-01`, bis: `${q.jahr}-12-31`, jahr: true } : q);
  route('GET', '/api/lu/tva', (ctx) => { ctx.need('FIBU', 'anzeigen'); return T().berechnen(jahrQ(ctx.q)); });
  route('GET', '/api/lu/tva/xml', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = T().xml(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'application/xml; charset=utf-8' }; });
  route('GET', '/api/lu/zm', (ctx) => { ctx.need('FIBU', 'anzeigen'); return T().zusammenfassend(ctx.q); });
  route('GET', '/api/lu/zm/xml', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = T().xmlZm(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'application/xml; charset=utf-8' }; });
};
