/**
 * Tier 2.1 — the lazy db proxy.
 *
 * The single thing that makes the Electric → LiveStore port mechanical
 * instead of painful: a Proxy that resolves `db.todos` to the right
 * `useTable`-style result inside React, and to a Promise-based "loader
 * proxy" outside React. So alkitab-alhakeem's 60+ files can keep
 * `import { teacherProfiles } from "@/lib/db"` post-migration, and the
 * 186-line `scripts/refactor-db-client-hooks.ts` migration script is
 * obsolete.
 *
 * Three access patterns work transparently:
 *
 *   1. **Inside React** (render / event handler / effect) — returns a
 *      memoised TanStack DB `Collection` via `useTable(modelName)`.
 *   2. **Inside a TanStack Router loader** (no React tree) — returns a
 *      `LoaderProxy` whose `.preload()` / `.findAll()` / `.findOne()`
 *      are Promise-based.
 *   3. **Server-authoritative tables** (e.g. LiveStore's own `events`
 *      audit log) — throws on access with a clear remediation hint.
 *
 * Detection uses React's internal `ReactCurrentDispatcher.current`:
 * it's a real dispatcher during render / inside hooks, and `null`
 * outside React entirely (e.g. inside a TanStack Router loader, where
 * `<LiveStoreProvider>` is not mounted). This is the same trick
 * `@tanstack/react-db` uses to detect "are we inside a render".
 *
 * @example Consumer `db.ts` (~10 lines)
 * ```ts
 * import { createLazyDb } from "@cyberistic/livestore-prisma"
 * import { lsdb } from "./livestore/schema"
 *
 * export const db = createLazyDb(lsdb.tables, {
 *   events: lsdb.events,         // optional — enables model-name inference
 *   serverOnly: ["events"],      // optional — server-authoritative tables
 *   onSync: (name, op, payload) => orpc[name][op](payload), // optional
 * })
 * ```
 *
 * @example Inside a React component
 * ```ts
 * import { db } from "@/lib/db"
 *
 * function TodosView() {
 *   const todos = db.todos           // → TanStack DB Collection
 *   const { data } = useLiveQuery(q => q.from({ t: todos }))
 *   return <List items={data} />
 * }
 * ```
 *
 * @example Inside a TanStack Router loader
 * ```ts
 * import { db } from "@/lib/db"
 *
 * export const Route = createFileRoute("/todos")({
 *   loader: async () => ({ todos: await db.todos.findAll() }),
 * })
 * ```
 */
import { queryDb } from '@livestore/livestore'
import type { Collection } from '@tanstack/db'
import * as React from 'react'

import {
  createCollection,
  liveStoreCollectionOptions,
  type LiveStoreRow,
} from '../db/liveStoreCollection.ts'
import { TABLES } from '../../prisma/generated/client-schemas/index.ts'
import { useLiveStoreConfig } from './LiveStoreProvider.tsx'
import { useTable } from './useTable.ts'

/**
 * Lazy import of the store module. We can't import `getOrCreateAppStore`
 * eagerly because it transitively pulls in Vite-specific worker imports
 * (`?worker` / `?sharedworker`) which break in pure Node / Bun test
 * environments. The proxy is usable without the store — only the
 * `LoaderProxy.preload()` / `.findAll()` paths actually need it.
 *
 * As of Tier 1.5, `getOrCreateAppStore()` returns an `AppStoreContext`
 * (which bundles the `store` + `schema` + `storeId`); we unwrap `.store`
 * to get the LiveStore `Store` instance the adapter expects.
 */
