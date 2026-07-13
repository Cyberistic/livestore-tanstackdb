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
import { Schema } from '@livestore/livestore'

import { toLiveStoreSchema } from './standardSchema.ts'
import type { TableDescriptor } from './types.ts'

const COLUMN_TYPE_TO_SCHEMA = {
  string: () => Schema.String,
  number: () => Schema.Number,
  boolean: () => Schema.Boolean,
  date: () => Schema.DateFromString,
  bytes: () => Schema.Uint8Array,
  json: () => Schema.Unknown,
  unknown: () => Schema.Unknown,
} as const

/**
 * Build a `Schema.Struct(...)` for a LiveStore table from a
 * `TableDescriptor`. Date columns decode from ISO strings (the format
 * LiveStore stores them in); other columns use plain Effect primitives.
 */
export const buildLiveStoreTableSchema = (
  _modelName: string,
  table: TableDescriptor,
): Parameters<typeof toLiveStoreSchema>[0] => {
  const fields: Record<string, Parameters<typeof Schema.Struct>[0][string]> = {}

  for (const col of table.columns) {
    const builder = COLUMN_TYPE_TO_SCHEMA[col.type]
    if (!builder) continue
    const base = builder()
    fields[col.name] = col.required
      ? base
      : Schema.optional(base)
  }

  return Schema.Struct(fields) as unknown as Parameters<typeof toLiveStoreSchema>[0]
}
