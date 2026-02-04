"use client";

/**
 * Lightweight client-side analytics: fire-and-forget, batched, non-blocking.
 * Events are queued and sent every 30s or when 10 events accumulate.
 */

import type { AnalyticsEventPayload, AnalyticsEventType } from "./types";

const BATCH_INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;
const ENDPOINT = "/api/analytics/events";

let queue: AnalyticsEventPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let sessionId: string | null = null;

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  if (sessionId) return sessionId;
  try {
    sessionId = sessionStorage.getItem("analytics_session_id");
    if (!sessionId) {
      sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem("analytics_session_id", sessionId);
    }
  } catch {
    sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  return sessionId;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, BATCH_INTERVAL_MS);
}

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, 50);
  const body = JSON.stringify({
    events: batch.map((e) => ({
      ...e,
      session_id: getSessionId(),
    })),
  });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(ENDPOINT, body);
    } catch {
      fetch(ENDPOINT, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }
  } else {
    fetch(ENDPOINT, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  }
}

/**
 * Track an analytics event. Non-blocking; never throws.
 */
export function track(
  eventType: AnalyticsEventType,
  payload: Omit<AnalyticsEventPayload, "event_type"> & { event_type?: AnalyticsEventType }
): void {
  if (typeof window === "undefined") return;
  const { event_category, resource_id, resource_type, metadata, lab_id } = payload;
  queue.push({
    event_type: eventType,
    event_category: event_category ?? "feature",
    resource_id,
    resource_type,
    metadata: metadata ?? {},
    lab_id,
  });
  if (queue.length >= BATCH_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  } else {
    scheduleFlush();
  }
}

/**
 * Flush queue immediately (e.g. before page unload). Call from onbeforeunload if desired.
 */
export function flushAnalytics(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flush();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushAnalytics);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAnalytics();
  });
}
