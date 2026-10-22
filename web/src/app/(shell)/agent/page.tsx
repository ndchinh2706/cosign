'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AuthorityMeter, Icon, IdentityChip, QuorumSeal, RiskChip } from '@/components/ui'
import { apiGet, apiPost, loadMock, useApi } from '@/lib/api'
import { API_MODE } from '@/lib/config'
import { applyEvent, type ConsoleState, type Run, type Step } from '@/lib/run'
import { useSession } from '@/lib/session'
import { useTide } from '@/lib/tide'
import { useCosignSocket, useReplay, type Envelope } from '@/lib/ws'

type Metrics = { points: [string, number][]; markers: { at: string; label: string; kind: string }[] }
type PlainRecord = { id: string; name: string; settlement_bank: string; payout_currency: string; payout_currency_prev?: string; last_tx: { id: string; status: string }[] }

const ATLAS = { username: 'ai-oncall-agent', display_name: 'Atlas', type: 'agent' as const }
const hhmmss = (iso: string) => iso.slice(11, 19)
const pct = (v?: number) => (v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)
const isRecords = (s: Step) => s.tool_name === 'decrypt_records' && s.status === 'ok'

// Mock: fold the storyboard up to the replay cursor so the screen survives role switches.
function useMockConsole(base: ConsoleState) {
  const { index } = useReplay()
  const [events, setEvents] = useState<Envelope[]>([])
  useEffect(() => {
    if (API_MODE === 'mock') void loadMock<Envelope[]>('ws/storyboard.json').then(setEvents)
  }, [])
  return useMemo(() => (index === 0 ? base : events.slice(0, index).reduce(applyEvent, { ...base, run: undefined, requests: {}, injection: undefined })), [index, events, base])
}

