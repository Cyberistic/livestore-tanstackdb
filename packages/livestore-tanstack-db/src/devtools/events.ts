/**
 * The typed event map for the LiveStore ↔ TanStack DB devtools panel.
 *
 * Event suffix → payload. The {@link EventClient} prefixes every emit
 * with the `pluginId` (`'livestore-tanstack-db'`), so consumers of the
 * panel see names like `livestore-tanstack-db:event-committed` on the
 * global event bus.
 */
export type LiveStoreDevtoolsEvents = {
  /** A LiveStore event was committed (local optimistic OR remote confirmed). */
  'event-committed': {
    kind: 'local' | 'remote'
    seqNum: string
    timestamp: number
    eventName: string
    args: Record<string, unknown>
  }

  /** A LiveStore session-level sync status changed. */
  'sync-state-changed': {
    localHead: string
    upstreamHead: string
    pendingCount: number
    isSynced: boolean
  }

  /** A TanStack DB collection's sync status changed. */
  'collection-status-changed': {
    collectionId: string
    status: 'idle' | 'loading' | 'ready' | 'error' | 'cleaned-up'
    previousStatus: 'idle' | 'loading' | 'ready' | 'error' | 'cleaned-up' | null
  }

  /** A new collection was registered with the devtools bridge. */
  'collection-registered': {
    collectionId: string
  }

  /** Panel asks the bridge for a full snapshot on mount. */
  'request-initial-state': void
}