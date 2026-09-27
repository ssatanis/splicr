export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="sheet min-h-[calc(100vh-2*var(--sheet-margin))]">{children}</main>;
}
