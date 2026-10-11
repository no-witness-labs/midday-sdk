# Devnet helper servers (faucet, fee relay) built from this repository, so the
# containers run the same code and dependency cohort as the SDK itself.
#
# Build from the repository root:
#   docker build -f docker/Dockerfile --build-arg SERVER=faucet    -t midday-faucet:<version> .
#   docker build -f docker/Dockerfile --build-arg SERVER=fee-relay -t midday-fee-relay:<version> .
ARG SERVER=faucet

FROM node:22-slim AS build
WORKDIR /app
# Toolchain for the native add-ons pulled in by dockerode/ssh2 and msgpackr.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@9.0.0 --activate
# Workspace manifests are needed for a frozen install; src/ must be present
# too because the package's `prepare` script builds during install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY examples/counter/package.json examples/counter/
COPY examples/devnet-testing/package.json examples/devnet-testing/
COPY examples/browser-lace/package.json examples/browser-lace/
COPY examples/effect-di/package.json examples/effect-di/
COPY website/package.json website/
COPY src/ ./src/
RUN pnpm install --frozen-lockfile --filter . && pnpm build && pnpm prune --prod

FROM node:22-slim
ARG SERVER
ENV SERVER=${SERVER}
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3001 3002
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s \
  CMD curl -fs "http://localhost:${FAUCET_PORT:-${FEE_RELAY_PORT:-3001}}/health" || exit 1
CMD ["sh", "-c", "exec node dist/devnet/bin/${SERVER}.js"]
