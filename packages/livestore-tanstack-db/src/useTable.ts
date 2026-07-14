import { queryDb } from "@livestore/livestore";
import type { Queryable, Store } from "@livestore/livestore";
import { createCollection } from "@tanstack/db";
import type { Collection } from "@tanstack/db";
import { useMemo } from "react";

import { liveStoreCollectionOptions, type LiveStoreRow } from "./liveStoreCollection.ts";
import type { MutationCallbacks, RpcClient, RpcConfig, RpcErrorContext } from "./mutations.ts";
import { createMutations } from "./mutations.ts";
import { useLiveStoreConfig } from "./LiveStoreProvider.tsx";
import { getKeyFromSchema } from "./getKeyFromSchema.ts";

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/** PascalCase model name (or client-document camelCase). Generic — the consumer's tables define the actual values. */
export type TableName = string;

/**
 * Row type for a given table. Derived from the consumer's LiveStore
 * table map at the call site.
 */
export type RowOf<TName extends string, T extends Record<string, any>> = T[TName] extends {
  readonly Type: infer R;
}
  ? R
  : LiveStoreRow;

// ─────────────────────────────────────────────────────────────────────
// Live store context — read from <LiveStoreProvider>
// ─────────────────────────────────────────────────────────────────────

/**
 * The shape the package reads from the surrounding LiveStore context.
 * Consumers populate this via `<LiveStoreProvider schema={...} oRPC={...}>`.
 */
export interface UseTableLiveStore {
  store: Store<any>;
  tables: Record<string, any>;
  events: Record<string, any>;
  schema: unknown;
  /**
   * Per-model read-only flags (server-authoritative tables). Typically
   * sourced from `createLiveStoreDb(...)`'s `readOnly` output.
   */
  readOnly?: Record<string, boolean>;
  /**
   * Tier 0.6 — optional oRPC client. Either set on
   * <LiveStoreProvider oRPC={...}> (then `useTable` auto-derives
   * `rpc.client` from it) or supplied explicitly alongside a
   * hand-rolled `liveStore` option.
   */
  oRPC?: RpcClient;
  /**
   * Per-model soft-delete column name. Mirrors
   * `createLiveStoreDb`'s `softDeleteColumns` input — `deleteEventKey`
   * payloads (`commitDelete`) use the configured column instead of the
   * hardcoded `"deletedAt"`. Falls back to schema-driven detection via
   * `softDeleteColumnFromSchema(tableSchema)`, then to `"deletedAt"`.
   */
  softDeleteColumns?: Record<string, string>;
}

const useLiveStore = (): UseTableLiveStore | null => {
  const config = useLiveStoreConfig();
  if (!config) return null;
  // The consumer's `createLiveStoreDb` output is stored on the
  // LiveStoreProvider's `schema` prop. The package's `useTable` reads
  // tables/events/store from the same place. The optional `oRPC`
  // client sits alongside `schema` in the context so per-table hooks
  // can auto-derive their RPC bindings (Tier 0.6).
  return {
    ...(config.schema as unknown as UseTableLiveStore),
    oRPC: config.oRPC,
  };
};

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (no module-level state)
// ─────────────────────────────────────────────────────────────────────

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const ucFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const syncedEventFor = (name: TableName, events: Record<string, any>, action: string) => {
  const key = `${lcFirst(name)}${action}`;
  const e = (events as Record<string, any>)[key];
  if (!e) {
    throw new Error(
      `useTable(${name}): no \`${key}\` event found in schema. ` +
        `Did createLiveStoreDb's includeCreated/includeDeleted flags disable it? ` +
        `Or did you forget to add a \`booleanColumns\` for per-field events?`,
    );
  }
  return e;
};

const clientDocSetEventFor = (name: TableName, events: Record<string, any>) => {
  const e = (events as Record<string, any>)[`${name}Set`];
  if (!e) {
    throw new Error(
      `useTable(${name}): no \`${name}Set\` event found in schema. Did the table get declared as a client document in createLiveStoreDb?`,
    );
  }
  return e;
};

/**
 * Build the `commitInsert` handler for a client-document table. The
 * client-document `set` event takes the document value as its first
 * argument (TanStack DB's `mutation.modified` is that document value),
 * not a synced-table `Created`-style payload.
 *
 * Plan 002 — previously this branch returned `makeCommitInsert(...)`,
 * which routes through `syncedEventFor(name, events, "Created")` and
 * throws because client documents emit `${name}Set`, not `${name}Created`.
 */
