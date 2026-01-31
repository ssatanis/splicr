import { getAuthenticatedUser } from '@/lib/supabase/server'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getAuthenticatedUser()

  return (
    <div>
      <header className="border-b">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold">SplicR Dashboard</h1>
          <p className="text-sm text-gray-600">{user.email}</p>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
