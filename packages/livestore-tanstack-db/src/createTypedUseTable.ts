/**
 * Typed per-table factory.
 *
 * `createTypedTable<TRow>({...})` takes a single table spec with typed
 * commit handlers and returns a React hook whose `.collection` is
 * `Collection<TRow, string>`.
 *
 * Follows the same pattern as `@tanstack/electric-db-collection` but
 * adapted for LiveStore's local-first sync model.
 *
 * @example
 * ```ts
 * const useTodoTable = createTypedTable<Todo>({
 *   id: 'todos',
 *   store: useAppStore,
 *   query: queryDb(tables.Todo.where({ deletedAt: null })),
 *   commits: {
 *     commitInsert: (row, store) =>
 *       store.commit(events.todoCreated({ id: row.id, text: row.text })),
 *   },
 * })
 *
 * const { collection } = useTodoTable()
 * // collection: Collection<Todo, string>
 * ```
 */
import { createCollection } from "@tanstack/db";
import type { Collection } from "@tanstack/db";
import type { Queryable, Store } from "@livestore/livestore";
import { useMemo } from "react";

import { liveStoreCollectionOptions } from "./liveStoreCollection.ts";

export interface TypedTableOptions<TRow> {
  /** Unique collection id (used by TanStack DB for devtools/logging). */
  id: string;
  /** LiveStore `Store` factory (e.g. `useAppStore`). */
  store: () => Store<any>;
  /** The LiveStore queryable for this table. */
  query: Queryable<ReadonlyArray<Record<string, unknown> & { id: string }>>;
  /** `true` for server-authoritative (audit logs, etc.). */
  isReadOnly?: boolean;
  /** Commit handlers — `store` is injected by the factory. */
  commits?: {
    commitInsert?: (row: TRow, store: Store<any>) => void;
    commitUpdate?: (original: TRow, changes: Partial<TRow>, store: Store<any>) => void;
    commitDelete?: (row: TRow, store: Store<any>) => void;
  };
}

export interface TypedTableResult<TRow extends object> {
  collection: Collection<TRow, string>;
  isReadOnly: boolean;
}

/**
 * Build a typed table hook for a single table.
 *
 * Returns a React hook (no arguments) whose `.collection` is
 * `Collection<TRow, string>`.
 */
export const createTypedTable = <TRow extends object>(
  options: TypedTableOptions<TRow>,
): (() => TypedTableResult<TRow>) => {
  const useTypedTable = (): TypedTableResult<TRow> => {
    const storeInstance = options.store();

    const collection = useMemo(
      () =>
        createCollection(
          liveStoreCollectionOptions({
            id: options.id,
            store: storeInstance,
            query: options.query,
            getKey: (row) => (row as { id: string }).id,
            ...(options.isReadOnly !== undefined ? { isReadOnly: options.isReadOnly } : {}),
            ...(options.commits?.commitInsert
              ? {
                  onInsert: async ({ transaction }) => {
                    for (const mutation of transaction.mutations) {
                      const row = mutation.modified as unknown as TRow;
                      options.commits!.commitInsert!(row, storeInstance);
                    }
                  },
                }
              : {}),
            ...(options.commits?.commitUpdate
              ? {
                  onUpdate: async ({ transaction }) => {
                    for (const mutation of transaction.mutations) {
                      const original = mutation.original as unknown as TRow;
                      const changes = mutation.changes as unknown as Partial<TRow>;
                      options.commits!.commitUpdate!(original, changes, storeInstance);
                    }
                  },
                }
              : {}),
            ...(options.commits?.commitDelete
              ? {
                  onDelete: async ({ transaction }) => {
                    for (const mutation of transaction.mutations) {
                      const row = mutation.original as unknown as TRow;
                      options.commits!.commitDelete!(row, storeInstance);
                    }
                  },
                }
              : {}),
          }),
        ),
      [storeInstance, options.query, options.isReadOnly],
    );

    return {
      collection: collection as unknown as Collection<TRow, string>,
      isReadOnly: options.isReadOnly ?? false,
    };
  };

  return useTypedTable;
};
