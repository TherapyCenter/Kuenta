'use strict';
// Spanish VAT books (libros registro de IVA, art. 62 RIVA) as CSV for the tax adviser (gestor) and an
// overview for the quarterly VAT return (modelo 303). The figures come from the invoices in KuentaPOS.
const L = require('../lib');
const ES = require('./index');
const NIF = require('../../public/js/nif.js');

const dec = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',');
const q = s => { const v = String(s ?? ''); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const fecha = iso => iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '';
const periodo = iso => `${Math.floor((Number(String(iso).slice(5, 7)) - 1) / 3) + 1}T`;
const csv = (head, rows) => Buffer.from('﻿' + [head, ...rows].map(r => r.map(q).join(';')).join('\r\n') + '\r\n', 'utf8');
function rango({ von, bis } = {}) { return { von: von || L.today().slice(0, 4) + '-01-01', bis: bis || L.today() }; }

// issued invoices (with their tax breakdown per rate)
function expedidas(r) {
  const d = L.db(); const VG = require('../api/vorgang');
  const out = [];
  for (const k of d.prepare("SELECT * FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ? AND COALESCE(ESNUMSERIE,'')<>'' ORDER BY DATUM, RECHNUNGNUMMER").all(r.von, r.bis)) {
    const pos = d.prepare('SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? ORDER BY PRTSORT').all(k.RECHNUNGID);
    const tax = VG.calc({ ...k }, pos.map(p => ({ ...p })));
    const kd = k.KUNID ? d.prepare('SELECT USTID FROM KUNDEN WHERE KUNID=?').get(k.KUNID) : null;
    const n = NIF.validar(kd && kd.USTID);
    const nif = n.ok ? n.nif : (kd && kd.USTID) || '';
    const nombre = Number(k.KUNART) === 1 || !k.KUNVORNAME ? k.KUNNAME : [k.KUNVORNAME, k.KUNNAME].filter(Boolean).join(' ');
    const grupos = Object.values(tax);
    grupos.forEach((g, i) => out.push({ k, nif, nombre, g, total: i === 0 ? k.GBRUTTO : null }));
  }
  return out;
}

function libroExpedidas(opts) {
  const r = rango(opts);
  const rows = expedidas(r).map(({ k, nif, nombre, g, total }) => [
    k.DATUM.slice(0, 4), periodo(k.DATUM), fecha(k.DATUM), k.LIEFDATUM && k.LIEFDATUM !== k.DATUM ? fecha(k.LIEFDATUM) : '', k.ESNUMSERIE, k.ESTIPO || '',
    nif, nombre || '', dec(g.netto), dec(g.rate), dec(g.mwst), g.reRate ? dec(g.reRate) : '', g.recargo ? dec(g.recargo) : '', total == null ? '' : dec(total),
  ]);
  return { buffer: csv(['Ejercicio', 'Periodo', 'Fecha expedición', 'Fecha operación', 'Serie-Número', 'Tipo factura', 'NIF destinatario', 'Nombre destinatario', 'Base imponible', 'Tipo IVA %', 'Cuota IVA', 'Tipo recargo %', 'Cuota recargo', 'Total factura'], rows), filename: `Libro_facturas_expedidas_${r.von}_${r.bis}.csv` };
}

function recibidas(r) {
  const d = L.db();
  return d.prepare('SELECT e.*, l.USTID FROM SW_EINGANG e LEFT JOIN LIEFERANTEN l ON l.LIEFID=e.LIEFID WHERE e.DATUM BETWEEN ? AND ? ORDER BY e.DATUM, e.ID').all(r.von, r.bis);
}
function libroRecibidas(opts) {
  const r = rango(opts);
  const rows = recibidas(r).map(e => [e.DATUM.slice(0, 4), periodo(e.DATUM), fecha(e.DATUM), e.LEISTUNGSDATUM ? fecha(e.LEISTUNGSDATUM) : '', e.RECHNUNGSNR || '', NIF.limpiar(e.USTID || ''), e.LIEFNAME || '', dec(e.NETTO), dec(e.STEUERSATZ), dec(e.MWST), dec(e.BRUTTO)]);
  return { buffer: csv(['Ejercicio', 'Periodo', 'Fecha expedición', 'Fecha operación', 'Número factura', 'NIF expedidor', 'Nombre expedidor', 'Base imponible', 'Tipo IVA %', 'Cuota soportada', 'Total factura'], rows), filename: `Libro_facturas_recibidas_${r.von}_${r.bis}.csv` };
}

// Overview for the quarterly return (indicative: the gestor files the return)
function modelo303({ jahr, quartal } = {}) {
  const y = Number(jahr) || Number(L.today().slice(0, 4)); const qn = Math.min(4, Math.max(1, Number(quartal) || Math.floor((Number(L.today().slice(5, 7)) - 1) / 3) + 1));
  const p = n => String(n).padStart(2, '0');
  const r = { von: `${y}-${p(qn * 3 - 2)}-01`, bis: `${y}-${p(qn * 3)}-31` };
  const dev = {}; const re = {}; let exento = 0;
  for (const { g } of expedidas(r)) {
    if (!g.rate) { exento += g.netto; continue; }
    const a = dev[g.rate] || (dev[g.rate] = { tipo: g.rate, base: 0, cuota: 0 }); a.base += g.netto; a.cuota += g.mwst;
    if (g.reRate) { const b = re[g.reRate] || (re[g.reRate] = { tipo: g.reRate, base: 0, cuota: 0 }); b.base += g.netto; b.cuota += g.recargo; }
  }
  let sopBase = 0, sopCuota = 0;
  for (const e of recibidas(r)) { sopBase += Number(e.NETTO) || 0; sopCuota += Number(e.MWST) || 0; }
  const casilla = { 4: ['01', '02', '03'], 10: ['04', '05', '06'], 21: ['07', '08', '09'] };
  const devengado = Object.values(dev).sort((a, b) => a.tipo - b.tipo).map(a => ({ ...a, base: L.r2(a.base), cuota: L.r2(a.cuota), casillas: casilla[a.tipo] || null }));
  const recargo = Object.values(re).sort((a, b) => a.tipo - b.tipo).map(a => ({ ...a, base: L.r2(a.base), cuota: L.r2(a.cuota) }));
  const totalDev = L.r2(devengado.reduce((s, a) => s + a.cuota, 0) + recargo.reduce((s, a) => s + a.cuota, 0));
  return {
    jahr: y, quartal: qn, von: r.von, bis: r.bis, devengado, recargo, exento: L.r2(exento),
    total_devengado: totalDev, soportado: { base: L.r2(sopBase), cuota: L.r2(sopCuota) }, resultado: L.r2(totalDev - sopCuota),
  };
}

module.exports = { libroExpedidas, libroRecibidas, modelo303 };
void ES;
