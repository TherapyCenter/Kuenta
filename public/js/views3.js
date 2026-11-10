'use strict';
/* global h, $, $$, fmt, api, qs, parseNum, LK, ENT, Win, toast, showError, confirmDlg, promptDlg, dialog, alertDlg, Overview, miniGrid, editRecord, pickKunde, pickRecord, pickFahrzeug, Vorgang, Print, App, today, addDays, addMonths, downloadUrl, pickFile, saveBlob, kname, r2, Pref, Views, SUBS, fld2, titel, qrcode */

// ================= Cash register =================
// Crypto payment at the register: show a QR code and wait until BTCPay reports "paid".
// Returns the ID of the crypto payment, or null when cancelled.
async function kryptoZahlung(betrag, text) {
  let k;
  try { k = await api('/api/kasse/krypto', { method: 'POST', body: { betrag, text } }); } catch (e) { showError(e); return null; }
  return new Promise(resolve => {
    let fertig = false; let timer = null;
    const quellen = k.methoden.length ? k.methoden : [{ name: 'Bezahlseite', link: k.link }];
    const qrBox = h('div', { style: { background: '#fff', padding: '10px', borderRadius: '6px', width: '300px', margin: '0 auto', lineHeight: 0 } });
    const info = h('div', { class: 'hint', style: { textAlign: 'center', marginTop: '6px', minHeight: '1.4em' } });
    const status = h('div', { style: { textAlign: 'center', fontSize: '19px', fontWeight: 700, marginTop: '8px' } }, 'Warte auf Zahlung …');
    const rest = h('div', { class: 'hint', style: { textAlign: 'center' } });
    const tabs = h('div', { style: { display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' } });
    const zeige = m => {
      try { const q = qrcode(0, 'M'); q.addData(/^lightning:/i.test(m.link) ? m.link.toUpperCase() : m.link); q.make(); qrBox.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2 }).replace('<svg ', '<svg style="width:100%;height:auto" '); }
      catch { qrBox.innerHTML = ''; }
      info.textContent = T(m.betrag ? `${m.betrag} ${m.waehrung || ''}`.trim() : 'Mit dem Handy scannen und im Browser bezahlen');
      [...tabs.children].forEach(b => b.classList.toggle('primary', b.dataset.n === m.name));
    };
    quellen.forEach(m => tabs.append(h('button', { class: 'btn', 'data-n': m.name, onclick: () => zeige(m) }, m.name === 'Lightning' ? '⚡ Lightning' : m.name === 'Bitcoin (on-chain)' ? '₿ Bitcoin' : m.name)));
    const content = h('div', { style: { padding: '12px' } },
      h('div', { style: { textAlign: 'center', fontSize: '30px', fontWeight: 700, marginBottom: '8px' } }, fmt.money(betrag)),
      quellen.length > 1 ? tabs : null, qrBox, info, status, rest);
    zeige(quellen[0]);
    const w = Win.open({ title: 'Krypto-Zahlung', width: 420, content, maximizable: false, onClose: r => {
      fertig = true; clearInterval(timer);
      if (r) return resolve(r);
      api(`/api/kasse/krypto/${k.id}/abbrechen`, { method: 'POST' }).then(x => { if (!x.ungueltig) toast('Zahlung abgebrochen. Zahlt der Kunde trotzdem noch, zeigt die Kasse einen Hinweis.', 'err'); }).catch(() => {});
      resolve(null);
    } });
    w.setButtons(['|', { label: 'Bezahlseite öffnen', onClick: () => window.open(k.link, '_blank', 'noopener') }, { label: 'Abbrechen', onClick: () => w.close(null) }]);
    if (!w.foot.parentNode) w.el.append(w.foot);
    const ende = Date.now() + k.minuten * 60000;
    const tick = async () => {
      if (fertig) return;
      const sek = Math.max(0, Math.round((ende - Date.now()) / 1000));
      rest.textContent = T(`gültig noch ${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, '0')} min`);
      try {
        const s = await api(`/api/kasse/krypto/${k.id}`);
        if (fertig) return;
        if (s.status === 'bezahlt') { status.textContent = T('✅ Bezahlt' + (s.methode ? ' (' + s.methode + ')' : '')); status.style.color = 'var(--ok)'; fertig = true; clearInterval(timer); setTimeout(() => w.close(k.id), 700); }
        else if (s.status === 'bestaetigung') status.textContent = T('⏳ Zahlung erkannt, wird bestätigt …');
        else if (s.status === 'abgelaufen' || s.status === 'ungueltig') { status.textContent = T(s.status === 'abgelaufen' ? '⌛ Abgelaufen – bitte neu starten' : '❌ Zahlung ungültig'); status.style.color = 'var(--err)'; clearInterval(timer); }
        else status.textContent = T(s.teilweise ? '⚠ Nur ein Teil bezahlt – bitte Rest nachzahlen' : 'Warte auf Zahlung …');
      } catch (e) { status.textContent = T('⚠ ' + e.message); }
    };
    timer = setInterval(tick, 2500); tick();
  });
}

const MUENZEN = ['500', '200', '100', '50', '20', '10', '5', '2', '1', '0.5', '0.2', '0.1', '0.05', '0.02', '0.01'];
async function zaehlprotokoll() {
  const inputs = {}; const sum = h('b');
  const calc = () => { let s = 0; for (const [w, i] of Object.entries(inputs)) s += Number(w) * (parseInt(i.value, 10) || 0); sum.textContent = fmt.money(r2(s)); return r2(s); };
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 12px' } }, MUENZEN.map(w => { const i = h('input', { type: 'number', min: 0, style: { width: '70px' } }); i.addEventListener('input', calc); inputs[w] = i; return h('label', { class: 'inline' }, h('span', { style: { width: '70px', textAlign: 'right' } }, fmt.money(Number(w))), '×', i); }));
  const r = await dialog('Kassenzählprotokoll', h('div', null, grid, h('div', { style: { marginTop: '8px', fontSize: '16px' } }, 'Gezählt: ', sum)), [{ label: 'Übernehmen', cls: 'primary', value: () => ({ betrag: calc(), protokoll: Object.fromEntries(Object.entries(inputs).map(([w, i]) => [w, parseInt(i.value, 10) || 0])) }) }, { label: 'Abbrechen', value: null }], { width: 620 });
  return r;
}

Views.kasse = async (main) => {
  await LK.ensure();
  let st = await api('/api/kasse');
  let lines = []; let kunde = null; let sel = -1;
  const bedSel = h('select', null, h('option', { value: '' }, st.bediener.length ? '– Bediener –' : '(kein Bediener)'), st.bediener.map(b => h('option', { value: b.id }, b.name)));
  bedSel.value = Pref.get('kasse.bediener', '');
  bedSel.addEventListener('change', () => Pref.set('kasse.bediener', bedSel.value));
  const kundeInfo = h('span', { class: 'hint' }, 'Barverkauf');
  const eingabe = h('input', { type: 'search', placeholder: 'Artikel-Nr. / EAN / AW-Nr. scannen oder eingeben + Enter', style: { width: '100%', height: '34px', fontSize: '15px' } });
  const tblWrap = h('div', { class: 'pos-wrap', style: { minHeight: '300px' } });
  const summe = h('div', { style: { fontSize: '38px', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } });
  const bestand = h('div', { class: 'hint', style: { textAlign: 'right' } });
  // US: prices before sales tax, the tax is added per rate (labor non-taxable if so set)
  const us = LK.data && LK.data.land === 'US';
  const zeile = l => r2(parseNum(l.MENGE) * parseNum(l.EINZEL) * (1 - parseNum(l.RABATT) / 100));
  const usRate = l => Number(l.DURCHLAUFER) === 1 || (LK.data.usLaborFree && l.POSART === 'L') ? 0 : LK.rate(l.MWST || 61);
  const total = () => {
    if (!us) return r2(lines.reduce((s, l) => s + zeile(l), 0));
    const g = {}; for (const l of lines) g[usRate(l)] = (g[usRate(l)] || 0) + zeile(l);
    return r2(Object.entries(g).reduce((s, [rt, n]) => s + r2(n) + r2(r2(n) * Number(rt) / 100), 0));
  };
  const draw = () => {
    const tbl = h('table', { class: 'pos' }, h('thead', null, h('tr', null, ['Bezeichnung', 'Menge', 'Einzel', 'Rabatt %', 'MwSt', 'Summe', ''].map(x => h('th', null, x)))));
    const tb = h('tbody');
    lines.forEach((l, i) => {
      const c = (f, num) => { const e = h('input', { type: 'text', class: num ? 'num' : '', value: num ? fmt.num(l[f], 3) : l[f] ?? '' }); e.addEventListener('change', () => { l[f] = num ? parseNum(e.value) : e.value; draw(); }); e.addEventListener('focus', () => { sel = i; }); return e; };
      const mw = h('select', null, LK.list('mwst').map(m => h('option', { value: m.id, selected: Number(l.MWST) === m.id }, LK.rate(m.id) + ' %'))); mw.addEventListener('change', () => { l.MWST = Number(mw.value); });
      tb.append(h('tr', { class: i === sel ? 'sel' : '' }, h('td', null, c('BEZEICHNUNG')), h('td', { style: { width: '80px' } }, c('MENGE', 1)), h('td', { style: { width: '100px' } }, c('EINZEL', 1)), h('td', { style: { width: '70px' } }, c('RABATT', 1)), h('td', { style: { width: '70px' } }, mw),
        h('td', { class: 'r', style: { width: '100px' } }, fmt.money0(r2(parseNum(l.MENGE) * parseNum(l.EINZEL) * (1 - parseNum(l.RABATT) / 100)))), h('td', { style: { width: '36px' } }, h('button', { class: 'btn icon sm', onclick: () => { lines.splice(i, 1); draw(); } }, '✕'))));
    });
    tbl.append(tb); tblWrap.innerHTML = ''; tblWrap.append(tbl);
    if (!lines.length) tblWrap.append(h('div', { class: 'grid-empty' }, 'Artikel scannen, Schnelltaste drücken oder über die Schaltflächen hinzufügen.'));
    summe.textContent = fmt.money(total());
    bestand.textContent = T(`Kassenbestand: ${fmt.money(st.bestand)}${st.land === 'ES' ? ' · VERI*FACTU' : st.land === 'GB' ? '' : st.land === 'US' ? ` · ${T('inkl. Sales Tax')}` : st.land === 'AT' ? (st.atRksv ? ' · RKSV aktiv' : ' · RKSV nicht aktiviert') : st.land === 'CH' ? '' : st.land === 'IT' ? ' · ' + T('jeder Verkauf als Fattura') : ['NL', 'BE', 'LU'].includes(st.land) ? '' : st.tse.aktiv ? ' · TSE aktiv' : ' · ohne TSE'}`);
  };
  const addArtikel = async (artid, menge = 1) => {
    const a = await api('/api/rec/artikel/' + artid);
    const mw = a.MWST > 0 ? a.MWST : 61;
    const ex = lines.find(l => l.ARTID === a.ARTID && l.POSART === 'A');
    if (ex) ex.MENGE = parseNum(ex.MENGE) + menge;
    else lines.push({ POSART: 'A', ARTID: a.ARTID, ARTNUMMER: a.ARTNUMMER, BEZEICHNUNG: a.BEZEICHNUNG1, MENGE: menge, EINZEL: r2((a.VKPNETTO || 0) * (us ? 1 : 1 + LK.rate(mw) / 100)), MWST: mw, EK: a.EKPNETTO || 0, EINHEITID: a.EINHEITID });
    draw();
  };
  const addAw = async (id, menge) => {
    const aw = await api('/api/rec/arbeitswerte/' + id);
    const ks = LK.list('kostensaetze').find(x => String(x.id) === String(aw.KOSTENSATZID));
    const fest = Number(aw.FESTPREISCHECK) === 1 || !ks; const mw = aw.MWST > 0 ? aw.MWST : 61;
    lines.push({ POSART: 'L', ARTID: aw.LEISTUNGID, ARTNUMMER: aw.LEISTUNGNUMMER, BEZEICHNUNG: aw.BEZEICHNUNG1, MENGE: menge ?? (fest ? 1 : aw.ANZAHLAW || 1), EINZEL: r2((fest ? aw.VKPNETTO || 0 : ks.preis || 0) * (us ? 1 : 1 + LK.rate(mw) / 100)), MWST: mw, DURCHLAUFER: aw.DURCHLAUF || 0, EINHEITID: aw.EINHEITID });
    draw();
  };
  eingabe.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    let v = eingabe.value.trim(); if (!v) return;
    let menge = 1; const m = v.match(/^(\d+(?:[.,]\d+)?)\*(.+)$/); if (m) { menge = parseNum(m[1]); v = m[2]; }
    for (const field of ['ARTNUMMER', 'EAN']) {
      const r = await api('/api/list/artikel?' + qs({ q: v, field, limit: 5, filters: { lager: 'alle' } }));
      const a = r.rows.find(x => String(x[field] || '').toLowerCase() === v.toLowerCase());
      if (a) { await addArtikel(a.ARTID, menge); eingabe.value = ''; return; }
    }
    const r2_ = await api('/api/list/arbeitswerte?' + qs({ q: v, field: 'LEISTUNGNUMMER', limit: 5 }));
    const aw = r2_.rows.find(x => String(x.LEISTUNGNUMMER || '').toLowerCase() === v.toLowerCase());
    if (aw) { await addAw(aw.LEISTUNGID, menge); eingabe.value = ''; return; }
    toast(`„${v}“ nicht gefunden`, 'err');
  });
  const druckeBon = async d => { await Print.kassenbon(d); if (App.setting('kasse.rechnungdrucken', '0') === '1' && d.bon.RECHNUNGID) await Vorgang.printById('rechnung', d.bon.RECHNUNGID); };
  const nachBon = async d => { lines = []; kunde = null; kundeInfo.textContent = T('Barverkauf'); st = await api('/api/kasse'); draw(); renderLetzte(); await druckeBon(d); eingabe.focus(); };
  const pruefeBediener = () => { if (st.bediener.length && !bedSel.value) { toast('Bitte zuerst den Bediener wählen.', 'err'); bedSel.focus(); return false; } return true; };
  const bezahlen = async (zahlart, extra = {}) => {
    if (!pruefeBediener()) return;
    let betrag = extra.betrag ?? total();
    if (!extra.rechnungid && !extra.auftragid && !lines.length) { toast('Keine Positionen erfasst.', 'err'); return; }
    // Switzerland: cash is rounded to 5 centimes (the server adds the rounding difference as a line)
    if (zahlart === 'BAR' && LK.data && LK.data.land === 'CH' && !extra.rechnungid && !extra.auftragid) betrag = Math.round(Math.round(betrag * 100) / 5) * 5 / 100;
    let gegeben = betrag;
    if (zahlart === 'BAR') {
      const g = h('input', { type: 'text', class: 'num', value: fmt.num2(betrag), style: { fontSize: '24px', height: '40px', width: '100%' } });
      const rg = h('div', { style: { fontSize: '22px', marginTop: '8px' } });
      const upd = () => { rg.textContent = T('Rückgeld: ' + fmt.money(Math.max(0, r2(parseNum(g.value) - betrag)))); };
      g.addEventListener('input', upd); upd();
      g.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); g.closest('.win').querySelector('.btn.primary').click(); } });
      setTimeout(() => g.select(), 50);
      const ok = await dialog(`Barzahlung – ${fmt.money(betrag)}`, h('div', null, h('div', { class: 'hint' }, 'Gegeben'), g, rg, h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' } }, [5, 10, 20, 50, 100].map(x => h('button', { class: 'btn', onclick: () => { g.value = fmt.num2(x); upd(); } }, { CHF: 'CHF ' + x, GBP: '£' + x, USD: '$' + x }[LK.data && LK.data.waehrung] || x + ' €')))), [{ label: 'Bezahlen', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 380 });
      if (!ok) return;
      gegeben = parseNum(g.value);
      if (gegeben < betrag - 0.004) { toast('Der gegebene Betrag ist zu niedrig.', 'err'); return; }
    } else if (zahlart === 'KRYPTO') {
      const kid = await kryptoZahlung(betrag, extra.rechnungid ? 'Rechnung' : extra.auftragid ? 'Auftrag' : (lines[0] && lines[0].BEZEICHNUNG) || 'Einkauf');
      if (!kid) return;
      extra = { ...extra, kryptoid: kid };
    } else if (zahlart === 'EC' && st.ec) {
      toast('Bitte Karte am Terminal vorlegen …');
      try { const r = await api('/api/kasse/ec', { method: 'POST', body: { betrag } }); if (!r.ok) { toast('EC-Zahlung fehlgeschlagen: ' + r.fehler, 'err'); return; } }
      catch (e) { if (!(await confirmDlg(`EC-Terminal: ${e.message}\n\nWurde die Zahlung am Terminal trotzdem erfolgreich durchgeführt?`))) return; }
    }
    try {
      const d = await api('/api/kasse/bon', { method: 'POST', body: { positionen: lines, zahlart, gegeben, kunid: kunde && kunde.KUNID, benid: bedSel.value || null, ...extra } });
      if (d.bon.TSE_FEHLER) toast(d.bon.TSE_FEHLER, 'err');
      await nachBon(d);
    } catch (e) { showError(e); }
  };
  const letzte = h('div');
  const renderLetzte = () => { letzte.innerHTML = ''; letzte.append(h('table', { class: 'simple' }, h('tbody', null, st.letzte.map(b => h('tr', { class: 'click', onclick: async () => druckeBon(await api('/api/kasse/bon/' + b.ID)) }, h('td', null, b.BONNR), h('td', null, String(b.ZEIT).slice(11, 16)), h('td', null, b.TYP === 'Beleg' ? (b.KUNDE || '') : b.TYP), h('td', { class: 'num' }, fmt.money0(b.BRUTTO)), h('td', null, b.STORNIERT ? h('span', { class: 'badge err' }, 'storniert') : b.ZAHLART)))))); };
  const schnell = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '4px' } },
    st.schnelltasten.map(s => h('button', { class: 'btn', style: { height: '46px', whiteSpace: 'normal', lineHeight: 1.1 }, onclick: () => s.art === 'L' ? addAw(s.id) : addArtikel(s.id) }, s.label)));
  const zahlBtn = (l, za, color) => h('button', { class: 'btn', style: { height: '56px', fontSize: '17px', fontWeight: 700, background: color, color: '#fff', borderColor: 'transparent' }, onclick: () => bezahlen(za) }, l);
  main.append(titel('Kasse', st.autorechnung ? 'Zu jedem Kassenvorgang wird automatisch eine Rechnung erstellt.' : ''),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 330px', gap: '10px', flex: 1, minHeight: 0 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 } },
        h('div', { class: 'form-row' }, h('label', { class: 'inline' }, 'Bediener', bedSel),
          h('button', { class: 'btn', onclick: async () => { const k = await pickKunde(); if (k) { kunde = k; kundeInfo.textContent = T(`Kunde: ${k.NUMMER || ''} ${kname(k)}`); } } }, '👤 Kunde wählen'), kundeInfo,
          kunde ? null : null),
        eingabe,
        h('div', { class: 'form-row' },
          h('button', { class: 'btn', onclick: async () => { const a = await pickRecord('artikel', { title: 'Artikel' }); if (a) addArtikel(a.ARTID); } }, '📦 Artikel'),
          h('button', { class: 'btn', onclick: () => { lines.push({ POSART: 'A', BEZEICHNUNG: 'Artikel', MENGE: 1, EINZEL: 0, MWST: 61 }); sel = lines.length - 1; draw(); $$('tbody tr', tblWrap).pop()?.querySelector('input')?.select(); } }, '➕ freier Artikel'),
          h('button', { class: 'btn', onclick: async () => { const a = await pickRecord('arbeitswerte', { title: 'Arbeitswert' }); if (a) addAw(a.LEISTUNGID); } }, '🔧 Arbeitswerte'),
          h('button', { class: 'btn', onclick: () => { lines.push({ POSART: 'L', BEZEICHNUNG: 'Arbeitsleistung', MENGE: 1, EINZEL: 0, MWST: 61 }); sel = lines.length - 1; draw(); } }, '➕ freier AW'),
          h('button', { class: 'btn', onclick: () => { if (lines.length && confirm(T('Alle Positionen verwerfen?'))) { lines = []; draw(); } } }, '🗑 Leeren')),
        tblWrap, st.schnelltasten.length ? schnell : h('div', { class: 'hint' }, 'Schnelltasten unter Einstellungen → Kasse anlegen.')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { class: 'panel' }, h('div', { class: 'pb' }, h('div', { class: 'hint' }, 'Zu zahlen'), summe, bestand)),
        zahlBtn('BAR', 'BAR', '#2e8b3e'), zahlBtn('EC-Karte', 'EC', '#1e66c8'), zahlBtn('Kreditkarte', 'KARTE', '#5a4fb0'),
        st.krypto ? zahlBtn('₿ Bitcoin / Lightning', 'KRYPTO', '#e8830c') : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
          h('button', { class: 'btn', style: { height: '44px' }, onclick: async () => {
            if (!pruefeBediener()) return;
            const a = await pickRecord('auftraege', { title: 'Auftrag bezahlen', params: { filters: JSON.stringify({ status: 'offen', archiv: 'aktiv' }) } }); if (!a) return;
            const za = await dialog(`Auftrag ${a.AUFTRAGNUMMER} über ${fmt.money(a.GBRUTTO)} bezahlen`, h('div', null, 'Zahlart wählen:'), [{ label: 'Bar', cls: 'primary', value: 'BAR' }, { label: 'EC-Karte', value: 'EC' }, ...(st.krypto ? [{ label: '₿ Krypto', value: 'KRYPTO' }] : []), { label: 'Abbrechen', value: null }]);
            if (za) bezahlen(za, { auftragid: a.AUFTRAGID, betrag: a.GBRUTTO });
          } }, '🛠️ Auftrag bezahlen'),
          h('button', { class: 'btn', style: { height: '44px' }, onclick: async () => {
            if (!pruefeBediener()) return;
            const op = await api('/api/finanzen/op');
            const g = miniGrid([{ f: 'RECHNUNGNUMMER', l: 'Rechnung', w: 90 }, { f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'KUNDE', l: 'Kunde', w: 220 }, { f: 'OFFEN', l: 'Offen', w: 100, t: 'money' }], op.rows.filter(r => r.OFFEN > 0), { height: 380 });
            const r = await dialog('Rechnung bezahlen', g.el, [{ label: 'Bar', cls: 'primary', value: () => g.current() && { za: 'BAR', r: g.current() } }, { label: 'EC-Karte', value: () => g.current() && { za: 'EC', r: g.current() } }, ...(st.krypto ? [{ label: '₿ Krypto', value: () => g.current() && { za: 'KRYPTO', r: g.current() } }] : []), { label: 'Abbrechen', value: null }], { width: 640 });
            if (r) bezahlen(r.za, { rechnungid: r.r.RECHNUNGID, betrag: r.r.OFFEN });
          } }, '💶 Rechnung bezahlen'),
          h('button', { class: 'btn', style: { height: '44px' }, onclick: () => kassenBewegung('Einzahlung', bedSel.value).then(async d => { if (d) { st = await api('/api/kasse'); draw(); renderLetzte(); } }) }, '⬇ Einzahlung'),
          h('button', { class: 'btn', style: { height: '44px' }, onclick: () => kassenBewegung('Auszahlung', bedSel.value).then(async d => { if (d) { st = await api('/api/kasse'); draw(); renderLetzte(); } }) }, '⬆ Auszahlung')),
        h('button', { class: 'btn', style: { height: '44px' }, onclick: () => kassenVerwaltung(bedSel.value).then(async () => { st = await api('/api/kasse'); draw(); renderLetzte(); }) }, '⚙ Verwaltung (Journal, Storno, Abschluss)'),
        h('div', { class: 'panel', style: { flex: 1, minHeight: 0 } }, h('h3', null, 'Letzte Bons'), h('div', { class: 'pb' }, letzte)))));
  draw(); renderLetzte(); eingabe.focus();
  for (const w of st.kryptoWarnungen || []) toast(`Achtung: Eine abgebrochene Krypto-Zahlung über ${fmt.money(w.BETRAG)} (${fmt.datetime(w.ANGELEGT)}) wurde doch noch bezahlt. Es gibt dazu keinen Bon. Bitte prüfen und ggf. über BTCPay erstatten.`, 'err');
};

