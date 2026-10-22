'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { apiPost } from '@/lib/api'
import { API_MODE } from '@/lib/config'
import { agentNeverHolds, approvalState, denyRequest, type ChangeRequest } from '@/lib/requests'
import { useSession } from '@/lib/session'
import { useCosignSocket } from '@/lib/ws'
import { toast } from './AppShell'
import { Icon, IdentityChip, QuorumSeal, RiskChip } from './ui'

const STATUS_C: Record<string, string> = { pending: 'var(--pending)', approved: 'var(--ok)', denied: 'var(--refused)' }
const CHECK = { pass: ['check', 'var(--ok)'], fail: ['cross', 'var(--refused)'], warn: ['alert', 'var(--pending)'], info: ['info', 'var(--text-muted)'] } as const

// Approve & sign: POST approve, show ORK progress from signing.progress (mock: local ticks).
export function useSign(cr: ChangeRequest | undefined, onDone: (next: ChangeRequest) => void) {
  const [nodes, setNodes] = useState<number | null>(null)
  const { me } = useSession()
  const { on } = useCosignSocket([])
  useEffect(() => on('signing.progress', (e) => {
    const p = e.payload as { request_id: string; ork_done: number }
    if (API_MODE === 'live' && p.request_id === cr?.id) setNodes(p.ork_done)
  }), [on, cr?.id])
  const sign = async () => {
    if (!cr) return
    setNodes(0)
    let tick: ReturnType<typeof setInterval> | undefined
    if (API_MODE === 'mock') tick = setInterval(() => setNodes((n) => Math.min(20, (n ?? 0) + 2)), 80)
    try {
      const [next] = await Promise.all([API_MODE === 'mock' ? mockApprove(cr, me?.user) : apiPost<ChangeRequest>(`/requests/${cr.id}/approve`, { duration_min: cr.duration_min }), new Promise((r) => setTimeout(r, API_MODE === 'mock' ? 900 : 0))])
      setNodes(20)
      onDone(next)
    } catch (e) {
      toast({ kind: 'refused', title: 'Signing failed.', body: (e as Error).message })
      setNodes(null)
    } finally {
      clearInterval(tick)
    }
  }
  return { nodes, sign, reset: () => setNodes(null) }
}

// Mock approve fixtures are fixed to CR-0192, so mock adds the signer to cr itself.
function mockApprove(cr: ChangeRequest, user?: { username: string; display_name: string }): ChangeRequest {
  if (!user) throw new Error('Not signed in.')
  const signed_by = [...cr.quorum.signed_by, { username: user.username, display_name: user.display_name, signed_at: new Date().toISOString(), signature: 'sig:mock', ork_nodes: '14/20' }]
  return { ...cr, status: signed_by.length >= cr.quorum.required ? 'approved' : 'pending', quorum: { ...cr.quorum, signed_by, approvals: signed_by.length } }
}

