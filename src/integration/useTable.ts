import { queryDb } from '@livestore/livestore'
import type { Queryable, Store } from '@livestore/livestore'
import { createCollection } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import { use as reactUse, useMemo } from 'react'

import { liveStoreCollectionOptions, type LiveStoreRow } from '../db/liveStoreCollection.ts'
import { tables, events, schema } from '../livestore/schema.ts'
import { getOrCreateAppStore, useAppStore } from '../livestore/store.ts'
import type { MutationCallbacks, RpcClient, RpcConfig } from './mutations.ts'
import { createMutations } from './mutations.ts'
import { useLiveStoreConfig } from './LiveStoreProvider.tsx'

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/** PascalCase model name (or client-document camelCase) — every key of `tables`. */
export type TableName = keyof typeof tables & string

/**
 * Row type for a given table.
 *
 * Tier 2.4 — `tables` is now typed precisely per-key by the factory
 * (`{ [K in keyof T]: SyncedTableFor<T[K]> }` where `SyncedTableFor`
 * preserves the schema's decoded `Type`). We derive `RowOf` straight
 * off `(typeof tables)[TName]['Type']`, so:
 *
 *   - `useTable('Todo').collection` is `Collection<Todo, string>`,
 *     not `Collection<LiveStoreRow, string>`.
 *   - `q.from({ todo: todos }).select(({ todo }) => todo.text)`
 *     type-checks end to end — the row shape flows through the
 *     `useLiveQuery` projection.
 *
 * Client-document keys (`uiState`) and any other `Record<string, any>`
 * key fall through to the `LiveStoreRow` fallback — their precise
 * types aren't tracked by the factory's schema-introspection export.
 */
export type RowOf<TName extends TableName> =
  (typeof tables)[TName] extends { readonly Type: infer R }
    ? [R] extends [never]
      ? LiveStoreRow
      : R extends object
        ? R
        : LiveStoreRow
    : LiveStoreRow

export interface UseTableOptions {
  /**
   * Server-side filter applied via `tables[name].where(...)`. Defaults
   * to `{ deletedAt: null }` (the soft-delete convention).
   */
  where?: Record<string, unknown>

  /**
   * Label used for the LiveStore query + the TanStack DB collection id.
   * Two `useTable` calls with different `label`s produce different
   * collections (independent subscriptions).
   */
  label?: string

  /**
   * Tier 0.6 declarative mutations. Each entry tells `createMutations`
   * which RPC procedure to fire (and which LiveStore event to commit)
   * on `insert` / `update` / `delete`. When `rpcClient` is missing
   * (e.g. this demo has no oRPC wired), the RPC calls become no-ops
   * and only the LiveStore events fire.
   *
   * @example
   * ```ts
   * useTable("TeacherProfile", {
   *   rpc: {
   *     teacher: {
   *       updateOwnProfile: { map: row => row },
   *     },
   *   },
   *   rpcClient: orpc,
   * })
   * ```
   */
  rpc?: RpcConfig

  /**
   * RPC client to call when the mutations config names procedures.
   * Falls back to the `oRPC` value on `<LiveStoreProvider>` (via
   * {@link useLiveStoreConfig}) when omitted.
   */
  rpcClient?: RpcClient
}

export interface UseTableResult<TName extends TableName> {
  /** The TanStack DB collection — use `.insert / .update / .delete / .toArray`. */
  collection: Collection<RowOf<TName>, string>
  /** The underlying LiveStore table definition — for hand-rolled `queryDb` callers. */
  table: (typeof tables)[TName]
  /** The full LiveStore schema — exposed so `useLiveQuery` callers can introspect. */
  schema: typeof schema
}

// ─────────────────────────────────────────────────────────────────────
// Auto-derived helpers — `createLiveStoreDb` keys events by their
// dotted name (`${version}.${ModelName}${Action}` for synced tables,
// `${name}Set` for client documents). We replicate the same convention
// so callers don't have to declare events per-model.
// ─────────────────────────────────────────────────────────────────────

const VERSION = 'v1'
const DEFAULT_WHERE = { deletedAt: null } as const

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const ucFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Look up a synced-table event by dotted key. */
const syncedEventFor = (name: TableName, action: string) =>
  (events as Record<string, any>)[`${VERSION}.${name}${action}`]

/** Look up a client-document `set` event by camelCase key. */
const clientDocSetEventFor = (name: TableName) =>
  (events as Record<string, any>)[`${name}Set`]

const getKey = <T extends LiveStoreRow>(row: T): string =>
  (row as { id: string }).id

