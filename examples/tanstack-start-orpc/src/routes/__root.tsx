import 'todomvc-app-css/index.css'

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { LiveStoreProvider } from '@cyberistic/livestore-tanstack-db'

import { rpcPosts } from '../lib/orpc-client.ts'
import { events, schema, tables } from '../livestore/schema.ts'
import {
  storeRegistry,
  StoreRegistryProvider,
  useAppStore,
} from '../livestore/store.ts'

import type { RouterAppContext } from '../router.tsx'

void events

/**
 * SSR-safe LiveStore mount. LiveStore's web adapter needs
 * `navigator.locks` (browser-only) — we defer the entire
 * LiveStore-backed subtree to after first client render. The server
 * emits the HTML shell + loader-fetched oRPC data, then the client
 * takes over and mounts the provider.
 *
 * Tier 3.1 demo: once mounted, children use `useTable('Todo')` with no
 * options. The package's `useLiveStore()` reads `{ store, tables,
 * events, schema, oRPC }` from the provider below.
 */
function ClientOnlyLiveStore({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  if (!hydrated) {
    return <div data-ssr="pending">Hydrating…</div>
  }

  return <BoundProvider>{children}</BoundProvider>
}

function BoundProvider({ children }: { children: ReactNode }) {
  const store = useAppStore()
  if (!store) {
    return <div data-ssr="pending">Resolving store…</div>
  }

  const runtime = {
    store,
    tables,
    events,
    schema,
  } as unknown as Parameters<typeof LiveStoreProvider>[0]['schema']

  return (
    <LiveStoreProvider schema={runtime} oRPC={rpcPosts}>
      {children}
    </LiveStoreProvider>
  )
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: 'TodoMVC — TanStack Start + oRPC + LiveStore + TanStack DB' },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: 'https://unpkg.com/todomvc-app-css@2.4.3/index.css',
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <ClientOnlyLiveStore>{children}</ClientOnlyLiveStore>
        </StoreRegistryProvider>
        <Scripts />
      </body>
    </html>
  )
}