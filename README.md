# LiveStore × TanStack DB + (bonus Prisma-Effect-Generator)

An end-to-end demo of the [LiveStore](https://livestore.dev) sync engine wired into [TanStack DB](https://tanstack.com/db) collections.

To test locally: `bunx prisma generate` then `bun run dev` 
To deploy, `alchemy login` to point to your cloudflare account then run `bun run deploy`


## Why
LiveStore already owns the "sync engine" role: its own local SQLite store, its own optimistic state, its own WebSocket transport. TanStack DB adds a second, much faster reactive layer on top, with a better API (imo) and `useLiveQuery` ergonomics. 

##  Bonus
Small Prisma to Effect Generator, which livestore consumes! (because I love the way prisma schemas work). Write your db schema in prisma, run `bunx prisma generate` which auto-generates the Effect schema, point livestore to it and you're good to go.

**Prisma schema** as the source of truth for both the Cloudflare D1 audit log and the LiveStore materialisers. The whole stack, D1, Durable Object, and Worker, is provisioned by [Alchemy](https://alchemy.run).


## Files of interest
(ai slop)

| Path | What it does |
|------|--------------|
| `prisma/schema.prisma` | Single source of truth for tables |
| `generators/effect-schema.cjs` | Prisma → Effect Schema generator |
| `prisma/generated/client-schemas/index.ts` | Generated Effect Schemas (gitignored) |
| `prisma/migrations/0001_init/migration.sql` | Generated DDL for D1 |
| `src/livestore/schema.ts` | LiveStore tables + events + materialisers |
| `src/livestore/queries.ts` | Pre-built `uiState$` query |
| `src/livestore/store.ts` | `useAppStore()` hook |
| `src/db/liveStoreCollection.ts` | TanStack DB collection options creator |
| `src/db/todoCollection.ts` | The `todos` collection wired with LiveStore events |
| `src/db/todoSchema.ts` | Client-facing Effect `Schema` for the row type |
| `src/components/*.tsx` | React components using `useLiveQuery` |
| `src/cf-worker/index.ts` | LiveStore sync DO with D1 write-through + SPA fallback |
| `alchemy.run.ts` | D1 + Durable Object + Worker |
| `.gitignore` | Excludes `node_modules`, `dist`, generated, `.alchemy`, etc. |

## Alchemy v2 note
(ai slop but it's true)

This stack uses the stable `alchemy@0.93.x` (v1) API. The v2 beta
(`alchemy@next`, `2.0.0-beta.x`) is Effect-based but its transitive
`@effect/*@0.x` tree — pulled in by `@livestore/utils` — references
effect@0.x runtime APIs (`TRef`, `STM`, `Effect.merge`, `Effect.tryMap`,
…) that aren't in any published effect@4 beta on npm. PR #801 advanced
it but the migration isn't viable yet. Stay on v1 stable.


## Credits
- TODO app example pulled from `bunx @livestore/cli@dev create --example tutorial-starter livestore-todo-app`

# License 
MIT 
