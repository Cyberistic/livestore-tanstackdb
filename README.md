


# LiveStore × TanStack DB + (bonus Prisma-Effect-Generator)
https://github.com/user-attachments/assets/83bebbe2-2a50-4f1b-9add-536811eb756b

An end-to-end demo of the [LiveStore](https://livestore.dev) sync engine wired into [TanStack DB](https://tanstack.com/db) collections.

To test locally: `bunx prisma generate` then `bun run dev` 
To deploy, `alchemy login` to point to your cloudflare account then run `bun run deploy`


## Why
LiveStore already owns the "sync engine" role: its own local SQLite store, its own optimistic state, its own WebSocket transport. TanStack DB adds a second, much faster reactive layer on top, with a better API (imo) and `useLiveQuery` ergonomics. 

##  Bonus
Small Prisma to Effect Generator, which livestore consumes! (because I love the way prisma schemas work). Write your db schema in prisma, run `bunx prisma generate` which auto-generates the Effect schema, point livestore to it and you're good to go.

**Prisma schema** as the source of truth for both the Cloudflare D1 audit log and the LiveStore materialisers. The whole stack, D1, Durable Object, and Worker, is provisioned by [Alchemy](https://alchemy.run).



## Using this setup in your own project

### Packages

```bash
bun add -D prisma-effect-schema-generator
```

### 1. Prisma schema + Effect Schema generator

```prisma
// prisma/schema.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

generator effect_client {
  provider = "prisma-effect-schema-generator"
  output   = "./generated/client-schemas/index.ts"
}

generator effect_tables {
  provider = "prisma-effect-schema-generator"
  output   = "./generated/client-schemas/tables.ts"
  tables   = "true"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Post {
  id        String    @id @default(cuid())
  title     String
  body      String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  @@map("posts")
}
```

Generate schemas:

```bash
bunx prisma generate
# creates prisma/generated/client-schemas/index.ts (Effect Schemas)
# creates prisma/generated/client-schemas/tables.ts  (LiveStore table descriptors)
```

### 2. LiveStore schema

```ts
// src/livestore/schema.ts
import { createLiveStoreDb } from '@cyberistic/livestore-prisma'
import { Schema } from 'effect'
import { Events, State } from '@livestore/livestore'

// Generated tables (from prisma-effect-schema-generator)
import { TABLES, PRIMARY_KEY_COLUMNS, SOFT_DELETE_COLUMNS } from '../../prisma/generated/client-schemas/tables.ts'
// Generated schemas (from prisma-effect-schema-generator)
import { PostSchema } from '../../prisma/generated/client-schemas/index.ts'

export const tables = createLiveStoreDb({
  tables: TABLES,
  primaryKeyColumns: PRIMARY_KEY_COLUMNS,
  softDeleteColumns: SOFT_DELETE_COLUMNS,
})

export const events = {
  postCreated: Events.synced({
    name: 'v1.PostCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String, body: Schema.String }),
  }),
  postUpdated: Events.synced({
    name: 'v1.PostUpdated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.optional(Schema.String) }),
  }),
  postDeleted: Events.synced({
    name: 'v1.PostDeleted',
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
  }),
} as const

const materializers = State.SQLite.materializers(events, {
  'v1.PostCreated': ({ id, title, body }) =>
    tables.Post.insert({ id, title, body, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }),
  'v1.PostUpdated': ({ id, ...rest }) =>
    tables.Post.update({ ...rest, updatedAt: new Date() }).where({ id }),
  'v1.PostDeleted': ({ id, deletedAt }) =>
    tables.Post.update({ deletedAt }).where({ id }),
})

export const schema = State.makeSchema({ tables, materializers })
```

### 3. Store setup

```ts
// src/livestore/store.ts
import { makePersistedAdapter } from '@livestore/adapter-web'
import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider, useStore } from '@livestore/react'

import { schema } from './schema.ts'

const adapter = makePersistedAdapter({ storage: { type: 'opfs' } })

export const storeRegistry = new StoreRegistry({
  defaultOptions: { batchUpdates },
})

export const storeOptions = {
  storeId: 'my-app',
  schema,
  adapter,
} as const

export const useAppStore = () => useStore(storeOptions)
export { StoreRegistryProvider }
```

### 4. TanStack DB collection

```ts
// src/db/postCollection.ts
import { createCollection } from '@tanstack/db'
import { liveStoreCollectionOptions } from '@cyberistic/livestore-tanstack-db'
import { useAppStore } from '../livestore/store.ts'
import { events, tables } from '../livestore/schema.ts'

import type { Post } from '../db/postSchema.ts'

export const usePostCollection = () => {
  const store = useAppStore()

  return createCollection(
    liveStoreCollectionOptions({
      id: 'posts',
      store,
      query: queryDb(tables.Post.where({ deletedAt: null })),
      getKey: (item) => item.id,
      onInsert: ({ transaction }) => {
        for (const m of transaction.mutations) {
          store.commit(events.postCreated(m.modified))
        }
      },
      onUpdate: ({ transaction }) => {
        for (const m of transaction.mutations) {
          store.commit(events.postUpdated({ id: m.original.id, ...m.changes }))
        }
      },
      onDelete: ({ transaction }) => {
        for (const m of transaction.mutations) {
          store.commit(events.postDeleted({ id: m.original.id, deletedAt: new Date() }))
        }
      },
    }),
  )
}
```

### 5. `useTable(name)` — the recommended path (Tier 0.2)

The hand-written `usePostCollection` in step 4 is the lower-level
`liveStoreCollectionOptions` API. Most apps want `useTable(name)`
instead — it auto-derives `getKey`, the soft-delete predicate, and
the commit handlers from the `createLiveStoreDb` schema:

```tsx
// src/db/postCollection.ts
import { useMemo } from 'react'
import { useTable } from '@cyberistic/livestore-tanstack-db'

import { useAppStore } from '../livestore/store.ts'
import { events, schema, tables } from '../livestore/schema.ts'

export const usePostCollection = () => {
  const store = useAppStore()
  // `liveStore` bundles the store + tables + events + schema in one
  // object. Pass it explicitly to skip the <LiveStoreProvider> lookup.
  const liveStore = useMemo(
    () => ({ store, tables, events, schema }),
    [store],
  )
  const { collection } = useTable('Post', { liveStore })
  return collection
}
```

What `useTable` auto-derives for you:

- **`getKey`** — read from the schema's primary-key column. The schema
  walker looks for an `isPrimaryKey: true` annotation on the
  property signatures (set by upstream `prisma-effect-schema-generator`
  when `emitPrimaryKeyMarker: true`), falls back to a field whose
  name ends in `Id`, and finally to `'id'`.
- **Soft-delete predicate** — walks the schema for a column matching
  `/(deleted|archived|removed)/` of `NullOr(...)` type, builds
  `tables[name].where({ [col]: null })`. No need to pass
  `where: { deletedAt: null }` on every call site.
- **`commitInsert/Update/Delete`** — derived from the events emitted
  by `createLiveStoreDb`: insert → `v1.<Model>Created`, delete →
  `v1.<Model>Deleted`, update → auto-detected per-field boolean
  toggles (`v1.<Model><Field>Completed` / `Uncompleted`) or
  `v1.<Model>Upserted`.

#### Filtered collections — `useTable(name, { where })`

Pass `where` to override or add to the auto-derived predicate:

```tsx
// Active posts only (overrides the deletedAt filter)
const activePosts = useTable('Post', {
  liveStore,
  where: { deletedAt: null, draft: false },
})
```

The `where` becomes both the LiveStore `tables.Post.where(...)` query
and a TanStack DB `q.where(...)` in one call.

#### Bulk — `useTables({ Post: {...}, Comment: {...} })`

Memoise many collections in one hook (Tier 1.4):

```tsx
const { Post, Comment } = useTables({
  Post: { liveStore },
  Comment: { liveStore, where: { deletedAt: null } },
})
```

#### Loaders — `preloadTable(name, { liveStore })`

Use outside a React tree — TanStack Router loaders, Cloudflare Worker
handlers, scripts. Returns a `Collection` directly (sync, no Suspense):

```ts
// In a TanStack Router loader
export const Route = createFileRoute('/posts')({
  loader: ({ deps }) => {
    const collection = preloadTable('Post', { liveStore })
    // Optional: wait for first sync before returning
    return collection.preload()
  },
  component: PostList,
})
```

#### Single-call CRUD — `useCrud(name)`

Tier 3.6 — wraps `useTable` and returns
`[collection, { create, update, remove }]` with auto-generated
`id`s and full type inference:

```tsx
const [posts, { create, update, remove }] = useCrud<PostRow>('Post')

// `create` makes `id` optional — auto-generated via crypto.randomUUID()
create({ title: 'hello', body: 'world' })
create({ id: 'fixed', title: '...', body: '...' })  // explicit id

// `update` accepts either a partial or a draft-mutation callback
update(post.id, { title: 'new' })
update(post.id, (draft) => { draft.title = 'new' })

// `remove` takes the id
remove(post.id)
```

### 6. RPC write-back (Tier 0.6)

For apps that need to round-trip mutations through a server, `useTable`
accepts an RPC config. The adapter you choose depends on your RPC
library:

- **oRPC** and direct-call clients: use `createORPCAdapter`.
- **tRPC**: use `createTRPCAdapter` (wraps `proc.mutate(input)`).

Both return the same normalized `RpcClient` shape that `useTable`
consumes.

#### oRPC

```tsx
import { createORPCAdapter } from '@cyberistic/livestore-tanstack-db'

const lessons = useTable('Lesson', {
  liveStore,
  rpc: {
    client: createORPCAdapter(orpc, { namespaces: ['teacher'] }),
    config: {
      teacher: {
        createLesson: {},            // auto-classified as `insert`
        updateLesson: {},            // auto-classified as `update`
        deleteLesson: {},            // auto-classified as `delete`
        // upsert-style proc — fires on both insert AND update
        upsertLesson: { event: 'lessonUpserted' },
        // explicit map: translate the row into the rpc input shape
        updateOwnProfile: { map: (row) => ({ bio: row.bio }) },
      },
    },
  },
})
```

#### tRPC

```tsx
import { createTRPCAdapter } from '@cyberistic/livestore-tanstack-db'

const lessons = useTable('Lesson', {
  liveStore,
  rpc: {
    client: createTRPCAdapter(trpc, { namespaces: ['teacher'] }),
    config: {
      teacher: {
        createLesson: {},            // auto-classified as `insert`
        updateLesson: {},            // auto-classified as `update`
        deleteLesson: {},            // auto-classified as `delete`
      },
    },
  },
})
```

Procedure-name heuristics auto-classify each proc into
`commitInsert/Update/Delete`:

| Procedure name pattern            | Wired to      |
|-----------------------------------|---------------|
| `createXxx`, `addXxx`, `upsertXxx` | `commitInsert`|
| `updateXxx`, `setXxx`, `markXxx`  | `commitUpdate`|
| `xxxDelete`, `xxxRemove`          | `commitDelete`|
| (fallback)                        | both insert + update (upsert-by-name) |

Override per-proc with `{ event: 'lessonUpserted' }` to pin a specific
LiveStore event (the event name suffix `Created` / `Deleted` / anything
else disambiguates the mutation kind).

#### Adapter options

Both adapters accept the same options:

```tsx
createORPCAdapter(client, {
  namespaces: ['teacher'],   // only include these top-level namespaces
  skipValidation: true,      // skip console.warn for missing/invalid procs
})

createTRPCAdapter(client, {
  namespaces: ['teacher'],
  skipValidation: true,
})
```

Missing procedures become `undefined` in the output — the mutation layer
treats them as no-ops.

### 7. React components

```tsx
// src/components/PostList.tsx
import { useLiveQuery } from '@tanstack/react-db'
import { usePostCollection } from '../db/postCollection.ts'

export const PostList = () => {
  const posts = usePostCollection()
  const { data } = useLiveQuery(q => q.from({ post: posts }))

  return (
    <ul>
      {data.map(({ post }) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  )
}

// Creating a post
posts.insert({
  id: crypto.randomUUID(),
  title: 'Hello',
  body: 'World',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
})

// Updating a post
posts.update(post.id, draft => { draft.title = 'Updated' })

// Deleting a post
posts.delete(post.id)
```

### 8. Devtools (optional)

<img width="1496" height="824" alt="image" src="https://github.com/user-attachments/assets/316aca38-618e-41b6-a1e4-3c0b34149754" />


Add the TanStack Devtools panel with the LiveStore plugin:

```tsx
// src/Root.tsx
import { TanStackDevtools } from '@tanstack/react-devtools'
import { liveStoreDevtoolsPlugin } from '@cyberistic/livestore-tanstack-db/devtools'

export const App = () => (
  <StoreRegistryProvider storeRegistry={storeRegistry}>
    {/* ... your app ... */}
    <TanStackDevtools plugins={[liveStoreDevtoolsPlugin()]} />
  </StoreRegistryProvider>
)
```

Also add the vite plugin for source injection:

```ts
// vite.config.ts
import { devtools } from '@tanstack/devtools-vite'

export default defineConfig({
  plugins: [devtools()],
})
```


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

