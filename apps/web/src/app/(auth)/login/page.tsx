import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPanel } from "@/components/auth/auth-panel";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthPanel>
      <Suspense>
        <AuthForm />
      </Suspense>
    </AuthPanel>
  );
}
