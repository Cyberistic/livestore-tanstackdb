/**
 * The devtools panel — a React component that subscribes to the
 * {@link liveStoreDevtools} event client and renders three sections:
 *
 *   1. Session sync status (localHead / upstreamHead / pendingCount).
 *   2. Per-collection TanStack DB status (`idle / loading / ready / error`).
 *   3. The local commit log (newest first, capped at 500 entries).
 */
import { useEffect, useState } from 'react'

import { liveStoreDevtools } from './eventClient.ts'
import type { LiveStoreDevtoolsEvents } from './events.ts'

type CommittedEvent = LiveStoreDevtoolsEvents['event-committed']
type SyncChanged = LiveStoreDevtoolsEvents['sync-state-changed']
type CollectionStatusChanged = LiveStoreDevtoolsEvents['collection-status-changed']

const LOG_CAP = 500

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  margin: '12px 0 4px',
  color: '#888',
}

const row: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  padding: '2px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
}

export const LiveStoreDevtoolsPanel = (): React.ReactElement => {
  const [log, setLog] = useState<ReadonlyArray<CommittedEvent>>([])
  const [sync, setSync] = useState<SyncChanged | null>(null)
  const [collections, setCollections] = useState<
    Map<string, { status: CollectionStatusChanged['status'] }>
  >(new Map())

  useEffect(() => {
    const cleanups = [
      liveStoreDevtools.on('event-committed', (event) => {
        setLog((prev) => [event.payload, ...prev].slice(0, LOG_CAP))
      }),
      liveStoreDevtools.on('sync-state-changed', (event) => {
        setSync(event.payload)
      }),
      liveStoreDevtools.on('collection-status-changed', (event) => {
        setCollections((prev) => {
          const next = new Map(prev)
          next.set(event.payload.collectionId, { status: event.payload.status })
          return next
        })
      }),
    ]
    liveStoreDevtools.emit('request-initial-state', undefined)
    return () => cleanups.forEach((c) => c())
  }, [])

  return (
    <div
      style={{
        padding: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#ddd',
        background: '#1a1a1a',
        minHeight: '100%',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, color: '#fff' }}>LiveStore ↔ TanStack DB</h2>

      <section>
        <div style={sectionTitle}>Session sync</div>
        <div style={row}>
          {sync
            ? `local=${sync.localHead} · upstream=${sync.upstreamHead} · pending=${sync.pendingCount} · ${sync.isSynced ? '✓ synced' : '⟳ syncing'}`
            : '… (waiting for first sync event)'}
        </div>
      </section>

      <section>
        <div style={sectionTitle}>Collections</div>
        {collections.size === 0 ? (
          <div style={{ ...row, color: '#666' }}>(none registered)</div>
        ) : (
          Array.from(collections.entries()).map(([id, { status }]) => (
            <div key={id} style={row}>
              <code style={{ color: '#a3a3ff' }}>{id}</code>
              <span style={{ marginLeft: 8, color: statusColor(status) }}>● {status}</span>
            </div>
          ))
        )}
      </section>

      <section>
        <div style={sectionTitle}>Local commit log (last {LOG_CAP})</div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {log.map((entry, i) => (
            <div key={i} style={row}>
              <span
                style={{
                  color: entry.kind === 'local' ? '#f59e0b' : '#10b981',
                  fontWeight: 600,
                  marginRight: 6,
                }}
              >
                {entry.kind === 'local' ? '●' : '○'}
              </span>
              <code style={{ color: '#9ca3af' }}>{entry.seqNum}</code>
              <span style={{ margin: '0 6px', color: '#666' }}>·</span>
              <code style={{ color: '#fff' }}>{entry.eventName}</code>
              <span style={{ marginLeft: 8, color: '#9ca3af' }}>
                {summariseArgs(entry.args)}
              </span>
            </div>
          ))}
          {log.length === 0 && (
            <div style={{ ...row, color: '#666' }}>(no commits yet)</div>
          )}
        </div>
      </section>
    </div>
  )
}

const statusColor = (status: CollectionStatusChanged['status']): string => {
  switch (status) {
    case 'ready':
      return '#10b981'
    case 'loading':
      return '#f59e0b'
    case 'error':
      return '#ef4444'
    case 'idle':
      return '#9ca3af'
    case 'cleaned-up':
      return '#6b7280'
  }
}

const summariseArgs = (args: Record<string, unknown>): string => {
  try {
    const json = JSON.stringify(args)
    return json.length > 80 ? `${json.slice(0, 77)}…` : json
  } catch {
    return '(unserialisable)'
  }
}