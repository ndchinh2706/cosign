'use client'

import { useState } from 'react'
import { toast } from '@/components/AppShell'
import { Icon, IdentityChip, QuorumSeal } from '@/components/ui'
import { api, useApi } from '@/lib/api'

type User = { username: string; display_name: string; type: 'agent' | 'human'; roles: string[]; last_login: string; pending_requests: string[] }
type RolesPut = { code: string; message: string; applied_removals?: string[]; request: { id: string; roles: string[]; quorum: { required: number; eligible: { username: string; display_name: string }[] } } }

const REALM_ROLES: [string, string][] = [
  ['agent', 'Runs as an AI agent identity'],
  ['_tide_customer_pii.selfencrypt', 'Encrypt customer PII'],
  ['_tide_customer_pii.selfdecrypt', 'Decrypt customer PII in own session'],
  ['realm-admin', 'Administer the realm, grant roles'],
]

// R1 + R2: an admin edits roles, and the edit becomes a change request instead of a change.
export default function UsersAndRoles() {
  const { data, error, loading, mutate } = useApi<{ items: User[] }>('/admin/users')
  const [editing, setEditing] = useState<User | null>(null)
  const users = data?.items ?? []
  return (
    <div data-screen="R1" style={{ padding: '28px 32px 100px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1>Users &amp; Roles</h1>
        {data && <span className="muted" style={{ fontSize: 13 }}>{users.length} identities in northwind-prod</span>}
      </div>
      {error && <p style={{ color: 'var(--refused)', margin: 0 }}>Couldn&apos;t load users. {error.message}</p>}
      {loading && !data && <p className="muted" style={{ margin: 0 }}>Loading…</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr className="muted" style={{ fontSize: 12, textAlign: 'left' }}>
              {['User', 'Type', 'Roles', 'Last login', ''].map((h) => <th key={h} style={{ fontWeight: 400, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username} style={{ borderBottom: '1px solid var(--rule)' }}>
                <td style={{ padding: '12px 18px' }}><IdentityChip person={u} size="sm" sub="handle" /></td>
                <td className="muted" style={{ padding: '12px 18px' }}>{u.type}</td>
                <td style={{ padding: '12px 18px' }}>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {u.roles.map((r) => <code key={r} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'var(--surface-2)' }}>{r}</code>)}
                    {u.pending_requests.length > 0 && <span className="pill" title={u.pending_requests.join(', ')} style={{ ['--c' as string]: 'var(--pending)' }}>{u.pending_requests.length} pending</span>}
                  </span>
                </td>
                <td className="muted" style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>{u.last_login.slice(0, 16).replace('T', ' ')}</td>
                <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                  <button className="btn" style={{ height: 30 }} onClick={() => setEditing(u)}>Edit roles</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditRoles user={editing} onSaved={mutate} onClose={() => setEditing(null)} />}
    </div>
  )
}

function EditRoles({ user, onSaved, onClose }: { user: User; onSaved: () => void; onClose: () => void }) {
  const [ticks, setTicks] = useState(() => new Set(user.roles))
  const [result, setResult] = useState<RolesPut | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const added = [...ticks].filter((r) => !user.roles.includes(r))
  const removed = user.roles.filter((r) => !ticks.has(r))
  const save = async () => {
    if (saving) return
    setError('')
    setSaving(true)
    try {
      const r = await api<RolesPut>('PUT', `/admin/users/${user.username}/roles`, { add: added, remove: removed, reason: 'Edit roles from admin console' })
      onSaved()
      if (r.code === 'quorum_required') {
        setResult(r)
        if (r.applied_removals?.length) toast({ kind: 'warn', title: `Removed immediately: ${r.applied_removals.join(', ')}`, body: 'Additions need quorum: TideCloak cannot apply them without threshold signatures.' })
        else toast({ kind: 'warn', title: 'No roles changed.', body: 'TideCloak cannot apply role changes without threshold signatures.' })
      } else {
        toast({ kind: 'ok', title: 'Role removed', body: r.message })
        onClose()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,10,.35)', zIndex: 30 }} />
      <aside data-screen="R2" aria-label="Edit roles" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px,100vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow)', zIndex: 31, display: 'flex', flexDirection: 'column', animation: 'cs-in 200ms ease' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Edit roles</h2>
            <code className="muted">{user.username}</code>
          </div>
          <button className="btn btn-icon" style={{ border: 'none' }} onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {!result ? (
          <>
            <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>Realm roles</h3>
              {REALM_ROLES.map(([r, desc]) => {
                const on = ticks.has(r)
                const isNew = on && !user.roles.includes(r)
                return (
                  <label key={r} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={on} onChange={() => setTicks((t) => { const n = new Set(t); if (n.has(r)) n.delete(r); else n.add(r); return n })} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}><code>{r}</code><span className="muted" style={{ fontSize: 12 }}>{desc}</span></span>
                    {isNew && <span className="pill" style={{ ['--c' as string]: 'var(--pending)' }}>New</span>}
                  </label>
                )
              })}
              {error && <p style={{ color: 'var(--refused)' }}>Couldn&apos;t save. {error}</p>}
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--surface-2)' }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || (!added.length && !removed.length)}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflow: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="card" style={{ borderColor: 'var(--pending)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, animation: 'cs-in 260ms ease' }}>
              <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>This is now change request <span className="mono">{result.request.id}</span> · pending quorum (0 / {result.request.quorum.required}).</div>
              <div className="muted">Your approval is not counted on your own request.</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <QuorumSeal required={result.request.quorum.required} approvals={[]} size={100} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Required approvers</h3>
                  {result.request.quorum.eligible.map((e) => <IdentityChip key={e.username} person={e} size="xs" sub="role" />)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{result.request.roles.map((r) => <code key={r} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, background: 'var(--surface-2)' }}>+ {r}</code>)}{(result.applied_removals ?? []).map((r) => <code key={'-' + r} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, background: 'var(--surface-2)', textDecoration: 'line-through' }}>- {r}</code>)}</div>
            </div>
            <p className="muted" style={{ margin: 0 }}>{result.applied_removals?.length ? `Removed immediately: ${result.applied_removals.join(', ')}. The additions above wait for quorum.` : result.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Close</button></div>
          </div>
        )}
      </aside>
    </>
  )
}
