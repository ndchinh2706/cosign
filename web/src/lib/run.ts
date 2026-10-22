// Agent Console state, folded from REST snapshots and WS events (docs/API.md §6.3, §8 A1–A6).
import type { AuthorityItem } from './session'
import type { Envelope } from './ws'

export type Step = {
  id: string
  seq: number
  kind: 'think' | 'tool' | 'message'
  ts: string
  status: 'ok' | 'refused' | 'blocked' | 'pending' | 'error'
  text?: string
  tool_name?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: { code: string; title?: string; missing_role?: string; note?: string }
  tier?: string
  tier_note?: string
  escalated?: boolean
  escalation_reason?: string
  injection_event_id?: string
}
export type Run = { id: string; incident_id: string; status: string; steps: Step[]; context_flagged: boolean; context_quarantined: boolean }
export type Injection = { line: string; score: number; lang: string; effect: string }
export type Request = { id: string; status: string; tier?: string; capability?: string; quorum?: { required: number; approvals: number; signed_by: { username: string }[] } }

export type ConsoleState = {
  run?: Run
  authority: AuthorityItem[]
  errorRate?: number
  injection?: Injection
  requests: Record<string, Request>
  grantExpires?: string
}

const upsertStep = (steps: Step[], s: Step) => [...steps.filter((x) => x.id !== s.id), s].sort((a, b) => a.seq - b.seq)

export function applyEvent(st: ConsoleState, e: Envelope): ConsoleState {
  const p = e.payload as Record<string, unknown>
  const run = st.run ?? { id: 'run_01', incident_id: 'INC-2417', status: 'running', steps: [], context_flagged: false, context_quarantined: false }
  switch (e.type) {
    case 'agent.step':
      return { ...st, run: { ...run, steps: upsertStep(run.steps, p as unknown as Step) } }
    case 'agent.message': {
      const id = String(p.step_id)
      const seq = Number(id.replace(/\D/g, ''))
      return { ...st, run: { ...run, steps: upsertStep(run.steps, { id, seq, kind: 'message', ts: String(p.ts), status: 'ok', text: String(p.text) }) } }
    }
    case 'agent.run.status':
      // A new run replaces the one on screen.
      if (p.run_id && p.run_id !== run.id) return { ...st, run: { ...run, id: String(p.run_id), status: String(p.status), steps: [] } }
      return { ...st, run: { ...run, status: String(p.status) } }
    case 'injection.detected':
      return { ...st, injection: p as unknown as Injection, run: { ...run, context_flagged: true } }
    case 'authority.updated':
      return { ...st, authority: (p.authority as AuthorityItem[]) ?? st.authority }
    case 'metrics.tick':
      return { ...st, errorRate: Number(p.error_rate) }
    case 'incident.updated':
      return p.error_rate === undefined ? st : { ...st, errorRate: Number(p.error_rate) }
    case 'request.created':
    case 'request.updated':
      return { ...st, requests: { ...st.requests, [String(p.id)]: p as unknown as Request } }
    case 'request.approved':
      return { ...st, grantExpires: String(p.expires_at) }
    default:
      return st
  }
}
