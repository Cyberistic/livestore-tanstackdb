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
    // LiveStore stores dates in SQLite as ISO strings. The value can
    // be a string (e.g. from `CURRENT_TIMESTAMP` defaults, server
    // responses, or old persisted rows) or a Date (in memory). Use
    // `Schema.DateFromString` which decodes both:
    //   * string → Date (transforms on decode)
    //   * Date   → string (transforms on encode to ISO 8601)
    //
    // Note: a plain `Schema.Union([Schema.instanceOf(Date),
    // Schema.DateFromString])` would also accept both on decode, but
    // its encode side would emit a `Date` object (via the
    // `instanceOf(Date)` branch) instead of an ISO string, which
    // LiveStore then JSON-encodes — wrapping the date in quotes
    // ("...2026-...Z") and breaking round-trips. `DateFromString`
    // alone is the correct codec.
    Schema.DateFromString,
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
