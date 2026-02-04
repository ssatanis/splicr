import { getAuthenticatedUser } from '@/lib/supabase/server'
import AppHeader from '@/components/AppHeader'
import AppFooter from '@/components/AppFooter'
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
      <div className="min-h-screen bg-background flex flex-col">
        <Sidebar />
        <AppHeader />
        <MainContent>{children}</MainContent>
        <AppFooter />
      </div>
    </SidebarProvider>
  )
}
