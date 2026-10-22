'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { apiPost, useApi } from '@/lib/api'
import { approvalState, useRequests } from '@/lib/requests'
import { navFor, screenFor } from '@/lib/screens'
import { useSession } from '@/lib/session'
import { useTide } from '@/lib/tide'
import { useCosignSocket, type Envelope } from '@/lib/ws'
import { Icon, IdentityChip, Mark, type ICONS } from './ui'
import { NotificationsDrawer, type Notification, type NotificationFeed } from './NotificationsDrawer'
import { ReplayControls, RoleSwitcher } from './RoleSwitcher'
import { API_MODE } from '@/lib/config'

type Incident = { id: string; service: string; status: string; started_at: string; resolved_at: string | null; run_id?: string }
type Toast = { id: string; kind: string; title: string; body?: string }

// Pages raise a toast without prop drilling: toast({ kind, title, body }).
export const toast = (t: Omit<Toast, 'id'>) => window.dispatchEvent(new CustomEvent('cosign:toast', { detail: t }))

const hhmm = (iso?: string | null) => (iso ? iso.slice(11, 16) : '')
const TOAST_C: Record<string, string> = { ok: 'var(--ok)', refused: 'var(--refused)', warn: 'var(--pending)', pending: 'var(--pending)' }

// Theme lives on <html data-theme>; the root layout applies the saved choice before paint.
function useTheme() {
  return () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('cosign.theme', next)
    } catch {}
  }
}

