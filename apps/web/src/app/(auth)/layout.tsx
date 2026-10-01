/** The auth pages share the landing site's canvas, sheet and brand system. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh">{children}</main>;
}
