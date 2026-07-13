# Prisma → LiveStore → TanStack DB — drop-in integration roadmap

> Source of truth for *all* work on this stack. Mirrors the dream-list
> in `~/Documents/alkitab-alhakeem/dream-list.md` and tracks what we've
> implemented + what's open. Lives at the repo root so other agents
> find it.

## Status legend

- ✅ done
- 🚧 in progress (this branch)
- ⏳ pending
- 🟢 ready for parallel work
- 🚫 blocked

## Packages

- **prisma-effect-schema-generator** (npm, `Cyberistic/Prisma-Effect-Schema-Generator`)
  — emits Effect `Schema.Struct(...)` per Prisma model. **Provides** the
  Effect Schema. **Missing** for our integration: `id` introspection,
  soft-delete detection, `Schema.standardSchemaV1(...)` wrap. Those three
  are upstream candidates (not LiveStore-specific).
- **`livestore-prisma`** (this repo, to be published)
  — uses the upstream generator, adds the LiveStore + TanStack DB glue.
  Tier 0.1, 0.2, 0.6, 2.1, 3.x live here.
- **alchemy.run.ts** in this repo is the working template for Tier 3.2.

## Top 3 priority (per the dream-list)

Top 3 the user picked:
1. **0.1 + 0.2** — `createLiveStoreDb(schema)` + `useTable(name)` hook
   eliminates ~850 lines of glue per app.
2. **0.6** — auto-derive `commitInsert/Update/Delete` from
   `{ rpc: { teacher: { createLesson: { event: "lessonUpserted" } } } }`
   config. Removes the second-biggest source of boilerplate.
3. **2.1** — lazy db proxy so `import { foo }` calls keep working
   post-migration. Single thing that made the Electric→LiveStore port
   mechanical instead of painful.

---

## Tier 0 — day 1, no glue code

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 0.1 | `createLiveStoreDb(schema)` factory — emits tables + events + materializers + makeSchema | ✅ | Shipped in `packages/livestore-prisma/src/createLiveStoreDb.ts`. Auto-derives `getKey` from `PRIMARY_KEY_COLUMNS`, soft-delete predicate from `SOFT_DELETE_COLUMNS`, per-field boolean toggle events from `TABLES[m].columns`. App uses it now (`src/livestore/schema.ts`). |
| 0.2 | `useTable(name)` hook — auto-creates `useLiveQuery` source per model | ✅ | Shipped in `packages/livestore-tanstack-db/src/useTable.ts`. App uses it (`src/db/todoCollection.ts`). Auto-derives `commitInsert/Update/Delete` from events. Supports `{ where, rpc, liveStore, noContext }`. Fixed 3 bugs during app migration (wrong event key lookup, missing boolean-toggle detection in `makeCommitUpdate`, handler keys `commitX` vs `onX`). |
| 0.3 | `useTable(name).insert/update/delete` that round-trips through LiveStore AND oRPC | ✅ | Shipped. `useTable('Todo', { rpc: { client, config } })` wires the oRPC config into `createMutations` (Tier 0.6). Direct calls to `todosCollection.update(id, draft => {...})` and `todosCollection.delete(id)` fire the auto-classified oRPC procedures (`posts.complete`, `posts.delete`, etc.) in addition to committing the LiveStore event. Both apps exercise this path: `useTable` → `onToggle` → `todosCollection.update(...)` → oRPC + LiveStore. |
| 0.4 | Prisma row type IS LiveStore row type IS TanStack DB row type | ✅ | Resolved via 2.3 — `prisma-effect-schema-generator@0.1.8` ships pre-wrapped `Schema.standardSchemaV1`, eliminating the boundary `as any` cast. |
| 0.5 | `useTable(name, { where: { ... } })` filtered collections | ✅ | Shipped. `useTable(name, { where })` pushes the filter into the LiveStore query and the TanStack DB `q.where(...)` so changing the filter invalidates both layers. Both apps use it (the `uiState.filter` is wired to `useTodoCollection({ where })` / `useTable('Todo', { where })`). The auto-derived `deletedAt: null` predicate (Tier 1.2) is still applied. |

