import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { createIsomorphicFn } from '@tanstack/react-start'

import { router } from './orpc.ts'
import { orpcServer } from './orpc-client.server.ts'

import type { RpcClient } from '@cyberistic/livestore-tanstack-db'

/**
 * Typed oRPC client used by `useTable` / `useCrud` and direct React
 * Query calls.
 *
 * Server-side: `orpc-client.server.ts` exposes a direct router call
 * (no HTTP loopback). The actual `.server` import is hidden inside
 * that file so the import-protection plugin doesn't break the client
 * bundle.
 * Client-side: wraps the same `/api/rpc` route the server handler
 * exposes.
 *
 * The resulting object's structure matches the contract:
 *   `orpc.posts.list()`, `orpc.posts.create({ text })`,
 *   `orpc.posts.complete({ id })`, `orpc.posts.delete({ id })`,
 *   `orpc.posts.bulkSeed({ rows })`.
 */
const getORPCClient = createIsomorphicFn()
  .server((): RouterClient<typeof router> => orpcServer)
  .client((): RouterClient<typeof router> => {
    const link = new RPCLink({
      url: `${window.location.origin}/api/rpc`,
    })
    return createORPCClient(link)
  })

export const orpc: RouterClient<typeof router> = getORPCClient()

/**
 * `posts.*` namespace cast to the loose `RpcClient` shape that
 * `@cyberistic/livestore-tanstack-db` consumes (the package's
 * `RpcClient` is `Record<string, Record<string, Procedure | undefined>>`
 * — intentionally permissive so any nested callable object works).
 */
export const rpcPosts: RpcClient = orpc.posts as unknown as RpcClient