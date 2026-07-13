import { useMemo } from "react";
import type { Collection, WritableDeep } from "@tanstack/db";

import type { LiveStoreRow } from "./liveStoreCollection.ts";
import { useTable, type UseTableOptions, type TableName } from "./useTable.ts";

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/**
 * Mutable CRUD actions returned by {@link useCrud}.
 *
 * - `create(input)` — pass the row without an `id` (or with one to
 *   override) and one is auto-generated via `crypto.randomUUID()` when
 *   missing. The full row is forwarded to `collection.insert(...)`.
 * - `update(id, changes)` — pass a `Partial<TRow>` to merge, or a
 *   callback that mutates a draft in place (TanStack DB supports both).
 * - `remove(id)` — `collection.delete(id)`.
 * - `bulkInsert(rows)` — Tier 1.7 of the dream-list. Forwards an array
 *   of rows to `collection.insert(rows)` in a single transaction. When
 *   the schema declares a `v1.<Model>BulkUpserted` event, the package
 *   auto-wires the commit handler so ONE event is committed instead of
 *   N per-row `*Created` events. Rows missing an `id` get one via
 *   `crypto.randomUUID()`.
 * - `bulkUpsert(rows)` — same as `bulkInsert`; the name signals intent
 *   (a batch that may overwrite existing rows). The materialised event
 *   is the same — wiring keeps a single `v1.<Model>BulkUpserted` per
 *   transaction.
 */
export interface CrudActions<TRow extends LiveStoreRow> {
  create: (input: Omit<TRow, "id"> & { id?: string }) => void;
  bulkInsert: (rows: ReadonlyArray<Omit<TRow, "id"> & { id?: string }>) => void;
  bulkUpsert: (rows: ReadonlyArray<Omit<TRow, "id"> & { id?: string }>) => void;
  update: (id: string, changes: Partial<TRow> | ((draft: TRow) => void)) => void;
  remove: (id: string) => void;
}

/** Tuple shape returned by {@link useCrud}. */
export type CrudResult<TRow extends LiveStoreRow = LiveStoreRow> = [
  Collection<TRow, string>,
  CrudActions<TRow>,
];

// ─────────────────────────────────────────────────────────────────────
// React hook
// ─────────────────────────────────────────────────────────────────────

/**
 * Tier 3.6 of the dream-list — a single `useCrud("lessons")` hook
 * that returns `[collection, { create, update, remove }]` with full
 * type inference. Built on top of {@link useTable}, so it inherits
 * every option `useTable` supports (where filters, RPC write-back,
 * commit overrides, etc.).
 *
 * Pass the row type as the generic parameter; the row type is
 * `LiveStoreRow` (a `Record<string, unknown> & { id: string }`) by
 * default. Consumers who want stronger typing cast or import their
 * Prisma-derived row type at the call site.
 *
 * @example
 * ```ts
 * const [posts, { create, update, remove }] = useCrud<PostRow>('Post')
 *
 * create({ title: 'hi', body: 'world' })            // id auto-generated
 * create({ id: 'fixed', title: 'hi', body: '... ' }) // explicit id
 * update(post.id, { title: 'new' })                 // partial merge
 * update(post.id, (draft) => { draft.title = 'new' }) // draft mutation
 * remove(post.id)
 * ```
 */
export const useCrud = <TRow extends LiveStoreRow = LiveStoreRow>(
  name: TableName,
  options: UseTableOptions<TableName> = {},
): CrudResult<TRow> => {
  const { collection } = useTable(name, options);

  const actions = useMemo<CrudActions<TRow>>(() => {
    const coll = collection as unknown as Collection<TRow, string>;

    // Tier 1.7 — fill missing ids in one pass so the bulk insert can be
    // a single `collection.insert(rows)` call (the optimistic handler
    // groups them into one transaction and one `v1.<Model>BulkUpserted`
    // event when the schema declares it).
    const fillMissingIds = (rows: ReadonlyArray<Omit<TRow, "id"> & { id?: string }>): TRow[] =>
      rows.map((row) => {
        const id = row.id ?? crypto.randomUUID();
        return { ...row, id } as unknown as TRow;
      });

    return {
      create: (input) => {
        const id = input.id ?? crypto.randomUUID();
        coll.insert({ ...input, id } as unknown as TRow);
      },
      bulkInsert: (rows) => {
        if (rows.length === 0) return;
        coll.insert(fillMissingIds(rows) as unknown as TRow);
      },
      bulkUpsert: (rows) => {
        if (rows.length === 0) return;
        coll.insert(fillMissingIds(rows) as unknown as TRow);
      },
      update: (id, changes) => {
        if (typeof changes === "function") {
          coll.update(id, changes as unknown as (draft: WritableDeep<TRow>) => void);
          return;
        }
        coll.update(id, (draft: WritableDeep<TRow>) => {
          Object.assign(draft as object, changes as object);
        });
      },
      remove: (id) => {
        coll.delete(id);
      },
    };
  }, [collection]);

  return [collection as unknown as Collection<TRow, string>, actions];
};
