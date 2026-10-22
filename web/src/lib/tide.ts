'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { apiGet, loadMock } from './api'
import { API_MODE, TIDE_MODE } from './config'
import { findUser, getDemoUser } from './users'

// Signatures follow docs/API.md §6.4 / docs/SCREENS.md (IAMService.doEncrypt / doDecrypt).
export type EncryptItem = { data: string; tags: string[] }
export type DecryptItem = { encrypted: string; tags: string[] }

export class TideRefusedError extends Error {
  code = 'tide_refused' as const
  constructor(public missingRole: string, public raw?: unknown) {
    super(`Decryption refused by Tide (missing role ${missingRole})`)
  }
}

export type TideApi = {
  mode: 'mock' | 'live'
  ready: boolean
  authenticated: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
  getToken: () => Promise<string | null>
  refreshToken: () => Promise<boolean>
  hasRealmRole: (role: string) => boolean
  doEncrypt: (items: EncryptItem[]) => Promise<string[]>
  doDecrypt: (items: DecryptItem[]) => Promise<string[]>
}

const MOCK_PREFIX = 'MOCK-CIPHERTEXT-'
const selfDecryptRole = (tag: string) => `_tide_${tag}.selfdecrypt`
// UTF-8 safe base64 (records contain '→', which plain btoa rejects).
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))
const mockRoles = () => findUser(getDemoUser())?.roles ?? []

type Authority = { capability: string; state: string; expires_at?: string }

// Live API: the server's authority is the source of truth, re-read on every decrypt so a quorum grant applies at once.
async function canSelfDecrypt(tag: string): Promise<boolean> {
  if (API_MODE !== 'live') return mockRoles().includes(selfDecryptRole(tag))
  const me = await apiGet<{ authority?: Authority[] }>(`/me?as=${getDemoUser()}`)
  const a = me.authority?.find((x) => x.capability === `${tag}.selfdecrypt`)
  if (!a) return false
  if (a.state === 'allowed') return true
  return a.state === 'granted' && (!a.expires_at || Date.parse(a.expires_at) > Date.now())
}

async function mockDecrypt(items: DecryptItem[]): Promise<string[]> {
  for (const it of items) {
    for (const tag of it.tags) {
      if (!(await canSelfDecrypt(tag))) throw new TideRefusedError(selfDecryptRole(tag))
    }
  }
  // Seeded mock ciphertexts map back to records-plaintext-demo-only.json; our own mock output is base64.
  const [records, plain] = await Promise.all([
    loadMock<{ items: { id: string; ciphertext: string }[] }>('records.json'),
    loadMock<{ items: { id: string }[] }>('records-plaintext-demo-only.json'),
  ])
  return items.map(({ encrypted }) => {
    const id = records.items.find((r) => r.ciphertext === encrypted)?.id
    const rec = plain.items.find((r) => r.id === id)
    if (rec) return JSON.stringify(rec)
    if (encrypted.startsWith(MOCK_PREFIX + 'b64:')) return unb64(encrypted.slice(MOCK_PREFIX.length + 4))
    throw new Error('decrypt_error: unknown mock ciphertext')
  })
}

const mockRefresh = async () => true

function useMockTide(): TideApi {
  return {
    mode: 'mock',
    ready: true,
    authenticated: true,
    login: async () => {},
    logout: async () => {},
    getToken: async () => null,
    refreshToken: mockRefresh,
    hasRealmRole: (role) => mockRoles().includes(role),
    doEncrypt: async (items) => items.map((i) => MOCK_PREFIX + 'b64:' + b64(i.data)),
    doDecrypt: mockDecrypt,
  }
}

function useLiveTide(): TideApi {
  const tc = useTideCloak()
  return {
    mode: 'live',
    ready: !tc.isInitializing,
    authenticated: tc.authenticated,
    login: tc.login,
    logout: tc.logout,
    getToken: tc.getToken,
    refreshToken: tc.forceRefreshToken,
    hasRealmRole: tc.hasRealmRole,
    doEncrypt: (items) => tc.doEncrypt(items),
    doDecrypt: async (items) => {
      try {
        return await tc.doDecrypt(items)
      } catch (e) {
        // CẦN KIỂM CHỨNG: exact error shape the SDK throws on a missing role.
        const msg = String((e as Error)?.message ?? e)
        const role = msg.match(/_tide_[\w.]+/)?.[0]
        if (role) throw new TideRefusedError(role, msg)
        throw e
      }
    },
  }
}

// TIDE_MODE is a build-time constant, so the chosen hook is stable across renders.
export const useTide: () => TideApi = TIDE_MODE === 'live' ? useLiveTide : useMockTide
