import React, { useCallback, useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'

import { uiState$ } from '../livestore/queries.ts'
import { useAppStore } from '../livestore/store.ts'
import { useTodoCollection } from '../db/todoCollection.ts'

export const MainSection: React.FC = () => {
  const store = useAppStore()
  const todosCollection = useTodoCollection()
  const { data: todos } = useLiveQuery(
    (q) =>
      q
        .from({ todo: todosCollection })
        .select(({ todo }) => ({ id: todo.id, text: todo.text })),
    [],
  )
  const { data: todoCompletion } = useLiveQuery(
    (q) =>
      q
        .from({ todo: todosCollection })
        .select(({ todo }) => ({ id: todo.id, completed: todo.completed })),
    [],
  )
  const { filter } = store.useQuery(uiState$) as unknown as {
    filter: 'all' | 'active' | 'completed'
  }

  const visibleTodos = useMemo(() => {
    if (!todos || !todoCompletion) return []
    const completionById = new Map(
      todoCompletion.map((todo) => [todo.id, todo.completed]),
    )
    const todosWithCompletion = todos.map((todo) => ({
      ...todo,
      completed: completionById.get(todo.id) ?? false,
    }))
    if (filter === 'active') {
      return todosWithCompletion.filter((todo) => !todo.completed)
    }
    if (filter === 'completed') {
      return todosWithCompletion.filter((todo) => todo.completed)
    }
    return todosWithCompletion
  }, [todos, todoCompletion, filter])

  const handleTodoToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const id = e.currentTarget.dataset.todoId
      if (!id) return
      todosCollection.update(id, (draft) => {
        draft.completed = !draft.completed
      })
    },
    [todosCollection],
  )

  const handleTodoDelete = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const id = e.currentTarget.dataset.todoId
      if (!id) return
      todosCollection.delete(id)
    },
    [todosCollection],
  )

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
                data-todo-id={todo.id}
                onChange={handleTodoToggle}
              />
              <label>{todo.text}</label>
              <button
                type="button"
                className="destroy"
                data-todo-id={todo.id}
                onClick={handleTodoDelete}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
