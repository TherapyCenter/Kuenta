'use strict';
/* global title, h, api, qs, fmt, toast, showError, confirmDlg, promptDlg, alertDlg, downloadUrl, pickFile, miniGrid, Win, Views, today, LK, T */
// Spanish tax system: settings tab (IVA, series, VERI*FACTU) and VAT books (libros registro, modelo 303)

const EsUI = {
  activo() { return !!(LK.data && LK.data.land === 'ES'); },
  ESTADOS: { pendiente: 'wartet auf Versand', aceptado: 'angenommen', aceptado_errores: 'angenommen mit Fehlern', rechazado: 'abgelehnt' },

  // Settings tab; s = settings from the server, changes = collected changes, helpers from the settings view
  settingsTab(p, { s, changes, si, grp, fld }) {
    const sel = (k, label, opts, def) => {
      const x = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: (s.sw[k] ?? def) === v }, l)));
      x.addEventListener('change', () => { changes.sw[k] = x.value; });
      return fld(label, x);
    };
    const status = h('div', { class: 'fld' });
    const zeigen = async () => {
      status.textContent = T('Lade …');
      try {
        const r = await api('/api/es/estado');
        const c = r.contador || {};
        status.textContent = '';
        const zeile = (a, b, cls) => h('div', { class: cls || '' }, h('b', null, T(a) + ': '), b);
        status.append(
          zeile('Umgebung', T(r.entorno === 'produccion' ? 'Produktion – Rechnungen werden bei der AEAT registriert' : 'Test – Rechnungen werden NICHT bei der AEAT registriert'), r.entorno === 'produccion' ? '' : 'note warn'),
          zeile('NIF der Firma', r.nifEmisor || T('fehlt – bitte unter Firmendaten → Steuernummer eintragen')),
          zeile('Zertifikat', r.certificado ? T('hinterlegt am ') + r.certificado.guardado : T('nicht hinterlegt')),
          zeile('Datensätze', Object.entries(c).map(([k, n]) => `${T(EsUI.ESTADOS[k] || k)}: ${n}`).join(' · ') || '0'),
          zeile('Letzter Versand', r.ultimoEnvio || '–'),
          ...(r.ultimoError ? [zeile('Letzter Fehler', r.ultimoError, 'note err')] : []),
          zeile('Softwarehersteller', `${r.productor.nombre} · ${r.productor.id || T('Steuerkennung fehlt')} · KuentaPOS ${r.productor.version}`, r.productor.id ? '' : 'note err'));
      } catch (e) { status.textContent = '❌ ' + e.message; }
    };
    const speichern = () => api('/api/einstellungen', { method: 'PUT', body: changes });
    const zertifikat = async () => {
      const f = await pickFile('.p12,.pfx,application/x-pkcs12'); if (!f) return;
      const pw = await promptDlg('Passwort des Zertifikats', '', { type: 'password' }); if (pw == null) return;
      try { await api('/api/es/certificado', { method: 'POST', body: f, headers: { 'X-Passwort': encodeURIComponent(pw) } }); toast('Zertifikat gespeichert', 'ok'); zeigen(); } catch (e) { showError(e); }
    };
    const probar = async () => {
      try { await speichern(); const r = await api('/api/es/probar', { method: 'POST' }); toast(T('Verbindung zur AEAT in Ordnung') + ` (HTTP ${r.status})`, 'ok'); } catch (e) { showError(e); }
    };
    const enviar = async () => {
      try {
        const r = await api('/api/es/enviar', { method: 'POST' });
        if (r.error) toast('❌ ' + r.error, 'err');
        else if (r.esperar) toast(T(`Die AEAT verlangt eine Pause. Nächster Versand in ${r.esperar} s (${r.pendientes} wartend).`));
        else toast(T(`Gesendet: ${r.enviados || 0}, abgelehnt: ${r.rechazados || 0}`), r.rechazados ? 'err' : 'ok');
        zeigen();
      } catch (e) { showError(e); }
    };
    const liste = async () => {
      const rows = await api('/api/es/registros?limit=2000');
      const g = miniGrid([{ f: 'ID', l: 'Nr.', w: 55, t: 'int' }, { f: 'NUMSERIE', l: 'Rechnung', w: 110 }, { f: 'FECHA', l: 'Datum', w: 85 }, { f: 'TIPO', l: 'Art', w: 75 }, { f: 'TIPOFACTURA', l: 'Typ', w: 45 }, { f: 'IMPORTE', l: 'Betrag', w: 85 },
        { f: 'ESTADO', l: 'Status', w: 150, render: r => T(EsUI.ESTADOS[r.ESTADO] || r.ESTADO) }, { f: 'MENSAJE', l: 'Meldung der AEAT', w: 300 }, { f: 'ENTORNO', l: 'Umgebung', w: 85 }, { f: 'GENERADO', l: 'Erzeugt', w: 160 }, { f: 'CSV', l: 'CSV', w: 140 }], rows,
      { onOpen: r => downloadUrl(`/api/es/registro/${r.ID}/xml`, 'VERIFACTU.xml') });
      Win.open({ title: 'VERI*FACTU-Datensätze (Doppelklick: XML)', width: 1150, height: 600, content: g.el });
    };
    p.append(h('div', { class: 'groups' },
      grp('IVA',
        si('es.iva.general', 'Allgemeiner Satz % (tipo general)', '21', true), si('es.iva.reducido', 'Ermäßigter Satz % (reducido)', '10', true), si('es.iva.superreducido', 'Stark ermäßigter Satz % (superreducido)', '4', true),
        si('es.limite.simplificada', 'Vereinfachte Rechnung bis € (factura simplificada)', '400', true),
        h('div', { class: 'fld hint' }, 'Kunden mit NIF bekommen immer eine vollständige Rechnung (F1), andere bis zu diesem Betrag eine vereinfachte (F2). Darüber braucht der Kunde eine NIF. Recargo de equivalencia stellen Sie beim Kunden ein (Steuer & Buchhaltung).')),
      grp('Rechnungsserien',
        si('es.serie.factura', 'Serie für Rechnungen', 'F', true), si('es.serie.rectificativa', 'Serie für Rechnungskorrekturen', 'R', true),
        h('div', { class: 'fld hint' }, 'Rechnungsnummer = Serie + fortlaufende Nummer (Nummernkreise), z. B. F20260001. Korrekturen haben eine eigene Serie (Art. 6.1.a RD 1619/2012). Eine einmal gemeldete Nummer wird nie wieder vergeben, auch nach dem Zurückspielen einer Sicherung nicht.')),
      grp('VERI*FACTU (Meldung an die AEAT)',
        sel('verifactu.entorno', 'Umgebung', [['pruebas', 'Test (prewww.aeat.es) – nichts wird registriert'], ['produccion', 'Produktion – Rechnungen werden registriert']], 'pruebas'),
        sel('verifactu.certificado', 'Art des Zertifikats', [['personal', 'Zertifikat der Firma oder des Vertreters'], ['sello', 'Elektronisches Siegel (sello electrónico)']], 'personal'),
        h('div', { class: 'fld hint' }, 'Jede Rechnung bekommt beim Ausstellen (Drucken, PDF, E-Mail, Kasse) einen Datensatz mit Hash-Kette und QR-Code. KuentaPOS sendet ihn sofort an die AEAT, ohne Internet später automatisch. Danach ist die Rechnung gesperrt; Änderungen nur per Rechnungskorrektur. Zertifikat, Hash-Kette und eine Kopie aller Datensätze liegen im Datenordner unter „verifactu“ und sind nicht Teil der Sicherung – diesen Ordner bitte zusätzlich sichern.'),
        h('div', { class: 'fld inline' },
          h('button', { class: 'btn', onclick: zertifikat }, '🔐 Zertifikat (.p12 / .pfx) hinterlegen'),
          h('button', { class: 'btn', onclick: probar }, '🔌 Speichern & Verbindung testen'),
          h('button', { class: 'btn', onclick: enviar }, '📤 Jetzt senden'),
          h('button', { class: 'btn', onclick: liste }, '📋 Datensätze'),
          h('button', { class: 'btn', onclick: async () => { if (await confirmDlg('Zertifikat und Passwort löschen?', { danger: true, ok: 'Löschen' })) { try { await api('/api/es/certificado', { method: 'DELETE' }); zeigen(); } catch (e) { showError(e); } } } }, '🗑 Zertifikat löschen')),
        status)));
    zeigen();
  },
};

