import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthPanel
      aside={
        <div className="mt-10 grid grid-cols-3 gap-4 text-sm">
          {[
            ["Free", "for public data, with a citation"],
            ["$150–250", "per screen for labs"],
            ["Pilots", "for cores, biotech and pharma"],
          ].map(([v, l]) => (
            <div key={v} className="rounded-2xl bg-white/10 p-4">
              <div className="text-xl font-medium">{v}</div>
              <div className="text-white/90 mt-1">{l}</div>
            </div>
          ))}
        </div>
      }
    >
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </AuthPanel>
  );
}
