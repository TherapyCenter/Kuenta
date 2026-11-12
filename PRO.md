# KuentaPOS Pro

**English** · [Deutsch](PRO.de.md)

KuentaPOS is open source (GNU AGPL 3.0) and fully usable free of charge: invoices, e-invoices,
cash register, DATEV, KFZ-Faktura import, reminders by letter and email, and everything else.

Some extra features are available as **add-ons**. They are unlocked with a license key.
The licensor is the open source developer **Doc**. Buying an add-on funds further development.

## Add-ons

| Add-on | since | Price |
|---|---|---|
| **SMS:** SMS reminders of the HU (German MOT), service and other due dates, SMS gateway (provider, Android phone, USB modem via the KuentaPOS SMS relay) | 1.0.8 | $20 |

The price is per add-on, one-off and unlimited, for one installation with all companies.
Payment is made with Bitcoin or Tether at the euro rate on the day of payment.

## Payment

- **Bitcoin (BTC):** on-chain or via Lightning
- **Tether (USDT):** the network is stated on the invoice

How an order works:

1. Write to **heidepower@proton.me** and state the name of your workshop,
   the billing address and the add-ons you want.
2. You receive an invoice with the amount and the payment address.
3. Once the payment has arrived, you get the license key by email.
4. In KuentaPOS, paste the key under *Settings → License* and click "Install license".
   Done. KuentaPOS does not need internet access for this.

## Frequent questions

**I buy another add-on later. What happens to my key?**
You get a new key that contains all your add-ons. Install it as usual; it replaces the old one.

**Does the license cover several workstations?**
Yes. KuentaPOS runs on one computer and the other workstations connect through the network.
The license applies to this one installation with all companies.

**Why is the Pro code visible in the repository?**
So you can see what it does. It is not under the AGPL, however, but under the
[KuentaPOS Pro license](server/pro/LICENSE.en.md) (English translation; the [German original](server/pro/LICENSE.md) is binding): it may only be run with a valid key.
