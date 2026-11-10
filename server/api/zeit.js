'use strict';
// Time tracking, time clock, time account, performance rate
const L = require('../lib');

const ARTEN = { A: 'Arbeitszeit', P: 'Pause', J: 'Auftrag', U: 'Urlaub', K: 'Krankheit', F: 'Feiertag', S: 'Sonstige Abwesenheit', B: 'Berufsschule' };
const pad = n => String(n).padStart(2, '0');
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = t => { if (!t) return null; const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// public holidays (nationwide + per federal state)
function ostern(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
function feiertage(y, land = L.sw('zeit.bundesland', 'HE')) {
  const o = ostern(y); const off = n => new Date(o.getTime() + n * 86400000).toISOString().slice(0, 10);
  const f = { [`${y}-01-01`]: 'Neujahr', [off(-2)]: 'Karfreitag', [off(1)]: 'Ostermontag', [`${y}-05-01`]: 'Tag der Arbeit', [off(39)]: 'Christi Himmelfahrt', [off(50)]: 'Pfingstmontag', [`${y}-10-03`]: 'Tag der Deutschen Einheit', [`${y}-12-25`]: '1. Weihnachtstag', [`${y}-12-26`]: '2. Weihnachtstag' };
  if (['BW', 'BY', 'ST'].includes(land)) f[`${y}-01-06`] = 'Heilige Drei Könige';
  if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(land)) f[off(60)] = 'Fronleichnam';
  if (['SL'].includes(land)) f[`${y}-08-15`] = 'Mariä Himmelfahrt';
  if (['BB', 'MV', 'SN', 'ST', 'TH', 'HB', 'HH', 'NI', 'SH'].includes(land)) f[`${y}-10-31`] = 'Reformationstag';
  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(land)) f[`${y}-11-01`] = 'Allerheiligen';
  if (['BE', 'MV'].includes(land)) f[`${y}-03-08`] = 'Frauentag';
  if (['TH'].includes(land)) f[`${y}-09-20`] = 'Weltkindertag';
  return f;
}

function mitarbeiter() {
  return L.db().prepare("SELECT BENUTZERID, PERSONALNR, ANREDE, VORNAME, NAME, SOLLMO, SOLLDI, SOLLMI, SOLLDO, SOLLFR, SOLLSA, SOLLSO, URLAUBSANSPRUCH, EINTRITT FROM BENUTZER WHERE COALESCE(ZEITERFASSUNG,0)=1 ORDER BY NAME, VORNAME").all();
}
function sollTag(m, iso) {
  const wd = new Date(iso + 'T12:00:00Z').getUTCDay();
  return Number(m[['SOLLSO', 'SOLLMO', 'SOLLDI', 'SOLLMI', 'SOLLDO', 'SOLLFR', 'SOLLSA'][wd]] || 0);
}

function minuten(e) {
  if (e.MINUTEN != null && !e.BEGINN) return e.MINUTEN;
  const b = toMin(e.BEGINN), en = toMin(e.ENDE);
  if (b == null || en == null) return e.MINUTEN || 0;
  return en >= b ? en - b : en + 1440 - b;
}

