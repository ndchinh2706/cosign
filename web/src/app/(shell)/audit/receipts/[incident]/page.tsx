'use client'

import { Fragment, use, useEffect, useState } from 'react'
import { IdentityChip, Mark, QuorumSeal } from '@/components/ui'
import { ApiError, useApi } from '@/lib/api'
import { API_MODE } from '@/lib/config'
import { findUser } from '@/lib/users'

type Receipt = {
  incident_id: string
  title: string
  generated_at: string
  summary: { who: string[]; what: string; when: string | null; mttr_min: number | null }
  approvals: { request_id: string; approver: string; display_name: string; signed_at: string; signature: string }[]
  data_accessed: { record_ids: string[]; fields: string[]; granted_min: number | null; actual_use: string | null }
  blocked_attempts: { request_id: string | null; actor: string; what: string; tier: string | null }[]
  signatures: { event: string; hash: string; signature: string }[]
  footer: string
}

// Print the receipt itself, in light colours, without the app chrome.
const PRINT_CSS = `@media print {
  body * { visibility: hidden; }
  [data-screen="C2"] article, [data-screen="C2"] article * { visibility: visible; }
  [data-screen="C2"] article { position: absolute; inset: 0 auto auto 0; border: none !important; padding: 0 !important; max-width: none !important; }
}`

