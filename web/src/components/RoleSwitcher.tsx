'use client'

import { useRouter } from 'next/navigation'
import { TIDE_MODE } from '@/lib/config'
import { useSession } from '@/lib/session'
import { DEMO_USERS } from '@/lib/users'
import { useReplay } from '@/lib/ws'

// Storyboard controls float at the bottom, like the prototype's demo bar.
export function ReplayControls() {
  const r = useReplay()
  const done = r.index >= r.total
  return (
    <div className="card desk" style={{ position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 50, display: 'flex', alignItems: 'center', gap: 4, padding: 6, fontSize: 12, boxShadow: 'var(--shadow)' }}>
      <span className="muted" style={{ padding: '0 6px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.beat ?? 'Storyboard'}</span>
      <button className="btn" style={{ height: 28, padding: '0 10px' }} onClick={r.playing ? r.pause : r.play} disabled={done && !r.playing}>
        {r.playing ? 'Pause' : 'Play'}
      </button>
      <button className="btn" style={{ height: 28, padding: '0 10px' }} onClick={r.nextBeat} disabled={done || r.playing} title={r.beat ?? 'End of storyboard'}>
        Next beat
      </button>
      <button className="btn" style={{ height: 28, padding: '0 10px' }} onClick={r.reset} title="Reset storyboard">
        Reset
      </button>
      <span className="muted" style={{ minWidth: 40 }}>
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
      <div role="tablist" aria-label="Demo as" style={{ display: 'flex', alignItems: 'center', gap: 4, height: 34 }}>
        <span className="muted" style={{ fontSize: 12, paddingRight: 4, whiteSpace: 'nowrap' }}>Demo as</span>
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
                height: 34,
                padding: '0 8px',
                border: 0,
                borderBottom: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 500,
                color: active ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: u.type === 'agent' ? 1 : '50%', background: u.color }} />
              {u.short}
            </button>
          )
        })}
      </div>
    </>
  )
}
