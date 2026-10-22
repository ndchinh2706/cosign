'use client'

import { useRouter } from 'next/navigation'
import { API_MODE, TIDE_MODE } from '@/lib/config'
import { useSession } from '@/lib/session'
import { DEMO_USERS } from '@/lib/users'
import { useReplay } from '@/lib/ws'

const ctrl = { padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }

function ReplayControls() {
  const r = useReplay()
  const done = r.index >= r.total
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
      <button style={ctrl} onClick={r.playing ? r.pause : r.play} disabled={done && !r.playing}>
        {r.playing ? 'Pause' : 'Play'}
      </button>
      <button style={ctrl} onClick={r.nextBeat} disabled={done || r.playing} title={r.beat ?? 'End of storyboard'}>
        Next beat
      </button>
      <button style={ctrl} onClick={r.reset} title="Reset storyboard">
        ↺
      </button>
      <span className="mono muted" style={{ fontSize: 11 }}>
        {r.index}/{r.total}
      </span>
    </div>
  )
}

export function RoleSwitcher() {
  const { demoUser, switchUser } = useSession()
  const router = useRouter()
  const live = TIDE_MODE === 'live'

  return (
    <>
      {API_MODE === 'mock' && <ReplayControls />}
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
    </>
  )
}
