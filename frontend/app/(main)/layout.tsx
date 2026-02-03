import { getAuthenticatedUser } from '@/lib/supabase/server'
import AppHeader from '@/components/AppHeader'
import Sidebar from '@/components/Sidebar'
import { SidebarProvider } from '@/lib/context/SidebarContext'
import MainContent from '@/components/MainContent'

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
    <SidebarProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <AppHeader />
        <MainContent>{children}</MainContent>
      </div>
    </SidebarProvider>
  )
}
