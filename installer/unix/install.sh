#!/bin/sh
# Install Kuenta for Linux / macOS (for the current user, without root).
#
#   ./installer/unix/install.sh               install or update
#   ./installer/unix/install.sh --uninstall   remove the program; asks whether to delete the data too
#       --delete-data   delete the data without asking (after a copy as .tar.gz in the home folder)
#       --no-backup     with --delete-data: no copy
#
# Program files:    ~/.local/lib/kuenta  (elsewhere: PREFIX=/path ./install.sh)
# Start command:    ~/.local/bin/kuenta  (network: kuenta --netzwerk)
# Data:             Linux ~/.local/share/kuenta, macOS ~/Library/Application Support/Kuenta
set -eu

SRC=$(cd "$(dirname "$0")/../.." && pwd)
PREFIX=${PREFIX:-$HOME/.local/lib/kuenta}
BIN=$HOME/.local/bin
OS=$(uname -s)
APPS=${XDG_DATA_HOME:-$HOME/.local/share}/applications
ICONS=${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps
MACAPP=$HOME/Applications/Kuenta.app
# messages in the system language (KUENTA_LANG=de|en|es to choose): msg "German" "English" "Spanish"
L=${KUENTA_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}}
case $L in de*) L=de ;; es*) L=es ;; *) L=en ;; esac
msg() { case $L in de) printf '%s\n' "$1" ;; es) printf '%s\n' "$3" ;; *) printf '%s\n' "$2" ;; esac; }

# data folder of Kuenta (as server/db/index.js): KUENTA_DATA, otherwise the folder of the operating system
datadir() {
  if [ -n "${KUENTA_DATA:-}" ]; then printf '%s\n' "$KUENTA_DATA"
  elif [ "$OS" = "Darwin" ]; then printf '%s\n' "$HOME/Library/Application Support/Kuenta"
  else printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}/kuenta"; fi
}
ja() { case $1 in j*|J*|y*|Y*|s*|S*) return 0 ;; *) return 1 ;; esac; }

uninstall() {
  rm -rf "$PREFIX" "$BIN/kuenta" "$APPS/kuenta.desktop" "$ICONS/kuenta.svg" "$MACAPP"
  msg "Kuenta wurde entfernt." "Kuenta has been removed." "Kuenta se ha eliminado."
  D=$(datadir)
  # only a folder that really holds Kuenta data is ever deleted
  if [ ! -f "$D/kuenta.db" ] && [ ! -f "$D/mandanten.json" ]; then return 0; fi
  case $D in "$HOME"|"$HOME/"|/) return 0 ;; esac
  loeschen=no; kopie=yes
  if [ "$DELETE_DATA" = 1 ]; then
    loeschen=yes; if [ "$NO_BACKUP" = 1 ]; then kopie=no; fi
  elif [ -t 0 ]; then
    msg "Sollen auch Ihre Kuenta-Daten gelöscht werden? ($D)" "Also delete your Kuenta data? ($D)" "¿Borrar también sus datos de Kuenta? ($D)"
    msg "Darin liegen Kunden, Rechnungen, Kassendaten und Sicherungen; Rechnungen und Kassendaten müssen in der Regel bis zu 10 Jahre aufbewahrt werden." \
        "It contains customers, invoices, cash register data and backups; invoices and cash register data usually have to be kept for up to 10 years." \
        "Contiene clientes, facturas, datos de caja y copias de seguridad; facturas y datos de caja suelen conservarse hasta 10 años."
    printf '%s' "$(msg "Daten löschen? [j/N] " "Delete the data? [y/N] " "¿Borrar los datos? [s/N] ")"
    read -r a || a=
    if ja "$a"; then
      loeschen=yes
      printf '%s' "$(msg "Vorher eine Kopie als .tar.gz im Home-Ordner speichern? [J/n] " "Save a copy as .tar.gz in the home folder first? [Y/n] " "¿Guardar antes una copia .tar.gz en la carpeta personal? [S/n] ")"
      read -r a || a=
      case $a in n*|N*)
        printf '%s' "$(msg "Wirklich ohne Kopie endgültig löschen? [j/N] " "Really delete for good without a copy? [y/N] " "¿Borrar definitivamente sin copia? [s/N] ")"
        read -r a || a=
        if ja "$a"; then kopie=no; else loeschen=no; fi ;;
      esac
    fi
  fi
  if [ "$loeschen" != yes ]; then
    msg "Ihre Daten bleiben erhalten: $D" "Your data is kept: $D" "Sus datos se conservan: $D"
    return 0
  fi
  if [ "$kopie" = yes ]; then
    Z="$HOME/Kuenta-Daten-$(date +%Y-%m-%d_%H%M).tar.gz"
    if ! tar -czf "$Z" -C "$(dirname "$D")" "$(basename "$D")"; then
      rm -f "$Z"
      msg "Die Kopie konnte nicht gespeichert werden. Ihre Daten wurden NICHT gelöscht: $D" "The copy could not be saved. Your data was NOT deleted: $D" "No se pudo guardar la copia. Sus datos NO se han borrado: $D" >&2
      return 1
    fi
    msg "Kopie der Daten: $Z" "Copy of the data: $Z" "Copia de los datos: $Z"
  fi
  rm -rf "$D"
  msg "Ihre Kuenta-Daten wurden gelöscht." "Your Kuenta data has been deleted." "Sus datos de Kuenta se han borrado."
}
DELETE_DATA=0; NO_BACKUP=0
if [ "${1:-}" = "--uninstall" ]; then
  for a in "$@"; do case $a in --delete-data) DELETE_DATA=1 ;; --no-backup) NO_BACKUP=1 ;; esac; done
  uninstall; exit $?
