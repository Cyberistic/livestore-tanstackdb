import { Schema, SessionIdSymbol } from "@livestore/livestore";

import { createLiveStoreDb } from "livestore-prisma";
import {
  PRIMARY_KEY_COLUMNS,
  SOFT_DELETE_COLUMNS,
  TABLES,
} from "../../prisma/generated/client-schemas/index.ts";
import { EventSchema, TodoSchema } from "../../prisma/generated/client-schemas/index.ts";

const UiStateSchema = Schema.Struct({
  newTodoText: Schema.String,
  filter: Schema.Union([
    Schema.Literal("all"),
    Schema.Literal("active"),
    Schema.Literal("completed"),
  ]),
});

const lsdb = createLiveStoreDb({
  models: { Todo: TodoSchema, Event: EventSchema },
  // `tables` is the introspection map the prisma-effect-schema-generator
  // emits alongside the Effect schemas — without it, `createLiveStoreDb`
  // can't see the column types, so per-field `Completed`/`Uncompleted`
  // events and soft-delete events don't get generated. Pass the map the
  // generator emitted.
  tables: TABLES,
  primaryKeyColumns: PRIMARY_KEY_COLUMNS,
  softDeleteColumns: SOFT_DELETE_COLUMNS,
  // Tier 1.7 — opt the Todo model into the bulk event so
  // `useCrud('Todo').bulkUpsert([...])` collapses N row inserts into a
  // single `v1.TodoBulkUpserted { rows }` event.
  events: {
    Todo: { includeBulkUpserted: true },
  },
  clientDocuments: {
    uiState: {
      schema: UiStateSchema,
      default: { id: SessionIdSymbol, value: { newTodoText: "", filter: "all" as const } },
    },
  },
});

export const { tables, events, materializers, schema, readOnly } = lsdb;

export const SyncPayload = Schema.Struct({ authToken: Schema.String });