const makeCommitInsert = (store: Store<any>, name: TableName) =>
  (row: LiveStoreRow) => {
    const evt = syncedEventFor(name, 'Created')
    if (!evt) {
      throw new Error(
        `useTable(${name}): no \`${VERSION}.${name}Created\` event found in schema.`,
      )
    }
    store.commit(evt(row as any) as never)
  }

const makeCommitDelete = (store: Store<any>, name: TableName) =>
  (row: LiveStoreRow) => {
    const evt = syncedEventFor(name, 'Deleted')
    if (!evt) {
      throw new Error(
        `useTable(${name}): no \`${VERSION}.${name}Deleted\` event found in schema.`,
      )
    }
    store.commit(
      evt({ id: (row as { id: string }).id, deletedAt: new Date() } as any) as never,
    )
  }

/**
 * Detect boolean flips in `changes` and emit `${name}${Field}Completed` /
 * `${name}${Field}Uncompleted` accordingly. Non-boolean changes fall on
 * the floor (the default factory only generates toggle events).
 *
 * If the user wants per-field update events, they should generate them
 * via the factory's `events` config (Tier 0.6) or override `commitUpdate`
 * directly on `liveStoreCollectionOptions`.
 */
const makeCommitUpdate = (store: Store<any>, name: TableName) =>
  (_original: LiveStoreRow, changes: Partial<LiveStoreRow>) => {
    const id =
      ((changes as { id?: string }).id ?? (_original as { id: string }).id) as string
    for (const [field, value] of Object.entries(changes)) {
      if (typeof value !== 'boolean') continue
      const action = value ? 'Completed' : 'Uncompleted'
      const evt = syncedEventFor(name, `${ucFirst(field)}${action}`)
      if (evt) store.commit(evt({ id } as any) as never)
    }
  }

/**
 * Build the three commit callbacks for a `useTable(...)` call.
 *
 * When `options.rpc` is set we delegate to `createMutations` (Tier 0.6
 * declarative path). Otherwise we fall back to the ad-hoc auto-toggle
 * behaviour that this hook has shipped since its first cut — so every
 * pre-0.6 call site keeps working without edits.
 */
const buildCommitCallbacks = (
  store: Store<any>,
  name: TableName,
  options: UseTableOptions,
  contextRpcClient: unknown,
): Pick<
  Partial<Parameters<typeof liveStoreCollectionOptions>[0]>,
  'commitInsert' | 'commitUpdate' | 'commitDelete'
> => {
  if (!options.rpc && options.rpcClient === undefined) {
    return {
      commitInsert: makeCommitInsert(store, name),
      commitUpdate: makeCommitUpdate(store, name),
      commitDelete: makeCommitDelete(store, name),
    }
  }

  const mutations: MutationCallbacks = createMutations({
    store,
    modelName: name,
    events: events as Record<string, (...args: any[]) => unknown>,
    rpcClient: (options.rpcClient as RpcClient | undefined) ??
      (contextRpcClient as RpcClient | undefined),
    rpcConfig: options.rpc,
  })

  return {
    commitInsert: mutations.commitInsert as never,
    commitUpdate: mutations.commitUpdate as never,
    commitDelete: mutations.commitDelete as never,
  }
}

// ─────────────────────────────────────────────────────────────────────
// useTable
// ─────────────────────────────────────────────────────────────────────

const buildQuery = <TName extends TableName>(
  name: TName,
  opts: UseTableOptions,
): Queryable<ReadonlyArray<RowOf<TName>>> => {
  const table = tables[name] as any
  const where = opts.where ?? DEFAULT_WHERE
  const q = table.where(where)
  return queryDb(q, {
    label: `${lcFirst(name)}$-${opts.label ?? 'all'}`,
  }) as unknown as Queryable<ReadonlyArray<RowOf<TName>>>
}

/**
 * Returns a TanStack DB collection for the given model, plus the
 * underlying LiveStore table + schema so callers can compose with
 * `useLiveQuery((q) => q.from({ todo: useTable("Todo").collection }))`.
 *
 * Every parameter is auto-derived from the model name + the
 * factory's `events` map; the caller never sees the
 * `liveStoreCollectionOptions` boilerplate.
 *
 * The collection itself is sourced from the module-level cache via
 * {@link getCollection}, so a `useTable.preload(name)` in a TanStack
 * Router loader and a `useTable(name)` here in a component share the
 * same `Collection` instance (and the same LiveStore subscription).
 * Strict-mode double renders are a no-op — the cache returns the
 * same Promise for the same `(name, label, where)` triple.
 */
