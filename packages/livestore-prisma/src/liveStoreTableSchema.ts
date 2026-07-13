/**
 * Build an Effect schema for a LiveStore `State.SQLite.table` def from
 * a `TableDescriptor` (the per-model metadata emitted by
 * `prisma-effect-schema-generator`).
 *
 * The auto-generated Effect schemas from upstream use `Schema.Date`,
 * which expects an actual `Date` instance. LiveStore stores Date
 * columns in SQLite as ISO 8601 strings, so query results fail with
 * `parseJson <-> DateFromSelf` mismatches.
 *
 * This builder uses `TABLES[model].columns` (column name + type +
 * required) and constructs a `Schema.Struct(...)` directly where
 * `'date'` columns become `Schema.DateFromString`. No AST walking —
 * we read the explicit column metadata and build from scratch.
 *
 * Used by {@link createLiveStoreDb} as the table schema for every
 * synced model. Falls back to the upstream `modelSchema` when no
 * `TABLES` entry exists for the model.
 *
 * @example
 * ```ts
 * const schema = buildLiveStoreTableSchema('Todo', TABLES['Todo'])
 * State.SQLite.table({ name: 'todos', schema: toLiveStoreSchema(schema) })
 * ```
 */
import { Schema } from "@livestore/livestore";

import { toLiveStoreSchema } from "./standardSchema.ts";
import type { TableDescriptor } from "./types.ts";

const COLUMN_TYPE_TO_SCHEMA = {
  string: () => Schema.String,
  number: () => Schema.Number,
  boolean: () => Schema.Boolean,
  date: () =>
    // LiveStore stores dates as ISO strings in SQLite. The value can be
    // a string when it comes from SQLite defaults (e.g. CURRENT_TIMESTAMP),
    // server responses, or old persisted rows, or a Date when created
    // in memory. Accept both on the type side and decode strings to Date;
    // encode back to ISO string for persistence.
    Schema.Union([
      // Date already on the decoded side; no transform needed.
      Schema.instanceOf(Date),
      // String → Date via the DateFromString transformation codec.
      Schema.DateFromString,
    ]),
  bytes: () => Schema.Uint8Array,
  json: () => Schema.Unknown,
  unknown: () => Schema.Unknown,
} as const;

/**
 * Build a `Schema.Struct(...)` for a LiveStore table from a
 * `TableDescriptor`. Date columns decode from ISO strings (the format
 * LiveStore stores them in); other columns use plain Effect primitives.
 */
export const buildLiveStoreTableSchema = (
  _modelName: string,
  table: TableDescriptor,
): Parameters<typeof toLiveStoreSchema>[0] => {
  const fieldPairs = table.columns.flatMap((col): Array<[string, Schema.Top]> => {
    const builder = COLUMN_TYPE_TO_SCHEMA[col.type];
    if (!builder) return [];
    const base = builder();
    return [[col.name, (col.required ? base : Schema.optional(base)) as Schema.Top]];
  });
  const fields = Object.fromEntries(fieldPairs) as Parameters<typeof Schema.Struct>[0];

  return Schema.Struct(fields) as unknown as Parameters<typeof toLiveStoreSchema>[0];
};
