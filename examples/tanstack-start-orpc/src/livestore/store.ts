import { makePersistedAdapter } from "@livestore/adapter-web";
import LiveStoreSharedWorker from "@livestore/adapter-web/shared-worker?sharedworker";
import { StoreRegistry } from "@livestore/livestore";
import { StoreRegistryProvider, useStore } from "@livestore/react";
import { unstable_batchedUpdates as batchUpdates } from "react-dom";

import LiveStoreWorker from "../livestore.worker.ts?worker";
import { getStoreId } from "../util/store-id.ts";
import { SyncPayload, schema } from "./schema.ts";

/**
 * LiveStore React entry for the TanStack Start example.
 *
 * Mirrors the root app: the `StoreRegistry` owns the lifecycle,
 * `useAppStore()` is a one-liner around `useStore(storeOptions)`.
 */
export const storeRegistry = new StoreRegistry({
  defaultOptions: { batchUpdates },
});

export const storeOptions = {
  storeId: getStoreId(),
  schema,
  adapter: makePersistedAdapter({
    storage: { type: "opfs" },
    worker: LiveStoreWorker,
    sharedWorker: LiveStoreSharedWorker,
  }),
  batchUpdates,
  syncPayloadSchema: SyncPayload,
  syncPayload: { authToken: "insecure-token-change-me" },
} as const;

export const useAppStore = () => useStore(storeOptions);

export { StoreRegistryProvider };
