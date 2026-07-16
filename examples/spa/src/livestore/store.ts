import { makePersistedAdapter } from "@livestore/adapter-web";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { StoreRegistry } from "@livestore/livestore";
import { StoreRegistryProvider, useStore } from "@livestore/react";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";

import LiveStoreWorker from "../livestore.worker.ts?worker";
import { getStoreId } from "../util/store-id.ts";
import { SyncPayload, schema } from "./schema.ts";

const storeId = getStoreId();

const adapter = makePersistedAdapter({
  storage: { type: "opfs" },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
});

/**
 * Canonical LiveStore React entry point — mirrors `examples/web-todomvc-sync-cf`.
 *
 * `StoreRegistry` owns the store lifecycle (creation, retain/release,
 * automatic shutdown after `unusedCacheTime`). `useStore` registers a
 * retain in a `useEffect`, so the store stays alive as long as a
 * component is using it. This replaces our hand-rolled
 * `getOrCreateAppStore` cache, which didn't call `retain()` and was
 * racing with LiveStore's internal shutdown path.
 *
 * `useAppStore` below is the consumer-facing hook; it just re-exports
 * `useStore(storeOptions)` with the right options so call sites stay
 * one-liner.
 */
export const storeRegistry = new StoreRegistry({
  defaultOptions: { batchUpdates },
});

export const storeOptions = {
  storeId,
  schema,
  adapter,
  batchUpdates,
  syncPayloadSchema: SyncPayload,
  syncPayload: { authToken: "insecure-token-change-me" },
} as const;

export const useAppStore = () => useStore(storeOptions);

export { StoreRegistryProvider };
