// Demo identities, docs/API.md §1.1. Used by the role switcher and mock /me.
export type DemoUser = {
  username: string
  displayName: string
  short: string
  type: 'agent' | 'human'
  roles: string[]
  home: string
}

export const DEMO_USERS: DemoUser[] = [
  { username: 'ai-oncall-agent', displayName: 'Atlas', short: 'Atlas', type: 'agent', roles: ['agent', '_tide_customer_pii.selfencrypt'], home: '/agent' },
  { username: 'linh.tran', displayName: 'Linh Tran', short: 'Linh', type: 'human', roles: ['oncall', 'tide-realm-admin'], home: '/incidents' },
  { username: 'marcus.lee', displayName: 'Marcus Lee', short: 'Marcus', type: 'human', roles: ['security-lead', 'tide-realm-admin', '_tide_customer_pii.selfencrypt', '_tide_customer_pii.selfdecrypt'], home: '/governance' },
  { username: 'dave.kim', displayName: 'Dave Kim', short: 'Dave', type: 'human', roles: ['platform-admin', 'tide-realm-admin'], home: '/admin/users' },
  { username: 'priya.nair', displayName: 'Priya Nair', short: 'Priya', type: 'human', roles: ['compliance'], home: '/audit' },
]

export const findUser = (username: string) => DEMO_USERS.find((u) => u.username === username)

const STORAGE_KEY = 'cosign.demoUser'
let current = DEMO_USERS[0].username
const listeners = new Set<() => void>()

export function getDemoUser(): string {
  if (typeof window !== 'undefined') current = window.localStorage.getItem(STORAGE_KEY) ?? current
  return current
}

export function setDemoUser(username: string) {
  current = username
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, username)
  listeners.forEach((l) => l())
}

export function subscribeDemoUser(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
