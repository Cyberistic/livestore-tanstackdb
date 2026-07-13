import alchemy from "alchemy";
import { D1Database, DurableObjectNamespace, Vite } from "alchemy/cloudflare";

const app = await alchemy("spa-example");

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

export const site = await Vite("site", {
  name: "livestore-tanstack-db-spa",
  entrypoint: "./dist/spa_example_site/index.js",
  assets: "./dist/client",
  bindings: {
    DB: db,
    SYNC_BACKEND_DO: syncBackend,
  },

  compatibilityFlags: ["enable_request_signal", "nodejs_compat"],
  adopt: true,
});

console.log(`Worker deployed at: ${site.url}`);

await app.finalize();