export function RequestReview({ cr, onChange, security, children }: { cr: ChangeRequest; onChange: (cr: ChangeRequest) => void; security?: boolean; children?: ReactNode }) {
  const { me } = useSession()
  const [modal, setModal] = useState(false)
  const blocked = me ? approvalState(cr, me.user.username, me.roles, me.user.type) : 'Loading…'
  const flagged = security && cr.flags.includes('injection')
  const forbidden = agentNeverHolds(cr)
  const signed = cr.quorum.signed_by
  const n = signed.length
  const progress = cr.apply_status === 'failed' ? 'Quorum reached · Tide did not apply the role' : cr.status === 'approved' ? `Quorum reached · ${n} of ${cr.quorum.required}` : cr.status === 'pending' ? `${n} of ${cr.quorum.required} approvals${n ? ` · waiting for ${cr.quorum.required - n} more` : ''}` : cr.status
  const deny = async (quarantine = false) => {
    try {
      onChange(await denyRequest(cr, { reason: 'Denied in review', quarantine_agent_context: quarantine }))
      toast({ kind: 'refused', title: `${cr.id} denied.`, body: quarantine ? 'Agent context quarantined.' : undefined })
    } catch (e) {
      toast({ kind: 'refused', title: 'Deny failed.', body: (e as Error).message })
    }
  }
  const approveBtn = <button className={flagged ? 'btn' : 'btn btn-primary'} style={{ flex: flagged ? 'none' : 1, height: 44, fontSize: 14 }} disabled={!!blocked || forbidden} onClick={() => setModal(true)}>Approve &amp; sign{flagged ? ` · requires ${cr.quorum.required} of ${cr.quorum.required}` : ''}</button>
  const denyBtn = <button className="btn" style={{ height: 44, padding: '0 18px', fontSize: 14, color: flagged ? 'var(--on-fill)' : 'var(--refused)', background: flagged ? 'var(--refused)' : undefined, borderColor: 'var(--refused)', flex: 'none' }} disabled={!!blocked} onClick={() => deny()}>Deny</button>

  return (
    // ponytail: flex-wrap instead of a media query; bases and grows keep the 1.35:1 split, stacking below ~820px.
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
      <div style={{ flex: '1.35 1 459px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 className="mono" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{cr.id}</h2>
            <span className="pill" style={{ ['--c' as string]: STATUS_C[cr.status] ?? 'var(--text-muted)' }}>{cr.status}</span>
            {cr.flags.includes('injection') && <span className="pill" style={{ ['--c' as string]: 'var(--refused)' }}>Flagged · injection</span>}
            {cr.requester.username === cr.target_user && cr.requester.type === 'human' && <span className="pill" style={{ ['--c' as string]: 'var(--refused)' }}>Flagged · self-grant</span>}
            <span style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 12 }}>created {cr.created_at.slice(11, 19)}{cr.incident_id ? ` · ${cr.incident_id}` : ''}</span>
          </div>
          <IdentityChip person={cr.requester} size="lg" sub="handle" />
          <dl style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', rowGap: 12, columnGap: 16, margin: 0 }}>
            <dt className="muted">Capability</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}><code>{cr.roles.join(', ')}</code></dd>
            <dt className="muted">Target</dt><dd style={{ margin: 0 }}><code>{cr.target_user}</code></dd>
            <dt className="muted">Scope</dt>
            <dd style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {cr.scope?.record_ids?.length && !cr.scope.unscoped ? (
                <>{cr.scope.count.toLocaleString('en-US')} records {cr.scope.record_ids.map((id) => <code key={id} style={{ fontSize: 12, padding: '2px 7px', borderRadius: 4, background: 'var(--surface-2)' }}>{id}</code>)}</>
              ) : (
                <span style={{ color: 'var(--refused)' }}>realm-wide · no record limit{cr.scope?.unscoped ? ` (${cr.scope.count.toLocaleString('en-US')} records)` : ''}</span>
              )}
            </dd>
            <dt className="muted">Duration</dt><dd style={{ margin: 0 }}>{cr.duration_min ? `${cr.duration_min} minutes` : 'permanent'}</dd>
          </dl>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Justification</h3>
            <blockquote style={{ margin: 0, padding: '12px 16px', borderRadius: 6, background: 'var(--surface-2)', fontSize: 14, lineHeight: 1.55 }}>&ldquo;{cr.justification}&rdquo;</blockquote>
          </div>
        </section>
        {!!cr.evidence?.log_excerpt?.length && (
          <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10, borderColor: flagged ? 'var(--refused)' : 'var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: flagged ? 'var(--refused)' : undefined }}>{flagged ? 'Why flagged' : 'Evidence'}</h3>
            {flagged && <p style={{ margin: 0 }}>Requested by the agent right after it processed a log line flagged as prompt injection ({cr.escalation_reason}).</p>}
            <div className="mono muted" style={{ fontSize: 12, lineHeight: 1.65, background: 'var(--surface-2)', borderRadius: 6, padding: '10px 12px' }}>
              {cr.evidence.log_excerpt.map((l) => <div key={l} style={flagged ? { color: 'var(--text)', textDecoration: 'underline', textDecorationColor: 'var(--warn)', textDecorationThickness: 2, textUnderlineOffset: 4 } : undefined}>{l}</div>)}
            </div>
          </section>
        )}
        {children}
      </div>

      <aside className="card" style={{ flex: '1 1 340px', minWidth: 0, position: 'sticky', top: 'calc(var(--topbar-h) + 16px)', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <QuorumSeal required={cr.quorum.required} approvals={signed} size={150} sig={signed.at(-1)?.signature} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <RiskChip tier={cr.tier} elevated={cr.escalated ? `↑ +1 tier: ${cr.escalation_reason}` : undefined} />
            <span style={{ fontSize: 14, fontWeight: 600, color: cr.apply_status === 'failed' ? 'var(--refused)' : STATUS_C[cr.status] === 'var(--pending)' ? 'var(--text)' : STATUS_C[cr.status] }}>{progress}</span>
            {cr.tide_change_request_id && <code className="muted" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>Tide CR {cr.tide_change_request_id}</code>}
            <span className="muted" style={{ fontSize: 12 }}>Requester cannot approve</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>Eligible approvers</h3>
          {cr.quorum.eligible.map((e) => {
            const s = signed.find((x) => x.username === e.username)
            const req = e.username === cr.requester.username
            return (
              <div key={e.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                <IdentityChip person={e} size="sm" sub="role" />
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: s ? 'var(--ok)' : 'var(--text-muted)' }}>{req ? 'requester · not counted' : s ? `signed ${s.signed_at.slice(11, 19)}` : cr.status === 'pending' ? 'pending' : '—'}</span>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Safety checks</h3>
          {cr.safety_checks.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, lineHeight: 1.45 }}>
              <Icon name={CHECK[c.status][0]} size={14} color={CHECK[c.status][1]} style={{ marginTop: 3 }} />
              <span>{c.label}{c.detail && <span className="muted">: {c.detail}</span>}</span>
            </div>
          ))}
        </div>
        {cr.status === 'pending' && (
          <div style={{ display: 'flex', flexDirection: flagged ? 'column' : 'row', gap: 8 }}>
            {flagged ? <>{denyBtn}<button className="btn" style={{ height: 40, color: 'var(--refused)', borderColor: 'var(--refused)' }} disabled={!!blocked} onClick={() => deny(true)}>Deny &amp; quarantine agent context</button>{approveBtn}</> : <>{approveBtn}{denyBtn}</>}
          </div>
        )}
        {!blocked && forbidden && cr.status === 'pending' && <p style={{ margin: 0, padding: '12px 14px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--refused)' }}>Agents can never hold roles.grant. Deny this request.</p>}
        {blocked && <p style={{ margin: 0, padding: '12px 14px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{blocked}</p>}
        <p className="muted" style={{ margin: 0, fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>Reducing authority is instant. Increasing authority requires quorum.</p>
      </aside>
      {modal && <SignModal cr={cr} onClose={() => setModal(false)} onSigned={onChange} />}
    </div>
  )
}

// E4: confirm, then watch the threshold signature collect across ORK nodes.
export function SignModal({ cr, onClose, onSigned }: { cr: ChangeRequest; onClose: () => void; onSigned: (cr: ChangeRequest) => void }) {
  const [result, setResult] = useState<ChangeRequest | null>(null)
  const { nodes, sign } = useSign(cr, (next) => {
    setResult(next)
    onSigned(next)
  })
  const view = result ?? cr
  const done = result ? result.quorum.signed_by.length : 0
  const step = result ? 3 : nodes === null ? -1 : nodes < 14 ? 1 : 2
  return (
    <div role="dialog" aria-label="Sign with Tide" style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,10,.55)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'cs-in 160ms ease' }}>
      <div className="card" data-screen="E4" style={{ width: 'min(620px, 94vw)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: '22px 26px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Sign with Tide</h2>
            <span className="muted">Approve {cr.id} · grant {cr.roles.join(' + ')} to {cr.target_user}</span>
          </div>
          <button className="btn btn-icon" style={{ border: 'none' }} onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div style={{ padding: '24px 26px', display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
          <QuorumSeal required={view.quorum.required} approvals={view.quorum.signed_by} size={150} sig={view.quorum.signed_by.at(-1)?.signature} />
          <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {['Verify identity', 'Sign', 'Submit to quorum'].map((label, i) => (
                <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, color: step >= i ? 'var(--text)' : 'var(--text-muted)', fontWeight: step === i + 1 ? 600 : 400 }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, border: `1px solid ${step > i ? 'var(--ok)' : 'var(--border)'}`, background: step > i ? 'var(--ok)' : 'transparent', color: step > i ? 'var(--on-fill)' : undefined }}>{i + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            {nodes !== null && !result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-live="polite">
                <span className="muted">Collecting threshold signature… <span style={{ color: 'var(--text)' }}>{nodes} / 20 ORK nodes</span></span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(20,1fr)', gap: 3 }}>
                  {Array.from({ length: 20 }, (_, i) => <div key={i} style={{ height: 6, borderRadius: 2, background: i < nodes ? 'var(--accent)' : 'var(--border)', transition: 'background 150ms' }} />)}
                </div>
              </div>
            )}
            {result?.apply_status === 'failed' && <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--refused)' }}>Quorum reached, but Tide did not apply the role. No access was granted.</div>}
            {result && result.apply_status !== 'failed' && <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ok)' }}>{result.status === 'approved' ? `Quorum reached · ${done} of ${result.quorum.required} approvals` : `${done} of ${result.quorum.required} approvals · waiting for ${result.quorum.required - done} more`}</div>}
          </div>
        </div>
        <div style={{ padding: '16px 26px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--surface-2)' }}>
          {result ? <button className="btn" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose} disabled={nodes !== null}>Cancel</button><button className="btn btn-primary" onClick={sign} disabled={nodes !== null}>Approve &amp; sign</button></>}
        </div>
      </div>
    </div>
  )
}
