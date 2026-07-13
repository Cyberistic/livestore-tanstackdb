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
- **`@cyberistic/livestore-prisma`** (this repo, to be published)
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
| 0.3 | `useTable(name).insert/update/delete` that round-trips through LiveStore AND oRPC | ⏳ | Needs 0.6 plumbing + an oRPC integration helper. |
| 0.4 | Prisma row type IS LiveStore row type IS TanStack DB row type | 🚧 | Known issue: Schema.Any → Schema.AnyNoContext variance. Factory currently casts through `as any`. Long-term: upstream `Schema.standardSchemaV1` wrap would remove the cast. |
| 0.5 | `useTable(name, { where: { ... } })` filtered collections | ⏳ | Should "just work" once 0.2 lands because TanStack DB's `where()` is the underlying mechanism. |

## Tier 1 — quality of life that should "just work"

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1.1 | Auto-derive `getKey` from Prisma `@id` / `@@id` | ⏳ | We hardcode `getKey = (row) => row.id` everywhere today. Detected by walking `Schema.ast.propertySignatures` looking for the `isPrimaryKey` marker. If upstream Schema.standardSchemaV1 is present, look up via the property's `meta._id`. |
| 1.2 | Auto-coerce soft-delete (`deletedAt: null` → live row) | ⏳ | Default predicate: row.`deletedAt` is null/undefined. Auto-detect by looking for a field named `deletedAt` of type `Schema.NullOr(Schema.Date)`. |
| 1.3 | `useTable(name, { where })` server-side filter | ⏳ | Combines 0.2 + 1.5 below. |
| 1.4 | Bulk-import via `useTables({ teacherProfiles: { where }, lessons: { sort } })` | ✅ | Shipped in `useTable.ts` as `useTables(spec)`. Returns `{ [name]: Collection }`. Memoized via shared `collectionCache`. |
| 1.5 | `useTable(name).preload()` for TanStack Router loaders | ✅ | Shipped as `preloadTable(name, { liveStore })` — no React context required, returns `Promise<Collection>`. Works in TanStack Router loaders / scripts. |
| 1.6 | oRPC ↔ LiveStore write-back is generated, not handwritten | ✅ | Shipped in `packages/livestore-tanstack-db/src/mutations.ts`. `useTable(name, { rpc: { ns: { proc: { event?, map? } } } })` auto-classifies procedures by name (`createXxx` → insert, `xxxDelete` → delete, `updateXxx`/`setXxx` → update) and synthesizes the commitRow + RPC fire. Falls back to upsert-via-name for ambiguous procs (e.g. `rpc.teacher.updateOwnProfile`). |
| 1.7 | Bulk optimistic actions (`insert N rows` → single `v1.XBulkUpserted`) | ⏳ | Build on top of 0.3. |

## Tier 2 — quality of life that should be free

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 2.1 | Lazy db proxy: `import { teacherProfiles }` keeps working post-migration | ✅ | Top 3 #3. **`createLazyDb(tables, options)` in `src/integration/lazyDb.ts`**, **`useDb()` in `src/integration/useDb.tsx`**, re-exported from `src/integration/index.ts`. The proxy resolves `db.<tableKey>` to a TanStack DB `Collection` (via `useTable`) when accessed inside any React render / event handler / effect (detected via `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current`), and to a Promise-based `LoaderProxy` (`preload()` / `findAll()` / `findOne()` / `insert()` / `update()` / `delete()`) when accessed outside React (TanStack Router loaders, Cloudflare Worker handlers, scripts). Server-only tables (LiveStore's `events` audit log, configured via `serverOnly: ['events']`) throw on access with a clear remediation hint. Model names are inferred from `events[*].name` so the consumer's `db.ts` stays at ~10 lines instead of 186. Pilot use case: `alkitab-alhakeem` can rewrite `import { useTeacherProfilesCollection } from "@/lib/db-client"` to `import { teacherProfiles } from "@/cyberistic/livestore-prisma/db"`, eliminating `scripts/refactor-db-client-hooks.ts` entirely. |
| 2.2 | Auto-injection of hook calls via TS transformer | 🚫 | Out of scope; would need a custom AST transform. Use 2.1 instead. |
| 2.3 | Emit `Schema.standardSchemaV1(...)` in the generator | ⏳ | Depends on upstream `prisma-effect-schema-generator` shipping a flag. Open a PR against `Cyberistic/Prisma-Effect-Schema-Generator`. Without it, call sites have to wrap with `Schema.standardSchemaV1(...)`. |
| 2.4 | `useLiveQuery` with `select` projection returning RefProxy | ⏳ | TanStack DB supports it; need to make sure the Effect schema flows through `q.from({ x: useTable("X") }).select(...)` correctly. |
| 2.5 | Re-export `useLiveQuery` etc. from the integration | ✅ | Re-exported from `packages/livestore-tanstack-db/src/index.ts`. |
| 2.6 | Codemod `createTableMigration(from: "electric", ...)` | 🚫 | Not building. |
| 2.7 | Combined LiveStore + TanStack DB Devtools | ✅ | **Shipped.** `@cyberistic/livestore-tanstack-db/devtools` subpath exposes `liveStoreDevtoolsPlugin()` for `<TanStackDevtools>`, plus `useLiveStoreDevtoolsBridge(store)` that wires the LiveStore store + every TanStack DB collection into a typed devtools bus. Panel renders three sections: session sync status, per-collection TanStack DB status (`idle / loading / ready / error / cleaned-up`), and a 500-entry local commit log (with pending + synced seqNums + timestamps). Coexists with the existing `@livestore/devtools-vite` panel. |
| 2.8 | Hot-reload-safe: editing `schema.prisma` regenerates Effect + LiveStore + TanStack types in one go | ⏳ | `bun prisma generate` already does Effect. LiveStore tables + TanStack collections need a co-compiler step. |

