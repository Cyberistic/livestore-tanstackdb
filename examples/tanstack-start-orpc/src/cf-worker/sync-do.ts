import type { CfTypes } from "@livestore/sync-cf/cf-worker";
import * as SyncBackend from "@livestore/sync-cf/cf-worker";

export type Env = SyncBackend.Env & {
  DB: CfTypes.D1Database;
  SYNC_BACKEND_DO: CfTypes.DurableObjectNamespace;
};

let db: CfTypes.D1Database | undefined;

const SyncBackendDOBase = SyncBackend.makeDurableObject({
  storage: { _tag: "do-sqlite" },
  // Forward `Cookie` and `Authorization` from the WebSocket / HTTP sync
  // request into the `onPush` / `onPull` callbacks so they can validate
  // the session before accepting events. This is the LiveStore
  // cookie-based auth pattern (see `docs.livestore.dev/patterns/auth`).
  // Drop this list once every client ships a real `authToken` in
  // `syncPayload` — today both clients send the same hard-coded
  // placeholder so cookies aren't strictly required.
  forwardHeaders: ["Cookie", "Authorization"],
  onPush: async (message, context) => {
    if (db === undefined) {
      throw new Error("D1 binding is unavailable");
    }

    const statement = db.prepare("INSERT INTO events (store_id, name, args) VALUES (?1, ?2, ?3)");
    const rows = message.batch.map((event: { name: unknown; args: unknown }) =>
      statement.bind(context.storeId, String(event.name), JSON.stringify(event.args)),
    );

    if (rows.length > 0) {
      await db.batch(rows);
    }
  },
  onPull: async () => {},
});

export class SyncBackendDO extends SyncBackendDOBase {
  constructor(state: CfTypes.DurableObjectState, env: Env) {
    super(state, env);
    db = env.DB;
  }
}
