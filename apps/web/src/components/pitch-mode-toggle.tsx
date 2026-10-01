"use client";

/**
 * Cmd/Ctrl+Shift+D between the current page and the illustrative workspace.
 *
 * NOT mounted in the root layout. A hidden gesture on every page of the public
 * site that jumps to a console of invented figures is a surprise a visitor did
 * not ask for, and /pitch is gated with the real console anyway
 * (lib/supabase/proxy.ts), so the shortcut would have redirected to the homepage
 * on a public deployment. Mount it inside a layout that is already behind the
 * console flag if you want the gesture back.
 */

import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

import { honestRoute } from "@/components/pitch/model";

const RETURN_PATH = "splicr:pitch-return-path";

export function PitchModeToggle() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.code === "KeyD" &&
        event.shiftKey &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        if (pathname.startsWith("/pitch")) {
          router.push(honestRoute(window.sessionStorage.getItem(RETURN_PATH)));
          return;
        }
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.sessionStorage.setItem(RETURN_PATH, honestRoute(current));
        router.push("/pitch");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  return null;
}
