import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="sheet min-h-[calc(100vh-2*var(--sheet-margin))] flex flex-col items-center justify-center text-center p-10">
      <Logo />
      <h1 className="mt-8 display text-ink text-5xl">Not a hit.</h1>
      <p className="mt-4 text-body max-w-sm">That page does not exist. It may have been an artifact of an old link.</p>
      <Link href="/" className="btn btn-teal mt-8">
        Back home
      </Link>
    </main>
  );
}
