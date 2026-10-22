// Shared pieces ported from design/prototype: IdentityChip, QuorumSeal, RiskChip, Icon.
import type { CSSProperties } from 'react'
import { findUser } from '@/lib/users'

export const ICONS = {
  terminal: 'M2.5 4l3.5 3.5L2.5 11M8 12h5.5',
  key: 'M10 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM7.5 8.5L2.5 13.5M4 12l1.5 1.5',
  inbox: 'M2 9h3.5l1 2h3l1-2H14M3.5 3h9L14 9v4H2V9z',
  alert: 'M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.2',
  check: 'M3 8.5l3 3 7-7',
  cross: 'M4 4l8 8M12 4l-8 8',
  server: 'M2.5 2.5h11v4.5h-11zM2.5 9h11v4.5h-11zM5 4.75h.1M5 11.25h.1',
  shield: 'M8 1.8l5.2 2v4c0 3.2-2.3 5.4-5.2 6.4-2.9-1-5.2-3.2-5.2-6.4v-4z',
  hex: 'M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z',
  doc: 'M4 1.8h5.5L12.5 5v9.2H4zM9.5 1.8V5h3M6 8.5h4.5M6 11h4.5',
  users: 'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M11 2.8a2.5 2.5 0 0 1 0 4.6M12.5 9.8c1.3.6 2 2 2 4.2',
  db: 'M2.5 3.5c0-1 2.5-1.8 5.5-1.8s5.5.8 5.5 1.8v9c0 1-2.5 1.8-5.5 1.8s-5.5-.8-5.5-1.8zM2.5 3.5c0 1 2.5 1.8 5.5 1.8s5.5-.8 5.5-1.8M2.5 8c0 1 2.5 1.8 5.5 1.8s5.5-.8 5.5-1.8',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1',
  lock: 'M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2',
  clock: 'M8 4.5V8l2.5 1.5M8 14a6 6 0 1 1 0-12 6 6 0 0 1 0 12z',
  bell: 'M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.5 10.5L14 14',
  theme: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 2.5v11',
  signout: 'M6 2.5H3.5v11H6M10 5l3 3-3 3M13 8H6.5',
  close: 'M4 4l8 8M12 4l-8 8',
  info: 'M8 7v5M8 4.2v.1',
} as const

export function Icon({ name, size = 16, color = 'currentColor', style }: { name: keyof typeof ICONS; size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }} aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  )
}

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-label="Cosign">
      <circle cx="14" cy="14" r="11" stroke="var(--border)" strokeWidth="3" />
      <path d="M14 3a11 11 0 0 1 10.4 14.6" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M22.2 21.4A11 11 0 0 1 4 18" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export type Person = { username: string; display_name: string; type?: 'agent' | 'human' }

const tint = (c: string) => ({ background: `color-mix(in oklch, ${c} 24%, var(--surface))`, color: `color-mix(in oklch, ${c} 45%, var(--text))` })

export function IdentityChip({ person, size = 'md', sub, avatarOnly }: { person: Person; size?: 'xs' | 'sm' | 'md' | 'lg'; sub?: 'role' | 'handle'; avatarOnly?: boolean }) {
  const u = findUser(person.username)
  const agent = (person.type ?? u?.type) === 'agent'
  const px = { xs: 20, sm: 26, md: 32, lg: 44 }[size]
  const initials = u?.initials ?? person.display_name.slice(0, 2).toUpperCase()
  const color = u?.color ?? '#8A92A3'
  const subText = sub === 'handle' ? `${person.username}@northwind` : sub === 'role' ? u?.role : ''
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: px < 26 ? 6 : 10, minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: px, height: px, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.round(px * 0.36), fontWeight: 600,
          ...(agent
            ? { clipPath: 'polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)', background: 'color-mix(in oklch, var(--agent) 26%, var(--surface))', color: 'var(--text)' }
            : { borderRadius: '50%', ...tint(color) }),
        }}
      >
        {initials}
      </span>
      {!avatarOnly && (
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 }}>
          <span style={{ fontSize: px >= 44 ? 16 : px <= 20 ? 12 : 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{person.display_name}</span>
          {subText && <span className={sub === 'handle' ? 'mono muted' : 'muted'} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{subText}</span>}
        </span>
      )}
    </span>
  )
}

const TIERS = ['T0 · auto', 'T1 · 1 of 2', 'T2 · 2 of 3', 'T3 · 3 of 3']
const TIER_C = ['var(--text-muted)', 'var(--accent)', 'var(--pending)', 'var(--refused)']

export function RiskChip({ tier, label, elevated }: { tier: number | string; label?: string; elevated?: string }) {
  const t = typeof tier === 'string' ? Number(tier.replace(/\D/g, '')) || 0 : tier
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="pill" style={{ ['--c' as string]: TIER_C[t] }}>{label ?? TIERS[t]}</span>
      {elevated && <span style={{ fontSize: 12, color: 'var(--refused)' }}>{elevated}</span>}
    </span>
  )
}

