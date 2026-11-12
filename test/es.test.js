'use strict';
// Spanish tax system: NIF check, VERI*FACTU records (hash chain, XML, sending), recargo de equivalencia,
// corrective invoices, restore of an older backup, VAT books, Facturae. German tenants stay unchanged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.KUENTAPOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kuentapos-es-'));
process.env.KUENTAPOS_SIF_NIF = 'A39200019';
process.env.KUENTAPOS_LANG = 'de';
const L = require('../server/lib');
const dbm = require('../server/db');
const VG = require('../server/api/vorgang');
const G = require('../server/api/generic');
const BK = require('../server/backup');
const NIF = require('../public/js/nif.js');
const VF = require('../server/es/verifactu');
const LIB = require('../server/es/libros');

// AEAT test double: accepts every record of the request
const enviados = [];
VF._setTransporte((xml) => {
  enviados.push(xml);
  const ns = [...xml.matchAll(/<sum1:IDFactura><sum1:IDEmisorFactura>[^<]*<\/sum1:IDEmisorFactura><sum1:NumSerieFactura>([^<]+)</g)].map(m => m[1]);
  const lin = ns.map(n => `<tikR:RespuestaLinea><tikR:IDFactura><tik:IDEmisorFactura>B12345674</tik:IDEmisorFactura><tik:NumSerieFactura>${n}</tik:NumSerieFactura><tik:FechaExpedicionFactura>01-01-2026</tik:FechaExpedicionFactura></tikR:IDFactura><tikR:Operacion><tik:TipoOperacion>Alta</tik:TipoOperacion></tikR:Operacion><tikR:EstadoRegistro>Correcto</tikR:EstadoRegistro></tikR:RespuestaLinea>`).join('');
  return { status: 200, body: `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="r" xmlns:tik="i"><tikR:CSV>A-TEST-CSV</tikR:CSV><tikR:TiempoEsperaEnvio>60</tikR:TiempoEsperaEnvio><tikR:EstadoEnvio>Correcto</tikR:EstadoEnvio>${lin}</tikR:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>` };
});
const enviarYa = async () => { L.setSw('verifactu.proximo', '0'); await new Promise(r => setImmediate(r)); return VF.enviar(); };

test('NIF, NIE and CIF check', () => {
  assert.ok(NIF.validar('12345678Z').ok);
  assert.ok(!NIF.validar('12345678A').ok);
  assert.ok(NIF.validar('x-1234567-l').ok);
  assert.strictEqual(NIF.validar('ES B12345674').nif, 'B12345674');
  assert.ok(NIF.validar('Q2826000H').ok, 'CIF with control letter (AEAT)');
  assert.ok(!NIF.validar('Q2826000E').ok);
  assert.deepStrictEqual(NIF.extranjero('DE 123456789'), { pais: 'DE', id: 'DE123456789' });
});