async function kassenBewegung(typ, benid) {
  const betrag = h('input', { type: 'text', class: 'num' }), verw = h('input', { type: 'text', placeholder: typ === 'Einzahlung' ? 'z. B. Wechselgeld' : 'z. B. Bankeinzahlung, Einkauf Büromaterial' }), gk = h('input', { type: 'text', placeholder: 'optional, z. B. 1360 Geldtransit' });
  const ok = await dialog(typ, h('div', { class: 'fgrid' }, fld2('Betrag', betrag, 1), fld2('Gegenkonto (FIBU)', gk, 1), fld2('Verwendung', verw)), [{ label: 'Buchen', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 480 });
  if (!ok) return null;
  try { const d = await api('/api/kasse/bewegung', { method: 'POST', body: { typ, betrag: parseNum(betrag.value), verwendung: verw.value, gegenkonto: gk.value, benid } }); await Print.kassenbon(d); return d; } catch (e) { showError(e); return null; }
}

async function kassenVerwaltung(benid) {
  return new Promise(resolve => {
    const tabs = h('div', { class: 'tabs' }); const pane = h('div', { class: 'win-body flex', style: { padding: '6px 0 0' } });
    const w = Win.open({ title: 'Kassenverwaltung', width: 1080, height: 700, content: h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tabs, pane), onClose: () => resolve() });
    const show = async t => {
      $$('button', tabs).forEach(b => b.classList.toggle('active', b.dataset.k === t)); pane.innerHTML = '';
      if (t === 'journal') {
        const von = h('input', { type: 'date', value: today() }), bis = h('input', { type: 'date', value: today() });
        let g; const holder = h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } });
        const load = async () => {
          const rows = await api('/api/kasse/journal?' + qs({ von: von.value, bis: bis.value }));
          g = miniGrid([{ f: 'BONNR', l: 'Bon', w: 60 }, { f: 'ZEIT', l: 'Zeit', w: 140, t: 'datetime' }, { f: 'TYP', l: 'Typ', w: 100 }, { f: 'KUNDE', l: 'Kunde / Verwendung', w: 220, render: r => r.TYP === 'Beleg' ? (r.KUNDE || '') + (r.STORNOID ? ' (Storno)' : '') : r.VERWENDUNG }, { f: 'BRUTTO', l: 'Betrag', w: 90, t: 'money' }, { f: 'ZAHLART', l: 'Zahlart', w: 80 }, { f: 'BEDIENER', l: 'Bediener', w: 110 }, { f: 'tse', l: 'TSE', w: 70, render: r => r.TSE_SIGNATUR ? '✓' : r.TSE_FEHLER ? '⚠' : '–' }, { f: 'st', l: 'Status', w: 90, render: r => r.STORNIERT ? 'storniert' : r.ABSCHLUSSID ? 'abgeschl.' : '' }], rows, { onOpen: async r => Print.kassenbon(await api('/api/kasse/bon/' + r.ID), { kopie: true }) });
          holder.innerHTML = ''; holder.append(g.el);
        };
        von.addEventListener('change', load); bis.addEventListener('change', load);
        pane.append(h('div', { class: 'searchbar' }, h('label', null, 'von', von), h('label', null, 'bis', bis)), holder,
          h('div', { class: 'grid-footer' }, h('span', { class: 'spacer' }),
            h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c) Print.kassenbon(await api('/api/kasse/bon/' + c.ID), { kopie: true }); } }, '🖨 Nachdruck'),
            h('button', { class: 'btn', onclick: async () => {
              const c = g.current(); if (!c) return;
              const rk = h('input', { type: 'checkbox', checked: true }); const za = h('select', null, h('option', { value: 'BAR' }, 'Bar'), h('option', { value: 'EC' }, 'EC-Karte'), c.ZAHLART === 'KRYPTO' ? h('option', { value: 'KRYPTO' }, 'Krypto (Erstattung über BTCPay)') : null); za.value = ['BAR', 'KRYPTO'].includes(c.ZAHLART) ? c.ZAHLART : 'EC';
              const ok = await dialog(`Bon ${c.BONNR} stornieren`, h('div', { class: 'fgrid' }, h('label', { class: 'fld chk' }, rk, h('span', null, 'Rechnungskorrektur zur Rechnung erstellen')), fld2('Rückzahlung per', za)), [{ label: 'Stornieren', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }]);
              if (!ok) return;
              try { const d = await api('/api/kasse/storno/' + c.ID, { method: 'POST', body: { rechnungskorrektur: rk.checked, zahlart: za.value } }); await Print.kassenbon(d); load(); } catch (e) { showError(e); }
            } }, '↩ Bon stornieren')));
        load();
      } else if (t === 'abschluss') {
        const v = await api('/api/kasse/abschluss/vorschau');
        const ist = h('input', { type: 'text', class: 'num', style: { fontSize: '20px', height: '36px', width: '180px' } });
        let protokoll = null;
        const diff = h('b'); const upd = () => { diff.textContent = T(ist.value ? fmt.money(r2(parseNum(ist.value) - v.soll)) : ''); };
        ist.addEventListener('input', upd);
        pane.append(h('div', { class: 'groups' },
          h('fieldset', { class: 'grp' }, h('legend', null, `Kassenabschluss Nr. ${v.znr}`), h('table', { class: 'simple' }, h('tbody', null,
            [['Bons seit letztem Abschluss', v.bons], ['Anfangsbestand', fmt.money(v.anfang)], ['Bareinnahmen', fmt.money(v.bar_ein)], ['Barausgaben', fmt.money(v.bar_aus)], ['Soll-Bestand', fmt.money(v.soll)], ['Umsatz brutto', fmt.money(v.umsatz_brutto)], ['Umsatz netto', fmt.money(v.umsatz_netto)], ...Object.entries(v.zahlarten).map(([k, x]) => ['davon ' + k, fmt.money(x)])].map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'num' }, b)))))),
          h('fieldset', { class: 'grp' }, h('legend', null, 'Zählung'), h('div', { class: 'fgrid' },
            fld2('Kassenbestand laut Zählung', ist), h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => { const r = await zaehlprotokoll(); if (r) { protokoll = r.protokoll; ist.value = fmt.num2(r.betrag); upd(); } } }, '🧮 Kassenzählprotokoll')),
            h('div', { class: 'fld' }, 'Differenz: ', diff),
            h('div', { class: 'fld' }, h('button', { class: 'btn primary', onclick: async () => {
              if (!ist.value) { toast('Bitte den gezählten Bestand eingeben.', 'err'); return; }
              if (!(await confirmDlg(`Buchungen abschließen?\nSoll ${fmt.money(v.soll)} · Ist ${fmt.money(parseNum(ist.value))} · Differenz ${diff.textContent}`))) return;
              try { const a = await api('/api/kasse/abschluss', { method: 'POST', body: { ist: parseNum(ist.value), zaehlprotokoll: protokoll, benid } }); toast(`Kassenabschluss Z${a.ZNR} erstellt`, 'ok'); await Print.zbon(a); show('berichte'); } catch (e) { showError(e); }
            } }, '✔ Buchungen abschließen'))))));
      } else if (t === 'berichte') {
        const rows = await api('/api/kasse/abschluesse');
        const g = miniGrid([{ f: 'ZNR', l: 'Z-Nr.', w: 60 }, { f: 'ZEIT', l: 'Zeit', w: 140, t: 'datetime' }, { f: 'UMSATZ_BRUTTO', l: 'Umsatz brutto', w: 110, t: 'money' }, { f: 'SOLL', l: 'Soll', w: 100, t: 'money' }, { f: 'IST', l: 'Ist', w: 100, t: 'money' }, { f: 'DIFFERENZ', l: 'Differenz', w: 90, t: 'money' }, { f: 'BEDIENER', l: 'Bediener', w: 120 }], rows, { onOpen: async r => Print.zbon(await api('/api/kasse/abschluss/' + r.ID)) });
        const von = h('input', { type: 'date', value: today().slice(0, 7) + '-01' }), bis = h('input', { type: 'date', value: today() });
        pane.append(g.el, h('div', { class: 'grid-footer' }, h('label', null, 'DSFinV-K von', von), h('label', null, 'bis', bis),
          h('button', { class: 'btn', onclick: () => downloadUrl('/api/kasse/dsfinvk?' + qs({ von: von.value, bis: bis.value }), 'DSFinV-K.zip') }, '📤 DSFinV-K-Export'),
          h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c) Print.zbon(await api('/api/kasse/abschluss/' + c.ID)); } }, '🖨 Z-Bon drucken')));
      }
    };
    for (const [k, l] of [['journal', 'Kassenbewegungen'], ['abschluss', 'Abschluss'], ['berichte', 'Berichte / Export']]) tabs.append(h('button', { 'data-k': k, onclick: () => show(k) }, l));
    w.setButtons(['|', { label: 'Schließen', onClick: () => w.close() }]);
    show('journal');
  });
}

