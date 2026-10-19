#!/usr/bin/env bash
# Runs once when the Codespace / devcontainer is created or rebuilt.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing the Node.js version pinned in .nvmrc ($(cat .nvmrc))"
export NVM_DIR="${NVM_DIR:-/usr/local/share/nvm}"
set +u
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm install
nvm alias default "$(cat .nvmrc)"
nvm use default
set -u

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
fi

echo "==> Installing dependencies from the lockfile"
npm ci

echo "==> Installing Playwright Chromium (for the smoke test)"
npx playwright install --with-deps chromium

echo "==> Seeding the development database with synthetic reference data"
npm run seed

echo "==> Done. Start the app with: npm run dev"
