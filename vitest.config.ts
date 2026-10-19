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
    // Suítes de integração importam muitos módulos; em máquina carregada o beforeAll passa de 10s.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    setupFiles: ["./test/setup.ts"],
    env: {
      CONNECTIONS_SECRET: "test-connections-secret-not-for-production-use",
      SESSION_SECRET: "test-session-secret-not-for-production-use-long-enough",
    },
  },
});
