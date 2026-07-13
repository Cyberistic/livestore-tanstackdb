import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'

export type Env = SyncBackend.Env & {
  DB: CfTypes.D1Database
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace
}

let db: CfTypes.D1Database | undefined

const SyncBackendDOBase = SyncBackend.makeDurableObject({
  storage: { _tag: 'do-sqlite' },
  onPush: async (message, context) => {
    if (db === undefined) {
      throw new Error('D1 binding is unavailable')
    }

    const statement = db.prepare(
      'INSERT INTO events (store_id, name, args) VALUES (?1, ?2, ?3)',
    )
    const rows = message.batch.map((event) =>
      statement.bind(
        context.storeId,
        String(event.name),
        JSON.stringify(event.args),
      ),
    )

    if (rows.length > 0) {
      await db.batch(rows)
    }
  },
  onPull: async () => {},
})

export class SyncBackendDO extends SyncBackendDOBase {
  constructor(state: CfTypes.DurableObjectState, env: Env) {
    super(state, env)
    db = env.DB
  }
}