## Tier 1 — quality of life that should "just work"

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1.1 | Auto-derive `getKey` from Prisma `@id` / `@@id` | 🚫 | Not planned. `getKey = (row) => row.id` stays hardcoded. |
| 1.2 | Auto-coerce soft-delete (`deletedAt: null` → live row) | ✅ | Shipped. `useTable` walks the table schema and auto-derives a `where: { [softDeleteCol]: null }` predicate. The walker matches field names against `/(deleted\|archived\|removed)/i` of `NullOr(...)` type, so `deletedAt`, `archivedAt`, `isDeleted` all work without configuration. |
| 1.3 | `useTable(name, { where })` server-side filter | ✅ | Shipped as part of 0.5 — `useTable(name, { where })` filters the LiveStore query server-side and propagates to TanStack DB's `q.where(...)`. Both apps use the `uiState.filter` (all/active/completed) via this path. |
| 1.4 | Bulk-import via `useTables({ teacherProfiles: { where }, lessons: { sort } })` | ✅ | Shipped in `useTable.ts` as `useTables(spec)`. Returns `{ [name]: Collection }`. Memoized via shared `collectionCache`. |
| 1.5 | `useTable(name).preload()` for TanStack Router loaders | ✅ | Shipped as `preloadTable(name, { liveStore })` — no React context required, returns `Promise<Collection>`. Works in TanStack Router loaders / scripts. |
| 1.6 | oRPC ↔ LiveStore write-back is generated, not handwritten | ✅ | Shipped in `packages/livestore-tanstack-db/src/mutations.ts`. `useTable(name, { rpc: { ns: { proc: { event?, map? } } } })` auto-classifies procedures by name (`createXxx` → insert, `xxxDelete` → delete, `updateXxx`/`setXxx` → update) and synthesizes the commitRow + RPC fire. Falls back to upsert-via-name for ambiguous procs (e.g. `rpc.teacher.updateOwnProfile`). |
| 1.7 | Bulk optimistic actions (`insert N rows` → single `v1.XBulkUpserted`) | ✅ | Shipped. `useCrud(name)` exposes `bulkInsert(rows)` and `bulkUpsert(rows)` which auto-generate missing `id`s and commit a single `v1.<Model>BulkUpserted { rows: T[] }` event. Auto-detected by `createLiveStoreDb` when the model opts in with `includeBulkUpserted: true`; falls back to per-row inserts when the event isn't present. `liveStoreCollectionOptions` routes `onInsert` to `onBulkInsert` when the transaction has multiple mutations. **Bug fix in SPA demo**: `makeCommitInsert` / `makeCommitDelete` in `useTable.ts` were reading `input.row` / `input.id` from a `{ row }` / `{ id }` wrapper, but the caller passes the raw row directly — fixed to take a raw row. The Header has a `single · v1.TodoCreated` vs `bulk · v1.TodoBulkUpserted` toggle so the user can compare both paths. |

## Tier 2 — quality of life that should be free

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 2.1 | Lazy db proxy: `import { teacherProfiles }` keeps working post-migration | ✅ | Top 3 #3. **`createLazyDb(tables, options)` in `src/integration/lazyDb.ts`**, **`useDb()` in `src/integration/useDb.tsx`**, re-exported from `src/integration/index.ts`. The proxy resolves `db.<tableKey>` to a TanStack DB `Collection` (via `useTable`) when accessed inside any React render / event handler / effect (detected via `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current`), and to a Promise-based `LoaderProxy` (`preload()` / `findAll()` / `findOne()` / `insert()` / `update()` / `delete()`) when accessed outside React (TanStack Router loaders, Cloudflare Worker handlers, scripts). Server-only tables (LiveStore's `events` audit log, configured via `serverOnly: ['events']`) throw on access with a clear remediation hint. Model names are inferred from `events[*].name` so the consumer's `db.ts` stays at ~10 lines instead of 186. Pilot use case: `alkitab-alhakeem` can rewrite `import { useTeacherProfilesCollection } from "@/lib/db-client"` to `import { teacherProfiles } from "@/livestore-prisma/db"`, eliminating `scripts/refactor-db-client-hooks.ts` entirely. |
| 2.2 | Auto-injection of hook calls via TS transformer | 🚫 | Out of scope; would need a custom AST transform. Use 2.1 instead. |
| 2.3 | Emit `Schema.standardSchemaV1(...)` in the generator | ✅ | Already shipped upstream in `prisma-effect-schema-generator@0.1.5+`. We bumped to `0.1.8`. The `standardSchemaV1 = "true"` flag in `schema.prisma` makes the generated `TodoSchema` / `EventSchema` come pre-wrapped, removing the Tier 0.4 `as any` cast that was previously needed. |
| 2.4 | `useLiveQuery` with `select` projection returning RefProxy | ✅ | Verified in `MainSection.tsx` — `q.from({ todo: todos }).select(({ todo }) => ({ id: todo.id, text: todo.text }))` narrows the type to `{ id: string; text: string; ... }[]`. TanStack DB returns a RefProxy with `$synced`/`$origin`/`$key`/`$collectionId` metadata alongside the projected fields. |
| 2.5 | Re-export `useLiveQuery` etc. from the integration | ✅ | Re-exported from `packages/livestore-tanstack-db/src/index.ts`. |
| 2.6 | Codemod `createTableMigration(from: "electric", ...)` | 🚫 | Not building. |
| 2.7 | Combined LiveStore + TanStack DB Devtools | ✅ | **Shipped.** `livestore-tanstack-db/devtools` subpath exposes `liveStoreDevtoolsPlugin()` for `<TanStackDevtools>`, plus `useLiveStoreDevtoolsBridge(store)` that wires the LiveStore store + every TanStack DB collection into a typed devtools bus. Panel renders three sections: session sync status, per-collection TanStack DB status (`idle / loading / ready / error / cleaned-up`), and a 500-entry local commit log (with pending + synced seqNums + timestamps). Coexists with the existing `@livestore/devtools-vite` panel. |
| 2.8 | Hot-reload-safe: editing `schema.prisma` regenerates Effect + LiveStore + TanStack types in one go | ✅ | Shipped. Workspace-root `bun run gen` runs both apps' Prisma generators (upstream `effect_client` + in-repo `livestore`) + rebuilds the integration packages. Narrower scripts: `gen:spa` (spa only) and `gen:start-orpc` (tanstack-start-orpc only). Documented in README. |

