'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'
import { useTide } from '@/lib/tide'

export default function LoginPage() {
  const { login, authenticated, mode } = useTide()
  const router = useRouter()
  useEffect(() => {
    if (mode === 'live' && authenticated) router.push('/')
  }, [mode, authenticated, router])

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <ScreenPlaceholder id="S1" />
        <div style={{ padding: '0 28px 24px' }}>
          <button
            onClick={() => (mode === 'live' ? login() : router.push('/'))}
            style={{ background: 'var(--accent)', color: '#0b0d12', border: 0, borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}
          >
            Continue with Tide
          </button>
        </div>
      </div>
    </div>
  )
}
