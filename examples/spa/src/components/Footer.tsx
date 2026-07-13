import { useCallback, useMemo } from "react";
import { useLiveQuery } from "@tanstack/react-db";

import { uiState$ } from "../livestore/queries.ts";
import { events } from "../livestore/schema.ts";
import { useAppStore } from "../livestore/store.ts";
import { useTodoCollection } from "../db/todoCollection.ts";

export const Footer = () => {
  const store = useAppStore();
  const todosCollection = useTodoCollection();
  const { data: todos } = useLiveQuery((_q) => todosCollection, []);
  const { filter } = store.useQuery(uiState$) as unknown as {
    newTodoText: string;
    filter: "all" | "active" | "completed";
  };

  const incompleteCount = useMemo(() => todos?.filter((t) => !t.completed).length ?? 0, [todos]);

  const setFilter = useCallback(
    (filter: "all" | "active" | "completed") => store.commit(events.uiStateSet({ filter })),
    [store],
  );
  const handleAllClick = useCallback(() => setFilter("all"), [setFilter]);
  const handleActiveClick = useCallback(() => setFilter("active"), [setFilter]);
  const handleCompletedClick = useCallback(() => setFilter("completed"), [setFilter]);

  const handleClearCompleted = useCallback(() => {
    if (!todos) return;
    for (const todo of todos) {
      if (todo.completed) {
        todosCollection.delete(todo.id);
      }
    }
  }, [todos, todosCollection]);

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          <a href="#/" className={filter === "all" ? "selected" : ""} onClick={handleAllClick}>
            All
          </a>
        </li>
        <li>
          <a
            href="#/"
            className={filter === "active" ? "selected" : ""}
            onClick={handleActiveClick}
          >
            Active
          </a>
        </li>
        <li>
          <a
            href="#/"
            className={filter === "completed" ? "selected" : ""}
            onClick={handleCompletedClick}
          >
            Completed
          </a>
        </li>
      </ul>
      <button type="button" className="clear-completed" onClick={handleClearCompleted}>
        Clear completed
      </button>
    </footer>
  );
};
