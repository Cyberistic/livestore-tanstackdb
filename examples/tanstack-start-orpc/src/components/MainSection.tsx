import { useCallback } from "react";
import { useLiveQuery } from "@tanstack/react-db";

import { useTable } from "livestore-tanstack-db";

import { uiState$ } from "../livestore/queries.ts";
import { rpcConfig } from "../livestore/schema.ts";
import { useAppStore } from "../livestore/store.ts";
import { rpcPosts } from "../lib/orpc-client.ts";
import { TodoItem } from "./TodoItem.tsx";

/**
 * Main visible section of the app — renders the active todos, applies
 * the `uiState.filter`, and wires toggle/delete back to the
 * collection.
 *
 * Tier 0.5 / 1.3 — the filter (all / active / completed) is pushed
 * down to the LiveStore query via `useTable(name, { where })` so:
 *   - the reactive query re-emits a new snapshot when the filter changes
 *     (no client-side `Array.filter` round-trip)
 *   - the auto-derived `deletedAt: null` predicate is still applied
 *     (Tier 1.2)
 *   - the TanStack DB live query stays reactive because both the
 *     collection's snapshot AND the `q.where(...)` are invalidated
 *     together
 *
 * `useTable('Todo')` reads the runtime from `<LiveStoreProvider>` —
 * no explicit `liveStore` option (Tier 3.1).
 */
export const MainSection = () => {
  const store = useAppStore();
  const { filter } = store.useQuery(uiState$) as unknown as {
    filter: "all" | "active" | "completed";
  };

  const where =
    filter === "active"
      ? { completed: false }
      : filter === "completed"
        ? { completed: true }
        : undefined;

  const { collection: todosCollection } = useTable("Todo", {
    rpc: { client: rpcPosts, config: rpcConfig },
    where,
  });

  const { data: todos } = useLiveQuery(
    (q) =>
      q
        .from({ todo: todosCollection })
        .select(({ todo }) => todo)
        .orderBy(({ todo }) => todo.createdAt, "desc"),
    [todosCollection],
  );

  const onToggle = useCallback(
    (id: string) => {
      todosCollection.update(id, (draft) => {
        draft.completed = !draft.completed;
      });
    },
    [todosCollection],
  );

  const onDelete = useCallback(
    (id: string) => {
      todosCollection.delete(id);
    },
    [todosCollection],
  );

  return (
    <section className="main">
      <ul className="todo-list">
        {(todos ?? []).map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo as unknown as Parameters<typeof TodoItem>[0]["todo"]}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  );
};