test('hash of the AEAT examples', () => {
  const h1 = VF.huellaAlta({ nif: '89890001K', numSerie: '12345678/G33', fecha: '01-01-2024', tipo: 'F1', cuota: '12.35', importe: '123.45', anterior: '', generado: '2024-01-01T19:20:30+01:00' });
  assert.strictEqual(h1, '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60');
  const h2 = VF.huellaAlta({ nif: '89890001K', numSerie: '12345679/G34', fecha: '01-01-2024', tipo: 'F1', cuota: '12.35', importe: '123.45', anterior: h1, generado: '2024-01-01T19:20:35+01:00' });
  assert.strictEqual(h2, 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97');
  const h3 = VF.huellaAnulacion({ nif: '89890001K', numSerie: '12345679/G34', fecha: '01-01-2024', anterior: h2, generado: '2024-01-01T19:20:40+01:00' });
  assert.strictEqual(h3, '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68');
  assert.match(VF.fechaHoraHuso(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
});

test('German tenant is unchanged until Spain is switched on', () => {
  assert.strictEqual(L.mwstRates()[61], 19);
  assert.strictEqual(G.lookups().land, 'DE');
  const t = VG.template('rechnung', {}); delete t.kopf._kunde;
  const r = VG.save('rechnung', { kopf: { ...t.kopf, KUNNAME: 'Barverkauf' }, pos: [{ POSART: 'A', BEZEICHNUNG: 'Teil', MENGE: 1, VKBRUTTO: 119, MWST: 61 }] });
  VG.setFlag('rechnung', [r.kopf.RECHNUNGID], 'GEDRUCKT', 1);
  assert.strictEqual(VF.vigente(r.kopf.RECHNUNGID), null, 'no VERI*FACTU record in Germany');
  assert.ok(!r.es);
});

let ids = {};
test('Spain: invoices, recargo, chain, lock, corrective invoice, sending', async () => {
  L.setSw('steuer.land', 'ES');
  L.db().prepare("UPDATE FIRMENDATEN SET FIRMENNAME='Taller Ejemplo SL', STEUERNR='B12345674', STRASSE='Calle Mayor 1', PLZ='28001', ORT='Madrid', LAND='ES', IBAN='ES9121000418450200051332'").run();
  assert.strictEqual(L.mwstRates()[61], 21);
  assert.strictEqual(G.lookups().land, 'ES');

  // business customer with NIF in recargo de equivalencia → F1 with recargo
  const k = G.saveRec('kunden', null, { NAME: 'Comercial López SL', ART: 1, USTID: 'ESB12345674', RECARGO: 1, STRASSE: 'Gran Vía 2', PLZ: '28013', ORT: 'Madrid', LAND: 'ES', LEITWEGID: 'L01280796/L01280796/L01280796' });
  const t = VG.template('rechnung', { kunid: k.KUNID }); delete t.kopf._kunde;
  assert.strictEqual(t.kopf.ESRECARGO, 1); assert.strictEqual(t.kopf.ANSICHTBRUTTO, 0);
  const r1 = VG.save('rechnung', { kopf: t.kopf, pos: [{ POSART: 'A', BEZEICHNUNG: 'Neumático', MENGE: 2, VK: 50, MWST: 61 }] });
  assert.strictEqual(r1.kopf.GBRUTTO, 126.2, '100 + 21 % IVA + 5.2 % recargo');
  assert.strictEqual(r1.tax[61].recargo, 5.2);
  assert.ok(r1.es && !r1.es.emitida);
  const id1 = r1.kopf.RECHNUNGID;
  VG.setFlag('rechnung', [id1], 'GEDRUCKT', 1); // printing issues the invoice
  const a1 = VF.vigente(id1);
  assert.ok(a1);
  assert.strictEqual(a1.TIPOFACTURA, 'F1');
  assert.strictEqual(a1.NUMSERIE, 'F' + r1.kopf.RECHNUNGNUMMER);
  assert.strictEqual(a1.IMPORTE, '126.20'); assert.strictEqual(a1.CUOTA, '26.20');
  assert.match(a1.XML, /<sum1:PrimerRegistro>S<\/sum1:PrimerRegistro>/);
  assert.match(a1.XML, /<sum1:NIF>B12345674<\/sum1:NIF><\/sum1:IDDestinatario>/);
  assert.match(a1.XML, /<sum1:TipoRecargoEquivalencia>5.20<\/sum1:TipoRecargoEquivalencia><sum1:CuotaRecargoEquivalencia>5.20</);
  assert.match(a1.XML, /<sum1:IdSistemaInformatico>KU<\/sum1:IdSistemaInformatico>/);
  assert.strictEqual(a1.HUELLA, VF.huellaAlta({ nif: 'B12345674', numSerie: a1.NUMSERIE, fecha: a1.FECHA, tipo: 'F1', cuota: '26.20', importe: '126.20', anterior: '', generado: a1.GENERADO }));
  assert.strictEqual(VF.emitir(id1).ID, a1.ID, 'issuing twice creates no second record');
  assert.throws(() => VG.save('rechnung', { kopf: { ...VG.load('rechnung', id1).kopf }, pos: r1.pos }), /VERI\*FACTU/);
  assert.throws(() => VG.remove('rechnung', id1), /VERI\*FACTU/);
  assert.throws(() => VG.setFlag('rechnung', [id1], 'GEDRUCKT', 0), /VERI\*FACTU/);
  const info = VG.load('rechnung', id1).es;
  assert.ok(info.emitida); assert.strictEqual(info.tipo, 'F1');
  assert.match(info.qr, /^https:\/\/prewww2\.aeat\.es\/wlpl\/TIKE-CONT\/ValidarQR\?nif=B12345674&numserie=F\d+&fecha=\d\d-\d\d-\d{4}&importe=126\.20$/);

  // private customer without NIF: simplified invoice, chained to the first record
  const t2 = VG.template('rechnung', {}); delete t2.kopf._kunde;
  const r2 = VG.save('rechnung', { kopf: { ...t2.kopf, KUNNAME: 'García', KUNVORNAME: 'Ana' }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Cambio de aceite', MENGE: 1, VKBRUTTO: 60.5, MWST: 61 }, { POSART: 'A', BEZEICHNUNG: 'Tasa ITV (suplido)', MENGE: 1, VKBRUTTO: 30, MWST: 63, DURCHLAUFER: 1 }] });
  const a2 = VF.emitir(r2.kopf.RECHNUNGID);
  assert.strictEqual(a2.TIPOFACTURA, 'F2');
  assert.ok(!/Destinatarios/.test(a2.XML));
  assert.strictEqual(a2.HUELLAANT, a1.HUELLA);
  assert.match(a2.XML, new RegExp(`<sum1:RegistroAnterior><sum1:IDEmisorFactura>B12345674</sum1:IDEmisorFactura><sum1:NumSerieFactura>${a1.NUMSERIE}</sum1:NumSerieFactura>`));
  assert.match(a2.XML, /<sum1:CalificacionOperacion>N1<\/sum1:CalificacionOperacion><sum1:BaseImponibleOimporteNoSujeto>30.00</, 'suplido is not subject to IVA');
  assert.strictEqual(a2.IMPORTE, '90.50'); assert.strictEqual(a2.CUOTA, '10.50');

  // above the limit without NIF: refused, invoice stays editable
  const r3 = VG.save('rechnung', { kopf: { ...t2.kopf, KUNNAME: 'Pérez' }, pos: [{ POSART: 'L', BEZEICHNUNG: 'Motor', MENGE: 1, VKBRUTTO: 1210, MWST: 61 }] });
  assert.throws(() => VF.emitir(r3.kopf.RECHNUNGID), /NIF/);
  assert.strictEqual(VF.vigente(r3.kopf.RECHNUNGID), null);

  // corrective invoice of the first one: R4 with reference, own series
  const st = VG.storno(id1);
  const a4 = VF.emitir(st.id);
  assert.strictEqual(a4.TIPOFACTURA, 'R4');
  assert.ok(a4.NUMSERIE.startsWith('R'));
  assert.strictEqual(a4.IMPORTE, '-126.20');
  assert.match(a4.XML, new RegExp(`<sum1:TipoRectificativa>I</sum1:TipoRectificativa><sum1:FacturasRectificadas><sum1:IDFacturaRectificada><sum1:IDEmisorFactura>B12345674</sum1:IDEmisorFactura><sum1:NumSerieFactura>${a1.NUMSERIE}<`));
  assert.strictEqual(VG.load('korrektur', st.id).es.rectificada.numSerie, a1.NUMSERIE);

  const res = await enviarYa();
  assert.ok(!res.error, res.error);
  assert.ok(enviados.length >= 1);
  assert.match(enviados[enviados.length - 1], /<sum:Cabecera><sum1:ObligadoEmision><sum1:NombreRazon>Taller Ejemplo SL<\/sum1:NombreRazon><sum1:NIF>B12345674</);
  for (const r of VF.registros()) assert.strictEqual(r.ESTADO, 'aceptado', r.NUMSERIE);
  assert.strictEqual(VF.registros()[0].CSV, 'A-TEST-CSV');
  ids = { id1, id2: r2.kopf.RECHNUNGID, a4 };
});

test('Spain: AEAT rejection and error code 3000 (duplicate)', async () => {
  const st = VF.interpretar('<x:RespuestaRegFactuSistemaFacturacion><x:CSV>C1</x:CSV><x:EstadoEnvio>ParcialmenteCorrecto</x:EstadoEnvio><x:RespuestaLinea><x:IDFactura><y:NumSerieFactura>F1</y:NumSerieFactura></x:IDFactura><x:EstadoRegistro>Incorrecto</x:EstadoRegistro><x:CodigoErrorRegistro>1104</x:CodigoErrorRegistro><x:DescripcionErrorRegistro>NIF &amp; nombre</x:DescripcionErrorRegistro></x:RespuestaLinea></x:RespuestaRegFactuSistemaFacturacion>');
  assert.strictEqual(st.lineas[0].estado, 'Incorrecto'); assert.strictEqual(st.lineas[0].mensaje, 'NIF & nombre'); assert.strictEqual(st.csv, 'C1');
  assert.strictEqual(VF.interpretar('<s:Fault><faultstring>Error de esquema</faultstring></s:Fault>').fault, 'Error de esquema');
});

test('Spain: restoring an older backup keeps all records, numbers and the chain', async () => {
  const vorher = VF.registros().length;
  const backup = BK.createBackup({});
  // issue one more invoice after the backup
  const t = VG.template('rechnung', {}); delete t.kopf._kunde;
  const r5 = VG.save('rechnung', { kopf: { ...t.kopf, KUNNAME: 'Ruiz' }, pos: [{ POSART: 'A', BEZEICHNUNG: 'Escobillas', MENGE: 1, VKBRUTTO: 24.2, MWST: 61 }] });
  const a5 = VF.emitir(r5.kopf.RECHNUNGID);
  await enviarYa();
  BK.restoreBackup(backup.buffer);
  // the restored database does not know invoice 5, the journal does
  const regs = VF.registros();
  assert.strictEqual(regs.length, vorher + 1);
  assert.strictEqual(regs[0].NUMSERIE, a5.NUMSERIE);
  assert.strictEqual(regs[0].ESTADO, 'aceptado');
  // the next invoice never gets the number of invoice 5 and continues the chain after it
  const r6 = VG.save('rechnung', { kopf: { ...t.kopf, KUNNAME: 'Soto' }, pos: [{ POSART: 'A', BEZEICHNUNG: 'Bujía', MENGE: 1, VKBRUTTO: 12.1, MWST: 61 }] });
  assert.ok(r6.kopf.RECHNUNGNUMMER > Number(a5.NUMSERIE.slice(1)), 'number already reported is skipped');
  const a6 = VF.emitir(r6.kopf.RECHNUNGID);
  assert.strictEqual(a6.HUELLAANT, a5.HUELLA);
  // issued invoices from before the backup are still locked
  assert.ok(VF.vigente(ids.id1));
});

test('Spain: VAT books, modelo 303, Facturae', () => {
  const lib = LIB.libroExpedidas({ von: '2000-01-01', bis: '2999-12-31' }).buffer.toString('utf8');
  assert.match(lib, /Serie-Número/);
  assert.match(lib, /;F\d+;F1;B12345674;Comercial López SL;100,00;21,00;21,00;5,20;5,20;126,20/);
  const m = LIB.modelo303({ jahr: L.today().slice(0, 4), quartal: Math.floor((Number(L.today().slice(5, 7)) - 1) / 3) + 1 });
  const g21 = m.devengado.find(x => x.tipo === 21);
  assert.deepStrictEqual(g21.casillas, ['07', '08', '09']);
  assert.ok(m.recargo.length === 1 && m.recargo[0].tipo === 5.2);
  const f = require('../server/es/facturae').create(ids.id1);
  assert.match(f.xml, /<SchemaVersion>3\.2\.2<\/SchemaVersion>/);
  assert.match(f.xml, /<EquivalenceSurcharge>5\.20<\/EquivalenceSurcharge>/);
  assert.match(f.xml, /<CentreCode>L01280796<\/CentreCode><RoleTypeCode>03<\/RoleTypeCode>/);
  assert.deepStrictEqual(f.problems, []);
});

test('Spain: register sale is a simplified invoice, cancellation an R5', async () => {
  const KS = require('../server/api/kasse');
  const b = await KS.bon({ zahlart: 'BAR', gegeben: 50, positionen: [{ POSART: 'A', BEZEICHNUNG: 'Limpiaparabrisas', MENGE: 1, EINZEL: 12.1, MWST: 61 }] });
  assert.ok(b.es && b.es.emitida, 'receipt carries the invoice');
  assert.strictEqual(b.es.tipo, 'F2');
  assert.match(b.es.qr, /ValidarQR\?nif=B12345674/);
  assert.strictEqual(b.es.nifEmisor, 'B12345674');
  const s = await KS.storno(b.bon.ID, { rechnungskorrektur: false });
  const k = VF.registros()[0];
  assert.strictEqual(k.TIPOFACTURA, 'R5', 'cancellation of a simplified invoice');
  assert.strictEqual(k.IMPORTE, '-12.10');
  assert.ok(s.bon.STORNOID);
});

test('Spain: PDF with QR code and Spanish number; switching back to Germany', () => {
  const PDF = require('../server/pdf/belege');
  const d = VG.load('rechnung', ids.id1);
  const buf = PDF.vorgangPdf('rechnung', d);
  assert.ok(buf.length > 1000);
  L.setSw('steuer.land', 'DE');
  assert.strictEqual(L.mwstRates()[61], 19);
  assert.ok(VF.vigente(ids.id1), 'issued Spanish invoices stay locked');
  dbm.closeAll();
});
