'use client'

import { useRouter } from 'next/navigation'
import { TIDE_MODE } from '@/lib/config'
import { useSession } from '@/lib/session'
import { DEMO_USERS } from '@/lib/users'

export function RoleSwitcher() {
  const { demoUser, switchUser } = useSession()
  const router = useRouter()
  const live = TIDE_MODE === 'live'

  return (
    <div role="tablist" style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
      {DEMO_USERS.map((u) => {
        const active = !live && u.username === demoUser
        return (
          <button
            key={u.username}
            role="tab"
            aria-selected={active}
            title={live ? 'Opens a new session' : u.username}
            onClick={() => {
              if (live) return void window.open(`/login?as=${u.username}`, '_blank')
              switchUser(u.username)
              router.push(u.home)
            }}
            style={{
              padding: '4px 10px',
              border: 0,
              cursor: 'pointer',
              background: active ? 'var(--surface-2)' : 'transparent',
              color: active ? (u.type === 'agent' ? 'var(--agent)' : 'var(--text)') : 'var(--text-muted)',
            }}
          >
            {u.short}
          </button>
        )
      })}
    </div>
  )
}