const makeCommitClientDocInsert = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
) => {
  const setEvent = clientDocSetEventFor(name, events);
  return (row: LiveStoreRow) => {
    store.commit(setEvent(row));
  };
};

/**
 * Walk the schema's property signatures and find a soft-delete column.
 * Heuristic: any field matching /(deleted|archived|removed)/ of
 * `NullOr(...)` type — covers `deletedAt`, `archivedAt`, `isDeleted`, etc.
 *
 * Tier 1.2 — removes the need for callers to pass `where: { deletedAt: null }`
 * for every `useTable(name)` call.
 */
const softDeleteColumnFromSchema = (schema: unknown): string | null => {
  if (!schema || typeof schema !== "object") return null;
  const fields = (schema as { readonly fields?: Readonly<Record<string, unknown>> }).fields;
  if (!fields) return null;
  for (const [name, sig] of Object.entries(fields)) {
    if (!/(deleted|archived|removed)/i.test(name)) continue;
    const ast = (sig as { readonly ast?: unknown }).ast;
    if (!ast) continue;
    const tag = (ast as { readonly _tag?: string })._tag;
    if (tag !== "Union") continue;
    const types = (ast as { readonly types?: ReadonlyArray<unknown> }).types;
    if (!Array.isArray(types)) continue;
    const hasNull = types.some((t) => {
      const tTag = (t as { readonly _tag?: string })._tag;
      return tTag === "Literal" && (t as { readonly literal?: unknown }).literal === null;
    });
    if (hasNull) return name;
  }
  return null;
};

/**
 * Build a default `where` predicate from the schema's soft-delete column.
 * Returns `{}` (no filter) when no soft-delete column is detected.
 */
const defaultWhereFromSchema = (schema: unknown): Record<string, unknown> => {
  const col = softDeleteColumnFromSchema(schema);
  return col ? { [col]: null } : {};
};

/**
 * Build a `getKey` function from the schema's primary-key column.
 * Tier 1.1 — wraps {@link getKeyFromSchema} so the row's pk column is
 * read instead of hardcoded `row.id`. Falls back to `'id'` when the
 * schema walker can't determine the pk.
 */
const getKeyFromTable = (schema: unknown): ((row: LiveStoreRow) => string) => {
  // The schema field on a LiveStore table def is `Schema.Top` from
  // `@livestore/livestore`. We accept `unknown` here because the column
  // walker tolerates `null` / non-schema inputs and falls back to a
  // `row.id` lookup.
  try {
    return getKeyFromSchema<LiveStoreRow>(schema as Parameters<typeof getKeyFromSchema>[0]);
  } catch {
    // No primary key found — fall back to `row.id` for compatibility.
    return (row: LiveStoreRow) => (row as unknown as { id: string }).id;
  }
};

const makeCommitInsert = (store: Store<any>, name: TableName, events: Record<string, any>) => {
  const e = syncedEventFor(name, events, "Created");
  // Takes a raw row (not `{ row }`) — matches the shape of
  // `MutationCallbacks['commitInsert']` and the loop in `useTable`
  // that passes `mutation.modified` directly.
  return (row: LiveStoreRow) => {
    store.commit(e(row));
  };
};

/**
 * Tier 1.7 — bulk insert. Emits a single `v1.<Model>BulkUpserted` event
 * carrying every row in the transaction. Returns `null` when the schema
 * doesn't define the event so the caller falls back to per-row commits.
 */
const makeCommitBulkInsert = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
): MutationCallbacks["commitBulkInsert"] | null => {
  const modelPrefix = lcFirst(name);
  const e = (events as Record<string, any>)[`${modelPrefix}BulkUpserted`];
  if (!e) return null;
  return (rows) => {
    store.commit(e({ rows }));
  };
};

const makeCommitDelete = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
  softDeleteColumn: string,
) => {
  const e = syncedEventFor(name, events, "Deleted");
  // Takes the raw row — `commitDelete` in `MutationCallbacks` is
  // `(row) => void`, and the caller passes `mutation.original` directly.
  // We extract `id` and append the soft-delete timestamp under the
  // configured column (defaults to `"deletedAt"`).
  return (row: LiveStoreRow) => {
    store.commit(
      e({
        id: (row as { id: string }).id,
        [softDeleteColumn]: new Date(),
      } as unknown as Parameters<typeof e>[0]),
    );
  };
};

