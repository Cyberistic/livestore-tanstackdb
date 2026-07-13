import type { Collection } from '@tanstack/db'
import { useMemo } from 'react'

import { useTable } from '@cyberistic/livestore-tanstack-db'

import { events, schema, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import type { Todo } from './todoSchema.ts'

export const useTodoCollection = (): Collection<Todo, string> => {
  const store = useAppStore()
  const liveStore = useMemo(
    () => ({ store, tables, events, schema }),
    [store],
  )
  const { collection } = useTable('Todo', { liveStore })
  return collection as unknown as Collection<Todo, string>
}