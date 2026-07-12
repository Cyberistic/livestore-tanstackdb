import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

import { toStandardSchemaV1 } from './standardSchema.ts'
import type {
  ColumnDescriptor,
  PrimaryKeyColumns,
  SoftDeleteColumns,
  TableDescriptor,
  Tables,
} from './types.ts'

type GeneratedSchemas = Record<string, Schema.Schema.Any>

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
  modelSchema: Schema.Schema.Any,
): Record<string, Schema.Schema.Any> => {
  const fields = (modelSchema as unknown as { fields: Record<string, Schema.Schema.Any> }).fields
  if (!fields || !columns) return {}
  const insertable = columns.filter(
    (c) =>
      c.required &&
      c.type !== 'boolean' &&
      !BOOLEAN_SUFFIX_BLOCKLIST.test(c.name),
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
      // The upstream `prisma-effect-schema-generator` output is already
      // wrapped in `Schema.standardSchemaV1(...)` when that flag is on;
      // the variance check on `State.SQLite.table({ schema })` still
      // disagrees at the type level because of how the intersection is
      // exposed. Cast through any at this single boundary.
      schema: toStandardSchemaV1(modelSchema) as never as never as never,
    })

    if (tableMeta && !tableMeta.includedInSync) {
      readOnly[modelName] = true
    }

    if (cfg.includeCreated !== false) {
      const createdName = `${version}.${modelName}Created`
      const createdSchema = Schema.Struct(insertableSchemaFor(columns, modelSchema))
      events[`${modelPrefix}Created`] = Events.synced({
        name: createdName,
        schema: toStandardSchemaV1(createdSchema) as never,
      })
      const defaults = defaultValuesFor(columns)
      const target = tables[modelName]
      materializers[createdName] = (args: Record<string, unknown>) =>
        target.insert({ ...defaults, ...args })
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