const makeCommitUpdate = (store: Store<any>, name: TableName, events: Record<string, any>) => {
  // Auto-detect per-field boolean toggles and emit Completed/Uncompleted
  // events (mirrors `createMutations` in mutations.ts). For other updates
  // we emit `<model>Upserted` if the schema has one. Callers can override
  // `commitUpdate` in the options to take full control.
  const modelPrefix = lcFirst(name);
  return (original: LiveStoreRow, changes: Record<string, unknown>) => {
    const id = ((changes as { id?: unknown }).id ?? (original as { id: unknown }).id) as string;
    const merged = { ...original, ...changes };

    const changeEntries = Object.entries(changes as Record<string, unknown>);
    const onlyBooleans =
      changeEntries.length > 0 && changeEntries.every(([, v]) => typeof v === "boolean");

    if (onlyBooleans) {
      for (const [field, value] of changeEntries) {
        if (typeof value !== "boolean") continue;
        // Match `createLiveStoreDb`'s `eventSuffixesFor`: a field whose
        // PascalCase form already ends in "Completed" emits just
        // "Completed" (no doubling), e.g. `completed` → `todoCompleted`
        // not `todoCompletedCompleted".
        const cap = ucFirst(field);
        const onKey = cap.endsWith("Completed")
          ? `${modelPrefix}Completed`
          : `${modelPrefix}${cap}Completed`;
        const offKey = cap.endsWith("Completed")
          ? `${modelPrefix}Uncompleted`
          : `${modelPrefix}${cap}Uncompleted`;
        const e = (events as Record<string, any>)[value ? onKey : offKey];
        if (e) store.commit(e({ id }));
      }
      return;
    }

    const upsertKey = `${modelPrefix}Upserted`;
    const upserted = (events as Record<string, any>)[upsertKey];
    if (upserted) store.commit(upserted({ row: merged }));
  };
};

// Exported for testing only — see useTable.commitCallbacks.test.ts.
export const buildCommitCallbacks = (
  store: Store<any>,
  name: TableName,
  events: Record<string, any>,
  softDeleteColumn: string = "deletedAt",
): {
  commitInsert?: MutationCallbacks["commitInsert"];
  commitBulkInsert?: MutationCallbacks["commitBulkInsert"];
  commitUpdate?: MutationCallbacks["commitUpdate"];
  commitDelete?: MutationCallbacks["commitDelete"];
} => {
  if (!(events as Record<string, any>)[`${name}Set`]) {
    // Synced table — has Created/Deleted events
    const base: {
      commitInsert: MutationCallbacks["commitInsert"];
      commitDelete: MutationCallbacks["commitDelete"];
      commitUpdate: MutationCallbacks["commitUpdate"];
      commitBulkInsert?: MutationCallbacks["commitBulkInsert"];
    } = {
      commitInsert: makeCommitInsert(store, name, events),
      commitDelete: makeCommitDelete(store, name, events, softDeleteColumn),
      commitUpdate: makeCommitUpdate(store, name, events),
    };
    const bulk = makeCommitBulkInsert(store, name, events);
    if (bulk) base.commitBulkInsert = bulk;
    return base;
  }
  // Client document — has a `set` event
  return {
    commitInsert: makeCommitClientDocInsert(store, name, events),
    commitUpdate: (input: { id: string; changes: Record<string, unknown> }) => {
      store.commit(clientDocSetEventFor(name, events)({ id: input.id, value: input.changes }));
    },
  };
};

const buildQuery = <TName extends TableName>(
  name: TName,
  tables: Record<string, any>,
  schema?: unknown,
): Queryable<any> => {
  // Default: soft-delete-aware (Tier 1.2). When the schema has a
  // `deletedAt` / `archivedAt` / `isDeleted` field of `NullOr(...)` type
  // we auto-derive a `where: { <col>: null }` filter. Callers can
  // override via `useTable(name, { where: ... })`.
  const where = defaultWhereFromSchema(schema);
  const t = (tables as Record<string, any>)[name];
  return queryDb(Object.keys(where).length === 0 ? t : t.where(where), {
    label: `${lcFirst(name)}:all`,
  });
};

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Tier 0.6 — auto-derive the oRPC client from the surrounding
 * LiveStore context. Explicit `options.rpc.client` wins; otherwise,
 * when `options.rpc.config` is provided AND the liveStore runtime
 * carries an `oRPC` client (either via <LiveStoreProvider oRPC={...}>
 * or an explicit `liveStore.oRPC`), we fill in `rpc.client` so callers
 * don't have to thread the same client through every call site.
 */
