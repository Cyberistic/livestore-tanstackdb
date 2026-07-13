import { createRouterClient, type RouterClient } from '@orpc/server'

import { router } from './orpc.ts'

/**
 * Server-side oRPC client. Direct router invocation — no HTTP loopback.
 *
 * Lives in `*.server.ts` so the TanStack Start import-protection plugin
 * keeps it out of client bundles. The companion `.ts` file wraps this
 * for the client side.
 *
 * Uses `createRouterClient(router, ...)` from `@orpc/server` so each
 * procedure is invoked like a plain function: `client.posts.list()`,
 * `client.posts.create({ text })`, etc.
 */
export const orpcServer: RouterClient<typeof router> = createRouterClient(
  router,
  {
    context: () => ({}),
  },
)