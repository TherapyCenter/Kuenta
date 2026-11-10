#!/bin/sh
# Start Kuenta (macOS / Linux). Network mode: ./kuenta.sh --netzwerk
# resolve symlinks so starting via ~/.local/bin/kuenta works too
SELF=$0
while [ -L "$SELF" ]; do
  LINK=$(readlink "$SELF")
  case $LINK in /*) SELF=$LINK ;; *) SELF=$(dirname "$SELF")/$LINK ;; esac
done
cd "$(dirname "$SELF")" || exit 1
if [ "$1" = "--netzwerk" ]; then HOST=0.0.0.0; export HOST; fi
NODE=node
[ -x ./node/bin/node ] && NODE=./node/bin/node
if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "Node.js nicht gefunden – bitte Node.js LTS (>= 22.13) installieren: https://nodejs.org"
  exit 1
fi
echo "Kuenta wird gestartet … Beenden mit Strg+C."
exec "$NODE" server/index.js --open