const resolveRpcOptions = <T extends UseTableOptions<TableName>>(
  options: T,
  liveStore: UseTableLiveStore,
): T => {
  if (!options.rpc?.config || options.rpc.client) return options;
  const oRPC = liveStore.oRPC;
  if (!oRPC) return options;
  return {
    ...options,
    rpc: {
      ...options.rpc,
      client: oRPC,
    },
  };
};

/**
 * Options for {@link useTable}.
 *
 * The package reads `store` / `tables` / `events` from the surrounding
 * <LiveStoreProvider> by default. Pass an explicit `liveStore` to
 * override (e.g. inside TanStack Router loaders where there is no
 * React tree to read context from).
 */
// oxlint-disable-next-line no-unused-vars
export interface UseTableOptions<TName extends TableName> {
  /** Server-side filter applied via `tables[name].where(...)`. */
  where?: Record<string, unknown>;
  /**
   * Override commit handlers. By default the package auto-derives
   * `commitInsert` / `commitUpdate` / `commitDelete` from the events
   * emitted by `createLiveStoreDb`. Pass any of these to override.
   */
  commitInsert?: MutationCallbacks["commitInsert"];
  /**
   * Tier 1.7 — bulk insert override. Auto-derived when the schema has
   * a `v1.<Model>BulkUpserted` event.
   */
  commitBulkInsert?: MutationCallbacks["commitBulkInsert"];
  commitUpdate?: MutationCallbacks["commitUpdate"];
  commitDelete?: MutationCallbacks["commitDelete"];
  /**
   * oRPC write-back. Pass an oRPC client + a per-table RPC config to
   * have mutations round-trip to the server automatically. The package
   * uses the Tier 0.6 heuristics in `createMutations()` to detect
   * insert vs update vs delete procs.
   *
   * `onError` is the typed error surface for failed write-backs. The
   * callback receives the raw error plus a context object identifying
   * which procedure failed and what input was sent. Use a runtime
   * check (`err instanceof ORPCError`) to narrow to your RPC client's
   * error type. Defaults to `console.error`.
   */
  rpc?: {
    client?: RpcClient;
    config?: RpcConfig;
    onError?: (err: unknown, ctx: RpcErrorContext) => void;
  };
  /**
   * Explicit LiveStore runtime. If omitted, the package reads it from
   * <LiveStoreProvider> via React context.
   */
  liveStore?: UseTableLiveStore;
  /**
   * Skip the React context read. Use in loaders / scripts that run
   * outside a React tree. `liveStore` is required when this is true.
   */
  noContext?: boolean;
}

// oxlint-disable-next-line no-unused-vars
export interface UseTableResult<TName extends TableName> {
  /** The TanStack DB collection with `.insert/.update/.delete` and `.toArray`. */
  collection: Collection<LiveStoreRow, string>;
  /** The LiveStore table def. */
  table: ReturnType<typeof queryDb>;
  /** The full LiveStore schema. */
  schema: unknown;
  /** `true` if this table is server-authoritative (no client write APIs). */
  isReadOnly: boolean;
}

/**
 * Module-level cache: one Collection per (storeId + name + where + rpc) key.
 * `useTable` returns the cached Collection; `createCollection` is sync, so
 * no promise/async is involved. Bypasses React's "creating promises in
 * Client Components" complaint.
 */
const collectionCache = new Map<string, Collection<LiveStoreRow, string>>();
const collectionCacheKey = (storeId: string, name: string, where: unknown, rpc: unknown) =>
  JSON.stringify({ storeId, name, where, rpc });

/**
 * Build a `Collection` for the given model name + options. Synchronous —
 * `createCollection` from `@tanstack/db` returns the Collection
 * immediately. Idempotent: repeated calls with the same key return the
 * cached instance.
 */
