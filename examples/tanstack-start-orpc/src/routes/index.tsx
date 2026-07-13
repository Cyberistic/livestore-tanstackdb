import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { useCrud, useTable } from '@cyberistic/livestore-tanstack-db'

import { Footer } from '../components/Footer.tsx'
import { Header } from '../components/Header.tsx'
import { MainSection } from '../components/MainSection.tsx'

import { orpc, rpcPosts } from '../lib/orpc-client.ts'
import { rpcConfig } from '../livestore/schema.ts'

/**
 * SSR loader — runs on the server before render. Uses the server-side
 * oRPC client (`createRouterClient` direct call, no HTTP loopback) so
 * the first paint can show the initial list. LiveStore hydrates from
 * the same data on the client.
 */
const initialPostsQuery = () => orpc.posts.list()

export const Route = createFileRoute('/')({
  loader: async () => ({
    initialPosts: await initialPostsQuery(),
  }),
  component: Home,
  pendingComponent: () => <div>Loading…</div>,
  errorComponent: ({ error }) => <div>Error: {String(error)}</div>,
})

function Home() {
  return <ClientOnlyTodoApp />
}

/**
 * Client-only wrapper: avoids running `useAppStore()` /
 * `useTable('Todo')` during SSR (those need `navigator.locks`). On
 * the server the route renders an HTML shell from the loader's data,
 * then the client mounts the interactive tree.
 */
function ClientOnlyTodoApp() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  if (!hydrated) {
    return (
      <section className="todoapp" data-ssr="pending">
        <p>Hydrating LiveStore…</p>
      </section>
    )
  }

  return <TodoApp />
}

function TodoApp() {
  // Tier 3.1 — `useTable('Todo')` with no `liveStore` option. The
  // package's `useLiveStore()` resolves the runtime (store, tables,
  // events, schema) from `<LiveStoreProvider>` further up.
  // Tier 0.6 — `rpc.config` is read by `createMutations` to classify
  // each procedure and wire commit handlers that round-trip to oRPC.
  const { collection: todosCollection } = useTable('Todo', {
    rpc: { client: rpcPosts, config: rpcConfig },
  })

  const [, { bulkUpsert }] = useCrud('Todo', {
    rpc: { client: rpcPosts, config: rpcConfig },
  })

  const router = useRouter()

  const handleBulkSeed = useCallback(async () => {
    // Demo a server-roundtrip: `bulkUpsert` locally emits a single
    // `v1.TodoBulkUpserted` event AND fires `orpc.posts.bulkSeed` so
    // the server sees the same payload.
    bulkUpsert([
      { text: 'Local row A' },
      { text: 'Local row B' },
      { text: 'Local row C' },
    ] as never)
    await router.invalidate()
  }, [bulkUpsert, router])

  return (
    <section className="todoapp">
      <Header />
      <button type="button" onClick={handleBulkSeed} style={{ marginLeft: 8 }}>
        Bulk seed 3 via useCrud
      </button>
      <span style={{ marginLeft: 8 }}>(rows: {todosCollection.size})</span>
      <MainSection />
      <Footer />
    </section>
  )
}