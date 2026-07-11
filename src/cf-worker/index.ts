import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'

import { SyncPayload } from '../livestore/schema.ts'

export type Env = SyncBackend.Env & {
  DB: D1Database
  /** Alchemy injects this automatically when `assets` is set on the Worker. */
  ASSETS: Fetcher
}

const SyncBackendDOBase = SyncBackend.makeDurableObject({
  onPush: async (message, context) => {
    // The `env` is captured by the wrapper class below and exposed as
    // `(globalThis as any).__syncBackendEnv` because the `CallbackContext`
    // type doesn't carry `env`. We prefer that over threading a closure
    // through every callback.
    const env = (globalThis as { __syncBackendEnv?: Env }).__syncBackendEnv
    if (!env?.DB) return

    const stmt = env.DB.prepare(
      'INSERT INTO events (store_id, name, args) VALUES (?1, ?2, ?3)',
    )

    const batch = message.batch
    const rows: D1PreparedStatement[] = []
    for (const event of batch) {
      rows.push(
        stmt.bind(
          context.storeId,
          String(event.name ?? ''),
          JSON.stringify(event.args ?? {}),
        ),
      )
    }
    if (rows.length > 0) {
      await env.DB.batch(rows)
    }
  },
  onPull: async (_message, _context) => {
    // Default DO-backed pull path serves connected clients from the
    // Durable Object's own SQLite. D1 is the durable mirror.
  },
})

/**
 * Wraps the LiveStore sync DO so that the `env` (and therefore the D1
 * binding) is available inside the `onPush` callback.
 *
 * The Cloudflare Workers runtime gives each Durable Object instance a
 * single env object; we capture it on first construction and stash it
 * on `globalThis` so the module-level `onPush` closure can read it.
 */
export class SyncBackendDO extends SyncBackendDOBase {
  constructor(state: CfTypes.DurableObjectState, env: Env) {
    super(state, env)
    ;(globalThis as { __syncBackendEnv?: Env }).__syncBackendEnv = env
  }
}

const validatePayload = (
  payload: { authToken: string } | undefined,
  context: { storeId: string },
) => {
  console.log(`Validating connection for store: ${context.storeId}`)
  if (payload?.authToken !== 'insecure-token-change-me') {
    throw new Error('Invalid auth token')
  }
}

export default {
  async fetch(request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) {
    // LiveStore sync traffic goes to the durable object.
    const searchParams = SyncBackend.matchSyncRequest(request)
    if (searchParams !== undefined) {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
        syncPayloadSchema: SyncPayload,
        validatePayload,
      })
    }

    // Everything else falls through to the SPA static assets. The
    // ASSETS binding is injected by Alchemy when `assets` is set on
    // the Worker resource.
    const response = await env.ASSETS.fetch(request as unknown as Request)
    if (response.status !== 404) return response as unknown as CfTypes.Response

    return new Response('Not Found', { status: 404 })
  },
}