import type { LiveStoreSchema } from '@livestore/livestore'
import type React from 'react'
import { createContext, useContext, useMemo } from 'react'

export interface LiveStoreProviderProps {
  /**
   * The LiveStore schema returned by `createLiveStoreDb(...)` (or the
   * hand-rolled `makeSchema(...)` block). Threaded down to per-table
   * collection hooks (Tier 0.2) so they can introspect models and
   * derive `getKey` / soft-delete predicates without re-importing.
   */
  schema: LiveStoreSchema
  /**
   * Reserved for Tier 0.6: the oRPC client used to translate TanStack
   * DB mutations into LiveStore events. Accepted today so consumers
   * can wire it through; per-table hooks (Tier 0.3) will pick it up
   * via `useLiveStoreConfig().oRPC` once they land.
   */
  oRPC?: unknown
  children: React.ReactNode
}

export interface LiveStoreConfig {
  schema: LiveStoreSchema
  oRPC: unknown
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
