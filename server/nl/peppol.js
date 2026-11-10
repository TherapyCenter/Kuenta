'use strict';
// Peppol BIS Billing 3.0 (UBL 2.1) with the Dutch rules (NLCIUS in Peppol): invoices to the government and to
// businesses on the Peppol network. Electronic addresses by the Peppol EAS list: 0106 KvK, 0190 OIN (government),
// 9944 Dutch btw-id. The supplier is identified by its KvK number; customers in the Netherlands by KvK or OIN.
// Uses the invoice data of the e-invoice builder (lines, tax groups, totals).
const L = require('../lib');
const NIF = require('../../public/js/nif.js');
const NL = require('./index');

const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a2 = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const a4 = n => (Math.round((Number(n) || 0) * 10000) / 10000).toString();
const t = v => String(v || '').trim();

// Dutch reason for each exempt category (the builder writes German texts)
function reden(g) {
  if (g.cat === 'AE') return { code: 'VATEX-EU-AE', text: 'Btw verlegd' };
  if (g.cat === 'K') return { code: 'VATEX-EU-IC', text: 'Intracommunautaire levering' };
  if (g.cat === 'G') return { code: 'VATEX-EU-G', text: 'Uitvoer buiten de EU' };
  if (g.rcode === 'VATEX-EU-F') return { code: 'VATEX-EU-F', text: 'Margeregeling gebruikte goederen' };
  if (/Kleinunternehmer/.test(g.reason || '')) return { code: null, text: 'Vrijgesteld (kleineondernemersregeling)' };
  if (/Durchlaufender/.test(g.reason || '')) return { code: null, text: 'Doorlopende post (in naam en voor rekening van de klant)' };
  return { code: null, text: 'Vrijgesteld van btw' };
}

// Peppol EAS codes of VAT numbers per country
const EAS_VAT = { NL: '9944', BE: '9925', DE: '9930', AT: '9914', FR: '9957', IT: '9906', ES: '9920', LU: '9938' };
// electronic address of a party: OIN (government), KvK, otherwise the VAT number
function endpoint({ oin, kvk, btw }) {
  const o = String(oin || '').replace(/\D/g, '');
  if (/^\d{20}$/.test(o)) return { scheme: '0190', id: o };
  const k = NIF.nlKvk(kvk);
  if (k.ok) return { scheme: '0106', id: k.kvk };
  const b = NIF.nlBtw(btw);
  if (b.ok) return { scheme: '9944', id: b.btw };
  const v = String(btw || '').toUpperCase().replace(/[\s.\-]/g, '');
  const land = v.slice(0, 2);
  if (EAS_VAT[land] && /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v)) return { scheme: EAS_VAT[land], id: v };
  return null;
}

