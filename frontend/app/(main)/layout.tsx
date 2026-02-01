import { getAuthenticatedUser } from '@/lib/supabase/server'
import AppHeader from '@/components/AppHeader'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await getAuthenticatedUser()

  return (
    <div>
      <AppHeader />
      <main>{children}</main>
    </div>
  )
}
