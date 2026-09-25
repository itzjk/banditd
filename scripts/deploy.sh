#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npx tsc --noEmit
npx eslint .
npm run build

URL=$(npx --yes vercel@latest deploy --prod --yes --no-wait | grep -oE "https://[a-z0-9.-]+\.vercel\.app" | head -1 || true)
if [ -z "$URL" ]; then
  echo "vercel deploy printed no deployment URL, nothing to wait for" >&2
  exit 1
fi
HOST=${URL#https://}
echo "deploying $HOST"

for _ in $(seq 1 40); do
  # Still building is the normal answer on the first polls: no match is not an error.
  STATE=$(npx --yes vercel@latest inspect "$HOST" 2>&1 | grep -oE "● (Ready|Error)" | head -1 || true)
  case "$STATE" in
    *Ready*) npx --yes vercel@latest alias set "$HOST" banditd.vercel.app; echo "live at https://banditd.vercel.app"; exit 0 ;;
    *Error*) echo "build failed: $HOST"; exit 1 ;;
  esac
  sleep 15
done

echo "timed out waiting for $HOST"
exit 1
