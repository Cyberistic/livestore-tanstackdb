/**
 * Structural types shared between the LiveStore integration code and
 * the upstream `prisma-effect-schema-generator` output. Re-exported
 * from `livestore-prisma` (the canonical source of truth) so a single
 * TABLES object can be passed to both packages.
 */
export type {
  ColumnDescriptor,
  TableDescriptor,
  PrimaryKeyColumns,
  SoftDeleteColumns,
  Tables,
} from "livestore-prisma";
