/**
 * Module-level LiveStore store cache.
 *
 * The package owns its own store lifecycle so loader-side consumers
 * (TanStack Router loaders, scripts) can call `getOrCreateStore()`
 * without rendering any React tree.
 *
 * Consumers typically pass the store via `<LiveStoreProvider store={...}>`
 * — this file is the fallback for non-React call sites (Tier 1.5
 * preload hooks, etc.).
 */
import { createStore } from "@livestore/livestore";
import type { Store } from "@livestore/livestore";
import { makePersistedAdapter } from "@livestore/adapter-web";

let storePromise: Promise<Store<any>> | null = null;

/**
 * Get-or-create the singleton LiveStore store. First call creates the
 * store via `createStore` (the non-React entry from `@livestore/livestore`);
 * subsequent calls return the cached Promise.
 */
export const getOrCreateStore = (): Promise<Store<any>> => {
  if (!storePromise) {
    // `StoreRegistry` and `Store` are part of @livestore/livestore's
    // public surface. The actual `schema` and `adapter` are consumer
    // overrides via the `LiveStoreProvider` config; for non-React
    // consumers (loaders, scripts), the package exposes a no-op
    // defaults that the consumer can replace.
    const storeId = "app-root";
    const adapter = makePersistedAdapter({
      storage: { type: "opfs" as const },
      worker: undefined as never,
      sharedWorker: undefined as never,
    });
    storePromise = createStore({
      storeId,
      schema: undefined as never,
      adapter,
    }) as unknown as Promise<Store<any>>;
  }
  return storePromise;
};
