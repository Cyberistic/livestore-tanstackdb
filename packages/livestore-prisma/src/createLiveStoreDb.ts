import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

import { toStandardSchemaV1, toLiveStoreSchema } from './standardSchema.ts'
import { buildLiveStoreTableSchema } from './liveStoreTableSchema.ts'
import type {
  ColumnDescriptor,
  PrimaryKeyColumns,
  SoftDeleteColumns,
  TableDescriptor,
  Tables,
} from './types.ts'

/**
 * The `prisma-effect-schema-generator` runtime contract.
 *
 * The `models` map is already a typed import from
 * `../../prisma/generated/client-schemas/index.ts`. We additionally
 * import the introspection maps the same file emits — `PRIMARY_KEY_COLUMNS`,
 * `SOFT_DELETE_COLUMNS`, `TABLES` — and use them to:
 *
 *   - auto-derive the DB table name (`TABLES[m].name`)
 *   - auto-derive `getKey` from `primaryKeyColumns[m]`
 *   - auto-derive the soft-delete predicate from `softDeleteColumns[m]`
 *   - auto-derive per-field `Completed`/`Uncompleted` events from
 *     `TABLES[m].columns.filter(c => c.type === 'boolean')`
 *
 * Consumers can still override per-model via the `tables?:` config option
 * (e.g. for ad-hoc per-table flags like `serverOnly`). The default below
 * is "use whatever the generator emitted".
 */
export const DEFAULT_TABLES: Tables = {}

type GeneratedSchemas = Record<string, unknown>

type RowType<S> = S extends Schema.Schema<infer T, any, any> ? T : never

type SyncedTableFor<S> = State.SQLite.TableDef<
  any,
  { readonly isClientDocumentTable: false },
  Schema.Schema<RowType<S>, any, never>
>

export type ClientDocumentInput = {
  schema: Schema.Schema.Any
  default?: {
    id?: string | typeof SessionIdSymbol
    value: unknown
  }
}

export type DefaultEventConfig = {
  includeCreated?: boolean
  includeDeleted?: boolean
  /**
   * Emit a `v1.<Model>BulkUpserted` event that batches N row inserts into
   * one event. Materialised as N `INSERT`s in one transaction. Tier 1.7 of
   * the dream-list — replaces N round-trips with one. Off by default to
   * preserve back-compat for schemas that don't define it.
   */
  includeBulkUpserted?: boolean
  booleanColumns?: string[]
  softDeleteColumn?: string | null
}

export type ClientDocuments = Record<
  string,
  Schema.Schema.Any | ClientDocumentInput
>

export interface LiveStoreDbConfig<T extends GeneratedSchemas> {
  /**
   * Per-model Effect Schemas. The consumer passes these in from whatever
   * source they prefer — typically the upstream
   * `prisma-effect-schema-generator` output. The package is
   * schema-source-agnostic.
   */
  models: T

  /**
   * Per-model introspection maps emitted by the upstream
   * `prisma-effect-schema-generator` (idColumn / softDeleteColumn / tables
   * options). The factory uses them to:
   *   - auto-derive `getKey` from `primaryKeyColumns[model]`
   *   - auto-build the soft-delete predicate from
   *     `softDeleteColumns[model]` (when present)
   *   - auto-derive `booleanColumns` from `tables[model].columns` for
   *     per-field toggle events (`v1.<Model><Field>Completed` /
   *     `...Uncompleted`)
   *
   * Optional — if omitted, the factory falls back to heuristics that work
   * for the simple case (`getKey = row => row.id`, no soft-delete).
   */
  primaryKeyColumns?: PrimaryKeyColumns
  softDeleteColumns?: SoftDeleteColumns
  tables?: Tables

  clientDocuments?: Record<string, Schema.Schema.Any | ClientDocumentInput>
  events?: Partial<Record<keyof T & string, DefaultEventConfig>>
  version?: string

  /**
   * Tables that should NOT get client-side write APIs even though
   * `tables[model].includedInSync` is `true`. Audit logs, event
   * mirrors, etc. — the DO/server writes to them, the client only reads.
   *
   * The recommended source for this list is the per-table flag in
   * `prisma/livestore.annotations.json` (read by the in-repo
   * `prisma-livestore-generator` and folded into the generator output).
   * For ad-hoc overrides, this option also accepts a manual list.
   *
   * The downstream `useTable(name)` / `createLazyDb({ serverOnly })`
   * both consult this list to refuse commit handlers.
   */
  serverOnlyTables?: ReadonlyArray<keyof T & string>
}

