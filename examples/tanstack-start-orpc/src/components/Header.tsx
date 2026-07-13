import { type ChangeEvent, type KeyboardEvent, useCallback, useMemo, useRef } from 'react'

import { useCrud } from '@cyberistic/livestore-tanstack-db'

import { uiState$ } from '../livestore/queries.ts'
import { events, rpcConfig } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { rpcPosts } from '../lib/orpc-client.ts'
import type { TodoRow } from './types.ts'

const splitRows = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const newTodoInputStyle: React.CSSProperties = {
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
  overflow: 'hidden',
}

/**
 * Top-of-app header: input field that creates a Todo on Enter. The
 * `useCrud('Todo')` hook wires `create` to the `v1.TodoCreated` event
 * AND fires `orpc.posts.create({ text })` via Tier 0.6. Plain Enter
 * submits one row; Shift+Enter inserts a literal newline — multiple
 * lines are bulk-upserted via a single `v1.TodoBulkUpserted` event
 * (Tier 1.7) with the same auto-generated `createdAt`.
 */
export const Header = () => {
  const store = useAppStore()
  const [todosCollection, { create, bulkUpsert }] = useCrud('Todo', {
    rpc: { client: rpcPosts, config: rpcConfig },
  })
  // Default `newTodoText` to `''` so the textarea stays controlled even
  // before LiveStore has materialised the uiState client document
  // (avoids React's "uncontrolled → controlled" warning when the
  // store first loads).
  const { newTodoText = '' } = store.useQuery(uiState$) as unknown as {
    newTodoText?: string
  }

  const inputRef = useRef<HTMLTextAreaElement>(null)

  const setNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )

  const submit = useCallback(() => {
    const lines = splitRows(newTodoText)
    if (lines.length === 0) return

    const now = new Date()

    if (lines.length === 1) {
      // Single line → Tier 0.x. `v1.TodoCreated` fires once + oRPC
      // `posts.create({ text })` via the Tier 0.6 auto-derive.
      create({ text: lines[0], createdAt: now } as Partial<TodoRow> as never)
    } else {
      // Multiple lines → Tier 1.7. One `v1.TodoBulkUpserted { rows }`
      // event carries every line. Each line becomes one Todo.
      bulkUpsert(
        lines.map((text) => ({ text, createdAt: now })) as Partial<TodoRow>[] as never[],
      )
    }
    store.commit(events.uiStateSet({ newTodoText: '' }))
  }, [create, bulkUpsert, newTodoText, store])

  const onChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => setNewTodoText(e.target.value),
    [setNewTodoText],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Plain Enter submits. Shift+Enter inserts a literal newline so
      // the user can paste/type multiple rows for the bulk path.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submit()
        return
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        const ta = e.currentTarget
        const start = ta.selectionStart ?? newTodoText.length
        const end = ta.selectionEnd ?? newTodoText.length
        const next = newTodoText.slice(0, start) + '\n' + newTodoText.slice(end)
        setNewTodoText(next)
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 1
          // Resize textarea to fit the content
          ta.style.height = 'auto'
          ta.style.height = `${ta.scrollHeight}px`
        })
      }
    },
    [submit, newTodoText, setNewTodoText],
  )

  const rowCount = useMemo(() => splitRows(newTodoText).length, [newTodoText])
  const isBulk = rowCount > 1
  const linesForHeight = newTodoText.split('\n').length
  const textareaRows = isBulk ? Math.min(Math.max(linesForHeight, 2), 6) : 1

  return (
    <header className="header">
      <h1>todos</h1>
      <textarea
        ref={inputRef}
        className="new-todo"
        placeholder={
          isBulk
            ? `${rowCount} todos — Enter submits as 1 bulk event`
            : 'What needs to be done?'
        }
        value={newTodoText}
        onChange={onChange}
        onKeyDown={onKeyDown}
        rows={textareaRows}
        autoFocus
        style={newTodoInputStyle}
      />
      <span
        style={{
          fontSize: 11,
          color: '#9b9b9b',
          paddingLeft: 60,
          display: 'block',
          marginTop: -6,
        }}
      >
        {isBulk
          ? `Enter → ${rowCount} rows in 1 event · Shift+Enter for newline`
          : `${todosCollection.size} items · Enter creates 1 row`}
      </span>
    </header>
  )
}