import type { Collection } from "@tanstack/db";
import { useMemo } from "react";

import { useTable } from "livestore-tanstack-db";

import { events, schema, tables } from "../livestore/schema.ts";
import { useAppStore } from "../livestore/store.ts";
import type { Todo } from "./todoSchema.ts";

/**
 * Options for the SPA's `useTodoCollection` hook — Tier 0.5 / 1.3.
 * Pass `where` to push the filter down to the LiveStore query (and
 * through to the TanStack DB `q.where(...)` so the join stays
 * reactive). The filter is applied in addition to the auto-derived
 * soft-delete predicate (`deletedAt: null`).
 *
 * Examples:
 *   useTodoCollection()                                    // live rows
 *   useTodoCollection({ where: { completed: false } })    // active only
 *   useTodoCollection({ where: { completed: true } })     // completed
 */
export interface UseTodoCollectionOptions {
  where?: Record<string, unknown>;
}

export const useTodoCollection = (
  options: UseTodoCollectionOptions = {},
): Collection<Todo, string> => {
  const store = useAppStore();
  const liveStore = useMemo(() => ({ store, tables, events, schema }), [store]);
  const { collection } = useTable("Todo", {
    liveStore,
    where: options.where,
  });
  return collection as unknown as Collection<Todo, string>;
};
