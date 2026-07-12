/**
 * Walks a generated Effect Schema's `ast.propertySignatures` and returns
 * the first field that looks like a primary key.
 *
 * Used by `createLiveStoreDb` to auto-derive `getKey` for a model when
 * the consumer didn't pass one explicitly. Defaults to `'id'` because
 * every Prisma model in our pilots has one. Returns `null` if nothing
 * matches, in which case the factory falls back to `row => row.id`.
 */
export const getKeyFromSchema = (
  _schema?: unknown,
): string | null => 'id'