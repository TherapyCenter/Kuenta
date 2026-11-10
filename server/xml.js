'use strict';
// Minimal XML parser (for e-invoices) and extraction of XML files embedded in PDFs
const zlib = require('zlib');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));

function parse(xml) {
  xml = String(xml).replace(/^﻿/, '');
  const root = { name: '#root', local: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {};
      String(m[4] || '').replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, k, __, a, b) => { attrs[k] = unesc(a ?? b ?? ''); });
      const el = { name: m[3], local: m[3].split(':').pop(), attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6]) top.text += unesc(m[6]);
  }
  return root.children[0] || null;
}

// helpers: path by local names
function all(el, name) { const out = []; (function walk(e) { for (const c of e.children) { if (c.local === name) out.push(c); walk(c); } })(el); return out; }
function find(el, ...path) {
  let cur = [el];
  for (const p of path) { cur = cur.flatMap(c => p.startsWith('>') ? c.children.filter(x => x.local === p.slice(1)) : all(c, p)); if (!cur.length) return null; }
  return cur[0];
}
function txt(el, ...path) { const e = path.length ? find(el, ...path) : el; return e ? e.text.trim() : ''; }

// Get the XML embedded in a PDF (ZUGFeRD / Factur-X / XRechnung)
function xmlFromPdf(buf) {
  const s = buf.toString('latin1');
  const re = /stream\r?\n/g; let m;
  const found = [];
  while ((m = re.exec(s))) {
    const dictStart = s.lastIndexOf('obj', m.index);
    const dict = s.slice(dictStart, m.index);
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) { try { data = zlib.inflateSync(data); } catch { try { data = zlib.inflateSync(data.subarray(0, data.length - 1)); } catch { continue; } } }
    const head = data.subarray(0, 400).toString('utf8');
    if (/CrossIndustryInvoice|<(\w+:)?Invoice\b|<(\w+:)?CreditNote\b/.test(head) || (/EmbeddedFile/.test(dict) && /<\?xml/.test(head))) found.push(data.toString('utf8'));
    re.lastIndex = end;
  }
  return found.find(x => /CrossIndustryInvoice|Invoice|CreditNote/.test(x)) || null;
}

