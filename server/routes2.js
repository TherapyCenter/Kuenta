'use strict';
// Routes of the add-on modules: PDF/ZUGFeRD, email, purchasing, time tracking, vehicle trading, register, interfaces, tenants
const L = require('./lib');
const dbm = require('./db');
const VG = require('./api/vorgang');
const FI = require('./api/finanzen');
const ER = require('./api/erechnung');
const EK = require('./api/einkauf');
const ZT = require('./api/zeit');
const HD = require('./api/handel');
const KS = require('./api/kasse');
const SN = require('./api/schnittstellen');
const TSE = require('./kasse/tse');
const ZVT = require('./kasse/zvt');
const MAIL = require('./mail');
const MAILCLIENT = require('./mailclient');
const PDF = require('./pdf/belege');
const { V } = require('../public/js/entities.js');

module.exports = function register(route, { json, readBody }) {
  const fname = s => String(s).replace(/[^\wäöüÄÖÜß.\- ]/g, '_');

  // ---------- PDF / ZUGFeRD ----------
  function vorgangPdf(typ, id, { zugferd, vorschau } = {}) {
    const v = V[typ]; if (!v) throw new L.HttpError(404, 'Unbekannter Vorgang');
    // Spain: an invoice that leaves Kuenta as PDF is issued (VERI*FACTU record with QR code)
    if (v.table === 'RECHNUNGEN' && !vorschau && require('./es').activo()) require('./es/verifactu').emitir(Number(id));
    if (zugferd && v.table === 'RECHNUNGEN') { const z = PDF.zugferd(id); return { buf: z.pdf, name: `${v.title}_${z.nr}.pdf`, problems: z.problems }; }
    const d = VG.load(typ, id);
    return { buf: PDF.vorgangPdf(typ, d), name: `${v.title}_${d.kopf[v.nr]}.pdf` };
  }
  route('GET', '/api/pdf/vorgang/:typ/:id', (ctx) => { const p = vorgangPdf(ctx.p.typ, ctx.p.id, { zugferd: ctx.q.zugferd === '1', vorschau: ctx.q.vorschau === '1' }); return { _download: p.buf, filename: fname(p.name), type: 'application/pdf' }; });
  route('GET', '/api/pdf/mahnung/:id', (ctx) => { const m = FI.mahnung(ctx.p.id); return { _download: PDF.mahnungPdf(m), filename: `Mahnung_${m.rechnung.RECHNUNGNUMMER}.pdf`, type: 'application/pdf' }; });

  // ---------- Email ----------
  const platz = (t, k) => String(t || '').replace(/\{(\w+)\}/g, (m, n) => ({ Nummer: k.nr, Vorgang: k.titel, Name: k.name, Anrede: k.anrede, Briefanrede: k.briefanrede, Firma: L.firma().FIRMENNAME || '', Betrag: k.betrag, Datum: k.datum, Zahlungslink: k.zahlungslink || '' }[n] ?? m));
  const { D, Dt, docLang, I18N } = require('./i18n');
  function briefanrede(a, name) { a = String(a || '').trim(); return D(/^herr/i.test(a) ? `Sehr geehrter ${a} ${name},` : /^frau/i.test(a) ? `Sehr geehrte ${a} ${name},` : 'Sehr geehrte Damen und Herren,'); }
  const eur = v => new Intl.NumberFormat(I18N.locale(docLang()), { style: 'currency', currency: L.waehrung() }).format(v);
  route('GET', '/api/mail/vorlage/:art/:typ/:id', (ctx) => {
    const { art, typ, id } = ctx.p;
    let to = '', k;
    if (art === 'mahnung') {
      const m = FI.mahnung(id); const r = m.rechnung;
      const kd = r.KUNID ? L.db().prepare('SELECT EMAIL, EMAILRECHNUNG FROM KUNDEN WHERE KUNID=?').get(r.KUNID) : null;
      to = kd ? (kd.EMAILRECHNUNG || kd.EMAIL || '') : '';
      k = { nr: r.RECHNUNGNUMMER, titel: D(m.mahnung.BETREFFTXT || 'Zahlungserinnerung'), name: r.KUNNAME, anrede: D(r.KUNANREDE || ''), briefanrede: briefanrede(r.KUNANREDE, r.KUNNAME), betrag: eur(r.OFFEN), datum: r.DATUM };
    } else {
      const v = V[typ]; const d = VG.load(typ, id); const kk = d.kopf;
      const kd = kk.KUNID ? L.db().prepare('SELECT EMAIL, EMAILRECHNUNG, ERECHNUNG FROM KUNDEN WHERE KUNID=?').get(kk.KUNID) : null;
      to = kd ? (v.table === 'RECHNUNGEN' ? kd.EMAILRECHNUNG || kd.EMAIL : kd.EMAIL) || '' : '';
      k = { nr: kk[v.nr], titel: D(v.title), name: kk.KUNNAME, anrede: D(kk.KUNANREDE || ''), briefanrede: briefanrede(kk.KUNANREDE, kk.KUNNAME), betrag: eur(kk.GBRUTTO), datum: kk.DATUM };
      k.format = kd ? Number(kd.ERECHNUNG || 0) : 0;
      const krypto = typ === 'rechnung' ? require('./btcpay').linkFuerBeleg(Number(id)) : null;
      if (krypto) k.zahlungslink = krypto.link;
    }
    // default texts in the document language; texts saved in the settings are used as they are
    const betreff = L.sw('mail.betreff.' + (art === 'mahnung' ? 'mahnung' : typ), Dt(art === 'mahnung' ? '{Vorgang} zu Rechnung Nr. {Nummer}' : '{Vorgang} Nr. {Nummer} – {Firma}'));
    const text = L.sw('mail.text.' + (art === 'mahnung' ? 'mahnung' : typ), Dt(art === 'mahnung'
      ? '{Briefanrede}\n\nanbei erhalten Sie unsere {Vorgang} zu Rechnung Nr. {Nummer} über offene {Betrag}.\n\nMit freundlichen Grüßen\n{Firma}'
      : '{Briefanrede}\n\nanbei erhalten Sie unsere(n) {Vorgang} Nr. {Nummer}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{Firma}'));
    let mailText = platz(text, k);
    if (k.zahlungslink && !text.includes('{Zahlungslink}')) { // put the note before the closing greeting, otherwise at the end
      const hinweis = Dt('Sie können auch mit {arten} bezahlen:', { arten: D(require('./btcpay').artenText()) }) + `\n${k.zahlungslink}\n\n`;
      const i = mailText.search(/\n\n(Mit freundlichen|Viele Grüße|Beste Grüße|Freundliche Grüße|Kind regards|Best regards|Yours|Atentamente|Saludos|Un saludo)/);
      mailText = i >= 0 ? mailText.slice(0, i + 2) + hinweis + mailText.slice(i + 2) : mailText + '\n\n' + hinweis.trimEnd();
    }
    return { to, betreff: platz(betreff, k), text: mailText + (L.sw('mail.signatur', '') ? '\n\n' + L.sw('mail.signatur', '') : ''), format: k.format || 0 };
  });
  route('POST', '/api/mail/senden', async (ctx) => {
    const b = await json(ctx.req);
    const atts = [];
    if (b.art === 'mahnung') { const m = FI.mahnung(b.id); atts.push({ filename: `Mahnung_${m.rechnung.RECHNUNGNUMMER}.pdf`, content: PDF.mahnungPdf(m), contentType: 'application/pdf' }); }
    else if (b.art === 'vorgang') {
      const v = V[b.typ];
      const f = b.format || 'pdf';
      if (f === 'zugferd' && v.table === 'RECHNUNGEN') { const p = vorgangPdf(b.typ, b.id, { zugferd: true }); atts.push({ filename: fname(p.name), content: p.buf, contentType: 'application/pdf' }); }
      else if ((f === 'xrechnung' || f === 'xrechnung-ubl') && v.table === 'RECHNUNGEN') {
        const x = ER.create(b.id, f === 'xrechnung-ubl' ? 'ubl' : 'cii'); atts.push({ filename: `XRechnung_${x.nr}.xml`, content: Buffer.from(x.xml, 'utf8'), contentType: 'application/xml' });
        if (b.pdfDazu) { const p = vorgangPdf(b.typ, b.id); atts.push({ filename: fname(p.name), content: p.buf, contentType: 'application/pdf' }); }
      } else { const p = vorgangPdf(b.typ, b.id); atts.push({ filename: fname(p.name), content: p.buf, contentType: 'application/pdf' }); }
    }
    for (const a of b.anhaenge || []) atts.push({ filename: a.name, content: Buffer.from(a.base64, 'base64'), contentType: a.type || 'application/octet-stream' });
    const entry = { to: b.to, subject: b.betreff, bezug: b.art === 'mahnung' ? 'MAHNUNG' : b.typ, bezugId: b.id, anhaenge: atts.map(a => a.filename).join(', '), user: ctx.user && ctx.user.name };
    const viaProgramm = L.sw('mail.versand', 'smtp') === 'programm';
    if (viaProgramm && !MAILCLIENT.isLocalRequest(ctx.req)) throw new L.HttpError(400, 'Das Mailprogramm kann nur an dem Rechner geöffnet werden, auf dem Kuenta läuft. Für andere Geräte bitte unter Einstellungen → E-Mail den direkten Versand (SMTP) wählen.');
    try {
      let programm = null;
      if (viaProgramm) {
        if (!String(b.to || '').trim()) throw new L.HttpError(400, 'Bitte einen Empfänger angeben.');
        programm = MAILCLIENT.open({ to: b.to, cc: b.cc, subject: b.betreff, text: b.text, attachments: atts }).programm;
      } else await MAIL.send({ to: b.to, cc: b.cc, subject: b.betreff, text: b.text, attachments: atts });
      MAIL.log({ ...entry, status: programm ? 'an ' + programm + ' übergeben' : 'gesendet' });
      if (b.art === 'vorgang') {
        const v = V[b.typ];
        L.db().prepare(`UPDATE ${v.table} SET GEDRUCKT=1 WHERE ${v.pk}=?`).run(b.id);
        if (v.table === 'RECHNUNGEN') L.db().prepare('UPDATE RECHNUNGEN SET MAILVERSAND=? WHERE RECHNUNGID=?').run(L.now(), b.id);
      }
      return { ok: true, anhaenge: entry.anhaenge, programm };
    } catch (e) { MAIL.log({ ...entry, status: 'Fehler', fehler: e.message }); throw e; }
  });
  route('POST', '/api/mail/test', async (ctx) => { const b = await json(ctx.req); await MAIL.send({ to: b.to, subject: 'Testnachricht von Kuenta', text: 'Der E-Mail-Versand aus Kuenta funktioniert.' }); return { ok: true }; });
  route('POST', '/api/mail/programm-test', async (ctx) => {
    await json(ctx.req);
    if (!MAILCLIENT.isLocalRequest(ctx.req)) throw new L.HttpError(400, 'Das Mailprogramm kann nur an dem Rechner geöffnet werden, auf dem Kuenta läuft.');
    return MAILCLIENT.open({ to: L.firma().EMAIL || '', subject: 'Testnachricht von Kuenta', text: 'Die Übergabe von Kuenta an das Mailprogramm funktioniert.\nUmlaute: äöü ÄÖÜ ß' });
  });
  route('GET', '/api/mail/programm', () => process.env.KUENTA_CONTAINER ? { thunderbird: null, container: true } : { thunderbird: MAILCLIENT.findThunderbird() });
  route('GET', '/api/mail/protokoll', () => L.db().prepare('SELECT * FROM SW_MAILS ORDER BY ID DESC LIMIT 1000').all());

  // ---------- Purchasing ----------
  route('GET', '/api/eingang/:id', (ctx) => EK.load(ctx.p.id));
  route('POST', '/api/eingang', async (ctx) => { ctx.need('Einkauf', 'erstellen'); return EK.save(await json(ctx.req), ctx.user); });
  route('DELETE', '/api/eingang/:id', (ctx) => EK.remove(ctx.p.id, ctx.user));
  route('POST', '/api/eingang/zahlung', async (ctx) => EK.addPayment(await json(ctx.req), ctx.user));
  route('DELETE', '/api/eingang/zahlung/:id', (ctx) => EK.deletePayment(ctx.p.id));
  route('POST', '/api/eingang/erechnung', async (ctx) => EK.importErechnung(await readBody(ctx.req), ctx.q.name, ctx.user));
  route('POST', '/api/erechnung/lesen', async (ctx) => {
    const buf = await readBody(ctx.req); const X = require('./xml');
    const xml = buf.subarray(0, 5).toString() === '%PDF-' ? X.xmlFromPdf(buf) : buf.toString('utf8');
    if (!xml) throw new L.HttpError(400, 'In dieser PDF-Datei ist keine E-Rechnung eingebettet.');
    return { xml };
  });
  route('POST', '/api/lager/bewegung', async (ctx) => EK.bewegung(await json(ctx.req)));
  route('GET', '/api/lager/bewegungen', (ctx) => EK.bewegungen(ctx.q));
  route('GET', '/api/inventur', () => EK.inventurListen());
  route('POST', '/api/inventur', async (ctx) => EK.inventurNeu(await json(ctx.req)));
  route('GET', '/api/inventur/:id', (ctx) => EK.inventur(ctx.p.id));
  route('PUT', '/api/inventur/:id', async (ctx) => EK.inventurSpeichern(ctx.p.id, await json(ctx.req)));
  route('POST', '/api/inventur/:id/buchen', (ctx) => EK.inventurBuchen(ctx.p.id));
  route('DELETE', '/api/inventur/:id', (ctx) => { const d = L.db(); const l = d.prepare('SELECT GEDRUCKT FROM INVETURLISTEN WHERE LISTID=?').get(ctx.p.id); if (l && Number(l.GEDRUCKT) === 2) throw new L.HttpError(409, 'Gebuchte Inventuren können nicht gelöscht werden.'); d.prepare('DELETE FROM INVENTURLISTEN_POS WHERE LISTID=?').run(ctx.p.id); d.prepare('DELETE FROM INVETURLISTEN WHERE LISTID=?').run(ctx.p.id); return { ok: true }; });

  // ---------- Time tracking ----------
  route('GET', '/api/zeit/mitarbeiter', () => ZT.mitarbeiter());
  route('POST', '/api/zeit/stempeln', async (ctx) => ZT.stempeln(await json(ctx.req)));
  route('GET', '/api/zeit/anwesenheit', () => ZT.anwesenheit());
  route('GET', '/api/zeit/monat/:benid/:monat', (ctx) => ZT.monat(Number(ctx.p.benid), ctx.p.monat));
  route('POST', '/api/zeit/abschluss', async (ctx) => { const b = await json(ctx.req); return ZT.monatsabschluss(b.benid, b.monat); });
  route('POST', '/api/zeit/oeffnen', async (ctx) => { const b = await json(ctx.req); return ZT.monatOeffnen(b.benid, b.monat); });
  route('GET', '/api/zeit/liste', (ctx) => ZT.liste(ctx.q));
  route('POST', '/api/zeit', async (ctx) => ZT.speichern(await json(ctx.req), ctx.user));
  route('DELETE', '/api/zeit/:id', (ctx) => ZT.loeschen(ctx.p.id, ctx.user));
  route('POST', '/api/zeit/korrektur', async (ctx) => ZT.korrektur(await json(ctx.req)));
  route('DELETE', '/api/zeit/korrektur/:id', (ctx) => ZT.korrekturLoeschen(ctx.p.id));
  route('GET', '/api/zeit/leistungsgrad', (ctx) => ZT.leistungsgrad(ctx.q));
  route('GET', '/api/zeit/feiertage/:jahr', (ctx) => ZT.feiertage(Number(ctx.p.jahr)));

  // ---------- Vehicle trading ----------
  route('GET', '/api/handel/:id/kalkulation', (ctx) => HD.kalkulation(ctx.p.id));
  route('GET', '/api/handel/:id/aufwand', (ctx) => HD.aufwandListe(ctx.p.id));
  route('POST', '/api/handel/aufwand', async (ctx) => HD.aufwandSpeichern(await json(ctx.req)));
  route('DELETE', '/api/handel/aufwand/:id', (ctx) => HD.aufwandLoeschen(ctx.p.id));
  route('POST', '/api/handel/:id/umbuchen', async (ctx) => HD.umbuchen(Number(ctx.p.id), await json(ctx.req)));
  route('GET', '/api/handel/:id/position', (ctx) => HD.position(Number(ctx.p.id), ctx.q.art));
  route('GET', '/api/handel/statistik', (ctx) => HD.statistik(ctx.q));
  route('GET', '/api/handel/bestand', () => HD.bestand());
  route('GET', '/api/kaufvertrag/neu', (ctx) => HD.vertragNeu(ctx.q));
  route('POST', '/api/kaufvertrag/:id/rechnung', (ctx) => HD.vertragRechnung(ctx.p.id, ctx.user));

  // ---------- Documents: down payment, collective invoice ----------
  route('GET', '/api/anzahlung/:auftragid', (ctx) => VG.anzahlungen(ctx.p.auftragid));
  route('POST', '/api/anzahlung', async (ctx) => VG.anzahlungSpeichern(await json(ctx.req)));
  route('DELETE', '/api/anzahlung/:id', (ctx) => VG.anzahlungLoeschen(ctx.p.id));
  route('POST', '/api/anzahlung/:id/rechnung', (ctx) => VG.anzahlungRechnung(ctx.p.id, ctx.user));
  route('POST', '/api/sammelrechnung', async (ctx) => { const b = await json(ctx.req); return VG.sammelrechnung(b.typ, b.ids, ctx.user); });

  // ---------- Cash register ----------
  route('GET', '/api/kasse', () => KS.status());
  route('POST', '/api/kasse/bon', async (ctx) => { ctx.need('Kasse', 'erstellen'); return KS.bon(await json(ctx.req), ctx.user); });
  route('POST', '/api/kasse/bewegung', async (ctx) => KS.bewegung(await json(ctx.req), ctx.user));
  route('POST', '/api/kasse/storno/:id', async (ctx) => KS.storno(ctx.p.id, await json(ctx.req), ctx.user));
  route('GET', '/api/kasse/bon/:id', (ctx) => KS.beleg(ctx.p.id));
  route('GET', '/api/kasse/journal', (ctx) => KS.journal(ctx.q));
  route('GET', '/api/kasse/abschluss/vorschau', () => KS.abschlussVorschau());
  route('POST', '/api/kasse/abschluss', async (ctx) => KS.abschluss(await json(ctx.req)));
  route('GET', '/api/kasse/abschluesse', () => KS.abschluesse());
  route('GET', '/api/kasse/abschluss/:id', (ctx) => KS.abschlussDetail(ctx.p.id));
  route('GET', '/api/kasse/dsfinvk', (ctx) => { const r = KS.dsfinvk(ctx.q); return { _download: r.buffer, filename: r.filename, type: 'application/zip' }; });
  route('POST', '/api/kasse/ec', async (ctx) => { const b = await json(ctx.req); return ZVT.zahlen(b.betrag); });
  route('POST', '/api/kasse/ec/test', () => ZVT.test());
  route('POST', '/api/kasse/krypto', async (ctx) => { ctx.need('Kasse', 'erstellen'); return require('./btcpay').kasseStart(await json(ctx.req)); });
  route('GET', '/api/kasse/krypto/:id', (ctx) => require('./btcpay').kasseStatus(Number(ctx.p.id)));
  route('POST', '/api/kasse/krypto/:id/abbrechen', (ctx) => { ctx.need('Kasse', 'erstellen'); return require('./btcpay').kasseAbbrechen(Number(ctx.p.id)); });
  route('POST', '/api/tse/einrichten', async (ctx) => TSE.einrichten(await json(ctx.req)));
  route('GET', '/api/tse/status', () => TSE.status());
  route('GET', '/api/tse/export', async (ctx) => ({ _download: await TSE.export(ctx.q), filename: `TSE-Export_${ctx.q.von || ''}_${ctx.q.bis || ''}.tar`, type: 'application/x-tar' }));

  // ---------- Crypto payment via BTCPay Server ----------
  const BTC = require('./btcpay');
  route('POST', '/api/btcpay/test', (ctx) => { ctx.need('Einstellungen', 'anzeigen'); BTC.zahlartId(); return BTC.test(); });
  route('POST', '/api/btcpay/link/:rid', async (ctx) => { ctx.need('Zahlungen', 'erstellen'); const b = await json(ctx.req); return BTC.link(Number(ctx.p.rid), { neu: !!b.neu }); });
  route('GET', '/api/btcpay/rechnung/:rid', (ctx) => ({ aktiv: BTC.bereit(), eintraege: BTC.liste(Number(ctx.p.rid)) }));
  route('POST', '/api/btcpay/pruefen', (ctx) => { ctx.need('Zahlungen', 'erstellen'); return BTC.pruefen({ user: ctx.user && ctx.user.name }); });

  // ---------- Interfaces / data import ----------
  route('GET', '/api/import/felder/:ent', (ctx) => ({ ...SN.zielfelder(ctx.p.ent), vorlagen: SN.vorlagen(ctx.p.ent) }));
  route('POST', '/api/import/csv/vorschau', async (ctx) => SN.vorschau(await readBody(ctx.req), { delim: ctx.q.delim }));
  route('POST', '/api/import/csv/:ent', async (ctx) => SN.importieren(ctx.p.ent, await readBody(ctx.req), JSON.parse(decodeURIComponent(ctx.req.headers['x-optionen'] || '%7B%7D')), ctx.user));
  route('POST', '/api/import/vorlage/:ent', async (ctx) => { const b = await json(ctx.req); return SN.vorlageSpeichern(ctx.p.ent, b.name, b.cfg); });
  route('POST', '/api/import/datanorm', async (ctx) => SN.datanorm(await readBody(ctx.req), ctx.q, ctx.user));
  route('POST', '/api/import/warenkorb', async (ctx) => SN.warenkorb(await readBody(ctx.req)));
  route('POST', '/api/import/warenkorb/anlegen', async (ctx) => SN.warenkorbAnlegen(await json(ctx.req), ctx.user));

  // ---------- Tenants ----------
  route('GET', '/api/mandanten', () => ({ liste: dbm.listMandanten(), aktiv: dbm.current() }), { public: true });
  route('POST', '/api/mandanten', async (ctx) => {
    const b = await json(ctx.req); const list = dbm.listMandanten();
    const id = Math.max(...list.map(m => m.id)) + 1;
    list.push({ id, name: String(b.name || `Mandant ${id}`).slice(0, 60) }); dbm.saveMandanten(list);
    dbm.runAs(id, () => { const d = dbm.get(); if (b.firma) d.prepare('UPDATE FIRMENDATEN SET FIRMENNAME=?').run(b.firma); });
    return { liste: list, id };
  });
  route('PUT', '/api/mandanten/:id', async (ctx) => { const b = await json(ctx.req); const list = dbm.listMandanten(); const m = list.find(x => x.id === Number(ctx.p.id)); if (!m) throw new L.HttpError(404, 'Mandant nicht gefunden'); m.name = String(b.name || m.name).slice(0, 60); dbm.saveMandanten(list); return { liste: list }; });
  route('POST', '/api/mandanten/wechseln', async (ctx) => {
    const b = await json(ctx.req); const id = Number(b.id);
    if (!dbm.listMandanten().some(m => m.id === id)) throw new L.HttpError(404, 'Mandant nicht gefunden');
    ctx.res.setHeader('Set-Cookie', `sw_mandant=${id}; SameSite=Strict; Path=/; Max-Age=31536000`);
    return { ok: true };
  }, { public: true });
};
