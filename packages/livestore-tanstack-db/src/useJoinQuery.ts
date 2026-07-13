import type { Collection } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import type { LiveStoreRow } from './liveStoreCollection.ts'
import { useLiveStoreConfig } from './LiveStoreProvider.tsx'
import { getCollection, type TableName, type UseTableOptions } from './useTable.ts'

// ─── Internal helper ───────────────────────────────────────────────

/**
 * Resolve a LiveStore runtime from the React context. Same logic as
 * `useLiveStore()` inside `useTable.ts` but inlined here to avoid
 * depending on an unexported symbol.
 */
const useLiveStoreRuntime = () => {
  const config = useLiveStoreConfig()
  if (!config) return null
  return {
    ...(config.schema as unknown as {
      store: any
      tables: Record<string, any>
      events: Record<string, any>
      schema: unknown
    }),
    oRPC: config.oRPC,
  }
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Tier 4.4 — cross-collection reactive joins.
 *
 * Resolves LiveStore-backed Collections by table name and runs a
 * TanStack DB join query. Combines `useTable(name)` resolution with
 * `useLiveQuery(q => q.from(...).join(...))` execution so consumers
 * don't have to thread collection instances through every call site.
 *
 * Every collection in `spec` is resolved from the same
 * `<LiveStoreProvider>` context, so joins across any number of tables
 * stay reactive — when any underlying LiveStore table changes, the
 * joined result re-computes automatically.
 *
 * @param spec   An object mapping aliases → LiveStore table names.
 *               The aliases are used as keys in `q.from()` / `.join()`.
 * @param queryFn  Receives the TanStack DB `Query` builder and an
 *               object of resolved Collections keyed by alias.
 * @param deps  Optional extra deps for the `useLiveQuery` re-run.
 *
 * @example
 * ```tsx
 * import { useJoinQuery, eq } from 'livestore-tanstack-db'
 *
 * const { data, isLoading } = useJoinQuery(
 *   { user: 'User', post: 'Post' },
 *   (q, { user, post }) =>
 *     q.from({ user })
 *      .join({ post }, ({ user, post }) => eq(user.id, post.userId))
 *      .where(({ user }) => eq(user.active, true))
 *      .select(({ user, post }) => ({
 *        userName: user.name,
 *        postTitle: post.title,
 *      })),
 * )
 * ```
 */
export const useJoinQuery = <
  TSpec extends Record<string, TableName>,
  TQueryFn extends (
    q: any,
    collections: { [K in keyof TSpec]: Collection<LiveStoreRow, string> },
  ) => any,
>(
  spec: TSpec,
  queryFn: TQueryFn,
  deps?: ReadonlyArray<unknown>,
) => {
  const liveStore = useLiveStoreRuntime()
  if (!liveStore) {
    throw new Error(
      'useJoinQuery: no <LiveStoreProvider> in scope. ' +
        'Wrap your component tree with <LiveStoreProvider schema={...}>.',
    )
  }

  const aliases = Object.keys(spec) as Array<keyof TSpec>
  const tableNames = aliases.map((a) => spec[a]) as TableName[]

  // Resolve all collections. `getCollection` is sync and cached, so
  // this is safe inside a hook — no new allocations after the first render.
  const collections = useMemo(() => {
    const result: Record<string, Collection<LiveStoreRow, string>> = {}
    for (const alias of aliases) {
      const tableName = spec[alias]
      result[alias as string] = getCollection(tableName, { liveStore } as any)
    }
    return result as { [K in keyof TSpec]: Collection<LiveStoreRow, string> }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStore, ...tableNames])

  // Build the query callback. `useLiveQuery` re-evaluates when deps
  // change, so we include all collection references + caller deps.
  const query = useMemo(() => {
    return (q: any) => queryFn(q, collections)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections, ...((deps as unknown[]) ?? [])])

  return useLiveQuery(query, [query, ...((deps as unknown[]) ?? [])])
}
