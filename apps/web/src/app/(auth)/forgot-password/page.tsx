import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthPanel>
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </AuthPanel>
  );
}
