'use client'

import { useState } from 'react'
import { Icon, IdentityChip } from '@/components/ui'
import { apiGet, apiPost, loadMock, useApi } from '@/lib/api'
import { API_MODE } from '@/lib/config'
import { useSession } from '@/lib/session'
import { useTide } from '@/lib/tide'

type Merchants = { table: string; tag: string; total: number; info: string; columns: string[]; items: Record<string, string>[] }
type Exported = { rows: number; file: string; note: string }
type Plain = { name: string; settlement_bank: string; tax_id: string }
type View = { person: { username: string; display_name: string }; note: string; plain?: Plain; cipher: string; refused?: string }

const FIELDS: [keyof Plain, string][] = [['name', 'name'], ['settlement_bank', 'bank_account'], ['tax_id', 'tax_id']]
const SAMPLE = 'mrc_8812'

// R3: an admin can read every byte of the table and still not one customer's name.
export default function DataBrowser() {
  const { data } = useApi<Merchants>('/admin/data/merchants')
  const { me } = useSession()
  const { doDecrypt } = useTide()
  const [views, setViews] = useState<View[] | null>(null)
  const [exported, setExported] = useState<Exported | null>(null)

  const compare = async () => {
    if (views) return setViews(null)
    const { items } = await apiGet<{ items: { id: string; tag: string; ciphertext: string }[] }>(`/records?ids=${SAMPLE}`)
    const rec = items[0]
    // This tab decrypts with its own session; Tide decides, not this code.
    const self: View = { person: me!.user, note: `This session · ${me!.roles[0]}`, cipher: rec.ciphertext }
    try {
      self.plain = JSON.parse((await doDecrypt([{ encrypted: rec.ciphertext, tags: [rec.tag] }]))[0])
    } catch (e) {
      self.refused = (e as Error).message
    }
    if (API_MODE === 'live') return setViews([self])
    // Mock storyboard: Atlas's view during its granted window, from the demo-only plaintext file.
    const demo = await loadMock<{ items: (Plain & { id: string })[] }>('records-plaintext-demo-only.json')
    setViews([
      self,
      { person: { username: 'ai-oncall-agent', display_name: 'Atlas' }, note: 'During granted window 03:16–03:28 · in-session decrypt', plain: demo.items.find((r) => r.id === SAMPLE), cipher: rec.ciphertext },
      { person: { username: 'linh.tran', display_name: 'Linh Tran' }, note: 'On-call SRE · approver, but no decrypt role', cipher: rec.ciphertext, refused: 'missing role _tide_customer_pii.selfdecrypt' },
    ])
  }

  return (
    <div data-screen="R3" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1>Data</h1>
        <code style={{ fontSize: 13, padding: '3px 8px', borderRadius: 4, background: 'var(--surface-2)' }}>{data?.table ?? 'merchants'}</code>
        {data && <span className="muted">{data.total.toLocaleString('en-US')} rows</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={compare} aria-pressed={!!views}>
          <span style={{ width: 28, height: 16, borderRadius: 8, background: views ? 'var(--text)' : 'var(--control)', position: 'relative' }}>
            <span style={{ position: 'absolute', top: 2, left: views ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: views ? 'var(--surface)' : '#fff', transition: 'left 150ms' }} />
          </span>
          Compare views
        </button>
        <button className="btn" onClick={async () => setExported(await apiPost<Exported>('/admin/data/merchants/export'))}>Export table</button>
      </div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
        <Icon name="lock" color="var(--text-muted)" />
        <span>{data?.info ?? 'You have infrastructure access, not data authority.'}</span>
      </div>

      {views && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${views.length},minmax(0,1fr))`, gap: 16, animation: 'cs-in 260ms ease' }}>
          {views.map((v) => (
            <div key={v.person.username + v.note} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, borderColor: v.plain ? 'var(--accent)' : 'var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <IdentityChip person={v.person} size="sm" sub="role" />
                <span style={{ fontSize: 12, fontWeight: 500, color: v.plain ? 'var(--accent)' : 'var(--text-muted)' }}>{v.plain ? 'plaintext' : 'ciphertext'}</span>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>{v.note}</span>
              <dl style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', rowGap: 10, columnGap: 12, margin: 0 }}>
                <dt className="muted" style={{ fontSize: 12 }}>id</dt><dd className="mono" style={{ margin: 0 }}>{SAMPLE}</dd>
                {FIELDS.map(([k, label]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt className="muted" style={{ fontSize: 12 }}>{label}</dt>
                    <dd style={{ margin: 0 }}>
                      {v.plain ? <span style={{ fontSize: 14, fontWeight: 500 }}>{v.plain[k]}</span> : <span className="mono muted" style={{ display: 'flex', gap: 6, fontSize: 12, wordBreak: 'break-all' }}><Icon name="lock" size={12} style={{ marginTop: 2 }} />{v.cipher.slice(16, 60)}…</span>}
                    </dd>
                  </div>
                ))}
              </dl>
              {v.refused && <span style={{ fontSize: 12, color: 'var(--refused)' }}>Tide refused: {v.refused}</span>}
            </div>
          ))}
        </div>
      )}

      <table className="card" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', overflow: 'hidden' }}>
        <thead>
          <tr className="mono muted" style={{ fontSize: 12, textAlign: 'left' }}>
            {(data?.columns ?? []).map((c) => (
              <th key={c} style={{ fontWeight: 400, padding: '10px 18px', borderBottom: '1px solid var(--border)', width: c === 'id' ? 120 : undefined }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{c}{c !== 'id' && <Icon name="lock" size={12} />}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data?.items.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--rule)' }}>
              {data.columns.map((c) => (
                <td key={c} className="mono" style={{ padding: '11px 18px', fontSize: c === 'id' ? 13 : 12, color: c === 'id' ? 'var(--text)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c === 'id' ? r[c] : String(r[c]).replace('MOCK-CIPHERTEXT-', '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {exported && (
        <div role="dialog" aria-label="Export ready" style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,10,.55)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 'min(520px, 92vw)', boxShadow: 'var(--shadow)', padding: 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="lock" />Export ready · ciphertext only</h2>
            <p style={{ margin: 0, fontSize: 14 }}>Export contains {exported.rows.toLocaleString('en-US')} encrypted rows. {exported.note}</p>
            <code className="muted" style={{ fontSize: 12, background: 'var(--surface-2)', borderRadius: 6, padding: '10px 12px', wordBreak: 'break-all' }}>{exported.file}</code>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={() => setExported(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