// ---------- Time clock ----------
function benutzerPerNr(nr) {
  const b = L.db().prepare('SELECT * FROM BENUTZER WHERE PERSONALNR=? AND COALESCE(ZEITERFASSUNG,0)=1').get(String(nr || '').trim());
  if (!b) throw new L.HttpError(404, 'Unbekannte Personalnummer.');
  return b;
}
function offene(benid, art) { return L.db().prepare(`SELECT * FROM SW_ZEIT WHERE BENID=? AND ENDE IS NULL AND BEGINN IS NOT NULL ${art ? 'AND ART=?' : ''} ORDER BY ID DESC`).all(...(art ? [benid, art] : [benid])); }
function close(e, t) {
  L.db().prepare('UPDATE SW_ZEIT SET ENDE=?, MINUTEN=?, AENDERUNGSDATUM=? WHERE ID=?').run(t, minuten({ ...e, ENDE: t }), L.now(), e.ID);
}
function stempeln({ PERSONALNR, AKTION, AUFTRAGNR, NOTIZ }) {
  const b = benutzerPerNr(PERSONALNR); const d = L.db();
  const now = new Date(); const datum = L.today(); const t = hm(now);
  pruefeOffen(b.BENUTZERID, datum);
  const ins = (art, extra = {}) => d.prepare('INSERT INTO SW_ZEIT (BENID, ART, DATUM, BEGINN, AUFTRAGID, NOTIZ, QUELLE, AENDERUNGSDATUM) VALUES (?,?,?,?,?,?,?,?)').run(b.BENUTZERID, art, datum, t, extra.auftrag || null, NOTIZ || null, 'Stempeluhr', L.now());
  const name = [b.VORNAME, b.NAME].filter(Boolean).join(' ');
  switch (AKTION) {
    case 'kommen':
      if (offene(b.BENUTZERID, 'A').length) throw new L.HttpError(409, `${name} ist bereits eingestempelt.`);
      ins('A'); return { meldung: `Willkommen, ${name}! Kommen um ${t} Uhr.` };
    case 'gehen': {
      const a = offene(b.BENUTZERID, 'A'); if (!a.length) throw new L.HttpError(409, `${name} ist nicht eingestempelt.`);
      for (const e of offene(b.BENUTZERID)) close(e, t);
      return { meldung: `Auf Wiedersehen, ${name}! Gehen um ${t} Uhr.` };
    }
    case 'pause':
      if (!offene(b.BENUTZERID, 'A').length) throw new L.HttpError(409, `${name} ist nicht eingestempelt.`);
      if (offene(b.BENUTZERID, 'P').length) throw new L.HttpError(409, 'Die Pause läuft bereits.');
      for (const e of offene(b.BENUTZERID, 'J')) close(e, t);
      ins('P'); return { meldung: `Pause ab ${t} Uhr. Guten Appetit!` };
    case 'pauseende': {
      const p = offene(b.BENUTZERID, 'P'); if (!p.length) throw new L.HttpError(409, 'Es läuft keine Pause.');
      p.forEach(e => close(e, t)); return { meldung: `Pause beendet um ${t} Uhr.` };
    }
    case 'auftrag': {
      const a = d.prepare('SELECT AUFTRAGID, AUFTRAGNUMMER, KUNNAME, FAHRKENNZEICHEN FROM AUFTRAEGE WHERE AUFTRAGNUMMER=?').get(Number(AUFTRAGNR));
      if (!a) throw new L.HttpError(404, `Auftrag ${AUFTRAGNR} nicht gefunden.`);
      if (!offene(b.BENUTZERID, 'A').length) ins('A');
      for (const e of offene(b.BENUTZERID, 'J')) close(e, t);
      ins('J', { auftrag: a.AUFTRAGID });
      return { meldung: `Auftrag ${a.AUFTRAGNUMMER} (${a.KUNNAME || ''} ${a.FAHRKENNZEICHEN || ''}) gestartet um ${t} Uhr.` };
    }
    case 'auftragende': {
      const j = offene(b.BENUTZERID, 'J'); if (!j.length) throw new L.HttpError(409, 'Kein Auftrag gestartet.');
      j.forEach(e => close(e, t)); return { meldung: `Auftrag beendet um ${t} Uhr.` };
    }
    default: throw new L.HttpError(400, 'Unbekannte Aktion');
  }
}
// close forgotten clock-ins from the previous day (end = start, with a note)
function pruefeOffen(benid, heute) {
  for (const e of L.db().prepare('SELECT * FROM SW_ZEIT WHERE BENID=? AND ENDE IS NULL AND BEGINN IS NOT NULL AND DATUM<?').all(benid, heute)) {
    L.db().prepare("UPDATE SW_ZEIT SET ENDE=BEGINN, MINUTEN=0, NOTIZ=TRIM(COALESCE(NOTIZ,'')||' (Ausstempeln vergessen – bitte korrigieren)') WHERE ID=?").run(e.ID);
  }
}
function anwesenheit() {
  const d = L.db(); const heute = L.today();
  return mitarbeiter().map(m => {
    const offen = d.prepare('SELECT * FROM SW_ZEIT WHERE BENID=? AND DATUM=? AND ENDE IS NULL AND BEGINN IS NOT NULL').all(m.BENUTZERID, heute);
    const a = offen.find(e => e.ART === 'A'), p = offen.find(e => e.ART === 'P'), j = offen.find(e => e.ART === 'J');
    const auftrag = j ? d.prepare('SELECT AUFTRAGNUMMER, FAHRKENNZEICHEN FROM AUFTRAEGE WHERE AUFTRAGID=?').get(j.AUFTRAGID) : null;
    const abw = d.prepare("SELECT ART FROM SW_ZEIT WHERE BENID=? AND DATUM=? AND ART IN ('U','K','S','B')").get(m.BENUTZERID, heute);
    return { BENUTZERID: m.BENUTZERID, NAME: [m.VORNAME, m.NAME].filter(Boolean).join(' '), PERSONALNR: m.PERSONALNR,
      status: p ? 'Pause' : a ? 'anwesend' : abw ? ARTEN[abw.ART] : 'abwesend', seit: (p || a || {}).BEGINN || null, auftrag: auftrag ? `${auftrag.AUFTRAGNUMMER} ${auftrag.FAHRKENNZEICHEN || ''}` : null };
  });
}

