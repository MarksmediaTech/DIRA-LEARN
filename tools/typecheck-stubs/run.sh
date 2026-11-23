#!/usr/bin/env bash
# Type-checks the whole frontend (screens included) against tools/typecheck-stubs/stubs.d.ts, with the project's strict
# settings, when the real packages cannot be installed. Usage: run.sh <project-dir> [tsc] [zod-dir]
PROJ="$(cd "$1" && pwd)"; TSC="${2:-/opt/npm-tools/node_modules/.bin/tsc}"; ZOD="${3:-/opt/npm-tools/node_modules/zod}"
TMP=$(mktemp -d)
cat > "$TMP/tsconfig.json" <<EOF
{ "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx",
    "strict": true, "noUncheckedIndexedAccess": true, "noUnusedLocals": true, "noUnusedParameters": true, "skipLibCheck": true,
    "isolatedModules": true, "noEmit": true, "ignoreDeprecations": "6.0", "baseUrl": "$PROJ", "types": [],
    "paths": { "@/*": ["src/*"], "zod": ["$ZOD"] } },
  "include": ["$PROJ/src/**/*.ts", "$PROJ/src/**/*.tsx", "$PROJ/tools/typecheck-stubs/stubs.d.ts"],
  "exclude": ["$PROJ/src/vite-env.d.ts"] }
EOF
OUT="$TMP/out.txt"; ( cd "$PROJ" && "$TSC" -p "$TMP/tsconfig.json" --pretty false ) > "$OUT" 2>&1   # paths relative to the project
# Any compiler error that is not a "src/..." line (for example "no inputs found" or a config error) is a failure, never ignored.
other=$(grep -E 'error TS[0-9]+' "$OUT" | grep -vE '^src/' || true)
if [ -n "$other" ]; then echo "TYPE CHECK COULD NOT RUN PROPERLY:"; echo "$other" | head -5; rm -rf "$TMP"; exit 1; fi
BASE="$PROJ/tools/typecheck-stubs/baseline.txt"
# Compare by file + error code + message (line numbers move as code changes).
norm() { grep -E '^src/' "$1" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort; }
total=$(grep -cE '^src/' "$OUT")
if [ "${UPDATE_BASELINE:-}" = 1 ]; then norm "$OUT" > "$BASE"; echo "baseline written: $total entries"; rm -rf "$TMP"; exit 0; fi
new=$(comm -13 <(sort "$BASE" 2>/dev/null) <(norm "$OUT"))
fixed=$(comm -23 <(sort "$BASE" 2>/dev/null) <(norm "$OUT") | wc -l)
echo "type errors: $total in total, $(grep -c . <<<"$new") NEW compared with the baseline of known stub limitations, $fixed baseline entries gone"
[ -n "$new" ] && { echo "NEW ERRORS:"; echo "$new"; rm -rf "$TMP"; exit 1; }
rm -rf "$TMP"; exit 0
