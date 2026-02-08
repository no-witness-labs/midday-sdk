# Fee relay server for Midday DevNet
# Multi-stage build - builds everything inside Docker

# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Copy source files
COPY package.json tsconfig.json ./
COPY src/ ./src/

# Install all deps and build
RUN npm install && npm run build

# Stage 2: Production
FROM node:22-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy package.json and install production deps only
COPY package.json ./
RUN npm install --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose fee relay port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s \
  CMD curl -f http://localhost:3002/health || exit 1

# Run fee relay server
CMD ["node", "dist/fee-relay-server.js"]
