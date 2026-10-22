'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { API_MODE, TIDE_MODE } from '@/lib/config'
import { navFor } from '@/lib/screens'
import { useSession } from '@/lib/session'
import { RoleSwitcher } from './RoleSwitcher'

export function AppShell({ children }: { children: ReactNode }) {
  const { me } = useSession()
  const pathname = usePathname()
  const nav = navFor(me?.roles ?? [])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'var(--sidebar-w) 1fr', minHeight: '100vh' }}>
      <aside style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)', padding: 16 }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>
          Cosign
        </Link>
        <nav style={{ marginTop: 24, display: 'grid', gap: 2 }}>
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: pathname === n.href ? 'var(--surface-2)' : 'transparent',
              }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            height: 'var(--topbar-h)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '0 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          {/* TODO: IncidentBanner, search, notifications bell (S3) */}
          <span className="mono" style={{ fontSize: 12, color: 'var(--refused)' }}>
            ● INC-2417 · payments-api degraded · 03:12
          </span>
          <span style={{ flex: 1 }} />
          <span className="mono muted" style={{ fontSize: 11 }}>
            api:{API_MODE} · tide:{TIDE_MODE}
          </span>
          <RoleSwitcher />
          <span className="mono" style={{ fontSize: 12 }}>
            {me?.user.display_name ?? '…'}
          </span>
        </header>
        <main style={{ flex: 1 }}>{children}</main>
      </div>
    </div>
  )
}
