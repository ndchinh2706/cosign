'use client'

import { useEffect, useState } from 'react'
import { Icon, IdentityChip } from '@/components/ui'
import { apiPost, useApi } from '@/lib/api'
import { findUser } from '@/lib/users'
import { useCosignSocket } from '@/lib/ws'

type AuditEvent = {
  id: string
  ts: string
  actor: string
  actor_type: 'agent' | 'human' | 'system'
  action: string
  target: string
  outcome: string
  incident_id: string | null
  request_id: string | null
  payload: Record<string, unknown>
  signers: string[]
  signature: string
  prev_hash: string
  hash: string
  verified: boolean
}
type Verify = { id: string; verified: boolean; ork_nodes: string; verified_at: string; method: string }

const GROUP: Record<string, string> = { allowed: 'allowed', signed: 'allowed', approved: 'allowed', refused: 'refused', blocked: 'refused', denied: 'refused', pending: 'pending' }
const COLOR: Record<string, string> = { allowed: 'var(--ok)', refused: 'var(--refused)', pending: 'var(--pending)' }
const FILTERS = [
  { key: 'actor', label: 'Actor', opts: [['all', 'All'], ['human', 'Human'], ['agent', 'Agent'], ['system', 'System']] },
  { key: 'outcome', label: 'Outcome', opts: [['all', 'All'], ['allowed', 'Allowed'], ['refused', 'Refused'], ['pending', 'Pending']] },
] as const
type Filter = { actor: string; outcome: string }

const byTsDesc = (a: AuditEvent, b: AuditEvent) => b.ts.localeCompare(a.ts)

