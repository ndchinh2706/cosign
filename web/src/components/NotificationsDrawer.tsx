'use client'

import Link from 'next/link'
import { Icon, IdentityChip, QuorumSeal, RiskChip, type Person } from './ui'

export type Notification = {
  id: string
  group: 'approval' | 'agent' | 'security'
  title: string
  body?: string
  request_id?: string | null
  requester?: Person
  tier?: string
  approvals?: number
  required?: number
  read?: boolean
  ts: string
}
export type NotificationFeed = { unread: number; groups: { id: string; label: string; items: Notification[] }[] }

const ATLAS: Person = { username: 'ai-oncall-agent', display_name: 'Atlas', type: 'agent' }

// S3: docs/SCREENS.md. Approvals first, then agent activity, then security events.
export function NotificationsDrawer({ feed, roles, onClose }: { feed: NotificationFeed; roles: string[]; onClose: () => void }) {
  const reviewHref = (id: string) => (roles.includes('security-lead') ? `/governance/requests/${id}` : `/requests/${id}`)
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,10,.35)', zIndex: 40 }} />
      <aside aria-label="Notifications" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 100vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow)', zIndex: 41, display: 'flex', flexDirection: 'column', animation: 'cs-in 200ms ease' }}>
        <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Notifications</h2>
          <button className="btn btn-icon" style={{ border: 'none' }} onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {feed.groups.map((g) => (
            <section key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: g.id === 'approval' ? 10 : 2 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>{g.label}</h3>
              {!g.items.length && <p className="muted" style={{ margin: 0 }}>{g.id === 'approval' ? 'Nothing waiting on you.' : 'Nothing yet.'}</p>}
              {g.items.map((n) =>
                g.id === 'approval' ? (
                  <div key={n.id} className="card" style={{ display: 'flex', gap: 12, padding: 14, background: 'var(--surface-2)' }}>
                    <IdentityChip person={n.requester ?? ATLAS} size="md" avatarOnly />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ lineHeight: 1.45 }}>{n.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {n.tier && <RiskChip tier={n.tier} />}
                        {n.request_id && <span className="mono muted" style={{ fontSize: 12 }}>{n.request_id}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <QuorumSeal required={n.required ?? 2} approvals={Array.from({ length: n.approvals ?? 0 }, () => ({ username: '' }))} size={38} />
                      {n.request_id && (
                        <Link href={reviewHref(n.request_id)} onClick={onClose} className="btn" style={{ height: 26, padding: '0 10px', fontSize: 12 }}>
                          Review
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={n.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
                    <span style={{ width: 6, height: 6, marginTop: 7, borderRadius: '50%', flex: 'none', background: g.id === 'security' ? 'var(--refused)' : 'var(--text-muted)' }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>{n.title}</span>
                      {n.body && <span className="muted" style={{ fontSize: 12 }}>{n.body}</span>}
                    </div>
                    <span className="muted" style={{ fontSize: 12 }}>{n.ts.slice(11, 16)}</span>
                  </div>
                ),
              )}
            </section>
          ))}
        </div>
      </aside>
    </>
  )
}
