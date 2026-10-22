'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { Icon, IdentityChip, Mark } from '@/components/ui'
import { useSession } from '@/lib/session'
import { useTide } from '@/lib/tide'
import { DEMO_USERS, findUser } from '@/lib/users'

const NODES = 20
const THRESHOLD = 14

// S1: docs/SCREENS.md. Live mode hands off to Tide; mock mode plays the node proof locally.
function SignIn() {
  const { login, authenticated, mode } = useTide()
  const { switchUser } = useSession()
  const router = useRouter()
  const as = useSearchParams().get('as')
  const [username, setUsername] = useState(as ?? 'linh.tran')
  const [nodes, setNodes] = useState<number | null>(null)

  useEffect(() => {
    if (mode === 'live' && authenticated) router.push('/')
  }, [mode, authenticated, router])

  const signIn = (name: string) => {
    if (mode === 'live') return void login()
    const u = findUser(name) ?? DEMO_USERS.find((d) => d.username.startsWith(name.toLowerCase())) ?? DEMO_USERS[1]
    setUsername(u.username)
    setNodes(0)
    let n = 0
    const t = setInterval(() => {
      n += 1
      setNodes(n)
      if (n >= THRESHOLD) {
        clearInterval(t)
        setTimeout(() => {
          switchUser(u.username)
          router.push(u.home)
        }, 700)
      }
    }, 90)
  }

  const proving = nodes !== null && nodes < THRESHOLD
  const proven = nodes !== null && nodes >= THRESHOLD

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, padding: 24 }}>
      <div className="card" style={{ width: 'min(440px, 100%)', padding: 36, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mark size={28} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>Cosign</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>Sign in to Northwind Pay</h1>
          <p className="muted" style={{ margin: 0 }}>Production access for AI agents, without god keys.</p>
        </div>

        {nodes === null && (
          <form onSubmit={(e) => (e.preventDefault(), signIn(username))} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8, fontWeight: 500 }}>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} className="mono" style={{ height: 40, borderRadius: 6, border: '1px solid var(--control)', background: 'var(--surface)', color: 'var(--text)', padding: '0 12px', fontSize: 14 }} />
            </label>
            <button type="submit" className="btn btn-primary" style={{ height: 44, fontSize: 14 }}>
              Continue with Tide
            </button>
          </form>
        )}
        {proving && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} aria-live="polite">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'cs-spin 800ms linear infinite' }} />
              <span style={{ fontSize: 14 }}>
                Proving identity to Tide network… <span className="muted">{nodes} / {NODES} nodes</span>
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${NODES},1fr)`, gap: 4 }}>
              {Array.from({ length: NODES }, (_, i) => (
                <div key={i} style={{ height: 6, borderRadius: 2, background: i < (nodes ?? 0) ? 'var(--accent)' : 'var(--border)', transition: 'background 200ms' }} />
              ))}
            </div>
          </div>
        )}
        {proven && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ok)', fontWeight: 600 }}>
            <Icon name="check" size={18} />
            Identity proven · {THRESHOLD}/{NODES} nodes signed
          </div>
        )}

        <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <Icon name="shield" size={14} />
          Zero-knowledge sign-in · no password is stored on any server.
        </div>
      </div>

      {mode === 'mock' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>Demo · quick login</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {DEMO_USERS.map((u) => (
              <button key={u.username} className="btn" style={{ height: 'auto', padding: '10px 14px 10px 10px' }} onClick={() => signIn(u.username)} disabled={nodes !== null}>
                <IdentityChip person={{ username: u.username, display_name: u.displayName, type: u.type }} size="sm" sub="role" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  )
}
