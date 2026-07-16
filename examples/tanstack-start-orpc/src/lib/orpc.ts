import { implement, ORPCError } from "@orpc/server";
import type { InferContractRouterOutputs } from "@orpc/contract";

import { contract } from "./contract.ts";

/**
 * Server-side implementation of the `posts.*` contract.
 *
 * The handler is intentionally a thin in-memory store — this example's
 * job is to demonstrate the LiveStore ↔ oRPC round-trip, not to be a
 * production CRUD. Real apps swap the `db` map for Prisma + D1 / SQLite
 * / Postgres. Each handler `console.log`s so dev sessions show the
 * write-back traffic.
 */

/**
 * Typed oRPC context shape — `headers` is the standard `Headers` object
 * so handlers can read cookies / authorization for auth (e.g. Better
 * Auth). Both transports populate it:
 *
 * - SSR (`createRouterClient` in `orpc-client.ts`): `getRequestHeaders()`
 *   from `@tanstack/react-start/server`.
 * - HTTP (`api.rpc.$.ts`): `request.headers` from the incoming fetch.
 *
 * To plug in Better Auth later, drop a middleware on `base` that calls
 * `auth.api.getSession({ headers: context.headers })` and adds the
 * session/user to context (see `orpc.dev/docs/integrations/better-auth`).
 */
export const base = implement(contract).$context<{ headers: Headers }>();

export type PostsOutputs = InferContractRouterOutputs<typeof contract.posts>;
type CreateOutput = PostsOutputs["create"];
type TodoRow = CreateOutput extends { row: infer R } ? R : never;

const db: {
  rows: Map<string, TodoRow>;
} = {
  rows: new Map<string, TodoRow>(),
};

const findOrThrow = (id: string): TodoRow => {
  const row = db.rows.get(id);
  if (!row) {
    throw new ORPCError("NOT_FOUND", {
      message: `post not found: ${id}`,
    });
  }
  return row;
};

export const listPosts = base.posts.list.handler(() => {
  return { rows: Array.from(db.rows.values()) };
});

export const createPost = base.posts.create.handler(({ input }) => {
  const id = crypto.randomUUID();
  const row: TodoRow = {
    id,
    text: input.text,
    completed: false,
    deletedAt: null,
  };
  db.rows.set(id, row);
  console.log(`[oRPC] posts.create → ${id} ("${input.text}")`);
  return { row };
});

export const completePost = base.posts.complete.handler(({ input }) => {
  // The example's in-memory `db.rows` map is separate from LiveStore's
  // D1-backed event log, so a row can exist on the client (e.g. synced
  // from a previous session) without being in the server's map. Upsert
  // here so the toggle is idempotent. Real apps would query D1 directly.
  const existing = db.rows.get(input.id);
  const row = existing ?? {
    id: input.id,
    text: (input as { text?: string }).text ?? "",
    completed: false,
    deletedAt: null,
  };
  row.completed = !row.completed;
  db.rows.set(input.id, row);
  console.log(
    `[oRPC] posts.complete → ${input.id} = ${row.completed} (${existing ? "toggle" : "upsert"})`,
  );
  return { id: row.id, completed: row.completed };
});

export const deletePost = base.posts.delete.handler(({ input }) => {
  // Demonstrate proper oRPC error typing — `findOrThrow` throws an
  // `ORPCError('NOT_FOUND', ...)` which the server's `onError` interceptor
  // serialises into a typed 404 response. The client-side `fireRpc`
  // surfaces this via the `onError` callback the user passes in
  // `useTable(name, { rpc: { onError } })`.
  findOrThrow(input.id);
  db.rows.delete(input.id);
  console.log(`[oRPC] posts.delete → ${input.id}`);
  return { id: input.id };
});

export const bulkSeedPosts = base.posts.bulkSeed.handler(({ input }) => {
  let count = 0;
  for (const item of input.rows) {
    const id = crypto.randomUUID();
    db.rows.set(id, {
      id,
      text: item.text,
      completed: false,
      deletedAt: null,
    });
    count += 1;
  }
  console.log(`[oRPC] posts.bulkSeed → ${count} rows`);
  return { count };
});

export const router = base.router({
  posts: {
    list: listPosts,
    create: createPost,
    complete: completePost,
    delete: deletePost,
    bulkSeed: bulkSeedPosts,
  },
});
