/**
 * The TanStack Devtools plugin descriptor for the LiveStore ↔ TanStack DB
 * integration. Consumers register it inside `<TanStackDevtools plugins={[...]}>`
 * to add the panel to the devtools shell.
 *
 * @example
 * ```tsx
 * import { TanStackDevtools } from '@tanstack/react-devtools'
 * import { liveStoreDevtoolsPlugin } from '@cyberistic/livestore-tanstack-db/devtools'
 *
 * <TanStackDevtools plugins={[liveStoreDevtoolsPlugin()]} />
 * ```
 */
import { createElement } from 'react'
import type { TanStackDevtoolsReactPlugin } from '@tanstack/react-devtools'

import { LiveStoreDevtoolsPanel } from './panel.tsx'

export const liveStoreDevtoolsPlugin = (): TanStackDevtoolsReactPlugin => ({
  id: 'livestore-tanstack-db',
  name: 'LiveStore',
  render: createElement(LiveStoreDevtoolsPanel),
})

export { LiveStoreDevtoolsPanel } from './panel.tsx'
export { useLiveStoreDevtoolsBridge, registerCollection } from './bridge.ts'
export type { LiveStoreDevtoolsEvents } from './events.ts'