'use strict';
// Facturae 3.2.2: Spanish e-invoice for public administrations (FACe). Kuenta creates the XML without a
// signature; sign it with AutoFirma (XAdES) before uploading it to FACe.
// DIR3 codes of the administration: customer field "Leitweg-ID" as "office/body/unit" (oficina contable /
// órgano gestor / unidad tramitadora), e.g. L01280796/L01280796/L01280796.
const L = require('../lib');
const ES = require('./index');
const NIF = require('../../public/js/nif.js');

const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a2 = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const a6 = n => (Math.round((Number(n) || 0) * 1e6) / 1e6).toFixed(6);
const iso = s => String(s || L.today()).slice(0, 10);
const ISO3 = { ES: 'ESP', DE: 'DEU', FR: 'FRA', PT: 'PRT', IT: 'ITA', AT: 'AUT', NL: 'NLD', BE: 'BEL', LU: 'LUX', CH: 'CHE', PL: 'POL', GB: 'GBR', DK: 'DNK', CZ: 'CZE' };

function party(p) {
  const persona = /^[0-9XYZKLM]/.test(p.nif) ? 'F' : 'J';
  const residente = !p.pais || p.pais === 'ES';
  let s = `<TaxIdentification><PersonTypeCode>${persona}</PersonTypeCode><ResidenceTypeCode>${residente ? 'R' : 'U'}</ResidenceTypeCode><TaxIdentificationNumber>${x(p.nif)}</TaxIdentificationNumber></TaxIdentification>`;
  const addr = residente
    ? `<AddressInSpain><Address>${x(p.calle)}</Address><PostCode>${x(p.cp)}</PostCode><Town>${x(p.ciudad)}</Town><Province>${x(p.provincia || p.ciudad)}</Province><CountryCode>ESP</CountryCode></AddressInSpain>`
    : `<OverseasAddress><Address>${x(p.calle)}</Address><PostCodeAndTown>${x([p.cp, p.ciudad].filter(Boolean).join(' '))}</PostCodeAndTown><Province>${x(p.provincia || p.ciudad)}</Province><CountryCode>${ISO3[p.pais] || 'ESP'}</CountryCode></OverseasAddress>`;
  if (p.dir3 && p.dir3.length) {
    s += '<AdministrativeCentres>' + p.dir3.map((c, i) => `<AdministrativeCentre><CentreCode>${x(c)}</CentreCode><RoleTypeCode>0${i + 1}</RoleTypeCode>${addr}</AdministrativeCentre>`).join('') + '</AdministrativeCentres>';
  }
  if (persona === 'J') s += `<LegalEntity><CorporateName>${x(p.nombre)}</CorporateName>${addr}</LegalEntity>`;
  else {
    const partes = String(p.apellidos || '').trim().split(/\s+/);
    s += `<Individual><Name>${x(p.nombrePila || p.nombre)}</Name><FirstSurname>${x(partes[0] || p.nombre)}</FirstSurname>${partes[1] ? `<SecondSurname>${x(partes.slice(1).join(' '))}</SecondSurname>` : ''}${addr}</Individual>`;
  }
  return s;
}

