import { Schema, SessionIdSymbol } from '@livestore/livestore'

import { createLazyDb } from '../integration/lazyDb.ts'
import { createLiveStoreDb } from '../integration/createLiveStoreDb.ts'
import { toStandardSchemaV1 } from '../integration/standardSchema.ts'
import {
  EventSchema,
  TodoSchema,
} from '../../prisma/generated/client-schemas/index.ts'

const UiStateSchema = toStandardSchemaV1(
  Schema.Struct({
    newTodoText: Schema.String,
    filter: Schema.Union(
      Schema.Literal('all'),
      Schema.Literal('active'),
      Schema.Literal('completed'),
    ),
  }),
)

const lsdb = createLiveStoreDb({
  // Prisma's `@@map("todos")` / `@@map("events")` produces these
  // SQL names. Default `camelToSnake` would give `todo`/`event`.
  tableNames: { Todo: 'todos', Event: 'events' },
  models: { Todo: TodoSchema, Event: EventSchema },
  clientDocuments: {
    uiState: {
      schema: UiStateSchema,
      default: { id: SessionIdSymbol, value: { newTodoText: '', filter: 'all' as const } },
    },
  },
})

export const { tables, events, materializers, schema } = lsdb

/**
 * Tier 2.1 — the lazy db proxy. `db.todos` resolves to the TanStack DB
 * `Collection` inside React, and to a Promise-based loader proxy in
 * TanStack Router loaders / Cloudflare Worker handlers. `db.events` is
 * server-authoritative and throws on access — the audit log is
 * read-only via the LiveStore event stream.
 */
export const db = createLazyDb(lsdb.tables, {
  events: lsdb.events,
  serverOnly: ['events'],
})

export const SyncPayload = Schema.Struct({ authToken: Schema.String })