export default function AgentConsole() {
  const { me } = useSession()
  const { doDecrypt } = useTide()
  const { data: snapshot } = useApi<Run>('/agent/runs/run_01')
  const { data: metrics } = useApi<Metrics>('/incidents/INC-2417/metrics')
  const base = useMemo<ConsoleState>(() => ({ run: snapshot, authority: me?.authority ?? [], errorRate: 0.38, requests: {} }), [snapshot, me])
  const mockState = useMockConsole(base)
  const [liveState, setLiveState] = useState<ConsoleState>(base)
  const [plain, setPlain] = useState<PlainRecord[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({ st_04: true })
  const { on, send } = useCosignSocket(['run:run_01', 'incident:INC-2417', 'user:ai-oncall-agent'], { console: true })
  const st = API_MODE === 'mock' ? mockState : { ...liveState, run: liveState.run ?? snapshot }

  // Live: fold every event; answer tool_call by decrypting in this tab (docs/API.md §6.4).
  useEffect(() => {
    if (API_MODE === 'mock') return
    const offAll = on('*', (e) => setLiveState((s) => applyEvent(s, e)))
    const offCall = on('tool_call', async (e) => {
      const p = e.payload as { run_id: string; step_id: string; call_id: string; tool: string; input: { ids: string[] } }
      const reply = (extra: Record<string, unknown>) => send('tool_result', { run_id: p.run_id, step_id: p.step_id, call_id: p.call_id, tool: p.tool, ...extra })
      try {
        const { items } = await apiGet<{ items: { id: string; tag: string; ciphertext: string }[] }>(`/records?ids=${p.input.ids.join(',')}`)
        const out = await doDecrypt(items.map((r) => ({ encrypted: r.ciphertext, tags: [r.tag] })))
        const records = out.map((s) => JSON.parse(s) as PlainRecord)
        const fields = ['name', 'settlement_bank', 'payout_currency', 'last_tx']
        reply({ ok: true, output: { records, decrypted_in: 'browser-session', fields } })
        setPlain(records)
        void apiPost('/records/access-log', { run_id: p.run_id, record_ids: p.input.ids, fields })
      } catch (err) {
        const msg = String((err as Error).message)
        const role = msg.match(/_tide_[\w.]+/)?.[0]
        reply({ ok: false, error: role ? { code: 'tide_refused', missing_role: role, raw: msg } : { code: 'decrypt_error', raw: msg } })
      }
    })
    return () => {
      offAll()
      offCall()
    }
  }, [on, send, doDecrypt])

  // Mock: plaintext for A5 comes from the demo-only file once the granted decrypt step lands.
  const decrypted = !!st.run?.steps.some(isRecords)
  useEffect(() => {
    if (API_MODE === 'mock' && decrypted) void loadMock<{ items: PlainRecord[] }>('records-plaintext-demo-only.json').then((d) => setPlain(d.items))
  }, [decrypted])

  const stream = useRef<HTMLDivElement>(null)
  const count = st.run?.steps.length ?? 0
  useEffect(() => {
    stream.current?.scrollTo({ top: stream.current.scrollHeight, behavior: 'smooth' })
  }, [count])

  const run = st.run
  const cr = st.requests['CR-0192']
  const seal = (cr?.quorum?.signed_by ?? []).map((s) => ({ username: s.username }))
  const granted = st.authority.find((a) => a.capability === 'customer_pii.selfdecrypt')?.state === 'granted'
  const statusPill = run?.status === 'completed' ? { t: 'Completed', c: 'var(--ok)' } : run?.status === 'waiting_approval' ? { t: 'Waiting for approval', c: 'var(--pending)' } : { t: 'Atlas is working', c: 'var(--agent)' }

  return (
    <div data-screen="A1" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,280px) minmax(0,1fr) minmax(260px,340px)', height: 'calc(100vh - var(--topbar-h))' }}>
      {/* timeline */}
      <section style={{ borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '16px 18px 12px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Run timeline</h2>
          <span className="mono muted" style={{ fontSize: 12 }}>{run?.id}</span>
        </div>
        <ol style={{ listStyle: 'none', margin: 0, padding: '14px 14px 80px', overflow: 'auto', flex: 1 }}>
          {run?.steps.filter((s) => s.kind !== 'message').map((s) => {
            const bad = s.status === 'refused' || s.status === 'blocked'
            const c = bad ? 'var(--refused)' : s.status === 'pending' ? 'var(--pending)' : 'var(--text-muted)'
            return (
              <li key={s.id} style={{ display: 'flex', gap: 10, paddingBottom: 14, animation: 'cs-in 260ms ease' }}>
                <Icon name={s.kind === 'think' ? 'info' : 'terminal'} size={14} color={c} style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span className="muted">{hhmmss(s.ts)}</span>
                    <span style={{ color: c, fontWeight: 500 }}>{s.kind === 'think' ? 'Thought' : { ok: 'Done', refused: 'Refused', blocked: 'Blocked', pending: 'Pending', error: 'Error' }[s.status]}</span>
                  </div>
                  <div className={s.kind === 'tool' ? 'mono' : ''} style={{ fontStyle: s.kind === 'think' ? 'italic' : 'normal', wordBreak: 'break-word' }}>{s.kind === 'tool' ? s.tool_name : s.text}</div>
                  {s.tier && <RiskChip tier={s.tier} label={s.tier === 'T0' ? 'T0 · auto' : undefined} />}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {/* stream */}
      <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
            <span className="mono muted">INC-2417</span>
            <h1 style={{ fontSize: 20, overflow: 'hidden', textOverflow: 'ellipsis' }}>payments-api returning 502s</h1>
            <span className="pill" style={{ ['--c' as string]: 'var(--refused)' }}>Sev 1</span>
            <span style={{ flex: 1 }} />
            <span className="pill" style={{ ['--c' as string]: statusPill.c, height: 28 }}>{statusPill.t}</span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 110 }}>
              <span className="muted" style={{ fontSize: 12 }}>Error rate</span>
              <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: (st.errorRate ?? 0) > 0.1 ? 'var(--refused)' : (st.errorRate ?? 0) > 0.02 ? 'var(--pending)' : 'var(--ok)' }}>{pct(st.errorRate)}</span>
              <span className="muted" style={{ fontSize: 12 }}>since 03:00</span>
            </div>
            {metrics && <ErrorChart m={metrics} />}
          </div>
        </div>
        <div ref={stream} style={{ flex: 1, overflow: 'auto', padding: '20px 24px 120px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!run?.steps.length && <p className="muted">The run has not started. Press Play to replay the storyboard.</p>}
          {run?.steps.map((s) => (
            <StreamItem key={s.id} s={s} open={!!open[s.id]} toggle={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} injection={st.injection?.line} cr={cr} seal={seal} plain={granted ? plain : null} />
          ))}
          {run?.status === 'completed' && (
            <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12, maxWidth: 820 }}>
              <Icon name="check" color="var(--ok)" />
              <span style={{ flex: 1, fontWeight: 600 }}>Run completed · authority returned</span>
              <Link className="btn" href={`/agent/runs/${run.id}/summary`}>Run summary</Link>
            </div>
          )}
        </div>
      </section>

      {/* authority */}
      <section style={{ borderLeft: '1px solid var(--border)', background: 'var(--surface)', overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <IdentityChip person={ATLAS} size="lg" sub="handle" />
        {run?.context_flagged && (
          <div style={{ padding: '12px 14px', borderRadius: 6, background: 'color-mix(in oklch, var(--pending) 12%, transparent)', display: 'flex', gap: 8 }}>
            <Icon name="alert" size={15} color="var(--pending)" style={{ marginTop: 2 }} />
            <span>Atlas context contains suspected injection. All requests escalated one tier.</span>
          </div>
        )}
        <AuthorityMeter items={st.authority} pendingSeal={{ required: 2, approvals: seal }} />
        {granted && st.grantExpires && (
          <span className="pill" style={{ ['--c' as string]: 'var(--pending)', alignSelf: 'flex-start', height: 24 }}>Access expires at {st.grantExpires.slice(11, 16)}</span>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Open requests</h2>
          <span>{Object.values(st.requests).filter((r) => r.status === 'pending' && r.id !== 'CR-0194').length}</span>
        </div>
        {Object.values(st.requests).filter((r) => r.status === 'pending' && r.id !== 'CR-0194').map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <QuorumSeal required={r.quorum?.required ?? 2} approvals={(r.quorum?.signed_by ?? []).map((s) => ({ username: s.username }))} size={28} />
            <span className="mono" style={{ fontSize: 12 }}>{r.id}</span>
            <code className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.capability}</code>
          </div>
        ))}
      </section>
    </div>
  )
}

function ErrorChart({ m }: { m: Metrics }) {
  const W = 600, H = 72
  const min = (t: string) => { const [h, mm] = t.split(':').map(Number); return (h - 3) * 60 + mm }
  const X = (t: string) => (min(t) / 31) * W
  const Y = (v: number) => H - 4 - (v / 0.4) * (H - 8)
  const line = m.points.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const markC: Record<string, string> = { deploy: 'var(--refused)', rollback: 'var(--text-muted)', approval: 'var(--accent)' }
  return (
    <div style={{ flex: 1, position: 'relative', height: H, margin: '0 44px 18px 0' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }} role="img" aria-label="Error rate since 03:00">
        {[0.4, 0.2, 0].map((v) => <line key={v} x1="0" x2={W} y1={Y(v)} y2={Y(v)} stroke={v ? 'var(--border)' : 'var(--control)'} vectorEffect="non-scaling-stroke" />)}
        {m.markers.map((k) => <line key={k.label} x1={X(k.at)} x2={X(k.at)} y1="0" y2={H} stroke={markC[k.kind] ?? 'var(--text-muted)'} vectorEffect="non-scaling-stroke" />)}
        <polyline points={line} fill="none" stroke="var(--refused)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {m.markers.map((k, i) => <span key={k.label} style={{ position: 'absolute', top: i % 2 ? 14 : -2, left: `${(X(k.at) / W) * 100}%`, marginLeft: 4, background: 'var(--bg)', paddingRight: 2, fontSize: 12, color: markC[k.kind] ?? 'var(--text-muted)', whiteSpace: 'nowrap' }}>{k.label}</span>)}
      {['40%', '20%', '0%'].map((t, i) => <span key={t} className="muted" style={{ position: 'absolute', right: -44, top: [-1, 29, 60][i], fontSize: 12 }}>{t}</span>)}
      {['03:00', '03:10', '03:20', '03:30'].map((t) => <span key={t} className="muted" style={{ position: 'absolute', top: 74, left: `${(X(t) / W) * 100}%`, transform: t === '03:00' ? 'none' : 'translateX(-50%)', fontSize: 12 }}>{t}</span>)}
    </div>
  )
}

function StreamItem({ s, open, toggle, injection, cr, seal, plain }: { s: Step; open: boolean; toggle: () => void; injection?: string; cr?: ConsoleState['requests'][string]; seal: { username: string }[]; plain: PlainRecord[] | null }) {
  if (s.kind === 'think')
    return <div className="muted" style={{ fontStyle: 'italic' }}>{s.text} <span style={{ fontStyle: 'normal', fontSize: 12 }}>{hhmmss(s.ts)}</span></div>
  if (s.kind === 'message')
    return (
      <div style={{ display: 'flex', gap: 12, maxWidth: 760 }}>
        <IdentityChip person={ATLAS} size="sm" avatarOnly />
        <div className="card" style={{ flex: 1, padding: '12px 15px', fontSize: 14, lineHeight: 1.55 }}>
          {s.text}
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Atlas · {hhmmss(s.ts)}</div>
        </div>
      </div>
    )
  if (s.status === 'refused')
    return (
      <div className="card" style={{ maxWidth: 820, borderColor: 'var(--refused)', padding: '18px 20px', display: 'flex', gap: 14 }}>
        <Icon name="lock" size={20} color="var(--refused)" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{s.error?.title ?? 'Decryption refused by Tide'}</div>
          <code style={{ color: 'var(--refused)' }}>missing role: {s.error?.missing_role}</code>
          <div className="muted">{s.error?.note ?? 'Enforced cryptographically, not by app logic.'}</div>
        </div>
      </div>
    )
  if (s.tool_name === 'request_access') {
    const inp = s.input as { capability: string; scope: { record_ids: string[] }; duration_min: number; justification: string }
    return (
      <div className="card" data-screen="A3" style={{ maxWidth: 820, borderColor: 'var(--control)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Request scoped access</h2>
          <span className="muted" style={{ fontSize: 12 }}>pre-filled by Atlas · read-only for humans</span>
          <span style={{ flex: 1 }} />
          <span className="mono muted" style={{ fontSize: 12 }}>{String(s.output?.request_id ?? '')}</span>
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', rowGap: 12, columnGap: 16, padding: '16px 18px', margin: 0 }}>
          <dt className="muted">Capability</dt><dd style={{ margin: 0 }}><code>_tide_{inp.capability}</code></dd>
          <dt className="muted">Scope</dt>
          <dd style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{inp.scope.record_ids.length} records {inp.scope.record_ids.map((id) => <code key={id} style={{ fontSize: 12, padding: '2px 7px', borderRadius: 4, background: 'var(--surface-2)' }}>{id}</code>)}</dd>
          <dt className="muted">Duration</dt><dd style={{ margin: 0 }}>{inp.duration_min} minutes</dd>
          <dt className="muted">Justification</dt><dd style={{ margin: 0, lineHeight: 1.55 }}>&ldquo;{inp.justification}&rdquo;</dd>
          <dt className="muted">Risk tier</dt><dd style={{ margin: 0 }}><RiskChip tier={s.tier ?? 'T2'} /></dd>
        </dl>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <QuorumSeal required={2} approvals={seal} size={34} />
          <span>{cr?.status === 'approved' ? `Approved ${seal.length} / 2 · threshold-signed` : `Submitted · waiting for quorum ${seal.length} / 2. Atlas cannot approve it.`}</span>
        </div>
      </div>
    )
  }
  if (s.status === 'blocked') {
    const o = s.output as { title: string; request_id: string; required: number; note: string }
    return (
      <div className="card" style={{ maxWidth: 820, borderColor: 'var(--refused)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="cross" color="var(--refused)" />
          <span style={{ fontSize: 16, fontWeight: 600 }}>{o.title}</span>
          <span className="pill" style={{ ['--c' as string]: 'var(--refused)' }}>Blocked</span>
        </div>
        <div>Change request <span className="mono">{o.request_id}</span> created · <code>{s.tool_name}</code> on <code>{String(s.input?.role)}</code></div>
        <RiskChip tier={s.tier ?? 'T3'} elevated={s.escalated ? `↑ +1 tier: ${s.escalation_reason}` : undefined} />
        <div className="muted">{o.note}</div>
      </div>
    )
  }
  return (
    <>
      <div className="card" style={{ maxWidth: 820, overflow: 'hidden' }}>
        <button onClick={toggle} aria-expanded={open} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
          <Icon name="terminal" size={14} color="var(--text-muted)" />
          <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.tool_name}({Object.entries(s.input ?? {}).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length}]` : v}`).join(', ')})</span>
          {s.tier && <RiskChip tier={s.tier} label={s.tier_note ? `${s.tier} · ${s.tier_note}` : undefined} />}
          <span className="pill">{s.status === 'pending' ? 'Pending' : 'Done'}</span>
          <span className="muted" style={{ fontSize: 12 }}>{hhmmss(s.ts)}</span>
        </button>
        {open && (
          <div style={{ borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--surface-2)' }}>
            <div style={{ padding: '10px 14px', borderRight: '1px solid var(--border)' }}><div className="muted" style={{ fontSize: 12 }}>Input</div><code style={{ wordBreak: 'break-all' }}>{JSON.stringify(s.input)}</code></div>
            <div style={{ padding: '10px 14px' }}><div className="muted" style={{ fontSize: 12 }}>Output</div><code style={{ wordBreak: 'break-word' }}>{JSON.stringify(s.output)}</code></div>
          </div>
        )}
      </div>
      {s.injection_event_id && injection && (
        <div style={{ maxWidth: 820, borderRadius: 6, background: 'var(--surface-2)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <code className="muted" style={{ fontSize: 12 }}>03:18:10 INFO settlement-worker batch=8812 status=retrying</code>
          <code style={{ fontSize: 12, textDecoration: 'underline', textDecorationColor: 'var(--warn)', textDecorationThickness: 2, textUnderlineOffset: 4 }}>03:18:11 {injection}</code>
          <span className="pill" style={{ ['--c' as string]: 'var(--warn)', alignSelf: 'flex-start' }}>Prompt injection · confidence 0.97 · French</span>
        </div>
      )}
      {isRecords(s) && <RecordsTable plain={plain} anomaly={String(s.output?.anomaly ?? '')} />}
    </>
  )
}

function RecordsTable({ plain, anomaly }: { plain: PlainRecord[] | null; anomaly: string }) {
  return (
    <div className="card" data-screen="A5" style={{ maxWidth: 980, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
        <Icon name="lock" size={14} color={plain ? 'var(--ok)' : 'var(--text-muted)'} />
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>merchants · 5 records</h2>
        <span className="muted" style={{ fontSize: 12 }}>{plain ? 'Decrypted in this browser session only · not visible to server or other users' : 'Session keys discarded at 03:28 · ciphertext only'}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr className="muted" style={{ fontSize: 12, textAlign: 'left' }}>
            {['merchant_id', 'name', 'settlement bank', 'payout currency', 'last 3 tx'].map((h) => <th key={h} style={{ fontWeight: 400, padding: '9px 16px', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {(plain ?? []).map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--rule)' }}>
              <td className="mono" style={{ padding: '9px 16px' }}>{r.id}</td>
              <td style={{ padding: '9px 16px' }}>{r.name}</td>
              <td className="mono" style={{ padding: '9px 16px' }}>{r.settlement_bank}</td>
              <td style={{ padding: '9px 16px', color: 'var(--pending)', fontWeight: 600 }}>{r.payout_currency_prev ? `${r.payout_currency_prev}→${r.payout_currency}` : r.payout_currency}</td>
              <td style={{ padding: '9px 16px' }}><span style={{ display: 'flex', gap: 5 }}>{r.last_tx.map((t) => <span key={t.id} title={t.status} style={{ width: 10, height: 10, borderRadius: 3, background: t.status === 'settled' ? 'var(--ok)' : 'var(--refused)' }} />)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!plain && <p className="muted" style={{ padding: '10px 16px', margin: 0 }}>Plaintext is gone with the session. Only the audit trail of this access remains.</p>}
      {plain && anomaly && <p style={{ padding: '10px 16px', margin: 0, color: 'var(--pending)' }}><span className="pill" style={{ ['--c' as string]: 'var(--pending)', marginRight: 8 }}>Anomaly</span>{anomaly}</p>}
    </div>
  )
}
