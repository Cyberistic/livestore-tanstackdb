import { createCollection } from '@tanstack/db'
import { queryDb } from '@livestore/livestore'
import { useMemo } from 'react'

import { liveStoreCollectionOptions } from './liveStoreCollection.ts'
import { useAppStore } from '../livestore/store.ts'
import { events, tables } from '../livestore/schema.ts'
import type { Todo } from './todoSchema.ts'

const allTodos$ = queryDb(
  tables.todos.where({ deletedAt: null }),
  { label: 'allTodos' },
)

/**
 * Returns the TanStack DB `todos` collection for this app.
 *
 * Must be rendered under `<StoreRegistryProvider>`. The collection is
 * memoised per-store so we get one TanStack DB collection per LiveStore
 * store instance, even with React 19 strict-mode double renders.
 */
export const useTodoCollection = () => {
  const store = useAppStore()

  return useMemo(
    () =>
      createCollection(
        liveStoreCollectionOptions<Todo>({
          id: 'todos',
          store,
          query: allTodos$,
          commitInsert: (row) =>
            store.commit(events.todoCreated({ id: row.id, text: row.text })),
          commitUpdate: (_original, changes) => {
            const id = (changes.id ?? _original.id) as string
            if (changes.completed === true) {
              store.commit(events.todoCompleted({ id }))
            } else if (changes.completed === false) {
              store.commit(events.todoUncompleted({ id }))
            }
          },
          commitDelete: (row) =>
            store.commit(events.todoDeleted({ id: row.id, deletedAt: new Date() })),
        }),
      ),
    [store],
  )
}