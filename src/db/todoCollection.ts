import type { Collection } from '@tanstack/db'

import { useTable } from '../integration/useTable.ts'
import type { Todo } from './todoSchema.ts'

/**
 * Concrete `Todo` row type cast over `useTable('Todo')`. The factory
 * doesn't preserve the per-model schema in its return type yet (Tier
 * 0.4), so we cast here to keep `todos.completed`, `todos.text`, etc.
 * type-checked at the call sites in `src/components/*.tsx`.
 *
 * Preserves `.insert / .update / .delete / .toArray` because they're
 * all methods on the underlying TanStack DB `Collection`.
 */
export const useTodoCollection = (): Collection<Todo, string> =>
  useTable('Todo').collection as unknown as Collection<Todo, string>