## Tier 3 — "would be really nice"

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 3.1 | Single `<LiveStoreProvider schema={...} oRPC={...}>` | ✅ | Shipped. `LiveStoreProvider.schema` accepts the full `createLiveStoreDb(...)` shape (or the bare `makeSchema(...)` output). The `as unknown as ...` cast is gone from the tanstack-start-orpc example. Internally `useTable` reads `tables` / `events` / `schema` from the wider context. `oRPC` is optional and auto-derives into `useTable(name, { rpc: { config } })` calls. |
| 3.2 | `alchemy.run.ts` Cloudflare Worker template emitted alongside the schema | 🚫 | Not planned. Working template stays at `alchemy.run.ts`; no separate `cloudflare-template/` extraction. |
| 3.3 | `prisma db push` ↔ wrangler D1 migrations round-trip | 🚫 | Not planned. |
| 3.4 | Per-row access control on LiveStore side | 🚫 | Out of scope; auth lives in the oRPC layer. |
| 3.5 | Schema diff tool that emits `v1.<Table>Migrated` events for column adds | 🚫 | Out of scope; will be in 4.x async layer. |
| 3.6 | `useCrud(name)` hook | ✅ | Shipped in `packages/livestore-tanstack-db/src/useCrud.ts`. `const [c, { create, update, remove }] = useCrud<PostRow>('Post')`. `create` auto-generates `id` via `crypto.randomUUID()`, `update` supports both partial merge and draft-mutation forms, `remove` takes id. Built on top of `useTable`, inherits all its options. |

