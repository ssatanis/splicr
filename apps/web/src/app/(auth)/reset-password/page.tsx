import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { SetPasswordForm } from "@/components/auth/set-password-form";

export const metadata: Metadata = { title: "Choose a password" };

/**
 * Where both the password-reset link and the invitation link land.
 *
 * Reaching this page means the link's token has already been exchanged for a
 * session by `/auth/callback`. Without that session there is nothing to update,
 * which the form says rather than failing silently on submit.
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
