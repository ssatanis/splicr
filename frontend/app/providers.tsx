"use client";

import { ReactNode } from "react";
import { UserProvider } from "@/lib/context/UserContext";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return <UserProvider>{children}</UserProvider>;
}
