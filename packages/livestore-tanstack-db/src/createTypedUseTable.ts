/**
 * Tier 0.2 / 0.4 — the typed `useTable` factory.
 *
 * The `useTable` exported from `./useTable.ts` is generic over the
 * model name as a string and returns `Collection<unknown, string>` —
 * that's necessary so the package stays schema-source-agnostic (it
 * can't know what rows look like until the consumer plugs in their
 * schemas). But for *consumer* code, the row type must be the actual
 * Prisma / Effect / LiveStore row type, end-to-end, with zero
 * `as unknown as Collection<Todo, string>` casts.
 *
 * `createTypedUseTable<TSchemas>` is the bridge: the consumer calls it
 * once with their typed schemas map, and gets back a fully-typed
 * `useTable` where `useTable('Todo')` returns `Collection<Todo, string>`
 * — no `unknown`, no `never`, no `as unknown as` at the call site.
 *
 * Implementation note: TanStack DB's `Collection<T>` is invariant on `T`,
 * so the adapter's `liveStoreCollectionOptions<TIn, TOut>` infers `TOut`
 * from the commit handler signature. We pass typed commit handlers, and
 * `createCollection` returns a `Collection<Row, string>` where `Row` is
 * `Schema.Schema.Type<TSchemas[TName]>`. The boundary inside this file
 * (the `as Collection<...>` on the last line) is the single, well-named
 * place where TanStack DB's invariant generic meets the typed row.
 *
 * @example
 * ```ts
 * // src/db/todoCollection.ts (per-model wrapper)
 * import { createTypedUseTable } from '@cyberistic/livestore-tanstack-db'
 * import type { Todo } from './todoSchema.ts'
 *
 * const useTable = createTypedUseTable<{ Todo: typeof lsdb.models.Todo }>({
 *   store: useAppStore,
 *   tables: {
 *     Todo: {
 *       query: queryDb(tables.Todo.where({ deletedAt: null })),
 *       commits: {
 *         commitInsert: (row, store) =>
 *           store.commit(events.todoCreated({ id: row.id, text: row.text })),
 *       },
 *     },
 *   },
 * })
 *
 * export const useTodoCollection = (): Collection<Todo, string> =>
 *   useTable('Todo').collection
 * ```
 */
import { createCollection } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { Queryable, Schema, Store } from '@livestore/livestore'
import { useMemo } from 'react'

import { liveStoreCollectionOptions, type LiveStoreRow } from './liveStoreCollection.ts'

/**
 * A typed schemas map keyed by PascalCase model name. Values are the
 * Effect `Schema` instances — the same ones the consumer passed to
 * `createLiveStoreDb({ models })`. The map is `Record<string, unknown>`
 * (rather than `Record<string, Schema.Schema.Any>`) because the upstream
 * `Schema.standardSchemaV1(...)` wrapper produces an intersection type
 * that doesn't structurally satisfy `Schema.Schema.Any` even though
 * its `Context` parameter IS `never`.
 */
export type TypedSchemas = Record<string, unknown>

/** Extract the row type from a typed schema. */
type RowOf<TSchema> = TSchema extends Schema.Schema<infer A, any, any>
  ? A extends object
    ? A
    : never
  : never

/**
 * Per-table spec the consumer provides to {@link createTypedUseTable}.
 *
 * The factory injects the resolved LiveStore `Store` as the second
 * argument of each commit handler so consumers don't have to call
 * `useAppStore()` from a callback (which would throw "Invalid hook
 * call" — TanStack DB fires these outside React's render cycle).
 *
 * `TRow` is the row type the consumer defines (e.g. via
 * `Schema.Schema.Type<typeof TodoSchema>` in the consumer's app). It's
 * a separate type parameter rather than extracted from `TSchema`
 * because the wrapped schema's intersection doesn't structurally satisfy
 * `Schema.Schema.Any`, so `Schema.Schema.Type<TSchema>` would evaluate to
 * `never`. Let the consumer's app supply the row type directly.
 */
