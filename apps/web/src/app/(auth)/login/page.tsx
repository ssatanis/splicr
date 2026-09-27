import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthPanel
      aside={
        <ul className="mt-10 space-y-3 text-white/85 text-sm">
          <li className="flex gap-3">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" /> Upload FASTQ or counts; the
            library is detected for you.
          </li>
          <li className="flex gap-3">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" /> Every hit gets a calibrated chance
            it is real and a one-line reason.
          </li>
          <li className="flex gap-3">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" /> Log what validated. The scores get
            sharper for everyone.
          </li>
        </ul>
      }
    >
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </AuthPanel>
  );
}
