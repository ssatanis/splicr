/**
 * The sign-in surface belongs to the console, not to the marketing site: a
 * researcher signing in should already be looking at the product they are about
 * to use. So it is plain white edge to edge rather than the marketing sheet
 * floating on a coloured page, and `console` is the theme scope that repaints
 * everything inside it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="console min-h-dvh bg-white">{children}</main>;
}
