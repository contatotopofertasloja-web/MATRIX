import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '@boilerplate/ui/globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Matrix',
  description: 'SaaS de bots de WhatsApp com IA',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
