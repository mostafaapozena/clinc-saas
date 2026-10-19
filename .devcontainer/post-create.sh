#!/usr/bin/env bash
# Runs once when the Codespace / devcontainer is created or rebuilt.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing the Node.js version pinned in .nvmrc ($(cat .nvmrc))"
export NVM_DIR="${NVM_DIR:-/usr/local/share/nvm}"
set +u
# --no-use: otherwise nvm.sh exits non-zero while the .nvmrc version is not yet installed.
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh" --no-use
nvm install
nvm alias default "$(cat .nvmrc)"
# The image puts $NVM_DIR/current/bin first on PATH; point it at the pinned version
# so every shell (including non-interactive `gh codespace ssh`) uses it.
ln -sfn "$NVM_DIR/versions/node/v$(cat .nvmrc)" "$NVM_DIR/current"
set -u

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
fi
if ! grep -qE '^DEMO_PASSWORD=.+' .env; then
  echo "==> Generating a random development DEMO_PASSWORD in .env (git-ignored)"
  sed -i '/^DEMO_PASSWORD=/d' .env
  echo "DEMO_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")" >> .env
fi

echo "==> Installing dependencies from the lockfile"
npm ci

echo "==> Installing Playwright Chromium (for browser tests)"
npx playwright install --with-deps chromium

echo "==> Seeding the development database with synthetic data"
npm run seed

echo "==> Done. Start the app with: npm run dev (demo password: see DEMO_PASSWORD in .env)"
