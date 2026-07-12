/**
 * The Prisma ↔ LiveStore bridge package.
 *
 *   - `prisma-livestore-generator` (sibling binary) reads
 *     `schema.prisma` + `livestore.annotations.json` and emits the
 *     LiveStore-specific code: events, materializers, table descriptors.
 *   - `createLiveStoreDb` consumes that output and the upstream
 *     `prisma-effect-schema-generator` schemas and builds a runnable
 *     LiveStore schema.
 *
 * Pairs with `@cyberistic/livestore-tanstack-db`, which provides the
 * TanStack-DB glue (useTable, lazyDb, mutations, LiveStoreProvider).
 */
export { createLiveStoreDb } from './createLiveStoreDb.ts'
export type {
  LiveStoreDb,
  LiveStoreDbConfig,
  DefaultEventConfig,
  ClientDocumentInput,
} from './createLiveStoreDb.ts'
export type {
  ColumnDescriptor,
  TableDescriptor,
  PrimaryKeyColumns,
  SoftDeleteColumns,
  Tables,
} from './types.ts'
export type ModelName = string