import { create } from "zustand";

import type { ReadFont, ReadLayout, ReadTheme, TextAlign } from "../lib/types";

const SETTINGS_KEY = "novus.readerSettings";

/** Page width  */
export const MEASURE_MIN = 560;
export const MEASURE_MAX = 1000;
export const MEASURE_STEP = 40;

export interface ReaderSettings {
  readTheme: ReadTheme;
  font: ReadFont;
  fontSize: number;
  lineHeight: number;
  measure: number;
  paragraphSpacing: number;
  align: TextAlign;
  layout: ReadLayout;
  brightness: number;
}

const DEFAULTS: ReaderSettings = {
  readTheme: "dark",
  font: "serif",
  fontSize: 19,
  lineHeight: 1.7,
  measure: 720,
  paragraphSpacing: 0.5,
  align: "left",
  layout: "paged",
  brightness: 1,
};

function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const merged = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ReaderSettings>) };
      if (merged.measure < MEASURE_MIN || merged.measure > MEASURE_MAX) {
        merged.measure = DEFAULTS.measure;
      }
      return merged;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULTS;
}

interface ReaderStore extends ReaderSettings {
  set: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void;
}

function persist(s: ReaderSettings): void {
  const data: ReaderSettings = {
    readTheme: s.readTheme,
    font: s.font,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    measure: s.measure,
    paragraphSpacing: s.paragraphSpacing,
    align: s.align,
    layout: s.layout,
    brightness: s.brightness,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

export const useReaderSettings = create<ReaderStore>((set, get) => ({
  ...loadSettings(),
  set: (key, value) => {
    set({ [key]: value } as Pick<ReaderSettings, typeof key>);
    persist(get());
  },
}));

export const FONT_STACKS: Record<ReadFont, string> = {
  serif: "'Lora', Georgia, 'Times New Roman', serif",
  sans: "'Hanken Grotesk', system-ui, sans-serif",
  modern: "'Source Serif 4', Georgia, serif",
};

export const FONT_LABELS: Record<ReadFont, string> = {
  serif: "Serif",
  sans: "Sans",
  modern: "Modern",
};
