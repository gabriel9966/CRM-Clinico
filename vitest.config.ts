import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    env: {
      CONNECTIONS_SECRET: "test-connections-secret-not-for-production-use",
      SESSION_SECRET: "test-session-secret-not-for-production-use-long-enough",
    },
  },
});