## Tier 4 — "the dream"

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 4.1 | `bun live:gen` reads schema, regenerates everything | ✅ | Shipped as `bun run gen` (the dream-list's `bun live:gen` name). The single command chains `gen:spa` + `gen:start-orpc` + `bun run build`, regenerating Effect schemas + LiveStore table defs + rebuilding the integration packages in one go. Add a Prisma model, run `bun run gen`, and the new collection is available everywhere. |
| 4.2 | Full SSR with `<HydrationBoundary>`-style events injection | 🚫 | Out of scope. |
| 4.3 | Versioned schema migrations (`v2.X` events co-existing with `v1.X`) | 🚫 | Out of scope. |
| 4.4 | Cross-collection reactive joins | ⏳ | TanStack DB supports this; need the type alignment (0.4). |

---

## Open questions / decisions

1. **Tier 0.4 type alignment** — `Schema.Any` vs `Schema.AnyNoContext` mismatch
   breaks `createCollection({ schema })` directly. Three paths:
   - (a) Upstream generator wraps with `Schema.standardSchemaV1(...)` (Tier 2.3)
   - (b) Factory casts (`as any`) at the boundary; runtime is fine
   - (c) Middleware inside the integration that coerces `Context = never`

   Currently doing (b). Plan: ship (a) upstream once we have a use case
   outside this repo.

2. **Generator options to ask upstream about** — propose the following
   options on `prisma-effect-schema-generator`:
   - `idColumn` — explicit declaration so we don't have to guess
   - `softDeleteColumn` (e.g. `"deletedAt"`) — explicit declaration
   - `emitStandardSchema` — boolean, default `false` in v1, opt-in
   - `relationColumns` — currently skipped; consider emitting
     `Schema.Struct` per relation for downstream composability

---

## Concrete shape — what 0.6 looks like in real code

Pilot source: `alkitab-alhakeem/apps/web/src/lib/db-client.ts:80-90, 130-150, 195-215`.

```ts
// Today (manual, × 17):
useTeacherProfilesCollection = () => {
  const store = useStore()
  return useMemo(() => createCollection(
    liveStoreCollectionOptions<TeacherProfile>({
      id: "teacherProfiles", store,
      query: allTeacherProfiles$,
      commitUpdate: (original, changes) => {
        const merged = { ...original, ...changes }
        commitRow(store, "teacherProfileUpserted", { row: merged })
        void rpc.teacher.updateOwnProfile({
          bio: merged.bio ?? null,
          specialization: merged.specialization ?? null,
        })
      },
    }),
  ), [store])
}

// With Tier 0.6 — declarative, no callback boilerplate:
useTeacherProfilesCollection = () =>
  useTable("TeacherProfile", {
    rpc: {
      teacher: {
        updateOwnProfile: { map: row => row },
      },
    },
  })
```

API surface we're targeting:

```ts
useTable<TModel>(name, {
  rpc?: { [namespace]: { [procedure]: { map?: (row, original?) => any } } },
  where?: { ... },
  sort?: { ... },
})
```

The factory auto-synthesizes:
- `commitInsert → store.commit(events[`v1.${T}Created`]) + rpc.ns.proc({...row})`
- `commitUpdate → store.commit(events[`v1.${T}Upserted`]) + rpc.ns.proc({...original, ...changes})`
- `commitDelete → rpc.ns.proc.delete({id})`

Agent 1's `createLiveStoreDb` already returns `{ tables, events, materializers, schema }`. Tier 0.6 just needs a `mutations` parameter on `createCollection` (or a parallel `createTableOptions` factory) that wires the oRPC handlers on top of the existing `liveStoreCollectionOptions` adapter.

---

## Files in this repo

| Path | Status |
|------|--------|
| `packages/livestore-prisma/src/createLiveStoreDb.ts` | ✅ Tier 0.1 — factory emits tables/events/materializers/schema from generator output |
| `packages/livestore-prisma/src/standardSchema.ts` | ✅ Tier 2.3 — `Schema.standardSchemaV1(...)` wrap + LiveStore schema coercion |
| `packages/livestore-prisma/src/types.ts` | ✅ Generator-introspection types (`ColumnDescriptor`, `TableDescriptor`, `PrimaryKeyColumns`, etc.) |
| `packages/livestore-prisma/src/generator.ts` | ✅ In-repo `prisma-livestore-generator` binary |
| `packages/livestore-tanstack-db/src/useTable.ts` | ✅ Tier 0.2/0.3/0.5/1.3/1.6 — TanStack DB glue + `useTable` / `useTables` / `preloadTable` |
| `packages/livestore-tanstack-db/src/useCrud.ts` | ✅ Tier 3.6 — `useCrud(name)` CRUD helper |
| `packages/livestore-tanstack-db/src/mutations.ts` | ✅ Tier 1.6 — oRPC procedure classification + mutation auto-wiring |
| `packages/livestore-tanstack-db/src/lazyDb.ts` | ✅ Tier 2.1 — `createLazyDb(tables, options)` proxy + `LoaderProxy` |
| `packages/livestore-tanstack-db/src/LiveStoreProvider.tsx` | ✅ Tier 3.1 — `<LiveStoreProvider>` + `useLiveStoreConfig` |
| `packages/livestore-tanstack-db/src/devtools/` | ✅ Tier 2.7 — LiveStore + TanStack DB devtools panel |
| `examples/spa/` | ✅ SPA demo using `livestore-prisma` + `livestore-tanstack-db` |
| `examples/tanstack-start-orpc/` | ✅ TanStack Start + oRPC demo |
| `cloudflare-template/` | ✅ Agent 4's Cloudflare Worker template directory |
| `alchemy.run.ts` | ✅ Working Cloudflare Worker template (Tier 3.2 source) |

---

## Open PRs to upstream

We should file a PR against `Cyberistic/Prisma-Effect-Schema-Generator` adding:

1. `idColumn` flag (default `null`, autodetects from `@id`/`@@id`)
2. `softDeleteColumn` flag (default `null`, autodetects `deletedAt` of `DateTime?`)
3. `emitStandardSchema: boolean` flag — wraps every generated schema with `Schema.standardSchemaV1(...)` so downstream `createCollection({ schema })` works without a cast.
4. Emits a `tables: Record<string, TableDef>` map keyed by model name so consumers can iterate.

These are all schema-introspection changes (no LiveStore coupling). Alchemy v2's stdlib calls them out as the missing features in §"Open questions" of todo.md.
