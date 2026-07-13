/**
 * Adapter helpers for plugging any RPC client (oRPC, tRPC, plain fetch
 * wrappers, hand-rolled clients) into the
 * {@link RpcClient} shape that `useTable(name, { rpc })` expects.
 *
 * The integration is RPC-agnostic: any nested object of callable
 * functions matches the `RpcClient` shape. The `createRpcAdapter`
 * helper below validates that an arbitrary input conforms to the
 * expected shape at runtime (warns on bad entries, never throws —
 * missing procedures become no-ops at the call site).
 *
 * @example
 * ```ts
 * import { createRpcAdapter } from '@cyberistic/livestore-tanstack-db'
 * import { orpc } from '@/lib/orpc'
 *
 * const rpc = createRpcAdapter(orpc, {
 *   // optional: only validate specific namespaces; the rest are skipped
 *   namespaces: ['teacher', 'student'],
 * })
 *
 * const lessons = useTable('Lesson', {
 *   rpc: { client: rpc, config: { teacher: { createLesson: {} } } },
 * })
 * ```
 */
import type { RpcClient, RpcProcedure } from './mutations.ts'

/** Shape that `createRpcAdapter` walks. Anything with this shape is accepted. */
type AnyRpcClient = Record<string, unknown>

export interface CreateRpcAdapterOptions {
  /**
   * Only include these top-level namespaces. Useful when the client
   * exposes internal/admin procedures you don't want to surface to the
   * schema-driven write-back. Defaults to all namespaces.
   */
  namespaces?: ReadonlyArray<string>

  /**
   * Skip validation (don't warn on bad entries). Use when you trust the
   * client shape and want to skip the per-namespace check. Defaults to
   * `false` (validate).
   */
  skipValidation?: boolean
}

/**
 * Adapt any nested object of callable functions into the `RpcClient`
 * shape that `useTable(name, { rpc })` expects.
 *
 * **Validation behaviour:**
 * - Walks `client[ns][proc]` and accepts any `function` value.
 * - Entries that are not functions (e.g. plain objects, primitives) are
 *   silently dropped (warnings printed to `console.warn` unless
 *   `skipValidation: true`).
 * - Missing namespaces/procedures become `undefined` in the output —
 *   the mutation layer treats undefined as "no-op".
 *
 * The output is plain — you can also just cast your `orpc` client
 * directly to `RpcClient` if you know it conforms. This helper exists
 * for the common case where you want a sanity check.
 *
 * @example
 * ```ts
 * // oRPC client → RpcClient
 * const rpc = createRpcAdapter(orpc)
 *
 * // Plain object → RpcClient
 * const rpc = createRpcAdapter({
 *   teacher: {
 *     createLesson: (input) => fetch('/api/teacher/lesson', { ...input }),
 *     deleteLesson: (input) => fetch(`/api/teacher/lesson/${input.id}`, { method: 'DELETE' }),
 *   },
 * })
 *
 * // Restrict to specific namespaces
 * const rpc = createRpcAdapter(orpc, { namespaces: ['teacher'] })
 * ```
 */
export const createRpcAdapter = (
  client: AnyRpcClient,
  options: CreateRpcAdapterOptions = {},
): RpcClient => {
  const { namespaces, skipValidation = false } = options
  const out: Record<string, Record<string, RpcProcedure | undefined>> = {}

  for (const [ns, procs] of Object.entries(client)) {
    if (namespaces && !namespaces.includes(ns)) continue
    if (procs === null || procs === undefined || typeof procs !== 'object') {
      if (!skipValidation) {
        console.warn(`[createRpcAdapter] namespace '${ns}' is not an object — skipping`)
      }
      continue
    }

    const procMap: Record<string, RpcProcedure | undefined> = {}
    for (const [proc, value] of Object.entries(procs as Record<string, unknown>)) {
      if (typeof value === 'function') {
        procMap[proc] = value as RpcProcedure
      } else if (value === undefined || value === null) {
        procMap[proc] = undefined
      } else if (!skipValidation) {
        console.warn(
          `[createRpcAdapter] ${ns}.${proc} is not a function (${typeof value}) — skipping`,
        )
      }
    }
    out[ns] = procMap
  }

  return out as RpcClient
}

/**
 * Type-only helper: extract the namespaces from an RPC client type. Useful
 * for constraining the `rpc.config` keys to only those that exist on the
 * real client.
 *
 * @example
 * ```ts
 * import type { orpc } from '@/lib/orpc'
 *
 * type OrpcNamespaces = NamespacesOf<typeof orpc>
 * // → 'teacher' | 'student' | ...
 * ```
 */
export type NamespacesOf<TClient> = TClient extends Record<string, any>
  ? keyof TClient & string
  : never
