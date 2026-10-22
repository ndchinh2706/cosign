import type { ReactNode } from 'react'

// E5 mobile shell: no sidebar, 390px column.
export default function MobileLayout({ children }: { children: ReactNode }) {
  return <div style={{ maxWidth: 390, margin: '0 auto', minHeight: '100vh' }}>{children}</div>
}
