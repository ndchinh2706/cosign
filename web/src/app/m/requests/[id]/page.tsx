'use client'

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { useSign } from '@/components/RequestReview'
import { Icon, IdentityChip, QuorumSeal, RiskChip } from '@/components/ui'
import { toast } from '@/components/AppShell'
import { agentNeverHolds, approvalState, denyRequest, useRequest } from '@/lib/requests'
import { useSession } from '@/lib/session'

// E5: Linh approves from her phone. One column, the decision in the thumb zone.
export default function MobileApproval({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { me } = useSession()
  const { cr, set } = useRequest(id)
  const [checks, setChecks] = useState(false)
  const { nodes, sign } = useSign(cr, set)
  // /m has no AppShell toast host, so show toasts (signing and deny failures) inline.
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent<{ title: string; body?: string }>).detail
      setErr([t.title, t.body].filter(Boolean).join(' '))
    }
    window.addEventListener('cosign:toast', h)
    return () => window.removeEventListener('cosign:toast', h)
  }, [])
  if (!cr) return <p className="muted" style={{ padding: 20 }}>Loading {id}…</p>
  const blocked = me ? approvalState(cr, me.user.username, me.roles, me.user.type) : 'Loading…'
  const mine = cr.quorum.signed_by.some((s) => s.username === me?.user.username)
  const passed = cr.safety_checks.filter((c) => c.status === 'pass').length

  if (nodes !== null && !mine)
    return (
      <main data-screen="E5" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 30 }} aria-live="polite">
        <span style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'cs-spin 800ms linear infinite' }} />
        <h1 style={{ fontSize: 20 }}>Signing with Tide</h1>
        <span className="muted">{nodes} / 20 ORK nodes</span>
        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(20,1fr)', gap: 3 }}>{Array.from({ length: 20 }, (_, i) => <div key={i} style={{ height: 6, borderRadius: 2, background: i < nodes ? 'var(--accent)' : 'var(--border)' }} />)}</div>
      </main>
    )

  const failed = cr.apply_status === 'failed'
  if (mine)
    return (
      <main data-screen="E5" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 30, textAlign: 'center' }}>
        <QuorumSeal required={cr.quorum.required} approvals={cr.quorum.signed_by} size={200} />
        <h1 style={{ fontSize: 26, color: failed ? 'var(--refused)' : 'var(--ok)' }}>Signed · {cr.quorum.signed_by.length} of {cr.quorum.required}</h1>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{failed ? 'Quorum reached, but Tide did not apply the role. No access was granted.' : cr.apply_status === 'awaiting_signature' ? 'Quorum reached. Waiting for a Tide admin to sign; Atlas gets nothing until Tide applies the role.' : cr.status === 'approved' ? 'Quorum reached. Access is granted for the approved window only.' : `Waiting for ${cr.quorum.required - cr.quorum.signed_by.length} more approver. Atlas gets nothing until the quorum is complete.`}</p>
        <Link className="btn" style={{ height: 46, padding: '0 26px', fontSize: 16 }} href="/incidents">Done</Link>
      </main>
    )

  return (
    <main data-screen="E5" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 14px' }}>
        <Link href="/incidents" className="btn btn-icon" style={{ width: 44, height: 44, borderRadius: '50%' }} aria-label="Back"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5" /></svg></Link>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ fontSize: 20 }}>Approval request</h1>
          <span className="mono muted" style={{ fontSize: 12 }}>{cr.id}{cr.incident_id ? ` · ${cr.incident_id}` : ''}</span>
        </div>
      </header>
      <div style={{ flex: 1, padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <IdentityChip person={cr.requester} size="md" sub="handle" />
          <code style={{ wordBreak: 'break-all' }}>{cr.roles.join(', ')}</code>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: '10px 12px', borderRadius: 6, background: 'var(--surface-2)' }}><div className="muted" style={{ fontSize: 12 }}>Scope</div><div style={{ fontSize: 16, fontWeight: 600 }}>{cr.scope?.record_ids?.length && !cr.scope.unscoped ? `${cr.scope.count} records` : 'realm-wide'}</div></div>
            <div style={{ padding: '10px 12px', borderRadius: 6, background: 'var(--surface-2)' }}><div className="muted" style={{ fontSize: 12 }}>Duration</div><div style={{ fontSize: 16, fontWeight: 600 }}>{cr.duration_min ? `${cr.duration_min} min` : 'permanent'}</div></div>
          </div>
          <RiskChip tier={cr.tier} />
        </section>
        <section className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
          <QuorumSeal required={cr.quorum.required} approvals={cr.quorum.signed_by} size={96} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{cr.quorum.signed_by.length} of {cr.quorum.required} signed</span>
            <span className="muted">{cr.quorum.eligible.map((e) => e.display_name.split(' ')[0]).join(', ')} eligible · requester cannot approve</span>
          </div>
        </section>
        <button className="card" onClick={() => setChecks((c) => !c)} aria-expanded={checks} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', cursor: 'pointer' }}>
          <span style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color="var(--ok)" />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>Safety checks · {passed} passed</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ transform: `rotate(${checks ? 90 : 0}deg)`, transition: 'transform 150ms' }}><path d="M6 3l5 5-5 5" /></svg>
          </span>
          {checks && cr.safety_checks.map((c) => <span key={c.id} className="muted" style={{ display: 'flex', gap: 8 }}><Icon name={c.status === 'pass' ? 'check' : c.status === 'fail' ? 'cross' : 'info'} size={14} style={{ marginTop: 2 }} />{c.label}</span>)}
        </button>
      </div>
      <footer style={{ position: 'sticky', bottom: 0, padding: '12px 20px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
        {blocked ? (
          <span className="muted" style={{ padding: '16px 0', fontSize: 14 }}>{blocked}</span>
        ) : (
          <>
            {err && <span role="alert" style={{ color: 'var(--refused)', fontSize: 14, textAlign: 'center' }}>{err}</span>}
            {agentNeverHolds(cr) ? (
              <span style={{ color: 'var(--refused)', padding: '8px 0', fontSize: 14 }}>Agents can never hold roles.grant. Deny this request.</span>
            ) : (
              <button className="btn btn-primary" style={{ width: '100%', height: 56, fontSize: 16 }} onClick={() => { setErr(null); void sign() }}>Approve &amp; sign</button>
            )}
            <button
              onClick={async () => {
                setErr(null)
                try {
                  set(await denyRequest(cr, { reason: 'Denied on mobile' }))
                } catch (e) {
                  toast({ kind: 'refused', title: 'Deny failed.', body: (e as Error).message })
                }
              }}
              style={{ height: 44, padding: '0 20px', border: 'none', background: 'transparent', color: 'var(--refused)', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Deny</button>
          </>
        )}
      </footer>
    </main>
  )
}
