'use strict';
// Fichier des écritures comptables (FEC, art. L47 A and A47 A-1 LPF): all accounting entries of the period in the
// 18 mandatory columns, tab separated, dates YYYYMMDD, amounts with a decimal comma. File name SIRENFECyyyymmdd.txt.
// Journals: VE sales, AC purchases, BQ bank, CA cash. Accounts of the plan comptable général (adjustable).
const L = require('../lib');

const HEAD = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const JOURNAUX = { VE: 'Ventes', AC: 'Achats', BQ: 'Banque', CA: 'Caisse' };
const d8 = iso => String(iso || '').slice(0, 10).replace(/-/g, '');
const m = v => (Math.round(Math.abs(Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',');
const clean = s => String(s ?? '').replace(/[\t\r\n|]/g, ' ').trim();

function comptes() {
  const c = (k, d) => L.sw('fr.compte.' + k, d);
  return { clients: c('clients', '411000'), fournisseurs: c('fournisseurs', '401000'), services: c('services', '706000'), marchandises: c('marchandises', '707000'),
    debours: c('debours', '467000'), tva: c('tva', '445710'), tvaDed: c('tvaded', '445660'), achats: c('achats', '607000'), banque: c('banque', '512000'), caisse: c('caisse', '530000') };
}
const LIB = { clients: 'Clients', fournisseurs: 'Fournisseurs', services: 'Prestations de services', marchandises: 'Ventes de marchandises', debours: 'Débours', tva: 'TVA collectée', tvaDed: 'TVA déductible sur autres biens et services', achats: 'Achats de marchandises', banque: 'Banque', caisse: 'Caisse' };

function fec({ von, bis } = {}) {
  von = von || L.today().slice(0, 4) + '-01-01'; bis = bis || L.today();
  const d = L.db(); const VG = require('../api/vorgang'); const C = comptes();
  const nums = {}; const rows = [];
  // one entry = several lines with the same number; amount > 0 debit, < 0 credit
  const ecriture = (j, date, piece, lib, lignes) => {
    const n = (nums[j] = (nums[j] || 0) + 1);
    for (const l of lignes) {
      if (!Math.round((l.montant || 0) * 100)) continue;
      rows.push([j, JOURNAUX[j], `${j}${String(n).padStart(6, '0')}`, d8(date), C[l.compte], LIB[l.compte], l.aux || '', clean(l.auxLib || ''), clean(piece), d8(date), clean(lib), l.montant > 0 ? m(l.montant) : '0,00', l.montant < 0 ? m(l.montant) : '0,00', '', '', d8(date), '', '']);
    }
  };
  // sales invoices and credit notes
  for (const k of d.prepare('SELECT * FROM RECHNUNGEN WHERE DATUM BETWEEN ? AND ? ORDER BY DATUM, RECHNUNGNUMMER').all(von, bis)) {
    const pos = d.prepare('SELECT * FROM RECHNUNGEN_POS WHERE RECHNUNGID=? ORDER BY PRTSORT').all(k.RECHNUNGID).map(p => ({ ...p }));
    const tax = VG.calc({ ...k }, pos);
    const vat = Object.values(tax).reduce((s, g) => s + g.mwst, 0);
    let serv = 0, marc = 0, deb = 0;
    for (const p of pos.filter(x => x.POSART !== 'T' && x.POSART !== 'Z')) {
      const net = Number(p.SUMME) || 0;
      if (Number(p.DURCHLAUFER) === 1) deb += net; else if (p.POSART === 'L') serv += net; else marc += net;
    }
    // align the net amounts with the invoice totals (rounding)
    const diff = L.r2(k.GBRUTTO - vat - serv - marc - deb); marc += diff;
    const aux = `C${k.KUNNUMMER || k.KUNID || ''}`, auxLib = [k.KUNNAME, k.KUNVORNAME].filter(Boolean).join(' ');
    ecriture('VE', k.DATUM, k.RECHNUNGNUMMER, `${Number(k.TYP) === 2 ? 'Avoir' : 'Facture'} ${k.RECHNUNGNUMMER} ${auxLib}`, [
      { compte: 'clients', montant: k.GBRUTTO, aux, auxLib }, { compte: 'services', montant: -serv }, { compte: 'marchandises', montant: -marc }, { compte: 'debours', montant: -deb }, { compte: 'tva', montant: -vat }]);
  }
  // customer payments (cash or bank)
  for (const z of d.prepare('SELECT z.*, a.KASSENBUCH, r.RECHNUNGNUMMER, r.KUNNUMMER, r.KUNID, r.KUNNAME, r.KUNVORNAME FROM ZAHLUNGSEINGAENGE z JOIN RECHNUNGEN r ON r.RECHNUNGID=z.RECHNUNGID LEFT JOIN ZAHLUNGSART a ON a.ID=z.ZAHLUNGSARTID WHERE z.DATUM BETWEEN ? AND ? AND COALESCE(z.ZAHLUNGSARTID,0)<>6 ORDER BY z.DATUM, z.ID').all(von, bis)) {
    const caisse = Number(z.KASSENBUCH) === 1;
    const auxLib = [z.KUNNAME, z.KUNVORNAME].filter(Boolean).join(' ');
    ecriture(caisse ? 'CA' : 'BQ', z.DATUM, z.RECHNUNGNUMMER, `Règlement facture ${z.RECHNUNGNUMMER}`, [{ compte: caisse ? 'caisse' : 'banque', montant: z.BETRAG }, { compte: 'clients', montant: -z.BETRAG, aux: `C${z.KUNNUMMER || z.KUNID || ''}`, auxLib }]);
  }
  // register sales without an invoice
  for (const b of d.prepare("SELECT * FROM SW_KASSE_BON WHERE TYP='Beleg' AND RECHNUNGID IS NULL AND substr(ZEIT,1,10) BETWEEN ? AND ? ORDER BY ID").all(von, bis)) {
    ecriture('CA', b.ZEIT, `T${b.BONNR}`, `Ticket ${b.BONNR}`, [{ compte: 'caisse', montant: b.BRUTTO }, { compte: 'marchandises', montant: -b.NETTO }, { compte: 'tva', montant: -(b.BRUTTO - b.NETTO) }]);
  }
  // purchase invoices and their payments
  for (const e of d.prepare('SELECT * FROM SW_EINGANG WHERE DATUM BETWEEN ? AND ? ORDER BY DATUM, ID').all(von, bis)) {
    const aux = `F${e.LIEFID || e.ID}`;
    ecriture('AC', e.DATUM, e.RECHNUNGSNR || `A${e.ID}`, `Facture ${e.RECHNUNGSNR || ''} ${e.LIEFNAME || ''}`, [{ compte: 'achats', montant: e.NETTO }, { compte: 'tvaDed', montant: e.MWST }, { compte: 'fournisseurs', montant: -e.BRUTTO, aux, auxLib: e.LIEFNAME }]);
  }
  for (const z of d.prepare('SELECT z.*, e.LIEFID, e.LIEFNAME, e.RECHNUNGSNR, e.ID EID FROM SW_EINGANG_ZAHLUNG z JOIN SW_EINGANG e ON e.ID=z.EINGANGID WHERE z.DATUM BETWEEN ? AND ? ORDER BY z.DATUM, z.ID').all(von, bis)) {
    const caisse = /bar|cash|esp/i.test(z.ART || '');
    ecriture(caisse ? 'CA' : 'BQ', z.DATUM, z.RECHNUNGSNR || `A${z.EID}`, `Règlement ${z.LIEFNAME || ''}`, [{ compte: 'fournisseurs', montant: z.BETRAG, aux: `F${z.LIEFID || z.EID}`, auxLib: z.LIEFNAME }, { compte: caisse ? 'caisse' : 'banque', montant: -z.BETRAG }]);
  }
  // order: by journal, then date and number (as an accounting program would export it)
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[3].localeCompare(b[3]) || a[2].localeCompare(b[2]));
  const siren = require('./index').siren() || '000000000';
  const buffer = Buffer.from([HEAD, ...rows].map(r => r.join('\t')).join('\r\n') + '\r\n', 'utf8');
  return { buffer, filename: `${siren}FEC${d8(bis)}.txt`, lignes: rows.length };
}

module.exports = { fec, HEAD };
