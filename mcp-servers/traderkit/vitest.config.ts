import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 75 },
      include: ["src/**"],
      exclude: [
        "src/index.ts",
        "src/cache.ts",
        "src/tools/check-trade.ts",
        "src/tools/check-wash-sale.ts",
        "src/tools/list-profiles.ts",
        "src/tools/set-profile.ts",
      ],
    },
  },
});
