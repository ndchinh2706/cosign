'use client'

import Link from 'next/link'
import { use, useState } from 'react'
import { IdentityChip, RiskChip } from '@/components/ui'
import { useApi } from '@/lib/api'

type Timeline = { items: { id: string; ts: string; actor_type: string; actor: string; label: string; outcome: string }[] }
type Access = { items: { id: string; requester: { username: string; display_name: string; type: 'agent' | 'human' }; capability: string; tier: string; escalated: boolean; status: string; approvals: number; required: number; flags: string[] }[] }
type Incident = { id: string; title: string; status: string; severity: string; started_at: string }

const OUT: Record<string, string> = { allowed: 'var(--text-muted)', refused: 'var(--refused)', blocked: 'var(--refused)', pending: 'var(--pending)', flagged: 'var(--pending)', approved: 'var(--ok)' }

// E2: everything that happened in one incident, and who asked for what.
export default function WarRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [tab, setTab] = useState<'timeline' | 'access'>('timeline')
  const { data: inc } = useApi<Incident>(`/incidents/${id}`)
  const { data: tl } = useApi<Timeline>(`/incidents/${id}/timeline`)
  const { data: access } = useApi<Access>(`/incidents/${id}/access`)
  return (
    <div data-screen="E2" style={{ padding: '24px 32px 100px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="mono muted">{id}</span>
        <h1>{inc?.title ?? 'War room'}</h1>
        {inc && <span className="pill" style={{ ['--c' as string]: 'var(--pending)' }}>{inc.status}</span>}
        <span style={{ flex: 1 }} />
        <Link className="btn" href="/agent">Agent console</Link>
      </div>
      <div role="tablist" style={{ display: 'flex', gap: 20, borderBottom: '1px solid var(--border)' }}>
        {(['timeline', 'access'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ height: 34, padding: 0, border: 'none', borderBottom: `1px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, background: 'transparent', cursor: 'pointer', color: tab === t ? 'var(--text)' : 'var(--text-muted)', fontWeight: 500 }}>
            {t === 'timeline' ? 'Timeline' : `Access requests${access ? ` · ${access.items.length}` : ''}`}
          </button>
        ))}
      </div>
      {tab === 'timeline' ? (
        <ol className="card" style={{ listStyle: 'none', margin: 0, padding: '8px 0' }}>
          {tl?.items.map((t) => (
            <li key={t.id} style={{ display: 'grid', gridTemplateColumns: '80px 170px minmax(0,1fr) 90px', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--rule)', alignItems: 'center' }}>
              <span className="muted">{t.ts.slice(11, 19)}</span>
              <IdentityChip person={{ username: t.actor, display_name: t.actor, type: t.actor_type === 'agent' ? 'agent' : 'human' }} size="xs" />
              <span>{t.label}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: OUT[t.outcome] ?? 'var(--text-muted)', textAlign: 'right' }}>{t.outcome}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="card">
          {access?.items.map((r) => (
            <Link key={r.id} href={`/requests/${r.id}`} style={{ display: 'grid', gridTemplateColumns: '90px 150px minmax(0,1fr) 150px 60px 80px', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--rule)', alignItems: 'center' }}>
              <span className="mono">{r.id}</span>
              <IdentityChip person={r.requester} size="xs" />
              <span style={{ display: 'flex', flexDirection: 'column' }}><code>{r.capability}</code>{r.flags.includes('injection') && <span style={{ fontSize: 12, color: 'var(--refused)' }}>flagged · injection</span>}</span>
              <RiskChip tier={r.tier} />
              <span>{r.approvals}/{r.required}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: OUT[r.status] }}>{r.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