export type SealApproval = { username: string }

// Ring of `required` arcs; filled arcs are approvals, all green once the threshold is met.
export function QuorumSeal({ required, approvals, size = 96, sig }: { required: number; approvals: SealApproval[]; size?: number; sig?: string }) {
  const k = Math.max(1, required)
  const n = Math.min(approvals.length, k)
  const done = n >= k
  const r = 40
  const gap = k === 1 ? 0.0001 : 14
  const rad = (d: number) => (d * Math.PI) / 180
  const av = Math.round(size * 0.24)
  const segs = Array.from({ length: k }, (_, i) => {
    const span = 360 / k
    const a0 = -90 + i * span + gap / 2
    const a1 = a0 + span - gap
    const p = (a: number) => `${(50 + r * Math.cos(rad(a))).toFixed(2)} ${(50 + r * Math.sin(rad(a))).toFixed(2)}`
    const d = k === 1 ? 'M50 10 A40 40 0 1 1 49.99 10' : `M${p(a0)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`
    const len = r * rad(k === 1 ? 360 : a1 - a0)
    const mid = rad((a0 + a1) / 2)
    return { d, len, filled: i < n, ax: 50 + 50 * Math.cos(mid), ay: 50 + 50 * Math.sin(mid), who: approvals[i] && findUser(approvals[i].username) }
  })
  const sw = size < 40 ? 11 : size < 80 ? 8 : 6
  const pad = size >= 64 ? Math.ceil(av / 2) + 4 : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flex: 'none', padding: pad }} aria-label={`${n} of ${k} approvals`}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
          {segs.map((s, i) => (
            <g key={i}>
              <path d={s.d} fill="none" stroke="var(--border)" strokeWidth={sw} strokeLinecap="round" />
              <path d={s.d} fill="none" stroke={done ? 'var(--ok)' : 'var(--accent)'} strokeWidth={sw} strokeLinecap="round" strokeDasharray={s.len} strokeDashoffset={s.filled ? 0 : s.len} style={{ transition: 'stroke-dashoffset 1000ms cubic-bezier(.65,0,.25,1), stroke 600ms' }} />
            </g>
          ))}
        </svg>
        {size >= 34 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: Math.round(size * 0.2), color: done ? 'var(--ok)' : 'var(--text)', letterSpacing: '-0.02em' }}>{n} / {k}</div>
            {size >= 90 && <div className="muted" style={{ fontSize: Math.max(12, Math.round(size * 0.075)) }}>{done ? 'signed' : 'approvals'}</div>}
          </div>
        )}
        {size >= 64 &&
          segs.map((s, i) =>
            s.filled && s.who ? (
              <div key={i} style={{ position: 'absolute', left: `${s.ax}%`, top: `${s.ay}%`, width: av, height: av, margin: -av / 2, borderRadius: '50%', outline: '3px solid var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(av * 0.38), fontWeight: 600, ...tint(s.who.color) }}>
                {s.who.initials}
              </div>
            ) : null,
          )}
      </div>
      {done && sig && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ok)', fontSize: 12, fontWeight: 600 }}>
            <Icon name="check" size={12} />
            Threshold-signed
          </span>
          <span className="mono muted" style={{ fontSize: 12 }}>{sig}</span>
        </div>
      )}
    </div>
  )
}

export type Authority = { capability: string; state: 'allowed' | 'locked' | 'pending' | 'granted'; expires_at?: string; reason?: string }

const AUTH = {
  allowed: { icon: 'check', c: 'var(--ok)', label: 'Allowed' },
  locked: { icon: 'lock', c: 'var(--text-muted)', label: 'Locked' },
  pending: { icon: 'clock', c: 'var(--pending)', label: 'Pending' },
  granted: { icon: 'clock', c: 'var(--text)', label: 'Granted' },
} as const

// What an identity can do right now. Increases need quorum; reductions are instant.
export function AuthorityMeter({ items, title = 'Current authority', pendingSeal }: { items: Authority[]; title?: string; pendingSeal?: { required: number; approvals: SealApproval[] } }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h2>
      <div className="card" style={{ overflow: 'hidden' }}>
        {items.map((r) => {
          const a = AUTH[r.state]
          const sub = r.state === 'granted' && r.expires_at ? `Access expires at ${r.expires_at.slice(11, 16)}` : r.reason
          return (
            <div key={r.capability} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 42, padding: '8px 12px', borderBottom: '1px solid var(--rule)' }}>
              <Icon name={a.icon} size={14} color={a.c} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <code style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.capability}</code>
                {sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}
              </div>
              {r.state === 'pending' && pendingSeal && <QuorumSeal required={pendingSeal.required} approvals={pendingSeal.approvals} size={26} />}
              <span style={{ fontSize: 12, fontWeight: 500, color: a.c }}>{a.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
