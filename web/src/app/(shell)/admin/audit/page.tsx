'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui'
import { api, ApiError, useApi } from '@/lib/api'

type Event = { id: string; ts: string; actor: string; action: string; target: string; outcome: string; signature: string }
const OUTCOME: Record<string, string> = { allowed: 'var(--ok)', approved: 'var(--ok)', refused: 'var(--refused)', blocked: 'var(--refused)', denied: 'var(--refused)', flagged: 'var(--pending)', pending: 'var(--pending)' }

// R4: an admin tries to delete history; the log is threshold-signed, so Tide refuses.
export default function AdminAudit() {
  const { data } = useApi<{ items: Event[] }>('/admin/audit')
  const [menu, setMenu] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const del = async (id: string) => {
    setMenu(null)
    try {
      await api('DELETE', `/admin/audit/${id}`)
    } catch (e) {
      setRefused(e instanceof ApiError ? e.message : String(e))
    }
  }
  return (
    <div data-screen="R4" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1400 }}>
      <h1>Audit</h1>
      <table className="card" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr className="muted" style={{ fontSize: 12, textAlign: 'left' }}>
            {['Time', 'Actor', 'Action', 'Target', 'Outcome', ''].map((h) => <th key={h} style={{ fontWeight: 400, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data?.items.map((a) => (
            <tr key={a.id} style={{ borderBottom: '1px solid var(--rule)' }}>
              <td className="muted" style={{ padding: '10px 18px' }}>{a.ts.slice(11, 19)}</td>
              <td style={{ padding: '10px 18px', fontWeight: 500 }}>{a.actor}</td>
              <td className="mono" style={{ padding: '10px 18px', fontSize: 12 }}>{a.action}</td>
              <td style={{ padding: '10px 18px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.target}</td>
              <td style={{ padding: '10px 18px', fontSize: 12, fontWeight: 500, color: OUTCOME[a.outcome] ?? 'var(--text-muted)' }}>{a.outcome}</td>
              <td style={{ padding: '10px 18px', position: 'relative', textAlign: 'right' }}>
                <button className="btn btn-icon" style={{ width: 30, height: 28 }} onClick={() => setMenu(menu === a.id ? null : a.id)} aria-label="Event actions" aria-expanded={menu === a.id}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><circle cx="3.5" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12.5" cy="8" r="1.2" /></svg>
                </button>
                {menu === a.id && (
                  <div className="card" role="menu" style={{ position: 'absolute', right: 18, top: 40, zIndex: 5, boxShadow: 'var(--shadow)', minWidth: 170, overflow: 'hidden', textAlign: 'left' }}>
                    <button role="menuitem" className="btn" style={{ width: '100%', border: 'none', borderRadius: 0, justifyContent: 'flex-start' }} onClick={() => (void navigator.clipboard?.writeText(a.id), setMenu(null))}>Copy event ID</button>
                    <button role="menuitem" className="btn" style={{ width: '100%', border: 'none', borderRadius: 0, justifyContent: 'flex-start', color: 'var(--refused)' }} onClick={() => del(a.id)}>Delete event</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {refused && (
        <div role="alertdialog" aria-label="Deletion refused" style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,10,.55)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 'min(520px, 92vw)', borderColor: 'var(--refused)', boxShadow: 'var(--shadow)', padding: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--refused)', display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="lock" />Deletion refused</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{refused}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={() => setRefused(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
