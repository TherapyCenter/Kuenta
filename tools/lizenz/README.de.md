# Lizenzwerkzeug und Lizenz-Shop (nur für den Herausgeber)

[English](README.md) · **Deutsch**

Das Lizenzwerkzeug stellt Kuenta-Pro-Lizenzen aus. Es braucht den privaten Schlüssel
`~/.kuenta-lizenz/privat.pem`. Der darf **nie** ins Repository oder auf einen Server.

```
node tools/lizenz/lizenz-werkzeug.js ausstellen --kunde "Werkstatt Muster" --funktionen sms --email kunde@example.de
node tools/lizenz/lizenz-werkzeug.js pruefen <Schlüssel>
```

Alle ausgestellten Lizenzen stehen in `~/.kuenta-lizenz/ausgestellt.csv`.
**Sichern Sie `privat.pem` und `ausgestellt.csv`**, z. B. auf einem verschlüsselten USB-Stick.

## Lizenz-Shop über BTCPay Server

Kunden kaufen Add-ons in einem BTCPay-Shop und zahlen mit Bitcoin, Lightning oder USDT.
Das Lizenzwerkzeug auf Ihrem PC holt die bezahlten Bestellungen ab, stellt die Schlüssel aus
und schickt sie per E-Mail. Der private Schlüssel bleibt bei Ihnen. Der BTCPay Server bekommt
nur einen API-Schlüssel mit Leserecht und kann selbst keine Lizenzen erzeugen.

### 1. Shop in BTCPay anlegen

1. Im Store eine App vom Typ **Point of Sale** anlegen, Darstellung „Produktliste“ oder „Warenkorb“.
2. Je Add-on einen Artikel anlegen. **Die Artikel-ID muss der Kuenta-Funktionsname sein:**
   `sms` (SMS-Add-on, 10 €), optional `pro` (alle Add-ons). Abweichende IDs ordnen Sie in
   `shop.json` unter `artikel` zu, z. B. `"sms-addon": "sms"`.
3. Unter *Formulare* ein Formular mit den Feldern **`buyerName`** (Beschriftung „Name der
   Werkstatt“, Pflicht) und **`buyerEmail`** (E-Mail, Pflicht) anlegen und der App zuweisen.
4. Unter *Konto → API-Schlüssel* einen Schlüssel nur mit dem Recht **„Rechnungen ansehen“**
   (`btcpay.store.canviewinvoices`) für diesen Store anlegen.

### 2. Lizenzwerkzeug einrichten

```
node tools/lizenz/lizenz-werkzeug.js shop einrichten
```

Das legt `~/.kuenta-lizenz/shop.json` an. Tragen Sie dort ein:
- `btcpay.url`, `btcpay.storeId`, `btcpay.apiKey`
- `smtp`: Mailserver für den Versand der Schlüssel (`secure`: `starttls`, `ssl` oder `none`)

Dann prüfen:

```
node tools/lizenz/lizenz-werkzeug.js shop test --mail-an ihre@adresse.de
node tools/lizenz/lizenz-werkzeug.js shop --probe
```

`--probe` zeigt, was passieren würde, ohne etwas auszustellen oder zu verschicken.

### 3. Regelmäßig abholen

```
node tools/lizenz/lizenz-werkzeug.js shop
```

- Beim **ersten Lauf** merkt sich das Werkzeug den Zeitpunkt. Ältere Zahlungen werden nicht
  nachträglich beliefert.
- Jede Bestellung wird **nur einmal** beliefert. Der Stand liegt in `~/.kuenta-lizenz/shop-stand.json`.
- Kauft jemand mit derselben E-Mail-Adresse ein weiteres Add-on, enthält der neue Schlüssel
  **alle** Add-ons dieser Adresse.
- Schlägt die E-Mail fehl, bleibt der Schlüssel erhalten und wird beim nächsten Lauf erneut verschickt.
- Fehlen Name oder E-Mail, meldet das Werkzeug die Bestellung zur Klärung. Nach dem Ausstellen
  von Hand: `shop erledigt <BTCPay-Rechnungs-ID>`.

Unter Windows alle 15 Minuten automatisch (einmal in einer Eingabeaufforderung ausführen,
Pfade anpassen):

```
schtasks /Create /TN "Kuenta Lizenz-Shop" /SC MINUTE /MO 15 /TR "\"C:\Program Files\nodejs\node.exe\" \"C:\Users\admin\claude\Kuenta\tools\lizenz\lizenz-werkzeug.js\" shop"
```

Lizenzen gehen nur raus, wenn Ihr PC läuft. Das ist gewollt, denn der private Schlüssel bleibt so
offline. Bei Bedarf weisen Sie im Shop-Text darauf hin („Schlüssel kommt in der Regel innerhalb
weniger Stunden“).

### Rechnungen für Ihre Kunden

BTCPay erstellt nur einen Zahlungsbeleg. Ob und wie Sie eine Rechnung im Sinne des UStG
ausstellen müssen (z. B. als Kleinunternehmer), klären Sie bitte mit Ihrem Steuerberater.