export interface LiveStoreDb<T extends GeneratedSchemas> {
  tables: {
    [K in keyof T & string]: SyncedTableFor<T[K]>
  } & Record<string, any>
  events: Record<string, any>
  materializers: Record<string, any>
  schema: ReturnType<typeof makeSchema>
  readOnly: Record<string, boolean>
}

const BOOLEAN_SUFFIX_BLOCKLIST = /(At|Date|Time|Id)$/

const booleanColumnsFor = (
  modelName: string,
  columns: ReadonlyArray<ColumnDescriptor> | undefined,
  override?: string[],
): string[] => {
  if (override) return override
  if (!columns) return []
  return columns
    .filter((c) => c.type === 'boolean' && !BOOLEAN_SUFFIX_BLOCKLIST.test(c.name))
    .map((c) => c.name)
}

const defaultValuesFor = (
  columns: ReadonlyArray<ColumnDescriptor> | undefined,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  if (!columns) return out
  for (const c of columns) {
    if (c.type === 'boolean') {
      out[c.name] = false
      continue
    }
    if (!c.required) out[c.name] = null
  }
  return out
}

const insertableSchemaFor = (
  columns: ReadonlyArray<ColumnDescriptor> | undefined,
  modelSchema: unknown,
): Record<string, Schema.Schema.Any> => {
  const fields = fieldsOf(modelSchema)
  if (!fields || !columns) return {}
  const insertable = columns.filter(
    (c) => c.required && c.type !== 'boolean',
  )
  const out: Record<string, Schema.Schema.Any> = {}
  for (const c of insertable) {
    const sig = fields[c.name]
    if (sig) out[c.name] = sig
  }
  return out
}

const eventSuffixesFor = (fieldName: string): { on: string; off: string } => {
  const cap = capitalize(fieldName)
  if (cap.endsWith('Completed')) {
    return { on: 'Completed', off: 'Uncompleted' }
  }
  return { on: `${cap}Completed`, off: `${cap}Uncompleted` }
}

const camelize = (s: string) => s[0]!.toLowerCase() + s.slice(1)
const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/**
 * Read the `fields` map from a `Schema.Struct`/`Schema.TypeLiteral`
 * instance without an `as unknown` cast. The `Schema.Struct` /
 * `TypeLiteral` interfaces both declare `readonly fields: Readonly<Fields>`,
 * but `Schema.Schema.Any` is the broader `Schema<any, any, any>` type
 * which doesn't expose `fields`. This helper narrows the type with
 * a structural check before reading.
 */
const fieldsOf = (
  schema: unknown,
): Readonly<Record<string, Schema.Schema.Any>> | undefined => {
  const direct = (schema as { readonly fields?: Readonly<Record<string, Schema.Schema.Any>> }).fields
  if (direct) return direct

  const ast = (schema as {
    readonly ast?: {
      readonly propertySignatures?: ReadonlyArray<{
        readonly name: PropertyKey
        readonly type: unknown
      }>
    }
  }).ast
  if (!ast?.propertySignatures) return undefined

  const out: Record<string, Schema.Schema.Any> = {}
  for (const sig of ast.propertySignatures) {
    out[String(sig.name)] = (Schema as any).make(sig.type)
  }
  return out
}

