'use client'

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { useApi } from './api'
import { API_MODE } from './config'
import { getDemoUser, setDemoUser, subscribeDemoUser } from './users'

export type AuthorityItem = { capability: string; state: 'allowed' | 'locked' | 'pending' | 'granted'; expires_at?: string; reason?: string; tide_role?: string }
export type Me = {
  user: { username: string; display_name: string; type: 'agent' | 'human'; email: string; avatar: string }
  roles: string[]
  home: string
  authority: AuthorityItem[]
  open_requests: number
  context_flagged: boolean
}

type Session = { me?: Me; loading: boolean; demoUser: string; switchUser: (u: string) => void; refresh: () => void }
const SessionCtx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const demoUser = useSyncExternalStore(subscribeDemoUser, getDemoUser, () => '')
  const { data: me, loading, mutate } = useApi<Me>(demoUser ? `/me?as=${demoUser}` : null) // ?as= only re-keys the fetch on switch
  return (
    <SessionCtx.Provider value={{ me, loading, demoUser, switchUser: setDemoUser, refresh: mutate }}>
      {children}
    </SessionCtx.Provider>
  )
}

export function useSession() {
  const s = useContext(SessionCtx)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}

export const useMe = () => useSession().me
export const isMock = API_MODE === 'mock'
