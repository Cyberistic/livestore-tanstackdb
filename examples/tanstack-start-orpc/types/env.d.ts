// Global Cloudflare Workers environment bindings for the TanStack Start app.
// `server.ts` imports its own more specific `Env` type; this global
// declaration satisfies wrangler / Miniflare tooling that expects a
// top-level `Env` interface.

interface Env {
  DB: D1Database;
  SYNC_BACKEND_DO: DurableObjectNamespace;
}

// Vite ?worker / ?sharedworker imports used by LiveStore's web adapter.
declare module "*?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module "*?sharedworker" {
  const SharedWorkerFactory: new () => SharedWorker;
  export default SharedWorkerFactory;
}
