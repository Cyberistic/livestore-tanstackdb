import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { createStorePromise } from '@livestore/livestore'
import type { LiveStoreSchema } from '@livestore/livestore'
import { withReactApi } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { use as reactUse } from 'react'

import LiveStoreWorker from '../livestore.worker.ts?worker'
import { getStoreId } from '../util/store-id.ts'
import { SyncPayload, schema } from './schema.ts'

const storeId = getStoreId()

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' as const },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

export type AppStore = Awaited<
  ReturnType<typeof createStorePromise<typeof schema>>
> & {
  useQuery: ReturnType<typeof withReactApi>['useQuery']
  useClientDocument: ReturnType<typeof withReactApi>['useClientDocument']
  useSyncStatus: ReturnType<typeof withReactApi>['useSyncStatus']
}

/**
 * The non-React "store handle" returned by {@link getOrCreateAppStore}.
 *
 * Bundles the `Store` together with the `schema` + `storeId` it was
 * created with, so callers outside React (TanStack Router loaders,
 * Cloudflare Worker handlers, scripts, the lazy-db proxy at
 * `integration/lazyDb.ts`) can:
 *
 *   - read/write the store directly (`store.commit(...)`,
 *     `store.query(...)`, `store.subscribe(...)`),
 *   - introspect the schema (e.g. to enumerate tables / events
 *     without re-importing `livestore/schema.ts`),
 *   - log the `storeId` (useful when correlating client + server
 *     sync logs).
 *
 * The {@link useAppStore} React hook unwraps `.store` for components
 * that only need the LiveStore `Store`.
 */
export interface AppStoreContext {
  /** The LiveStore `Store` instance, with `withReactApi` applied. */
  store: AppStore
  /** The `LiveStoreSchema` the store was created with. */
  schema: typeof schema
  /** The `storeId` the store was created with. */
  storeId: string
}

const loadStore = (): Promise<AppStoreContext> =>
  createStorePromise({
    storeId,
    schema: schema as LiveStoreSchema,
    adapter,
    batchUpdates,
    syncPayloadSchema: SyncPayload,
    syncPayload: { authToken: 'insecure-token-change-me' },
  }).then(
    (store): AppStoreContext => ({
      store: withReactApi(store) as AppStore,
      schema,
      storeId,
    }),
  )

/**
 * Module-level store cache. We hold the in-flight Promise so that:
 *   1. The TanStack Router loader can call `getOrCreateAppStore()` outside
 *      any React tree (no `<StoreRegistryProvider>` required).
 *   2. The component-level `useAppStore()` hook sees the same instance via
 *      `React.use(storePromise)` — no double-load, no two registries.
 */
let storePromise: Promise<AppStoreContext> | null = null

/**
 * Returns the same LiveStore store context every call. Kicks off the
 * initial load on the first call and caches the resulting promise.
 *
 * The returned {@link AppStoreContext} exposes the `store`, `schema`,
 * and `storeId` together — non-React callers (loaders, scripts,
 * Worker handlers) can `store.commit(...)` / `store.query(...)`
 * directly without touching the React tree.
 *
 * Safe to call from non-React contexts (e.g. TanStack Router loaders).
 */
export const getOrCreateAppStore = (): Promise<AppStoreContext> => {
  if (storePromise === null) storePromise = loadStore()
  return storePromise
}

/**
 * Reset the module-level store cache. The next call to
 * {@link getOrCreateAppStore} will start a fresh load on the same
 * `storeId`.
 *
 * Test-only — production code should never call this. The LiveStore
 * web worker + OPFS connection spawned by the original store are NOT
 * actually closed by `disposeAppStore`; they keep running in the
 * background. To get a fully clean slate for the next test, also call
 * `disposeCollections()` from `integration/useTable.ts` so any cached
 * TanStack DB collections referencing the old store don't leak into
 * the next render.
 */
export const disposeAppStore = (): void => {
  storePromise = null
}

/**
 * React entry point. Suspends until the store is ready, then returns
 * the `store` from the same context `getOrCreateAppStore()` would
 * return. Public API for components — unchanged from before Tier 1.5.
 */
export const useAppStore = (): AppStore => {
  return reactUse(getOrCreateAppStore()).store
}