// C1: every action, hash-chained and threshold-signed; pick a row to re-verify its signature.
export default function AuditTrail() {
  const { data, error, loading } = useApi<{ items: AuditEvent[] }>('/audit')
  const [live, setLive] = useState<AuditEvent[]>([])
  const [filter, setFilter] = useState<Filter>({ actor: 'all', outcome: 'all' })
  const [sel, setSel] = useState<AuditEvent | null>(null)
  const { on } = useCosignSocket(['global'])

  useEffect(() => on('audit.appended', (e) => {
    const ev = e.payload as unknown as AuditEvent
    setLive((l) => (l.some((x) => x.id === ev.id) ? l : [ev, ...l]))
  }), [on])

  const seen = new Set(live.map((e) => e.id))
  const events = [...live, ...(data?.items ?? []).filter((e) => !seen.has(e.id)).sort(byTsDesc)].filter(
    (e) => (filter.actor === 'all' || e.actor_type === filter.actor) && (filter.outcome === 'all' || GROUP[e.outcome] === filter.outcome),
  )
  const td = { padding: '10px 16px' }

  return (
    <div data-screen="C1" style={{ display: 'grid', gridTemplateColumns: sel ? 'minmax(0,1fr) 400px' : 'minmax(0,1fr)', minHeight: 'calc(100vh - var(--topbar-h))' }}>
      <div style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0, maxWidth: 1400 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>Audit trail</h1>
          <span className="muted" style={{ fontSize: 14 }}>Every event is hash-chained and threshold-signed by the Tide network.</span>
        </div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          {FILTERS.map((g) => (
            <div key={g.key} role="group" aria-label={g.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="muted" style={{ fontSize: 12, marginRight: 6 }}>{g.label}</span>
              {g.opts.map(([v, label]) => {
                const on = filter[g.key] === v
                return (
                  <button
                    key={v}
                    aria-pressed={on}
                    onClick={() => setFilter((f) => ({ ...f, [g.key]: v }))}
                    style={{ height: 34, padding: '0 8px', marginBottom: -1, border: 'none', borderBottom: `1px solid ${on ? 'var(--accent)' : 'transparent'}`, background: 'transparent', color: on ? 'var(--text)' : 'var(--text-muted)', fontWeight: 500, cursor: 'pointer' }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        {error && <p style={{ color: 'var(--refused)', margin: 0 }}>Couldn&apos;t load the audit trail. {error.message}</p>}
        {loading && !data && <p className="muted" style={{ margin: 0 }}>Loading events…</p>}
        {data && (
          <table className="card" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr className="muted" style={{ fontSize: 12, textAlign: 'left' }}>
                {[['Time', 92], ['Actor', 170], ['Action', 170], ['Target', undefined], ['Outcome', 96], ['Signature', 100]].map(([h, w]) => (
                  <th key={h} style={{ fontWeight: 400, padding: '10px 16px', borderBottom: '1px solid var(--border)', width: w }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const u = findUser(e.actor)
                const c = COLOR[GROUP[e.outcome]] ?? 'var(--text-muted)'
                const active = sel?.id === e.id
                return (
                  <tr
                    key={e.id}
                    onClick={() => setSel(active ? null : e)}
                    onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), setSel(active ? null : e))}
                    tabIndex={0}
                    aria-selected={active}
                    style={{ borderBottom: '1px solid var(--rule)', cursor: 'pointer', background: active ? 'color-mix(in oklch, var(--accent) 10%, var(--surface))' : undefined }}
                  >
                    <td className="muted" style={td}>{e.ts.slice(11, 19)}</td>
                    <td style={{ ...td, overflow: 'hidden' }}>
                      {u ? (
                        <IdentityChip person={{ username: u.username, display_name: u.displayName, type: u.type }} size="xs" />
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}><Icon name="server" size={14} color="var(--text-muted)" />{e.actor}</span>
                      )}
                    </td>
                    <td className="mono" style={{ ...td, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.action}</td>
                    <td style={{ ...td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.target}>{e.target}</td>
                    <td style={{ ...td, fontSize: 12, fontWeight: 500, color: c }}>{e.outcome}</td>
                    <td style={td}>
                      {e.verified ? (
                        <span title={`Signers: ${e.signers.join(', ')} · ${e.hash}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--ok)' }}>
                          <Icon name="check" size={12} />Verified
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>Unverified</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {events.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ padding: '28px 16px', textAlign: 'center' }}>No events match</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {sel && <AuditDetail key={sel.id} event={sel} onClose={() => setSel(null)} />}
    </div>
  )
}

function AuditDetail({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  const [state, setState] = useState<{ busy?: boolean; result?: Verify; failed?: string }>({})
  const verify = async () => {
    setState({ busy: true })
    try {
      setState({ result: await apiPost<Verify>(`/audit/${event.id}/verify`) })
    } catch (e) {
      setState({ failed: e instanceof Error ? e.message : String(e) })
    }
  }
  const ok = state.result?.verified
  const label = { fontSize: 12 }
  return (
    <aside aria-label="Event detail" style={{ borderLeft: '1px solid var(--border)', background: 'var(--surface)', padding: 20, display: 'flex', flexDirection: 'column', gap: 18, position: 'sticky', top: 'var(--topbar-h)', height: 'calc(100vh - var(--topbar-h))', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Event <span className="mono">{event.id}</span></h2>
        <button className="btn btn-icon" style={{ border: 'none', width: 28, height: 28 }} onClick={onClose} aria-label="Close detail"><Icon name="close" size={14} /></button>
      </div>
      <pre className="mono" style={{ margin: 0, padding: 14, borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {JSON.stringify(event, null, 2)}
      </pre>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="muted" style={label}>Signature</span>
        <code style={{ fontSize: 12 }}>{event.signature}</code>
        <span className="muted">Threshold-signed by the Tide network. No single party holds the key.</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="muted" style={label}>Hash chain</span>
        <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', rowGap: 4, fontSize: 12 }}>
          <span className="muted">Previous</span><code style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.prev_hash}</code>
          <span className="muted">This</span><code style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.hash}</code>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={verify} disabled={state.busy}>{state.busy ? 'Verifying…' : state.result ? 'Verify again' : 'Verify'}</button>
        {state.result && (
          <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: ok ? 'var(--ok)' : 'var(--refused)' }}>
            <Icon name={ok ? 'check' : 'cross'} size={12} />
            {ok ? `Verified · ${state.result.ork_nodes} ORK · ${state.result.verified_at.slice(11, 19)}` : 'Verification failed'}
          </span>
        )}
        {state.failed && <span role="status" style={{ fontSize: 12, color: 'var(--refused)' }}>Verification failed. {state.failed}</span>}
      </div>
    </aside>
  )
}