const loadStore = async () => {
  const mod = await import('../livestore/store.ts')
  const ctx = await mod.getOrCreateAppStore()
  return ctx.store
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type SyncOp = 'insert' | 'update' | 'delete'

export type OnSync = (
  name: string,
  op: SyncOp,
  payload: unknown,
) => void

export interface LazyDbOptions {
  /**
   * The LiveStore `events` map (from `createLiveStoreDb` output). When
   * supplied, `createLazyDb` infers the proxy-key → model-name mapping
   * by matching `events.<prefix><Action>` against
   * `events.<prefix><Action>.name === 'v<N>.<Model><Action>'`. This
   * lets consumers skip the explicit `modelNames` map for the common
   * `camelCase-plural → PascalCase-singular` case (including
   * `quizzes → Quiz` etc).
   */
  events?: Record<string, unknown>

  /**
   * Override or extend the inferred mapping. Keys are the proxy
   * access keys (matching `tables` keys, e.g. `todos`,
   * `teacherProfiles`); values are PascalCase model names passed to
   * `useTable()`.
   *
   * @example
   * ```ts
   * createLazyDb(tables, {
   *   events,
   *   modelNames: { quizzes: "Quiz" }, // override inference edge case
   * })
   * ```
   */
  modelNames?: Record<string, string>

  /**
   * Tables that are server-authoritative (e.g. LiveStore's own
   * `events` audit log). Accessing them via `db.<name>` throws a
   * descriptive error. The intended workflow is: subscribe via the
   * LiveStore event stream / an oRPC query, never write through the
   * collection.
   */
  serverOnly?: string[]

  /**
   * Read callback for non-React readers. Fires the first time a
   * `LoaderProxy.<method>()` resolves its collection. Useful for
   * analytics / instrumentation; the actual read happens against the
   * LiveStore-backed collection.
   */
  onRead?: (name: string) => unknown

  /**
   * Write callback for non-React writers. When a TanStack Router
   * loader (or any non-React code) calls `db.todos.insert(row)` /
   * `.update(...)` / `.delete(...)`, the proxy can't fire the
   * LiveStore commit (no React render). This callback receives the
   * operation so downstream apps can wire it to their actual oRPC
   * client via `<LiveStoreProvider oRPC={...}>`.
   *
   * If omitted, non-React writes throw with a clear message
   * pointing at this option.
   */
  onSync?: OnSync
}

/**
 * The non-React shape returned by `createLazyDb()` when accessed
 * outside a render context. Mirrors the TanStack DB `Collection` API
 * but resolves everything through Promises so TanStack Router
 * loaders / Cloudflare Worker handlers can `await` the result.
 */
export interface LoaderProxy<T extends LiveStoreRow = LiveStoreRow> {
  /** Returns the underlying TanStack DB collection (loads the store if needed). */
  preload(): Promise<Collection<T, string>>
  /** Returns all rows currently in the collection. */
  findAll(): Promise<T[]>
  /** Returns the first row matching the given partial filter. */
  findOne(filter: Partial<T>): Promise<T | undefined>
  /** Inserts a row. Routes through `onSync` (the LiveStore commit happens on the server). */
  insert(row: Partial<T>): Promise<void>
  /** Updates a row by id. Routes through `onSync`. */
  update(id: string, changes: Partial<T>): Promise<void>
  /** Deletes a row by id. Routes through `onSync`. */
  delete(id: string): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * React's internal dispatcher is set during render / inside hooks,
 * and `null` outside React entirely. This is the canonical (if
 * unofficial) way to detect "are we in a render context" — the same
 * trick TanStack DB and React Query use internally.
 *
 * Calling `React.useContext(...)` outside React would also work in
 * some versions, but its behaviour has shifted across React 18 → 19
 * (sometimes throws, sometimes warns). Reading the dispatcher is
 * stable across versions.
 */
const insideReactRender = (): boolean => {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: {
        ReactCurrentDispatcher?: { current: unknown }
      }
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  const dispatcher = internals?.ReactCurrentDispatcher?.current
  return dispatcher != null
}

/**
 * Naive camelCase-plural → PascalCase-singular for the fallback path
 * (used when `events` is not supplied). Handles the common
 * `todos → Todo`, `lessons → Lesson`, `categories → Category`,
 * `boxes → Box`, `buses → Bus` cases. Doesn't handle irregulars
 * (`children → child`); those need an explicit `modelNames` entry.
 */
const inferModelNameFromTableKey = (tableKey: string): string => {
  let name = tableKey.charAt(0).toUpperCase() + tableKey.slice(1)
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y'
  if (
    name.endsWith('sses') ||
    name.endsWith('shes') ||
    name.endsWith('ches') ||
    name.endsWith('xes')
  ) {
    return name.slice(0, -2)
  }
  if (name.endsWith('ses')) return name.slice(0, -2)
  if (name.endsWith('s')) return name.slice(0, -1)
  return name
}

/**
 * Build the table-key → model-name map by matching table keys against
 * event prefixes derived from `events[*].name === 'v<N>.<Model><Action>'`.
 *
 * Strategy: build `prefix → modelName` (where `prefix = lcFirst(model)`)
 * from the events map, then for each table key try a few candidate
 * singular forms until one matches a known prefix. This handles
 * irregular plurals like `quizzes → quiz → Quiz` correctly without
 * English pluralization heuristics.
 */
const inferModelNamesFromEvents = (
  tables: Record<string, unknown>,
  events: Record<string, unknown>,
): Record<string, string> => {
  const prefixToModel: Record<string, string> = {}
  for (const event of Object.values(events)) {
    const name = (event as { name?: unknown })?.name
    if (typeof name !== 'string') continue
    const m = name.match(
      /^v\d+\.([A-Z]\w+?)(?:Created|Deleted|Upserted|Completed|Uncompleted)$/,
    )
    if (!m) continue
    const modelName = m[1]!
    const prefix = modelName.charAt(0).toLowerCase() + modelName.slice(1)
    prefixToModel[prefix] = modelName
  }

  const out: Record<string, string> = {}
  for (const tableKey of Object.keys(tables)) {
    // Try in order of specificity so e.g. `quizzes` matches `quiz`
    // (not `quizz`) when both are in the index.
    const candidates = [
      tableKey, // exact prefix match (no pluralization)
      tableKey.slice(0, -1), // strip trailing 's'
      tableKey.slice(0, -2), // strip trailing 'es'
      tableKey.replace(/ies$/, 'y'), // 'categories' → 'category'
    ]
    for (const cand of candidates) {
      const hit = prefixToModel[cand]
      if (hit) {
        out[tableKey] = hit
        break
      }
    }
  }
  return out
}

const DEFAULT_WHERE = { deletedAt: null } as const

// ─────────────────────────────────────────────────────────────────────
// Loader proxy (non-React access path)
// ─────────────────────────────────────────────────────────────────────

const makeLoaderProxy = (
  name: string,
  table: { where: (filter: Record<string, unknown>) => unknown },
  onRead: ((name: string) => unknown) | undefined,
  onSync: OnSync | undefined,
): LoaderProxy => {
  let collectionPromise: Promise<Collection<LiveStoreRow, string>> | undefined

  const getCollection = (): Promise<Collection<LiveStoreRow, string>> => {
    if (!collectionPromise) {
      collectionPromise = (async () => {
        onRead?.(name)
        const store = await loadStore()
        const query = queryDb(
          (table.where(DEFAULT_WHERE) as unknown as Parameters<typeof queryDb>[0]),
          { label: `${name}-loader` },
        )
        return createCollection<LiveStoreRow, string>(
          liveStoreCollectionOptions<LiveStoreRow>({
            id: `${name}-loader`,
            store,
            query: query as unknown as Parameters<typeof liveStoreCollectionOptions>[0]['query'],
            getKey: (row) => row.id as string,
          }),
        )
      })()
    }
    return collectionPromise
  }

  const requireOnSync = (method: 'insert' | 'update' | 'delete'): void => {
    if (!onSync) {
      throw new Error(
        `db.${name}.${method}() called outside React with no onSync callback configured. ` +
          `Either use db.${name} inside a React component (then write through the Collection's ` +
          `commitInsert / commitUpdate / commitDelete), or pass createLazyDb({ onSync }) so ` +
          `the proxy can route the write to your oRPC client.`,
      )
    }
  }

  return {
    preload: getCollection,
    findAll: async () => {
      const collection = await getCollection()
      return collection.toArray as never
    },
    findOne: async (filter) => {
      const collection = await getCollection()
      const entries = Object.entries(filter)
      return collection.toArray.find((row) =>
        entries.every(([k, v]) => (row as Record<string, unknown>)[k] === v),
      ) as never
    },
    insert: async (row) => {
      requireOnSync('insert')
      onSync!(name, 'insert', row)
    },
    update: async (id, changes) => {
      requireOnSync('update')
      onSync!(name, 'update', { id, ...changes })
    },
    delete: async (id) => {
      requireOnSync('delete')
      onSync!(name, 'delete', { id })
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the lazy db proxy.
 *
 * @param tables - The `tables` record from `createLiveStoreDb` (or any
 *   `Record<string, TableDef>` keyed by camelCase-plural model key,
 *   e.g. `todos`, `teacherProfiles`).
 * @param options - Optional behaviour overrides (see {@link LazyDbOptions}).
 * @returns A frozen-by-convention `Readonly<Record<string, unknown>>`
 *   proxy whose property accesses resolve to either a TanStack DB
 *   `Collection` (inside React) or a {@link LoaderProxy} (outside).
 *
 * **Throws** when accessing a `serverOnly` table (e.g. LiveStore's
 * audit log), or when accessed inside a React component without a
 * mounted `<LiveStoreProvider>`.
 */
export const createLazyDb = (
  tables: Record<string, unknown>,
  options: LazyDbOptions = {},
): Readonly<Record<string, unknown>> => {
  const serverOnly = new Set<string>(options.serverOnly ?? [])
  // Fold in any upstream-detected server-only tables: TABLES[m].includedInSync === false.
  for (const [name, meta] of Object.entries(TABLES) as Array<[string, { includedInSync: boolean }]>) {
    if (meta.includedInSync === false) serverOnly.add(name)
  }
  const inferredModelNames = options.events
    ? inferModelNamesFromEvents(tables, options.events)
    : {}
  const modelNames: Record<string, string> = {
    ...inferredModelNames,
    ...(options.modelNames ?? {}),
  }
  const onRead = options.onRead
  const onSync = options.onSync

  return new Proxy({}, {
    get(_target, rawName) {
      if (typeof rawName !== 'string') return undefined

      // 1. Server-only guard — check FIRST so a thrown error doesn't
      //    disturb React's hook bookkeeping for the current render.
      if (serverOnly.has(rawName)) {
        const modelName = modelNames[rawName] ?? inferModelNameFromTableKey(rawName)
        throw new Error(
          `Table '${modelName}' is server-authoritative. ` +
            `Use an oRPC procedure to write to it, or \`db.${rawName}.read()\` ` +
            `to subscribe to the audit log.`,
        )
      }

      // 2. Table lookup.
      const table = tables[rawName]
      if (!table) {
        throw new Error(
          `createLazyDb: unknown table '${rawName}'. ` +
            `Known tables: ${Object.keys(tables).join(', ')}. ` +
            `If this is a new model, regenerate the schema (bun prisma generate).`,
        )
      }

      // 3. Model-name resolution. Both inferred and explicit maps are
      //    merged up-front; we look up here.
      const modelName = modelNames[rawName] ?? inferModelNameFromTableKey(rawName)

      // 4. React-render detection. Outside React (TanStack Router
      //    loader, Cloudflare Worker handler, plain Node script) →
      //    return the Promise-based loader proxy.
      if (!insideReactRender()) {
        return makeLoaderProxy(
          rawName,
          table as { where: (filter: Record<string, unknown>) => unknown },
          onRead,
          onSync,
        )
      }

      // 5. Inside React — also require a mounted <LiveStoreProvider>
      //    so `useTable` can find the store + oRPC client. The
      //    `useLiveStoreConfig` hook is itself a `useContext` call,
      //    so it participates in React's hook-order tracking.
      const config = useLiveStoreConfig()
      if (config === null) {
        throw new Error(
          `db.${rawName} accessed inside a React component but ` +
            `<LiveStoreProvider> is not mounted. Wrap your app with ` +
            `<LiveStoreProvider schema={...}>` +
            (onSync ? ' oRPC={...}' : '') +
            ` to use db.${rawName} inside React.`,
        )
      }

      // 6. Inside React with provider → the memoised Collection from
      //    `useTable`. `useTable`'s `useMemo` keys on `[store, name,
      //    label, whereKey]` so re-accessing `db.todos` from an event
      //    handler (which captures the value from render) returns the
      //    same Collection instance — no duplicate subscriptions.
      return useTable(modelName as Parameters<typeof useTable>[0]).collection
    },
  }) as Readonly<Record<string, unknown>>
}