import { defineConfig, env } from "prisma/config";

try {
  process.loadEnvFile(".env");
} catch {
  // .env may already be loaded (e.g. by Next.js) or absent in some environments.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // CLI de migrations usa uma credencial administrativa separada; o app usa DATABASE_URL.
    url: process.env.DATABASE_MIGRATION_URL || env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
