# Kuenta – Invoicing & POS for auto repair shops

[English](README.md) · **Deutsch**

Kuenta ist eine plattformunabhängige Faktura für Kfz-Werkstätten. Es läuft im Browser auf Windows, macOS, Linux und Tablets und übernimmt den kompletten Datenbestand aus **KFZ-Faktura** (Datensicherung `*.kfz`, `DB1.bak` oder direkt aus dem Programmordner). Bedienung und Masken sind an KFZ-Faktura angelehnt: Menüleiste, Navigationsmenü, Schnellmenü, Übersichtstabellen mit Suchleiste und Buchstabenleiste, „Weitere Funktionen“ und Rechtsklick-Menüs, Eingabemasken mit Reitern.

## Installation und Start

Ausführliche Anleitung für Windows, Linux und macOS: **[INSTALL.de.md](INSTALL.de.md)**.
Handbuch: **[Deutsch](docs/handbuch.html)** · **[English](docs/handbook-en.html)** · **[Español](docs/handbook-es.html)**.

| System | Installation | Start |
|---|---|---|
| Windows | `Kuenta-Setup-<Version>.exe` (Node.js ist enthalten) | Startmenü → *Kuenta* bzw. *Kuenta im Netzwerk* |
| Linux / macOS | Node.js ab 22.13, dann `./installer/unix/install.sh` | `kuenta` (Netzwerk: `kuenta --netzwerk`) |
| Container (Docker/Podman) | `podman build -t kuenta:1.6.0 .` bzw. `docker compose up -d --build` | `http://<Rechner>:3700` (Daten im Volume `/data`) |
| ohne Installation | Node.js ab 22.13 | `Kuenta starten.bat` bzw. `./kuenta.sh` oder `node server/index.js --open` |

Danach öffnet sich der Browser mit `http://127.0.0.1:3700`. Im Netzwerkbetrieb zeigt das Startfenster die Adresse für die anderen Geräte an. **Wichtig:** Im Netzwerkbetrieb unter *Einstellungen → Vorgabewerte* die Anmeldung aktivieren und Benutzer anlegen.

Nach der Installation ist der Datenbestand leer. Firmendaten unter *Einstellungen* eintragen; vorhandene Daten per Import übernehmen (KFZ-Faktura, frühere Sicherungen, CSV/DATANORM).

Die Daten liegen im Benutzerprofil, nicht im Programmordner: Windows `%APPDATA%\Kuenta`, macOS `~/Library/Application Support/Kuenta`, Linux `~/.local/share/kuenta`.

Umgebungsvariablen: `PORT` (Standard 3700), `HOST` (Standard 127.0.0.1), `KUENTA_LANG` (`de`, `en` oder `es`: Konsole und neue Installationen, Standard: Systemsprache), `KUENTA_DATA` (anderes Datenverzeichnis, nur auf einem lokalen Laufwerk – nicht auf einem Netzlaufwerk/NAS, siehe INSTALL.de.md).

## Daten aus KFZ-Faktura übernehmen

*Kuenta → Daten aus KFZ-Faktura importieren* (oder Navigationsmenü *System → KFZ-Faktura-Import*):

1. **Datensicherung (`*.kfz`)** – in KFZ-Faktura *„KFZ-Faktura → Daten sichern“*, die Datei per Ziehen-und-Ablegen hochladen. Passwortgeschützte Sicherungen werden unterstützt.
2. **Datenbanksicherung** `DB1.bak` / `*.fbk` direkt hochladen.
3. **Programmordner** (nur Windows), z. B. `C:\KFZ-Faktura` – liest `db\DB1.FDB` über das mitgelieferte Firebird. KFZ-Faktura vorher schließen. Die Originaldatenbank wird nur kopiert, nie verändert.

Übernommen werden alle Tabellen (Kunden, Fahrzeuge, Artikel, Arbeitswerte, Lieferanten, Reifeneinlagerung, Angebote, Aufträge, Lieferscheine, Rechnungen, Rechnungskorrekturen, Zahlungen, OP, Mahnungen, Kassenbuch, FIBU-Buchungen, Textbausteine, Einstellungen, Nummernkreise, KBA-Schlüsselnummern, PLZ-Verzeichnis) sowie Dokumente, Bilder und das Firmenlogo. Vor jedem Import legt Kuenta eine Sicherheitskopie der bisherigen Daten an (Unterordner `sicherheitskopien` im Datenordner).