// ================= Vehicle trading =================
SUBS.handelKalkulation = async (pane, id) => {
  const draw = async () => {
    const fz = await api('/api/rec/fahrzeuglager/' + id).catch(() => api('/api/rec/fahrzeuge/' + id));
    const k = await api(`/api/handel/${id}/kalkulation`);
    const list = await api(`/api/handel/${id}/aufwand`);
    const ek = h('input', { type: 'text', class: 'num', value: fmt.num2(fz.EKP) }), vk = h('input', { type: 'text', class: 'num', value: fmt.num2(fz.VKPBRUTTO || fz.VKP) });
    const save = async () => { await api('/api/rec/fahrzeuge/' + id, { method: 'PUT', body: { ...fz, EKP: parseNum(ek.value), VKPBRUTTO: parseNum(vk.value), VKP: parseNum(vk.value) } }); draw(); };
    const g = miniGrid([{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'BESCHREIBUNG', l: 'Beschreibung', w: 260 }, { f: 't', l: 'Art', w: 90, render: r => r.TYP === 'G' ? 'Gutschrift' : 'Kosten' }, { f: 'BETRAGNETTO', l: 'Betrag netto', w: 110, t: 'money' }], list, { height: 200, empty: 'Noch keine Kosten erfasst.', onOpen: r => edit(r) });
    const edit = async (r = {}) => {
      const bez = h('input', { type: 'text', value: r.BESCHREIBUNG || '' }), dat = h('input', { type: 'date', value: r.DATUM || today() }), betrag = h('input', { type: 'text', class: 'num', value: r.BETRAGNETTO != null ? fmt.num2(r.BETRAGNETTO) : '' });
      const typ = h('select', null, h('option', { value: 'K' }, 'Kosten (addieren)'), h('option', { value: 'G' }, 'Gutschrift (abziehen)')); typ.value = r.TYP || 'K';
      if (await dialog('Kosten / Aufwand', h('div', { class: 'fgrid' }, fld2('Beschreibung', bez), fld2('Datum', dat, 1), fld2('Art', typ, 1), fld2('Betrag netto', betrag, 1)), [{ label: 'OK', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }])) {
        await api('/api/handel/aufwand', { method: 'POST', body: { AUFWID: r.AUFWID, FAHRID: id, BESCHREIBUNG: bez.value, DATUM: dat.value, TYP: typ.value, BETRAGNETTO: parseNum(betrag.value) } }); draw();
      }
    };
    pane.innerHTML = '';
    pane.append(h('div', { class: 'groups' },
      h('fieldset', { class: 'grp' }, h('legend', null, 'Kalkulation'), h('div', { class: 'fgrid' },
        fld2('Einkaufspreis', ek, 1), fld2('Verkaufspreis brutto', vk, 1), h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: save }, '💾 Preise übernehmen')),
        h('table', { class: 'simple fld' }, h('tbody', null, [['Aufwand / Kosten', k.aufwand], ['Einsatz (EK + Aufwand)', k.einsatz], ['Verkaufspreis netto', k.vknetto], [k.diffbesteuert ? 'USt auf Marge (§ 25a)' : 'MwSt', k.mwst], ['Gewinn', k.gewinn]].map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'num', style: { fontWeight: a === 'Gewinn' ? 700 : '', color: a === 'Gewinn' && b < 0 ? 'var(--err)' : '' } }, fmt.money(b)))))),
        h('div', { class: 'fld hint' }, k.diffbesteuert ? 'Differenzbesteuerung: Umsatzsteuer nur auf die Marge, nicht ausweisbar.' : 'Regelbesteuerung: MwSt ausweisbar.'))),
      h('fieldset', { class: 'grp' }, h('legend', null, 'Kosten / Aufwandsrechnung'), g.el, h('div', { class: 'form-row', style: { marginTop: '6px' } },
        h('button', { class: 'btn', onclick: () => edit() }, '➕ Neu'), h('button', { class: 'btn', onclick: () => { const c = g.current(); if (c) edit(c); } }, '✏️ Bearbeiten'),
        h('button', { class: 'btn', onclick: async () => { const c = g.current(); if (c && await confirmDlg('Eintrag löschen?')) { await api('/api/handel/aufwand/' + c.AUFWID, { method: 'DELETE' }); draw(); } } }, '🗑 Löschen'),
        h('button', { class: 'btn', onclick: () => Print.aufwand(fz, list, k) }, '🖨 Drucken')))));
  };
  draw();
};

