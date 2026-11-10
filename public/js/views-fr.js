'use strict';
/* global title, h, api, qs, fmt, toast, showError, confirmDlg, dialog, downloadUrl, miniGrid, Win, Views, today, LK, T, dateRange, addMonths, addDays */
// French tax system: settings tab (TVA, legal mentions, accounts, Chorus Pro) and the view
// "Comptabilité" (FEC, cash register journal ISCA, Chorus Pro deposits)

const FrUI = {
  activo() { return !!(LK.data && LK.data.land === 'FR'); },
  settingsTab(p, { s, changes, si, sb, grp, fld, ob }) {
    const txt = (k, label, def) => { const t = h('textarea', { rows: 2 }, s.sw[k] ?? def); t.addEventListener('change', () => { changes.sw[k] = t.value; }); return fld(label, t); };
    const chorus = async () => {
      const id = h('input', { type: 'text' }), sec = h('input', { type: 'password' }), login = h('input', { type: 'text' }), pw = h('input', { type: 'password' });
      const ok = await dialog('Chorus Pro (PISTE)', h('div', { class: 'fgrid' }, fld('Client ID (PISTE)', id), fld('Client secret (PISTE)', sec), fld('Login des technischen Kontos', login), fld('Passwort des technischen Kontos', pw),
        h('div', { class: 'fld hint' }, T('Anwendung auf piste.gouv.fr mit der API „Factures“ und „Transverses“ anlegen, in Chorus Pro ein technisches Konto (compte technique) einrichten und mit der Anwendung verknüpfen. Gilt für die gewählte Umgebung.'))),
      [{ label: 'Speichern', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 560 });
      if (!ok) return;
      try { await api('/api/einstellungen', { method: 'PUT', body: changes }); await api('/api/fr/chorus/acceso', { method: 'POST', body: { clientId: id.value, clientSecret: sec.value, login: login.value, password: pw.value } }); toast('Gespeichert', 'ok'); } catch (e) { showError(e); }
    };
    const sel = (k, label, opts, def) => { const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] ?? def) === v }, l))); x.addEventListener('change', () => { changes.sw[k] = x.value; }); return fld(label, x); };
    p.append(h('div', { class: 'groups' },
      grp('TVA',
        si('fr.tva.normal', 'Taux normal %', '20', true), si('fr.tva.intermediaire', 'Taux intermédiaire %', '10', true), si('fr.tva.reduit', 'Taux réduit %', '5.5', true),
        ob('Kleinunternehmer', 'Franchise en base de TVA (art. 293 B du CGI) – Rechnungen ohne TVA'),
        sb('fr.tva_debits', "Option pour le paiement de la taxe d'après les débits", '0'),
        h('div', { class: 'fld hint' }, 'Die SIRET der Firma gehört unter Firmendaten → Steuernummer, die TVA-Nummer (FR…) unter USt-IdNr. Die SIREN/SIRET von Geschäftskunden steht im Kunden unter Steuer & Buchhaltung. Gedruckte Rechnungen sind gesperrt; Korrekturen als Avoir (Rechnung stornieren).')),
      grp('Angaben der Firma (Pflichtangaben)',
        si('fr.forme', 'Rechtsform (z. B. SARL, SAS, EI)', '', true), si('fr.capital', 'Kapital (z. B. 10 000 €)', '', true),
        si('fr.rcs', 'RCS / RM (z. B. RCS Lyon 732 829 320)', '', true), si('fr.ape', 'Code APE / NAF (z. B. 4520A)', '', true),
        txt('fr.penalites', 'Strafzinsen bei Zahlungsverzug (Text auf der Rechnung)', "En cas de retard de paiement, des pénalités calculées à trois fois le taux d'intérêt légal sont exigibles."),
        txt('fr.escompte', 'Skonto (Text auf der Rechnung)', "Pas d'escompte pour paiement anticipé.")),
      grp('Chorus Pro (öffentliche Auftraggeber)',
        sel('fr.chorus.entorno', 'Umgebung', [['sandbox', 'Sandbox (PISTE qualification)'], ['production', 'Produktion']], 'sandbox'),
        h('div', { class: 'fld hint' }, 'Rechnungen an Behörden gehen als Factur-X über die API von Chorus Pro. Im Kunden: SIRET der Behörde (SIREN/SIRET) und Code service (Leitweg-ID); die Nummer der Bestellung (engagement) im Feld Bestell-Nr. der Rechnung. Für andere Geschäftskunden laden Sie die Factur-X-Datei bei Ihrer Plattform (PDP) hoch.'),
        h('div', { class: 'fld inline' }, h('button', { class: 'btn', onclick: chorus }, '🔑 Zugangsdaten Chorus Pro'))),
      grp('Konten (Plan comptable général, FEC)',
        si('fr.compte.clients', 'Clients', '411000', true), si('fr.compte.fournisseurs', 'Fournisseurs', '401000', true),
        si('fr.compte.services', 'Prestations de services', '706000', true), si('fr.compte.marchandises', 'Ventes de marchandises', '707000', true),
        si('fr.compte.debours', 'Débours', '467000', true), si('fr.compte.tva', 'TVA collectée', '445710', true), si('fr.compte.tvaded', 'TVA déductible', '445660', true),
        si('fr.compte.achats', 'Achats', '607000', true), si('fr.compte.banque', 'Banque', '512000', true), si('fr.compte.caisse', 'Caisse', '530000', true))));
  },
};

