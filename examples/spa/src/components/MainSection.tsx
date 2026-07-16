import React, { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";

import { devtoolsOn } from "livestore-tanstack-db/devtools";

import { uiState$ } from "../livestore/queries.ts";
import { useAppStore } from "../livestore/store.ts";
import { useTodoCollection } from "../db/todoCollection.ts";

/**
 * Main visible section of the todo list. The filter (all / active /
 * completed) is pushed down to the LiveStore query via the
 * collection's `where` option (Tier 0.5 / 1.3) so:
 *
 *   - LiveStore's reactive query emits a new snapshot when the filter
 *     changes — no client-side `Array.filter` round-trip
 *   - the auto-derived `deletedAt: null` predicate is still applied
 *     (Tier 1.2) so soft-deleted rows never show up regardless
 *     of filter
 *   - the TanStack DB live query stays reactive because both the
 *     upstream collection's snapshot AND the `q.where(...)` are
 *     invalidated together
 */
export const MainSection: React.FC = () => {
  const store = useAppStore();
  const { filter } = store.useQuery(uiState$) as unknown as {
    filter: "all" | "active" | "completed";
  };

  // The `where` is a top-level `useTable` option (Tier 0.5/1.3) —
  // pushes the filter into LiveStore + TanStack DB.
  const where =
    filter === "active"
      ? { completed: false }
      : filter === "completed"
        ? { completed: true }
        : undefined;
  const todosCollection = useTodoCollection({ where });

  const { data: todos } = useLiveQuery(
    (q) =>
      q
        .from({ todo: todosCollection })
        .select(({ todo }) => ({
          id: todo.id,
          text: todo.text,
          createdAt: todo.createdAt,
          completed: todo.completed,
        }))
        .orderBy(({ todo }) => todo.createdAt, "desc"),
    [todosCollection],
  );

  // Listen for the last bulk-upsert event from the devtools bridge so
  // we can highlight which rows arrived together.
  const [lastBulk, setLastBulk] = useState<{ count: number; rows: string[]; at: number } | null>(
    null,
  );
  useEffect(() => {
    const unsub = devtoolsOn("event-committed", (payload) => {
      if (payload.kind === "remote" && payload.eventName === "v1.TodoBulkUpserted") {
        const args = payload.args as { rows?: Array<{ text?: string }> };
        const rows = (args.rows ?? []).map((r) => r.text ?? "").filter((t) => t.length > 0);
        setLastBulk({ count: rows.length, rows, at: Date.now() });
      }
    });
    return unsub;
  }, []);

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
      {lastBulk && (
        <div
          data-bulk-banner
          style={{
            padding: "6px 16px",
            margin: "0 8px 8px",
            fontSize: 11,
            color: "#92400e",
            background: "rgba(249,115,22,0.08)",
            border: "1px solid rgba(249,115,22,0.25)",
            borderRadius: 3,
            lineHeight: 1.4,
          }}
        >
          <strong>bulk · {lastBulk.count} rows in 1 event</strong>
          <span style={{ marginLeft: 6, color: "#9b9b9b" }}>
            {new Date(lastBulk.at).toLocaleTimeString()}
          </span>
          <div
            style={{
              marginTop: 2,
              color: "#78716c",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {lastBulk.rows.map((text, i) => (
              <span key={i}>
                {i > 0 && " · "}
                <code style={{ background: "rgba(0,0,0,0.04)", padding: "0 3px", borderRadius: 2 }}>
                  {text}
                </code>
              </span>
            ))}
          </div>
        </div>
      )}
      <ul className="todo-list">
        {(todos ?? []).map((todo) => (
          <li key={todo.id}>
            <div className="state">
              <input
                type="checkbox"
                className="toggle"
                id={`todo-toggle-${todo.id}`}
                data-todo-id={todo.id}
                checked={Boolean(todo.completed)}
                onChange={() => onToggle(todo.id)}
              />
              <label htmlFor={`todo-toggle-${todo.id}`}>{todo.text}</label>
              <button
                type="button"
                className="destroy"
                data-todo-id={todo.id}
                onClick={() => onDelete(todo.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
