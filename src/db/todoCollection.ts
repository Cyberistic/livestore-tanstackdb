import type { Collection } from '@tanstack/db'

import { useTable } from '../integration/useTable.ts'
import type { Todo } from './todoSchema.ts'

/**
 * Tier 0.6 — the `useTable` hook now accepts an `rpc` config that
 * synthesises the `commitInsert/Update/Delete` callbacks
 * declaratively, replacing the ~30 lines of glue each model hook
 * needed in the pre-0.6 alkitab-alhakeem pilot.
 *
 * @example Equivalent alkitab shape:
 * ```ts
 * export const useTeacherProfilesCollection = () =>
 *   useTable("TeacherProfile", {
 *     rpc: {
 *       teacher: {
 *         updateOwnProfile: { map: row => row },
 *       },
 *     },
 *     rpcClient: orpc,
 *   })
 * ```
 *
 * This demo has no RPC client wired (the `<LiveStoreProvider>` here
 * passes only `schema`); passing `rpc: {}` keeps the new
 * declarative pipeline in front of the chain without firing any
 * external calls. Real apps supply their `orpc` client.
 */
export const useTodoCollection = (): Collection<Todo, string> =>
  useTable('Todo', {
    rpc: {
      todo: {
        // procedural spec only — no rpc client wired in this repo.
      },
    },
  }).collection as unknown as Collection<Todo, string>
