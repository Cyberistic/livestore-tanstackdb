import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

import { getKeyFromSchema } from './getKeyFromSchema.ts'
import { softDeleteLivePredicate } from './softDeleteLivePredicate.ts'
import { toStandardSchemaV1 } from './standardSchema.ts'

/**
 * The shape emitted by `prisma-effect-schema-generator`. Each property
 * is an `Effect` `Schema<Decoded, Encoded, Context>` we can hand to
 * `State.SQLite.table({ schema })` or `clientDocument({ schema })`.
 *
 * Note: the runtime schemas are perfectly valid, but the type-level
 * `Schema.Any` (= `Schema<any, any, unknown>`) is *not* assignable to
 * `Schema.Schema.AnyNoContext` (= `Schema<any, any, never>`) which
 * `State.SQLite.table({ schema })` requires. We narrow with `as never`
 * at the boundary (Tier 0.4 in todo.md — long-term, wrapping the
 * generator output with `Schema.standardSchemaV1(...)` removes this).
 */
type GeneratedSchemas = Record<string, Schema.Schema.Any>

/**
 * Configuration for a single client document. The `schema` is the value
 * schema (the row body, ignoring `id`); `default` mirrors
 * `State.SQLite.clientDocument({ default })`. We intentionally type
 * `schema` as `Schema.Schema.Any` because the `Effect` `Schema<A, I, R>`
 * type is invariant on `A` / `I` (`in out`) — a precise `Schema.Struct`
 * can't be widened to `Schema.Any` without a `as never` cast at the
 * call site. The runtime value is the schema instance, unchanged.
 */
export type ClientDocumentInput = {
  schema: Schema.Schema.Any
  default?: {
    id?: string | typeof SessionIdSymbol
    value: unknown
  }
}

/**
 * Per-model configuration for the auto-generated events.
 *
 * Tier 0.1 default behaviour (matching the hand-rolled schema):
 *
 *   - Emit `v1.<Model>Created` + `v1.<Model>Deleted` events.
 *   - For every field whose AST is `Schema.Boolean` AND whose name does
 *     *not* end with `At` / `Date` / `Time` / `Id`, emit a
 *     `v1.<Model><Field>Completed` and `v1.<Model><Field>Uncompleted`
 *     toggle event pair.
 */
export type DefaultEventConfig = {
  /** Generate `v1.<Model>Created`. Defaults to `true`. */
  includeCreated?: boolean
  /** Generate `v1.<Model>Deleted`. Defaults to `true`. */
  includeDeleted?: boolean
  /**
   * Override which fields are treated as togglable booleans. By
   * default: every `Schema.Boolean` whose name doesn't end with
   * `At` / `Date` / `Time` / `Id`. Pass an explicit list to opt
   * specific fields in or out.
   */
  booleanColumns?: string[]
  /**
   * Names to treat as soft-delete timestamps. Default: `["deletedAt"]`.
   * The factory will only emit `v1.<Model>Deleted` if at least one of
   * these is a `Schema.NullOr(Schema.Date)` field on the model.
   */
  softDeleteColumns?: string[]
}

export type ClientDocuments = Record<
  string,
  Schema.Schema.Any | ClientDocumentInput
>

export interface LiveStoreDbConfig<T extends GeneratedSchemas> {
  /**
   * The Schemas object emitted by `prisma-effect-schema-generator` (the
   * default export of `prisma/generated/client-schemas/index.ts`).
   * Keys are model names (`"Todo"`, `"Event"`, …); the factory will
   * create a `tables.<tableName>` entry for each.
   */
  models: T

  /**
   * Override the SQL table name (and `tables.<key>` JS key) for any
   * specific model. Defaults to `camelToSnake(modelName)` (which
   * gives `Todo → todo`, not `todos` — Prisma `@@map("todos")` would
   * mismatch). Use this to match the DDL Prisma produces.
   *
   * @example
   * ```ts
   * createLiveStoreDb({
   *   models: { Todo: TodoSchema, Event: EventSchema },
   *   tableNames: { Todo: 'todos', Event: 'events' },
   * })
   * ```
   */
  tableNames?: Partial<Record<keyof T & string, string>>

  /**
   * Local-only documents (`State.SQLite.clientDocument`). Each entry
   * becomes a `tables[name]` AND an `events[name + "Set"]` event. The
   * value can be a bare schema or a `{ schema, default }` object.
   */
  clientDocuments?: Record<string, Schema.Schema.Any | ClientDocumentInput>

  /** Per-model event configuration. */
  events?: Partial<Record<keyof T & string, DefaultEventConfig>>

