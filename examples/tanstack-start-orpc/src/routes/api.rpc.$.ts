import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'
import { createFileRoute } from '@tanstack/react-router'

import { router } from '../lib/orpc.ts'

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
        console.log(`[oRPC server] ${request.method} ${new URL(request.url).pathname}`)
        const { response } = (await handler.handle(request, {
          prefix: '/api/rpc',
          // Forward the incoming request headers (cookies, auth, etc.)
          // so handlers can read them via `context.headers`. The
          // browser attaches `Cookie` automatically; SSR uses
          // `getRequestHeaders()` from `orpc-client.ts`.
          context: {
            headers: request.headers,
          },
        })) as { response?: Response }
        console.log(`[oRPC server] → ${response?.status ?? 'none'}`)
        return response ?? new Response('Not Found', { status: 404 })
      },
    },
  },
})