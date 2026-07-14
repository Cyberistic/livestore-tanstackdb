import { Schema } from "@livestore/livestore";

/**
 * Tier 1.1 — derive a `getKey`-style accessor from a Prisma/Effect
 * model schema. Walks `ast.propertySignatures` looking for the column
 * marked as primary key (Prisma's `@id` in DMMF terms → we look for
 * `isPrimaryKey: true` OR `meta._id: true` annotations on the
 * property; falls back to the `id` column when no annotation is set,
 * mirroring Prisma's `@id default` behaviour).
 *
 * The returned function is `(row) => row[primaryKeyColumnName]` — the
 * shape TanStack DB's `createCollection({ getKey })` expects.
 *
 * Throws if no usable column is found; the caller is responsible for
 * not invoking this on schemas without an id.
 */
export const getKeyFromSchema = <TRow extends Record<string, unknown>>(
  schema: Schema.Top,
): ((row: TRow) => string) => {
  const props = propertySignaturesOf(schema);

  const annotated = props.find((p) => {
    const a = p.annotations;
    return a?.isPrimaryKey === true || a?._id === true;
  });
  if (annotated) {
    const name = String(annotated.name);
    return (row: TRow) => row[name] as unknown as string;
  }

  const namedId = props.find((p) => String(p.name) === "id");
  if (namedId) {
    return (row: TRow) => row.id as unknown as string;
  }

  throw new Error(
    `getKeyFromSchema: no primary key found on schema (${
      props.length === 0
        ? "struct has no fields"
        : 'tried isPrimaryKey, _id annotations, and a field named "id"'
    })`,
  );
};

type PropertySignature = {
  readonly name: PropertyKey;
  readonly type: { _tag: string };
  readonly isOptional: boolean;
  readonly annotations: Record<string, unknown> & Record<symbol, unknown>;
};

const propertySignaturesOf = (schema: Schema.Top): PropertySignature[] => {
  const direct = (schema.ast as { propertySignatures?: ReadonlyArray<PropertySignature> })
    .propertySignatures;
  return Array.isArray(direct) ? [...direct] : [];
};
