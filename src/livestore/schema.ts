import { Schema, SessionIdSymbol } from '@livestore/livestore'

import { toStandardSchemaV1 } from '../integration/standardSchema.ts'
import { createLiveStoreDb } from '../integration/createLiveStoreDb.ts'
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

const db = createLiveStoreDb({
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

export const { tables, events, materializers, schema } = db

export const SyncPayload = Schema.Struct({ authToken: Schema.String })
