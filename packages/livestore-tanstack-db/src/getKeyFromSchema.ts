import type { Schema } from "@livestore/livestore";
import { getKeyFromSchema as getKeyColumnFromSchema } from "livestore-prisma";

/**
 * Tier 1.1 — derive a `getKey`-style accessor from a LiveStore model
 * schema. Wraps {@link getKeyColumnFromSchema} (which returns the
 * primary-key column name as a `string | null`) into the
 * `(row) => row[pk]` shape TanStack DB's
 * `createCollection({ getKey })` expects.
 *
 * `livestore-prisma`'s helper walks `schema.fields` (Effect v4 style)
 * and falls back to `'id'` whenever the schema shape is unrecognised
 * (e.g. a bare `Schema.Top` from a LiveStore table def). The
 * fallback matches the catch-and-`row.id` recovery in
 * {@link getKeyFromTable}, so observable behaviour at the call sites
 * we exercise today is identical to the previous local walker.
 */
export const getKeyFromSchema = <TRow extends Record<string, unknown>>(
  schema: Schema.Top,
): ((row: TRow) => string) => {
  const pk = getKeyColumnFromSchema(schema) ?? "id";
  return (row: TRow) => row[pk] as unknown as string;
};
