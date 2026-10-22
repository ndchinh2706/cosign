'use client'

import Link from 'next/link'
import { use, useEffect } from 'react'
import { Icon } from '@/components/ui'
import { useApi } from '@/lib/api'
import { SCREENS } from '@/lib/screens'
import { useMe } from '@/lib/session'
import { useCosignSocket } from '@/lib/ws'

type Summary = {
  run_id: string
  incident_id: string
  resolved_at: string | null
  mttr_min: number
  actions: { total: number; auto: number; approved: number; blocked: number }
  authority_returned: { capability: string; revoked_at: string; reason: string }[]
}

// A6: what the run did, and proof that the authority it borrowed went back.
export default function RunSummary({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: s, error, mutate } = useApi<Summary>(`/agent/runs/${id}/summary`)
  const roles = useMe()?.roles ?? []
  const { on } = useCosignSocket([`run:${id}`, `incident:${s?.incident_id ?? 'INC-2417'}`])
  useEffect(() => on('request.expired', () => mutate()), [on, mutate])
  const cell = { padding: '14px 20px', display: 'flex', flexDirection: 'column' as const, gap: 4 }
  return (
    <div data-screen="A6" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 880 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1>Run summary</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          <span className="mono">{id}</span> · {s?.incident_id ?? 'INC-2417'} {s && (s.resolved_at ? `resolved at ${s.resolved_at.slice(11, 16)}` : 'in progress')}
        </span>
      </div>
      {error && <p style={{ color: 'var(--refused)' }}>Couldn&apos;t load the run summary. {error.message}</p>}
      {s && (
        <>
          {!s.resolved_at && <div className="card" style={{ padding: '12px 16px' }}>Run still in progress · figures are provisional</div>}
          <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
            <div style={cell}><span className="muted" style={{ fontSize: 12 }}>Resolved</span><span style={{ fontSize: 24, fontWeight: 500 }}>{s.resolved_at?.slice(11, 16) ?? '—'}</span></div>
            <div style={{ ...cell, borderLeft: '1px solid var(--border)' }}><span className="muted" style={{ fontSize: 12 }}>Time to resolve</span><span style={{ fontSize: 24, fontWeight: 500 }}>{s.mttr_min} <span className="muted" style={{ fontSize: 14 }}>min</span></span></div>
            <div style={{ ...cell, borderLeft: '1px solid var(--border)' }}>
              <span className="muted" style={{ fontSize: 12 }}>Actions</span>
              <span style={{ fontSize: 24, fontWeight: 500 }}>{s.actions.total}</span>
              <span className="muted" style={{ fontSize: 12 }}>{s.actions.auto} auto · {s.actions.approved} approved · {s.actions.blocked} blocked</span>
            </div>
          </div>
          <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Authority returned</h2>
            {s.authority_returned.map((a) => (
              <div key={a.capability} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="check" size={14} color="var(--ok)" />
                <code>{a.capability}</code>
                <span className="muted">revoked at {a.revoked_at.slice(11, 16)} · {a.reason}</span>
              </div>
            ))}
            {!s.authority_returned.length && <span className="muted">No borrowed authority returned yet. Active grants are revoked automatically when they expire.</span>}
          </section>
          <div style={{ display: 'flex', gap: 10 }}>
            {SCREENS.C2.roles.some((r) => roles.includes(r)) && <Link className="btn btn-primary" href={`/audit/receipts/${s.incident_id}`}>View access receipt</Link>}
            {roles.includes('agent') && <Link className="btn" href="/agent">Back to console</Link>}
          </div>
        </>
      )}
    </div>
  )
}
