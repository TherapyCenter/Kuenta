'use strict';
// Routes of the UK tax system: Making Tax Digital (HMRC), VAT return, accounting exports
const L = require('../lib');
const HM = require('./hmrc');
const VAT = require('./vat');
const EX = require('./export');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

module.exports = function register(route, { json }) {
  // browser data for the fraud prevention headers (screens, window size) and the signed-in user
  const ctxHm = ctx => {
    let client = {};
    try { client = JSON.parse(decodeURIComponent((ctx.req.headers['x-kuentapos-client'] || ctx.req.headers['x-kuenta-client']) || '')) || {}; } catch { /* none */ }
    return { client, usuario: ctx.user && ctx.user.name };
  };
  route('GET', '/api/gb/estado', () => HM.estado());
  route('POST', '/api/gb/app', async (ctx) => { ctx.need('Einstellungen', 'anzeigen'); return HM.guardarApp(await json(ctx.req)); });
  route('POST', '/api/gb/conectar', async (ctx) => { ctx.need('Einstellungen', 'anzeigen'); await json(ctx.req); return HM.autorizar(ctx.req); });
  route('POST', '/api/gb/desconectar', async (ctx) => { ctx.need('Einstellungen', 'anzeigen'); await json(ctx.req); return HM.desconectar(); });
  // HMRC sends the browser back here after signing in (the state identifies tenant and request)
  route('GET', '/api/gb/oauth/callback', async (ctx) => {
    let msg, ok = true;
    try { await HM.callback(ctx.q); msg = 'KuentaPOS is now connected to HMRC. You can close this window.'; } catch (e) { ok = false; msg = e.message; }
    return { _html: `<!doctype html><html><head><meta charset="utf-8"><title>KuentaPOS – HMRC</title></head><body style="font-family:sans-serif;padding:40px;max-width:640px">
      <h2>${ok ? '✅' : '❌'} HMRC</h2><p>${esc(msg)}</p><script>try { window.opener && window.opener.postMessage({ hmrc: ${ok} }, '*'); } catch (e) {} ${ok ? 'setTimeout(function(){ window.close(); }, 2500);' : ''}</script></body></html>` };
  }, { public: true });
  route('GET', '/api/gb/obligaciones', async (ctx) => { ctx.need('FIBU', 'anzeigen'); return HM.obligaciones(ctx.q, ctxHm(ctx)); });
  route('GET', '/api/gb/calcular', (ctx) => { ctx.need('FIBU', 'anzeigen'); return VAT.calcular(ctx.q); });
  route('POST', '/api/gb/enviar', async (ctx) => { ctx.need('FIBU', 'anzeigen'); return HM.enviar(await json(ctx.req), ctxHm(ctx)); });
  route('GET', '/api/gb/return/:periodKey', async (ctx) => { ctx.need('FIBU', 'anzeigen'); return HM.verReturn(ctx.p.periodKey, ctxHm(ctx)); });
  route('POST', '/api/gb/probar-cabeceras', async (ctx) => { await json(ctx.req); return HM.probarCabeceras(ctxHm(ctx)); });
  route('GET', '/api/gb/export/:art', (ctx) => {
    ctx.need('FIBU', 'anzeigen');
    const f = { 'xero-sales': EX.xeroVentas, 'xero-bills': EX.xeroCompras, quickbooks: EX.quickbooks, sage: EX.sage, journal: EX.diario }[ctx.p.art];
    if (!f) throw new L.HttpError(404, 'Unbekannter Export');
    const r = f(ctx.q);
    return { _download: r.buffer, filename: r.filename, type: 'text/csv; charset=utf-8' };
  });
};
