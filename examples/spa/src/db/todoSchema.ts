import { Schema } from 'effect'

// Generated from `prisma/schema.prisma` — the single source of truth for
// both the D1 DDL and the LiveStore SQLite materialisers. The TodoSchema
// exported here is *literally* the same Schema instance the LiveStore
// `tables.Todo` definition uses, so the client-side row type can never
// drift from the server-side definition.
import { TodoSchema } from '../../prisma/generated/client-schemas/index.ts'

/**
 * Client-facing Todo type as exposed through the TanStack DB collection.
 *
 * Derive from the Prisma-generated `TodoSchema` rather than redeclaring
 * the fields by hand — adding a column to `prisma/schema.prisma` and
 * re-running `bun run db:generate` is enough to thread it through here.
 */
export type Todo = Schema.Schema.Type<typeof TodoSchema>

/** Raw row type emitted by LiveStore (same as the client-facing Todo). */
export type TodoRow = Todo