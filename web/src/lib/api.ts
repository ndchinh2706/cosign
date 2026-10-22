'use client'

import { useCallback, useEffect, useState } from 'react'
import { API_MODE, API_URL, MOCKS_BASE, TIDE_MODE } from './config'
import { findUser, getDemoUser } from './users'

export type ApiErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } }

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody | unknown) {
    super((body as ApiErrorBody)?.error?.message ?? `HTTP ${status}`)
  }
  get code() {
    return (this.body as ApiErrorBody)?.error?.code
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
type MockEntry = { method: Method; pattern: RegExp; file?: string | string[]; status?: number }

// method + path -> docs/mocks file (table in docs/mocks/README.md).
const p = (s: string) => new RegExp('^' + s.replace(/:[a-z_]+/g, '[^/]+') + '$')
const MOCKS: MockEntry[] = [
  { method: 'GET', pattern: p('/health'), file: 'health.json' },
  { method: 'GET', pattern: p('/me'), file: 'me.json' },
  { method: 'GET', pattern: p('/notifications'), file: 'notifications.json' },
  { method: 'GET', pattern: p('/incidents'), file: 'incidents.json' },
  { method: 'GET', pattern: p('/incidents/:id'), file: 'incident.json' },
  { method: 'GET', pattern: p('/incidents/:id/timeline'), file: 'incident-timeline.json' },
  { method: 'GET', pattern: p('/incidents/:id/metrics'), file: 'incident-metrics.json' },
  { method: 'GET', pattern: p('/incidents/:id/access'), file: 'incident-access.json' },
  { method: 'GET', pattern: p('/incidents/:id/receipt'), file: 'receipt.json' },
  { method: 'GET', pattern: p('/services'), file: 'services.json' },
  { method: 'GET', pattern: p('/deploys'), file: 'deploys.json' },
  { method: 'GET', pattern: p('/logs'), file: 'logs.json' },
  { method: 'POST', pattern: p('/agent/runs'), file: 'agent-run-create.json', status: 201 },
  { method: 'GET', pattern: p('/agent/runs'), file: 'agent-runs.json' },
  { method: 'GET', pattern: p('/agent/runs/:id'), file: 'agent-run.json' },
  { method: 'GET', pattern: p('/agent/runs/:id/summary'), file: 'agent-run-summary.json' },
  { method: 'POST', pattern: p('/requests'), file: 'request-create.json', status: 201 },
  { method: 'GET', pattern: p('/requests'), file: 'requests.json' },
  { method: 'GET', pattern: p('/requests/:id'), file: 'request.json' },
  { method: 'POST', pattern: p('/requests/:id/approve'), file: ['request-approve.json', 'request-approve-2.json'] },
  { method: 'POST', pattern: p('/requests/:id/deny'), file: 'request-deny.json' },
  { method: 'GET', pattern: p('/records'), file: 'records.json' },
  { method: 'POST', pattern: p('/records/bulk'), status: 201 }, // no mock file; 201 {count} in live mode
  { method: 'POST', pattern: p('/scan'), file: 'scan.json' },
  { method: 'GET', pattern: p('/admin/users'), file: 'admin-users.json' },
  { method: 'PUT', pattern: p('/admin/users/:u/roles'), file: 'admin-roles-put.json', status: 202 },
  { method: 'GET', pattern: p('/admin/data/merchants'), file: 'admin-merchants.json' },
  { method: 'POST', pattern: p('/admin/data/merchants/export'), file: 'admin-export.json' },
  { method: 'GET', pattern: p('/admin/audit'), file: 'audit.json' },
  { method: 'DELETE', pattern: p('/admin/audit/:id'), file: 'admin-audit-delete.json', status: 403 },
  { method: 'GET', pattern: p('/governance/overview'), file: 'governance-overview.json' },
  { method: 'GET', pattern: p('/governance/authority-map'), file: 'authority-map.json' },
  { method: 'GET', pattern: p('/policies'), file: 'policies.json' },
  { method: 'GET', pattern: p('/policies/versions'), file: 'policy-versions.json' },
  { method: 'GET', pattern: p('/agents'), file: 'agents.json' },
  { method: 'GET', pattern: p('/agents/:u'), file: 'agent-detail.json' },
  { method: 'POST', pattern: p('/agents/:u/revoke-all'), file: 'agent-revoke-all.json' },
  { method: 'GET', pattern: p('/audit'), file: 'audit.json' },
  { method: 'GET', pattern: p('/audit/:id'), file: 'audit-event.json' },
  { method: 'POST', pattern: p('/audit/:id/verify'), file: 'audit-verify.json' },
]

export async function loadMock<T = unknown>(file: string): Promise<T> {
  const res = await fetch(`${MOCKS_BASE}/${file}`)
  if (!res.ok) throw new Error(`mock ${file} missing — run npm run sync-mocks`)
  return res.json() as Promise<T>
}

const mockCalls = new Map<string, number>()

async function mockMe() {
  const user = findUser(getDemoUser())
  if (!user || user.username === 'ai-oncall-agent') return loadMock('me.json')
  const map = await loadMock<{ identities: { username: string; cells: Record<string, string> }[] }>('authority-map.json')
  const cells = map.identities.find((i) => i.username === user.username)?.cells ?? {}
  return {
    user: { username: user.username, display_name: user.displayName, type: user.type, email: `${user.username}@northwind`, avatar: 'round' },
    roles: user.roles,
    home: user.home,
    authority: Object.entries(cells).map(([capability, state]) => ({ capability, state })),
    open_requests: 0,
    context_flagged: false,
  }
}

async function mockRequest<T>(method: Method, path: string): Promise<T> {
  const pathname = path.split('?')[0]
  if (method === 'GET' && pathname === '/me') return mockMe() as Promise<T>
  const entry = MOCKS.find((m) => m.method === method && m.pattern.test(pathname))
  if (!entry?.file) return {} as T // endpoint has no mock body (e.g. 204s)
  let file = entry.file
  if (Array.isArray(file)) {
    const n = mockCalls.get(pathname) ?? 0
    mockCalls.set(pathname, n + 1)
    file = file[Math.min(n, file.length - 1)]
  }
  const body = await loadMock<T>(file)
  if ((entry.status ?? 200) >= 400) throw new ApiError(entry.status!, body)
  return body
}

let tokenGetter: (() => Promise<string | null>) | null = null
export function setTokenGetter(fn: (() => Promise<string | null>) | null) {
  tokenGetter = fn
}

export const getAuthToken = () => (TIDE_MODE === 'live' && tokenGetter ? tokenGetter() : Promise.resolve(null))

async function authHeaders(): Promise<Record<string, string>> {
  if (TIDE_MODE === 'live' && tokenGetter) {
    const token = await tokenGetter()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
  return { 'X-Demo-User': getDemoUser() } // backend AUTH_MODE=dev
}

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  if (API_MODE === 'mock') return mockRequest<T>(method, path)
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

export const apiGet = <T,>(path: string) => api<T>('GET', path)
export const apiPost = <T,>(path: string, body?: unknown) => api<T>('POST', path, body ?? {})

export function useApi<T = unknown>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: Boolean(path) })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    apiGet<T>(path).then(
      (data) => !cancelled && setState({ data, loading: false }),
      (error: Error) => !cancelled && setState((s) => ({ ...s, error, loading: false })),
    )
    return () => {
      cancelled = true
    }
  }, [path, nonce])

  const mutate = useCallback(() => {
    setState((s) => ({ ...s, loading: true }))
    setNonce((n) => n + 1)
  }, [])

  const setData = useCallback(
    (next: T | ((prev: T | undefined) => T | undefined)) =>
      setState((s) => ({ ...s, data: typeof next === 'function' ? (next as (p: T | undefined) => T | undefined)(s.data) : next })),
    [],
  )

  return { ...state, mutate, setData }
}
