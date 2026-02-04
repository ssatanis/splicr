export const APPEARANCE_STORAGE_KEY = "splicr-appearance";

export type Theme = "light" | "dark" | "system";
export type AccentId = "default" | "ocean" | "forest" | "sunset" | "lavender" | "rose";
export type FontSize = "small" | "medium" | "large";
export type ColorblindMode = "none" | "protanopia" | "deuteranopia" | "tritanopia";

export interface AppearanceState {
  theme: Theme;
  color_scheme: AccentId;
  font_size: FontSize;
  compact_mode: boolean;
  reduce_animations: boolean;
  high_contrast: boolean;
  colorblind_mode: ColorblindMode;
}

export const DEFAULT_APPEARANCE: AppearanceState = {
  theme: "system",
  color_scheme: "default",
  font_size: "medium",
  compact_mode: false,
  reduce_animations: false,
  high_contrast: false,
  colorblind_mode: "none",
};

const ACCENT_COLORS: Record<AccentId, string> = {
  default: "#6ABF36",
  ocean: "#06B6D4",
  forest: "#10B981",
  sunset: "#F59E0B",
  lavender: "#A78BFA",
  rose: "#FB7185",
};

export function getStoredAppearance(): AppearanceState {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<AppearanceState>;
    return { ...DEFAULT_APPEARANCE, ...parsed };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function persistAppearance(settings: AppearanceState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function applyAppearance(settings: AppearanceState): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // Theme (dark class)
  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", isDark);

  // Accent color
  root.style.setProperty("--color-accent", ACCENT_COLORS[settings.color_scheme]);
  if (settings.color_scheme === "default") {
    root.removeAttribute("data-accent");
  } else {
    root.setAttribute("data-accent", settings.color_scheme);
  }

  // Base font size
  const fontSizes: Record<FontSize, string> = {
    small: "14px",
    medium: "16px",
    large: "18px",
  };
  root.style.fontSize = fontSizes[settings.font_size];

  // Compact mode
  root.setAttribute("data-compact", settings.compact_mode ? "true" : "false");

  // Reduce motion
  root.classList.toggle("reduce-motion", settings.reduce_animations);

  // High contrast
  root.setAttribute("data-high-contrast", settings.high_contrast ? "true" : "false");

  // Colorblind mode
  if (settings.colorblind_mode === "none") {
    root.removeAttribute("data-colorblind");
  } else {
    root.setAttribute("data-colorblind", settings.colorblind_mode);
  }
}