function create(rid) {
  const d = L.db(); const VG = require('../api/vorgang');
  const typ = (d.prepare('SELECT TYP FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid) || {}).TYP === 2 ? 'korrektur' : 'rechnung';
  const doc = VG.load(typ, rid); const k = doc.kopf;
  const f = L.firma(); const kunde = k.KUNID ? d.prepare('SELECT * FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {};
  const problems = [];
  const nifE = ES.nifEmisor(); if (!nifE) problems.push('NIF der eigenen Firma fehlt (Einstellungen → Firmendaten → Steuernummer).');
  const nk = NIF.validar(kunde.USTID); if (!nk.ok) problems.push('NIF des Kunden fehlt oder ist ungültig.');
  const dir3 = String(kunde.LEITWEGID || '').split(/[/;,\s]+/).filter(Boolean).slice(0, 3);
  if (dir3.length !== 3) problems.push('DIR3-Codes der Behörde fehlen: im Kunden im Feld Leitweg-ID als Oficina contable/Órgano gestor/Unidad tramitadora eintragen.');
  if (!/^\d{5}$/.test(String(f.PLZ || ''))) problems.push('Postleitzahl der Firma muss fünfstellig sein.');
  const ns = ES.numSerie(k); const serie = ES.serie(k.TYP); const nr = ns.startsWith(serie) ? ns.slice(serie.length) : String(k.RECHNUNGNUMMER);
  const sign = 1;
  const taxes = Object.values(doc.tax || {});
  const total = Number(k.GBRUTTO) || 0;
  const bruto = L.r2(taxes.reduce((s, g) => s + g.netto, 0));
  const cuotas = L.r2(taxes.reduce((s, g) => s + g.mwst + (g.recargo || 0), 0));
  const taxXml = g => `<Tax><TaxTypeCode>01</TaxTypeCode><TaxRate>${a2(g.rate)}</TaxRate><TaxableBase><TotalAmount>${a2(sign * g.netto)}</TotalAmount></TaxableBase><TaxAmount><TotalAmount>${a2(sign * g.mwst)}</TotalAmount></TaxAmount>${g.reRate ? `<EquivalenceSurcharge>${a2(g.reRate)}</EquivalenceSurcharge><EquivalenceSurchargeAmount><TotalAmount>${a2(g.recargo)}</TotalAmount></EquivalenceSurchargeAmount>` : ''}</Tax>`;
  const rates = L.mwstRates();
  const lines = doc.pos.filter(p => p.POSART !== 'T' && p.POSART !== 'Z').map(p => {
    const rate = Number(p.DURCHLAUFER) === 1 || k.STEUERART ? 0 : (rates[Number(p.MWST) || 61] ?? 0);
    const qty = Number(p.MENGE) || 0; const unit = Number(p.VK) || 0; const cost = qty * unit; const gross = Number(p.SUMME) || 0;
    const rab = cost - gross;
    return `<InvoiceLine><ItemDescription>${x([p.BEZEICHNUNG || p.BESCHREIBUNG || 'Concepto', p.BEZEICHNUNG ? p.BESCHREIBUNG : ''].filter(Boolean).join(' – ').slice(0, 2500))}</ItemDescription>` +
      `<Quantity>${qty}</Quantity><UnitOfMeasure>01</UnitOfMeasure><UnitPriceWithoutTax>${a6(unit)}</UnitPriceWithoutTax><TotalCost>${a6(cost)}</TotalCost>` +
      (Math.abs(rab) > 0.000001 ? `<DiscountsAndRebates><Discount><DiscountReason>Descuento</DiscountReason><DiscountRate>${a2(p.RABATT)}</DiscountRate><DiscountAmount>${a6(rab)}</DiscountAmount></Discount></DiscountsAndRebates>` : '') +
      `<GrossAmount>${a6(gross)}</GrossAmount><TaxesOutputs><Tax><TaxTypeCode>01</TaxTypeCode><TaxRate>${a2(rate)}</TaxRate><TaxableBase><TotalAmount>${a2(gross)}</TotalAmount></TaxableBase><TaxAmount><TotalAmount>${a2(gross * rate / 100)}</TotalAmount></TaxAmount></Tax></TaxesOutputs>` +
      (p.ARTNUMMER ? `<ArticleCode>${x(String(p.ARTNUMMER).slice(0, 20))}</ArticleCode>` : '') + '</InvoiceLine>';
  });
  let corrective = '';
  if (k.TYP === 2 && doc.es && doc.es.rectificada) {
    const o = doc.es.rectificada; const os = ES.serie(1); const onr = o.numSerie.startsWith(os) ? o.numSerie.slice(os.length) : o.numSerie;
    corrective = `<Corrective><InvoiceNumber>${x(onr)}</InvoiceNumber><InvoiceSeriesCode>${x(os)}</InvoiceSeriesCode><ReasonCode>16</ReasonCode><ReasonDescription>Base imponible</ReasonDescription>` +
      `<TaxPeriod><StartDate>${iso(o.fecha)}</StartDate><EndDate>${iso(k.DATUM)}</EndDate></TaxPeriod><CorrectionMethod>02</CorrectionMethod><CorrectionMethodDescription>Rectificación por diferencias</CorrectionMethodDescription></Corrective>`;
  }
  const due = L.addDays(iso(k.DATUM), k.FAELLING || 0);
  const pago = `<PaymentDetails><Installment><InstallmentDueDate>${due}</InstallmentDueDate><InstallmentAmount>${a2(total)}</InstallmentAmount><PaymentMeans>${f.IBAN ? '04' : '01'}</PaymentMeans>${f.IBAN ? `<AccountToBeCredited><IBAN>${x(String(f.IBAN).replace(/\s/g, ''))}</IBAN></AccountToBeCredited>` : ''}</Installment></PaymentDetails>`;
  const seller = party({ nif: nifE, nombre: f.FIRMENNAME, calle: f.STRASSE, cp: f.PLZ, ciudad: f.ORT, pais: (f.LAND || 'ES').toUpperCase() });
  const esEmpresa = Number(k.KUNART) === 1 || !k.KUNVORNAME;
  const buyer = party({ nif: nk.ok ? nk.nif : String(kunde.USTID || ''), nombre: esEmpresa ? k.KUNNAME : [k.KUNVORNAME, k.KUNNAME].filter(Boolean).join(' '), nombrePila: k.KUNVORNAME, apellidos: k.KUNNAME, calle: k.KUNSTRASSE, cp: k.KUNPLZ, ciudad: k.KUNORT, pais: (k.KUNLAND || 'ES').toUpperCase(), dir3 });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<fe:Facturae xmlns:fe="http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
    `<FileHeader><SchemaVersion>3.2.2</SchemaVersion><Modality>I</Modality><InvoiceIssuerType>EM</InvoiceIssuerType><Batch><BatchIdentifier>${x(nifE + ns)}</BatchIdentifier><InvoicesCount>1</InvoicesCount>` +
    `<TotalInvoicesAmount><TotalAmount>${a2(total)}</TotalAmount></TotalInvoicesAmount><TotalOutstandingAmount><TotalAmount>${a2(total)}</TotalAmount></TotalOutstandingAmount><TotalExecutableAmount><TotalAmount>${a2(total)}</TotalAmount></TotalExecutableAmount><InvoiceCurrencyCode>EUR</InvoiceCurrencyCode></Batch></FileHeader>` +
    `<Parties><SellerParty>${seller}</SellerParty><BuyerParty>${buyer}</BuyerParty></Parties>` +
    `<Invoices><Invoice><InvoiceHeader><InvoiceNumber>${x(nr)}</InvoiceNumber><InvoiceSeriesCode>${x(serie)}</InvoiceSeriesCode><InvoiceDocumentType>FC</InvoiceDocumentType><InvoiceClass>${k.TYP === 2 ? 'OR' : 'OO'}</InvoiceClass>${corrective}</InvoiceHeader>` +
    `<InvoiceIssueData><IssueDate>${iso(k.DATUM)}</IssueDate>${k.LIEFDATUM && iso(k.LIEFDATUM) !== iso(k.DATUM) ? `<OperationDate>${iso(k.LIEFDATUM)}</OperationDate>` : ''}<InvoiceCurrencyCode>EUR</InvoiceCurrencyCode><TaxCurrencyCode>EUR</TaxCurrencyCode><LanguageName>es</LanguageName></InvoiceIssueData>` +
    `<TaxesOutputs>${taxes.map(taxXml).join('')}</TaxesOutputs>` +
    `<InvoiceTotals><TotalGrossAmount>${a2(bruto)}</TotalGrossAmount><TotalGeneralDiscounts>0.00</TotalGeneralDiscounts><TotalGeneralSurcharges>0.00</TotalGeneralSurcharges><TotalGrossAmountBeforeTaxes>${a2(bruto)}</TotalGrossAmountBeforeTaxes>` +
    `<TotalTaxOutputs>${a2(cuotas)}</TotalTaxOutputs><TotalTaxesWithheld>0.00</TotalTaxesWithheld><InvoiceTotal>${a2(total)}</InvoiceTotal><TotalOutstandingAmount>${a2(total)}</TotalOutstandingAmount><TotalExecutableAmount>${a2(total)}</TotalExecutableAmount></InvoiceTotals>` +
    `<Items>${lines.join('')}</Items>${pago}</Invoice></Invoices></fe:Facturae>`;
  return { xml, problems, nr: ns };
}

module.exports = { create };
