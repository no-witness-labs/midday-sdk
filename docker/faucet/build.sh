#!/bin/bash
# Build the faucet Docker image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building midday-faucet Docker image..."

# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Build Docker image
docker build -t midday-faucet:latest .

echo "Done! Image: midday-faucet:latest"
