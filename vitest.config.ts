import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globals: true,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // E2E tests spin up multiple Docker containers and should run sequentially
    // to avoid resource contention on CI runners
    fileParallelism: false,
  }
})