Bei einem erneuten Import bleiben Daten, die es nur in Kuenta gibt, erhalten: Einstellungen (E-Mail, Kasse, Sicherung), Kassenbons und -abschlüsse, Zeiterfassung, Termine, Aufgaben, Briefe, Eingangsrechnungen, Fahrzeughandel, eigene Dokumente, Protokolle sowie Kuenta-eigene Felder in den Stammdaten (z. B. E-Rechnungsformat und Leitweg-ID beim Kunden). Ersetzt werden die Tabellen aus KFZ-Faktura; Kuenta zeigt vorher an, wie viele davon seit dem letzten Import in Kuenta geändert wurden. Technisch: Tabellen mit Präfix `SW_` und die Zusatzspalten aus `EXT_COLUMNS` (`server/db/index.js`) werden aus der bisherigen Datenbank übernommen (`keepKuentaData` in `server/import/kfz.js`). Neue Kuenta-eigene Felder deshalb immer dort anlegen.

Technik: Kuenta liest das Firebird-Sicherungsformat (gbak, Version 5–10) selbst ein; Firebird muss dafür nicht installiert sein. Neuere KFZ-Faktura-Versionen, die ihre Sicherung im 7-Zip-Format packen: die `.kfz`-Datei mit 7-Zip entpacken und `db\DB1.bak` hochladen.

## Funktionsumfang

