'use strict';
// ebInterface 6.1 (Austrian e-invoice standard) for invoices to the federal government (e-rechnung.gv.at, USP)
// and other recipients. Uses the invoice data of the e-invoice builder (lines, tax groups, totals).
// For the federal government: order reference (Auftragsreferenz) = order number of the invoice,
// supplier number (Lieferantennummer) = field "Leitweg-ID" of the customer.
const L = require('../lib');
const NIF = require('../../public/js/nif.js');
const pkg = require('../../package.json');

const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a2 = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const a4 = n => (Math.round((Number(n) || 0) * 10000) / 10000).toFixed(4);
const NS = 'http://www.ebinterface.at/schema/6p1/';

function adresse(name, strasse, plz, ort, land, { tel, mail } = {}) {
  return `<Address><Name>${x(name)}</Name>${strasse ? `<Street>${x(strasse)}</Street>` : ''}<Town>${x(ort)}</Town><ZIP>${x(plz)}</ZIP><Country CountryCode="${x(land || 'AT')}"/>${tel ? `<Phone>${x(tel)}</Phone>` : ''}${mail ? `<Email>${x(mail)}</Email>` : ''}</Address>`;
}
const kategorie = l => (l.cat === 'S' ? 'S' : l.cat === 'AE' ? 'AE' : l.cat === 'K' ? 'K' : l.cat === 'G' ? 'G' : 'E');

