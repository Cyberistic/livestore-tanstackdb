/**
 * Structural types shared between the LiveStore integration code and
 * the upstream `prisma-effect-schema-generator` output. Re-exported
 * from `./index.ts` so consumers don't need a second import for them.
 */
export interface ColumnDescriptor {
  readonly name: string;
  readonly type: "string" | "number" | "boolean" | "date" | "json" | "bytes" | "unknown";
  readonly required: boolean;
  readonly list: boolean;
  readonly unique: boolean;
  readonly isEnum: boolean;
  readonly enumValues?: ReadonlyArray<string>;
}

export interface TableDescriptor {
  readonly name: string;
  readonly primaryKey: string | null;
  readonly softDelete: string | null;
  readonly columns: ReadonlyArray<ColumnDescriptor>;
  readonly includedInSync: boolean;
}

/** Map of model name → primary-key column (or null for composite keys). */
export type PrimaryKeyColumns = Readonly<Record<string, string | null>>;

/** Map of model name → soft-delete column. Models without soft-delete are absent. */
export type SoftDeleteColumns = Readonly<Partial<Record<string, string>>>;

/** Map of model name → table descriptor. */
export type Tables = Readonly<Record<string, TableDescriptor>>;
