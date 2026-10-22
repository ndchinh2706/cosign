'use client'

import Link from 'next/link'
import { use } from 'react'
import { AuthorityMeter, IdentityChip, RiskChip } from '@/components/ui'
import { useApi } from '@/lib/api'
import type { Agent } from '../page'

type Detail = Agent & { runs: { id: string; incident_id: string; status: string; started_at: string; steps_count: number }[]; requests: { id: string; change: string; tier: string; status: string }[]; injection_events?: { id: string; text: string; label: string; score: number; lang: string; ts: string; quarantined: boolean }[] }

export default function AgentDetail({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params)
  const { data: d, error } = useApi<Detail>(`/agents/${username}`)
  // ponytail: mock maps every /agents/:u to Atlas's detail; fall back to the list card for other agents
  const { data: list } = useApi<{ items: Agent[] }>(d && d.username !== username ? '/agents' : null)
  const card = list?.items.find((x) => x.username === username)
  const a: Detail | undefined = d && d.username !== username ? card && { ...card, runs: [], requests: [], injection_events: [] } : d
  return (
    <div data-screen="L4D" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1100 }}>
      <Link className="muted" href="/governance/agents">Agents</Link>
      {error && <p style={{ color: 'var(--refused)' }}>Couldn&apos;t load {username}. {error.message}</p>}
      {a && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <h1>{a.display_name}</h1>
            <IdentityChip person={a} size="sm" sub="handle" avatarOnly />
            <code className="muted">{a.model}</code>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 18, alignItems: 'start' }}>
            <AuthorityMeter items={a.authority} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Runs</h2>
                {a.runs.map((r) => <div key={r.id} style={{ display: 'flex', gap: 12 }}><span className="mono">{r.id}</span><span>{r.incident_id}</span><span className="muted">{r.steps_count} steps · {r.status.replace('_', ' ')}</span></div>)}
              </section>
              <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Requests</h2>
                {a.requests.map((r) => <Link key={r.id} href={`/governance/requests/${r.id}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}><span className="mono">{r.id}</span><span>{r.change}</span><RiskChip tier={r.tier} /><span className="muted">{r.status}</span></Link>)}
              </section>
              <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Injection events</h2>
                {!a.injection_events?.length && <span className="muted">No injection events.</span>}
                {a.injection_events?.map((e) => (
                  <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ color: 'var(--refused)' }}>{e.label} · {e.score.toFixed(2)} · {e.lang}</span><span className="muted">{e.ts.slice(11, 19)}</span>{e.quarantined && <span className="muted">quarantined</span>}</span>
                    <code className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.text}</code>
                  </div>
                ))}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
