/**
 * The devtools event bus — a shared `EventTarget` on
 * `globalThis.__TANSTACK_EVENT_TARGET__` that both the bridge (app code)
 * and the panel (devtools UI) use to communicate.
 *
 * If the `@tanstack/devtools-vite` plugin already set up the target, we
 * reuse it. Otherwise we create one and wire up the `tanstack-connect`
 * handshake so any `EventClient` instances still in the app can connect.
 *
 * In production (`process.env.NODE_ENV !== 'development'`) the
 * `EventClient` import folds to a no-op, but the direct `devtoolsEmit` /
 * `devtoolsOn` helpers below still work — callers should gate those too
 * if they want to tree-shake the dev overhead out of prod bundles.
 */
import type { LiveStoreDevtoolsEvents } from "./events.ts";

const getOrCreateGlobalTarget = (): EventTarget => {
  if (typeof globalThis === "undefined") return new EventTarget();

  const existing = (globalThis as any).__TANSTACK_EVENT_TARGET__ as EventTarget | undefined;
  if (existing) return existing;

  const target = new EventTarget();
  (globalThis as any).__TANSTACK_EVENT_TARGET__ = target;

  // Respond to the EventClient's connection handshake so any EventClient
  // instances in the app can complete their connect loop.
  target.addEventListener("tanstack-connect", () => {
    target.dispatchEvent(new CustomEvent("tanstack-connect-success"));
  });

  return target;
};

const globalTarget = getOrCreateGlobalTarget();

export const devtoolsEmit = <K extends keyof LiveStoreDevtoolsEvents & string>(
  event: K,
  payload: LiveStoreDevtoolsEvents[K],
): void => {
  globalTarget.dispatchEvent(
    new CustomEvent(`livestore-tanstack-db:${event}`, {
      detail: {
        type: `livestore-tanstack-db:${event}`,
        payload,
        pluginId: "livestore-tanstack-db",
      },
    }),
  );
};

export const devtoolsOn = <K extends keyof LiveStoreDevtoolsEvents & string>(
  event: K,
  cb: (payload: LiveStoreDevtoolsEvents[K]) => void,
): (() => void) => {
  const handler = (e: Event) => {
    cb((e as CustomEvent).detail.payload);
  };
  globalTarget.addEventListener(`livestore-tanstack-db:${event}`, handler);
  return () => globalTarget.removeEventListener(`livestore-tanstack-db:${event}`, handler);
};
