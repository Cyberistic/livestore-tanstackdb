import { createCollection } from '@tanstack/db'
import type {
  BaseCollectionConfig,
  CollectionConfig,
  InsertMutationFnParams,
  UpdateMutationFnParams,
  DeleteMutationFnParams,
  UtilsRecord,
} from '@tanstack/db'
import type { Store, Queryable, Unsubscribe } from '@livestore/livestore'

// ─── Public types ──────────────────────────────────────────────────

/** A single row that lives in LiveStore and is mirrored into a TanStack DB collection. */
export type LiveStoreRow = Record<string, unknown> & { id: string }

/** Decide which LiveStore rows are visible in the collection. */
export type IsRowLive<T extends LiveStoreRow> = (row: T) => boolean

/** Map a raw LiveStore row into the collection's output type. */
export type CoerceRow<TIn extends LiveStoreRow, TOut extends LiveStoreRow> = (
  row: TIn,
) => TOut

/**
 * LiveStore collection utilities — exposed via `collection.utils`.
 *
 * Unlike Electric (which needs `awaitTxId` / `awaitMatch` for async server
 * confirmation), LiveStore's sync is local. The store commits events
 * synchronously and `store.subscribe` fires immediately. So the only
 * utility is direct access to the underlying `Store`.
 */
export interface LiveStoreCollectionUtils<T extends LiveStoreRow> extends UtilsRecord {
  /** Direct access to the underlying LiveStore `Store` instance. */
  getStore: () => Store<any>
}

// ─── Config ────────────────────────────────────────────────────────

/**
 * Configuration for `liveStoreCollectionOptions`.
 *
 * Mirrors `ElectricCollectionConfig` in structure but is adapted for
 * LiveStore's local-first sync model:
 *
 * - No `shapeOptions` (LiveStore has its own sync transport).
 * - `onInsert/onUpdate/onDelete` are **synchronous** — they commit
 *   LiveStore events and return `void`. No txid matching needed.
 * - `utils.getStore()` gives direct access to the LiveStore `Store`.
 */
export interface LiveStoreCollectionConfig<
  T extends LiveStoreRow = LiveStoreRow,
  TSchema extends import('@standard-schema/spec').StandardSchemaV1 = never,
> extends Omit<
    BaseCollectionConfig<T, string, TSchema, LiveStoreCollectionUtils<T>>,
    'onInsert' | 'onUpdate' | 'onDelete' | 'syncMode'
  > {
  /** The LiveStore `Store` instance to bridge to. */
  store: Store<any>

  /** A LiveStore query whose results are the rows mirrored into TanStack DB. */
  query: Queryable<ReadonlyArray<T>>

  /** Decide which LiveStore rows are visible. Defaults to `deletedAt === null`. */
  isRowLive?: IsRowLive<T>

  /** Map a raw LiveStore row into the collection's output type. */
  coerce?: CoerceRow<T, T>

  /**
   * Marks this table as server-authoritative. When `true`, the collection
   * won't wire commit handlers (Tier 2.1). The `useTable` helper checks
   * this and refuses client writes.
   */
  isReadOnly?: boolean

  /**
   * Translate a TanStack DB insert into a LiveStore event commit.
   * Called asynchronously (TanStack DB requirement) but the actual commit
   * is synchronous — no txid matching needed.
   */
  onInsert?: (params: InsertMutationFnParams<T, string, LiveStoreCollectionUtils<T>>) => Promise<void>

  /**
   * Translate a TanStack DB update into a LiveStore event commit.
   */
  onUpdate?: (params: UpdateMutationFnParams<T, string, LiveStoreCollectionUtils<T>>) => Promise<void>

  /**
   * Translate a TanStack DB delete into a LiveStore event commit.
   */
  onDelete?: (params: DeleteMutationFnParams<T, string, LiveStoreCollectionUtils<T>>) => Promise<void>
}

// ─── Defaults ──────────────────────────────────────────────────────

const defaultIsRowLive: IsRowLive<LiveStoreRow> = (row) => {
  const deletedAt = (row as { deletedAt?: unknown }).deletedAt
  return deletedAt === null || deletedAt === undefined || deletedAt === 0
}

/** Deep equality check for LiveStore rows (plain objects from SQLite). */
const rowsEqual = (a: LiveStoreRow, b: LiveStoreRow): boolean => {
  if (a === b) return true
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false
  }
  return true
}

// ─── Main function ─────────────────────────────────────────────────

