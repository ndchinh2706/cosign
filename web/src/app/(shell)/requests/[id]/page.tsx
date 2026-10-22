'use client'

import Link from 'next/link'
import { use } from 'react'
import { RequestReview } from '@/components/RequestReview'
import { useRequest } from '@/lib/requests'

// E3: an approver reviews one change request; E4 opens from Approve & sign.
export default function ApprovalReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { cr, set, all, error } = useRequest(id)
  return (
    <div data-screen="E3" style={{ padding: '24px 32px 100px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1>Approvals</h1>
        <span className="muted" style={{ fontSize: 14 }}>{all.filter((r) => r.status === 'pending').length} change requests waiting on the quorum</span>
      </div>
      <nav aria-label="Change requests" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
        {all.map((r) => (
          <Link key={r.id} href={`/requests/${r.id}`} aria-current={r.id === id ? 'page' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, borderBottom: `1px solid ${r.id === id ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, color: r.id === id ? 'var(--text)' : 'var(--text-muted)' }}>
            <span className="mono">{r.id}</span>
            <span style={{ fontSize: 12 }}>{r.capability}</span>
          </Link>
        ))}
      </nav>
      {error && <p style={{ color: 'var(--refused)' }}>Couldn&apos;t load {id}. {error.message}</p>}
      {cr ? <RequestReview cr={cr} onChange={set} /> : !error && <p className="muted">Loading {id}…</p>}
    </div>
  )
}
