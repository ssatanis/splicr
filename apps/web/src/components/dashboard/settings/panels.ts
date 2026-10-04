/**
 * The panel list, shared by the server page and the client shell.
 *
 * It lives in its own module on purpose. Every export of a "use client" module
 * becomes a client reference, so `isPanelKey` could not be called while
 * rendering the page if it were declared beside the component that uses it.
 */

export const SETTINGS_PANELS = [
  { key: "profile", label: "Profile" },
  { key: "lab", label: "Lab" },
  { key: "usage", label: "People and usage" },
  { key: "analysis", label: "Analysis defaults" },
  { key: "qc", label: "QC thresholds" },
  { key: "retention", label: "Data retention" },
  { key: "notifications", label: "Notifications" },
  { key: "danger", label: "Danger zone" },
] as const;

export type PanelKey = (typeof SETTINGS_PANELS)[number]["key"];

export const DEFAULT_PANEL: PanelKey = "profile";

const KEYS: readonly string[] = SETTINGS_PANELS.map((panel) => panel.key);

/** Whether `?panel=` names a real panel. Anything else falls back. */
export function isPanelKey(value: unknown): value is PanelKey {
  return typeof value === "string" && KEYS.includes(value);
}
