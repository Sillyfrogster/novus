import type { HighlightColorKey } from "./types";

export interface HighlightColor {
  label: string;
  /** Base hex. Applied in the book as a low-opacity tint via color-mix. */
  color: string;
}

export const HIGHLIGHT_COLOR_KEYS: HighlightColorKey[] = ["slate", "sage", "violet", "rose"];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorKey = "slate";

const DEFAULTS: Record<HighlightColorKey, HighlightColor> = {
  slate: { label: "Slate", color: "#9fb4d0" },
  sage: { label: "Sage", color: "#9bbcaf" },
  violet: { label: "Violet", color: "#b3a6d4" },
  rose: { label: "Rose", color: "#d3a3ad" },
};

const STORE_KEY = "novus.highlightColors";

type ColorMap = Record<HighlightColorKey, HighlightColor>;

function loadOverrides(): Partial<Record<HighlightColorKey, Partial<HighlightColor>>> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Partial<Record<HighlightColorKey, Partial<HighlightColor>>>;
  } catch {
  }
  return {};
}

/** The current color map. */
export function resolveColors(): ColorMap {
  const overrides = loadOverrides();
  const out = {} as ColorMap;
  for (const key of HIGHLIGHT_COLOR_KEYS) {
    out[key] = { ...DEFAULTS[key], ...(overrides[key] ?? {}) };
  }
  return out;
}

/** Persist a single slot's overrides */
export function saveColorOverride(
  key: HighlightColorKey,
  patch: Partial<HighlightColor>,
): ColorMap {
  const overrides = loadOverrides();
  overrides[key] = { ...(overrides[key] ?? {}), ...patch };
  localStorage.setItem(STORE_KEY, JSON.stringify(overrides));
  return resolveColors();
}

export function resetColor(key: HighlightColorKey): ColorMap {
  const overrides = loadOverrides();
  delete overrides[key];
  localStorage.setItem(STORE_KEY, JSON.stringify(overrides));
  return resolveColors();
}

/** The in-book tint for a slot. */
export function tintFor(color: string): string {
  return `color-mix(in srgb, ${color} 34%, transparent)`;
}
