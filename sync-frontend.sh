#!/usr/bin/env bash
# Die Oberfläche (HTML, CSS, JS, Schriften) gibt es zweimal: in php/ und go/.
# Ausnahme: icons/ – die Go-Fassung hat bewusst blaue Icons und wird nicht überschrieben.
# Bearbeitet wird sie in php/ – dieses Skript kopiert sie danach nach go/.
#
#   bash sync-frontend.sh
#
# tests/run-both.sh meldet, wenn die beiden Kopien voneinander abweichen.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
FILES=(index.html manifest.webmanifest sw.js)
DIRS=(css js fonts)

for f in "${FILES[@]}"; do cp "$ROOT/php/$f" "$ROOT/go/$f"; done
for d in "${DIRS[@]}"; do
  rm -rf "$ROOT/go/$d"
  cp -R "$ROOT/php/$d" "$ROOT/go/$d"
done
echo "Oberfläche von php/ nach go/ kopiert."
