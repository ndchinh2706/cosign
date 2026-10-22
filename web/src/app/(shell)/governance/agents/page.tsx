'use client'

import Link from 'next/link'
import { useState } from 'react'
import { toast } from '@/components/AppShell'
import { AuthorityMeter, IdentityChip, type Authority } from '@/components/ui'
import { apiPost, useApi } from '@/lib/api'

export type Agent = { username: string; display_name: string; type: 'agent'; purpose: string; model: string; status: string; authority: Authority[]; runs_today: number; last_action: { ts: string; label: string } | null; flags: string[] }
type Revoked = { revoked: string[]; withdrawn_requests: string[]; run_paused: string | null; note: string }

const STATUS_C: Record<string, string> = { waiting_approval: 'var(--pending)', elevated: 'var(--pending)', revoked: 'var(--refused)', running: 'var(--ok)', active: 'var(--ok)' }

// L4: every agent identity, what it holds, and the kill switch that takes it all back at once.
export default function Agents() {
  const { data, mutate } = useApi<{ items: Agent[] }>('/agents')
  const [busy, setBusy] = useState(false)
  const revokeAll = async () => {
    setBusy(true)
    try {
      const r = await apiPost<Revoked>('/agents/ai-oncall-agent/revoke-all')
      toast({ kind: 'ok', title: 'Elevated access revoked.', body: `${r.revoked.join(', ') || 'nothing held'} · ${r.withdrawn_requests.length} requests withdrawn · ${r.note}` })
      mutate()
    } catch (e) {
      toast({ kind: 'refused', title: 'Revoke failed.', body: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-screen="L4" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1500 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1>Agents</h1>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <button className="btn" style={{ height: 38, color: 'var(--refused)', borderColor: 'var(--refused)' }} onClick={revokeAll} disabled={busy}>Revoke all elevated access</button>
          <span className="muted" style={{ fontSize: 12 }}>Reducing authority is instant, no quorum.</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 16, alignItems: 'start' }}>
        {data?.items.map((a) => (
          <section key={a.username} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Link href={`/governance/agents/${a.username}`}><IdentityChip person={a} size="md" sub="handle" /></Link>
              <span style={{ fontSize: 12, fontWeight: 500, color: STATUS_C[a.status] ?? 'var(--text-muted)' }}>{a.status.replace('_', ' ')}</span>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: 0 }}>
              <dt className="muted">Purpose</dt><dd style={{ margin: 0 }}>{a.purpose}</dd>
              <dt className="muted">Model</dt><dd style={{ margin: 0 }}><code style={{ fontSize: 12 }}>{a.model}</code></dd>
              <dt className="muted">Runs today</dt><dd style={{ margin: 0 }}>{a.runs_today}</dd>
              <dt className="muted">Last action</dt><dd style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.last_action ? a.last_action.label : <span className="muted">—</span>}</dd>
            </dl>
            <AuthorityMeter items={a.authority} title="Authority" />
          </section>
        ))}
      </div>
    </div>
  )
}
