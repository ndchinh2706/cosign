'use client'

import { useState } from 'react'
import Link from 'next/link'
import { IdentityChip, QuorumSeal, RiskChip } from '@/components/ui'
import { ApiError, apiPost, useApi } from '@/lib/api'

type Tier = { label: string; required: number; of: number; max_duration_min: number | null; eligible: string[]; examples: string[] }
type Policies = { version: string; tiers: Record<string, Tier>; escalation: { rule: string; label: string }[]; edit_note: string; principle: string }
type Versions = { items: { version: string; created_at: string; signed_by: string[]; signature: string; change: string }[] }

const NAMES: Record<string, string> = { 'marcus.lee': 'Marcus Lee', 'linh.tran': 'Linh Tran', 'dave.kim': 'Dave Kim' }

// L3: the rules themselves, and proof that the rules were signed.
export default function Policies() {
  const { data: p } = useApi<Policies>('/policies')
  const { data: v } = useApi<Versions>('/policies/versions')
  const [editing, setEditing] = useState(false)
  const [sent, setSent] = useState<{ id?: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const next = Number(p?.version.replace('v', '') ?? 7) + 1
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await apiPost<{ request?: { id: string } }>('/policies/draft', { ...p, version: `v${next}` })
      setSent({ id: r?.request?.id })
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 403 ? 'Only a security lead can propose policy changes.' : 'Could not submit draft.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-screen="L3" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1300 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1>Quorum policies</h1>
        <span className="muted" style={{ fontSize: 14 }}>Version {p?.version.replace('v', '') ?? '7'}, threshold-signed</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => { setEditing((e) => !e); setSent(null); setErr(null) }}>{editing ? 'Discard draft' : 'Edit policy'}</button>
      </div>
      {editing && (
        <div style={{ padding: '14px 16px', borderRadius: 6, background: 'color-mix(in oklch, var(--pending) 12%, transparent)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <RiskChip tier={3} />
          {sent ? (
            <>
              <QuorumSeal required={3} approvals={[]} size={28} />
              <span>Draft v{next} submitted as change request {sent.id ? <Link href={`/governance/requests/${sent.id}`}><code>{sent.id}</code></Link> : null} · 0 of 3 approvals.</span>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }}>{p?.edit_note} Draft v{next} will be submitted as a change request.</span>
              {err && <span style={{ color: 'var(--refused)' }}>{err}</span>}
              <button className="btn" disabled={!p || busy} onClick={submit}>Submit draft</button>
            </>
          )}
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr className="muted" style={{ fontSize: 12, textAlign: 'left' }}>
            {['Tier', 'Example actions', 'Approvers required', 'Max duration', 'Eligible approvers'].map((h) => <th key={h} style={{ fontWeight: 400, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {p && Object.entries(p.tiers).map(([id, t], i) => (
            <tr key={id} style={{ borderBottom: '1px solid var(--rule)' }}>
              <td style={{ padding: '14px 18px' }}><RiskChip tier={i} /></td>
              <td style={{ padding: '14px 18px' }}>{t.examples.map((e) => <code key={e} style={{ marginRight: 8 }}>{e}</code>)}</td>
              <td style={{ padding: '14px 18px' }}>{t.required ? `${t.required} of ${t.of}` : 'none, auto'}</td>
              <td style={{ padding: '14px 18px' }}>{t.max_duration_min ? `${t.max_duration_min} min` : <span className="muted">—</span>}</td>
              <td className="muted" style={{ padding: '14px 18px' }}>{t.eligible.length ? t.eligible.join(', ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 18, alignItems: 'start' }}>
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Escalation rules</h2>
          {p?.escalation.map((r) => <div key={r.rule} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>{r.label}</div>)}
        </section>
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Version history</h2>
          {v?.items.map((x) => (
            <div key={x.version} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
              <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><b style={{ fontWeight: 600 }}>{x.version}</b><span>{x.change}</span><span style={{ flex: 1 }} /><span className="muted" style={{ fontSize: 12 }}>{x.created_at.slice(0, 10)}</span></span>
              <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{x.signed_by.map((u) => <IdentityChip key={u} person={{ username: u, display_name: NAMES[u] ?? u }} size="xs" />)}<code className="muted" style={{ fontSize: 12 }}>{x.signature}</code></span>
            </div>
          ))}
        </section>
      </div>
      <p className="muted" style={{ margin: 0 }}>Reducing authority is instant. Increasing authority requires quorum.</p>
    </div>
  )
}
