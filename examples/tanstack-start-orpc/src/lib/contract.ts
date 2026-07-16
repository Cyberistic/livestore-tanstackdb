import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * oRPC contract for the `posts.*` namespace — five procedures that map
 * 1:1 to LiveStore events emitted by `createLiveStoreDb`.
 *
 * Tier 0.6 of `livestore-tanstack-db` walks
 * `classifyProcedure()` over the procedure names:
 *   - `posts.create` → insert (via `todoCreated` event override)
 *   - `posts.complete` → update (boolean toggle → `todoCompleted`)
 *   - `posts.delete` → delete (via `todoDeleted`)
 *   - `posts.bulkSeed` → insert (bulk → `todoBulkUpserted`)
 *
 * The contract is the single source of truth — the implementer
 * (server) and client both import `contract` so types stay aligned.
 */
const TodoRow = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  deletedAt: z.union([z.date(), z.string(), z.null()]).optional(),
});

const TodoInput = TodoRow.pick({ text: true });

export const listContract = oc
  .input(z.object({}).optional())
  .output(z.object({ rows: z.array(TodoRow) }));

export const createContract = oc.input(TodoInput).output(z.object({ row: TodoRow }));

export const completeContract = oc
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), completed: z.boolean() }));

export const deleteContract = oc
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }));

export const bulkSeedContract = oc
  .input(z.object({ rows: z.array(TodoInput) }))
  .output(z.object({ count: z.number().int().nonnegative() }));

export const contract = {
  posts: {
    list: listContract,
    create: createContract,
    complete: completeContract,
    delete: deleteContract,
    bulkSeed: bulkSeedContract,
  },
} as const;
