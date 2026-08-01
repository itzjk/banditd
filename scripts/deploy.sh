#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npx tsc --noEmit
npx eslint .
npm run build

URL=$(npx --yes vercel@latest deploy --prod --yes --no-wait | grep -oE "https://[a-z0-9.-]+\.vercel\.app" | head -1)
HOST=${URL#https://}
echo "deploying $HOST"

for _ in $(seq 1 40); do
  STATE=$(npx --yes vercel@latest inspect "$HOST" 2>&1 | grep -oE "● (Ready|Error)" | head -1)
  case "$STATE" in
    *Ready*) npx --yes vercel@latest alias set "$HOST" banditd.vercel.app; echo "live at https://banditd.vercel.app"; exit 0 ;;
    *Error*) echo "build failed: $HOST"; exit 1 ;;
  esac
  sleep 15
done

echo "timed out waiting for $HOST"
exit 1
