'use strict';
// Routes of the Spanish tax system: VERI*FACTU, certificate, VAT books, Facturae
const L = require('../lib');
const VF = require('./verifactu');
const LIB = require('./libros');

module.exports = function register(route, { json, readBody }) {
  route('GET', '/api/es/estado', () => VF.resumen());
  route('POST', '/api/es/enviar', async (ctx) => { await json(ctx.req); return VF.enviar(); });
  route('POST', '/api/es/emitir', async (ctx) => {
    const b = await json(ctx.req);
    return [].concat(b.ids || []).map(id => { VF.emitir(Number(id)); return VF.info(L.db().prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(id)); });
  });
  route('POST', '/api/es/subsanar/:id', async (ctx) => { ctx.need('Rechnungen', 'anzeigen'); await json(ctx.req); return VF.emitir(Number(ctx.p.id), { subsanar: true }); });
  route('POST', '/api/es/anular/:id', async (ctx) => { ctx.need('Einstellungen', 'anzeigen'); await json(ctx.req); return VF.anular(Number(ctx.p.id)); });
  route('GET', '/api/es/registros', (ctx) => VF.registros({ estado: ctx.q.estado, limit: ctx.q.limit }));
  route('GET', '/api/es/registro/:id/xml', (ctx) => { const r = VF.xmlDe(ctx.p.id); return { _download: Buffer.from(r.XML, 'utf8'), filename: `VERIFACTU_${String(r.NUMSERIE).replace(/[^\w-]/g, '_')}_${ctx.p.id}.xml`, type: 'application/xml' }; });
  route('POST', '/api/es/certificado', async (ctx) => {
    ctx.need('Einstellungen', 'anzeigen');
    const buf = await readBody(ctx.req);
    const pw = ctx.req.headers['x-passwort'] ? decodeURIComponent(ctx.req.headers['x-passwort']) : '';
    return VF.guardarCertificado(buf, pw);
  });
  route('DELETE', '/api/es/certificado', (ctx) => { ctx.need('Einstellungen', 'anzeigen'); return VF.borrarCertificado(); });
  route('POST', '/api/es/probar', async (ctx) => { await json(ctx.req); return VF.probar(); });
  route('GET', '/api/es/libro/:art', (ctx) => {
    ctx.need('FIBU', 'anzeigen');
    const r = ctx.p.art === 'recibidas' ? LIB.libroRecibidas(ctx.q) : LIB.libroExpedidas(ctx.q);
    return { _download: r.buffer, filename: r.filename, type: 'text/csv; charset=utf-8' };
  });
  route('GET', '/api/es/modelo303', (ctx) => { ctx.need('FIBU', 'anzeigen'); return LIB.modelo303(ctx.q); });
  route('GET', '/api/es/facturae/:id', (ctx) => {
    const r = require('./facturae').create(Number(ctx.p.id));
    if (ctx.q.pruefen === '1') return { problems: r.problems, xml: r.xml };
    return { _download: Buffer.from(r.xml, 'utf8'), filename: `Facturae_${String(r.nr).replace(/[^\w-]/g, '_')}.xsig.xml`.replace('.xsig', ''), type: 'application/xml' };
  });
};
