'use client'

import Link from 'next/link'
import { IdentityChip, QuorumSeal, RiskChip } from '@/components/ui'
import { useApi } from '@/lib/api'
import { approvalState, useRequests } from '@/lib/requests'
import { useSession } from '@/lib/session'

type Incident = { id: string; title: string; service: string; severity: string; status: string; started_at: string; error_rate: number; owner_agent: string; owner_human: string; mini_timeline: { ts: string; label: string }[] }
type Incidents = { stats: { active_incidents: number; agent_runs_today: number; pending_approvals: number; mttr_7d_min: number }; items: Incident[] }
type Service = { name: string; health: string; error_rate: number; p95_ms: number; current_deploy: string }

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

// E1: Linh's on-call home. The one question: is anything waiting on me?
export default function IncidentsHome() {
  const { me } = useSession()
  const { data } = useApi<Incidents>('/incidents')
  const { data: services } = useApi<{ items: Service[] }>('/services')
  const { data: reqs } = useRequests()
  const mine = (reqs?.items ?? []).filter((r) => me && !approvalState(r, me.user.username, me.roles, me.user.type))
  const s = data?.stats
  const kpis: [string, string | number, string?][] = s ? [['Active incidents', s.active_incidents], ['Agent runs today', s.agent_runs_today], ['Waiting on you', mine.length, mine.length ? 'var(--pending)' : undefined], ['MTTR, last 7 days', `${s.mttr_7d_min} min`]] : []
  return (
    <div data-screen="E1" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1500 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1>Incidents</h1>
        <span className="muted" style={{ fontSize: 14 }}>{mine.length ? `${mine.length} change request${mine.length > 1 ? 's' : ''} waiting on your signature` : 'Nothing waiting on your signature'}</span>
      </div>
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        {kpis.map(([label, v, c], i) => (
          <div key={label} style={{ padding: '14px 20px', borderLeft: i ? '1px solid var(--border)' : 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>{label}</span>
            <span style={{ fontSize: 24, fontWeight: 500, color: c }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(320px,1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data?.items.map((inc) => (
            <section key={inc.id} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span className="mono muted">{inc.id}</span>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{inc.title}</h2>
                <span className="pill" style={{ ['--c' as string]: 'var(--refused)' }}>{inc.severity.replace('SEV-', 'Sev ')}</span>
                <span className="pill" style={{ ['--c' as string]: 'var(--pending)' }}>{inc.status}</span>
              </div>
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                <div><div className="muted" style={{ fontSize: 12 }}>Error rate at open</div><div style={{ fontSize: 24, fontWeight: 500, color: 'var(--refused)' }}>{pct(inc.error_rate)}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>Started</div><div style={{ fontSize: 24, fontWeight: 500 }}>{inc.started_at.slice(11, 16)}</div></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Owners</span>
                  <span style={{ display: 'flex', gap: 14 }}><IdentityChip person={{ username: inc.owner_agent, display_name: 'Atlas', type: 'agent' }} size="xs" /><IdentityChip person={{ username: inc.owner_human, display_name: 'Linh Tran' }} size="xs" /></span>
                </div>
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {inc.mini_timeline.map((t) => <li key={t.ts} style={{ display: 'flex', gap: 12 }}><span className="muted" style={{ width: 44 }}>{t.ts.slice(11, 16)}</span>{t.label}</li>)}
              </ol>
              <div><Link className="btn" href={`/incidents/${inc.id}`}>Open war room</Link></div>
            </section>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Needs your approval</h2>
            {!mine.length && <p className="muted" style={{ margin: 0 }}>Nothing waiting on you.</p>}
            {mine.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <QuorumSeal required={r.quorum.required} approvals={r.quorum.signed_by} size={38} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span><b style={{ fontWeight: 600 }}>{r.requester.display_name}</b> requests <code>{r.capability}</code></span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><RiskChip tier={r.tier} /><span className="mono muted" style={{ fontSize: 12 }}>{r.id}</span></span>
                </div>
                <Link className="btn" style={{ height: 30 }} href={`/requests/${r.id}`}>Review</Link>
              </div>
            ))}
          </section>
          <section className="card" style={{ overflow: 'hidden' }}>
            <h2 style={{ margin: 0, padding: '14px 18px', fontSize: 14, fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Services</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr className="muted" style={{ fontSize: 12 }}>{['Service', 'Deploy', 'Error rate', 'p95'].map((h, i) => <th key={h} style={{ fontWeight: 400, padding: '8px 18px', textAlign: i > 1 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
              <tbody>
                {services?.items.map((sv) => (
                  <tr key={sv.name} style={{ borderTop: '1px solid var(--rule)' }}>
                    <td style={{ padding: '10px 18px' }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', marginRight: 8, background: sv.health === 'ok' ? 'var(--ok)' : 'var(--pending)' }} />{sv.name}</td>
                    <td className="mono muted" style={{ padding: '10px 18px' }}>{sv.current_deploy}</td>
                    <td style={{ padding: '10px 18px', textAlign: 'right' }}>{pct(sv.error_rate)}</td>
                    <td style={{ padding: '10px 18px', textAlign: 'right' }}>{sv.p95_ms} <span className="muted">ms</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  )
}
