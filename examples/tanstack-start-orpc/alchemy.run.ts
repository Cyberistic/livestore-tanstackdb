import alchemy from "alchemy";
import { D1Database, DurableObjectNamespace, TanStackStart } from "alchemy/cloudflare";

const app = await alchemy("tanstack-start-orpc-example");

export const db = await D1Database("todos-db", {
  name: "todos-db",
  primaryLocationHint: "wnam",
  migrationsDir: "./prisma/migrations",
  migrationsTable: "d1_migrations",
});

export const syncBackend = await DurableObjectNamespace("sync-backend", {
  className: "SyncBackendDO",
  sqlite: true,
});

export const site = await TanStackStart("tanstack-start-orpc", {
  bindings: {
    DB: db,
    SYNC_BACKEND_DO: syncBackend,
  },
  compatibilityFlags: ["nodejs_compat"],
});

console.log(`Worker deployed at: ${site.url}`);

await app.finalize();
