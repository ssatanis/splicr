import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { PublicVerifyCodeForm } from "@/components/auth/verify-code-form";

export const metadata: Metadata = { title: "Verify your code" };

export default function VerifyCodePage() {
  return (
    <AuthPanel>
      <Suspense>
        <PublicVerifyCodeForm />
      </Suspense>
    </AuthPanel>
  );
}
