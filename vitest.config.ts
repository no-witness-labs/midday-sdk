import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 30_000,
    globals: true,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"]
  }
})
