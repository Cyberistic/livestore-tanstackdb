import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

import { SyncBackendDO, type Env } from './cf-worker/sync-do.ts'
import { SyncPayload } from './livestore/schema.ts'

const startFetch = createStartHandler(defaultStreamHandler)

const validatePayload = (payload: { authToken: string }) => {
  if (payload.authToken !== 'insecure-token-change-me') {
    throw new Error('Invalid auth token')
  }
}

export { SyncBackendDO }

export default {
  async fetch(
    request: CfTypes.Request,
    env: Env,
    ctx: CfTypes.ExecutionContext,
  ) {
    const searchParams = SyncBackend.matchSyncRequest(request)

    if (searchParams !== undefined) {
      return SyncBackend.handleSyncRequest({
        request,
        searchParams,
        env,
        ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
        syncPayloadSchema: SyncPayload,
        validatePayload,
      })
    }

    return startFetch(request as unknown as Request)
  },
}
