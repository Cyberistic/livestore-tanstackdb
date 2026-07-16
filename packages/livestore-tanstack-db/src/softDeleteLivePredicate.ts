import type { Schema } from "@livestore/livestore";

/**
 * Tier 1.2 — auto-coerce a soft-delete predicate from a LiveStore
 * model schema. If the schema has a `deletedAt: Schema.NullOr(
 * Schema.Date)` field (or whatever `options.column` names), returns
 * `(row) => row[column] == null`. If the field is absent, returns
 * `() => true` (every row is live).
 *
 * Override the field name via {@link column}.
 *
 * Note: this is a *factory* — it inspects the schema at call time.
 * `livestore-prisma` exports a different shape, a single-row predicate
 * that checks `deletedAt`, `archivedAt`, and `isDeleted`. The two
 * operate on different inputs (schema vs row) and different column
 * semantics (single explicit column vs auto-detected set), so we
 * cannot delegate to the prisma version — the factory walker stays
 * local. The `livestore-prisma` predicate is still re-exported from
 * the package index for consumers that have a row in hand.
 */
export const softDeleteLivePredicate = <TRow extends Record<string, unknown>>(
  schema: Schema.Top,
  options: { column?: string } = {},
): ((row: TRow) => boolean) => {
  const column = options.column ?? "deletedAt";
  const props = propertySignaturesOf(schema);

  const found = props.find((p) => String(p.name) === column);
  if (!found) return () => true;
  if (!isNullOrDate(found)) return () => true;

  return (row: TRow) => row[column] == null;
};

type PropertySignature = {
  readonly name: PropertyKey;
  readonly type: { _tag: string; types?: ReadonlyArray<unknown>; members?: ReadonlyArray<unknown> };
  readonly isOptional: boolean;
  readonly annotations: Record<string, unknown> & Record<symbol, unknown>;
};

const propertySignaturesOf = (schema: Schema.Top): PropertySignature[] => {
  const direct = (schema.ast as { propertySignatures?: ReadonlyArray<PropertySignature> })
    .propertySignatures;
  return Array.isArray(direct) ? [...direct] : [];
};

const isNullOrDate = (p: PropertySignature): boolean => {
  if (p.type._tag !== "Union") return false;
  const members = (p.type.types ?? p.type.members) as ReadonlyArray<{ _tag: string }> | undefined;
  if (!members || members.length !== 2) return false;
  return members.some((m) => m._tag === "Literal" || m._tag === "Declaration");
};
