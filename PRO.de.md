# KuentaPOS Pro

[English](PRO.md) · **Deutsch**

KuentaPOS ist Open Source (GNU AGPL 3.0) und in vollem Umfang kostenlos nutzbar: Rechnungen,
E-Rechnung, Kasse, DATEV, KFZ-Faktura-Import, Erinnerungen per Brief und E-Mail und alles andere.

Einige Zusatzfunktionen gibt es als **Add-ons**. Sie werden mit einem Lizenzschlüssel
freigeschaltet. Lizenzgeber ist der Open-Source-Entwickler **Doc**. Mit dem Kauf
finanzieren Sie die Weiterentwicklung.

## Add-ons

| Add-on | seit | Preis |
|---|---|---|
| **SMS:** SMS-Erinnerungen an HU, Inspektion und andere Termine, SMS-Gateway (Anbieter, Android-Handy, Surfstick über das KuentaPOS-SMS-Relais) | 1.0.8 | 20 $ |
| **WhatsApp Business:** Erinnerungen an Termine, Belege (Angebote, Aufträge, Rechnungen …) als PDF und die Nachricht „Fahrzeug fertig“ über die WhatsApp Cloud API von Meta, mit Ihrem eigenen WhatsApp-Business-Konto und freigegebenen Vorlagen | 1.9.0 | 20 $ |
| **Telegram:** Erinnerungen, Belege als PDF und „Fahrzeug fertig“ über Ihren eigenen Telegram-Bot; Kunden verbinden sich einmalig per QR-Code oder Link | 1.9.0 | 20 $ |

Der Preis gilt je Add-on, einmalig und unbefristet, für eine Installation mit allen Mandanten.
Bezahlt wird mit Bitcoin oder Tether zum Euro-Kurs am Zahltag.

## Bezahlen

- **Bitcoin (BTC):** on-chain oder über Lightning
- **Tether (USDT):** Netz wird mit der Rechnung genannt

So läuft eine Bestellung ab:

1. Schreiben Sie an **heidepower@proton.me** und nennen Sie den Namen Ihrer Werkstatt,
   die Rechnungsanschrift und die gewünschten Add-ons.
2. Sie erhalten eine Rechnung mit Betrag und Zahlungsadresse.
3. Nach Zahlungseingang bekommen Sie den Lizenzschlüssel per E-Mail.
4. In KuentaPOS unter *Einstellungen → Lizenz* den Schlüssel einfügen und „Lizenz einspielen“
   klicken. Fertig. KuentaPOS muss dafür nicht ins Internet.

## Häufige Fragen

**Ich kaufe später ein weiteres Add-on. Was passiert mit meinem Schlüssel?**
Sie bekommen einen neuen Schlüssel, der alle Ihre Add-ons enthält. Den spielen Sie wie gewohnt
ein, er ersetzt den alten.

**Gilt die Lizenz für mehrere Arbeitsplätze?**
Ja. KuentaPOS läuft auf einem Rechner und die anderen Arbeitsplätze greifen über das Netzwerk zu.
Die Lizenz gilt für diese eine Installation mit allen Mandanten.

**Warum ist der Pro-Code im Repository sichtbar?**
Damit Sie nachvollziehen können, was er tut. Er steht aber nicht unter der AGPL, sondern unter
der [KuentaPOS-Pro-Lizenz](server/pro/LICENSE.md): ausführen nur mit gültigem Schlüssel.
