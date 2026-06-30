import { create } from "zustand";

import {
  addHighlight,
  deleteHighlight,
  listHighlights,
  setHighlightColor,
  setHighlightNote,
  type NewHighlight,
} from "../lib/ipc";
import {
  resolveColors,
  saveColorOverride,
  resetColor,
  type HighlightColor,
} from "../lib/highlightColors";
import type { Highlight, HighlightColorKey } from "../lib/types";

type ColorMap = Record<HighlightColorKey, HighlightColor>;

export interface CaptureInput {
  id?: string;
  bookId: string;
  cfi: string;
  text: string;
  chapterLabel: string | null;
  chapterHref: string | null;
  sectionIndex: number;
  location: number | null;
  color: HighlightColorKey;
}

function bookOrder(a: Highlight, b: Highlight): number {
  if (a.sectionIndex !== b.sectionIndex) return a.sectionIndex - b.sectionIndex;
  const al = a.location ?? Number.MAX_SAFE_INTEGER;
  const bl = b.location ?? Number.MAX_SAFE_INTEGER;
  if (al !== bl) return al - bl;
  return a.createdAt - b.createdAt;
}

interface HighlightStore {
  bookId: string | null;
  highlights: Highlight[];
  colors: ColorMap;
  loading: boolean;

  loadFor: (bookId: string) => Promise<void>;
  capture: (input: CaptureInput) => Promise<Highlight | null>;
  updateNote: (id: string, note: string | null) => Promise<void>;
  setColor: (id: string, color: HighlightColorKey) => Promise<void>;
  remove: (id: string) => Promise<Highlight | null>;
  restore: (h: Highlight) => Promise<void>;

  renameColor: (key: HighlightColorKey, label: string) => void;
  recolor: (key: HighlightColorKey, color: string) => void;
  resetColorSlot: (key: HighlightColorKey) => void;
}

export const useHighlights = create<HighlightStore>((set, get) => ({
  bookId: null,
  highlights: [],
  colors: resolveColors(),
  loading: false,

  loadFor: async (bookId) => {
    set((s) => ({ bookId, loading: true, highlights: s.bookId === bookId ? s.highlights : [] }));
    try {
      const highlights = await listHighlights(bookId);
      if (get().bookId === bookId) set({ highlights, loading: false });
    } catch {
      if (get().bookId === bookId) set({ highlights: [], loading: false });
    }
  },

  capture: async ({ id: providedId, ...input }) => {
    const id = providedId ?? crypto.randomUUID();
    const payload: NewHighlight = { id, note: null, ...input };
    const optimistic: Highlight = { ...payload, createdAt: Math.floor(Date.now() / 1000) };
    set((s) => ({ highlights: [...s.highlights, optimistic].sort(bookOrder) }));
    try {
      const saved = await addHighlight(payload);
      set((s) => ({
        highlights: s.highlights.map((h) => (h.id === id ? saved : h)).sort(bookOrder),
      }));
      return saved;
    } catch {
      set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) }));
      return null;
    }
  },

  updateNote: async (id, note) => {
    const clean = note && note.trim() ? note.trim() : null;
    const prev = get().highlights;
    set((s) => ({ highlights: s.highlights.map((h) => (h.id === id ? { ...h, note: clean } : h)) }));
    try {
      await setHighlightNote(id, clean);
    } catch {
      set({ highlights: prev });
    }
  },

  setColor: async (id, color) => {
    const prev = get().highlights;
    set((s) => ({ highlights: s.highlights.map((h) => (h.id === id ? { ...h, color } : h)) }));
    try {
      await setHighlightColor(id, color);
    } catch {
      set({ highlights: prev });
    }
  },

  remove: async (id) => {
    const removed = get().highlights.find((h) => h.id === id) ?? null;
    set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) }));
    try {
      await deleteHighlight(id);
      return removed;
    } catch {
      if (removed) set((s) => ({ highlights: [...s.highlights, removed].sort(bookOrder) }));
      return null;
    }
  },

  restore: async (h) => {
    set((s) => ({ highlights: [...s.highlights, h].sort(bookOrder) }));
    try {
      const { createdAt, ...rest } = h;
      void createdAt;
      await addHighlight(rest);
    } catch {
      set((s) => ({ highlights: s.highlights.filter((x) => x.id !== h.id) }));
    }
  },

  renameColor: (key, label) => set({ colors: saveColorOverride(key, { label }) }),
  recolor: (key, color) => set({ colors: saveColorOverride(key, { color }) }),
  resetColorSlot: (key) => set({ colors: resetColor(key) }),
}));
