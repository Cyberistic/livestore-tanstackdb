import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'
import { createFileRoute } from '@tanstack/react-router'

import { router } from '../lib/orpc.ts'

/**
 * oRPC handler mounted at `/api/rpc/$` — TanStack Start's catch-all
 * server route. The `prefix: '/api/rpc'` tells the oRPC fetch handler
 * where to look for procedures in the URL path.
 *
 * This is the only server endpoint the SPA talks to for mutations; the
 * rest of the app's state flows through LiveStore's local-first log.
 */
const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error('[oRPC server] error:', error)
    }),
  ],
})

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        console.log(`[oRPC server] ${request.method} ${request.url}`)
        const { response } = await handler.handle(request, {
          prefix: '/api/rpc',
          context: {},
        })
        console.log(`[oRPC server] → ${response?.status ?? 'no response'}`)
        return response ?? new Response('Not Found', { status: 404 })
      },
    },
  },
})