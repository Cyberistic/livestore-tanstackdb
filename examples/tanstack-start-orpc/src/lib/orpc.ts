import { implement } from '@orpc/server'
import type { InferContractRouterOutputs } from '@orpc/contract'

import { contract } from './contract.ts'

/**
 * Server-side implementation of the `posts.*` contract.
 *
 * The handler is intentionally a thin in-memory store — this example's
 * job is to demonstrate the LiveStore ↔ oRPC round-trip, not to be a
 * production CRUD. Real apps swap the `db` map for Prisma + D1 / SQLite
 * / Postgres. Each handler `console.log`s so dev sessions show the
 * write-back traffic.
 */

export type PostsOutputs = InferContractRouterOutputs<typeof contract.posts>
type CreateOutput = PostsOutputs['create']
type TodoRow = CreateOutput extends { row: infer R } ? R : never

const db: {
  rows: Map<string, TodoRow>
} = {
  rows: new Map<string, TodoRow>(),
}

const os = implement(contract)

const findOrThrow = (id: string): TodoRow => {
  const row = db.rows.get(id)
  if (!row) throw new Error(`post not found: ${id}`)
  return row
}

export const listPosts = os.posts.list.handler(() => {
  return { rows: Array.from(db.rows.values()) }
})

export const createPost = os.posts.create.handler(({ input }) => {
  const id = crypto.randomUUID()
  const row: TodoRow = {
    id,
    text: input.text,
    completed: false,
    deletedAt: null,
  }
  db.rows.set(id, row)
  console.log(`[oRPC] posts.create → ${id} ("${input.text}")`)
  return { row }
})

export const completePost = os.posts.complete.handler(({ input }) => {
  const row = findOrThrow(input.id)
  row.completed = !row.completed
  console.log(`[oRPC] posts.complete → ${input.id} = ${row.completed}`)
  return { id: row.id, completed: row.completed }
})

export const deletePost = os.posts.delete.handler(({ input }) => {
  db.rows.delete(input.id)
  console.log(`[oRPC] posts.delete → ${input.id}`)
  return { id: input.id }
})

export const bulkSeedPosts = os.posts.bulkSeed.handler(({ input }) => {
  let count = 0
  for (const item of input.rows) {
    const id = crypto.randomUUID()
    db.rows.set(id, {
      id,
      text: item.text,
      completed: false,
      deletedAt: null,
    })
    count += 1
  }
  console.log(`[oRPC] posts.bulkSeed → ${count} rows`)
  return { count }
})

export const router = os.router({
  posts: {
    list: listPosts,
    create: createPost,
    complete: completePost,
    delete: deletePost,
    bulkSeed: bulkSeedPosts,
  },
})