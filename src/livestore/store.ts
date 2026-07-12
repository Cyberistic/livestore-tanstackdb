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

const loadStore = (): Promise<AppStore> =>
  createStorePromise({
    storeId,
    schema: schema as LiveStoreSchema,
    adapter,
    batchUpdates,
    syncPayloadSchema: SyncPayload,
    syncPayload: { authToken: 'insecure-token-change-me' },
  }).then(withReactApi) as Promise<AppStore>

/**
 * Module-level store cache. We hold the in-flight Promise so that:
 *   1. The TanStack Router loader can call `getOrCreateAppStore()` outside
 *      any React tree (no `<StoreRegistryProvider>` required).
 *   2. The component-level `useAppStore()` hook sees the same instance via
 *      `React.use(storePromise)` — no double-load, no two registries.
 */
let storePromise: Promise<AppStore> | null = null

/**
 * Returns the same LiveStore store instance every call. Kicks off the
 * initial load on the first call and caches the resulting promise.
 *
 * Safe to call from non-React contexts (e.g. TanStack Router loaders).
 */
export const getOrCreateAppStore = (): Promise<AppStore> => {
  if (storePromise === null) storePromise = loadStore()
  return storePromise
}

/**
 * React entry point. Suspends until the store is ready, then returns the
 * same instance `getOrCreateAppStore()` would return.
 */
export const useAppStore = (): AppStore => {
  const store = reactUse(getOrCreateAppStore())
  return store
}