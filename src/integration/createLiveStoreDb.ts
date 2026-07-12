import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

import {
  PRIMARY_KEY_COLUMNS,
  SOFT_DELETE_COLUMNS,
  TABLES,
  type ColumnDescriptor,
  type TableDescriptor,
  type ModelName,
} from '../../prisma/generated/client-schemas/index.ts'
import { toStandardSchemaV1 } from './standardSchema.ts'

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
  models: T
  clientDocuments?: Record<string, Schema.Schema.Any | ClientDocumentInput>
  events?: Partial<Record<keyof T & string, DefaultEventConfig>>
  version?: string

  /**
   * Tables that should NOT get client-side write APIs even though
   * `TABLES[model].includedInSync` is `true`. Audit logs, event
   * mirrors, etc. — the DO/server writes to them, the client only reads.
   *
   * Pairs with `TABLES[m].includedInSync` from the generator:
   * - If `includedInSync: false` (upstream autodetected): server-only
   *   regardless of this list.
   * - If `includedInSync: true` and name is in this list: server-only
   *   (consumer override; e.g. `Event` table that the upstream hasn't
   *   flagged yet because the `idColumn` autodetect PR hasn't landed).
   * - Otherwise: client-writable.
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
  modelName: keyof typeof TABLES & string,
  override?: string[],
): string[] => {
  if (override) return override
  return TABLES[modelName].columns
    .filter((c) => c.type === 'boolean' && !BOOLEAN_SUFFIX_BLOCKLIST.test(c.name))
    .map((c) => c.name)
}

const defaultValuesFor = (
  modelName: keyof typeof TABLES & string,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const c of TABLES[modelName].columns) {
    if (c.type === 'boolean') {
      out[c.name] = false
      continue
    }
    if (!c.required) out[c.name] = null
  }
  return out
}

const insertableSchemaFor = (
  modelName: keyof typeof TABLES & string,
  modelSchema: Schema.Schema.Any,
): Record<string, Schema.Schema.Any> => {
  const fields = (modelSchema as unknown as { fields: Record<string, Schema.Schema.Any> }).fields
  if (!fields) return {}
  const insertable = TABLES[modelName].columns.filter(
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
    const mName = modelName as keyof typeof TABLES & string
    const tableMeta = TABLES[mName]
    const modelPrefix = camelize(modelName)
    const cfg = config.events?.[mName] ?? {}

    const booleanCols = booleanColumnsFor(mName, cfg.booleanColumns)
    const softDeleteCol =
      cfg.softDeleteColumn !== undefined
        ? cfg.softDeleteColumn
        : (SOFT_DELETE_COLUMNS as Record<string, string | undefined>)[mName]

    tables[modelName] = State.SQLite.table({
      name: tableMeta.name,
      schema: toStandardSchemaV1(modelSchema),
    })

    if (!tableMeta.includedInSync) {
      readOnly[modelName] = true
    }

    if (cfg.includeCreated !== false) {
      const createdName = `${version}.${modelName}Created`
      const createdSchema = Schema.Struct(insertableSchemaFor(mName, modelSchema))
      events[`${modelPrefix}Created`] = Events.synced({
        name: createdName,
        schema: toStandardSchemaV1(createdSchema),
      })
      const defaults = defaultValuesFor(mName)
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
export { PRIMARY_KEY_COLUMNS, SOFT_DELETE_COLUMNS, TABLES } from '../../prisma/generated/client-schemas/index.ts'
export type { ModelName, ColumnDescriptor, TableDescriptor } from '../../prisma/generated/client-schemas/index.ts'