the feature list for the Prisma → LiveStore → TanStack DB ideal plug-and-play experience:
Desired out-of-the-box features for prisma → livestore → tanstack-db
A "drop this in and it works" stack should need zero glue code at the call site. The features below are the things I had to hand-roll or work around during this migration; in priority order.
Tier 0 — must work on day one, no glue code at the call site
#	Feature	Why it matters
0.1	createLiveStoreDb(schema) factory that takes the prisma-effect-schema-generator output and emits the entire tables + events + materializers + makeSchema block	350 lines of as const boilerplate per app today
0.2	useTable(name) hook that auto-creates a strongly-typed useLiveQuery source for any Prisma model — no manual liveStoreCollection + createCollection + useMemo per collection	Today: ~17 hand-written hooks, each ~30 lines
0.3	useTable(name).insert / update / delete that round-trips through LiveStore AND the oRPC server in one call, with a single declarative config object (no commitRow + rpc.teacher.foo() in 17 places)	Today: 17 ad-hoc commitAndFire / commitDeleteAndFire blocks
0.4	The Prisma row type IS the LiveStore row type IS the TanStack DB row type, with zero as any / as never / Schema.Schema.Type<...> aliasing	Today: TIn[string] doesn't narrow to string because the schema standardisation chain breaks
0.5	Same import shape works for getThreadMessages(threadId)-style filtered collections — derived from the base table with where() in a single hook call	Today: per-thread collection needs a separate useThreadMessagesForThread factory
Tier 1 — should "just work" once the integration is in place
#	Feature	Why it matters
1.1	Auto-derived getKey from the Prisma @@id / @id — no more getKey = (row) => row.id boilerplate	17× boilerplate today
1.2	Auto-derived coerce for soft-deleted rows (default: treat deletedAt: null as live)	Every call site currently passes the same predicate
1.3	useTable(name, { where: { ... } }) server-side filter that becomes a LiveStore tables.x.where({ ... }) AND a TanStack DB q.where(...) in one call	The getThreadMessages pattern is everywhere
1.4	Bulk-import a collection via useTables({ teacherProfiles: { where: { ... } }, lessons: { sort: 'desc' } }) that returns all of them memoised in one hook	60+ files today each do useXxxCollection() 1-3 times
1.5	useTable(name).preload() that works in TanStack Router loaders (loaderDeps + await Promise.all(collections.map(c => c.preload()))) without needing the store provider in the loader	Today: db-client.ts collections can't be touched in loaders
1.6	The oRPC ↔ LiveStore write-back is generated, not handwritten — createLiveStoreDb({ schema, rpc: { teacher: { createLesson: { event: "lessonUpserted" } } } })	17 handwritten commitAndFire blocks today
1.7	createOptimisticAction-style bulk mutations that turn collection.insert N rows into a single v1.XBulkUpserted event	Today: 1 event per row = N round-trips
Tier 2 — quality-of-life that should be free
#	Feature	Why it matters
2.1	useLiveQuery((q) => q.from({ x: useTable("X") })) should not require useTable to be called inside the component — i.e. collections should be lazily initialised from a module-level store ref so top-level import { teacherProfiles } keeps working	Today: 60+ files had to be edited to switch to hooks
2.2	Auto-injection of hook calls into every component in a file (Babel/TS transformer) so consumers never see the boilerplate	Today: mechanical migration script + manual fixes for 37 files
2.3	Standard Schema out of the box — prisma-effect-schema-generator should emit Schema.standardSchemaV1(...) by default so CollectionConfig.schema works without a wrapper	Today: Effect Schema.standardSchemaV1 exists but the generator doesn't wrap
2.4	useLiveQuery with a select projection that returns a RefProxy so call sites can do q.from({ x: useTable("X") }).where(({ x }) => eq(x.col, v)).select(({ x }) => ({ id: x.id, name: x.name }))	TanStack DB supports it; the Effect schema needs to flow through
2.5	Re-export useLiveQuery, useLiveSuspenseQuery, useLiveInfiniteQuery from the integration so consumers don't need to know which package owns them	Less @tanstack/react-db import noise
2.6	**A `createTableMigration(from: "electric"	"electricCollectionOptions", table: ...)` codemod** for projects migrating off Electric
2.7	Devtools panel showing the LiveStore event log + the LiveStore ↔ TanStack DB sync state per collection	The TanStack DB Devtools only knows about its own state; LiveStore has its own panel — they should be one view
2.8	Hot-reload-safe: editing schema.prisma and re-running bun prisma generate updates the Effect schemas AND the LiveStore tables AND the TanStack DB collection row types in one go, with no consumer code changes	Today: each column change needs a regeneration + typecheck run
Tier 3 — "would be really nice"
#	Feature	Why it matters
3.1	<LiveStoreProvider schema={prismaSchema} oRPC={orpcClient}> single component that wires StoreRegistryProvider + useAppStore + every per-table useTable provider	Today: 3 layers of provider + a worker import + a sync URL
3.2	Cloudflare Worker template generated alongside the schema: alchemy.run.ts (D1 binding + Durable Object + WS sync) — we already have this in alchemy.run/ but it should be a single command	The "no docker, just CF Workers" promise
3.3	prisma db push → wrangler d1 migrations apply round-trip with the schema diff generator so the LiveStore DDL stays in sync with Prisma's DDL	The D1 layer is currently unhooked from the Prisma migrations
3.4	Per-row access control on the LiveStore side — useTable("lessons", { where: ({ studentId }) => eq(studentId, currentUserId) }) that ALSO becomes a server-side where clause in the Electric-shape equivalent on the Durable Object	Today: every client gets every row, filtered client-side
3.5	Schema diff tool that detects when a Prisma column was added/removed and emits the matching v1.<Table>Migrated event so existing clients can ALTER TABLE their local SQLite	Today: adding a column is a breaking change for cached clients
3.6	A single useCrud("lessons") hook that gives you [collection, { create, update, remove }] with full type inference — i.e. create({ title, order }) is typed and id is optional	Eliminates the entire commitUpdate/commitInsert/commitDelete 3-method surface
Tier 4 — "the dream"
#	Feature	Why it matters
4.1	"Add a Prisma model, get a full LiveStore collection" — single command bun live:gen reads the schema, regenerates everything (Effect schemas, LiveStore tables/events, TanStack DB collection types, oRPC mutation adapters, tests, and Cloudflare Worker routing)	True plug-and-play
4.2	Full SSR — preload() in a TanStack Start loader that hydrates the LiveStore on the client via a single __livestore_events injection (like <HydrationBoundary>)	Today: ssr: false everywhere; PWA can't render until JS loads
4.3	Versioned schema migrations that produce v2.X events that coexist with v1.X until every client upgrades	The "we can never change a column" trap
4.4	Cross-collection join ergonomics — q.from({ s: students }).join({ u: users }, ...).where(({ s, u }) => eq(s.userId, u.id)) should work with the same useLiveQuery API but with cross-collection reactive updates	Already supported by TanStack DB, but the Effect schema standardisation makes the types T[string] instead of User.name
Top 3 we'd want first
If I had to pick only three to ship a great DX in v0:
0.1 + 0.2 — createLiveStoreDb(schema) + useTable(name) eliminate the 350 + 17×30 = ~850 lines of glue per app.
0.6 — Auto-derive the commitInsert/Update/Delete from a { rpc: { teacher: { createLesson: "lessonUpserted" } } } config; this removes the second-biggest source of boilerplate.
2.1 — A lazy db proxy that auto-resolves db.teacherProfiles to the right useTeacherProfilesCollection()-style result, so existing import { foo } call sites keep working. This is the single thing that would have made the Electric → LiveStore migration a non-event.