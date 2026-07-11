import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@livestore/react'

import { uiState$ } from '../livestore/queries.ts'
import { useAppStore } from '../livestore/store.ts'
import { useTodoCollection } from '../db/todoCollection.ts'
import type { Todo } from '../db/todoSchema.ts'

export const MainSection: React.FC = () => {
  const store = useAppStore()
  const todos = useTodoCollection()
  const { filter } = useQuery(uiState$) as unknown as {
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