export function useTable<TName extends TableName>(
  name: TName,
  options: UseTableOptions = {},
): UseTableResult<TName> {
  // Tier 0.6 hookup: pull the optional oRPC client off the React tree
  // via <LiveStoreProvider>. Falls back to `null` when no provider is
  // mounted (the common case in this demo) — `createMutations`
  // tolerates a missing client and just no-ops the RPC calls.
  const liveStoreConfig = useLiveStoreConfig()
  const contextRpcClient = liveStoreConfig?.oRPC

  // Resolve the (possibly cached) collection. `getCollection` awaits
  // the store internally, so `React.use` here suspends until BOTH
  // the store and the collection are ready. Subsequent renders with
  // the same Promise return synchronously without re-suspending.
  const collectionPromise = getCollection(name, options, contextRpcClient)
  const collection = reactUse(collectionPromise) as Collection<
    RowOf<TName>,
    string
  >

  const table = tables[name] as (typeof tables)[TName]

  // Keep the result object referentially stable across renders so
  // downstream consumers that destructure `{ collection }` (and use
  // it as a hook dep / `useEffect` dep) don't re-fire on every
  // render. `table` is a LiveStore module-level singleton (stable
  // across renders), `collection` is the same cache hit (stable),
  // and `schema` is a static import (stable).
  return useMemo(
    () => ({ collection, table, schema }) as UseTableResult<TName>,
    [collection, table],
  )
}

// ─────────────────────────────────────────────────────────────────────
// useTables — bulk variant for preloading many collections at once
// ─────────────────────────────────────────────────────────────────────

export type UseTablesSpec = Record<
  string,
  { where?: Record<string, unknown>; label?: string }
>

export type UseTablesResult<Spec extends UseTablesSpec> = {
  [K in keyof Spec & string]: Collection<RowOf<K & TableName>, string>
}

/**
 * Stable, order-independent JSON stringification of an object. Used as
 * the memo key for `useTables` so `{ a: {}, b: {} }` and `{ b: {}, a: {} }`
 * produce the same key (otherwise the spec would invalidate the memo
 * on every render that reorders keys).
 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/**
 * Bulk-load many collections in a single hook call. Each entry is
 * auto-derived from `events` (same as `useTable`), so callers just
 * pass the names + optional filters.
 *
 * With >10 collections: each entry is built independently and the
 * whole result is memoised on a stable JSON key of the spec. Spec
 * objects are normalised (keys sorted + JSON.stringify) so referential
 * inequality between renders doesn't bust the memo. No N² work.
 */
export function useTables<Spec extends UseTablesSpec>(
  spec: Spec,
): UseTablesResult<Spec> {
  const store = useAppStore()
  const memoKey = useMemo(() => stableStringify(spec), [spec])

  return useMemo(() => {
    const out: Record<string, Collection<LiveStoreRow, string>> = {}
    for (const name of Object.keys(spec)) {
      const opts = spec[name] ?? {}
      const where = opts.where ?? DEFAULT_WHERE
      const label = opts.label ?? 'all'
      const whereKey = JSON.stringify(where)
      const table = tables[name as TableName] as any
      const query = queryDb(table.where(where), {
        label: `${lcFirst(name)}-${label}`,
      }) as unknown as Queryable<ReadonlyArray<LiveStoreRow>>
      out[name] = createCollection<LiveStoreRow, string>(
        liveStoreCollectionOptions<LiveStoreRow>({
          id: `${lcFirst(name)}-${label}-${whereKey}`,
          store,
          query,
          getKey,
          commitInsert: makeCommitInsert(store, name as TableName),
          commitUpdate: makeCommitUpdate(store, name as TableName),
          commitDelete: makeCommitDelete(store, name as TableName),
        }),
      )
    }
    return out as unknown as UseTablesResult<Spec>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, memoKey])
}

// ─────────────────────────────────────────────────────────────────────
// getCollection — module-level cache shared by useTable + preload
// ─────────────────────────────────────────────────────────────────────

/**
 * Module-level cache of in-flight + resolved `Collection` promises.
 *
 * Keyed by `(name, label, whereKey)` — the same triple that becomes
 * the TanStack DB collection's `id` further down. The cache outlives
 * React's component lifecycle, so a `useTable.preload('Todo')` call
 * from a TanStack Router loader and a `useTable('Todo')` call from a
 * component share the same collection instance (and the same
 * LiveStore subscription).
 *
 * The Promise is stored, not the resolved Collection, so that
 * concurrent callers for the same key all `await` the SAME in-flight
 * load — no duplicate `createCollection(...)` calls, no duplicate
 * subscriptions against LiveStore.
 */
