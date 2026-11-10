'use strict';
// Vehicle trading: stock vehicles, costing/expenses, sale, trade-in, purchase contracts, statistics
const L = require('../lib');

const num = x => { const n = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

// re-sum expenses and update the costing
function kalkulation(fahrid) {
  const d = L.db();
  const fz = d.prepare('SELECT * FROM FAHRZEUGE WHERE FAHR_ID=?').get(fahrid);
  if (!fz) throw new L.HttpError(404, 'Fahrzeug nicht gefunden');
  const auf = d.prepare("SELECT COALESCE(SUM(CASE WHEN TYP='G' THEN -BETRAGNETTO ELSE BETRAGNETTO END),0) s FROM FAHRZEUG_AUFWAND WHERE FAHRID=?").get(fahrid).s;
  const rate = L.mwstRates()[61] / 100;
  const diff = Number(fz.MWSTAUSWEISBAR) !== 1; // margin scheme
  const vkb = num(fz.VKPBRUTTO) || num(fz.VKP);
  const einsatz = L.r2(num(fz.EKP) + auf);
  let netto, mwst;
  if (diff) { const marge = Math.max(0, vkb - einsatz); mwst = L.r2(marge - marge / (1 + rate)); netto = L.r2(vkb - mwst); }
  else { netto = L.r2(vkb / (1 + rate)); mwst = L.r2(vkb - netto); }
  d.prepare('UPDATE FAHRZEUGE SET AUFWAND=?, EINSATZ=?, VKPNETTO=?, VKPMWST=?, VKPBRUTTO=?, VKP=? WHERE FAHR_ID=?').run(L.r2(auf), einsatz, netto, mwst, vkb, vkb, fahrid);
  return { aufwand: L.r2(auf), einsatz, vkbrutto: vkb, vknetto: netto, mwst, gewinn: L.r2(netto - einsatz), diffbesteuert: diff };
}
function aufwandListe(fahrid) { return L.db().prepare('SELECT * FROM FAHRZEUG_AUFWAND WHERE FAHRID=? ORDER BY DATUM, AUFWID').all(fahrid); }
function aufwandSpeichern(a) {
  const d = L.db();
  const v = [a.FAHRID, a.BESCHREIBUNG || '', a.DATUM || L.today(), a.TYP === 'G' ? 'G' : 'K', L.r2(num(a.BETRAGNETTO)), a.REID || null];
  if (a.AUFWID) d.prepare('UPDATE FAHRZEUG_AUFWAND SET FAHRID=?, BESCHREIBUNG=?, DATUM=?, TYP=?, BETRAGNETTO=?, REID=? WHERE AUFWID=?').run(...v, a.AUFWID);
  else d.prepare('INSERT INTO FAHRZEUG_AUFWAND (FAHRID, BESCHREIBUNG, DATUM, TYP, BETRAGNETTO, REID) VALUES (?,?,?,?,?,?)').run(...v);
  return kalkulation(a.FAHRID);
}
function aufwandLoeschen(id) { const a = L.db().prepare('SELECT FAHRID FROM FAHRZEUG_AUFWAND WHERE AUFWID=?').get(id); L.db().prepare('DELETE FROM FAHRZEUG_AUFWAND WHERE AUFWID=?').run(id); return a ? kalkulation(a.FAHRID) : {}; }

// move between stock <-> customer
function umbuchen(fahrid, { ziel, kunid, frztyp }) {
  const d = L.db();
  if (ziel === 'kunde') {
    d.prepare('UPDATE FAHRZEUGE SET FRZTYP=0, VERKAUF=COALESCE(VERKAUF,?), AENDERUNGSDATUM=? WHERE FAHR_ID=?').run(L.today(), L.now(), fahrid);
    if (kunid) d.prepare('INSERT OR IGNORE INTO KUNDEN_FAHRZEUGE (KUNID, FAHRID) VALUES (?,?)').run(kunid, fahrid);
  } else {
    d.prepare('UPDATE FAHRZEUGE SET FRZTYP=?, EINKAUF=COALESCE(EINKAUF,?), VERKAUF=NULL, AENDERUNGSDATUM=? WHERE FAHR_ID=?').run(Number(frztyp) === 1 ? 1 : 2, L.today(), L.now(), fahrid);
    if (L.sw('handel.halterentfernen', '1') === '1') d.prepare('DELETE FROM KUNDEN_FAHRZEUGE WHERE FAHRID=?').run(fahrid);
  }
  return { ok: true };
}

// Line item for a document (vehicle sale/purchase)
function position(fahrid, art = 'verkauf') {
  const fz = L.db().prepare('SELECT * FROM FAHRZEUGE WHERE FAHR_ID=?').get(fahrid);
  if (!fz) throw new L.HttpError(404, 'Fahrzeug nicht gefunden');
  if (art === 'verkauf') kalkulation(fahrid);
  const f = L.db().prepare('SELECT * FROM FAHRZEUGE WHERE FAHR_ID=?').get(fahrid);
  const diff = Number(f.MWSTAUSWEISBAR) !== 1;
  const text = [`${f.MARKE || ''} ${f.MODELL || ''}`.trim(), f.FZIDENTNR && `FIN: ${f.FZIDENTNR}`, f.EZ && `EZ: ${f.EZ.slice(8, 10)}.${f.EZ.slice(5, 7)}.${f.EZ.slice(0, 4)}`, f.KM && `km-Stand: ${f.KM}`, f.KENNZEICHEN && `Kennzeichen: ${f.KENNZEICHEN}`].filter(Boolean).join(', ');
  const preis = art === 'verkauf' ? num(f.VKPBRUTTO) || num(f.VKP) : num(f.EKP);
  return {
    POSART: 'F', ARTID: f.FAHR_ID, ARTNUMMER: f.FRZNUMMER ? String(f.FRZNUMMER) : '', BEZEICHNUNG: art === 'verkauf' ? (Number(f.FRZTYP) === 1 ? 'Neufahrzeug' : 'Gebrauchtfahrzeug') : 'Inzahlungnahme Gebrauchtfahrzeug',
    BESCHREIBUNG: text, MENGE: art === 'verkauf' ? 1 : -1, EINHEITID: null, MWST: diff || art !== 'verkauf' ? 63 : 61, DIFFSTEUER: diff || art !== 'verkauf' ? 1 : 0,
    VKBRUTTO: preis, VK: diff || art !== 'verkauf' ? preis : L.r2(preis / (1 + L.mwstRates()[61] / 100) * 10000) / 10000, EK: art === 'verkauf' ? num(f.EINSATZ) : 0, RABATT: 0,
  };
}

// After saving an invoice: move sold stock vehicles, put trade-ins into stock
function nachRechnung(rid) {
  const d = L.db();
  const k = d.prepare('SELECT * FROM RECHNUNGEN WHERE RECHNUNGID=?').get(rid);
  if (!k || k.TYP !== 1) return;
  for (const p of d.prepare("SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? AND POSART='F' AND ARTID>0").all(rid)) {
    const fz = d.prepare('SELECT * FROM FAHRZEUGE WHERE FAHR_ID=?').get(p.ARTID);
    if (!fz) continue;
    if (Number(p.MENGE) > 0) {
      if (d.prepare('SELECT ID FROM SW_FZVERKAUF WHERE FAHRID=? AND RECHNUNGID=?').get(fz.FAHR_ID, rid)) continue;
      d.prepare('INSERT INTO SW_FZVERKAUF (FAHRID, RECHNUNGID, DATUM, KUNID, VK, EK, AUFWAND, DIFFBESTEUERT, FRZTYP_VORHER, EINKAUF) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(fz.FAHR_ID, rid, k.DATUM, k.KUNID, L.r2(p.SUMMEBRUTTO), num(fz.EKP), num(fz.AUFWAND), Number(p.DIFFSTEUER) === 1 ? 1 : 0, fz.FRZTYP, fz.EINKAUF);
      if (Number(fz.FRZTYP) > 0) { umbuchen(fz.FAHR_ID, { ziel: 'kunde', kunid: k.KUNID }); d.prepare('UPDATE FAHRZEUGE SET VERKAUF=? WHERE FAHR_ID=?').run(k.DATUM, fz.FAHR_ID); }
    } else if (Number(fz.FRZTYP) === 0) {
      umbuchen(fz.FAHR_ID, { ziel: 'lager', frztyp: 2 });
      d.prepare('UPDATE FAHRZEUGE SET EKP=?, EINKAUF=? WHERE FAHR_ID=?').run(Math.abs(L.r2(p.SUMMEBRUTTO)), k.DATUM, fz.FAHR_ID);
    }
  }
}
// Cancellation: sold vehicles go back into stock
function nachStorno(rid) {
  for (const v of L.db().prepare('SELECT * FROM SW_FZVERKAUF WHERE RECHNUNGID=?').all(rid)) {
    if (v.FRZTYP_VORHER > 0) umbuchen(v.FAHRID, { ziel: 'lager', frztyp: v.FRZTYP_VORHER });
    L.db().prepare('DELETE FROM SW_FZVERKAUF WHERE ID=?').run(v.ID);
  }
}

function statistik(q) {
  const d = L.db(); const von = q.von || L.today().slice(0, 4) + '-01-01', bis = q.bis || L.today();
  const rows = d.prepare(`SELECT v.*, f.KENNZEICHEN, f.MARKE, f.MODELL, f.FZIDENTNR, f.FRZNUMMER, r.RECHNUNGNUMMER, TRIM(COALESCE(r.KUNNAME,'')||' '||COALESCE(r.KUNVORNAME,'')) KUNDE
    FROM SW_FZVERKAUF v LEFT JOIN FAHRZEUGE f ON f.FAHR_ID=v.FAHRID LEFT JOIN RECHNUNGEN r ON r.RECHNUNGID=v.RECHNUNGID WHERE v.DATUM BETWEEN ? AND ? ORDER BY v.DATUM`).all(von, bis);
  const rate = L.mwstRates()[61] / 100;
  for (const r of rows) {
    const einsatz = (r.EK || 0) + (r.AUFWAND || 0);
    const netto = r.DIFFBESTEUERT ? r.VK - Math.max(0, r.VK - einsatz) * rate / (1 + rate) : r.VK / (1 + rate);
    r.EINSATZ = L.r2(einsatz); r.VKNETTO = L.r2(netto); r.GEWINN = L.r2(netto - einsatz);
    r.STANDTAGE = r.EINKAUF ? Math.round((Date.parse(r.DATUM) - Date.parse(r.EINKAUF)) / 86400000) : null;
  }
  const s = k => L.r2(rows.reduce((a, r) => a + (r[k] || 0), 0));
  return { von, bis, rows, summe: { VK: s('VK'), EINSATZ: s('EINSATZ'), VKNETTO: s('VKNETTO'), GEWINN: s('GEWINN') } };
}
function bestand() {
  return L.db().prepare(`SELECT FAHR_ID, FRZNUMMER, FRZTYP, KENNZEICHEN, MARKE, MODELL, EZ, KM, EKP, AUFWAND, EINSATZ, VKPBRUTTO, EINKAUF, STANDORT,
    CAST(julianday('now') - julianday(EINKAUF) AS INTEGER) STANDTAGE FROM FAHRZEUGE WHERE FRZTYP IN (1,2) ORDER BY EINKAUF`).all();
}

// ---------- Purchase contracts ----------
function vertragNeu(q) {
  const d = L.db();
  const nr = (d.prepare('SELECT MAX(NUMMER) m FROM SW_KAUFVERTRAG').get().m || Number(L.sw('kaufvertrag.start', '0'))) + 1;
  const v = { NUMMER: nr, ART: q.art === 'NW' ? 'NW' : 'GW', DATUM: L.today(), GEWAEHRLEISTUNG: 0, DIFFBESTEUERT: q.art === 'NW' ? 0 : 1, ZAHLUNGSWEISE: 'Barzahlung bei Übergabe', VORVERTRAGLICH: L.sw('kaufvertrag.vorvertraglich', '') };
  if (q.fahrid) Object.assign(v, fahrzeugFuerVertrag(q.fahrid));
  if (q.kunid) Object.assign(v, kundeFuerVertrag(q.kunid));
  return v;
}
function fahrzeugFuerVertrag(fahrid) {
  const f = L.db().prepare('SELECT * FROM FAHRZEUGE WHERE FAHR_ID=?').get(fahrid); if (!f) return {};
  return { FAHRID: f.FAHR_ID, FAHRZEUG: JSON.stringify({ marke: f.MARKE, modell: f.MODELL, fin: f.FZIDENTNR, kennzeichen: f.KENNZEICHEN, ez: f.EZ, briefnr: f.FRZBRIEFNR, farbe: f.FARBE, kw: f.KW, ps: f.PS, kraftstoff: f.KRAFTSTOFF, vorbesitzer: f.VORBESITZER }),
    KMSTAND: f.KM, HU: f.HU, KAUFPREIS: num(f.VKPBRUTTO) || num(f.VKP), DIFFBESTEUERT: Number(f.MWSTAUSWEISBAR) === 1 ? 0 : 1, UNFALLSCHAEDEN: f.UNFALLSCHADEN || '', MAENGEL: f.ALLGZUSTAND || '' };
}
function kundeFuerVertrag(kunid) {
  const k = L.db().prepare('SELECT * FROM KUNDEN WHERE KUNID=?').get(kunid); if (!k) return {};
  return { KUNID: k.KUNID, KAEUFER: JSON.stringify({ anrede: k.ANREDE, name: k.NAME, vorname: k.VORNAME, zusatz: k.ZUSATZ, strasse: k.STRASSE, plz: k.PLZ, ort: k.ORT, telefon: k.TELEFON || k.MOBIL, email: k.EMAIL, gebdatum: k.GEBDATUM, nummer: k.NUMMER }), UNTERNEHMER: Number(k.ART) === 1 ? 1 : 0 };
}
function vertrag(id) { const v = L.db().prepare('SELECT * FROM SW_KAUFVERTRAG WHERE ID=?').get(id); if (!v) throw new L.HttpError(404, 'Kaufvertrag nicht gefunden'); return v; }
function vertragSpeichern(v) {
  const d = L.db();
  if (Number(v.GEWAEHRLEISTUNG) === 2 && !Number(v.UNTERNEHMER) && v.ART === 'GW') throw new L.HttpError(400, 'Ein vollständiger Gewährleistungsausschluss ist gegenüber Verbrauchern unzulässig (§ 476 BGB). Wählen Sie die Verkürzung auf ein Jahr oder kennzeichnen Sie den Käufer als Unternehmer.');
  // Take buyer/vehicle data as a snapshot; entered values (e.g. price) take precedence
  const fill = (src) => { for (const [k, val] of Object.entries(src)) if (k === 'KAEUFER' || k === 'FAHRZEUG' || v[k] == null || v[k] === '') v[k] = val; };
  if (v.KUNID) fill(kundeFuerVertrag(v.KUNID));
  if (v.FAHRID) fill(fahrzeugFuerVertrag(v.FAHRID));
  v.AENDERUNGSDATUM = L.now();
  const cols = [...L.tableColumns('SW_KAUFVERTRAG')].filter(c => c !== 'ID' && v[c] !== undefined);
  let id = Number(v.ID) || null;
  if (id) d.prepare(`UPDATE SW_KAUFVERTRAG SET ${cols.map(c => c + '=?').join(',')} WHERE ID=?`).run(...cols.map(c => v[c] === '' ? null : v[c]), id);
  else id = Number(d.prepare(`INSERT INTO SW_KAUFVERTRAG (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => v[c] === '' ? null : v[c])).lastInsertRowid);
  return vertrag(id);
}
function vertragLoeschen(id) { L.db().prepare('DELETE FROM SW_KAUFVERTRAG WHERE ID=?').run(id); return { ok: true }; }
// Invoice from a purchase contract
function vertragRechnung(id, user) {
  const VG = require('./vorgang');
  const v = vertrag(id);
  if (v.RECHNUNGID) throw new L.HttpError(409, 'Zu diesem Kaufvertrag wurde bereits eine Rechnung erstellt.');
  if (!v.KUNID || !v.FAHRID) throw new L.HttpError(400, 'Kaufvertrag benötigt Käufer und Fahrzeug.');
  const t = VG.template('rechnung', { kunid: v.KUNID }); delete t.kopf._kunde;
  t.kopf.ANSICHTBRUTTO = 1; t.kopf.FAHRID = null;
  const p = position(v.FAHRID, 'verkauf'); p.VKBRUTTO = num(v.KAUFPREIS);
  if (!Number(p.DIFFSTEUER)) p.VK = L.r2(p.VKBRUTTO / (1 + L.mwstRates()[61] / 100) * 10000) / 10000; else p.VK = p.VKBRUTTO;
  const pos = [p];
  if (num(v.INZAHLUNGNAHMEBETRAG)) pos.push({ POSART: 'A', BEZEICHNUNG: 'Inzahlungnahme', BESCHREIBUNG: v.INZAHLUNGNAHME || '', MENGE: -1, VKBRUTTO: num(v.INZAHLUNGNAHMEBETRAG), VK: num(v.INZAHLUNGNAHMEBETRAG), MWST: 63, DIFFSTEUER: 1 });
  t.kopf.EINLEITUNGTXT = `Gemäß Kaufvertrag Nr. ${v.NUMMER} vom ${v.DATUM.slice(8, 10)}.${v.DATUM.slice(5, 7)}.${v.DATUM.slice(0, 4)}`;
  const r = VG.save('rechnung', { kopf: t.kopf, pos }, user);
  L.db().prepare('UPDATE SW_KAUFVERTRAG SET RECHNUNGID=? WHERE ID=?').run(r.kopf.RECHNUNGID, id);
  if (num(v.ANZAHLUNG)) VG.addPayment({ RECHNUNGID: r.kopf.RECHNUNGID, BETRAG: num(v.ANZAHLUNG), ZAHLUNGSARTID: 1, BANKNAME: 'Anzahlung lt. Kaufvertrag' }, user);
  return { id: r.kopf.RECHNUNGID, nr: r.kopf.RECHNUNGNUMMER };
}

module.exports = { kalkulation, aufwandListe, aufwandSpeichern, aufwandLoeschen, umbuchen, position, nachRechnung, nachStorno, statistik, bestand, vertragNeu, vertrag, vertragSpeichern, vertragLoeschen, vertragRechnung };
