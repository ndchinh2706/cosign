import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Providers } from '@/components/Providers'
import { SessionProvider } from '@/lib/session'
import './globals.css'

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })

export const metadata: Metadata = {
  title: 'Cosign',
  description: 'Production access for AI agents, without god keys.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <SessionProvider>{children}</SessionProvider>
        </Providers>
      </body>
    </html>
  )
}
