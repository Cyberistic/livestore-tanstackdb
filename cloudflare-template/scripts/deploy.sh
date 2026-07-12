#!/usr/bin/env bash
set -e

# Install deps
bun install

# Generate Prisma client (+ Effect schemas via the `effect_client` generator)
bun run db:generate

# Diff `prisma/schema.prisma` into `prisma/migrations/0001_init/migration.sql`
# for D1 to apply at deploy time.
DATABASE_URL=file:./prisma/dev.db bun run db:migrate

# Login to Alchemy / Cloudflare. The `--skip` flag does not exist — you
# must run `bunx alchemy login` interactively the first time. After that
# the credentials are cached and `bun run deploy` works non-interactively.
# bunx alchemy login --skip

# Build SPA (vite build) + upload via Alchemy. Already wired in package.json:
#   "deploy": "bun run build && alchemy deploy"
bun run deploy