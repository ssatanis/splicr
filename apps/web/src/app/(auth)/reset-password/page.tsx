import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { SetPasswordForm } from "@/components/auth/set-password-form";

export const metadata: Metadata = { title: "Create your password" };

/**
 * Where both the password-reset code and invitation code flows land.
 *
 * Reaching this page normally means the code has already been exchanged for a
 * session. Without that session there is nothing to update, which the form says
 * rather than failing silently on submit.
 */
export default function ResetPasswordPage() {
  return (
    <AuthPanel>
      <Suspense>
        <SetPasswordForm />
      </Suspense>
    </AuthPanel>
  );
}
