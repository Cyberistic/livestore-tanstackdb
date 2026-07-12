import { queryDb } from '@livestore/livestore'
import type { Queryable, Store } from '@livestore/livestore'
import { createCollection } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import { use as reactUse, useMemo } from 'react'

import { liveStoreCollectionOptions, type LiveStoreRow } from './liveStoreCollection.ts'
import type { MutationCallbacks, RpcClient, RpcConfig } from './mutations.ts'
import { createMutations } from './mutations.ts'
import { useLiveStoreConfig } from './LiveStoreProvider.tsx'

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/** PascalCase model name (or client-document camelCase). Generic — the consumer's tables define the actual values. */
export type TableName = string

/**
 * Row type for a given table. Derived from the consumer's LiveStore
 * table map at the call site.
 */
export type RowOf<TName extends string, T extends Record<string, any>> =
  T[TName] extends { readonly Type: infer R } ? R : LiveStoreRow

// ─────────────────────────────────────────────────────────────────────
// Live store context — read from <LiveStoreProvider>
// ─────────────────────────────────────────────────────────────────────

/**
 * The shape the package reads from the surrounding LiveStore context.
 * Consumers populate this via `<LiveStoreProvider schema={...} oRPC={...}>`.
 */
export interface UseTableLiveStore {
  store: Store<any>
  tables: Record<string, any>
  events: Record<string, any>
  schema: unknown
}

const useLiveStore = (): UseTableLiveStore | null => {
  const config = useLiveStoreConfig() as { schema: any } | null
  if (!config) return null
  // The consumer's `createLiveStoreDb` output is stored on the
  // LiveStoreProvider's `schema` prop. The package's `useTable` reads
  // tables/events/store from the same place. Consumers who want a
  // non-context API can pass an explicit `liveStore` option instead.
  return config.schema as unknown as UseTableLiveStore
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (no module-level state)
// ─────────────────────────────────────────────────────────────────────

const VERSION = 'v1'
const DEFAULT_WHERE = { deletedAt: null } as const

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const ucFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const syncedEventFor = (
  name: TableName,
  events: Record<string, any>,
  action: string,
) => {
  const e = (events as Record<string, any>)[`${VERSION}.${name}${action}`]
  if (!e) {
    throw new Error(
      `useTable(${name}): no \`${VERSION}.${name}${action}\` event found in schema. ` +
        `Did createLiveStoreDb's includeCreated/includeDeleted flags disable it? ` +
        `Or did you forget to add a \`booleanColumns\` for per-field events?`,
    )
  }
  return e
}

const clientDocSetEventFor = (
  name: TableName,
  events: Record<string, any>,
) => {
  const e = (events as Record<string, any>)[`${name}Set`]
  if (!e) {
    throw new Error(
      `useTable(${name}): no \`${name}Set\` event found in schema. Did the table get declared as a client document in createLiveStoreDb?`,
    )
  }
  return e
}

const getKey = <T extends LiveStoreRow>(row: T): string => (row as { id: string }).id

const makeCommitInsert = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
) => {
  const e = syncedEventFor(name, events, 'Created')
  return (input: { row: LiveStoreRow }) => {
    // type level for our use case; the runtime is fine.
    store.commit(e(input.row))
  }
}

const makeCommitDelete = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
) => {
  const e = syncedEventFor(name, events, 'Deleted')
  return (input: { id: string }) => {
    store.commit(e(input))
  }
}

const makeCommitUpdate = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
) => {
  // For per-field boolean toggles we emit Completed/Uncompleted events.
  // For other updates we emit Upserted.
  // Tier 0.6: this gets synthesized from the oRPC config — for now,
  // callers can override commitUpdate in their options.
  return (input: { row: LiveStoreRow }) => {
    const upserted = (events as Record<string, any>)[`${VERSION}.${name}Upserted`]
    if (upserted) {

      store.commit(upserted(input))
    }
  }
}

