#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TEMP_BACKUP="$(mktemp -d /tmp/burgfried-offline-build.XXXXXX)"
API_BACKUP="$TEMP_BACKUP/api"
CONFIG_BACKUP="$TEMP_BACKUP/next.config.ts"
restore() {
  set +e
  if [ -f "$CONFIG_BACKUP" ]; then mv -f "$CONFIG_BACKUP" next.config.ts; fi
  if [ -d "$API_BACKUP" ]; then mkdir -p src/app; mv "$API_BACKUP" src/app/api; fi
  rm -rf "$TEMP_BACKUP"
}
trap restore EXIT

if [ -d src/app/api ]; then mv src/app/api "$API_BACKUP"; fi
cp next.config.ts "$CONFIG_BACKUP"
cat > next.config.ts <<'EOF'
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "export" };
export default nextConfig;
EOF

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/app_db}" npm run build
rm -rf mobile/www
mkdir -p mobile/www
cp -a out/. mobile/www/
python3 - <<'PY'
from pathlib import Path
p = Path("mobile/www/index.html")
s = p.read_text()
s = s.replace("<head>", '<head><script>window.__BURGFRIED_OFFLINE__=true;</script>', 1)
p.write_text(s)
PY

cd mobile
npm install --no-audit --no-fund >/dev/null
npx cap copy android
printf '\nOffline-Web-Bundle erstellt: mobile/www\n'
