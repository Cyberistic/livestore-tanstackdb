import { Schema, SessionIdSymbol } from "@livestore/livestore";
import { createLiveStoreDb } from "livestore-prisma";

import { liveStoreDbConfig } from "../../prisma/generated/livestore/index.ts";

/**
 * UI session state (one row per session, stored in OPFS only). Includes
 * the current `newTodoText` draft + the active `filter`.
 */
const UiStateSchema = Schema.Struct({
  newTodoText: Schema.String,
  filter: Schema.Union([
    Schema.Literal("all"),
    Schema.Literal("active"),
    Schema.Literal("completed"),
  ]),
});

export const { tables, events, materializers, schema, readOnly } = createLiveStoreDb({
  ...liveStoreDbConfig,
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
        value: { newTodoText: "", filter: "all" as const },
      },
    },
  },
});

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
    create: { event: "todoCreated" },
    // `complete` toggles existing rows (boolean update). Pin the event
    // so classifyProcedure routes it to the UPDATE bucket only — without
    // this it would fall into the `['insert', 'update']` upsert default
    // and fire on every new row, racing the create RPC.
    complete: { event: "todoCompleted" },
    delete: { event: "todoDeleted" },
    bulkSeed: { event: "todoBulkUpserted" },
  },
} as const;

export const SyncPayload = Schema.Struct({ authToken: Schema.String });