export const getCollection = <TName extends TableName>(
  name: TName,
  options: UseTableOptions<TName> & { liveStore: UseTableLiveStore },
): Collection<LiveStoreRow, string> => {
  const { liveStore, where, rpc, commitInsert, commitBulkInsert, commitUpdate, commitDelete } =
    options;
  const store = liveStore.store;
  const key = collectionCacheKey(store["storeId"] ?? "", name, where, rpc);
  const cached = collectionCache.get(key);
  if (cached) return cached;

  const tableDef = (liveStore.tables as Record<string, any>)[name];
  const tableSchema = (tableDef?.rowSchema ?? tableDef?.schema) as unknown;
  const table = where
    ? tableDef.where(where)
    : buildQuery(name, liveStore.tables as Record<string, any>, tableSchema);

  const live = liveStore.events as Record<string, any>;
  const isReadOnly = Boolean((liveStore.readOnly as Record<string, boolean> | undefined)?.[name]);

  // Resolve the soft-delete column from the most specific source first,
  // falling back through the schema walker and finally `"deletedAt"`.
  // Mirrors `createLiveStoreDb`'s precedence: explicit per-model map
  // (`softDeleteColumns[model]`) → schema-detection → `"deletedAt"`.
  const softDeleteColumn =
    (liveStore.softDeleteColumns as Record<string, string> | undefined)?.[name] ??
    softDeleteColumnFromSchema(tableSchema) ??
    "deletedAt";

  // Auto-derive commit handlers unless the caller overrode them.
  const auto = isReadOnly
    ? {}
    : buildCommitCallbacks(store, name, live, softDeleteColumn);

  const insert = commitInsert ?? auto.commitInsert;
  const bulkInsert = commitBulkInsert ?? auto.commitBulkInsert;
  const update = commitUpdate ?? auto.commitUpdate;
  const delete_ = commitDelete ?? auto.commitDelete;

  // Tier 1.1 — auto-derive `getKey` from the schema's primary-key
  // column. The schema walker looks for an `isPrimaryKey` marker on the
  // ast property signatures (set by upstream `prisma-effect-schema-generator`
  // when it emits one); falls back to `'id'`.
  const rowGetKey = getKeyFromTable(tableSchema);

  // Tier 0.6 — oRPC write-back via the createMutations helper.
  const mutationOverrides = rpc?.client
    ? createMutations({
        store,
        modelName: name,
        events: live,
        rpcClient: rpc.client,
        rpcConfig: rpc.config,
        onRpcError: rpc.onError,
        softDeleteColumn,
      })
    : null;

  // Resolve the actual commit handlers: caller overrides win, then
  // mutationOverrides (Tier 0.6 RPC write-back), then the auto-derived
  // handlers. `mutationOverrides` and `auto` may both contribute
  // handlers — `mutationOverrides` takes priority when present.
  const finalInsert = mutationOverrides?.commitInsert ?? insert;
  const finalBulkInsert = mutationOverrides?.commitBulkInsert ?? bulkInsert;
  const finalUpdate = mutationOverrides?.commitUpdate ?? update;
  const finalDelete = mutationOverrides?.commitDelete ?? delete_;

  const collection = createCollection(
    liveStoreCollectionOptions<LiveStoreRow>({
      id: name.toLowerCase(),
      store,
      query: table,
      getKey: rowGetKey,
      isReadOnly,
      ...(finalInsert
        ? {
            onInsert: async ({ transaction }) => {
              // Tier 1.7 — when `commitBulkInsert` is wired AND the
              // transaction carries multiple rows, dispatch to the
              // bulk handler so a single `v1.<Model>BulkUpserted`
              // event is emitted. Single-row transactions still go
              // through `commitInsert` for back-compat.
              const mutations = transaction.mutations;
              if (finalBulkInsert && mutations.length > 1) {
                finalBulkInsert(mutations.map((m) => m.modified) as unknown as LiveStoreRow[]);
                return;
              }
              for (const m of mutations) {
                finalInsert(m.modified as LiveStoreRow);
              }
            },
            ...(finalBulkInsert
              ? {
                  onBulkInsert: async ({ rows }) => {
                    finalBulkInsert(rows as unknown as LiveStoreRow[]);
                  },
                }
              : {}),
          }
        : {}),
      ...(finalUpdate
        ? {
            onUpdate: async ({ transaction }) => {
              for (const m of transaction.mutations) {
                finalUpdate(m.original as LiveStoreRow, m.changes as Partial<LiveStoreRow>);
              }
            },
          }
        : {}),
      ...(finalDelete
        ? {
            onDelete: async ({ transaction }) => {
              for (const m of transaction.mutations) {
                finalDelete(m.original as LiveStoreRow);
              }
            },
          }
        : {}),
    }),
  );
  collectionCache.set(key, collection);
  // Tier 2.7: auto-register the collection with the devtools bridge
  // so consumers don't have to pass `collections={...}` explicitly
  // to `<LiveStoreDevtoolsBridge>`. The devtools panel shows
  // per-collection `status:change` events for every collection
  // created by `useTable`.
  if (typeof window !== "undefined") {
    void import("./devtools/bridge.ts").then(({ registerCollection }) => {
      registerCollection(name, collection);
    });
  }
  return collection;
};

