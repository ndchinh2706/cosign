'use client'

import type { ReactNode } from 'react'
import { TIDE_MODE } from '@/lib/config'

export function LiveOnly({ children }: { children: ReactNode }) {
  if (TIDE_MODE !== 'live') {
    return <p style={{ padding: '2rem' }}>Requires NEXT_PUBLIC_TIDE_MODE=live and a provisioned tidecloak.json.</p>
  }
  return <>{children}</>
}