// ---------- Monthly report ----------
function monat(benid, mon) {
  const d = L.db();
  const m = d.prepare('SELECT * FROM BENUTZER WHERE BENUTZERID=?').get(benid);
  if (!m) throw new L.HttpError(404, 'Mitarbeiter nicht gefunden');
  const [y, mo] = mon.split('-').map(Number);
  const tage = new Date(y, mo, 0).getDate();
  const ft = feiertage(y);
  const eintr = d.prepare('SELECT z.*, a.AUFTRAGNUMMER FROM SW_ZEIT z LEFT JOIN AUFTRAEGE a ON a.AUFTRAGID=z.AUFTRAGID WHERE z.BENID=? AND substr(z.DATUM,1,7)=? ORDER BY z.DATUM, z.BEGINN, z.ID').all(benid, mon);
  const rows = []; let soll = 0, ist = 0, urlaub = 0, krank = 0;
  for (let t = 1; t <= tage; t++) {
    const iso = `${mon}-${pad(t)}`;
    const es = eintr.filter(e => e.DATUM === iso);
    let s = ft[iso] ? 0 : sollTag(m, iso);
    if (m.EINTRITT && iso < m.EINTRITT) s = 0;
    const zukunft = iso > L.today();
    const arbeit = es.filter(e => e.ART === 'A').reduce((a, e) => a + minuten(e), 0);
    const pause = es.filter(e => e.ART === 'P').reduce((a, e) => a + minuten(e), 0);
    const abw = es.find(e => ['U', 'K', 'S', 'B'].includes(e.ART));
    let i = Math.max(0, arbeit - pause) / 60;
    // statutory minimum break (ArbZG §4) when none was clocked
    if (L.sw('zeit.autopause', '1') === '1' && !pause && arbeit > 0) { if (arbeit > 540) i -= 0.75; else if (arbeit > 360) i -= 0.5; }
    if (abw) { i += s; if (abw.ART === 'U') urlaub += s ? 1 : 0; if (abw.ART === 'K') krank += s ? 1 : 0; }
    if (!zukunft) soll += s; ist += i;
    rows.push({ datum: iso, wochentag: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(iso + 'T12:00:00Z').getUTCDay()], feiertag: ft[iso] || null, soll: s, ist: L.r2(i), saldo: zukunft ? 0 : L.r2(i - s), pause: pause, zukunft, abwesenheit: abw ? ARTEN[abw.ART] : null,
      kommen: (es.filter(e => e.ART === 'A').map(e => e.BEGINN).sort()[0]) || null, gehen: (es.filter(e => e.ART === 'A').map(e => e.ENDE).filter(Boolean).sort().pop()) || null, eintraege: es.length });
  }
  const vorher = d.prepare('SELECT * FROM SW_ZEIT_MONAT WHERE BENID=? AND MONAT<? ORDER BY MONAT DESC LIMIT 1').get(benid, mon);
  const korr = d.prepare('SELECT * FROM SW_ZEIT_KORREKTUR WHERE BENID=? AND MONAT=?').all(benid, mon);
  const korrStd = korr.reduce((s, k) => s + (k.STUNDEN || 0), 0), korrUrl = korr.reduce((s, k) => s + (k.URLAUBSTAGE || 0), 0);
  const vortrag = vorher ? vorher.SALDO : 0;
  const urlaubVor = vorher ? vorher.URLAUBREST : (mo === 1 || !vorher ? Number(m.URLAUBSANSPRUCH || 0) : 0);
  const urlaubBasis = mo === 1 ? Number(m.URLAUBSANSPRUCH || 0) + (vorher && vorher.MONAT.startsWith(String(y - 1)) && L.sw('zeit.resturlaubuebertragen', '1') === '1' ? vorher.URLAUBREST : 0) : urlaubVor;
  const abschluss = d.prepare('SELECT * FROM SW_ZEIT_MONAT WHERE BENID=? AND MONAT=?').get(benid, mon);
  return {
    mitarbeiter: { id: m.BENUTZERID, name: [m.VORNAME, m.NAME].filter(Boolean).join(' '), personalnr: m.PERSONALNR },
    monat: mon, tage: rows, eintraege: eintr, korrekturen: korr,
    summe: { soll: L.r2(soll), ist: L.r2(ist), saldo: L.r2(ist - soll), vortrag: L.r2(vortrag), korrektur: L.r2(korrStd), konto: L.r2(vortrag + ist - soll + korrStd), urlaub, krank, urlaubRest: L.r2(urlaubBasis - urlaub + korrUrl) },
    abgeschlossen: abschluss && abschluss.ABGESCHLOSSEN ? abschluss.ABGESCHLOSSEN : null,
  };
}
function istAbgeschlossen(benid, datum) {
  const r = L.db().prepare('SELECT ABGESCHLOSSEN FROM SW_ZEIT_MONAT WHERE BENID=? AND MONAT=?').get(benid, String(datum).slice(0, 7));
  return !!(r && r.ABGESCHLOSSEN);
}
function monatsabschluss(benid, mon) {
  const ids = benid ? [Number(benid)] : mitarbeiter().map(m => m.BENUTZERID);
  const out = [];
  for (const id of ids) {
    const r = monat(id, mon);
    if (r.abgeschlossen) continue;
    L.db().prepare('INSERT OR REPLACE INTO SW_ZEIT_MONAT (BENID, MONAT, SOLL, IST, SALDO, VORTRAG, URLAUB, KRANK, URLAUBREST, ABGESCHLOSSEN) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, mon, r.summe.soll, r.summe.ist, r.summe.konto, r.summe.vortrag, r.summe.urlaub, r.summe.krank, r.summe.urlaubRest, L.now());
    out.push({ id, name: r.mitarbeiter.name, konto: r.summe.konto });
  }
  return { abgeschlossen: out };
}
function monatOeffnen(benid, mon) { L.db().prepare('UPDATE SW_ZEIT_MONAT SET ABGESCHLOSSEN=NULL WHERE BENID=? AND MONAT=?').run(benid, mon); return { ok: true }; }

// ---------- Bookings ----------
function speichern(e, user) {
  const d = L.db();
  if (!e.BENID || !e.DATUM || !e.ART) throw new L.HttpError(400, 'Mitarbeiter, Datum und Art angeben.');
  if (istAbgeschlossen(e.BENID, e.DATUM)) throw new L.HttpError(409, 'Der Monat ist abgeschlossen. Änderungen sind nicht mehr möglich.');
  if (e.ID) { const old = d.prepare('SELECT * FROM SW_ZEIT WHERE ID=?').get(e.ID); if (old && istAbgeschlossen(old.BENID, old.DATUM)) throw new L.HttpError(409, 'Der Monat ist abgeschlossen.'); }
  const bisDatum = e.BISDATUM && e.BISDATUM > e.DATUM && ['U', 'K', 'S', 'B'].includes(e.ART) ? e.BISDATUM : null;
  const vals = r => [r.BENID, r.ART, r.DATUM, r.BEGINN || null, r.ENDE || null, r.BEGINN && r.ENDE ? minuten(r) : (r.MINUTEN ?? null), r.AUFTRAGID || null, r.NOTIZ || null, r.QUELLE || 'manuell', L.now()];
  if (e.ID) { d.prepare('UPDATE SW_ZEIT SET BENID=?, ART=?, DATUM=?, BEGINN=?, ENDE=?, MINUTEN=?, AUFTRAGID=?, NOTIZ=?, QUELLE=?, AENDERUNGSDATUM=? WHERE ID=?').run(...vals(e), e.ID); }
  else if (bisDatum) {
    for (let t = e.DATUM; t <= bisDatum; t = L.addDays(t, 1)) d.prepare('INSERT INTO SW_ZEIT (BENID, ART, DATUM, BEGINN, ENDE, MINUTEN, AUFTRAGID, NOTIZ, QUELLE, AENDERUNGSDATUM) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...vals({ ...e, DATUM: t }));
  } else d.prepare('INSERT INTO SW_ZEIT (BENID, ART, DATUM, BEGINN, ENDE, MINUTEN, AUFTRAGID, NOTIZ, QUELLE, AENDERUNGSDATUM) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...vals(e));
  L.protocol(user && user.name, 'SW_ZEIT', e.ID || '', e.ID ? 'geändert' : 'angelegt', e);
  return { ok: true };
}
function loeschen(id, user) {
  const e = L.db().prepare('SELECT * FROM SW_ZEIT WHERE ID=?').get(id);
  if (e && istAbgeschlossen(e.BENID, e.DATUM)) throw new L.HttpError(409, 'Der Monat ist abgeschlossen.');
  L.db().prepare('DELETE FROM SW_ZEIT WHERE ID=?').run(id);
  L.protocol(user && user.name, 'SW_ZEIT', id, 'gelöscht', e);
  return { ok: true };
}
function liste(q) {
  const w = ['1=1']; const p = [];
  if (q.benid) { w.push('z.BENID=?'); p.push(Number(q.benid)); }
  if (q.von) { w.push('z.DATUM>=?'); p.push(q.von); }
  if (q.bis) { w.push('z.DATUM<=?'); p.push(q.bis); }
  if (q.arten) { const a = String(q.arten).split(',').filter(x => ARTEN[x]); w.push(`z.ART IN (${a.map(() => '?').join(',')})`); p.push(...a); }
  return L.db().prepare(`SELECT z.*, TRIM(COALESCE(b.VORNAME,'')||' '||COALESCE(b.NAME,'')) MITARBEITER, a.AUFTRAGNUMMER, a.KUNNAME, a.FAHRKENNZEICHEN FROM SW_ZEIT z
    LEFT JOIN BENUTZER b ON b.BENUTZERID=z.BENID LEFT JOIN AUFTRAEGE a ON a.AUFTRAGID=z.AUFTRAGID WHERE ${w.join(' AND ')} ORDER BY z.DATUM DESC, z.BEGINN DESC LIMIT 3000`).all(...p)
    .map(r => ({ ...r, ARTTEXT: ARTEN[r.ART] || r.ART, STUNDEN: L.r2(minuten(r) / 60) }));
}
function korrektur(k) {
  if (istAbgeschlossen(k.BENID, k.MONAT + '-01')) throw new L.HttpError(409, 'Der Monat ist abgeschlossen.');
  if (k.ID) L.db().prepare('UPDATE SW_ZEIT_KORREKTUR SET STUNDEN=?, URLAUBSTAGE=?, NOTIZ=? WHERE ID=?').run(Number(k.STUNDEN) || 0, Number(k.URLAUBSTAGE) || 0, k.NOTIZ || '', k.ID);
  else L.db().prepare('INSERT INTO SW_ZEIT_KORREKTUR (BENID, MONAT, STUNDEN, URLAUBSTAGE, NOTIZ) VALUES (?,?,?,?,?)').run(k.BENID, k.MONAT, Number(k.STUNDEN) || 0, Number(k.URLAUBSTAGE) || 0, k.NOTIZ || '');
  return { ok: true };
}
function korrekturLoeschen(id) { L.db().prepare('DELETE FROM SW_ZEIT_KORREKTUR WHERE ID=?').run(id); return { ok: true }; }

// ---------- Performance rate ----------
function vorgabeStunden(auftragid) {
  const awMin = Number(L.sw('zeit.awminuten', '6')) || 6;
  const rows = L.db().prepare("SELECT p.MENGE, e.BEZEICHNUNG EINHEIT FROM AUFTRAEGE_POS p LEFT JOIN EINHEITEN e ON e.EINHEITID=p.EINHEITID WHERE p.AUFTRAGID=? AND p.POSART='L' AND COALESCE(p.DURCHLAUFER,0)=0").all(auftragid);
  let h = 0;
  for (const r of rows) { const e = String(r.EINHEIT || '').toLowerCase(); if (/^aw/.test(e)) h += (r.MENGE || 0) * awMin / 60; else if (/std|stunde|^h$/.test(e)) h += r.MENGE || 0; }
  return L.r2(h);
}
function leistungsgrad(q) {
  const d = L.db(); const von = q.von || L.today().slice(0, 7) + '-01', bis = q.bis || L.today();
  const j = d.prepare(`SELECT z.*, TRIM(COALESCE(b.VORNAME,'')||' '||COALESCE(b.NAME,'')) MITARBEITER FROM SW_ZEIT z LEFT JOIN BENUTZER b ON b.BENUTZERID=z.BENID WHERE z.ART='J' AND z.DATUM BETWEEN ? AND ? AND z.AUFTRAGID IS NOT NULL`).all(von, bis);
  const auftr = {};
  for (const e of j) { const a = auftr[e.AUFTRAGID] || (auftr[e.AUFTRAGID] = { AUFTRAGID: e.AUFTRAGID, ist: 0, ma: {} }); const h = minuten(e) / 60; a.ist += h; a.ma[e.MITARBEITER] = (a.ma[e.MITARBEITER] || 0) + h; }
  const proAuftrag = Object.values(auftr).map(a => {
    const k = d.prepare('SELECT AUFTRAGNUMMER, DATUM, KUNNAME, FAHRKENNZEICHEN FROM AUFTRAEGE WHERE AUFTRAGID=?').get(a.AUFTRAGID) || {};
    const vorgabe = vorgabeStunden(a.AUFTRAGID);
    return { ...k, AUFTRAGID: a.AUFTRAGID, vorgabe, ist: L.r2(a.ist), grad: a.ist ? Math.round(vorgabe / a.ist * 100) : null, mitarbeiter: Object.keys(a.ma).join(', ') };
  }).sort((a, b) => (b.AUFTRAGNUMMER || 0) - (a.AUFTRAGNUMMER || 0));
  const ma = {};
  for (const a of Object.values(auftr)) {
    const vorgabe = vorgabeStunden(a.AUFTRAGID);
    for (const [n, h] of Object.entries(a.ma)) { const x = ma[n] || (ma[n] = { mitarbeiter: n, ist: 0, vorgabe: 0, auftraege: 0 }); x.ist += h; x.vorgabe += a.ist ? vorgabe * h / a.ist : 0; x.auftraege++; }
  }
  const proMitarbeiter = Object.values(ma).map(x => ({ ...x, ist: L.r2(x.ist), vorgabe: L.r2(x.vorgabe), grad: x.ist ? Math.round(x.vorgabe / x.ist * 100) : null }));
  return { von, bis, proAuftrag, proMitarbeiter };
}

module.exports = { ARTEN, feiertage, mitarbeiter, stempeln, anwesenheit, monat, monatsabschluss, monatOeffnen, speichern, loeschen, liste, korrektur, korrekturLoeschen, leistungsgrad };
