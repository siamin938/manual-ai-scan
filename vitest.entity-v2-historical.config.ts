import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/entity-v2-historical-replay.live.ts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 30_000,
  },
});
