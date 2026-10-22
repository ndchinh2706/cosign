import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { JetBrains_Mono, Public_Sans } from 'next/font/google'
import { Providers } from '@/components/Providers'
import { SessionProvider } from '@/lib/session'
import './globals.css'

const sans = Public_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-public' })
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains' })

export const metadata: Metadata = {
  title: 'Cosign',
  description: 'Production access for AI agents, without god keys.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <Providers>
          <SessionProvider>{children}</SessionProvider>
        </Providers>
      </body>
    </html>
  )
}
