import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'

import { devtoolsOn } from '@cyberistic/livestore-tanstack-db/devtools'

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
        .select(({ todo }) => ({
          id: todo.id,
          text: todo.text,
          createdAt: todo.createdAt,
        }))
        .orderBy(({ todo }) => todo.createdAt, 'desc'),
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

  // Listen for the last bulk-upsert event from the devtools bridge so we
  // can highlight which rows arrived together.
  const [lastBulk, setLastBulk] = useState<{ count: number; rows: string[]; at: number } | null>(
    null,
  )
  useEffect(() => {
    const unsub = devtoolsOn('event-committed', (payload) => {
      if (
        payload.kind === 'remote' &&
        payload.eventName === 'v1.TodoBulkUpserted'
      ) {
        const args = payload.args as { rows?: Array<{ text?: string }> }
        const rows = (args.rows ?? [])
          .map((r) => r.text ?? '')
          .filter((t) => t.length > 0)
        setLastBulk({ count: rows.length, rows, at: Date.now() })
      }
    })
    return unsub
  }, [])

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
      {lastBulk && (
        <div
          data-bulk-banner
          style={{
            padding: '6px 16px',
            margin: '0 8px 8px',
            fontSize: 11,
            color: '#92400e',
            background: 'rgba(249,115,22,0.08)',
            border: '1px solid rgba(249,115,22,0.25)',
            borderRadius: 3,
            lineHeight: 1.4,
          }}
        >
          <strong>bulk · {lastBulk.count} rows in 1 event</strong>
          <span style={{ marginLeft: 6, color: '#9b9b9b' }}>
            {new Date(lastBulk.at).toLocaleTimeString()}
          </span>
          <div
            style={{
              marginTop: 2,
              color: '#78716c',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {lastBulk.rows.map((text, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <code style={{ background: 'rgba(0,0,0,0.04)', padding: '0 3px', borderRadius: 2 }}>
                  {text}
                </code>
              </span>
            ))}
          </div>
        </div>
      )}
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