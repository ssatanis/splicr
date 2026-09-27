"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * Whether the viewer has asked for reduced motion.
 *
 * useSyncExternalStore with a server snapshot of false, so the server renders
 * the animated form and the client corrects it on the first paint rather than
 * rendering one thing and then flipping it in an effect.
 *
 * This lives here rather than in components/three/primitives because that
 * module imports three.js: anything importing the hook from there would pull a
 * 976 KB 3D library into its bundle to ask a one-line media query.
 */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
