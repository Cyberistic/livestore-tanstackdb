/**
 * Type-level test for `toStandardSchemaV1`.
 *
 * The wrapped schema must satisfy TanStack DB's `CollectionConfig['schema']`
 * shape so it can be passed directly to `createCollection({ schema })`.
 * We assert the assignment without pulling in a new dep — the failure
 * mode is a compile error.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Schema } from '@livestore/livestore'

import { TodoSchema } from '../../prisma/generated/client-schemas/index.ts'
import { toStandardSchemaV1 } from './standardSchema.ts'

// Wrapping a generator-emitted schema must yield a `StandardSchemaV1`-
// compatible value.
const wrapped = toStandardSchemaV1(TodoSchema)

// Direct brand check: `wrapped` must be assignable to
// `StandardSchemaV1<unknown, Todo>`. A variance failure surfaces here.
const _brand: StandardSchemaV1<unknown, typeof TodoSchema.Type> = wrapped

// Round-trip check: the same wrapped schema must still be usable as
// an Effect Schema (decode/encode) — the `& Schema<...>` intersection
// keeps that ergonomics intact.
const _schema: Schema.Schema<typeof TodoSchema.Type, any, never> = wrapped

export const __wrappedTodoSchema = wrapped
export const __brand = _brand
export const __schema = _schema
