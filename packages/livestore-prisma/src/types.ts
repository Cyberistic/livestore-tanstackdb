/**
 * Structural types the {@link createLiveStoreDb} factory consumes. Mirrored
 * from `livestore-tanstack-db`'s `types.ts` (kept identical
 * so consumers can pass a single TABLES object to both packages).
 */

export interface ColumnDescriptor {
  readonly name: string
  readonly type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'json'
    | 'bytes'
    | 'unknown'
  readonly required: boolean
  readonly list: boolean
  readonly unique: boolean
  readonly isEnum: boolean
  readonly enumValues?: ReadonlyArray<string>
}

export interface TableDescriptor {
  readonly name: string
  readonly primaryKey: string | null
  readonly softDelete: string | null
  readonly columns: ReadonlyArray<ColumnDescriptor>
  readonly includedInSync: boolean
}

export type PrimaryKeyColumns = Readonly<Record<string, string | null>>
export type SoftDeleteColumns = Readonly<Partial<Record<string, string>>>
export type Tables = Readonly<Record<string, TableDescriptor>>