export const createLiveStoreDb = <T extends GeneratedSchemas>(
  config: LiveStoreDbConfig<T>,
): LiveStoreDb<T> => {
  const version = config.version ?? 'v1'
  const tables: Record<string, any> = {}
  const events: Record<string, any> = {}
  const materializers: Record<string, any> = {}
  const readOnly: Record<string, boolean> = {}

  for (const [modelName, modelSchema] of Object.entries(config.models)) {
    const mName = modelName as string
    const tableMeta = config.tables?.[mName]
    const columns = tableMeta?.columns
    const modelPrefix = camelize(modelName)
    const cfg = config.events?.[mName] ?? {}

    const booleanCols = booleanColumnsFor(mName, columns, cfg.booleanColumns)
    const softDeleteCol =
      cfg.softDeleteColumn !== undefined
        ? cfg.softDeleteColumn
        : config.softDeleteColumns?.[mName]

    const tableName = tableMeta?.name ?? mName.toLowerCase()

    tables[modelName] = State.SQLite.table({
      name: tableName,
      // Build the LiveStore table schema from `TABLES[model].columns`
      // directly, mapping `'date'` columns to `Schema.DateFromString`.
      // The upstream generator's `Schema.Date` expects a `Date` object,
      // but LiveStore stores dates as ISO strings, so we can't reuse
      // the auto-generated schema for the table def.
      schema: tableMeta
        ? toLiveStoreSchema(buildLiveStoreTableSchema(modelName, tableMeta))
        : toLiveStoreSchema(modelSchema),
    })

    if (tableMeta && !tableMeta.includedInSync) {
      readOnly[modelName] = true
    }

    if (cfg.includeCreated !== false) {
      const createdName = `${version}.${modelName}Created`
      const createdSchema = Schema.Struct(insertableSchemaFor(columns, modelSchema))
      events[`${modelPrefix}Created`] = Events.synced({
        name: createdName,
        schema: toStandardSchemaV1(createdSchema),
      })
      const defaults = defaultValuesFor(columns)
      const target = tables[modelName]
      materializers[createdName] = (args: Record<string, unknown>) =>
        target.insert({ ...defaults, ...args })
    }

    // Tier 1.7 — bulk event. When the consumer opts in, emit a single
    // `v1.<Model>BulkUpserted` event whose payload is `{ rows: T[] }`.
    // The materialiser returns N inserts that run inside the same
    // event-driven write — only one event/turn, not N.
    if (cfg.includeBulkUpserted === true) {
      const bulkName = `${version}.${modelName}BulkUpserted`
      const rowFields = insertableSchemaFor(columns, modelSchema)
      const rowsSchema = Schema.Array(Schema.Struct(rowFields))
      const bulkSchema = Schema.Struct({ rows: rowsSchema })
      events[`${modelPrefix}BulkUpserted`] = Events.synced({
        name: bulkName,
        schema: toStandardSchemaV1(bulkSchema),
      })
      const defaults = defaultValuesFor(columns)
      const target = tables[modelName]
      materializers[bulkName] = (args: { rows: ReadonlyArray<Record<string, unknown>> }) =>
        args.rows.map((row) => target.insert({ ...defaults, ...row }))
    }

    if (cfg.includeDeleted !== false && softDeleteCol) {
      const deletedName = `${version}.${modelName}Deleted`
      events[`${modelPrefix}Deleted`] = Events.synced({
        name: deletedName,
        schema: Schema.Struct({ id: Schema.String, [softDeleteCol]: Schema.Date }),
      })
      const target = tables[modelName]
      materializers[deletedName] = (args: { id: string; [k: string]: unknown }) =>
        target.update({ [softDeleteCol]: args[softDeleteCol as string] }).where({
          id: args.id,
        })
    }

    const target = tables[modelName]
    for (const field of booleanCols) {
      const { on: onSuffix, off: offSuffix } = eventSuffixesFor(field)
      const onName = `${version}.${modelName}${onSuffix}`
      const offName = `${version}.${modelName}${offSuffix}`
      const onKey = `${modelPrefix}${onSuffix}`
      const offKey = `${modelPrefix}${offSuffix}`
      const setSchema = Schema.Struct({ id: Schema.String })
      events[onKey] = Events.synced({
        name: onName,
        schema: setSchema,
      })
      events[offKey] = Events.synced({
        name: offName,
        schema: setSchema,
      })
      materializers[onName] = ({ id }: { id: string }) =>
        target.update({ [field]: true }).where({ id })
      materializers[offName] = ({ id }: { id: string }) =>
        target.update({ [field]: false }).where({ id })
    }
  }

  if (config.clientDocuments) {
    for (const [name, input] of Object.entries(config.clientDocuments)) {
      const isInput = (i: unknown): i is ClientDocumentInput =>
        typeof i === 'object' && i !== null && 'schema' in (i as object)
      const docSchema = (isInput(input) ? input.schema : input) as Schema.Schema.Any
      const default_ = isInput(input) ? input.default : undefined
      const args: { name: string; schema: unknown; default?: unknown } = {
        name,
        schema: docSchema,
        ...(default_ ? { default: default_ } : {}),
      }
      tables[name] = State.SQLite.clientDocument(args as Parameters<typeof State.SQLite.clientDocument>[0])
      events[`${name}Set`] = tables[name].set
    }
  }

  const state = State.SQLite.makeState({ tables, materializers })

  return {
    tables: tables as LiveStoreDb<T>['tables'],
    events,
    materializers,
    schema: makeSchema({ events, state }),
    readOnly,
  }
}

export { getKeyFromSchema } from './getKeyFromSchema.ts'
export { softDeleteLivePredicate } from './softDeleteLivePredicate.ts'

// Re-export the structural types consumers see, plus a ModelName type
// the consumer can use directly without depending on the upstream
// `prisma-effect-schema-generator` package.
export type {
  ColumnDescriptor,
  TableDescriptor,
  PrimaryKeyColumns,
  SoftDeleteColumns,
  Tables,
} from './types.ts'
export type ModelName = string