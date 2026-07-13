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

type CreateMode = 'single' | 'bulk'

const splitRows = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

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

  const [createMode, setCreateMode] = useState<CreateMode>('single')

  const updatedNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )

  const submit = useCallback(() => {
    const lines = splitRows(newTodoText)

    if (createMode === 'single' || lines.length <= 1) {
      // Single-row path — Tier 0.x. `v1.TodoCreated` fires once.
      const text = lines[0] ?? ''
      if (!text) return
      create({ text } as Partial<Todo> as never)
    } else {
      // Bulk path — Tier 1.7. One `v1.TodoBulkUpserted { rows }` event
      // carries every typed row. Each line becomes one Todo.
      bulkUpsert(
        lines.map((text) => ({ text })) as Partial<Todo>[] as never[],
      )
    }

    store.commit(events.uiStateSet({ newTodoText: '' }))
  }, [create, bulkUpsert, newTodoText, store, createMode])

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => updatedNewTodoText(e.target.value),
    [updatedNewTodoText],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Plain Enter submits. Shift+Enter inserts a newline so the
      // user can type multiple rows in bulk mode.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
    },
    [submit],
  )

  const lines = useMemo(() => splitRows(newTodoText), [newTodoText])
  const rowCount = lines.length
  const isBulk = createMode === 'bulk'

  return (
    <header className="header">
      <h1>todos</h1>

      <textarea
        className="new-todo"
        placeholder={isBulk ? 'One todo per line…' : 'What needs to be done?'}
        value={newTodoText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={isBulk ? Math.max(2, Math.min(rowCount + 1, 6)) : 1}
        autoFocus
        style={{
          display: 'block',
          width: '100%',
          padding: '16px 16px 16px 60px',
          margin: 0,
          fontSize: 24,
          fontFamily: 'inherit',
          fontWeight: 300,
          lineHeight: 1.3,
          color: 'inherit',
          background: 'rgba(0, 0, 0, 0.003)',
          boxShadow: 'inset 0 -2px 1px rgba(0,0,0,0.03)',
          border: 'none',
          outline: 'none',
          resize: 'none',
          boxSizing: 'border-box',
          fontStyle: newTodoText ? 'normal' : 'italic',
          transition: 'box-shadow 0.3s',
        }}
      />

      <div
        style={{
          padding: '4px 16px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: '#9b9b9b',
          background: '#fff',
        }}
      >
        <span>submit as</span>
        {(['single', 'bulk'] as const).map((mode) => {
          const isActive = createMode === mode
          const label = mode === 'single' ? '1 row' : 'many rows'
          return (
            <button
              key={mode}
              type="button"
              data-mode={mode}
              onClick={() => setCreateMode(mode)}
              style={{
                padding: '1px 6px',
                border: '1px solid #d4d4d4',
                borderRadius: 2,
                background: isActive ? '#fafafa' : 'transparent',
                color: isActive ? '#333' : '#9b9b9b',
                fontStyle: isActive ? 'italic' : 'normal',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          )
        })}
        <span style={{ marginLeft: 'auto' }}>
          {isBulk && rowCount > 1
            ? `Enter → ${rowCount} rows in 1 event`
            : 'Enter → 1 row'}
          {isBulk && rowCount > 0 ? ' · Shift+Enter for newline' : ''}
        </span>
      </div>
    </header>
  )
}