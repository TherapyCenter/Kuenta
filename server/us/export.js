'use strict';
// QuickBooks Online (US) invoice import: one row per invoice line, tax code TAX or NON, dates MM/DD/YYYY
const L = require('../lib');

const q = s => { const v = String(s ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const n2 = v => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
const n4 = v => String(Math.round((Number(v) || 0) * 10000) / 10000);
const fecha = iso => iso ? `${String(iso).slice(5, 7)}/${String(iso).slice(8, 10)}/${String(iso).slice(0, 4)}` : '';
const nombre = k => (Number(k.KUNART) === 1 || !k.KUNVORNAME ? k.KUNNAME : [k.KUNVORNAME, k.KUNNAME].filter(Boolean).join(' ')) || 'Cash sale';

function quickbooks(o = {}) {
  const von = o.von || L.today().slice(0, 4) + '-01-01', bis = o.bis || L.today();
  const d = L.db(); const VG = require('../api/vorgang');
  const usLaborFree = L.sw('us.labor.taxable', '0') !== '1';
  const items = { A: L.sw('us.qbo.parts', 'Parts'), L: L.sw('us.qbo.labor', 'Labor'), FEE: L.sw('us.qbo.fees', 'Fees') };
  const head = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Location', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'ItemTaxCode', 'ItemTaxAmount', 'Currency'];
  const rows = [];
  for (const k of d.prepare('SELECT * FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ? ORDER BY DATUM, RECHNUNGNUMMER').all(von, bis)) {
    const pos = d.prepare('SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? ORDER BY PRTSORT').all(k.RECHNUNGID).map(p => ({ ...p }));
    const tax = VG.calc({ ...k }, pos);
    const due = L.addDays(k.DATUM, k.FAELLING || 0);
    for (const p of pos.filter(x => x.POSART !== 'T' && x.POSART !== 'Z')) {
      const code = Number(p.DURCHLAUFER) === 1 || k.STEUERART || (usLaborFree && p.POSART === 'L') ? 63 : (Number(p.MWST) || 61);
      const rate = code === 63 ? 0 : (tax[code] ? tax[code].rate : 0);
      const net = Number(p.SUMME) || 0;
      const item = ['SHOP', 'FEE'].includes(p.ARTNUMMER) ? items.FEE : p.POSART === 'L' ? items.L : items.A;
      rows.push([k.RECHNUNGNUMMER, nombre(k), fecha(k.DATUM), fecha(due), '', '', [k.FAHRKENNZEICHEN, k.FAHRMARKE, k.FAHRMODELL, k.BESTELLNR].filter(Boolean).join(' '), item,
        (p.BEZEICHNUNG || p.BESCHREIBUNG || 'Item').slice(0, 4000), n4(p.MENGE), n4(net / (Number(p.MENGE) || 1)), n2(net), rate > 0 ? 'TAX' : 'NON', n2(net * rate / 100), 'USD']);
    }
  }
  const buffer = Buffer.from([head, ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n', 'utf8');
  return { buffer, filename: `QuickBooks_invoices_${von}_${bis}.csv` };
}

module.exports = { quickbooks };