async function fahrzeugVerkaufen(fz) {
  const k = await pickKunde(); if (!k) return;
  const pos = await api(`/api/handel/${fz.FAHR_ID}/position?art=verkauf`);
  const t = await api('/api/vorgang/rechnung/neu?' + qs({ kunid: k.KUNID }));
  return Vorgang.openWith('rechnung', { ...t, kopf: { ...t.kopf, ANSICHTBRUTTO: 1 }, pos: [pos] });
}

Views.verkaufsstatistik = async (main) => {
  let von = today().slice(0, 4) + '-01-01', bis = today();
  const wrap = h('div', { class: 'overview' }); let data, g;
  const cols = [{ f: 'DATUM', l: 'Verkauf', w: 90, t: 'date' }, { f: 'MARKE', l: 'Marke', w: 120 }, { f: 'MODELL', l: 'Modell', w: 150 }, { f: 'FZIDENTNR', l: 'FIN', w: 150 }, { f: 'KUNDE', l: 'Käufer', w: 180 }, { f: 'RECHNUNGNUMMER', l: 'Rechnung', w: 90 }, { f: 'EINSATZ', l: 'Einsatz', w: 95, t: 'money' }, { f: 'VK', l: 'VK brutto', w: 95, t: 'money' }, { f: 'VKNETTO', l: 'VK netto', w: 95, t: 'money' }, { f: 'GEWINN', l: 'Gewinn', w: 95, t: 'money' }, { f: 'STANDTAGE', l: 'Standtage', w: 80, t: 'int' }];
  const load = async () => {
    data = await api('/api/handel/statistik?' + qs({ von, bis }));
    const ng = miniGrid(cols, data.rows, { footer: data.summe, onOpen: r => Vorgang.open('rechnung', r.RECHNUNGID) });
    if (g) g.el.replaceWith(ng.el); else wrap.append(ng.el); g = ng;
  };
  const v = h('input', { type: 'date', value: von }), b = h('input', { type: 'date', value: bis });
  v.addEventListener('change', () => { von = v.value; load(); }); b.addEventListener('change', () => { bis = b.value; load(); });
  main.append(titel('Fahrzeug-Verkaufsstatistik'), h('div', { class: 'searchbar' }, h('label', null, 'von', v), h('label', null, 'bis', b)), wrap,
    h('div', { class: 'grid-footer' }, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => Print.liste('Fahrzeug-Verkaufsstatistik', `${fmt.date(von)} – ${fmt.date(bis)}`, cols, data.rows, data.summe, { quer: true }) }, '🖨 Drucken')));
  await load();
};

