# Kuenta installieren

[English](INSTALL.md) · **Deutsch**

Kuenta ist eine Webanwendung: Ein kleiner Server läuft auf dem Werkstatt-PC, bedient wird im Browser (auch von Tablets und weiteren Arbeitsplätzen im Netzwerk). Nach der Installation ist der Datenbestand **leer** – eigene Firmendaten tragen Sie unter *Einstellungen* ein, vorhandene Daten holen Sie per Import herein (siehe [Daten übernehmen](#daten-übernehmen)).

**Wo liegen die Daten?** Nie im Programmordner, sondern im Benutzerprofil. Updates und Deinstallation lassen sie unangetastet.

| System | Datenordner |
|---|---|
| Windows | `%APPDATA%\Kuenta` (z. B. `C:\Users\<Name>\AppData\Roaming\Kuenta`) |
| macOS | `~/Library/Application Support/Kuenta` |
| Linux | `~/.local/share/kuenta` (bzw. `$XDG_DATA_HOME/kuenta`) |

Mit der Umgebungsvariablen `KUENTA_DATA` lässt sich ein anderer Ordner festlegen, z. B. eine zweite Festplatte im selben Rechner.

> **Datenordner nie auf ein Netzlaufwerk oder NAS legen.** Kuenta arbeitet ständig in seiner Datenbank. Über eine Netzwerkfreigabe (SMB/NFS) kann sie dabei beschädigt werden, z. B. bei einer kurzen Netzwerkstörung. Kuenta zeigt beim Start eine Warnung, wenn der Datenordner auf einem Netzlaufwerk liegt. Für mehrere Arbeitsplätze ist der Netzwerkbetrieb gedacht (ein Rechner hält die Daten, die anderen arbeiten im Browser). **Sicherungen** dürfen und sollten dagegen auf ein NAS oder einen anderen Datenträger: *Kuenta → Daten sichern* → Sicherungsordner.

---

## Windows

1. `Kuenta-Setup-<Version>.exe` ausführen.
   - *Für alle Benutzer installieren* (Standard, braucht Administratorrechte) → `C:\Programme\Kuenta`
   - *Nur für mich installieren* → ohne Administratorrechte, im Benutzerprofil
2. Optional im Assistenten: Desktop-Verknüpfung, Firewall-Freigabe für den Netzwerkbetrieb.
3. Start über das Startmenü: **Kuenta**. Es öffnet sich ein Konsolenfenster (bitte geöffnet lassen – Schließen beendet Kuenta) und der Browser mit `http://127.0.0.1:3700`.

Node.js ist im Installer enthalten; es muss nichts weiter installiert werden. Unterstützt wird Windows 10/11 (64 Bit).

**Netzwerkbetrieb:** Startmenü → *Kuenta im Netzwerk*. Das Konsolenfenster zeigt die Adresse für die anderen Geräte (`http://<IP>:3700`). Windows fragt beim ersten Start ggf. nach einer Firewall-Freigabe – für „Private Netzwerke“ zulassen. Danach unter *Einstellungen → Vorgabewerte* die Anmeldung aktivieren und Benutzer anlegen.

**Update:** Einfach den neuen Installer ausführen. Ein laufendes Kuenta wird vorher automatisch beendet (Datenbank wird sauber geschlossen) und nach dem Update wieder gestartet – im selben Modus wie vorher (lokal bzw. im Netzwerk). Die Daten bleiben unverändert.

**Ausrollen ohne Rückfragen** (z. B. per Skript oder Softwareverteilung):

```
Kuenta-Setup-<Version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

- `/CURRENTUSER` bzw. `/ALLUSERS` legt fest, ob nur für den Benutzer oder für alle installiert wird (Standard: wie bei der ersten Installation).
- `/NOSTART` – Kuenta nach dem Update nicht wieder starten.
- `/LOG="C:\Temp\kuenta-setup.log"` – Protokoll schreiben.
- Läuft die Installation unter dem Systemkonto (Softwareverteilung), wird Kuenta zwar beendet, aber nicht wieder gestartet (es liefe sonst im falschen Benutzerprofil). Die Benutzer starten es dann wie gewohnt über das Startmenü.

**Deinstallation:** *Einstellungen → Apps* → Kuenta. Ein laufendes Kuenta wird vorher beendet. Der Datenordner bleibt erhalten und kann bei Bedarf von Hand gelöscht werden.

### Installer selbst bauen

Voraussetzungen: Windows, [Inno Setup 6](https://jrsoftware.org/isdl.php), Internetzugang (Node.js wird von nodejs.org geladen und per SHA-256 geprüft).

```powershell
npm run installer:windows
# oder: powershell -ExecutionPolicy Bypass -File installer\windows\build.ps1 [-NodeVersion 24.21.0]
```

Ergebnis: `build\Kuenta-Setup-<Version>.exe` (Version aus `package.json`).

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

### 2. Kuenta herunterladen und installieren

```sh
git clone <Repository-URL> kuenta     # oder Archiv herunterladen und entpacken
cd kuenta
./installer/unix/install.sh
```

Das Skript installiert ohne root für den aktuellen Benutzer:

- Programm nach `~/.local/lib/kuenta` (anderer Ort: `PREFIX=/opt/kuenta ./installer/unix/install.sh`)
- Startbefehl `~/.local/bin/kuenta`
- Eintrag im Anwendungsmenü („Kuenta“)

### 3. Starten

Über das Anwendungsmenü oder im Terminal:

```sh
kuenta              # nur dieser Rechner
kuenta --netzwerk   # für Tablets / weitere Arbeitsplätze freigeben
```

Beenden mit `Strg+C` bzw. durch Schließen des Terminalfensters. Ohne Installation geht es auch direkt aus dem entpackten Ordner: `./kuenta.sh`.

**Update:** neue Version herunterladen (`git pull`) und `./installer/unix/install.sh` erneut ausführen.
**Deinstallation:** `./installer/unix/install.sh --uninstall` (Daten bleiben erhalten).

### Optional: als Dienst im Hintergrund (Server ohne Bildschirm)

```sh
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/kuenta.service <<'EOF'
[Unit]
Description=Kuenta

[Service]
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/env node %h/.local/lib/kuenta/server/index.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now kuenta
loginctl enable-linger "$USER"   # Dienst auch ohne angemeldeten Benutzer laufen lassen
```

Bei aktiver Firewall Port 3700/TCP freigeben (z. B. `sudo ufw allow 3700/tcp`). Im Netzwerkbetrieb unbedingt die Anmeldung aktivieren.

---

## macOS

### 1. Node.js installieren (ab Version 22.13)

- Installationspaket von [nodejs.org](https://nodejs.org/de) (LTS) herunterladen und installieren, **oder**
- mit Homebrew: `brew install node@24` (Hinweise von Homebrew zum `PATH` beachten)

Prüfen im Terminal: `node -v`

### 2. Kuenta installieren

Im Terminal (Programme → Dienstprogramme → Terminal):

```sh
git clone <Repository-URL> kuenta     # oder Archiv herunterladen und im Finder entpacken
cd kuenta
./installer/unix/install.sh
```

Das Skript legt das Programm unter `~/.local/lib/kuenta` ab, den Startbefehl `kuenta` und die App **Kuenta** im Ordner *Programme* des Benutzers (`~/Applications`).

### 3. Starten

Doppelklick auf *Kuenta* in `~/Applications` (öffnet ein Terminalfenster und den Browser) oder im Terminal `kuenta`. Netzwerkbetrieb: `kuenta --netzwerk`; macOS fragt beim ersten Mal, ob „node“ eingehende Verbindungen annehmen darf – zulassen.

Beim ersten Öffnen der App kann macOS eine Sicherheitswarnung zeigen (nicht signierte App). Dann im Finder Rechtsklick → *Öffnen* oder unter *Systemeinstellungen → Datenschutz & Sicherheit* „Trotzdem öffnen“ wählen.

**Update:** neue Version herunterladen und `./installer/unix/install.sh` erneut ausführen.
**Deinstallation:** `./installer/unix/install.sh --uninstall` (Daten bleiben erhalten).

---

## Container (Docker / Podman)

Für Linux-Server, NAS-Systeme mit Container-Unterstützung, Raspberry Pi oder Macs: Kuenta läuft auch als Container. Das Image enthält Node.js, es muss sonst nichts installiert werden. Es läuft auf x86_64 und ARM64 (z. B. Mac mit Apple-Chip, Raspberry Pi 4/5).

### Bauen und starten

Im Kuenta-Ordner (dort liegt das `Dockerfile`):

```sh
# Podman
podman build -t kuenta:1.4.1 .
podman run -d --name kuenta --restart unless-stopped -p 3700:3700 -v kuenta-daten:/data kuenta:1.4.1

# Docker
docker build -t kuenta:1.4.1 .
docker run -d --name kuenta --restart unless-stopped -p 3700:3700 -v kuenta-daten:/data kuenta:1.4.1
```

Oder mit Compose (Datei `compose.yaml` liegt bei):

```sh
docker compose up -d --build      # bzw. podman compose up -d --build
```

Danach im Browser `http://<Rechner>:3700` öffnen.

> **Sofort die Anmeldung einschalten.** Im Container ist Kuenta im ganzen Netzwerk erreichbar. Unter *Einstellungen → Vorgabewerte* die Anmeldung aktivieren und Benutzer anlegen. Soll Kuenta nur auf diesem Rechner erreichbar sein: `-p 127.0.0.1:3700:3700`.

### Daten

- Alle Daten liegen im Volume `kuenta-daten` (im Container `/data`). Beim Löschen oder Neubauen des Containers bleiben sie erhalten.
- Ein eigener Ordner statt Volume geht auch: `-v /srv/kuenta:/data`. Der Ordner muss dem Benutzer mit der UID 1000 gehören (`sudo chown 1000:1000 /srv/kuenta`). Bei Podman ohne root stattdessen `-v /srv/kuenta:/data:Z,U`.
- Auf Fedora, RHEL und anderen Systemen mit SELinux braucht ein eigener Ordner den Zusatz `:Z`.
- **Sicherungen** gehören auf ein anderes Laufwerk oder NAS: z. B. `-v /mnt/nas/kuenta-sicherungen:/sicherungen` und in Kuenta unter *Daten sichern* den Sicherungsordner `/sicherungen` eintragen. Den Datenordner selbst nicht auf ein Netzlaufwerk legen.

### Einstellungen

| Variable | Standard | Bedeutung |
|---|---|---|
| `TZ` | `Europe/Berlin` | Zeitzone für Rechnungsdatum und Uhrzeit, z. B. `-e TZ=Europe/Vienna` |
| `PORT` | `3700` | Port im Container (Zuordnung nach außen über `-p`) |

### Bedienung

```sh
podman logs -f kuenta        # Ausgabe ansehen (docker logs -f kuenta)
podman stop kuenta           # beenden – die Datenbank wird sauber geschlossen
podman start kuenta          # wieder starten
```

**Update:** neue Version holen, Image neu bauen und den Container neu anlegen. Die Daten im Volume bleiben erhalten:

```sh
podman build -t kuenta:1.4.1 .
podman rm -f kuenta
podman run -d --name kuenta --restart unless-stopped -p 3700:3700 -v kuenta-daten:/data kuenta:1.4.1
```

Mit Compose: `docker compose up -d --build`.

**Automatisch starten mit Podman (systemd, ab Podman 4.4):** Datei `~/.config/containers/systemd/kuenta.container` anlegen:

```ini
[Container]
Image=localhost/kuenta:1.4.1
ContainerName=kuenta
PublishPort=3700:3700
Volume=kuenta-daten:/data

[Service]
Restart=always
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

Dann `systemctl --user daemon-reload` und `systemctl --user start kuenta`. Damit Kuenta auch ohne angemeldeten Benutzer läuft: `loginctl enable-linger "$USER"`. Bei Docker reicht `--restart unless-stopped`.

### Unterschiede zur normalen Installation

- **E-Mail:** Im Container gibt es kein Mailprogramm. Bitte unter *Einstellungen → E-Mail* den direkten Versand (SMTP) wählen. Die Übergabe an Thunderbird geht nur bei einer normalen Installation.
- **Import aus KFZ-Faktura:** Den direkten Import aus dem Programmordner gibt es nur unter Windows. Im Container die Datensicherung (`*.kfz`) oder `DB1.bak` hochladen.
- Es öffnet sich kein Browserfenster. Die Adresse rufen Sie selbst auf.

---

## Daten übernehmen

Nach dem ersten Start ist Kuenta leer. Auf der Übersicht stehen Schaltflächen für die Einrichtung bereit:

| Quelle | Weg in Kuenta |
|---|---|
| eigene Firmendaten von Hand | *Einstellungen* → Firmendaten (Name, Anschrift, Bank, Steuernummer, Logo) |
| KFZ-Faktura (`*.kfz`, `DB1.bak`, Programmordner) | *Kuenta → Daten aus KFZ-Faktura importieren* |
| Kuenta-Sicherung (`*.kuenta`) oder ältere KFZ-Faktotum-/Schraubwerk-Sicherung (`*.kft`, `*.swb`) | *Kuenta → Daten wiederherstellen* |
| Kunden, Fahrzeuge, Artikel … aus anderen Programmen (CSV, DATANORM) | *Kuenta → Datenimport* |

Umzug auf einen anderen Rechner: auf dem alten Rechner *Daten sichern* (`*.kuenta`), auf dem neuen *Daten wiederherstellen*.
