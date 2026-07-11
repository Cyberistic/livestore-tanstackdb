import { useCallback } from 'react'

import { useQuery } from '@livestore/react'
import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { useTodoCollection } from '../db/todoCollection.ts'

export const Header = () => {
  const store = useAppStore()
  const todos = useTodoCollection()
  const { newTodoText } = useQuery(uiState$) as unknown as {
    newTodoText: string
    filter: 'all' | 'active' | 'completed'
  }

  const updatedNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )

  const todoCreated = useCallback(() => {
    const text = newTodoText.trim()
    if (text === '') return
    todos.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
      deletedAt: null as Date | null,
    })
    store.commit(events.uiStateSet({ newTodoText: '' }))
  }, [newTodoText, store, todos])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    updatedNewTodoText(e.target.value)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') todoCreated()
  }

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