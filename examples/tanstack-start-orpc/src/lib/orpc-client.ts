import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { createRouterClient } from '@orpc/server'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { createORPCAdapter } from 'livestore-tanstack-db'

import { router } from './orpc.ts'

/**
 * Typed isomorphic oRPC client used by `useTable` / `useCrud` and direct
 * React Query calls.
 *
 * Server-side: uses `createRouterClient(router, ...)` for direct router
 * invocation with no HTTP loopback. `getRequestHeaders()` is forwarded as
 * initial context so procedures that need request headers can access them.
 * This matches the "Optimize SSR" pattern from the oRPC TanStack Start
 * adapter docs.
 *
 * Client-side: wraps the same `/api/rpc` route the server handler exposes.
 *
 * The resulting object's structure matches the contract:
 *   `orpc.posts.list()`, `orpc.posts.create({ text })`,
 *   `orpc.posts.complete({ id })`, `orpc.posts.delete({ id })`,
 *   `orpc.posts.bulkSeed({ rows })`.
 */
const getORPCClient = createIsomorphicFn()
  .server((): RouterClient<typeof router> => createRouterClient(router, {
    context: async () => ({
      headers: getRequestHeaders(),
    }),
  }))
  .client((): RouterClient<typeof router> => {
    const link = new RPCLink({
      url: `${window.location.origin}/api/rpc`,
      interceptors: [
        async (options) => {
          const path = options.path.join('/')
          console.log(`[oRPC client] → ${path}`, options.input)
          const start = performance.now()
          const result = await options.next()
          console.log(`[oRPC client] ← ${path} (${(performance.now() - start).toFixed(1)}ms)`)
          return result
        },
      ],
    })
    return createORPCClient(link)
  })

export const orpc: RouterClient<typeof router> = getORPCClient()

/**
 * `posts.*` namespace adapted into the `RpcClient` shape that
 * `livestore-tanstack-db` consumes. This avoids the
 * `as unknown as RpcClient` cast and validates that every leaf is a
 * callable oRPC procedure.
 */
export const rpcPosts = createORPCAdapter(orpc, { namespaces: ['posts'], router })
