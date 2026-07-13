import { useEffect, useState } from 'react'
import type { TanStackDevtoolsPluginProps } from '@tanstack/devtools'

import { devtoolsEmit, devtoolsOn } from './eventClient.ts'
import type { LiveStoreDevtoolsEvents } from './events.ts'

type CommittedEvent = LiveStoreDevtoolsEvents['event-committed']
type SyncChanged = LiveStoreDevtoolsEvents['sync-state-changed']
type CollectionStatusChanged = LiveStoreDevtoolsEvents['collection-status-changed']

const LOG_CAP = 500

// Reset helper: the devtools shell applies `width: 100%; height: 100%`
// to every descendant of the plugin container. We override on every
// child to let block content flow naturally inside the scroll area.
const reset: React.CSSProperties = {
  width: 'auto',
  height: 'auto',
  minWidth: 0,
  minHeight: 0,
  boxSizing: 'border-box',
}

const colors = {
  bg: '#1f1f1f',
  bgElevated: '#272727',
  border: '#3a3a3a',
  text: '#e5e5e5',
  textMuted: '#888',
  textDim: '#666',
  green: '#10b981',
  yellow: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  gray: '#9ca3af',
  purple: '#a78bfa',
  orange: '#f97316',
} as const

const containerStyle: React.CSSProperties = {
  flexGrow: 1,
  width: '100%',
  height: '100%',
  border: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: colors.bg,
  color: colors.text,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
}

const headerStyle: React.CSSProperties = {
  ...reset,
  flexShrink: 0,
  padding: '8px 12px',
  borderBottom: `1px solid ${colors.border}`,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: colors.bgElevated,
}

const scrollStyle: React.CSSProperties = {
  ...reset,
  flex: 1,
  overflow: 'auto',
  padding: 12,
}

const sectionStyle: React.CSSProperties = {
  ...reset,
  marginBottom: 12,
}

const sectionTitleStyle: React.CSSProperties = {
  ...reset,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  marginBottom: 6,
  color: colors.textMuted,
}

const cardStyle: React.CSSProperties = {
  ...reset,
  padding: '6px 8px',
  borderRadius: 4,
  background: colors.bgElevated,
  border: `1px solid ${colors.border}`,
  marginBottom: 6,
}

const rowStyle: React.CSSProperties = {
  ...reset,
  padding: '4px 8px',
  borderRadius: 3,
  background: colors.bgElevated,
  marginBottom: 2,
  fontSize: 11,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const pillStyle = (color: string): React.CSSProperties => ({
  ...reset,
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 600,
  color: colors.text,
  background: color,
  minWidth: 16,
  textAlign: 'center',
})

const inlineStyle: React.CSSProperties = {
  ...reset,
  display: 'inline',
}

export const LiveStoreDevtoolsPanel = (
  _props: TanStackDevtoolsPluginProps,
): React.ReactElement => {
  const [log, setLog] = useState<ReadonlyArray<CommittedEvent>>([])
  const [sync, setSync] = useState<SyncChanged | null>(null)
  const [collections, setCollections] = useState<
    Map<string, { status: CollectionStatusChanged['status'] }>
  >(new Map())

  useEffect(() => {
    const cleanups = [
      devtoolsOn('event-committed', (payload) => {
        setLog((prev) => [payload, ...prev].slice(0, LOG_CAP))
      }),
      devtoolsOn('sync-state-changed', (payload) => {
        setSync(payload)
      }),
      devtoolsOn('collection-registered', (payload) => {
        setCollections((prev) => {
          const next = new Map(prev)
          if (!next.has(payload.collectionId)) {
            next.set(payload.collectionId, { status: 'idle' })
          }
          return next
        })
      }),
      devtoolsOn('collection-status-changed', (payload) => {
        setCollections((prev) => {
          const next = new Map(prev)
          next.set(payload.collectionId, { status: payload.status })
          return next
        })
      }),
    ]
    devtoolsEmit('request-initial-state', undefined as any)
    return () => cleanups.forEach((c) => c())
  }, [])

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={pillStyle(colors.blue)}>LS</span>
        <h2 style={{ ...reset, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.text, margin: 0 }}>
          LiveStore ↔ TanStack DB
        </h2>
      </div>

      <div style={scrollStyle}>
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Session sync</div>
          <div style={cardStyle}>
            {sync ? (
              <div style={{ ...reset, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ ...reset, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={pillStyle(sync.isSynced ? colors.green : colors.yellow)}>
                    {sync.isSynced ? '✓ synced' : '⟳ syncing'}
                  </span>
                  <span style={{ ...inlineStyle, color: colors.textMuted }}>pending: {sync.pendingCount}</span>
                </div>
                <div style={{ ...reset, color: colors.textMuted, fontSize: 11 }}>
                  local: <code style={{ ...reset, color: colors.text }}>{sync.localHead}</code>
                  {' · '}
                  upstream: <code style={{ ...reset, color: colors.text }}>{sync.upstreamHead}</code>
                </div>
              </div>
            ) : (
              <span style={{ ...reset, color: colors.textDim }}>… waiting for first sync event</span>
            )}
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Collections</div>
          {collections.size === 0 ? (
            <div style={{ ...cardStyle, color: colors.textDim }}>
              (none registered)
            </div>
          ) : (
            Array.from(collections.entries()).map(([id, { status }]) => (
              <div key={id} style={rowStyle}>
                <code style={{ ...reset, color: colors.purple }}>{id}</code>
                <span style={{ ...reset, flex: 1 }} />
                <span style={pillStyle(statusColor(status))}>{status}</span>
              </div>
            ))
          )}
        </section>

        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>
            Local commit log{' '}
            <span style={{ ...reset, color: colors.textDim }}>(last {LOG_CAP})</span>
          </div>
          {log.length === 0 ? (
            <div style={{ ...cardStyle, color: colors.textDim }}>
              (no commits yet)
            </div>
          ) : (
            log.map((entry, i) => (
              <div key={i} style={rowStyle}>
                <span style={pillStyle(entry.kind === 'local' ? colors.orange : colors.green)}>
                  {entry.seqNum}
                </span>
                <span style={{ ...reset, color: colors.textMuted, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(entry.timestamp)}
                </span>
                <code style={{ ...reset, color: colors.text }}>{entry.eventName}</code>
                <span style={{ ...reset, flex: 1 }} />
                <span style={{ ...reset, color: colors.textMuted, fontSize: 10 }}>
                  {summariseArgs(entry.args)}
                </span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}

const statusColor = (status: CollectionStatusChanged['status']): string => {
  switch (status) {
    case 'ready':
      return colors.green
    case 'loading':
      return colors.yellow
    case 'error':
      return colors.red
    case 'idle':
      return colors.gray
    case 'cleaned-up':
      return colors.textDim
  }
}

const summariseArgs = (args: Record<string, unknown>): string => {
  try {
    const json = JSON.stringify(args)
    return json.length > 60 ? `${json.slice(0, 57)}…` : json
  } catch {
    return '(unserialisable)'
  }
}

const formatTime = (timestamp: number): string => {
  const d = new Date(timestamp)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`
}
