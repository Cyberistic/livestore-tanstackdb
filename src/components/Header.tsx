import { type ChangeEvent, type KeyboardEvent, useCallback } from 'react'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { useTodoCollection } from '../db/todoCollection.ts'

export const Header = () => {
  const store = useAppStore()
  const todosCollection = useTodoCollection()
  const { newTodoText } = store.useQuery(uiState$)

  const updatedNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )

  const todoCreated = useCallback(
    () => {
      todosCollection.insert({
        id: crypto.randomUUID(),
        text: newTodoText,
        completed: false,
        deletedAt: null,
        createdAt: new Date(),
      } as any)
      store.commit(events.uiStateSet({ newTodoText: '' }))
    },
    [newTodoText, store, todosCollection],
  )

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
    </header>
  )
}