/**
 * Creates LiveStore collection options for use with `createCollection`.
 *
 * Follows the same pattern as `@tanstack/electric-db-collection`'s
 * `electricCollectionOptions` but adapted for LiveStore's local-first
 * sync model:
 *
 * - **Sync**: Subscribes to a LiveStore query and diffs against the
 *   previous snapshot to emit insert/update/delete messages.
 * - **Mutations**: `onInsert/onUpdate/onDelete` commit LiveStore events
 *   synchronously. No async server round-trip or txid matching.
 * - **Utils**: `getStore()` for direct access to the LiveStore `Store`.
 *
 * @example
 * ```ts
 * import { createCollection } from '@tanstack/db'
 * import { liveStoreCollectionOptions } from '@cyberistic/livestore-tanstack-db'
 *
 * const todosCollection = createCollection(
 *   liveStoreCollectionOptions({
 *     id: 'todos',
 *     store: appStore,
 *     query: queryDb(tables.Todo.where({ deletedAt: null })),
 *     getKey: (item) => item.id,
 *     onInsert: ({ transaction }) => {
 *       const row = transaction.mutations[0].modified
 *       appStore.commit(events.todoCreated({ id: row.id, text: row.text }))
 *     },
 *   })
 * )
 * ```
 */
export function liveStoreCollectionOptions<T extends LiveStoreRow>(
  config: LiveStoreCollectionConfig<T>,
): Omit<CollectionConfig<T, string>, 'utils' | 'onInsert' | 'onUpdate' | 'onDelete'> &
  Pick<LiveStoreCollectionConfig<T>, 'onInsert' | 'onUpdate' | 'onDelete'> & {
    id?: string
    utils: LiveStoreCollectionUtils<T>
  } {
  const {
    store,
    query,
    getKey = (row: T) => (row as { id: string }).id,
    isRowLive = defaultIsRowLive as IsRowLive<T>,
    coerce = ((row: T) => row as unknown as T) as CoerceRow<T, T>,
    onInsert,
    onUpdate,
    onDelete,
    ...restConfig
  } = config

  // ── Sync: subscribe to LiveStore, diff against previous snapshot ──

  const sync: CollectionConfig<T, string>['sync']['sync'] = (params) => {
    const { begin, write, commit, markReady } = params

    let snapshot = new Map<string, T>()
    let initialSyncComplete = false
    const eventBuffer: Array<ReadonlyArray<T>> = []

    const apply = (rows: ReadonlyArray<T>) => {
      const next = new Map<string, T>()
      for (const row of rows) {
        if (!isRowLive(row)) continue
        const coerced = coerce(row)
        next.set(getKey(coerced), coerced)
      }

      begin({ immediate: true })

      const messages: Array<
        | { type: 'insert'; value: T; key: string }
        | { type: 'update'; value: T; key: string }
        | { type: 'delete'; key: string; value: T }
      > = []

      for (const [key, row] of next) {
        const prev = snapshot.get(key)
        if (prev === undefined) {
          messages.push({ type: 'insert', value: row, key })
        } else if (!rowsEqual(prev, row)) {
          messages.push({ type: 'update', value: row, key })
        }
      }
      for (const [key, prev] of snapshot) {
        if (!next.has(key)) {
          messages.push({ type: 'delete', key, value: prev })
        }
      }

      for (const message of messages) {
        write(message)
      }

      commit()
      snapshot = next
    }

    const unsubscribe: Unsubscribe = store.subscribe(query, (rows) => {
      const safeRows = (rows ?? []) as ReadonlyArray<T>

      if (!initialSyncComplete) {
        eventBuffer.push(safeRows)
        return
      }

      apply(safeRows)
    })

    // Drain the initial snapshot on the next microtask so TanStack DB
    // gets a single atomic commit instead of one per event.
    queueMicrotask(() => {
      try {
        const seen = new Map<string, T>()
        for (const bufferedRows of eventBuffer) {
          for (const row of bufferedRows) {
            if (!isRowLive(row)) continue
            const coerced = coerce(row)
            seen.set(getKey(coerced), coerced)
          }
        }

        begin({ immediate: true })
        for (const row of seen.values()) {
          write({ type: 'insert', value: row })
        }
        commit()
        snapshot = seen
      } finally {
        initialSyncComplete = true
        eventBuffer.length = 0
        markReady()
      }
    })

    return () => {
      unsubscribe()
      snapshot.clear()
    }
  }

  // ── Mutation handlers: commit LiveStore events synchronously ──

  const wrappedOnInsert = onInsert
    ? async (params: InsertMutationFnParams<T, string, LiveStoreCollectionUtils<T>>) => {
        await onInsert(params)
      }
    : undefined

  const wrappedOnUpdate = onUpdate
    ? async (params: UpdateMutationFnParams<T, string, LiveStoreCollectionUtils<T>>) => {
        await onUpdate(params)
      }
    : undefined

  const wrappedOnDelete = onDelete
    ? async (params: DeleteMutationFnParams<T, string, LiveStoreCollectionUtils<T>>) => {
        await onDelete(params)
      }
    : undefined

  // ── Utils ──

  const utils: LiveStoreCollectionUtils<T> = {
    getStore: () => store,
  }

  return {
    ...restConfig,
    getKey,
    sync: { sync, rowUpdateMode: 'partial' },
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils,
  }
}

// Re-export createCollection for convenience
export { createCollection }
