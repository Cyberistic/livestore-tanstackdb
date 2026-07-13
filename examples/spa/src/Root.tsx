import { FPSMeter } from '@overengineering/fps-meter'
import { TanStackDevtools } from '@tanstack/react-devtools'
import type React from 'react'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { MainSection } from './components/MainSection.tsx'
import { VersionBadge } from './components/VersionBadge.tsx'

import { storeRegistry, StoreRegistryProvider } from './livestore/store.ts'

import { liveStoreDevtoolsPlugin, LiveStoreDevtoolsBridge } from 'livestore-tanstack-db/devtools'

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

export const App: React.FC = () => (
  <ErrorBoundary fallback={errorBoundaryFallback}>
    <Suspense fallback={suspenseFallback}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <div style={fpsContainerStyle}>
          <FPSMeter height={40} />
        </div>
        <AppBody />
        <VersionBadge />
        <LiveStoreDevtoolsBridge />
        <TanStackDevtools plugins={[liveStoreDevtoolsPlugin()]} />
      </StoreRegistryProvider>
    </Suspense>
  </ErrorBoundary>
)