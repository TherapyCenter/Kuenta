# KuentaPOS-SMS-Relais (Surfstick mit SIM-Karte)

[English](README.md) · **Deutsch**

Das Relais läuft auf einem eigenen Rechner (z. B. altem PC, Mini-PC oder Raspberry Pi), an dem ein USB-Surfstick mit SIM-Karte steckt. KuentaPOS schickt die Erinnerungs-SMS über das Netzwerk an das Relais, das Relais verschickt sie über den Stick.

```
KuentaPOS  ──(Netzwerk, POST /sms)──►  Relais-Rechner  ──(gammu)──►  Surfstick + SIM  ──►  Kunde
```

## Was Sie brauchen

- **Surfstick, der SMS über AT-Befehle versenden kann.** Geeignet sind Sticks, die sich als Modem (serielle Schnittstelle) anmelden. Sticks, die nur als Netzwerkkarte erscheinen (z. B. Huawei „HiLink“ wie E3372h), müssen erst in den Modem-Modus umgestellt werden oder sind ungeeignet.
- **SIM-Karte mit SMS-Tarif** und abgeschalteter PIN (oder PIN in der gammu-Konfiguration).
- **Node.js ab Version 18** und **gammu** auf dem Relais-Rechner.

> **UMTS ist in Deutschland abgeschaltet** (alle Netzbetreiber seit 2021/2022). Ein reiner UMTS-Stick verschickt SMS dann nur noch über das alte GSM-Netz (2G), solange es noch betrieben wird. Besser ist ein **LTE-Stick mit Modem-Modus**. Für SMS reicht die Netzanbindung völlig, auch ohne Datenvolumen.

## Einrichtung unter Linux (Debian, Ubuntu, Raspberry Pi OS)

```sh
sudo apt install gammu nodejs
ls /dev/ttyUSB*            # Schnittstellen des Sticks, meist ttyUSB0 bis ttyUSB2
gammu-detect               # zeigt gefundene Modems
```

Datei `~/.gammurc` anlegen (Schnittstelle anpassen):

```ini
[gammu]
device = /dev/ttyUSB0
connection = at
```

Testen:

```sh
gammu identify                                   # Stick wird erkannt?
gammu sendsms TEXT +4917012345678 -text "Test"   # Test-SMS an Ihr Handy
```

Funktioniert das, das Relais starten (Token frei wählen, langes Zufallswort):

```sh
KUENTAPOS_SMS_TOKEN=IhrGeheimesToken node kuentapos-sms-relais.js
```

### Als Dienst im Hintergrund

```ini
# /etc/systemd/system/kuentapos-sms-relais.service
[Unit]
Description=KuentaPOS-SMS-Relais
After=network-online.target

[Service]
User=pi
Environment=KUENTAPOS_SMS_TOKEN=IhrGeheimesToken
ExecStart=/usr/bin/node /opt/kuentapos-sms-relais/kuentapos-sms-relais.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now kuentapos-sms-relais
```

Der Benutzer braucht Zugriff auf den Stick: `sudo usermod -aG dialout pi`.

## Einrichtung unter Windows

1. gammu für Windows installieren und den Ordner mit `gammu.exe` zum `PATH` hinzufügen.
2. Im Geräte-Manager unter „Anschlüsse (COM & LPT)“ den Modem-Anschluss des Sticks ablesen, z. B. `COM5`.
3. `gammurc` anlegen, z. B. `C:\kuentapos-sms\gammurc`:
   ```ini
   [gammu]
   device = COM5:
   connection = at
   ```
4. Testen: `gammu -c C:\kuentapos-sms\gammurc identify`
5. Starten (PowerShell):
   ```powershell
   $env:KUENTAPOS_SMS_TOKEN = "IhrGeheimesToken"
   $env:KUENTAPOS_SMS_GAMMURC = "C:\kuentapos-sms\gammurc"
   node kuentapos-sms-relais.js
   ```
6. In der Windows-Firewall Port 3790 für das private Netzwerk freigeben.

## In KuentaPOS eintragen

*Einstellungen → Erinnerungen & SMS → SMS-Gateway → Vorlage „KuentaPOS-SMS-Relais“* einsetzen und anpassen:

| Feld | Wert |
|---|---|
| Adresse (URL) | `http://<Relais-Rechner>:3790/sms`, z. B. `http://192.168.1.50:3790/sms` |
| Kopfzeilen | `X-Token: IhrGeheimesToken` |
| Inhalt | `{"nummer":"{nummer}","text":"{text}"}` |

Dann „Einstellungen speichern & Test-SMS senden“.

## Einstellungen des Relais

| Variable | Standard | Bedeutung |
|---|---|---|
| `KUENTAPOS_SMS_TOKEN` | – (Pflicht) | Muss mit der Kopfzeile `X-Token` in KuentaPOS übereinstimmen |
| `PORT` | `3790` | Port des Relais |
| `HOST` | `0.0.0.0` | Netzwerkkarte; `127.0.0.1`, wenn KuentaPOS auf demselben Rechner läuft |
| `KUENTAPOS_SMS_BEFEHL` | `gammu` | Mit laufendem `gammu-smsd` stattdessen `gammu-smsd-inject` |
| `KUENTAPOS_SMS_GAMMURC` | – | Pfad zur gammu-Konfiguration |

## Hinweise

- Das Relais sendet eine SMS nach der anderen. 50 Erinnerungen dauern einige Minuten.
- Texte mit Zeichen außerhalb des SMS-Standardzeichensatzes (z. B. Emojis) werden als Unicode-SMS mit nur 70 Zeichen je Teil verschickt. Deutsche Umlaute und ß gehören zum Standardzeichensatz.
- Das Relais nur im eigenen Netzwerk betreiben, nicht aus dem Internet erreichbar machen.
- Prüfen Sie beim Tarif, ob der Versand vieler SMS erlaubt ist. Manche Privattarife verbieten Massenversand.
