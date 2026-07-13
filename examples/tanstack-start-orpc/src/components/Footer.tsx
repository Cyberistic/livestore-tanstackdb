import { useCallback, useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'

import { useTable } from '@cyberistic/livestore-tanstack-db'

import { uiState$ } from '../livestore/queries.ts'
import { events, rpcConfig } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { rpcPosts } from '../lib/orpc-client.ts'
import type { TodoRow } from './types.ts'

export const Footer = () => {
  const store = useAppStore()
  const { collection: todosCollection } = useTable('Todo', {
    rpc: { client: rpcPosts, config: rpcConfig },
  })
  const { data: todos } = useLiveQuery((_q) => todosCollection, [])
  const { filter } = store.useQuery(uiState$) as unknown as {
    filter: 'all' | 'active' | 'completed'
  }

  const incompleteCount = useMemo(
    () => (todos as unknown as ReadonlyArray<TodoRow> | undefined)?.filter((t) => !t.completed).length ?? 0,
    [todos],
  )

  const setFilter = useCallback(
    (next: 'all' | 'active' | 'completed') =>
      store.commit(events.uiStateSet({ filter: next })),
    [store],
  )

  const onClearCompleted = useCallback(() => {
    const rows = todos as unknown as ReadonlyArray<TodoRow> | undefined
    if (!rows) return
    for (const t of rows) {
      if (t.completed) todosCollection.delete(t.id)
    }
  }, [todos, todosCollection])

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          <a
            href="#/"
            className={filter === 'all' ? 'selected' : ''}
            onClick={(e) => {
              e.preventDefault()
              setFilter('all')
            }}
          >
            All
          </a>
        </li>
        <li>
          <a
            href="#/"
            className={filter === 'active' ? 'selected' : ''}
            onClick={(e) => {
              e.preventDefault()
              setFilter('active')
            }}
          >
            Active
          </a>
        </li>
        <li>
          <a
            href="#/"
            className={filter === 'completed' ? 'selected' : ''}
            onClick={(e) => {
              e.preventDefault()
              setFilter('completed')
            }}
          >
            Completed
          </a>
        </li>
      </ul>
      <button type="button" className="clear-completed" onClick={onClearCompleted}>
        Clear completed
      </button>
    </footer>
  )
}