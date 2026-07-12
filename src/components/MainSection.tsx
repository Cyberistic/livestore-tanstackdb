import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'

import type { Todo } from '../db/todoSchema.ts'
import { db } from '../livestore/schema.ts'
import { uiState$ } from '../livestore/queries.ts'
import { useAppStore } from '../livestore/store.ts'

export const MainSection: React.FC = () => {
  const store = useAppStore()
  // Tier 2.1 — `db.todos` resolves to the memoised TanStack DB
  // collection via `useTable("Todo")` because we're inside a React
  // render. Same identity across renders, so the `useLiveQuery`
  // subscription stays stable.
  const todos = db.todos as unknown as ReturnType<
    typeof import('../db/todoCollection.ts')['useTodoCollection']
  >
  const { filter } = store.useQuery(uiState$, { store: store as never }) as unknown as {
    newTodoText: string
    filter: 'all' | 'active' | 'completed'
  }

  const { data: visibleTodos } = useLiveQuery((q) => {
    let query = q.from({ todo: todos })
    if (filter === 'completed') {
      query = query.where(({ todo }) => eq(todo.completed, true))
    } else if (filter === 'active') {
      query = query.where(({ todo }) => eq(todo.completed, false))
    }
    return query
  })

  const handleToggle = (todo: Todo) => {
    todos.update(todo.id, (draft) => {
      draft.completed = !todo.completed
    })
  }

  const handleDelete = (todo: Todo) => {
    todos.delete(todo.id)
  }

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo) => (
          <li key={todo.id}>
            <div className="state">
              <input
                type="checkbox"
                className="toggle"
                checked={todo.completed}
                onChange={() => handleToggle(todo)}
              />
              <label>{todo.text}</label>
              <button
                type="button"
                className="destroy"
                onClick={() => handleDelete(todo)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}