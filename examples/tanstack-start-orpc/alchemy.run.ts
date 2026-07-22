import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export const db = Cloudflare.D1.Database("todos-db", {
  name: "todos-db",
  primaryLocationHint: "wnam",
  migrationsDir: "./prisma/migrations",
  migrationsTable: "d1_migrations",
});

export const syncBackend = Cloudflare.DurableObject("sync-backend", {
  className: "SyncBackendDO",
});

export class Site extends Cloudflare.Website.Vite<Site>()("Site", {
  name: "tanstack-start-orpc",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    DB: db,
    SYNC_BACKEND_DO: syncBackend,
  },
}) { }

export type SiteEnv = Cloudflare.InferEnv<typeof Site>;

export default Alchemy.Stack(
  "TanstackStartOprcExample",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const site = yield* Site;
    return { url: site.url.as<string>() };
  }),
);
