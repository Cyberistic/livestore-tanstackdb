/**
 * Walks a generated Effect Schema's `ast.propertySignatures` and returns
 * the first field that looks like a primary key.
 *
 * Used by `createLiveStoreDb` to auto-derive `getKey` for a model when
 * the consumer didn't pass one explicitly. Defaults to `'id'` because
 * every Prisma model in our pilots has one. Returns `null` if nothing
 * matches, in which case the factory falls back to `row => row.id`.
 */
export const getKeyFromSchema = (schema?: unknown): string | null => {
  if (!schema || typeof schema !== "object") return "id";
  const fields = (schema as { readonly fields?: Readonly<Record<string, unknown>> }).fields;
  if (!fields) return "id";

  // Look for a field whose ast has the `isPrimaryKey` marker. The upstream
  // `prisma-effect-schema-generator` sets this on the id field when
  // `emitPrimaryKeyMarker: true` is configured. Falls back to any field
  // whose name ends in `Id` (case-insensitive).
  for (const [name, sig] of Object.entries(fields)) {
    const ast = (sig as { readonly ast?: { readonly isPrimaryKey?: boolean } }).ast;
    if (ast?.isPrimaryKey) return name;
  }
  for (const name of Object.keys(fields)) {
    if (/^(id|.*Id)$/i.test(name)) return name;
  }
  return "id";
};
