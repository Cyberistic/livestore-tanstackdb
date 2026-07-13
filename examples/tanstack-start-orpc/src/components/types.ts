import { Schema } from 'effect'

import { TodoSchema } from '../../prisma/generated/client-schemas/index.ts'

/**
 * Single source of truth for the Todo row type. Re-exports the
 * Prisma-derived `TodoSchema` so consumers get the exact same row type
 * that `tables.Todo` materializes.
 */
export type TodoRow = Schema.Schema.Type<typeof TodoSchema>