'use client'

import { TideCloakProvider } from '@tidecloak/nextjs'
import { useEffect, type ReactNode } from 'react'
import tcConfig from '../../tidecloak.json'
import { setTokenGetter } from '@/lib/api'
import { TIDE_MODE } from '@/lib/config'
import { useTide } from '@/lib/tide'

function TokenBridge() {
  const { getToken } = useTide()
  useEffect(() => {
    setTokenGetter(getToken)
    return () => setTokenGetter(null)
  }, [getToken])
  return null
}

export function Providers({ children }: { children: ReactNode }) {
  if (TIDE_MODE !== 'live') return <>{children}</>
  return (
    <TideCloakProvider config={tcConfig}>
      <TokenBridge />
      {children}
    </TideCloakProvider>
  )
}
