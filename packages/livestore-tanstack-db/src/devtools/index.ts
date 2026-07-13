import { createElement } from "react";
import type { TanStackDevtoolsReactPlugin } from "@tanstack/react-devtools";

import { LiveStoreDevtoolsPanel } from "./panel.tsx";

export const liveStoreDevtoolsPlugin = (): TanStackDevtoolsReactPlugin => ({
  id: "livestore-tanstack-db",
  name: "LiveStore",
  render: (_el, _props) => createElement(LiveStoreDevtoolsPanel),
  defaultOpen: true,
});

export { LiveStoreDevtoolsPanel } from "./panel.tsx";
export { useLiveStoreDevtoolsBridge, registerCollection } from "./bridge.ts";
export { devtoolsEmit, devtoolsOn } from "./eventClient.ts";
export type { LiveStoreDevtoolsEvents } from "./events.ts";

/** Drop-in bridge component. */
export { LiveStoreDevtoolsBridge } from "./LiveStoreDevtoolsBridge.tsx";
export type { LiveStoreDevtoolsBridgeProps } from "./LiveStoreDevtoolsBridge.tsx";
