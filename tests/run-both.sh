#!/usr/bin/env bash
# Startet PHP- und Go-Backend mit frischen Testdaten, lässt tests/api_test.py gegen
# beide laufen und vergleicht die Antworten.
#
#   bash tests/run-both.sh        (braucht php, go, git, python3)
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
PIDS=()
cleanup() { kill "${PIDS[@]}" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

# Ist die Oberfläche in php/ und go/ gleich? (sonst: bash sync-frontend.sh)
FRONT_DIFF=$(cd "$ROOT" && for p in index.html manifest.webmanifest sw.js css js fonts; do diff -rq "php/$p" "go/$p"; done 2>&1 || true)
if [ -n "$FRONT_DIFF" ]; then
  echo "✗ Oberfläche in php/ und go/ unterschiedlich – bash sync-frontend.sh ausführen:"
  echo "$FRONT_DIFF"
  exit 1
fi

(cd "$ROOT/go" && go build -o "$TMP/notizblog-go" .) || exit 1

for name in php go; do
  mkdir -p "$TMP/$name/data" "$TMP/$name/uploads"
  # Test-Homepage: Git-Repo mit eigenem „Remote“
  git init -q --bare "$TMP/$name/remote.git"
  git init -q -b main "$TMP/$name/homepage"
  git -C "$TMP/$name/homepage" config user.name Test
  git -C "$TMP/$name/homepage" config user.email test@example.com
  git -C "$TMP/$name/homepage" commit -q --allow-empty -m start
  git -C "$TMP/$name/homepage" remote add origin "$TMP/$name/remote.git"
  git -C "$TMP/$name/homepage" push -q -u origin main 2>/dev/null
done

# Gleiche auth.json für beide (Passwort „test-passwort“) – erzeugt von PHP, gelesen von beiden
printf 'test-passwort\n' | NOTIZBLOG_DATA="$TMP/php/data" php "$ROOT/php/bin/passwd.php" test >/dev/null
cp "$TMP/php/data/auth.json" "$TMP/go/data/auth.json"

NOTIZBLOG_DATA="$TMP/php/data" NOTIZBLOG_UPLOADS="$TMP/php/uploads" \
  php -S 127.0.0.1:8201 -t "$ROOT/php" "$ROOT/php/router.php" </dev/null >"$TMP/php.log" 2>&1 &
PIDS+=($!)
NOTIZBLOG_ROOT="$ROOT/go" NOTIZBLOG_DATA="$TMP/go/data" NOTIZBLOG_UPLOADS="$TMP/go/uploads" PORT=8202 \
  "$TMP/notizblog-go" </dev/null >"$TMP/go.log" 2>&1 &
PIDS+=($!)
sleep 1

UPLOADS_DIR="$TMP/php/uploads" python3 "$ROOT/tests/api_test.py" http://127.0.0.1:8201 "$TMP/php/data" "$TMP/php/homepage" >"$TMP/php.json"
UPLOADS_DIR="$TMP/go/uploads"  python3 "$ROOT/tests/api_test.py" http://127.0.0.1:8202 "$TMP/go/data"  "$TMP/go/homepage"  >"$TMP/go.json"

python3 - "$TMP/php.json" "$TMP/go.json" <<'PY'
import json, sys
php, go = (json.load(open(f)) for f in sys.argv[1:3])
for name, r in (('PHP', php), ('Go', go)):
    print(f"{name}: {len(r['results'])} Schritte, {len(r['failures'])} Fehler")
    for f in r['failures']:
        print('   ✗', f)
diff = [(a['step'], a, b) for a, b in zip(php['results'], go['results']) if a != b]
print(f"Unterschiede PHP ↔ Go: {len(diff)}")
for step, a, b in diff:
    print('  ≠', step)
    print('     PHP:', json.dumps(a, ensure_ascii=False)[:400])
    print('     Go: ', json.dumps(b, ensure_ascii=False)[:400])
ok = not diff and not php['failures'] and not go['failures']
print('✓ Beide Backends verhalten sich gleich.' if ok else '✗ Es gibt Unterschiede oder Fehler.')
sys.exit(0 if ok else 1)
PY
