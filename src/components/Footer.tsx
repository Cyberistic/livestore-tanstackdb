import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@livestore/react'
import { useCallback } from 'react'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { useTodoCollection } from '../db/todoCollection.ts'

export const Footer = () => {
  const store = useAppStore()
  const todos = useTodoCollection()
  const { filter } = useQuery(uiState$) as unknown as {
    newTodoText: string
    filter: 'all' | 'active' | 'completed'
  }

  const { data: activeTodos } = useLiveQuery((q) =>
    q.from({ todo: todos }).where(({ todo }) => eq(todo.completed, false)),
  )
  const incompleteCount = activeTodos.length

  const setFilter = useCallback(
    (next: 'all' | 'active' | 'completed') =>
      store.commit(events.uiStateSet({ filter: next })),
    [store],
  )

  const handleClearCompleted = useCallback(() => {
    // TanStack DB drives a single transaction with N deletes; the adapter
    // turns each into a LiveStore `v1.TodoDeleted` event.
    const completedIds: Array<string> = todos.toArray
      .filter((t) => t.completed)
      .map((t) => t.id)
    if (completedIds.length === 0) return
    todos.delete(completedIds)
  }, [todos])

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          <a href="#/" className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
            All
          </a>
        </li>
        <li>
          <a href="#/" className={filter === 'active' ? 'selected' : ''} onClick={() => setFilter('active')}>
            Active
          </a>
        </li>
        <li>
          <a
            href="#/"
            className={filter === 'completed' ? 'selected' : ''}
            onClick={() => setFilter('completed')}
          >
            Completed
          </a>
        </li>
      </ul>
      <button type="button" className="clear-completed" onClick={handleClearCompleted}>
        Clear completed
      </button>
    </footer>
  )
}