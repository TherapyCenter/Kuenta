#!/bin/sh
# Install Kuenta for Linux / macOS (for the current user, without root).
#
#   ./installer/unix/install.sh               install or update
#   ./installer/unix/install.sh --uninstall   remove the program (data is kept)
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

uninstall() {
  rm -rf "$PREFIX" "$BIN/kuenta" "$APPS/kuenta.desktop" "$ICONS/kuenta.svg" "$MACAPP"
  echo "Kuenta wurde entfernt. Ihre Daten wurden nicht gelöscht."
}
if [ "${1:-}" = "--uninstall" ]; then uninstall; exit 0; fi

# check Node.js >= 22.13
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden. Bitte zuerst Node.js LTS (ab 22.13) installieren – siehe INSTALL.md." >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Node.js $(node -v) ist zu alt. Benötigt wird Version 22.13 oder neuer – siehe INSTALL.md." >&2
  exit 1
fi

echo "Installiere Kuenta nach $PREFIX ..."
rm -rf "$PREFIX/server" "$PREFIX/public"
mkdir -p "$PREFIX" "$BIN"
cp -R "$SRC/server" "$SRC/public" "$PREFIX/"
for f in package.json README.md INSTALL.md LICENSE kuenta.sh; do
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
  echo "App angelegt: $MACAPP"
else
  mkdir -p "$APPS" "$ICONS"
  cp "$SRC/public/img/icon.svg" "$ICONS/kuenta.svg"
  cat > "$APPS/kuenta.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Kuenta
Comment=Werkstatt-Faktura
Exec="$PREFIX/kuenta.sh"
Icon=kuenta
Terminal=true
Categories=Office;Finance;
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
  echo "Startmenü-Eintrag angelegt: $APPS/kuenta.desktop"
fi

case ":$PATH:" in *":$BIN:"*) ;; *) echo "Hinweis: $BIN ist nicht im PATH – Start alternativ mit $PREFIX/kuenta.sh" ;; esac
echo "Fertig. Starten mit: kuenta   (Netzwerkbetrieb: kuenta --netzwerk)"