// ================= Data import (interfaces) =================
Views.datenimport = async (main) => {
  const art = h('select', null, [['kunden', 'Kunden'], ['fahrzeuge', 'Fahrzeuge'], ['artikel', 'Artikel'], ['arbeitswerte', 'Arbeitswerte'], ['lieferanten', 'Lieferanten'], ['datanorm', 'Artikel/Preise aus DATANORM 4/5']].map(([k, l]) => h('option', { value: k }, l)));
  const body = h('div', { class: 'view-scroll' });
  const render = async () => {
    body.innerHTML = '';
    if (art.value === 'datanorm') {
      const preis = h('select', null, h('option', { value: 'auto' }, 'automatisch (lt. Preiskennzeichen)'), h('option', { value: 'vk' }, 'als Verkaufspreis'), h('option', { value: 'ek' }, 'als Einkaufspreis'));
      const auf = h('input', { type: 'text', class: 'num', value: '0' });
      const lief = h('select', null, h('option', { value: '' }, '–'), LK.list('lieferanten').map(l => h('option', { value: l.id }, l.name)));
      const res = h('div');
      body.append(h('div', { class: 'groups' }, h('fieldset', { class: 'grp' }, h('legend', null, 'DATANORM-Import'), h('div', { class: 'fgrid' },
        h('div', { class: 'fld hint' }, 'Liest A-Sätze (Artikel, Preise) und B-Sätze (EAN) aus DATANORM-Dateien Ihres Teilelieferanten. Vorhandene Artikel (gleiche Artikel-Nr.) werden aktualisiert.'),
        fld2('Preise übernehmen', preis, 1), fld2('Aufschlag auf EK für VK (%)', auf, 1), fld2('Lieferant zuordnen', lief),
        h('div', { class: 'fld' }, h('button', { class: 'btn primary', onclick: async () => { const f = await pickFile('*/*'); if (!f) return; try { const r = await api('/api/import/datanorm?' + qs({ preisAls: preis.value, aufschlag: parseNum(auf.value), lieferant: lief.value }), { method: 'POST', body: f }); res.innerHTML = ''; res.append(h('div', { class: 'note ok' }, `✔ ${r.gelesen} Artikel gelesen: ${r.neu} neu, ${r.geaendert} aktualisiert, ${r.geloescht} gelöscht.`)); } catch (e) { showError(e); } } }, '📂 DATANORM-Datei wählen & importieren')), res))));
      return;
    }
    const ent = art.value;
    const meta = await api('/api/import/felder/' + ent);
    let file = null, vorschau = null;
    const skip = h('input', { type: 'checkbox', checked: true }); const upd = h('input', { type: 'checkbox', checked: true });
    const delim = h('select', null, h('option', { value: '' }, 'automatisch'), h('option', { value: ';' }, 'Semikolon ;'), h('option', { value: ',' }, 'Komma ,'), h('option', { value: '\t' }, 'Tabulator'), h('option', { value: '|' }, 'senkrechter Strich |'));
    const mapBox = h('div'); const res = h('div'); const sels = {};
    const vorlSel = h('select', null, h('option', { value: '' }, '– Vorlage –'), Object.keys(meta.vorlagen).map(n => h('option', { value: n }, n)));
    vorlSel.addEventListener('change', () => { const v = meta.vorlagen[vorlSel.value]; if (!v) return; delim.value = v.delim || ''; skip.checked = !!v.ersteZeileUeberspringen; for (const [f, c] of Object.entries(v.zuordnung || {})) if (sels[f]) sels[f].value = c; });
    const ladeVorschau = async () => {
      if (!file) return;
      vorschau = await api('/api/import/csv/vorschau?' + qs({ delim: delim.value }), { method: 'POST', body: file });
      mapBox.innerHTML = '';
      const kopf = vorschau.beispiel[0] || [];
      const opts = Array.from({ length: vorschau.spalten }, (_, i) => h('option', { value: i }, `Spalte ${i + 1}: ${String(kopf[i] ?? '').slice(0, 30)}`));
      const tbl = h('table', { class: 'simple' }, h('thead', null, h('tr', null, h('th', null, 'Feld in Kuenta'), h('th', null, 'Spalte der Importdatei'))),
        h('tbody', null, meta.felder.map(f => { const s = h('select', null, h('option', { value: '' }, '– nicht importieren –'), opts.map(o => o.cloneNode(true))); sels[f.f] = s;
          const auto = kopf.findIndex(k => String(k).toLowerCase().replace(/[^a-zäöü]/g, '') === String(f.l).toLowerCase().replace(/[^a-zäöü]/g, '')); if (auto >= 0) s.value = auto;
          return h('tr', null, h('td', null, f.l, f.f === meta.schluessel ? h('span', { class: 'badge' }, 'Schlüssel') : null), h('td', null, s)); })));
      const preview = h('div', { style: { overflow: 'auto', maxHeight: '220px' } }, h('table', { class: 'simple' }, h('tbody', null, vorschau.beispiel.slice(0, 8).map(r => h('tr', null, r.map(c => h('td', null, String(c).slice(0, 40))))))));
      mapBox.append(h('div', { class: 'hint' }, `${vorschau.zeilen} Zeilen erkannt, Trennzeichen „${vorschau.delim === '\t' ? 'Tab' : vorschau.delim}“. Vorschau:`), preview, h('h4', null, 'Feldzuordnung'), tbl);
    };
    delim.addEventListener('change', ladeVorschau);
    body.append(h('div', { class: 'groups' },
      h('fieldset', { class: 'grp' }, h('legend', null, '1. Datei'), h('div', { class: 'fgrid' },
        h('div', { class: 'fld note' }, 'Tipp: Legen Sie vor dem Import eine Datensicherung an. Datensätze mit gleichem Schlüsselfeld werden aktualisiert.'),
        h('div', { class: 'fld' }, h('button', { class: 'btn', onclick: async () => { file = await pickFile('.csv,.txt,text/csv'); if (file) ladeVorschau(); } }, '📂 CSV-/Textdatei wählen')),
        fld2('Trennzeichen', delim, 1), fld2('Vorlage laden', vorlSel, 1),
        h('label', { class: 'fld chk' }, skip, h('span', null, 'erste Zeile enthält Spaltenüberschriften (überspringen)')),
        meta.schluessel ? h('label', { class: 'fld chk' }, upd, h('span', null, 'vorhandene Datensätze anhand des Schlüsselfelds aktualisieren')) : null)),
      h('fieldset', { class: 'grp', style: { gridColumn: '1 / -1' } }, h('legend', null, '2. Zuordnung & Import'), mapBox,
        h('div', { class: 'form-row', style: { marginTop: '8px' } },
          h('button', { class: 'btn', onclick: async () => { const n = await promptDlg('Name der Vorlage', ''); if (!n) return; const cfg = { delim: delim.value, ersteZeileUeberspringen: skip.checked, zuordnung: Object.fromEntries(Object.entries(sels).filter(([, s]) => s.value !== '').map(([f, s]) => [f, s.value])) }; meta.vorlagen = await api('/api/import/vorlage/' + ent, { method: 'POST', body: { name: n, cfg } }); vorlSel.append(h('option', { value: n }, n)); toast('Vorlage gespeichert', 'ok'); } }, '💾 Zuordnung als Vorlage speichern'),
          h('button', { class: 'btn primary', onclick: async () => {
            if (!file) { toast('Bitte zuerst eine Datei wählen.', 'err'); return; }
            const zuordnung = Object.fromEntries(Object.entries(sels).filter(([, s]) => s.value !== '').map(([f, s]) => [f, Number(s.value)]));
            if (!Object.keys(zuordnung).length) { toast('Bitte mindestens ein Feld zuordnen.', 'err'); return; }
            try { const r = await api('/api/import/csv/' + ent, { method: 'POST', body: file, headers: { 'X-Optionen': encodeURIComponent(JSON.stringify({ delim: delim.value || null, ersteZeileUeberspringen: skip.checked, zuordnung, aktualisieren: upd.checked })) } });
              res.innerHTML = ''; res.append(h('div', { class: r.fehlerAnzahl ? 'note' : 'note ok' }, `✔ ${r.neu} neu angelegt, ${r.geaendert} aktualisiert.${r.fehlerAnzahl ? ` ${r.fehlerAnzahl} Fehler:` : ''}`, r.fehler.length ? h('ul', null, r.fehler.map(x => h('li', null, x))) : null)); App.refresh(ent);
            } catch (e) { showError(e); }
          } }, '📥 Importieren')), res)));
  };
  art.addEventListener('change', render);
  main.append(titel('Datenimport', 'Kunden, Fahrzeuge, Artikel, Arbeitswerte, Lieferanten aus CSV · Artikel aus DATANORM'), h('div', { class: 'searchbar' }, h('label', null, 'Import-Art', art)), body);
  render();
};