// Live Tide: wait for the SDK, then send signed-out users to /login before any API call fires.
export function AuthGate({ children }: { children: ReactNode }) {
  const { mode, ready, authenticated } = useTide()
  const router = useRouter()
  const blocked = mode === 'live' && !(ready && authenticated)
  useEffect(() => {
    if (mode === 'live' && ready && !authenticated) router.replace('/login')
  }, [mode, ready, authenticated, router])
  return blocked ? null : <>{children}</>
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, demoUser } = useSession()
  const { hasRealmRole, logout } = useTide()
  const pathname = usePathname()
  const router = useRouter()
  const toggleTheme = useTheme()
  const nav = navFor(me?.roles ?? [])

  // Route guard (docs/SCREENS.md §1.1): wrong role goes to its own home.
  useEffect(() => {
    const s = screenFor(pathname)
    if (me && s && !s.roles.includes('*') && !s.roles.some(hasRealmRole)) router.replace(me.home)
  }, [me, pathname, hasRealmRole, router])

  const { data: incident, setData: setIncident } = useApi<Incident>('/incidents/INC-2417')
  const { data: feed, setData: setFeed, mutate: refetchFeed } = useApi<NotificationFeed>(me ? `/notifications?as=${demoUser}` : null)
  const { data: reqs } = useRequests()
  const [drawer, setDrawer] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const { on } = useCosignSocket(['incident:INC-2417', `user:${demoUser}`, ...(incident?.run_id ? [`run:${incident.run_id}`] : [])])

  useEffect(() => {
    const mine = (e: Envelope) => !e.channel?.startsWith('user:') || e.channel === `user:${demoUser}`
    const offs = [
      on('incident.updated', (e) => setIncident((i) => (i ? { ...i, ...(e.payload as Partial<Incident>) } : i))),
      on('notification', (e) => {
        if (!mine(e)) return
        // live payloads lack requester and body, so reload the feed; the mock replay merges.
        if (API_MODE === 'live') return refetchFeed()
        const n = { ...(e.payload as unknown as Notification), ts: e.ts, read: false }
        setFeed((f) => {
          if (!f || f.groups.some((g) => g.items.some((i) => i.id === n.id))) return f
          return { unread: f.unread + 1, groups: f.groups.map((g) => (g.id === n.group ? { ...g, items: [n, ...g.items] } : g)) }
        })
      }),
      on('request.updated', (e) => {
        const r = e.payload as { id: string; status: string; quorum?: { approvals: number } }
        // Decided requests drop out of the approval group; their unread items leave the bell count too.
        setFeed((f) => f && { ...f, unread: Math.max(0, f.unread - (f.groups.find((g) => g.id === 'approval')?.items.filter((i) => i.request_id === r.id && r.status !== 'pending' && !i.read).length ?? 0)), groups: f.groups.map((g) => (g.id !== 'approval' ? g : { ...g, items: g.items.flatMap((i) => (i.request_id !== r.id ? [i] : r.status === 'pending' ? [{ ...i, approvals: r.quorum?.approvals ?? i.approvals }] : [])) })) })
      }),
      on('toast', (e) => {
        if (!mine(e)) return
        const t = { id: e.id, ...(e.payload as { kind: string; title: string; body?: string }) }
        setToasts((ts) => [...ts, t].slice(-3))
        setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 4800)
      }),
    ]
    const local = (e: Event) => {
      const t = { id: Math.random().toString(36).slice(2), ...(e as CustomEvent<Omit<Toast, 'id'>>).detail }
      setToasts((ts) => [...ts, t].slice(-3))
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 4800)
    }
    window.addEventListener('cosign:toast', local)
    return () => {
      offs.forEach((off) => off())
      window.removeEventListener('cosign:toast', local)
    }
  }, [on, demoUser, setIncident, setFeed, refetchFeed])

  // Same count as E1 "Waiting on you".
  const approvals = (reqs?.items ?? []).filter((r) => me && !approvalState(r, me.user.username, me.roles, me.user.type)).length
  const markRead = (id: string) => {
    apiPost(`/notifications/${id}/read`).catch(() => {})
    setFeed((f) => f && { unread: Math.max(0, f.unread - 1), groups: f.groups.map((g) => ({ ...g, items: g.items.map((i) => (i.id === id ? { ...i, read: true } : i)) })) })
  }
  const resolved = incident?.status === 'resolved'

  return (
    <div className="shell">
      <aside className="rail">
        <Link href="/" style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Cosign home">
          <Mark />
        </Link>
        <nav aria-label="Main">
          {nav.map((n) => (
            <Link key={n.label} href={n.href} className="rail-item" title={n.label} aria-label={n.label} aria-current={pathname === n.href ? 'page' : undefined}>
              <Icon name={n.icon as keyof typeof ICONS} />
              {n.label === 'Approvals' && approvals > 0 && <span className="rail-badge">{approvals}</span>}
            </Link>
          ))}
        </nav>
        <div style={{ padding: '12px 0' }}>
          <button className="rail-item" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }} title="Sign out" aria-label="Sign out" onClick={() => void logout().then(() => router.push('/login'))}>
            <Icon name="signout" />
          </button>
        </div>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header className="topbar">
          <div className="desk wide" style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Northwind Pay</span>
            <span className="mono muted" style={{ fontSize: 12 }}>northwind-prod</span>
          </div>
          {incident && (
            <Link href={me?.roles.includes('agent') ? '/agent' : `/incidents/${incident.id}`} className="btn" style={{ gap: 8, minWidth: 0, overflow: 'hidden' }}>
              <span style={{ width: 6, height: 6, flex: 'none', borderRadius: '50%', background: resolved ? 'var(--ok)' : 'var(--refused)' }} />
              <span className="mono">{incident.id}</span>
              <span className="muted">·</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{incident.service} {incident.status}</span>
              <span className="muted desk">· {hhmm(resolved ? incident.resolved_at : incident.started_at)}</span>
            </Link>
          )}
          <div className="desk wide card" style={{ flex: '0 1 200px', height: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', color: 'var(--text-muted)' }}>
            <Icon name="search" size={14} />
            <span style={{ flex: 1 }}>Search</span>
            <span style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '0 5px' }}>⌘K</span>
          </div>
          <span style={{ flex: 1 }} />
          <div className="desk" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RoleSwitcher />
          </div>
          <button className="btn btn-icon desk" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
            <Icon name="theme" />
          </button>
          <button className="btn btn-icon" style={{ position: 'relative', color: 'var(--text)' }} onClick={() => setDrawer(true)} title="Notifications" aria-label="Notifications">
            <Icon name="bell" />
            {!!feed?.unread && (
              <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--refused)', color: 'var(--on-fill)', fontSize: 11, fontWeight: 600, lineHeight: '18px' }}>
                {feed.unread}
              </span>
            )}
          </button>
          {me && <IdentityChip person={me.user} size="sm" avatarOnly />}
        </header>
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>

      {API_MODE === 'mock' && <ReplayControls />}
      {drawer && feed && <NotificationsDrawer feed={feed} roles={me?.roles ?? []} onClose={() => setDrawer(false)} onRead={markRead} />}

      <div style={{ position: 'fixed', bottom: 72, right: 16, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8, width: 316 }} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="card" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))} style={{ display: 'flex', gap: 10, padding: '12px 14px', boxShadow: 'var(--shadow)', animation: 'cs-in 220ms ease', cursor: 'pointer' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: TOAST_C[t.kind] ?? 'var(--accent)', marginTop: 5, flex: 'none' }} />
            <span>
              <b style={{ fontWeight: 600 }}>{t.title}</b> {t.body && <span className="muted">{t.body}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
