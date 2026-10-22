'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Icon, IdentityChip, QuorumSeal, RiskChip, type ICONS } from '@/components/ui'
import { API_MODE } from '@/lib/config'
import { useApi } from '@/lib/api'
import { useRequests } from '@/lib/requests'
import { useCosignSocket } from '@/lib/ws'

type Overview = { stats: { pending_change_requests: number; agents_elevated_now: number; injection_detections_24h: number; policy_version: string; policy_signed: boolean } }
type AuthMap = { capabilities: string[]; identities: { username: string; display_name: string; type: 'agent' | 'human'; cells: Record<string, 'allowed' | 'locked' | 'pending' | 'granted'> }[] }

const CELL: Record<string, [keyof typeof ICONS, string, string]> = {
  allowed: ['check', 'var(--ok)', 'Allowed'],
  locked: ['lock', 'var(--text-muted)', 'Locked'],
  pending: ['clock', 'var(--pending)', 'Pending'],
  granted: ['clock', 'var(--text)', 'Granted, time left'],
}
const age = (s?: number) => (s == null ? '' : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : `${Math.floor(s / 3600)}h`)

// L1: the security lead's question is "what is trying to gain authority right now?"
export default function Governance() {
  const { data: ov, mutate: reOv } = useApi<Overview>('/governance/overview')
  const { data: map, mutate: reMap, setData: setMap } = useApi<AuthMap>('/governance/authority-map')
  const { on } = useCosignSocket(['role:security-lead'])
  useEffect(() => {
    const r = () => { reOv(); if (API_MODE === 'live') reMap() }
    const offs = ['authority.updated', 'injection.detected', 'request.created', 'request.updated'].map((t) => on(t, r))
    // Mock GETs are static, so patch the identity's cells from the event itself.
    offs.push(on('authority.updated', (e) => {
      const p = e.payload as { user: string; authority?: { capability: string; state: AuthMap['identities'][number]['cells'][string] }[] }
      if (p.authority) setMap((m) => m && { ...m, identities: m.identities.map((i) => (i.username === p.user ? { ...i, cells: { ...i.cells, ...Object.fromEntries(p.authority!.map((a) => [a.capability, a.state])) } } : i)) })
    }))
    return () => offs.forEach((f) => f())
  }, [on, reOv, reMap, setMap])
  const { data: reqs } = useRequests()
  const queue = (reqs?.items ?? []).filter((r) => r.status === 'pending')
  const s = ov?.stats
  return (
    <div data-screen="L1" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1600 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1>Governance</h1>
        <span className="muted" style={{ fontSize: 14 }}>Quorum policy {s?.policy_version ?? 'v7'}, threshold-signed by Marcus Lee, Linh Tran and Dave Kim</span>
      </div>
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        {([['Pending change requests', queue.length, queue.length ? 'var(--pending)' : undefined], ['Agents with elevated access now', s?.agents_elevated_now ?? 0], ['Injection detections · 24h', s?.injection_detections_24h ?? 0, 'var(--refused)']] as [string, number, string?][]).map(([l, v, c], i) => (
          <div key={l} style={{ padding: '16px 20px', borderLeft: i ? '1px solid var(--border)' : 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="muted">{l}</span>
            <span style={{ fontSize: 24, fontWeight: 500, color: c }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 18, alignItems: 'start' }}>
        <section id="approvals" className="card" style={{ overflowX: 'auto' }}>
          <h2 style={{ margin: 0, padding: '16px 18px', fontSize: 14, fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Change request queue</h2>
          {!queue.length && <p className="muted" style={{ padding: '24px 18px', margin: 0 }}>Queue is empty.</p>}
          {queue.map((q) => (
            <Link key={q.id} href={`/governance/requests/${q.id}`} style={{ display: 'grid', gridTemplateColumns: '80px 120px minmax(0,1fr) 140px 70px 44px', gap: 10, minWidth: 680, alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--rule)' }}>
              <span className="mono">{q.id}</span>
              <IdentityChip person={q.requester} size="xs" />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>grant <code>{q.roles.join(' + ')}</code></span>
                {q.flags.includes('injection') && <span style={{ fontSize: 12, color: 'var(--refused)' }}>injection in agent context</span>}
                {q.requester.username === q.target_user && q.requester.type === 'human' && <span style={{ fontSize: 12, color: 'var(--refused)' }}>self-grant</span>}
              </span>
              <RiskChip tier={q.tier} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><QuorumSeal required={q.quorum.required} approvals={q.quorum.signed_by} size={26} />{q.quorum.signed_by.length}/{q.quorum.required}</span>
              <span className="muted" style={{ fontSize: 12 }}>{age((q as { age_s?: number }).age_s)}</span>
            </Link>
          ))}
        </section>
        <section className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Authority map</h2>
            <span className="muted" style={{ fontSize: 12 }}>sensitive capabilities</span>
          </div>
          {map && (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr><th style={{ width: 120 }} />{map.capabilities.map((c) => <th key={c} className="mono muted" style={{ fontWeight: 400, fontSize: 11, padding: '10px 4px', lineHeight: 1.3, wordBreak: 'break-word' }}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {map.identities.map((id) => (
                  <tr key={id.username} style={{ borderTop: '1px solid var(--rule)' }}>
                    <td style={{ padding: '10px 14px' }}><IdentityChip person={id} size="xs" /></td>
                    {map.capabilities.map((c) => {
                      const [icon, col, label] = CELL[id.cells[c]] ?? CELL.locked
                      return <td key={c} title={`${id.display_name} · ${c}: ${label}`} style={{ textAlign: 'center' }}><Icon name={icon} size={14} color={col} /></td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ padding: '10px 14px', display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
            {Object.values(CELL).map(([icon, col, label]) => <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name={icon} size={14} color={col} />{label}</span>)}
          </div>
        </section>
      </div>
      <p className="muted" style={{ margin: 0 }}>Reducing authority is instant. Increasing authority requires quorum.</p>
    </div>
  )
}
