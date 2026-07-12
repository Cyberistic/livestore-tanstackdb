import { Schema, SessionIdSymbol } from '@livestore/livestore'

import { toStandardSchemaV1 } from '../integration/standardSchema.ts'
import { createLiveStoreDb } from '../integration/createLiveStoreDb.ts'
import {
  EventSchema,
  TodoSchema,
} from '../../prisma/generated/client-schemas/index.ts'

const db = createLiveStoreDb({
  models: { Todo: TodoSchema, Event: EventSchema },
  // Prisma's `@@map("todos")` / `@@map("events")` produces these
  // SQL names. The factory's default `camelToSnake` would give
  // `todo`/`event` instead, which wouldn't match the DDL.
  tableNames: { Todo: 'todos', Event: 'events' },
  clientDocuments: {
    uiState: {
      // Tier 2.3: wrap with `toStandardSchemaV1` so the schema's
      // `Context = never` survives the trip into `clientDocument`'s
      // `Input<TType>` parameter. The helper also exposes the
      // `~standard` brand for TanStack DB's collection schema slot.
      schema: toStandardSchemaV1(
        Schema.Struct({
          newTodoText: Schema.String,
          filter: Schema.Union(
            Schema.Literal('all'),
            Schema.Literal('active'),
            Schema.Literal('completed'),
          ),
        }),
      ),
      default: {
        id: SessionIdSymbol,
        value: { newTodoText: '', filter: 'all' as const },
      },
    },
  },
})

export const { tables, events, materializers, schema } = db

export const SyncPayload = Schema.Struct({ authToken: Schema.String })
