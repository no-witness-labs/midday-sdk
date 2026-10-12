# Devnet helper servers (faucet, fee relay) running this SDK's own servers.
#
# The build context is the package root: either a repository checkout after
# `pnpm build`, or the installed package (node_modules/@no-witness-labs/midday-sdk),
# which is what `Images.buildServerImage` uses. Only package.json and dist/ are
# read; dependencies come from the registry, so no sources or lockfile are needed.
#
#   docker build -f docker/Dockerfile --build-arg SERVER=faucet    -t midday-faucet:<version> .
#   docker build -f docker/Dockerfile --build-arg SERVER=fee-relay -t midday-fee-relay:<version> .
ARG SERVER=faucet

FROM node:22-slim
ARG SERVER
ENV SERVER=${SERVER} NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY package.json ./
# --ignore-scripts: skips the package's own `prepare` (a TypeScript build) and the
# optional native rebuilds; classic-level, ssh2 and msgpackr ship prebuilt binaries.
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY dist/ ./dist/
EXPOSE 3001 3002
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s \
  CMD curl -fs "http://localhost:${FAUCET_PORT:-${FEE_RELAY_PORT:-3001}}/health" || exit 1
CMD ["sh", "-c", "exec node dist/devnet/bin/${SERVER}.js"]
