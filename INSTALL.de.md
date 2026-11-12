# KuentaPOS installieren

[English](INSTALL.md) · **Deutsch**

KuentaPOS ist eine Webanwendung: Ein kleiner Server läuft auf dem Werkstatt-PC, bedient wird im Browser (auch von Tablets und weiteren Arbeitsplätzen im Netzwerk). Nach der Installation ist der Datenbestand **leer** – eigene Firmendaten tragen Sie unter *Einstellungen* ein, vorhandene Daten holen Sie per Import herein (siehe [Daten übernehmen](#daten-übernehmen)).

**Wo liegen die Daten?** Nie im Programmordner, sondern im Benutzerprofil. Updates lassen sie unangetastet; bei der Deinstallation entscheiden Sie, ob sie erhalten bleiben.

| System | Datenordner |
|---|---|
| Windows | `%APPDATA%\KuentaPOS` (z. B. `C:\Users\<Name>\AppData\Roaming\KuentaPOS`) |
| macOS | `~/Library/Application Support/KuentaPOS` |
| Linux | `~/.local/share/kuentapos` (bzw. `$XDG_DATA_HOME/kuentapos`) |

Mit der Umgebungsvariablen `KUENTAPOS_DATA` lässt sich ein anderer Ordner festlegen, z. B. eine zweite Festplatte im selben Rechner.

> **Datenordner nie auf ein Netzlaufwerk oder NAS legen.** KuentaPOS arbeitet ständig in seiner Datenbank. Über eine Netzwerkfreigabe (SMB/NFS) kann sie dabei beschädigt werden, z. B. bei einer kurzen Netzwerkstörung. KuentaPOS zeigt beim Start eine Warnung, wenn der Datenordner auf einem Netzlaufwerk liegt. Für mehrere Arbeitsplätze ist der Netzwerkbetrieb gedacht (ein Rechner hält die Daten, die anderen arbeiten im Browser). **Sicherungen** dürfen und sollten dagegen auf ein NAS oder einen anderen Datenträger: *KuentaPOS → Daten sichern* → Sicherungsordner.

---

## Windows

1. `KuentaPOS-Setup-<Version>.exe` ausführen.
   - *Für alle Benutzer installieren* (Standard, braucht Administratorrechte) → `C:\Programme\KuentaPOS`
   - *Nur für mich installieren* → ohne Administratorrechte, im Benutzerprofil
2. Optional im Assistenten: Desktop-Verknüpfung, Firewall-Freigabe für den Netzwerkbetrieb.
3. Start über das Startmenü: **KuentaPOS**. Es öffnet sich ein Konsolenfenster (bitte geöffnet lassen – Schließen beendet KuentaPOS) und der Browser mit `http://127.0.0.1:3700`.

Node.js ist im Installer enthalten; es muss nichts weiter installiert werden. Unterstützt wird Windows 10/11 (64 Bit).

**Netzwerkbetrieb:** Startmenü → *KuentaPOS im Netzwerk*. Das Konsolenfenster zeigt die Adresse für die anderen Geräte (`http://<IP>:3700`). Windows fragt beim ersten Start ggf. nach einer Firewall-Freigabe – für „Private Netzwerke“ zulassen. Danach unter *Einstellungen → Vorgabewerte* die Anmeldung aktivieren und Benutzer anlegen.

**Update:** Einfach den neuen Installer ausführen. Ein laufendes KuentaPOS wird vorher automatisch beendet (Datenbank wird sauber geschlossen) und nach dem Update wieder gestartet – im selben Modus wie vorher (lokal bzw. im Netzwerk). Die Daten bleiben unverändert.

**Ausrollen ohne Rückfragen** (z. B. per Skript oder Softwareverteilung):

```
KuentaPOS-Setup-<Version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

- `/CURRENTUSER` bzw. `/ALLUSERS` legt fest, ob nur für den Benutzer oder für alle installiert wird (Standard: wie bei der ersten Installation).
- `/NOSTART` – KuentaPOS nach dem Update nicht wieder starten.
- `/LOG="C:\Temp\kuentapos-setup.log"` – Protokoll schreiben.
- Läuft die Installation unter dem Systemkonto (Softwareverteilung), wird KuentaPOS zwar beendet, aber nicht wieder gestartet (es liefe sonst im falschen Benutzerprofil). Die Benutzer starten es dann wie gewohnt über das Startmenü.

**Deinstallation:** *Einstellungen → Apps* → KuentaPOS, oder den Installer erneut starten und „KuentaPOS deinstallieren“ wählen. Ein laufendes KuentaPOS wird vorher beendet. Danach fragt KuentaPOS, ob auch die Daten gelöscht werden sollen; vorher kann eine Kopie als ZIP auf dem Desktop gespeichert werden. Still: `unins000.exe /VERYSILENT` behält die Daten, `/DELETEDATA` löscht sie nach einer Kopie (`/NOBACKUP`: ohne Kopie).

### Installer selbst bauen

Voraussetzungen: Windows, [Inno Setup 6](https://jrsoftware.org/isdl.php), Internetzugang (Node.js wird von nodejs.org geladen und per SHA-256 geprüft).

```powershell
npm run installer:windows
# oder: powershell -ExecutionPolicy Bypass -File installer\windows\build.ps1 [-NodeVersion 24.21.0]
```

Ergebnis: `build\KuentaPOS-Setup-<Version>.exe` (Version aus `package.json`).

---

## Linux

### 1. Node.js installieren (ab Version 22.13)

Prüfen: `node -v` – zeigt es `v22.13` oder neuer, weiter mit Schritt 2.

| Distribution | Befehl |
|---|---|
| Debian / Ubuntu / Mint | Paketquellen sind meist zu alt. Über NodeSource: `curl -fsSL https://deb.nodesource.com/setup_24.x \| sudo -E bash -` und danach `sudo apt install -y nodejs` |
| Fedora (ab 41) | `sudo dnf install nodejs` (sonst NodeSource: `https://rpm.nodesource.com/setup_24.x`) |
| openSUSE | `sudo zypper install nodejs24` |
| Arch / Manjaro | `sudo pacman -S nodejs` |
| alle (ohne root) | [nvm](https://github.com/nvm-sh/nvm): `nvm install 24` |

### 2. KuentaPOS herunterladen und installieren

```sh
git clone <Repository-URL> kuentapos     # oder Archiv herunterladen und entpacken
cd kuentapos
./installer/unix/install.sh
```

Das Skript installiert ohne root für den aktuellen Benutzer:

- Programm nach `~/.local/lib/kuentapos` (anderer Ort: `PREFIX=/opt/kuentapos ./installer/unix/install.sh`)
- Startbefehl `~/.local/bin/kuentapos`
- Eintrag im Anwendungsmenü („KuentaPOS“)

### 3. Starten

Über das Anwendungsmenü oder im Terminal:

```sh
kuentapos              # nur dieser Rechner
kuentapos --netzwerk   # für Tablets / weitere Arbeitsplätze freigeben
```

Beenden mit `Strg+C` bzw. durch Schließen des Terminalfensters. Ohne Installation geht es auch direkt aus dem entpackten Ordner: `./kuentapos.sh`.

**Update:** neue Version herunterladen (`git pull`) und `./installer/unix/install.sh` erneut ausführen.
**Deinstallation:** `./installer/unix/install.sh --uninstall` – fragt im Terminal, ob auch die Daten gelöscht werden (vorher Kopie als `.tar.gz` im Home-Ordner); ohne Terminal bleiben sie erhalten. `--delete-data` löscht ohne Rückfrage nach einer Kopie, `--no-backup` ohne Kopie.

### Optional: als Dienst im Hintergrund (Server ohne Bildschirm)

```sh
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/kuentapos.service <<'EOF'
[Unit]
Description=KuentaPOS

[Service]
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/env node %h/.local/lib/kuentapos/server/index.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now kuentapos
loginctl enable-linger "$USER"   # Dienst auch ohne angemeldeten Benutzer laufen lassen
```

Bei aktiver Firewall Port 3700/TCP freigeben (z. B. `sudo ufw allow 3700/tcp`). Im Netzwerkbetrieb unbedingt die Anmeldung aktivieren.

---

## macOS

### 1. Node.js installieren (ab Version 22.13)

- Installationspaket von [nodejs.org](https://nodejs.org/de) (LTS) herunterladen und installieren, **oder**
- mit Homebrew: `brew install node@24` (Hinweise von Homebrew zum `PATH` beachten)

Prüfen im Terminal: `node -v`

### 2. KuentaPOS installieren

Im Terminal (Programme → Dienstprogramme → Terminal):

```sh
git clone <Repository-URL> kuentapos     # oder Archiv herunterladen und im Finder entpacken
cd kuentapos
./installer/unix/install.sh
```

Das Skript legt das Programm unter `~/.local/lib/kuentapos` ab, den Startbefehl `kuentapos` und die App **KuentaPOS** im Ordner *Programme* des Benutzers (`~/Applications`).

### 3. Starten

Doppelklick auf *KuentaPOS* in `~/Applications` (öffnet ein Terminalfenster und den Browser) oder im Terminal `kuentapos`. Netzwerkbetrieb: `kuentapos --netzwerk`; macOS fragt beim ersten Mal, ob „node“ eingehende Verbindungen annehmen darf – zulassen.

Beim ersten Öffnen der App kann macOS eine Sicherheitswarnung zeigen (nicht signierte App). Dann im Finder Rechtsklick → *Öffnen* oder unter *Systemeinstellungen → Datenschutz & Sicherheit* „Trotzdem öffnen“ wählen.

**Update:** neue Version herunterladen und `./installer/unix/install.sh` erneut ausführen.
**Deinstallation:** `./installer/unix/install.sh --uninstall` – fragt im Terminal, ob auch die Daten gelöscht werden (vorher Kopie als `.tar.gz` im Home-Ordner); ohne Terminal bleiben sie erhalten. `--delete-data` löscht ohne Rückfrage nach einer Kopie, `--no-backup` ohne Kopie.

---

## Container (Docker / Podman)

Für Linux-Server, NAS-Systeme mit Container-Unterstützung, Raspberry Pi oder Macs: KuentaPOS läuft auch als Container. Das Image enthält Node.js, es muss sonst nichts installiert werden. Es läuft auf x86_64 und ARM64 (z. B. Mac mit Apple-Chip, Raspberry Pi 4/5).

### Bauen und starten

Im KuentaPOS-Ordner (dort liegt das `Dockerfile`):

```sh
# Podman
podman build -t kuentapos:1.8.3 .
podman run -d --name kuentapos --restart unless-stopped -p 3700:3700 -v kuentapos-daten:/data kuentapos:1.8.3

# Docker
docker build -t kuentapos:1.8.3 .
docker run -d --name kuentapos --restart unless-stopped -p 3700:3700 -v kuentapos-daten:/data kuentapos:1.8.3
```

Oder mit Compose (Datei `compose.yaml` liegt bei):

```sh
docker compose up -d --build      # bzw. podman compose up -d --build
```

Danach im Browser `http://<Rechner>:3700` öffnen.

> **Sofort die Anmeldung einschalten.** Im Container ist KuentaPOS im ganzen Netzwerk erreichbar. Unter *Einstellungen → Vorgabewerte* die Anmeldung aktivieren und Benutzer anlegen. Soll KuentaPOS nur auf diesem Rechner erreichbar sein: `-p 127.0.0.1:3700:3700`.

### Daten

- Alle Daten liegen im Volume `kuentapos-daten` (im Container `/data`). Beim Löschen oder Neubauen des Containers bleiben sie erhalten.
- Ein eigener Ordner statt Volume geht auch: `-v /srv/kuentapos:/data`. Der Ordner muss dem Benutzer mit der UID 1000 gehören (`sudo chown 1000:1000 /srv/kuentapos`). Bei Podman ohne root stattdessen `-v /srv/kuentapos:/data:Z,U`.
- Auf Fedora, RHEL und anderen Systemen mit SELinux braucht ein eigener Ordner den Zusatz `:Z`.
- **Sicherungen** gehören auf ein anderes Laufwerk oder NAS: z. B. `-v /mnt/nas/kuentapos-sicherungen:/sicherungen` und in KuentaPOS unter *Daten sichern* den Sicherungsordner `/sicherungen` eintragen. Den Datenordner selbst nicht auf ein Netzlaufwerk legen.

### Einstellungen

| Variable | Standard | Bedeutung |
|---|---|---|
| `TZ` | `Europe/Berlin` | Zeitzone für Rechnungsdatum und Uhrzeit, z. B. `-e TZ=Europe/Vienna` |
| `PORT` | `3700` | Port im Container (Zuordnung nach außen über `-p`) |

### Bedienung

```sh
podman logs -f kuentapos        # Ausgabe ansehen (docker logs -f kuentapos)
podman stop kuentapos           # beenden – die Datenbank wird sauber geschlossen
podman start kuentapos          # wieder starten
```

**Update:** neue Version holen, Image neu bauen und den Container neu anlegen. Die Daten im Volume bleiben erhalten:

```sh
podman build -t kuentapos:1.8.3 .
podman rm -f kuentapos
podman run -d --name kuentapos --restart unless-stopped -p 3700:3700 -v kuentapos-daten:/data kuentapos:1.8.3
```

Mit Compose: `docker compose up -d --build`.

**Umstieg von „Kuenta“ (bis Version 1.8.2):** Das Volume hieß damals `kuenta-daten`. Bei einer bestehenden Installation beim Update weiter `-v kuenta-daten:/data` angeben (bzw. `Volume=kuenta-daten:/data`), sonst startet KuentaPOS mit leerem Datenbestand. Die alte Container-Instanz entfernen Sie mit `podman rm -f kuenta`. `compose.yaml` verwendet das alte Volume weiter.

**Automatisch starten mit Podman (systemd, ab Podman 4.4):** Datei `~/.config/containers/systemd/kuentapos.container` anlegen:

```ini
[Container]
Image=localhost/kuentapos:1.8.3
ContainerName=kuentapos
PublishPort=3700:3700
Volume=kuentapos-daten:/data

[Service]
Restart=always
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

Dann `systemctl --user daemon-reload` und `systemctl --user start kuentapos`. Damit KuentaPOS auch ohne angemeldeten Benutzer läuft: `loginctl enable-linger "$USER"`. Bei Docker reicht `--restart unless-stopped`.

### Unterschiede zur normalen Installation

- **E-Mail:** Im Container gibt es kein Mailprogramm. Bitte unter *Einstellungen → E-Mail* den direkten Versand (SMTP) wählen. Die Übergabe an Thunderbird geht nur bei einer normalen Installation.
- **Import aus KFZ-Faktura:** Den direkten Import aus dem Programmordner gibt es nur unter Windows. Im Container die Datensicherung (`*.kfz`) oder `DB1.bak` hochladen.
- Es öffnet sich kein Browserfenster. Die Adresse rufen Sie selbst auf.

---

## Umbrel

KuentaPOS gibt es als App für [umbrelOS](https://umbrel.com) (Umbrel Home, Raspberry Pi, PC) im Community-App-Store
`https://github.com/TherapyCenter/umbrel-app-store`.

1. In umbrelOS den **App Store** öffnen, oben rechts **⋯** → **Community App Stores**.
2. `https://github.com/TherapyCenter/umbrel-app-store` einfügen und **Add** klicken.
3. Den Store **TherapyCenter** öffnen und **KuentaPOS** installieren.

KuentaPOS läuft danach unter `http://umbrel.local:3700` und ist von jedem Gerät im Netzwerk erreichbar, z. B. vom Tablet in
der Werkstatt. Der Zugang ist durch die Umbrel-Anmeldung geschützt; wer mehrere Mitarbeiter hat, legt zusätzlich in KuentaPOS
unter *Einstellungen → Vorgabewerte* Benutzer an. Die Daten liegen auf dem Umbrel im Datenordner der App und bleiben bei
Updates erhalten. Zusätzlich in KuentaPOS unter *KuentaPOS → Daten sichern* eine Sicherung anlegen und extern aufbewahren.
Updates bietet umbrelOS an, sobald eine neue KuentaPOS-Version im Store steht.

## Daten übernehmen

Nach dem ersten Start ist KuentaPOS leer. Auf der Übersicht stehen Schaltflächen für die Einrichtung bereit:

| Quelle | Weg in KuentaPOS |
|---|---|
| eigene Firmendaten von Hand | *Einstellungen* → Firmendaten (Name, Anschrift, Bank, Steuernummer, Logo) |
| KFZ-Faktura (`*.kfz`, `DB1.bak`, Programmordner) | *KuentaPOS → Daten aus KFZ-Faktura importieren* |
| KuentaPOS-Sicherung (`*.kuentapos`) oder ältere KFZ-Faktotum-/Schraubwerk-Sicherung (`*.kft`, `*.swb`) | *KuentaPOS → Daten wiederherstellen* |
| Kunden, Fahrzeuge, Artikel … aus anderen Programmen (CSV, DATANORM) | *KuentaPOS → Datenimport* |

Umzug auf einen anderen Rechner: auf dem alten Rechner *Daten sichern* (`*.kuentapos`), auf dem neuen *Daten wiederherstellen*.