// Convert an e-invoice (CII or UBL) into a uniform object
function readInvoice(xml) {
  const r = parse(xml);
  if (!r) throw new Error('Keine gültige XML-Datei');
  const num = v => { const n = Number(String(v || '').trim()); return Number.isFinite(n) ? n : 0; };
  const d8 = v => { v = String(v || '').trim(); return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v.slice(0, 10); };
  if (r.local === 'CrossIndustryInvoice') {
    const sel = find(r, 'SellerTradeParty'); const sum = find(r, 'SpecifiedTradeSettlementHeaderMonetarySummation');
    const taxes = all(find(r, 'ApplicableHeaderTradeSettlement') || r, 'ApplicableTradeTax').filter(t => find(t, '>CalculatedAmount'));
    return {
      format: 'CII', nr: txt(r, 'ExchangedDocument', '>ID'), typ: txt(r, 'ExchangedDocument', '>TypeCode'), datum: d8(txt(r, 'ExchangedDocument', 'IssueDateTime', 'DateTimeString')),
      faellig: d8(txt(r, 'SpecifiedTradePaymentTerms', 'DueDateDateTime', 'DateTimeString')), leistung: d8(txt(r, 'ActualDeliverySupplyChainEvent', 'DateTimeString')),
      verkaeufer: { name: txt(sel, '>Name'), strasse: txt(sel, 'LineOne'), plz: txt(sel, 'PostcodeCode'), ort: txt(sel, 'CityName'), land: txt(sel, 'CountryID'), email: txt(sel, 'URIID'), ustid: (all(sel, 'SpecifiedTaxRegistration').map(t => find(t, 'ID')).find(e => e && e.attrs.schemeID === 'VA') || { text: '' }).text.trim(), telefon: txt(sel, 'CompleteNumber') },
      iban: txt(r, 'IBANID'), bic: txt(r, 'BICID'), zahlungsbedingung: txt(r, 'SpecifiedTradePaymentTerms', 'Description'),
      netto: num(txt(sum, 'TaxBasisTotalAmount')), steuer: num(txt(sum, 'TaxTotalAmount')), brutto: num(txt(sum, 'GrandTotalAmount')), zahlbetrag: num(txt(sum, 'DuePayableAmount')),
      steuern: taxes.map(t => ({ satz: num(txt(t, 'RateApplicablePercent')), basis: num(txt(t, 'BasisAmount')), betrag: num(txt(t, 'CalculatedAmount')) })),
      positionen: all(r, 'IncludedSupplyChainTradeLineItem').map(li => ({ artnr: txt(li, 'SellerAssignedID'), bezeichnung: txt(li, 'SpecifiedTradeProduct', '>Name'), menge: num(txt(li, 'BilledQuantity')), einheit: (find(li, 'BilledQuantity') || { attrs: {} }).attrs.unitCode || '', preis: num(txt(li, 'NetPriceProductTradePrice', 'ChargeAmount')), satz: num(txt(li, 'RateApplicablePercent')), summe: num(txt(li, 'LineTotalAmount')) })),
    };
  }
  if (r.local === 'Invoice' || r.local === 'CreditNote') {
    const sel = find(r, 'AccountingSupplierParty'); const sum = find(r, 'LegalMonetaryTotal');
    const lines = [...all(r, 'InvoiceLine'), ...all(r, 'CreditNoteLine')];
    return {
      format: 'UBL', nr: txt(r, '>ID'), typ: txt(r, '>InvoiceTypeCode') || txt(r, '>CreditNoteTypeCode'), datum: txt(r, '>IssueDate'), faellig: txt(r, '>DueDate'), leistung: txt(r, 'ActualDeliveryDate'),
      verkaeufer: { name: txt(sel, 'RegistrationName') || txt(sel, 'PartyName', 'Name'), strasse: txt(sel, 'StreetName'), plz: txt(sel, 'PostalZone'), ort: txt(sel, 'CityName'), land: txt(sel, 'IdentificationCode'), email: txt(sel, 'EndpointID'), ustid: txt(sel, 'PartyTaxScheme', 'CompanyID'), telefon: txt(sel, 'Telephone') },
      iban: txt(r, 'PayeeFinancialAccount', '>ID'), bic: txt(r, 'FinancialInstitutionBranch', '>ID'), zahlungsbedingung: txt(r, 'PaymentTerms', 'Note'),
      netto: num(txt(sum, 'TaxExclusiveAmount')), steuer: num(txt(r, '>TaxTotal', '>TaxAmount')), brutto: num(txt(sum, 'TaxInclusiveAmount')), zahlbetrag: num(txt(sum, 'PayableAmount')),
      steuern: all(r, 'TaxSubtotal').map(t => ({ satz: num(txt(t, 'Percent')), basis: num(txt(t, 'TaxableAmount')), betrag: num(txt(t, '>TaxAmount')) })),
      positionen: lines.map(li => ({ artnr: txt(li, 'SellersItemIdentification', 'ID'), bezeichnung: txt(li, 'Item', '>Name'), menge: num(txt(li, 'InvoicedQuantity') || txt(li, 'CreditedQuantity')), einheit: (find(li, 'InvoicedQuantity') || find(li, 'CreditedQuantity') || { attrs: {} }).attrs.unitCode || '', preis: num(txt(li, 'PriceAmount')), satz: num(txt(li, 'ClassifiedTaxCategory', 'Percent')), summe: num(txt(li, '>LineExtensionAmount')) })),
    };
  }
  throw new Error('Unbekanntes E-Rechnungsformat (' + r.local + ')');
}

module.exports = { parse, find, all, txt, xmlFromPdf, readInvoice };
