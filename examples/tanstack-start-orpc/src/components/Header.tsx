import { type ChangeEvent, type KeyboardEvent, useCallback } from 'react'

import { useCrud, type RpcClient } from '@cyberistic/livestore-tanstack-db'

import { uiState$ } from '../livestore/queries.ts'
import { events, rpcConfig } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { orpc } from '../lib/orpc-client.ts'
import type { TodoRow } from './types.ts'

const rpcPosts = orpc.posts as unknown as RpcClient

/**
 * Top-of-app header: input field that creates a Todo on Enter. The
 * `useCrud('Todo')` hook wires `create` to the `v1.TodoCreated` event
 * AND fires `orpc.posts.create({ text })` via Tier 0.6.
 */
export const Header = () => {
  const store = useAppStore()
  const [todosCollection, { create, bulkUpsert }] = useCrud('Todo', {
    rpc: { client: rpcPosts, config: rpcConfig },
  })
  const { newTodoText } = store.useQuery(uiState$) as unknown as {
    newTodoText: string
  }

  const setNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )

  const onCreate = useCallback(() => {
    create({ text: newTodoText } as Partial<TodoRow> as never)
    store.commit(events.uiStateSet({ newTodoText: '' }))
  }, [create, newTodoText, store])

  const onSeedBulk = useCallback(() => {
    bulkUpsert([
      { text: 'Bulk row 1' } as Partial<TodoRow> as never,
      { text: 'Bulk row 2' } as Partial<TodoRow> as never,
      { text: 'Bulk row 3' } as Partial<TodoRow> as never,
    ])
  }, [bulkUpsert])

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setNewTodoText(e.target.value),
    [setNewTodoText],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') onCreate()
    },
    [onCreate],
  )

  return (
    <header className="header">
      <h1>TodoMVC</h1>
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        value={newTodoText}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      <button type="button" onClick={onSeedBulk} style={{ marginLeft: 8 }}>
        Seed 3 via bulkUpsert
      </button>
      <span style={{ marginLeft: 8 }}>(rows: {todosCollection.size})</span>
    </header>
  )
}