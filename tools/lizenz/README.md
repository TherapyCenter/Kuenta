# License tool and license shop (publisher only)

**English** · [Deutsch](README.de.md)

The license tool issues Kuenta Pro licenses. It needs the private key
`~/.kuenta-lizenz/privat.pem`. That key must **never** go into the repository or onto a server.

```
node tools/lizenz/lizenz-werkzeug.js ausstellen --kunde "Werkstatt Muster" --funktionen sms --email kunde@example.de
node tools/lizenz/lizenz-werkzeug.js pruefen <key>
```

All issued licenses are listed in `~/.kuenta-lizenz/ausgestellt.csv`.
**Back up `privat.pem` and `ausgestellt.csv`**, e.g. on an encrypted USB stick.

## License shop via BTCPay Server

Customers buy add-ons in a BTCPay shop and pay with Bitcoin, Lightning or USDT.
The license tool on your PC fetches the paid orders, issues the keys and sends them by email.
The private key stays with you. The BTCPay Server only gets an API key with read rights and
cannot create licenses itself.

### 1. Create the shop in BTCPay

1. In the store, create an app of type **Point of Sale**, display "Product list" or "Cart".
2. Create one item per add-on. **The item ID must be the Kuenta feature name:**
   `sms` (SMS add-on, 10 €), optionally `pro` (all add-ons). Map different IDs in
   `shop.json` under `artikel`, e.g. `"sms-addon": "sms"`.
3. Under *Forms*, create a form with the fields **`buyerName`** (label "Workshop name",
   required) and **`buyerEmail`** (email, required) and assign it to the app.
4. Under *Account → API keys*, create a key with only the right **"View invoices"**
   (`btcpay.store.canviewinvoices`) for this store.

### 2. Set up the license tool

```
node tools/lizenz/lizenz-werkzeug.js shop einrichten
```

This creates `~/.kuenta-lizenz/shop.json`. Enter there:
- `btcpay.url`, `btcpay.storeId`, `btcpay.apiKey`
- `smtp`: mail server for sending the keys (`secure`: `starttls`, `ssl` or `none`)

Then check:

```
node tools/lizenz/lizenz-werkzeug.js shop test --mail-an your@address.com
node tools/lizenz/lizenz-werkzeug.js shop --probe
```

`--probe` shows what would happen without issuing or sending anything.

### 3. Fetch regularly

```
node tools/lizenz/lizenz-werkzeug.js shop
```

- On the **first run** the tool remembers the time. Older payments are not delivered afterwards.
- Each order is delivered **only once**. The state is kept in `~/.kuenta-lizenz/shop-stand.json`.
- If someone buys another add-on with the same email address, the new key contains
  **all** add-ons of that address.
- If the email fails, the key is kept and sent again on the next run.
- If name or email are missing, the tool reports the order for clarification. After issuing
  it by hand: `shop erledigt <BTCPay invoice ID>`.

On Windows, automatically every 15 minutes (run once in a command prompt, adjust the paths):

```
schtasks /Create /TN "Kuenta Lizenz-Shop" /SC MINUTE /MO 15 /TR "\"C:\Program Files\nodejs\node.exe\" \"C:\Users\admin\claude\Kuenta\tools\lizenz\lizenz-werkzeug.js\" shop"
```

Licenses only go out while your PC is running. That is intentional, because the private key
stays offline this way. If needed, mention it in the shop text ("The key usually arrives
within a few hours").

The emails with the key are currently in German.

### Invoices for your customers

BTCPay only creates a payment receipt. Whether and how you have to issue an invoice under
German VAT law (e.g. as a small business), please clarify with your tax adviser.
