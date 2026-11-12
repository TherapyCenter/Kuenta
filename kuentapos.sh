#!/bin/sh
# Start KuentaPOS (macOS / Linux). Network mode: ./kuentapos.sh --netzwerk
# resolve symlinks so starting via ~/.local/bin/kuentapos works too
SELF=$0
while [ -L "$SELF" ]; do
  LINK=$(readlink "$SELF")
  case $LINK in /*) SELF=$LINK ;; *) SELF=$(dirname "$SELF")/$LINK ;; esac
done
cd "$(dirname "$SELF")" || exit 1
# messages in the system language (KUENTAPOS_LANG=de|en|es to choose): msg "German" "English" "Spanish"
L=${KUENTAPOS_LANG:-${KUENTA_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}}}
case $L in de*) L=de ;; es*) L=es ;; *) L=en ;; esac
msg() { case $L in de) printf '%s\n' "$1" ;; es) printf '%s\n' "$3" ;; *) printf '%s\n' "$2" ;; esac; }
if [ "$1" = "--netzwerk" ]; then HOST=0.0.0.0; export HOST; fi
NODE=node
[ -x ./node/bin/node ] && NODE=./node/bin/node
if ! command -v "$NODE" >/dev/null 2>&1; then
  msg "Node.js nicht gefunden – bitte Node.js LTS (>= 22.13) installieren: https://nodejs.org" \
      "Node.js not found – please install Node.js LTS (>= 22.13): https://nodejs.org" \
      "No se encontró Node.js: instale Node.js LTS (>= 22.13): https://nodejs.org"
  exit 1
fi
msg "KuentaPOS wird gestartet … Beenden mit Strg+C." "Starting KuentaPOS … stop with Ctrl+C." "Iniciando KuentaPOS … detener con Ctrl+C."
exec "$NODE" server/index.js --open
