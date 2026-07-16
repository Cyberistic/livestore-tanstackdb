import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "@livestore/livestore";
import { toStandardSchemaV1 as toStandardSchemaV1Prisma } from "livestore-prisma";

/**
 * Wrap any generated Effect Schema so it satisfies TanStack DB's
 * Standard Schema shape (works in `createCollection({ schema })`
 * directly without the `as any` cast we currently use).
 *
 * Delegates to `livestore-prisma`'s {@link toStandardSchemaV1Prisma}
 * and re-projects the return type to the `StandardSchemaV1` ∩
 * `Schema.Codec<T, _, never, never>` shape TanStack DB's
 * `createCollection({ schema })` accepts.
 *
 * The `prisma-effect-schema-generator` upstream package should also
 * emit this by default once 2.3 ships in our fork — until then,
 * call sites can wrap manually with this helper.
 */
export const toStandardSchemaV1 = <T>(s: Schema.Codec<T, any, any, any>) =>
  toStandardSchemaV1Prisma(
    s as unknown as Parameters<typeof toStandardSchemaV1Prisma>[0],
  ) as unknown as StandardSchemaV1<unknown, T> & Schema.Codec<T, any, never, never>;
