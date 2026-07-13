import { queryDb, type LiveQueryDef } from '@livestore/livestore'

import { tables } from './schema.ts'

type UiStateRow = typeof tables.uiState.Type

export const uiState$: LiveQueryDef<UiStateRow, 'def'> = queryDb(
  tables.uiState.get(),
  { label: 'uiState' },
) as never