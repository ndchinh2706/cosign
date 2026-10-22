'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useMe } from '@/lib/session'

// S2: send each role to its own home.
export default function RoleHome() {
  const me = useMe()
  const router = useRouter()
  useEffect(() => {
    if (me?.home) router.replace(me.home)
  }, [me, router])
  return <p className="muted" style={{ padding: '24px 32px' }}>Opening your home…</p>
}
