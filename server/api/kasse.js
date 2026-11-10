'use strict';
// Cash register: receipts, cash in/out, cancellation, closing (Z report), DSFinV-K
const L = require('../lib');
const VG = require('./vorgang');
const TSE = require('../kasse/tse');
const { writeZip } = require('../import/zip');

const num = x => { const n = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const BTC = require('../btcpay');
const ES = require('../es');
const VF = require('../es/verifactu');
const ZAHLART_ID = { BAR: 1, EC: 2, KARTE: 2, UEBERWEISUNG: 3, KRYPTO: -1 };
const ZAHLART_TEXT = { BAR: 'Bar', EC: 'EC-Karte', KARTE: 'Kreditkarte', UEBERWEISUNG: 'Überweisung', KRYPTO: 'Krypto' };
// payment type ID in the database; crypto is created when needed
const zahlartDb = za => za === 'KRYPTO' ? BTC.zahlartId() : ZAHLART_ID[za];

function bediener(benid) {
  const b = benid ? L.db().prepare('SELECT BENUTZERID, VORNAME, NAME FROM BENUTZER WHERE BENUTZERID=?').get(benid) : null;
  return b ? { id: b.BENUTZERID, name: [b.VORNAME, b.NAME].filter(Boolean).join(' ') } : { id: null, name: '' };
}
function letzterAbschluss() { return L.db().prepare('SELECT * FROM SW_KASSE_ABSCHLUSS ORDER BY ZNR DESC LIMIT 1').get(); }
function offeneBons() { return L.db().prepare('SELECT * FROM SW_KASSE_BON WHERE ABSCHLUSSID IS NULL ORDER BY ID').all(); }
function barWirkung(b) {
  if (b.TYP === 'Einzahlung' || b.TYP === 'Anfangsbestand') return b.BRUTTO;
  if (b.TYP === 'Auszahlung') return -b.BRUTTO;
  if (b.TYP === 'Differenz') return b.BRUTTO;
  return b.ZAHLART === 'BAR' ? b.BRUTTO : 0;
}
function bestand() {
  const la = letzterAbschluss();
  const anfang = la ? la.IST : L.optNum('Kassenanfang', 0);
  return L.r2(anfang + offeneBons().reduce((s, b) => s + barWirkung(b), 0));
}

function status() {
  const d = L.db();
  return {
    bediener: d.prepare("SELECT BENUTZERID id, TRIM(COALESCE(VORNAME,'')||' '||COALESCE(NAME,'')) name FROM BENUTZER WHERE COALESCE(KASSENBEDIENER,0)=1 ORDER BY NAME").all(),
    barkunde: Number(L.sw('kasse.barkunde', '0')) || null,
    schnelltasten: JSON.parse(L.sw('kasse.schnelltasten', '[]') || '[]'),
    autorechnung: L.sw('kasse.autorechnung', '1') === '1' || ES.activo(),
    land: L.land(),
    tse: { aktiv: TSE.cfg().aktiv, serial: L.sw('tse.seriennummer', '') },
    ec: L.sw('ec.aktiv', '0') === '1',
    krypto: BTC.bereit(),
    kryptoWarnungen: BTC.bereit() ? BTC.kasseWarnungen() : [],
    bestand: bestand(),
    letzte: d.prepare('SELECT ID, BONNR, ZEIT, TYP, BRUTTO, ZAHLART, KUNDE, STORNIERT FROM SW_KASSE_BON ORDER BY ID DESC LIMIT 10').all(),
  };
}

function rateOf(code) { return L.mwstRates()[Number(code) || 61] ?? 0; }
function linien(positionen) {
  const us = L.land() === 'US'; const usLaborFree = us && L.sw('us.labor.taxable', '0') !== '1';
  return positionen.filter(p => num(p.MENGE)).map((p, i) => {
    const frei = Number(p.DURCHLAUFER) === 1 || (usLaborFree && p.POSART === 'L');
    const rate = frei ? 0 : rateOf(p.MWST);
    // US: the unit price is before sales tax, elsewhere it includes VAT
    const betrag = L.r2(num(p.MENGE) * num(p.EINZEL) * (1 - num(p.RABATT) / 100));
    const brutto = us ? L.r2(betrag * (1 + rate / 100)) : betrag;
    return { POS: i + 1, POSART: p.POSART || 'A', ARTID: p.ARTID || null, ARTNUMMER: p.ARTNUMMER || '', BEZEICHNUNG: p.BEZEICHNUNG || 'Artikel', MENGE: num(p.MENGE), EINZEL: num(p.EINZEL), RABATT: num(p.RABATT),
      MWSTSATZ: rate, MWSTCODE: frei ? 63 : (Number(p.MWST) || 61), BRUTTO: brutto, NETTO: us ? betrag : L.r2(brutto / (1 + rate / 100)), GVTYP: p.GVTYP || 'Umsatz', EK: num(p.EK), DURCHLAUFER: p.DURCHLAUFER ? 1 : 0, EINHEITID: p.EINHEITID || null };
  });
}
function summen(lines) {
  const ust = {}; let brutto = 0, netto = 0;
  for (const l of lines) { ust[l.MWSTSATZ] = L.r2((ust[l.MWSTSATZ] || 0) + l.BRUTTO); brutto += l.BRUTTO; netto += l.NETTO; }
  return { ust, brutto: L.r2(brutto), netto: L.r2(netto) };
}

function speichereBon(b, lines) {
  const d = L.db();
  b.BONNR = (d.prepare('SELECT MAX(BONNR) m FROM SW_KASSE_BON').get().m || 0) + 1;
  b.ZEIT = b.ZEIT || L.now();
  const cols = [...L.tableColumns('SW_KASSE_BON')].filter(c => c !== 'ID' && b[c] !== undefined);
  const id = Number(d.prepare(`INSERT INTO SW_KASSE_BON (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => b[c])).lastInsertRowid);
  const pc = ['POS', 'POSART', 'ARTID', 'ARTNUMMER', 'BEZEICHNUNG', 'MENGE', 'EINZEL', 'RABATT', 'MWSTSATZ', 'MWSTCODE', 'BRUTTO', 'NETTO', 'GVTYP'];
  for (const l of lines) d.prepare(`INSERT INTO SW_KASSE_POS (BONID, ${pc.join(',')}) VALUES (?,${pc.map(() => '?').join(',')})`).run(id, ...pc.map(c => l[c] ?? null));
  return id;
}

// Sale / pay an order / pay an invoice
const kryptoInArbeit = new Set(); // never book the same crypto payment twice at the same time
async function bon(p, user) {
  if (p.zahlart !== 'KRYPTO') return bonBuchen(p, user, null);
  const kid = Number(p.kryptoid);
  if (!kid) throw new L.HttpError(400, 'Krypto-Zahlung fehlt.');
  if (kryptoInArbeit.has(kid)) throw new L.HttpError(409, 'Diese Krypto-Zahlung wird gerade verbucht.');
  kryptoInArbeit.add(kid);
  try {
    // check with BTCPay first, then create the invoice or convert the order
    const erwartet = p.rechnungid ? (p.betrag != null ? L.r2(num(p.betrag)) : VG.load('rechnung', p.rechnungid).offen)
      : p.auftragid ? VG.load('auftrag', p.auftragid).kopf.GBRUTTO : summen(linien(p.positionen || [])).brutto;
    const krypto = await BTC.kasseVerbrauchen(kid, erwartet);
    return await bonBuchen(p, user, krypto);
  } finally { kryptoInArbeit.delete(kid); }
}
async function bonBuchen(p, user, krypto) {
  const zahlart = ZAHLART_ID[p.zahlart] ? p.zahlart : 'BAR';
  const bed = bediener(p.benid);
  let kunid = Number(p.kunid) || Number(L.sw('kasse.barkunde', '0')) || null;
  let rechnungid = null; let lines; let bezahlBetrag;
  if (p.rechnungid) {
    const r = VG.load('rechnung', p.rechnungid);
    bezahlBetrag = p.betrag != null ? L.r2(num(p.betrag)) : r.offen;
    if (!bezahlBetrag) throw new L.HttpError(400, 'Die Rechnung ist bereits bezahlt.');
    kunid = r.kopf.KUNID; rechnungid = r.kopf.RECHNUNGID;
    lines = [{ POS: 1, POSART: 'Z', BEZEICHNUNG: `Zahlung Rechnung Nr. ${r.kopf.RECHNUNGNUMMER}`, MENGE: 1, EINZEL: bezahlBetrag, RABATT: 0, MWSTSATZ: 0, MWSTCODE: 63, BRUTTO: bezahlBetrag, NETTO: bezahlBetrag, GVTYP: 'Forderungsaufloesung' }];
  } else {
    let pos = p.positionen || [];
    if (p.auftragid) {
      const conv = await VG.convert('auftrag', p.auftragid, 'rechnung', 'wandeln', user);
      rechnungid = conv.id;
      const r = VG.load('rechnung', rechnungid); kunid = r.kopf.KUNID;
      pos = r.pos.filter(x => x.POSART !== 'T' && x.POSART !== 'Z').map(x => ({ ...x, EINZEL: x.VKBRUTTO, MWST: x.MWST }));
    }
    lines = linien(pos);
    if (!lines.length) throw new L.HttpError(400, 'Der Kassenvorgang enthält keine Positionen.');
    const s = summen(lines); bezahlBetrag = s.brutto;
    // Spain: every sale is an invoice (factura simplificada or completa) with a VERI*FACTU record
    if (!rechnungid && (L.sw('kasse.autorechnung', '1') === '1' || ES.activo())) {
      const t = VG.template('rechnung', kunid ? { kunid } : {}); delete t.kopf._kunde;
      t.kopf.ANSICHTBRUTTO = L.land() === 'US' ? 0 : 1; t.kopf.ZAHLBDTEXT = zahlart === 'KRYPTO' ? 'Betrag per Krypto-Zahlung (BTCPay) erhalten.' : `Betrag ${ZAHLART_TEXT[zahlart].toLowerCase()} erhalten.`; t.kopf.FAELLING = 0;
      if (!kunid) { t.kopf.KUNNAME = 'Barverkauf'; }
      const r = VG.save('rechnung', { kopf: t.kopf, pos: lines.map(l => ({ POSART: l.POSART === 'L' ? 'L' : 'A', ARTID: l.ARTID, ARTNUMMER: l.ARTNUMMER, BEZEICHNUNG: l.BEZEICHNUNG, MENGE: l.MENGE, ...(L.land() === 'US' ? { VK: l.EINZEL } : { VKBRUTTO: l.EINZEL }), RABATT: l.RABATT, MWST: l.MWSTCODE, EK: l.EK, DURCHLAUFER: l.DURCHLAUFER, EINHEITID: l.EINHEITID })) }, user);
      rechnungid = r.kopf.RECHNUNGID;
      if (ES.activo()) {
        try { VF.emitir(rechnungid); } catch (e) { VG.remove('rechnung', rechnungid, user); throw e; }
        bezahlBetrag = r.kopf.GBRUTTO; // incl. recargo de equivalencia
      } else if (L.land() === 'US') bezahlBetrag = r.kopf.GBRUTTO; // sales tax rounded per rate as on the invoice
    }
  }
  if (rechnungid && ES.activo()) VF.emitir(rechnungid); // invoice paid at the register is issued now at the latest
  if (krypto && Math.abs(krypto.BETRAG - bezahlBetrag) > 0.005) throw new L.HttpError(409, 'Der Betrag hat sich geändert. Die Krypto-Zahlung passt nicht mehr zum Bon.');
  const s = summen(lines);
  if (rechnungid) { await VG.addPayment({ RECHNUNGID: rechnungid, BETRAG: bezahlBetrag, ZAHLUNGSARTID: zahlartDb(zahlart), BANKNAME: 'Kasse' }, user); }
  else if (zahlart === 'BAR') {
    L.db().prepare('INSERT INTO KASSENBUCH (ART, EMPFAENGER, VERWENDUNG, DATUM, AUSGABEN, EINNAHMEN, BELEGNUMMER, AENDERUNGSDATUM, STEUERSCHLUESSEL) VALUES (1,?,?,?,0,?,?,?,0)')
      .run('Barverkauf', 'Kassenbon', L.today(), bezahlBetrag, 'Bon', L.now());
  }
  const kunde = kunid ? L.db().prepare("SELECT TRIM(COALESCE(NAME,'')||' '||COALESCE(VORNAME,'')) n FROM KUNDEN WHERE KUNID=?").get(kunid) : null;
  const ust = p.rechnungid ? { 0: bezahlBetrag } : s.ust;
  const tse = await TSE.signieren({ receiptType: 'RECEIPT', ustSummen: ust, zahlarten: { [zahlart]: bezahlBetrag } });
  const gegeben = zahlart === 'BAR' && p.gegeben ? num(p.gegeben) : bezahlBetrag;
  const id = speichereBon({ TYP: 'Beleg', BENID: bed.id, BEDIENER: bed.name, KUNID: kunid, KUNDE: kunde ? kunde.n : 'Barverkauf', RECHNUNGID: rechnungid, VERWENDUNG: krypto ? `Krypto (BTCPay)${krypto.METHODE ? ' · ' + krypto.METHODE : ''}` : undefined, BRUTTO: bezahlBetrag, NETTO: p.rechnungid ? bezahlBetrag : s.netto, ZAHLART: zahlart, GEGEBEN: gegeben, RUECKGELD: L.r2(Math.max(0, gegeben - bezahlBetrag)), ...(tse || {}) }, lines);
  if (krypto) BTC.kasseVerknuepfen(krypto.ID, id);
  return beleg(id);
}

async function bewegung({ typ, betrag, verwendung, gegenkonto, benid }, user) {
  const art = typ === 'Auszahlung' ? 'Auszahlung' : 'Einzahlung';
  const b = L.r2(Math.abs(num(betrag))); if (!b) throw new L.HttpError(400, 'Bitte einen Betrag eingeben.');
  if (!verwendung) throw new L.HttpError(400, 'Bitte die Verwendung angeben.');
  const bed = bediener(benid);
  const tse = await TSE.signieren({ receiptType: 'TRANSFER', ustSummen: { 0: art === 'Auszahlung' ? -b : b }, zahlarten: { BAR: art === 'Auszahlung' ? -b : b } });
  if (L.sw('kasse.kassenbuch', '1') === '1') {
    const kid = Number(L.db().prepare('INSERT INTO KASSENBUCH (ART, EMPFAENGER, VERWENDUNG, DATUM, AUSGABEN, EINNAHMEN, BELEGNUMMER, AENDERUNGSDATUM, GEGENKONTO, STEUERSCHLUESSEL) VALUES (?,?,?,?,?,?,?,?,?,0)')
      .run(art === 'Auszahlung' ? 2 : 1, bed.name || 'Kasse', verwendung, L.today(), art === 'Auszahlung' ? b : 0, art === 'Einzahlung' ? b : 0, art, L.now(), gegenkonto || null).lastInsertRowid);
    if (gegenkonto) {
      const kasse = L.optNum('FIBU-Kasse', 1000);
      L.db().prepare('INSERT INTO FIBU (BELEGDATUM, SOLL, HABEN, BUCHUNGSTEXT, BELEGNUMMER, BETRAG, ERSTELLUNGSDATUM, EXPORTIERT, KASSENID) VALUES (?,?,?,?,?,?,?,0,?)')
        .run(L.today(), art === 'Einzahlung' ? kasse : Number(gegenkonto), art === 'Einzahlung' ? Number(gegenkonto) : kasse, String(verwendung).slice(0, 60), art, b, L.today(), kid);
    }
  }
  const id = speichereBon({ TYP: art, BENID: bed.id, BEDIENER: bed.name, BRUTTO: b, NETTO: b, ZAHLART: 'BAR', VERWENDUNG: verwendung, GEGENKONTO: gegenkonto || null, ...(tse || {}) },
    [{ POS: 1, POSART: 'Z', BEZEICHNUNG: verwendung, MENGE: 1, EINZEL: b, RABATT: 0, MWSTSATZ: 0, MWSTCODE: 63, BRUTTO: b, NETTO: b, GVTYP: art === 'Einzahlung' ? 'Einzahlung' : 'Auszahlung' }]);
  return beleg(id);
}

async function storno(bonid, { rechnungskorrektur = true, zahlart } = {}, user) {
  const d = L.db();
  const o = d.prepare('SELECT * FROM SW_KASSE_BON WHERE ID=?').get(bonid);
  if (!o) throw new L.HttpError(404, 'Bon nicht gefunden');
  if (o.STORNIERT) throw new L.HttpError(409, 'Dieser Bon wurde bereits storniert.');
  if (o.STORNOID) throw new L.HttpError(409, 'Ein Stornobeleg kann nicht storniert werden.');
  if (o.TYP !== 'Beleg') throw new L.HttpError(400, 'Nur Verkaufsbelege können storniert werden. Ein-/Auszahlungen bitte durch eine Gegenbuchung korrigieren.');
  if (String(o.ZEIT).slice(0, 10) !== L.today()) throw new L.HttpError(409, 'Nur Bons vom heutigen Tag können storniert werden. Bitte erstellen Sie eine Rechnungskorrektur.');
  if (o.ABSCHLUSSID) throw new L.HttpError(409, 'Der Bon ist bereits in einem Kassenabschluss enthalten.');
  const lines = d.prepare('SELECT * FROM SW_KASSE_POS WHERE BONID=? ORDER BY POS').all(bonid).map(l => ({ ...l, MENGE: -l.MENGE, BRUTTO: -l.BRUTTO, NETTO: -l.NETTO }));
  const za = ZAHLART_ID[zahlart] ? zahlart : o.ZAHLART;
  if (ES.activo()) rechnungskorrektur = true; // Spain: a cancelled sale needs a corrective invoice
  if (o.RECHNUNGID) {
    const isZahlung = lines.length === 1 && lines[0].GVTYP === 'Forderungsaufloesung';
    if (isZahlung) {
      const z = d.prepare("SELECT ID FROM ZAHLUNGSEINGAENGE WHERE RECHNUNGID=? AND BETRAG=? AND BANKNAME='Kasse' ORDER BY ID DESC").get(o.RECHNUNGID, o.BRUTTO);
      if (z) VG.deletePayment(z.ID, user);
    } else if (rechnungskorrektur) {
      const st = VG.storno(o.RECHNUNGID, user);
      if (ES.activo()) VF.emitir(st.id);
      const k = VG.load('korrektur', st.id);
      if (Math.abs(k.offen) > 0.004) await VG.addPayment({ RECHNUNGID: st.id, BETRAG: k.offen, ZAHLUNGSARTID: zahlartDb(za), BANKNAME: 'Kasse (Storno)' }, user);
    } else {
      const z = d.prepare("SELECT ID FROM ZAHLUNGSEINGAENGE WHERE RECHNUNGID=? AND BANKNAME='Kasse' ORDER BY ID DESC").get(o.RECHNUNGID);
      if (z) VG.deletePayment(z.ID, user);
    }
  } else if (o.ZAHLART === 'BAR') {
    d.prepare('INSERT INTO KASSENBUCH (ART, EMPFAENGER, VERWENDUNG, DATUM, AUSGABEN, EINNAHMEN, BELEGNUMMER, AENDERUNGSDATUM, STEUERSCHLUESSEL) VALUES (2,?,?,?,?,0,?,?,0)').run('Storno', `Storno Bon ${o.BONNR}`, L.today(), o.BRUTTO, String(o.BONNR), L.now());
  }
  const ust = {}; for (const l of lines) ust[l.MWSTSATZ] = L.r2((ust[l.MWSTSATZ] || 0) + l.BRUTTO);
  const tse = await TSE.signieren({ receiptType: 'CANCELLATION', ustSummen: ust, zahlarten: { [za]: -o.BRUTTO } });
  const id = speichereBon({ TYP: 'Beleg', BENID: o.BENID, BEDIENER: o.BEDIENER, KUNID: o.KUNID, KUNDE: o.KUNDE, RECHNUNGID: o.RECHNUNGID, BRUTTO: -o.BRUTTO, NETTO: -o.NETTO, ZAHLART: za, GEGEBEN: -o.BRUTTO, RUECKGELD: 0, STORNOID: o.ID, VERWENDUNG: `Storno zu Bon ${o.BONNR}`, ...(tse || {}) }, lines);
  d.prepare('UPDATE SW_KASSE_BON SET STORNIERT=1 WHERE ID=?').run(o.ID);
  return beleg(id);
}

function beleg(id) {
  const d = L.db();
  const b = d.prepare('SELECT * FROM SW_KASSE_BON WHERE ID=?').get(id);
  if (!b) throw new L.HttpError(404, 'Bon nicht gefunden');
  const pos = d.prepare('SELECT * FROM SW_KASSE_POS WHERE BONID=? ORDER BY POS').all(id);
  const ust = {};
  for (const p of pos) { const u = ust[p.MWSTSATZ] || (ust[p.MWSTSATZ] = { satz: p.MWSTSATZ, brutto: 0, netto: 0 }); u.brutto = L.r2(u.brutto + p.BRUTTO); u.netto = L.r2(u.netto + p.NETTO); }
  const r = b.RECHNUNGID ? d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(b.RECHNUNGID) : null;
  // Spain: the receipt shows the invoice (series number, NIF, QR code of VERI*FACTU)
  const es = r && (ES.activo() || r.ESNUMSERIE) ? { ...VF.info(r), recargo: r.GRECARGO || 0 } : null;
  return { es, bon: b, pos, ust: Object.values(ust).map(u => ({ ...u, mwst: L.r2(u.brutto - u.netto) })), rechnungnr: r && r.RECHNUNGNUMMER, firma: L.firma(), kasse: L.sw('kasse.seriennummer', 'Kasse 1'), fusstext: L.sw('kasse.bonfusstext', 'Vielen Dank für Ihren Besuch!') };
}
function journal(q) {
  return L.db().prepare('SELECT * FROM SW_KASSE_BON WHERE substr(ZEIT,1,10) BETWEEN ? AND ? ORDER BY ID DESC LIMIT 5000').all(q.von || L.today(), q.bis || L.today());
}

// ---------- Closing ----------
function abschlussVorschau() {
  const la = letzterAbschluss();
  const anfang = la ? la.IST : L.optNum('Kassenanfang', 0);
  const bons = offeneBons();
  const ein = L.r2(bons.reduce((s, b) => s + Math.max(0, barWirkung(b)), 0));
  const aus = L.r2(bons.reduce((s, b) => s + Math.min(0, barWirkung(b)), 0));
  const ust = {}, zahl = {};
  let ub = 0, un = 0;
  for (const b of bons) {
    if (b.TYP !== 'Beleg') continue;
    zahl[b.ZAHLART] = L.r2((zahl[b.ZAHLART] || 0) + b.BRUTTO);
    for (const p of L.db().prepare('SELECT * FROM SW_KASSE_POS WHERE BONID=?').all(b.ID)) {
      if (p.GVTYP === 'Forderungsaufloesung') continue;
      const u = ust[p.MWSTSATZ] || (ust[p.MWSTSATZ] = { satz: p.MWSTSATZ, brutto: 0, netto: 0 }); u.brutto = L.r2(u.brutto + p.BRUTTO); u.netto = L.r2(u.netto + p.NETTO);
      ub += p.BRUTTO; un += p.NETTO;
    }
  }
  return { znr: (la ? la.ZNR : 0) + 1, anfang, bar_ein: ein, bar_aus: aus, soll: L.r2(anfang + ein + aus), umsatz_brutto: L.r2(ub), umsatz_netto: L.r2(un), ust: Object.values(ust), zahlarten: zahl, bons: bons.length, von: bons[0] && bons[0].ZEIT, bis: bons.length && bons[bons.length - 1].ZEIT };
}
async function abschluss({ ist, zaehlprotokoll, benid }) {
  const d = L.db(); const v = abschlussVorschau();
  if (ist == null || ist === '') throw new L.HttpError(400, 'Bitte den gezählten Kassenbestand eingeben.');
  const istB = L.r2(num(ist)); const diff = L.r2(istB - v.soll); const bed = bediener(benid);
  if (Math.abs(diff) >= 0.01) {
    const tse = await TSE.signieren({ receiptType: 'TRANSFER', ustSummen: { 0: diff }, zahlarten: { BAR: diff } });
    speichereBon({ TYP: 'Differenz', BENID: bed.id, BEDIENER: bed.name, BRUTTO: diff, NETTO: diff, ZAHLART: 'BAR', VERWENDUNG: 'Kassendifferenz', ...(tse || {}) },
      [{ POS: 1, POSART: 'Z', BEZEICHNUNG: 'Kassendifferenz', MENGE: 1, EINZEL: diff, MWSTSATZ: 0, MWSTCODE: 63, BRUTTO: diff, NETTO: diff, GVTYP: 'DifferenzSollIst' }]);
    if (L.sw('kasse.kassenbuch', '1') === '1') d.prepare('INSERT INTO KASSENBUCH (ART, EMPFAENGER, VERWENDUNG, DATUM, AUSGABEN, EINNAHMEN, BELEGNUMMER, AENDERUNGSDATUM, STEUERSCHLUESSEL) VALUES (?,?,?,?,?,?,?,?,0)')
      .run(diff > 0 ? 1 : 2, 'Kasse', 'Kassendifferenz laut Zählprotokoll', L.today(), diff < 0 ? -diff : 0, diff > 0 ? diff : 0, `Z${v.znr}`, L.now());
  }
  const bons = offeneBons();
  const r = d.prepare('INSERT INTO SW_KASSE_ABSCHLUSS (ZNR, ZEIT, VON_BONID, BIS_BONID, ANFANG, BAR_EIN, BAR_AUS, SOLL, IST, DIFFERENZ, UMSATZ_BRUTTO, UMSATZ_NETTO, UST, ZAHLARTEN, ZAEHLPROTOKOLL, BENID, BEDIENER) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(v.znr, L.now(), bons[0] ? bons[0].ID : null, bons.length ? bons[bons.length - 1].ID : null, v.anfang, v.bar_ein, v.bar_aus, v.soll, istB, diff, v.umsatz_brutto, v.umsatz_netto, JSON.stringify(v.ust), JSON.stringify(v.zahlarten), JSON.stringify(zaehlprotokoll || null), bed.id, bed.name);
  d.prepare('UPDATE SW_KASSE_BON SET ABSCHLUSSID=? WHERE ABSCHLUSSID IS NULL').run(r.lastInsertRowid);
  return abschlussDetail(Number(r.lastInsertRowid));
}
function abschluesse() { return L.db().prepare('SELECT * FROM SW_KASSE_ABSCHLUSS ORDER BY ZNR DESC LIMIT 1000').all(); }
function abschlussDetail(id) {
  const a = L.db().prepare('SELECT * FROM SW_KASSE_ABSCHLUSS WHERE ID=?').get(id);
  if (!a) throw new L.HttpError(404, 'Abschluss nicht gefunden');
  return { ...a, UST: JSON.parse(a.UST || '[]'), ZAHLARTEN: JSON.parse(a.ZAHLARTEN || '{}'), ZAEHLPROTOKOLL: JSON.parse(a.ZAEHLPROTOKOLL || 'null'), firma: L.firma(), kasse: L.sw('kasse.seriennummer', 'Kasse 1') };
}

// ---------- DSFinV-K (German tax authority's digital interface for cash register systems) ----------
function dsfinvk({ von, bis }) {
  const d = L.db(); const f = L.firma();
  const kid = L.sw('kasse.seriennummer', 'KASSE1');
  const zs = d.prepare("SELECT * FROM SW_KASSE_ABSCHLUSS WHERE substr(ZEIT,1,10) BETWEEN ? AND ? ORDER BY ZNR").all(von || '0000', bis || '9999');
  const ustKey = s => ({ 19: 1, 7: 2, 10.7: 3, 5.5: 4, 0: 5 })[Number(s)] || 5;
  const dec = (v, n = 2) => (Number(v) || 0).toFixed(n).replace('.', ',');
  const q = v => v == null ? '' : '"' + String(v).replace(/"/g, '""') + '"';
  const files = {}; const add = (name, header, rows) => { files[name] = files[name] || [header.join(';')]; for (const r of rows) files[name].push(r.join(';')); };
  const H = ['Z_KASSE_ID', 'Z_ERSTELLUNG', 'Z_NR'];
  for (const z of zs) {
    const zk = [q(kid), q(z.ZEIT.replace(' ', 'T')), z.ZNR];
    add('cashpointclosing.csv', [...H, 'Z_BUCHUNGSTAG', 'TAXONOMIE_VERSION', 'Z_START_ID', 'Z_ENDE_ID', 'NAME', 'STRASSE', 'PLZ', 'ORT', 'LAND', 'STNR', 'USTID', 'Z_SE_ZAHLUNGEN', 'Z_SE_BARZAHLUNGEN'],
      [[...zk, q(z.ZEIT.slice(0, 10)), q('2.3'), z.VON_BONID || '', z.BIS_BONID || '', q(f.FIRMENNAME), q(f.STRASSE), q(f.PLZ), q(f.ORT), q('DEU'), q(f.STEUERNR || ''), q(f.USTNR || ''), dec(z.UMSATZ_BRUTTO), dec(z.BAR_EIN + z.BAR_AUS)]]);
    add('location.csv', [...H, 'LOC_NAME', 'LOC_STRASSE', 'LOC_PLZ', 'LOC_ORT', 'LOC_LAND', 'LOC_USTID'], [[...zk, q(f.FIRMENNAME), q(f.STRASSE), q(f.PLZ), q(f.ORT), q('DEU'), q(f.USTNR || '')]]);
    add('cashregister.csv', [...H, 'KASSE_BRAND', 'KASSE_MODELL', 'KASSE_SERIENNR', 'KASSE_SW_BRAND', 'KASSE_SW_VERSION', 'KASSE_BASISWAEH_CODE', 'KEINE_UST_ZUORDNUNG'], [[...zk, q('Kuenta'), q('PC-Kasse'), q(kid), q('Kuenta'), q('1.0'), q('EUR'), q('')]]);
    add('tse.csv', [...H, 'TSE_ID', 'TSE_SERIAL', 'TSE_SIG_ALGO', 'TSE_ZEITFORMAT', 'TSE_PD_ENCODING', 'TSE_PUBLIC_KEY', 'TSE_ZERTIFIKAT_I', 'TSE_ZERTIFIKAT_II'],
      [[...zk, 1, q(L.sw('tse.seriennummer', '')), q(L.sw('tse.signaturalgorithmus', '')), q(L.sw('tse.zeitformat', 'unixTime')), q('UTF-8'), q(L.sw('tse.publickey', '')), q((L.sw('tse.zertifikat', '') || '').slice(0, 1000)), q((L.sw('tse.zertifikat', '') || '').slice(1000, 2000))]]);
    add('vat.csv', [...H, 'UST_SCHLUESSEL', 'UST_SATZ', 'UST_BESCHR'], [[...zk, 1, dec(19), q('Regelsteuersatz')], [...zk, 2, dec(7), q('Ermäßigter Steuersatz')], [...zk, 5, dec(0), q('Nicht steuerbar / steuerfrei')]]);
    const bons = d.prepare('SELECT * FROM SW_KASSE_BON WHERE ABSCHLUSSID=? ORDER BY ID').all(z.ID);
    const gv = {}; const pay = {};
    for (const b of bons) {
      const pos = d.prepare('SELECT * FROM SW_KASSE_POS WHERE BONID=? ORDER BY POS').all(b.ID);
      const bk = [...zk, b.ID];
      add('transactions.csv', [...H, 'BON_ID', 'BON_NR', 'BON_TYP', 'BON_NAME', 'TERMINAL_ID', 'BON_STORNO', 'BON_START', 'BON_ENDE', 'BEDIENER_ID', 'BEDIENER_NAME', 'UMS_BRUTTO', 'KUNDE_NAME', 'KUNDE_ID', 'KUNDE_TYP', 'KUNDE_STRASSE', 'KUNDE_PLZ', 'KUNDE_ORT', 'KUNDE_LAND', 'KUNDE_USTID', 'BON_NOTIZ'],
        [[...bk, b.BONNR, q(b.TYP === 'Beleg' ? 'Beleg' : 'AVTransfer'), q(b.TYP), q(''), b.STORNOID ? 1 : 0, q((b.TSE_START || b.ZEIT).replace(' ', 'T')), q((b.TSE_ENDE || b.ZEIT).replace(' ', 'T')), q(b.BENID || ''), q(b.BEDIENER || ''), dec(b.BRUTTO), q(b.KUNDE || ''), q(b.KUNID || ''), q(''), q(''), q(''), q(''), q(''), q(''), q(b.VERWENDUNG || '')]]);
      const bu = {};
      for (const p of pos) {
        const k = ustKey(p.MWSTSATZ);
        const u = bu[k] || (bu[k] = { b: 0, n: 0 }); u.b += p.BRUTTO; u.n += p.NETTO;
        const g = gv[p.GVTYP + '|' + k] || (gv[p.GVTYP + '|' + k] = { typ: p.GVTYP, k, b: 0, n: 0 }); g.b += p.BRUTTO; g.n += p.NETTO;
        add('lines.csv', [...H, 'BON_ID', 'POS_ZEILE', 'GUTSCHEIN_NR', 'ARTIKELTEXT', 'POS_TERMINAL_ID', 'GV_TYP', 'GV_NAME', 'INHAUS', 'P_STORNO', 'AGENTUR_ID', 'ART_NR', 'GTIN', 'WARENGR_ID', 'WARENGR', 'MENGE', 'FAKTOR', 'EINHEIT', 'STK_BR'],
          [[...bk, p.POS, q(''), q(p.BEZEICHNUNG), q(''), q(p.GVTYP || 'Umsatz'), q(''), 0, b.STORNOID ? 1 : 0, 0, q(p.ARTNUMMER || ''), q(''), q(''), q(''), dec(p.MENGE, 3), dec(1, 3), q('Stück'), dec(p.EINZEL, 5)]]);
        add('lines_vat.csv', [...H, 'BON_ID', 'POS_ZEILE', 'UST_SCHLUESSEL', 'POS_BRUTTO', 'POS_NETTO', 'POS_UST'], [[...bk, p.POS, k, dec(p.BRUTTO, 5), dec(p.NETTO, 5), dec(p.BRUTTO - p.NETTO, 5)]]);
      }
      for (const [k, u] of Object.entries(bu)) add('transactions_vat.csv', [...H, 'BON_ID', 'UST_SCHLUESSEL', 'BON_BRUTTO', 'BON_NETTO', 'BON_UST'], [[...bk, k, dec(u.b, 5), dec(u.n, 5), dec(u.b - u.n, 5)]]);
      const zt = b.ZAHLART === 'BAR' ? 'Bar' : 'Unbar';
      add('datapayment.csv', [...H, 'BON_ID', 'ZAHLART_TYP', 'ZAHLART_NAME', 'ZAHLWAEH_CODE', 'ZAHLWAEH_BETRAG', 'BASISWAEH_BETRAG'], [[...bk, q(zt), q(ZAHLART_TEXT[b.ZAHLART] || b.ZAHLART), q(''), q(''), dec(b.BRUTTO)]]);
      pay[zt + '|' + (ZAHLART_TEXT[b.ZAHLART] || b.ZAHLART)] = (pay[zt + '|' + (ZAHLART_TEXT[b.ZAHLART] || b.ZAHLART)] || 0) + b.BRUTTO;
      add('transactions_tse.csv', [...H, 'BON_ID', 'TSE_ID', 'TSE_TANR', 'TSE_TA_START', 'TSE_TA_ENDE', 'TSE_TA_VORGANGSART', 'TSE_TA_SIGZ', 'TSE_TA_SIG', 'TSE_TA_FEHLER', 'TSE_VORGANGSDATEN'],
        [[...bk, 1, b.TSE_TXNR || '', q(b.TSE_START || ''), q(b.TSE_ENDE || ''), q(b.TSE_VORGANGSART || 'Kassenbeleg-V1'), b.TSE_ZAEHLER || '', q(b.TSE_SIGNATUR || ''), q(b.TSE_FEHLER || (TSE.cfg().aktiv ? '' : 'Keine TSE aktiv')), q(b.TSE_DATEN || '')]]);
    }
    for (const g of Object.values(gv)) add('businesscases.csv', [...H, 'GV_TYP', 'GV_NAME', 'AGENTUR_ID', 'UST_SCHLUESSEL', 'Z_UMS_BRUTTO', 'Z_UMS_NETTO', 'Z_UST'], [[...zk, q(g.typ), q(''), 0, g.k, dec(g.b, 5), dec(g.n, 5), dec(g.b - g.n, 5)]]);
    for (const [k, v] of Object.entries(pay)) { const [t, n] = k.split('|'); add('payment.csv', [...H, 'ZAHLART_TYP', 'ZAHLART_NAME', 'Z_ZAHLART_BETRAG'], [[...zk, q(t), q(n), dec(v)]]); }
    add('cash_per_currency.csv', [...H, 'ZAHLART_WAEH', 'ZAHLART_BETRAG_WAEH'], [[...zk, q('EUR'), dec(z.BAR_EIN + z.BAR_AUS)]]);
  }
  const list = Object.entries(files).map(([name, lines]) => ({ name, data: Buffer.from(lines.join('\r\n') + '\r\n', 'utf8') }));
  const idx = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">\n<DataSet><Version>1.0</Version><DataSupplier><Name>${String(f.FIRMENNAME || '').replace(/&/g, '&amp;')}</Name><Location>${String(f.ORT || '').replace(/&/g, '&amp;')}</Location><Comment>DSFinV-K 2.3 Export Kuenta</Comment></DataSupplier><Media><Name>DSFinV-K</Name>\n${list.map(x => `<Table><URL>${x.name}</URL><Name>${x.name.replace('.csv', '')}</Name><DecimalSymbol>,</DecimalSymbol><DigitGroupingSymbol>.</DigitGroupingSymbol><VariableLength><ColumnDelimiter>;</ColumnDelimiter><RecordDelimiter>&#13;&#10;</RecordDelimiter><TextEncapsulator>"</TextEncapsulator>${files[x.name][0].split(';').map(c => `<VariableColumn><Name>${c}</Name><AlphaNumeric/></VariableColumn>`).join('')}</VariableLength></Table>`).join('\n')}\n</Media></DataSet>\n`;
  list.push({ name: 'index.xml', data: Buffer.from(idx, 'utf8') });
  return { buffer: writeZip(list), filename: `DSFinV-K_${kid}_${von || 'alle'}_${bis || ''}.zip`, abschluesse: zs.length };
}

module.exports = { status, bon, bewegung, storno, beleg, journal, abschlussVorschau, abschluss, abschluesse, abschlussDetail, dsfinvk, bestand };
