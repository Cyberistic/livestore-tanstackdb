import { useEffect } from 'react'
import {
  registerCollection,
  useLiveStoreDevtoolsBridge,
} from '@cyberistic/livestore-tanstack-db/devtools'

import { useAppStore } from '../livestore/store.ts'
import { useTodoCollection } from '../db/todoCollection.ts'

export const LiveStoreDevtoolsBridge: React.FC = () => {
  const store = useAppStore()
  const todosCollection = useTodoCollection()

  useLiveStoreDevtoolsBridge(store)

  useEffect(() => {
    registerCollection('Todo', todosCollection)
  }, [todosCollection])

  return null
}