## Tier 3 — "would be really nice"

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 3.1 | Single `<LiveStoreProvider schema={...} oRPC={...}>` | ⏳ | Wraps `StoreRegistryProvider` + provider for `useAppStore` + per-table collection provider. |
| 3.2 | `alchemy.run.ts` Cloudflare Worker template emitted alongside the schema | ⏳ | We already have a working template in `alchemy.run.ts` here. Extract into a `cloudflare-template/` directory. |
| 3.3 | `prisma db push` ↔ wrangler D1 migrations round-trip | ⏳ | Currently unhooked. Could be a `bun prisma migrate diff` + `wrangler d1 migrations apply` script. |
| 3.4 | Per-row access control on LiveStore side | 🚫 | Out of scope; auth lives in the oRPC layer. |
| 3.5 | Schema diff tool that emits `v1.<Table>Migrated` events for column adds | 🚫 | Out of scope; will be in 4.x async layer. |
| 3.6 | `useCrud(name)` hook | ✅ | Shipped in `packages/livestore-tanstack-db/src/useCrud.ts`. `const [c, { create, update, remove }] = useCrud<PostRow>('Post')`. `create` auto-generates `id` via `crypto.randomUUID()`, `update` supports both partial merge and draft-mutation forms, `remove` takes id. Built on top of `useTable`, inherits all its options. |

## Tier 4 — "the dream"

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 4.1 | `bun live:gen` reads schema, regenerates everything | ⏳ | Top 3 culmination. |
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
| `src/integration/createLiveStoreDb.ts` | 🚧 Factory — emits tables/events/materializers/schema from generator output. `commitRow`-style oRPC write-back not yet wired. |
| `src/integration/useTable.ts` | ⏳ TanStack DB glue — drafted, needs keying fix + lazy store per Agent 1's `camelToSnake` table keys |
| `src/integration/lazy-db.ts` | ⏳ Tier 2.1 — `import { X } from "@/lib/db"` proxy that resolves to the right `useXCollection()` |
| `src/integration/LiveStoreProvider.tsx` | ⏳ |
| `src/integration/standardSchema.ts` | ⏳ `Schema.standardSchemaV1(...)` wrap (Tier 2.3) |
| `src/livestore/schema.ts` | existing 89-line → now ~36 lines via the factory (Agent 1's commit `a949f05c`) |
| `alchemy.run.ts` | working Cloudflare Worker template (Tier 3.2 source) |
| `cloudflare-template/` | ⏳ Agent 4's template directory |

---

## Open PRs to upstream

We should file a PR against `Cyberistic/Prisma-Effect-Schema-Generator` adding:

1. `idColumn` flag (default `null`, autodetects from `@id`/`@@id`)
2. `softDeleteColumn` flag (default `null`, autodetects `deletedAt` of `DateTime?`)
3. `emitStandardSchema: boolean` flag — wraps every generated schema with `Schema.standardSchemaV1(...)` so downstream `createCollection({ schema })` works without a cast.
4. Emits a `tables: Record<string, TableDef>` map keyed by model name so consumers can iterate.

These are all schema-introspection changes (no LiveStore coupling). Alchemy v2's stdlib calls them out as the missing features in §"Open questions" of todo.md.

---

## Files in this repo

| Path | Status |
|------|--------|
| `src/integration/createLiveStoreDb.ts` | 🚧 Factory — drafts the schema/events/materializers from generator output |
| `src/integration/useTable.ts` | ⏳ TanStack DB glue |
| `src/integration/LiveStoreProvider.tsx` | ⏳ |
| `src/integration/lazyDb.ts` | ✅ Tier 2.1 — `createLazyDb(tables, options)` proxy + `LoaderProxy` shape |
| `src/integration/useDb.tsx` | ✅ Tier 2.1 — `useDb(name)` hook (thin wrapper over `useTable`) |
| `src/livestore/schema.ts` | existing 89-line hand-rolled — to be replaced by the factory |
| `alchemy.run.ts` | working Cloudflare Worker template (Tier 3.2 source) |
