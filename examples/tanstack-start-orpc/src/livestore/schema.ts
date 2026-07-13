import { Schema, SessionIdSymbol } from '@livestore/livestore'
import { createLiveStoreDb } from '@cyberistic/livestore-prisma'

import {
  PRIMARY_KEY_COLUMNS,
  SOFT_DELETE_COLUMNS,
  TABLES,
  TodoSchema,
} from '../../prisma/generated/client-schemas/index.ts'

/**
 * UI session state (one row per session, stored in OPFS only). Includes
 * the current `newTodoText` draft + the active `filter`.
 */
const UiStateSchema = Schema.Struct({
  newTodoText: Schema.String,
  filter: Schema.Union(
    Schema.Literal('all'),
    Schema.Literal('active'),
    Schema.Literal('completed'),
  ),
})

const lsdb = createLiveStoreDb({
  models: { Todo: TodoSchema },
  tables: TABLES,
  primaryKeyColumns: PRIMARY_KEY_COLUMNS,
  softDeleteColumns: SOFT_DELETE_COLUMNS,
  events: {
    // Tier 1.7 — bulk-insert. Emits a single `v1.TodoBulkUpserted` event
    // so `useCrud('Todo').bulkUpsert([...])` collapses N round-trips
    // into one.
    Todo: { includeBulkUpserted: true },
  },
  clientDocuments: {
    uiState: {
      schema: UiStateSchema as never,
      default: {
        id: SessionIdSymbol as never,
        value: { newTodoText: '', filter: 'all' as const },
      },
    },
  },
})

export const { tables, events, materializers, schema, readOnly } = lsdb

/**
 * oRPC RPC config consumed by `useTable(name, { rpc: {...} })`. Tier
 * 0.6 — `classifyProcedure` in `livestore-tanstack-db` walks these
 * keys, infers insert/update/delete from the procedure name, and wires
 * the matching commit handler so writes round-trip to the oRPC client.
 *
 * Naming convention: TanStack DB's `classifyProcedure` regex matches
 * `^create|add|insert|...` for insert, `^update|set|mark|patch|...`
 * for update, and `...Delete|Remove|...$` for delete. With our `posts.*`
 * namespace the procedure names line up directly.
 */
export const rpcConfig = {
  posts: {
    create: { event: 'todoCreated' },
    complete: { event: 'todoCompleted' },
    delete: { event: 'todoDeleted' },
    bulkSeed: { event: 'todoBulkUpserted' },
  },
} as const

export const SyncPayload = Schema.Struct({ authToken: Schema.String })