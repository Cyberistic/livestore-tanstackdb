import 'todomvc-app-css/index.css'

import { TanStackDevtools } from '@tanstack/react-devtools'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { LiveStoreProvider } from "livestore-tanstack-db"
import {
  LiveStoreDevtoolsBridge,
  liveStoreDevtoolsPlugin,
  rpcConfig,
} from 'livestore-tanstack-db/devtools'

import { rpcPosts } from '../lib/orpc-client.ts'
import { events, schema, tables } from '../livestore/schema.ts'
import {
  storeRegistry,
  StoreRegistryProvider,
  useAppStore,
} from '../livestore/store.ts'

import type { RouterAppContext } from '../router.tsx'

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

  // `LiveStoreProvider.schema` accepts the full `createLiveStoreDb`
  // shape — no `as unknown as` cast needed.
  const runtime = { store, tables, events, schema }

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

/**
 * Tier 2.7: drop-in devtools bridge. `useTable('Todo')` auto-registers
 * the collection internally, so the bridge doesn't need any props
 * beyond the store. Just mount once.
 */
function DevtoolsMount() {
  const store = useAppStore()
  return (
    <>
      <LiveStoreDevtoolsBridge store={store} />
      <TanStackDevtools plugins={[liveStoreDevtoolsPlugin()]} />
    </>
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
          <ClientOnlyLiveStore>
            {children}
            <DevtoolsMount />
          </ClientOnlyLiveStore>
        </StoreRegistryProvider>
        <Scripts />
      </body>
    </html>
  )
}