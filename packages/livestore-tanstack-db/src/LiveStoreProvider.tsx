import type { LiveStoreSchema } from '@livestore/livestore'
import type React from 'react'
import { createContext, useContext, useMemo } from 'react'

import type { RpcClient } from './mutations.ts'

/**
 * The shape `LiveStoreProvider` accepts. We accept both:
 * - the full `LiveStoreDb` object returned by `createLiveStoreDb(...)`
 *   (the Tier 0.1 output: `{ tables, events, materializers, schema, readOnly }`)
 * - the bare `LiveStoreSchema` (the `makeSchema(...)` output of a
 *   hand-rolled schema)
 *
 * Internally we always normalize to the wider shape so per-table
 * hooks can introspect `tables` / `events` / `schema` from a single
 * context value. The bare-schema path synthesises a `tables: {}`
 * (callers then provide `liveStore` to `useTable` explicitly).
 */
export type LiveStoreProviderSchema =
  | LiveStoreSchema
  | (LiveStoreSchema & {
      readonly tables?: Record<string, unknown>
      readonly events?: Record<string, unknown>
      readonly materializers?: Record<string, unknown>
      readonly readOnly?: Record<string, unknown>
    })

export interface LiveStoreProviderProps {
  /**
   * The LiveStore schema — either the bare `makeSchema(...)` output,
   * or the wider `createLiveStoreDb(...)` object. Threaded down to
   * per-table collection hooks (Tier 0.2) so they can introspect
   * models and derive `getKey` / soft-delete predicates without
   * re-importing.
   */
  schema: LiveStoreProviderSchema
  /**
   * Tier 0.6: the oRPC client used to translate TanStack DB mutations
   * into LiveStore events. When set, any
   * `useTable(name, { rpc: { config } })` call auto-derives `rpc.client`
   * from this value, so consumers don't have to thread the same client
   * through every call site.
   */
  oRPC?: RpcClient
  children: React.ReactNode
}

export interface LiveStoreConfig {
  schema: LiveStoreProviderSchema
  oRPC?: RpcClient
  /**
   * Tables that should NOT get client-side write APIs. Read by
   * `lazyDb` and `useTable` to refuse commit handlers. Typically
   * sourced from the per-table flags in
   * `prisma/livestore.annotations.json`.
   */
  serverOnlyTables?: ReadonlyArray<string>
}

const LiveStoreConfigContext = createContext<LiveStoreConfig | null>(null)

/**
 * Read the { schema, oRPC } pair passed to <LiveStoreProvider>.
 *
 * Returns `null` when no provider is in scope. Per-table hooks (Tier
 * 0.2/0.3) use this to discover which models exist and what oRPC
 * client to write back through.
 */
export const useLiveStoreConfig = (): LiveStoreConfig | null =>
  useContext(LiveStoreConfigContext)

/**
 * Single import for the whole LiveStore integration tree.
 *
 * Today this is a thin wrapper: the store is still created at module
 * load by `getOrCreateAppStore()` in `livestore/store.ts` (so callers
 * can use it from TanStack Router loaders, no React tree required),
 * and `useAppStore()` reads from the same module-cached promise.
 *
 * The provider's job is to surface `{ schema, oRPC }` to descendant
 * hooks via context. The shape is forward-compatible with the
 * "<StoreRegistryProvider> + <StoreProvider>" stack mentioned in
 * todo.md Tier 3.1 — when per-table collection providers land, they
 * compose inside this one.
 */
export const LiveStoreProvider: React.FC<LiveStoreProviderProps> = ({
  schema,
  oRPC,
  children,
}) => {
  const value = useMemo<LiveStoreConfig>(
    () => ({ schema, oRPC }),
    [schema, oRPC],
  )
  return (
    <LiveStoreConfigContext.Provider value={value}>
      {children}
    </LiveStoreConfigContext.Provider>
  )
}
