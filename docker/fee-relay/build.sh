#!/bin/bash
# Build the fee relay Docker image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building midday-fee-relay Docker image..."

# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Build Docker image
docker build -t midday-fee-relay:latest .

echo "Done! Image: midday-fee-relay:latest"