  /** Event-name prefix. Defaults to `"v1"`. */
  version?: string
}

/**
 * The output of {@link createLiveStoreDb}. Drop-in for the 89-line
 * hand-written `tables` + `events` + `materializers` + `schema` we
 * currently maintain.
 *
 * Agent 2 builds `useTable(name)` on top of `tables[name]` and the
 * factory's `events` map. We type `tables` as `Record<string, any>` so
 * that `tables.todos.Type`, `tables.uiState.get()`, etc. work without
 * `noUncheckedIndexedAccess` widening. Downstream consumers can cast
 * individual values to the precise `TableDef` shape they need.
 */
export interface LiveStoreDb<T extends GeneratedSchemas> {
  /**
   * SQL tables + client documents. Synced-table keys are derived from
   * the `models` PascalCase names (`Todo` → `tables.todos`); client-doc
   * keys are the literal keys passed to `clientDocuments`. Each value is
   * a `State.SQLite.TableDef` (synced) or `ClientDocumentTableDef`
   * (client doc); both expose the LiveStore query builder so
   * `tables.todos.where({...})` and `tables.uiState.get()` work.
   */
  tables: Record<string, any>
  /**
   * Event definitions keyed by friendly names (`todoCreated`,
   * `todoCompleted`, …). Each is an `EventDef`: callable as
   * `events.todoCreated({ id, text })` and LiveStore-friendly as a
   * `store.commit(events.todoCreated({...}))` payload.
   */
  events: Record<string, any>
  /**
   * Materializers keyed by event *name* (`v1.TodoCreated`, …). Each is
   * a `Materializer` (event args + context → SQL ops). Not exposed as
   * `tables.events` because the JS key is by event-name, not table-name.
   */
  materializers: Record<string, any>
  /** The `LiveStoreSchema` returned by `makeSchema(...)`. */
  schema: ReturnType<typeof makeSchema>
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — pure runtime reflection over Effect's `Schema` AST.
// ─────────────────────────────────────────────────────────────────────

type AST = Schema.Schema.Any['ast']

/**
 * The runtime representation of an `Effect` property signature: the
 * `.ast` of `Schema.Struct({...})` is a `TypeLiteral` whose
 * `propertySignatures` array contains `{ name, type, isOptional,
 * isReadonly, annotations }` entries.
 */
type PropertySignature = {
  readonly name: PropertyKey
  readonly type: AST
  readonly isOptional: boolean
  readonly isReadonly: boolean
  readonly annotations: Record<string, unknown> & Record<symbol, unknown>
}

/**
 * Pull the property signatures off a schema's AST. We prefer the
 * direct `.propertySignatures` accessor on `TypeLiteral` (present in
 * every Effect version we ship with). If the AST is a refinement/
 * transformation the fields aren't directly exposed — we'd need
 * `Schema.getPropertySignatures`, but in our tested bundle
 * (`@livestore/utils@0.4.0`, `effect@3.x`) that helper isn't a
 * function, so the direct path is the one that actually runs today.
 */
const getProperties = (schema: Schema.Schema.Any): PropertySignature[] => {
  const ast = schema.ast
  const direct = (ast as { propertySignatures?: ReadonlyArray<PropertySignature> }).propertySignatures
  return Array.isArray(direct) ? [...direct] : []
}

/**
 * Heuristic for the toggle-event generator: every field whose schema
 * is `Schema.Boolean` AND whose name doesn't end with one of the
 * timestamp / soft-delete / id suffixes.
 *
 * Effect's AST tags the primitive as `"BooleanKeyword"` (NOT
 * `"Boolean"`), and the original draft's `t._tag === 'Boolean'` would
 * silently miss every boolean field. Tier 0.1 fix.
 */
const BOOLEAN_SUFFIX_BLOCKLIST = /(At|Date|Time|Id)$/

const inferBooleanColumns = (
  schema: Schema.Schema.Any,
): string[] => {
  const out: string[] = []
  for (const p of getProperties(schema)) {
    if (p.type._tag !== 'BooleanKeyword') continue
    const name = String(p.name)
    if (BOOLEAN_SUFFIX_BLOCKLIST.test(name)) continue
    out.push(name)
  }
  return out
}

/**
 * True when a property is `Schema.NullOr(SomePrimitive)` — used to
 * detect soft-delete columns. The AST representation is `Union`
 * with at least one `Literal` member; we don't otherwise care which
 * primitive the non-null branch is.
 */
const isNullOrColumn = (p: PropertySignature): boolean => {
  if (p.type._tag !== 'Union') return false
  // `Schema.NullOr(X)` → `Union<[Refinement(Transformation(Date)), Literal(null)]>`.
  // We confirm *some* `Literal` member with `value === null` (encoded as
  // the symbol `Null` in some Effect versions; `Schema.Null` AST
  // branches off a `Declaration` whose name is `'Null'`). The simplest
  // robust check: the union has 2 members, at least one is a Literal.
  const members = (p.type as { types?: ReadonlyArray<AST>; members?: ReadonlyArray<AST> }).types
    ?? (p.type as { members?: ReadonlyArray<AST> }).members
  if (!members || members.length !== 2) return false
  return members.some((m) => m._tag === 'Literal' || m._tag === 'Declaration')
}

/**
 * The insertable shape for `v1.<Model>Created`. Only the fields the
 * caller must supply go in: everything else is filled in by the
 * materialiser's defaults (booleans → `false`, nullable timestamps →
 * `null`, …). For the TodoMVC demo this is just `{ id, text }`.
 *
 * Specifically: drop optional fields, `Schema.Boolean` (covered by
 * toggle events), `Schema.NullOr(...)` (covered by materialiser
 * defaults), and soft-delete / timestamp columns.
 */
const insertableFields = (
  modelSchema: Schema.Schema.Any,
): Record<string, Schema.Schema.Any> => {
  const fields = (modelSchema as unknown as { fields: Record<string, Schema.Schema.Any> }).fields
  if (!fields) return {}
  const out: Record<string, Schema.Schema.Any> = {}
  for (const p of getProperties(modelSchema)) {
    const name = String(p.name)
    if (p.isOptional) continue
    if (BOOLEAN_SUFFIX_BLOCKLIST.test(name)) continue
    if (p.type._tag === 'BooleanKeyword') continue
    if (isNullOrColumn(p)) continue
    const sig = fields[name]
    if (sig) out[name] = sig
  }
  return out
}

/**
 * Pick the `<Suffix>` portion of `v1.<Model><Suffix>` for boolean
 * toggle events.
 *
 * Rule: if the field's capitalized name already ends with
 * `Completed` (e.g. `completed` → `Completed`), the natural pair is
 * `(Completed, Uncompleted)` — matching the hand-rolled
 * `v1.TodoCompleted` / `v1.TodoUncompleted`. Otherwise we qualify each
 * action with the field name so multiple booleans disambiguate
 * (`User.enabled` → `v1.UserEnabledCompleted` etc).
 */
const eventSuffixesFor = (
  fieldName: string,
): { on: string; off: string } => {
  const cap = capitalize(fieldName)
  if (cap.endsWith('Completed')) {
    return { on: 'Completed', off: 'Uncompleted' }
  }
  return { on: `${cap}Completed`, off: `${cap}Uncompleted` }
}

/**
 * Default values supplied by the materializer when a row is inserted
 * from a `Created` event. For boolean columns we emit `false`; for
 * nullable timestamps we emit `null`; everything else is left for the
 * caller (`completed: false`, `deletedAt: null` for the TodoMVC demo).
 */
const defaultValuesFor = (modelSchema: Schema.Schema.Any): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const p of getProperties(modelSchema)) {
    const name = String(p.name)
    if (p.type._tag === 'BooleanKeyword') {
      out[name] = false
      continue
    }
    if (isNullOrColumn(p)) {
      out[name] = null
    }
  }
  return out
}

