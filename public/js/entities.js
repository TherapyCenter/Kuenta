// Shared module definitions (server + browser).
// Column SQL from this file is only ever used on the server.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ENT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ANREDEN = ['', 'Herr', 'Frau', 'Firma', 'Familie', 'Herr Dr.', 'Frau Dr.', 'Divers'];
  const offenSql = (t) => `ROUND(${t}.GBRUTTO - COALESCE((SELECT SUM(z.BETRAG) FROM ZAHLUNGSEINGAENGE z WHERE z.RECHNUNGID=${t}.RECHNUNGID),0),2)`;
  const kundeName = (t) => `TRIM(COALESCE(${t}.KUNNAME,'')||CASE WHEN COALESCE(${t}.KUNVORNAME,'')<>'' THEN ', '||${t}.KUNVORNAME ELSE '' END)`;

  const vorgangCols = (t, nr, extra = []) => [
    { f: nr, l: 'Nummer', w: 90, t: 'int' },
    { f: 'DATUM', l: 'Datum', w: 90, t: 'date' },
    { f: 'KUNNUMMER', l: 'Kd.-Nr.', w: 70, t: 'int' },
    { f: 'KUNDE', l: 'Kunde', w: 220, sql: kundeName(t) },
    { f: 'KUNORT', l: 'Ort', w: 120 },
    { f: 'FAHRKENNZEICHEN', l: 'Kennzeichen', w: 110 },
    { f: 'FAHRMARKE', l: 'Marke', w: 110, hidden: true },
    { f: 'FAHRMODELL', l: 'Modell', w: 130, hidden: true },
    { f: 'GNETTO', l: 'Netto', w: 90, t: 'money' },
    { f: 'GBRUTTO', l: 'Brutto', w: 90, t: 'money' },
    ...extra,
    { f: 'GEDRUCKT', l: 'Gedruckt', w: 70, t: 'bool' },
    { f: 'ARCHIV', l: 'Archiv', w: 60, t: 'bool', hidden: true },
  ];
  const vorgangSearch = (nr) => [
    { f: nr, l: 'Nummer' }, { f: 'KUNNAME', l: 'Kunde (Name/Firma)' }, { f: 'KUNNUMMER', l: 'Kunden-Nr.' },
    { f: 'FAHRKENNZEICHEN', l: 'Kennzeichen' }, { f: 'KUNORT', l: 'Ort' }, { f: 'FAHRIDENTNR', l: 'Fz.-Ident-Nr.' }, { f: 'DATUM', l: 'Datum (JJJJ-MM-TT)' },
  ];
  const archivFilter = { key: 'archiv', l: 'Ansicht', opts: [
    { k: 'aktiv', l: 'aktive Vorgänge', sql: 'COALESCE(ARCHIV,0)=0' },
    { k: 'archiv', l: 'archivierte Vorgänge', sql: 'ARCHIV=1' },
    { k: 'beide', l: 'aktive und archivierte', sql: '1=1' }] };

  const E = {};

  E.kunden = {
    table: 'KUNDEN', pk: 'KUNID', title: 'Kunden', one: 'Kunde', icon: '👤', right: 'Kunden',
    number: { f: 'NUMMER', key: 'Nummernkreis Kunden' },
    columns: [
      { f: 'NUMMER', l: 'Kunden-Nr.', w: 85, t: 'int' },
      { f: 'VORNAME', l: 'Vorname', w: 120 },
      { f: 'NAME', l: 'Name/Firma', w: 200 },
      { f: 'ZUSATZ', l: 'Namenszusatz', w: 140 },
      { f: 'STRASSE', l: 'Straße', w: 170 },
      { f: 'PLZ', l: 'PLZ', w: 60 },
      { f: 'ORT', l: 'Ort', w: 130 },
      { f: 'TELEFON', l: 'Telefon', w: 120 },
      { f: 'MOBIL', l: 'Mobil', w: 120 },
      { f: 'EMAIL', l: 'E-Mail', w: 170, hidden: true },
      { f: 'FAHRZEUGE', l: 'Fahrzeuge', w: 160, hidden: true, sql: "(SELECT GROUP_CONCAT(f.KENNZEICHEN, ', ') FROM KUNDEN_FAHRZEUGE kf JOIN FAHRZEUGE f ON f.FAHR_ID=kf.FAHRID WHERE kf.KUNID=KUNDEN.KUNID)" },
      { f: 'AENDERUNGSDATUM', l: 'Geändert', w: 130, t: 'datetime', hidden: true },
    ],
    search: [{ f: 'NAME', l: 'Name/Firma' }, { f: 'NUMMER', l: 'Kunden-Nr.' }, { f: 'VORNAME', l: 'Vorname' }, { f: 'ORT', l: 'Ort' }, { f: 'STRASSE', l: 'Straße' }, { f: 'PLZ', l: 'PLZ' }, { f: 'TELEFON', l: 'Telefon' }, { f: 'EMAIL', l: 'E-Mail' }, { f: 'FAHRZEUGE', l: 'Kennzeichen' }],
    letter: 'NAME', sort: 'NAME',
    form: [
      { tab: 'Kundendaten', groups: [
        { title: 'Kunde', fields: [
          { f: 'NUMMER', l: 'Kunden-Nr.', t: 'int' },
          { f: 'ART', l: 'Kundenart', t: 'radio', opts: [[0, 'Privatkunde'], [1, 'Firma']] },
          { f: 'ANREDE', l: 'Anrede', t: 'combo', opts: ANREDEN },
          { f: 'NAME', l: 'Name / Firma', req: true },
          { f: 'VORNAME', l: 'Vorname' },
          { f: 'ZUSATZ', l: 'Zusatz' },
          { f: 'STRASSE', l: 'Straße' },
          { f: 'LAND', l: 'Land', t: 'select', src: 'laender', w: 1 },
          { f: 'PLZ', l: 'PLZ', t: 'plz', w: 1 },
          { f: 'ORT', l: 'Ort', w: 2 },
          { f: 'GEBDATUM', l: 'Geburtsdatum', t: 'date' },
        ] },
        { title: 'Kontakt', fields: [
          { f: 'TELEFON', l: 'Telefon', t: 'tel' },
          { f: 'MOBIL', l: 'Mobil', t: 'tel' },
          { f: 'FAX', l: 'Fax' },
          { f: 'EMAIL', l: 'E-Mail', t: 'email' },
          { f: 'INTERNETSEITE', l: 'Internetseite' },
          { f: 'KEINEERINNERUNG', l: 'Keine Erinnerungen per E-Mail/SMS', t: 'bool' },
        ] },
        { title: 'Anmerkung', fields: [
          { f: 'ANMERKUNG', l: 'Anmerkung', t: 'memo', rows: 4 },
          { f: 'ZEIGANMERKUNG', l: 'Anmerkung beim Öffnen eines Vorgangs anzeigen', t: 'bool' },
        ] },
      ] },
      { tab: 'Konditionen', groups: [
        { title: 'Zahlung & Preise', fields: [
          { f: 'KUNZAHLBDID', l: 'Zahlungsbedingung', t: 'select', src: 'zahlungsbedingungen' },
          { f: 'PREISGRUPPE', l: 'Preisgruppe', t: 'select', opts: [[0, 'Standard (VK)'], [1, 'Preisgruppe 1'], [2, 'Preisgruppe 2'], [3, 'Preisgruppe 3'], [4, 'Preisgruppe 4'], [5, 'Preisgruppe 5']] },
          { f: 'RABATTART', l: 'Rabatt Artikel (%)', t: 'pct' },
          { f: 'RABATTLOHN', l: 'Rabatt Arbeitswerte (%)', t: 'pct' },
          { f: 'AUSNETTO', l: 'Vorgänge in Netto-Ansicht erstellen', t: 'bool' },
        ] },
        { title: 'Steuer & Buchhaltung', fields: [
          { f: 'USTID', l: 'USt-IdNr. / NIF' },
          { f: 'DEBITORNR', l: 'Debitoren-Nr.', t: 'int' },
          { f: 'NETTORECHNUNG', l: 'Ausländischer Kunde: bekommt eine Netto-Rechnung (ohne MwSt)', t: 'bool' },
          { f: 'EXPORTART', l: 'Steuerlicher Grund', t: 'select', opts: [['REVERSE_CHARGE', 'Reverse Charge (Leistung an EU-Unternehmer)'], ['IG_LIEFERUNG', 'Innergemeinschaftliche Lieferung'], ['AUSFUHR', 'Ausfuhr / Drittland']] },
          { f: 'RECARGO', l: 'Spanien: Kunde im Recargo de equivalencia (Einzelhändler)', t: 'bool' },
          { f: 'TAXEXEMPT', l: 'USA: steuerbefreit (Exemption certificate)', t: 'bool' },
          { f: 'EXEMPTCERT', l: 'USA: Nummer des Exemption Certificate' },
          { f: 'EXEMPTREASON', l: 'USA: Grund (z. B. Resale, Government, Non-profit)' },
          { f: 'FIBUEXPORT', l: 'an FIBU exportiert', t: 'bool', ro: true },
        ] },
        { title: 'E-Rechnung', fields: [
          { f: 'ERECHNUNG', l: 'Rechnungsformat', t: 'select', opts: [[0, 'PDF / Papier'], [1, 'XRechnung (CII)'], [2, 'XRechnung (UBL)'], [3, 'ZUGFeRD / Factur-X (PDF + XML)']] },
          { f: 'LEITWEGID', l: 'Leitweg-ID (öffentliche Auftraggeber)' },
          { f: 'EMAILRECHNUNG', l: 'E-Mail für Rechnungen', t: 'email' },
        ] },
      ] },
      { tab: 'Fahrzeuge', sub: 'kundenFahrzeuge' },
      { tab: 'Vorgänge', sub: 'kundenVorgaenge' },
      { tab: 'Dokumente', sub: 'dokumente', bezug: 'KUNDE' },
    ],
  };

  E.fahrzeuge = {
    table: 'FAHRZEUGE', pk: 'FAHR_ID', title: 'Fahrzeuge', one: 'Fahrzeug', icon: '🚗', right: 'Fahrzeuge',
    number: { f: 'FRZNUMMER', key: 'Nummerkreis Fahrzeuge' },
    where: 'COALESCE(FAHRZEUGE.FRZTYP,0)=0',
    columns: [
      { f: 'FRZNUMMER', l: 'Fz.-Nr.', w: 70, t: 'int' },
      { f: 'KENNZEICHEN', l: 'Kennzeichen', w: 110 },
      { f: 'FZIDENTNR', l: 'Fz.-Ident.-Nr.', w: 160 },
      { f: 'SCHLUESSNR1', l: 'HSN', w: 50 },
      { f: 'SCHLUESSNR2', l: 'TSN', w: 60 },
      { f: 'MARKE', l: 'Marke', w: 150 },
      { f: 'MODELL', l: 'Modell', w: 170 },
      { f: 'EZ', l: 'EZ', w: 85, t: 'date' },
      { f: 'HU', l: 'HU', w: 70, t: 'month' },
      { f: 'KM', l: 'KM', w: 75, t: 'int' },
      { f: 'HALTER', l: 'Halter', w: 180, sql: "(SELECT TRIM(COALESCE(k.NAME,'')||CASE WHEN COALESCE(k.VORNAME,'')<>'' THEN ', '||k.VORNAME ELSE '' END) FROM KUNDEN_FAHRZEUGE kf JOIN KUNDEN k ON k.KUNID=kf.KUNID WHERE kf.FAHRID=FAHRZEUGE.FAHR_ID LIMIT 1)" },
      { f: 'KRAFTSTOFF', l: 'Kraftstoff', w: 80, hidden: true },
      { f: 'MOTORCODE', l: 'Motorcode', w: 80, hidden: true },
    ],
    search: [{ f: 'KENNZEICHEN', l: 'Kennzeichen' }, { f: 'FZIDENTNR', l: 'Fz.-Ident.-Nr.' }, { f: 'MARKE', l: 'Marke' }, { f: 'MODELL', l: 'Modell' }, { f: 'HALTER', l: 'Halter' }, { f: 'FRZNUMMER', l: 'Fz.-Nr.' }, { f: 'SCHLUESSNR1', l: 'HSN' }],
    letter: 'MODELL', sort: 'KENNZEICHEN',
    form: [
      { tab: 'Fahrzeugdaten', groups: [
        { title: 'Fahrzeug', fields: [
          { f: 'FRZNUMMER', l: 'Fahrzeug-Nr.', t: 'int' },
          { f: 'KENNZEICHEN', l: 'Kennzeichen', upper: true },
          { f: 'FZIDENTNR', l: 'Fz.-Ident.-Nr. (FIN)', upper: true },
          { f: 'SCHLUESSNR1', l: 'HSN (2.1)', t: 'hsn', w: 1 },
          { f: 'SCHLUESSNR2', l: 'TSN (2.2)', t: 'tsn', w: 1 },
          { f: 'MARKE', l: 'Marke' },
          { f: 'MODELL', l: 'Modell' },
          { f: 'EZ', l: 'Erstzulassung', t: 'date', w: 1 },
          { f: 'HU', l: 'Nächste HU', t: 'hu', w: 1 },
          { f: 'KM', l: 'KM-Stand', w: 1 },
          { f: 'TACHO', l: 'Tachostand', w: 1 },
        ] },
        { title: 'Technik', fields: [
          { f: 'KW', l: 'kW', t: 'int', w: 1 },
          { f: 'PS', l: 'PS', t: 'int', w: 1 },
          { f: 'HUBRAUM', l: 'Hubraum (ccm)', t: 'int', w: 1 },
          { f: 'ZYLINDER', l: 'Zylinder', t: 'int', w: 1 },
          { f: 'KRAFTSTOFF', l: 'Kraftstoff', t: 'combo', src: 'opt60' },
          { f: 'GETRIEBE', l: 'Getriebe', t: 'combo', src: 'opt30' },
          { f: 'MOTORCODE', l: 'Motorcode' },
          { f: 'UMWELTPLAKETTE', l: 'Umweltplakette', t: 'combo', src: 'opt100', w: 1 },
          { f: 'KAT', l: 'Schadstoffklasse', t: 'combo', src: 'opt50', w: 1 },
          { f: 'BEREIFUNG1', l: 'Bereifung vorne', w: 1 },
          { f: 'BEREIFUNG2', l: 'Bereifung hinten', w: 1 },
          { f: 'FARBE', l: 'Farbe', w: 1 },
          { f: 'FARBCODE', l: 'Farbcode', w: 1 },
          { f: 'RADIOCODE', l: 'Radiocode', w: 1 },
          { f: 'SCHLUSSELNR', l: 'Schlüssel-Nr.', w: 1 },
        ] },
        { title: 'Notiz', fields: [{ f: 'NOTIZ', l: 'Notiz', t: 'memo', rows: 3 }] },
      ] },
      { tab: 'Weitere Daten/Termine', groups: [
        { title: 'Inspektion', fields: [
          { f: 'LETZTEINS', l: 'Letzte Inspektion', t: 'date', w: 1 },
          { f: 'LETZTEINSKM', l: 'bei KM', t: 'int', w: 1 },
          { f: 'INSINTERVAL', l: 'Intervall (Monate)', t: 'int', w: 1 },
          { f: 'INSKM', l: 'Intervall (KM)', t: 'int', w: 1 },
          { f: 'NAECHSTEINS', l: 'Nächste Inspektion', t: 'date' },
        ] },
        { title: 'Termine', fields: [
          { f: 'ZR', l: 'Zahnriemen gewechselt', t: 'date', w: 1 },
          { f: 'ZRKM', l: 'Zahnriemen bei KM', t: 'int', w: 1 },
          { f: 'KLIMA', l: 'Klimaservice', t: 'date' },
          { f: 'LETZTESP', l: 'Letzte SP', t: 'date', w: 1 },
          { f: 'NAECHSTESP', l: 'Nächste SP', t: 'date', w: 1 },
          { f: 'LETZTE57B', l: 'Letzte §57b', t: 'date', w: 1 },
          { f: 'NAECHSTE57B', l: 'Nächste §57b', t: 'date', w: 1 },
          { f: 'LETZTEUVV', l: 'Letzte UVV', t: 'date', w: 1 },
          { f: 'NAECHSTEUVV', l: 'Nächste UVV', t: 'date', w: 1 },
          { f: 'INDTERMIN1', l: '$IND1', t: 'date', w: 1 },
          { f: 'INDTERMIN2', l: '$IND2', t: 'date', w: 1 },
          { f: 'INDTERMIN3', l: '$IND3', t: 'date', w: 1 },
        ] },
        { title: 'Individuelle Felder', fields: [
          { f: 'INDFELD1', l: '$IND4' }, { f: 'INDFELD2', l: '$IND5' }, { f: 'INDFELD3', l: '$IND6' }, { f: 'INDFELD4', l: '$IND7' }, { f: 'INDFELD5', l: '$IND8' },
        ] },
      ] },
      { tab: 'Halter', sub: 'fahrzeugHalter' },
      { tab: 'Reifeneinlagerung', sub: 'fahrzeugReifen' },
      { tab: 'Historie', sub: 'fahrzeugHistorie' },
      { tab: 'Dokumente/Fotos', sub: 'dokumente', bezug: 'FAHRZEUG' },
    ],
  };

  E.artikel = {
    table: 'ARTIKEL', pk: 'ARTID', title: 'Artikel', one: 'Artikel', icon: '📦', right: 'Artikel',
    number: { f: 'ARTNUMMER', key: 'Nummerkreis Artikel', text: true },
    columns: [
      { f: 'ARTNUMMER', l: 'Artikel-Nr.', w: 120 },
      { f: 'BEZEICHNUNG1', l: 'Bezeichnung', w: 260 },
      { f: 'BEZEICHNUNG2', l: 'Beschreibung', w: 180, hidden: true },
      { f: 'EAN', l: 'EAN', w: 110, hidden: true },
      { f: 'HERSTELLER', l: 'Hersteller', w: 120, sql: '(SELECT h.HERNAME FROM HERSTELLER h WHERE h.HERID=ARTIKEL.HERID)' },
      { f: 'WARENGRUPPENAME', l: 'Warengruppe', w: 120, sql: '(SELECT w.BEZEICHNUNG FROM WARENGRUPPEN w WHERE w.GRUPPENID=ARTIKEL.WARENGRUPPE)' },
      { f: 'EKPNETTO', l: 'EK netto', w: 85, t: 'money', right: 'Einkaufspreis anzeigen' },
      { f: 'VKPNETTO', l: 'VK netto', w: 85, t: 'money' },
      { f: 'LAGER', l: 'Bestand', w: 70, t: 'num' },
      { f: 'LAGERORT', l: 'Lagerort', w: 100 },
    ],
    search: [{ f: 'BEZEICHNUNG1', l: 'Bezeichnung' }, { f: 'ARTNUMMER', l: 'Artikel-Nr.' }, { f: 'EAN', l: 'EAN' }, { f: 'HERSTELLER', l: 'Hersteller' }, { f: 'LAGERORT', l: 'Lagerort' }],
    statusFilters: [{ key: 'lager', l: 'Lager', opts: [
      { k: 'alle', l: 'alle Artikel', sql: '1=1' },
      { k: 'min', l: 'Mindestbestand unterschritten', sql: 'COALESCE(LAGERFUEHRUNG,0)=1 AND LAGER<LAGERMIN' },
      { k: 'lager', l: 'mit Lagerführung', sql: 'COALESCE(LAGERFUEHRUNG,0)=1' }] }],
    letter: 'BEZEICHNUNG1', sort: 'BEZEICHNUNG1',
    form: [
      { tab: 'Artikeldaten', groups: [
        { title: 'Artikel', fields: [
          { f: 'ARTNUMMER', l: 'Artikel-Nr.' },
          { f: 'BEZEICHNUNG1', l: 'Bezeichnung', req: true },
          { f: 'BEZEICHNUNG2', l: 'Beschreibung' },
          { f: 'EAN', l: 'EAN / Barcode' },
          { f: 'ERSETZUNG', l: 'Ersetzt durch' },
          { f: 'HERID', l: 'Hersteller', t: 'select', src: 'hersteller' },
          { f: 'LIEFID', l: 'Lieferant', t: 'select', src: 'lieferanten' },
          { f: 'WARENGRUPPE', l: 'Warengruppe', t: 'select', src: 'warengruppen' },
          { f: 'EINHEITID', l: 'Einheit', t: 'select', src: 'einheiten' },
        ] },
        { title: 'Preise', fields: [
          { f: 'EKPNETTO', l: 'Einkaufspreis netto', t: 'money', right: 'Einkaufspreis anzeigen' },
          { f: 'VKPNETTO', l: 'Verkaufspreis netto', t: 'money' },
          { f: 'MWST', l: 'MwSt', t: 'select', src: 'mwst' },
          { f: 'VKPGR1', l: 'Preisgruppe 1', t: 'money', w: 1 }, { f: 'VKPGR2', l: 'Preisgruppe 2', t: 'money', w: 1 },
          { f: 'VKPGR3', l: 'Preisgruppe 3', t: 'money', w: 1 }, { f: 'VKPGR4', l: 'Preisgruppe 4', t: 'money', w: 1 },
          { f: 'VKPGR5', l: 'Preisgruppe 5', t: 'money', w: 1 },
        ] },
      ] },
      { tab: 'Lager / Langtext', groups: [
        { title: 'Lager', fields: [
          { f: 'LAGERFUEHRUNG', l: 'Lagerführung aktiv', t: 'bool' },
          { f: 'LAGER', l: 'Bestand', t: 'num', w: 1 },
          { f: 'LAGERORT', l: 'Lagerort', w: 1 },
          { f: 'LAGERMIN', l: 'Mindestbestand', t: 'num', w: 1 },
          { f: 'LAGERMAX', l: 'Maximalbestand', t: 'num', w: 1 },
        ] },
        { title: 'Langtext', fields: [{ f: 'LANGTEXT', l: 'Langtext (wird im Vorgang übernommen)', t: 'memo', rows: 6 }] },
      ] },
      { tab: 'Lagerbewegungen', sub: 'artikelBewegungen' },
    ],
  };

  E.arbeitswerte = {
    table: 'LEISTUNG', pk: 'LEISTUNGID', title: 'Arbeitswerte', one: 'Arbeitswert', icon: '🔧', right: 'Arbeitswerte',
    number: { f: 'LEISTUNGNUMMER', key: 'Nummernkreis Arbeitswert', text: true },
    columns: [
      { f: 'LEISTUNGNUMMER', l: 'AW-Nr.', w: 100 },
      { f: 'BEZEICHNUNG1', l: 'Bezeichnung', w: 300 },
      { f: 'BESCHREIBUNG', l: 'Beschreibung', w: 200, hidden: true },
      { f: 'ANZAHLAW', l: 'Menge/AW', w: 80, t: 'num' },
      { f: 'KOSTENSATZNAME', l: 'Stundensatz', w: 120, sql: '(SELECT k.BEZEICHNUNG FROM KOSTENSATZ k WHERE k.KOSTENSATZID=LEISTUNG.KOSTENSATZID)' },
      { f: 'VKPNETTO', l: 'Preis netto', w: 90, t: 'money' },
      { f: 'FESTPREISCHECK', l: 'Festpreis', w: 70, t: 'bool' },
    ],
    search: [{ f: 'BEZEICHNUNG1', l: 'Bezeichnung' }, { f: 'LEISTUNGNUMMER', l: 'AW-Nr.' }, { f: 'BESCHREIBUNG', l: 'Beschreibung' }],
    letter: 'BEZEICHNUNG1', sort: 'BEZEICHNUNG1',
    form: [{ tab: 'Arbeitswert', groups: [
      { title: 'Arbeitswert', fields: [
        { f: 'LEISTUNGNUMMER', l: 'AW-Nr.' },
        { f: 'BEZEICHNUNG1', l: 'Bezeichnung', req: true },
        { f: 'BESCHREIBUNG', l: 'Beschreibung' },
        { f: 'EINHEITID', l: 'Einheit', t: 'select', src: 'einheiten' },
        { f: 'MWST', l: 'MwSt', t: 'select', src: 'mwst' },
        { f: 'DURCHLAUF', l: 'Durchlaufender Posten (z. B. TÜV-Gebühr)', t: 'bool' },
      ] },
      { title: 'Preis', fields: [
        { f: 'FESTPREISCHECK', l: 'Festpreis', t: 'bool' },
        { f: 'VKPNETTO', l: 'Festpreis netto', t: 'money' },
        { f: 'KOSTENSATZID', l: 'Stundenverrechnungssatz', t: 'select', src: 'kostensaetze' },
        { f: 'ANZAHLAW', l: 'Anzahl AW / Stunden', t: 'num' },
      ] },
      { title: 'Arbeitstext', fields: [{ f: 'ARBEITSTEXT', l: 'Arbeitstext', t: 'memo', rows: 5 }] },
    ] }],
  };

  E.lieferanten = {
    table: 'LIEFERANTEN', pk: 'LIEFID', title: 'Lieferanten', one: 'Lieferant', icon: '🚚', right: 'Lieferanten',
    number: { f: 'NUMMER', key: 'Nummernkreis Liefranten' },
    columns: [
      { f: 'NUMMER', l: 'Nr.', w: 70, t: 'int' }, { f: 'NAME', l: 'Name', w: 200 }, { f: 'ZUSATZ', l: 'Zusatz', w: 140 },
      { f: 'STRASSE', l: 'Straße', w: 160 }, { f: 'PLZ', l: 'PLZ', w: 60 }, { f: 'ORT', l: 'Ort', w: 120 },
      { f: 'TELEFON', l: 'Telefon', w: 120 }, { f: 'ANSPRNAME', l: 'Ansprechpartner', w: 140 }, { f: 'EMAIL', l: 'E-Mail', w: 160, hidden: true },
    ],
    search: [{ f: 'NAME', l: 'Name' }, { f: 'NUMMER', l: 'Nr.' }, { f: 'ORT', l: 'Ort' }, { f: 'ANSPRNAME', l: 'Ansprechpartner' }],
    letter: 'NAME', sort: 'NAME',
    form: [{ tab: 'Lieferant', groups: [
      { title: 'Anschrift', fields: [
        { f: 'NUMMER', l: 'Lieferanten-Nr.', t: 'int' }, { f: 'NAME', l: 'Name', req: true }, { f: 'ZUSATZ', l: 'Zusatz' },
        { f: 'STRASSE', l: 'Straße' }, { f: 'LAND', l: 'Land', t: 'select', src: 'laender', w: 1 }, { f: 'PLZ', l: 'PLZ', t: 'plz', w: 1 }, { f: 'ORT', l: 'Ort' },
      ] },
      { title: 'Kontakt', fields: [
        { f: 'TELEFON', l: 'Telefon', t: 'tel' }, { f: 'MOBIL', l: 'Mobil', t: 'tel' }, { f: 'FAX', l: 'Fax' }, { f: 'EMAIL', l: 'E-Mail', t: 'email' },
        { f: 'ANSPRNAME', l: 'Ansprechpartner' }, { f: 'ANSPRTEL', l: 'Tel. Ansprechpartner', t: 'tel' },
      ] },
      { title: 'Steuer, Bank & FIBU', fields: [
        { f: 'USTID', l: 'USt-IdNr.' }, { f: 'IBAN', l: 'IBAN' }, { f: 'BIC', l: 'BIC', w: 1 },
        { f: 'KREDITORNR', l: 'Kreditoren-Nr.', t: 'int', w: 1 }, { f: 'GEGENKONTO', l: 'Standard-Aufwandskonto (z. B. 3400)', w: 1 },
      ] },
      { title: 'Anmerkung', fields: [{ f: 'ANMERKUNG', l: 'Anmerkung', t: 'memo', rows: 4 }] },
    ] }],
  };

  const reifenSeite = (p, l) => [
    { f: `REIFEN${p}HERSTELLER`, l: `${l}: Hersteller`, t: 'combo', src: 'reifenmarken' },
    { f: `REIFEN${p}BREITE`, l: 'Breite', w: 1 }, { f: `REIFEN${p}QUERSCHNITT`, l: 'Querschnitt', w: 1 },
    { f: `REIFEN${p}DURCHM`, l: 'Zoll', w: 1 },
    { f: p === 'VORNE' ? 'REIFENVORNETRAGINX' : 'REIFENHINTENTRAGINX', l: 'Tragfähigkeit', w: 1 },
    { f: p === 'VORNE' ? 'REIFENVORNEGESCHINX' : 'REIFENHINTENGESCHINX', l: 'Geschw.-Index', w: 1 },
    { f: p === 'VORNE' ? 'REIFENVORNZUSTAND' : 'REIFENHINTENZUSTAND', l: 'Zustand', t: 'select', opts: [[0, '–'], [1, 'gut'], [2, 'mittel'], [3, 'schlecht'], [4, 'erneuern']], w: 1 },
    { f: p === 'VORNE' ? 'REIFENVORNSCHADEN' : 'REIFENHINTENSCHADEN', l: 'Schaden' },
  ];
  E.reifen = {
    table: 'REIFENEINLAGERUNG', pk: 'EINLAGERUNGID', title: 'Reifeneinlagerung', one: 'Reifeneinlagerung', icon: '⭕', right: 'Reifeneinlagerung',
    number: { f: 'EINLNUMMER', key: 'Reifeneinlagerung' },
    columns: [
      { f: 'EINLNUMMER', l: 'Einl.-Nr.', w: 75, t: 'int' },
      { f: 'STATUSTEXT', l: 'Status', w: 85, sql: "CASE WHEN COALESCE(STATUS,0)=0 THEN 'eingelagert' ELSE 'ausgelagert' END" },
      { f: 'EINDATUM', l: 'Eingelagert', w: 90, t: 'date' },
      { f: 'AUSDATUM', l: 'Ausgelagert', w: 90, t: 'date' },
      { f: 'KENNZEICHEN', l: 'Kennzeichen', w: 110, sql: '(SELECT f.KENNZEICHEN FROM FAHRZEUGE f WHERE f.FAHR_ID=REIFENEINLAGERUNG.FAHRZEUGID)' },
      { f: 'KUNDE', l: 'Kunde', w: 180, sql: "(SELECT TRIM(COALESCE(k.NAME,'')||CASE WHEN COALESCE(k.VORNAME,'')<>'' THEN ', '||k.VORNAME ELSE '' END) FROM KUNDEN k WHERE k.KUNID=REIFENEINLAGERUNG.KUNID)" },
      { f: 'LAGERORT', l: 'Lagerort', w: 100 },
      { f: 'REIFENTYPTEXT', l: 'Reifentyp', w: 90, sql: "CASE REIFENTYP WHEN 1 THEN 'Sommer' WHEN 2 THEN 'Winter' WHEN 3 THEN 'Ganzjahr' ELSE '' END" },
      { f: 'GROESSE', l: 'Größe', w: 110, sql: "COALESCE(REIFENVORNEBREITE,'')||'/'||COALESCE(REIFENVORNEQUERSCHNITT,'')||' R'||COALESCE(REIFENVORNEDURCHM,'')" },
      { f: 'REIFENVORNEHERSTELLER', l: 'Hersteller', w: 110 },
      { f: 'REIFENANZAHL', l: 'Anzahl', w: 60, t: 'int' },
    ],
    search: [{ f: 'KENNZEICHEN', l: 'Kennzeichen' }, { f: 'KUNDE', l: 'Kunde' }, { f: 'EINLNUMMER', l: 'Einl.-Nr.' }, { f: 'LAGERORT', l: 'Lagerort' }, { f: 'REIFENVORNEHERSTELLER', l: 'Hersteller' }],
    statusFilters: [{ key: 'status', l: 'Status', opts: [
      { k: 'ein', l: 'eingelagert', sql: 'COALESCE(STATUS,0)=0' }, { k: 'aus', l: 'ausgelagert', sql: 'STATUS=1' }, { k: 'alle', l: 'alle', sql: '1=1' }] }],
    letter: null, sort: 'EINLNUMMER', sortDir: 'desc',
    form: [
      { tab: 'Einlagerung', groups: [
        { title: 'Einlagerung', fields: [
          { f: 'EINLNUMMER', l: 'Einlagerungs-Nr.', t: 'int', w: 1 },
          { f: 'STATUS', l: 'Status', t: 'select', opts: [[0, 'eingelagert'], [1, 'ausgelagert']], w: 1 },
          { f: 'EINDATUM', l: 'Eingelagert am', t: 'date', w: 1 },
          { f: 'AUSDATUM', l: 'Ausgelagert am', t: 'date', w: 1 },
          { f: 'FAHRZEUGID', l: 'Fahrzeug', t: 'fahrzeug' },
          { f: 'KUNID', l: 'Kunde', t: 'kunde' },
          { f: 'LAGERORT', l: 'Lagerort' },
          { f: 'REIFENANZAHL', l: 'Anzahl Reifen', t: 'int', w: 1 },
          { f: 'REIFENTYP', l: 'Reifentyp', t: 'select', opts: [[0, '–'], [1, 'Sommerreifen'], [2, 'Winterreifen'], [3, 'Ganzjahresreifen']], w: 1 },
          { f: 'RFT', l: 'Runflat (RFT)', t: 'bool', w: 1 },
          { f: 'OPTWUCHTEN', l: 'Wuchten', t: 'bool', w: 1 },
          { f: 'OPTWASCHEN', l: 'Waschen', t: 'bool', w: 1 },
          { f: 'OPTSTICKSTOFF', l: 'Stickstoff', t: 'bool', w: 1 },
        ] },
        { title: 'Bemerkung', fields: [{ f: 'BEMERKUNG', l: 'Bemerkung', t: 'memo', rows: 3 }] },
      ] },
      { tab: 'Reifen', groups: [
        { title: 'Reifen vorne', fields: reifenSeite('VORNE', 'Vorne') },
        { title: 'Reifen hinten', fields: reifenSeite('HINTEN', 'Hinten') },
        { title: 'Profiltiefe (mm) / DOT', fields: [
          { f: 'PROFIALLERREIFEN', l: 'gleiche Profiltiefe für alle Reifen', t: 'bool' },
          { f: 'REIFENPROFILVL', l: 'Profil VL', t: 'num', w: 1 }, { f: 'REIFENDOTVL', l: 'DOT VL', w: 1 },
          { f: 'REIFENPROFILVR', l: 'Profil VR', t: 'num', w: 1 }, { f: 'REIFENDOTVR', l: 'DOT VR', w: 1 },
          { f: 'REIFENPROFILHL', l: 'Profil HL', t: 'num', w: 1 }, { f: 'REIFENDOTHL', l: 'DOT HL', w: 1 },
          { f: 'REIFENPROFILHR', l: 'Profil HR', t: 'num', w: 1 }, { f: 'REIFENDOTHR', l: 'DOT HR', w: 1 },
          { f: 'REIFENPROFILHL2', l: 'Profil Reserve', t: 'num', w: 1 }, { f: 'REIFENDOTVLHL2', l: 'DOT Reserve', w: 1 },
        ] },
      ] },
      { tab: 'Felgen', groups: [
        { title: 'Felgen', fields: [
          { f: 'FELGENTYP', l: 'Felgentyp', t: 'select', opts: [[0, '–'], [1, 'Alufelge'], [2, 'Stahlfelge']], w: 1 },
          { f: 'RADKAPPENANZAHL', l: 'Radkappen', t: 'int', w: 1 },
          { f: 'RADSCHRAUBENANZAHL', l: 'Radschrauben', t: 'int', w: 1 },
          { f: 'RADSCHLOSS', l: 'Felgenschloss', t: 'bool', w: 1 },
          { f: 'RADSCHLOSSNR', l: 'Felgenschloss-Nr.' },
          { f: 'FELGEVORNEMARKE', l: 'Felge vorne: Marke', w: 1 }, { f: 'FELGEVORNEGROSSE', l: 'Größe', w: 1 },
          { f: 'FELGEVORNESCHADEN', l: 'Schäden vorne', t: 'memo', rows: 2 },
          { f: 'FELGEHINTENMARKE', l: 'Felge hinten: Marke', w: 1 }, { f: 'FELGEHINTENGROSSE', l: 'Größe', w: 1 },
          { f: 'FELGEHINTENSCHADEN', l: 'Schäden hinten', t: 'memo', rows: 2 },
        ] },
      ] },
    ],
  };

  // --- Documents (Vorgänge) ---
  E.angebote = {
    table: 'ANGEBOTE', pk: 'ANGEBOTID', title: 'Angebote', one: 'Angebot', icon: '📝', right: 'Angebote', vorgang: 'angebot',
    columns: vorgangCols('ANGEBOTE', 'ANGEBOTNUMMER', [{ f: 'STATUS', l: 'Status', w: 110, sql: "CASE WHEN COALESCE(RECHID,-1)>0 THEN 'Rechnung erstellt' WHEN COALESCE(AUFTRAGID,-1)>0 THEN 'Auftrag erstellt' ELSE '' END" }]),
    search: vorgangSearch('ANGEBOTNUMMER'), sort: 'ANGEBOTNUMMER', sortDir: 'desc', letter: null,
    statusFilters: [{ key: 'status', l: 'Status', opts: [
      { k: 'alle', l: 'alle', sql: '1=1' }, { k: 'rech', l: 'Rechnung erstellt', sql: 'COALESCE(RECHID,-1)>0' },
      { k: 'auf', l: 'Auftrag erstellt', sql: 'COALESCE(AUFTRAGID,-1)>0' }, { k: 'ged', l: 'gedruckt', sql: 'GEDRUCKT=1' }, { k: 'nged', l: 'nicht gedruckt', sql: 'COALESCE(GEDRUCKT,0)=0' }] }, archivFilter],
  };
  E.auftraege = {
    table: 'AUFTRAEGE', pk: 'AUFTRAGID', title: 'Aufträge', one: 'Auftrag', icon: '🛠️', right: 'Aufträge', vorgang: 'auftrag',
    columns: vorgangCols('AUFTRAEGE', 'AUFTRAGNUMMER', [{ f: 'STATUS', l: 'Status', w: 110, sql: "CASE WHEN COALESCE(RECHNUNGID,-1)>0 THEN 'Rechnung erstellt' WHEN COALESCE(GEDRUCKT,0)=1 THEN 'gedruckt' ELSE 'offen' END" }]),
    search: vorgangSearch('AUFTRAGNUMMER'), sort: 'AUFTRAGNUMMER', sortDir: 'desc', letter: null,
    statusFilters: [{ key: 'status', l: 'Status', opts: [
      { k: 'alle', l: 'alle', sql: '1=1' }, { k: 'offen', l: 'offen (keine Rechnung)', sql: 'COALESCE(RECHNUNGID,-1)<=0' },
      { k: 'rech', l: 'Rechnung erstellt', sql: 'COALESCE(RECHNUNGID,-1)>0' }, { k: 'ged', l: 'gedruckt', sql: 'GEDRUCKT=1' }] }, archivFilter],
  };
  E.lieferscheine = {
    table: 'LIEFERSCHEIN', pk: 'LIEFERSCHEINID', title: 'Lieferscheine', one: 'Lieferschein', icon: '📃', right: 'Lieferscheine', vorgang: 'lieferschein',
    columns: vorgangCols('LIEFERSCHEIN', 'LIEFERSCHEINNUMMER', [{ f: 'STATUS', l: 'Status', w: 110, sql: "CASE WHEN COALESCE(RECHNUNGID,-1)>0 THEN 'Rechnung erstellt' ELSE '' END" }]),
    search: vorgangSearch('LIEFERSCHEINNUMMER'), sort: 'LIEFERSCHEINNUMMER', sortDir: 'desc', letter: null,
    statusFilters: [{ key: 'status', l: 'Status', opts: [
      { k: 'alle', l: 'alle', sql: '1=1' }, { k: 'ged', l: 'gedruckt', sql: 'GEDRUCKT=1' }, { k: 'nged', l: 'nicht gedruckt', sql: 'COALESCE(GEDRUCKT,0)=0' },
      { k: 'rech', l: 'Rechnung erstellt', sql: 'COALESCE(RECHNUNGID,-1)>0' }] }, archivFilter],
  };
  const zahlCols = [
    { f: 'OFFEN', l: 'Offen', w: 85, t: 'money', sql: offenSql('RECHNUNGEN') },
    { f: 'ZAHLSTATUSTEXT', l: 'Zahlstatus', w: 110, sql: "CASE COALESCE(ZAHLSTATUS,0) WHEN 2 THEN 'bezahlt' WHEN 1 THEN 'teilweise bezahlt' ELSE 'offen' END" },
  ];
  E.rechnungen = {
    table: 'RECHNUNGEN', pk: 'RECHNUNGID', title: 'Rechnungen', one: 'Rechnung', icon: '💶', right: 'Rechnungen', vorgang: 'rechnung',
    where: 'RECHNUNGEN.TYP=1',
    columns: vorgangCols('RECHNUNGEN', 'RECHNUNGNUMMER', zahlCols),
    search: vorgangSearch('RECHNUNGNUMMER'), sort: 'RECHNUNGNUMMER', sortDir: 'desc', letter: null,
    statusFilters: [{ key: 'status', l: 'Status', opts: [
      { k: 'alle', l: 'alle', sql: '1=1' }, { k: 'ged', l: 'gedruckt', sql: 'GEDRUCKT=1' }, { k: 'nged', l: 'nicht gedruckt', sql: 'COALESCE(GEDRUCKT,0)=0' },
      { k: 'offen', l: 'nicht bezahlt', sql: 'COALESCE(ZAHLSTATUS,0)<2' }, { k: 'bez', l: 'bezahlt', sql: 'ZAHLSTATUS=2' },
      { k: 'storno', l: 'storniert', sql: 'COALESCE(GUTSCHRIFTID,-1)>0' }] }, archivFilter],
  };
  E.korrekturen = {
    table: 'RECHNUNGEN', pk: 'RECHNUNGID', title: 'Rechnungskorrekturen', one: 'Rechnungskorrektur', icon: '↩️', right: 'Rechnungskorrekturen', vorgang: 'korrektur',
    where: 'RECHNUNGEN.TYP=2',
    columns: vorgangCols('RECHNUNGEN', 'RECHNUNGNUMMER', [...zahlCols, { f: 'BEZUG', l: 'zu Rechnung', w: 90, sql: '(SELECT r2.RECHNUNGNUMMER FROM RECHNUNGEN r2 WHERE r2.RECHNUNGID=RECHNUNGEN.REIDGUTSCHRIFT)' }]),
    search: vorgangSearch('RECHNUNGNUMMER'), sort: 'RECHNUNGNUMMER', sortDir: 'desc', letter: null,
    statusFilters: [{ key: 'status', l: 'Status', opts: [
      { k: 'alle', l: 'alle', sql: '1=1' }, { k: 'ged', l: 'gedruckt', sql: 'GEDRUCKT=1' }, { k: 'nged', l: 'nicht gedruckt', sql: 'COALESCE(GEDRUCKT,0)=0' }] }, archivFilter],
  };

  // --- Finance (lists) ---
  E.kassenbuch = {
    table: 'KASSENBUCH', pk: 'KASSENID', title: 'Kassenbuch', one: 'Kassenbucheintrag', icon: '💰', right: 'Kassenbuch',
    columns: [
      { f: 'DATUM', l: 'Datum', w: 90, t: 'date' },
      { f: 'BELEGNUMMER', l: 'Beleg-Nr.', w: 100 },
      { f: 'EMPFAENGER', l: 'Empfänger / Einzahler', w: 220 },
      { f: 'VERWENDUNG', l: 'Verwendungszweck', w: 300 },
      { f: 'EINNAHMEN', l: 'Einnahmen', w: 95, t: 'money' },
      { f: 'AUSGABEN', l: 'Ausgaben', w: 95, t: 'money' },
      { f: 'GEGENKONTO', l: 'Gegenkonto', w: 85, hidden: true },
    ],
    search: [{ f: 'EMPFAENGER', l: 'Empfänger' }, { f: 'BELEGNUMMER', l: 'Beleg-Nr.' }, { f: 'VERWENDUNG', l: 'Verwendungszweck' }, { f: 'DATUM', l: 'Datum (JJJJ-MM-TT)' }],
    sort: 'DATUM', sortDir: 'desc', letter: null, monthFilter: 'DATUM',
    form: [{ tab: 'Kassenbucheintrag', groups: [{ title: 'Buchung', fields: [
      { f: 'DATUM', l: 'Datum', t: 'date', req: true },
      { f: 'ART', l: 'Art', t: 'radio', opts: [[1, 'Einnahme'], [2, 'Ausgabe']] },
      { f: 'BELEGNUMMER', l: 'Beleg-Nr.' },
      { f: 'EMPFAENGER', l: 'Empfänger / Einzahler' },
      { f: 'VERWENDUNG', l: 'Verwendungszweck', t: 'memo', rows: 2 },
      { f: 'EINNAHMEN', l: 'Einnahme', t: 'money', w: 1 },
      { f: 'AUSGABEN', l: 'Ausgabe', t: 'money', w: 1 },
      { f: 'GEGENKONTO', l: 'Gegenkonto (FIBU)', w: 1 },
      { f: 'STEUERSCHLUESSEL', l: 'MwSt-Satz (%)', t: 'int', w: 1 },
    ] }] }],
  };

  E.zahlungen = {
    table: 'ZAHLUNGSEINGAENGE', pk: 'ID', title: 'Zahlungen', one: 'Zahlung', icon: '🏦', right: 'Zahlungen', readonly: true,
    columns: [
      { f: 'DATUM', l: 'Datum', w: 90, t: 'date' },
      { f: 'RENR', l: 'Rechnungs-Nr.', w: 100, sql: '(SELECT r.RECHNUNGNUMMER FROM RECHNUNGEN r WHERE r.RECHNUNGID=ZAHLUNGSEINGAENGE.RECHNUNGID)' },
      { f: 'KUNDE', l: 'Kunde', w: 220, sql: "(SELECT TRIM(COALESCE(r.KUNNAME,'')||CASE WHEN COALESCE(r.KUNVORNAME,'')<>'' THEN ', '||r.KUNVORNAME ELSE '' END) FROM RECHNUNGEN r WHERE r.RECHNUNGID=ZAHLUNGSEINGAENGE.RECHNUNGID)" },
      { f: 'ZAHLART', l: 'Zahlungsart', w: 150, sql: '(SELECT a.ART FROM ZAHLUNGSART a WHERE a.ID=ZAHLUNGSEINGAENGE.ZAHLUNGSARTID)' },
      { f: 'BETRAG', l: 'Betrag', w: 95, t: 'money' },
      { f: 'BANKNAME', l: 'Bank / Bemerkung', w: 150 },
    ],
    search: [{ f: 'RENR', l: 'Rechnungs-Nr.' }, { f: 'KUNDE', l: 'Kunde' }, { f: 'DATUM', l: 'Datum (JJJJ-MM-TT)' }],
    sort: 'DATUM', sortDir: 'desc', letter: null, monthFilter: 'DATUM',
  };

  // --- Simple master data tables ---
  const simple = (table, pk, title, one, cols, extra = {}) => ({
    table, pk, title, one, simple: true, right: 'Einstellungen',
    columns: cols.map(c => ({ w: 160, ...c })),
    search: cols.filter(c => !c.t || c.t === 'text').map(c => ({ f: c.f, l: c.l })),
    sort: cols[0].f, letter: null,
    form: [{ tab: one, groups: [{ title: one, fields: cols.map(c => ({ ...c })) }] }],
    ...extra,
  });
  E.zahlungsbedingungen = simple('ZAHLUNGSBEDINUNGEN', 'ZAHLBDID', 'Zahlungsbedingungen', 'Zahlungsbedingung', [
    { f: 'NAME', l: 'Bezeichnung', req: true }, { f: 'TEXT', l: 'Text auf Rechnung', w: 300 },
    { f: 'TAGEFAELLIG', l: 'Fällig in Tagen', t: 'int', w: 90 }, { f: 'TAGESKONTO', l: 'Skonto-Tage', t: 'int', w: 90 }, { f: 'SKONTO', l: 'Skonto %', t: 'pct', w: 80 },
    { f: 'ERECHCODE', l: 'E-Rechnung Zahlungsart-Code', t: 'select', opts: [['58', '58 – SEPA-Überweisung'], ['30', '30 – Überweisung'], ['59', '59 – SEPA-Lastschrift'], ['10', '10 – Bar'], ['48', '48 – Kartenzahlung'], ['1', '1 – nicht definiert']], w: 160 }]);
  E.einheiten = simple('EINHEITEN', 'EINHEITID', 'Einheiten', 'Einheit', [{ f: 'BEZEICHNUNG', l: 'Bezeichnung', req: true },
    { f: 'UNECE', l: 'UN/ECE-Code (E-Rechnung)', t: 'select', opts: [['H87', 'H87 – Stück'], ['C62', 'C62 – Einheit'], ['HUR', 'HUR – Stunde'], ['LTR', 'LTR – Liter'], ['MTR', 'MTR – Meter'], ['KGM', 'KGM – Kilogramm'], ['SET', 'SET – Satz'], ['PR', 'PR – Paar'], ['LS', 'LS – Pauschale'], ['MIN', 'MIN – Minute'], ['DAY', 'DAY – Tag'], ['KMT', 'KMT – Kilometer']] }]);
  E.kostensaetze = simple('KOSTENSATZ', 'KOSTENSATZID', 'Stundenverrechnungssätze', 'Stundenverrechnungssatz', [
    { f: 'BEZEICHNUNG', l: 'Bezeichnung', req: true }, { f: 'AWBETRAG', l: 'Preis je AW/Std. netto', t: 'money' }, { f: 'AWKOSTEN', l: 'Kosten je AW/Std.', t: 'money' }]);
  E.auftragsarten = simple('AUFTRAGSART', 'AUFARTID', 'Auftragsarten', 'Auftragsart', [{ f: 'BEZEICHNUNG', l: 'Bezeichnung', req: true }]);
  E.warengruppen = simple('WARENGRUPPEN', 'GRUPPENID', 'Warengruppen', 'Warengruppe', [{ f: 'BEZEICHNUNG', l: 'Bezeichnung', req: true }]);
  E.hersteller = simple('HERSTELLER', 'HERID', 'Hersteller', 'Hersteller', [{ f: 'HERNAME', l: 'Name', req: true }]);
  E.zahlungsarten = simple('ZAHLUNGSART', 'ID', 'Zahlungsarten', 'Zahlungsart', [{ f: 'ART', l: 'Bezeichnung', req: true }, { f: 'KASSENBUCH', l: 'ins Kassenbuch', t: 'bool' }, { f: 'EC', l: 'EC-/Kartenzahlung', t: 'bool' }]);
  E.textbausteine = simple('TEXTBLOCK', 'TXTID', 'Textbausteine', 'Textbaustein', [{ f: 'TXTBEZEICHNUNG', l: 'Bezeichnung', req: true }, { f: 'TXTTEXT', l: 'Text', t: 'memo', rows: 8, w: 400 }]);
  E.drucktexte = simple('DRUCKTEXTBAUSTEINE', 'IDTXT', 'Einleitungs-/Schlusstexte', 'Druck-Textbaustein', [
    { f: 'TXTBEZEICHNUNG', l: 'Bezeichnung', req: true },
    { f: 'TXTART', l: 'Vorgangsart', t: 'select', opts: [[1, 'Angebot'], [2, 'Auftrag'], [3, 'Lieferschein'], [4, 'Rechnung'], [5, 'Rechnungskorrektur'], [6, 'Mahnung']], w: 110 },
    { f: 'TXTARTVARIABLE', l: 'Mahnstufe (nur Mahnung)', w: 80 },
    { f: 'TXTARTSTANDARD', l: 'Standard', t: 'bool', w: 70 },
    { f: 'TXTBETREFF', l: 'Betreff' },
    { f: 'EINLEITUNG', l: 'Einleitungstext', t: 'memo', rows: 4, hidden: true },
    { f: 'SCHLUSSTEXT', l: 'Schlusstext', t: 'memo', rows: 4, hidden: true }]);
  E.laender = simple('LAENDERCODES', 'LANDID', 'Länder', 'Land', [{ f: 'ISO3166', l: 'ISO-Code', w: 80 }, { f: 'BEZEICHNUNG', l: 'Bezeichnung', req: true }], { sort: 'BEZEICHNUNG' });
  E.reifenmarken = simple('REIFENMARKEN', 'RMARKEID', 'Reifenmarken', 'Reifenmarke', [{ f: 'RMARKE', l: 'Marke', req: true }]);
  E.farben = simple('FRZ_FARBEN', 'ID', 'Fahrzeugfarben', 'Farbe', [{ f: 'BEZEICHNUNG', l: 'Bezeichnung', req: true }]);
  E.fibukonten = simple('FIBUKONTEN', 'ID', 'FIBU-Konten', 'FIBU-Konto', [{ f: 'KONTONR', l: 'Konto-Nr.', w: 90 }, { f: 'KTOBEZEICHNUNG', l: 'Bezeichnung', req: true }]);
  E.benutzer = simple('BENUTZER', 'BENUTZERID', 'Benutzer/Mitarbeiter', 'Benutzer', [
    { f: 'ANREDE', l: 'Anrede', t: 'combo', opts: ANREDEN, w: 80 }, { f: 'VORNAME', l: 'Vorname' }, { f: 'NAME', l: 'Name', req: true },
    { f: 'TELEFON', l: 'Telefon' }, { f: 'EMAIL', l: 'E-Mail', t: 'email' },
    { f: 'LOGINBENUTZEN', l: 'Anmeldung erlaubt', t: 'bool', w: 80 }, { f: 'BENUTZER', l: 'Benutzername' },
    { f: 'PASSWORT', l: 'Passwort (leer = unverändert)', t: 'password', hidden: true },
    { f: 'PERSONALNR', l: 'Personal-Nr. (Stempeluhr)', w: 90 }], { right: 'Benutzer' });
  E.benutzer.form = [
    { tab: 'Benutzer', groups: [
      { title: 'Person', fields: [{ f: 'ANREDE', l: 'Anrede', t: 'combo', opts: ANREDEN, w: 1 }, { f: 'VORNAME', l: 'Vorname', w: 1 }, { f: 'NAME', l: 'Name / Bezeichnung', req: true }, { f: 'TELEFON', l: 'Telefon', w: 1 }, { f: 'EMAIL', l: 'E-Mail', t: 'email', w: 1 }] },
      { title: 'Anmeldung', fields: [{ f: 'LOGINBENUTZEN', l: 'Anmeldung erlaubt', t: 'bool' }, { f: 'BENUTZER', l: 'Benutzername', w: 1 }, { f: 'PASSWORT', l: 'Passwort (leer = unverändert)', t: 'password', w: 1 }] },
      { title: 'Verwendung', fields: [{ f: 'ZEITERFASSUNG', l: 'Mitarbeiter in der Zeiterfassung', t: 'bool' }, { f: 'PERSONALNR', l: 'Personal-Nr. (Stempeluhr)', w: 1 }, { f: 'EINTRITT', l: 'Eintrittsdatum', t: 'date', w: 1 }, { f: 'KASSENBEDIENER', l: 'Kassenbediener', t: 'bool' }, { f: 'TERMINPLANER', l: 'Als Ressource im Terminplaner anzeigen', t: 'bool' }] },
    ] },
    { tab: 'Sollzeiten / Urlaub', groups: [
      { title: 'Sollstunden je Wochentag', fields: [['SOLLMO', 'Montag'], ['SOLLDI', 'Dienstag'], ['SOLLMI', 'Mittwoch'], ['SOLLDO', 'Donnerstag'], ['SOLLFR', 'Freitag'], ['SOLLSA', 'Samstag'], ['SOLLSO', 'Sonntag']].map(([f, l]) => ({ f, l, t: 'num', w: 1 })) },
      { title: 'Urlaub', fields: [{ f: 'URLAUBSANSPRUCH', l: 'Urlaubsanspruch (Tage pro Jahr)', t: 'num' }] },
    ] },
  ];

  E.termine = { table: 'SW_TERMINE', pk: 'ID', title: 'Termine', one: 'Termin', right: 'Termine', columns: [{ f: 'BEGINN', l: 'Beginn', t: 'datetime' }, { f: 'TITEL', l: 'Titel' }], search: [{ f: 'TITEL', l: 'Titel' }], sort: 'BEGINN' };
  E.aufgaben = {
    table: 'SW_AUFGABEN', pk: 'ID', title: 'Aufgaben', one: 'Aufgabe', icon: '✅', right: 'Termine',
    columns: [{ f: 'ERLEDIGT', l: 'Erledigt', w: 70, t: 'bool' }, { f: 'FAELLIG', l: 'Fällig', w: 90, t: 'date' }, { f: 'PRIOTEXT', l: 'Priorität', w: 80, sql: "CASE PRIORITAET WHEN 2 THEN 'hoch' WHEN 0 THEN 'niedrig' ELSE 'normal' END" }, { f: 'TITEL', l: 'Aufgabe', w: 300 },
      { f: 'KUNDE', l: 'Kunde', w: 180, sql: "(SELECT TRIM(COALESCE(k.NAME,'')||' '||COALESCE(k.VORNAME,'')) FROM KUNDEN k WHERE k.KUNID=SW_AUFGABEN.KUNID)" }],
    search: [{ f: 'TITEL', l: 'Aufgabe' }, { f: 'KUNDE', l: 'Kunde' }],
    statusFilters: [{ key: 'erl', l: 'Status', opts: [{ k: 'offen', l: 'offen', sql: 'COALESCE(ERLEDIGT,0)=0' }, { k: 'erl', l: 'erledigt', sql: 'ERLEDIGT=1' }, { k: 'alle', l: 'alle', sql: '1=1' }] }],
    sort: 'FAELLIG', letter: null,
    form: [{ tab: 'Aufgabe', groups: [{ title: 'Aufgabe', fields: [
      { f: 'TITEL', l: 'Aufgabe', req: true }, { f: 'FAELLIG', l: 'Fällig am', t: 'date', w: 1 },
      { f: 'PRIORITAET', l: 'Priorität', t: 'select', opts: [[0, 'niedrig'], [1, 'normal'], [2, 'hoch']], w: 1 },
      { f: 'KUNID', l: 'Kunde', t: 'kunde' }, { f: 'ERLEDIGT', l: 'erledigt', t: 'bool' }, { f: 'NOTIZ', l: 'Notiz', t: 'memo', rows: 5 }] }] }],
  };
  E.briefe = {
    table: 'SW_BRIEFE', pk: 'ID', title: 'Briefe', one: 'Brief', icon: '✉️', right: 'Termine',
    columns: [{ f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'BETREFF', l: 'Betreff', w: 300 },
      { f: 'KUNDE', l: 'Empfänger', w: 220, sql: "(SELECT TRIM(COALESCE(k.NAME,'')||' '||COALESCE(k.VORNAME,'')) FROM KUNDEN k WHERE k.KUNID=SW_BRIEFE.KUNID)" }],
    search: [{ f: 'BETREFF', l: 'Betreff' }, { f: 'KUNDE', l: 'Empfänger' }], sort: 'DATUM', sortDir: 'desc', letter: null,
    form: [{ tab: 'Brief', groups: [{ title: 'Brief', fields: [
      { f: 'KUNID', l: 'Empfänger (Kunde)', t: 'kunde' }, { f: 'DATUM', l: 'Datum', t: 'date', w: 1 }, { f: 'BETREFF', l: 'Betreff', req: true },
      { f: 'TEXT', l: 'Text  (Platzhalter: {Anrede} {Name} {Vorname} {Briefanrede})', t: 'memo', rows: 14 }] }] }],
  };

  // --- Purchasing ---
  E.eingang = {
    table: 'SW_EINGANG', pk: 'ID', title: 'Eingangsrechnungen', one: 'Eingangsrechnung', icon: '📥', right: 'Einkauf', custom: 'eingang',
    columns: [
      { f: 'DATUM', l: 'Datum', w: 90, t: 'date' }, { f: 'RECHNUNGSNR', l: 'Rechnungs-Nr.', w: 130 }, { f: 'LIEFNAME', l: 'Lieferant', w: 220 },
      { f: 'NETTO', l: 'Netto', w: 95, t: 'money' }, { f: 'MWST', l: 'USt', w: 85, t: 'money' }, { f: 'BRUTTO', l: 'Brutto', w: 95, t: 'money' },
      { f: 'OFFEN', l: 'Offen', w: 95, t: 'money', sql: 'ROUND(SW_EINGANG.BRUTTO - COALESCE((SELECT SUM(z.BETRAG) FROM SW_EINGANG_ZAHLUNG z WHERE z.EINGANGID=SW_EINGANG.ID),0),2)' },
      { f: 'FAELLIG', l: 'Fällig', w: 90, t: 'date' },
      { f: 'ZAHLSTATUSTEXT', l: 'Status', w: 110, sql: "CASE COALESCE(ZAHLSTATUS,0) WHEN 2 THEN 'bezahlt' WHEN 1 THEN 'teilweise bezahlt' ELSE 'offen' END" },
      { f: 'ERECHNUNGFORMAT', l: 'E-Rechnung', w: 100 }, { f: 'GEGENKONTO', l: 'Gegenkonto', w: 85, hidden: true },
    ],
    search: [{ f: 'LIEFNAME', l: 'Lieferant' }, { f: 'RECHNUNGSNR', l: 'Rechnungs-Nr.' }, { f: 'DATUM', l: 'Datum (JJJJ-MM-TT)' }],
    statusFilters: [{ key: 'status', l: 'Status', opts: [{ k: 'alle', l: 'alle', sql: '1=1' }, { k: 'offen', l: 'offen', sql: 'COALESCE(ZAHLSTATUS,0)=0' }, { k: 'teil', l: 'teilweise bezahlt', sql: 'ZAHLSTATUS=1' }, { k: 'bez', l: 'bezahlt', sql: 'ZAHLSTATUS=2' }] }],
    sort: 'DATUM', sortDir: 'desc', letter: null, monthFilter: 'DATUM',
  };
  E.lager = {
    table: 'ARTIKEL', pk: 'ARTID', title: 'Lagerbestände', one: 'Artikel', icon: '🏬', right: 'Artikel',
    number: { f: 'ARTNUMMER', key: 'Nummerkreis Artikel', text: true },
    columns: [
      { f: 'ARTNUMMER', l: 'Artikel-Nr.', w: 120 }, { f: 'BEZEICHNUNG1', l: 'Bezeichnung', w: 260 }, { f: 'LAGERORT', l: 'Lagerort', w: 100 },
      { f: 'LAGER', l: 'Bestand', w: 80, t: 'num' }, { f: 'LAGERMIN', l: 'Mindestbestand', w: 100, t: 'num' }, { f: 'LAGERMAX', l: 'Maximalbestand', w: 100, t: 'num' },
      { f: 'RESERVIERT', l: 'Reserviert', w: 85, t: 'num', sql: "(SELECT COALESCE(SUM(p.MENGE),0) FROM AUFTRAEGE_POS p JOIN AUFTRAEGE a ON a.AUFTRAGID=p.AUFTRAGID WHERE p.ARTID=ARTIKEL.ARTID AND p.POSART='A' AND COALESCE(a.RECHNUNGID,-1)<=0 AND COALESCE(a.ARCHIV,0)=0)" },
      { f: 'VERFUEGBAR', l: 'Verfügbar', w: 85, t: 'num', sql: "COALESCE(LAGER,0)-(SELECT COALESCE(SUM(p.MENGE),0) FROM AUFTRAEGE_POS p JOIN AUFTRAEGE a ON a.AUFTRAGID=p.AUFTRAGID WHERE p.ARTID=ARTIKEL.ARTID AND p.POSART='A' AND COALESCE(a.RECHNUNGID,-1)<=0 AND COALESCE(a.ARCHIV,0)=0)" },
      { f: 'EKPNETTO', l: 'EK netto', w: 85, t: 'money', right: 'Einkaufspreis anzeigen' }, { f: 'WERT', l: 'Lagerwert', w: 95, t: 'money', sql: 'ROUND(COALESCE(LAGER,0)*COALESCE(EKPNETTO,0),2)', right: 'Einkaufspreis anzeigen' },
    ],
    search: [{ f: 'BEZEICHNUNG1', l: 'Bezeichnung' }, { f: 'ARTNUMMER', l: 'Artikel-Nr.' }, { f: 'LAGERORT', l: 'Lagerort' }, { f: 'EAN', l: 'EAN' }],
    statusFilters: [{ key: 'bestand', l: 'Bestand', opts: [
      { k: 'alle', l: 'alle (mit Lagerführung)', sql: 'COALESCE(LAGERFUEHRUNG,0)=1' },
      { k: 'gleich', l: 'Bestand = Mindestbestand', sql: 'COALESCE(LAGERFUEHRUNG,0)=1 AND COALESCE(LAGER,0)=COALESCE(LAGERMIN,0)' },
      { k: 'unter', l: 'Bestand < Mindestbestand', sql: 'COALESCE(LAGERFUEHRUNG,0)=1 AND COALESCE(LAGER,0)<COALESCE(LAGERMIN,0)' },
      { k: 'null', l: 'Bestand <= 0', sql: 'COALESCE(LAGERFUEHRUNG,0)=1 AND COALESCE(LAGER,0)<=0' },
      { k: 'ohne', l: 'alle Artikel', sql: '1=1' }] }],
    letter: 'BEZEICHNUNG1', sort: 'BEZEICHNUNG1',
  };

  // --- Vehicle trading ---
  E.fahrzeuglager = {
    table: 'FAHRZEUGE', pk: 'FAHR_ID', title: 'Fahrzeuglager', one: 'Lagerfahrzeug', icon: '🚙', right: 'Fahrzeuge',
    number: { f: 'FRZNUMMER', key: 'Nummerkreis Fahrzeuge' }, where: 'FAHRZEUGE.FRZTYP IN (1,2)',
    columns: [
      { f: 'FRZNUMMER', l: 'Fz.-Nr.', w: 70, t: 'int' }, { f: 'TYPTEXT', l: 'Art', w: 60, sql: "CASE FRZTYP WHEN 1 THEN 'NW' ELSE 'GW' END" },
      { f: 'MARKE', l: 'Marke', w: 140 }, { f: 'MODELL', l: 'Modell', w: 170 }, { f: 'EZ', l: 'EZ', w: 85, t: 'date' }, { f: 'KM', l: 'KM', w: 80, t: 'int' },
      { f: 'FARBE', l: 'Farbe', w: 90 }, { f: 'KENNZEICHEN', l: 'Kennzeichen', w: 100, hidden: true }, { f: 'FZIDENTNR', l: 'FIN', w: 150, hidden: true },
      { f: 'EKP', l: 'EK', w: 90, t: 'money', right: 'Einkaufspreis anzeigen' }, { f: 'EINSATZ', l: 'Einsatz', w: 90, t: 'money', right: 'Einkaufspreis anzeigen' },
      { f: 'VKPBRUTTO', l: 'VK brutto', w: 95, t: 'money' }, { f: 'EINKAUF', l: 'Einkauf', w: 85, t: 'date' },
      { f: 'STANDTAGE', l: 'Standtage', w: 75, t: 'int', sql: "CAST(julianday('now') - julianday(EINKAUF) AS INTEGER)" }, { f: 'STANDORT', l: 'Standort', w: 100 },
    ],
    search: [{ f: 'MODELL', l: 'Modell' }, { f: 'MARKE', l: 'Marke' }, { f: 'FZIDENTNR', l: 'FIN' }, { f: 'KENNZEICHEN', l: 'Kennzeichen' }, { f: 'FRZNUMMER', l: 'Fz.-Nr.' }],
    statusFilters: [{ key: 'art', l: 'Art', opts: [{ k: 'alle', l: 'Neu- und Gebrauchtwagen', sql: '1=1' }, { k: 'nw', l: 'Neuwagen', sql: 'FRZTYP=1' }, { k: 'gw', l: 'Gebrauchtwagen', sql: 'FRZTYP=2' }] }],
    letter: 'MARKE', sort: 'EINKAUF', sortDir: 'desc',
  };
  E.fahrzeuglager.form = [
    { tab: 'Fahrzeugdaten', groups: [
      { title: 'Fahrzeug', fields: [
        { f: 'FRZNUMMER', l: 'Fahrzeug-Nr.', t: 'int', w: 1 }, { f: 'FRZTYP', l: 'Art', t: 'select', opts: [[1, 'Neuwagen (NW)'], [2, 'Gebrauchtwagen (GW)']], w: 1 },
        { f: 'FZIDENTNR', l: 'FIN', upper: true }, { f: 'SCHLUESSNR1', l: 'HSN', t: 'hsn', w: 1 }, { f: 'SCHLUESSNR2', l: 'TSN', t: 'tsn', w: 1 },
        { f: 'MARKE', l: 'Marke' }, { f: 'MODELL', l: 'Modell' }, { f: 'KENNZEICHEN', l: 'Kennzeichen', upper: true, w: 1 }, { f: 'FRZBRIEFNR', l: 'ZB II / Brief-Nr.', w: 1 },
        { f: 'EZ', l: 'Erstzulassung', t: 'date', w: 1 }, { f: 'HU', l: 'HU', t: 'hu', w: 1 }, { f: 'KM', l: 'KM-Stand', w: 1 }, { f: 'VORBESITZER', l: 'Vorbesitzer', t: 'int', w: 1 },
      ] },
      { title: 'Technik', fields: [
        { f: 'KW', l: 'kW', t: 'int', w: 1 }, { f: 'PS', l: 'PS', t: 'int', w: 1 }, { f: 'HUBRAUM', l: 'Hubraum', t: 'int', w: 1 }, { f: 'ZYLINDER', l: 'Zylinder', t: 'int', w: 1 },
        { f: 'KRAFTSTOFF', l: 'Kraftstoff', t: 'combo', src: 'opt60', w: 1 }, { f: 'GETRIEBE', l: 'Getriebe', t: 'combo', src: 'opt30', w: 1 }, { f: 'GANGE', l: 'Gänge', t: 'int', w: 1 },
        { f: 'TUREN', l: 'Türen', t: 'int', w: 1 }, { f: 'SITZE', l: 'Sitze', t: 'int', w: 1 }, { f: 'FARBE', l: 'Farbe', w: 1 }, { f: 'FARBCODE', l: 'Farbcode', w: 1 },
        { f: 'POSLSTER', l: 'Polster', t: 'combo', src: 'opt40', w: 1 }, { f: 'POSLSTERFARBE', l: 'Polsterfarbe', w: 1 }, { f: 'UMWELTPLAKETTE', l: 'Umweltplakette', t: 'combo', src: 'opt100', w: 1 }, { f: 'KAT', l: 'Schadstoffklasse', t: 'combo', src: 'opt50', w: 1 },
      ] },
    ] },
    { tab: 'Ausstattung/Beschreibung', groups: [
      { title: 'Ausstattung / Beschreibung', fields: [{ f: 'BESCHREIBUNG', l: 'Ausstattung, Sonderausstattung, Beschreibung', t: 'memo', rows: 10 }] },
      { title: 'Zustand', fields: [{ f: 'SCHECKHEFTGEPFLEGT', l: 'scheckheftgepflegt', t: 'bool' }, { f: 'UNFALLSCHADEN', l: 'Unfallschäden', t: 'memo', rows: 3 }, { f: 'ALLGZUSTAND', l: 'Allgemeiner Zustand / bekannte Mängel', t: 'memo', rows: 3 }] },
    ] },
    { tab: 'Handelsdaten', groups: [
      { title: 'Daten', fields: [
        { f: 'EINKAUF', l: 'Einkaufsdatum', t: 'date', w: 1 }, { f: 'VERKAUF', l: 'Verkaufsdatum', t: 'date', w: 1 }, { f: 'ABGEMELDET', l: 'Abgemeldet am', t: 'date', w: 1 },
        { f: 'STANDORT', l: 'Standort', w: 1 }, { f: 'KATEGORIE', l: 'Kategorie (Limousine, Kombi, …)', w: 1 },
        { f: 'MWSTAUSWEISBAR', l: 'MwSt ausweisbar (Regelbesteuerung) – sonst Differenzbesteuerung § 25a', t: 'bool' },
      ] },
      { title: 'Verbrauch & Emission (Pkw-EnVKV)', fields: [
        { f: 'VINNERORTS', l: 'Verbrauch innerorts (l/100 km)', w: 1 }, { f: 'VAUSSERORT', l: 'außerorts', w: 1 }, { f: 'VKOMBINIERT', l: 'kombiniert', w: 1 },
        { f: 'CO2EMMISSION', l: 'CO₂ (g/km)', t: 'int', w: 1 }, { f: 'STROM', l: 'Stromverbrauch (kWh/100 km)', t: 'int', w: 1 }, { f: 'EFFIZKLASSE', l: 'CO₂-Klasse', w: 1 }, { f: 'EMISGRUPPE', l: 'Emissionsgruppe', w: 1 },
        { f: 'LEERGEWICHT', l: 'Leergewicht (kg)', t: 'int', w: 1 }, { f: 'GESAMTGEWICHT', l: 'zul. Gesamtgewicht (kg)', t: 'int', w: 1 },
      ] },
    ] },
    { tab: 'Kalkulation', sub: 'handelKalkulation' },
    { tab: 'Dokumente/Fotos', sub: 'dokumente', bezug: 'FAHRZEUG' },
  ];
  E.kaufvertraege = {
    table: 'SW_KAUFVERTRAG', pk: 'ID', title: 'Kaufverträge', one: 'Kaufvertrag', icon: '🤝', right: 'Fahrzeuge',
    columns: [
      { f: 'NUMMER', l: 'Nr.', w: 70, t: 'int' }, { f: 'ART', l: 'Art', w: 50 }, { f: 'DATUM', l: 'Datum', w: 90, t: 'date' },
      { f: 'KAEUFERNAME', l: 'Käufer', w: 200, sql: "(SELECT TRIM(COALESCE(k.NAME,'')||' '||COALESCE(k.VORNAME,'')) FROM KUNDEN k WHERE k.KUNID=SW_KAUFVERTRAG.KUNID)" },
      { f: 'FZ', l: 'Fahrzeug', w: 220, sql: "(SELECT COALESCE(f.MARKE,'')||' '||COALESCE(f.MODELL,'') FROM FAHRZEUGE f WHERE f.FAHR_ID=SW_KAUFVERTRAG.FAHRID)" },
      { f: 'KAUFPREIS', l: 'Kaufpreis', w: 100, t: 'money' }, { f: 'RE', l: 'Rechnung', w: 90, sql: '(SELECT r.RECHNUNGNUMMER FROM RECHNUNGEN r WHERE r.RECHNUNGID=SW_KAUFVERTRAG.RECHNUNGID)' },
    ],
    search: [{ f: 'KAEUFERNAME', l: 'Käufer' }, { f: 'FZ', l: 'Fahrzeug' }, { f: 'NUMMER', l: 'Nr.' }], sort: 'NUMMER', sortDir: 'desc', letter: null,
    form: [
      { tab: 'Kunden-/Fahrzeugdaten', groups: [
        { title: 'Vertrag', fields: [{ f: 'NUMMER', l: 'Vertrags-Nr.', t: 'int', w: 1 }, { f: 'ART', l: 'Art', t: 'select', opts: [['GW', 'Gebrauchtwagen'], ['NW', 'Neuwagen']], w: 1 }, { f: 'DATUM', l: 'Datum', t: 'date', w: 1 }, { f: 'LIEFERTERMIN', l: 'Liefertermin', t: 'date', w: 1 }] },
        { title: 'Käufer', fields: [{ f: 'KUNID', l: 'Käufer (Kunde)', t: 'kunde', req: true }, { f: 'UNTERNEHMER', l: 'Käufer ist Unternehmer (kein Verbrauchsgüterkauf)', t: 'bool' }] },
        { title: 'Fahrzeug', fields: [{ f: 'FAHRID', l: 'Fahrzeug aus dem Lager', t: 'fahrzeug', ent: 'fahrzeuglager', req: true }, { f: 'KMSTAND', l: 'km-Stand bei Übergabe', w: 1 }, { f: 'HU', l: 'Nächste HU', t: 'hu', w: 1 }] },
        { title: 'Preis & Zahlung', fields: [
          { f: 'KAUFPREIS', l: 'Kaufpreis brutto', t: 'money', w: 1 }, { f: 'DIFFBESTEUERT', l: 'differenzbesteuert (§ 25a UStG)', t: 'bool', w: 1 },
          { f: 'ANZAHLUNG', l: 'Anzahlung', t: 'money', w: 1 }, { f: 'ZAHLUNGSWEISE', l: 'Zahlungsweise', t: 'combo', opts: ['Barzahlung bei Übergabe', 'Überweisung vor Übergabe', 'Finanzierung', 'Leasing'], w: 1 },
          { f: 'INZAHLUNGNAHME', l: 'Inzahlungnahme (Fahrzeug, FIN, km)', t: 'memo', rows: 2 }, { f: 'INZAHLUNGNAHMEBETRAG', l: 'Anrechnungsbetrag Inzahlungnahme', t: 'money' },
        ] },
      ] },
      { tab: 'Vorvertragliche Informationen', groups: [
        { title: 'Gewährleistung', fields: [{ f: 'GEWAEHRLEISTUNG', l: 'Sachmängelhaftung', t: 'select', opts: [[0, 'gesetzlich (2 Jahre)'], [1, 'auf 1 Jahr verkürzt (nur Gebrauchtwagen, vorher gesondert vereinbart)'], [2, 'ausgeschlossen (nur gegenüber Unternehmern)']] },
          { f: 'AKTUALISIERUNG_AUS', l: 'Aktualisierungspflicht für digitale Elemente ausgeschlossen (§ 475b BGB, gesondert vereinbart)', t: 'bool' }] },
        { title: 'Zustand / Mängel', fields: [{ f: 'UNFALLFREI', l: 'Das Fahrzeug ist nach Kenntnis des Verkäufers unfallfrei', t: 'bool' }, { f: 'UNFALLSCHAEDEN', l: 'Bekannte Unfallschäden', t: 'memo', rows: 3 }, { f: 'MAENGEL', l: 'Bekannte Mängel (vom Käufer zur Kenntnis genommen)', t: 'memo', rows: 4 }] },
        { title: 'Weitere Vereinbarungen', fields: [{ f: 'VORVERTRAGLICH', l: 'Vorvertragliche Informationen / Hinweise', t: 'memo', rows: 4 }, { f: 'ZUSATZ', l: 'Sonstige Vereinbarungen', t: 'memo', rows: 4 }] },
      ] },
    ],
  };

  // Document types
  const V = {
    angebot: { key: 'angebot', ent: 'angebote', table: 'ANGEBOTE', pos: 'ANGEBOTE_POS', pk: 'ANGEBOTID', posPk: 'ANGPOSID', nr: 'ANGEBOTNUMMER', numKey: 'Nummernkreis Angebot', title: 'Angebot', txtArt: 1, histTyp: 1, form: 'angebot' },
    auftrag: { key: 'auftrag', ent: 'auftraege', table: 'AUFTRAEGE', pos: 'AUFTRAEGE_POS', pk: 'AUFTRAGID', posPk: 'AUFPOSID', nr: 'AUFTRAGNUMMER', numKey: 'Nummernkreis Auftrag', title: 'Auftrag', txtArt: 2, histTyp: 2, form: 'auftrag' },
    lieferschein: { key: 'lieferschein', ent: 'lieferscheine', table: 'LIEFERSCHEIN', pos: 'LIEFERSCHEIN_POS', pk: 'LIEFERSCHEINID', posPk: 'LIEFPOSID', nr: 'LIEFERSCHEINNUMMER', numKey: 'Nummerkreis Lieferschein', title: 'Lieferschein', txtArt: 3, histTyp: 3, form: 'lieferschein' },
    rechnung: { key: 'rechnung', ent: 'rechnungen', table: 'RECHNUNGEN', pos: 'RECHNUNGEN_POS', pk: 'RECHNUNGID', posPk: 'RECHNUNGPOSID', nr: 'RECHNUNGNUMMER', numKey: 'Nummernkreis Rechnung', title: 'Rechnung', typ: 1, txtArt: 4, histTyp: 4, form: 'rechnung' },
    korrektur: { key: 'korrektur', ent: 'korrekturen', table: 'RECHNUNGEN', pos: 'RECHNUNGEN_POS', pk: 'RECHNUNGID', posPk: 'RECHNUNGPOSID', nr: 'RECHNUNGNUMMER', numKey: 'Nummerkreis Gutschrift', title: 'Rechnungskorrektur', typ: 2, txtArt: 5, histTyp: 5, form: 'rechnungskorrektur' },
  };
  // Link columns: in table X the ID of document Y
  const LINKS = {
    ANGEBOTE: { auftrag: 'AUFTRAGID', lieferschein: 'LIEFID', rechnung: 'RECHID' },
    AUFTRAEGE: { angebot: 'ANGEBOTID', lieferschein: 'LIEFERSCHEINID', rechnung: 'RECHNUNGID' },
    LIEFERSCHEIN: { angebot: 'ANGEBOTID', auftrag: 'AUFTRAGID', rechnung: 'RECHNUNGID' },
    RECHNUNGEN: { angebot: 'ANGEBOTID', auftrag: 'AUFTRAGID', lieferschein: 'LIEFERSCHEINID' },
  };

  // Permission categories (ZUGRIFFSRECHTE.KATEGORIE)
  return { E, V, LINKS, ANREDEN };
});