- **Stammdaten:** Kunden (Fahrzeuge, Vorgangshistorie, Dokumente, Konditionen, E-Rechnungs-Einstellungen, Leitweg-ID, Auslandskunden mit Netto-Rechnung), Fahrzeuge (KBA-Suche über HSN/TSN, Termine, Halter, Reifeneinlagerung, Historie, Fotos/Dokumente), Artikel (Preisgruppen, Lager, Lagerbewegungen), Arbeitswerte mit Stundenverrechnungssätzen, Lieferanten, Reifeneinlagerung mit Einlagerungsbeleg.
- **Büro:** Terminplaner, Aufgaben, Briefe, **Zeiterfassung** (Summen/Zeitkonto, Zeitstempelung, Aufträge, Abwesenheit, Korrekturen, Monatsabschluss, Stundenzettel, Feiertage je Bundesland) und **Stempeluhr** (Kommen/Gehen, Pause, Auftrag – mit Personalnummer, Anwesenheitsliste).
- **Einkauf:** Eingangsrechnungen (Positionen mit Lagerbuchung und EK-Aktualisierung, Zahlungen bar/Bank, FIBU-Buchung, Dokumente), **Einlesen eingehender E-Rechnungen** (XRechnung CII/UBL und ZUGFeRD-PDF, Lieferant wird automatisch angelegt), Lagerbestände (Mindestbestand, reserviert, verfügbar), Lagerbewegung (Schnellerfassung mit Scanner), Inventur (Zählliste, Ist-Erfassung, Buchung), E-Rechnung visualisieren.
- **Verkauf:** Angebot/Kostenvoranschlag, Auftrag/Arbeitskarte, Lieferschein, Rechnung, Rechnungskorrektur/Gutschrift/Storno – Positionen mit Artikeln, Arbeitswerten, Texten, Zwischensummen, KET, MTZ, Rabatt, durchlaufenden Posten, Fahrzeugverkauf/-ankauf, **Import aus Teilekatalogen (Warenkorb-CSV/DATANORM)**. Weiterführen, Kopieren, Archiv, **Anzahlungs-/Abschlags- und Schlussrechnung**, **Sammelrechnung**, Stapeldruck, PDF, **E-Mail-Versand** (direkt per SMTP oder Übergabe an Thunderbird/das Standard-Mailprogramm, damit die Mail im Ordner „Gesendet“ liegt).
- **Kasse:** Kassenoberfläche mit Scanner-Eingabe und Schnelltasten, Bar (mit Rückgeld)/EC/Kreditkarte, Auftrag oder Rechnung über die Kasse bezahlen, automatische Rechnung zu jedem Barumsatz, Ein-/Auszahlungen, Bon-Storno, Kassenabschluss (Z-Bon) mit Zählprotokoll und Differenzbuchung, Kassenjournal, **Cloud-TSE fiskaly SIGN DE** (KassenSichV) mit QR-Code auf dem Bon, **DSFinV-K-Export**, **EC-Terminal über ZVT**.
- **Fahrzeughandel:** Fahrzeuglager (NW/GW, Ausstattung, Handelsdaten, Pkw-EnVKV-Angaben), Kalkulation mit Kosten/Aufwand und Differenzbesteuerung § 25a, Preisschild, Verkauf per Rechnung mit Umbuchung zum Kunden, Inzahlungnahme ins Lager, **Kaufverträge** (NW/GW, Gewährleistung, vorvertragliche Informationen) mit Rechnungserstellung, Verkaufsstatistik.
- **E-Rechnung:** XRechnung 3.0 (EN 16931) in CII und UBL, **ZUGFeRD 2.3 / Factur-X als PDF/A-3** mit eingebetteter XRechnung, Steuerfälle Reverse Charge, innergemeinschaftliche Lieferung, Ausfuhr, Kleinunternehmer, Differenzbesteuerung. Geprüft mit dem Mustang-Validator (PDF/A und EN-16931-/XRechnung-Schematron).
- **Finanzen:** Zahlungen, Offene Posten, Rechnungsliste, Mahnwesen (4 Stufen, PDF, E-Mail), Kassenbuch, **DATEV-Export** (Buchungsstapel und Debitoren/Kreditoren im DATEV-Format, Windows-1252, Prüfung von Wirtschaftsjahr und Kontenbereichen, abweichendes Wirtschaftsjahr, Sammeldebitor/-kreditor), GoBD-Datenexport.
- **Auswertung:** Fahrzeugtermine mit Erinnerung per Brief, **E-Mail und SMS** (Protokoll gegen Doppelversand, Abmeldung je Kunde; SMS ist eine Pro-Funktion, siehe unten; SMS über frei einstellbares HTTP-Gateway: Anbieter, Android-Handy oder Kuenta-SMS-Relais mit Surfstick in `installer/sms-relais`), Umsatz/Roherlöse, Serienbriefe, Leistungsgrad je Auftrag und Mitarbeiter.
- **Schnittstellen / Datenimport:** Import-Assistent für Kunden, Fahrzeuge, Artikel, Arbeitswerte und Lieferanten aus CSV mit Feldzuordnung und Vorlagen, DATANORM 4/5.
- **System:** Mandantenverwaltung (mehrere Betriebe/Demodaten, je Arbeitsplatz wählbar), Benutzer und Rechte, Änderungsprotokoll, E-Mail-Versandprotokoll, Datensicherung (*.kuenta, optional AES-256), tägliche automatische Sicherung, Übersicht mit Augensymbol (Beträge ausblenden) und Anzeige in €, $, £, ₿ oder sats (nur Anzeige, Kurse von EZB und Bitstamp; Rechnungen bleiben in Euro), Hell-/Dunkelmodus und vier Farbschemata (Blau, Grün, Graphit, Bordeaux) je Arbeitsplatz.
- **Sprachen:** Oberfläche auf Deutsch, Englisch oder Spanisch (je Arbeitsplatz, Menü *Kuenta → Sprache / Language*). Belege (PDF, Druck, E-Mail-Vorlagen) in einer eigenen Belegsprache je Mandant (*Einstellungen → Vorgabewerte*).
- **Steuersystem je Mandant:** Deutschland, Spanien, Großbritannien, USA, Frankreich, Österreich, Schweiz, Italien oder Niederlande (*Einstellungen → Steuer / Mahnung / Kasse → Steuersystem*).
- **Österreichisches Steuersystem (Reiter *Österreich*):** USt 20/10/13 %, Prüfung der UID (ATU…), Pflichtangaben nach § 11 UStG (Kunden-UID ab 10.000 € brutto) und § 14 UGB (Rechtsform, Sitz, Firmenbuch), Kleinunternehmer, Ist-Besteuerung; Registrierkasse nach RKSV (signierte Belege mit QR-Code, AES-verschlüsselter Umsatzzähler, Start-, Monats-, Jahres-, Sammel- und Schlussbeleg, Ausfall der Signatureinheit, DEP-Export; A-Trust a.sign RK online oder lokaler Testschlüssel); UVA mit Kennzahlen und XML für FinanzOnline; E-Rechnung im Format ebInterface 6.1 für e-rechnung.gv.at.
- **Schweizer Steuersystem (Reiter *Schweiz*):** Beträge in Franken (CHF 1'234.50), MWST 8,1/2,6/3,8 %, Prüfung der UID (CHE-…), MWST-Nummer auf den Belegen, nicht MWST-pflichtige Betriebe; QR-Rechnung mit Zahlteil und Empfangsschein (QR-IBAN mit QR-Referenz oder IBAN mit Creditor Reference); 5-Rappen-Rundung bei Barzahlung an der Kasse; MWST-Abrechnung nach Ziffern (effektive Methode oder Saldosteuersatz) mit CSV.
- **Italienisches Steuersystem (Reiter *Italia*):** IVA 22/10/4 % (zweiter ermäßigter Satz einstellbar), Prüfung von Partita IVA und Codice Fiscale, Pflichtangaben (REA, Capitale sociale, Socio unico), Regime forfettario, Natura-Codes N1–N5, Marca da bollo virtuale, Split payment für öffentliche Auftraggeber; elektronische Rechnung FatturaPA 1.2.2 (FPR12/FPA12, Nota di credito TD04) als XML für das SdI, gedruckte Rechnung als copia di cortesia; Liquidazione IVA monatlich oder vierteljährlich mit Codice tributo für das F24 und Registro IVA vendite (CSV); Belegsprache Italienisch; an der Kasse wird jeder Verkauf als Rechnung erfasst.
- **Niederländisches Steuersystem (Reiter *Nederland*):** btw 21/9 %, Prüfung von btw-id (Elferprobe und Modulo 97) und KvK-Nummer, KvK und btw-id auf jedem Beleg, Kleineondernemersregeling (KOR), btw verlegd, ICL, Margeregeling; E-Rechnung Peppol BIS Billing 3.0 (UBL, Rechnung und Creditnota) mit Peppol-Adressen (KvK 0106, OIN 0190, USt-IdNr.), geprüft gegen UBL-Schema sowie EN16931- und Peppol-Regeln; Btw-aangifte nach Rubriken (1a–5g) in ganzen Euro mit CSV; Belegsprache Niederländisch.
- **Hinweis Niederlande:** Kuenta sendet Peppol-Rechnungen nicht selbst (über einen Peppol-Dienstleister oder das Leveranciersportaal) und reicht die Btw-aangifte nicht ein (Eingabe in Mijn Belastingdienst Zakelijk); die ICP-Meldung erstellt Kuenta nicht.
- **Hinweis Italien:** FatturaPA ist gegen das offizielle XSD-Schema 1.2.2 geprüft. Kuenta sendet die Datei nicht selbst an das SdI (Upload im Portal „Fatture e Corrispettivi“, per PEC oder über einen Dienstleister). Für documenti commerciali an der Kasse ist ein zugelassenes RT-Gerät nötig; LIPE und Dichiarazione IVA erstellt Kuenta nicht.
- **Hinweis Österreich:** RKSV geprüft mit eigenen Tests (Verkettung, Umsatzzähler, Signatur) und gegen eine simulierte A-Trust-Schnittstelle, noch nicht gegen den A-Trust-Dienst und die BMF-Belegcheck-App. ebInterface ist gegen das offizielle XSD-Schema 6.1 geprüft; die UVA-XML vor dem ersten Echtbetrieb mit dem FinanzOnline-Testupload prüfen.
- **Spanisches Steuersystem (Reiter *España / VERI\*FACTU*):** IVA 21/10/4 %, Recargo de equivalencia, Prüfung von NIF/NIE/CIF, Rechnungsserien (eigene Serie für Korrekturen), vollständige und vereinfachte Rechnungen (F1/F2), Rechnungskorrekturen R1–R5, **VERI\*FACTU** (Datensätze mit SHA-256-Hash-Kette und QR-Code, Versand an die AEAT mit dem elektronischen Zertifikat der Firma, Warteschlange ohne Internet, Flusskontrolle), Kassenbons als vereinfachte Rechnungen, **Facturae 3.2.2** für Behörden (FACe), Umsatzsteuerbücher (libros registro) als CSV und Übersicht für das modelo 303. Ohne diese Einstellung arbeitet Kuenta wie bisher nach deutschem Steuerrecht; Sicherungen und der Import aus KFZ-Faktura sind davon nicht betroffen.
- **Britisches Steuersystem (Reiter *United Kingdom / MTD*):** Rechnungen in Pfund (£) als VAT invoice mit VAT-Satz je Position, Tax point und VAT-Registriernummer, Standard/Reduced/Zero rate/Exempt, Auslagen (outside the scope), second-hand margin scheme, nicht registrierte Kleinbetriebe; VAT-Schemen Standard, Cash accounting und Flat rate; **Making Tax Digital for VAT** (Verbindung zu HMRC per OAuth, Zeiträume abrufen, 9-Box-Erklärung aus den Rechnungen berechnen und einreichen, Fraud-Prevention-Header); Exporte für **Xero** (Verkaufs- und Eingangsrechnungen), **QuickBooks Online**, **Sage 50** (Audit trail) und ein VAT-Journal.
- **US-Steuersystem (Reiter *United States / Sales tax*):** Beträge in Dollar, Datum MM/TT/JJJJ, Adressen „Springfield, IL 62701“; ein kombinierter Sales-Tax-Satz des Werkstattstandorts (optional ein zweiter), Arbeit und Gebühren wahlweise steuerpflichtig, steuerbefreite Kunden mit Exemption Certificate; Rechnungen mit Steuerkennzeichen je Position, Zustand der Teile (neu/gebraucht/aufbereitet), Tacho bei Annahme und Rückgabe, Verbleib der ersetzten Teile und Registriernummer der Werkstatt (z. B. BAR ARD No.); Shop supplies (Prozent der Arbeit mit Obergrenze) und einstellbare Gebühren (Altstoffe, Reifen je Stück, Core charge); schriftlicher Kostenvoranschlag mit Freigaben des Kunden (Betrag, Datum, Art, Person) und Warnung, wenn die Rechnung den freigegebenen Betrag übersteigt; Kasse mit Preisen vor Steuer; Export für **QuickBooks Online**. Keine automatische Satzermittlung und keine Steuererklärung.
- **Hinweis Making Tax Digital:** geprüft gegen eine simulierte HMRC-Schnittstelle, noch nicht gegen die HMRC-Sandbox. Vor dem Echtbetrieb registriert der Herausgeber Kuenta im HMRC Developer Hub (API „VAT (MTD)“, Redirect URI), prüft die Fraud-Prevention-Header in der Sandbox (*Header prüfen*) und beantragt die Produktionsfreigabe. Nicht unterstützt: EU-Warenverkehr Nordirlands (Boxen 2, 8, 9).
- **Hinweis VERI\*FACTU:** geprüft mit den Beispielen der AEAT (Hash) und gegen einen simulierten AEAT-Dienst, noch nicht gegen die Testumgebung der AEAT. Vor dem Echtbetrieb: Zertifikat hinterlegen, Testrechnungen in der Testumgebung senden, dann auf Produktion umstellen. Der Hersteller der Software trägt seine Steuerkennung in `server/es/sistema.js` ein und gibt die *declaración responsable* ab. Nicht unterstützt: TicketBAI (Baskenland), Navarra, IGIC (Kanaren), REBU in VERI\*FACTU, der Modus „No VERI\*FACTU“, SII.

### Hinweise und Grenzen

- **TSE:** Unterstützt wird die Cloud-TSE von fiskaly (SIGN DE). Die Anbindung ist nach der API-Dokumentation umgesetzt und gegen eine Simulation getestet, aber noch nicht gegen ein echtes fiskaly-Konto. Vor dem Echtbetrieb bitte mit fiskaly-Testzugangsdaten prüfen und die Kasse beim Finanzamt melden. USB-TSE (Swissbit) und die österreichische RKSV werden nicht unterstützt.
- **EC-Terminal:** ZVT über TCP/IP (Anmeldung und Zahlung) ist gegen ein simuliertes Terminal getestet, nicht gegen ein echtes Gerät.
- **DSFinV-K:** Der Export folgt der Dateistruktur der DSFinV-K 2.3. Vor einer Prüfung bitte mit dem DSFinV-K-Prüfwerkzeug kontrollieren.
- **Teilekataloge:** Live-Schnittstellen zu TecDoc, DAT, Elekat & Co. setzen Herstellerlizenzen voraus und sind nicht enthalten. Übernommen werden Warenkörbe, die die Kataloge als CSV/DATANORM exportieren.
- **Kaufvertrag:** Die Vertragstexte sind ein Muster und ersetzen keine Rechtsberatung.
- Logos im CMYK-Format wandelt die Oberfläche automatisch in ein PDF/A-taugliches PNG um.

## Datensicherung

*Kuenta → Daten sichern* erzeugt eine `*.kuenta`-Datei (ZIP mit Datenbank und Dokumenten; mit Passwort AES-256-GCM-verschlüsselt). Zusätzlich sichert Kuenta täglich automatisch in den Unterordner `sicherungen` des Datenordners (Anzahl und Ordner einstellbar). Alternativ den ganzen Datenordner sichern, während Kuenta beendet ist. Sicherungen der Vorgängerversionen „KFZ-Faktotum“ (`*.kft`) und „Schraubwerk“ (`*.swb`) lassen sich weiterhin wiederherstellen.

## Entwicklung

```
npm test                    # automatische Tests
npm run server              # Server ohne Browser starten
npm run installer:windows   # Windows-Installer bauen (Inno Setup 6 nötig, siehe INSTALL.de.md)
```

Der Quellcode wird mit Git verwaltet. Es gehören **keine Kunden- oder Firmendaten** ins Repository: Daten liegen im Benutzerprofil (bzw. in `KUENTA_DATA`); `.gitignore` schließt zusätzlich Datenbanken, Sicherungen (`*.kuenta`, `*.kft`, `*.swb`, `*.kfz`) und den Ordner `build/` aus. Tests arbeiten nur mit erfundenen Testdaten in temporären Ordnern.

Aufbau: `server/` (HTTP-Server, Geschäftslogik, Import, E-Rechnung, PDF/A-Erzeugung, SMTP, Kasse/TSE/ZVT, Sicherung), `public/` (Oberfläche, ohne Build-Schritt), `installer/` (Windows-Installer, Linux/macOS-Installationsskript), `public/js/entities.js` (gemeinsame Definition aller Module für Server und Oberfläche). Die Datenbank ist SQLite (in Node.js eingebaut) mit den Tabellen- und Spaltennamen von KFZ-Faktura.

Übersetzungen: Der deutsche Text im Code ist der Schlüssel, die Übersetzungen stehen in `public/js/lang/en.js` und `es.js` (Erklärung in `public/js/i18n.js`). `node tools/i18n/missing.js` listet Texte ohne Übersetzung. Kommentare im Code sind englisch.

Schrift: Liberation Sans (SIL Open Font License, `server/pdf/fonts/LICENSE`). QR-Code: qrcode-generator (MIT, `public/vendor/qrcode.js`).

## Lizenz

Copyright © 2026 DoctorD (heidepower@proton.me). Kuenta ist Open Source unter der **GNU Affero General Public License 3.0** (`LICENSE`). Ausgenommen ist der Ordner `server/pro/`: Er steht unter der [Kuenta-Pro-Lizenz](server/pro/LICENSE.md) und läuft nur mit einem Lizenzschlüssel. Was zu Kuenta Pro gehört und wie man es kauft (10 € je Add-on, Bitcoin oder Tether), steht in [PRO.de.md](PRO.de.md). Beiträge: [CONTRIBUTING.de.md](CONTRIBUTING.de.md).

### Für den Herausgeber: Lizenzen ausstellen

```
node tools/lizenz/lizenz-werkzeug.js schluessel     # einmalig: Schlüsselpaar erzeugen
node tools/lizenz/lizenz-werkzeug.js ausstellen --kunde "Werkstatt Muster" --funktionen sms --zahlung "BTC …, txid …"
node tools/lizenz/lizenz-werkzeug.js pruefen KUENTA1.…
```

Der private Schlüssel liegt in `~/.kuenta-lizenz/privat.pem` und gehört **nie** ins Repository. Der öffentliche Schlüssel steht in `server/lizenz.js`. Jede ausgestellte Lizenz wird in `~/.kuenta-lizenz/ausgestellt.csv` vermerkt. `--funktionen` nennt die gekauften Add-ons (mehrere mit Komma, `pro` = alle, auch künftige). Kauft jemand ein weiteres Add-on, bekommt er einen neuen Schlüssel mit allen seinen Add-ons. Ohne `--bis` ist die Lizenz unbefristet.

Automatischer Verkauf über einen BTCPay-Shop (Bitcoin, Lightning, USDT): `node tools/lizenz/lizenz-werkzeug.js shop`, Einrichtung in [tools/lizenz/README.md](tools/lizenz/README.md).

Neue Pro-Funktion: Code nach `server/pro/`, in `server/lizenz.js` bei `FUNKTIONEN` eintragen und in der Route bzw. im Modul `LIZENZ.brauche('<name>')` aufrufen.
