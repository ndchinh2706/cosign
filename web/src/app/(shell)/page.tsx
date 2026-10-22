'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'
import { useMe } from '@/lib/session'

export default function RoleHome() {
  const me = useMe()
  const router = useRouter()
  useEffect(() => {
    if (me?.home) router.replace(me.home)
  }, [me, router])
  return <ScreenPlaceholder id="S2" />
}
