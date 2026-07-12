import { queryDb } from '@livestore/livestore'
import type { Queryable, Store } from '@livestore/livestore'
import { createCollection } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import { useMemo } from 'react'

import { liveStoreCollectionOptions, type LiveStoreRow } from '../db/liveStoreCollection.ts'
import { tables, events, schema } from '../livestore/schema.ts'
import { getOrCreateAppStore, useAppStore } from '../livestore/store.ts'

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/** PascalCase model name (or client-document camelCase) — every key of `tables`. */
export type TableName = keyof typeof tables & string

/**
 * Row type for a given table.
 *
 * The factory's `createLiveStoreDb` types `tables` loosely
 * (`ReturnType<typeof State.SQLite.table>`), which erases the schema
 * generic to `any`. That means `(typeof tables)[TName]['Type']`
 * collapses to `any` / `unknown` for a still-generic `TName` — not
 * useful for `Collection<RowOf<TName>, string>`.
 *
 * Until Tier 0.4 lands (effect-Schema → StandardSchemaV1 wrap, see
 * `todo.md` + `integration/standardSchema.ts`), we return a generic
 * `LiveStoreRow` and let per-model wrappers (e.g. `useTodoCollection`)
 * cast to the concrete row type. Concrete types ARE preserved when you
 * read `(typeof tables)['Todo']['Type']` with a specific (non-generic)
 * key — that's the escape hatch this hook leaves open.
 */
export type RowOf<TName extends TableName> = LiveStoreRow

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
 * Memoised per `(store, name, label, where)` — strict-mode double
 * renders won't create two collections.
 */
export function useTable<TName extends TableName>(
  name: TName,
  options: UseTableOptions = {},
): UseTableResult<TName> {
  // Suspends until the LiveStore store is ready; once resolved, every
  // subsequent render returns the resolved `Store` instance synchronously,
  // so `useMemo` below can pass it to `liveStoreCollectionOptions` without
  // re-suspending.
  const store = useAppStore()

  const label = options.label ?? 'all'
  const where = options.where ?? DEFAULT_WHERE
  const whereKey = JSON.stringify(where)

  return useMemo(() => {
    const table = tables[name] as (typeof tables)[TName]
    const query = buildQuery(name, { where, label })

    const collection = createCollection<RowOf<TName>, string>(
      liveStoreCollectionOptions<RowOf<TName>>({
        id: `${lcFirst(name)}-${label}-${whereKey}`,
        store,
        query,
        getKey,
        commitInsert: makeCommitInsert(store, name),
        commitUpdate: makeCommitUpdate(store, name),
        commitDelete: makeCommitDelete(store, name),
      }),
    )

    return { collection, table, schema } satisfies UseTableResult<TName>
    // `store` is stable (same Promise → same Store), so we only need
    // to recompute when the inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, name, label, whereKey])
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
// useTable.preload — for TanStack Router loaders
// ─────────────────────────────────────────────────────────────────────

/**
 * Kick off the LiveStore store load from a non-React context
 * (TanStack Router loader, event handler, etc.). Returns the same
 * `Promise<Store>` that `useAppStore()` will eventually resolve,
 * so the loader can `await` it to gate the route render on store
 * readiness if it wants to.
 *
 * No-op outside the browser — `createStorePromise` needs OPFS / a
 * web worker, neither of which exist in SSR / Workers environments.
 */
useTable.preload = (): Promise<ReturnType<typeof useAppStore>> => {
  if (typeof window === 'undefined') return Promise.resolve(null as never)
  return getOrCreateAppStore()
}

// Type augmentation so `useTable.preload` shows up in IDEs.
export interface UseTableHook {
  <TName extends TableName>(
    name: TName,
    options?: UseTableOptions,
  ): UseTableResult<TName>
  preload: () => Promise<ReturnType<typeof useAppStore>>
}

// Re-export the client-doc event helper so callers can grab the
// `set` event factory for documents without a `useTable` path.
export const setClientDocEvent = clientDocSetEventFor