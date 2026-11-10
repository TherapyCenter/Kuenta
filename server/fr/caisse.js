'use strict';
// French cash register law (art. 286 I 3° bis CGI, BOI-TVA-DECLA-30-10-30): conditions ISCA
// - Inaltérabilité: every receipt, closure and technical event is an entry signed with ECDSA P-256 and chained
//   to the previous entry of the same kind; corrections are new entries (cancellation receipts), nothing is deleted
// - Sécurisation: perpetual grand totals (GT and GT in absolute value), integrity check of all signatures
// - Conservation: daily, monthly and yearly closures with totals per VAT rate
// - Archivage: signed archive (ZIP) of a period with the public key for verification
// Entries are also appended to fr/journal.jsonl in the data folder (outside backups): restoring an older
// backup never loses an entry; the restore itself is recorded in the event log (JET).
// The certification (NF525 / LNE) is done by an accredited body; this module provides the technical basis.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('../lib');
const dbm = require('../db');
const pkg = require('../../package.json');

const activo = () => L.land() === 'FR';
const dir = () => path.join(dbm.DATA_DIR, 'fr');
const diario = () => path.join(dir(), 'journal.jsonl');
const kasse = () => L.sw('kasse.seriennummer', 'KASSE1');

// ---------- key pair (created once per company) ----------
function claves() {
  const priv = path.join(dir(), 'cle-privee.pem'), pub = path.join(dir(), 'cle-publique.pem');
  if (!fs.existsSync(priv)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
  }
  return { priv: fs.readFileSync(priv, 'utf8'), pub: fs.readFileSync(pub, 'utf8') };
}
const n2 = v => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
// the signed text: kind, number, time, register, amounts, data and the signature of the previous entry
const texto = e => [e.TYP, e.NR, e.ZEIT, e.KASSE, n2(e.TOTAL), n2(e.GT), n2(e.GTABS), e.DATEN, e.VORHER || ''].join('|');
const firmar = e => crypto.sign('sha256', Buffer.from(texto(e), 'utf8'), { key: claves().priv, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const comprobar = (e, pub) => { try { return crypto.verify('sha256', Buffer.from(texto(e), 'utf8'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(e.SIGNATUR, 'base64url')); } catch { return false; } };

// ---------- journal file and database ----------
const COLS = ['ID', 'TYP', 'NR', 'REF', 'ZEIT', 'KASSE', 'DATEN', 'TOTAL', 'GT', 'GTABS', 'VORHER', 'SIGNATUR'];
function anotar(e) {
  fs.mkdirSync(dir(), { recursive: true });
  const fd = fs.openSync(diario(), 'a');
  try { fs.writeSync(fd, JSON.stringify(e) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
const sincronizados = new WeakSet();
function asegurar() {
  const d = L.db();
  if (sincronizados.has(d)) return d;
  sincronizados.add(d);
  const regs = new Map();
  let txt = ''; try { txt = fs.readFileSync(diario(), 'utf8'); } catch { /* none yet */ }
  for (const line of txt.split('\n')) { if (!line.trim()) continue; try { const e = JSON.parse(line); regs.set(e.ID, e); } catch { /* torn last line */ } }
  const enDb = new Set(d.prepare('SELECT ID FROM SW_FR_JOURNAL').all().map(r => r.ID));
  for (const r of d.prepare('SELECT * FROM SW_FR_JOURNAL').all()) if (!regs.has(r.ID)) { anotar(r); regs.set(r.ID, r); }
  const faltan = [...regs.values()].filter(e => !enDb.has(e.ID));
  if (faltan.length) {
    const ins = d.prepare(`INSERT INTO SW_FR_JOURNAL (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
    d.exec('BEGIN'); try { for (const e of faltan) ins.run(...COLS.map(c => e[c] ?? null)); d.exec('COMMIT'); } catch (err) { d.exec('ROLLBACK'); throw err; }
  }
  return d;
}

const ultimo = (d, typ) => d.prepare('SELECT * FROM SW_FR_JOURNAL WHERE TYP=? ORDER BY NR DESC LIMIT 1').get(typ) || null;
// new signed entry; grand totals are kept for receipts and closures
function registrar(typ, { ref = null, total = 0, datos = {} } = {}) {
  const d = asegurar();
  const prev = ultimo(d, typ);
  const tickets = typ === 'ticket' ? prev : null;
  const e = {
    ID: d.prepare('SELECT COALESCE(MAX(ID),0)+1 n FROM SW_FR_JOURNAL').get().n, TYP: typ, NR: prev ? prev.NR + 1 : 1, REF: ref == null ? null : String(ref),
    ZEIT: new Date().toISOString(), KASSE: kasse(), DATEN: JSON.stringify(datos), TOTAL: Math.round(total * 100) / 100,
    GT: typ === 'ticket' ? Math.round(((tickets ? tickets.GT : 0) + total) * 100) / 100 : (datos.gt ?? 0),
    GTABS: typ === 'ticket' ? Math.round(((tickets ? tickets.GTABS : 0) + Math.abs(total)) * 100) / 100 : (datos.gtabs ?? 0),
    VORHER: prev ? prev.SIGNATUR : '',
  };
  e.SIGNATUR = firmar(e);
  anotar(e); // the file first: it survives restores
  d.prepare(`INSERT INTO SW_FR_JOURNAL (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`).run(...COLS.map(c => e[c] ?? null));
  return e;
}

// technical event log (journal des événements techniques)
function jet(evenement, detail = {}) { if (!activo()) return null; return registrar('jet', { ref: evenement, datos: { evenement, ...detail, version: pkg.version } }); }

// a receipt of the register: totals per VAT rate
function ticket(bonid) {
  if (!activo()) return null;
  const d = L.db();
  const b = d.prepare('SELECT * FROM SW_KASSE_BON WHERE ID=?').get(bonid); if (!b) return null;
  const tva = {};
  for (const p of d.prepare('SELECT MWSTSATZ, BRUTTO, NETTO FROM SW_KASSE_POS WHERE BONID=?').all(bonid)) {
    const t = tva[p.MWSTSATZ] || (tva[p.MWSTSATZ] = { ht: 0, tva: 0, ttc: 0 });
    t.ht += p.NETTO; t.ttc += p.BRUTTO; t.tva += p.BRUTTO - p.NETTO;
  }
  for (const t of Object.values(tva)) for (const k of Object.keys(t)) t[k] = Math.round(t[k] * 100) / 100;
  const vente = b.TYP === 'Beleg';
  const e = registrar('ticket', { ref: bonid, total: vente ? b.BRUTTO : 0, datos: { bon: b.BONNR, type: b.TYP, annule: b.STORNOID || null, paiement: b.ZAHLART, facture: b.RECHNUNGID || null, tva, mouvement: vente ? null : b.BRUTTO } });
  return { signature: e.SIGNATUR, nr: e.NR, gt: e.GT };
}

// closures: daily with the Z report, monthly and yearly; totals from the receipts since the last closure of that kind
function cloture(periode, ref, extra = {}) {
  if (!activo()) return null;
  const d = asegurar();
  const typ = { J: 'cloture_j', M: 'cloture_m', A: 'cloture_a' }[periode];
  const prev = ultimo(d, typ);
  const desde = prev ? JSON.parse(prev.DATEN).jusqua : 0;
  const tickets = d.prepare("SELECT * FROM SW_FR_JOURNAL WHERE TYP='ticket' AND NR>? ORDER BY NR").all(desde);
  const tva = {}; let total = 0;
  for (const t of tickets) {
    total += t.TOTAL;
    for (const [taux, v] of Object.entries(JSON.parse(t.DATEN).tva || {})) {
      const a = tva[taux] || (tva[taux] = { ht: 0, tva: 0, ttc: 0 });
      a.ht += v.ht; a.tva += v.tva; a.ttc += v.ttc;
    }
  }
  for (const t of Object.values(tva)) for (const k of Object.keys(t)) t[k] = Math.round(t[k] * 100) / 100;
  const last = ultimo(d, 'ticket');
  const e = registrar(typ, { ref, total, datos: { ...extra, periode: ref, depuis: desde, jusqua: last ? last.NR : desde, tickets: tickets.length, tva, gt: last ? last.GT : 0, gtabs: last ? last.GTABS : 0 } });
  jet('CLOTURE', { periode, ref });
  return e;
}
// daily closure with the Z report; a new month or year closes the previous one first
function clotureJour(znr) {
  if (!activo()) return null;
  const d = asegurar();
  const mois = L.today().slice(0, 7), an = L.today().slice(0, 4);
  const lm = ultimo(d, 'cloture_m'); const la = ultimo(d, 'cloture_a'); const lj = ultimo(d, 'cloture_j');
  const moisPrec = lj ? JSON.parse(lj.DATEN).mois : null;
  const e = cloture('J', `Z${znr}`, { mois });
  if (moisPrec && moisPrec !== mois && (!lm || lm.REF !== moisPrec)) cloture('M', moisPrec);
  if (moisPrec && moisPrec.slice(0, 4) !== an && (!la || la.REF !== moisPrec.slice(0, 4))) cloture('A', moisPrec.slice(0, 4));
  return e;
}

// reprint of a receipt: numbered duplicate, recorded in the event log
function duplicata(bonid) {
  if (!activo()) return null;
  const d = asegurar();
  const n = d.prepare("SELECT COUNT(*) n FROM SW_FR_JOURNAL WHERE TYP='jet' AND REF='DUPLICATA' AND DATEN LIKE ?").get(`%"bon":${Number(bonid)},%`).n + 1;
  jet('DUPLICATA', { bon: Number(bonid), numero: n });
  return { numero: n };
}

// integrity check of all chains and grand totals
function verifier() {
  const d = asegurar(); const pub = claves().pub;
  const erreurs = []; let n = 0;
  for (const typ of ['ticket', 'cloture_j', 'cloture_m', 'cloture_a', 'jet']) {
    let prev = null; let gt = 0, gtabs = 0;
    for (const e of d.prepare('SELECT * FROM SW_FR_JOURNAL WHERE TYP=? ORDER BY NR').all(typ)) {
      n++;
      if (!comprobar(e, pub)) erreurs.push(`${typ} ${e.NR}: signature invalide`);
      if ((prev ? prev.SIGNATUR : '') !== (e.VORHER || '')) erreurs.push(`${typ} ${e.NR}: chaînage rompu`);
      if (prev && e.NR !== prev.NR + 1) erreurs.push(`${typ} ${e.NR}: numérotation discontinue`);
      if (typ === 'ticket') {
        gt = Math.round((gt + e.TOTAL) * 100) / 100; gtabs = Math.round((gtabs + Math.abs(e.TOTAL)) * 100) / 100;
        if (Math.abs(gt - e.GT) > 0.005 || Math.abs(gtabs - e.GTABS) > 0.005) erreurs.push(`ticket ${e.NR}: grand total incohérent`);
      }
      prev = e;
    }
  }
  if (erreurs.length) jet('ERREUR_INTEGRITE', { erreurs: erreurs.slice(0, 20) });
  return { ok: !erreurs.length, entrees: n, erreurs };
}

// signed archive of a period: entries as CSV, the signature of the archive and the public key
function archive({ von, bis } = {}) {
  const d = asegurar();
  von = von || L.today().slice(0, 4) + '-01-01'; bis = bis || L.today();
  const rows = d.prepare('SELECT * FROM SW_FR_JOURNAL WHERE substr(ZEIT,1,10) BETWEEN ? AND ? ORDER BY TYP, NR').all(von, bis);
  const q = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = Buffer.from([COLS.join(';'), ...rows.map(r => COLS.map(c => q(r[c])).join(';'))].join('\r\n') + '\r\n', 'utf8');
  const hash = crypto.createHash('sha256').update(csv).digest('hex');
  const sig = crypto.sign('sha256', Buffer.from(hash), { key: claves().priv, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const info = JSON.stringify({ logiciel: 'Kuenta', version: pkg.version, siren: require('./index').siren(), caisse: kasse(), du: von, au: bis, entrees: rows.length, sha256: hash, signature: sig, algorithme: 'ECDSA P-256 SHA-256 (IEEE P1363, base64url)' }, null, 2);
  const zip = require('../import/zip').writeZip([
    { name: 'journal.csv', data: csv }, { name: 'archive.json', data: Buffer.from(info) }, { name: 'cle-publique.pem', data: Buffer.from(claves().pub) },
    { name: 'LISEZMOI.txt', data: Buffer.from('Archive signée Kuenta. journal.csv contient toutes les entrées (tickets, clôtures, événements) avec leur signature chaînée.\r\narchive.json contient l\'empreinte SHA-256 de journal.csv et sa signature, vérifiable avec cle-publique.pem.\r\n') }]);
  jet('ARCHIVE', { du: von, au: bis, entrees: rows.length, sha256: hash });
  return { buffer: zip, filename: `Kuenta_archive_${von}_${bis}.zip` };
}

function liste({ typ, limit = 500 } = {}) {
  return asegurar().prepare(`SELECT ID, TYP, NR, REF, ZEIT, KASSE, TOTAL, GT, GTABS, DATEN, substr(SIGNATUR,1,16) SIG FROM SW_FR_JOURNAL ${typ ? 'WHERE TYP=?' : ''} ORDER BY ID DESC LIMIT ${Math.min(Number(limit) || 500, 10000)}`).all(...(typ ? [typ] : []));
}
function infoTicket(bonid) {
  if (!activo()) return null;
  const e = asegurar().prepare("SELECT NR, SIGNATUR, GT FROM SW_FR_JOURNAL WHERE TYP='ticket' AND REF=?").get(String(bonid));
  return e ? { nr: e.NR, signature: e.SIGNATUR, court: e.SIGNATUR.slice(-4).toUpperCase() } : null;
}

module.exports = { activo, ticket, cloture, clotureJour, jet, duplicata, verifier, archive, liste, infoTicket, claves };
