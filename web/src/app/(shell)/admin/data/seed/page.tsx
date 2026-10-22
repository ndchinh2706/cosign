'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui'
import { apiPost, loadMock } from '@/lib/api'
import { API_MODE } from '@/lib/config'
import { useTide } from '@/lib/tide'

type Rec = { id: string; name: string; settlement_bank: string; tax_id: string; payout_currency: string } & Record<string, unknown>
type Step = 'queued' | 'encrypting' | 'encrypted' | 'uploaded' | 'failed'

const TAG = 'customer_pii'
const ENCRYPT_ROLE = `_tide_${TAG}.selfencrypt`
const FIELDS = ['name', 'settlement_bank', 'tax_id', 'payout_currency'] as const
const STEP_C: Record<Step, string> = { queued: 'var(--text-muted)', encrypting: 'var(--pending)', encrypted: 'var(--accent)', uploaded: 'var(--ok)', failed: 'var(--refused)' }

// Seed: plaintext exists only in this tab; Tide encrypts it here and the API only ever receives ciphertext.
export default function SeedPage() {
  const { doEncrypt, hasRealmRole } = useTide()
  const [records, setRecords] = useState<Rec[] | null>(null)
  const [steps, setSteps] = useState<Record<string, Step>>({})
  const [cipher, setCipher] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Roles come from client-only session state; wait for mount (records load) so SSR and hydration agree.
  const canEncrypt = records !== null && hasRealmRole(ENCRYPT_ROLE)
  const refused = records !== null && !canEncrypt
  const done = records !== null && records.every((r) => steps[r.id] === 'uploaded')

  useEffect(() => {
    // ponytail: demo-only plaintext file is the seed input; it never leaves this tab.
    loadMock<{ items: Rec[] }>('records-plaintext-demo-only.json').then((d) => setRecords(d.items), (e: Error) => setError(e.message))
  }, [])

  const run = async () => {
    if (!records) return
    setBusy(true)
    setError(null)
    setSteps({})
    setCipher({})
    try {
      const out: Record<string, string> = {}
      for (const r of records) {
        setSteps((s) => ({ ...s, [r.id]: 'encrypting' }))
        ;[out[r.id]] = await doEncrypt([{ data: JSON.stringify(r), tags: [TAG] }])
        setSteps((s) => ({ ...s, [r.id]: 'encrypted' }))
      }
      await apiPost('/records/bulk', { items: records.map((r) => ({ id: r.id, tag: TAG, ciphertext: out[r.id] })) })
      setSteps(Object.fromEntries(records.map((r) => [r.id, 'uploaded'])))
      setCipher(out)
    } catch (e) {
      setSteps((s) => Object.fromEntries(Object.entries(s).map(([id, st]) => [id, st === 'uploaded' ? st : 'failed'])))
      setError((e as Error).message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-screen="SEED" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1>Seed encrypted records</h1>
        <code style={{ fontSize: 13, padding: '3px 8px', borderRadius: 4, background: 'var(--surface-2)' }}>merchants</code>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={run} disabled={!canEncrypt || busy} style={{ opacity: !canEncrypt || busy ? 0.5 : 1, cursor: !canEncrypt || busy ? 'not-allowed' : 'pointer' }}>
          <Icon name="lock" size={14} />
          {busy ? 'Encrypting…' : done ? 'Encrypt and upload again' : 'Encrypt in browser and upload'}
        </button>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px' }}>
        <Icon name={refused ? 'cross' : 'lock'} color={refused ? 'var(--refused)' : 'var(--text-muted)'} style={{ marginTop: 2 }} />
        {!refused ? (
          <span>Each record is encrypted by Tide in this tab with tag <code>{TAG}</code>. Only ciphertext is sent to <code>POST /records/bulk</code>.</span>
        ) : (
          <span>
            <span style={{ color: 'var(--refused)', fontWeight: 500 }}>Tide refused: missing role <code>{ENCRYPT_ROLE}</code>.</span>{' '}
            <span className="muted">Your session can see this page but cannot encrypt customer data. Ask a security lead who holds the encrypt role.</span>
          </span>
        )}
      </div>

      <section className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Sample merchants</h2>
          <span className="muted" style={{ fontSize: 12 }}>{records?.length ?? 0} records · plaintext in this tab only</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr className="muted" style={{ fontSize: 12, textAlign: 'left' }}>
                {['id', ...FIELDS, 'status'].map((c) => (
                  <th key={c} className={c === 'status' ? undefined : 'mono'} style={{ fontWeight: 400, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records?.map((r) => {
                const step = steps[r.id] ?? 'queued'
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--rule)' }}>
                    <td className="mono" style={{ padding: '11px 18px', fontSize: 13 }}>{r.id}</td>
                    {FIELDS.map((f) => (
                      <td key={f} style={{ padding: '11px 18px', fontSize: 13, whiteSpace: 'nowrap' }}>{r[f]}</td>
                    ))}
                    <td style={{ padding: '11px 18px' }}>
                      <span className="pill" style={{ ['--c' as string]: STEP_C[step] }}>{step}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {error && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderTop: '1px solid var(--border)', color: 'var(--refused)' }}>
            <Icon name="alert" size={14} />
            <span style={{ flex: 1, fontSize: 13 }}>Seed failed: {error}</span>
            <button className="btn" onClick={run} disabled={busy || !canEncrypt}>Retry</button>
          </div>
        )}
      </section>

      {done && (
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, animation: 'cs-in 260ms ease' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={14} color="var(--ok)" />
            Uploaded {records.length} records as ciphertext
          </h2>
          <dl style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', rowGap: 8, columnGap: 12, margin: 0 }}>
            {records.map((r) => (
              <div key={r.id} style={{ display: 'contents' }}>
                <dt className="mono" style={{ fontSize: 13 }}>{r.id}</dt>
                <dd className="mono muted" style={{ margin: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cipher[r.id].slice(0, 72)}…</dd>
              </div>
            ))}
          </dl>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            The server never saw plaintext: it stored only these ciphertexts. Decrypting them needs a Tide decrypt role, checked by the Tide network, not by Cosign.
            {API_MODE === 'mock' && ' Mock mode: ciphertext is a local placeholder and the upload is not persisted.'}
          </p>
        </section>
      )}
    </div>
  )
}
