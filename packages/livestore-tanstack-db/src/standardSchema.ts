import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "@livestore/livestore";

/**
 * Wrap any generated Effect Schema so it satisfies TanStack DB's
 * Standard Schema shape (works in `createCollection({ schema })`
 * directly without the `as any` cast we currently use).
 *
 * The `prisma-effect-schema-generator` upstream package should also
 * emit this by default once 2.3 ships in our fork — until then,
 * call sites can wrap manually with this helper.
 *
 * Returns the intersection of `StandardSchemaV1<unknown, T>` and the
 * Effect `SchemaClass<T, unknown, never>`, so call sites keep the
 * decode/encode ergonomics of an Effect Schema while TanStack DB
 * sees the `~standard` brand.
 */
export const toStandardSchemaV1 = <T>(s: Schema.Codec<T, any, any, any>) =>
  Schema.toStandardSchemaV1(
    s as unknown as Parameters<typeof Schema.toStandardSchemaV1>[0],
  ) as unknown as StandardSchemaV1<unknown, T> & Schema.Codec<T, any, never, never>;
