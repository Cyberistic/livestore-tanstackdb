/**
 * The LiveStore ↔ TanStack DB integration package.
 *
 *   - `liveStoreCollectionOptions` (Pattern B adapter) — bridges a
 *     LiveStore query into a TanStack DB collection.
 *   - `useTable(name)` / `useTables(spec)` / `preloadTable(name)` — React
 *     hooks for accessing those collections. The lazy `db.<name>` proxy
 *     (Tier 2.1) lets existing `import { X } from "@/lib/db"` call sites
 *     keep working post-migration.
 *   - `LiveStoreProvider` + `useLiveStoreConfig` — single component that
 *     holds the LiveStore schema, the store reference, and the oRPC
 *     client so descendants can use any of the above.
 *   - `createMutations` (Tier 0.6) — auto-derives commitInsert /
 *     commitUpdate / commitDelete from a `{ rpc: { ns: { proc: { map? } } } }`
 *     config so writes round-trip to the server automatically.
 *
 * Pairs with `@cyberistic/livestore-prisma` (or with hand-written
 * LiveStore schemas — this package is LiveStore-source-agnostic).
 */
export { liveStoreCollectionOptions } from './liveStoreCollection.ts'
export type {
  LiveStoreRow,
  IsRowLive,
  CoerceRow,
} from './liveStoreCollection.ts'

export { useTable, useTables, preloadTable, getCollection } from './useTable.ts'
export type {
  UseTableOptions,
  UseTableResult,
  TableName,
  RowOf,
  UseTableLiveStore,
} from './useTable.ts'
export type { RpcClient, RpcConfig } from './mutations.ts'

export { createLazyDb } from './lazyDb.ts'
export type {
  LazyDbOptions,
  LoaderProxy,
  OnSync,
  SyncOp,
} from './lazyDb.ts'

export { createMutations } from './mutations.ts'

export { LiveStoreProvider, useLiveStoreConfig } from './LiveStoreProvider.tsx'
export type { LiveStoreProviderProps, LiveStoreConfig } from './LiveStoreProvider.tsx'

export { getKeyFromSchema } from './getKeyFromSchema.ts'
export { softDeleteLivePredicate } from './softDeleteLivePredicate.ts'
export { toStandardSchemaV1 } from './standardSchema.ts'