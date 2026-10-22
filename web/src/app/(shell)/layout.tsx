import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'

// TODO: role guard per route group (docs/SCREENS.md §1.1) — redirect to /me.home on wrong role.
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
