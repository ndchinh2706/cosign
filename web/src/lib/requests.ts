// Change requests (docs/API.md §5 /requests): one shape for E3, E4, E5, L2.
import { useEffect } from 'react'
import { apiPost, useApi } from './api'
import { API_MODE } from './config'
import { useCosignSocket } from './ws'

export type Signer = { username: string; display_name: string; signed_at: string; signature: string; ork_nodes: string }
export type ChangeRequest = {
  id: string
  type: string
  status: 'pending' | 'approved' | 'denied' | 'withdrawn' | 'expired'
  requester: { username: string; display_name: string; type: 'agent' | 'human' }
  target_user: string
  capability: string
  roles: string[]
  scope?: { record_ids?: string[]; roles?: string[]; count: number; unscoped?: boolean }
  duration_min: number | null
  justification: string
  evidence?: { log_excerpt?: string[] }
  tier: string
  escalated: boolean
  escalation_reason: string | null
  quorum: { required: number; of: number; approvals: number; eligible: { username: string; display_name: string; role: string }[]; signed_by: Signer[] }
  safety_checks: { id: string; label: string; status: 'pass' | 'fail' | 'warn' | 'info'; detail?: string }[]
  flags: string[]
  incident_id?: string
  apply_status?: 'applied' | 'failed' | 'awaiting_signature' // docs/API.md §7: Tide did not (yet) apply the role
  tide_change_request_id?: string | null
  created_at: string
}

export function useRequests() {
  const r = useApi<{ items: ChangeRequest[] }>('/requests')
  const { on } = useCosignSocket(['role:oncall', 'role:security-lead'])
  const { setData } = r
  useEffect(() => {
    const upsert = (cr: ChangeRequest) => setData((d) => (d ? { items: d.items.some((x) => x.id === cr.id) ? d.items.map((x) => (x.id === cr.id ? { ...x, ...cr } : x)) : [...d.items, cr] } : d))
    const a = on('request.updated', (e) => upsert(e.payload as unknown as ChangeRequest))
    const b = on('request.created', (e) => upsert(e.payload as unknown as ChangeRequest))
    // Mock storyboard sends only request.expired; live also sends request.updated.
    const c = on('request.expired', (e) => {
      const id = (e.payload as { id: string }).id
      setData((d) => d && { items: d.items.map((x) => (x.id === id ? { ...x, status: 'expired' } : x)) })
    })
    return () => {
      a()
      b()
      c()
    }
  }, [on, setData])
  return r
}

// The list is the source of truth: WS request.* events patch it. Mock GET /requests/:id
// always serves CR-0192, so mock reads only the list; live falls back to GET /requests/:id.
export function useRequest(id: string) {
  const list = useRequests()
  const one = useApi<ChangeRequest>(API_MODE === 'live' ? `/requests/${id}` : null)
  const item = list.data?.items.find((x) => x.id === id)
  const cr = API_MODE === 'live' ? (item ?? one.data) : item
  const set = (next: ChangeRequest) => {
    if (API_MODE === 'live') one.setData(next)
    list.setData((d) => (d ? { items: d.items.map((x) => (x.id === next.id ? next : x)) } : d))
  }
  return { cr, set, all: list.data?.items ?? [], error: one.error ?? list.error }
}

// Backend approve always 403s these (access.py _never_for_agent); the only decision left is Deny.
export const agentNeverHolds = (cr: ChangeRequest) => cr.safety_checks.some((c) => c.id === 'agent_never_holds' && c.status === 'fail')

// Mock deny fixtures are fixed to CR-0193, so mock builds the result from cr.
export const denyRequest = (cr: ChangeRequest, body: Record<string, unknown>) =>
  API_MODE === 'mock' ? Promise.resolve<ChangeRequest>({ ...cr, status: 'denied' }) : apiPost<ChangeRequest>(`/requests/${cr.id}/deny`, body)

export function approvalState(cr: ChangeRequest, me: string, roles: string[], userType?: string) {
  if (cr.requester.username === me) return 'Requester cannot approve own request.'
  if (userType === 'agent') return 'Agents can never approve requests.'
  if (roles.includes('compliance')) return 'Compliance can read but not approve.'
  const signed = cr.quorum.signed_by.find((s) => s.username === me)
  if (signed) return `You signed at ${signed.signed_at.slice(11, 16)}. ${cr.status === 'approved' ? 'Quorum reached.' : cr.status === 'pending' ? `Waiting for ${cr.quorum.required - cr.quorum.signed_by.length} more.` : `This request is ${cr.status}.`}`
  if (cr.status !== 'pending') return `This request is ${cr.status}.`
  if (!cr.quorum.eligible.some((e) => e.username === me)) return 'You are not an eligible approver.'
  return null
}
