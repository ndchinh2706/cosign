// Route registry for docs/SCREENS.md §2. `proto` = file in design/prototype/ to port from.
export type Screen = { code: string; name: string; route: string; roles: string[]; proto: string }

export const SCREENS: Record<string, Screen> = {
  S1: { code: 'S1', name: 'Sign-in (Tide BYOiD)', route: '/login', roles: ['*'], proto: 'Cosign.dc.html' },
  S2: { code: 'S2', name: 'Role home redirect', route: '/', roles: ['*'], proto: 'Cosign.dc.html' },
  A1: { code: 'A1–A5', name: 'Agent Console', route: '/agent', roles: ['agent'], proto: 'Cosign Agent.dc.html' },
  A6: { code: 'A6', name: 'Run summary', route: '/agent/runs/[id]/summary', roles: ['agent', 'oncall', 'security-lead', 'compliance'], proto: 'Cosign Agent.dc.html' },
  E1: { code: 'E1', name: 'Incidents home', route: '/incidents', roles: ['oncall', 'security-lead', 'platform-admin', 'compliance'], proto: 'Cosign SRE.dc.html' },
  E2: { code: 'E2', name: 'War room', route: '/incidents/[id]', roles: ['oncall', 'security-lead', 'platform-admin', 'compliance'], proto: 'Cosign SRE.dc.html' },
  E3: { code: 'E3 (+E4)', name: 'Approval request review', route: '/requests/[id]', roles: ['oncall', 'security-lead', 'platform-admin'], proto: 'Cosign RequestReview.dc.html' },
  E5: { code: 'E5', name: 'Mobile approval', route: '/m/requests/[id]', roles: ['oncall'], proto: 'Cosign Mobile.dc.html' },
  L1: { code: 'L1', name: 'Governance overview', route: '/governance', roles: ['security-lead'], proto: 'Cosign Security.dc.html' },
  L2: { code: 'L2', name: 'Change request review (security)', route: '/governance/requests/[id]', roles: ['security-lead'], proto: 'Cosign Security.dc.html' },
  L3: { code: 'L3', name: 'Quorum policies', route: '/governance/policies', roles: ['security-lead'], proto: 'Cosign Security.dc.html' },
  L4: { code: 'L4', name: 'Agent registry', route: '/governance/agents', roles: ['security-lead'], proto: 'Cosign Security.dc.html' },
  L4D: { code: 'L4', name: 'Agent detail', route: '/governance/agents/[username]', roles: ['security-lead'], proto: 'Cosign Security.dc.html' },
  R1: { code: 'R1 (+R2)', name: 'Users & Roles', route: '/admin/users', roles: ['platform-admin', 'security-lead'], proto: 'Cosign Admin.dc.html' },
  R3: { code: 'R3', name: 'Data browser', route: '/admin/data', roles: ['platform-admin', 'security-lead'], // security-lead opens it to show the compare view decrypting
    proto: 'Cosign Admin.dc.html' },
  SEED: { code: 'Seed', name: 'Seed encrypted records', route: '/admin/data/seed', roles: ['security-lead', 'platform-admin'], proto: '(none — docs/SCREENS.md "Seed page")' },
  R4: { code: 'R4', name: 'Audit log (attempt to tamper)', route: '/admin/audit', roles: ['platform-admin'], proto: 'Cosign Admin.dc.html' },
  C1: { code: 'C1', name: 'Audit trail', route: '/audit', roles: ['compliance', 'security-lead', 'platform-admin', 'oncall'], proto: 'Cosign Compliance.dc.html' },
  C2: { code: 'C2', name: 'Access receipt', route: '/audit/receipts/[incident]', roles: ['compliance'], proto: 'Cosign Compliance.dc.html' },
}

export type NavItem = { label: string; href: string; icon: string }

// Sidebar per role, docs/SCREENS.md §2.
export const NAV_BY_ROLE: Record<string, NavItem[]> = {
  agent: [
    { label: 'Console', href: '/agent', icon: 'terminal' },
    { label: 'Run summary', href: '/agent/runs/run_01/summary', icon: 'doc' },
  ],
  oncall: [
    { label: 'Incidents', href: '/incidents', icon: 'alert' },
    { label: 'War room', href: '/incidents/INC-2417', icon: 'server' },
    { label: 'Approvals', href: '/incidents#approvals', icon: 'check' },
  ],
  'security-lead': [
    { label: 'Governance', href: '/governance', icon: 'shield' },
    { label: 'Approvals', href: '/governance#approvals', icon: 'check' },
    { label: 'Agents', href: '/governance/agents', icon: 'hex' },
    { label: 'Policies', href: '/governance/policies', icon: 'doc' },
  ],
  'platform-admin': [
    { label: 'Users & Roles', href: '/admin/users', icon: 'users' },
    { label: 'Data', href: '/admin/data', icon: 'db' },
    { label: 'Audit', href: '/admin/audit', icon: 'list' },
  ],
  compliance: [
    { label: 'Audit Trail', href: '/audit', icon: 'list' },
    { label: 'Access Receipts', href: '/audit/receipts/INC-2417', icon: 'doc' },
  ],
}

export const navFor = (roles: string[]) => roles.flatMap((r) => NAV_BY_ROLE[r] ?? [])

const routeRe = (route: string) => new RegExp('^' + route.replace(/\[[^\]]+\]/g, '[^/]+') + '$')
export const screenFor = (pathname: string) => Object.values(SCREENS).find((s) => routeRe(s.route).test(pathname))
