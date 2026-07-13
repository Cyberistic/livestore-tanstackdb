import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useMemo,
  useState,
} from 'react'

import { useCrud } from '@cyberistic/livestore-tanstack-db'

import { uiState$ } from '../livestore/queries.ts'
import { events, schema, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import type { Todo } from '../db/todoSchema.ts'

type CreateMode = 'normal' | 'bulk'

const SEED_ROWS: ReadonlyArray<Partial<Todo>> = [
  { text: 'Bulk row 1' } as Partial<Todo>,
  { text: 'Bulk row 2' } as Partial<Todo>,
  { text: 'Bulk row 3' } as Partial<Todo>,
]

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

  const [createMode, setCreateMode] = useState<CreateMode>('normal')

  const updatedNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )

  const todoCreated = useCallback(() => {
    if (createMode === 'normal') {
      // Tier 0.x single-row commit. `v1.TodoCreated` event fires once
      // with `{ id, text, completed, deletedAt }`.
      create({ text: newTodoText } as Partial<Todo> as never)
    } else {
      // Tier 1.7 bulk path. A single `v1.TodoBulkUpserted { rows }` event
      // carries the typed-in row plus the 3 seed rows. Demonstrates
      // that N inserts collapse to one round-trip.
      bulkUpsert([
        { text: newTodoText },
        ...SEED_ROWS,
      ] as Partial<Todo>[] as never[])
    }
    store.commit(events.uiStateSet({ newTodoText: '' }))
  }, [create, bulkUpsert, newTodoText, store, createMode])

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

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 11, color: '#888' }}>create mode:</span>
        <button
          type="button"
          data-mode="normal"
          onClick={() => setCreateMode('normal')}
          style={{
            padding: '2px 8px',
            fontSize: 11,
            border: '1px solid',
            borderColor: createMode === 'normal' ? '#3b82f6' : '#3a3a3a',
            borderRadius: 3,
            background: createMode === 'normal' ? 'rgba(59,130,246,0.15)' : 'transparent',
            color: createMode === 'normal' ? '#fff' : '#888',
            cursor: 'pointer',
          }}
        >
          single · v1.TodoCreated
        </button>
        <button
          type="button"
          data-mode="bulk"
          onClick={() => setCreateMode('bulk')}
          style={{
            padding: '2px 8px',
            fontSize: 11,
            border: '1px solid',
            borderColor: createMode === 'bulk' ? '#f97316' : '#3a3a3a',
            borderRadius: 3,
            background: createMode === 'bulk' ? 'rgba(249,115,22,0.15)' : 'transparent',
            color: createMode === 'bulk' ? '#fff' : '#888',
            cursor: 'pointer',
          }}
        >
          bulk · v1.TodoBulkUpserted
        </button>
      </div>

      <input
        className="new-todo"
        placeholder="What needs to be done?"
        value={newTodoText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />

      <div style={{ marginTop: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#666' }}>
          press Enter to{' '}
          <strong style={{ color: createMode === 'bulk' ? '#f97316' : '#3b82f6' }}>
            {createMode === 'bulk' ? 'bulk-upsert 4 rows' : 'create 1 row'}
          </strong>
        </span>
        <span style={{ fontSize: 11, color: '#666' }}>·</span>
        <span style={{ fontSize: 11, color: '#666' }}>total: {todosCollection.size}</span>
      </div>
    </header>
  )
}