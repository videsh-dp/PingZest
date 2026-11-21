#!/usr/bin/env bash
# Runs on the server for each deploy (called by GitHub Actions over SSH, as the deploy user).
# Unpacks the release built by CI, installs production packages, updates the database indexes,
# switches the "current" link and reloads PM2. Keeps the last 5 releases for rollback.
#   Rollback by hand:  bash /var/www/pingzest/current/deploy/release.sh --rollback
set -euo pipefail
APP_DIR=/var/www/pingzest
cd "$APP_DIR"

if [ "${1:-}" = "--rollback" ]; then
  prev=$(ls -1t releases | sed -n 2p)
  [ -n "$prev" ] || { echo "No previous release"; exit 1; }
  ln -sfn "$APP_DIR/releases/$prev" current
  pm2 startOrReload current/ecosystem.config.cjs --update-env && pm2 save
  echo "Rolled back to $prev"; exit 0
fi

SHA="${1:?release id}"
DIR="$APP_DIR/releases/$SHA"
mkdir -p "$DIR"
tar -xzf "/tmp/pingzest-$SHA.tgz" -C "$DIR"
rm -f "/tmp/pingzest-$SHA.tgz"
cd "$DIR"

echo "▶ Installing production packages"
npm install --omit=dev --no-audit --no-fund --loglevel=error

echo "▶ Database: generate client, create collections and indexes"
set -a; . "$APP_DIR/shared/.env"; set +a
npx prisma generate >/dev/null
npx prisma db push --skip-generate

echo "▶ Switching to $SHA"
ln -sfn "$DIR" "$APP_DIR/current"
pm2 startOrReload "$APP_DIR/current/ecosystem.config.cjs" --update-env
pm2 save >/dev/null

echo "▶ Health check"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then echo "✅ Live: $SHA"; break; fi
  sleep 1
  if [ "$i" = 20 ]; then
    echo "❌ Health check failed, rolling back"; bash "$DIR/deploy/release.sh" --rollback; exit 1
  fi
done

echo "▶ Cleaning old releases"
ls -1t "$APP_DIR/releases" | tail -n +6 | while read -r old; do rm -rf "$APP_DIR/releases/$old"; done
