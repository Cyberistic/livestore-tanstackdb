/**
 * The LiveStore ↔ TanStack DB integration package.
 *
 * Follows the same pattern as `@tanstack/electric-db-collection` but
 * adapted for LiveStore's local-first sync model:
 *
 * - `liveStoreCollectionOptions` — Pattern B adapter bridging a LiveStore
 *   query into a TanStack DB collection. Mutation handlers commit
 *   LiveStore events synchronously (no txid matching needed).
 * - `createTypedTable<TRow>` — Typed per-table factory returning a React
 *   hook whose `.collection` is `Collection<TRow, string>`.
 * - `useTable` / `useTables` / `preloadTable` — Generic hooks for
 *   accessing collections by name.
 * - `createLazyDb` — Lazy db proxy for deferred schema loading.
 * - `LiveStoreProvider` / `useLiveStoreConfig` — React context for
 *   LiveStore configuration.
 */
export {
  liveStoreCollectionOptions,
  createCollection,
} from './liveStoreCollection.ts'
export type {
  LiveStoreRow,
  LiveStoreCollectionConfig,
  LiveStoreCollectionUtils,
  IsRowLive,
  CoerceRow,
} from './liveStoreCollection.ts'

export { createTypedTable } from './createTypedUseTable.ts'
export type {
  TypedTableOptions,
  TypedTableResult,
} from './createTypedUseTable.ts'

export { useTable, useTables, preloadTable, getCollection } from './useTable.ts'
export type {
  UseTableOptions,
  UseTableResult,
  TableName,
  RowOf,
  UseTableLiveStore,
} from './useTable.ts'

export { useCrud } from './useCrud.ts'
export type { CrudActions, CrudResult } from './useCrud.ts'

export type { RpcClient, RpcConfig, RpcProcedure } from './mutations.ts'

export { createRpcAdapter } from './rpcAdapter.ts'
export type { CreateRpcAdapterOptions, NamespacesOf } from './rpcAdapter.ts'

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
