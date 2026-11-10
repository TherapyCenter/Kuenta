# Kuenta – Invoicing & POS for auto repair shops

**English** · [Deutsch](README.de.md)

Kuenta is cross-platform invoicing and point-of-sale software for car workshops. It runs in the browser on Windows, macOS, Linux and tablets and takes over the complete data of **KFZ-Faktura**, a widely used German workshop program (backup `*.kfz`, `DB1.bak` or directly from the program folder). Screens and workflow follow KFZ-Faktura: menu bar, navigation, quick bar, overview tables with search bar and letter bar, "More functions" and right-click menus, input forms with tabs.

The user interface is available in **German, English and Spanish**. Tax rules, e-invoicing, the cash register (TSE) and the DATEV export are designed for Germany.

## Installation and start

Detailed instructions for Windows, Linux and macOS: **[INSTALL.md](INSTALL.md)**.
Handbook: **[English](docs/handbook-en.html)** · **[Español](docs/handbook-es.html)** · **[Deutsch](docs/handbuch.html)**.

| System | Installation | Start |
|---|---|---|
| Windows | `Kuenta-Setup-<version>.exe` (Node.js included) | Start menu → *Kuenta* or *Kuenta (network)* |
| Linux / macOS | Node.js 22.13 or later, then `./installer/unix/install.sh` | `kuenta` (network: `kuenta --netzwerk`) |
| Container (Docker/Podman) | `podman build -t kuenta:1.8.0 .` or `docker compose up -d --build` | `http://<computer>:3700` (data in the volume `/data`) |
| Without installation | Node.js 22.13 or later | `Kuenta starten.bat`, `./kuenta.sh` or `node server/index.js --open` |

The browser then opens `http://127.0.0.1:3700`. In network mode the start window shows the address for the other devices. **Important:** in network mode, enable login under *Settings → Defaults* and create users.

After installation the database is empty. Enter your company details under *Settings*, or import existing data (KFZ-Faktura, earlier backups, CSV/DATANORM). Switch the language in the menu *Kuenta → Sprache / Language* or on the login page.

The data lives in the user profile, not in the program folder: Windows `%APPDATA%\Kuenta`, macOS `~/Library/Application Support/Kuenta`, Linux `~/.local/share/kuenta`.

Environment variables: `PORT` (default 3700), `HOST` (default 127.0.0.1), `KUENTA_LANG` (`de`, `en` or `es`: console and new installations, default: system language), `KUENTA_DATA` (different data folder, on a local drive only – not on a network drive/NAS, see INSTALL.md).

## Taking over data from KFZ-Faktura

*Kuenta → Import data from KFZ-Faktura* (or navigation *System → KFZ-Faktura import*):

1. **Backup (`*.kfz`)** – in KFZ-Faktura use *"KFZ-Faktura → Daten sichern"*, then drag and drop the file. Password-protected backups are supported.
2. **Database backup** `DB1.bak` / `*.fbk` – upload directly.
3. **Program folder** (Windows only), e.g. `C:\KFZ-Faktura` – reads `db\DB1.FDB` via the bundled Firebird. Close KFZ-Faktura first. The original database is only copied, never changed.

All tables are taken over (customers, vehicles, articles, labour items, suppliers, tyre storage, quotes, orders, delivery notes, invoices, invoice corrections, payments, open items, dunning letters, cash book, accounting entries, text modules, settings, number ranges, KBA vehicle codes, postcode directory) as well as documents, images and the company logo. Before every import Kuenta saves a safety copy of the previous data (subfolder `sicherheitskopien` in the data folder).

When importing again, data that only exists in Kuenta is kept: settings (email, register, backup), register receipts and closings, time tracking, appointments, tasks, letters, incoming invoices, vehicle trading, own documents, logs, and Kuenta's own fields in the master data (e.g. e-invoice format and Leitweg ID of a customer). The tables from KFZ-Faktura are replaced; beforehand Kuenta shows how many of them were changed in Kuenta since the last import. Technically: tables with the prefix `SW_` and the extra columns in `EXT_COLUMNS` (`server/db/index.js`) are copied from the previous database (`keepKuentaData` in `server/import/kfz.js`). Always add new Kuenta-only fields there.

