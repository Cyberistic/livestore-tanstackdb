import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.ts";

/**
 * `createRouter` in `@tanstack/react-router` lets you supply a typed
 * router-wide context. The root route declares
 * `createRootRouteWithContext<RouterAppContext>()`. Empty for now —
 * reserved for loaders that want a shared server-side context (auth,
 * tracing, etc).
 */
export interface RouterAppContext {}

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
  });
}
