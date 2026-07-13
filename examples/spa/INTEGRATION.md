# Prisma → LiveStore → TanStack DB integration

End-to-end integration guide for the `@cyberistic/livestore-prisma` stack.
The full chain — from `prisma/schema.prisma` to a React component using
`useLiveQuery` — in one walk-through.

> **Pilot:** [`~/Documents/alkitab-alhakeem`](file:///Users/cyberistic/Documents/alkitab-alhakeem) — 17 collection hooks, ~510 lines per app replaced by this factory.
> The alkitab app keeps its hand-written `useTeacherProfilesCollection` /
> `useMemorizationPathsCollection` shapes side-by-side with the factory's
> output for migration reference.

## The chain

```
   ┌───────────────────────────────────────────┐
   │           prisma/schema.prisma            │
   │       (single source of truth)            │
   └──────────────┬────────────────────────────┘
                  │  bunx prisma generate
                  ▼
   ┌───────────────────────────────────────────┐
   │  prisma/generated/client-schemas/index.ts │
   │  • Effect Schema.Struct per model         │
   │  • PRIMARY_KEY_COLUMNS / SOFT_DELETE_COLUMNS│
   │  • TABLES = { columns, primaryKey, … }    │
   └──────────────┬────────────────────────────┘
                  │  createLiveStoreDb({ models, clientDocuments })
                  ▼
   ┌───────────────────────────────────────────┐
   │  src/livestore/schema.ts                  │
   │  • tables (per-model PascalCase keys)      │
   │  • events (per-model Created / Deleted / …)│
   │  • materializers                          │
   │  • readOnly (event/audit tables)           │
   └──────────────┬────────────────────────────┘
                  │  useTable('Todo') + React
                  ▼
   ┌───────────────────────────────────────────┐
   │  useTable() → TanStack DB Collection      │
   │  useLiveQuery(q => q.from({ todo })       │
   │                   .select(({ todo }) => …│
   └───────────────────────────────────────────┘
```

## Quickstart

The fastest path to a working app is:

```bash
# 1. Install
bun install

# 2. Generate Effect schemas + DDL from prisma/schema.prisma
bun run db:generate
bun run db:migrate

# 3. Define your models in src/livestore/schema.ts
#    (See "What the factory consumes" below.)

# 4. Local dev
bun run dev               # http://localhost:60001

# 5. Typecheck (Tier 2.4 verifies the row type flows through)
bun run typecheck

# 6. Production
bun run deploy             # → Cloudflare Worker + D1 + Durable Object
```

### What the factory consumes

```ts
// src/livestore/schema.ts
import { SessionIdSymbol, Schema } from '@livestore/livestore'
import { TodoSchema, EventSchema } from '../generated/client-schemas/index.ts'
import { createLiveStoreDb } from '../integration/createLiveStoreDb.ts'
import { toStandardSchemaV1 } from '../integration/standardSchema.ts'

const UiStateSchema = toStandardSchemaV1(Schema.Struct({
  newTodoText: Schema.String,
  filter: Schema.Union(Schema.Literal('all'), Schema.Literal('active'), Schema.Literal('completed')),
}))

const db = createLiveStoreDb({
  models: { Todo: TodoSchema, Event: EventSchema },
  clientDocuments: {
    uiState: {
      schema: UiStateSchema,
      default: { id: SessionIdSymbol, value: { newTodoText: '', filter: 'all' as const } },
    },
  },
})

export const { tables, events, materializers, schema, readOnly } = db
```

That replaces the ~89 lines of hand-written `State.SQLite.table` +
`Events.synced` + `State.SQLite.materializers` glue.

### What the factory emits

| Output | Shape | Used by |
|--------|-------|---------|
| `tables.Todo` | `State.SQLite.TableDef<…, Schema<{id, text, …}>>` | `tables.Todo.where({…})`, `q.from({ todo })` |
| `tables.uiState` | `State.SQLite.ClientDocumentTableDef` | `tables.uiState.get()` |
| `events.todoCreated` | `Events.synced` factory | `store.commit(events.todoCreated({id, text}))` |
| `materializers["v1.TodoCreated"]` | materializer fn | registered automatically with `State.SQLite.makeState` |
| `readOnly.Event` | `true` | `useTable('Event')` skips wiring commit handlers |

### Generator flags the factory expects

The local generator (`generators/effect-schema.cjs`) currently emits:

- `PRIMARY_KEY_COLUMNS[m]` — the `@id` column (or `@@id`, then `@@unique`)
- `SOFT_DELETE_COLUMNS[m]` — nullable field matching
  `/^(deleted|archived|removed)(At)?$|^isDeleted$/`
- `TABLES[m]` — `{ name, primaryKey, softDelete, includedInSync, columns[] }`
  where `name` honours `@@map` and `includedInSync` is `false` for
  `event|audit|log|…` shaped tables (server-authoritative audit logs).

These mirror the upstream PR landing on `Cyberistic/Prisma-Effect-Schema-Generator`
that adds `idColumn`, `softDeleteColumn`, `tables` generator options.

## Tier 2.4: row type flows end-to-end

Because the factory types `tables` per-key
(`{ [K in keyof T]: TableDef<…, Schema<RowType<T[K]>, …>> }`),
`useTable('Todo')` returns a `Collection<Todo, string>` — not
`Collection<LiveStoreRow, string>`.

```tsx
const todos = useTable('Todo')
// todos.collection : Collection<{ id: string; text: string; completed: boolean; deletedAt: Date | null }, string>

useLiveQuery((q) =>
  q.from({ todo: todos.collection })
   .select(({ todo }) => ({ id: todo.id, title: todo.text }))
)
// → data: Array<{ id: string; title: string }>
```

Verified by `src/integration/__tests__/tier2-4-demo.tsx` (negative cases
included).

## Tier mapping

This integration covers the following dream-list tiers
(see `todo.md` for the full roadmap):

| Tier | Feature | Status |
|------|---------|--------|
| 0.1 | `createLiveStoreDb(schema)` factory | ✅ |
| 0.2 | `useTable(name)` hook | ✅ |
| 0.4 | Prisma row = LiveStore row = TanStack row | ✅ (via `Schema.standardSchemaV1`) |
| 0.6 | Declarative `rpc` mutations | ✅ (via `createMutations`) |
| 1.2 | Auto soft-delete (`deletedAt: null`) | ✅ |
| 2.1 | Lazy db proxy (`db.teacherProfiles`) | 🚧 (other agent's slice) |
| 2.4 | `useTable(name).select(...)` row types | ✅ |
| 3.x | Per-app `<LiveStoreProvider>` + cloud templates | ⏳ |

## Open questions / follow-ups

1. **`as never` on `State.SQLite.clientDocument`** — still one cast in
   `createLiveStoreDb.ts:215`. Closes when the upstream
   `prisma-effect-schema-generator` PR lands its `emitStandardSchema`
   flag (Tier 2.3). Documented inline.

2. **`keying`** — `useTable('Todo')` looks up `tables.Todo` (PascalCase),
   which the factory now keys by model name. The pre-existing
   `tableNames: { Todo: 'todos' }` config option was removed because
   `TABLES[m].name` (from `@@map`) is the authoritative SQL name.

3. **Audit / event tables** — `Event` model has
   `TABLES.Event.includedInSync === false`, so the factory sets
   `readOnly['Event'] = true`. `useTable('Event')` skips wiring
   commit handlers but still returns the synced-table collection (for
   reads). Alchemy apps can use this for the D1 audit-log mirror.