const camelToSnake = (s: string) =>
  s.replace(/[A-Z]/g, (m, i) => (i ? '_' : '') + m.toLowerCase())

/** `"Todo"` → `"todo"`, `"EventLog"` → `"eventLog"`. */
const camelize = (s: string) => s[0]!.toLowerCase() + s.slice(1)

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1)

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

/**
 * Tier 0.1. Replace ~350 lines of hand-written LiveStore glue per app
 * with one call driven by the `prisma-effect-schema-generator` output.
 *
 * The runtime table derivation uses `State.SQLite.table({ name,
 * schema })` — `name` becomes the SQL table name AND the exported
 * `tables.<name>` key; `schema` is reflected into typed columns via
 * `getColumnDefForSchema`. Confirmed at runtime: produces `{id, text,
 * completed, deletedAt}` columns for the `todos` table on the demo.
 */
export const createLiveStoreDb = <T extends GeneratedSchemas>(
  config: LiveStoreDbConfig<T>,
): LiveStoreDb<T> => {
  const version = config.version ?? 'v1'
  const tables: Record<string, any> = {}
  const events: Record<string, any> = {}
  const materializers: Record<string, any> = {}

  // ── Synced tables (one per model in `prisma/schema.prisma`) ────
  for (const [modelName, modelSchema] of Object.entries(config.models)) {
    // Override the SQL table name to match Prisma's `@@map(...)` /
    // `@@unique(...)` keys. Falls back to a naïve snake-case of the
    // model name (which is wrong for plural model names like `Todo`
    // — Prisma's `@@map("todos")` would mismatch — hence the
    // override).
    const tableName =
      config.tableNames?.[modelName as keyof T & string] ?? camelToSnake(modelName)
    const modelPrefix = camelize(modelName)
    const cfg = config.events?.[modelName as keyof T & string] ?? {}

    tables[tableName] = State.SQLite.table({
      name: tableName,
      // Tier 2.3: wrap with `toStandardSchemaV1` so the schema's
      // `Context` narrows from `unknown` to `never`, which
      // `State.SQLite.table({ schema })` accepts. (Also exposes the
      // `~standard` brand for TanStack DB's `CollectionConfig.schema`.)
      schema: toStandardSchemaV1(modelSchema),
    })

    const booleanCols = cfg.booleanColumns ?? inferBooleanColumns(modelSchema)
    const softDeleteCols = cfg.softDeleteColumns ?? ['deletedAt']

    // `v1.<Model>Created`: args = `Schema.Struct(insertableFields(...))`
    if (cfg.includeCreated !== false) {
      const createdName = `${version}.${modelName}Created`
      const createdSchema = Schema.Struct(insertableFields(modelSchema))
      events[`${modelPrefix}Created`] = Events.synced({
        name: createdName,
        // Tier 2.3: same `Context = never` narrowing as the table
        // schema above. `Events.synced`'s `Schema.Schema<TType,
        // TEncoded>` (R=never) accepts the wrapped form.
        schema: toStandardSchemaV1(createdSchema),
      })
      const defaults = defaultValuesFor(modelSchema)
      materializers[createdName] = (args: Record<string, unknown>) =>
        (tables[tableName] as any).insert({ ...defaults, ...args })
    }

    // `v1.<Model>Deleted`: only generated for models with a soft-delete
    // column (`deletedAt: Schema.NullOr(Schema.Date)` by convention).
    // The materialiser writes the timestamp onto the row instead of
    // removing it; consumers filter soft-deleted rows out via
    // {@link softDeleteLivePredicate}.
    if (cfg.includeDeleted !== false) {
      const softDeleteField = softDeleteCols.find((n) =>
        getProperties(modelSchema).some((p) => String(p.name) === n && isNullOrColumn(p)),
      )
      if (softDeleteField) {
        const deletedName = `${version}.${modelName}Deleted`
        events[`${modelPrefix}Deleted`] = Events.synced({
          name: deletedName,
          schema: Schema.Struct({ id: Schema.String, [softDeleteField]: Schema.Date }),
        })
        materializers[deletedName] = (args: { id: string; [k: string]: unknown }) =>
          (tables[tableName] as any).update({ [softDeleteField]: args[softDeleteField] }).where({ id: args.id })
      }
    }

    // Toggle events for boolean columns. Naming convention:
    //   `v1.<Model><Suffix>` where `<Suffix>` is `Completed`/`Uncompleted`
    //   for `completed`-style fields (matches the hand-rolled
    //   `v1.TodoCompleted` / `v1.TodoUncompleted`), and `<Field>Completed` /
    //   `<Field>Uncompleted` for everything else so multiple booleans
    //   remain unambiguous.
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
        (tables[tableName] as any).update({ [field]: true }).where({ id })
      materializers[offName] = ({ id }: { id: string }) =>
        (tables[tableName] as any).update({ [field]: false }).where({ id })
    }
  }

  // ── Client documents (local-only ephemeral state) ────────────
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
      // Tier 0.4 workaround: `clientDocument`'s input type insists on a
      // `default` field with shape `Input<TType>` (covariant on the
      // value schema), which the `Schema.Schema.Any` we receive from
      // the generator doesn't satisfy. Cast once, outside the call.
      tables[name] = State.SQLite.clientDocument(args as never) as never
      events[`${name}Set`] = (tables[name] as any).set
    }
  }

  const state = State.SQLite.makeState({ tables, materializers })

  const built: LiveStoreDb<T> = {
    tables,
    events,
    materializers,
    schema: makeSchema({ events, state }),
  }
  return built
}

export { getKeyFromSchema } from './getKeyFromSchema.ts'
export { softDeleteLivePredicate } from './softDeleteLivePredicate.ts'
