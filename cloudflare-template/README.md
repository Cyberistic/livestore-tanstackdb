# Cloudflare Worker + D1 + DO template for LiveStore SPAs

Drop-in Cloudflare deploy glue for a LiveStore + TanStack DB SPA. One
Worker hosts both the static SPA and the `@livestore/sync-cf` sync
WebSocket. Events are mirrored into a Cloudflare D1 database for
audit / replay / analytics. A Durable Object namespace backs the sync
backend.

This template is meant to be **copied into a project that already has**:

- A working `prisma/schema.prisma` (the sync backend's `onPush` writes
  to a table *you* define in that schema — see *Adapting the worker
  entry* below)
- A `src/cf-worker/index.ts` worker entry that wraps
  `@livestore/sync-cf/cf-worker`
- A `package.json` with `deploy`, `db:generate`, `db:migrate` scripts
- A `vite.config.ts` using `@cloudflare/vite-plugin`

## Files

| File | Purpose |
|------|---------|
| `alchemy.run.ts.template`  | Handlebars-substituted alchemy stack — run `sed` to render |
| `wrangler.toml.template`   | Handlebars-substituted wrangler config — run `sed` to render |
| `scripts/deploy.sh`        | One-shot deploy: install → generate → migrate → deploy |

## Placeholders

Both `*.template` files use the same placeholders:

| Placeholder             | Used in                              | Default suggestion            |
|-------------------------|--------------------------------------|------------------------------|
| `{{AppName}}`           | alchemy app name + D1 + DO IDs       | `myapp`                      |
| `{{WorkerName}}`        | worker name + bundle directory       | `${AppName}_site` (see note) |
| `{{DbName}}`            | D1 database name + binding label     | `${AppName}-db`              |
| `{{DomainPrefix}}`      | D1 `primaryLocationHint`             | `wnam`                       |
| `{{SchemaImportsPath}}` | Path to the prisma-generated schemas | `../prisma/generated/client-schemas/index.ts` |

> **Worker name hyphen gotcha.** The `@cloudflare/vite-plugin` emits
> the build bundle directory as `./dist/<worker-name>/`, replacing
> `-` with `_` in `worker-name`. To keep `alchemy.run.ts`'s
> `entrypoint: "./dist/{{WorkerName}}/index.js"` aligned with the
> build output, `{{WorkerName}}` must contain **no hyphens**. We
> recommend `${AppName}_site`. If you need a hyphenated worker name
> (e.g. `myapp-site`), add a second `sed` pass that rewrites the
> `entrypoint` path to `./dist/myapp_site/index.js` separately.

## Usage

```bash
APP=myapp

# Render alchemy.run.ts
sed -e "s/{{AppName}}/$APP/g" \
    -e "s/{{WorkerName}}/${APP}_site/g" \
    -e "s/{{DbName}}/${APP}-db/g" \
    -e "s/{{DomainPrefix}}/wnam/g" \
    -e "s|{{SchemaImportsPath}}|../prisma/generated/client-schemas/index.ts|g" \
    alchemy.run.ts.template > alchemy.run.ts

# Render wrangler.toml
sed -e "s/{{WorkerName}}/${APP}_site/g" \
    wrangler.toml.template > wrangler.toml

# Deploy
bash scripts/deploy.sh
```

## Prerequisites

- **Bun** >= 1.x
- A **Cloudflare account** (free tier works; D1 + DO are both included)
- A Cloudflare account / API token that Alchemy can use. Run once:
  ```bash
  bunx alchemy login
  ```
  Note: `--skip` is **not** a real flag. If you are already logged in
  you can simply skip the step; the credentials are cached.

## Pinned versions

This template is known-good against:

| Package                     | Version  |
|-----------------------------|----------|
| `alchemy`                   | `0.93.x` |
| `@livestore/*`              | `0.4.0`  |
| `@cloudflare/vite-plugin`   | `1.13.x` |
| `wrangler`                  | `4.42.x` |
| `prisma` / `@prisma/client` | `7.8.x`  |

alchemy v2 (`alchemy@next`) is **not** supported — its transitive
`@effect/*@0.x` tree collides with `@livestore/utils` (see the
comment in `alchemy.run.ts`).

## Adapting `src/cf-worker/index.ts`

The template assumes a worker entry shaped like:

```ts
import type { CfTypes } from '@livestore/sync-cf/cf-worker'
import * as SyncBackend from '@livestore/sync-cf/cf-worker'

export type Env = SyncBackend.Env & {
  DB: D1Database        // bound by alchemy as `DB`
  ASSETS: Fetcher       // injected by alchemy when `assets` is set
}

export class SyncBackendDO extends SyncBackend.makeDurableObject({
  onPush: async (message, ctx, env) => {
    // write env.DB rows — e.g. `events (store_id, name, args)`
  },
}) { /* ... */ }

export default {
  async fetch(request: CfTypes.Request, env: Env, ctx: CfTypes.ExecutionContext) {
    // 1. LiveStore sync traffic → DO
    const sp = SyncBackend.matchSyncRequest(request)
    if (sp !== undefined) {
      return SyncBackend.handleSyncRequest({
        request, searchParams: sp, ctx,
        syncBackendBinding: 'SYNC_BACKEND_DO',
        syncPayloadSchema: <your Schema>,
        validatePayload: (payload, ctx) => { /* throw on bad auth */ },
      })
    }

    // 2. SPA fallback — env.ASSETS is the `assets` binding from alchemy.
    if (env.ASSETS) {
      const r = await env.ASSETS.fetch(request as unknown as Request)
      if (r.status !== 404) return r as unknown as CfTypes.Response
    }
    return new Response('Not Found', { status: 404 })
  },
}
```

### Bindings

| Binding          | Type                    | Where it comes from                                                                 |
|------------------|-------------------------|-------------------------------------------------------------------------------------|
| `SYNC_BACKEND_DO`| `DurableObjectNamespace`| `alchemy.run.ts` → `DurableObjectNamespace("sync-backend", { className: "SyncBackendDO", sqlite: true })` |
| `DB`             | `D1Database`            | `alchemy.run.ts` → `D1Database("{{DbName}}", ...)`                                   |
| `ASSETS`         | `Fetcher`               | Alchemy auto-injects when `assets: "./dist/client"` is set on the `Vite` resource   |

### `env.DB` — the audit log

`env.DB` is the **durable event mirror**. The Durable Object's own
SQLite is the source of truth; `env.DB` (D1) is a queryable, durable
replica that lives across DO evictions and is suitable for replay,
analytics, or region rebuilds. Write to it from the DO's `onPush`
callback (see example above).

### `env.ASSETS` — the SPA fallback

`env.ASSETS` is the static-asset `Fetcher` that Alchemy provisions
when `assets: "./dist/client"` is set on the `Vite` resource. Always
guard for its presence — it is **undefined** under `bun run dev`
(`@cloudflare/vite-plugin` serves the SPA itself in that mode). The
expected fallback chain is:

1. `matchSyncRequest(request)` — WebSocket upgrade for LiveStore → DO
2. `env.ASSETS.fetch(request)` — static SPA (`dist/client`)
3. `new Response('Not Found', { status: 404 })`

### `wrangler.toml` vs `alchemy.run.ts`

The `wrangler.toml` only needs the `[[durable_objects.bindings]]`
declaration so that the **local** worker (run by
`@cloudflare/vite-plugin` under `bun run dev`) knows about the DO
class. The `DB` and `SYNC_BACKEND_DO` bindings you set in
`alchemy.run.ts` are baked into the deployed `wrangler.json` at
deploy time — they are **not** read from `wrangler.toml` in
production.