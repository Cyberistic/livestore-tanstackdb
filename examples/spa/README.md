# SPA example — LiveStore + TanStack DB

The simplest case. **No oRPC, no SSR** — a Vite SPA that talks to a
LiveStore sync Durable Object over WebSockets. The browser holds the
authoritative copy of state (via OPFS), the sync DO mirrors every event
into a Cloudflare D1 SQLite database.

This is the "lowest level" surface of the stack; the oRPC variant in
`../tanstack-start-orpc/` adds server-side write routing on top.

## Quickstart

```bash
bun install
bun run db:generate   # generates prisma/generated/{client,client-schemas}
bun run dev           # vite on :60001, backed by a local worker / DO
```

Local dev requires **no Cloudflare login** — the
`@cloudflare/vite-plugin` runs a local worker via wrangler/miniflare
that executes `src/cf-worker/index.ts`, and the worker's local DO
SQLite holds the in-memory state.

## Architecture

```
   ┌────────────────────────────────────────────────┐
   │              Browser (SPA)                      │
   │  ┌──────────────┐    ┌─────────────────────┐    │
   │  │  OPFS SQLite │ ←→ │  React + LiveStore  │    │
   │  │  (event log) │    │  useTable() hooks   │    │
   │  └──────────────┘    └────────────────────┬─┘    │
   │                                          │       │
   │                          WebSocket       │       │
   │                          /sync           │       │
   └─────────────────────────────────────────┼───────┘
                                             ▼
   ┌────────────────────────────────────────────────┐
   │   Cloudflare Worker (deployed via Alchemy)      │
   │  ┌──────────────────────────────────────────┐   │
   │  │  Sync Backend Durable Object (SQLite)    │   │
   │  │  • Owns the per-store event log         │   │
   │  │  • On every `onPush` → mirror into D1   │   │
   │  └────────────────┬─────────────────────────┘   │
   │                   │ events                       │
   └───────────────────┼────────────────────────────┘
                       ▼
   ┌────────────────────────────────────────────────┐
   │   Cloudflare D1 (SQLite)                        │
   │  • `todos` table (mirror)                       │
   │  • `events` table (audit log, serverOnly)        │
   └────────────────────────────────────────────────┘
```

## Deploy

```bash
bun alchemy login   # one-time
bun run deploy      # plan + apply (rebuilds dist/ first)
bun run destroy     # tear it all down
```

`alchemy.run.ts` provisions:
- **D1 database** (`todos-db`) — migrations sourced from
  `prisma/migrations/`, auto-diffed from `prisma/schema.prisma`.
- **Sync backend Durable Object** namespace (`SYNC_BACKEND_DO`,
  `SyncBackendDO`, `sqlite: true`) — one isolate per `storeId`.
- **Worker + static SPA** (`Cloudflare.Vite`) — points at the bundle
  the `@cloudflare/vite-plugin` already produced in `./dist/`.

## Files

| Path | Purpose |
|------|---------|
| `prisma/schema.prisma` | source of truth for `Todo` + `Event` models |
| `prisma/livestore.annotations.json` | per-table flags (`serverOnly`, …) |
| `prisma/migrations/*.sql` | SQL diffs applied to D1 on deploy |
| `prisma.config.ts` | Prisma 7 config (schema path, DATABASE_URL) |
| `src/livestore/schema.ts` | generated tables / events / materializers |
| `src/db/*.ts` | TanStack DB collections + `useTable` wrappers |
| `src/cf-worker/index.ts` | Worker entry: `/sync` route → `SyncBackendDO` |
| `vite.config.ts` | Vite + Cloudflare plugin + LiveStore devtools |
| `alchemy.run.ts` | Resource declarations |
| `wrangler.toml` | Local-DO bindings + DO class migrations |

## See also

- [INTEGRATION.md](./INTEGRATION.md) — end-to-end walkthrough:
  Prisma → generated schemas → useTable.
- [`../tanstack-start-orpc/`](../tanstack-start-orpc/) — same stack +
  TanStack Start SSR + oRPC write routing.
- [`../../packages/livestore-prisma/`](../../packages/livestore-prisma/) — the Prisma generator that emits the LiveStore schema.
- [`../../packages/livestore-tanstack-db/`](../../packages/livestore-tanstack-db/) — the React glue (`useTable`, `useCrud`, `createRpcAdapter`, `LiveStoreProvider`).