// C2: who touched customer data during the incident, who approved it, and what was refused.
export default function AccessReceipt({ params }: { params: Promise<{ incident: string }> }) {
  const { incident } = use(params)
  const { data: r, error, loading } = useApi<Receipt>(`/incidents/${incident}/receipt`)
  const { data: inc } = useApi<{ resolved_at: string | null }>(`/incidents/${incident}`)
  const [shared, setShared] = useState(false)

  useEffect(() => {
    const html = document.documentElement
    let prev: string | undefined
    const before = () => ((prev = html.dataset.theme), (html.dataset.theme = 'light'))
    const after = () => prev && (html.dataset.theme = prev)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  const share = async () => {
    await navigator.clipboard?.writeText(window.location.href).catch(() => {})
    setShared(true)
  }

  const section = { display: 'flex', flexDirection: 'column' as const, gap: 12 }
  const heading = { margin: 0, fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }
  const width = { width: '100%', maxWidth: 900 }
  // mttr_min is computed even while the incident is open, so resolution comes from the incident itself.
  // mock incident.json is the mid-incident snapshot; receipt.json is the finished one
  const resolved = API_MODE === 'mock' ? r?.summary.mttr_min != null : inc?.resolved_at != null
  const denied = error instanceof ApiError && error.status === 403
  const rids = [...new Set(r?.approvals.map((a) => a.request_id))]

  return (
    <div data-screen="C2" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <style>{PRINT_CSS}</style>
      <div data-noprint style={{ ...width, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1>Access receipt</h1>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => window.print()} disabled={!r}>Export PDF</button>
        <button className="btn btn-primary" onClick={share} disabled={!r}>{shared ? 'Link copied' : 'Share with auditor'}</button>
      </div>
      {loading && !r && <p className="muted" style={{ ...width, margin: 0 }}>Loading receipt…</p>}
      {error && (
        <p style={{ ...width, margin: 0, color: (error instanceof ApiError && error.status === 404) || denied ? 'var(--text-muted)' : 'var(--refused)' }}>
          {error instanceof ApiError && error.status === 404 ? 'No receipt for this incident.' : denied ? 'Receipts are visible to compliance, security and on-call.' : `Couldn't load the receipt. ${error.message}`}
        </p>
      )}
      {r && (API_MODE === 'mock' || inc) && !resolved && (
        <div role="status" style={{ ...width, padding: '10px 14px', borderRadius: 'var(--radius)', border: '1px solid color-mix(in oklch, var(--pending) 40%, transparent)', background: 'color-mix(in oklch, var(--pending) 10%, transparent)' }}>
          Incident still open · receipt is partial
        </div>
      )}
      {r && (
        <article className="card" style={{ ...width, padding: '40px 44px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, paddingBottom: 22, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Northwind Pay · Cosign</span>
              <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{r.title}</span>
              <span className="muted">Generated {r.generated_at.slice(0, 16).replace('T', ' ')} ({r.generated_at.slice(19)})</span>
            </div>
            <Mark size={40} />
          </header>

          <section style={section}>
            <h2 style={heading}>Summary</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16 }}>
              {[
                ['Incident', r.incident_id],
                ['Who', r.summary.who.join(', ') || '—'],
                ['What', r.summary.what],
                ['When', r.summary.when ?? '—'],
                ['Time to resolve', resolved ? `${r.summary.mttr_min} min` : 'Open'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="muted" style={{ fontSize: 12 }}>{k}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'break-word' }}>{v}</span>
                </div>
              ))}
            </div>
          </section>

          {rids.length === 0 && (
            <section style={section}>
              <h2 style={heading}>Approvals</h2>
              <span className="muted">No approvals yet.</span>
            </section>
          )}
          {rids.map((rid) => {
            const group = r.approvals.filter((a) => a.request_id === rid)
            return (
              <section key={rid} style={section}>
                <h2 style={heading}>Approvals · <span className="mono">{rid}</span></h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
                  {/* ponytail: receipt carries no threshold, so each request's seal shows the signers it has (min 2, the T2 quorum) */}
                  <QuorumSeal required={Math.max(2, group.length)} approvals={group.map((a) => ({ username: a.approver }))} size={96} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,auto) auto 1fr', alignItems: 'center', gap: '10px 20px', flex: 1, minWidth: 260 }}>
                    {group.map((a) => (
                      <Fragment key={a.approver + a.signed_at}>
                        <IdentityChip person={{ username: a.approver, display_name: a.display_name, type: findUser(a.approver)?.type }} size="sm" sub="role" />
                        <span className="muted" style={{ fontSize: 12 }}>signed {a.signed_at.slice(11, 19)}</span>
                        <code className="muted" style={{ fontSize: 12, justifySelf: 'end' }}>{a.signature}</code>
                      </Fragment>
                    ))}
                  </div>
                </div>
              </section>
            )
          })}

          <section style={section}>
            <h2 style={heading}>Data accessed</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0,1fr)', rowGap: 10, alignItems: 'baseline' }}>
              <span className="muted">Records</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {r.data_accessed.record_ids.map((id) => <code key={id} style={{ fontSize: 12, padding: '2px 7px', borderRadius: 4, background: 'var(--surface-2)' }}>{id}</code>)}
              </div>
              <span className="muted">Fields</span>
              <code style={{ fontSize: 12 }}>{r.data_accessed.fields.join(', ')}</code>
              <span className="muted">Values</span>
              <span>Not stored. Decrypted in the approved browser session only.</span>
              <span className="muted">Actual use</span>
              <span>{r.data_accessed.actual_use ? `${r.data_accessed.actual_use} of ${r.data_accessed.granted_min} min granted` : 'No elevated access granted'}</span>
            </div>
          </section>

          <section style={{ ...section, gap: 10 }}>
            <h2 style={heading}>Blocked attempts · {r.blocked_attempts.length}</h2>
            {r.blocked_attempts.length === 0 && <span className="muted">None.</span>}
            {r.blocked_attempts.map((b, i) => (
              <div key={b.request_id ?? i} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 'var(--radius)', background: 'color-mix(in oklch, var(--refused) 7%, var(--surface-2))' }}>
                {b.request_id && <code style={{ fontSize: 12, fontWeight: 600 }}>{b.request_id}</code>}
                <span style={{ flex: 1, minWidth: 200 }}>{b.what}</span>
                <span className="muted" style={{ fontSize: 12 }}>{findUser(b.actor)?.displayName ?? b.actor}{b.tier && ` · ${b.tier}`}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--refused)' }}>Blocked</span>
              </div>
            ))}
          </section>

          <section style={{ ...section, gap: 8 }}>
            <h2 style={heading}>Signatures</h2>
            {r.signatures.map((s) => (
              <div key={s.hash} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) minmax(0,1fr) auto', gap: 12, fontSize: 12 }}>
                <code>{s.event}</code>
                <code className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.hash}</code>
                <code className="muted">{s.signature}</code>
              </div>
            ))}
          </section>

          <footer className="muted" style={{ paddingTop: 18, borderTop: '1px solid var(--border)' }}>{r.footer}</footer>
        </article>
      )}
    </div>
  )
}
