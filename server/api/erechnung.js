'use strict';
// XRechnung 3.0 (EN 16931) in CII and UBL syntax
const L = require('../lib');

const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a2 = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const a4 = n => (Math.round((Number(n) || 0) * 10000) / 10000).toFixed(4).replace(/0{1,2}$/, '');
const d8 = iso => (iso || L.today()).slice(0, 10).replace(/-/g, '');

const STEUERARTEN = {
  REVERSE_CHARGE: { cat: 'AE', code: 'VATEX-EU-AE', text: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG / Art. 196 MwStSystRL)' },
  IG_LIEFERUNG: { cat: 'K', code: 'VATEX-EU-IC', text: 'Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b i. V. m. § 6a UStG)' },
  AUSFUHR: { cat: 'G', code: 'VATEX-EU-G', text: 'Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1a i. V. m. § 6 UStG)' },
};

function build(rid) {
  const d = L.db();
  const k = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  if (!k) throw new L.HttpError(404, 'Rechnung nicht gefunden');
  const pos = d.prepare("SELECT p.*, e.UNECE, e.BEZEICHNUNG EINHEIT FROM RECHNUNGEN_POS p LEFT JOIN EINHEITEN e ON e.EINHEITID=p.EINHEITID WHERE RECHNUNGID=? ORDER BY PRTSORT").all(rid);
  const kunde = k.KUNID ? d.prepare('SELECT * FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {};
  const f = L.firma();
  const zb = k.ZAHLBDID ? d.prepare('SELECT * FROM ZAHLUNGSBEDINUNGEN WHERE ZAHLBDID=?').get(k.ZAHLBDID) : null;
  const paid = d.prepare('SELECT COALESCE(SUM(BETRAG),0) s FROM ZAHLUNGSEINGAENGE WHERE RECHNUNGID=? AND ZAHLUNGSARTID<>6').get(rid).s;
  const rates = L.mwstRates();
  const klein = L.optNum('Kleinunternehmer', 0) === 1;
  const credit = k.TYP === 2;
  const sign = credit ? -1 : 1;
  const problems = [];

  const lines = [];
  for (const p of pos) {
    if (p.POSART === 'T' || p.POSART === 'Z') continue;
    const dp = Number(p.DURCHLAUFER) === 1;
    const rate = dp ? 0 : (rates[p.MWST] ?? 0);
    let cat = 'S', reason = null, rcode = null;
    const sa = STEUERARTEN[k.STEUERART];
    if (sa) { cat = sa.cat; reason = sa.text; rcode = sa.code; }
    else if (Number(p.DIFFSTEUER) === 1) { cat = 'E'; reason = 'Differenzbesteuerung nach § 25a UStG'; rcode = 'VATEX-EU-F'; }
    else if (klein) { cat = 'E'; reason = 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG'; }
    else if (dp) { cat = 'E'; reason = 'Durchlaufender Posten gemäß § 10 Abs. 1 Satz 6 UStG'; }
    else if (rate === 0) { cat = 'E'; reason = 'Steuerfreie Leistung'; }
    const qty = sign * (Number(p.MENGE) || 0); void rcode;
    const net = Number(p.VK || 0) * (1 - (Number(p.RABATT) || 0) / 100);
    const lineTotal = Math.round(qty * net * 100) / 100;
    lines.push({
      id: lines.length + 1,
      name: (p.BEZEICHNUNG || p.BESCHREIBUNG || p.ARTNUMMER || 'Position').slice(0, 200),
      desc: [p.BEZEICHNUNG ? p.BESCHREIBUNG : null, p.ARBEITSTEXT, p.MEMOTEXT].filter(Boolean).join('\n').slice(0, 1000),
      artnr: p.ARTNUMMER, qty, unit: p.UNECE || 'C62', price: net, total: lineTotal, service: p.POSART === 'L', cat, rate: cat === 'S' ? rate : 0, reason, rcode,
    });
  }
  // tax breakdown
  const groups = {};
  for (const l of lines) {
    const key = l.cat + '|' + l.rate;
    const g = groups[key] || (groups[key] = { cat: l.cat, rate: l.rate, basis: 0, reason: l.reason, rcode: l.rcode });
    g.basis += l.total;
  }
  const taxes = Object.values(groups).map(g => ({ ...g, basis: Math.round(g.basis * 100) / 100, tax: Math.round(g.basis * g.rate) / 100 }));
  const lineTotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
  const taxTotal = Math.round(taxes.reduce((s, t) => s + t.tax, 0) * 100) / 100;
  const grand = Math.round((lineTotal + taxTotal) * 100) / 100;
  const printed = Math.round(sign * k.GBRUTTO * 100) / 100;
  const rounding = Math.round((printed - grand) * 100) / 100;
  const prepaid = Math.round(sign * paid * 100) / 100;
  const due = Math.round((grand + rounding - prepaid) * 100) / 100;

  // check mandatory fields
  if (!f.FIRMENNAME) problems.push('Firmenname fehlt (Einstellungen → Firmendaten)');
  if (!f.STRASSE || !f.PLZ || !f.ORT) problems.push('Firmenanschrift unvollständig');
  if (!f.USTNR && !f.STEUERNR) problems.push('USt-IdNr. oder Steuernummer der Firma fehlt');
  if (!f.EMAIL) problems.push('E-Mail-Adresse der Firma fehlt (elektronische Adresse BT-34)');
  if (!f.TELEFON) problems.push('Telefonnummer der Firma fehlt (Kontakt BT-42)');
  if (!f.IBAN) problems.push('IBAN der Firma fehlt (Zahlungsanweisung)');
  if (!k.KUNNAME) problems.push('Kundenname fehlt');
  if (!String(k.KUNORT || '').trim() || !String(k.KUNPLZ || '').trim()) problems.push('Kundenanschrift unvollständig (PLZ und Ort sind Pflicht)');
  if (!kunde.EMAILRECHNUNG && !kunde.EMAIL) problems.push('E-Mail-Adresse des Kunden fehlt (elektronische Adresse BT-49)');
  if (!lines.length) problems.push('Keine Rechnungspositionen');
  const fr = L.land() === 'FR';
  if (fr && !require('../fr').siren()) problems.push('SIRET der Firma fehlt oder ist ungültig (Einstellungen → Firmendaten → Steuernummer)');
  if (fr && (Number(k.KUNART) === 1 || kunde.USTID) && !require('../../public/js/nif.js').frSiren(kunde.SIREN).ok) problems.push('SIREN/SIRET des Kunden fehlt (Pflicht für Geschäftskunden ab der E-Rechnungsreform)');
  if ((k.STEUERART === 'REVERSE_CHARGE' || k.STEUERART === 'IG_LIEFERUNG') && !kunde.USTID) problems.push('USt-IdNr. des Kunden fehlt (Pflicht bei Reverse Charge / innergemeinschaftlicher Lieferung)');

  const orig = k.REIDGUTSCHRIFT > 0 ? d.prepare('SELECT RECHNUNGNUMMER, DATUM FROM RECHNUNGEN WHERE RECHNUNGID=?').get(k.REIDGUTSCHRIFT) : null;
  const faellig = L.addDays(k.DATUM, k.FAELLING || 0);
  const notes = [k.EINLEITUNGTXT, k.SCHLUSSTXT].filter(s => s && s.trim()).map(s => s.trim());
  if (klein && L.land() === 'DE') notes.push('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
  return {
    k, f, kunde, zb, lines, taxes, lineTotal, taxTotal, grand, rounding, prepaid, due, credit, orig, faellig, notes, problems,
    buyerRef: kunde.LEITWEGID || String(k.KUNNUMMER || k.RECHNUNGNUMMER),
    payCode: (zb && zb.ERECHCODE) || '58',
    buyerMail: kunde.EMAILRECHNUNG || kunde.EMAIL || '',
    sellerTaxId: f.USTNR ? String(f.USTNR).replace(/\s/g, '') : null,
    sellerTaxNo: L.land() === 'FR' ? null : (f.STEUERNR || null),
  };
}

function addrCii(name, street, plz, ort, land) {
  const t = v => String(v || '').trim();
  return `<ram:PostalTradeAddress>${t(plz) ? `<ram:PostcodeCode>${x(t(plz))}</ram:PostcodeCode>` : ''}${t(street) ? `<ram:LineOne>${x(t(street))}</ram:LineOne>` : ''}${t(ort) ? `<ram:CityName>${x(t(ort))}</ram:CityName>` : ''}<ram:CountryID>${x(land || 'DE')}</ram:CountryID></ram:PostalTradeAddress>`;
}

function cii(rid) {
  const b = build(rid); const { k, f } = b;
  const buyerName = [k.KUNNAME, k.KUNVORNAME].filter(Boolean).join(', ');
  // France: Factur-X profile EN 16931, BT-23 = kind of operations (B1 goods, S1 services, M1 mixed), SIREN/SIRET
  const fr = L.land() === 'FR';
  const FR = fr ? require('../fr') : null; const NIFJ = require('../../public/js/nif.js');
  const nature = fr ? (b.lines.some(l => l.service) && b.lines.some(l => !l.service) ? 'M1' : b.lines.some(l => l.service) ? 'S1' : 'B1') : null;
  const sirenAch = fr ? NIFJ.frSiren(b.kunde.SIREN) : { ok: false };
  const o = [];
  o.push('<?xml version="1.0" encoding="UTF-8"?>');
  o.push('<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">');
  if (fr) o.push(`<rsm:ExchangedDocumentContext><ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${nature}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>`);
  else o.push('<rsm:ExchangedDocumentContext><ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>');
  o.push(`<rsm:ExchangedDocument><ram:ID>${x(k.RECHNUNGNUMMER)}</ram:ID><ram:TypeCode>${b.credit ? 381 : 380}</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${d8(k.DATUM)}</udt:DateTimeString></ram:IssueDateTime>`);
  for (const n of b.notes) o.push(`<ram:IncludedNote><ram:Content>${x(n)}</ram:Content></ram:IncludedNote>`);
  if (fr) {
    // mandatory notes: penalties (PMD), recovery indemnity (PMT), discount (AAB)
    const pro = Number(k.KUNART) === 1 || sirenAch.ok || !!b.kunde.USTID;
    const notas = [['AAB', L.sw('fr.escompte', FR.ESCOMPTE)], ['PMD', L.sw('fr.penalites', FR.PENALITES)], ['PMT', pro ? 'Indemnité forfaitaire pour frais de recouvrement : 40 € (art. L441-10 du Code de commerce).' : 'Indemnité forfaitaire pour frais de recouvrement : non applicable (client particulier).']];
    for (const [c, t] of notas) o.push(`<ram:IncludedNote><ram:Content>${x(t)}</ram:Content><ram:SubjectCode>${c}</ram:SubjectCode></ram:IncludedNote>`);
    for (const m of FR.mentions(b.credit ? 'korrektur' : 'rechnung', k, b.lines.map(l => ({ POSART: l.service ? 'L' : 'A' })), b.kunde).filter(m => !/escompte|pénalités|Indemnité/.test(m))) o.push(`<ram:IncludedNote><ram:Content>${x(m)}</ram:Content><ram:SubjectCode>TXD</ram:SubjectCode></ram:IncludedNote>`);
  }
  o.push('</rsm:ExchangedDocument><rsm:SupplyChainTradeTransaction>');
  for (const l of b.lines) {
    o.push(`<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${l.id}</ram:LineID></ram:AssociatedDocumentLineDocument>`);
    o.push(`<ram:SpecifiedTradeProduct>${l.artnr ? `<ram:SellerAssignedID>${x(l.artnr)}</ram:SellerAssignedID>` : ''}<ram:Name>${x(l.name)}</ram:Name>${l.desc ? `<ram:Description>${x(l.desc)}</ram:Description>` : ''}</ram:SpecifiedTradeProduct>`);
    o.push(`<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${a4(l.price)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>`);
    o.push(`<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${x(l.unit)}">${a4(l.qty)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`);
    o.push(`<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${l.cat}</ram:CategoryCode><ram:RateApplicablePercent>${a2(l.rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${a2(l.total)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>`);
    o.push('</ram:IncludedSupplyChainTradeLineItem>');
  }
  // Agreement
  o.push(`<ram:ApplicableHeaderTradeAgreement><ram:BuyerReference>${x(b.buyerRef)}</ram:BuyerReference>`);
  o.push(`<ram:SellerTradeParty><ram:Name>${x(f.FIRMENNAME)}</ram:Name>`);
  if (f.HANDELSREGISTER) o.push(`<ram:Description>${x(f.HANDELSREGISTER)}</ram:Description>`);
  if (fr && FR.siren()) o.push(`<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${FR.siren()}</ram:ID>${L.sw('fr.forme', '') ? `<ram:TradingBusinessName>${x(f.FIRMENNAME)}</ram:TradingBusinessName>` : ''}</ram:SpecifiedLegalOrganization>`);
  o.push(`<ram:DefinedTradeContact><ram:PersonName>${x(f.BANKINHABER || f.GESCHAEFTSFUEHRER || f.FIRMENNAME)}</ram:PersonName><ram:TelephoneUniversalCommunication><ram:CompleteNumber>${x(f.TELEFON)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication><ram:EmailURIUniversalCommunication><ram:URIID>${x(f.EMAIL)}</ram:URIID></ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>`);
  o.push(addrCii(f.FIRMENNAME, f.STRASSE, f.PLZ, f.ORT, f.LAND));
  o.push(`<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(f.EMAIL)}</ram:URIID></ram:URIUniversalCommunication>`);
  if (b.sellerTaxId) o.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(b.sellerTaxId)}</ram:ID></ram:SpecifiedTaxRegistration>`);
  if (b.sellerTaxNo) o.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(b.sellerTaxNo)}</ram:ID></ram:SpecifiedTaxRegistration>`);
  o.push('</ram:SellerTradeParty>');
  o.push(`<ram:BuyerTradeParty>${k.KUNNUMMER ? `<ram:ID>${x(k.KUNNUMMER)}</ram:ID>` : ''}<ram:Name>${x(buyerName)}</ram:Name>`);
  if (sirenAch.ok) o.push(`<ram:SpecifiedLegalOrganization><ram:ID schemeID="${sirenAch.num.length === 14 ? '0009' : '0002'}">${sirenAch.num}</ram:ID></ram:SpecifiedLegalOrganization>`);
  o.push(addrCii(buyerName, k.KUNSTRASSE, k.KUNPLZ, k.KUNORT, k.KUNLAND));
  if (b.buyerMail) o.push(`<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(b.buyerMail)}</ram:URIID></ram:URIUniversalCommunication>`);
  if (b.kunde.USTID) o.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(String(b.kunde.USTID).replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>`);
  o.push('</ram:BuyerTradeParty>');
  if (k.BESTELLNR) o.push(`<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${x(k.BESTELLNR)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>`);
  o.push('</ram:ApplicableHeaderTradeAgreement>');
  o.push(`<ram:ApplicableHeaderTradeDelivery>${b.taxes.some(t => t.cat === 'K' || t.cat === 'G') ? `<ram:ShipToTradeParty><ram:Name>${x(buyerName)}</ram:Name><ram:PostalTradeAddress><ram:CountryID>${x(k.KUNLAND || 'DE')}</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty>` : ''}<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${d8(k.LIEFDATUM || k.DATUM)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>`);
  o.push(`<ram:ApplicableHeaderTradeSettlement><ram:PaymentReference>${x(k.RECHNUNGNUMMER)}</ram:PaymentReference><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>`);
  o.push(`<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>${x(b.payCode)}</ram:TypeCode>`);
  if (f.IBAN && ['58', '30', '31', '42'].includes(b.payCode)) {
    o.push(`<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(String(f.IBAN).replace(/\s/g, ''))}</ram:IBANID>${f.BANKINHABER ? `<ram:AccountName>${x(f.BANKINHABER)}</ram:AccountName>` : ''}</ram:PayeePartyCreditorFinancialAccount>`);
    if (f.BIC) o.push(`<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(f.BIC)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>`);
  }
  o.push('</ram:SpecifiedTradeSettlementPaymentMeans>');
  for (const t of b.taxes) {
    o.push(`<ram:ApplicableTradeTax><ram:CalculatedAmount>${a2(t.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${t.reason ? `<ram:ExemptionReason>${x(t.reason)}</ram:ExemptionReason>` : ''}<ram:BasisAmount>${a2(t.basis)}</ram:BasisAmount><ram:CategoryCode>${t.cat}</ram:CategoryCode>${t.rcode ? `<ram:ExemptionReasonCode>${t.rcode}</ram:ExemptionReasonCode>` : ''}<ram:RateApplicablePercent>${a2(t.rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`);
  }
  o.push(`<ram:SpecifiedTradePaymentTerms><ram:Description>${x(k.ZAHLBDTEXT || (fr ? 'Paiement à réception de facture' : 'Zahlbar ohne Abzug'))}</ram:Description>${b.due > 0 ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${d8(b.faellig)}</udt:DateTimeString></ram:DueDateDateTime>` : ''}</ram:SpecifiedTradePaymentTerms>`);
  o.push(`<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${a2(b.lineTotal)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${a2(b.lineTotal)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">${a2(b.taxTotal)}</ram:TaxTotalAmount>${b.rounding ? `<ram:RoundingAmount>${a2(b.rounding)}</ram:RoundingAmount>` : ''}<ram:GrandTotalAmount>${a2(b.grand)}</ram:GrandTotalAmount><ram:TotalPrepaidAmount>${a2(b.prepaid)}</ram:TotalPrepaidAmount><ram:DuePayableAmount>${a2(b.due)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>`);
  if (b.orig) o.push(`<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${x(b.orig.RECHNUNGNUMMER)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d8(b.orig.DATUM)}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>`);
  o.push('</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>');
  return { xml: o.join('\n'), problems: b.problems, nr: k.RECHNUNGNUMMER };
}

function ubl(rid) {
  const b = build(rid); const { k, f } = b;
  const root = b.credit ? 'CreditNote' : 'Invoice';
  const buyerName = [k.KUNNAME, k.KUNVORNAME].filter(Boolean).join(', ');
  const t = v => String(v || '').trim();
  const addr = (street, plz, ort, land) => `<cac:PostalAddress>${t(street) ? `<cbc:StreetName>${x(t(street))}</cbc:StreetName>` : ''}${t(ort) ? `<cbc:CityName>${x(t(ort))}</cbc:CityName>` : ''}${t(plz) ? `<cbc:PostalZone>${x(t(plz))}</cbc:PostalZone>` : ''}<cac:Country><cbc:IdentificationCode>${x(land || 'DE')}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`;
  const o = [];
  o.push('<?xml version="1.0" encoding="UTF-8"?>');
  o.push(`<ubl:${root} xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`);
  o.push('<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID><cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>');
  o.push(`<cbc:ID>${x(k.RECHNUNGNUMMER)}</cbc:ID><cbc:IssueDate>${x(k.DATUM)}</cbc:IssueDate>`);
  if (!b.credit && b.due > 0) o.push(`<cbc:DueDate>${x(b.faellig)}</cbc:DueDate>`);
  o.push(`<cbc:${root}TypeCode>${b.credit ? 381 : 380}</cbc:${root}TypeCode>`);
  for (const n of b.notes) o.push(`<cbc:Note>${x(n)}</cbc:Note>`);
  o.push(`<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode><cbc:BuyerReference>${x(b.buyerRef)}</cbc:BuyerReference>`);
  if (k.BESTELLNR) o.push(`<cac:OrderReference><cbc:ID>${x(k.BESTELLNR)}</cbc:ID></cac:OrderReference>`);
  if (b.orig) o.push(`<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${x(b.orig.RECHNUNGNUMMER)}</cbc:ID><cbc:IssueDate>${x(b.orig.DATUM)}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>`);
  o.push(`<cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="EM">${x(f.EMAIL)}</cbc:EndpointID><cac:PartyName><cbc:Name>${x(f.FIRMENNAME)}</cbc:Name></cac:PartyName>${addr(f.STRASSE, f.PLZ, f.ORT, f.LAND)}`);
  if (b.sellerTaxId) o.push(`<cac:PartyTaxScheme><cbc:CompanyID>${x(b.sellerTaxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  if (b.sellerTaxNo) o.push(`<cac:PartyTaxScheme><cbc:CompanyID>${x(b.sellerTaxNo)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  o.push(`<cac:PartyLegalEntity><cbc:RegistrationName>${x(f.FIRMENNAME)}</cbc:RegistrationName>${f.HANDELSREGISTER ? `<cbc:CompanyLegalForm>${x(f.HANDELSREGISTER)}</cbc:CompanyLegalForm>` : ''}</cac:PartyLegalEntity>`);
  o.push(`<cac:Contact><cbc:Name>${x(f.BANKINHABER || f.GESCHAEFTSFUEHRER || f.FIRMENNAME)}</cbc:Name><cbc:Telephone>${x(f.TELEFON)}</cbc:Telephone><cbc:ElectronicMail>${x(f.EMAIL)}</cbc:ElectronicMail></cac:Contact></cac:Party></cac:AccountingSupplierParty>`);
  o.push(`<cac:AccountingCustomerParty><cac:Party>${b.buyerMail ? `<cbc:EndpointID schemeID="EM">${x(b.buyerMail)}</cbc:EndpointID>` : ''}${k.KUNNUMMER ? `<cac:PartyIdentification><cbc:ID>${x(k.KUNNUMMER)}</cbc:ID></cac:PartyIdentification>` : ''}<cac:PartyName><cbc:Name>${x(buyerName)}</cbc:Name></cac:PartyName>${addr(k.KUNSTRASSE, k.KUNPLZ, k.KUNORT, k.KUNLAND)}`);
  if (b.kunde.USTID) o.push(`<cac:PartyTaxScheme><cbc:CompanyID>${x(String(b.kunde.USTID).replace(/\s/g, ''))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  o.push(`<cac:PartyLegalEntity><cbc:RegistrationName>${x(buyerName)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>`);
  o.push(`<cac:Delivery><cbc:ActualDeliveryDate>${x(k.LIEFDATUM || k.DATUM)}</cbc:ActualDeliveryDate>${b.taxes.some(t => t.cat === 'K' || t.cat === 'G') ? `<cac:DeliveryLocation><cac:Address><cac:Country><cbc:IdentificationCode>${x(k.KUNLAND || 'DE')}</cbc:IdentificationCode></cac:Country></cac:Address></cac:DeliveryLocation>` : ''}</cac:Delivery>`);
  o.push(`<cac:PaymentMeans><cbc:PaymentMeansCode>${x(b.payCode)}</cbc:PaymentMeansCode><cbc:PaymentID>${x(k.RECHNUNGNUMMER)}</cbc:PaymentID>`);
  if (f.IBAN && ['58', '30', '31', '42'].includes(b.payCode)) o.push(`<cac:PayeeFinancialAccount><cbc:ID>${x(String(f.IBAN).replace(/\s/g, ''))}</cbc:ID>${f.BANKINHABER ? `<cbc:Name>${x(f.BANKINHABER)}</cbc:Name>` : ''}${f.BIC ? `<cac:FinancialInstitutionBranch><cbc:ID>${x(f.BIC)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}</cac:PayeeFinancialAccount>`);
  o.push('</cac:PaymentMeans>');
  o.push(`<cac:PaymentTerms><cbc:Note>${x(k.ZAHLBDTEXT || 'Zahlbar ohne Abzug')}</cbc:Note></cac:PaymentTerms>`);
  o.push(`<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${a2(b.taxTotal)}</cbc:TaxAmount>`);
  for (const t of b.taxes) o.push(`<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${a2(t.basis)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">${a2(t.tax)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${t.cat}</cbc:ID><cbc:Percent>${a2(t.rate)}</cbc:Percent>${t.rcode ? `<cbc:TaxExemptionReasonCode>${t.rcode}</cbc:TaxExemptionReasonCode>` : ''}${t.reason ? `<cbc:TaxExemptionReason>${x(t.reason)}</cbc:TaxExemptionReason>` : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`);
  o.push('</cac:TaxTotal>');
  o.push(`<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">${a2(b.lineTotal)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">${a2(b.lineTotal)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">${a2(b.grand)}</cbc:TaxInclusiveAmount><cbc:PrepaidAmount currencyID="EUR">${a2(b.prepaid)}</cbc:PrepaidAmount>${b.rounding ? `<cbc:PayableRoundingAmount currencyID="EUR">${a2(b.rounding)}</cbc:PayableRoundingAmount>` : ''}<cbc:PayableAmount currencyID="EUR">${a2(b.due)}</cbc:PayableAmount></cac:LegalMonetaryTotal>`);
  const lineTag = b.credit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = b.credit ? 'CreditedQuantity' : 'InvoicedQuantity';
  for (const l of b.lines) {
    o.push(`<cac:${lineTag}><cbc:ID>${l.id}</cbc:ID><cbc:${qtyTag} unitCode="${x(l.unit)}">${a4(l.qty)}</cbc:${qtyTag}><cbc:LineExtensionAmount currencyID="EUR">${a2(l.total)}</cbc:LineExtensionAmount>`);
    o.push(`<cac:Item>${l.desc ? `<cbc:Description>${x(l.desc)}</cbc:Description>` : ''}<cbc:Name>${x(l.name)}</cbc:Name>${l.artnr ? `<cac:SellersItemIdentification><cbc:ID>${x(l.artnr)}</cbc:ID></cac:SellersItemIdentification>` : ''}<cac:ClassifiedTaxCategory><cbc:ID>${l.cat}</cbc:ID><cbc:Percent>${a2(l.rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>`);
    o.push(`<cac:Price><cbc:PriceAmount currencyID="EUR">${a4(l.price)}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`);
  }
  o.push(`</ubl:${root}>`);
  return { xml: o.join('\n'), problems: b.problems, nr: k.RECHNUNGNUMMER };
}

function create(rid, format) {
  const res = format === 'ubl' ? ubl(rid) : cii(rid);
  L.db().prepare('UPDATE RECHNUNGEN SET ERECHNUNGERSTELLT=? WHERE RECHNUNGID=?').run(L.now(), rid);
  return res;
}

module.exports = { create, build, STEUERARTEN };
