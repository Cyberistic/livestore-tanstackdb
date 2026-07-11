# LiveStore × TanStack DB × Prisma × D1

An end-to-end demo of the [LiveStore](https://livestore.dev) sync engine wired
into [TanStack DB](https://tanstack.com/db) collections, with a single
**Prisma schema** as the source of truth for both the Cloudflare D1 audit log
and the LiveStore materialisers. The whole stack — D1, Durable Object, and
Worker — is provisioned by [Alchemy](https://alchemy.run).

```
                   ┌────────────────────────────────────────────────┐
                   │              prisma/schema.prisma              │
                   │            (single source of truth)            │
                   └────────────────┬───────────────┬───────────────┘
                                    │               │
                  effect_client     │               │   prisma migrate diff
                  generator         │               │
                                    ▼               ▼
        ┌──────────────────────────────────┐   ┌──────────────────────────┐
        │  generated/client-schemas/       │   │  prisma/migrations/       │
        │  (Effect Schema.Struct per model) │   │  (DDL applied to D1)     │
        └─────────────────┬────────────────┘   └─────────────┬────────────┘
                          │                                  │
                          ▼                                  ▼
            ┌─────────────────────────────┐    ┌──────────────────────────┐
            │     src/livestore/schema.ts  │    │   alchemy.run.ts          │
            │   tables.todos = table({     │    │   D1Database({           │
            │     schema: TodoSchema, ... }) │   │     migrationsDir:        │
            │   })                          │    │     "./prisma/migrations"│
            └──────────────┬───────────────┘    │   })                      │
                           │                    └──────────┬───────────────┘
                           ▼                               │
            ┌─────────────────────────────┐                ▼
            │      LiveStore (browser)     │    ┌──────────────────────────┐
            │   events → SQLite materialiser │    │   src/cf-worker/index.ts │
            │   store.subscribe(query)      │◀───│   SyncBackendDO:          │
            └──────────────┬───────────────┘    │   - LiveStore sync DO     │
                           │                    │   - onPush → D1 mirror    │
                           │  diff snapshots    │   - /sync WebSocket       │
                           ▼                    └──────────────────────────┘
            ┌─────────────────────────────┐
            │   src/db/liveStoreCollection  │    TanStack DB chain
            │   Pattern B adapter:          │    ════════════════
            │   - sync → begin/write/commit  │
            │   - onInsert/Update/Delete     │
            │     → store.commit(events.*)   │
            └──────────────┬───────────────┘
                           │
                           ▼
            ┌─────────────────────────────┐
            │  src/db/todoCollection.ts     │
            │   createCollection(           │
            │     liveStoreCollectionOptions│
            │       ({store, query: allTodos$, │
            │        commitInsert/...})     │
            └──────────────┬───────────────┘
                           │  useTodoCollection()
                           ▼
            ┌─────────────────────────────┐
            │  React components:            │
            │   - useLiveQuery(q =>         │
            │       q.from({todo: todos}))  │
            │   - todos.insert/update/      │
            │       delete                  │
            └─────────────────────────────┘
```

## Why

LiveStore already owns the "sync engine" role: its own local SQLite store,
its own optimistic state, its own WebSocket transport. TanStack DB adds a
second, much faster reactive layer on top — sub-millisecond live queries,
cross-collection joins, the `useLiveQuery` ergonomics.

The hand-off is `src/db/liveStoreCollection.ts` — a small adapter that
follows [Pattern B from the TanStack DB collection-options-creator guide](https://raw.githubusercontent.com/tanstack/db/main/docs/guides/collection-options-creator.md):

- `sync` subscribes to a LiveStore query, diffs the snapshot, and forwards
  insert / update / delete messages into TanStack DB with `begin` /
  `write` / `commit` (buffering the initial snapshot, deduping the stream).
- `onInsert` / `onUpdate` / `onDelete` translate the TanStack DB mutation
  into the corresponding LiveStore event commit.

Components then consume the collection with `@tanstack/react-db`'s
`useLiveQuery` exactly the way they would for any other sync engine.

## The chain, end-to-end

### 1. Prisma → Effect Schema → LiveStore

`prisma/schema.prisma` is the single source of truth. Two generators consume
it on every `bun run db:generate`:

- `client` — standard Prisma Client (for ad-hoc D1 reads).
- `effect_client` — a custom Prisma generator
  (`generators/effect-schema.cjs`) that emits an `@livestore/utils/effect`
  `Schema.Struct` per model into
  `prisma/generated/client-schemas/index.ts`.

```prisma
// prisma/schema.prisma
datasource db {
  provider = "sqlite"
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

generator effect_client {
  provider = "node ./generators/effect-schema.cjs"
  output   = "./generated/client-schemas/index.ts"
}

model Todo {
  id        String    @id
  text      String
  completed Boolean   @default(false)
  deletedAt DateTime? @map("deleted_at")
  @@map("todos")
}

model Event {
  id        Int      @id @default(autoincrement())
  storeId   String   @map("store_id")
  name      String
  args      String
  createdAt DateTime @default(now()) @map("created_at")
  @@index([storeId, id])
  @@map("events")
}
```

```ts
// prisma/generated/client-schemas/index.ts  (auto-generated)
export const TodoSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  completed: Schema.Boolean,
  deletedAt: Schema.NullOr(Schema.Date),
})
```

```ts
// src/livestore/schema.ts
import { TodoSchema } from '../../prisma/generated/client-schemas/index.ts'

export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    schema: TodoSchema,        // ← same shape as D1, generated from Prisma
  }),
  uiState: State.SQLite.clientDocument({ /* … */ }),
}

export const events = {
  todoCreated:    Events.synced({ name: 'v1.TodoCreated',    schema: Schema.Struct({ id: Schema.String, text: Schema.String }) }),
  todoCompleted:  Events.synced({ name: 'v1.TodoCompleted',  schema: Schema.Struct({ id: Schema.String }) }),
  todoUncompleted: Events.synced({ name: 'v1.TodoUncompleted', schema: Schema.Struct({ id: Schema.String }) }),
  todoDeleted:    Events.synced({ name: 'v1.TodoDeleted',    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }) }),
  uiStateSet:     tables.uiState.set,
} as const

const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated':    ({ id, text })       => tables.todos.insert({ id, text, completed: false, deletedAt: null }),
  'v1.TodoCompleted':  ({ id })             => tables.todos.update({ completed: true  }).where({ id }),
  'v1.TodoUncompleted':({ id })             => tables.todos.update({ completed: false }).where({ id }),
  'v1.TodoDeleted':    ({ id, deletedAt }) => tables.todos.update({ deletedAt }).where({ id }),
})
```

Adding a column is now a one-liner in `prisma/schema.prisma` — both sides
regenerate from the same generator invocation.

### 2. The LiveStore ↔ TanStack DB adapter

`src/db/liveStoreCollection.ts` is the Pattern B bridge:

```ts
export function liveStoreCollectionOptions<TIn, TOut>(config) {
  const sync = ({ begin, write, commit, markReady }) => {
    // 1. Buffer the initial snapshot (LiveStore fires one before
    //    the first server round-trip).
    // 2. Diff each new snapshot against the previous one and
    //    emit insert / update / delete messages.
    const unsubscribe = store.subscribe(query, (rows) => { /* diff & write */ })
    queueMicrotask(() => { /* flush buffered snapshot, markReady() */ })
    return () => unsubscribe()
  }

  const onInsert  = ({ transaction }) => { for (const m of transaction.mutations) commitInsert(m.modified) }
  const onUpdate  = ({ transaction }) => { for (const m of transaction.mutations) commitUpdate(m.original, m.changes) }
  const onDelete  = ({ transaction }) => { for (const m of transaction.mutations) commitDelete(m.original) }

  return { id, getKey, sync: { sync, rowUpdateMode: 'partial' }, onInsert, onUpdate, onDelete }
}
```

`src/db/todoCollection.ts` wires it up:

```ts
export const useTodoCollection = () => {
  const store = useAppStore()
  return useMemo(() => createCollection(
    liveStoreCollectionOptions<Todo>({
      id: 'todos',
      store,
      query: allTodos$,
      commitInsert: (row) => store.commit(events.todoCreated({ id: row.id, text: row.text })),
      commitUpdate: (_o, changes) => {
        if (changes.completed === true)  store.commit(events.todoCompleted({ id: changes.id ?? _o.id }))
        if (changes.completed === false) store.commit(events.todoUncompleted({ id: changes.id ?? _o.id }))
      },
      commitDelete: (row) => store.commit(events.todoDeleted({ id: row.id, deletedAt: new Date() })),
    }),
  ), [store])
}
```

### 3. React components

`useLiveQuery` from `@tanstack/react-db` is the only API components touch
for reads; `todos.insert` / `todos.update` / `todos.delete` are the only APIs
for writes:

```tsx
const MainSection = () => {
  const todos = useTodoCollection()
  const { data: visibleTodos } = useLiveQuery(q => {
    let query = q.from({ todo: todos })
    if (filter === 'completed') query = query.where(({ todo }) => eq(todo.completed, true))
    if (filter === 'active')    query = query.where(({ todo }) => eq(todo.completed, false))
    return query
  })

  return <ul>{visibleTodos.map(todo => <li>{todo.text}</li>)}</ul>
}

// writes
todos.insert({ id: crypto.randomUUID(), text, completed: false, deletedAt: null })
todos.update(todo.id, draft => { draft.completed = !todo.completed })
todos.delete(todo.id)
```

### 4. D1 audit log

`src/cf-worker/index.ts` extends the LiveStore `SyncBackendDO` and writes
every accepted event to a D1 table. The Durable Object itself still uses its
own SQLite for hot reads (low-latency fan-out to connected clients); D1 is
the durable, queryable mirror:

```ts
export class SyncBackendDO extends SyncBackend.makeDurableObject({
  onPush: async (message, context) => {
    const env = (globalThis as { __syncBackendEnv?: Env }).__syncBackendEnv
    const stmt = env.DB.prepare(
      'INSERT INTO events (store_id, name, args) VALUES (?1, ?2, ?3)',
    )
    await env.DB.batch(message.batch.map(e =>
      stmt.bind(context.storeId, String(e.name), JSON.stringify(e.args ?? {})),
    ))
  },
}) {}
```

(`__syncBackendEnv` is captured by the wrapper class because the
`CallbackContext` type only exposes `storeId` / `payload` / `headers`.)

### 5. Alchemy — Infrastructure as TypeScript

`alchemy.run.ts` provisions D1, the Durable Object namespace, and the Worker
in one declarative file:

```ts
const app = await alchemy("livestore-tanstack-db")

const db = await D1Database("todos-db", {
  name: "todos-db",
  primaryLocationHint: "wnam",
  migrationsDir: "./prisma/migrations",   // ← generated from `prisma migrate diff`
  migrationsTable: "d1_migrations",
})

const syncBackend = await DurableObjectNamespace("sync-backend", {
  className: "SyncBackendDO", sqlite: true,
})

const site = await Worker("site", {
  name: "livestore-tanstack-db-site",
  entrypoint: "./src/cf-worker/index.ts",
  bindings: { DB: db, SYNC_BACKEND_DO: syncBackend },
  assets: { binding: "ASSETS", directory: "./dist/client" },
})

await app.finalize()
```

The Worker also serves the built SPA from `dist/client/` via the
auto-injected `ASSETS` binding (with a fallback in `cf-worker/index.ts`
that returns `Not Found` when no asset matches).

## How a mutation round-trips

```
User clicks "complete" in MainSection
  ↓
todos.update(todo.id, draft => { draft.completed = true })   ← TanStack DB optimistic apply
  ↓
liveStoreCollectionOptions.onUpdate()                          ← adapter callback
  ↓
store.commit(events.todoCompleted({ id }))                    ← LiveStore event
  ↓
LiveStore materialises locally, pushes to the DO
  ↓
DO writes to its own SQLite, mirrors to D1 (audit log)         ← src/cf-worker/index.ts
  ↓
WebSocket fans the event out to every connected client
  ↓
Each client's LiveStore reapplies the event to its local store
  ↓
store.subscribe(query) fires with the updated rows
  ↓
liveStoreCollectionOptions.sync() diffs against last snapshot
  ↓
begin() / write({ type: 'update', value }) / commit()
  ↓
TanStack DB's live query engine incrementally re-derives every
active useLiveQuery(q => q.from({ todo: todos })...)
  ↓
Components re-render
```

Two layers of optimistic state, two layers of reactive streaming — and the
component only ever talks to TanStack DB.

## Run it

```bash
# 1. Install
bun install

# 2. Generate Effect Schemas + DDL from prisma/schema.prisma
bun run db:generate            # → prisma/generated/client-schemas/index.ts
bun run db:migrate             # → prisma/migrations/0001_init/migration.sql

# 3. Local dev — Vite + @cloudflare/vite-plugin on :60001.
#    No Cloudflare credentials required; wrangler/miniflare runs
#    the worker locally with a local DO SQLite.
bun run dev
# → http://localhost:60001          the SPA
# → http://localhost:60001/_livestore  LiveStore devtools

# 4. Typecheck
bun run typecheck

# 5. Production build
bun run build                   # → dist/

# 6. Provision on Cloudflare
bun alchemy login               # one-time OAuth
bun run deploy                  # → D1 + Durable Object + Worker
bun run destroy                 # tear it all down
```

## Files of interest

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

This stack uses the stable `alchemy@0.93.x` (v1) API. The v2 beta
(`alchemy@next`, `2.0.0-beta.x`) is Effect-based but its transitive
`@effect/*@0.x` tree — pulled in by `@livestore/utils` — references
effect@0.x runtime APIs (`TRef`, `STM`, `Effect.merge`, `Effect.tryMap`,
…) that aren't in any published effect@4 beta on npm. PR #801 advanced
it but the migration isn't viable yet. Stay on v1 stable.