Views.frCompta = async (main) => {
  let von = today().slice(0, 4) + '-01-01', bis = today();
  const out = h('div');
  const TYPS = { ticket: 'Ticket', cloture_j: 'Tagesabschluss', cloture_m: 'Monatsabschluss', cloture_a: 'Jahresabschluss', jet: 'Ereignis (JET)' };
  const journal = async (typ) => {
    const rows = await api('/api/fr/caisse/journal?' + qs({ typ, limit: 2000 }));
    const g = miniGrid([{ f: 'TYP', l: 'Art', w: 120, render: r => T(TYPS[r.TYP] || r.TYP) }, { f: 'NR', l: 'Nr.', w: 60, t: 'int' }, { f: 'ZEIT', l: 'Zeit', w: 170 }, { f: 'REF', l: 'Bezug', w: 110 },
      { f: 'TOTAL', l: 'Betrag', w: 95, t: 'money' }, { f: 'GT', l: 'Grand total', w: 110, t: 'money' }, { f: 'SIG', l: 'Signatur', w: 150 }, { f: 'DATEN', l: 'Daten', w: 420 }], rows);
    Win.open({ title: 'Kassenjournal (ISCA)', width: 1200, height: 620, content: g.el });
  };
  const pruefen = async () => {
    try {
      const r = await api('/api/fr/caisse/verifier');
      await dialog('Integritätsprüfung', h('div', null, h('div', { class: 'note ' + (r.ok ? 'ok' : 'err') }, r.ok ? T(`✔ Alle ${r.entrees} Einträge sind unverändert, Signaturen und Verkettung in Ordnung.`) : T(`❌ ${r.erreurs.length} Fehler gefunden.`)),
        r.erreurs.length ? h('ul', null, r.erreurs.slice(0, 50).map(e => h('li', null, e))) : null), [{ label: 'OK', value: true }], { width: 620 });
    } catch (e) { showError(e); }
  };
  const abschluss = async (periode) => {
    if (!(await confirmDlg(periode === 'A' ? 'Jahresabschluss jetzt erstellen?' : 'Monatsabschluss für den laufenden Monat jetzt erstellen?', { ok: 'Erstellen' }))) return;
    try { await api('/api/fr/caisse/cloture', { method: 'POST', body: { periode } }); toast('Abschluss erstellt', 'ok'); } catch (e) { showError(e); }
  };
  const chorus = async () => {
    out.textContent = '';
    try {
      const r = await api('/api/fr/chorus/estado');
      out.append(h('div', { class: 'hint' }, `${T('Chorus Pro')} · ${r.entorno === 'production' ? T('Produktion') : 'Sandbox'} · ${r.acceso ? T('Zugangsdaten hinterlegt') : T('keine Zugangsdaten')}`),
        miniGrid([{ f: 'RECHNUNGNUMMER', l: 'Rechnung', w: 100 }, { f: 'GESENDET', l: 'Gesendet', w: 150 }, { f: 'FLUX', l: 'Fluss-Nr.', w: 160 }, { f: 'STATUS', l: 'Status', w: 200 }, { f: 'BENUTZER', l: 'Benutzer', w: 120 }], r.envios).el);
    } catch (e) { showError(e); }
  };
  main.append(title('Comptabilité (France)', 'FEC, Kassenjournal nach ISCA und Chorus Pro'),
    h('div', { class: 'view-scroll' },
      h('div', { class: 'searchbar' }, ...dateRange(von, bis, (a, b) => { von = a; bis = b; }),
        h('button', { class: 'btn primary', onclick: () => downloadUrl('/api/fr/fec?' + qs({ von, bis }), 'FEC.txt') }, '⬇ FEC'),
        h('button', { class: 'btn', onclick: () => downloadUrl('/api/fr/caisse/archive?' + qs({ von, bis }), 'archive.zip') }, '🗄 ' + T('Signiertes Kassenarchiv'))),
      h('div', { class: 'hint', style: { maxWidth: '900px', margin: '4px 0 10px' } }, 'Der FEC (fichier des écritures comptables) enthält alle Buchungen des Zeitraums im vorgeschriebenen Format und wird der Finanzverwaltung bei einer Prüfung übergeben. Das Kassenarchiv enthält alle signierten Bons, Abschlüsse und Ereignisse mit dem öffentlichen Schlüssel zur Prüfung.'),
      h('fieldset', { class: 'grp' }, h('legend', null, 'Kasse (ISCA: inaltérabilité, sécurisation, conservation, archivage)'),
        h('div', { class: 'searchbar' },
          h('button', { class: 'btn', onclick: () => journal('') }, '📋 ' + T('Kassenjournal')), h('button', { class: 'btn', onclick: () => journal('jet') }, '🧾 ' + T('Ereignisprotokoll (JET)')),
          h('button', { class: 'btn', onclick: pruefen }, '🔍 ' + T('Integrität prüfen')), h('button', { class: 'btn', onclick: () => abschluss('M') }, T('Monatsabschluss')), h('button', { class: 'btn', onclick: () => abschluss('A') }, T('Jahresabschluss'))),
        h('div', { class: 'hint' }, 'Jeder Bon wird signiert und mit dem vorherigen verkettet; der Tagesabschluss entsteht mit dem Z-Bon, Monats- und Jahresabschlüsse beim Wechsel automatisch. Die Zertifizierung NF525 erfolgt durch eine akkreditierte Stelle.')),
      h('fieldset', { class: 'grp', style: { marginTop: '10px' } }, h('legend', null, 'Chorus Pro'), h('div', { class: 'searchbar' }, h('button', { class: 'btn', onclick: chorus }, '🔄 ' + T('Übermittlungen anzeigen'))), out)));
};
