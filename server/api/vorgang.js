'use strict';
// Documents: quote, order, delivery note, invoice, invoice correction
const { V, LINKS } = require('../../public/js/entities.js');
const L = require('../lib');

function vt(typ) {
  const v = V[typ];
  if (!v) throw new L.HttpError(404, 'Unbekannter Vorgangstyp: ' + typ);
  return v;
}
const num = x => { const n = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

// ---------- Calculation ----------
function calc(kopf, pos) {
  const rates = L.mwstRates();
  const brutto = Number(kopf.ANSICHTBRUTTO) === 1;
  const groups = {};
  let einsatz = 0; let sub = 0;
  // US: labor is non-taxable in many states (setting)
  const usLaborFree = L.land() === 'US' && L.sw('us.labor.taxable', '0') !== '1';
  pos.forEach((p, i) => {
    p.PRTSORT = i + 1;
    if (p.POSART === 'T') { p.SUMME = 0; p.SUMMEBRUTTO = 0; p.POS = 0; return; }
    if (p.POSART === 'Z') { p.SUMME = L.r2(sub); p.SUMMEBRUTTO = 0; p.POS = 0; sub = 0; return; }
    let code = Number(p.DURCHLAUFER) === 1 || Number(p.DIFFSTEUER) === 1 || kopf.STEUERART ? 63 : (Number(p.MWST) || 61);
    if (usLaborFree && p.POSART === 'L') code = 63;
    if (!p.MWST) p.MWST = 61;
    const rate = rates[code] ?? 0;
    const menge = num(p.MENGE), rab = num(p.RABATT);
    let vk, vkb;
    if (brutto) { vkb = num(p.VKBRUTTO); vk = vkb / (1 + rate / 100); }
    else { vk = num(p.VK); vkb = vk * (1 + rate / 100); }
    p.VK = vk; p.VKBRUTTO = vkb; p.VKNETTO_RUND = vk; p.VKBRUTTO_RUND = vkb;
    p.MENGE = menge; p.RABATT = rab; p.EK = num(p.EK);
    p.SUMME = menge * vk * (1 - rab / 100);
    p.SUMMEBRUTTO = menge * vkb * (1 - rab / 100);
    sub += brutto ? p.SUMMEBRUTTO : p.SUMME;
    einsatz += menge * p.EK;
    const g = groups[code] || (groups[code] = { rate, netto: 0, brutto: 0, konto: {} });
    g.netto += p.SUMME; g.brutto += p.SUMMEBRUTTO;
  });
  let pnr = 0; for (const p of pos) if (p.POSART !== 'T' && p.POSART !== 'Z') p.POS = ++pnr;
  const tax = {}; let gn = 0, gb = 0, gre = 0;
  // Spain: recargo de equivalencia on top of the IVA for customers in that regime
  const ES = require('../es');
  const conRecargo = Number(kopf.ESRECARGO) === 1 && ES.activo();
  for (const [code, g] of Object.entries(groups)) {
    let n, m, b;
    if (brutto) { b = L.r2(g.brutto); n = L.r2(b / (1 + g.rate / 100)); m = L.r2(b - n); }
    else { n = L.r2(g.netto); m = L.r2(n * g.rate / 100); b = L.r2(n + m); }
    const reRate = conRecargo && g.rate > 0 && Number(code) !== 63 ? ES.recargo(g.rate) : 0;
    const re = reRate ? L.r2(n * reRate / 100) : 0;
    b = L.r2(b + re);
    tax[code] = { rate: g.rate, netto: n, mwst: m, brutto: b };
    if (reRate) Object.assign(tax[code], { reRate, recargo: re });
    gn += n; gb += b; gre += re;
  }
  kopf.GNETTO = L.r2(gn); kopf.GBRUTTO = L.r2(gb); kopf.GRECARGO = L.r2(gre);
  kopf.GMWST1 = tax[61] ? tax[61].mwst : 0;
  kopf.GMWST2 = tax[62] ? tax[62].mwst : 0;
  kopf.GMWSTAT = tax[64] ? tax[64].mwst : 0;
  kopf.EINSATZ = L.r2(einsatz);
  return tax;
}

// ---------- Load ----------
function load(typ, id) {
  const v = vt(typ); const d = L.db();
  const kopf = d.prepare(`SELECT * FROM ${v.table} WHERE ${v.pk}=?`).get(id);
  if (!kopf) throw new L.HttpError(404, `${v.title} nicht gefunden`);
  const pos = d.prepare(`SELECT * FROM ${v.pos} WHERE ${v.pk}=? ORDER BY PRTSORT, ${v.posPk}`).all(id);
  const res = { typ, kopf, pos, tax: calc({ ...kopf }, pos.map(p => ({ ...p }))) };
  if (v.table === 'RECHNUNGEN') {
    res.zahlungen = d.prepare('SELECT z.*, a.ART ZAHLART FROM ZAHLUNGSEINGAENGE z LEFT JOIN ZAHLUNGSART a ON a.ID=z.ZAHLUNGSARTID WHERE RECHNUNGID=? ORDER BY DATUM, ID').all(id);
    res.offen = L.r2(kopf.GBRUTTO - res.zahlungen.reduce((s, z) => s + z.BETRAG, 0));
    res.mahnungen = d.prepare('SELECT * FROM MAHNUNG WHERE RECHNUNGID=? ORDER BY MAHNDATUM').all(id);
  }
  res.verknuepft = related(v, kopf);
  if (v.table === 'RECHNUNGEN') {
    const ES = require('../es');
    if (ES.activo() || kopf.ESNUMSERIE) res.es = require('../es/verifactu').info(kopf);
  }
  return res;
}

function related(v, kopf) {
  const d = L.db(); const out = [];
  const links = LINKS[v.table] || {};
  for (const [t, col] of Object.entries(links)) {
    const id = kopf[col];
    if (id > 0) {
      const tv = V[t];
      const r = d.prepare(`SELECT ${tv.nr} nr, DATUM FROM ${tv.table} WHERE ${tv.pk}=?`).get(id);
      if (r) out.push({ typ: t, id, title: tv.title, nr: r.nr, datum: r.DATUM });
    }
  }
  if (v.table === 'RECHNUNGEN') {
    for (const [col, t] of [['GUTSCHRIFTID', 'korrektur'], ['REIDGUTSCHRIFT', 'rechnung']]) {
      if (kopf[col] > 0) {
        const r = d.prepare('SELECT RECHNUNGNUMMER nr, DATUM, TYP FROM RECHNUNGEN WHERE RECHNUNGID=?').get(kopf[col]);
        if (r) out.push({ typ: r.TYP === 2 ? 'korrektur' : 'rechnung', id: kopf[col], title: r.TYP === 2 ? 'Rechnungskorrektur' : 'Rechnung', nr: r.nr, datum: r.DATUM });
      }
    }
  }
  return out;
}

// ---------- New (default values) ----------
function template(typ, q = {}) {
  const v = vt(typ); const d = L.db();
  const kopf = {
    [v.nr]: L.nextNumber(v.numKey, v.table, v.nr, v.typ ? `TYP=${v.typ}` : ''),
    DATUM: L.today(), LIEFDATUM: L.today(), GEDRUCKT: 0, ARCHIV: 0,
    ANSICHTBRUTTO: L.land() === 'US' ? 0 : Number(L.sw('vorgang.ansichtbrutto', '1')), RABATTZEIGEN: 0, KUNLAND: L.land() !== 'DE' ? L.land() : L.opt('Länderkürzel', 'DE'),
    DRUCKFORMULAR: v.form, BENID: -1, AUFTYPID: -1,
  };
  if (v.typ) kopf.TYP = v.typ;
  const zb = d.prepare("SELECT * FROM ZAHLUNGSBEDINUNGEN ORDER BY CASE WHEN NAME='Standard' THEN 0 ELSE 1 END, ZAHLBDID LIMIT 1").get();
  if (zb) applyZahlbd(kopf, zb);
  for (const dt of d.prepare('SELECT * FROM DRUCKTEXTBAUSTEINE WHERE TXTART=? AND TXTARTSTANDARD=1').all(v.txtArt)) {
    kopf.EINLEITUNGTXT = dt.EINLEITUNG; kopf.SCHLUSSTXT = dt.SCHLUSSTEXT;
  }
  if (q.kunid) Object.assign(kopf, kundeFelder(q.kunid));
  if (q.fahrid) Object.assign(kopf, fahrzeugFelder(q.fahrid));
  return { typ, kopf, pos: [], neu: true };
}

function applyZahlbd(kopf, zb) {
  kopf.ZAHLBDID = zb.ZAHLBDID; kopf.FAELLING = zb.TAGEFAELLIG || 0; kopf.TAGESKONTO = zb.TAGESKONTO || 0;
  kopf.SKONTO = zb.SKONTO || 0; kopf.ZAHLBDTEXT = zb.TEXT;
}

function kundeFelder(kunid) {
  const d = L.db();
  const k = d.prepare('SELECT * FROM KUNDEN WHERE KUNID=?').get(kunid);
  if (!k) throw new L.HttpError(404, 'Kunde nicht gefunden');
  const f = {
    KUNID: k.KUNID, KUNNUMMER: k.NUMMER, KUNART: k.ART, KUNANREDE: k.ANREDE, KUNNAME: k.NAME, KUNVORNAME: k.VORNAME,
    KUNZUSATZ: k.ZUSATZ, KUNSTRASSE: k.STRASSE, KUNPLZ: k.PLZ, KUNORT: k.ORT, KUNLAND: k.LAND || (L.land() !== 'DE' ? L.land() : 'DE'),
    RABATTART: k.RABATTART || 0, RABATTLOHN: k.RABATTLOHN || 0,
  };
  if (k.AUSNETTO === 1) f.ANSICHTBRUTTO = 0;
  f.STEUERART = Number(k.NETTORECHNUNG) === 1 ? (k.EXPORTART || 'REVERSE_CHARGE') : null;
  if (f.STEUERART) f.ANSICHTBRUTTO = 0;
  f.ESRECARGO = Number(k.RECARGO) === 1 && require('../es').activo() ? 1 : 0;
  if (L.land() === 'US' && Number(k.TAXEXEMPT) === 1) f.STEUERART = 'EXEMPT'; // resale / exemption certificate
  if (L.land() === 'US') f.ANSICHTBRUTTO = 0; // US prices are quoted before sales tax
  if (f.ESRECARGO) f.ANSICHTBRUTTO = 0;
  if (k.KUNZAHLBDID) {
    const zb = d.prepare('SELECT * FROM ZAHLUNGSBEDINUNGEN WHERE ZAHLBDID=?').get(k.KUNZAHLBDID);
    if (zb) applyZahlbd(f, zb);
  }
  f._kunde = { ANMERKUNG: k.ANMERKUNG, ZEIGANMERKUNG: k.ZEIGANMERKUNG, PREISGRUPPE: k.PREISGRUPPE, EMAIL: k.EMAIL, TELEFON: k.TELEFON, MOBIL: k.MOBIL };
  return f;
}
function fahrzeugFelder(fahrid) {
  const fz = L.db().prepare('SELECT * FROM FAHRZEUGE WHERE FAHR_ID=?').get(fahrid);
  if (!fz) throw new L.HttpError(404, 'Fahrzeug nicht gefunden');
  return {
    FAHRID: fz.FAHR_ID, FAHRNUMMER: fz.FRZNUMMER, FAHRKENNZEICHEN: fz.KENNZEICHEN, FAHRHSN: fz.SCHLUESSNR1, FAHRTSN: fz.SCHLUESSNR2,
    FAHRMARKE: fz.MARKE, FAHRMODELL: fz.MODELL, FAHRIDENTNR: fz.FZIDENTNR, FAHREZ: fz.EZ, FAHRKM: parseInt(fz.KM, 10) || 0, FAHRHU: fz.HU,
  };
}

// ---------- Save ----------
function save(typ, payload, user) {
  const v = vt(typ); const d = L.db();
  const kopfIn = { ...(payload.kopf || {}) };
  const pos = (payload.pos || []).map(p => ({ ...p }));
  const id = Number(kopfIn[v.pk]) || null;
  if (v.table === 'RECHNUNGEN') {
    // Only Kuenta assigns invoice numbers: a new invoice gets the next number, an existing one keeps its number.
    // So typing cannot create gaps, and two workstations never get the same number.
    const old = id ? d.prepare(`SELECT ${v.nr} nr FROM ${v.table} WHERE ${v.pk}=?`).get(id) : null;
    kopfIn[v.nr] = old ? old.nr : L.nextNumber(v.numKey, v.table, v.nr, `TYP=${v.typ}`);
    const ES = require('../es');
    if (id && require('../es/verifactu').vigente(id)) throw new L.HttpError(409, 'Die Rechnung ist ausgestellt und an VERI*FACTU gemeldet. Sie kann nicht mehr geändert werden. Bitte erstellen Sie eine Rechnungskorrektur.');
    // Spain: never reuse a number that was already reported (e.g. after restoring an older backup)
    if (!old && ES.activo()) kopfIn[v.nr] = Math.max(kopfIn[v.nr], require('../es/verifactu').siguienteNumero(ES.serie(v.typ)));
  }
  if (!kopfIn[v.nr]) kopfIn[v.nr] = L.nextNumber(v.numKey, v.table, v.nr, v.typ ? `TYP=${v.typ}` : '');
  kopfIn[v.nr] = parseInt(kopfIn[v.nr], 10);
  if (!Number.isFinite(kopfIn[v.nr])) throw new L.HttpError(400, 'Die Vorgangsnummer muss eine Zahl sein.');
  const dup = d.prepare(`SELECT ${v.pk} id FROM ${v.table} WHERE ${v.nr}=? ${v.typ ? 'AND TYP=' + v.typ : ''}`).get(kopfIn[v.nr]);
  if (dup && dup.id !== id) throw new L.HttpError(409, `Die Nummer ${kopfIn[v.nr]} ist bereits vergeben.`);
  if (!kopfIn.DATUM) kopfIn.DATUM = L.today();
  if (v.typ) kopfIn.TYP = v.typ;
  if (id && v.table === 'RECHNUNGEN') {
    const old = d.prepare('SELECT GEDRUCKT FROM RECHNUNGEN WHERE RECHNUNGID=?').get(id);
    if (old && old.GEDRUCKT && L.sw('gobd.sperre', '0') === '1') throw new L.HttpError(409, 'Gedruckte Rechnungen sind gesperrt (GoBD). Bitte erstellen Sie eine Rechnungskorrektur.');
  }
  const tax = calc(kopfIn, pos);
  const cols = L.tableColumns(v.table); const pcols = L.tableColumns(v.pos);
  kopfIn.AENDERUNGSDATUM = L.now();
  const vals = {};
  for (const [k, val] of Object.entries(kopfIn)) if (cols.has(k) && k !== v.pk) vals[k] = val === '' ? null : val;
  d.exec('BEGIN');
  try {
    let vid = id;
    const keys = Object.keys(vals);
    if (vid) d.prepare(`UPDATE ${v.table} SET ${keys.map(k => `"${k}"=?`).join(',')} WHERE ${v.pk}=?`).run(...keys.map(k => vals[k]), vid);
    else vid = Number(d.prepare(`INSERT INTO ${v.table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => vals[k])).lastInsertRowid);
    if (v.table === 'RECHNUNGEN') lagerRevert(vid);
    d.prepare(`DELETE FROM ${v.pos} WHERE ${v.pk}=?`).run(vid);
    for (const p of pos) {
      p[v.pk] = vid;
      const pv = {};
      for (const [k, val] of Object.entries(p)) if (pcols.has(k) && k !== v.posPk) pv[k] = val === '' ? null : val;
      const pk = Object.keys(pv);
      d.prepare(`INSERT INTO ${v.pos} (${pk.map(k => `"${k}"`).join(',')}) VALUES (${pk.map(() => '?').join(',')})`).run(...pk.map(k => pv[k]));
    }
    L.commitNumber(v.numKey, kopfIn[v.nr]);
    if (kopfIn.FAHRID > 0) afterVehicle(v, vid, kopfIn);
    if (v.table === 'RECHNUNGEN') { fibuRechnung(vid); lagerBook(vid); recalcStatus(vid); upsertOp(vid); require('./handel').nachRechnung(vid); }
    d.exec('COMMIT');
    L.protocol(user && user.name, v.table, vid, id ? 'geändert' : 'angelegt', { nr: kopfIn[v.nr], brutto: kopfIn.GBRUTTO });
    return load(typ, vid);
  } catch (e) { d.exec('ROLLBACK'); throw e; }
}

function afterVehicle(v, vid, k) {
  const d = L.db();
  const ex = d.prepare('SELECT FZHISID FROM FAHRZEUGE_HISTORIE WHERE FAHRID=? AND VORGANGID=? AND VORGANGTYP=?').get(k.FAHRID, vid, v.histTyp);
  if (!ex) d.prepare('INSERT INTO FAHRZEUGE_HISTORIE (FAHRID, VORGANGID, VORGANGTYP) VALUES (?,?,?)').run(k.FAHRID, vid, v.histTyp);
  if (L.sw('vorgang.fahrzeugdatenuebernahme', '1') !== '1') return;
  const fz = d.prepare('SELECT KM, HU FROM FAHRZEUGE WHERE FAHR_ID=?').get(k.FAHRID);
  if (!fz) return;
  const km = parseInt(k.FAHRKM, 10) || 0;
  if (km > (parseInt(fz.KM, 10) || 0)) d.prepare('UPDATE FAHRZEUGE SET KM=?, AENDERUNGSDATUM=? WHERE FAHR_ID=?').run(String(km), L.now(), k.FAHRID);
  if (k.FAHRHU && k.FAHRHU !== fz.HU && k.FAHRHU > (fz.HU || '')) d.prepare('UPDATE FAHRZEUGE SET HU=? WHERE FAHR_ID=?').run(k.FAHRHU, k.FAHRID);
}

// ---------- Accounting (FIBU) ----------
function debitor(k) {
  const kd = k.KUNID ? L.db().prepare('SELECT DEBITORNR FROM KUNDEN WHERE KUNID=?').get(k.KUNID) : null;
  return require('../datev').debitorKonto(kd && kd.DEBITORNR, k.KUNNUMMER);
}
function fibuRechnung(rid) {
  const d = L.db();
  const k = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  d.prepare('DELETE FROM FIBU WHERE RECHID=? AND ZAHLID IS NULL AND COALESCE(EXPORTIERT,0)=0').run(rid);
  if (d.prepare('SELECT COUNT(*) n FROM FIBU WHERE RECHID=? AND ZAHLID IS NULL').get(rid).n) return; // already exported
  const rates = L.mwstRates();
  const pos = d.prepare("SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? AND POSART NOT IN ('T','Z')").all(rid);
  const kArt = L.optNum('FIBU-Einnahme-Artikel', 8400), kAw = L.optNum('FIBU-Einnahme-Arbeitswert', 8401), kDp = L.optNum('FIBU-Einnahme-Durch.Posten', 8402);
  const groups = {};
  for (const p of pos) {
    const dp = Number(p.DURCHLAUFER) === 1;
    const konto = dp ? kDp : p.POSART === 'F' ? (Number(p.DIFFSTEUER) === 1 ? L.optNum('FIBU-Erlöse-Fahrzeug-Diff', kArt) : L.optNum('FIBU-Erlöse-Fahrzeug', kArt)) : p.POSART === 'A' ? kArt : kAw;
    const rate = dp ? 0 : (rates[p.MWST] ?? 0);
    const key = konto + '|' + rate;
    groups[key] = (groups[key] || 0) + (Number(p.SUMMEBRUTTO) || 0);
  }
  const deb = debitor(k);
  const name = [k.KUNNAME, k.KUNVORNAME].filter(Boolean).join(' ');
  const ins = d.prepare('INSERT INTO FIBU (BELEGDATUM, SOLL, HABEN, BUCHUNGSTEXT, BELEGNUMMER, RECHID, BETRAG, ERSTELLUNGSDATUM, EXPORTIERT, STEUERSCHLUESSEL) VALUES (?,?,?,?,?,?,?,?,0,?)');
  // align gross totals per group with the invoice total (rounding)
  const entries = Object.entries(groups);
  const total = entries.reduce((s, [, b]) => s + b, 0);
  let diff = L.r2(k.GBRUTTO - L.r2(total));
  for (const [key, b] of entries) {
    const [konto, rate] = key.split('|').map(Number);
    let betrag = L.r2(b) + diff; diff = 0;
    if (!betrag) continue;
    ins.run(k.DATUM, deb, konto, `${k.TYP === 2 ? 'Rechnungskorrektur' : 'Rechnung'} an ${name}`, String(k.RECHNUNGNUMMER), rid, L.r2(betrag), L.today(), rate);
  }
}

// ---------- Stock ----------
function lagerRevert(rid) {
  const d = L.db();
  for (const b of d.prepare('SELECT ARTIKELID, ANZAHL FROM ARTBESTANDBEWEGUNGEN WHERE RECHNUNGID=?').all(rid)) {
    d.prepare('UPDATE ARTIKEL SET LAGER=COALESCE(LAGER,0)-? WHERE ARTID=?').run(b.ANZAHL, b.ARTIKELID);
  }
  d.prepare('DELETE FROM ARTBESTANDBEWEGUNGEN WHERE RECHNUNGID=?').run(rid);
}
function lagerBook(rid) {
  const d = L.db();
  const k = d.prepare('SELECT RECHNUNGNUMMER, DATUM, TYP FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  for (const p of d.prepare("SELECT RECHNUNGPOSID, ARTID, MENGE FROM RECHNUNGEN_POS WHERE RECHNUNGID=? AND POSART='A' AND ARTID>0").all(rid)) {
    const a = d.prepare('SELECT LAGERFUEHRUNG FROM ARTIKEL WHERE ARTID=?').get(p.ARTID);
    if (!a || Number(a.LAGERFUEHRUNG) !== 1) continue;
    const anz = -Number(p.MENGE || 0);
    d.prepare('INSERT INTO ARTBESTANDBEWEGUNGEN (DATUM, ARTIKELID, ANZAHL, BESCHREIBUNG, RECHNUNGID, RECHNUNGPOSID, EINGABETYP) VALUES (?,?,?,?,?,?,?)')
      .run(k.DATUM, p.ARTID, anz, `${k.TYP === 2 ? 'Rechnungskorrektur' : 'Rechnung'} ${k.RECHNUNGNUMMER}`, rid, p.RECHNUNGPOSID, 'R');
    d.prepare('UPDATE ARTIKEL SET LAGER=COALESCE(LAGER,0)+? WHERE ARTID=?').run(anz, p.ARTID);
  }
}

// ---------- Payment status / open items ----------
function recalcStatus(rid) {
  const d = L.db();
  const r = d.prepare('SELECT GBRUTTO FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  if (!r) return;
  const paid = d.prepare('SELECT COALESCE(SUM(BETRAG),0) s FROM ZAHLUNGSEINGAENGE WHERE RECHNUNGID=?').get(rid).s;
  const offen = L.r2(r.GBRUTTO - paid);
  const st = Math.abs(offen) < 0.005 ? 2 : Math.abs(paid) > 0.004 ? 1 : 0;
  d.prepare('UPDATE RECHNUNGEN SET ZAHLSTATUS=? WHERE RECHNUNGID=?').run(st, rid);
  return { offen, status: st };
}
function upsertOp(rid) {
  const d = L.db();
  const r = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  const st = recalcStatus(rid);
  d.prepare('DELETE FROM OP WHERE RECHNUNGID=?').run(rid);
  if (st.status === 2) return;
  const faellig = L.addDays(r.DATUM, r.FAELLING || 0);
  const skd = L.addDays(r.DATUM, r.TAGESKONTO || 0);
  d.prepare('INSERT INTO OP (RECHNUNGID, BRUTTO, SKONTO, SKONTODATUM, FAELLIGDATUM, AENDERUNGSDATUM, MAHNSTUFE) VALUES (?,?,?,?,?,?,?)')
    .run(rid, st.offen, L.r2(r.GBRUTTO * (r.SKONTO || 0) / 100), skd, faellig, L.now(),
      (d.prepare('SELECT MAX(MAHNSTUFE) m FROM MAHNUNG WHERE RECHNUNGID=?').get(rid).m) || 0);
}

// ---------- Payments ----------
function addPayment(p, user) {
  const d = L.db();
  const r = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(p.RECHNUNGID);
  if (!r) throw new L.HttpError(404, 'Rechnung nicht gefunden');
  const betrag = L.r2(num(p.BETRAG));
  if (!betrag) throw new L.HttpError(400, 'Bitte einen Betrag eingeben.');
  const art = d.prepare('SELECT * FROM ZAHLUNGSART WHERE ID=?').get(p.ZAHLUNGSARTID) || { ID: 3, ART: 'Überweisung', KASSENBUCH: 0 };
  const datum = p.DATUM || L.today();
  d.exec('BEGIN');
  try {
    const zid = Number(d.prepare('INSERT INTO ZAHLUNGSEINGAENGE (RECHNUNGID, BETRAG, ZAHLUNGSARTID, DATUM, AENDERUNGSDATUM, BANKNAME, GUTSCHRIFTID) VALUES (?,?,?,?,?,?,?)')
      .run(r.RECHNUNGID, betrag, art.ID, datum, L.now(), p.BANKNAME || '', p.GUTSCHRIFTID || -1).lastInsertRowid);
    let kid = null;
    const name = [r.KUNNAME, r.KUNVORNAME].filter(Boolean).join(' ');
    if (Number(art.KASSENBUCH) === 1) {
      kid = Number(d.prepare('INSERT INTO KASSENBUCH (ART, EMPFAENGER, VERWENDUNG, DATUM, AUSGABEN, EINNAHMEN, BELEGNUMMER, RECHID, AENDERUNGSDATUM, ZAHLID, STEUERSCHLUESSEL) VALUES (?,?,?,?,?,?,?,?,?,?,0)')
        .run(betrag >= 0 ? 1 : 2, `${r.KUNNUMMER || ''} ${name}`.trim(), `${art.ART} zur Rechnung-Nr.: ${r.RECHNUNGNUMMER}`, datum, betrag < 0 ? -betrag : 0, betrag >= 0 ? betrag : 0, String(r.RECHNUNGNUMMER), r.RECHNUNGID, L.now(), zid).lastInsertRowid);
    }
    if (art.ID !== 6) { // do not book credit notes that were offset
      const soll = Number(art.KASSENBUCH) === 1 ? L.optNum('FIBU-Kasse', 1000) : art.ART === 'Krypto (BTCPay)' ? require('../btcpay').cfg().konto : bankKonto(p.BANKNAME);
      d.prepare('INSERT INTO FIBU (BELEGDATUM, SOLL, HABEN, BUCHUNGSTEXT, BELEGNUMMER, RECHID, ZAHLID, BETRAG, ERSTELLUNGSDATUM, EXPORTIERT, KASSENID) VALUES (?,?,?,?,?,?,?,?,?,0,?)')
        .run(datum, soll, debitor(r), `Zahlung zu Rechnung ${r.RECHNUNGNUMMER}`, String(r.RECHNUNGNUMMER), r.RECHNUNGID, zid, betrag, L.today(), kid);
    }
    upsertOp(r.RECHNUNGID);
    d.exec('COMMIT');
    L.protocol(user && user.name, 'ZAHLUNGSEINGAENGE', zid, 'angelegt', { rechnung: r.RECHNUNGNUMMER, betrag });
    return { id: zid };
  } catch (e) { d.exec('ROLLBACK'); throw e; }
}
function bankKonto(name) {
  for (const i of [1, 2, 3]) if (name && L.opt(`FIBU-Bank${i}Name`) === name) return L.optNum(`FIBU-Bank${i}`, 1200);
  return L.optNum('FIBU-Bank1', 1200);
}
function deletePayment(zid, user) {
  const d = L.db();
  const z = d.prepare('SELECT * FROM ZAHLUNGSEINGAENGE WHERE ID=?').get(zid);
  if (!z) throw new L.HttpError(404, 'Zahlung nicht gefunden');
  d.exec('BEGIN');
  try {
    d.prepare('DELETE FROM KASSENBUCH WHERE ZAHLID=?').run(zid);
    d.prepare('DELETE FROM FIBU WHERE ZAHLID=?').run(zid);
    d.prepare('DELETE FROM ZAHLUNGSEINGAENGE WHERE ID=?').run(zid);
    upsertOp(z.RECHNUNGID);
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  L.protocol(user && user.name, 'ZAHLUNGSEINGAENGE', zid, 'gelöscht', z);
  return { ok: true };
}

// ---------- Delete ----------
function remove(typ, id, user) {
  const v = vt(typ); const d = L.db();
  const k = d.prepare(`SELECT * FROM ${v.table} WHERE ${v.pk}=?`).get(id);
  if (!k) throw new L.HttpError(404, `${v.title} nicht gefunden`);
  if (v.table === 'RECHNUNGEN') {
    const pays = d.prepare('SELECT COUNT(*) n FROM ZAHLUNGSEINGAENGE WHERE RECHNUNGID=?').get(id).n;
    if (pays) throw new L.HttpError(409, 'Zu dieser Rechnung sind Zahlungen erfasst. Bitte zuerst die Zahlungen löschen oder die Rechnung stornieren.');
    if (require('../es/verifactu').vigente(id)) throw new L.HttpError(409, 'Die Rechnung ist an VERI*FACTU gemeldet und darf nicht gelöscht werden. Bitte erstellen Sie eine Rechnungskorrektur.');
    if (k.GEDRUCKT) throw new L.HttpError(409, 'Die Rechnung wurde bereits gedruckt/versendet und darf nicht gelöscht werden (GoBD). Bitte stornieren Sie die Rechnung.');
    const exp = d.prepare('SELECT COUNT(*) n FROM FIBU WHERE RECHID=? AND EXPORTIERT=1').get(id).n;
    if (exp) throw new L.HttpError(409, 'Die Rechnung wurde bereits an die FIBU exportiert und kann nicht gelöscht werden.');
  }
  d.exec('BEGIN');
  try {
    if (v.table === 'RECHNUNGEN') {
      lagerRevert(id);
      d.prepare('DELETE FROM FIBU WHERE RECHID=?').run(id);
      d.prepare('DELETE FROM OP WHERE RECHNUNGID=?').run(id);
      d.prepare('DELETE FROM MAHNUNG WHERE RECHNUNGID=?').run(id);
      d.prepare('UPDATE RECHNUNGEN SET GUTSCHRIFTID=-1 WHERE GUTSCHRIFTID=?').run(id);
    }
    d.prepare(`DELETE FROM ${v.pos} WHERE ${v.pk}=?`).run(id);
    d.prepare(`DELETE FROM ${v.table} WHERE ${v.pk}=?`).run(id);
    d.prepare('DELETE FROM FAHRZEUGE_HISTORIE WHERE VORGANGID=? AND VORGANGTYP=?').run(id, v.histTyp);
    for (const [t, links] of Object.entries(LINKS)) {
      const col = links[typ === 'korrektur' ? 'rechnung' : typ];
      if (col && t !== v.table) d.prepare(`UPDATE ${t} SET ${col}=-1 WHERE ${col}=?`).run(id);
    }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  L.protocol(user && user.name, v.table, id, 'gelöscht', { nr: k[v.nr], brutto: k.GBRUTTO });
  return { ok: true };
}

// ---------- Continue / copy ----------
const KOPF_SKIP = new Set(['ESNUMSERIE', 'ESTIPO', 'ESRECT', 'GEDRUCKT', 'ARCHIV', 'AENDERUNGSDATUM', 'ZAHLSTATUS', 'GUTSCHRIFTID', 'REIDGUTSCHRIFT', 'AUFTRAGID', 'ANGEBOTID', 'LIEFERSCHEINID', 'RECHNUNGID', 'RECHID', 'LIEFID', 'TYP', 'DRUCKFORMULAR', 'ERECHNUNGERSTELLT', 'STORNOVONID', 'KEINEMAHNUNG']);
function convert(typ, id, ziel, mode, user) {
  const v = vt(typ); const zv = vt(ziel);
  const src = load(typ, id);
  const kopf = {};
  for (const [k, val] of Object.entries(src.kopf)) if (!KOPF_SKIP.has(k) && k !== v.pk && k !== v.nr) kopf[k] = val;
  kopf.DATUM = L.today();
  if (mode === 'kopieren') kopf.LIEFDATUM = L.today();
  kopf.DRUCKFORMULAR = zv.form;
  // texts of the target document
  const dt = L.db().prepare('SELECT * FROM DRUCKTEXTBAUSTEINE WHERE TXTART=? AND TXTARTSTANDARD=1').get(zv.txtArt);
  if (dt && typ !== ziel) { kopf.EINLEITUNGTXT = dt.EINLEITUNG; kopf.SCHLUSSTXT = dt.SCHLUSSTEXT; }
  const pos = src.pos.map(p => { const c = { ...p }; delete c[v.posPk]; delete c[v.pk]; return c; });
  if (mode === 'wandeln') {
    const back = LINKS[zv.table] && LINKS[zv.table][typ];
    if (back) kopf[back] = id;
    if (typ === 'lieferschein' && ziel === 'rechnung') pos.forEach((p, i) => { p.LIEFERSCHEINID = id; p.LIEFERSCHEINPOSID = src.pos[i][v.posPk]; });
  }
  if (mode === 'wandeln' && typ === 'auftrag' && ziel === 'rechnung') {
    const anz = anzahlungsRechnungen(id);
    if (anz.length) {
      pos.push({ POSART: 'T', BEZEICHNUNG: 'abzüglich bereits abgerechneter Anzahlungen / Abschläge:' });
      for (const a of anz) for (const ap of a.pos) pos.push({ ...ap, MENGE: -Number(ap.MENGE || 1), BEZEICHNUNG: `abzgl. ${ap.BEZEICHNUNG || 'Anzahlung'}`, BESCHREIBUNG: `Rechnung Nr. ${a.nr} vom ${de(a.datum)}` });
      kopf.DRUCKFORMULAR = 'schluss';
    }
  }
  const res = save(ziel, { kopf, pos }, user);
  const newId = res.kopf[zv.pk];
  if (mode === 'wandeln') {
    const fwd = LINKS[v.table] && LINKS[v.table][ziel === 'korrektur' ? 'rechnung' : ziel];
    if (fwd) L.db().prepare(`UPDATE ${v.table} SET ${fwd}=? WHERE ${v.pk}=?`).run(newId, id);
  }
  return { typ: ziel, id: newId, nr: res.kopf[zv.nr] };
}

function storno(id, user) {
  const d = L.db();
  const src = load('rechnung', id);
  if (src.kopf.GUTSCHRIFTID > 0) throw new L.HttpError(409, 'Diese Rechnung wurde bereits storniert.');
  const kopf = {};
  for (const [k, val] of Object.entries(src.kopf)) if (!KOPF_SKIP.has(k) && k !== 'RECHNUNGID' && k !== 'RECHNUNGNUMMER') kopf[k] = val;
  kopf.DATUM = L.today();
  kopf.DRUCKFORMULAR = 'storno-rechnung';
  kopf.REIDGUTSCHRIFT = id; kopf.STORNOVONID = id;
  kopf.EINLEITUNGTXT = `Stornorechnung zur Rechnung Nr. ${src.kopf.RECHNUNGNUMMER} vom ${de(src.kopf.DATUM)}.`;
  kopf.SCHLUSSTXT = '';
  const pos = src.pos.map(p => { const c = { ...p }; delete c.RECHNUNGPOSID; delete c.RECHNUNGID; if (c.POSART !== 'T' && c.POSART !== 'Z') c.MENGE = -Number(c.MENGE || 0); return c; });
  const res = save('korrektur', { kopf, pos }, user);
  const kid = res.kopf.RECHNUNGID;
  d.prepare('UPDATE RECHNUNGEN SET GUTSCHRIFTID=? WHERE RECHNUNGID=?').run(kid, id);
  require('./handel').nachStorno(id);
  d.prepare('UPDATE SW_ANZAHLUNGEN SET RECHNUNGID=NULL WHERE RECHNUNGID=?').run(id);
  // offset open amounts against each other
  const offen = src.offen;
  if (Math.abs(offen) > 0.004) {
    addPayment({ RECHNUNGID: id, BETRAG: offen, ZAHLUNGSARTID: 6, BANKNAME: `Storno ${res.kopf.RECHNUNGNUMMER}`, GUTSCHRIFTID: kid }, user);
    addPayment({ RECHNUNGID: kid, BETRAG: -offen, ZAHLUNGSARTID: 6, BANKNAME: `Storno zu ${src.kopf.RECHNUNGNUMMER}`, GUTSCHRIFTID: kid }, user);
  }
  return { typ: 'korrektur', id: kid, nr: res.kopf.RECHNUNGNUMMER };
}
const de = iso => iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '';

function setFlag(typ, ids, flag, value) {
  const v = vt(typ);
  if (!['GEDRUCKT', 'ARCHIV'].includes(flag)) throw new L.HttpError(400, 'Ungültig');
  if (v.table === 'RECHNUNGEN' && flag === 'GEDRUCKT') {
    const VF = require('../es/verifactu');
    for (const id of [].concat(ids)) {
      if (value && require('../es').activo()) VF.emitir(id); // printed = issued: create the VERI*FACTU record
      if (!value && VF.vigente(id)) throw new L.HttpError(409, 'Die Rechnung ist an VERI*FACTU gemeldet und bleibt als ausgestellt markiert.');
    }
  }
  const st = L.db().prepare(`UPDATE ${v.table} SET ${flag}=? WHERE ${v.pk}=?`);
  for (const id of [].concat(ids)) st.run(value ? 1 : 0, id);
  return { ok: true };
}

// ---------- Down payments / partial invoices ----------
function anzahlungsRechnungen(auftragid) {
  const d = L.db();
  return d.prepare('SELECT a.*, r.RECHNUNGNUMMER, r.DATUM RDATUM FROM SW_ANZAHLUNGEN a JOIN RECHNUNGEN r ON r.RECHNUNGID=a.RECHNUNGID WHERE a.AUFTRAGID=? AND COALESCE(r.GUTSCHRIFTID,-1)<=0').all(auftragid)
    .map(a => ({ nr: a.RECHNUNGNUMMER, datum: a.RDATUM, pos: d.prepare("SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? AND POSART NOT IN ('T','Z')").all(a.RECHNUNGID).map(p => { const c = { ...p }; delete c.RECHNUNGPOSID; delete c.RECHNUNGID; return c; }) }));
}
function anzahlungen(auftragid) {
  const d = L.db();
  const a = d.prepare('SELECT * FROM AUFTRAEGE WHERE AUFTRAGID=?').get(auftragid);
  if (!a) throw new L.HttpError(404, 'Auftrag nicht gefunden');
  const rows = d.prepare('SELECT x.*, r.RECHNUNGNUMMER, r.GBRUTTO FROM SW_ANZAHLUNGEN x LEFT JOIN RECHNUNGEN r ON r.RECHNUNGID=x.RECHNUNGID WHERE x.AUFTRAGID=? ORDER BY x.DATUM, x.ID').all(auftragid);
  return { auftrag: { id: a.AUFTRAGID, nr: a.AUFTRAGNUMMER, netto: a.GNETTO, brutto: a.GBRUTTO, kunde: [a.KUNNAME, a.KUNVORNAME].filter(Boolean).join(', ') }, rows };
}
function anzahlungSpeichern(x) {
  const d = L.db();
  if (x.ID) { const o = d.prepare('SELECT RECHNUNGID FROM SW_ANZAHLUNGEN WHERE ID=?').get(x.ID); if (o && o.RECHNUNGID) throw new L.HttpError(409, 'Zu dieser Anzahlung wurde bereits eine Rechnung erstellt.'); }
  const v = [x.AUFTRAGID, Number(x.ART) === 2 ? 2 : 1, x.DATUM || L.today(), x.BEZEICHNUNG || '', L.r2(num(x.NETTO)), Number(x.MWST) || 61];
  if (x.ID) d.prepare('UPDATE SW_ANZAHLUNGEN SET AUFTRAGID=?, ART=?, DATUM=?, BEZEICHNUNG=?, NETTO=?, MWST=? WHERE ID=?').run(...v, x.ID);
  else d.prepare('INSERT INTO SW_ANZAHLUNGEN (AUFTRAGID, ART, DATUM, BEZEICHNUNG, NETTO, MWST) VALUES (?,?,?,?,?,?)').run(...v);
  return anzahlungen(x.AUFTRAGID);
}
function anzahlungLoeschen(id) {
  const d = L.db(); const o = d.prepare('SELECT * FROM SW_ANZAHLUNGEN WHERE ID=?').get(id);
  if (o && o.RECHNUNGID) throw new L.HttpError(409, 'Zu dieser Anzahlung wurde bereits eine Rechnung erstellt. Bitte die Rechnung stornieren.');
  d.prepare('DELETE FROM SW_ANZAHLUNGEN WHERE ID=?').run(id);
  return o ? anzahlungen(o.AUFTRAGID) : {};
}
function anzahlungRechnung(id, user) {
  const d = L.db(); const x = d.prepare('SELECT * FROM SW_ANZAHLUNGEN WHERE ID=?').get(id);
  if (!x) throw new L.HttpError(404, 'Anzahlung nicht gefunden');
  if (x.RECHNUNGID) throw new L.HttpError(409, 'Rechnung bereits erstellt.');
  const a = load('auftrag', x.AUFTRAGID);
  const kopf = {};
  for (const [k, val] of Object.entries(a.kopf)) if (!KOPF_SKIP.has(k) && k !== 'AUFTRAGID' && k !== 'AUFTRAGNUMMER') kopf[k] = val;
  kopf.DATUM = L.today(); kopf.ANSICHTBRUTTO = 0; kopf.AUFTRAGID = x.AUFTRAGID;
  kopf.DRUCKFORMULAR = Number(x.ART) === 2 ? 'abschlag' : 'anzahlung';
  kopf.EINLEITUNGTXT = `${Number(x.ART) === 2 ? 'Abschlagsrechnung' : 'Anzahlungsrechnung'} zu Auftrag Nr. ${a.kopf.AUFTRAGNUMMER} vom ${de(a.kopf.DATUM)}.`;
  kopf.SCHLUSSTXT = 'Der Betrag wird in der Schlussrechnung verrechnet.';
  const pos = [{ POSART: 'L', BEZEICHNUNG: x.BEZEICHNUNG || (Number(x.ART) === 2 ? 'Abschlagszahlung' : 'Anzahlung'), BESCHREIBUNG: `zu Auftrag Nr. ${a.kopf.AUFTRAGNUMMER}`, MENGE: 1, VK: x.NETTO, MWST: x.MWST || 61 }];
  const r = save('rechnung', { kopf, pos }, user);
  d.prepare('UPDATE SW_ANZAHLUNGEN SET RECHNUNGID=? WHERE ID=?').run(r.kopf.RECHNUNGID, id);
  return { id: r.kopf.RECHNUNGID, nr: r.kopf.RECHNUNGNUMMER };
}

// ---------- Collective invoice ----------
function sammelrechnung(typ, ids, user) {
  if (!['auftrag', 'lieferschein'].includes(typ)) throw new L.HttpError(400, 'Sammelrechnungen nur aus Aufträgen oder Lieferscheinen.');
  const v = vt(typ); const d = L.db();
  const quellen = ids.map(id => load(typ, id)).sort((a, b) => String(a.kopf.DATUM).localeCompare(String(b.kopf.DATUM)));
  if (!quellen.length) throw new L.HttpError(400, 'Keine Belege ausgewählt.');
  if (new Set(quellen.map(q => q.kopf.KUNID)).size > 1) throw new L.HttpError(400, 'Eine Sammelrechnung ist nur für Belege desselben Kunden möglich.');
  const fertig = quellen.filter(q => (q.kopf.RECHNUNGID || -1) > 0);
  if (fertig.length) throw new L.HttpError(409, `Für ${v.title} ${fertig.map(q => q.kopf[v.nr]).join(', ')} wurde bereits eine Rechnung erstellt.`);
  const t = template('rechnung', { kunid: quellen[0].kopf.KUNID }); delete t.kopf._kunde;
  t.kopf.ANSICHTBRUTTO = quellen[0].kopf.ANSICHTBRUTTO;
  const last = quellen[quellen.length - 1].kopf;
  t.kopf.LIEFDATUM = last.LIEFDATUM || last.DATUM;
  t.kopf.EINLEITUNGTXT = `Sammelrechnung über ${quellen.length} ${quellen.length === 1 ? v.title : (typ === 'auftrag' ? 'Aufträge' : 'Lieferscheine')} (Leistungszeitraum ${de(quellen[0].kopf.DATUM)} – ${de(t.kopf.LIEFDATUM)}).`;
  const pos = [];
  for (const q of quellen) {
    pos.push({ POSART: 'T', BEZEICHNUNG: `${v.title} Nr. ${q.kopf[v.nr]} vom ${de(q.kopf.DATUM)}${q.kopf.FAHRKENNZEICHEN ? ' – ' + q.kopf.FAHRKENNZEICHEN + ' ' + [q.kopf.FAHRMARKE, q.kopf.FAHRMODELL].filter(Boolean).join(' ') : ''}` });
    for (const p of q.pos) { const c = { ...p }; delete c[v.posPk]; delete c[v.pk]; if (typ === 'lieferschein') { c.LIEFERSCHEINID = q.kopf[v.pk]; c.LIEFERSCHEINPOSID = p[v.posPk]; } pos.push(c); }
    pos.push({ POSART: 'Z', BEZEICHNUNG: `Summe ${v.title} ${q.kopf[v.nr]}` });
  }
  const r = save('rechnung', { kopf: t.kopf, pos }, user);
  for (const q of quellen) d.prepare(`UPDATE ${v.table} SET RECHNUNGID=? WHERE ${v.pk}=?`).run(r.kopf.RECHNUNGID, q.kopf[v.pk]);
  return { typ: 'rechnung', id: r.kopf.RECHNUNGID, nr: r.kopf.RECHNUNGNUMMER };
}

module.exports = { load, template, save, remove, convert, storno, setFlag, addPayment, deletePayment, kundeFelder, fahrzeugFelder, calc, recalcStatus, upsertOp, anzahlungen, anzahlungSpeichern, anzahlungLoeschen, anzahlungRechnung, sammelrechnung };

