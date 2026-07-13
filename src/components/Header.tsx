import { type ChangeEvent, type KeyboardEvent, useCallback, useMemo } from 'react'

import { useCrud } from '@cyberistic/livestore-tanstack-db'

import { uiState$ } from '../livestore/queries.ts'
import { events, schema, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import type { Todo } from '../db/todoSchema.ts'

export const Header = () => {
  const store = useAppStore()
  const liveStore = useMemo(
    () => ({ store, tables, events, schema }),
    [store],
  )
  const [todosCollection, { create, bulkUpsert }] = useCrud<Todo>('Todo', {
    liveStore,
  })
  const { newTodoText } = store.useQuery(uiState$)

  const updatedNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )

  const todoCreated = useCallback(
    () => {
      create({ text: newTodoText } as Partial<Todo> as never)
      store.commit(events.uiStateSet({ newTodoText: '' }))
    },
    [create, newTodoText, store],
  )

  const seedBulk = useCallback(() => {
    bulkUpsert([
      { text: 'Bulk row 1' } as Partial<Todo> as never,
      { text: 'Bulk row 2' } as Partial<Todo> as never,
      { text: 'Bulk row 3' } as Partial<Todo> as never,
    ])
  }, [bulkUpsert])

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => updatedNewTodoText(e.target.value),
    [updatedNewTodoText],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        todoCreated()
      }
    },
    [todoCreated],
  )

  return (
    <header className="header">
      <h1>TodoMVC</h1>
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        value={newTodoText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <button type="button" onClick={seedBulk} style={{ marginLeft: 8 }}>
        Seed 3 via bulkUpsert
      </button>
      <span style={{ marginLeft: 8 }}>(rows: {todosCollection.size})</span>
    </header>
  )
}