// Take a shopping cart from a parts catalogue into a document
async function warenkorbDialog() {
  const f = await pickFile('.csv,.txt,.dat,*/*'); if (!f) return null;
  let rows;
  try { rows = await api('/api/import/warenkorb', { method: 'POST', body: f }); } catch (e) { showError(e); return null; }
  if (!rows.length) { toast('Keine Positionen in der Datei erkannt.', 'err'); return null; }
  const checks = rows.map(() => h('input', { type: 'checkbox' }));
  const gross = h('input', { type: 'checkbox' }); const alle = h('input', { type: 'checkbox', onchange: () => checks.forEach(c => { c.checked = alle.checked; }) });
  const tbl = h('table', { class: 'simple' }, h('thead', null, h('tr', null, h('th', null, 'Anlegen'), h('th', null, 'Artikel-Nr.'), h('th', null, 'Bezeichnung'), h('th', { class: 'num' }, 'Menge'), h('th', { class: 'num' }, 'Preis'), h('th', { class: 'num' }, 'EK'))),
    h('tbody', null, rows.map((r, i) => h('tr', null, h('td', null, checks[i]), h('td', null, r.artnr), h('td', null, r.bezeichnung), h('td', { class: 'num' }, fmt.num(r.menge)), h('td', { class: 'num' }, fmt.money0(r.preis)), h('td', { class: 'num' }, fmt.money0(r.ek))))));
  const ok = await dialog(`Import aus Teilekatalog (${rows.length} Positionen)`, h('div', null, h('div', { style: { maxHeight: '50vh', overflow: 'auto' } }, tbl), h('div', { class: 'form-row', style: { marginTop: '8px' } }, h('label', { class: 'inline' }, alle, 'alle auswählen'), h('label', { class: 'inline' }, gross, 'Bezeichnung in Großschrift'))),
    [{ label: 'In den Vorgang übernehmen', cls: 'primary', value: true }, { label: 'Abbrechen', value: false }], { width: 820 });
  if (!ok) return null;
  const sel = rows.map((r, i) => ({ ...r, anlegen: checks[i].checked, bezeichnung: gross.checked ? String(r.bezeichnung).toUpperCase() : r.bezeichnung }));
  const toCreate = sel.filter(r => r.anlegen);
  if (toCreate.length) { const ids = await api('/api/import/warenkorb/anlegen', { method: 'POST', body: toCreate }); toCreate.forEach((r, i) => { r.artid = ids[i]; }); }
  return sel;
}