function create(rid) {
  const ER = require('../api/erechnung');
  const b = ER.build(rid); const { k, f, kunde } = b;
  const credit = b.credit;
  const root = credit ? 'CreditNote' : 'Invoice';
  const problems = NL.pruefen(credit ? 'korrektur' : 'rechnung', k, kunde);
  const seller = endpoint({ kvk: NL.kvk(), btw: f.USTNR });
  const buyerNl = !k.KUNLAND || k.KUNLAND === 'NL';
  const buyer = endpoint({ oin: kunde.NL_OIN, kvk: kunde.NL_KVK, btw: kunde.USTID });
  const buyerLegal = /^\d{20}$/.test(String(kunde.NL_OIN || '').replace(/\D/g, '')) ? { scheme: '0190', id: String(kunde.NL_OIN).replace(/\D/g, '') } : NIF.nlKvk(kunde.NL_KVK).ok ? { scheme: '0106', id: NIF.nlKvk(kunde.NL_KVK).kvk } : null;
  if (!NL.kvk()) problems.push('KvK-Nummer der Firma fehlt (Pflicht für Peppol)');
  if (!f.STRASSE || !f.PLZ || !f.ORT) problems.push('Firmenanschrift unvollständig');
  if (!buyer) problems.push('Peppol-Adresse des Kunden fehlt: OIN (Behörden), KvK-Nummer oder btw-id im Kunden eintragen');
  if (buyerNl && !buyerLegal) problems.push('KvK-Nummer oder OIN des niederländischen Kunden fehlt (Peppol-Regel NL-R-005)');
  if (buyerNl && (!k.KUNSTRASSE || !k.KUNPLZ || !k.KUNORT)) problems.push('Anschrift des Kunden unvollständig (Straße, Postleitzahl, Ort)');
  if (!k.BESTELLNR && !kunde.LEITWEGID) problems.push('Bestell-Nr. der Rechnung oder Referenz des Kunden fehlt (Peppol: BuyerReference oder OrderReference)');
  if (credit && !b.orig) problems.push('Creditnota ohne Bezug auf die ursprüngliche Rechnung');
  if (!f.IBAN) problems.push('IBAN der Firma fehlt');
  if (!b.lines.length) problems.push('Keine Rechnungspositionen');

  const buyerName = [k.KUNNAME, k.KUNVORNAME].filter(Boolean).join(Number(k.KUNART) === 1 ? ' ' : ', ');
  const addr = (street, plz, ort, land) => `<cac:PostalAddress>${t(street) ? `<cbc:StreetName>${x(t(street))}</cbc:StreetName>` : ''}${t(ort) ? `<cbc:CityName>${x(t(ort))}</cbc:CityName>` : ''}${t(plz) ? `<cbc:PostalZone>${x(t(plz))}</cbc:PostalZone>` : ''}<cac:Country><cbc:IdentificationCode>${x(land || 'NL')}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`;
  const o = [];
  o.push('<?xml version="1.0" encoding="UTF-8"?>');
  o.push(`<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`);
  o.push('<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID><cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>');
  o.push(`<cbc:ID>${x(k.RECHNUNGNUMMER)}</cbc:ID><cbc:IssueDate>${x(String(k.DATUM).slice(0, 10))}</cbc:IssueDate>`);
  if (!credit && b.due > 0) o.push(`<cbc:DueDate>${x(b.faellig)}</cbc:DueDate>`);
  o.push(`<cbc:${root}TypeCode>${credit ? 381 : 380}</cbc:${root}TypeCode>`);
  const notes = [...NL.mentions(credit ? 'korrektur' : 'rechnung', k, b.lines.map(() => ({ POSART: 'A' }))), ...[k.EINLEITUNGTXT, k.SCHLUSSTXT].filter(s => s && s.trim()).map(s => s.trim())];
  if (notes.length) o.push(`<cbc:Note>${x(notes.join('\n'))}</cbc:Note>`);
  o.push('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>');
  o.push(`<cbc:BuyerReference>${x(kunde.LEITWEGID || k.BESTELLNR || k.KUNNUMMER || k.RECHNUNGNUMMER)}</cbc:BuyerReference>`);
  if (k.BESTELLNR) o.push(`<cac:OrderReference><cbc:ID>${x(k.BESTELLNR)}</cbc:ID></cac:OrderReference>`);
  if (b.orig) o.push(`<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${x(b.orig.RECHNUNGNUMMER)}</cbc:ID><cbc:IssueDate>${x(String(b.orig.DATUM).slice(0, 10))}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>`);
  // supplier
  o.push(`<cac:AccountingSupplierParty><cac:Party>${seller ? `<cbc:EndpointID schemeID="${seller.scheme}">${x(seller.id)}</cbc:EndpointID>` : ''}<cac:PartyName><cbc:Name>${x(f.FIRMENNAME)}</cbc:Name></cac:PartyName>${addr(f.STRASSE, f.PLZ, f.ORT, f.LAND || 'NL')}`);
  if (NL.btw()) o.push(`<cac:PartyTaxScheme><cbc:CompanyID>${x(NL.btw())}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  o.push(`<cac:PartyLegalEntity><cbc:RegistrationName>${x(f.FIRMENNAME)}</cbc:RegistrationName>${NL.kvk() ? `<cbc:CompanyID schemeID="0106">${NL.kvk()}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity>`);
  // Peppol forbids empty elements: the contact only with telephone or e-mail
  o.push(`${f.TELEFON || f.EMAIL ? `<cac:Contact>${f.TELEFON ? `<cbc:Telephone>${x(f.TELEFON)}</cbc:Telephone>` : ''}${f.EMAIL ? `<cbc:ElectronicMail>${x(f.EMAIL)}</cbc:ElectronicMail>` : ''}</cac:Contact>` : ''}</cac:Party></cac:AccountingSupplierParty>`);
  // customer
  o.push(`<cac:AccountingCustomerParty><cac:Party>${buyer ? `<cbc:EndpointID schemeID="${buyer.scheme}">${x(buyer.id)}</cbc:EndpointID>` : ''}${k.KUNNUMMER ? `<cac:PartyIdentification><cbc:ID>${x(k.KUNNUMMER)}</cbc:ID></cac:PartyIdentification>` : ''}<cac:PartyName><cbc:Name>${x(buyerName)}</cbc:Name></cac:PartyName>${addr(k.KUNSTRASSE, k.KUNPLZ, k.KUNORT, k.KUNLAND || 'NL')}`);
  if (kunde.USTID) o.push(`<cac:PartyTaxScheme><cbc:CompanyID>${x(String(kunde.USTID).replace(/\s/g, '').toUpperCase())}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  o.push(`<cac:PartyLegalEntity><cbc:RegistrationName>${x(buyerName)}</cbc:RegistrationName>${buyerLegal ? `<cbc:CompanyID schemeID="${buyerLegal.scheme}">${buyerLegal.id}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>`);
  o.push(`<cac:Delivery><cbc:ActualDeliveryDate>${x(String(k.LIEFDATUM || k.DATUM).slice(0, 10))}</cbc:ActualDeliveryDate>${b.taxes.some(g => g.cat === 'K' || g.cat === 'G') ? `<cac:DeliveryLocation><cac:Address><cac:Country><cbc:IdentificationCode>${x(k.KUNLAND || 'NL')}</cbc:IdentificationCode></cac:Country></cac:Address></cac:DeliveryLocation>` : ''}</cac:Delivery>`);
  // credit transfer (30) with IBAN
  o.push(`<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentID>${x(k.RECHNUNGNUMMER)}</cbc:PaymentID>${f.IBAN ? `<cac:PayeeFinancialAccount><cbc:ID>${x(String(f.IBAN).replace(/\s/g, ''))}</cbc:ID>${f.BANKINHABER ? `<cbc:Name>${x(f.BANKINHABER)}</cbc:Name>` : ''}${f.BIC ? `<cac:FinancialInstitutionBranch><cbc:ID>${x(String(f.BIC).replace(/\s/g, ''))}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}</cac:PayeeFinancialAccount>` : ''}</cac:PaymentMeans>`);
  if (!credit) o.push(`<cac:PaymentTerms><cbc:Note>${x(k.ZAHLBDTEXT || `Te betalen voor ${b.faellig}`)}</cbc:Note></cac:PaymentTerms>`);
  o.push(`<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${a2(b.taxTotal)}</cbc:TaxAmount>`);
  for (const g of b.taxes) {
    const r = g.cat === 'S' ? null : reden(g);
    o.push(`<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${a2(g.basis)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">${a2(g.tax)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${g.cat}</cbc:ID><cbc:Percent>${a2(g.rate)}</cbc:Percent>${r && r.code ? `<cbc:TaxExemptionReasonCode>${r.code}</cbc:TaxExemptionReasonCode>` : ''}${r ? `<cbc:TaxExemptionReason>${x(r.text)}</cbc:TaxExemptionReason>` : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`);
  }
  o.push('</cac:TaxTotal>');
  o.push(`<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">${a2(b.lineTotal)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">${a2(b.lineTotal)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">${a2(b.grand)}</cbc:TaxInclusiveAmount>${b.prepaid ? `<cbc:PrepaidAmount currencyID="EUR">${a2(b.prepaid)}</cbc:PrepaidAmount>` : ''}${b.rounding ? `<cbc:PayableRoundingAmount currencyID="EUR">${a2(b.rounding)}</cbc:PayableRoundingAmount>` : ''}<cbc:PayableAmount currencyID="EUR">${a2(b.due)}</cbc:PayableAmount></cac:LegalMonetaryTotal>`);
  const lineTag = credit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
  for (const l of b.lines) {
    o.push(`<cac:${lineTag}><cbc:ID>${l.id}</cbc:ID><cbc:${qtyTag} unitCode="${x(l.unit)}">${a4(l.qty)}</cbc:${qtyTag}><cbc:LineExtensionAmount currencyID="EUR">${a2(l.total)}</cbc:LineExtensionAmount>`);
    o.push(`<cac:Item>${l.desc ? `<cbc:Description>${x(l.desc)}</cbc:Description>` : ''}<cbc:Name>${x(l.name)}</cbc:Name>${l.artnr ? `<cac:SellersItemIdentification><cbc:ID>${x(l.artnr)}</cbc:ID></cac:SellersItemIdentification>` : ''}<cac:ClassifiedTaxCategory><cbc:ID>${l.cat}</cbc:ID><cbc:Percent>${a2(l.rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>`);
    o.push(`<cac:Price><cbc:PriceAmount currencyID="EUR">${a4(l.price)}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`);
  }
  o.push(`</${root}>`);
  return { xml: o.join('\n'), problems: [...new Set(problems)], filename: `Peppol_${String(k.RECHNUNGNUMMER).replace(/[^\w-]/g, '_')}.xml` };
}

module.exports = { create, endpoint };
