/**
 * Tier 0.2 / 0.4 — the typed Todo collection hook.
 *
 * Uses `createTypedUseTable<{ Todo: typeof TodoSchema }>(...)` from
 * `@cyberistic/livestore-tanstack-db` so `useTodoCollection()` returns
 * `Collection<Todo, string>` with **zero** `as unknown as` / `as never`
 * / `as any` casts at this call site.
 *
 * The factory hides the TanStack DB invariant `Collection<T, K>` cast
 * inside its body and injects the resolved LiveStore `Store` into each
 * commit handler — consumers never call `useAppStore()` from a callback
 * (which would be a Rules-of-Hooks violation since TanStack DB fires
 * these outside React's render cycle).
 *
 * Commit handlers are defined at module load with `(row, store) => void`
 * signatures; the factory's React hook body resolves the store once and
 * wraps the handler so the second arg is injected at call time.
 */
import type { Collection } from '@tanstack/db'
import { queryDb } from '@livestore/livestore'

import { createTypedUseTable } from '@cyberistic/livestore-tanstack-db'
import { TodoSchema } from '../../prisma/generated/client-schemas/index.ts'

import { useAppStore } from '../livestore/store.ts'
import { events, tables } from '../livestore/schema.ts'
import type { Todo } from './todoSchema.ts'

const useTable = createTypedUseTable<{ Todo: typeof TodoSchema }>({
  store: useAppStore,
  tables: {
    Todo: {
      query: queryDb(tables.Todo.where({ deletedAt: null }), { label: 'todos:all' }),
      commits: {
        commitInsert: (row, store) => {
          store.commit(events.todoCreated({ id: row.id, text: row.text }))
        },
        commitUpdate: (original, changes, store) => {
          const merged = { ...original, ...changes }
          store.commit(events.todoCompleted({ id: merged.id }))
        },
        commitDelete: (row, store) => {
          store.commit(events.todoDeleted({ id: row.id, deletedAt: new Date() }))
        },
      },
    },
  },
})

export const useTodoCollection = (): Collection<Todo, string> =>
  useTable('Todo').collection