// ================= Tenants (Mandanten) =================
async function mandantenDialog() {
  const d = await api('/api/mandanten');
  const radios = d.liste.map(m => h('input', { type: 'radio', name: 'mand', value: m.id, checked: m.id === d.aktiv }));
  const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, d.liste.map((m, i) => h('label', { class: 'inline' }, radios[i], `${m.id}: ${m.name}`, h('button', { class: 'btn sm', onclick: async e => { e.preventDefault(); const n = await promptDlg('Neuer Name', m.name); if (n) { await api('/api/mandanten/' + m.id, { method: 'PUT', body: { name: n } }); location.reload(); } } }, '✏️'))));
  const r = await dialog('Mandant wechseln', h('div', null, h('div', { class: 'hint', style: { marginBottom: '8px' } }, 'Jeder Mandant hat eigene Daten (Kunden, Vorgänge, Einstellungen). Der gewählte Mandant gilt für diesen Browser.'), list),
    [{ label: 'Neuer Mandant…', value: 'neu' }, { label: 'Wechseln', cls: 'primary', value: 'ok' }, { label: 'Abbrechen', value: null }], { width: 460 });
  if (r === 'neu') {
    const n = await promptDlg('Name des neuen Mandanten (z. B. Demodaten oder Zweitbetrieb)', ''); if (!n) return;
    const res = await api('/api/mandanten', { method: 'POST', body: { name: n } });
    await api('/api/mandanten/wechseln', { method: 'POST', body: { id: res.id } });
    await alertDlg(`Mandant „${n}“ wurde angelegt. Sie können jetzt unter System → KFZ-Faktura-Import Daten übernehmen (z. B. die Demodaten DB0) oder neu beginnen.`);
    location.reload();
  } else if (r === 'ok') {
    const id = Number((radios.find(x => x.checked) || {}).value);
    if (id && id !== d.aktiv) { await api('/api/mandanten/wechseln', { method: 'POST', body: { id } }); location.reload(); }
  }
}