function create(rid) {
  const ER = require('../api/erechnung');
  const b = ER.build(rid); const { k, f, kunde } = b;
  const credit = b.credit; const sg = credit ? -1 : 1; // credit memos with positive amounts
  const problems = [];
  if (!NIF.atUid(f.USTNR).ok && !require('./index').klein()) problems.push('UID-Nummer der Firma fehlt oder ist ungültig');
  if (!f.STRASSE || !f.PLZ || !f.ORT) problems.push('Firmenanschrift unvollständig');
  if (!f.IBAN) problems.push('IBAN der Firma fehlt');
  if (!k.KUNNAME || !k.KUNPLZ || !k.KUNORT) problems.push('Name und Anschrift des Kunden unvollständig');
  if (!b.lines.length) problems.push('Keine Rechnungspositionen');
  const bund = !!kunde.LEITWEGID;
  if (bund && !k.BESTELLNR) problems.push('Auftragsreferenz fehlt (Bestell-Nr. der Rechnung, bei Rechnungen an den Bund Pflicht)');
  const kundeName = [k.KUNNAME, k.KUNVORNAME].filter(Boolean).join(Number(k.KUNART) === 1 ? ' ' : ', ');
  const o = [];
  o.push('<?xml version="1.0" encoding="UTF-8"?>');
  o.push(`<Invoice xmlns="${NS}" GeneratingSystem="Kuenta ${x(pkg.version)}" DocumentType="${credit ? 'CreditMemo' : 'Invoice'}" InvoiceCurrency="EUR" DocumentTitle="${x((credit ? 'Gutschrift ' : 'Rechnung ') + k.RECHNUNGNUMMER)}" Language="ger">`);
  o.push(`<InvoiceNumber>${x(k.RECHNUNGNUMMER)}</InvoiceNumber><InvoiceDate>${x(String(k.DATUM).slice(0, 10))}</InvoiceDate>`);
  o.push(`<Delivery><Date>${x(String(k.LIEFDATUM || k.DATUM).slice(0, 10))}</Date></Delivery>`);
  o.push(`<Biller><VATIdentificationNumber>${x(String(f.USTNR || '00000000').replace(/\s/g, ''))}</VATIdentificationNumber>${bund ? `<InvoiceRecipientsBillerID>${x(kunde.LEITWEGID)}</InvoiceRecipientsBillerID>` : ''}${adresse(f.FIRMENNAME, f.STRASSE, f.PLZ, f.ORT, f.LAND || 'AT', { tel: f.TELEFON, mail: f.EMAIL })}</Biller>`);
  o.push(`<InvoiceRecipient><VATIdentificationNumber>${x(String(kunde.USTID || '00000000').replace(/\s/g, ''))}</VATIdentificationNumber>${k.KUNNUMMER ? `<BillersInvoiceRecipientID>${x(k.KUNNUMMER)}</BillersInvoiceRecipientID>` : ''}${k.BESTELLNR ? `<OrderReference><OrderID>${x(k.BESTELLNR)}</OrderID></OrderReference>` : ''}${adresse(kundeName, k.KUNSTRASSE, k.KUNPLZ, k.KUNORT, k.KUNLAND || 'AT', { mail: b.buyerMail })}</InvoiceRecipient>`);
  o.push('<Details><ItemList>');
  for (const l of b.lines) {
    const tax = l.cat === 'S' ? Math.round(l.total * l.rate) / 100 : 0;
    o.push(`<ListLineItem><PositionNumber>${l.id}</PositionNumber><Description>${x(l.name)}</Description>${l.artnr ? `<ArticleNumber ArticleNumberType="SellersArticleNumber">${x(l.artnr)}</ArticleNumber>` : ''}<Quantity Unit="${x(l.unit)}">${a4(sg * l.qty)}</Quantity><UnitPrice>${a4(l.price)}</UnitPrice><TaxItem><TaxableAmount>${a2(sg * l.total)}</TaxableAmount><TaxPercent TaxCategoryCode="${kategorie(l)}">${a2(l.rate)}</TaxPercent><TaxAmount>${a2(sg * tax)}</TaxAmount></TaxItem><LineItemAmount>${a2(sg * l.total)}</LineItemAmount></ListLineItem>`);
  }
  o.push('</ItemList></Details>');
  o.push('<Tax>');
  for (const t of b.taxes) o.push(`<TaxItem><TaxableAmount>${a2(sg * t.basis)}</TaxableAmount><TaxPercent TaxCategoryCode="${kategorie(t)}">${a2(t.rate)}</TaxPercent><TaxAmount>${a2(sg * t.tax)}</TaxAmount></TaxItem>`);
  o.push('</Tax>');
  o.push(`<TotalGrossAmount>${a2(sg * b.grand)}</TotalGrossAmount>`);
  if (b.prepaid) o.push(`<PrepaidAmount>${a2(sg * b.prepaid)}</PrepaidAmount>`);
  if (b.rounding) o.push(`<RoundingAmount>${a2(sg * b.rounding)}</RoundingAmount>`);
  o.push(`<PayableAmount>${a2(sg * b.due)}</PayableAmount>`);
  if (!credit && f.IBAN) o.push(`<PaymentMethod><UniversalBankTransaction><BeneficiaryAccount>${f.BIC ? `<BIC>${x(f.BIC.replace(/\s/g, ''))}</BIC>` : ''}<IBAN>${x(f.IBAN.replace(/\s/g, ''))}</IBAN><BankAccountOwner>${x(f.BANKINHABER || f.FIRMENNAME)}</BankAccountOwner></BeneficiaryAccount><PaymentReference>${x(k.RECHNUNGNUMMER)}</PaymentReference></UniversalBankTransaction></PaymentMethod>`);
  if (!credit) o.push(`<PaymentConditions><DueDate>${x(b.faellig)}</DueDate></PaymentConditions>`);
  const notes = [...require('./index').mentions(credit ? 'korrektur' : 'rechnung', k, b.lines.map(l => ({ POSART: 'A' }))), ...b.notes.filter(n => !/§ 19 UStG/.test(n))];
  if (b.orig) notes.unshift(`Korrektur zu Rechnung ${b.orig.RECHNUNGNUMMER} vom ${String(b.orig.DATUM).slice(0, 10)}`);
  if (notes.length) o.push(`<Comment>${x(notes.join('\n'))}</Comment>`);
  o.push('</Invoice>');
  return { xml: o.join(''), problems, filename: `ebInterface_${String(k.RECHNUNGNUMMER).replace(/[^\w-]/g, '_')}.xml` };
}

module.exports = { create };
