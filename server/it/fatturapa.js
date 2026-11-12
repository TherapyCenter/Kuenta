'use strict';
// FatturaPA 1.2.2 (fattura elettronica) for the Sistema di Interscambio (SdI): FPR12 for businesses and consumers,
// FPA12 for public bodies (6-character codice ufficio). Credit notes as TD04 with the invoice they correct.
// The file is named IT<codice fiscale>_<progressivo>.xml and is sent to the SdI by the user (portal "Fatture e
// Corrispettivi", PEC or an intermediary); KuentaPOS does not transmit it itself.
// Only characters of Basic Latin and Latin-1 are allowed in the file.
const L = require('../lib');
const NIF = require('../../public/js/nif.js');
const IT = require('./index');

const LATIN = { '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '€': 'EUR', '…': '...', '•': '-' };
const lat = s => String(s ?? '').replace(/[–—’‘“”€…•]/g, c => LATIN[c]).replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
const x = (s, max) => { let t = lat(s).trim(); if (max) t = t.slice(0, max); return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
const a2 = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const prezzo = n => { const s = (Math.round((Number(n) || 0) * 1e8) / 1e8).toFixed(8).replace(/0+$/, ''); const [i, d = ''] = s.split('.'); return `${i}.${d.padEnd(2, '0')}`; };
const r2 = L.r2;

// "Milano (MI)" / "Milano MI" -> comune and provincia
function comune(ort) {
  const m = /^(.*?)[\s,]*\(?\b([A-Z]{2})\)?$/.exec(String(ort || '').trim());
  return m && m[1] ? { comune: m[1].trim(), provincia: m[2] } : { comune: String(ort || '').trim(), provincia: '' };
}
function sede(strasse, plz, ort, land, prov) {
  const it = !land || land === 'IT';
  const c = comune(ort);
  const cap = it ? String(plz || '').replace(/\D/g, '').padStart(5, '0').slice(0, 5) : '00000';
  const p = it ? (prov || c.provincia) : '';
  return `<Sede><Indirizzo>${x(strasse || '-', 60)}</Indirizzo><CAP>${cap}</CAP><Comune>${x(c.comune, 60)}</Comune>${p ? `<Provincia>${x(p.toUpperCase(), 2)}</Provincia>` : ''}<Nazione>${x(land || 'IT', 2)}</Nazione></Sede>`;
}
function idFiscale(ust) {
  const s = String(ust || '').toUpperCase().replace(/[\s.\-]/g, '');
  if (!s) return '';
  const it = NIF.itPiva(s);
  if (it.ok) return `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${it.piva}</IdCodice></IdFiscaleIVA>`;
  const m = /^([A-Z]{2})([0-9A-Z+*]{2,28})$/.exec(s);
  return m ? `<IdFiscaleIVA><IdPaese>${m[1] === 'EL' ? 'GR' : m[1]}</IdPaese><IdCodice>${m[2]}</IdCodice></IdFiscaleIVA>` : '';
}
function progressivo() {
  const n = (Number(L.sw('it.sdi.progressivo', '0')) || 0) + 1;
  L.setSw('it.sdi.progressivo', String(n));
  return n.toString(36).toUpperCase().padStart(5, '0').slice(-5);
}

function create(rid, { probe = false } = {}) {
  const d = L.db(); const VG = require('../api/vorgang');
  const k = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  if (!k) throw new L.HttpError(404, 'Rechnung nicht gefunden');
  const pos = d.prepare('SELECT p.*, e.BEZEICHNUNG EINHEIT FROM RECHNUNGEN_POS p LEFT JOIN EINHEITEN e ON e.EINHEITID=p.EINHEITID WHERE RECHNUNGID=? ORDER BY PRTSORT').all(rid).map(p => ({ ...p }));
  VG.calc({ ...k }, pos);
  const f = L.firma(); const kunde = k.KUNID ? d.prepare('SELECT * FROM KUNDEN WHERE KUNID=?').get(k.KUNID) || {} : {};
  const credit = Number(k.TYP) === 2; const sg = credit ? -1 : 1; // credit notes (TD04) with positive amounts
  const typ = credit ? 'korrektur' : 'rechnung';
  const problems = IT.pruefen(typ, k, kunde);
  const split = IT.split(kunde);
  const rates = L.mwstRates();

  // lines and summary per rate / nature
  const lines = []; const riep = {};
  for (const p of pos) {
    if (p.POSART === 'T' || p.POSART === 'Z') continue;
    const nat = IT.natura(p, k);
    const aliq = nat ? 0 : (rates[Number(p.MWST) || 61] ?? 0);
    const qty = sg * (Number(p.MENGE) || 0);
    const totale = r2(qty * (Number(p.VK) || 0) * (1 - (Number(p.RABATT) || 0) / 100));
    lines.push({ n: lines.length + 1, desc: [p.BEZEICHNUNG || p.BESCHREIBUNG || p.ARTNUMMER || 'Articolo', p.BEZEICHNUNG ? p.BESCHREIBUNG : ''].filter(Boolean).join(' – '), art: p.ARTNUMMER, qty, um: p.EINHEIT, prezzo: Number(p.VK) || 0, sconto: Number(p.RABATT) || 0, totale, aliq, nat });
    const key = `${aliq}|${nat || ''}`;
    const g = riep[key] || (riep[key] = { aliq, nat, imponibile: 0 });
    g.imponibile += totale;
  }
  const riepilogo = Object.values(riep).map(g => ({ ...g, imponibile: r2(g.imponibile), imposta: r2(r2(g.imponibile) * g.aliq / 100) }));
  const imponibile = r2(riepilogo.reduce((s, g) => s + g.imponibile, 0));
  const imposta = r2(riepilogo.reduce((s, g) => s + g.imposta, 0));
  const totale = r2(imponibile + imposta);
  const stampato = r2(sg * Number(k.GBRUTTO));
  const arrotondamento = r2(stampato - totale);
  const bollo = IT.bollo(k, pos);
  if (!lines.length) problems.push('Keine Rechnungspositionen');

  // transmission data: recipient code, PEC, format
  const estero = k.KUNLAND && k.KUNLAND !== 'IT';
  const sdi = String(kunde.IT_SDI || '').toUpperCase().trim();
  const pa = /^[A-Z0-9]{6}$/.test(sdi);
  const codiceDest = estero ? 'XXXXXXX' : /^[A-Z0-9]{6,7}$/.test(sdi) ? sdi : '0000000';
  const formato = pa ? 'FPA12' : 'FPR12';
  const idTrasm = IT.cf() || '00000000000';
  const prog = probe ? '00000' : progressivo();

  const nome = String(k.KUNVORNAME || '').trim();
  const anagrafica = Number(k.KUNART) !== 1 && nome && !NIF.itPiva(kunde.USTID).ok
    ? `<Anagrafica><Nome>${x(nome, 60)}</Nome><Cognome>${x(k.KUNNAME, 60)}</Cognome></Anagrafica>`
    : `<Anagrafica><Denominazione>${x([k.KUNNAME, Number(k.KUNART) === 1 ? '' : nome].filter(Boolean).join(' '), 80)}</Denominazione></Anagrafica>`;
  const cfCliente = NIF.itCf(kunde.IT_CF).ok ? NIF.itCf(kunde.IT_CF).cf : '';

  const rea = L.sw('it.rea.ufficio', '') && L.sw('it.rea.numero', '')
    ? `<IscrizioneREA><Ufficio>${x(L.sw('it.rea.ufficio', '').toUpperCase(), 2)}</Ufficio><NumeroREA>${x(L.sw('it.rea.numero', ''), 20)}</NumeroREA>${L.sw('it.capitale', '') ? `<CapitaleSociale>${a2(String(L.sw('it.capitale', '')).replace(/\./g, '').replace(',', '.'))}</CapitaleSociale>` : ''}${L.sw('it.sociounico', '') !== '' ? `<SocioUnico>${L.sw('it.sociounico', '0') === '1' ? 'SU' : 'SM'}</SocioUnico>` : ''}<StatoLiquidazione>${L.sw('it.liquidazione', '0') === '1' ? 'LS' : 'LN'}</StatoLiquidazione></IscrizioneREA>`
    : '';

  const o = [];
  o.push('<?xml version="1.0" encoding="UTF-8"?>');
  o.push(`<p:FatturaElettronica versione="${formato}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">`);
  o.push('<FatturaElettronicaHeader>');
  o.push(`<DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${x(idTrasm, 28)}</IdCodice></IdTrasmittente><ProgressivoInvio>${prog}</ProgressivoInvio><FormatoTrasmissione>${formato}</FormatoTrasmissione><CodiceDestinatario>${codiceDest}</CodiceDestinatario>${(f.TELEFON || f.EMAIL) ? `<ContattiTrasmittente>${f.TELEFON ? `<Telefono>${x(f.TELEFON, 12)}</Telefono>` : ''}${f.EMAIL ? `<Email>${x(f.EMAIL, 256)}</Email>` : ''}</ContattiTrasmittente>` : ''}${codiceDest === '0000000' && kunde.IT_PEC ? `<PECDestinatario>${x(kunde.IT_PEC, 256)}</PECDestinatario>` : ''}</DatiTrasmissione>`);
  o.push(`<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${x(IT.piva(), 28)}</IdCodice></IdFiscaleIVA>${IT.cf() && IT.cf() !== IT.piva() ? `<CodiceFiscale>${x(IT.cf(), 16)}</CodiceFiscale>` : ''}<Anagrafica><Denominazione>${x(f.FIRMENNAME, 80)}</Denominazione></Anagrafica><RegimeFiscale>${IT.forfettario() ? 'RF19' : 'RF01'}</RegimeFiscale></DatiAnagrafici>${sede(f.STRASSE, f.PLZ, f.ORT, f.LAND || 'IT', L.sw('it.provincia', ''))}${rea}</CedentePrestatore>`);
  o.push(`<CessionarioCommittente><DatiAnagrafici>${idFiscale(kunde.USTID)}${cfCliente ? `<CodiceFiscale>${cfCliente}</CodiceFiscale>` : ''}${anagrafica}</DatiAnagrafici>${sede(k.KUNSTRASSE, k.KUNPLZ, k.KUNORT, k.KUNLAND || 'IT')}</CessionarioCommittente>`);
  o.push('</FatturaElettronicaHeader><FatturaElettronicaBody><DatiGenerali>');
  const causali = IT.mentions(typ, k, pos, kunde).filter(m => !/^Copia di cortesia/.test(m));
  o.push(`<DatiGeneraliDocumento><TipoDocumento>${credit ? 'TD04' : 'TD01'}</TipoDocumento><Divisa>EUR</Divisa><Data>${x(String(k.DATUM).slice(0, 10))}</Data><Numero>${x(k.RECHNUNGNUMMER, 20)}</Numero>${bollo ? `<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>${a2(bollo)}</ImportoBollo></DatiBollo>` : ''}<ImportoTotaleDocumento>${a2(stampato)}</ImportoTotaleDocumento>${arrotondamento ? `<Arrotondamento>${a2(arrotondamento)}</Arrotondamento>` : ''}${causali.map(c => `<Causale>${x(c, 200)}</Causale>`).join('')}</DatiGeneraliDocumento>`);
  if (k.BESTELLNR) o.push(`<DatiOrdineAcquisto><IdDocumento>${x(k.BESTELLNR, 20)}</IdDocumento></DatiOrdineAcquisto>`);
  const orig = Number(k.REIDGUTSCHRIFT) > 0 ? d.prepare('SELECT RECHNUNGNUMMER, DATUM FROM RECHNUNGEN WHERE RECHNUNGID=?').get(k.REIDGUTSCHRIFT) : null;
  if (credit && orig) o.push(`<DatiFattureCollegate><IdDocumento>${x(orig.RECHNUNGNUMMER, 20)}</IdDocumento><Data>${x(String(orig.DATUM).slice(0, 10))}</Data></DatiFattureCollegate>`);
  o.push('</DatiGenerali><DatiBeniServizi>');
  for (const l of lines) {
    o.push(`<DettaglioLinee><NumeroLinea>${l.n}</NumeroLinea>${l.art ? `<CodiceArticolo><CodiceTipo>INTERNO</CodiceTipo><CodiceValore>${x(l.art, 35)}</CodiceValore></CodiceArticolo>` : ''}<Descrizione>${x(l.desc, 1000)}</Descrizione><Quantita>${prezzo(l.qty)}</Quantita>${l.um ? `<UnitaMisura>${x(l.um, 10)}</UnitaMisura>` : ''}<PrezzoUnitario>${prezzo(l.prezzo)}</PrezzoUnitario>${l.sconto ? `<ScontoMaggiorazione><Tipo>SC</Tipo><Percentuale>${a2(l.sconto)}</Percentuale></ScontoMaggiorazione>` : ''}<PrezzoTotale>${a2(l.totale)}</PrezzoTotale><AliquotaIVA>${a2(l.aliq)}</AliquotaIVA>${l.nat ? `<Natura>${l.nat}</Natura>` : ''}</DettaglioLinee>`);
  }
  for (const g of riepilogo) {
    o.push(`<DatiRiepilogo><AliquotaIVA>${a2(g.aliq)}</AliquotaIVA>${g.nat ? `<Natura>${g.nat}</Natura>` : ''}<ImponibileImporto>${a2(g.imponibile)}</ImponibileImporto><Imposta>${a2(g.imposta)}</Imposta>${g.nat ? '' : `<EsigibilitaIVA>${split ? 'S' : 'I'}</EsigibilitaIVA>`}${g.nat ? `<RiferimentoNormativo>${x(IT.NATURA[g.nat], 100)}</RiferimentoNormativo>` : ''}</DatiRiepilogo>`);
  }
  o.push('</DatiBeniServizi>');
  // payment: open amount (split payment without the IVA), bank transfer with IBAN
  const pagato = sg * d.prepare('SELECT COALESCE(SUM(BETRAG),0) s FROM ZAHLUNGSEINGAENGE WHERE RECHNUNGID=?').get(rid).s;
  const daPagare = r2(stampato - (split ? imposta : 0) - pagato);
  if (!credit && daPagare > 0) {
    const scad = L.addDays(k.DATUM, Number(k.FAELLING) || 0);
    o.push(`<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>${f.IBAN ? 'MP05' : 'MP01'}</ModalitaPagamento><DataScadenzaPagamento>${scad}</DataScadenzaPagamento><ImportoPagamento>${a2(daPagare)}</ImportoPagamento>${f.IBAN ? `${f.BANKNAME ? `<IstitutoFinanziario>${x(f.BANKNAME, 80)}</IstitutoFinanziario>` : ''}<IBAN>${x(String(f.IBAN).replace(/\s/g, ''), 34)}</IBAN>` : ''}</DettaglioPagamento></DatiPagamento>`);
  }
  o.push('</FatturaElettronicaBody></p:FatturaElettronica>');
  return { xml: o.join(''), problems, filename: `IT${idTrasm}_${prog}.xml`, formato, codiceDestinatario: codiceDest, totale: stampato };
}

module.exports = { create, comune };
