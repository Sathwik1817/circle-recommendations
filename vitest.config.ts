import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // node:sqlite is stable in practice but still flagged experimental on Node 22; keep test output clean.
    execArgv: ["--disable-warning=ExperimentalWarning"],
  },
});