// VAT books and quarterly overview (in the FIBU view when the tenant uses the Spanish tax system)
Views.librosEs = async (main) => {
  let von = today().slice(0, 4) + '-01-01', bis = today();
  const jahr = h('input', { type: 'number', value: today().slice(0, 4), style: { width: '80px' } });
  const quartal = h('select', null, [1, 2, 3, 4].map(n => h('option', { value: n, selected: n === Math.floor((Number(today().slice(5, 7)) - 1) / 3) + 1 }, `${n}T`)));
  const out = h('div', { class: 'view-scroll' });
  const m303 = async () => {
    try {
      const r = await api('/api/es/modelo303?' + qs({ jahr: jahr.value, quartal: quartal.value }));
      const row = (a, b, c, d) => h('tr', null, h('td', null, a), h('td', { class: 'r' }, b), h('td', { class: 'r' }, c), h('td', { class: 'r' }, d));
      out.textContent = '';
      out.append(h('table', { class: 'simple', style: { minWidth: '560px' } },
        h('tr', null, h('th', null, T('IVA devengado (Umsatzsteuer)')), h('th', { class: 'r' }, T('Basis')), h('th', { class: 'r' }, '%'), h('th', { class: 'r' }, T('Steuer'))),
        r.devengado.map(a => row(a.casillas ? `${T('Casillas')} ${a.casillas.join('/')}` : T('Regimen general'), fmt.money(a.base), fmt.num(a.tipo), fmt.money(a.cuota))),
        r.recargo.map(a => row(T('Recargo de equivalencia'), fmt.money(a.base), fmt.num(a.tipo), fmt.money(a.cuota))),
        row(h('b', null, T('Total cuota devengada (27)')), '', '', h('b', null, fmt.money(r.total_devengado))),
        row(T('IVA soportado, operaciones interiores (28/29)'), fmt.money(r.soportado.base), '', fmt.money(r.soportado.cuota)),
        row(h('b', null, T('Ergebnis (46)')), '', '', h('b', null, fmt.money(r.resultado))),
        r.exento ? row(T('steuerfrei / nicht steuerbar'), fmt.money(r.exento), '', '') : null),
      h('div', { class: 'hint', style: { marginTop: '8px' } }, T(`Zeitraum ${fmt.date(r.von)} – ${fmt.date(r.bis)}. Richtwerte aus den ausgestellten Rechnungen und den erfassten Eingangsrechnungen; die Erklärung (modelo 303) reicht Ihr gestor ein.`)));
    } catch (e) { showError(e); }
  };
  const vonI = h('input', { type: 'date', value: von, onchange: e => { von = e.target.value; } });
  const bisI = h('input', { type: 'date', value: bis, onchange: e => { bis = e.target.value; } });
  main.append(title('Libros registro de IVA / Modelo 303', 'Bücher für den gestor (CSV) und Übersicht für die Quartalserklärung'),
    h('div', { class: 'searchbar' }, T('Zeitraum'), vonI, bisI,
      h('button', { class: 'btn', onclick: () => downloadUrl('/api/es/libro/expedidas?' + qs({ von, bis }), 'Libro_expedidas.csv') }, '⬇ ' + T('Ausgestellte Rechnungen (expedidas)')),
      h('button', { class: 'btn', onclick: () => downloadUrl('/api/es/libro/recibidas?' + qs({ von, bis }), 'Libro_recibidas.csv') }, '⬇ ' + T('Erhaltene Rechnungen (recibidas)'))),
    h('div', { class: 'searchbar' }, T('Modelo 303'), jahr, quartal, h('button', { class: 'btn primary', onclick: m303 }, T('Berechnen'))), out);
  m303();
};
