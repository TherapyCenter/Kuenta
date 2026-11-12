# KuentaPOS SMS relay (USB modem with SIM card)

**English** · [Deutsch](README.de.md)

The relay runs on a separate computer (e.g. an old PC, mini PC or Raspberry Pi) with a USB modem stick and SIM card plugged in. KuentaPOS sends the reminder SMS over the network to the relay, and the relay sends them via the stick.

```
KuentaPOS  ──(network, POST /sms)──►  relay computer  ──(gammu)──►  USB modem + SIM  ──►  customer
```

## What you need

- **A USB modem that can send SMS via AT commands.** Suitable are sticks that register as a modem (serial interface). Sticks that only appear as a network card (e.g. Huawei "HiLink" such as the E3372h) must first be switched to modem mode or are unsuitable.
- **A SIM card with an SMS plan** and the PIN switched off (or the PIN in the gammu configuration).
- **Node.js 18 or later** and **gammu** on the relay computer.

> **UMTS has been switched off in Germany** (all network operators since 2021/2022). A pure UMTS stick then only sends SMS over the old GSM network (2G) as long as it is still operated. Better use an **LTE stick with modem mode**. The network connection is fully sufficient for SMS, even without a data plan.

## Setup on Linux (Debian, Ubuntu, Raspberry Pi OS)

```sh
sudo apt install gammu nodejs
ls /dev/ttyUSB*            # interfaces of the stick, usually ttyUSB0 to ttyUSB2
gammu-detect               # shows the modems found
```

Create the file `~/.gammurc` (adjust the interface):

```ini
[gammu]
device = /dev/ttyUSB0
connection = at
```

Test:

```sh
gammu identify                                   # is the stick recognised?
gammu sendsms TEXT +4917012345678 -text "Test"   # test SMS to your phone
```

If that works, start the relay (choose any token, a long random word):

```sh
KUENTAPOS_SMS_TOKEN=YourSecretToken node kuentapos-sms-relais.js
```

### As a background service

```ini
# /etc/systemd/system/kuentapos-sms-relais.service
[Unit]
Description=KuentaPOS SMS relay
After=network-online.target

[Service]
User=pi
Environment=KUENTAPOS_SMS_TOKEN=YourSecretToken
ExecStart=/usr/bin/node /opt/kuentapos-sms-relais/kuentapos-sms-relais.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now kuentapos-sms-relais
```

The user needs access to the stick: `sudo usermod -aG dialout pi`.

## Setup on Windows

1. Install gammu for Windows and add the folder containing `gammu.exe` to the `PATH`.
2. In Device Manager under "Ports (COM & LPT)", read the modem port of the stick, e.g. `COM5`.
3. Create a `gammurc`, e.g. `C:\kuentapos-sms\gammurc`:
   ```ini
   [gammu]
   device = COM5:
   connection = at
   ```
4. Test: `gammu -c C:\kuentapos-sms\gammurc identify`
5. Start (PowerShell):
   ```powershell
   $env:KUENTAPOS_SMS_TOKEN = "YourSecretToken"
   $env:KUENTAPOS_SMS_GAMMURC = "C:\kuentapos-sms\gammurc"
   node kuentapos-sms-relais.js
   ```
6. Allow port 3790 for the private network in the Windows firewall.

## Entering it in KuentaPOS

Insert and adjust the template *Settings → Reminders & SMS → SMS gateway → template "KuentaPOS SMS relay"*:

| Field | Value |
|---|---|
| Address (URL) | `http://<relay computer>:3790/sms`, e.g. `http://192.168.1.50:3790/sms` |
| Headers | `X-Token: YourSecretToken` |
| Body | `{"nummer":"{nummer}","text":"{text}"}` |

Then "Save settings & send test SMS".

## Relay settings

| Variable | Default | Meaning |
|---|---|---|
| `KUENTAPOS_SMS_TOKEN` | – (required) | must match the header `X-Token` in KuentaPOS |
| `PORT` | `3790` | port of the relay |
| `HOST` | `0.0.0.0` | network interface; `127.0.0.1` if KuentaPOS runs on the same computer |
| `KUENTAPOS_SMS_BEFEHL` | `gammu` | with a running `gammu-smsd` use `gammu-smsd-inject` instead |
| `KUENTAPOS_SMS_GAMMURC` | – | path to the gammu configuration |

## Notes

- The relay sends one SMS after the other. 50 reminders take a few minutes.
- Texts with characters outside the SMS default character set (e.g. emojis) are sent as Unicode SMS with only 70 characters per part. German umlauts and ß belong to the default character set; many Spanish accented letters (e.g. á, ó, ú) do not and turn the message into Unicode.
- Only run the relay in your own network; do not make it reachable from the internet.
- Check whether your plan allows sending many SMS. Some private plans forbid bulk sending.
