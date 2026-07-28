import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env automatically and takes the datasource URL
// from here rather than from `env()` in the schema.
if (process.env.DATABASE_URL === undefined) {
  const { existsSync } = await import("node:fs");
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.mts",
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
