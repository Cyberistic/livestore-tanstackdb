/**
 * Wrap an Effect schema with `Schema.toStandardSchemaV1(...)` so its
 * `DecodingServices` / `EncodingServices` narrow to `never`. Required
 * for `State.SQLite.table({ schema })` and `Events.synced({ schema })`
 * (both want `Schema.Codec` with no service requirements).
 *
 * `prisma-effect-schema-generator@0.1.9` already emits this wrapper
 * for model schemas when `standardSchemaV1 = "true"`. The helper
 * below is for ad-hoc `Schema.Struct(...)` shapes that we build
 * inside `createLiveStoreDb` (e.g. the `{ id, deletedAt }` shape for
 * the `v1.<Model>Deleted` event payload) — those still need
 * narrowing, so we wrap them too.
 */
import { Schema, State } from "@livestore/livestore";

export const toStandardSchemaV1 = <A, I>(
  schema: Schema.Codec<A, I, unknown, unknown>,
): Schema.Codec<A, I, never, never> =>
  Schema.toStandardSchemaV1(
    schema as unknown as Parameters<typeof Schema.toStandardSchemaV1>[0],
  ) as unknown as Schema.Codec<A, I, never, never>;

/**
 * Type-system bridge: LiveStore's `State.SQLite.table({ schema })`
 * variance check wants `Schema.Schema.AnyNoContext` (= `Schema<any, any, never>`).
 * Schemas from upstream `prisma-effect-schema-generator@0.1.8+` are
 * wrapped in `Schema.standardSchemaV1(...)`, returning
 * `StandardSchemaV1<I, A> & SchemaClass<A, I, never>`. The intersection
 * doesn't structurally assign to `AnyNoContext`, even though its
 * `Context` parameter IS `never`.
 *
 * We assert what we know at runtime: the wrapper composes, Context
 * stays `never`. The variance check agrees — this is purely a
 * TypeScript display issue, not a runtime one.
 */
export const toLiveStoreSchema = (
  schema: unknown,
): Parameters<typeof State.SQLite.table>[0]["schema"] =>
  schema as Parameters<typeof State.SQLite.table>[0]["schema"];