fi

# check Node.js >= 22.13
if ! command -v node >/dev/null 2>&1; then
  msg "Node.js wurde nicht gefunden. Bitte zuerst Node.js LTS (ab 22.13) installieren – siehe INSTALL.de.md." \
      "Node.js was not found. Please install Node.js LTS (22.13 or later) first – see INSTALL.md." \
      "No se encontró Node.js. Instale primero Node.js LTS (22.13 o posterior); véase INSTALL.md." >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  msg "Node.js $(node -v) ist zu alt. Benötigt wird Version 22.13 oder neuer – siehe INSTALL.de.md." \
      "Node.js $(node -v) is too old. Version 22.13 or later is required – see INSTALL.md." \
      "Node.js $(node -v) es demasiado antiguo. Se necesita la versión 22.13 o posterior; véase INSTALL.md." >&2
  exit 1
fi

msg "Installiere Kuenta nach $PREFIX ..." "Installing Kuenta to $PREFIX ..." "Instalando Kuenta en $PREFIX ..."
rm -rf "$PREFIX/server" "$PREFIX/public" "$PREFIX/docs"
mkdir -p "$PREFIX" "$BIN"
cp -R "$SRC/server" "$SRC/public" "$SRC/docs" "$PREFIX/"
for f in package.json README.md README.de.md INSTALL.md INSTALL.de.md LICENSE kuenta.sh; do
  if [ -f "$SRC/$f" ]; then cp "$SRC/$f" "$PREFIX/"; fi
done
chmod +x "$PREFIX/kuenta.sh"
ln -sf "$PREFIX/kuenta.sh" "$BIN/kuenta"

if [ "$OS" = "Darwin" ]; then
  # small app in ~/Applications that starts Kuenta in a terminal window
  mkdir -p "$MACAPP/Contents/MacOS"
  cat > "$MACAPP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Kuenta</string>
  <key>CFBundleIdentifier</key><string>de.kuenta.app</string>
  <key>CFBundleExecutable</key><string>Kuenta</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$(node -p "require('$PREFIX/package.json').version")</string>
</dict></plist>
EOF
  cat > "$MACAPP/Contents/MacOS/Kuenta" <<EOF
#!/bin/sh
open -a Terminal "$PREFIX/kuenta.sh"
EOF
  chmod +x "$MACAPP/Contents/MacOS/Kuenta"
  msg "App angelegt: $MACAPP" "App created: $MACAPP" "App creada: $MACAPP"
else
  mkdir -p "$APPS" "$ICONS"
  cp "$SRC/public/img/icon.svg" "$ICONS/kuenta.svg"
  cat > "$APPS/kuenta.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Kuenta
Comment=Invoicing & POS for auto repair shops
Exec="$PREFIX/kuenta.sh"
Icon=kuenta
Terminal=true
Categories=Office;Finance;
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
  msg "Startmenü-Eintrag angelegt: $APPS/kuenta.desktop" "Menu entry created: $APPS/kuenta.desktop" "Entrada de menú creada: $APPS/kuenta.desktop"
fi

case ":$PATH:" in *":$BIN:"*) ;; *) msg "Hinweis: $BIN ist nicht im PATH – Start alternativ mit $PREFIX/kuenta.sh" "Note: $BIN is not in the PATH – start with $PREFIX/kuenta.sh instead" "Aviso: $BIN no está en el PATH; inicie con $PREFIX/kuenta.sh" ;; esac
msg "Fertig. Starten mit: kuenta   (Netzwerkbetrieb: kuenta --netzwerk)" "Done. Start with: kuenta   (network mode: kuenta --netzwerk)" "Listo. Iniciar con: kuenta   (modo red: kuenta --netzwerk)"
