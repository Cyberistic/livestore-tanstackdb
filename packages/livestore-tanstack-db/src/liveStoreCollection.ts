import { createCollection } from '@tanstack/db'
import type {
  CollectionConfig,
  InsertMutationFn,
  UpdateMutationFn,
  DeleteMutationFn,
  ChangeMessage,
  DeleteKeyMessage,
} from '@tanstack/db'
import type { Store, Queryable, Unsubscribe } from '@livestore/livestore'

/**
 * A single row that lives in LiveStore and is mirrored into a TanStack DB collection.
 *
 * The row shape is intentionally generic so this adapter works with any
 * LiveStore table (todos, comments, projects, ...). Callers narrow it via
 * the `getKey` + schema they pass to `createCollection`.
 */
export type LiveStoreRow = Record<string, unknown> & { id: string }

/** A LiveStore queryable whose results are the rows to mirror. */
type LiveStoreQueryable<T> = Queryable<ReadonlyArray<T>>

/**
 * Decide whether a LiveStore row is "alive" in the TanStack DB collection.
 *
 * LiveStore tables often use a `deletedAt` (or similar) soft-delete column.
 * TanStack DB collections prefer hard deletes in their sync protocol, so we
 * let callers plug in a predicate that decides which rows count as present.
 */
export type IsRowLive<T extends LiveStoreRow> = (row: T) => boolean

const defaultIsRowLive: IsRowLive<LiveStoreRow> = (row) => {
  const deletedAt = (row as { deletedAt?: unknown }).deletedAt
  return deletedAt === null || deletedAt === undefined || deletedAt === 0
}

/**
 * Convert a LiveStore materialised row into the shape the TanStack DB
 * collection expects. Override this when the columns need reification
 * (e.g. LiveStore stores `deletedAt` as `number | null`, but the
 * client-facing schema wants `Date | null`).
 */
export type CoerceRow<TIn extends LiveStoreRow, TOut extends LiveStoreRow> = (
  row: TIn,
) => TOut

export interface LiveStoreCollectionConfig<
  TIn extends LiveStoreRow,
  TOut extends LiveStoreRow = TIn,
> {
  /** A unique id for the collection (used by TanStack DB for devtools/logging). */
  id: string

  /** The LiveStore `Store` instance to bridge to. */
  store: Store<any>

  /** A LiveStore query whose results are the rows mirrored into TanStack DB. */
  query: LiveStoreQueryable<TIn>

  /** Extract the primary key from a row. Defaults to `row.id`. */
  getKey?: (row: TOut) => string

  /** Translate a TanStack DB insert into the LiveStore events that produce it. */
  commitInsert?: (row: TOut) => void

  /** Translate a TanStack DB update into LiveStore events. */
  commitUpdate?: (original: TOut, changes: Partial<TOut>) => void

  /** Translate a TanStack DB delete into LiveStore events. */
  commitDelete?: (row: TOut) => void

  /** Decide which LiveStore rows are visible in the collection. */
  isRowLive?: IsRowLive<TIn>

  /**
   * Marks this table as server-authoritative. The package's
   * `useTable(name)` checks `isReadOnly` and refuses to wire commit
   * handlers when true (Tier 2.1). The default factory in
   * `@cyberistic/livestore-prisma` sets this to true for any table in
   * `prisma/livestore.annotations.json` that has `serverOnly: true`.
   */
  isReadOnly?: boolean

  /** Map a raw LiveStore row into the collection's output type. */
  coerce?: CoerceRow<TIn, TOut>
}

type Change<T extends LiveStoreRow> = ChangeMessage<T, string> | DeleteKeyMessage<string>

/**
 * Bridge a LiveStore query into a TanStack DB collection.
 *
 * LiveStore already owns the "sync engine" role here: it has its own local
 * SQLite store, its own optimistic state, its own WebSocket transport. So we
 * follow Pattern B from the TanStack DB collection-options-creator guide:
 *
 *   - We provide the `sync` function that subscribes to LiveStore and
 *     forwards change messages into TanStack DB with begin/write/commit.
 *   - We provide `onInsert` / `onUpdate` / `onDelete` that translate the
 *     TanStack DB mutation into the appropriate LiveStore event commit.
 */
export function liveStoreCollectionOptions<
  TIn extends LiveStoreRow,
  TOut extends LiveStoreRow = TIn,
>(
  config: LiveStoreCollectionConfig<TIn, TOut>,
): CollectionConfig<TOut, string> {
  const {
    id,
    store,
    query,
    getKey = (row: TOut) => (row as { id: string }).id,
    commitInsert,
    commitUpdate,
    commitDelete,
    isRowLive = defaultIsRowLive as IsRowLive<TIn>,
    coerce = ((row: TIn) => row as unknown as TOut) as CoerceRow<TIn, TOut>,
  } = config

  const sync = (
    params: Parameters<
      NonNullable<CollectionConfig<TOut, string>['sync']['sync']>
    >[0],
  ) => {
    const { begin, write, commit, markReady } = params

    let snapshot = new Map<string, TOut>()
    let initialSyncComplete = false
    const eventBuffer: Array<ReadonlyArray<TIn>> = []

    const apply = (rows: ReadonlyArray<TIn>) => {
      const next = new Map<string, TOut>()
      for (const row of rows) {
        if (!isRowLive(row)) continue
        const coerced = coerce(row)
        next.set(getKey(coerced), coerced)
      }

      begin({ immediate: true })

      const messages: Array<Change<TOut>> = []
      for (const [key, row] of next) {
        const prev = snapshot.get(key)
        if (prev === undefined) {
          messages.push({ type: 'insert', value: row, key })
        } else if (prev !== row) {
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
      const safeRows = (rows ?? []) as ReadonlyArray<TIn>

      if (!initialSyncComplete) {
        // Buffer the pre-sync snapshot so TanStack DB only commits once
        // we've drained the dedup'd initial state.
        eventBuffer.push(safeRows)
        return
      }

      apply(safeRows)
    })

    queueMicrotask(() => {
      try {
        const seen = new Map<string, TOut>()
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

  const onInsert: InsertMutationFn<TOut, string> = async ({ transaction }) => {
    for (const mutation of transaction.mutations) {
      const row = mutation.modified as TOut
      commitInsert?.(row)
    }
  }

  const onUpdate: UpdateMutationFn<TOut, string> = async ({ transaction }) => {
    for (const mutation of transaction.mutations) {
      const original = mutation.original as TOut
      const changes = mutation.changes as Partial<TOut>
      commitUpdate?.(original, changes)
    }
  }

  const onDelete: DeleteMutationFn<TOut, string> = async ({ transaction }) => {
    for (const mutation of transaction.mutations) {
      const original = mutation.original as TOut
      commitDelete?.(original)
    }
  }

  return {
    id,
    getKey: getKey as (item: TOut) => string,
    sync: { sync, rowUpdateMode: 'partial' },
    onInsert,
    onUpdate,
    onDelete,
  }
}

// Re-export so consumers can use `createCollection` directly with the result
// of `liveStoreCollectionOptions` without pulling in `@tanstack/db` themselves.
export { createCollection }