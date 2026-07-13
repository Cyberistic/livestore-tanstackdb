import { queryDb, type LiveQueryDef } from '@livestore/livestore'

import { tables } from './schema.ts'

/**
 * Active UI session state (one row per session, stored in OPFS only).
 *
 * `LiveQueryDef<UiStateRow, 'def'>` is annotated explicitly because
 * TypeScript's inference for `queryDb(...)` doesn't survive an `export`
 * across module boundaries — the result type widens to
 * `LiveQueryDef<unknown, 'def'>` without the hint.
 */
type UiStateRow = typeof tables.uiState.Type

export const uiState$: LiveQueryDef<UiStateRow, 'def'> = queryDb(
  tables.uiState.get(),
  { label: 'uiState' },
) as never

/**
 * Soft-delete-aware Todo stream. Used by the TanStack DB collection bridge
 * in `db/todoCollection.ts` to mirror LiveStore's `todos` table into the
 * `useLiveQuery`/`useTodoCollection` API.
 *
 * The `as never` cast at the export site is the same LiveStore quirk as
 * `uiState$` — TypeScript widens `queryDb(...)`'s return type across the
 * module boundary. Runtime behaviour is unchanged.
 */
type TodoRow = typeof tables.Todo.Type

export const allTodos$: LiveQueryDef<TodoRow, 'def'> = queryDb(
  tables.Todo.where({ deletedAt: null }),
  { label: 'todos:all' },
) as never