'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { loadMock } from './api'
import { TIDE_MODE } from './config'
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

async function mockDecrypt(items: DecryptItem[]): Promise<string[]> {
  for (const it of items) {
    for (const tag of it.tags) {
      if (!mockRoles().includes(selfDecryptRole(tag))) throw new TideRefusedError(selfDecryptRole(tag))
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
