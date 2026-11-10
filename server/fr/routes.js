'use strict';
// Routes of the French tax system: cash register journal (ISCA), FEC, Chorus Pro
const FRC = require('./caisse');
const CH = require('./chorus');

module.exports = function register(route, { json }) {
  route('GET', '/api/fr/caisse/journal', (ctx) => FRC.liste({ typ: ctx.q.typ, limit: ctx.q.limit }));
  route('GET', '/api/fr/caisse/verifier', () => FRC.verifier());
  route('POST', '/api/fr/caisse/cloture', async (ctx) => { const b = await json(ctx.req); const p = b.periode === 'A' ? 'A' : 'M'; return FRC.cloture(p, b.ref || (p === 'A' ? new Date().getFullYear() - 1 : '').toString() || new Date().toISOString().slice(0, 7)); });
  route('POST', '/api/fr/caisse/duplicata/:bonid', async (ctx) => { await json(ctx.req); return FRC.duplicata(Number(ctx.p.bonid)) || {}; });
  route('GET', '/api/fr/caisse/archive', (ctx) => { const r = FRC.archive(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'application/zip' }; });
  route('GET', '/api/fr/fec', (ctx) => { ctx.need('FIBU', 'anzeigen'); const r = require('./fec').fec(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'text/plain; charset=utf-8' }; });
  route('GET', '/api/fr/chorus/estado', () => CH.estado());
  route('POST', '/api/fr/chorus/acceso', async (ctx) => { ctx.need('Einstellungen', 'anzeigen'); return CH.guardarAcceso(await json(ctx.req)); });
  route('POST', '/api/fr/chorus/deposer/:id', async (ctx) => { await json(ctx.req); return CH.deposer(Number(ctx.p.id), ctx.user && ctx.user.name); });
  route('GET', '/api/fr/chorus/cr/:id', (ctx) => CH.compteRendu(Number(ctx.p.id)));
};
