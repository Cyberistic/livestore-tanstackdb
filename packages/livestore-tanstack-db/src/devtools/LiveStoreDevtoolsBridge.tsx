/**
 * Drop-in React component that wires a LiveStore `Store` + a set of
 * TanStack DB collections into the devtools bus (Tier 2.7). Mount
 * once inside the React tree, after `<StoreRegistryProvider>`:
 *
 *   <LiveStoreDevtoolsBridge collections={{ Todo: todosCollection }} />
 *
 * The component:
 *   - patches `store.commit` to forward every optimistic local commit
 *     into the devtools panel BEFORE the event is confirmed (seqNum
 *     shown as `(pending)`).
 *   - iterates `store.events()` to emit every confirmed event with
 *     its real seqNum (kind: `'remote'`).
 *   - subscribes to `store.subscribeSyncStatus` for session-level
 *     sync state.
 *   - registers every collection passed via the `collections` prop
 *     so per-collection `status:change` events flow into the panel.
 *
 * If `store` is omitted, the bridge falls back to the module-level
 * `getOrCreateAppStore()` from `@livestore/adapter-web` — so most
 * apps can write:
 *
 *   <LiveStoreDevtoolsBridge collections={{ Todo: todosCollection }} />
 *
 * without threading the store through the tree.
 */
import { useEffect } from 'react'
import type { Store } from '@livestore/livestore'
import type { Collection } from '@tanstack/db'

import { useLiveStoreDevtoolsBridge, registerCollection } from './bridge.ts'

export interface LiveStoreDevtoolsBridgeProps {
  /**
   * The LiveStore `Store` to bridge. Omit to use the module-cached
   * `getOrCreateAppStore()`.
   */
  store?: Store<any> | null

  /**
   * Map of `modelName → collection` to register with the bridge.
   * The bridge subscribes to each collection's `status:change`
   * events so the devtools panel can show per-collection state.
   */
  collections?: Record<string, Collection<any, string>>
}

// We deliberately don't depend on @livestore/adapter-web at the
// top level — most consumers pass the store explicitly. The fallback
// is a lazy `require()` that only runs if `store` is omitted.
let _fallbackStore: Store<any> | null | undefined = undefined
const resolveAppStore = (): Store<any> | null => {
  if (_fallbackStore !== undefined) return _fallbackStore
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@livestore/adapter-web') as {
      getOrCreateAppStore?: () => Store<any> | null
    }
    _fallbackStore =
      typeof mod.getOrCreateAppStore === 'function'
        ? mod.getOrCreateAppStore()
        : null
  } catch {
    _fallbackStore = null
  }
  return _fallbackStore
}

/**
 * Mount once inside the React tree, after `<StoreRegistryProvider>`.
 * Returns `null` — it's a side-effect-only component.
 *
 * @example
 * ```tsx
 * function App() {
 *   const [todos] = useCrud('Todo')
 *   return (
 *     <>
 *       <Header />
 *       <MainSection />
 *       <LiveStoreDevtoolsBridge collections={{ Todo: todos }} />
 *       <TanStackDevtools plugins={[liveStoreDevtoolsPlugin()]} />
 *     </>
 *   )
 * }
 * ```
 */
export const LiveStoreDevtoolsBridge: React.FC<LiveStoreDevtoolsBridgeProps> = ({
  store,
  collections,
}) => {
  // Resolve the store: prefer the explicit `store` prop, fall back
  // to the module-cached app store.
  const resolvedStore = store ?? resolveAppStore()

  useLiveStoreDevtoolsBridge(resolvedStore)

  useEffect(() => {
    if (!collections) return
    for (const [id, collection] of Object.entries(collections)) {
      registerCollection(id, collection)
    }
  }, [collections])

  return null
}