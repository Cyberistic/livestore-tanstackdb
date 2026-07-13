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
import type { RpcClient, RpcProcedure } from "./mutations.ts";

export interface CreateRpcAdapterOptions {
  /**
   * Only include these top-level namespaces. Useful when the client
   * exposes internal/admin procedures you don't want to surface to the
   * schema-driven write-back. Defaults to all namespaces.
   */
  namespaces?: ReadonlyArray<string>;

  /**
   * The router definition object (e.g. `os.router({ posts: {...} })`).
   * When provided, the adapter enumerates namespaces and procedures
   * from the router instead of walking the client. Required when the
   * client is an oRPC Proxy (which has no enumerable own keys).
   */
  router?: Record<string, unknown>;
}

/** Adapt an oRPC (or any direct-call) client into the `RpcClient` shape.
 *
 * oRPC's `createORPCClient` / `createRouterClient` returns a Proxy tree
 * (no own enumerable keys, every property access appends a segment to
 * the procedure path). To enumerate namespaces and procedures without
 * tripping the Proxy, the adapter walks the **router definition** (a
 * plain object) when one is supplied.
 *
 * The procedure functions themselves are still resolved via the Proxy
 * (`client[ns][proc]`), which builds the correct call path.
 */
export const createORPCAdapter = (
  client: Record<string, unknown>,
  options: CreateRpcAdapterOptions = {},
): RpcClient => {
  const { namespaces, router } = options;
  const out: Record<string, Record<string, RpcProcedure | undefined>> = {};

  const namespaceKeys = Object.keys(router ?? client);

  for (const ns of namespaceKeys) {
    if (namespaces && !namespaces.includes(ns)) continue;

    const nsClient = (client as Record<string, unknown>)[ns];
    if (nsClient === null || nsClient === undefined) continue;

    const nsRouter = (router?.[ns] ?? nsClient) as Record<string, unknown>;
    const procKeys = Object.keys(nsRouter);

    const procMap: Record<string, RpcProcedure | undefined> = {};
    for (const proc of procKeys) {
      const procValue = (nsClient as Record<string, unknown>)[proc];
      procMap[proc] =
        typeof procValue === "function"
          ? // Wrap in a plain function: any property access on the inner
            // oRPC Proxy would otherwise extend its procedure path. Storing
            // and calling through this wrapper keeps the call path stable.
            (((input: unknown) => (procValue as RpcProcedure)(input)) as RpcProcedure)
          : undefined;
    }
    out[ns] = procMap;
  }

  return out as RpcClient;
};

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
  const { namespaces } = options;
  const out: Record<string, Record<string, RpcProcedure | undefined>> = {};

  for (const [ns, procs] of Object.entries(client)) {
    if (namespaces && !namespaces.includes(ns)) continue;
    if (procs === null || procs === undefined || typeof procs !== "object") continue;

    const procMap: Record<string, RpcProcedure | undefined> = {};
    for (const [proc, value] of Object.entries(procs as Record<string, unknown>)) {
      if (value === undefined || value === null) {
        procMap[proc] = undefined;
        continue;
      }

      if (typeof value === "function") {
        procMap[proc] = value as RpcProcedure;
      } else if (typeof value === "object") {
        const proxy = value as Record<string, unknown>;
        if (typeof proxy.mutate === "function") {
          procMap[proc] = (input) => (proxy.mutate as RpcProcedure)(input);
        }
      }
    }
    out[ns] = procMap;
  }

  return out as RpcClient;
};

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
export type NamespacesOf<TClient> =
  TClient extends Record<string, any> ? keyof TClient & string : never;
