import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

/**
 * Prisma 7 takes its connection through a driver adapter rather than a URL in
 * the schema, so the pool is configured here.
 *
 * The global cache exists because Next's dev server re-evaluates modules on
 * every hot reload; without it each edit opens a fresh pool and Postgres
 * refuses connections after a few dozen saves.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function create() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? create();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
