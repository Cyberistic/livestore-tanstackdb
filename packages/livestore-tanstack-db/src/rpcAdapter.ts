/**
 * Adapter helpers for plugging any RPC client (oRPC, tRPC, plain fetch
 * wrappers, hand-rolled clients) into the
 * {@link RpcClient} shape that `useTable(name, { rpc })` expects.
 *
 * The integration is RPC-agnostic at the call site, but the adapters are
 * library-specific because the procedure-call conventions differ:
 *
 * - **oRPC / plain objects:** `client.ns.proc(input)` — direct function
 *   call. Use {@link createORPCAdapter}.
 * - **tRPC:** `client.ns.proc.mutate(input)` — procedure proxy with a
 *   `.mutate` method. Use {@link createTRPCAdapter}.
 *
 * Both return the same normalized `RpcClient` shape that `useTable` consumes.
 */
import type { RpcClient, RpcProcedure } from './mutations.ts'

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

  /**
   * The router definition object (e.g. `os.router({ posts: {...} })`).
   * When provided, the adapter enumerates namespaces from the router
   * definition instead of `Object.entries(client)`. This is required
   * when the client is an oRPC Proxy (which has no enumerable own keys).
   */
  router?: Record<string, unknown>
}

/** Adapt an oRPC (or any direct-call) client into the `RpcClient` shape.
 *
 * Walks `client[ns][proc]` and accepts any function value. Missing or
 * non-function entries become `undefined` in the output, which the
 * mutation layer treats as a no-op.
 */
export const createORPCAdapter = (
  client: Record<string, unknown>,
  options: CreateRpcAdapterOptions = {},
): RpcClient => {
  const { namespaces, skipValidation = false, router } = options
  const out: Record<string, Record<string, RpcProcedure | undefined>> = {}

  // When `router` is provided, enumerate namespaces from the router
  // definition. oRPC clients (createORPCClient / createRouterClient)
  // return a Proxy with no enumerable own keys, so Object.entries()
  // returns []. The router definition is a plain object we can walk.
  const namespaceKeys = router
    ? Object.keys(router)
    : Object.keys(client)

  for (const ns of namespaceKeys) {
    if (namespaces && !namespaces.includes(ns)) continue

    // Access the namespace on both client (Proxy) and router (plain object)
    const nsClient = (client as Record<string, unknown>)[ns]
    if (nsClient === null || nsClient === undefined || (typeof nsClient !== 'object' && typeof nsClient !== 'function')) {
      if (!skipValidation) {
        console.warn(`[createORPCAdapter] namespace '${ns}' is not an object/function — skipping`)
      }
      continue
    }

    // Enumerate procedures from the router definition (plain object)
    const nsRouter = router ? (router[ns] as Record<string, unknown> | undefined) : undefined
    const procKeys = nsRouter ? Object.keys(nsRouter) : Object.keys(nsClient as Record<string, unknown>)

    const procMap: Record<string, RpcProcedure | undefined> = {}
    for (const proc of procKeys) {
      // Access the procedure on the client Proxy — this triggers the
      // Proxy's `get` trap and returns a callable procedure function.
      const procValue = typeof nsClient === 'function'
        ? undefined
        : (nsClient as Record<string, unknown>)[proc]

      if (typeof procValue === 'function') {
        procMap[proc] = procValue as RpcProcedure
      } else if (procValue === undefined || procValue === null) {
        procMap[proc] = undefined
      } else if (!skipValidation) {
        console.warn(
          `[createORPCAdapter] ${ns}.${proc} is not a function (${typeof procValue}) — skipping`,
        )
      }
    }
    out[ns] = procMap
  }

  return out as RpcClient
}

/**
 * Adapt a tRPC client into the `RpcClient` shape.
 *
 * tRPC exposes procedures as proxy objects with `.mutate` (and `.query`,
 * `.subscribe`) methods. This adapter wraps `.mutate(input)` so that
 * `useTable`'s mutation layer can call it like a plain function.
 *
 * Walks `client[ns][proc]`, looks for a `.mutate` method, and falls back
 * to a direct function if the value is already callable. Missing or
 * invalid entries become `undefined` (no-op).
 */
export const createTRPCAdapter = (
  client: Record<string, unknown>,
  options: CreateRpcAdapterOptions = {},
): RpcClient => {
  const { namespaces, skipValidation = false } = options
  const out: Record<string, Record<string, RpcProcedure | undefined>> = {}

  for (const [ns, procs] of Object.entries(client)) {
    if (namespaces && !namespaces.includes(ns)) continue
    if (procs === null || procs === undefined || typeof procs !== 'object') {
      if (!skipValidation) {
        console.warn(`[createTRPCAdapter] namespace '${ns}' is not an object — skipping`)
      }
      continue
    }

    const procMap: Record<string, RpcProcedure | undefined> = {}
    for (const [proc, value] of Object.entries(procs as Record<string, unknown>)) {
      if (value === undefined || value === null) {
        procMap[proc] = undefined
        continue
      }

      if (typeof value === 'function') {
        // Direct-call procedures (oRPC, plain functions) also work here.
        procMap[proc] = value as RpcProcedure
      } else if (typeof value === 'object') {
        const proxy = value as Record<string, unknown>
        if (typeof proxy.mutate === 'function') {
          procMap[proc] = (input) => (proxy.mutate as RpcProcedure)(input)
        } else if (!skipValidation) {
          console.warn(
            `[createTRPCAdapter] ${ns}.${proc} has no .mutate method — skipping`,
          )
        }
      } else if (!skipValidation) {
        console.warn(
          `[createTRPCAdapter] ${ns}.${proc} is not a tRPC procedure (${typeof value}) — skipping`,
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
