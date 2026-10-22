import type { ReactNode } from 'react'
import { AppShell, AuthGate } from '@/components/AppShell'

// TODO: role guard per route group (docs/SCREENS.md §1.1) — redirect to /me.home on wrong role.
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  )
}
