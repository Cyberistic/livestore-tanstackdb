import alchemy from 'alchemy'
import { D1Database, DurableObjectNamespace, Vite } from 'alchemy/cloudflare'

const app = await alchemy('tanstack-start-orpc-example')

export const db = await D1Database('todos-db', {
  name: 'todos-db',
  primaryLocationHint: 'wnam',
  migrationsDir: './prisma/migrations',
  migrationsTable: 'd1_migrations',
})

export const syncBackend = await DurableObjectNamespace('sync-backend', {
  className: 'SyncBackendDO',
  sqlite: true,
})

export const site = await Vite('site', {
  name: 'tanstack-start-orpc-site',
  entrypoint: './dist/server/server.js',
  assets: './dist/client',
  bindings: {
    DB: db,
    SYNC_BACKEND_DO: syncBackend,
  },
  compatibilityDate: '2025-05-08',
  compatibilityFlags: ['enable_request_signal', 'nodejs_compat'],
  adopt: true,
})

console.log(`Worker deployed at: ${site.url}`)

await app.finalize()
