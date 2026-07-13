import { FPSMeter } from '@overengineering/fps-meter'
import type React from 'react'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'

import { storeRegistry, StoreRegistryProvider } from './livestore/store.ts'

const errorBoundaryFallback = <div>Something went wrong</div>
const suspenseFallback = <div>Loading app...</div>
const fpsContainerStyle = { top: 0, right: 0, position: 'absolute', background: '#333' } as const

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

/**
 * Mirrors the canonical `examples/web-todomvc-sync-cf` shape:
 *   - `StoreRegistryProvider` owns the store lifecycle
 *   - `useStore` (called inside `<Header />` / `<MainSection />` / `<Footer />`)
 *     registers retain/release effects automatically
 *   - No custom `LiveStoreProvider` or store.commit patching — the
 *     devtools bridge we added previously was racing with the
 *     registry's retain path and shutting the store down mid-commit.
 *
 * If you need to wire oRPC, drop an `oRPC={...}` prop here later.
 */
export const App: React.FC = () => (
  <ErrorBoundary fallback={errorBoundaryFallback}>
    <Suspense fallback={suspenseFallback}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <div style={fpsContainerStyle}>
          <FPSMeter height={40} />
        </div>
        <AppBody />
        <VersionBadge />
      </StoreRegistryProvider>
    </Suspense>
  </ErrorBoundary>
)