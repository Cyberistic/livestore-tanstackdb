import { type ChangeEvent, type KeyboardEvent, useCallback, useMemo, useRef } from "react";

import { useCrud } from "livestore-tanstack-db";

import { uiState$ } from "../livestore/queries.ts";
import { events, schema, tables } from "../livestore/schema.ts";
import { useAppStore } from "../livestore/store.ts";
import type { Todo } from "../db/todoSchema.ts";

const splitRows = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const newTodoInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "16px 16px 16px 60px",
  margin: 0,
  fontSize: 24,
  fontFamily: "inherit",
  fontWeight: 300,
  lineHeight: 1.3,
  color: "inherit",
  background: "rgba(0, 0, 0, 0.003)",
  boxShadow: "inset 0 -2px 1px rgba(0,0,0,0.03)",
  border: "none",
  outline: "none",
  resize: "none",
  boxSizing: "border-box",
  overflow: "hidden",
};

export const Header = () => {
  const store = useAppStore();
  const liveStore = useMemo(() => ({ store, tables, events, schema }), [store]);
  const [, { create, bulkUpsert }] = useCrud<Todo>("Todo", {
    liveStore,
  });
  const { newTodoText } = store.useQuery(uiState$);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const updatedNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  );

  const submit = useCallback(() => {
    const lines = splitRows(newTodoText);
    if (lines.length === 0) return;

    const now = new Date();

    if (lines.length === 1) {
      // Single line → Tier 0.x. `v1.TodoCreated` fires once.
      create({ text: lines[0], createdAt: now } as Partial<Todo> as never);
    } else {
      // Multiple lines → Tier 1.7. One `v1.TodoBulkUpserted { rows }` event
      // carries every line. Each line becomes one Todo.
      bulkUpsert(lines.map((text) => ({ text, createdAt: now })) as Partial<Todo>[] as never[]);
    }
    store.commit(events.uiStateSet({ newTodoText: "" }));
  }, [create, bulkUpsert, newTodoText, store]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => updatedNewTodoText(e.target.value),
    [updatedNewTodoText],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Plain Enter submits. Shift+Enter inserts a literal newline so
      // the user can paste/type multiple rows for the bulk path.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart ?? newTodoText.length;
        const end = ta.selectionEnd ?? newTodoText.length;
        const next = newTodoText.slice(0, start) + "\n" + newTodoText.slice(end);
        updatedNewTodoText(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 1;
          // Resize textarea to fit the content
          ta.style.height = "auto";
          ta.style.height = `${ta.scrollHeight}px`;
        });
      }
    },
    [submit, newTodoText, updatedNewTodoText],
  );

  const rowCount = useMemo(() => splitRows(newTodoText).length, [newTodoText]);
  const isBulk = rowCount > 1;

  // Resize the textarea on mount + whenever text changes.
  const linesForHeight = newTodoText.split("\n").length;
  const textareaRows = isBulk ? Math.min(Math.max(linesForHeight, 2), 6) : 1;

  return (
    <header className="header">
      <h1>todos</h1>
      <textarea
        ref={inputRef}
        className="new-todo"
        placeholder={
          isBulk ? `${rowCount} todos — Enter submits as 1 bulk event` : "What needs to be done?"
        }
        value={newTodoText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={textareaRows}
        autoFocus
        style={newTodoInputStyle}
      />
    </header>
  );
};