const collectionCache = new Map<
  string,
  Promise<Collection<LiveStoreRow, string>>
>()

const collectionCacheKey = (
  name: TableName,
  label: string,
  whereKey: string,
): string => `${name}|${label}|${whereKey}`

/**
 * Resolve a TanStack DB collection for `(name, options)` — creating
 * it on first call, returning the cached `Promise<Collection>` on
 * subsequent calls. Internal — exported only for `useTable.preload`
 * and for the `disposeCollections` test helper.
 *
 * The returned promise resolves once BOTH the LiveStore store and
 * the collection have been built. Callers inside React can `await`
 * it directly (the `useTable` hook suspends via `React.use`); callers
 * outside React (TanStack Router loaders) can `await` it the same
 * way. Idempotent on the cache key.
 *
 * Browser-only — `createStorePromise` needs OPFS / a web worker, both
 * of which are absent in SSR / Workers environments. The `preload`
 * static method adds an SSR guard; this function does not.
 */
export const getCollection = <TName extends TableName>(
  name: TName,
  options: UseTableOptions = {},
  contextRpcClient: unknown = undefined,
): Promise<Collection<RowOf<TName>, string>> => {
  const label = options.label ?? 'all'
  const where = options.where ?? DEFAULT_WHERE
  const whereKey = JSON.stringify(where)
  const key = collectionCacheKey(name, label, whereKey)

  const cached = collectionCache.get(key)
  if (cached) return cached as unknown as Promise<Collection<RowOf<TName>, string>>

  const promise = (async (): Promise<Collection<RowOf<TName>, string>> => {
    const { store } = await getOrCreateAppStore()
    const query = buildQuery(name, { where, label })
    const callbacks = buildCommitCallbacks(store, name, options, contextRpcClient)
    return createCollection<RowOf<TName>, string>(
      liveStoreCollectionOptions<RowOf<TName>>({
        id: `${lcFirst(name)}-${label}-${whereKey}`,
        store,
        query,
        getKey,
        ...callbacks,
      }),
    )
  })()
  collectionCache.set(key, promise as unknown as Promise<Collection<LiveStoreRow, string>>)
  return promise
}

/**
 * Drop all cached collections. Test-only — pair with
 * `disposeAppStore()` from `livestore/store.ts` for a fully clean
 * slate between tests. The `Collection` instances themselves aren't
 * formally "closed" (TanStack DB doesn't expose a teardown API), but
 * dropping them from the cache ensures the next render / preload
 * creates fresh ones against the (reset) store.
 */
export const disposeCollections = (): void => {
  collectionCache.clear()
}

// ─────────────────────────────────────────────────────────────────────
// useTable.preload — for TanStack Router loaders
// ─────────────────────────────────────────────────────────────────────

/**
 * Preload a collection (and the underlying LiveStore store) from a
 * non-React context — TanStack Router loaders, route handlers,
 * scripts. Returns a `Promise<Collection>` that resolves once the
 * collection has been created and is ready to be read.
 *
 * Multiple in-flight calls for the same `(name, label, where)`
 * return the same Promise — the cache lives at module scope and
 * outlives React's component lifecycle, so a `preload` from a loader
 * and the matching `useTable(name)` in a component share one
 * collection instance.
 *
 * No-op outside the browser — resolves to `null` so loaders can
 * `await` without crashing on SSR / Workers, where `createStorePromise`
 * can't actually build a store (no OPFS, no web worker).
 *
 * @example
 * ```ts
 * // In a TanStack Router loader:
 * export const Route = createFileRoute('/lessons')({
 *   loader: async () => {
 *     await useTable.preload('Lesson')
 *     // ^ runs in loader, no React tree, no provider
 *   },
 * })
 * ```
 */
useTable.preload = <TName extends TableName>(
  name: TName,
  options: UseTableOptions = {},
): Promise<Collection<RowOf<TName>, string> | null> => {
  if (typeof window === 'undefined') return Promise.resolve(null)
  return getCollection(name, options)
}

// Type augmentation so `useTable.preload` shows up in IDEs.
export interface UseTableHook {
  <TName extends TableName>(
    name: TName,
    options?: UseTableOptions,
  ): UseTableResult<TName>
  preload: <TName extends TableName>(
    name: TName,
    options?: UseTableOptions,
  ) => Promise<Collection<RowOf<TName>, string> | null>
}

// Re-export the client-doc event helper so callers can grab the
// `set` event factory for documents without a `useTable` path.
export const setClientDocEvent = clientDocSetEventFor