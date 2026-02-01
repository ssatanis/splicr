import { ReactNode } from 'react';

// Required for static export (Electron build). Client-side navigation handles all result ids.
export function generateStaticParams() {
  return [{ id: 'view' }];
}

export default function ResultLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