const buildCommitCallbacks = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
): {
  commitInsert?: MutationCallbacks['commitInsert']
  commitUpdate?: MutationCallbacks['commitUpdate']
  commitDelete?: MutationCallbacks['commitDelete']
} => {
  if (!(events as Record<string, any>)[`${name}Set`]) {
    // Synced table — has Created/Deleted events
    return {
      commitInsert: makeCommitInsert(store, name, events),
      commitDelete: makeCommitDelete(store, name, events),
      commitUpdate: makeCommitUpdate(store, name, events),
    }
  }
  // Client document — has a `set` event
  return {
    commitInsert: makeCommitInsert(store, name, events),
    commitUpdate: (input: { id: string; changes: Record<string, unknown> }) => {

      store.commit(clientDocSetEventFor(name, events)({ id: input.id, value: input.changes }))
    },
  }
}

const buildQuery = <TName extends TableName>(
  name: TName,
  tables: Record<string, any>,
): Queryable<any> => {
  // Default: soft-delete-aware. `useTable(name, { where: ... })` lets
  // callers override.
  return queryDb((tables as Record<string, any>)[name].where(DEFAULT_WHERE), {
    label: `${lcFirst(name)}:all`,
  })
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Options for {@link useTable}.
 *
 * The package reads `store` / `tables` / `events` from the surrounding
 * <LiveStoreProvider> by default. Pass an explicit `liveStore` to
 * override (e.g. inside TanStack Router loaders where there is no
 * React tree to read context from).
 */
export interface UseTableOptions<TName extends TableName> {
  /** Server-side filter applied via `tables[name].where(...)`. */
  where?: Record<string, unknown>
  /**
   * Override commit handlers. By default the package auto-derives
   * `commitInsert` / `commitUpdate` / `commitDelete` from the events
   * emitted by `createLiveStoreDb`. Pass any of these to override.
   */
  commitInsert?: MutationCallbacks['commitInsert']
  commitUpdate?: MutationCallbacks['commitUpdate']
  commitDelete?: MutationCallbacks['commitDelete']
  /**
   * oRPC write-back. Pass an oRPC client + a per-table RPC config to
   * have mutations round-trip to the server automatically. The package
   * uses the Tier 0.6 heuristics in `createMutations()` to detect
   * insert vs update vs delete procs.
   */
  rpc?: {
    client?: RpcClient
    config?: RpcConfig
  }
  /**
   * Explicit LiveStore runtime. If omitted, the package reads it from
   * <LiveStoreProvider> via React context.
   */
  liveStore?: UseTableLiveStore
  /**
   * Skip the React context read. Use in loaders / scripts that run
   * outside a React tree. `liveStore` is required when this is true.
   */
  noContext?: boolean
}

export interface UseTableResult<TName extends TableName> {
  /** The TanStack DB collection with `.insert/.update/.delete` and `.toArray`. */
  collection: Collection<LiveStoreRow, string>
  /** The LiveStore table def. */
  table: ReturnType<typeof queryDb>
  /** The full LiveStore schema. */
  schema: unknown
  /** `true` if this table is server-authoritative (no client write APIs). */
  isReadOnly: boolean
}

const collectionCache = new Map<string, Promise<Collection<any, string>>>()
const collectionCacheKey = (
  storeId: string,
  name: string,
  where: unknown,
  rpc: unknown,
) => JSON.stringify({ storeId, name, where, rpc })

/**
 * Build a `Collection` for the given model name + options. Idempotent —
 * multiple calls return the same `Promise<Collection>`.
 */
export const getCollection = async <TName extends TableName>(
  name: TName,
  options: UseTableOptions<TName> & { liveStore: UseTableLiveStore },
): Promise<Collection<LiveStoreRow, string>> => {
  const { liveStore, where, rpc, commitInsert, commitUpdate, commitDelete } = options
  const store = liveStore.store
  const key = collectionCacheKey(store['storeId'] ?? '', name, where, rpc)
  const cached = collectionCache.get(key)
  if (cached) return cached as Promise<Collection<LiveStoreRow, string>>

  const collectionPromise = (async () => {
    const table = where
      ? (liveStore.tables as Record<string, any>)[name].where(where)
      : buildQuery(name, liveStore.tables as Record<string, any>)

    const live = liveStore.events as Record<string, any>
    const isReadOnly = Boolean((liveStore.tables as Record<string, any>)[name]?.['__readOnly'])

    // Auto-derive commit handlers unless the caller overrode them.
    const auto = isReadOnly
      ? {}
      : buildCommitCallbacks(store, name, live)

    const insert = commitInsert ?? auto.commitInsert
    const update = commitUpdate ?? auto.commitUpdate
    const delete_ = commitDelete ?? auto.commitDelete

    // Tier 0.6 — oRPC write-back via the createMutations helper.
    const mutationOverrides = rpc?.client
      ? createMutations({
          store,
          modelName: name,
          events: live,
          rpcClient: rpc.client,
          rpcConfig: rpc.config,
        })
      : null

    return createCollection(
      liveStoreCollectionOptions<LiveStoreRow>({
        id: name.toLowerCase(),
        store,
        query: table,
        getKey,
        isReadOnly,
        ...(insert ? { commitInsert: insert } : {}),
        ...(update ? { commitUpdate: update } : {}),
        ...(delete_ ? { commitDelete: delete_ } : {}),
        ...(mutationOverrides?.commitInsert ? { commitInsert: mutationOverrides.commitInsert } : {}),
        ...(mutationOverrides?.commitUpdate ? { commitUpdate: mutationOverrides.commitUpdate } : {}),
        ...(mutationOverrides?.commitDelete ? { commitDelete: mutationOverrides.commitDelete } : {}),
      }),
    )
  })()

  collectionCache.set(key, collectionPromise)
  return collectionPromise as Promise<Collection<LiveStoreRow, string>>
}

// ─────────────────────────────────────────────────────────────────────
// React hook
// ─────────────────────────────────────────────────────────────────────

/**
 * React hook that returns the TanStack DB collection for a LiveStore table.
 *
 * Must be rendered inside a `<LiveStoreProvider>` (or pass `liveStore`
 * explicitly to bypass the context).
 */
export const useTable = <TName extends TableName>(
  name: TName,
  options: UseTableOptions<TName> = {},
): UseTableResult<TName> => {
  const liveStore = options.liveStore ?? (!options.noContext ? useLiveStore() : null)
  if (!liveStore) {
    throw new Error(
      `useTable(${name}): no LiveStore runtime in scope. Either render inside a <LiveStoreProvider>, or pass \`liveStore\` explicitly.`,
    )
  }

  const collection = reactUse(
    getCollection(name, { ...options, liveStore }),
  )

  return {
    collection: collection as Collection<LiveStoreRow, string>,
    table: buildQuery(name, liveStore.tables as Record<string, any>) as never,
    schema: liveStore.schema,
    isReadOnly: Boolean((liveStore.tables as Record<string, any>)[name]?.['__readOnly']),
  }
}

// ─────────────────────────────────────────────────────────────────────
// Bulk + loaders
// ─────────────────────────────────────────────────────────────────────

/**
 * Bulk-import many collections in one call. Returns a `Map<name, collection>`.
 *
 * Tier 1.4 — replaces the 60+ files in alkitab-alhakeem that each do
 * `useXxxCollection()` 1-3 times.
 */
export const useTables = <Spec extends Record<string, UseTableOptions<TableName>>>(
  spec: Spec,
): { [K in keyof Spec]: Collection<LiveStoreRow, string> } => {
  const liveStore = useLiveStore()
  if (!liveStore) {
    throw new Error('useTables: no LiveStore runtime in scope.')
  }
  const out: Record<string, any> = {}
  for (const [name, opts] of Object.entries(spec)) {
    out[name] = reactUse(getCollection(name, { ...(opts as UseTableOptions<TableName>), liveStore }))
  }
  return out as { [K in keyof Spec]: Collection<LiveStoreRow, string> }
}

/**
 * Loader-side equivalent of `useTable`. Returns a `Promise<Collection>` —
 * safe in TanStack Router loaders (no React tree required).
 */
export const preloadTable = <TName extends TableName>(
  name: TName,
  options: UseTableOptions<TName> & { liveStore: UseTableLiveStore },
): Promise<Collection<LiveStoreRow, string>> => getCollection(name, options)

/** Type alias re-export. */
export type { RpcClient, RpcConfig }