Technology: Kuenta reads the Firebird backup format (gbak, versions 5–10) itself; Firebird does not need to be installed. Newer KFZ-Faktura versions pack their backup in 7-Zip format: unpack the `.kfz` file with 7-Zip and upload `db\DB1.bak`.

## Features

- **Master data:** customers (vehicles, document history, files, terms, e-invoice settings, Leitweg ID, foreign customers with net invoices), vehicles (KBA lookup via HSN/TSN, due dates, owner, tyre storage, history, photos/files), articles (price groups, stock, stock movements), labour items with hourly rates, suppliers, tyre storage with storage receipt.
- **Office:** appointment planner, tasks, letters, **time tracking** (totals/time account, clocking, orders, absence, corrections, month-end closing, time sheet, public holidays per German federal state) and **time clock** (clock in/out, break, order – with staff number, attendance list).
- **Purchasing:** incoming invoices (line items with stock booking and purchase price update, cash/bank payments, accounting entry, files), **reading incoming e-invoices** (XRechnung CII/UBL and ZUGFeRD PDF, the supplier is created automatically), stock levels (minimum stock, reserved, available), stock movement (quick entry with scanner), stocktaking (counting list, actual quantities, booking), visualising e-invoices.
- **Sales:** quote/cost estimate, order/job card, delivery note, invoice, invoice correction/credit note/cancellation – line items with articles, labour items, texts, subtotals, small parts and paint material surcharges, discount, pass-through items, vehicle sale/purchase, **import from parts catalogues (cart CSV/DATANORM)**. Continue, copy, archive, **down payment, partial and final invoices**, **collective invoice**, batch print, PDF, **sending by email** (directly via SMTP or handed over to Thunderbird/the default mail program, so the mail ends up in the "Sent" folder).
- **Cash register:** register screen with scanner input and quick keys, cash (with change)/debit card/credit card/**crypto**, pay orders or invoices at the register, automatic invoice for every cash sale, cash in/out, voiding receipts, closing (Z report) with cash count and difference booking, register journal, **cloud TSE fiskaly SIGN DE** (German KassenSichV) with QR code on the receipt, **DSFinV-K export**, **card terminal via ZVT**.
- **Crypto payment:** Bitcoin, Lightning and USDT through your own **BTCPay Server** – payment link and QR code on the PDF invoice and in the email, automatic booking of paid invoices, QR payment at the register. Free in the core, can be switched off.
- **Vehicle trading:** vehicle stock (new/used, equipment, trading data, Pkw-EnVKV details), costing with costs/expenses and margin scheme § 25a, price tag, sale by invoice with transfer to the customer, trade-ins into stock, **purchase contracts** (new/used, warranty, pre-contractual information) with invoice creation, sales statistics.
- **E-invoice:** XRechnung 3.0 (EN 16931) in CII and UBL, **ZUGFeRD 2.3 / Factur-X as PDF/A-3** with embedded XRechnung, tax cases reverse charge, intra-community supply, export, small business, margin scheme. Checked with the Mustang validator (PDF/A and EN 16931/XRechnung Schematron).
- **Finance:** payments, open items, invoice list, dunning (4 levels, PDF, email), cash book, **DATEV export** (booking batch and debtors/creditors in DATEV format, Windows-1252, checks of fiscal year and account ranges, different fiscal year, collective debtor/creditor), GoBD data export.
- **Reports:** vehicle due dates with reminders by letter, **email and SMS** (log against double sending, opt-out per customer; SMS is a Pro feature, see below; SMS via a freely configurable HTTP gateway: provider, Android phone or the Kuenta SMS relay with a USB modem in `installer/sms-relais`), revenue/gross profit, mail merge, performance rate per order and employee.
- **Interfaces / data import:** import assistant for customers, vehicles, articles, labour items and suppliers from CSV with field mapping and templates, DATANORM 4/5.
- **System:** multiple companies (several businesses/demo data, selectable per workstation), users and permissions, change log, email sending log, backup (`*.kuenta`, optionally AES-256), daily automatic backup, overview with eye icon (hide amounts) and display in €, $, £, ₿ or sats (display only, rates from the ECB and Bitstamp; invoices stay in euros), light/dark mode and four colour schemes (blue, green, graphite, bordeaux) per workstation.
- **Languages:** user interface in German, English or Spanish (per workstation, menu *Kuenta → Sprache / Language*). Documents (PDF, printing, email templates) in a separate document language per company (*Settings → Defaults*).
- **Tax system per company:** Germany, Spain, the United Kingdom, the United States, France, Austria, Switzerland, Italy, the Netherlands, Belgium or Luxembourg (*Settings → Tax / dunning / register → Tax system*).
- **French tax system (tab *France*):** VAT 20/10/5.5 %, check of SIREN/SIRET, mandatory notes (legal form, capital, RCS, APE, nature of operations, late payment penalties, € 40 recovery fee), franchise en base, printed invoices locked; Factur-X EN 16931 and submission to Chorus Pro; cash register with a signed, chained journal, grand totals, closures, duplicates and event log (basis for NF525), FEC export; French as document language.
- **Austrian tax system (tab *Österreich*):** VAT 20/10/13 %, UID check (ATU…), invoice requirements of § 11 UStG (customer UID above € 10,000 gross) and § 14 UGB, small business exemption, cash accounting; cash register security regulation RKSV (signed receipts with QR code, AES-encrypted turnover counter, start, monthly, yearly, collective and closing receipts, failure of the signature device, DEP export; A-Trust a.sign RK online or a local test key); VAT return (UVA) with Kennzahlen and XML for FinanzOnline; e-invoices in ebInterface 6.1 for e-rechnung.gv.at.
- **Swiss tax system (tab *Schweiz*):** amounts in francs (CHF 1'234.50), VAT 8.1/2.6/3.8 %, UID check (CHE-…), VAT number on documents, businesses not registered for VAT; QR-bill with payment part and receipt (QR-IBAN with QR reference or IBAN with creditor reference); cash rounded to 5 centimes at the register; VAT return by Ziffern (effective or net tax rate method) with CSV.
- **Italian tax system (tab *Italia*):** VAT 22/10/4 % (second reduced rate adjustable), check of partita IVA and codice fiscale, company details (REA, share capital, single shareholder), flat rate scheme (regime forfettario), nature codes N1–N5, virtual stamp duty, split payment for public bodies; e-invoice FatturaPA 1.2.2 (FPR12/FPA12, credit note TD04) as XML for the SdI, the printed invoice is a courtesy copy; periodic VAT settlement (monthly or quarterly) with the F24 payment code and the sales VAT register (CSV); Italian as document language; at the register every sale becomes an invoice.
- **Dutch tax system (tab *Nederland*):** VAT 21/9 %, check of btw-id (eleven test and modulo 97) and KvK number, KvK and btw-id on every document, small business scheme (KOR), reverse charge, intra-community supplies, margin scheme; e-invoice Peppol BIS Billing 3.0 (UBL, invoice and credit note) with Peppol addresses (KvK 0106, OIN 0190, VAT number), checked against the UBL schema and the EN16931 and Peppol rules; VAT return by rubrieken (1a–5g) in whole euros with CSV; Dutch as document language.
- **Belgian tax system (tab *België / Belgique*):** VAT 21/12/6 %, check of the enterprise number (modulo 97), enterprise number and RPR/RPM on every document, small business exemption, reverse charge, intra-community supplies, margin scheme and disbursements with legal texts in Dutch or French; e-invoice Peppol BIS Billing 3.0 (mandatory between businesses since 2026) with the enterprise number as Peppol address (0208); periodic VAT return by grids with the XML for Intervat, checked against the schema of the SPF Finances; French as document language (also for France).
- **Luxembourg tax system (tab *Lëtzebuerg*):** VAT 17/14/8 % (third rate adjustable, e.g. 3 %), check of the VAT number, VAT number, RCS and business permit on every document, small business franchise (art. 57), legal texts in French or German; e-invoice Peppol BIS Billing 3.0 (mandatory for public bodies) with the VAT number as Peppol address (9938); VAT return by the fields of the eCDF form, periodic (TVA_DECM / TVA_DECT) and annual (TVA_DECA, sections I–IV), and recapitulative statement (TVA_LICM/LICT, TVA_PSIM/PSIT), each with the XML for the eCDF platform, checked against the schema of the CTIE.
- **Note on Luxembourg:** Kuenta does not send Peppol invoices itself. Kuenta fills sections I–IV of the annual return; further parts of the form (among them the appendices on expenses) are completed by the accountant on eCDF. Check corrections of earlier periods in the recapitulative statement, the margin scheme and special cases with your accountant.
- **Note on Belgium:** Kuenta does not send Peppol invoices itself (through a Peppol service provider / access point or Hermes) and creates neither the annual client listing nor the intra-community listing.
- **Note on the Netherlands:** Kuenta does not send Peppol invoices itself (through a Peppol service provider or the Leveranciersportaal) and does not file the VAT return (entered in Mijn Belastingdienst Zakelijk); Kuenta does not create the ICP listing.
- **Note on Italy:** FatturaPA is checked against the official XSD schema 1.2.2. Kuenta does not send the file to the SdI itself (upload in the portal “Fatture e Corrispettivi”, by PEC or through an intermediary). Commercial documents at the register need an approved RT device; Kuenta does not create the LIPE or the annual VAT return.
- **Note on Austria:** RKSV tested with own tests (chain, turnover counter, signature) and against a simulated A-Trust service, not yet against the A-Trust service and the BMF receipt check app. ebInterface is checked against the official XSD schema 6.1; check the UVA XML with the FinanzOnline test upload before going live.
- **Spanish tax system (settings tab *España / VERI\*FACTU*):** IVA 21/10/4 %, recargo de equivalencia, NIF/NIE/CIF check, invoice series (own series for corrective invoices), full and simplified invoices (F1/F2), corrective invoices R1–R5, **VERI\*FACTU** (records with SHA-256 hash chain and QR code, sent to the AEAT with the company's electronic certificate, queue and retry when offline, flow control), receipts at the register as simplified invoices, **Facturae 3.2.2** for public administrations (FACe), VAT books (libros registro) as CSV and an overview for the modelo 303. Without this setting Kuenta works with German tax law as before; backups and the import from KFZ-Faktura are not affected.

### Notes and limits

- **TSE:** the cloud TSE from fiskaly (SIGN DE) is supported. The connection follows the API documentation and has been tested against a simulation, not yet against a real fiskaly account. Before going live, check with fiskaly test credentials and register the register with the tax office. USB TSEs (Swissbit) and the Austrian RKSV are not supported.
- **Card terminal:** ZVT over TCP/IP (registration and payment) has been tested against a simulated terminal, not against a real device.
- **DSFinV-K:** the export follows the file structure of DSFinV-K 2.3. Before an audit, check it with the DSFinV-K test tool.
- **Crypto payment:** tested against a simulated BTCPay Server, not yet against a real one. USDT only via the Liquid network.
- **Parts catalogues:** live connections to TecDoc, DAT, Elekat & co. require manufacturer licenses and are not included. Carts exported by the catalogues as CSV/DATANORM are taken over.
- **Purchase contract:** the contract texts are a template and do not replace legal advice.
- **UK tax system (settings tab *United Kingdom / MTD*):** invoices in pounds (£) as VAT invoices with VAT rate per line, tax point and VAT registration number, standard/reduced/zero rate/exempt, disbursements outside the scope, second-hand margin scheme, not VAT registered; VAT schemes standard, cash accounting and flat rate; **Making Tax Digital for VAT** (connect to HMRC via OAuth, load obligations, calculate the 9-box return from the invoices and submit it, fraud prevention headers); exports for **Xero** (sales invoices and bills), **QuickBooks Online**, **Sage 50** (audit trail) and a VAT journal.
- **US tax system (settings tab *United States / Sales tax*):** amounts in dollars, dates MM/DD/YYYY, addresses "Springfield, IL 62701"; one combined sales tax rate for the shop location (plus an optional second rate), labor and fees taxable or not, tax-exempt customers with exemption certificate; invoices with tax marker per line, condition of parts (new/used/rebuilt), odometer in/out, replaced parts returned or disposed of and the shop's registration number (e.g. BAR ARD No.); shop supplies (percentage of labor with a maximum) and configurable fees (hazardous waste, tire fee per tire, core charge); written estimates with the customer's authorizations (amount, date, method, person) and a warning when the invoice exceeds the authorized amount; register with prices before tax; export for **QuickBooks Online**.
- **Countries:** Germany, Spain (common territory), the United Kingdom (Great Britain; Northern Ireland EU trade not supported) and the United States (sales tax at the shop location; no automatic rate lookup or filing). Not supported in Spain: TicketBAI (Basque Country) and Navarre, IGIC (Canary Islands), REBU margin scheme in VERI\*FACTU, the "No VERI\*FACTU" mode with signed records, SII.
- **Making Tax Digital:** tested against a simulated HMRC API, not yet against the HMRC sandbox. Before going live the publisher registers Kuenta in the HMRC Developer Hub (API "VAT (MTD)", redirect URI), checks the fraud prevention headers in the sandbox (*Check headers*) and applies for production credentials.
- **VERI\*FACTU:** tested against the AEAT examples (hash) and a simulated AEAT service, not yet against the AEAT test environment. Before going live: store the electronic certificate, send test invoices in the test environment, then switch to production. The producer of the software must enter its tax ID in `server/es/sistema.js` and issue the *declaración responsable*. Facturae files are created without a signature; sign them with AutoFirma before uploading them to FACe.
- The user interface converts CMYK logos automatically into a PNG suitable for PDF/A.

## Backup

*Kuenta → Back up data* creates a `*.kuenta` file (ZIP with database and documents; with a password, AES-256-GCM encrypted). In addition Kuenta backs up automatically every day into the subfolder `sicherungen` of the data folder (number and folder adjustable). Alternatively back up the whole data folder while Kuenta is stopped. Backups of the predecessor versions "KFZ-Faktotum" (`*.kft`) and "Schraubwerk" (`*.swb`) can still be restored.

## Development

```
npm test                    # automated tests
npm run server              # start the server without a browser
npm run installer:windows   # build the Windows installer (needs Inno Setup 6, see INSTALL.md)
```

**No customer or company data** belongs in the repository: data lives in the user profile (or in `KUENTA_DATA`); `.gitignore` also excludes databases, backups (`*.kuenta`, `*.kft`, `*.swb`, `*.kfz`) and the folder `build/`. Tests only use made-up test data in temporary folders.

Structure: `server/` (HTTP server, business logic, import, e-invoice, PDF/A generation, SMTP, register/TSE/ZVT, backup), `public/` (user interface, no build step), `installer/` (Windows installer, Linux/macOS install script), `public/js/entities.js` (shared definition of all modules for server and user interface). The database is SQLite (built into Node.js) with the table and column names of KFZ-Faktura. Identifiers in the code are mostly German, comments are in English.

Translations: the German text in the code is the key; the translations are in `public/js/lang/en.js` and `es.js` (explained in `public/js/i18n.js`). `node tools/i18n/missing.js` lists texts without a translation.

Font: Liberation Sans (SIL Open Font License, `server/pdf/fonts/LICENSE`). QR code: qrcode-generator (MIT, `public/vendor/qrcode.js`).

## License

Copyright © 2026 Doc (heidepower@proton.me). Kuenta is open source under the **GNU Affero General Public License 3.0** (`LICENSE`). The folder `server/pro/` is excluded: it is under the [Kuenta Pro license](server/pro/LICENSE.en.md) (the German original [LICENSE.md](server/pro/LICENSE.md) is binding) and only runs with a license key. What belongs to Kuenta Pro and how to buy it (10 € per add-on, Bitcoin or Tether) is described in [PRO.md](PRO.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

### For the publisher: issuing licenses

```
node tools/lizenz/lizenz-werkzeug.js schluessel     # once: create the key pair
node tools/lizenz/lizenz-werkzeug.js ausstellen --kunde "Werkstatt Muster" --funktionen sms --zahlung "BTC …, txid …"
node tools/lizenz/lizenz-werkzeug.js pruefen KUENTA1.…
```

The private key is stored in `~/.kuenta-lizenz/privat.pem` and **never** belongs in the repository. The public key is in `server/lizenz.js`. Every issued license is recorded in `~/.kuenta-lizenz/ausgestellt.csv`. `--funktionen` names the purchased add-ons (several separated by commas, `pro` = all, including future ones). If someone buys another add-on, they get a new key with all their add-ons. Without `--bis` the license is unlimited.

Automatic sales through a BTCPay shop (Bitcoin, Lightning, USDT): `node tools/lizenz/lizenz-werkzeug.js shop`, setup in [tools/lizenz/README.md](tools/lizenz/README.md).

New Pro feature: put the code into `server/pro/`, add it to `FUNKTIONEN` in `server/lizenz.js` and call `LIZENZ.brauche('<name>')` in the route or module.
