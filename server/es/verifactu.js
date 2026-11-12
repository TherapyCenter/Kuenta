'use strict';
require('../env'); // accept old KUENTA_* variables
// VERI*FACTU (RD 1007/2023, Orden HAC/1177/2024): every issued invoice gets a billing record ("registro de
// facturación de alta") with a SHA-256 hash chain and a QR code. The records are sent to the AEAT with the
// company's electronic certificate (mode "VERI*FACTU", art. 16 of the regulation).
//
// Besides the database, every record is appended to verifactu/registros.jsonl in the data folder. That folder
// is not part of backups, so restoring an older backup or importing KFZ-Faktura data never loses a record or
// breaks the chain: missing records are copied back into the database from that file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const tls = require('tls');
const L = require('../lib');
const dbm = require('../db');
const ES = require('./index');
const { productor } = require('./sistema');
const { NIF } = ES;

const NS = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  sum: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd',
  sum1: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd',
};
const URLS = {
  produccion: {
    personal: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    sello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    qr: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
  },
  pruebas: {
    personal: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    sello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    qr: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
  },
};
const entorno = () => (L.sw('verifactu.entorno', 'pruebas') === 'produccion' ? 'produccion' : 'pruebas');

// ---------- formats ----------
const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const imp = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const fecha = iso => { const s = String(iso || L.today()).slice(0, 10); return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`; };
function fechaHoraHuso(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(); const s = off >= 0 ? '+' : '-'; const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${s}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}
const t = (n, v) => `<sum1:${n}>${v}</sum1:${n}>`;

// ---------- hash (specification "Detalle de las especificaciones técnicas para generación de la huella") ----------
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex').toUpperCase();
const v = s => String(s ?? '').trim();
function huellaAlta(r) {
  return sha(`IDEmisorFactura=${v(r.nif)}&NumSerieFactura=${v(r.numSerie)}&FechaExpedicionFactura=${v(r.fecha)}&TipoFactura=${v(r.tipo)}` +
    `&CuotaTotal=${v(r.cuota)}&ImporteTotal=${v(r.importe)}&Huella=${v(r.anterior)}&FechaHoraHusoGenRegistro=${v(r.generado)}`);
}
function huellaAnulacion(r) {
  return sha(`IDEmisorFacturaAnulada=${v(r.nif)}&NumSerieFacturaAnulada=${v(r.numSerie)}&FechaExpedicionFacturaAnulada=${v(r.fecha)}` +
    `&Huella=${v(r.anterior)}&FechaHoraHusoGenRegistro=${v(r.generado)}`);
}

// ---------- journal file and database ----------
const dir = () => path.join(dbm.DATA_DIR, 'verifactu');
const diario = () => path.join(dir(), 'registros.jsonl');
function anotar(obj) {
  fs.mkdirSync(dir(), { recursive: true });
  const fd = fs.openSync(diario(), 'a');
  try { fs.writeSync(fd, JSON.stringify(obj) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
const COLS = ['ID', 'TIPO', 'RECHNUNGID', 'NIF', 'NUMSERIE', 'FECHA', 'TIPOFACTURA', 'CUOTA', 'IMPORTE', 'HUELLA', 'HUELLAANT', 'GENERADO', 'XML', 'ENTORNO', 'ESTADO', 'CSV', 'CODIGO', 'MENSAJE', 'ENVIADO', 'INTENTOS', 'SUBSANA'];
const ESTADO_COLS = ['ESTADO', 'CSV', 'CODIGO', 'MENSAJE', 'ENVIADO', 'INTENTOS'];

// Compare database and journal once per database connection (a restore or import opens a new one)
const sincronizados = new WeakSet();
function asegurar() {
  const d = L.db();
  if (sincronizados.has(d)) return d;
  sincronizados.add(d);
  const regs = new Map();
  let txt = '';
  try { txt = fs.readFileSync(diario(), 'utf8'); } catch { /* no journal yet */ }
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; } // torn last line after a power failure
    if (o.t === 'reg' && o.r) regs.set(o.r.ID, { ...o.r });
    else if (o.t === 'estado' && regs.has(o.id)) Object.assign(regs.get(o.id), o.v);
  }
  const enDb = new Map(d.prepare('SELECT * FROM SW_VERIFACTU').all().map(r => [r.ID, r]));
  // records only in the database (journal deleted or copied from elsewhere): write them to the journal
  for (const r of enDb.values()) if (!regs.has(r.ID)) { anotar({ t: 'reg', r }); regs.set(r.ID, r); }
  d.exec('BEGIN');
  try {
    const ins = d.prepare(`INSERT INTO SW_VERIFACTU (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
    const upd = d.prepare(`UPDATE SW_VERIFACTU SET ${ESTADO_COLS.map(c => c + '=?').join(',')} WHERE ID=?`);
    for (const r of regs.values()) {
      const h = enDb.get(r.ID);
      if (!h) ins.run(...COLS.map(c => r[c] ?? null));
      else if (ESTADO_COLS.some(c => (h[c] ?? null) !== (r[c] ?? null))) upd.run(...ESTADO_COLS.map(c => r[c] ?? null), r.ID);
    }
    // issued invoices keep their number and lock even if the restored database is older
    const mark = d.prepare("UPDATE RECHNUNGEN SET ESNUMSERIE=?, ESTIPO=?, GEDRUCKT=1 WHERE RECHNUNGID=? AND COALESCE(ESNUMSERIE,'')=''");
    for (const r of regs.values()) if (r.TIPO === 'alta' && r.ESTADO !== 'rechazado') {
      const k = d.prepare('SELECT RECHNUNGID, TYP, RECHNUNGNUMMER, ESNUMSERIE FROM RECHNUNGEN WHERE RECHNUNGID=?').get(r.RECHNUNGID);
      if (k && ES.numSerie(k) === r.NUMSERIE) mark.run(r.NUMSERIE, r.TIPOFACTURA, r.RECHNUNGID);
    }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return d;
}
function estado(id, val) {
  const d = asegurar();
  const keys = Object.keys(val).filter(k => ESTADO_COLS.includes(k));
  d.prepare(`UPDATE SW_VERIFACTU SET ${keys.map(k => k + '=?').join(',')} WHERE ID=?`).run(...keys.map(k => val[k] ?? null), id);
  anotar({ t: 'estado', id, v: Object.fromEntries(keys.map(k => [k, val[k] ?? null])) });
}

function registroDe(rid, numSerie) {
  return asegurar().prepare('SELECT * FROM SW_VERIFACTU WHERE RECHNUNGID=? AND NUMSERIE=? ORDER BY ID DESC LIMIT 1').get(rid, numSerie) || null;
}
function cabecera(rid) { return L.db().prepare('SELECT RECHNUNGID, TYP, RECHNUNGNUMMER, ESNUMSERIE, DATUM, GBRUTTO FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid); }
// latest valid record of an invoice: the invoice is issued and may no longer be changed or deleted
function vigente(rid) {
  const k = cabecera(rid); if (!k) return null;
  const r = registroDe(rid, ES.numSerie(k));
  return r && r.ESTADO !== 'rechazado' ? r : null;
}
// next free number of a series, also counting invoices that are only in the journal (after a restore)
function siguienteNumero(serie) {
  const re = new RegExp('^' + String(serie).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
  let max = 0;
  for (const r of asegurar().prepare("SELECT NUMSERIE FROM SW_VERIFACTU WHERE TIPO='alta'").all()) { const m = re.exec(r.NUMSERIE); if (m) max = Math.max(max, Number(m[1])); }
  return max + 1;
}

function instalacion() {
  const f = path.join(dir(), 'instalacion.txt');
  try { const s = fs.readFileSync(f, 'utf8').trim(); if (s) return s; } catch { /* new */ }
  const id = crypto.randomUUID();
  fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(f, id);
  return id;
}

// ---------- content of the record ----------
function nombreCliente(k) {
  return Number(k.KUNART) === 1 || /^firma$/i.test(k.KUNANREDE || '') || !k.KUNVORNAME ? (k.KUNNAME || '') : [k.KUNVORNAME, k.KUNNAME].filter(Boolean).join(' ');
}
// recipient from the tax ID of the customer (field USTID): Spanish NIF or EU VAT ID of another country
function destinatario(k, kunde) {
  const nombre = nombreCliente(k).slice(0, 120);
  const id = kunde && kunde.USTID;
  const n = NIF.validar(id);
  if (n.ok) return { nombre, nif: n.nif };
  const ext = NIF.extranjero(id);
  if (ext) return { nombre, idOtro: { pais: ext.pais, tipo: '02', id: ext.id } };
  return null;
}

function datos(rid, { subsanacion = false, rechazoPrevio = false } = {}) {
  const d = L.db();
  const k = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  if (!k) throw new L.HttpError(404, 'Rechnung nicht gefunden');
  const f = L.firma(); const nif = ES.nifEmisor();
  if (!nif) throw new L.HttpError(400, 'Für VERI*FACTU fehlt die NIF Ihrer Firma (Einstellungen → Firmendaten → Steuernummer).');
  if (!f.FIRMENNAME) throw new L.HttpError(400, 'Bitte tragen Sie den Firmennamen ein (Einstellungen → Firmendaten).');
  const pos = d.prepare("SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? AND POSART NOT IN ('T','Z') ORDER BY PRTSORT").all(rid);
  if (!pos.length) throw new L.HttpError(400, 'Die Rechnung hat keine Positionen.');
  const kunde = k.KUNID ? d.prepare('SELECT * FROM KUNDEN WHERE KUNID=?').get(k.KUNID) : null;
  const rates = ES.mwstRates(); const brutto = Number(k.ANSICHTBRUTTO) === 1; const conRecargo = Number(k.ESRECARGO) === 1;
  // tax breakdown: S1 taxed, N1 not subject (suplidos), N2 not subject by place of supply, E1/E2/E5 exempt
  const exterior = { REVERSE_CHARGE: 'N2', IG_LIEFERUNG: 'E5', AUSFUHR: 'E2' }[k.STEUERART];
  const grupos = {};
  for (const p of pos) {
    if (Number(p.DIFFSTEUER) === 1) throw new L.HttpError(400, 'Positionen mit Differenzbesteuerung (REBU) können noch nicht an VERI*FACTU gemeldet werden.');
    const rate = rates[Number(p.MWST) || 61] ?? 0;
    const cal = k.STEUERART ? (exterior || 'N2') : Number(p.DURCHLAUFER) === 1 ? 'N1' : rate ? 'S1' : 'E1';
    const r = cal === 'S1' ? rate : 0;
    const g = grupos[cal + '|' + r] || (grupos[cal + '|' + r] = { cal, rate: r, netto: 0, brutto: 0 });
    g.netto += Number(p.SUMME) || 0; g.brutto += Number(p.SUMMEBRUTTO) || 0;
  }
  const desglose = Object.values(grupos).map(g => {
    let base, cuota = 0;
    if (g.cal === 'S1' && brutto) { const b = L.r2(g.brutto); base = L.r2(b / (1 + g.rate / 100)); cuota = L.r2(b - base); }
    else if (g.cal === 'S1') { base = L.r2(g.netto); cuota = L.r2(base * g.rate / 100); }
    else base = L.r2(g.netto);
    const reRate = conRecargo && g.cal === 'S1' ? ES.recargo(g.rate) : 0;
    return { ...g, base, cuota, reRate, re: reRate ? L.r2(base * reRate / 100) : 0 };
  });
  if (desglose.length > 12) throw new L.HttpError(400, 'Zu viele verschiedene Steuersätze in einer Rechnung (höchstens 12).');
  const cuota = desglose.reduce((s, g) => s + g.cuota + g.re, 0);
  const total = Number(k.GBRUTTO) || 0;

  let dest = destinatario(k, kunde);
  let tipo, rect = null;
  if (Number(k.TYP) === 2) {
    const orig = k.REIDGUTSCHRIFT > 0 ? d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(k.REIDGUTSCHRIFT) : null;
    const oreg = orig ? registroDe(orig.RECHNUNGID, ES.numSerie(orig)) : null;
    if (orig) rect = { nif: oreg ? oreg.NIF : nif, numSerie: oreg ? oreg.NUMSERIE : ES.numSerie(orig), fecha: oreg ? oreg.FECHA : fecha(orig.DATUM) };
    const simple = oreg ? ['F2', 'R5'].includes(oreg.TIPOFACTURA) : !dest;
    if (simple) tipo = 'R5';
    else {
      tipo = /^R[1-4]$/.test(k.ESRECT || '') ? k.ESRECT : 'R4';
      if (!dest) throw new L.HttpError(400, 'Für eine Rechnungskorrektur zu einer vollständigen Rechnung braucht der Kunde eine NIF (Kunde → USt-IdNr. / NIF).');
    }
  } else if (dest) tipo = 'F1';
  else if (Math.abs(total) <= ES.limite() + 0.001) tipo = 'F2';
  else throw new L.HttpError(400, `Rechnungen über ${ES.limite()} € sind vollständige Rechnungen und brauchen die NIF des Kunden. Bitte beim Kunden die NIF eintragen (Kunde → USt-IdNr. / NIF).`);
  if (tipo === 'F2' || tipo === 'R5') dest = null; // simplified invoices name no recipient

  const fz = k.FAHRKENNZEICHEN ? `${k.FAHRKENNZEICHEN} ${[k.FAHRMARKE, k.FAHRMODELL].filter(Boolean).join(' ')}`.trim() : null;
  const desc = [fz, ...pos.slice(0, 3).map(p => p.BEZEICHNUNG || p.BESCHREIBUNG)].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 500) || 'Venta';
  const liefer = String(k.LIEFDATUM || '').slice(0, 10); const datum = String(k.DATUM || L.today()).slice(0, 10);
  return {
    k, nif, nombreEmisor: String(f.FIRMENNAME).slice(0, 120), numSerie: ES.numSerie(k), fecha: fecha(datum), tipo, rect, dest, desglose,
    cuota: imp(cuota), importe: imp(total), desc, fechaOp: liefer && liefer < datum ? fecha(liefer) : null, subsanacion, rechazoPrevio,
  };
}

function idXml(p) { return p.nif ? t('NIF', x(p.nif)) : t('IDOtro', t('CodigoPais', x(p.idOtro.pais)) + t('IDType', x(p.idOtro.tipo)) + t('ID', x(p.idOtro.id))); }
function sistemaXml(p) {
  return t('SistemaInformatico', t('NombreRazon', x(p.nombreRazon)) + idXml(p) + t('NombreSistemaInformatico', x(p.nombreSistema)) +
    t('IdSistemaInformatico', x(p.id)) + t('Version', x(p.version)) + t('NumeroInstalacion', x(instalacion())) +
    t('TipoUsoPosibleSoloVerifactu', 'S') + t('TipoUsoPosibleMultiOT', 'S') + t('IndicadorMultiplesOT', dbm.listMandanten().length > 1 ? 'S' : 'N'));
}
function encadenamiento(prev) {
  return t('Encadenamiento', prev
    ? t('RegistroAnterior', t('IDEmisorFactura', x(prev.NIF)) + t('NumSerieFactura', x(prev.NUMSERIE)) + t('FechaExpedicionFactura', x(prev.FECHA)) + t('Huella', prev.HUELLA))
    : t('PrimerRegistro', 'S'));
}
function detalle(g) {
  let s = t('Impuesto', '01') + t('ClaveRegimen', g.cal === 'E2' ? '02' : '01');
  s += g.cal[0] === 'E' ? t('OperacionExenta', g.cal) : t('CalificacionOperacion', g.cal);
  if (g.cal === 'S1') s += t('TipoImpositivo', imp(g.rate));
  s += t('BaseImponibleOimporteNoSujeto', imp(g.base));
  if (g.cal === 'S1') s += t('CuotaRepercutida', imp(g.cuota));
  if (g.reRate) s += t('TipoRecargoEquivalencia', imp(g.reRate)) + t('CuotaRecargoEquivalencia', imp(g.re));
  return s;
}
function xmlAlta(r, prev, sif, generado, huella) {
  let s = t('IDVersion', '1.0') + t('IDFactura', t('IDEmisorFactura', x(r.nif)) + t('NumSerieFactura', x(r.numSerie)) + t('FechaExpedicionFactura', r.fecha));
  s += t('NombreRazonEmisor', x(r.nombreEmisor));
  if (r.subsanacion) s += t('Subsanacion', 'S');
  if (r.rechazoPrevio) s += t('RechazoPrevio', 'X');
  s += t('TipoFactura', r.tipo);
  if (r.tipo[0] === 'R') {
    s += t('TipoRectificativa', 'I');
    if (r.rect) s += t('FacturasRectificadas', t('IDFacturaRectificada', t('IDEmisorFactura', x(r.rect.nif)) + t('NumSerieFactura', x(r.rect.numSerie)) + t('FechaExpedicionFactura', r.rect.fecha)));
  }
  if (r.fechaOp) s += t('FechaOperacion', r.fechaOp);
  s += t('DescripcionOperacion', x(r.desc));
  if (r.dest) s += t('Destinatarios', t('IDDestinatario', t('NombreRazon', x(r.dest.nombre)) + idXml(r.dest)));
  s += t('Desglose', r.desglose.map(g => t('DetalleDesglose', detalle(g))).join(''));
  s += t('CuotaTotal', r.cuota) + t('ImporteTotal', r.importe);
  s += encadenamiento(prev) + sistemaXml(sif);
  s += t('FechaHoraHusoGenRegistro', generado) + t('TipoHuella', '01') + t('Huella', huella);
  return t('RegistroAlta', s);
}
function xmlAnulacion(a, prev, sif, generado, huella) {
  const s = t('IDVersion', '1.0') + t('IDFactura', t('IDEmisorFacturaAnulada', x(a.NIF)) + t('NumSerieFacturaAnulada', x(a.NUMSERIE)) + t('FechaExpedicionFacturaAnulada', a.FECHA)) +
    encadenamiento(prev) + sistemaXml(sif) + t('FechaHoraHusoGenRegistro', generado) + t('TipoHuella', '01') + t('Huella', huella);
  return t('RegistroAnulacion', s);
}

function sifPruefen() {
  const sif = productor();
  if (!sif.nif && !(sif.idOtro && sif.idOtro.id)) throw new L.HttpError(500, 'Die Steuerkennung des Softwareherstellers fehlt (server/es/sistema.js oder KUENTAPOS_SIF_NIF / KUENTAPOS_SIF_IDOTRO). Ohne sie nimmt die AEAT keine Datensätze an.');
  return sif;
}
function guardar(rec) {
  const d = asegurar();
  anotar({ t: 'reg', r: rec }); // the journal first: it survives restores
  d.prepare(`INSERT INTO SW_VERIFACTU (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`).run(...COLS.map(c => rec[c] ?? null));
  setImmediate(() => enviar().catch(() => { /* retried by the timer */ }));
  return rec;
}
const nuevoId = d => d.prepare('SELECT COALESCE(MAX(ID),0) m FROM SW_VERIFACTU').get().m + 1;
const anterior = (d, ent) => d.prepare('SELECT * FROM SW_VERIFACTU WHERE ENTORNO=? ORDER BY ID DESC LIMIT 1').get(ent) || null;

// Issue an invoice: create the record (only once). Afterwards the invoice is locked.
function emitir(rid, { subsanar = false } = {}) {
  const d = asegurar();
  const k0 = cabecera(rid);
  if (!k0) throw new L.HttpError(404, 'Rechnung nicht gefunden');
  const vorh = registroDe(rid, ES.numSerie(k0));
  if (vorh && vorh.TIPO === 'anulacion') throw new L.HttpError(409, 'Der Datensatz dieser Rechnung wurde storniert (anulación).');
  if (vorh && vorh.ESTADO !== 'rechazado' && !subsanar) return vorh;
  const sif = sifPruefen();
  const r = datos(rid, { subsanacion: !!vorh, rechazoPrevio: !!vorh && vorh.ESTADO === 'rechazado' });
  const ent = entorno(); const prev = anterior(d, ent); const generado = fechaHoraHuso();
  const huella = huellaAlta({ nif: r.nif, numSerie: r.numSerie, fecha: r.fecha, tipo: r.tipo, cuota: r.cuota, importe: r.importe, anterior: prev ? prev.HUELLA : '', generado });
  const rec = guardar({
    ID: nuevoId(d), TIPO: 'alta', RECHNUNGID: Number(rid), NIF: r.nif, NUMSERIE: r.numSerie, FECHA: r.fecha, TIPOFACTURA: r.tipo, CUOTA: r.cuota, IMPORTE: r.importe,
    HUELLA: huella, HUELLAANT: prev ? prev.HUELLA : '', GENERADO: generado, XML: xmlAlta(r, prev, sif, generado, huella), ENTORNO: ent,
    ESTADO: 'pendiente', INTENTOS: 0, SUBSANA: vorh ? 1 : 0,
  });
  d.prepare('UPDATE RECHNUNGEN SET GEDRUCKT=1, ESNUMSERIE=?, ESTIPO=? WHERE RECHNUNGID=?').run(r.numSerie, r.tipo, rid);
  L.protocol(null, 'SW_VERIFACTU', rec.ID, 'alta', { factura: r.numSerie, tipo: r.tipo, importe: r.importe });
  return rec;
}

// Cancel the record of an invoice issued by mistake (registro de anulación). Invoices that were really
// issued are corrected with a corrective invoice instead.
function anular(rid) {
  const d = asegurar();
  const a = vigente(rid);
  if (!a || a.TIPO !== 'alta') throw new L.HttpError(409, 'Zu dieser Rechnung gibt es keinen gültigen VERI*FACTU-Datensatz.');
  const sif = sifPruefen(); const ent = a.ENTORNO; const prev = anterior(d, ent); const generado = fechaHoraHuso();
  const huella = huellaAnulacion({ nif: a.NIF, numSerie: a.NUMSERIE, fecha: a.FECHA, anterior: prev ? prev.HUELLA : '', generado });
  const rec = guardar({
    ID: nuevoId(d), TIPO: 'anulacion', RECHNUNGID: a.RECHNUNGID, NIF: a.NIF, NUMSERIE: a.NUMSERIE, FECHA: a.FECHA, TIPOFACTURA: a.TIPOFACTURA, CUOTA: a.CUOTA, IMPORTE: a.IMPORTE,
    HUELLA: huella, HUELLAANT: prev ? prev.HUELLA : '', GENERADO: generado, XML: xmlAnulacion(a, prev, sif, generado, huella), ENTORNO: ent, ESTADO: 'pendiente', INTENTOS: 0, SUBSANA: 0,
  });
  L.protocol(null, 'SW_VERIFACTU', rec.ID, 'anulación', { factura: a.NUMSERIE });
  return rec;
}

// ---------- QR code (art. 21 Orden HAC/1177/2024) ----------
function qr(rec) {
  const base = URLS[rec.ENTORNO === 'produccion' ? 'produccion' : 'pruebas'].qr;
  return `${base}?nif=${encodeURIComponent(rec.NIF)}&numserie=${encodeURIComponent(rec.NUMSERIE)}&fecha=${encodeURIComponent(rec.FECHA)}&importe=${encodeURIComponent(rec.IMPORTE)}`;
}

// ---------- certificate ----------
const certFile = () => path.join(dir(), 'certificado.p12');
const accesoFile = () => path.join(dir(), 'acceso.json');
function tlsFehler(e) {
  const m = String(e && e.message || e);
  if (/mac verify|bad decrypt|wrong password|PKCS12/i.test(m) && !/unsupported/i.test(m)) return new L.HttpError(400, 'Das Passwort des Zertifikats ist falsch.');
  if (/unsupported/i.test(m)) return new L.HttpError(400, 'Das Zertifikat ist mit einem veralteten Verfahren verschlüsselt. Bitte neu exportieren (Windows: „AES256-SHA256“) oder umwandeln: openssl pkcs12 -legacy -in alt.p12 -out neu.pem und openssl pkcs12 -export -in neu.pem -out neu.p12');
  return e instanceof Error ? e : new Error(m);
}
function guardarCertificado(buf, passphrase) {
  if (!buf || !buf.length) throw new L.HttpError(400, 'Bitte eine Zertifikatsdatei (.p12 / .pfx) wählen.');
  try { tls.createSecureContext({ pfx: buf, passphrase }); } catch (e) { throw tlsFehler(e); }
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(certFile(), buf, { mode: 0o600 });
  fs.writeFileSync(accesoFile(), JSON.stringify({ passphrase, guardado: L.now() }), { mode: 0o600 });
  return { ok: true };
}
function certificado() {
  let pfx, acc;
  try { pfx = fs.readFileSync(certFile()); acc = JSON.parse(fs.readFileSync(accesoFile(), 'utf8')); } catch { throw new L.HttpError(400, 'Es ist noch kein elektronisches Zertifikat hinterlegt (Einstellungen → España / VERI*FACTU).'); }
  return { pfx, passphrase: acc.passphrase, guardado: acc.guardado };
}
function borrarCertificado() { for (const f of [certFile(), accesoFile()]) { try { fs.unlinkSync(f); } catch { /* gone */ } } return { ok: true }; }

// ---------- sending ----------
function sobre(recs) {
  const f = L.firma();
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="${NS.soap}" xmlns:sum="${NS.sum}" xmlns:sum1="${NS.sum1}"><soapenv:Header/><soapenv:Body>` +
    '<sum:RegFactuSistemaFacturacion><sum:Cabecera>' + t('ObligadoEmision', t('NombreRazon', x(String(f.FIRMENNAME || '').slice(0, 120))) + t('NIF', x(recs[0].NIF))) + '</sum:Cabecera>' +
    recs.map(r => `<sum:RegistroFactura>${r.XML}</sum:RegistroFactura>`).join('') +
    '</sum:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>';
}
const urlEnvio = () => process.env.KUENTAPOS_VERIFACTU_URL || URLS[entorno()][L.sw('verifactu.certificado', 'personal') === 'sello' ? 'sello' : 'personal'];
let transporte = null; // tests replace the HTTPS transport
function post(xml, { method = 'POST' } = {}) {
  if (transporte) return Promise.resolve(transporte(xml, method));
  const { pfx, passphrase } = certificado();
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(urlEnvio()), {
      method, pfx, passphrase, timeout: 60000,
      headers: method === 'POST' ? { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', 'Content-Length': Buffer.byteLength(xml) } : {},
    }, res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch).toString('utf8') })); });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung bei der Verbindung zur AEAT.')));
    req.on('error', e => reject(tlsFehler(e)));
    req.end(method === 'POST' ? xml : undefined);
  });
}
const ent2 = s => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function tag(s, n) { const m = String(s).match(new RegExp(`<(?:[\\w-]+:)?${n}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${n}>`)); return m ? ent2(m[1].trim()) : null; }
function interpretar(body) {
  const fault = tag(body, 'faultstring');
  if (fault) return { fault };
  const lineas = [];
  const re = /<(?:[\w-]+:)?RespuestaLinea>([\s\S]*?)<\/(?:[\w-]+:)?RespuestaLinea>/g; let m;
  while ((m = re.exec(body))) lineas.push({ numSerie: tag(m[1], 'NumSerieFactura'), operacion: tag(m[1], 'TipoOperacion'), estado: tag(m[1], 'EstadoRegistro'), codigo: tag(m[1], 'CodigoErrorRegistro'), mensaje: tag(m[1], 'DescripcionErrorRegistro') });
  return { csv: tag(body, 'CSV'), estadoEnvio: tag(body, 'EstadoEnvio'), espera: Number(tag(body, 'TiempoEsperaEnvio')) || 60, lineas };
}
const ESTADOS = { Correcto: 'aceptado', AceptadoConErrores: 'aceptado_errores', Incorrecto: 'rechazado' };

const enviando = new Set();
// Send pending records (at most 1000), respecting the waiting time the AEAT asks for (flow control)
async function enviar() {
  if (!ES.activo()) return { enviados: 0 };
  const m = dbm.current();
  if (enviando.has(m)) return { ocupado: true };
  const d = asegurar(); const ent = entorno();
  const prox = Number(L.sw('verifactu.proximo', '0')) || 0;
  const recs = d.prepare("SELECT * FROM SW_VERIFACTU WHERE ESTADO='pendiente' AND ENTORNO=? ORDER BY ID LIMIT 1000").all(ent);
  if (!recs.length) return { enviados: 0 };
  if (Date.now() < prox && recs.length < 1000) return { esperar: Math.ceil((prox - Date.now()) / 1000), pendientes: recs.length };
  enviando.add(m);
  try {
    const fallo = (msg) => {
      const n = Math.max(...recs.map(r => r.INTENTOS || 0)) + 1;
      for (const r of recs) estado(r.ID, { MENSAJE: msg, INTENTOS: (r.INTENTOS || 0) + 1 });
      L.setSw('verifactu.proximo', String(Date.now() + Math.min(3600, 60 * 2 ** Math.min(n - 1, 6)) * 1000));
      L.setSw('verifactu.ultimoerror', `${L.now()} ${msg}`);
      return { error: msg, pendientes: recs.length };
    };
    let res;
    try { res = await post(sobre(recs)); } catch (e) { return fallo(e.message); }
    const r = interpretar(res.body);
    if (r.fault) return fallo('AEAT: ' + r.fault);
    if (!r.lineas.length && !r.estadoEnvio) return fallo(`AEAT antwortet mit HTTP ${res.status}${res.status === 403 ? ' (Zertifikat nicht berechtigt)' : ''}.`);
    const usadas = new Set(); let ok = 0, err = 0;
    for (const rec of recs) {
      const op = rec.TIPO === 'anulacion' ? 'Anulacion' : 'Alta';
      const i = r.lineas.findIndex((l, j) => !usadas.has(j) && l.numSerie === rec.NUMSERIE && (!l.operacion || l.operacion === op));
      const l = i >= 0 ? r.lineas[i] : null; if (i >= 0) usadas.add(i);
      let est = l ? ESTADOS[l.estado] || 'rechazado' : (r.estadoEnvio === 'Correcto' ? 'aceptado' : 'rechazado');
      if (l && l.codigo === '3000') est = 'aceptado'; // already registered (duplicate)
      estado(rec.ID, { ESTADO: est, CSV: r.csv, CODIGO: l && l.codigo, MENSAJE: l && l.mensaje, ENVIADO: L.now(), INTENTOS: (rec.INTENTOS || 0) + 1 });
      if (est === 'rechazado') err++; else ok++;
    }
    L.setSw('verifactu.proximo', String(Date.now() + r.espera * 1000));
    L.setSw('verifactu.ultimoenvio', `${L.now()} ${r.estadoEnvio || ''} CSV ${r.csv || '-'}`);
    if (err) L.setSw('verifactu.ultimoerror', `${L.now()} ${err} Datensatz/Datensätze abgelehnt`);
    return { enviados: recs.length, aceptados: ok, rechazados: err, csv: r.csv };
  } finally { enviando.delete(m); }
}

// Connection test: certificate readable and accepted by the AEAT server (TLS with client certificate)
async function probar() {
  certificado();
  const res = await post('', { method: 'GET' });
  if (res.status === 403) throw new L.HttpError(400, 'Die AEAT lehnt das Zertifikat ab (HTTP 403). Ist es ein gültiges Zertifikat der Firma oder ihres Vertreters?');
  return { ok: true, status: res.status, url: urlEnvio(), entorno: entorno() };
}

// ---------- information for printing and the user interface ----------
const MOTIVOS = { R1: 'Error fundado en derecho y art. 80 Uno, Dos y Seis LIVA', R2: 'Art. 80.3 LIVA (concurso de acreedores)', R3: 'Art. 80.4 LIVA (créditos incobrables)', R4: 'Resto de causas', R5: 'Factura rectificativa en facturas simplificadas' };
const TITULOS = { F1: 'Factura', F2: 'Factura simplificada', R1: 'Factura rectificativa', R2: 'Factura rectificativa', R3: 'Factura rectificativa', R4: 'Factura rectificativa', R5: 'Factura rectificativa simplificada' };
function info(kopf) {
  const rec = registroDe(kopf.RECHNUNGID, ES.numSerie(kopf));
  const alta = rec && rec.TIPO === 'alta' ? rec : null;
  const out = { activo: ES.activo(), numSerie: ES.numSerie(kopf), nifEmisor: ES.nifEmisor(), emitida: !!(rec && rec.ESTADO !== 'rechazado'), anulada: !!(rec && rec.TIPO === 'anulacion') };
  if (rec) Object.assign(out, { id: rec.ID, estado: rec.ESTADO, codigo: rec.CODIGO, mensaje: rec.MENSAJE, csv: rec.CSV, entorno: rec.ENTORNO, generado: rec.GENERADO, huella: rec.HUELLA });
  if (alta) Object.assign(out, { tipo: alta.TIPOFACTURA, titulo: TITULOS[alta.TIPOFACTURA], qr: qr(alta), motivo: MOTIVOS[alta.TIPOFACTURA] });
  if (Number(kopf.TYP) === 2 && kopf.REIDGUTSCHRIFT > 0) {
    const o = cabecera(kopf.REIDGUTSCHRIFT);
    if (o) out.rectificada = { numSerie: ES.numSerie(o), fecha: o.DATUM };
  }
  return out;
}
function resumen() {
  const d = asegurar();
  const cnt = Object.fromEntries(d.prepare('SELECT ESTADO, COUNT(*) n FROM SW_VERIFACTU WHERE ENTORNO=? GROUP BY ESTADO').all(entorno()).map(r => [r.ESTADO, r.n]));
  let cert = null; try { cert = { guardado: certificado().guardado }; } catch { /* none */ }
  const sif = productor();
  return {
    activo: ES.activo(), entorno: entorno(), contador: cnt, certificado: cert, nifEmisor: ES.nifEmisor(), url: urlEnvio(),
    productor: { nombre: sif.nombreRazon, id: sif.nif || (sif.idOtro && sif.idOtro.id) || '', version: sif.version }, instalacion: fs.existsSync(path.join(dir(), 'instalacion.txt')) ? instalacion() : null,
    proximo: Number(L.sw('verifactu.proximo', '0')) || 0, ultimoEnvio: L.sw('verifactu.ultimoenvio', ''), ultimoError: L.sw('verifactu.ultimoerror', ''),
  };
}
function registros({ estado: est, limit = 500 } = {}) {
  const d = asegurar();
  return d.prepare(`SELECT ID, TIPO, RECHNUNGID, NUMSERIE, FECHA, TIPOFACTURA, IMPORTE, ESTADO, CODIGO, MENSAJE, CSV, ENTORNO, GENERADO, ENVIADO, INTENTOS FROM SW_VERIFACTU ${est ? 'WHERE ESTADO=?' : ''} ORDER BY ID DESC LIMIT ${Math.min(Number(limit) || 500, 10000)}`).all(...(est ? [est] : []));
}
function xmlDe(id) { const r = asegurar().prepare('SELECT NUMSERIE, XML FROM SW_VERIFACTU WHERE ID=?').get(id); if (!r) throw new L.HttpError(404, 'Datensatz nicht gefunden'); return r; }

module.exports = {
  emitir, anular, enviar, probar, vigente, registroDe, siguienteNumero, info, resumen, registros, xmlDe, qr,
  guardarCertificado, borrarCertificado, huellaAlta, huellaAnulacion, fechaHoraHuso, interpretar, sobre, datos, asegurar, URLS,
  _setTransporte(fn) { transporte = fn; },
};
