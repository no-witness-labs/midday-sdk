#!/usr/bin/env bash
# Builds the devnet helper-server images from this repository (same code and
# dependency cohort as the SDK). Tags: midday-<server>:<sdk version>.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
VERSION=$(node -p "require('./package.json').version")
for SERVER in faucet fee-relay; do
  docker build -f docker/Dockerfile --build-arg SERVER=$SERVER -t "midday-$SERVER:$VERSION" .
  echo "Built midday-$SERVER:$VERSION"
done
