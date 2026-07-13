/**
 * Build a LiveStore-ism-row predicate that hides soft-deleted rows.
 *
 * The factory's default is `() => true` (everything is live). When the
 * consumer passes a `softDeleteColumn` (autodetected by
 * `prisma-effect-schema-generator`'s `softDeleteColumn` option or
 * declared explicitly via `prisma/livestore.annotations.json`), we wrap
 * the row read to set the column to `null` on the read path.
 */
export const softDeleteLivePredicate = (row: unknown): boolean => {
  if (row === null || typeof row !== "object") return true;
  const r = row as { deletedAt?: unknown; archivedAt?: unknown; isDeleted?: unknown };
  return (
    r.deletedAt == null &&
    r.archivedAt == null &&
    (r.isDeleted === undefined || r.isDeleted === false)
  );
};
