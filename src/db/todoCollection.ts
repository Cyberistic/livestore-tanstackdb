import type { Collection } from '@tanstack/db'
import { queryDb } from '@livestore/livestore'

import { createTypedTable } from '@cyberistic/livestore-tanstack-db'

import { useAppStore } from '../livestore/store.ts'
import { events, tables } from '../livestore/schema.ts'
import type { Todo } from './todoSchema.ts'

export const useTodoTable = createTypedTable<Todo>({
  id: 'todos',
  store: useAppStore,
  query: queryDb(tables.Todo.where({ deletedAt: null }), { label: 'todos:all' }),
  commits: {
    commitInsert: (row, store) => {
      store.commit(events.todoCreated({ id: row.id, text: row.text }))
    },
    commitUpdate: (original, changes, store) => {
      const merged = { ...original, ...changes }
      if (merged.completed !== original.completed) {
        store.commit(
          merged.completed
            ? events.todoCompleted({ id: merged.id })
            : events.todoUncompleted({ id: merged.id }),
        )
      }
    },
    commitDelete: (row, store) => {
      store.commit(events.todoDeleted({ id: row.id, deletedAt: new Date() }))
    },
  },
})

export const useTodoCollection = (): Collection<Todo, string> =>
  useTodoTable().collection