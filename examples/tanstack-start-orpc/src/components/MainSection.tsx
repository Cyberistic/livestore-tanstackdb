import { type ChangeEvent, useCallback, useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'

import { useTable } from '@cyberistic/livestore-tanstack-db'

import { uiState$ } from '../livestore/queries.ts'
import { rpcConfig } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { rpcPosts } from '../lib/orpc-client.ts'
import { TodoItem } from './TodoItem.tsx'
import type { TodoRow } from './types.ts'

/**
 * Main visible section of the app — renders the active todos, applies
 * the `uiState.filter`, and wires toggle/delete back to the
 * collection.
 *
 * `useTable('Todo')` reads the runtime from `<LiveStoreProvider>` —
 * no explicit `liveStore` option (Tier 3.1).
 */
export const MainSection = () => {
  const store = useAppStore()
  const { collection: todosCollection } = useTable('Todo', {
    rpc: { client: rpcPosts, config: rpcConfig },
  })
  const { data: todos } = useLiveQuery(
    (q) =>
      q
        .from({ todo: todosCollection })
        .select(({ todo }) => todo)
        .orderBy(({ todo }) => todo.createdAt, 'desc'),
    [],
  )

  const { filter } = store.useQuery(uiState$) as unknown as {
    filter: 'all' | 'active' | 'completed'
  }

  const visibleTodos = useMemo(() => {
    if (!todos) return []
    const rows = todos as unknown as ReadonlyArray<TodoRow>
    if (filter === 'active') return rows.filter((t) => !t.completed)
    if (filter === 'completed') return rows.filter((t) => t.completed)
    return rows.slice()
  }, [todos, filter])

  const onToggle = useCallback(
    (id: string) => {
      const row = (todos as unknown as ReadonlyArray<TodoRow> | undefined)?.find(
        (t) => t.id === id,
      )
      if (!row) return
      todosCollection.update(id, (draft) => {
        draft.completed = !draft.completed
      })
    },
    [todos, todosCollection],
  )

  const onDelete = useCallback(
    (id: string) => {
      todosCollection.delete(id)
    },
    [todosCollection],
  )

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  )
}

// Re-export to satisfy `verbatimModuleSyntax` if it ever gets turned on.
export type { ChangeEvent }