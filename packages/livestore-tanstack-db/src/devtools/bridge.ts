/**
 * Bridge between a LiveStore `Store` + the consumer's TanStack DB
 * collections, and the {@link liveStoreDevtools} event client.
 *
 * Mount once inside the React tree, after `<StoreRegistryProvider>`. It
 *
 *   - Wraps `store.commit` to forward every optimistic local commit
 *     (with the event name + args) into the devtools panel BEFORE the
 *     event is confirmed.
 *   - Subscribes to `store.subscribeSyncStatus` for session-level sync
 *     state.
 *   - Subscribes to every TanStack DB collection registered via
 *     {@link registerCollection} for per-collection status changes.
 */
import { useEffect } from 'react'
import type { Store } from '@livestore/livestore'
import type { Collection } from '@tanstack/db'

import { liveStoreDevtools } from './eventClient.ts'

/**
 * Internal registry of TanStack DB collections registered with the
 * devtools bridge. Keyed by the model name (PascalCase, e.g. `'Todo'`).
 */
const registeredCollections = new Map<string, Collection<object, string>>()

/**
 * Register a TanStack DB collection with the devtools bridge. Call from
 * the per-table hook (e.g. `useTodoCollection`) so the bridge can
 * subscribe to its lifecycle events.
 */
export const registerCollection = (id: string, collection: Collection<object, string>): void => {
  registeredCollections.set(id, collection)
  liveStoreDevtools.emit('collection-registered', { collectionId: id })
}

/**
 * The bridge hook. Pass the LiveStore `Store` instance.
 */
export const useLiveStoreDevtoolsBridge = (store: Store<any> | null | undefined): void => {
  useEffect(() => {
    if (!store) return

    const originalCommit = store.commit.bind(store)
    const patchedCommit = (...args: unknown[]) => {
      for (const arg of args) {
        const events = Array.isArray(arg) ? arg : [arg]
        for (const ev of events) {
          if (typeof ev !== 'object' || ev === null) continue
          const e = ev as { name?: unknown; args?: unknown }
          if (typeof e.name !== 'string') continue
          liveStoreDevtools.emit('event-committed', {
            kind: 'local',
            seqNum: '(pending)',
            eventName: e.name,
            args: (e.args as Record<string, unknown> | undefined) ?? {},
          })
        }
      }
      return (originalCommit as (...a: unknown[]) => unknown)(...args)
    }
    ;(store as { commit: typeof store.commit }).commit = patchedCommit as typeof store.commit

    const unsubSync = store.subscribeSyncStatus((status) => {
      liveStoreDevtools.emit('sync-state-changed', {
        localHead: status.localHead,
        upstreamHead: status.upstreamHead,
        pendingCount: status.pendingCount,
        isSynced: status.isSynced,
      })
    })

    const unsubInitial = liveStoreDevtools.on('request-initial-state', () => {
      const status = store.syncStatus()
      liveStoreDevtools.emit('sync-state-changed', {
        localHead: status.localHead,
        upstreamHead: status.upstreamHead,
        pendingCount: status.pendingCount,
        isSynced: status.isSynced,
      })
      for (const [id, collection] of registeredCollections) {
        liveStoreDevtools.emit('collection-registered', { collectionId: id })
      }
    })

    const unsubCollections = new Map<string, () => void>()
    for (const [id, collection] of registeredCollections) {
      const unsub = collection.on('status:change', (event) => {
        liveStoreDevtools.emit('collection-status-changed', {
          collectionId: id,
          status: event.status,
          previousStatus: event.previousStatus,
        })
      })
      unsubCollections.set(id, unsub)
    }

    return () => {
      ;(store as { commit: typeof store.commit }).commit = originalCommit
      unsubSync()
      unsubInitial()
      for (const unsub of unsubCollections.values()) unsub()
    }
  }, [store])
}