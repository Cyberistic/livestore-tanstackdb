/**
 * Single source of truth for the Todo row type. Re-exports the
 * Prisma-derived `TodoRow` generated alongside the LiveStore config so
 * consumers get the exact same row type that `tables.Todo` materializes.
 */
export type { TodoRow } from "../../prisma/generated/livestore/index.ts";