export interface TypedTableSpec<TSchema, TRow extends object = Record<string, unknown>> {
  /** The LiveStore queryable whose results mirror into the TanStack DB collection. */
  query: Queryable<ReadonlyArray<Record<string, unknown> & { id: string }>>
  /** Server-authoritative (audit logs, etc.). Defaults to `false`. */
  isReadOnly?: boolean
  /**
   * Per-table commit handlers — typed against the row type.
   * `store` is the resolved LiveStore `Store` (injected by the factory).
   */
  commits?: {
    commitInsert?: (row: TRow, store: Store<any>) => void
    commitUpdate?: (original: TRow, changes: Partial<TRow>, store: Store<any>) => void
    commitDelete?: (row: TRow, store: Store<any>) => void
  }
}

export interface CreateTypedUseTableOptions<
  TSchemas extends TypedSchemas,
  TRowMap extends Record<string, object> = Record<string, object>,
> {
  /** LiveStore `Store` factory (e.g. `useAppStore`). */
  store: () => Store<any>
  /**
   * Per-model table specs. Keys are PascalCase model names; values
   * define the LiveStore query + commit handlers for each table.
   */
  tables: {
    [K in keyof TSchemas & string]: TypedTableSpec<TSchemas[K], TRowMap[K & string]>
  }
}

export interface TypedUseTableResult<TRow extends object> {
  collection: Collection<TRow, string>
  isReadOnly: boolean
}

export interface TypedUseTable<TSchemas extends TypedSchemas, TRowMap extends Record<string, object>> {
  <TName extends keyof TSchemas & string>(name: TName): TypedUseTableResult<TRowMap[TName & string]>
}

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * Build a typed `useTable` hook from a typed schemas map.
 *
 * Returns a function whose return type is fully inferred: calling
 * `useTable('Todo')` returns `{ collection: Collection<Todo, string>, isReadOnly: boolean }`.
 *
 * Implementation: the factory's returned hook body resolves the
 * `Store` (via `options.store()`), wraps each commit handler to inject
 * the store as the second arg, and hands the result to
 * `liveStoreCollectionOptions` + `createCollection`. The internal
 * invariant generic boundary is hidden in this body via the final
 * `as Collection<Row, string>` cast on the last line.
 */
export const createTypedUseTable = <TSchemas extends TypedSchemas>(
  options: CreateTypedUseTableOptions<TSchemas>,
): TypedUseTable<TSchemas> => {
  return <TName extends keyof TSchemas & string>(name: TName): TypedUseTableResult<TSchemas[TName]> => {
    // The wrapped schema's structural intersection doesn't satisfy
    // `Schema.Schema.Any`, so `RowOf<...>` evaluates to `never`. Use
    // the row type from the table spec's commit handler signature
    // instead — that's the canonical source of truth for what a row
    // looks like.
    type CommitInsertSig = NonNullable<TypedTableSpec<TSchemas[TName]>['commits']>['commitInsert']
    type Row = CommitInsertSig extends (row: infer R, ...args: any[]) => any ? R : never
    const storeInstance = options.store()
    const spec = options.tables[name]

    const collection = useMemo(
      () =>
        createCollection(
          liveStoreCollectionOptions({
            id: lcFirst(name),
            store: storeInstance,
            query: spec.query,
            ...(spec.isReadOnly !== undefined ? { isReadOnly: spec.isReadOnly } : {}),
            ...(spec.commits?.commitInsert
              ? {
                  commitInsert: (row: LiveStoreRow) =>
                    spec.commits!.commitInsert!(row as unknown as Row, storeInstance),
                }
              : {}),
            ...(spec.commits?.commitUpdate
              ? {
                  commitUpdate: (original: LiveStoreRow, changes: Partial<LiveStoreRow>) =>
                    spec.commits!.commitUpdate!(
                      original as unknown as Row,
                      changes as unknown as Partial<Row>,
                      storeInstance,
                    ),
                }
              : {}),
            ...(spec.commits?.commitDelete
              ? {
                  commitDelete: (row: LiveStoreRow) =>
                    spec.commits!.commitDelete!(row as unknown as Row, storeInstance),
                }
              : {}),
          }),
        ),
      [storeInstance, name, spec.query, spec.isReadOnly],
    )

    return {
      collection: collection as unknown as Collection<Row, string>,
      isReadOnly: spec.isReadOnly ?? false,
    }
  }
}