'use client'

import Link from 'next/link'
import { use } from 'react'
import { RequestReview } from '@/components/RequestReview'
import { useRequest } from '@/lib/requests'

// L2: the security view of a change request: why it was flagged and what it would unlock.
export default function SecurityReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { cr, set, all, error } = useRequest(id)
  const wide = cr?.roles.includes('realm-admin')
  return (
    <div data-screen="L2" style={{ padding: '24px 32px 100px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1>Approvals</h1>
        <span className="muted" style={{ fontSize: 14 }}>Security view · includes flagged requests</span>
      </div>
      <nav aria-label="Change requests" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
        {all.map((r) => (
          <Link key={r.id} href={`/governance/requests/${r.id}`} aria-current={r.id === id ? 'page' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, borderBottom: `1px solid ${r.id === id ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, color: r.id === id ? 'var(--text)' : 'var(--text-muted)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.flags.length ? 'var(--refused)' : 'var(--pending)' }} />
            <span className="mono">{r.id}</span>
          </Link>
        ))}
      </nav>
      {error && <p style={{ color: 'var(--refused)' }}>Couldn&apos;t load {id}. {error.message}</p>}
      {cr && (
        <RequestReview cr={cr} onChange={set} security>
          {wide && (
            <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Blast radius preview</h3>
              <span>If approved, {cr.target_user} could:</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['read all 48,201 customer records', 'grant roles to any identity', 'export data', 'edit the quorum policy'].map((t) => <span key={t} style={{ padding: '6px 10px', borderRadius: 4, background: 'var(--surface-2)' }}>{t}</span>)}
              </div>
            </section>
          )}
        </RequestReview>
      )}
    </div>
  )
}
