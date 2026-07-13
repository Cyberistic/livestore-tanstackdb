/**
 * The devtools event client. Singleton — both the bridge hook and the
 * React panel import this instance and talk to each other over the
 * TanStack Devtools event bus.
 *
 * In production (`process.env.NODE_ENV !== 'development'`) the
 * `EventClient` import folds to a no-op and the bridge hook never
 * emits, so this module is effectively free in prod bundles.
 */
import { EventClient } from '@tanstack/devtools-event-client'

import type { LiveStoreDevtoolsEvents } from './events.ts'

class LiveStoreDevtoolsClient extends EventClient<LiveStoreDevtoolsEvents> {
  constructor() {
    super({ pluginId: 'livestore-tanstack-db' })
  }
}

export const liveStoreDevtools = new LiveStoreDevtoolsClient()