import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 configuration. The `url` field on `datasource` was removed
 * from schema files; instead the migration/adapter URL lives here.
 *
 * For local generation we just point at a throwaway SQLite file.
 * Production migrations run against the live Cloudflare D1 database
 * through Alchemy's `Cloudflare.D1.Database` resource — Prisma's
 * generated SQL is diff'd into `prisma/migrations/` and pointed at
 * via `migrationsDir`.
 */
export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
    seed: undefined,
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  },
})