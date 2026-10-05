"use client";

import Script from "next/script";
import { useRef } from "react";

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (options: { url: string; parentElement: HTMLElement }) => void;
    };
  }
}

/**
 * Calendly's own colours, overridden with ours so the embed reads as part of the
 * page rather than a third-party rectangle dropped into it. Calendly wants hex
 * without the leading hash, and silently ignores anything it cannot parse.
 */
const BRAND = new URLSearchParams({
  hide_gdpr_banner: "1",
  hide_landing_page_details: "1",
  //  Drops Calendly's own header block: organiser, event name, duration and
  //  conferencing note. All four are already stated beside the embed, and
  //  carrying them twice is what forces the widget into an internal scrollbar.
  hide_event_type_details: "1",
  background_color: "ffffff",
  text_color: "174f62",
  primary_color: "c2560a",
});

/**
 * An inline Calendly booking widget.
 *
 * WHY THE SCRIPT IS RE-RUN ON MOUNT
 *
 * widget.js scans the document for `.calendly-inline-widget` when it first
 * loads. On a client-side navigation to this page the script is already loaded,
 * that scan has long since happened, and the host element would stay empty. So
 * the host is left bare and filled by `initInlineWidget` from `onReady`, which
 * next/script fires on first load *and* on every subsequent mount.
 *
 * The container is cleared first because a re-mount would otherwise stack a
 * second iframe underneath the first.
 */
export function CalendlyInline({ url, className }: { url: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={host} className={className} aria-label="Booking calendar" />
      <Script
        src="https://assets.calendly.com/assets/external/widget.js"
        strategy="afterInteractive"
        onReady={() => {
          if (!host.current || !window.Calendly) return;
          host.current.replaceChildren();
          window.Calendly.initInlineWidget({
            url: `${url}?${BRAND.toString()}`,
            parentElement: host.current,
          });
        }}
      />
    </>
  );
}