// ─────────────────────────────────────────────────────────────────────
// React hook
// ─────────────────────────────────────────────────────────────────────

/**
 * React hook that returns the TanStack DB collection for a LiveStore table.
 *
 * Synchronous — `createCollection` returns the Collection immediately, so
 * `useTable` doesn't suspend and can be used in Client Components without
 * needing `<Suspense>`. Memoised by `(storeId + name + where + rpc)`.
 *
 * Must be rendered inside a `<LiveStoreProvider>` (or pass `liveStore`
 * explicitly to bypass the context).
 */
export const useTable = <TName extends TableName>(
  name: TName,
  options: UseTableOptions<TName> = {},
): UseTableResult<TName> => {
  const liveStore = options.liveStore ?? (!options.noContext ? useLiveStore() : null);
  if (!liveStore) {
    throw new Error(
      `useTable(${name}): no LiveStore runtime in scope. Either render inside a <LiveStoreProvider>, or pass \`liveStore\` explicitly.`,
    );
  }

  // Tier 0.6 — auto-derive `rpc.client` from the LiveStore context
  // (or an explicit `liveStore.oRPC`) when only `rpc.config` is given.
  const resolvedOptions = resolveRpcOptions(options, liveStore);

  const collection = useMemo(
    () => getCollection(name, { ...resolvedOptions, liveStore }),
    [
      liveStore,
      name,
      resolvedOptions.where,
      resolvedOptions.rpc,
      resolvedOptions.commitInsert,
      resolvedOptions.commitBulkInsert,
      resolvedOptions.commitUpdate,
      resolvedOptions.commitDelete,
    ],
  );

  return {
    collection: collection as Collection<LiveStoreRow, string>,
    table: buildQuery(name, liveStore.tables as Record<string, any>) as never,
    schema: liveStore.schema,
    isReadOnly: Boolean((liveStore.readOnly as Record<string, boolean> | undefined)?.[name]),
  };
};

// ─────────────────────────────────────────────────────────────────────
// Bulk + loaders
// ─────────────────────────────────────────────────────────────────────

/**
 * Bulk-import many collections in one call. Returns a `{ [name]: collection }`.
 *
 * Tier 1.4 — replaces the 60+ files in alkitab-alhakeem that each do
 * `useXxxCollection()` 1-3 times.
 */
export const useTables = <Spec extends Record<string, UseTableOptions<TableName>>>(
  spec: Spec,
): { [K in keyof Spec]: Collection<LiveStoreRow, string> } => {
  const liveStore = useLiveStore();
  if (!liveStore) {
    throw new Error("useTables: no LiveStore runtime in scope.");
  }
  const out: Record<string, any> = {};
  for (const [name, opts] of Object.entries(spec)) {
    const resolvedOpts = resolveRpcOptions(opts as UseTableOptions<TableName>, liveStore);
    out[name] = useMemo(
      () => getCollection(name, { ...resolvedOpts, liveStore }),
      [
        liveStore,
        name,
        resolvedOpts.where,
        resolvedOpts.rpc,
        resolvedOpts.commitInsert,
        resolvedOpts.commitBulkInsert,
        resolvedOpts.commitUpdate,
        resolvedOpts.commitDelete,
      ],
    );
  }
  return out as { [K in keyof Spec]: Collection<LiveStoreRow, string> };
};

/**
 * Loader-side equivalent of `useTable`. Returns a `Collection` directly
 * (sync) — safe in TanStack Router loaders / scripts / Worker handlers
 * (no React tree required).
 */
export const preloadTable = <TName extends TableName>(
  name: TName,
  options: UseTableOptions<TName> & { liveStore: UseTableLiveStore },
): Collection<LiveStoreRow, string> => getCollection(name, options);

export type { RpcClient, RpcConfig };
