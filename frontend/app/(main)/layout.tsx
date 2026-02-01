import { getAuthenticatedUser } from '@/lib/supabase/server'
import AppHeader from '@/components/AppHeader'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Skip server-side auth for static export (Electron desktop); auth is enforced client-side
  if (process.env.ELECTRON_BUILD !== 'true') {
    await getAuthenticatedUser()
  }

  return (
    <div>
      <AppHeader />
      <main>{children}</main>
    </div>
  )
}
