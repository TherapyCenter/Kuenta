'use strict';
// UK accounting exports instead of DATEV: Xero (sales invoices and bills), QuickBooks Online (invoices),
// Sage 50 (audit trail transactions) and a plain VAT journal. Dates dd/mm/yyyy, amounts with a decimal point.
const L = require('../lib');
const GB = require('./index');

const q = s => { const v = String(s ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const csv = (head, rows) => Buffer.from([head, ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n', 'utf8');
const n2 = v => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
const n4 = v => String(Math.round((Number(v) || 0) * 10000) / 10000);
const fecha = iso => iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '';
const rango = (o = {}) => ({ von: o.von || L.today().slice(0, 4) + '-01-01', bis: o.bis || L.today() });
const nombre = k => (Number(k.KUNART) === 1 || !k.KUNVORNAME ? k.KUNNAME : [k.KUNVORNAME, k.KUNNAME].filter(Boolean).join(' ')) || 'Cash sale';

// sales invoices with their lines (as calculated on the invoice) and the VAT category per line
function facturas(r) {
  const d = L.db(); const VG = require('../api/vorgang');
  return d.prepare('SELECT * FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ? ORDER BY DATUM, RECHNUNGNUMMER').all(r.von, r.bis).map(k => {
    const pos = d.prepare('SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? ORDER BY PRTSORT').all(k.RECHNUNGID).map(p => ({ ...p }));
    const tax = VG.calc({ ...k }, pos);
    const lineas = pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z').map(p => ({ p, cat: GB.categoria(p, k), rate: tax[Number(p.MWST) || 61] ? tax[Number(p.MWST) || 61].rate : 0 }));
    const kd = k.KUNID ? d.prepare('SELECT EMAIL, USTID FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {};
    // per VAT category: net and VAT (VAT of standard/reduced lines from the invoice totals, so pennies match)
    const grupos = {};
    for (const l of lineas) { const g = grupos[l.cat] || (grupos[l.cat] = { cat: l.cat, rate: ['S', 'R'].includes(l.cat) ? l.rate : 0, net: 0, vat: 0 }); g.net += Number(l.p.SUMME) || 0; }
    if (grupos.S && tax[61]) { grupos.S.net = tax[61].netto; grupos.S.vat = tax[61].mwst; }
    if (grupos.R && tax[62]) { grupos.R.net = tax[62].netto; grupos.R.vat = tax[62].mwst; }
    return { k, lineas, grupos: Object.values(grupos), kd, faellig: L.addDays(k.DATUM, k.FAELLING || 0) };
  });
}
function compras(r) {
  const d = L.db();
  return d.prepare('SELECT e.*, l.USTID, l.EMAIL FROM SW_EINGANG e LEFT JOIN LIEFERANTEN l ON l.LIEFID=e.LIEFID WHERE e.DATUM BETWEEN ? AND ? ORDER BY e.DATUM, e.ID').all(r.von, r.bis)
    .map(e => ({ e, pos: d.prepare('SELECT * FROM SW_EINGANG_POS WHERE EINGANGID=? ORDER BY POS').all(e.ID) }));
}

const XERO_VENTA = { S: r => `${r}% (VAT on Income)`, R: r => `${r}% (VAT on Income)`, Z: () => 'Zero Rated Income', E: () => 'Exempt Income', O: () => 'No VAT', M: () => 'No VAT', N: () => 'No VAT' };
const xeroCompra = rate => !GB.registrado() ? 'No VAT' : Number(rate) > 0 ? `${Number(rate)}% (VAT on Expenses)` : 'Zero Rated Expenses';

function xeroVentas(o) {
  const r = rango(o); const cuenta = L.sw('gb.xero.sales', '200');
  const head = ['*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', 'Discount', '*AccountCode', '*TaxType', 'TaxAmount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency', 'BrandingTheme'];
  const rows = [];
  for (const f of facturas(r)) for (const l of f.lineas) {
    const p = l.p; const k = f.k;
    rows.push([nombre(k), f.kd.EMAIL || '', k.KUNSTRASSE || '', k.KUNZUSATZ || '', '', '', k.KUNORT || '', '', k.KUNPLZ || '', k.KUNLAND || '', k.RECHNUNGNUMMER, k.FAHRKENNZEICHEN || k.BESTELLNR || '', fecha(k.DATUM), fecha(f.faellig), '',
      String(p.ARTNUMMER || '').slice(0, 30), (p.BEZEICHNUNG || p.BESCHREIBUNG || 'Item').slice(0, 4000), n4(p.MENGE), n4(p.VK), Number(p.RABATT) ? n2(p.RABATT) : '', cuenta, XERO_VENTA[l.cat](l.rate), '', '', '', '', '', 'GBP', '']);
  }
  return { buffer: csv(head, rows), filename: `Xero_sales_invoices_${r.von}_${r.bis}.csv` };
}
function xeroCompras(o) {
  const r = rango(o); const cuenta = L.sw('gb.xero.purchases', '310');
  const head = ['*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', 'Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType', 'TaxAmount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency'];
  const rows = [];
  for (const { e, pos } of compras(r)) {
    const lin = pos.length ? pos.map(p => ({ d: p.BEZEICHNUNG || p.ARTNUMMER || 'Purchase', m: p.MENGE, u: p.EKNETTO, rate: p.STEUERSATZ })) : [{ d: e.BEMERKUNG || 'Purchase', m: 1, u: e.NETTO, rate: e.STEUERSATZ }];
    for (const l of lin) rows.push([e.LIEFNAME || 'Supplier', e.EMAIL || '', '', '', '', '', '', '', '', '', e.RECHNUNGSNR || `K${e.ID}`, fecha(e.DATUM), fecha(e.FAELLIG || e.DATUM), '', '', l.d, n4(l.m), n4(l.u), e.GEGENKONTO || cuenta, xeroCompra(l.rate), '', '', '', '', '', 'GBP']);
  }
  return { buffer: csv(head, rows), filename: `Xero_bills_${r.von}_${r.bis}.csv` };
}

const QBO = { S: r => `${Number(r).toFixed(1)}% S`, R: r => `${Number(r).toFixed(1)}% R`, Z: () => '0.0% Z', E: () => 'Exempt', O: () => 'No VAT', M: () => 'No VAT', N: () => 'No VAT' };
function quickbooks(o) {
  const r = rango(o); const item = L.sw('gb.qbo.item', 'Sales');
  const head = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Location', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'ItemTaxCode', 'ItemTaxAmount', 'Currency'];
  const rows = [];
  for (const f of facturas(r)) for (const l of f.lineas) {
    const p = l.p; const k = f.k; const net = Number(p.SUMME) || 0;
    rows.push([k.RECHNUNGNUMMER, nombre(k), fecha(k.DATUM), fecha(f.faellig), '', '', [k.FAHRKENNZEICHEN, k.BESTELLNR].filter(Boolean).join(' '), item, (p.BEZEICHNUNG || p.BESCHREIBUNG || 'Item').slice(0, 4000), n4(p.MENGE), n4(net / (Number(p.MENGE) || 1)), n2(net), QBO[l.cat](l.rate), n2(['S', 'R'].includes(l.cat) ? net * l.rate / 100 : 0), 'GBP']);
  }
  return { buffer: csv(head, rows), filename: `QuickBooks_invoices_${r.von}_${r.bis}.csv` };
}

const SAGE = { S: 'T1', R: 'T5', Z: 'T0', E: 'T2', O: 'T9', M: 'T9', N: 'T9' };
const sageRef = s => String(s ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
function sage(o) {
  const r = rango(o); const ventas = L.sw('gb.sage.sales', '4000'); const comprasN = L.sw('gb.sage.purchases', '5000');
  const head = ['Type', 'Account Reference', 'Nominal A/C Ref', 'Department Code', 'Date', 'Reference', 'Details', 'Net Amount', 'Tax Code', 'Tax Amount', 'Exchange Rate', 'Extra Reference', 'User Name', 'Project Refn', 'Cost Code Refn'];
  const rows = [];
  for (const f of facturas(r)) for (const g of f.grupos) {
    const credit = Number(f.k.TYP) === 2 || g.net < 0;
    rows.push([credit ? 'SC' : 'SI', sageRef(f.k.KUNNUMMER ? 'C' + f.k.KUNNUMMER : 'CASH'), ventas, '0', fecha(f.k.DATUM), String(f.k.RECHNUNGNUMMER), nombre(f.k).slice(0, 60), n2(Math.abs(g.net)), SAGE[g.cat], n2(Math.abs(g.vat)), '', '', 'KuentaPOS', '', '']);
  }
  for (const { e } of compras(r)) {
    const credit = Number(e.BRUTTO) < 0; const code = !GB.registrado() ? 'T9' : Number(e.STEUERSATZ) === GB.tasas().reduced ? 'T5' : Number(e.STEUERSATZ) > 0 ? 'T1' : 'T0';
    rows.push([credit ? 'PC' : 'PI', sageRef(e.LIEFID ? 'S' + e.LIEFID : 'SUPPLIER'), e.GEGENKONTO || comprasN, '0', fecha(e.DATUM), String(e.RECHNUNGSNR || ''), String(e.LIEFNAME || '').slice(0, 60), n2(Math.abs(e.NETTO)), code, n2(Math.abs(e.MWST)), '', '', 'KuentaPOS', '', '']);
  }
  return { buffer: csv(head, rows), filename: `Sage50_audit_trail_${r.von}_${r.bis}.csv` };
}

const CAT = { S: 'Standard', R: 'Reduced', Z: 'Zero-rated', E: 'Exempt', O: 'Outside the scope', M: 'Margin scheme', N: 'Not VAT registered' };
function diario(o) {
  const r = rango(o);
  const head = ['Date', 'Type', 'Number', 'Name', 'VAT number', 'VAT category', 'VAT rate %', 'Net', 'VAT', 'Gross'];
  const rows = [];
  for (const f of facturas(r)) for (const g of f.grupos) rows.push([fecha(f.k.DATUM), Number(f.k.TYP) === 2 ? 'Sales credit note' : 'Sales invoice', f.k.RECHNUNGNUMMER, nombre(f.k), f.kd.USTID || '', CAT[g.cat], n2(g.rate), n2(g.net), n2(g.vat), n2(g.net + g.vat)]);
  for (const { e } of compras(r)) rows.push([fecha(e.DATUM), 'Purchase invoice', e.RECHNUNGSNR || '', e.LIEFNAME || '', e.USTID || '', Number(e.STEUERSATZ) > 0 ? 'Standard/Reduced' : 'Zero-rated/Exempt', n2(e.STEUERSATZ), n2(e.NETTO), n2(e.MWST), n2(e.BRUTTO)]);
  return { buffer: csv(head, rows), filename: `VAT_journal_${r.von}_${r.bis}.csv` };
}

module.exports = { xeroVentas, xeroCompras, quickbooks, sage, diario };
